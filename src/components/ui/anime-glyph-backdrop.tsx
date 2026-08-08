import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Pezzy signature backdrop: a dense, seamless black-on-black field of small
 * anime-culture glyphs — torii, shuriken, onigiri, ramen, katana, sakura, koi,
 * daruma, maneki-neko, crane, doki-doki heart, kamon crest, chibi ghost,
 * sparkle — packed tightly on a staggered lattice with a diagonal lean (manga
 * "speed" energy) and faded from the center outward so it reads as texture,
 * never distraction. Cheap, sharp, zero JS.
 */

// Motif silhouettes, each drawn in a 0..24 box, filled with currentColor.
const GLYPHS: Record<string, React.ReactNode> = {
  sparkle: (
    <path d="M12 2c1 6 4 9 10 10-6 1-9 4-10 10-1-6-4-9-10-10 6-1 9-4 10-10Z" />
  ),
  torii: (
    <g>
      <path d="M3 6h18v2.2H3z" />
      <path d="M5.5 9.4h13V11h-13z" />
      <rect x="6.2" y="7" width="2.1" height="12" />
      <rect x="15.7" y="7" width="2.1" height="12" />
    </g>
  ),
  shuriken: (
    <path
      fillRule="evenodd"
      d="M12 3l2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Zm0 7.6a1.4 1.4 0 100 2.8 1.4 1.4 0 000-2.8Z"
    />
  ),
  onigiri: (
    <g>
      <path d="M12 5c3 0 7 13 7 13H5s4-13 7-13Z" />
      <rect x="9" y="13.5" width="6" height="4.5" rx="1" fill="#05060a" />
    </g>
  ),
  ramen: <path d="M4 10h16a8 8 0 01-16 0Z" />,
  katana: (
    <g transform="rotate(-45 12 12)">
      <rect x="11" y="3" width="2" height="13" rx="1" />
      <rect x="9.4" y="15.6" width="5.2" height="1.6" />
      <rect x="11" y="17" width="2" height="3" rx="0.6" />
    </g>
  ),
  sakura: (
    <g>
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse
          key={a}
          cx="12"
          cy="6.5"
          rx="2.6"
          ry="4"
          transform={`rotate(${a} 12 12)`}
        />
      ))}
      <circle cx="12" cy="12" r="1.6" fill="#05060a" />
    </g>
  ),
  koi: (
    <path d="M3 12c0-3 4-4.5 8-3 2-2.5 5-3 8-2.5-1 2.5-1 4 0 6.5-3 .5-6 0-8-2.5-4 1.5-8 0-8-3Z" />
  ),
  daruma: <path d="M12 4c4 0 6 4 6 8.5S15.5 20 12 20s-6-3-6-7.5S8 4 12 4Z" />,
  neko: (
    <g>
      <circle cx="12" cy="13" r="5.5" />
      <path d="M6.5 9.5 8 4l3.4 4.2z" />
      <path d="M17.5 9.5 16 4l-3.4 4.2z" />
    </g>
  ),
  crane: <path d="M3 15 12 6l2 5.5L21 8l-6 6.5-3-2-7 4z" />,
  heart: (
    <path d="M12 20C5.5 14.5 4.5 9.8 7.3 7.7c2-1.5 3.9-.4 4.7 1 .8-1.4 2.7-2.5 4.7-1 2.8 2.1 1.8 6.8-4.7 12.3Z" />
  ),
  kamon: (
    <g>
      <path
        fillRule="evenodd"
        d="M12 3a9 9 0 110 18 9 9 0 010-18Zm0 3a6 6 0 100 12 6 6 0 000-12Z"
      />
      <circle cx="12" cy="12" r="2.2" />
    </g>
  ),
  ghost: (
    <g>
      <path d="M6 11c0-5 12-5 12 0v8c-1.6-1.6-2.6.9-3.6-.4-.9 1.3-1.9 1.3-2.8 0-1 1.3-2-1.2-3.6.4Z" />
      <circle cx="9.6" cy="11" r="1.1" fill="#05060a" />
      <circle cx="14.4" cy="11" r="1.1" fill="#05060a" />
    </g>
  ),
};

const KEYS = Object.keys(GLYPHS);

// Dense staggered lattice — tightly packed, odd rows offset half a step.
const STEP = 60; // center-to-center spacing
const G = 42; // rendered glyph size
const COLS = 6;
const ROWS = 6;
const TILE = STEP * COLS;
const SHADES = ["#1a2138", "#212a48", "#2a3358"];

function buildCells() {
  const cells: { key: string; cx: number; cy: number; color: string; rot: number }[] =
    [];
  let i = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cx = c * STEP + (r % 2 ? STEP / 2 : 0);
      const cy = r * STEP;
      const color = i % 13 === 0 ? "#37416e" : SHADES[i % SHADES.length];
      const rot = ((i * 47) % 16) - 8; // subtle per-glyph jitter
      cells.push({ key: KEYS[i % KEYS.length], cx, cy, color, rot });
      i++;
    }
  }
  return cells;
}

const CELLS = buildCells();

export function AnimeGlyphBackdrop({ className }: { className?: string }) {
  const mask =
    "radial-gradient(ellipse 70% 68% at 50% 50%, #000 0%, rgba(0,0,0,0.62) 40%, rgba(0,0,0,0.14) 72%, transparent 100%)";
  return (
    <div
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      aria-hidden="true"
    >
      <svg
        className="h-full w-full"
        width="100%"
        height="100%"
        style={{ WebkitMaskImage: mask, maskImage: mask }}
      >
        <defs>
          {KEYS.map((k) => (
            <symbol key={k} id={`pz-${k}`} viewBox="0 0 24 24">
              {GLYPHS[k]}
            </symbol>
          ))}
          {/* Diagonal lean gives the field manga "speed" energy instead of a flat grid. */}
          <pattern
            id="pezzy-anime-glyphs"
            x="0"
            y="0"
            width={TILE}
            height={TILE}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-22)"
          >
            {CELLS.map((cell, idx) => (
              <use
                key={idx}
                href={`#pz-${cell.key}`}
                x={cell.cx - G / 2}
                y={cell.cy - G / 2}
                width={G}
                height={G}
                transform={`rotate(${cell.rot} ${cell.cx} ${cell.cy})`}
                style={{ color: cell.color }}
              />
            ))}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#pezzy-anime-glyphs)" />
      </svg>
    </div>
  );
}
