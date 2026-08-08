/**
 * Shared recommendation core.
 *
 * This is the ONE place chatbot, homepage rows, and "what to watch next"
 * route through — no per-feature forks (see CLAUDE.md / PRD). Every caller
 * builds a RecoContext and calls recommend().
 *
 * The ranking below is deterministic/rule-based. It doubles as the fallback
 * for the chatbot's real Groq-backed assistant (see @/lib/reco/llm, the
 * model-facing seam) when GROQ_API_KEY is missing or a call fails, so it
 * stays alive and untouched by the LLM path rather than being replaced.
 */
import { cached } from "@/lib/cache";
import { getCatalog, getCatalogIndex, toListTitle } from "@/lib/catalog-service";
import { getContinueWatching, type ContinueWatchingItem } from "@/lib/db";
import { getProfileContext } from "./profile-context";
import type { RecoContext, RecoRow, Title, TitleProgress } from "@/lib/types";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — placeholder until LLM ranker lands.

const ROW_SIZE = 12;

export function byScoreDesc(titles: Title[]): Title[] {
  return [...titles].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function excludeIds(titles: Title[], ids: Set<string>): Title[] {
  return titles.filter((t) => !ids.has(t.id));
}

function totalEpisodes(title: Title): number {
  return (title.seasons ?? []).reduce((sum, season) => sum + season.episodes.length, 0);
}

/**
 * Take the first `size` unused titles and mark them used.
 *
 * Every row used to independently sort the whole catalog by score and take the
 * top 8, so the highest-rated shows appeared in *every* row — "Top picks",
 * "Action" and "What to watch next" were the same twelve posters. Threading one
 * `used` set through the row builders is what makes the rails differ.
 */
function pick(candidates: Title[], used: Set<string>, size = ROW_SIZE): Title[] {
  const chosen: Title[] = [];
  for (const title of candidates) {
    if (used.has(title.id)) continue;
    // Rails render poster cards only — see `toListTitle`.
    chosen.push(toListTitle(title));
    used.add(title.id);
    if (chosen.length === size) break;
  }
  return chosen;
}

/**
 * Genres worth a rail, most-represented first. Derived from the catalog rather
 * than hardcoded so the rows track whatever `npm run catalog` pulled in.
 */
function topGenres(catalog: Title[], count: number): string[] {
  const counts = new Map<string, number>();
  for (const title of catalog) {
    for (const genre of title.genres) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([genre]) => genre);
}

function topPicksRow(
  watchHistory: string[],
  catalog: Title[],
  byId: Map<string, Title>,
  used: Set<string>
): RecoRow {
  const watchedGenres = new Set(
    watchHistory.flatMap((id) => byId.get(id)?.genres ?? [])
  );
  const watchedIds = new Set(watchHistory);

  const candidates =
    watchedGenres.size > 0
      ? catalog.filter((t) => t.genres.some((g) => watchedGenres.has(g)))
      : catalog;

  const titles = pick(byScoreDesc(excludeIds(candidates, watchedIds)), used);

  return {
    id: "top-picks",
    label: "Top picks for you",
    reason:
      watchedGenres.size > 0
        ? `Matched to genres you watch: ${Array.from(watchedGenres).slice(0, 3).join(", ")}.`
        : "Popular titles to get you started.",
    aiGenerated: true,
    titles,
  };
}

function becauseYouWatchedRows(
  watchHistory: string[],
  catalog: Title[],
  byId: Map<string, Title>,
  used: Set<string>
): RecoRow[] {
  const rows: RecoRow[] = [];
  const seedIds = watchHistory.slice(0, 2);

  for (const seedId of seedIds) {
    const seed = byId.get(seedId);
    if (!seed) continue;

    // Rank by how many genres a candidate shares with the seed, not by raw
    // score — otherwise "because you watched X" is just the leaderboard again.
    const overlap = (title: Title) =>
      title.genres.filter((genre) => seed.genres.includes(genre)).length;

    const similar = pick(
      excludeIds(
        catalog.filter((t) => t.id !== seed.id && overlap(t) > 0),
        new Set(watchHistory)
      ).sort(
        (a, b) => overlap(b) - overlap(a) || (b.score ?? 0) - (a.score ?? 0)
      ),
      used
    );

    if (similar.length === 0) continue;

    rows.push({
      id: `because-${seed.id}`,
      label: `Because you watched ${seed.title}`,
      reason: `Shares genres with ${seed.title}: ${seed.genres.slice(0, 2).join(", ")}.`,
      aiGenerated: true,
      titles: similar,
    });
  }

  return rows;
}

function genreRows(catalog: Title[], used: Set<string>, count = 6): RecoRow[] {
  return topGenres(catalog, count)
    .map((genre) => ({
      id: `genre-${genre.toLowerCase()}`,
      label: genre,
      aiGenerated: false,
      titles: pick(
        byScoreDesc(catalog.filter((title) => title.genres.includes(genre))),
        used
      ),
    }))
    .filter((row) => row.titles.length > 0);
}

/**
 * The catalog snapshot is written in AniList popularity order, so catalog order
 * is a different signal from `score` — which keeps this rail from duplicating
 * the score-ranked ones above.
 */
function popularRow(catalog: Title[], used: Set<string>): RecoRow {
  return {
    id: "popular",
    label: "Popular on Pezzy",
    aiGenerated: false,
    titles: pick(catalog, used),
  };
}

function newAndTrendingRow(catalog: Title[], used: Set<string>): RecoRow {
  const cutoff = new Date().getFullYear() - 2;
  // Recent titles, still in popularity order — sorting purely by year surfaces
  // obscure current-season ONAs ahead of anything anyone is watching.
  const recent = catalog.filter((title) => (title.year ?? 0) >= cutoff);
  return {
    id: "new-trending",
    label: "New & Trending",
    aiGenerated: false,
    titles: pick(recent.length >= ROW_SIZE ? recent : catalog, used),
  };
}

function whatToWatchNextRow(
  watchHistory: string[],
  catalog: Title[],
  byId: Map<string, Title>
): RecoRow {
  const watchedIds = new Set(watchHistory);
  const lastWatched = watchHistory[watchHistory.length - 1];
  const seed = lastWatched ? byId.get(lastWatched) : undefined;

  const candidates = seed
    ? catalog.filter((t) => t.id !== seed.id && t.genres.some((g) => seed.genres.includes(g)))
    : catalog;

  const titles = byScoreDesc(excludeIds(candidates, watchedIds))
    .slice(0, ROW_SIZE)
    .map(toListTitle);

  return {
    id: "watch-next",
    label: "What to watch next",
    reason: seed
      ? `Picking up the vibe from ${seed.title}.`
      : "Highest-rated titles in the catalog right now.",
    aiGenerated: true,
    titles,
  };
}

function continueWatchingRow(
  items: ContinueWatchingItem[],
  byId: Map<string, Title>,
  used: Set<string>
): RecoRow {
  const ordered = items
    .map((item) => ({ item, title: byId.get(item.titleId) }))
    .filter((entry): entry is { item: ContinueWatchingItem; title: Title } =>
      Boolean(entry.title)
    );

  const titles = pick(
    ordered.map((entry) => entry.title),
    used
  );

  // Only carry progress for titles that actually made it into the row (`pick`
  // can drop some to ROW_SIZE or to an earlier row's `used` set).
  const shownIds = new Set(titles.map((t) => t.id));
  const progress: Record<string, TitleProgress> = {};
  for (const { item } of ordered) {
    if (!shownIds.has(item.titleId)) continue;
    progress[item.titleId] = {
      seasonNumber: item.seasonNumber,
      episodeNumber: item.episodeNumber,
      positionSeconds: item.positionSeconds,
      durationSeconds: item.durationSeconds,
      completed: item.completed,
    };
  }

  return {
    id: "continue-watching",
    label: "Continue watching",
    aiGenerated: false,
    titles,
    progress,
  };
}

function myListRow(ids: string[], byId: Map<string, Title>, used: Set<string>): RecoRow {
  const ordered = ids.map((id) => byId.get(id)).filter((t): t is Title => Boolean(t));
  return {
    id: "my-list",
    label: "My List",
    aiGenerated: false,
    titles: pick(ordered, used),
  };
}

function criticallyAcclaimedRow(catalog: Title[], used: Set<string>): RecoRow {
  return {
    id: "critically-acclaimed",
    label: "Critically acclaimed",
    reason: "Highest AniList scores in the catalog.",
    aiGenerated: false,
    titles: pick(byScoreDesc(catalog), used),
  };
}

function moviesRow(catalog: Title[], used: Set<string>): RecoRow {
  return {
    id: "movies",
    label: "Movies",
    aiGenerated: false,
    titles: pick(byScoreDesc(catalog.filter((t) => t.format === "movie")), used),
  };
}

function shortSeriesRow(catalog: Title[], used: Set<string>): RecoRow {
  // Bingeable in a weekend - total episodes across the whole title, not per
  // season, so a long-running franchise doesn't qualify via its shortest arc.
  const short = catalog.filter(
    (t) => t.format !== "movie" && totalEpisodes(t) > 0 && totalEpisodes(t) <= 13
  );
  return {
    id: "short-series",
    label: "Short & bingeable",
    reason: "13 episodes or fewer, done in a weekend.",
    aiGenerated: false,
    titles: pick(byScoreDesc(short), used),
  };
}

/**
 * Picks whichever past decade is best represented in the catalog (excluding
 * the current one, already covered by "New & Trending") and builds a row
 * from it. Returns undefined if the catalog has no dated titles to group.
 */
function byDecadeRow(catalog: Title[], used: Set<string>): RecoRow | undefined {
  const currentDecade = Math.floor(new Date().getFullYear() / 10) * 10;
  const counts = new Map<number, number>();
  for (const title of catalog) {
    if (!title.year) continue;
    const decade = Math.floor(title.year / 10) * 10;
    if (decade === currentDecade) continue;
    counts.set(decade, (counts.get(decade) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return undefined;
  const [bestDecade] = ranked[0];

  return {
    id: `decade-${bestDecade}`,
    label: `Best of the ${bestDecade}s`,
    aiGenerated: false,
    titles: pick(
      byScoreDesc(catalog.filter((t) => Math.floor((t.year ?? 0) / 10) * 10 === bestDecade)),
      used
    ),
  };
}

/**
 * High score, low popularity. Catalog order IS the popularity signal (see
 * catalog-service.ts) - titles past the popular half of the list that still
 * score well are the gems the leaderboard rows never surface.
 */
function hiddenGemsRow(catalog: Title[], used: Set<string>): RecoRow {
  const popularCutoff = Math.floor(catalog.length / 2);
  const gems = catalog.filter(
    (title, index) => index > popularCutoff && (title.score ?? 0) >= 75
  );
  return {
    id: "hidden-gems",
    label: "Hidden gems",
    reason: "High-scoring titles most people haven't found yet.",
    aiGenerated: false,
    titles: pick(byScoreDesc(gems), used),
  };
}

const KEYWORD_GENRES: Record<string, string> = {
  mecha: "Sci-Fi",
  robot: "Sci-Fi",
  scifi: "Sci-Fi",
  "sci-fi": "Sci-Fi",
  space: "Sci-Fi",
  romance: "Romance",
  romantic: "Romance",
  love: "Romance",
  scary: "Horror",
  horror: "Horror",
  creepy: "Horror",
  funny: "Comedy",
  comedy: "Comedy",
  laugh: "Comedy",
  sad: "Drama",
  drama: "Drama",
  emotional: "Drama",
  action: "Action",
  fight: "Action",
  battle: "Action",
  fantasy: "Fantasy",
  magic: "Fantasy",
  mystery: "Mystery",
  detective: "Mystery",
  psychological: "Psychological",
  mind: "Psychological",
  supernatural: "Supernatural",
  ghost: "Supernatural",
};

function chatRow(prompt: string, catalog: Title[]): RecoRow {
  const lower = prompt.toLowerCase();
  const knownGenres = new Set(catalog.flatMap((t) => t.genres));

  let matchedGenre: string | undefined;

  // Direct genre name match first (e.g. "make me a row about fantasy").
  for (const genre of knownGenres) {
    if (lower.includes(genre.toLowerCase())) {
      matchedGenre = genre;
      break;
    }
  }

  // Fall back to keyword mapping.
  if (!matchedGenre) {
    for (const [keyword, genre] of Object.entries(KEYWORD_GENRES)) {
      if (lower.includes(keyword)) {
        matchedGenre = genre;
        break;
      }
    }
  }

  if (matchedGenre) {
    const titles = byScoreDesc(
      catalog.filter((title) =>
        title.genres.some(
          (genre) => genre.toLowerCase() === matchedGenre?.toLowerCase()
        )
      )
    )
      .slice(0, ROW_SIZE)
      .map(toListTitle);
    if (titles.length > 0) {
      return {
        id: `chat-${matchedGenre.toLowerCase()}`,
        label: `${matchedGenre} picks`,
        reason: `You asked about ${matchedGenre.toLowerCase()}. Here's what fits.`,
        aiGenerated: true,
        titles,
      };
    }
  }

  // Fallback: popular titles.
  return {
    id: "chat-popular",
    label: "Popular right now",
    reason: "Couldn't pin down a specific ask, so here's what's popular.",
    aiGenerated: true,
    titles: byScoreDesc(catalog).slice(0, ROW_SIZE).map(toListTitle),
  };
}

export async function recommend(ctx: RecoContext): Promise<RecoRow[]> {
  // hub/page.tsx doesn't wire real watch history through RecoContext yet, so
  // fall back to the profile's own DB history rather than showing an empty
  // "for you" experience. An explicit ctx.watchHistory still wins.
  const profileContext = getProfileContext(ctx.profileId);
  const watchHistory = ctx.watchHistory?.length ? ctx.watchHistory : profileContext.watchedTitleIds;
  const cacheKey = `recommend:${ctx.intent}:${ctx.profileId}:${ctx.prompt ?? ""}:${watchHistory.join(",")}`;

  const rows = await cached(cacheKey, CACHE_TTL_MS, async () => {
    const catalog = await getCatalog();
    const byId = getCatalogIndex();

    if (ctx.intent === "next") {
      return [whatToWatchNextRow(watchHistory, catalog, byId)];
    }

    if (ctx.intent === "chat") {
      return [chatRow(ctx.prompt ?? "", catalog)];
    }

    // intent === "home". `used` is shared across every builder below so each
    // rail shows different titles, see `pick`. Personal/continue-watching
    // rows first, then broader browse rows (D2).
    const used = new Set<string>();
    const continueWatchingItems = getContinueWatching(ctx.profileId, 20);
    const rows: RecoRow[] = [
      continueWatchingRow(continueWatchingItems, byId, used),
      topPicksRow(watchHistory, catalog, byId, used),
      ...becauseYouWatchedRows(watchHistory, catalog, byId, used),
      myListRow(profileContext.myListIds, byId, used),
      newAndTrendingRow(catalog, used),
      criticallyAcclaimedRow(catalog, used),
      hiddenGemsRow(catalog, used),
      moviesRow(catalog, used),
      shortSeriesRow(catalog, used),
    ];
    // Computed here (not up front) so it draws from whatever `used` left over
    // after the personal rows above, instead of claiming titles ahead of them.
    const decadeRow = byDecadeRow(catalog, used);
    if (decadeRow) rows.push(decadeRow);
    rows.push(popularRow(catalog, used), ...genreRows(catalog, used));
    return rows.filter((row) => row.titles.length > 0);
  });

  return ctx.limit ? rows.slice(0, ctx.limit) : rows;
}
