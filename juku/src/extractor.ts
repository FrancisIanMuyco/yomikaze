/**
 * Image / Page extractor — extracts ordered chapter pages and normalizes
 * their URLs (absolute, deduplicated, tracking params stripped).
 */
import type { JukuPage } from './types.js'
import { Deduplicator } from './dedup.js'

const TRACKING_PARAMS = /[?&](utm_[a-z]+|fbclid|gclid|ref|source)=[^&]*/gi

export function normalizeImageUrl(raw: string, baseUrl?: string): string {
  let url = raw.trim()
  if (!url) return ''
  if (baseUrl && !/^https?:\/\//i.test(url)) {
    try {
      url = new URL(url, baseUrl).href
    } catch {
      return ''
    }
  }
  try {
    const u = new URL(url)
    // Only strip common tracking params; keep real query data (e.g. CDN keys).
    u.search = u.search
      .replace(TRACKING_PARAMS, (m, _p, off, str) => {
        const rest = str.slice(off + m.length)
        return rest.startsWith('&') ? '&' : ''
      })
      .replace(/^&/, '')
    if (!u.search) u.search = ''
    return u.href
  } catch {
    return url
  }
}

export class PageExtractor {
  private readonly dedup = new Deduplicator()

  /**
   * Build an ordered, deduplicated page list from raw page sources.
   * `pages` may be strings or objects with a `url` field.
   */
  extract(
    pages: Array<string | { url?: string }>,
    opts: { chapterKey: string; baseUrl?: string },
  ): JukuPage[] {
    const out: JukuPage[] = []
    const seenUrls = new Set<string>()
    let n = 0
    for (const raw of pages) {
      const url = normalizeImageUrl(typeof raw === 'string' ? raw : (raw.url ?? ''), opts.baseUrl)
      if (!url || seenUrls.has(url)) continue
      seenUrls.add(url)
      n += 1
      const page: JukuPage = { pageNumber: n, imageUrl: url }
      // Page-level dedup keyed on chapter + page number + URL.
      if (this.dedup.isNew('page', `${opts.chapterKey}:${n}:${url}`)) {
        out.push(page)
      }
    }
    return out
  }
}

export const pageExtractor = new PageExtractor()
