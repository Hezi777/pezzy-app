import "server-only";

import { cookies } from "next/headers";
import { getProfile, type Profile } from "@/lib/db";

export const ACTIVE_PROFILE_COOKIE = "pezzy-profile";

export async function getActiveProfile(): Promise<Profile | null> {
  const cookieStore = await cookies();
  const profileId = cookieStore.get(ACTIVE_PROFILE_COOKIE)?.value;
  return profileId ? getProfile(profileId) : null;
}
