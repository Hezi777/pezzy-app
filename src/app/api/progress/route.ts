import { NextResponse } from "next/server";
import { requireActiveProfile } from "@/app/api/_lib/require-active-profile";
import { getContinueWatching, getTitleProgress, recordWatchProgress } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const profile = await requireActiveProfile();
  if (profile instanceof NextResponse) return profile;

  const titleId = new URL(request.url).searchParams.get("titleId");

  if (titleId) {
    const episodes = getTitleProgress(profile.id, titleId);
    return NextResponse.json({ episodes });
  }

  const items = getContinueWatching(profile.id, 20);
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const profile = await requireActiveProfile();
  if (profile instanceof NextResponse) return profile;

  const body = (await request.json()) as {
    titleId?: unknown;
    seasonNumber?: unknown;
    episodeNumber?: unknown;
    audioLanguage?: unknown;
    positionSeconds?: unknown;
    durationSeconds?: unknown;
    completed?: unknown;
  };

  if (
    typeof body.titleId !== "string" ||
    typeof body.seasonNumber !== "number" ||
    typeof body.episodeNumber !== "number" ||
    (body.audioLanguage !== "sub" && body.audioLanguage !== "dub") ||
    typeof body.positionSeconds !== "number"
  ) {
    return NextResponse.json({ error: "Invalid progress payload." }, { status: 400 });
  }

  recordWatchProgress({
    profileId: profile.id,
    titleId: body.titleId,
    seasonNumber: body.seasonNumber,
    episodeNumber: body.episodeNumber,
    audioLanguage: body.audioLanguage,
    positionSeconds: body.positionSeconds,
    durationSeconds: typeof body.durationSeconds === "number" ? body.durationSeconds : null,
    completed: typeof body.completed === "boolean" ? body.completed : undefined,
  });

  return NextResponse.json({ ok: true });
}
