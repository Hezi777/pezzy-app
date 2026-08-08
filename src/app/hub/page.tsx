import { Suspense } from "react";
import { redirect } from "next/navigation";
import { recommend } from "@/lib/reco";
import { getFeaturedTitle } from "@/lib/catalog-service";
import { TopNav } from "@/components/ui/top-nav";
import { ContentRow } from "@/components/ui/content-row";
import { PromptRow } from "@/components/ui/prompt-row";
import { AskPezzy } from "@/components/ui/ask-pezzy";
import { Hero } from "@/components/ui/hero";
import { AmbientBackground } from "@/components/ui/ambient-background";
import { HubEntrance } from "@/components/three/hub-entrance";
import { getActiveProfile } from "@/lib/active-profile";

// Rows the skeleton stands in for. The real count is whatever the
// recommendation core returns; this is only how much shell to draw while
// waiting.
const SKELETON_ROWS = 5;

// Awaits the shared recommendation core. Split out from the page so the hub
// shell (nav, hero, ambient bg) can stream immediately behind Suspense
// instead of blocking the whole route on this fetch.
//
// Every row the core returns is rendered. It already dedupes titles across
// rails via a shared `used` set and drops empty rows, so capping the list
// here just threw away the personal rails (Continue watching, My List) that
// come back after the generic ones.
async function RecoRows({ profileId }: { profileId: string }) {
  // No `watchHistory` override: the core reads the profile's real history
  // from the database when the caller does not supply one.
  const rows = await recommend({ profileId, intent: "home" });

  return (
    <>
      {rows.map((row) => (
        <ContentRow key={row.id} row={row} />
      ))}
    </>
  );
}

function RecoRowsSkeleton() {
  return (
    <div className="space-y-8 px-[4vw]" aria-hidden>
      {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
        <div key={i} className="space-y-3">
          <div className="h-5 w-40 rounded bg-white/5" />
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 6 }).map((_, j) => (
              <div
                key={j}
                className="aspect-[2/3] w-40 flex-none rounded-lg bg-white/5 md:w-48"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function HubPage() {
  const [featured, profile] = await Promise.all([
    getFeaturedTitle(),
    getActiveProfile(),
  ]);
  if (!profile) redirect("/");

  return (
    <main className="relative min-h-screen bg-background">
      <AmbientBackground />
      <TopNav
        profileName={profile.name}
        profileAvatar={profile.avatarUrl ?? undefined}
      />

      <HubEntrance>
        <Hero title={featured} />

        <div className="relative z-10 -mt-24 space-y-2 pb-24">
          <Suspense fallback={<RecoRowsSkeleton />}>
            <RecoRows profileId={profile.id} />
          </Suspense>

          {/* Talk to your homepage: always-present prompt to generate a new row */}
          <PromptRow profileId={profile.id} />
        </div>
      </HubEntrance>

      <AskPezzy profileId={profile.id} />
    </main>
  );
}
