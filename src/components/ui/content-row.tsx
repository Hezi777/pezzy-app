"use client";

import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import type { RecoRow } from "@/lib/types";
import { PosterCard } from "@/components/ui/poster-card";
import { entranceTransition } from "@/lib/motion";

interface ContentRowProps {
  row: RecoRow;
  /** Shows a small dismiss control next to the label. Used for prompt-generated rows. */
  onDismiss?: () => void;
}

/**
 * A labeled horizontal rail of posters. Personalized rows use `row.reason`
 * as quiet secondary text beneath the label — no bar or badge. Cards
 * stagger in (scale-from-0.94 + fade-up) when the row scrolls into view,
 * so the row reads as "composing itself for you."
 */
export function ContentRow({ row, onDismiss }: ContentRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });
  const reduceMotion = useReducedMotion();

  return (
    // hover/focus-within raises this row's stacking context above sibling rows
    // (both the one before and after in DOM order), so a lifted/scaled card
    // isn't painted over by the next row down.
    <div ref={ref} className="relative py-4 hover:z-10 focus-within:z-10">
      <div className="mb-3 flex items-center justify-between gap-2.5 px-[4vw]">
        <h2 className="text-lg font-semibold tracking-tight text-foreground/95">
          {row.label}
        </h2>
        {onDismiss && (
          <button
            type="button"
            aria-label={`Remove ${row.label} row`}
            onClick={onDismiss}
            className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {row.aiGenerated && row.reason && (
        <p className="mb-3 px-[4vw] text-sm text-muted-foreground">
          {row.reason}
        </p>
      )}

      {/* overflow-x-auto forces overflow-y to compute to auto too, which
          clips a hovered card's scale/lift on the cross axis. py-10/-my-10
          gives the scrollport room on the padding side of that clip (where
          overflow doesn't cut) while the negative margin cancels the padding
          out of the surrounding layout, so row spacing stays identical. */}
      <div
        className="flex gap-3 overflow-x-auto px-[4vw] py-10 -my-10 [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >

        {row.titles.map((title, i) => (
          <motion.div
            key={title.id}
            initial={reduceMotion ? false : { opacity: 0, y: 20, scale: 0.94 }}
            animate={
              inView || reduceMotion
                ? { opacity: 1, y: 0, scale: 1 }
                : { opacity: 0, y: 20, scale: 0.94 }
            }
            transition={{
              ...entranceTransition,
              duration: 0.45,
              delay: reduceMotion ? 0 : i * 0.07,
            }}
          >
            <PosterCard title={title} progress={row.progress?.[title.id]} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
