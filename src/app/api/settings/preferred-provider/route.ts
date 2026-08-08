import { NextResponse } from "next/server";
import { requireActiveProfile } from "@/app/api/_lib/require-active-profile";
import { getPreferredProvider, setPreferredProvider } from "@/lib/db";

export const runtime = "nodejs";

// Data-only for now: no settings UI. The player (src/lib/anime.ts) reads and
// writes this once multi-provider stream selection lands, so the player can
// remember which provider worked last time instead of asking again.
export async function GET() {
  const profile = await requireActiveProfile();
  if (profile instanceof NextResponse) return profile;
  return NextResponse.json({ preferredProvider: getPreferredProvider(profile.id) });
}

export async function PUT(request: Request) {
  const profile = await requireActiveProfile();
  if (profile instanceof NextResponse) return profile;

  const body = (await request.json()) as { preferredProvider?: unknown };
  if (body.preferredProvider !== null && typeof body.preferredProvider !== "string") {
    return NextResponse.json(
      { error: "preferredProvider must be a string or null." },
      { status: 400 }
    );
  }

  setPreferredProvider(profile.id, body.preferredProvider);
  return NextResponse.json({ preferredProvider: body.preferredProvider });
}
