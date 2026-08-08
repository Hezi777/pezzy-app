"use client";

import { useContext, useState } from "react";
import { usePathname } from "next/navigation";
import { LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { swoosh, pageTransitionOffset } from "@/lib/motion";

/**
 * Freezes the App Router's LayoutRouterContext for the lifetime of a single
 * render. AnimatePresence needs the outgoing tree to keep rendering while it
 * plays its exit animation, but App Router tears the old segment's context
 * down the instant navigation commits — which would unmount mid-exit and
 * cut the swoosh short. Snapshotting the context in a ref and handing that
 * frozen copy to the exiting children keeps them alive and stable until
 * AnimatePresence itself removes them.
 */
function FrozenRouter({ children }: { children: React.ReactNode }) {
  const context = useContext(LayoutRouterContext);
  // useState's lazy initializer runs exactly once, capturing the context
  // from the first render and ignoring it thereafter — a ref would do the
  // same, but reading ref.current during render trips the refs lint rule.
  const [frozen] = useState(context);

  return (
    <LayoutRouterContext.Provider value={frozen}>
      {children}
    </LayoutRouterContext.Provider>
  );
}

const pageTransition = { duration: 0.4, ease: swoosh };

/**
 * Route-level transition: a lateral slide + fade, not a vertical one. The
 * old vertical version combined with `mode="wait"` unmounted the outgoing
 * page before mounting the incoming one, so the document briefly collapsed
 * to zero height between the two and the scroll position snapped. `mode=
 * "popLayout"` fixes that at the root: the outgoing page is pulled out of
 * layout flow (absolutely positioned) the instant it starts exiting, so the
 * incoming page occupies its natural position/height immediately and the
 * two simply cross-fade past each other, no gap. The offset is a fixed px
 * value, not a %, so the slide distance doesn't blow up on a tall page.
 * Only transform/opacity animate here, never layout properties. Reduced
 * motion is handled globally via <MotionConfig reducedMotion="user"> in the
 * root layout, which collapses transforms to plain opacity fades;
 * useReducedMotion() here is a belt-and-suspenders check for the same thing.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  return (
    <div className="relative min-h-screen">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={pathname}
          className="min-h-screen"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: pageTransitionOffset }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
          exit={
            reduceMotion
              ? { opacity: 0, transition: { duration: 0.2 } }
              : { opacity: 0, x: -pageTransitionOffset, transition: pageTransition }
          }
          transition={pageTransition}
        >
          <FrozenRouter>{children}</FrozenRouter>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
