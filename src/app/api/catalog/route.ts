import { NextResponse } from "next/server";
import { getCatalogTitle, toListTitle } from "@/lib/catalog-service";

const MAX_IDS = 100;

export async function GET(req: Request) {
  const requestedIds = new URL(req.url).searchParams
    .get("ids")
    ?.split(",")
    .filter(Boolean) ?? [];

  if (
    requestedIds.length > MAX_IDS ||
    requestedIds.some((id) => !/^[1-9]\d*$/.test(id))
  ) {
    return NextResponse.json(
      { error: `ids must contain at most ${MAX_IDS} numeric AniList IDs` },
      { status: 400 }
    );
  }

  if (requestedIds.length === 0) {
    return NextResponse.json([]);
  }

  const titles = await Promise.all(requestedIds.map(getCatalogTitle));
  return NextResponse.json(titles.filter((title) => !!title).map(toListTitle));
}
