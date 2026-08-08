import { notFound } from "next/navigation";
import { getCatalog } from "@/lib/catalog-service";
import { TopNav } from "@/components/ui/top-nav";
import { ContentRow } from "@/components/ui/content-row";
import { TitleDetail } from "@/components/ui/title-detail";
import type { RecoRow } from "@/lib/types";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const catalog = await getCatalog();
  const title = catalog.find((candidate) => candidate.id === id);

  if (!title) {
    notFound();
  }

  const similar = catalog
    .filter(
      (t) => t.id !== title.id && t.genres.some((g) => title.genres.includes(g))
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 10);

  const moreLikeThis: RecoRow = {
    id: "more-like-this",
    label: "More Like This",
    aiGenerated: false,
    titles: similar,
  };

  return (
    <main className="relative min-h-screen bg-background">
      <TopNav />

      <TitleDetail title={title} />

      {similar.length > 0 && (
        <div className="relative z-10 pb-24">
          <ContentRow row={moreLikeThis} />
        </div>
      )}
    </main>
  );
}
