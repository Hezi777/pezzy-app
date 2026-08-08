# Pezzy — AI Architecture

> **Owner: Perry ([@perrys21](https://github.com/perrys21)).** This is your doc — the design of everything behind the AI boundary. Hen owns the plumbing around it ([ARCHITECTURE.md](ARCHITECTURE.md)); you own what calls a model.
> **Status:** 🚧 Scaffold — sections below are placeholders for Perry to fill in. **Updated:** 2026-07-19

---

## How this fits

Every AI feature runs **behind Hen's server boundary** — inside `src/app/api/*` route handlers, never in client code, no provider keys client-side (PRD R3). The prototype leaves a `TODO(llm)` seam at each spot where a real model call goes. This doc is where you decide what fills those seams.

Before the per-feature design is real, the shared **[AI boundary](ARCHITECTURE.md#the-ai-boundary-open)** has to be agreed with Hen (shape, contract, caching, data access, fallbacks). Capture your position on those five questions first — everything below depends on the answers.

> **Convention:** when you make a decision here, note it as a short dated entry in [Decisions](#decisions) so Hen can see what changed without re-reading the whole doc. Keep prompt text and provider keys out of client code and out of git.

## Providers

_What model powers each capability, and why. Fill in._

| Capability | Provider / model | Notes |
|---|---|---|
| LLM (ranking, chat, rows, reason copy) | TODO(perrys21) | |
| Image (avatar from selfie) | TODO(perrys21) | |
| ASR (speech → text) | TODO(perrys21) | |
| Translation (MT) | TODO(perrys21) | |

<!-- Anthropic/Claude is a candidate for the LLM slots; if you go that route, see the claude-api reference for model IDs, pricing, caching, and tool use before hardcoding anything. -->

## The seam (your side of the boundary)

_Your answer to the five questions in [ARCHITECTURE.md → The AI boundary](ARCHITECTURE.md#the-ai-boundary-open): library vs. service, who owns prompts vs. schema, caching, how you read watch history/embeddings, failure/fallback behavior._

TODO(perrys21)

## Per-feature design

For each: current stub → target design (prompt strategy, inputs, outputs, cost/caching, quality bar).

### Rec-core ranking + reason copy
- **Stub:** `src/lib/reco/index.ts` — deterministic scoring; `TODO(llm)` marks where the ranker/reason-writer goes. The candidate-selection and row-assembly *pipeline* around it is Hen's and already works.
- **Target:** TODO(perrys21)

### Chatbot (Ask Pezzy)
- **Stub:** `src/app/api/chat/route.ts` + `src/components/ui/ask-pezzy.tsx` (UI is Hen's).
- **Target:** TODO(perrys21) — how watch history enters the prompt, tool/rec-core access, response shape.

### Conversational homepage rows
- **Stub:** routes through the rec core (`intent: "chat"`); UI in `src/components/ui/prompt-row.tsx`.
- **Target:** TODO(perrys21) — prompt → row spec, editing existing rows by asking.

### Subtitles + translation
- **Prototype:** `/api/subtitles/generate` transcribes the selected original or
  dubbed audio locally with whisper.cpp, then `src/lib/subtitle-translation.ts`
  translates each timing-preserving cue batch through Groq. Every
  episode/audio/language WebVTT is persisted once.
- **Current languages:** English, Hebrew, Spanish, French, German, Portuguese,
  Japanese, and Arabic. The order is persisted per profile and controls both
  translation priority and player ordering.
- **TODO(perrys21):** evaluate/replace the translation model and prompt, define
  subtitle quality evals, and decide whether separate Parakeet models are worth
  a Linux/NVIDIA production path. The translation function's cue-in/tracks-out
  contract is the provider seam.

### Avatar from selfie
- **Stub:** `src/app/api/avatar/route.ts` + `src/components/ui/avatar-studio.tsx` (UI is Hen's).
- **Target:** TODO(perrys21) — image model + style, and note: face photos are biometric-adjacent — consent, minimal retention, deletion on request (PRD R4). Storage/retention mechanics are Hen's; the generation flow is yours.

## Cost & caching

_AI costs per call — nothing generates on every load (PRD R3). Hen wires `cached()` + `checkRateLimit()` at the route layer; document here what you cache, cache keys, TTLs, and per-user cost targets._

TODO(perrys21)

## Quality & safety

_Evals, guardrails, prompt-injection handling, content moderation. Fill in._

TODO(perrys21)

## Decisions

_Dated log of AI-side decisions, newest first._

- _(none yet)_

---

*Perry owns this doc. Link back to [ARCHITECTURE.md](ARCHITECTURE.md) for anything crossing the boundary.*
