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
  private titlesById = new Map<string, Title>()
  private chaptersByTitleId = new Map<string, Chapter[]>()
  private rawChaptersByTitleId = new Map<string, ScrapedChapter[]>()
  private loadPromise: Promise<void> | null = null
  /** Per-title lazy chapter loads (dedupe concurrent fetches). */
  private titleLoads = new Map<string, Promise<void>>()
  private titleLoaded = new Set<string>()
  /** Signature of the last indexed index — used to skip no-op reloads. */
  private lastItemsSignature = ''

  constructor(items: RawScrapedItem[] = [], chapters: ScrapedChapter[] = []) {
    if (items.length || chapters.length) {
      this.items = items
      this.index()
      if (chapters.length) {
        const bySeries = new Map<string, ScrapedChapter[]>()
        for (const ch of chapters) {
          const arr = bySeries.get(ch.series_id) || []
          arr.push(ch)
          bySeries.set(ch.series_id, arr)
        }
        for (const [seriesId, chs] of bySeries) {
          const titleId = `mangafire:${seriesId}`
          this.rawChaptersByTitleId.set(titleId, chs)
          this.chaptersByTitleId.set(titleId, this.mapChapters(titleId, chs))
        }
      }
    } else {
      // No data passed in — load the lightweight titles.json index; chapter
      // files (public/titles/<source_id>.json) are lazy-loaded per title so a
      // browsing session never downloads the full export.
      this.loadPromise = this.loadData()
      // Auto-refresh the index only (titles list is small — never the full
      // page export) so newly imported titles pick up without a reload.
      const pollMs = Number(import.meta.env.VITE_SCRAPED_REFRESH_MS ?? 180_000)
      if (pollMs > 0) {
        window.setInterval(() => void this.refresh(), pollMs)
      }
    }
  }

  private static itemsSignature(items: RawScrapedItem[]): string {
    const first = items[0]
    const last = items[items.length - 1]
    return [items.length, first?.source_id ?? '', first?.title ?? '', last?.source_id ?? ''].join('|')
  }

  private async loadData() {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}titles.json`)
      if (!res.ok) return
      const data = await res.json()
      this.items = data.items || []
      this.lastItemsSignature = MangaFireProvider.itemsSignature(this.items)
      this.index()
    } catch {
      // no scraped data available yet
    }
  }

  /** Poll the lightweight index and re-index only when the title set changed. */
  private async refresh() {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}titles.json?t=${Date.now()}`)
      if (!res.ok) return
      const data = await res.json()
      const items: RawScrapedItem[] = data.items || []
      const sig = MangaFireProvider.itemsSignature(items)
      if (sig === this.lastItemsSignature) return
      this.items = items
      this.lastItemsSignature = sig
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
  }

  /** Lazy-load one title's chapters from public/titles/<source_id>.json. */
  private async loadTitleChapters(titleId: string): Promise<void> {
    if (this.titleLoaded.has(titleId)) return
    const pending = this.titleLoads.get(titleId)
    if (pending) return pending
    const sourceId = titleId.replace(/^mangafire:/, '')
    const p = (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}titles/${sourceId}.json`)
        if (!res.ok) return
        const data = await res.json()
        const chs: ScrapedChapter[] = data.chapters || []
        this.rawChaptersByTitleId.set(titleId, chs)
        this.chaptersByTitleId.set(titleId, this.mapChapters(titleId, chs))
        this.titleLoaded.add(titleId)
      } catch {
        // title chapters unavailable — leave the title metadata-only
      }
    })()
    this.titleLoads.set(titleId, p)
    await p
  }

  private mapChapters(titleId: string, scrapedChapters: ScrapedChapter[]): Chapter[] {
    const sorted = [...scrapedChapters].sort((a, b) => a.number - b.number)
    return sorted.map((ch, idx) => ({
      id: ch.chapter_id,
      providerId: 'mangafire',
      titleId,
      chapterNumber: ch.number,
      title: ch.title || `Chapter ${ch.number}`,
      publishedAt: undefined,
      updatedAt: Date.now() - (sorted.length - idx) * 86400000,
      // Chapters with no scraped pages (metadata-only import) are flagged so
      // the UI shows the "Metadata only" badge and the reader offers a
      // "Open on MangaFire" fallback instead of a blank screen.
      available: ch.pages.length > 0,
      pageCount: ch.pages.length,
      officialUrl: ch.url,
    }))
  }

  /** Titles a chapter id might belong to (chapter ids usually prefix source_id). */
  private candidateSourceIds(chapterId: string): string[] {
    const dash = chapterId.replaceAll('_', '-')
    const out: string[] = []
    for (const item of this.items) {
      const sid = item.source_id
      if (
        chapterId === sid ||
        chapterId.startsWith(`${sid}-`) ||
        chapterId.startsWith(`${sid.replaceAll(' ', '-')}-`) ||
        dash.startsWith(`${sid.replaceAll(' ', '-')}-`)
      ) {
        out.push(sid)
      }
    }
    return out
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
    await this.loadTitleChapters(titleId)
    return this.chaptersByTitleId.get(titleId) || []
  }

  async getChapter(chapterId: string): Promise<Chapter | null> {
    await this.ensureLoaded()
    for (const chs of this.chaptersByTitleId.values()) {
      const found = chs.find(c => c.id === chapterId)
      if (found) return found
    }
    for (const sourceId of this.candidateSourceIds(chapterId)) {
      const title = this.titlesById.get(`mangafire:${sourceId}`)
      if (!title) continue
      await this.loadTitleChapters(title.id)
      const found = this.chaptersByTitleId.get(title.id)?.find(c => c.id === chapterId)
      if (found) return found
    }
    return null
  }

  async getChapterPages(chapterId: string): Promise<ChapterPage[]> {
    await this.ensureLoaded()
    for (const [titleId, chs] of this.rawChaptersByTitleId) {
      await this.loadTitleChapters(titleId)
      const ch = chs.find(c => c.chapter_id === chapterId)
      if (ch) return this.toPages(chapterId, ch)
    }
    for (const sourceId of this.candidateSourceIds(chapterId)) {
      const title = this.titlesById.get(`mangafire:${sourceId}`)
      if (!title) continue
      await this.loadTitleChapters(title.id)
      const ch = this.rawChaptersByTitleId.get(title.id)?.find(c => c.chapter_id === chapterId)
      if (ch) return this.toPages(chapterId, ch)
    }
    return []
  }

  private toPages(chapterId: string, ch: ScrapedChapter): ChapterPage[] {
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
