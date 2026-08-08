import "server-only";

/**
 * The playback source boundary.
 *
 * Pezzy deliberately owns no content. Everything from the catalog down to the
 * player is source-agnostic: a `StreamResolver` turns "this title, this
 * episode, this audio language" into playable URLs, and nothing else in the app
 * knows or cares where those came from.
 *
 * That boundary exists for two reasons. Licensing is the first — a production
 * deployment plugs in whatever it actually holds rights to (an S3/CDN origin, a
 * licensed partner API), and that decision stays in one file. Security is the
 * second — a resolver's output is untrusted by construction, so everything
 * downstream (`anime-proxy.ts`, `safe-fetch.ts`) treats it as hostile input
 * regardless of which implementation produced it. See docs/SECURITY.md.
 *
 * The bundled implementation is `open-movie-resolver.ts`, which serves
 * Creative Commons films so the app runs end-to-end from a fresh clone.
 */

/** Audio track selection. Subtitled original audio, or a dubbed track. */
export type ContentLanguage = "sub" | "dub";

export type StreamQuality = "auto" | "360p" | "480p" | "720p" | "1080p";

export interface ResolvedSubtitle {
  url: string;
  label: string;
  /** BCP-47 where the source provides it; a bare language name otherwise. */
  language: string;
}

export interface ResolvedStream {
  /** Absolute URL of the media. Never handed to the browser directly. */
  sourceUrl: string;
  isHLS: boolean;
  quality: StreamQuality;
  language: ContentLanguage;
  /**
   * Request headers the origin requires (Referer, User-Agent, tokens).
   * Replayed server-side only — see `anime-proxy.ts`.
   */
  headers: Record<string, string>;
  subtitles: ResolvedSubtitle[];
}

export interface ResolveRequest {
  /** Catalog media id. Identifies the season, not the franchise. */
  mediaId: string;
  /** 1-based, relative to the season. */
  episode: number;
  language: ContentLanguage;
  signal?: AbortSignal;
}

export interface StreamResolver {
  /** Stable id, surfaced to clients so a specific source can be requested. */
  readonly id: string;
  resolve(request: ResolveRequest): Promise<ResolvedStream[]>;
}

/** One resolver's failure, kept structured rather than joined into a string. */
export interface ResolverFailure {
  resolver: string;
  message: string;
}

export class StreamResolutionError extends Error {
  constructor(public readonly failures: ResolverFailure[]) {
    super(failures.map((f) => `${f.resolver}: ${f.message}`).join("; "));
    this.name = "StreamResolutionError";
  }
}

/**
 * Race every candidate resolver and take the first that produces streams.
 *
 * Sources differ in coverage and latency, so a fixed order would mean waiting
 * on a slow one that has nothing while a fast one already answered. Failures
 * are collected rather than discarded — when every resolver misses, the caller
 * needs to know why each one did.
 */
export async function resolveFirst(
  resolvers: StreamResolver[],
  request: ResolveRequest
): Promise<{ resolver: string; streams: ResolvedStream[] }> {
  if (resolvers.length === 0) {
    throw new StreamResolutionError([
      { resolver: "none", message: "no resolver is configured" },
    ]);
  }

  const attempts = resolvers.map((resolver) => ({
    id: resolver.id,
    promise: (async () => {
      const streams = await resolver.resolve(request);
      if (streams.length === 0) throw new Error("returned no streams");
      return { resolver: resolver.id, streams };
    })(),
  }));

  try {
    return await Promise.any(attempts.map((attempt) => attempt.promise));
  } catch (error) {
    const failures: ResolverFailure[] =
      error instanceof AggregateError
        ? error.errors.map((reason, i) => ({
            resolver: attempts[i]?.id ?? "unknown",
            message: reason instanceof Error ? reason.message : String(reason),
          }))
        : [
            {
              resolver: attempts[0]?.id ?? "unknown",
              message: error instanceof Error ? error.message : String(error),
            },
          ];
    throw new StreamResolutionError(failures);
  }
}
