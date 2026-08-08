import { TopNav } from "@/components/ui/top-nav";
import { TitleGrid } from "@/components/ui/title-grid";
import { getTitlesByFormat } from "@/lib/catalog-service";

export default async function MoviesPage() {
  const titles = await getTitlesByFormat("movie");

  return (
    <main className="min-h-screen bg-background pt-24 pb-24">
      <TopNav />

      <div className="px-[4vw] pb-8">
        <h1 className="text-2xl font-bold text-foreground">Movies</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Standalone films from the catalog.
        </p>
      </div>

      <TitleGrid titles={titles} />
    </main>
  );
}
