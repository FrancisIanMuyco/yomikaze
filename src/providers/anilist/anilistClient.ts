import { ApiError, RateLimitError, TimeoutError } from '@/lib/errors'

const ENDPOINT = (import.meta.env.VITE_ANILIST_ENDPOINT as string | undefined) ?? 'https://graphql.anilist.co'

function getTimeoutMs(): number {
  const raw = import.meta.env.VITE_ANILIST_TIMEOUT_MS
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15_000
}

export interface GraphQLError {
  message: string
  status?: number
}

/**
 * Minimal GraphQL client for AniList's public endpoint.
 * - No API key required for public queries.
 * - CORS enabled (Access-Control-Allow-Origin: *).
 * - One retry for 429 / 5xx with backoff; then a typed error.
 */
export async function graphql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  retries = 1,
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs())

  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new TimeoutError()
    }
    throw new ApiError('Network error while contacting AniList. Please check your connection.', undefined, true)
  } finally {
    clearTimeout(timeout)
  }

  if (res.status === 429 || res.status >= 500) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 2500))
      return graphql<T>(query, variables, retries - 1)
    }
    if (res.status === 429) throw new RateLimitError()
    throw new ApiError('AniList is having trouble right now. Please try again shortly.', res.status, true)
  }

  if (!res.ok) {
    throw new ApiError(`AniList request failed (HTTP ${res.status}).`, res.status, true)
  }

  let json: { data?: T; errors?: GraphQLError[] }
  try {
    json = (await res.json()) as { data?: T; errors?: GraphQLError[] }
  } catch {
    throw new ApiError('AniList returned an unreadable response.', undefined, true)
  }

  if (json.errors && json.errors.length > 0) {
    const first = json.errors[0]?.message ?? 'Unknown GraphQL error'
    throw new ApiError(`AniList: ${first}`)
  }

  return json.data as T
}
