# Pezzy

An AI-native, Netflix-style streaming platform for anime. AI is woven through the whole product, not bolted on: a chatbot that knows your watch history, a homepage you can talk to, on-demand subtitles & translation, and anime avatars from a selfie.

## Why this exists

The catalog is table stakes; the **AI personalization layer is the moat**. Every feature decision should ask: does this make the experience feel more personal and conversational than a static catalog? If a feature doesn't serve that, question it.

Full product thinking lives in [docs/PRD.md](docs/PRD.md) — read it before proposing anything non-trivial.

## Ground rules for this project

- **Licensing gates content.** Never assume we can ship, subtitle, or ingest anime we don't have rights to. Pezzy holds no anime rights: the catalog is metadata only, and playback sits behind the `StreamResolver` interface with a Creative Commons demo implementation. Any real deployment plugs in owned or licensed content. Never add a resolver for a source we don't have rights to. (See PRD R1.)
- **Metadata comes from AniList** (primary), Jikan/MAL (secondary). Not IMDb — its data is restricted. (PRD R2.)
- **The recommendation core is shared infrastructure.** Chatbot, custom homepage rows, and "what to watch next" all route through it. Build it once; don't fork per-feature logic.
- **AI costs money per call.** Anything that generates (subtitles, translations, avatars, rows) must cache and be rate-limited. Don't ship a generate-on-every-load path. (PRD R3.)
- **Face photos are sensitive.** Avatar generation processes biometric-adjacent data — explicit consent, minimal retention, deletion on request. Don't store raw uploads longer than needed. (PRD R4.)
- **No provider/API keys in client code.** All AI calls go through a server-side boundary.

## Tech stack

**Frontend (in place):** Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 (CSS-var tokens in `globals.css`, no `tailwind.config.js`) · `motion` (Framer Motion successor, import from `motion/react`) · Three.js via `@react-three/fiber` + `drei` + `postprocessing` for the cinematic bits. shadcn-style layout: shared UI in `src/components/ui`, `cn` from `@/lib/utils`, alias `@/*` → `src/*`.

**Server boundary (in place):** Next Route Handlers under `src/app/api/*`. AI/generation routes (`recommend`, `chat`, `avatar`, `subtitles`) remain stubbed and run server-side behind `cached()` + `checkRateLimit()`. Playback routes (`anime/streams`, `anime/proxy`) run configured `StreamResolver`s and proxy media without exposing upstream headers or URLs to the client.

**Catalog:** a generated snapshot, not live API calls. `npm run catalog` (`scripts/build-catalog.mjs`) writes `src/lib/catalog.data.json` (~750 franchises); `src/lib/catalog-service.ts` serves it from memory. Each season carries its own AniList `mediaId` — playback depends on it. Never re-add per-request AniList enrichment (30 req/min public limit), and don't hand-edit the JSON. AniList `streamingEpisodes` is franchise-wide, so it is only trusted when it matches the entry's own episode count. Real per-season episode titles + stills come from **Kitsu** (keyless, default on). Title logos come from **TMDB** via `--logos` + `TMDB_API_KEY` — read at generation time only, never at runtime, never in client code.

**Playback:** `src/lib/stream-resolver.ts` defines the source boundary; `src/lib/anime.ts` races the configured resolvers and takes the first useful answer. The bundled `OpenMovieResolver` serves Creative Commons films so a clone runs end-to-end. `src/lib/anime-proxy.ts` issues short-lived opaque tokens and `/api/anime/proxy` rewrites HLS playlists recursively. `video-player.tsx` is a custom player (own controls, caption + quality menus, keyboard shortcuts) supporting HLS/MP4, sub/dub, and subtitle tracks. Subtitle resources must be registered with the stream's headers and served as `text/vtt` or origins 403. Never expose arbitrary proxy URLs. A resolver's output is untrusted input — see docs/SECURITY.md.

**Subtitle generation (prototype, on `feat/asr-subtitles`):** `src/lib/asr.ts` transcribes an episode's own audio with **local whisper.cpp** (Metal on macOS, CUDA on Windows). `src/lib/subtitle-translation.ts` then creates eight timing-preserving language tracks through Groq (`GROQ_API_KEY`, server-only). `/api/subtitles/generate` streams source cues and completed translations over SSE and persists every track via `src/lib/subtitle-store.ts`. Both model calls cross into Perry's AI ownership; their interfaces are intentionally replaceable.

**Local persistence (prototype):** `src/lib/db.ts` uses Node's built-in SQLite driver and stores `.pezzy/pezzy.db` locally. It owns migrations for profiles, settings, My List, watch progress, and subtitle metadata. Profile creation and active-profile selection are wired; the remaining tables are schema foundations awaiting their UI/API wiring. No ORM, daemon, Docker, or remote service is required.

**Typography:** Satoshi is the single Latin face, self-hosted as `@font-face` in `globals.css` (weights 400/500/700, `public/fonts/satoshi/`) rather than pulled from Fontshare's CDN. `--font-display` and `--font-wordmark` are aliases for Satoshi, kept as separate tokens so existing `font-display`/`font-wordmark` utility classes don't need touching. Assistant is loaded locally by `next/font` for Hebrew content selected with `:lang(he)`. Fraunces and Onest are gone.

**Still open — do not assume, ask first:** auth, remote/production persistence, the remaining AI providers, and the licensed production video stack (storage, transcoding, CDN, durable proxy/session state, observability, DRM). See `docs/PRD.md` §"Stack gaps". Don't scaffold any of these without a decision here.

## Commands

Package manager: **npm** (`package-lock.json`). Node 24.

```bash
npm install
npm run dev     # Next.js dev server (Turbopack) — http://localhost:3000
npm run build   # production build
npm run lint    # eslint
npm run catalog # regenerate src/lib/catalog.data.json (network; ~10 min with Kitsu)
```

No test suite yet — `npm run build` + `npm run lint` are the verification/done signals.

## Ownership (two founders)

The codebase splits **AI vs. everything else**, not frontend vs. backend:

- **Hen ([@Hezi777](https://github.com/Hezi777)) — full-stack (frontend + non-AI backend):** UI, catalog, persistence/DB, auth, video, object storage, and the server boundary the AI runs behind (routes, `cached()`, rate-limit, schemas).
- **Perry ([@perrys21](https://github.com/perrys21)) — AI integrations:** the model calls behind that boundary (LLM ranking/chat/rows, image avatars, ASR + translation) — every `TODO(llm)` seam.

Rule of thumb: **if a line calls a model or shapes a prompt, it's Perry's; everything around it is Hen's.** When a change crosses the AI boundary, flag it — the interface isn't settled yet ([ARCHITECTURE.md](docs/ARCHITECTURE.md#the-ai-boundary-open)). Full split + map: [ARCHITECTURE.md](docs/ARCHITECTURE.md); enforced in [CODEOWNERS](CODEOWNERS).

## Working with this repo

- **Docs:** product → [docs/PRD.md](docs/PRD.md) · architecture + ownership → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · AI layer (Perry's) → [docs/AI-ARCHITECTURE.md](docs/AI-ARCHITECTURE.md).
- When scope is unclear, check the PRD's risk/open-decision list before inventing an answer.
- Flag anything that's a product/business call rather than deciding silently.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
