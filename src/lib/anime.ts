import "server-only";

import type { Season, Title } from "@/lib/types";
import { parseHlsVariants, registerAnimeResource } from "@/lib/anime-proxy";
import { safeFetch, screenUrl } from "@/lib/safe-fetch";
import { OpenMovieResolver } from "@/lib/resolvers/open-movie-resolver";
import {
  resolveFirst,
  StreamResolutionError,
  type ContentLanguage,
  type ResolvedStream,
  type StreamQuality,
  type StreamResolver,
} from "@/lib/stream-resolver";

/**
 * Configured playback sources.
 *
 * Add a resolver here and it joins the race automatically — nothing else needs
 * to change. See `stream-resolver.ts` for the contract and docs/SECURITY.md for
 * why a resolver's output is treated as untrusted no matter who wrote it.
 */
const resolvers: StreamResolver[] = [new OpenMovieResolver()];

/** Resolver ids a client may request explicitly via `provider` on /api/anime/streams. */
export const PROVIDER_IDS: string[] = resolvers.map((resolver) => resolver.id);

const REQUEST_TIMEOUT_MS = 30_000;

export interface AnimeSubtitle {
  url: string;
  label: string;
  language: string;
}

export interface AnimeStream {
  id: string;
  provider: string;
  label: string;
  url: string;
  isHLS: boolean;
  quality: StreamQuality;
  language: ContentLanguage;
  subtitles: AnimeSubtitle[];
}

export interface AnimeSource {
  provider: string;
  url: string;
  headers: Record<string, string>;
  isHLS: boolean;
  quality: StreamQuality;
  language: ContentLanguage;
}

/** One resolver's failure, kept structured instead of joined into one string. */
export interface ProviderFailure {
  provider: string;
  message: string;
}

export class ProviderResolutionError extends Error {
  constructor(public readonly failures: ProviderFailure[]) {
    super(failures.map((f) => `${f.provider}: ${f.message}`).join("; "));
    this.name = "ProviderResolutionError";
  }
}

/**
 * The catalog media id to stream. Each season carries its own (see
 * `Season.mediaId`); a movie or a season-less title is its own entry.
 */
function mediaIdFor(title: Title, season?: Season): string {
  return season?.mediaId ?? title.id;
}

/**
 * Header values may come from a remote source, and we replay them on outbound
 * requests and hand them to ffmpeg as `-headers` lines. A CR or LF in a value
 * is therefore request-header injection; an invalid name makes `new Headers()`
 * throw mid-request. Drop anything that is not a clean single-line pair.
 */
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

export function sanitizeUpstreamHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HEADER_NAME_RE.test(name)) continue;
    if (/[\r\n\0]/.test(value)) continue;
    if (value.length > 2048) continue;
    safe[name] = value;
  }
  return safe;
}

/**
 * Fetch and parse the master playlist's real quality variants. Best-effort:
 * a failed fetch or a single-rendition playlist returns an empty array, and
 * the caller falls back to the one "auto" stream rather than fabricating
 * quality options that all point at the same media.
 */
