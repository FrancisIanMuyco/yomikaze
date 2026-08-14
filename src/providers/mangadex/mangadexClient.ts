import { ApiError, RateLimitError, TimeoutError } from '@/lib/errors'

const ENDPOINT = (import.meta.env.VITE_MANGADEX_ENDPOINT as string | undefined) ?? 'https://api.mangadex.org'

function getTimeoutMs(): number {
  const raw = import.meta.env.VITE_MANGADEX_TIMEOUT_MS
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15_000
}

/**
 * Minimal REST client for MangaDex's official public API.
 * - No API key required for public reads (docs: api.mangadex.org).
 * - CORS is enabled (origin-reflected).
 * - One retry for 429 / 5xx with backoff, then a typed error.
 */
export async function mdGet<T>(
  path: string,
  params: Record<string, unknown> = {},
  retries = 1,
): Promise<T> {
  const url = new URL(`${ENDPOINT}${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      // MangaDex uses the literal `key[]` suffix for repeated params (e.g. includes[]=cover_art).
      for (const item of value) url.searchParams.append(`${key}[]`, String(item))
    } else if (typeof value === 'object') {
      // Flatten nested objects: { order: { followedCount: 'desc' } } → order[followedCount]=desc
      for (const [sub, v] of Object.entries(value)) {
        if (v === undefined || v === null) continue
        url.searchParams.append(`${key}[${sub}]`, String(v))
      }
    } else {
      url.searchParams.append(key, String(value))
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs())

  let res: Response
  try {
    res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new TimeoutError()
    }
    throw new ApiError('Network error while contacting MangaDex. Please check your connection.', undefined, true)
  } finally {
    clearTimeout(timeout)
  }

  if (res.status === 429 || res.status >= 500) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 2000))
      return mdGet<T>(path, params, retries - 1)
    }
    if (res.status === 429) throw new RateLimitError('MangaDex is rate limiting requests. Please wait a moment.')
    throw new ApiError('MangaDex is having trouble right now. Please try again shortly.', res.status, true)
  }

  if (!res.ok) {
    throw new ApiError(`MangaDex request failed (HTTP ${res.status}).`, res.status, true)
  }

  let json: { result?: string; errors?: Array<{ detail?: string }> }
  try {
    json = (await res.json()) as { result?: string; errors?: Array<{ detail?: string }> }
  } catch {
    throw new ApiError('MangaDex returned an unreadable response.', undefined, true)
  }

  if (json.errors && json.errors.length > 0) {
    throw new ApiError(`MangaDex: ${json.errors[0]?.detail ?? 'request error'}`)
  }

  return json as unknown as T
}
