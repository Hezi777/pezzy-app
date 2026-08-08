/**
 * Regenerates the local catalog snapshot from AniList.
 *
 *   node scripts/build-catalog.mjs [--pages 20] [--out src/lib/catalog.data.json]
 *
 * Why a snapshot instead of live AniList calls: AniList's public GraphQL API is
 * rate limited (30 req/min on the degraded tier we see today), so enriching a
 * catalogue this size on every cache miss is not viable. The snapshot is the
 * catalogue; re-run this script to refresh it.
 *
 * What it produces, and why each part matters:
 *   - Franchises, not entries. AniList splits a show into one entry per season.
 *     We chain PREQUEL/SEQUEL relations, then split the chain on title: an
 *     entry only stays a season of the root when its name reads as a
 *     continuation of the root's ("Season 2", "Final Season Part 2", an
 *     "... Arc" name, ...). A distinctly branded entry (Z, GT, Kai, Super,
 *     Shippuden, Brotherhood) becomes its own Title instead, so "Attack on
 *     Titan" is one Title with six seasons but "Dragon Ball" splits into five.
 *     See `isContinuationTitle` / `splitByContinuation`. Titles that split out
 *     of the same chain are cross-linked via `related`.
 *   - Every season keeps its OWN AniList id in `mediaId`. Playback resolution
 *     (src/lib/anime.ts) maps that id straight to a provider, so season 3
 *     episode 4 resolves to season 3 episode 4 — the previous snapshot had no
 *     per-season id and every season carried a copy of season 1's episodes.
 *   - Per-episode titles that are actually verified to belong to their season.
 *     AniList's `streamingEpisodes` is scraped per *franchise*, so a sequel's
 *     record carries a verbatim copy of season 1's episode list — that is what
 *     produced the wrong episode titles before. See `episodesFor` for the
 *     check that rejects it. The same field is null for still-airing
 *     long-runners (One Piece); Kitsu's per-anime episode count fills that in.
 *   - Real per-episode titles AND stills from Kitsu, which (unlike AniList)
 *     models episodes per season and needs no API key. This is the default
 *     source for episode art; pass --no-kitsu to skip it.
 *   - Title logos from TMDB by default (pass --no-logos to skip, needs
 *     TMDB_API_KEY), falling back to Fanart.tv for entries TMDB has no logo
 *     for (needs FANART_API_KEY, a free personal key). Both joined via the
 *     Fribb anime-lists id mapping.
 *
 * Licensing: metadata + artwork come from AniList (PRD R2), episode titles and
 * stills from Kitsu, optional titles from Jikan/MAL and logos from TMDB /
 * Fanart.tv. All of it is hot-linked demo material under the same caveat as
 * before (PRD R1) — swap for owned/licensed art before production.
 */
import { writeFile } from "node:fs/promises";

const ENDPOINT = "https://graphql.anilist.co";
const JIKAN_ENDPOINT = "https://api.jikan.moe/v4";
const KITSU_ENDPOINT = "https://kitsu.io/api/edge";
const TMDB_ENDPOINT = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const FANART_ENDPOINT = "https://webservice.fanart.tv/v3/tv";
/**
 * Maps an AniList id to kitsu / mal / tmdb ids — and, critically, to the TMDB
 * *season number*, since AniList models each season as its own entry.
 */
const MAPPING_URL =
  "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";
const PER_PAGE = 50;
const KITSU_PAGE_LIMIT = 20; // Kitsu's maximum.
const REQUEST_SPACING_MS = 2100; // AniList degraded tier allows 30 req/min.
const JIKAN_SPACING_MS = 1100; // Jikan allows 3 req/s, 60 req/min.
const KITSU_SPACING_MS = 120;
const KITSU_CONCURRENCY = 6;
const TMDB_SPACING_MS = 60;
const FANART_SPACING_MS = 60;
// Seasons are TV-shaped only. OVAs/specials chained into a franchise would show
// up as "season 2" between two real seasons, which is worse than omitting them.
const SERIES_FORMATS = new Set(["TV", "TV_SHORT", "ONA"]);

const PAGE_QUERY = `
  query CatalogPage($page: Int!, $perPage: Int!) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage }
      media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
        id
        idMal
        title { english romaji native }
        format
        episodes
        seasonYear
        startDate { year }
        genres
        averageScore
        popularity
        description(asHtml: false)
        coverImage { extraLarge large color }
        bannerImage
        streamingEpisodes { title thumbnail }
        relations { edges { relationType node { id type format } } }
      }
    }
  }
`;

