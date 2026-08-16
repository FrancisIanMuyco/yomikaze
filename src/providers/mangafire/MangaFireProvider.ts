import { proxyImageUrl } from '@/lib/utils'
import type { ContentProvider } from '@/providers/ContentProvider'
import type { Chapter, ChapterPage, LibraryQuery, LibraryResult, Title, TitleStatus } from '@/types'
import type { RawScrapedItem, ScrapedChapter } from '../scrapedTypes'

const STATUS_MAP: Record<string, TitleStatus> = {
  'releasing': 'RELEASING',
  'ongoing': 'RELEASING',
  'finished': 'FINISHED',
  'hiatus': 'HIATUS',
  'cancelled': 'CANCELLED',
  'not yet published': 'NOT_YET_RELEASED',
}

function toKind(type?: string): 'MANGA' | 'MANHUA' | 'MANHWA' {
  const s = (type || '').toLowerCase()
  if (s.includes('manhua')) return 'MANHUA'
  if (s.includes('manhwa')) return 'MANHWA'
  return 'MANGA'
}

function pickTitle(item: RawScrapedItem): string {
  return item.title || item.alt_titles[0] || 'Untitled'
}

export class MangaFireProvider implements ContentProvider {
  readonly id = 'mangafire'
  readonly label = 'MangaFire (scraped)'

  private items: RawScrapedItem[] = []
  private chapters: ScrapedChapter[] = []
  private titlesById = new Map<string, Title>()
  private chaptersByTitleId = new Map<string, Chapter[]>()
  private loadPromise: Promise<void> | null = null
  /** Signature of the last indexed scraped.json — used to skip no-op reloads. */
  private lastSignature = ''

  constructor(items: RawScrapedItem[] = [], chapters: ScrapedChapter[] = []) {
    if (items.length || chapters.length) {
      this.items = items
      this.chapters = chapters
      this.index()
    } else {
      // No data passed in — load the scraped mangafire.to export (public/scraped.json).
      this.loadPromise = this.loadData()
      // Auto-refresh: pick up newly imported titles/chapters without a manual
      // page reload (the JUKU engine rewrites public/scraped.json on import).
      const pollMs = Number(import.meta.env.VITE_SCRAPED_REFRESH_MS ?? 60_000)
      if (pollMs > 0) {
        window.setInterval(() => void this.refresh(), pollMs)
      }
    }
  }

  private static signature(items: RawScrapedItem[], chapters: ScrapedChapter[]): string {
    const first = items[0]
    const last = chapters[chapters.length - 1]
    return [
      items.length,
      chapters.length,
      first?.source_id ?? '',
      first?.title ?? '',
      last?.chapter_id ?? '',
    ].join('|')
  }

