import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getCatalogTitle } from "@/lib/catalog-service";
import { VideoPlayer } from "@/components/ui/video-player";
import { getActiveProfile } from "@/lib/active-profile";
import {
  getAlwaysGenerateSubtitles,
  getAutoSkipIntro,
  getPreferredAudio,
} from "@/lib/db";

export default async function WatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ season?: string; episode?: string; t?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const title = await getCatalogTitle(id);
  if (!title) notFound();

  const season = query.season ? Number(query.season) : undefined;
  const episode = query.episode ? Number(query.episode) : undefined;
  // The one place `t` (resume position, seconds) is parsed.
  const startPositionSeconds = query.t ? Number(query.t) : undefined;

  const seasonData = title.seasons?.find((item) => item.number === season);
  const malId = title.format === "movie" ? title.malId : seasonData?.malId;

  // Server component, so these read straight off the DB getters instead of
  // a client round trip to /api/settings/* before playback can even start.
  const profile = await getActiveProfile();
  const autoSkipIntro = profile ? getAutoSkipIntro(profile.id) : false;
  const preferredAudio = profile ? getPreferredAudio(profile.id) : "ask";
  const alwaysGenerateSubtitles = profile
    ? getAlwaysGenerateSubtitles(profile.id)
    : false;

  // Next-episode link for the outro's "Next episode" control, if there is one.
  let nextEpisodeHref: string | undefined;
  if (seasonData && episode !== undefined) {
    const hasNext = seasonData.episodes.some((item) => item.number === episode + 1);
    if (hasNext) {
      nextEpisodeHref = `/watch/${title.id}?season=${season}&episode=${episode + 1}`;
    } else {
      const nextSeason = title.seasons?.find((item) => item.number === (season ?? 0) + 1);
      const firstEpisode = nextSeason?.episodes[0]?.number;
      if (nextSeason && firstEpisode !== undefined) {
        nextEpisodeHref = `/watch/${title.id}?season=${nextSeason.number}&episode=${firstEpisode}`;
      }
    }
  }

  return (
    <main className="min-h-screen bg-background px-[4vw] py-8">
      <div className="mx-auto max-w-6xl">
        <Link
          href={`/title/${title.id}`}
          className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to {title.title}
        </Link>

        <div className="overflow-hidden rounded-xl border border-white/10 bg-card">
          <VideoPlayer
            titleId={title.id}
            season={season}
            episode={episode}
            malId={malId}
            autoSkipIntro={autoSkipIntro}
            preferredAudio={preferredAudio}
            alwaysGenerateSubtitles={alwaysGenerateSubtitles}
            nextEpisodeHref={nextEpisodeHref}
            startPositionSeconds={
              Number.isFinite(startPositionSeconds) ? startPositionSeconds : undefined
            }
          />
        </div>

        <h1 className="mt-5 text-xl font-semibold text-foreground">
          {title.title}
          {episode !== undefined && season !== undefined
            ? ` · S${season} E${episode}`
            : ""}
        </h1>
      </div>
    </main>
  );
}
