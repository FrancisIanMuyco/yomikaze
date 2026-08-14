/**
 * JUKU — common schema.
 *
 * Every source adapter must convert its raw results into these shapes
 * (see normalizer.ts). The DatabaseWriter then maps Juku titles/chapters
 * into the same `public/scraped.json` store the YOMIKAZE frontend reads.
 */

export interface JukuTitle {
  title: string
  alternativeTitles: string[]
  /** Stable id used as `source_id` in the store */
  slug: string
  description?: string
  cover?: string
  author?: string
  artist?: string
  genres: string[]
  status?: string
  rating?: number
  /** manga | manhua | manhwa */
  type?: string
  year?: number
  source: string
  sourceUrl?: string
  chapters: JukuChapter[]
}

export interface JukuChapter {
  chapterNumber: number
  chapterTitle?: string
  chapterUrl?: string
  publishedAt?: number
  pages: JukuPage[]
}

export interface JukuPage {
  pageNumber: number
  imageUrl: string
}

/** Per-source rate limit configuration. */
export interface RateLimitConfig {
  /** Max requests per second (0 = unlimited) */
  rps: number
  /** Max requests per minute (0 = unlimited) */
  rpm: number
  /** Max concurrent requests for this source (0 = global only) */
  concurrency: number
}

export interface SourceConfig {
  id: string
  label: string
  /** How pages are fetched: http (axios) or browser (Playwright) */
  mode: 'http' | 'browser'
  /** true when this source needs the Playwright network observer */
  usesBrowser: boolean
  rateLimit: RateLimitConfig
}

/** Per-source limits applied by the request queue. */
export interface SourceLimits {
  maxConcurrent: number
}

export interface PipelineStats {
  source: string
  requests: number
  cacheHits: number
  errors: number
  titlesFound: number
  chaptersFound: number
  pagesFound: number
}

export type ScrapeMode = 'auto' | 'http' | 'browser'