  private async loadData() {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}scraped.json?t=${Date.now()}`)
      if (!res.ok) return
      const data = await res.json()
      this.items = data.items || [data]
      this.chapters = data.chapters || []
      this.lastSignature = MangaFireProvider.signature(this.items, this.chapters)
      this.index()
    } catch {
      // no scraped data available yet
    }
  }

  /** Poll scraped.json and re-index only when the library actually changed. */
  private async refresh() {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}scraped.json?t=${Date.now()}`)
      if (!res.ok) return
      const data = await res.json()
      const items: RawScrapedItem[] = data.items || [data]
      const chapters: ScrapedChapter[] = data.chapters || []
      const sig = MangaFireProvider.signature(items, chapters)
      if (sig === this.lastSignature) return
      this.items = items
      this.chapters = chapters
      this.lastSignature = sig
      this.index()
    } catch {
      // keep the current data on transient errors
    }
  }

  private async ensureLoaded() {
    if (this.loadPromise) await this.loadPromise
  }

  private index() {
    for (const item of this.items) {
      const title: Title = {
        id: `mangafire:${item.source_id}`,
        providerId: 'mangafire',
        title: pickTitle(item),
        alternativeTitles: item.alt_titles,
        type: toKind(item.type || item.source_id),
        description: item.description,
        // Route the cover through the /mfcdn/ proxy too — static.mfcdn.nl
        // covers are hotlink-protected and fail in the browser otherwise.
        coverUrl: proxyImageUrl(item.cover_url),
        author: item.authors?.[0],
        artist: item.authors?.[1],
        genres: item.genres,
        tags: [],
        status: STATUS_MAP[(item.status ?? '').toLowerCase()] || 'UNKNOWN',
        rating: item.rating,
        // mangafire `rank` is ascending (1 = most popular), so invert it so
        // the POPULAR sort (descending by popularity) orders correctly.
        popularity: item.rank ? 1000 / item.rank : 0,
        year: item.year,
        chapterCount: item.chapter_count ? Number(item.chapter_count) : undefined,
        officialUrl: item.url,
      }
      this.titlesById.set(title.id, title)
    }

    const chaptersBySeries = new Map<string, ScrapedChapter[]>()
    for (const ch of this.chapters) {
      const arr = chaptersBySeries.get(ch.series_id) || []
      arr.push(ch)
      chaptersBySeries.set(ch.series_id, arr)
    }

    for (const [seriesId, chs] of chaptersBySeries) {
      chs.sort((a, b) => a.number - b.number)
      const titleId = `mangafire:${seriesId}`
      const chapters: Chapter[] = chs.map((ch, idx) => ({
        id: ch.chapter_id,
        providerId: 'mangafire',
        titleId,
        chapterNumber: ch.number,
        title: ch.title || `Chapter ${ch.number}`,
        publishedAt: undefined,
        updatedAt: Date.now() - (chs.length - idx) * 86400000,
        // Chapters with no scraped pages (metadata-only import) are flagged so
        // the UI shows the "Metadata only" badge and the reader offers a
        // "Open on MangaFire" fallback instead of a blank screen.
        available: ch.pages.length > 0,
        pageCount: ch.pages.length,
        officialUrl: ch.url,
      }))
      this.chaptersByTitleId.set(titleId, chapters)
    }
  }

  async getTitles(): Promise<Title[]> {
    await this.ensureLoaded()
    return Array.from(this.titlesById.values())
  }

  async searchTitles(query: string): Promise<Title[]> {
    await this.ensureLoaded()
    const q = query.trim().toLowerCase()
    if (!q) return []
    return Array.from(this.titlesById.values()).filter(t =>
      [t.title, ...t.alternativeTitles, t.author ?? '', ...t.genres].join(' ').toLowerCase().includes(q)
    )
  }

  async getTitle(id: string): Promise<Title | null> {
    await this.ensureLoaded()
    return this.titlesById.get(id) || null
  }

  async getChapters(titleId: string): Promise<Chapter[]> {
    await this.ensureLoaded()
    return this.chaptersByTitleId.get(titleId) || []
  }

  async getChapter(chapterId: string): Promise<Chapter | null> {
    await this.ensureLoaded()
    for (const chs of this.chaptersByTitleId.values()) {
      const found = chs.find(c => c.id === chapterId)
      if (found) return found
    }
    return null
  }

  async getChapterPages(chapterId: string): Promise<ChapterPage[]> {
    await this.ensureLoaded()
    for (const ch of this.chapters) {
      if (ch.chapter_id === chapterId) {
        return ch.pages.map((url, idx) => ({
          id: `${chapterId}:p${idx + 1}`,
          chapterId,
          pageNumber: idx + 1,
          imageUrl: proxyImageUrl(url) || url,
          width: undefined,
          height: undefined,
          alt: `Page ${idx + 1}`,
          source: 'mangafire',
        }))
      }
    }
    return []
  }

  async getGenres(): Promise<string[]> {
    await this.ensureLoaded()
    const set = new Set<string>()
    for (const t of this.titlesById.values()) {
      for (const g of t.genres) set.add(g)
    }
    return Array.from(set).sort()
  }

  async getTrending(): Promise<Title[]> {
    await this.ensureLoaded()
    return Array.from(this.titlesById.values()).slice(0, 12)
  }

  async getPopular(): Promise<Title[]> {
    await this.ensureLoaded()
    return Array.from(this.titlesById.values()).slice(0, 12)
  }

  async getLatest(): Promise<Title[]> {
    await this.ensureLoaded()
    return Array.from(this.titlesById.values()).slice(0, 12)
  }

  async getLibrary(query: LibraryQuery): Promise<LibraryResult> {
    await this.ensureLoaded()
    let titles = Array.from(this.titlesById.values())
    const q = query.search?.trim().toLowerCase()
    if (q) {
      titles = titles.filter(t =>
        [t.title, ...t.alternativeTitles, t.author ?? '', ...t.genres].join(' ').toLowerCase().includes(q)
      )
    }
    if (query.genre) {
      const genre = query.genre
      titles = titles.filter(t => t.genres.includes(genre))
    }
    if (query.status && query.status !== 'ALL') {
      titles = titles.filter(t => t.status === query.status)
    }
    if (query.year) {
      titles = titles.filter(t => t.year === query.year)
    }
    if (query.kind === 'MANHUA') {
      titles = titles.filter(t => t.type === 'MANHUA' || t.type === 'MANHWA')
    } else if (query.kind && query.kind !== 'ALL') {
      titles = titles.filter(t => t.type === query.kind)
    }

    const sortMap: Record<string, (a: Title, b: Title) => number> = {
      POPULAR: (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0),
      RATING: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
      A_Z: (a, b) => a.title.localeCompare(b.title),
      LATEST: (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    }
    titles.sort(sortMap[query.sort] || sortMap.LATEST)

    const pageSize = 30
    const start = ((query.page ?? 1) - 1) * pageSize
    return {
      titles: titles.slice(start, start + pageSize),
      hasNextPage: start + pageSize < titles.length,
    }
  }
}
