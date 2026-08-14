/**
 * Lightweight in-memory TTL cache.
 * Used to respect provider rate limits and avoid duplicate requests.
 */

export interface CacheOptions {
  ttlMs: number
}

export function getCacheTtlMs(): number {
  const raw = import.meta.env.VITE_API_CACHE_TTL_MS
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000
}

interface CacheEntry {
  value: unknown
  expiresAt: number
}

const store = new Map<string, CacheEntry>()

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key)
  if (!entry) return undefined
  if (entry.expiresAt < Date.now()) {
    store.delete(key)
    return undefined
  }
  return entry.value as T
}

export function cacheSet<T>(key: string, value: T, ttlMs = getCacheTtlMs()): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
}

export function cacheClear(): void {
  store.clear()
}

/** Run `fn`, memoizing the result under `key` until it expires. */
export async function cacheWrap<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs = getCacheTtlMs(),
): Promise<T> {
  const hit = cacheGet<T>(key)
  if (hit !== undefined) return hit
  const value = await fn()
  cacheSet(key, value, ttlMs)
  return value
}
