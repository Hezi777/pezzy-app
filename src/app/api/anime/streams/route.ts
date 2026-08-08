import { NextResponse } from "next/server";
import type { ContentLanguage } from "@/lib/stream-resolver";
import {
  PROVIDER_IDS,
  ProviderResolutionError,
  resolveAnimeStreams,
} from "@/lib/anime";
import { getCatalogTitle } from "@/lib/catalog-service";
import { resolveSeasonEpisode } from "@/app/api/_lib/resolve-season-episode";
import { clientKey } from "@/app/api/_lib/client-key";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // One request fans out to every provider with a 90s budget each, so this is
  // the most expensive unauthenticated route in the app. Cap it.
  const { ok } = checkRateLimit(`anime-streams:${clientKey(request)}`, {
    limit: 20,
    windowMs: 60_000,
  });
  if (!ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = (await request.json()) as {
    titleId?: unknown;
    season?: unknown;
    episode?: unknown;
    language?: unknown;
    provider?: unknown;
  };
  if (typeof body.titleId !== "string") {
    return NextResponse.json({ error: "titleId is required" }, { status: 400 });
  }
  if (!["sub", "dub"].includes(String(body.language))) {
    return NextResponse.json(
      { error: "language must be sub or dub" },
      { status: 400 }
    );
  }
  const provider = body.provider;
  if (provider !== undefined && !PROVIDER_IDS.includes(String(provider))) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  const title = await getCatalogTitle(body.titleId);
  if (!title) {
    return NextResponse.json({ error: "Unknown titleId" }, { status: 404 });
  }

  const resolved = resolveSeasonEpisode(title, body.season, body.episode);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: "A valid season and episode are required" },
      { status: 400 }
    );
  }
  const { season, episode: episodeNumber } = resolved;

  try {
    const streams = await resolveAnimeStreams({
      title,
      season,
      episode: episodeNumber,
      language: body.language as ContentLanguage,
      provider: provider === undefined ? undefined : String(provider),
    });
    return NextResponse.json({
      streams,
      provider: streams[0]?.provider ?? null,
      providers: PROVIDER_IDS,
    });
  } catch (error) {
    if (error instanceof ProviderResolutionError) {
      console.error("Anime stream resolution failed", error.failures);
    } else {
      console.error(
        "Anime stream resolution failed",
        error instanceof Error ? error.message : error
      );
    }
    return NextResponse.json(
      { error: "No anime provider returned a playable stream", providers: PROVIDER_IDS },
      { status: 502 }
    );
  }
}
