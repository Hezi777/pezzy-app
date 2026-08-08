"use client";

import { Info, Play } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { Title } from "@/lib/types";
import { TitleLogo } from "@/components/ui/title-logo";
import { entranceTransition } from "@/lib/motion";
import { Button } from "@/components/ui/button";

interface HeroProps {
  title: Title;
}

/**
 * Full-bleed featured-title hero. Key art with a scrim into the background
 * and a soft spotlight glow tinted toward the title's accent color (falls
 * back to navy), left-aligned title/synopsis/CTAs.
 */
export function Hero({ title }: HeroProps) {
  const reduceMotion = useReducedMotion();
  const image = title.banner ?? title.poster;
  const glowColor = title.color ?? "#3D5AFE";

  return (
    <section className="relative h-[80vh] min-h-[560px] w-full overflow-hidden">
      {/* Key art — slow Ken Burns drift, disabled under reduced motion */}
      <motion.img
        src={image}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        initial={{ scale: 1, x: 0, y: 0 }}
        animate={
          reduceMotion
            ? undefined
            : { scale: 1.06, x: "-1.5%", y: "-1%" }
        }
        transition={
          reduceMotion
            ? undefined
            : { duration: 24, ease: "linear", repeat: Infinity, repeatType: "mirror" }
        }
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

      {/* Content */}
      <div className="relative flex h-full max-w-[1600px] flex-col justify-end px-[4vw] pb-20">
        <motion.p
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={entranceTransition}
          className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground"
        >
          Pezzy Original
        </motion.p>

        <motion.h1
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={entranceTransition}
          className="max-w-xl font-display text-4xl font-semibold leading-[1.02] tracking-tight text-foreground md:text-6xl"
        >
          <TitleLogo
            title={title.title}
            logo={title.logo}
            imageClassName="max-h-28 md:max-h-40"
          />
        </motion.h1>

        {title.synopsis && (
          <motion.p
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...entranceTransition, delay: 0.1 }}
            className="mt-4 max-w-md line-clamp-3 text-sm text-muted-foreground md:text-base"
          >
            {title.synopsis}
          </motion.p>
        )}

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...entranceTransition, delay: 0.18 }}
          className="mt-3 flex items-center gap-3 text-sm text-muted-foreground"
        >
          {title.year && <span>{title.year}</span>}
          {title.genres.length > 0 && (
            <span className="truncate">{title.genres.join(" · ")}</span>
          )}
        </motion.div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...entranceTransition, delay: 0.26 }}
          className="mt-6 flex items-center gap-3"
        >
          <Button variant="primary" size="lg">
            <Play className="h-4 w-4 fill-current" />
            Play
          </Button>
          <Button variant="secondary" size="lg" className="backdrop-blur">
            <Info className="h-4 w-4" />
            More Info
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
