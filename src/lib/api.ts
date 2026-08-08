/**
 * Client-side fetch helpers for the AI/recommendation API. Plain fetch,
 * usable from client components — no server-only code here.
 */
import type {
  AvatarGenRequest,
  AvatarGenResponse,
  ChatRequest,
  ChatResponse,
  RecoContext,
  RecoRow,
  SubtitleRequest,
  SubtitleResponse,
  Title,
} from "@/lib/types";

async function getJson<T>(url: string, label: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${label} failed: ${res.status}`);
  return res.json();
}

async function postJson<T>(url: string, label: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${label} failed: ${res.status}`);
  return res.json();
}

export async function getCatalogTitles(ids: string[]): Promise<Title[]> {
  const params = new URLSearchParams({ ids: ids.join(",") });
  return getJson(`/api/catalog?${params.toString()}`, "getCatalogTitles");
}

export async function searchCatalogLive(
  query: string,
  signal?: AbortSignal
): Promise<Title[]> {
  const params = new URLSearchParams({ q: query, limit: "8" });
  return getJson(`/api/search?${params.toString()}`, "searchCatalogLive", signal);
}

export async function getRecommendations(ctx: RecoContext): Promise<RecoRow[]> {
  return postJson("/api/recommend", "getRecommendations", ctx);
}

export async function askPezzy(req: ChatRequest): Promise<ChatResponse> {
  return postJson("/api/chat", "askPezzy", req);
}

export async function generateAvatar(req: AvatarGenRequest): Promise<AvatarGenResponse> {
  return postJson("/api/avatar", "generateAvatar", req);
}

export async function requestSubtitles(req: SubtitleRequest): Promise<SubtitleResponse> {
  const params = new URLSearchParams({ titleId: req.titleId, language: req.language });
  const res = await fetch(`/api/subtitles?${params.toString()}`, {
    method: "POST",
  });

  if (!res.ok) {
    throw new Error(`requestSubtitles failed: ${res.status}`);
  }

  return res.json();
}
