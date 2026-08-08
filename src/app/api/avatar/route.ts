import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { catalog } from "@/lib/catalog";
import type { AvatarGenRequest } from "@/lib/types";

/**
 * Profile avatars. Two paths:
 *
 * GET  -> a gallery of anime character headshots to pick from (the default,
 *         Netflix-style picker). No AI, no consent needed.
 * POST -> the optional "turn me anime" extra: a selfie -> AI-styled avatar.
 *         This is the server boundary for that feature (PRD R4): the model
 *         call lives here so no provider key reaches the client, and the
 *         biometric constraints are enforced server-side.
 *
 * TODO(llm): no image model is wired up yet. Once one is chosen, call it here
 * with `body.imageDataUrl` + `body.style` (img2img / style transfer), return
 * ONLY the generated result, and wrap the call in cached() so re-generating
 * the same selfie+style doesn't re-bill. Until then this reports honestly
 * that the feature isn't available rather than faking a result.
 *
 * Privacy (CLAUDE.md / PRD R4):
 *  - The source photo is biometric-adjacent. It is held in memory for this
 *    request only and never written to disk or logged.
 *  - Only the generated anime avatar would be retained, once implemented.
 *  - Deletion on request is handled by the profile/settings layer.
 */

// Gallery avatars are cropped-in-the-browser (rounded-full) circles of AniList
// cover art already used elsewhere in the app (catalog posters, banners) under
// the PRD R1 demo caveat, see src/lib/catalog.ts. No new licensing exposure:
// same source, same caveat, just reused as profile icons instead of posters.
const GALLERY_SIZE = 30;

// catalog is a static module-level import, so the gallery is the same for
// every request — compute it once instead of refiltering on each GET.
const GALLERY_AVATARS = catalog
  .filter((title) => Boolean(title.poster))
  .slice(0, GALLERY_SIZE)
  .map((title) => ({
    id: title.id,
    url: title.poster,
    label: title.title,
  }));

export async function GET() {
  return NextResponse.json({ avatars: GALLERY_AVATARS });
}

export async function POST(req: Request) {
  const body = (await req.json()) as AvatarGenRequest;

  if (!body.profileId || !body.imageDataUrl) {
    return NextResponse.json(
      { error: "profileId and imageDataUrl are required" },
      { status: 400 }
    );
  }

  // Consent gate: a face photo cannot be processed without it (PRD R4).
  if (!body.consent) {
    return NextResponse.json(
      { error: "Consent is required to process a face photo." },
      { status: 403 }
    );
  }

  const { ok } = checkRateLimit(`avatar:${body.profileId}`, { limit: 5 });
  if (!ok) {
    return NextResponse.json(
      { error: "Too many avatar generations. Try again in a minute." },
      { status: 429 }
    );
  }

  return NextResponse.json(
    { error: "AI avatar generation is not available yet." },
    { status: 501 }
  );
}
