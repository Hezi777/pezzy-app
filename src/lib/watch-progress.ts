// Client-side watch progress reporting. Talks to /api/progress (see
// src/app/api/progress/route.ts) so playback position survives reloads and
// powers the Continue watching row. Mirrors src/lib/my-list.ts's shape but
// is server-backed rather than localStorage-backed, since progress needs to
// feed the shared recommendation core (src/lib/reco).

export interface ProgressUpdate {
  titleId: string;
  seasonNumber: number;
  episodeNumber: number;
  audioLanguage: "sub" | "dub";
  positionSeconds: number;
  durationSeconds?: number;
  completed?: boolean;
}

export interface EpisodeProgress {
  seasonNumber: number;
  episodeNumber: number;
  audioLanguage: string;
  positionSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
  lastWatchedAt: string;
}

/**
 * Percent of an episode watched, clamped to 0–100. Undefined when the
 * duration isn't known yet, which is the signal to render no progress bar
 * at all rather than an empty one.
 */
export function watchedPercent(
  progress: { positionSeconds: number; durationSeconds?: number | null } | undefined
): number | undefined {
  if (!progress?.durationSeconds) return undefined;
  return Math.min(100, Math.max(0, (progress.positionSeconds / progress.durationSeconds) * 100));
}

// Throttle window between writes during playback. Callers should call
// reportProgress on every timeupdate tick; this decides which ones land.
const REPORT_INTERVAL_MS = 12_000;

let lastReportAt = 0;

/**
 * Called repeatedly during playback (e.g. on timeupdate). Throttled to one
 * network write per REPORT_INTERVAL_MS; pass force to bypass the throttle
 * for pause and seek-settle writes, which should always land.
 */
export function reportProgress(update: ProgressUpdate, force = false): void {
  const now = Date.now();
  if (!force && now - lastReportAt < REPORT_INTERVAL_MS) return;
  lastReportAt = now;

  fetch("/api/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
    keepalive: force,
  }).catch(() => {
    // A dropped progress write must never break playback.
  });
}

/**
 * Call on unmount/navigation-away (e.g. a `pagehide` handler or the
 * player's cleanup). Uses sendBeacon rather than fetch: once the page is
 * being torn down, fetch (even with keepalive) can be dropped mid-flight,
 * while sendBeacon is designed to reliably queue the request for delivery.
 */
export function reportProgressOnUnload(update: ProgressUpdate): void {
  if (typeof navigator === "undefined" || !navigator.sendBeacon) {
    reportProgress(update, true);
    return;
  }
  const blob = new Blob([JSON.stringify(update)], { type: "application/json" });
  const sent = navigator.sendBeacon("/api/progress", blob);
  if (!sent) reportProgress(update, true);
}

/** Fetch all progress rows for a title, for rendering watched ticks/resume bars. */
export async function getTitleProgress(titleId: string): Promise<EpisodeProgress[]> {
  try {
    const res = await fetch(`/api/progress?titleId=${encodeURIComponent(titleId)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { episodes: EpisodeProgress[] };
    return data.episodes;
  } catch {
    return [];
  }
}
