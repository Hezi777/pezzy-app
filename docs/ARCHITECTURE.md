# Pezzy — Architecture & Ownership

> System layers, who owns what, and the boundary where the two halves meet.
> Product rationale lives in [PRD.md](PRD.md); this doc is the *how* and the *who*.
> **Owners:** Hen ([@Hezi777](https://github.com/Hezi777)) · Perry ([@perrys21](https://github.com/perrys21)) · **Updated:** 2026-07-27

---

## Ownership model

The split is **AI vs. everything else** — not frontend vs. backend.

- **Hen — full-stack (frontend + non-AI backend).** All UI/UX, the catalog, the persistence layer (DB, ORM, migrations), auth + sessions + per-profile scoping, data storage (ratings, watch history, My List, settings), video (storage, streaming, player), object storage, and the **server boundary** the AI runs behind (route handlers, `cached()`, rate-limiting, request/response contracts). Hen owns the plumbing that AI drops into.
- **Perry — AI integrations.** Everything behind the boundary that calls a model: LLM (rec-core ranking + reason copy, chatbot, conversational rows), image model (avatars), ASR + translation (subtitles). Perry designs prompts, picks providers, and fills the `TODO(llm)` seams. Perry's architecture is his to define in **[AI-ARCHITECTURE.md](AI-ARCHITECTURE.md)**.

Rule of thumb: **if a line of code calls a model or shapes a prompt, it's Perry's. Everything around it is Hen's.**

## Ownership map

| Layer / concern | Owner | State today |
|---|---|---|
| UI / UX (all pages, components, Three.js) | **Hen** | Built (prototype) |
| Catalog data + AniList sourcing | **Hen** | Built (generated snapshot, `npm run catalog`) |
| Catalog search | **Hen** | Built (`/search`, in-memory ranking) |
| Local persistence + migrations | **Hen** | SQLite foundation built |
| Auth + sessions | **Hen** | Not built — local active-profile cookie only |
| Profiles / watch progress / My List / settings storage | **Hen** | Schema built; profiles wired |
| Video playback + provider resolution | **Hen** | Built (prototype) |
| Video player UI (controls, captions, quality) | **Hen** | Built (custom player) |
| Production video: licensed storage, transcoding, CDN, DRM | **Hen** | Not built |
| Object storage (avatars, subtitle tracks) | **Hen** | Not built |
| Server boundary: routes, `cached()`, rate-limit, schemas | **Hen** | Built (stub calls) |
| Rec-core pipeline (candidate selection, row assembly) | **Hen** | Built (rule-based) |
| Rec-core ranking / reason copy (LLM) | **Perry** | Stub — `TODO(llm)` in `src/lib/reco/index.ts` |
| Chatbot (LLM) | **Perry** | Stub — `src/app/api/chat/route.ts` |
| Conversational rows (LLM) | **Perry** | Stub — routes through rec core |
| Subtitles + translation (ASR + MT) | **Perry** | Stub — `src/app/api/subtitles/route.ts` |
| Avatar generation (image model) | **Perry** | Stub — `src/app/api/avatar/route.ts` |
| AI providers, prompts, eval, model cost/quality | **Perry** | Not chosen |

Founder-level *product* decisions behind the "not built" rows (which DB, which auth, which video stack) are tracked in [PRD → Stack gaps](PRD.md#stack-gaps).

## System layers

```
┌──────────────────────────────────────────────┐
│  Client (Next.js App Router, React 19)         │  ← Hen
│  pages · components · Three.js · client fetch  │
└───────────────────────┬──────────────────────┘
                        │  HTTP (JSON)
┌───────────────────────▼──────────────────────┐
│  Server boundary  (Route Handlers /api/*)      │  ← Hen
│  validation · cached() · checkRateLimit()      │
│  request/response contracts (src/lib/types)    │
└─────────┬───────────────────────────┬────────┘
          │                           │
┌─────────▼─────────┐      ┌──────────▼─────────────┐
│  Data layer        │      │  AI layer               │  ← Perry
│  DB · ORM · catalog│      │  LLM · image · ASR/MT   │
│  (Hen)             │      │  prompts · providers    │
└────────────────────┘      └─────────────────────────┘
          │
┌─────────▼──────────┐
│  Playback layer      │  ← Hen
│  StreamResolver(s)   │
│  + tokenized proxy   │
└─────────────────────┘
```

The **AI layer sits behind the server boundary** — never called from the client, no provider keys in client code (PRD R3, CLAUDE.md security rule).

## Non-AI architecture (Hen)

Current state and the direction for each layer Hen owns. Nothing below is scaffolded until the stack decision it depends on is made (CLAUDE.md rule — no premature scaffolding).

- **Catalog.** `scripts/build-catalog.mjs` pulls AniList's most popular anime, clusters PREQUEL/SEQUEL chains into franchises, and writes `src/lib/catalog.data.json` (~750 titles). Each season keeps its **own AniList `mediaId`** — that is what playback maps to a provider. The script deliberately rejects AniList's `streamingEpisodes` for sequels: it is scraped per franchise, so a season-2 record carries season 1's episode list verbatim. Seasons it can't verify get numbered placeholders, then **Kitsu** (keyless, and the one source that models episodes per season) fills real per-episode titles and stills. **TMDB** supplies each franchise's title logo under `--logos`; its key is read at generation time only, so no runtime dependency and nothing reaches the client. Nothing calls AniList at request time — enriching a catalogue this size live would blow the 30 req/min public limit on every cache miss.
- **Persistence.** The local prototype uses Node 24's built-in SQLite driver at `.pezzy/pezzy.db`. Idempotent migrations create per-profile settings, My List, watch progress/history, and subtitle metadata tables. Profile creation and active-profile selection are wired; My List/settings/progress still need route and UI integration. Remote persistence and auth remain separate production decisions.
- **Auth & sessions.** Today: none; profile select is cosmetic. Target: auth provider + session model, with every data read/write scoped to the signed-in profile.
- **Server boundary.** Built and stable: AI routes under `src/app/api/{recommend,chat,avatar,subtitles}` plus catalog and playback routes under `src/app/api/{catalog,anime}`. AI generation is wrapped in `cached()` (`src/lib/cache.ts`) + `checkRateLimit()` (`src/lib/rate-limit.ts`). This is the contract surface Perry plugs into — keeping it stable is Hen's job.
- **Video playback.** A selected season resolves through the `StreamResolver` boundary (`src/lib/stream-resolver.ts`), with configured resolvers raced in `src/lib/anime.ts`. The browser receives only Pezzy URLs: upstream video, HLS playlists, segments, keys, and subtitle tracks pass through short-lived opaque tokens managed by `src/lib/anime-proxy.ts` and `/api/anime/proxy`. `src/components/ui/video-player.tsx` is a custom player over `hls.js` — its own scrubber, volume, subtitle and quality menus, PiP, fullscreen and keyboard shortcuts — handling HLS/MP4, sub/dub selection, and WebVTT tracks. Subtitle resources are registered with the stream's own headers and re-served as `text/vtt`; without both, subtitle hosts return 403 and the browser refuses the track. Resolver output is untrusted input — see [SECURITY.md](SECURITY.md).
- **Production video.** Licensed media ownership, durable proxy/session state, storage, transcoding, CDN, observability, and DRM are not built. The current third-party resolver is a development prototype, not the production content strategy, and remains gated on licensing (PRD R1).
- **Object storage.** For Perry's generated artifacts (avatars, subtitle tracks). Hen provides the bucket + retention/deletion policy; face-photo retention rules apply (PRD R4). Perry writes to it through an interface Hen exposes.

## The AI boundary (open)

**This is the one thing Hen and Perry must decide together before AI work is real.** The prototype pretends the seam is a local function call inside each route; the real shape is undecided. Open questions for the joint session:

1. **Shape** — does Perry ship a **library** (Hen imports and calls in-process) or a **separate service** (Hen calls over HTTP/queue)?
2. **Contract ownership** — who owns the request/response schema and the prompts? Proposal: Hen owns the schema in `src/lib/types.ts` (so cache keys stay stable); Perry owns prompt contents behind it.
3. **Caching & cost** — does Hen's `cached()` / `checkRateLimit()` wrap Perry's call from the outside (Perry stays stateless), or does Perry cache internally too? (PRD R3: no generate-on-every-load.)
4. **Data access** — how does Perry read watch history / embeddings? Through a context object Hen passes in, or direct DB/vector-store reads?
5. **Failure modes** — timeouts, fallbacks to the rule-based path, partial results.

Until these are answered, the ownership map's Perry rows are **provisional**. Perry drafts his side in [AI-ARCHITECTURE.md](AI-ARCHITECTURE.md); this section holds the shared interface once agreed.

## Docs map

| Doc | Purpose | Primary owner |
|---|---|---|
| [README.md](../README.md) | Onboarding: what it is, run it, repo map | Hen |
| [PRD.md](PRD.md) | Product: why / what / roadmap / risks | Both |
| ARCHITECTURE.md (this) | System layers + ownership + the AI boundary | Hen |
| [AI-ARCHITECTURE.md](AI-ARCHITECTURE.md) | AI providers, prompts, seam internals | **Perry** |
| [CLAUDE.md](../CLAUDE.md) | Agent operating rules + pointers | Both |

---

*Living document — update when a layer's state or an ownership boundary changes.*
