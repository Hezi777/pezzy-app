import "server-only";

import { randomUUID } from "node:crypto";
import type { StreamQuality } from "@/lib/stream-resolver";
import { assertPublicUrlSync } from "@/lib/safe-fetch";

const RESOURCE_TTL_MS = 30 * 60 * 1000;

/**
 * "subtitle" resources are re-served as `text/vtt`. Providers hand back
 * subtitle files as `application/octet-stream` (or SRT), which browsers refuse
 * to attach to a <track>.
 */
export type AnimeResourceKind = "media" | "subtitle";

interface RegisteredResource {
  url: string;
  headers: Record<string, string>;
  kind: AnimeResourceKind;
  expiresAt: number;
}

const resources = new Map<string, RegisteredResource>();

function pruneExpiredResources(now = Date.now()): void {
  for (const [token, resource] of resources) {
    if (resource.expiresAt <= now) resources.delete(token);
  }
}

export function registerAnimeResource(
  url: string,
  headers: Record<string, string> = {},
  kind: AnimeResourceKind = "media"
): string {
  // These URLs are scraped from provider pages, so they are untrusted input to
  // a server-side fetch. Cheap checks here; `/api/anime/proxy` re-checks with
  // DNS resolution before it actually issues the request.
  const parsed = assertPublicUrlSync(url);

  pruneExpiredResources();
  const token = randomUUID();
  resources.set(token, {
    url: parsed.href,
    headers,
    kind,
    expiresAt: Date.now() + RESOURCE_TTL_MS,
  });
  return `/api/anime/proxy?token=${encodeURIComponent(token)}`;
}

/**
 * Convert SubRip to WebVTT when a provider serves SRT. Comma decimal
 * separators and the missing WEBVTT header are the only differences that
 * matter for playback.
 */
export function toWebVtt(body: string): string {
  const text = body.replace(/^﻿/, "").trim();
  if (text.startsWith("WEBVTT")) return text;
  return `WEBVTT\n\n${text.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    "$1.$2"
  )}`;
}

export function getAnimeResource(token: string): RegisteredResource | undefined {
  const resource = resources.get(token);
  if (!resource) return undefined;
  if (resource.expiresAt <= Date.now()) {
    resources.delete(token);
    return undefined;
  }
  return resource;
}

export interface HlsVariant {
  url: string;
  quality: StreamQuality;
}

const RESOLUTION_HEIGHTS: Array<{ height: number; quality: StreamQuality }> = [
  { height: 1080, quality: "1080p" },
  { height: 720, quality: "720p" },
  { height: 480, quality: "480p" },
  { height: 360, quality: "360p" },
];
const NAMED_QUALITIES = RESOLUTION_HEIGHTS.map((entry) => entry.quality);

function qualityForHeight(height: number): StreamQuality {
  return RESOLUTION_HEIGHTS.reduce((closest, candidate) =>
    Math.abs(candidate.height - height) < Math.abs(closest.height - height)
      ? candidate
      : closest
  ).quality;
}

/**
 * Parse a master playlist's `#EXT-X-STREAM-INF` variants into real quality
 * options. Providers report a single placeholder `quality` on the resolved
 * payload (usually `'auto'`); the actual renditions, if there is more than
 * one, live inside the master manifest. Returns an empty array when the
 * playlist only has one rendition or isn't a master playlist at all, so the
 * caller can fall back to the single payload-level stream rather than
 * fabricating quality choices that all point at the same media.
 */
export function parseHlsVariants(playlist: string, baseUrl: string): HlsVariant[] {
  const lines = playlist.split("\n").map((line) => line.trim());
  const variants: HlsVariant[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
    const uri = lines[i + 1];
    if (!uri || uri.startsWith("#")) continue;

    const nameMatch = line.match(/NAME="([^"]+)"/i);
    const resolutionMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
    const namedQuality = nameMatch?.[1] as StreamQuality | undefined;
    const quality =
      namedQuality && NAMED_QUALITIES.includes(namedQuality)
        ? namedQuality
        : resolutionMatch
          ? qualityForHeight(Number(resolutionMatch[1]))
          : "auto";

    variants.push({ url: new URL(uri, baseUrl).href, quality });
  }
  return variants;
}

export function rewriteHlsPlaylist(
  playlist: string,
  playlistUrl: string,
  headers: Record<string, string>
): string {
  const register = (value: string) =>
    registerAnimeResource(new URL(value, playlistUrl).href, headers);

  return playlist
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) return register(trimmed);
      return line.replace(/URI=(["'])(.*?)\1/g, (_match, quote, uri) => {
        return `URI=${quote}${register(uri)}${quote}`;
      });
    })
    .join("\n");
}
