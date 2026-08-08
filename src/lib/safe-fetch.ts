import "server-only";

import { isIP } from "node:net";
import { isPrivateAddress, screenUrl } from "../../scripts/private-address.mjs";
import { lookup } from "node:dns/promises";
import { lookup as dnsLookup } from "node:dns";
// undici's own `fetch`, not the global one: Node's built-in fetch is backed by
// a bundled copy of undici and rejects a dispatcher from the standalone package
// ("invalid onRequestStart method"). Using both from the same package keeps the
// pinned dispatcher compatible.
import { Agent, fetch as undiciFetch } from "undici";

/**
 * Egress guard for every URL that reaches a server-side fetch.
 *
 * Playback URLs come from a `StreamResolver` and, beyond it, from a remote
 * origin — HLS manifests in particular are just text naming more URLs to
 * fetch. A hostile or compromised source can therefore hand us any URL it
 * likes, and we would fetch it with the source's own headers and stream the
 * body back to the browser. Without this guard that is a read-anything SSRF:
 * cloud metadata (169.254.169.254), other services on the host, or our own API
 * on localhost.
 *
 * A hostname allowlist is not workable here — provider media lives on CDN
 * hosts that change per request — so this blocks by resolved address instead.
 *
 * The address classification itself lives in `scripts/private-address.mjs` so
 * the sandboxed SDK worker can import the exact same implementation.
 */

export { screenUrl } from "../../scripts/private-address.mjs";

export class BlockedUrlError extends Error {
  constructor(url: string, reason: string) {
    super(`Blocked upstream URL (${reason}): ${url.slice(0, 120)}`);
    this.name = "BlockedUrlError";
  }
}

/**
 * Cheap checks that need no DNS. Safe to call on the hot path (every playlist
 * line goes through `registerAnimeResource`).
 */
export function assertPublicUrlSync(url: string): URL {
  const reason = screenUrl(url);
  if (reason) throw new BlockedUrlError(url, reason);
  return new URL(url);
}

/**
 * Full check: resolves the hostname and rejects if *any* answer is private, so
 * a public name pointed at 127.0.0.1 does not slip through.
 */
export async function assertPublicUrl(url: string): Promise<URL> {
  const parsed = assertPublicUrlSync(url);
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return parsed;

  let answers: Array<{ address: string }>;
  try {
    answers = await lookup(host, { all: true });
  } catch {
    throw new BlockedUrlError(url, "hostname did not resolve");
  }
  if (answers.length === 0) throw new BlockedUrlError(url, "hostname did not resolve");
  for (const { address } of answers) {
    if (isPrivateAddress(address)) {
      throw new BlockedUrlError(url, `resolves to private address ${address}`);
    }
  }
  return parsed;
}

/**
 * Validating DNS then calling `fetch` is a check-then-use: the record is free
 * to change between the two calls, and a rebinding attacker only has to win
 * that race once to have us connect to 169.254.169.254 with a hostname that
 * validated clean.
 *
 * This dispatcher closes the window by moving the check *into* the connect
 * step. undici calls `lookup` at the moment it opens the socket, so the address
 * we approve here is necessarily the address the socket uses — there is no
 * second resolution to poison. Every redirect hop gets its own connect, so each
 * is validated the same way.
 */
const pinnedDispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err, "", 0);
        const list = Array.isArray(addresses) ? addresses : [];
        const permitted = list.filter((entry) => !isPrivateAddress(entry.address));
        if (permitted.length === 0) {
          return callback(
            new BlockedUrlError(hostname, "every DNS answer is a private address"),
            "",
            0
          );
        }
        // `all: true` was requested above, so undici accepts the array form.
        callback(null, permitted as never, 0);
      });
    },
  },
});

const MAX_REDIRECTS = 5;

/**
 * `fetch` that re-validates every redirect hop.
 *
 * Following redirects automatically would defeat `assertPublicUrl` entirely: a
 * public provider URL is free to 302 to the metadata endpoint, and the guard
 * would only ever have seen the first hop.
 */
export async function safeFetch(
  url: string,
  init: RequestInit & { headers?: HeadersInit } = {}
): Promise<{ response: Response; finalUrl: string }> {
  let current = (await assertPublicUrl(url)).href;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = (await undiciFetch(current, {
      ...(init as Parameters<typeof undiciFetch>[1]),
      redirect: "manual",
      dispatcher: pinnedDispatcher,
    })) as unknown as Response;
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, current).href;
      current = (await assertPublicUrl(next)).href;
      await response.body?.cancel();
      continue;
    }
    return { response, finalUrl: current };
  }
  throw new BlockedUrlError(url, "too many redirects");
}
