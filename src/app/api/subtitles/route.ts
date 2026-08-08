import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { cached } from "@/lib/cache";
import { getCatalogTitle } from "@/lib/catalog-service";
import type { SubtitleResponse } from "@/lib/types";

/**
 * On-demand subtitles / translation (PRD R3). Server boundary so the model
 * key stays server-side, and so generation is cached and rate-limited rather
 * than run on every playback.
 *
 * TODO(llm): the real version transcribes/translates the title's audio track
 * into `language` with an ASR + translation model, persists the resulting cue
 * track (so it is generated once per title+language, not per view), and streams
 * it back. Provider not chosen yet; key from a server-only env var. The
 * cached() wrapper below is the "generate once" guard.
 */

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const titleId = searchParams.get("titleId") ?? "";
  const language = searchParams.get("language") ?? "en";

  const title = await getCatalogTitle(titleId);
  if (!title) {
    return NextResponse.json({ error: "Unknown titleId" }, { status: 404 });
  }

  const { ok } = checkRateLimit(`subs:${titleId}:${language}`, { limit: 10 });
  if (!ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let servedFromCache = true;
  const result = await cached<SubtitleResponse>(
    `subs:${titleId}:${language}`,
    24 * 60 * 60 * 1000,
    async () => {
      servedFromCache = false;
      // TODO(llm): replace with real ASR + translation output.
      return {
        titleId,
        language,
        cues: [
          { start: 0, end: 3, text: `[${title.title}] subtitles in ${language} are generated on demand.` },
        ],
        cached: false,
      };
    }
  );

  return NextResponse.json({ ...result, cached: servedFromCache });
}
