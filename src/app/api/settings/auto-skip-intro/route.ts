import { NextResponse } from "next/server";
import { requireActiveProfile } from "@/app/api/_lib/require-active-profile";
import { getAutoSkipIntro, setAutoSkipIntro } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const profile = await requireActiveProfile();
  if (profile instanceof NextResponse) return profile;
  return NextResponse.json({ autoSkipIntro: getAutoSkipIntro(profile.id) });
}

export async function PUT(request: Request) {
  const profile = await requireActiveProfile();
  if (profile instanceof NextResponse) return profile;

  const body = (await request.json()) as { autoSkipIntro?: unknown };
  if (typeof body.autoSkipIntro !== "boolean") {
    return NextResponse.json(
      { error: "autoSkipIntro must be a boolean." },
      { status: 400 }
    );
  }

  setAutoSkipIntro(profile.id, body.autoSkipIntro);
  return NextResponse.json({ autoSkipIntro: body.autoSkipIntro });
}
