import { NextResponse } from "next/server";
import { cached } from "@/lib/cache";
import { fetchSkipTimes } from "@/lib/aniskip";

export const runtime = "nodejs";

// AniSkip data doesn't change with the caller's episode length (that param
// only tunes upstream tolerance), so the cache key omits it — that lets an
// early call with an unknown duration (0) and a later one with the real
// duration share the same cached result.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const malId = searchParams.get("malId");
  const episode = Number(searchParams.get("episode"));
  const episodeLength = Number(searchParams.get("episodeLength") ?? "0");

  if (!malId || !Number.isInteger(episode) || episode < 1) {
    return NextResponse.json(
      { error: "malId and episode are required" },
      { status: 400 }
    );
  }

  const result = await cached(
    `skip-times:${malId}:${episode}`,
    24 * 60 * 60 * 1000,
    () => fetchSkipTimes(malId, episode, Number.isFinite(episodeLength) ? episodeLength : 0)
  );
  return NextResponse.json(result);
}
