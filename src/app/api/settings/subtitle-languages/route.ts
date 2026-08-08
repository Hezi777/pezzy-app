import { NextResponse } from "next/server";
import { requireActiveProfile } from "@/app/api/_lib/require-active-profile";
import {
  getPreferredSubtitleLanguages,
  setPreferredSubtitleLanguages,
} from "@/lib/db";
import { SUBTITLE_LANGUAGES } from "@/lib/subtitle-languages";

export const runtime = "nodejs";

export async function GET() {
  const profile = await requireActiveProfile();
  if (profile instanceof NextResponse) return profile;
  return NextResponse.json({
    languages: getPreferredSubtitleLanguages(profile.id),
  });
}

export async function PUT(request: Request) {
  const profile = await requireActiveProfile();
  if (profile instanceof NextResponse) return profile;

  const body = (await request.json()) as { languages?: unknown };
  const supported = new Set<string>(SUBTITLE_LANGUAGES.map(({ code }) => code));
  const languages = Array.isArray(body.languages)
    ? body.languages.filter((code): code is string => typeof code === "string")
    : [];
  if (
    languages.length !== supported.size ||
    new Set(languages).size !== supported.size ||
    languages.some((code) => !supported.has(code))
  ) {
    return NextResponse.json(
      { error: "Include every supported language exactly once." },
      { status: 400 }
    );
  }

  setPreferredSubtitleLanguages(profile.id, languages);
  return NextResponse.json({ languages });
}
