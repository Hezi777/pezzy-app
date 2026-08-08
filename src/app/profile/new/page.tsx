"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AvatarStudio } from "@/components/ui/avatar-studio";

export default function NewProfilePage() {
  const router = useRouter();

  return (
    <main className="relative flex min-h-screen w-full flex-col items-center justify-center gap-8 bg-background px-4">
      <Link
        href="/"
        className="absolute left-6 top-6 flex items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ChevronLeft className="h-4 w-4" />
        Back
      </Link>

      <h1 className="text-2xl font-semibold text-foreground">Create your profile</h1>

      <AvatarStudio
        profileId="new"
        showNameField
        onComplete={async (avatarUrl, name) => {
          const response = await fetch("/api/profiles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ avatarUrl, name }),
          });
          if (!response.ok) return;
          router.push("/");
        }}
      />
    </main>
  );
}
