import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createProfile, listProfiles } from "@/lib/db";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ profiles: listProfiles() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    name?: unknown;
    avatarUrl?: unknown;
  };
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (name.length < 1 || name.length > 40) {
    return NextResponse.json(
      { error: "Profile name must be between 1 and 40 characters." },
      { status: 400 }
    );
  }
  // Accepts a local asset path, an AniList gallery URL, or an uploaded
  // photo's data URL (see AvatarStudio's gallery / upload / AI tabs).
  if (
    body.avatarUrl !== undefined &&
    (typeof body.avatarUrl !== "string" ||
      !(
        body.avatarUrl.startsWith("/avatars/") ||
        body.avatarUrl.startsWith("https://") ||
        body.avatarUrl.startsWith("data:image/")
      ))
  ) {
    return NextResponse.json({ error: "Invalid avatar URL." }, { status: 400 });
  }

  const profile = createProfile({
    id: randomUUID(),
    name,
    avatarUrl: body.avatarUrl,
  });

  return NextResponse.json({ profile }, { status: 201 });
}
