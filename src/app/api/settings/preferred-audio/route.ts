import { NextResponse } from "next/server";
import { requireActiveProfile } from "@/app/api/_lib/require-active-profile";
import { getPreferredAudio, setPreferredAudio, type PreferredAudio } from "@/lib/db";

export const runtime = "nodejs";

const VALID_VALUES = new Set<PreferredAudio>(["ask", "sub", "dub"]);

export async function GET() {
  const profile = await requireActiveProfile();
  if (profile instanceof NextResponse) return profile;
  return NextResponse.json({ preferredAudio: getPreferredAudio(profile.id) });
}

export async function PUT(request: Request) {
  const profile = await requireActiveProfile();
  if (profile instanceof NextResponse) return profile;

  const body = (await request.json()) as { preferredAudio?: unknown };
  if (
    typeof body.preferredAudio !== "string" ||
    !VALID_VALUES.has(body.preferredAudio as PreferredAudio)
  ) {
    return NextResponse.json(
      { error: "preferredAudio must be 'ask', 'sub' or 'dub'." },
      { status: 400 }
    );
  }

  setPreferredAudio(profile.id, body.preferredAudio as PreferredAudio);
  return NextResponse.json({ preferredAudio: body.preferredAudio });
}
