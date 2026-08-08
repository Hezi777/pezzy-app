import "server-only";

import { cached } from "@/lib/cache";
import { getCatalog, getCatalogIndex, toListTitle } from "@/lib/catalog-service";
import { byScoreDesc } from "./index";
import { getProfileContext } from "./profile-context";
import type { RecoRow, Title } from "@/lib/types";

/**
 * Model-facing chat assistant. This is the one place a model call happens for
 * the chatbot (see CLAUDE.md - AI ownership). Groq is the current provider;
 * the input/output contract (profileId, message -> AssistantReply) is kept
 * provider-neutral so it can be swapped without touching the chat route.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// Verified against Groq's live /v1/models list: supports tools, json_mode and
// structured_outputs, same family already used for subtitle translation.
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const CHAT_CACHE_TTL_MS = 10 * 60 * 1000; // PRD R3 - don't pay for the same ask twice.
const SHORTLIST_SIZE = 60;
const ROW_SIZE = 12;
// Kept smaller than the chat SHORTLIST_SIZE: each candidate here also carries
// a synopsis, and the org's Groq tier caps tokens-per-minute at 8000 - a full
// 60-title payload with synopses plus an unbounded output budget blew past it.
const ROW_SHORTLIST_SIZE = 40;
// gpt-oss is a reasoning model - it spends completion tokens on hidden
// reasoning before the final JSON, so this needs real headroom or the call
// gets cut off mid-generation (see the json_validate_failed case this guards).
const ROW_MAX_COMPLETION_TOKENS = 1800;

const SYSTEM_PROMPT = `You are Pezzy, a friendly anime-streaming assistant embedded in a chat widget.
Reply in 1-3 short, casual sentences, like a knowledgeable friend, not a formal assistant.
Never use em dashes or en dashes; use a comma, a period, or a plain hyphen instead.
You are given "candidates": a shortlist of real catalog titles (id, title, year, genres, score,
format), plus the profile's My List, continue-watching, and recently watched titles. You may ONLY
recommend titles that appear in "candidates" - never invent a title, and never name a title that is
not in that list. If the user is not asking for a recommendation, just answer conversationally and
set wantsRow to false with an empty titleIds array. When you do recommend, choose the best-fitting
ids from candidates, set wantsRow to true, write a short rowLabel (e.g. "Mecha picks"), a one-sentence
reason, and list the chosen ids in titleIds, most relevant first, at most 12.`;

export interface AssistantReply {
  reply: string;
  row?: RecoRow;
}

const ROW_SYSTEM_PROMPT = `You are Pezzy's homepage row composer. The user typed a free-text request
for a custom row of anime titles (e.g. "revenge stories with a great villain"). You are given
"candidates": a shortlist of real catalog titles (id, title, year, genres, score, format, synopsis).
You may ONLY pick ids that appear in "candidates" - never invent a title or use an id that is not
listed. Read each candidate's synopsis and genres to judge fit, don't just pattern-match a keyword.
Write a short, punchy rowLabel that reads like a real streaming-service rail title (e.g. "Revenge
plots with unforgettable villains"), not a restatement of the prompt, plus a one-sentence reason
explaining the pick. Choose the best-fitting ids from candidates, most relevant first, at most 12.
If nothing fits well, still choose the closest reasonable picks - never return an empty list.
Never use em dashes or en dashes anywhere in rowLabel or reason; use a comma, period, or plain
hyphen instead.`;

function rowSchema() {
  return {
    type: "object",
    properties: {
      rowLabel: { type: "string" },
      reason: { type: "string" },
      titleIds: { type: "array", items: { type: "string" } },
    },
    required: ["rowLabel", "reason", "titleIds"],
    additionalProperties: false,
  };
}

// Generic English filler that would otherwise swamp genuine signal words when
// scanning the prompt for lexical overlap with a title's genres/title/synopsis.
const PROMPT_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are", "was", "were",
  "be", "been", "i", "me", "my", "we", "our", "you", "your", "it", "its", "this", "that", "these",
  "those", "want", "would", "like", "something", "some", "any", "show", "shows", "anime", "watch",
  "watching", "story", "stories", "about", "also", "can", "just", "really", "very", "get", "give",
  "find", "looking", "look",
]);

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * Lexical overlap between the prompt and a title's genres/title/synopsis.
 * Synopsis carries the richest signal for an open-ended ask like "revenge
 * stories with a great villain" - genres alone can't tell a revenge plot from
 * any other Action show, but a synopsis usually says so in plain words.
 */
function scoreTitleForPrompt(title: Title, promptTokens: Set<string>): number {
  let score = 0;
  for (const token of title.genres.flatMap((g) => tokenize(g))) {
    if (promptTokens.has(token)) score += 3;
  }
  for (const token of tokenize(title.title)) {
    if (promptTokens.has(token)) score += 2;
  }
  for (const token of tokenize(title.synopsis ?? "")) {
    if (promptTokens.has(token)) score += 1;
  }
  return score;
}