function parseArgs(argv) {
  const args = {
    pages: 20,
    out: "src/lib/catalog.data.json",
    jikan: false,
    kitsu: true,
    logos: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]?.replace(/^--/, "");
    if (key === "jikan") {
      args.jikan = true;
      continue;
    }
    if (key === "logos") {
      args.logos = true;
      continue;
    }
    if (key === "no-logos") {
      args.logos = false;
      continue;
    }
    if (key === "no-kitsu") {
      args.kitsu = false;
      continue;
    }
    const value = argv[i + 1];
    if (key === "pages") args.pages = Number(value);
    else if (key === "out") args.out = value;
    i += 1;
  }
  if (!Number.isInteger(args.pages) || args.pages < 1) {
    throw new Error("--pages must be a positive integer");
  }
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function query(variables, attempt = 1) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: PAGE_QUERY, variables }),
  });

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") ?? 60);
    if (attempt > 5) throw new Error("AniList rate limit exceeded after 5 retries");
    console.warn(`  rate limited, waiting ${retryAfter}s…`);
    await sleep((retryAfter + 1) * 1000);
    return query(variables, attempt + 1);
  }

  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error(
      payload.errors?.map((error) => error.message).join("; ") ??
        `AniList request failed (${response.status})`
    );
  }
  return payload.data;
}

function plainText(value) {
  if (!value) return undefined;
  return (
    value
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/\s+/g, " ")
      .trim() || undefined
  );
}

function displayTitle(media) {
  return media.title.english ?? media.title.romaji ?? media.title.native ?? null;
}

function startYear(media) {
  return media.seasonYear ?? media.startDate?.year ?? undefined;
}

/**
 * Build a season's episode list.
 *
 * The episode COUNT comes from AniList's `episodes` field, which is per-entry
 * and reliable. Episode TITLES are the trap: `streamingEpisodes` is scraped
 * from the franchise's streaming page, so "Attack on Titan Season 2" (12
 * episodes) ships a 25-entry list that is season 1's, verbatim. Every sequel in
 * every franchise we sampled does this.
 *
 * So we only accept the listing when it demonstrably describes THIS entry: its
 * parsed episode numbers must cover exactly 1..declaredCount. Season 1 passes
 * (25 numbers, 25 declared); the sequels fail (25 numbers, 12 declared) and get
 * numbered placeholders instead — which `--jikan` can then fill in for real.
 * A wrong title is worse than a plain one.
 */
function episodesFor(media) {
  const declared = Number.isInteger(media.episodes) ? media.episodes : 0;
  if (declared < 1) return [];

  const byNumber = new Map();
  for (const episode of media.streamingEpisodes ?? []) {
    const label = episode.title?.trim();
    const parsed = label?.match(/^Episode\s+(\d+)\s*[-–—:]?\s*(.*)$/i);
    if (!parsed) continue;
    const number = Number(parsed[1]);
    if (!Number.isInteger(number) || number < 1 || byNumber.has(number)) continue;
    byNumber.set(number, {
      number,
      title: parsed[2].trim() || `Episode ${number}`,
      // AniList's `streamingEpisodes` thumbnails are hosted on licensors' own
      // CDNs. We take the episode titles from here but not the stills — per-
      // episode art comes from Kitsu below, and episodes without one fall back
      // to the title's cover art in the UI.
      thumbnail: undefined,
    });
  }

  const describesThisEntry =
    byNumber.size === declared && Math.max(...byNumber.keys()) === declared;

  return Array.from({ length: declared }, (_, index) => {
    const number = index + 1;
    const listed = describesThisEntry ? byNumber.get(number) : undefined;
    return listed ?? { number, title: `Episode ${number}` };
  });
}

/** Fribb's id mapping, keyed by AniList id. */
async function fetchIdMapping() {
  const response = await fetch(MAPPING_URL);
  if (!response.ok) throw new Error(`Mapping fetch failed (${response.status})`);
  const entries = await response.json();
  const byAniList = new Map();
  for (const entry of entries) {
    if (entry.anilist_id) byAniList.set(Number(entry.anilist_id), entry);
  }
  return byAniList;
}

