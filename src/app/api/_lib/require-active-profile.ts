import { NextResponse } from "next/server";
import { getActiveProfile } from "@/lib/active-profile";
import type { Profile } from "@/lib/db";

/**
 * Shared 401 gate for routes that need an active profile. Returns the
 * profile, or a ready-to-return 401 response when none is selected.
 */
export async function requireActiveProfile(): Promise<Profile | NextResponse> {
  const profile = await getActiveProfile();
  if (!profile) {
    return NextResponse.json({ error: "Choose a profile first." }, { status: 401 });
  }
  return profile;
}