async function fetchHlsVariants(
  sourceUrl: string,
  headers: Record<string, string> = {}
) {
  try {
    const { response, finalUrl } = await safeFetch(sourceUrl, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return [];
    return parseHlsVariants(await response.text(), finalUrl);
  } catch {
    return [];
  }
}

/** Cap the per-stream subtitle list; a resolver may report it from remote data. */
const MAX_SUBTITLE_TRACKS = 32;
/** Cap the quality variants a single master playlist may expand into. */
const MAX_VARIANTS = 16;

async function toClientStreams(
  resolverId: string,
  stream: ResolvedStream,
  index: number
): Promise<AnimeStream[]> {
  const headers = sanitizeUpstreamHeaders(stream.headers);

  // Subtitle hosts often enforce the same Referer as the video, so the track
  // must carry the stream's headers.
  //
  // Registration is per-track and failures are skipped rather than thrown: a
  // source can serve one malformed subtitle URL alongside a perfectly good
  // video, and losing the whole episode over a caption track is a denial of
  // playback the source gets to choose.
  const subtitles: AnimeSubtitle[] = [];
  for (const track of (stream.subtitles ?? []).slice(0, MAX_SUBTITLE_TRACKS)) {
    try {
      subtitles.push({
        url: registerAnimeResource(track.url, headers, "subtitle"),
        label: track.label,
        language: track.language,
      });
    } catch {
      // Bad track, keep the stream.
    }
  }

  const variants = stream.isHLS
    ? (await fetchHlsVariants(stream.sourceUrl, headers)).slice(0, MAX_VARIANTS)
    : [];

  // Expand into per-quality entries only when the manifest actually labels its
  // renditions. Plenty of masters carry neither RESOLUTION nor NAME, and those
  // parse to a uniform "auto" — offering five identical-looking options that
  // silently pick different bitrates is worse than one entry, and hls.js
  // already does adaptive selection from the master on its own.
  const labelled = new Set(variants.map((variant) => variant.quality));
  const useVariants = variants.length > 1 && labelled.size > 1;
  const targets = useVariants
    ? variants
    : [{ url: stream.sourceUrl, quality: stream.quality }];

  const out: AnimeStream[] = [];
  for (const [variantIndex, target] of targets.entries()) {
    let url: string;
    try {
      url = registerAnimeResource(target.url, headers);
    } catch {
      continue; // Unusable target; try the next rendition.
    }
    out.push({
      id: `${resolverId}:${index}:${variantIndex}:${target.quality}:${stream.language}`,
      provider: resolverId,
      label: `${target.quality} · ${stream.language}`,
      url,
      isHLS: stream.isHLS,
      quality: target.quality as StreamQuality,
      language: stream.language,
      subtitles,
    });
  }
  return out;
}

interface ResolveInput {
  title: Title;
  season?: Season;
  episode: number;
  language: ContentLanguage;
  /** Resolve through this resolver only, skipping the race. See PROVIDER_IDS. */
  provider?: string;
}

async function resolveRaw(
  input: ResolveInput
): Promise<{ resolver: string; streams: ResolvedStream[] }> {
  const candidates = input.provider
    ? resolvers.filter((resolver) => resolver.id === input.provider)
    : resolvers;
  if (candidates.length === 0) {
    throw new Error(`Unknown provider "${input.provider}"`);
  }

  try {
    return await resolveFirst(candidates, {
      mediaId: mediaIdFor(input.title, input.season),
      episode: input.episode,
      language: input.language,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof StreamResolutionError) {
      throw new ProviderResolutionError(
        error.failures.map((failure) => ({
          provider: failure.resolver,
          message: failure.message,
        }))
      );
    }
    throw error;
  }
}

export async function resolveAnimeStreams(
  input: ResolveInput
): Promise<AnimeStream[]> {
  const { resolver, streams } = await resolveRaw(input);
  const mapped = await Promise.all(
    streams.map((stream, index) => toClientStreams(resolver, stream, index))
  );
  return mapped.flat();
}

/**
 * The same resolution, but returning the raw upstream URL and headers instead
 * of proxy tokens.
 *
 * Server-only consumers (subtitle transcription) need to pull the media
 * themselves with the source's required headers. The proxy indirection exists
 * to keep upstream URLs away from the browser — it would only get in the way
 * here, so this must never be handed to a client.
 *
 * The URL is screened here rather than only at fetch time because the consumer
 * hands it to ffmpeg as `-i`, and ffmpeg's protocol handlers accept far more
 * than HTTP — `file:`, `concat:`, and friends.
 */
export async function resolveAnimeSources(
  input: ResolveInput
): Promise<AnimeSource[]> {
  const { resolver, streams } = await resolveRaw(input);
  const sources: AnimeSource[] = [];
  for (const stream of streams) {
    const reason = screenUrl(stream.sourceUrl);
    if (reason) {
      console.error(`Rejected ${resolver} source URL (${reason})`);
      continue;
    }
    sources.push({
      provider: resolver,
      url: stream.sourceUrl,
      headers: sanitizeUpstreamHeaders(stream.headers ?? {}),
      isHLS: stream.isHLS,
      quality: stream.quality,
      language: stream.language,
    });
  }
  if (sources.length === 0) {
    throw new ProviderResolutionError([
      { provider: resolver, message: "no usable source URL survived screening" },
    ]);
  }
  return sources;
}
