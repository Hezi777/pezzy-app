import { NextResponse } from "next/server";
import { ACTIVE_PROFILE_COOKIE, getActiveProfile } from "@/lib/active-profile";
import { getProfile } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ profile: await getActiveProfile() });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as { profileId?: unknown };
  if (typeof body.profileId !== "string" || !getProfile(body.profileId)) {
    return NextResponse.json({ error: "Unknown profile." }, { status: 404 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACTIVE_PROFILE_COOKIE, body.profileId, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return response;
}
