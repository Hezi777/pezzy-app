"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A show's title in a hero: its stylised logo when we have one, styled text
 * otherwise.
 *
 * Logos are transparent PNG wordmarks from TMDB (see `Title.logo`) and only
 * exist for a subset of the catalog, so the text path is the norm, not an error
 * case. The image is height-constrained rather than width-constrained because
 * logo art varies wildly in aspect ratio — a wide one must not blow out the
 * column. A load failure falls back to text too, since these are remote assets.
 */
export function TitleLogo({
  title,
  logo,
  className,
  imageClassName,
}: {
  title: string;
  logo?: string;
  className?: string;
  imageClassName?: string;
}) {
  const [failed, setFailed] = React.useState(false);

  if (logo && !failed) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={logo}
        alt={title}
        onError={() => setFailed(true)}
        className={cn(
          "max-w-[min(100%,26rem)] object-contain object-left drop-shadow-[0_2px_12px_rgba(0,0,0,0.75)]",
          imageClassName
        )}
      />
    );
  }

  return <span className={className}>{title}</span>;
}
