"use client";

import { useEffect, useState } from "react";
import { TopNav } from "@/components/ui/top-nav";
import { TitleGrid } from "@/components/ui/title-grid";
import { getCatalogTitles } from "@/lib/api";
import { useMyList } from "@/lib/my-list";
import type { Title } from "@/lib/types";

export default function MyListPage() {
  const { ids } = useMyList();
  const idsKey = ids.join(",");
  const [result, setResult] = useState<{
    idsKey: string;
    titles: Title[];
    failed: boolean;
  }>({
    idsKey: "",
    titles: [],
    failed: false,
  });

  useEffect(() => {
    let active = true;

    if (ids.length === 0) return;

    getCatalogTitles(ids)
      .then((nextTitles) => {
        if (active) setResult({ idsKey, titles: nextTitles, failed: false });
      })
      .catch(() => {
        if (active) setResult({ idsKey, titles: [], failed: true });
      });

    return () => {
      active = false;
    };
  }, [ids, idsKey]);

  const loading = ids.length > 0 && result.idsKey !== idsKey;
  const titles = ids.length === 0 || loading ? [] : result.titles;

  return (
    <main className="min-h-screen bg-background pt-24 pb-24">
      <TopNav />

      <div className="px-[4vw] pb-8">
        <h1 className="text-2xl font-bold text-foreground">My List</h1>
      </div>

      <TitleGrid
        titles={titles}
        emptyMessage={
          loading
            ? "Loading your list…"
            : result.failed
              ? "Couldn’t load your list. Refresh to try again."
              : "Your list is empty. Tap the bookmark on any title to save it here."
        }
      />
    </main>
  );
}