/**
 * Every episode Kitsu has for one anime id, keyed by episode number.
 *
 * `needed` caps pagination at the season's own episode count — without it a
 * long-running series pages through its entire run to fill a 12-episode season.
 */
async function fetchKitsuEpisodes(kitsuId, needed = 400) {
  const byNumber = new Map();
  const limit = Math.min(Math.ceil(needed / KITSU_PAGE_LIMIT) * KITSU_PAGE_LIMIT, 400);
  for (let offset = 0; offset < limit; offset += KITSU_PAGE_LIMIT) {
    const url =
      `${KITSU_ENDPOINT}/anime/${kitsuId}/episodes` +
      `?page[limit]=${KITSU_PAGE_LIMIT}&page[offset]=${offset}`;
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.api+json" },
    });
    if (!response.ok) throw new Error(`Kitsu returned ${response.status}`);
    const payload = await response.json();
    const rows = payload.data ?? [];

    for (const row of rows) {
      const attributes = row.attributes ?? {};
      const number = Number(attributes.number);
      if (!Number.isInteger(number) || number < 1 || byNumber.has(number)) continue;
      const title = String(
        attributes.canonicalTitle ?? attributes.titles?.en ?? ""
      ).trim();
      const thumbnail =
        attributes.thumbnail?.original ?? attributes.thumbnail?.large ?? undefined;
      byNumber.set(number, { title, thumbnail });
    }

    if (rows.length < KITSU_PAGE_LIMIT) break;
    await sleep(KITSU_SPACING_MS);
  }
  return byNumber;
}

/**
 * Kitsu's total episode count for an anime id.
 *
 * The fallback for still-airing long-runners (One Piece, AniList id 21) whose
 * `episodes` field is null on AniList - there is no declared count to build a
 * season from otherwise. One cheap request (page limit 1, read `meta.count`)
 * per affected season.
 */
async function fetchKitsuEpisodeCount(kitsuId) {
  const url = `${KITSU_ENDPOINT}/anime/${kitsuId}/episodes?page[limit]=1`;
  const response = await fetch(url, { headers: { Accept: "application/vnd.api+json" } });
  if (!response.ok) throw new Error(`Kitsu returned ${response.status}`);
  const payload = await response.json();
  return Number(payload.meta?.count) || 0;
}

/**
 * Fill episode titles and stills from Kitsu.
 *
 * Kitsu is the one keyless source that models episodes *per season*, which is
 * exactly what AniList gets wrong — so it fixes the numbered placeholders and
 * supplies the per-episode art AniList only has for a franchise's first entry.
 * It also supplies the episode COUNT for seasons AniList reports as null
 * (`season._unknownEpisodeCount`, set in `toTitle` for still-airing
 * long-runners like One Piece) before filling titles/stills the usual way.
 * Best-effort per season: a failure leaves whatever we already had.
 */
async function enrichEpisodesFromKitsu(titles, mapping) {
  const pending = [];
  for (const title of titles) {
    for (const season of title.seasons ?? []) {
      const kitsuId = mapping.get(Number(season.mediaId))?.kitsu_id;
      if (!kitsuId) continue;
      if (season.episodes.length > 0 || season._unknownEpisodeCount) {
        pending.push({ season, kitsuId });
      }
    }
  }

  let titled = 0;
  let art = 0;
  let counted = 0;
  let failed = 0;
  let done = 0;

  // Sequential over ~860 seasons took the better part of an hour, nearly all of
  // it waiting on the network. A small worker pool keeps Kitsu comfortable
  // while cutting that to a few minutes.
  async function worker() {
    for (;;) {
      const job = pending.shift();
      if (!job) return;
      try {
        if (job.season.episodes.length === 0 && job.season._unknownEpisodeCount) {
          const count = await fetchKitsuEpisodeCount(job.kitsuId);
          if (count > 0) {
            job.season.episodes = Array.from({ length: count }, (_, index) => ({
              number: index + 1,
              title: `Episode ${index + 1}`,
            }));
            counted += 1;
          }
        }
        if (job.season.episodes.length > 0) {
          const episodes = await fetchKitsuEpisodes(
            job.kitsuId,
            job.season.episodes.length
          );
          for (const episode of job.season.episodes) {
            const match = episodes.get(episode.number);
            if (!match) continue;
            // Kitsu's own numbering is per season, so a title here is trustworthy
            // in a way AniList's franchise-wide listing never was.
            if (match.title && /^Episode \d+$/.test(episode.title)) {
              episode.title = match.title;
              titled += 1;
            }
            if (match.thumbnail && !episode.thumbnail) {
              episode.thumbnail = match.thumbnail;
              art += 1;
            }
          }
        }
      } catch {
        failed += 1;
      }
      done += 1;
      process.stdout.write(
        `\r  kitsu episodes ${done}/${total} (titles ${titled}, stills ${art}, ` +
          `counted ${counted}, failed ${failed})`
      );
      await sleep(KITSU_SPACING_MS);
    }
  }

  const total = pending.length;
  await Promise.all(
    Array.from({ length: Math.min(KITSU_CONCURRENCY, total) }, worker)
  );
  if (total > 0) process.stdout.write("\n");
  return { titled, art, counted, failed, pending: total };
}

