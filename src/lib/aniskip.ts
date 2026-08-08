import "server-only";

/** One skippable interval (opening or ending), in seconds from episode start. */
export interface SkipInterval {
  start: number;
  end: number;
}

export interface SkipTimes {
  op?: SkipInterval;
  ed?: SkipInterval;
}

interface AniSkipResponse {
  found?: boolean;
  results?: Array<{
    interval: { startTime: number; endTime: number };
    skipType: "op" | "ed" | "mixed-op" | "mixed-ed" | "recap";
  }>;
}

/**
 * Looks up opening/ending timestamps from AniSkip (free, keyless).
 * Many titles have no data — that degrades to `{}` rather than an error, so
 * the player can silently skip showing a skip button.
 */
export async function fetchSkipTimes(
  malId: string,
  episode: number,
  episodeLength: number
): Promise<SkipTimes> {
  try {
    const url = `https://api.aniskip.com/v2/skip-times/${encodeURIComponent(malId)}/${episode}?types=op&types=ed&episodeLength=${episodeLength}`;
    const response = await fetch(url);
    if (!response.ok) return {};

    const data = (await response.json()) as AniSkipResponse;
    if (!data.found || !data.results) return {};

    const result: SkipTimes = {};
    for (const item of data.results) {
      if (item.skipType === "op") {
        result.op = { start: item.interval.startTime, end: item.interval.endTime };
      } else if (item.skipType === "ed") {
        result.ed = { start: item.interval.startTime, end: item.interval.endTime };
      }
    }
    return result;
  } catch (error) {
    console.error("AniSkip lookup failed", error instanceof Error ? error.message : error);
    return {};
  }
}
