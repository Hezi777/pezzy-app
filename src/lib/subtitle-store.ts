import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * On-disk store for generated subtitle tracks.
 *
 * Transcription is free but slow (a couple of minutes per episode), so a track
 * must be generated once and reused forever — PRD R3's "no generate-on-every-
 * load" rule applies just as much to CPU time as to API spend. The in-memory
 * `cached()` helper isn't enough here: it dies with the process, and losing a
 * finished track means paying the whole transcription again.
 *
 * This is deliberately a local directory, not a storage decision. Object
 * storage for generated artifacts is an open founder call (PRD "Stack gaps"),
 * so this keeps the same shape — a keyed get/put — that a bucket would.
 */

const STORE_DIRECTORY = join(process.cwd(), ".pezzy", "subtitles");

function fileFor(key: string): string {
  // Keys contain ids and colons; hash so they're always valid filenames.
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return join(STORE_DIRECTORY, `${digest}.vtt`);
}

export async function getGeneratedTrack(key: string): Promise<string | null> {
  try {
    return await readFile(fileFor(key), "utf8");
  } catch {
    return null;
  }
}

export async function putGeneratedTrack(key: string, vtt: string): Promise<void> {
  await mkdir(STORE_DIRECTORY, { recursive: true });
  await writeFile(fileFor(key), vtt, "utf8");
}
