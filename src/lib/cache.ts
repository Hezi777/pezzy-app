/**
 * Tiny in-memory TTL cache.
 *
 * AI calls cost money per call (PRD R3) — anything that generates content
 * (recs, chat rows, subtitles, avatars) must be cached rather than
 * regenerated on every load. This in-memory map is a placeholder; production
 * swaps it for a shared store (Redis / edge cache) so it works across
 * server instances.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value as T;
  }

  const value = await fn();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}
