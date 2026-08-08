"use client";

import * as React from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronLeft, Play, Plus } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { Episode, Season, Title } from "@/lib/types";
import { useMyList } from "@/lib/my-list";
import { TitleLogo } from "@/components/ui/title-logo";
import {
  getTitleProgress,
  watchedPercent,
  type EpisodeProgress,
} from "@/lib/watch-progress";

interface TitleDetailProps {
  title: Title;
}

// Season titles from AniList repeat the franchise name ("Attack on Titan
// Final Season Part 2"), which is just noise once it's the label on a
// per-season control. Strip the franchise prefix and whatever separator
// punctuation is left behind; keep the remainder verbatim so arc-named
// seasons (Demon Slayer's "Mugen Train Arc") survive instead of being
// flattened to "Season N".
function seasonLabel(franchiseTitle: string, season: Season): string {
  const raw = season.title?.trim();
  if (!raw) return `Season ${season.number}`;

  let remainder = raw;
  if (raw.toLowerCase().startsWith(franchiseTitle.trim().toLowerCase())) {
    remainder = raw.slice(franchiseTitle.trim().length);
  }
  remainder = remainder.replace(/^[\s:.\-–—]+/, "").trim();

  return remainder || `Season ${season.number}`;
}

/**
 * Cinematic detail view for a single title: full-bleed hero, meta, CTAs,
 * synopsis, and (for TV) a season selector with an episode list.
 */
