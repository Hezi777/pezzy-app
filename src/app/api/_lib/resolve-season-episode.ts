import type { Season, Title } from "@/lib/types";

/**
 * Shared season/episode resolution for playback-adjacent routes (stream
 * lookup, subtitle generation): movies are always episode 1 with no season,
 * TV titles must resolve to one of the title's own seasons.
 */
export function resolveSeasonEpisode(
  title: Title,
  rawSeason: unknown,
  rawEpisode: unknown
): { ok: true; season: Season | undefined; episode: number } | { ok: false } {
  if (title.format === "movie") {
    return { ok: true, season: undefined, episode: 1 };
  }

  const seasonNumber = Number(rawSeason);
  const season = title.seasons?.find((item) => item.number === seasonNumber);
  const episode = Number(rawEpisode);
  if (!season || !Number.isInteger(episode) || episode < 1) {
    return { ok: false };
  }
  return { ok: true, season, episode };
}