/**
 * Attach each franchise's title logo (the stylised wordmark) from TMDB.
 *
 * Requires TMDB_API_KEY — TMDB is the only source with curated logo art, and it
 * rejects keyless requests. The key is only ever read here, at generation time,
 * so nothing ships to the client and there is no runtime dependency. Without a
 * key this step is skipped and the UI falls back to rendering the title as text.
 */
async function enrichLogosFromTmdb(titles, mapping, apiKey) {
  const seen = new Map();
  let filled = 0;
  let failed = 0;

  for (const [index, title] of titles.entries()) {
    const ids = mapping.get(Number(title.id))?.themoviedb_id;
    const tmdbId = typeof ids === "object" ? (ids?.tv ?? ids?.movie) : ids;
    const kind = typeof ids === "object" && ids?.tv ? "tv" : "movie";
    if (!tmdbId) continue;

    const cacheKey = `${kind}:${tmdbId}`;
    if (seen.has(cacheKey)) {
      if (seen.get(cacheKey)) title.logo = seen.get(cacheKey);
      continue;
    }

    try {
      const response = await fetch(
        `${TMDB_ENDPOINT}/${kind}/${tmdbId}/images?include_image_language=en,ja,null`,
        { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }
      );
      if (!response.ok) throw new Error(`TMDB returned ${response.status}`);
      const payload = await response.json();
      const logos = payload.logos ?? [];
      // Prefer an English wordmark; PNGs keep transparency, SVGs don't render
      // reliably in an <img> sized by CSS height.
      const best =
        logos
          .filter((logo) => logo.file_path?.endsWith(".png"))
          .sort(
            (a, b) =>
              (a.iso_639_1 === "en" ? -1 : 1) - (b.iso_639_1 === "en" ? -1 : 1) ||
              (b.vote_average ?? 0) - (a.vote_average ?? 0)
          )[0] ?? logos[0];

      const url = best?.file_path ? `${TMDB_IMAGE_BASE}${best.file_path}` : null;
      seen.set(cacheKey, url);
      if (url) {
        title.logo = url;
        filled += 1;
      }
    } catch {
      seen.set(cacheKey, null);
      failed += 1;
    }
    process.stdout.write(
      `\r  tmdb logos ${index + 1}/${titles.length} (found ${filled}, failed ${failed})`
    );
    await sleep(TMDB_SPACING_MS);
  }
  process.stdout.write("\n");
  return { filled, failed };
}

/**
 * Fallback title logos from Fanart.tv for TV entries TMDB has no logo for.
 *
 * TMDB's anime logo coverage is incomplete; Fanart.tv is a second free source
 * (a personal API key - no credit card, no paid tier) keyed on thetvdb id,
 * which the Fribb mapping already carries as `tvdb_id`. Movies are skipped:
 * Fanart's movie endpoint is keyed on the same TMDB id we already tried.
 * Requires FANART_API_KEY; skipped silently without it, same as TMDB.
 */