export function TitleDetail({ title }: TitleDetailProps) {
  const reduceMotion = useReducedMotion();
  const { has, toggle } = useMyList();
  const image = title.banner ?? title.poster;
  const saved = has(title.id);

  const glowColor = title.color ?? "#3D5AFE";
  const seasons = title.seasons ?? [];
  const [seasonNumber, setSeasonNumber] = React.useState(
    seasons[0]?.number ?? 1
  );
  const activeSeason =
    seasons.find((s) => s.number === seasonNumber) ?? seasons[0];

  // One fetch for every episode's progress across all seasons of this title.
  // Empty on a fresh profile (or if the request fails) — episodes then just
  // render with no bar/badge, same as before this existed.
  const [progress, setProgress] = React.useState<EpisodeProgress[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    getTitleProgress(title.id).then((rows) => {
      if (!cancelled) setProgress(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [title.id]);

  // Keyed lookup for the episode list below, which re-checks this per episode
  // on every render — avoids an O(episodes × progress rows) scan.
  const progressByEpisode = React.useMemo(() => {
    const map = new Map<string, EpisodeProgress>();
    for (const row of progress) {
      map.set(`${row.seasonNumber}:${row.episodeNumber}`, row);
    }
    return map;
  }, [progress]);

  return (
    <>
      {/* HERO */}
      <section className="relative h-[70vh] min-h-[480px] w-full overflow-hidden">
        {/* Back control sits above the hero copy in its own stacking context —
            inside the bottom-aligned content column it landed on the synopsis. */}
        <Link
          href="/hub"
          aria-label="Back"
          className="absolute left-[4vw] top-20 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-background/60 text-foreground backdrop-blur transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />

        {/* Spotlight glow — tinted toward the title's accent color */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(50% 60% at 25% 40%, color-mix(in srgb, ${glowColor} 35%, transparent) 0%, transparent 70%)`,
          }}
        />

        {/* Left-to-right scrim */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background via-background/60 to-transparent" />
        {/* Bottom scrim into page background */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/10 to-transparent" />
        {/* Top scrim — the nav is transparent until scrolled, so a bright banner
            (a daylit sky, say) leaves the nav links unreadable without this. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background/80 to-transparent" />

        {/* pt-28 keeps the hero copy clear of the fixed nav: the block is
            bottom-aligned, so a long synopsis grows upward into it. */}
        <div className="relative flex h-full max-w-[1600px] flex-col justify-end px-[4vw] pb-16 pt-28">
          <motion.h1
            initial={reduceMotion ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-xl font-display text-4xl font-semibold leading-[1.02] tracking-tight text-foreground md:text-6xl"
          >
            <TitleLogo
              title={title.title}
              logo={title.logo}
              imageClassName="max-h-28 md:max-h-40"
            />
          </motion.h1>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="mt-3 flex flex-wrap items-center gap-3 text-sm text-foreground/70"
          >
            {title.year && <span>{title.year}</span>}
            <span>{title.format === "movie" ? "Movie" : "Series"}</span>
            {title.genres.length > 0 && (
              <span className="truncate">{title.genres.join(" · ")}</span>
            )}
            {title.score !== undefined && (
              <span>{(title.score / 10).toFixed(1)}</span>
            )}
          </motion.div>

          {title.synopsis && (
            <motion.p
              initial={reduceMotion ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.6,
                delay: 0.16,
                ease: [0.22, 1, 0.36, 1],
              }}
              // Clamped: AniList synopses run several hundred words, which
              // pushed the title and CTAs out of the hero. Full text sits with
              // the season below.
              className="mt-4 line-clamp-3 max-w-xl text-sm text-foreground/75 md:text-base"
            >
              {title.synopsis}
            </motion.p>
          )}

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.6,
              delay: 0.24,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="mt-6 flex items-center gap-3"
          >
            <Link
              href={
                title.format === "movie"
                  ? `/watch/${title.id}`
                  : `/watch/${title.id}?season=${activeSeason?.number ?? 1}&episode=${activeSeason?.episodes[0]?.number ?? 1}`
              }
              className="flex items-center gap-2 rounded-md border border-steel/60 bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_0_20px_rgba(61,90,254,0.35)] transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Play className="h-4 w-4 fill-current" />
              Play
            </Link>
            <button
              type="button"
              onClick={() => toggle(title.id)}
              aria-pressed={saved}
              className="flex items-center gap-2 rounded-md border border-white/10 bg-background/40 px-6 py-2.5 text-sm font-semibold text-foreground backdrop-blur transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {saved ? (
                <Check className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              My List
            </button>
          </motion.div>
        </div>
      </section>

      {/* SEASON SELECTOR + EPISODES */}
      {title.format === "tv" && seasons.length > 0 && activeSeason && (
        <section className="relative z-10 mx-auto max-w-[1600px] px-[4vw] pb-12 pt-8">
          {/* A single-season title has nothing to switch between — a
              one-option dropdown would just be noise above the episode list. */}
          {seasons.length > 1 && (
            <div className="relative mb-6 inline-block">
              <select
                aria-label="Season"
                value={seasonNumber}
                onChange={(e) => setSeasonNumber(Number(e.target.value))}
                className="appearance-none rounded-md border border-white/10 bg-card py-2 pl-4 pr-10 text-sm font-medium text-foreground transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {seasons.map((season) => (
                  <option key={season.number} value={season.number}>
                    {seasonLabel(title.title, season)} · {season.episodes.length}{" "}
                    episode{season.episodes.length === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          )}

          {activeSeason.synopsis && (
            <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
              {activeSeason.synopsis}
            </p>
          )}

          <div className="flex flex-col gap-3">
            {activeSeason.episodes.map((episode) => (
              /* Key includes the season: every season numbers episodes from 1,
                 so keying on the number alone let React reuse the same card
                 across a season switch — and EpisodeCard seeds its <img> src in
                 useState, so the thumbnails stayed on the previous season's. */
              <EpisodeCard
                key={`${activeSeason.number}:${episode.number}`}
                episode={episode}
                fallback={image}
                titleId={title.id}
                seasonNumber={activeSeason.number}
                progress={progressByEpisode.get(
                  `${activeSeason.number}:${episode.number}`
                )}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function EpisodeCard({
  episode,
  fallback,
  titleId,
  seasonNumber,
  progress,
}: {
  episode: Episode;
  fallback: string;
  titleId: string;
  seasonNumber: number;
  progress?: EpisodeProgress;
}) {
  const [src, setSrc] = React.useState(episode.thumbnail ?? fallback);

  const percent = watchedPercent(progress);
  const remainingMinutes =
    progress && progress.durationSeconds && !progress.completed
      ? Math.round((progress.durationSeconds - progress.positionSeconds) / 60)
      : undefined;
  // Resuming only makes sense past a few seconds in — otherwise it's just
  // the start of the episode anyway.
  const canResume = !!progress && !progress.completed && progress.positionSeconds > 5;
  const href = `/watch/${titleId}?season=${seasonNumber}&episode=${episode.number}${
    canResume ? `&t=${Math.floor(progress!.positionSeconds)}` : ""
  }`;

  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-md border border-white/10 bg-card p-2 transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-video w-40 flex-none overflow-hidden rounded-sm sm:w-56">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          onError={() => setSrc(fallback)}
          alt=""
          className="h-full w-full object-cover"
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
          <Play className="h-8 w-8 fill-current text-foreground" />
        </div>
        {progress?.completed && (
          <div
            aria-hidden
            className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            <Check className="h-3 w-3" />
          </div>
        )}
        {percent !== undefined && percent > 0 && !progress?.completed && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-background/60">
            <div
              className="h-full bg-primary"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">
          Episode {episode.number}
          {remainingMinutes !== undefined && remainingMinutes >= 1 && (
            <> · {remainingMinutes} min left</>
          )}
        </p>
        <p className="truncate text-sm font-medium text-foreground">
          {episode.title}
        </p>
      </div>
    </Link>
  );
}