/**
 * Grounded candidates for an open-ended row prompt: rank the whole catalog by
 * lexical overlap with the prompt (title/genres/synopsis) so vague asks like
 * "shows where the main character is secretly the bad guy" still surface
 * plausible synopsis matches instead of only a keyword-matched genre. Then
 * top up with the profile's watched genres, top-rated, and popularity order
 * so the model always has a full, diverse list even when the prompt has weak
 * lexical signal (e.g. "i want to cry").
 */
function buildPromptShortlist(
  catalog: Title[],
  byId: Map<string, Title>,
  profileContext: ReturnType<typeof getProfileContext>,
  prompt: string
): Title[] {
  const chosen = new Set<string>();
  const list: Title[] = [];

  const add = (id: string) => {
    if (chosen.has(id) || list.length >= ROW_SHORTLIST_SIZE) return;
    const title = byId.get(id);
    if (!title) return;
    chosen.add(id);
    list.push(title);
  };

  const promptTokens = new Set(
    tokenize(prompt).filter((token) => token.length > 2 && !PROMPT_STOPWORDS.has(token))
  );

  if (promptTokens.size > 0) {
    const ranked = catalog
      .map((title) => ({ title, relevance: scoreTitleForPrompt(title, promptTokens) }))
      .filter((entry) => entry.relevance > 0)
      .sort(
        (a, b) => b.relevance - a.relevance || (b.title.score ?? 0) - (a.title.score ?? 0)
      );
    for (const entry of ranked) add(entry.title.id);
  }

  const watchedGenres = new Set(
    profileContext.watchedTitleIds.flatMap((id) => byId.get(id)?.genres ?? [])
  );
  const genreMatches = byScoreDesc(
    catalog.filter((title) => title.genres.some((genre) => watchedGenres.has(genre)))
  );
  for (const title of genreMatches) add(title.id);

  const topRated = byScoreDesc(catalog);
  for (const title of topRated) add(title.id);

  for (const title of catalog) add(title.id);

  return list;
}

function truncateSynopsis(text: string | undefined, max = 160): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

// Belt and suspenders beyond the system prompt instruction - the system
// prompt forbids em/en dashes, but model output can't be trusted on its own.
function stripDashes(text: string): string {
  return text.replace(/[‐-―]/g, "-");
}

