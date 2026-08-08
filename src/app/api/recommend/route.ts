import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { recommend } from "@/lib/reco";
import { generateRowFromPrompt } from "@/lib/reco/llm";
import type { RecoContext } from "@/lib/types";

export async function POST(req: Request) {
  const ctx = (await req.json()) as RecoContext;

  if (!ctx.profileId || !ctx.intent) {
    return NextResponse.json(
      { error: "profileId and intent are required" },
      { status: 400 }
    );
  }

  const { ok } = checkRateLimit(ctx.profileId);
  if (!ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  // "Make your own row" - try the real Groq-backed composer first, and fall
  // back to the deterministic keyword ranker (recommend()) when there's no
  // key or the model call fails. Branched here rather than in reco/index.ts
  // since that file is owned elsewhere right now.
  if (ctx.intent === "chat" && ctx.prompt) {
    const aiRow = await generateRowFromPrompt(ctx.profileId, ctx.prompt);
    if (aiRow) return NextResponse.json([aiRow]);
  }

  const rows = await recommend(ctx);
  return NextResponse.json(rows);
}
