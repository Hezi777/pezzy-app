import { NextResponse } from "next/server";
import { requireActiveProfile } from "@/app/api/_lib/require-active-profile";
import { getAlwaysGenerateSubtitles, setAlwaysGenerateSubtitles } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const profile = await requireActiveProfile();
  if (profile instanceof NextResponse) return profile;
  return NextResponse.json({
    alwaysGenerateSubtitles: getAlwaysGenerateSubtitles(profile.id),
  });
}

export async function PUT(request: Request) {
  const profile = await requireActiveProfile();
  if (profile instanceof NextResponse) return profile;

  const body = (await request.json()) as { alwaysGenerateSubtitles?: unknown };
  if (typeof body.alwaysGenerateSubtitles !== "boolean") {
    return NextResponse.json(
      { error: "alwaysGenerateSubtitles must be a boolean." },
      { status: 400 }
    );
  }

  setAlwaysGenerateSubtitles(profile.id, body.alwaysGenerateSubtitles);
  return NextResponse.json({ alwaysGenerateSubtitles: body.alwaysGenerateSubtitles });
}