async function callRowGeneration(
  apiKey: string,
  profileId: string,
  prompt: string
): Promise<RecoRow> {
  const catalog = await getCatalog();
  const byId = getCatalogIndex();
  const profileContext = getProfileContext(profileId);
  const shortlist = buildPromptShortlist(catalog, byId, profileContext, prompt);

  const candidatesPayload = shortlist.map((title) => ({
    id: title.id,
    title: title.title,
    year: title.year,
    genres: title.genres,
    score: title.score,
    format: title.format ?? "tv",
    synopsis: truncateSynopsis(title.synopsis),
  }));

  const profileSummary = {
    name: profileContext.profile?.name,
    myList: profileContext.myListIds.map((id) => byId.get(id)?.title).filter(Boolean),
    recentlyWatched: profileContext.watchedTitleIds
      .slice(0, 10)
      .map((id) => byId.get(id)?.title)
      .filter(Boolean),
  };

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.GROQ_CHAT_MODEL ?? DEFAULT_MODEL,
      temperature: 0.4,
      // Without a cap Groq reserves the full remaining context as "requested"
      // tokens against the org's tokens-per-minute limit, so an unbounded
      // default alone was enough to blow the budget even on a small prompt.
      max_completion_tokens: ROW_MAX_COMPLETION_TOKENS,
      messages: [
        { role: "system", content: ROW_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({ prompt, profile: profileSummary, candidates: candidatesPayload }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "row_reply", strict: true, schema: rowSchema() },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Groq row generation failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned no row content");

  const parsed = JSON.parse(content) as {
    rowLabel?: string;
    reason?: string;
    titleIds?: string[];
  };

  // Only ids we actually shortlisted (themselves drawn from the catalog) can
  // ever become a rendered title - a hallucinated id is filtered out here.
  const shortlistIds = new Set(shortlist.map((title) => title.id));
  const resolvedTitles = (parsed.titleIds ?? [])
    .filter((id) => shortlistIds.has(id))
    .map((id) => byId.get(id))
    .filter((title): title is Title => Boolean(title))
    .slice(0, ROW_SIZE)
    .map(toListTitle);

  if (resolvedTitles.length === 0) throw new Error("Groq row had no resolvable titles");

  return {
    id: `chat-ai-${Date.now()}`,
    label: stripDashes(parsed.rowLabel || "Picked for you"),
    reason: parsed.reason ? stripDashes(parsed.reason) : undefined,
    aiGenerated: true,
    titles: resolvedTitles,
  };
}

/**
 * Real Groq-backed row for the homepage's "Make your own row" composer.
 * Returns null when there is no GROQ_API_KEY or the call fails/produces no
 * resolvable titles, so the route can fall back to the deterministic
 * chatRow ranker instead of surfacing an error to the user.
 */
export async function generateRowFromPrompt(
  profileId: string,
  prompt: string
): Promise<RecoRow | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const cacheKey = `chat-row-llm:${profileId}:${prompt}`;
  try {
    return await cached(cacheKey, CHAT_CACHE_TTL_MS, () => callRowGeneration(apiKey, profileId, prompt));
  } catch {
    return null;
  }
}

function responseSchema() {
  return {
    type: "object",
    properties: {
      reply: { type: "string" },
      wantsRow: { type: "boolean" },
      rowLabel: { type: "string" },
      reason: { type: "string" },
      titleIds: { type: "array", items: { type: "string" } },
    },
    required: ["reply", "wantsRow", "rowLabel", "reason", "titleIds"],
    additionalProperties: false,
  };
}

/**
 * Build a grounded candidate set: personal signal first (continue watching,
 * My List, genres the profile actually watches), then top-rated and popular
 * titles so there's always broad coverage. The model can only pick ids from
 * this list, and every id in it comes straight from the catalog.
 */
function buildShortlist(
  catalog: Title[],
  byId: Map<string, Title>,
  profileContext: ReturnType<typeof getProfileContext>
): Title[] {
  const chosen = new Set<string>();
  const list: Title[] = [];

  const add = (id: string) => {
    if (chosen.has(id) || list.length >= SHORTLIST_SIZE) return;
    const title = byId.get(id);
    if (!title) return;
    chosen.add(id);
    list.push(title);
  };

  profileContext.continueWatchingIds.forEach(add);
  profileContext.myListIds.forEach(add);

  const watchedGenres = new Set(
    profileContext.watchedTitleIds.flatMap((id) => byId.get(id)?.genres ?? [])
  );
  const genreMatches = byScoreDesc(
    catalog.filter((title) => title.genres.some((genre) => watchedGenres.has(genre)))
  );
  for (const title of genreMatches) add(title.id);

  const topRated = byScoreDesc(catalog);
  for (const title of topRated) add(title.id);

  // Catalog order is popularity (see catalog-service.ts) - final fallback.
  for (const title of catalog) add(title.id);

  return list;
}

async function callAssistant(
  apiKey: string,
  profileId: string,
  message: string
): Promise<AssistantReply> {
  const catalog = await getCatalog();
  const byId = getCatalogIndex();
  const profileContext = getProfileContext(profileId);
  const shortlist = buildShortlist(catalog, byId, profileContext);

  const candidatesPayload = shortlist.map((title) => ({
    id: title.id,
    title: title.title,
    year: title.year,
    genres: title.genres,
    score: title.score,
    format: title.format ?? "tv",
  }));

  const profileSummary = {
    name: profileContext.profile?.name,
    myList: profileContext.myListIds.map((id) => byId.get(id)?.title).filter(Boolean),
    continueWatching: profileContext.continueWatchingIds
      .map((id) => byId.get(id)?.title)
      .filter(Boolean),
    recentlyWatched: profileContext.watchedTitleIds
      .slice(0, 10)
      .map((id) => byId.get(id)?.title)
      .filter(Boolean),
  };

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.GROQ_CHAT_MODEL ?? DEFAULT_MODEL,
      temperature: 0.4,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({ message, profile: profileSummary, candidates: candidatesPayload }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "assistant_reply", strict: true, schema: responseSchema() },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Groq chat failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned no reply");

  const parsed = JSON.parse(content) as {
    reply?: string;
    wantsRow?: boolean;
    rowLabel?: string;
    reason?: string;
    titleIds?: string[];
  };
  if (!parsed.reply) throw new Error("Groq reply missing text");

  // Belt and suspenders: only ids we actually shortlisted (themselves drawn
  // from the catalog) can ever become a rendered title.
  const shortlistIds = new Set(shortlist.map((title) => title.id));
  const resolvedTitles = (parsed.titleIds ?? [])
    .filter((id) => shortlistIds.has(id))
    .map((id) => byId.get(id))
    .filter((title): title is Title => Boolean(title))
    .slice(0, ROW_SIZE)
    .map(toListTitle);

  const row: RecoRow | undefined =
    parsed.wantsRow && resolvedTitles.length > 0
      ? {
          id: `chat-${Date.now()}`,
          label: parsed.rowLabel || "Picked for you",
          reason: parsed.reason || undefined,
          aiGenerated: true,
          titles: resolvedTitles,
        }
      : undefined;

  return { reply: parsed.reply, row };
}

/**
 * Real Groq-backed reply for the chat widget. Returns null when there is no
 * GROQ_API_KEY or the call fails so the route can fall back to the
 * deterministic ranker instead of surfacing an error to the user.
 */
export async function chatWithAssistant(
  profileId: string,
  message: string
): Promise<AssistantReply | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const cacheKey = `chat-llm:${profileId}:${message}`;
  try {
    return await cached(cacheKey, CHAT_CACHE_TTL_MS, () => callAssistant(apiKey, profileId, message));
  } catch {
    return null;
  }
}
