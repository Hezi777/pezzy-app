"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { PosterCard } from "@/components/ui/poster-card";
import type { Title } from "@/lib/types";

interface TitleGridProps {
  titles: Title[];
  emptyMessage?: string;
}

// The catalog runs to hundreds of entries and is growing; mounting every
// poster (and decoding every image) at once is the real cost on /series and
// /movies, not the hover handler alone. Reveal in batches instead.
const PAGE_SIZE = 60;

/** Responsive poster grid with a subtle staggered fade-in. */
export function TitleGrid({ titles, emptyMessage }: TitleGridProps) {
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset paging whenever the underlying title list changes (new search,
  // new list contents). Adjusting state during render (rather than in an
  // effect) avoids an extra cascading render on every titles change.
  const [prevTitles, setPrevTitles] = useState(titles);
  if (prevTitles !== titles) {
    setPrevTitles(titles);
    setVisible(PAGE_SIZE);
  }

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || visible >= titles.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible((v) => Math.min(v + PAGE_SIZE, titles.length));
        }
      },
      { rootMargin: "800px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, titles.length]);

  if (titles.length === 0) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center px-[4vw] text-center">
        <p className="text-sm text-muted-foreground">
          {emptyMessage ?? "Nothing here yet."}
        </p>
      </div>
    );
  }

  const shown = titles.slice(0, visible);

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 px-[4vw] min-[430px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {shown.map((t, i) => (
          <motion.div
            key={t.id}
            initial={reduceMotion ? undefined : { opacity: 0, y: 12 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.32, delay: reduceMotion ? 0 : Math.min(i * 0.03, 0.6), ease: [0.22, 1, 0.36, 1] }}
          >
            <PosterCard title={t} layout="grid" />
          </motion.div>
        ))}
      </div>
      {visible < titles.length && <div ref={sentinelRef} aria-hidden className="h-px" />}
    </div>
  );
}
