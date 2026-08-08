import { getAnimeResource, rewriteHlsPlaylist, toWebVtt } from "@/lib/anime-proxy";
import { BlockedUrlError, safeFetch } from "@/lib/safe-fetch";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientKey } from "@/app/api/_lib/client-key";

export const runtime = "nodejs";

/**
 * Applied to every proxied response. `nosniff` stops content-type upgrades,
 * the CSP neuters anything that still manages to be interpreted as a document,
 * and `sandbox` denies it script/same-origin capability outright.
 */
const HARDENED_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};

/** Media content types we are willing to re-serve. Anything else is bytes. */
const ALLOWED_MEDIA_TYPES = [
  "video/",
  "audio/",
  "image/",
  "application/octet-stream",
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "application/dash+xml",
  "application/mp4",
];

function safeMediaContentType(upstream: Response): string {
  const raw = (upstream.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  return ALLOWED_MEDIA_TYPES.some((allowed) =>
    allowed.endsWith("/") ? raw.startsWith(allowed) : raw === allowed
  )
    ? raw
    : "application/octet-stream";
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return new Response("Missing token", { status: 400 });

  // Unauthenticated egress: without a cap this route is an open bandwidth relay
  // for anyone holding a token. Generous, because one episode is hundreds of
  // segment requests.
  const { ok } = checkRateLimit(`anime-proxy:${clientKey(request)}`, {
    limit: 600,
    windowMs: 60_000,
  });
  if (!ok) return new Response("Too many requests", { status: 429 });

  const resource = getAnimeResource(token);
  if (!resource) return new Response("Unknown or expired token", { status: 404 });

  let upstream: Response;
  let upstreamUrl: string;
  try {
    // Inside the try: `new Headers()` throws on a malformed name or value, and
    // provider headers are scraped. Outside, that throw is an unhandled 500.
    const headers = new Headers(resource.headers);
    const range = request.headers.get("range");
    if (range) headers.set("Range", range);

    const result = await safeFetch(resource.url, {
      headers,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    upstream = result.response;
    upstreamUrl = result.finalUrl;
  } catch (error) {
    if (error instanceof BlockedUrlError) {
      console.error("Blocked anime proxy target", error.message);
      return new Response("Upstream media request blocked", { status: 502 });
    }
    return new Response("Upstream media request failed", { status: 502 });
  }
  if (!upstream.ok && upstream.status !== 206) {
    return new Response("Upstream media request failed", {
      status: upstream.status,
    });
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  const isPlaylist =
    contentType.includes("mpegurl") ||
    new URL(upstreamUrl).pathname.toLowerCase().endsWith(".m3u8");
  if (isPlaylist) {
    const playlist = rewriteHlsPlaylist(
      await upstream.text(),
      upstreamUrl,
      resource.headers
    );
    return new Response(playlist, {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-store",
        ...HARDENED_HEADERS,
      },
    });
  }

  if (resource.kind === "subtitle") {
    return new Response(toWebVtt(await upstream.text()), {
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Cache-Control": "no-store",
        ...HARDENED_HEADERS,
      },
    });
  }

  const responseHeaders = new Headers();
  for (const name of ["accept-ranges", "content-length", "content-range"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  // Never echo the upstream content-type. This response is served from our own
  // origin, so a provider answering `text/html` with a <script> in it would be
  // stored XSS on pezzy for anyone who opens a proxy URL directly. Media types
  // only, and `nosniff` so the browser cannot upgrade it back to HTML.
  responseHeaders.set("Content-Type", safeMediaContentType(upstream));
  responseHeaders.set("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(HARDENED_HEADERS)) {
    responseHeaders.set(name, value);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
