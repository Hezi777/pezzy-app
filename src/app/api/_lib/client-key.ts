/**
 * Rate-limit bucket for routes with no profile to key on.
 *
 * Best-effort: `x-forwarded-for` is client-controlled unless a trusted proxy
 * rewrites it, so this raises the cost of abuse rather than preventing it.
 * Real enforcement belongs at the edge (see PRD "Stack gaps" — no production
 * proxy/WAF decision yet).
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim();
  return ip || request.headers.get("x-real-ip") || "unknown";
}
