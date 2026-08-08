/**
 * Simple in-memory fixed-window rate limiter.
 *
 * Guards anything that would call an LLM (PRD R3) so a single profile can't
 * trigger unbounded generation cost. This in-memory map is per-process and a
 * placeholder; production uses a shared store (Redis / edge KV) so limits
 * hold across server instances.
 */

interface RateLimitOptions {
  /** Max requests allowed per window. Default 20. */
  limit?: number;
  /** Window size in ms. Default 60_000 (1 minute). */
  windowMs?: number;
}

interface Window {
  count: number;
  windowStart: number;
}

const windows = new Map<string, Window>();

export function checkRateLimit(
  key: string,
  opts: RateLimitOptions = {}
): { ok: boolean; remaining: number } {
  const limit = opts.limit ?? 20;
  const windowMs = opts.windowMs ?? 60_000;
  const now = Date.now();

  const existing = windows.get(key);
  if (!existing || now - existing.windowStart >= windowMs) {
    windows.set(key, { count: 1, windowStart: now });
    return { ok: true, remaining: limit - 1 };
  }

  if (existing.count >= limit) {
    return { ok: false, remaining: 0 };
  }

  existing.count += 1;
  return { ok: true, remaining: limit - existing.count };
}
