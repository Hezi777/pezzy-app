# Security model

Pezzy's core assumption: **the media source is hostile.**

Not "might be compromised someday" — hostile by default, in the threat model,
regardless of which `StreamResolver` is plugged in. Everything in this document
follows from that one decision.

---

## Why a media source is untrusted input

It's tempting to think of a video URL as inert data. It isn't.

An **HLS manifest is a program** in the sense that matters: it is text, fetched
from a remote origin, that names more URLs for your server to fetch — segments,
encryption keys, audio renditions, subtitle playlists, and further nested
manifests. If you proxy HLS, you have built a general-purpose "fetch what this
text tells you to fetch" engine, and the remote origin writes the text.

That is an SSRF primitive pointed at your own infrastructure. On a cloud host,
the highest-value target is one hop away:

```
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000
http://169.254.169.254/latest/meta-data/iam/security-credentials/
```

Without a guard, the server fetches that with the origin's own headers and
streams the response back to the browser. Same technique reaches `localhost`
services, private subnets, and the app's own internal API routes.

The other half: a resolver's output — URLs, headers, subtitle labels, quality
strings — is remote data structured as a payload. Treating it as trusted because
it arrived through a typed interface is a category error.

---

## Controls

### 1. Nothing upstream reaches the browser

`registerAnimeResource` mints an opaque, short-lived token per resource
(30-minute TTL). The client receives `/api/anime/proxy?token=…` and never sees
the origin URL, its headers, or its tokens. For HLS, `rewriteHlsPlaylist` walks
the manifest and rewrites every URI — bare segment lines *and* quoted `URI="…"`
attributes on `EXT-X-KEY`, `EXT-X-MEDIA`, and `EXT-X-I-FRAME-STREAM-INF` — so
nested playlists resolve back through the same boundary rather than escaping it.

→ [`src/lib/anime-proxy.ts`](../src/lib/anime-proxy.ts)

### 2. Egress is filtered by resolved address

A hostname allowlist doesn't work here — media lives on CDN hosts that vary per
request — so `safe-fetch.ts` filters by *address*:

- **Scheme screen.** `http:`/`https:` only. Stops `file:`, `data:`, `javascript:`.
- **Address classification.** Loopback, RFC1918, CGNAT, link-local
  (`169.254/16`), unique-local, and multicast are refused.
- **IPv6 done properly.** Textual prefix matching is not enough:
  `http://[::ffff:169.254.169.254]` is normalized by `new URL()` to
  `[::ffff:a9fe:a9fe]`, which matches none of the obvious prefixes. The guard
  expands every address to its 16 bytes and unwraps each IPv6 form that embeds
  IPv4 — v4-mapped, v4-compatible, 6to4, NAT64 — before classifying.
- **Redirects re-validated per hop.** `fetch` follows redirects by default,
  which would mean only the first URL was ever checked. A public URL is free to
  302 into private space. `safeFetch` follows manually and re-screens each hop.
- **Socket pinned to the verified address.** Checking DNS and then calling
  `fetch` is check-then-use: the record can change in between, and a rebinding
  attacker only has to win that race once. The check runs *inside* the connect
  step via an undici `Agent` with a custom `lookup`, so the address approved is
  necessarily the address the socket uses.

→ [`src/lib/safe-fetch.ts`](../src/lib/safe-fetch.ts) ·
[`scripts/private-address.mjs`](../scripts/private-address.mjs)

### 3. The proxy can't become an XSS vector

The proxy serves bytes from a third party on *our* origin. Echoing the upstream
`Content-Type` would mean an origin answering `text/html` gets script execution
on the app's domain. Responses are clamped to a media-type allowlist and sent
with `X-Content-Type-Options: nosniff` and
`Content-Security-Policy: default-src 'none'; sandbox`.

### 4. Headers are sanitized before replay

Header values may be remote data, and they get replayed on outbound requests and
passed to ffmpeg as `-headers` lines. A CR or LF in a value is request-header
injection; an invalid name makes `new Headers()` throw mid-request.
`sanitizeUpstreamHeaders` drops both. ffmpeg additionally gets an explicit
`-protocol_whitelist`, because its protocol handlers accept far more than HTTP.

### 5. Resource limits are structural

Unbounded input from a remote origin is a denial-of-service primitive, so the
boundary caps subtitle tracks, quality variants, and redirect depth, and
rate-limits both `/api/anime/streams` (fan-out is expensive) and
`/api/anime/proxy` (unauthenticated egress).

### 6. One malformed field doesn't kill playback

Resource registration is per-item and failures are skipped, not thrown. A source
serving one bad subtitle URL alongside a good video shouldn't be able to deny
the whole episode — that hands the source a trivial availability lever.

---

## Integrating an untrusted dependency

If you plug in a resolver that wraps a large third-party library — especially
one that parses HTML or JSON from sites you don't control — the guards above
cover egress but not the parser itself. The pattern that does:

1. **Run it in a separate process**, not in the app's. Node's permission model
   (`--permission`) denies capabilities by omission: without
   `--allow-child-process` a shell-out is impossible; without `--allow-fs-write`
   it cannot touch the database; a scoped `--allow-fs-read` keeps it away from
   `.env`. Pass only what it genuinely needs, which is usually network alone.
2. **Pass plain JSON across the boundary**, rebuilt field by field. Don't ship
   the library's objects into the app — prototypes, getters, and cyclic
   references shouldn't cross.
3. **Wrap its HTTP client**, not just your own calls. A scraper dereferences
   URLs *internally*; guarding only the URLs it returns leaves its own fetches
   unprotected. Wrapping the transport puts every request behind one check
   instead of requiring you to enumerate call sites.
4. **Cap response size and neuter backoff hints.** Libraries that feed a remote
   `Retry-After` straight into a sleep can be parked for weeks by one header.
5. **Read the dependency's source before trusting it.** Grep for `eval`,
   `new Function`, `child_process`, `execSync`, and command strings built by
   template literal. Shell quoting via `JSON.stringify` is a specific trap: it
   produces *double* quotes, which do not stop `$(…)`, backticks, or `${…}`.

Two practical notes learned the hard way: `--allow-fs-read=a,b` is **not** split
on commas — pass one flag per path — and the permission model compares paths as
exact strings, so on a case-insensitive filesystem `process.cwd()` may not match
what the module loader resolves. Use `realpathSync`.

---

## Known gaps

Stated plainly, because a security document that only lists wins is marketing.

- **No authentication.** Every route is unauthenticated. This is a local
  prototype; the persistence layer is a local SQLite file.
- **Rate limiting is in-memory and per-process**, keyed on a client-controlled
  `x-forwarded-for`. It raises the cost of abuse; it does not prevent it. Real
  enforcement belongs at the edge.
- **Proxy tokens are bearer tokens.** Unguessable (`randomUUID`) and short-lived,
  but anyone holding one can pull the resource for its TTL.
- **No test suite.** The guards were verified by hand against known bypass
  classes. That verification should be automated and isn't.
- **No CSRF protection** on state-changing routes, and no signed sessions.

None of these are hard to fix; all of them are unfixed. Treat this as a
demonstration of the boundary design, not as production-hardened code.
