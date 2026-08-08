import "server-only";

import type {
  ResolveRequest,
  ResolvedStream,
  StreamResolver,
} from "@/lib/stream-resolver";

/**
 * The bundled demo source: Creative Commons films and public HLS test streams.
 *
 * Pezzy holds no anime rights, so the repository ships nothing that pretends
 * otherwise. This resolver exists so a fresh clone actually plays video —
 * exercising the proxy, the HLS rewriter, the quality menu, and the player's
 * full control surface against real multi-rendition manifests rather than a
 * mock.
 *
 * A deployment with licensed content replaces this file. Nothing else changes:
 * everything downstream consumes the `StreamResolver` interface.
 */

interface DemoFilm {
  title: string;
  attribution: string;
  url: string;
  isHLS: boolean;
}

/**
 * Multi-rendition manifests are deliberate — a single-rendition source would
 * leave the quality-selection path untested.
 */
const DEMO_FILMS: DemoFilm[] = [
  {
    title: "Big Buck Bunny",
    attribution: "© Blender Foundation — CC BY 3.0 — peach.blender.org",
    url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    isHLS: true,
  },
  {
    title: "Tears of Steel",
    attribution: "© Blender Foundation — CC BY 3.0 — mango.blender.org",
    url: "https://test-streams.mux.dev/tos_ismc/main.m3u8",
    isHLS: true,
  },
  {
    title: "Mux test stream",
    attribution: "Mux public test stream",
    url: "https://stream.mux.com/v69RSHhFelSm4701snP22dYz2jICy4E4FUyk02rW4gxRM.m3u8",
    isHLS: true,
  },
  {
    title: "Apple BipBop",
    attribution: "Apple HLS example stream",
    url: "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8",
    isHLS: true,
  },
];

/**
 * Deterministic pick, so a given episode always plays the same film across
 * reloads — otherwise resume-from-progress would jump between titles.
 */
function filmFor(mediaId: string, episode: number): DemoFilm {
  let hash = 0;
  const key = `${mediaId}:${episode}`;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return DEMO_FILMS[Math.abs(hash) % DEMO_FILMS.length];
}

export class OpenMovieResolver implements StreamResolver {
  readonly id = "open-movie";

  async resolve(request: ResolveRequest): Promise<ResolvedStream[]> {
    const film = filmFor(request.mediaId, request.episode);
    return [
      {
        sourceUrl: film.url,
        isHLS: film.isHLS,
        quality: "auto",
        language: request.language,
        // Public CDNs, no origin requirements. A licensed source would put its
        // Referer / auth headers here; they are replayed server-side only.
        headers: {},
        subtitles: [],
      },
    ];
  }
}

/** Attribution for the demo content, surfaced in the UI and the README. */
export const DEMO_ATTRIBUTIONS = DEMO_FILMS.map(
  (film) => `${film.title} — ${film.attribution}`
);
