/**
 * Shared contract for the Pezzy hub + AI layer.
 *
 * This is the seam between the recommendation/AI foundation (server) and the
 * hub UI (client). Both sides build against these types. Keep changes here
 * coordinated — everything routes through this.
 */

/** One episode within a season. */
export interface Episode {
  number: number;
  title: string;
  /**
   * Thumbnail URL. May be an external AniList streaming-episode image (demo
   * asset, same licensing caveat as posters — see PRD R1) or a local fallback
   * (season banner/poster). Render with an onError fallback.
   */
  thumbnail?: string;
}

/** A season of a show (a franchise groups its seasons — see catalog clustering). */
export interface Season {
  number: number;
  /**
   * This season's OWN AniList media id. A franchise is one Title, but AniList
   * models each season as a separate entry — playback resolves against this id,
   * not the franchise's, so season 3 doesn't stream season 1.
   */
  mediaId: string;
  title: string;
  year?: number;
  synopsis?: string;
  episodes: Episode[];
  /** This season's MyAnimeList id, for AniSkip intro/outro timestamps. */
  malId?: string;
}

/**
 * A single catalog entry (metadata sourced from AniList — see PRD R2).
 * A "show" is a franchise: multiple AniList seasons collapse into one Title
 * with a `seasons` array. Movies carry `format: "movie"` and no seasons.
 */
export interface Title {
  id: string;
  title: string;
  year?: number;
  genres: string[];
  /** 0–100 (AniList averageScore). */
  score?: number;
  synopsis?: string;
  /** Cover image URL (AniList CDN). */
  poster: string;
  /** Wide banner URL for hero use (AniList CDN). Absent for some titles. */
  banner?: string;
  /**
   * The show's stylised title treatment (transparent PNG wordmark) from TMDB,
   * e.g. the Attack on Titan logo. Absent for most titles — heroes must fall
   * back to rendering `title` as text.
   */
  logo?: string;
  /** Dominant color hex from AniList coverImage, e.g. "#4F7CFF". */
  color?: string;
  /** "tv" (has seasons/episodes) or "movie" (standalone). */
  format?: "tv" | "movie";
  /** Seasons for a TV show, ordered. Empty/absent for movies. */
  seasons?: Season[];
  /** A movie's MyAnimeList id, for AniSkip intro/outro timestamps. */
  malId?: string;
  /**
   * Ids of sibling titles that split out of the same AniList PREQUEL/SEQUEL
   * chain during catalog clustering (e.g. the other Dragon Ball shows), for a
   * future "related titles" UI.
   */
  related?: string[];
}

export type RecoIntent = "home" | "next" | "chat";

/**
 * Input to the shared recommendation core. Chatbot, homepage rows, and
 * "what to watch next" all build one of these and call `recommend()`.
 */
export interface RecoContext {
  profileId: string;
  intent: RecoIntent;
  /** Title ids the profile has watched. */
  watchHistory?: string[];
  /** Natural-language ask (chat / talk-to-your-homepage). */
  prompt?: string;
  /** Max number of rows to return. */
  limit?: number;
}

/**
 * Resume point for one title. Only the Continue watching row populates this -
 * nothing attaches it to `Title` itself, so every other rail's payload is
 * unaffected (see `RecoRow.progress`).
 */
export interface TitleProgress {
  seasonNumber: number;
  episodeNumber: number;
  positionSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
}

/** A labeled rail of titles. `aiGenerated` drives the cyan AI chip in the UI. */
export interface RecoRow {
  id: string;
  label: string;
  /** Short, human explanation of why this row exists (AI transparency). */
  reason?: string;
  aiGenerated: boolean;
  titles: Title[];
  /** Resume progress keyed by title id. Only set on the Continue watching row. */
  progress?: Record<string, TitleProgress>;
}

export interface ChatRequest {
  profileId: string;
  message: string;
}

export interface ChatResponse {
  reply: string;
  /** Optional row generated from the ask (e.g. "make me a row about mecha"). */
  row?: RecoRow;
}

/**
 * Turn a user selfie into an anime avatar (PRD R4). Face photos are
 * biometric-adjacent: `consent` gates the whole flow, the source is never
 * persisted longer than the generation call, and only the generated result is
 * kept. See src/app/api/avatar/route.ts.
 */
export interface AvatarGenRequest {
  profileId: string;
  /** Source selfie as a data URL. Held in memory for the call only, never stored. */
  imageDataUrl: string;
  /** Art direction, e.g. "shonen", "shojo", "chibi". */
  style?: string;
  /** Explicit consent to process a face photo. The server rejects a false value. */
  consent: boolean;
}

export interface AvatarGenResponse {
  /** URL of the generated anime avatar. */
  avatarUrl: string;
  /** Style actually applied. */
  style: string;
}

/**
 * On-demand subtitles / translation for a title (PRD R3 — cache + rate-limit,
 * never generate on every load). Foundation stub only; see
 * src/app/api/subtitles/route.ts.
 */
export interface SubtitleRequest {
  titleId: string;
  /** BCP-47 target language, e.g. "en", "es", "ja". */
  language: string;
}

export interface SubtitleCue {
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
  text: string;
}

export interface SubtitleResponse {
  titleId: string;
  language: string;
  cues: SubtitleCue[];
  /** True when served from cache rather than freshly generated. */
  cached: boolean;
}
