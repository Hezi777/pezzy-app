/**
 * Shared motion signature for Pezzy's UI. One easing curve, one entrance
 * transition, one hover spring — reused across hero, rows, cards, and the
 * profile selector instead of ad-hoc inline values per component.
 */

/** The "swoosh" easing tuple — also used by the route-level template.tsx. */
export const swoosh = [0.16, 1, 0.3, 1] as const;

/** Standard fade/rise entrance transition for content composing into view. */
export const entranceTransition = {
  duration: 0.5,
  ease: swoosh,
};

/** Hover/lift spring — snappy but soft, for cards and interactive discs. */
export const hoverSpring = {
  type: "spring" as const,
  stiffness: 260,
  damping: 26,
};

/**
 * Route-level page transition offset, in px not %. A percentage translate on
 * a tall page is a huge pixel distance and reads as a "jump"; a small fixed
 * offset plus a fade reads as a smooth lateral swap regardless of page height.
 */
export const pageTransitionOffset = 24;
