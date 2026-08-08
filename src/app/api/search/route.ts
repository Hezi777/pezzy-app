import { NextResponse } from "next/server";
import { searchCatalog } from "@/lib/catalog-service";

const MAX_LIMIT = 20;

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const query = params.get("q")?.trim() ?? "";

  if (!query) {
    return NextResponse.json([]);
  }

  const limit = Math.min(
    Math.max(1, Number(params.get("limit")) || MAX_LIMIT),
    MAX_LIMIT
  );

  return NextResponse.json(await searchCatalog(query, limit));
}
