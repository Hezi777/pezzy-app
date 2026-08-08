import { TopNav } from "@/components/ui/top-nav";
import { TitleGrid } from "@/components/ui/title-grid";
import { searchCatalog } from "@/lib/catalog-service";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const titles = query ? await searchCatalog(query) : [];

  return (
    <main className="min-h-screen bg-background pt-24 pb-24">
      <TopNav initialQuery={query} />

      <div className="px-[4vw] pb-8">
        <h1 className="text-2xl font-bold text-foreground">
          {query ? `Results for “${query}”` : "Search"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {query
            ? `${titles.length} ${titles.length === 1 ? "title" : "titles"}`
            : "Search the catalog by show, season or genre."}
        </p>
      </div>

      <TitleGrid
        titles={titles}
        emptyMessage={
          query
            ? `Nothing matched “${query}”. Try a different show or genre.`
            : "Type a search above to get started."
        }
      />
    </main>
  );
}
