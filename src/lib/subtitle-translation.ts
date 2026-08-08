import "server-only";

import { SUBTITLE_LANGUAGES } from "@/lib/subtitle-languages";
import type { SubtitleCue } from "@/lib/types";

export { SUBTITLE_LANGUAGES };

const BATCH_SIZE = 30;
// Groq's on-demand tier caps this model at 8000 tokens/min (measured), so only
// two languages are translated at once; more than that just trades 429s for
// concurrency with no net speedup.
const MAX_CONCURRENT_LANGUAGES = 2;
const MAX_ATTEMPTS = 4;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// Reasoning models spend a variable, hard-to-predict share of their output on
// hidden reasoning tokens. Without an explicit cap Groq's default trims the
// response mid-array on anything but the smallest batches, which fails the
// strict json_schema check and looked like every language silently vanishing.
const TOKENS_PER_CUE = 130;
const MIN_COMPLETION_TOKENS = 1024;

export class TranslationUnavailableError extends Error {}

/** Per-cue outcome for one target language: either its cues or why it failed. */
export type LanguageTranslationResult =
  | { cues: SubtitleCue[]; error?: undefined }
  | { cues?: undefined; error: string };

function translationSchema(count: number) {
  return {
    type: "object",
    properties: {
      cues: {
        type: "array",
        minItems: count,
        maxItems: count,
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            text: { type: "string" },
          },
          required: ["id", "text"],
          additionalProperties: false,
        },
      },
    },
    required: ["cues"],
    additionalProperties: false,
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

/**
 * Groq doesn't set a Retry-After header on 429s; the wait is only in the
 * error body, e.g. "...Please try again in 19.0725s...".
 */
function parseRetrySeconds(body: string): number | null {
  const match = body.match(/try again in ([\d.]+)s/i);
  return match ? Number(match[1]) : null;
}

/** POST to Groq, retrying transient failures (429 / 5xx) with backoff. */
async function callGroq(body: unknown, apiKey: string, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal,
      body: JSON.stringify(body),
    });

    const transient = response.status === 429 || response.status >= 500;
    if (response.ok || !transient || attempt === MAX_ATTEMPTS - 1) return response;

    // A 429 is a shared per-minute token budget, not a per-request hiccup, so
    // it needs the actual reset time rather than a short exponential backoff
    // (which just burns through every retry before the window clears).
    const detail = response.status === 429 ? await response.clone().text() : "";
    const retryAfter = parseRetrySeconds(detail);
    const backoffMs = retryAfter ? retryAfter * 1000 + 250 : 800 * 2 ** attempt;
    await sleep(backoffMs, signal);
  }
  throw new Error("unreachable");
}

/** Translate one language's cues, batch by batch, preserving timing exactly. */
async function translateLanguage(
  cues: SubtitleCue[],
  sourceLanguage: string,
  target: { code: string; name: string },
  apiKey: string,
  model: string,
  signal?: AbortSignal
): Promise<SubtitleCue[]> {
  const results: SubtitleCue[] = [];

  for (let offset = 0; offset < cues.length; offset += BATCH_SIZE) {
    const batch = cues.slice(offset, offset + BATCH_SIZE);
    const response = await callGroq(
      {
        model,
        // Low reasoning effort keeps hidden reasoning tokens down, which is
        // most of what was blowing the batch past the TPM budget and the
        // (unset) output cap below.
        reasoning_effort: "low",
        max_completion_tokens: Math.max(MIN_COMPLETION_TOKENS, batch.length * TOKENS_PER_CUE),
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You translate anime subtitles professionally. Preserve meaning, names, honorifics, tone, and continuity. Keep each line concise enough to read during its original cue. Do not censor, explain, merge, split, or omit cues. Return every cue.",
          },
          {
            role: "user",
            content: JSON.stringify({
              sourceLanguage,
              targetLanguage: target,
              cues: batch.map((cue, index) => ({ id: offset + index, text: cue.text })),
            }),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "subtitle_translation",
            strict: true,
            schema: translationSchema(batch.length),
          },
        },
      },
      apiKey,
      signal
    );

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Groq translation failed (${response.status}): ${detail.slice(0, 300)}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Groq returned no translation");

    const result = JSON.parse(content) as { cues?: Array<{ id?: number; text?: string }> };
    const byId = new Map(result.cues?.map((cue) => [cue.id, cue.text]) ?? []);

    for (let index = 0; index < batch.length; index += 1) {
      const text = byId.get(offset + index);
      if (typeof text !== "string" || !text.trim()) {
        throw new Error(`Translation response omitted cue ${offset + index}`);
      }
      results.push({ ...batch[index], text: text.trim() });
    }
  }

  return results;
}

/**
 * Translate cue text without touching its timing, one target language at a
 * time so a single bad response only takes down that language.
 *
 * Groq is only the prototype transport. The input/output contract is deliberately
 * provider-neutral so Perry can replace the model without changing playback,
 * caching, or the subtitle-generation route.
 *
 * `onLanguageSettled` fires as each language finishes (success or failure),
 * letting the caller stream tracks out over SSE instead of waiting for every
 * language in the batch.
 */
export async function translateCues(
  cues: SubtitleCue[],
  sourceLanguage: string,
  targets: readonly { code: string; name: string }[],
  signal?: AbortSignal,
  onLanguageSettled?: (
    target: { code: string; name: string },
    result: LanguageTranslationResult
  ) => void | Promise<void>
): Promise<Record<string, SubtitleCue[]>> {
  const envKey = process.env.GROQ_API_KEY;
  if (!envKey) {
    throw new TranslationUnavailableError(
      "GROQ_API_KEY is required for multilingual subtitle translation"
    );
  }
  const apiKey: string = envKey;
  const model = process.env.GROQ_TRANSLATION_MODEL ?? "openai/gpt-oss-120b";

  const translated: Record<string, SubtitleCue[]> = {};
  const queue = [...targets];

  async function worker() {
    for (;;) {
      const target = queue.shift();
      if (!target) return;
      try {
        const result = await translateLanguage(cues, sourceLanguage, target, apiKey, model, signal);
        translated[target.code] = result;
        await onLanguageSettled?.(target, { cues: result });
      } catch (error) {
        if (signal?.aborted) return;
        const message = error instanceof Error ? error.message : "Translation failed";
        await onLanguageSettled?.(target, { error: message });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_LANGUAGES, targets.length) }, worker)
  );

  return translated;
}