async function enrichLogosFromFanart(titles, mapping, apiKey) {
  const missing = titles.filter((title) => !title.logo && title.format !== "movie");
  let filled = 0;
  let failed = 0;

  for (const [index, title] of missing.entries()) {
    const tvdbId = mapping.get(Number(title.id))?.tvdb_id;
    if (!tvdbId) continue;

    try {
      const response = await fetch(`${FANART_ENDPOINT}/${tvdbId}?api_key=${apiKey}`, {
        headers: { Accept: "application/json" },
      });
      if (response.status === 404) continue; // no artwork on file for this id
      if (!response.ok) throw new Error(`Fanart returned ${response.status}`);
      const payload = await response.json();
      const logos = payload.hdtvlogo ?? payload.clearlogo ?? [];
      const best = [...logos].sort(
        (a, b) =>
          (a.lang === "en" ? -1 : 1) - (b.lang === "en" ? -1 : 1) ||
          (Number(b.likes) || 0) - (Number(a.likes) || 0)
      )[0];
      if (best?.url) {
        title.logo = best.url;
        filled += 1;
      }
    } catch {
      failed += 1;
    }
    process.stdout.write(
      `\r  fanart logos ${index + 1}/${missing.length} (found ${filled}, failed ${failed})`
    );
    await sleep(FANART_SPACING_MS);
  }
  if (missing.length > 0) process.stdout.write("\n");
  return { filled, failed, pending: missing.length };
}

/**
 * Fill placeholder episode titles from Jikan (the public MyAnimeList gateway,
 * PRD R2's secondary source) for seasons AniList could not describe.
 *
 * Best-effort by design: Jikan proxies a MAL scrape and returns 504 whenever
 * MAL is unreachable, so any failure leaves the numbered placeholders in place
 * rather than failing the build.
 */
async function enrichEpisodeTitlesFromJikan(titles, malIdBySeason) {
  const pending = [];
  for (const title of titles) {
    for (const season of title.seasons ?? []) {
      const malId = malIdBySeason.get(season.mediaId);
      const needsTitles = season.episodes.every((episode) =>
        /^Episode \d+$/.test(episode.title)
      );
      if (malId && needsTitles && season.episodes.length > 0) {
        pending.push({ season, malId });
      }
    }
  }

  let filled = 0;
  let failed = 0;
  for (const [index, { season, malId }] of pending.entries()) {
    try {
      const response = await fetch(`${JIKAN_ENDPOINT}/anime/${malId}/episodes`);
      if (!response.ok) throw new Error(`Jikan returned ${response.status}`);
      const payload = await response.json();
      const byNumber = new Map(
        (payload.data ?? []).map((episode) => [
          Number(episode.mal_id),
          String(episode.title ?? "").trim(),
        ])
      );
      let applied = 0;
      for (const episode of season.episodes) {
        const name = byNumber.get(episode.number);
        if (name) {
          episode.title = name;
          applied += 1;
        }
      }
      if (applied > 0) filled += 1;
    } catch {
      failed += 1;
    }
    process.stdout.write(
      `\r  jikan episode titles ${index + 1}/${pending.length} (filled ${filled}, failed ${failed})`
    );
    if (index < pending.length - 1) await sleep(JIKAN_SPACING_MS);
  }
  if (pending.length > 0) process.stdout.write("\n");
  return { filled, failed, pending: pending.length };
}

/**
 * Union-find over PREQUEL/SEQUEL edges, restricted to entries we actually
 * fetched and to series formats. Movies stay standalone: a film sequel to a TV
 * show is its own catalogue entry, not "season 4".
 */
function clusterFranchises(mediaById) {
  const parent = new Map([...mediaById.keys()].map((id) => [id, id]));
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(id) !== root) {
      const next = parent.get(id);
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  for (const media of mediaById.values()) {
    if (!SERIES_FORMATS.has(media.format)) continue;
    for (const edge of media.relations?.edges ?? []) {
      if (edge.relationType !== "PREQUEL" && edge.relationType !== "SEQUEL") continue;
      const related = mediaById.get(edge.node?.id);
      if (!related || !SERIES_FORMATS.has(related.format)) continue;
      union(media.id, related.id);
    }
  }

  const groups = new Map();
  for (const id of mediaById.keys()) {
    const root = find(id);
    const group = groups.get(root);
    if (group) group.push(mediaById.get(id));
    else groups.set(root, [mediaById.get(id)]);
  }
  return [...groups.values()];
}

