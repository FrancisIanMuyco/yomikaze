/** Small shared utilities used across the app. */

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

/**
 * Rewrites mangafire CDN image URLs to the local proxy path (/mfcdn/<host>/<path>)
 * so images load with the correct Referer header (see vite.config.ts).
 * Covers live on static.mfcdn.nl and pages on mfcdn*.xyz — both are matched.
 * Non-mangafire URLs pass through unchanged.
 */
export function proxyImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  const m = /^https:\/\/([^/]+)\/(.+)$/.exec(url)
  if (m && /(^|\.)mfcdn\d*\./i.test(m[1])) {
    return `/mfcdn/${m[1]}/${m[2]}`
  }
  return url
}

/**
 * Normalize a title/chapter id for fuzzy matching: lowercase, strip the
 * provider prefix (`mangafire:`) and all non-alphanumeric characters.
 *
 * Used to resolve stale links (history/Continue Reading snapshots) whose
 * ids no longer match the current library — e.g. an old mangafire slug
 * `mangafire:God Level Assassin` vs the current `mangafire:God-Level
 * Assassin, I'm the Shadow`.
 */
export function normalizeId(id: string): string {
  return id
    .replace(/^[^:]+:/, '') // strip provider prefix e.g. `mangafire:`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '') // strip spaces, punctuation, dashes
}

/** Strip HTML tags + common entities from provider descriptions. */
export function stripHtml(input?: string | null): string {
  if (!input) return ''
  return input
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function formatDate(ts?: number): string {
  if (!ts) return 'Unknown'
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(ts))
  } catch {
    return 'Unknown'
  }
}

export function formatRelativeTime(ts?: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

export function formatNumber(n?: number): string {
  if (n === undefined || n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/** AniList averageScore is 0-100; we display it as /10. */
export function formatRating(rating?: number): string {
  if (rating === undefined || rating === null) return 'N/A'
  return (rating / 10).toFixed(1)
}

export function typeLabel(type: string): string {
  switch (type) {
    case 'MANGA':
      return 'Manga'
    case 'MANHUA':
      return 'Manhua'
    case 'MANHWA':
      return 'Manhwa'
    default:
      return type
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'RELEASING':
      return 'Ongoing'
    case 'FINISHED':
      return 'Completed'
    case 'HIATUS':
      return 'On Hiatus'
    case 'CANCELLED':
      return 'Cancelled'
    case 'NOT_YET_RELEASED':
      return 'Not Released'
    default:
      return 'Unknown'
  }
}

export function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeLocalJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage may be unavailable (private mode) — fail silently
  }
}
