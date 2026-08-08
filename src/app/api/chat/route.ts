import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { recommend } from "@/lib/reco";
import { chatWithAssistant } from "@/lib/reco/llm";
import type { ChatRequest, ChatResponse } from "@/lib/types";

// Fallback-only NLU for when Groq is unavailable (no key / error) - see
// chatWithAssistant in @/lib/reco/llm, which is the real path.
const RECO_KEYWORDS = [
  "recommend",
  "suggest",
  "row about",
  "show me",
  "watch",
  "anime about",
  "something",
];

function wantsRecommendation(message: string): boolean {
  const lower = message.toLowerCase();
  return RECO_KEYWORDS.some((kw) => lower.includes(kw));
}

export async function POST(req: Request) {
  const body = (await req.json()) as ChatRequest;

  if (!body.profileId || !body.message) {
    return NextResponse.json(
      { error: "profileId and message are required" },
      { status: 400 }
    );
  }

  const { ok } = checkRateLimit(body.profileId);
  if (!ok) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const assistantReply = await chatWithAssistant(body.profileId, body.message);
  if (assistantReply) {
    return NextResponse.json(assistantReply satisfies ChatResponse);
  }

  // Groq missing/unavailable - degrade to the deterministic ranker rather
  // than showing the user an error (PRD R3).
  if (wantsRecommendation(body.message)) {
    const rows = await recommend({
      profileId: body.profileId,
      intent: "chat",
      prompt: body.message,
    });
    const row = rows[0];
    const response: ChatResponse = {
      reply: `Good call. I put together "${row.label}" for you. ${row.reason ?? ""}`.trim(),
      row,
    };
    return NextResponse.json(response);
  }

  const response: ChatResponse = {
    reply:
      "I'm still learning, but I can build you a row. Try asking for something like \"show me a row about mecha\" or \"recommend something romantic.\"",
  };
  return NextResponse.json(response);
}