/**
 * True when `candidateTitle` reads as a continuation of `rootTitle` - the
 * same show under the same name, just a later installment - rather than a
 * distinctly branded spin-off (Z, GT, Kai, Super, Shippuden, Brotherhood, ...).
 *
 * `clusterFranchises` unions on ANY PREQUEL/SEQUEL edge, which is what
 * collapsed "Dragon Ball", "Dragon Ball Z", "GT", "Kai" and "Super" into one
 * title. This is the check `splitByContinuation` uses to pull those apart
 * again: identical names, or the root's name plus a continuation suffix
 * ("Season 2", "2nd Season", "Part 2", "Final Season", "Final Season Part 2",
 * "2nd Cour", a trailing "... Arc", a roman numeral, or a bare number).
 */
function isContinuationTitle(rootTitle, candidateTitle) {
  const normalize = (value) =>
    value
      .toLowerCase()
      .replace(/^the\s+/, "")
      .replace(/[:!?.]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const root = normalize(rootTitle);
  const candidate = normalize(candidateTitle);
  if (root === candidate) return true;
  if (!candidate.startsWith(root)) return false;

  const suffix = candidate.slice(root.length).trim();
  if (!suffix) return true;
  if (/\barc$/.test(suffix)) return true;

  const CONTINUATION_SUFFIX =
    /^(the\s+)?(final\s+season(\s+part\s+\d+)?|season\s+\d+(\s+part\s+\d+)?|part\s+\d+|\d+(st|nd|rd|th)\s+season|\d+(st|nd|rd|th)\s+cour|[ivx]+|\d+)$/;
  return CONTINUATION_SUFFIX.test(suffix);
}

/**
 * Split one union-find group into the clusters that actually belong in the
 * same catalogue Title, per `isContinuationTitle`. Greedy: take the earliest
 * entry as a candidate root, pull out everything else that continues its
 * name, then repeat over whatever is left - so "Dragon Ball" peels off as one
 * title, then "Dragon Ball Z" becomes its own root for the next pass, and so
 * on for GT/Kai/Super.
 */
function splitByContinuation(group) {
  const remaining = [...group].sort(
    (a, b) => (startYear(a) ?? 9999) - (startYear(b) ?? 9999) || a.id - b.id
  );
  const clusters = [];
  while (remaining.length > 0) {
    const root = remaining.shift();
    const cluster = [root];
    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      if (isContinuationTitle(displayTitle(root), displayTitle(remaining[i]))) {
        cluster.push(remaining.splice(i, 1)[0]);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

function toTitle(group) {
  const ordered = [...group].sort(
    (a, b) => (startYear(a) ?? 9999) - (startYear(b) ?? 9999) || a.id - b.id
  );
  const root = ordered[0];
  const name = displayTitle(root);
  const poster = root.coverImage?.extraLarge ?? root.coverImage?.large;
  if (!name || !poster) return null;

  const isMovie = root.format === "MOVIE";
  // Franchise-level genres: the union across seasons, most common first, so a
  // long-running show isn't typed only by its first season's tags.
  const genreCounts = new Map();
  for (const media of ordered) {
    for (const genre of media.genres ?? []) {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    }
  }

  const title = {
    id: String(root.id),
    title: name,
    year: startYear(root),
    genres: [...genreCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([genre]) => genre),
    score: root.averageScore ?? undefined,
    synopsis: plainText(root.description),
    poster,
    banner: ordered.find((media) => media.bannerImage)?.bannerImage ?? undefined,
    color: root.coverImage?.color ?? undefined,
    format: isMovie ? "movie" : "tv",
    popularity: root.popularity ?? 0,
  };

  if (isMovie) {
    // Movies have no seasons to hang idMal on, so it goes on the Title itself.
    if (root.idMal) title.malId = String(root.idMal);
    return title;
  }

  title.seasons = ordered.map((media, index) => {
    const season = {
      number: index + 1,
      mediaId: String(media.id),
      title: displayTitle(media) ?? `Season ${index + 1}`,
      year: startYear(media),
      synopsis: plainText(media.description),
      episodes: episodesFor(media),
    };
    if (media.idMal) season.malId = String(media.idMal);
    // AniList reports `episodes: null` for still-airing long-runners (One
    // Piece, id 21). Flag it so enrichEpisodesFromKitsu can fill the real
    // count instead of leaving the season empty; stripped before writing out.
    if (!Number.isInteger(media.episodes)) season._unknownEpisodeCount = true;
    return season;
  });

  return title;
}

/**
 * Turn one PREQUEL/SEQUEL union-find group into one or more catalogue Titles.
 * A raw group can chain together shows that are not actually the same title
 * (see `splitByContinuation`), so this always returns an array, and
 * cross-links siblings that came out of the same original group via
 * `related` so the UI can offer "you may also like the other Dragon Ball
 * shows" without re-deriving the relationship at request time.
 */
function buildFranchiseTitles(rawGroup) {
  const built = splitByContinuation(rawGroup).map(toTitle).filter(Boolean);
  if (built.length > 1) {
    const ids = built.map((title) => title.id);
    for (const title of built) {
      title.related = ids.filter((id) => id !== title.id);
    }
  }
  return built;
}

async function main() {
  const { pages, out, jikan, kitsu, logos } = parseArgs(process.argv.slice(2));
  const mediaById = new Map();
  const malIdBySeason = new Map();

  for (let page = 1; page <= pages; page += 1) {
    const data = await query({ page, perPage: PER_PAGE });
    for (const media of data.Page.media) {
      if (!displayTitle(media)) continue;
      if (!SERIES_FORMATS.has(media.format) && media.format !== "MOVIE") continue;
      mediaById.set(media.id, media);
      if (media.idMal) malIdBySeason.set(String(media.id), media.idMal);
    }
    process.stdout.write(`\r  fetched page ${page}/${pages} (${mediaById.size} entries)`);
    if (!data.Page.pageInfo.hasNextPage) break;
    if (page < pages) await sleep(REQUEST_SPACING_MS);
  }
  process.stdout.write("\n");

  let titles = clusterFranchises(mediaById)
    .flatMap(buildFranchiseTitles)
    .sort((a, b) => b.popularity - a.popularity);

  for (const title of titles) delete title.popularity;

  let mapping = new Map();
  if (kitsu || logos) {
    try {
      mapping = await fetchIdMapping();
      console.log(`  id mapping: ${mapping.size} AniList entries`);
    } catch (error) {
      console.warn(
        `  id mapping unavailable (${error.message}) — skipping Kitsu/TMDB`
      );
    }
  }

  if (kitsu && mapping.size > 0) {
    const result = await enrichEpisodesFromKitsu(titles, mapping);
    console.log(
      `  kitsu: ${result.titled} episode titles + ${result.art} stills + ` +
        `${result.counted} counts across ${result.pending} seasons ` +
        `(${result.failed} unavailable)`
    );
  }

  if (logos) {
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) {
      console.warn("  TMDB_API_KEY not set, skipping logos");
    } else if (mapping.size > 0) {
      const result = await enrichLogosFromTmdb(titles, mapping, apiKey);
      console.log(`  tmdb: ${result.filled} logos (${result.failed} failed)`);

      const fanartKey = process.env.FANART_API_KEY;
      if (fanartKey) {
        const fanartResult = await enrichLogosFromFanart(titles, mapping, fanartKey);
        console.log(
          `  fanart: ${fanartResult.filled} logos (${fanartResult.failed} failed) ` +
            `of ${fanartResult.pending} still missing`
        );
      }
    }
  }

  if (jikan) {
    const result = await enrichEpisodeTitlesFromJikan(titles, malIdBySeason);
    console.log(
      `  jikan: filled ${result.filled}/${result.pending} seasons (${result.failed} unavailable)`
    );
  }

  // A series with no episode data anywhere (--no-kitsu, or a Kitsu miss) is
  // unplayable - drop it rather than ship a detail page whose every episode
  // 404s at the provider. Deferred until here so Kitsu gets a chance to fill
  // still-airing long-runners' unknown counts first.
  titles = titles.filter(
    (title) => !title.seasons || !title.seasons.every((season) => season.episodes.length === 0)
  );
  for (const title of titles) {
    for (const season of title.seasons ?? []) delete season._unknownEpisodeCount;
  }

  await writeFile(out, `${JSON.stringify(titles)}\n`);

  const seasons = titles.flatMap((t) => t.seasons ?? []);
  const episodes = seasons.flatMap((s) => s.episodes);
  const named = episodes.filter((e) => !/^Episode \d+$/.test(e.title)).length;
  console.log(
    `Wrote ${out}: ${titles.length} titles · ${seasons.length} seasons · ` +
      `${episodes.length} episodes (${named} with real titles) ` +
      `from ${mediaById.size} AniList entries`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
