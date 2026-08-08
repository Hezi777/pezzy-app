# Pezzy — PRD

> An AI-native, Netflix-style streaming platform for anime.
> **Status:** Draft v0.5 · **Owners:** Hen ([@Hezi777](https://github.com/Hezi777)) · Perry ([@perrys21](https://github.com/perrys21)) · **Updated:** 2026-07-27
> **Prototype:** frontend + stubbed AI/server boundary + a generated AniList catalog snapshot + third-party provider playback are built. Backend, real AI providers, and the licensed production video stack remain open (see "Stack gaps").

---

## The idea

Streaming anime, but the whole experience adapts to you through AI — not static rows and generic recs like Netflix. You can talk to your homepage, generate subtitles in any language on demand, ask a chatbot what to watch next, and make an anime avatar from a selfie.

**The bet:** the catalog is table stakes; the AI layer is the moat.

## Problem

- Anime fans juggle multiple apps; discovery is generic and subtitles are often missing in their language.
- Existing platforms treat everyone the same. Nothing feels personal.

## Who it's for

- **Bingers** who want great recs and subtitles *now*.
- **Curators** who rate everything and hunt hidden gems.
- **New users** with no history — the homepage must feel personal on day one.
- (Later) **Social viewers** who watch what friends watch.

> **Who builds what:** the AI layer is Perry's; everything else (frontend + non-AI backend) is Hen's. The full split, the system layers, and the still-open AI boundary live in [ARCHITECTURE.md](ARCHITECTURE.md) — this doc stays product-only.

## What we're building

The AI **recommendation core** is the foundation — the chatbot, custom homepage rows, and "what to watch next" all run on it. Build it once, reuse everywhere.

| # | Feature | What it does | Phase |
|---|---------|--------------|-------|
| 1 | Streaming + Netflix-style UI | Browse, play, resume. Unique anime-forward look, not a Netflix skin. | P0–P1 |
| 2 | Ratings | Rate titles; feeds the rec core. | P1 |
| 3 | **Rec core** | Personalized recommendations from watch history + content signals. | P1 |
| 4 | **AI chatbot** | Knows your watch history, tells you what to watch next. | P1 |
| 5 | Conversational homepage | Type a query → get a custom row. Edit existing rows by asking. | P2 |
| 6 | On-demand subtitles + translation | Generate & translate subs on request; cached per title/language. | P2 |
| 7 | Anime avatar | Upload a selfie → anime-styled profile picture. | P2 |
| 8 | Social layer | Follow friends, recommend titles, see what they're watching. | P4 |

## Roadmap

- **P0 — Foundation:** auth, profiles, catalog data, self-hosted playback → *can browse and play a video.*
- **P1 — Lean MVP:** unique UI, ratings, rec core, AI chatbot → *sign up, watch, rate, get AI recs.*
- **P2 — AI media tools:** subtitles/translation, avatars, conversational rows → *signature AI features live.*
- **P3 — Scale & content:** expanded/licensed catalog, performance (gated on R1 below).
- **P4 — Social:** follow, recommend, activity feed.

> Order is deliberate: prove the AI loop (P1) *before* spending on content licensing (P3).

## Success metrics

- % of new users who watch ≥1 episode **and** get an AI rec in session 1.
- % of plays that come from an AI rec (chatbot / custom row).
- Weekly active viewers · W1/W4 retention.
- AI cost per active user stays under target.

## Risks & open decisions

1. **Content licensing (blocks P3).** Streaming unlicensed anime is illegal, and Pezzy holds no anime rights. Playback is abstracted behind `StreamResolver` and ships with a Creative Commons demo implementation only. Any shipped MVP must use owned or licensed content. *How do we source content legally?*
2. **Metadata:** use **AniList** (free), not IMDb (restricted).
3. **AI cost:** generation (subs, translations, avatars, rows) must cache + rate-limit.
4. **Face-photo privacy:** avatars need consent + minimal retention (GDPR/CCPA).
5. **Monetization:** subscription vs. freemium vs. ads — undecided.
6. **Tech stack:** frontend and prototype playback chosen (see below); backend, AI providers, and licensed production delivery remain open.
7. **AI boundary architecture (Hen ↔ Perry).** Where the AI seam sits and who owns the prompts/schema/caching is undecided — needs a joint architecture session. Details in [ARCHITECTURE.md](ARCHITECTURE.md#the-ai-boundary-open).

## Stack gaps

What the prototype fakes today and the decision each one needs. Nothing here is scaffolded yet by design (CLAUDE.md rule) — these are founder calls.

| Area | Prototype today | Needs a decision on |
|------|-----------------|---------------------|
| **Data / persistence** | Catalog is a generated AniList snapshot; local SQLite migrations cover profiles, settings, My List, watch progress, and subtitle metadata. Profiles are wired; other per-profile tables await UI/API integration. | Decide whether production remains local-first or gains remote persistence/vector search. |
| **Auth** | None; local profiles use an HTTP-only active-profile cookie. | Auth provider + account/session model if the product becomes multi-user or remote. |
| **AI providers** | `recommend`/`chat`/`avatar`/`subtitles` routes are rule-based/stubbed, marked `TODO(llm)`. | LLM (ranking + chat + reason copy), image model (avatar), ASR + translation (subtitles). Cost + `cached()`/rate-limit already wired. |
| **Video** | `StreamResolver` implementations resolve a title/episode to playable URLs; Pezzy proxies HLS/media/subtitles into an `hls.js` player with sub/dub selection. | Licensed storage, transcoding, CDN, durable proxy/session state, observability, and DRM. Gated on R1. |
| **Object storage** | Avatar generation returns a placeholder; nothing persisted. | Where generated avatars/subtitle tracks live; retention + deletion for face data (R4). |
| **Images/licensing** | Posters/banners come from the AniList CDN and episode thumbnails from streaming providers, hot-linked (demo placeholders). | Owned/licensed art, self-hosted, before production (R1). |

> Ownership of building each of these (all Hen's except AI providers) is mapped in [ARCHITECTURE.md](ARCHITECTURE.md#ownership-map).

Frontend is settled: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · `motion` · Three.js. Playback uses the `StreamResolver` boundary + a tokenized Next.js media proxy + `hls.js`. AI calls stay behind the server boundary (no client keys).

---

*Living document — bump the version and date on meaningful changes.*
