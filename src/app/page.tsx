"use client";

import { Plus, User } from "lucide-react";
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ProfileSelector,
  ProfileIcon,
} from "@/components/ui/profile-selector";
import { AnimeGlyphBackdrop } from "@/components/ui/anime-glyph-backdrop";

// Placeholder anime avatars — SFW, attributed art from nekos.best, saved locally
// in /public/avatars. These are community art for the demo only; replace with
// owned or AI-generated anime avatars before production (licensing — see CLAUDE.md).
export default function Home() {
  const router = useRouter();
  const [profiles, setProfiles] = React.useState<
    { id: string; label: string; icon: string | React.ReactNode }[]
  >([
    {
      id: "add",
      label: "Add Profile",
      icon: (
        <ProfileIcon className="bg-white/5">
          <Plus className="h-10 w-10 text-muted-foreground" />
        </ProfileIcon>
      ),
    },
  ]);

  React.useEffect(() => {
    let cancelled = false;

    fetch("/api/profiles")
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load profiles");
        return response.json() as Promise<{
          profiles: { id: string; name: string; avatarUrl: string | null }[];
        }>;
      })
      .then((result) => {
        if (cancelled) return;
        setProfiles([
          ...result.profiles.map((profile) => ({
            id: profile.id,
            label: profile.name,
            icon:
              profile.avatarUrl ?? (
                <ProfileIcon className="bg-white/5">
                  <User className="h-10 w-10 text-muted-foreground" />
                </ProfileIcon>
              ),
          })),
          {
            id: "add",
            label: "Add Profile",
            icon: (
              <ProfileIcon className="bg-white/5">
                <Plus className="h-10 w-10 text-muted-foreground" />
              </ProfileIcon>
            ),
          },
        ]);
      })
      .catch(() => {
        // The add-profile action remains available if local persistence fails.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleProfileSelect = async (id: string) => {
    if (id === "add") {
      router.push("/profile/new");
      return;
    }
    const response = await fetch("/api/profiles/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: id }),
    });
    if (!response.ok) return;
    router.push("/hub");
  };

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-background">
      {/* Signature anime-glyph texture, faded center-out */}
      <AnimeGlyphBackdrop />

      {/* Soft central navy spotlight, above glyphs, below content: a
          brighter steel-navy core over a wider soft falloff, plus a subtle
          edge vignette to keep focus centered. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(32% 30% at 50% 48%, rgba(61,90,254,0.22) 0%, transparent 100%), radial-gradient(60% 58% at 50% 50%, rgba(61,90,254,0.26) 0%, rgba(85,112,255,0.10) 45%, transparent 75%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 50%, transparent 60%, rgba(0,0,0,0.35) 100%)",
        }}
      />

      {/* Content, transparent so the backdrop shows through */}
      <ProfileSelector
        className="relative z-10 bg-transparent"
        profiles={profiles}
        onProfileSelect={handleProfileSelect}
      />
    </main>
  );
}
