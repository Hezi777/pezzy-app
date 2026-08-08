"use client";

import * as React from "react";
import Link from "next/link";
import { Bookmark, Play } from "lucide-react";
import { motion, useReducedMotion, useMotionValue } from "motion/react";
import type { Title, TitleProgress } from "@/lib/types";
import { useMyList } from "@/lib/my-list";
import { cn } from "@/lib/utils";
import { hoverSpring } from "@/lib/motion";
import { watchedPercent } from "@/lib/watch-progress";

interface PosterCardProps {
  title: Title;
  layout?: "rail" | "grid";
  /** Resume point for a Continue watching card. Absent on every other rail. */
  progress?: TitleProgress;
}

// Established resume convention: season/episode always included together,
// `t` (whole seconds) only when there's real progress to resume from.
function buildResumeQuery(progress: TitleProgress): string {
  const params = new URLSearchParams({
    season: String(progress.seasonNumber),
    episode: String(progress.episodeNumber),
  });
  if (!progress.completed && progress.positionSeconds > 5) {
    params.set("t", String(Math.floor(progress.positionSeconds)));
  }
  return params.toString();
}

/**
 * Vertical 2:3 poster card. No chrome at rest; on hover/focus it scales up,
 * lifts, tilts subtly toward the cursor, and reveals a bottom overlay with
 * title/meta/quick-actions. Transform-only for smooth 60fps motion.
 */
function PosterCardImpl({ title, layout = "rail", progress }: PosterCardProps) {
  const reduceMotion = useReducedMotion();
  // Tilt is driven by raw motion values, not React state: hundreds of
  // setState calls per mousemove sweep was the actual jank source (each one
  // re-rendered the card's whole Link/img subtree). Motion values update the
  // transform directly on the DOM node without touching React at all.
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const [hovered, setHovered] = React.useState(false);
  const { has, toggle } = useMyList();
  const saved = has(title.id);
  const firstSeason = title.seasons?.[0];
  const resumeQuery = progress ? buildResumeQuery(progress) : null;
  const watchHref = resumeQuery
    ? `/watch/${title.id}?${resumeQuery}`
    : title.format === "movie"
      ? `/watch/${title.id}`
      : firstSeason?.episodes[0]
        ? `/watch/${title.id}?season=${firstSeason.number}&episode=${firstSeason.episodes[0].number}`
        : `/title/${title.id}`;
  const progressPercent = watchedPercent(progress);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reduceMotion) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    rotateX.set(py * -8);
    rotateY.set(px * 8);
  };

  const handleLeave = () => {
    setHovered(false);
    rotateX.set(0);
    rotateY.set(0);
  };

  return (
    <motion.div
      className={cn(
        "group relative min-w-0",
        layout === "grid" ? "w-full" : "w-40 flex-none sm:w-44 md:w-48"
      )}
      style={{ perspective: 800 }}
      onMouseEnter={() => setHovered(true)}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleLeave}
    >
      {/* Pre-rendered shadow layer: its box-shadow value never changes, only
          opacity crossfades in on hover/focus, so this is compositor-only
          instead of repainting an interpolated box-shadow every frame. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-md opacity-0 shadow-[0_20px_40px_rgba(0,0,0,0.5),0_0_28px_rgba(61,90,254,0.28)] transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100"
      />
      <motion.div
        animate={
          reduceMotion
            ? undefined
            : {
                scale: hovered ? 1.06 : 1,
                y: hovered ? -8 : 0,
              }
        }
        transition={hoverSpring}
        className="relative aspect-[2/3] w-full overflow-hidden rounded-md ring-1 ring-foreground/15 group-hover:ring-steel/60 group-focus-within:ring-steel/60"
        style={{ transformStyle: "preserve-3d", rotateX, rotateY }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={title.poster}
          alt={title.title}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />

        {progress && (
          <div
            aria-hidden
            className="pointer-events-none absolute left-2 top-2 z-20 rounded bg-background/80 px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-foreground/90 backdrop-blur"
          >
            S{progress.seasonNumber} E{progress.episodeNumber}
          </div>
        )}

        <Link
          href={`/title/${title.id}`}
          aria-label={`View ${title.title}`}
          className="absolute inset-0 z-10 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onFocus={() => setHovered(true)}
          onBlur={handleLeave}
        />

        {/* Readability scrims sit beneath all text and controls. */}
        <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-t from-background/90 via-background/10 to-transparent opacity-60 transition-opacity duration-280 group-hover:opacity-0 group-focus-within:opacity-0" />
        <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-t from-background via-background/60 to-transparent opacity-100 transition-opacity duration-280 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" />

        {/* Subtitle-style caption, anime-sub lower third */}
        <div className="pointer-events-none absolute inset-x-0 bottom-[26%] z-20 flex justify-center px-3 opacity-100 transition-opacity duration-280 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <p className="line-clamp-2 text-center text-sm font-semibold tracking-wide text-white [text-shadow:0_2px_8px_rgba(0,0,0,1)]">
            <span className="text-steel">「</span> {title.title}{" "}
            <span className="text-steel">」</span>
          </p>
        </div>

        {/* Hover overlay */}
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-end opacity-100 transition-opacity duration-280 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <div className="p-3">
            <div className="flex items-center gap-1.5 text-xs text-foreground/80">
              {title.year && <span>{title.year}</span>}
              {title.score !== undefined && (
                <span>· {(title.score / 10).toFixed(1)}</span>
              )}
            </div>
            <div className="pointer-events-auto mt-2 flex items-center gap-2">
              <Link
                href={watchHref}
                aria-label={`Play ${title.title}`}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-primary/60 bg-primary text-primary-foreground shadow-[0_0_12px_rgba(61,90,254,0.5)] transition-colors hover:bg-primary-hover active:scale-[0.98] sm:h-7 sm:w-7"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
              </Link>
              <button
                type="button"
                aria-label={
                  saved
                    ? `Remove ${title.title} from My List`
                    : `Save ${title.title} to My List`
                }
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggle(title.id);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-foreground backdrop-blur transition-colors hover:bg-white/[0.1] active:scale-[0.98] sm:h-7 sm:w-7"
              >
                <Bookmark
                  className={cn("h-3.5 w-3.5", saved && "fill-current")}
                />
              </button>
            </div>
          </div>
        </div>

        {progressPercent !== undefined && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[3px] bg-black/50"
          >
            <div className="h-full bg-primary" style={{ width: `${progressPercent}%` }} />
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// Memoized so an unrelated re-render of a parent grid/row (e.g. paging in
// more cards) doesn't re-run every already-mounted card's render/diff.
export const PosterCard = React.memo(PosterCardImpl);
