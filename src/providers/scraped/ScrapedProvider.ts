import { proxyImageUrl } from '@/lib/utils'
import type { ContentProvider } from '@/providers/ContentProvider'
import type { Chapter, ChapterPage, LibraryQuery, LibraryResult, Title, TitleStatus } from '@/types'
import type { RawScrapedItem, ScrapedChapter } from '../scrapedTypes'

const STATUS_MAP: Record<string, TitleStatus> = {
  'releasing': 'RELEASING',
  'finished': 'FINISHED',
  'hiatus': 'HIATUS',
  'cancelled': 'CANCELLED',
  'not yet published': 'NOT_YET_RELEASED',
}

function toKind(sourceId: string): 'MANGA' | 'MANHUA' | 'MANHWA' {
  const s = sourceId.toLowerCase()
  if (s.includes('manhua')) return 'MANHUA'
  if (s.includes('manhwa')) return 'MANHWA'
  return 'MANGA'
}

function pickTitle(item: RawScrapedItem): string {
  return item.title || item.alt_titles[0] || 'Untitled'
}

export class ScrapedProvider implements ContentProvider {
  readonly id = 'scraped'
  readonly label = 'Scraped (local JSON)'

  private items: RawScrapedItem[] = []
  private titlesById = new Map<string, Title>()
  private chaptersByTitleId = new Map<string, Chapter[]>()
  private titleChaptersLoaded = new Set<string>()
  private loadPromise: Promise<void> | null = null

  constructor() {
    this.loadPromise = this.loadIndex()
  }

  /** Load the lightweight index (items only, no chapters). */
  private async loadIndex() {
    try {
      // Try lazy-loaded titles.json first (new format)
      const res = await fetch(`${import.meta.env.BASE_URL}titles.json`)
      if (res.ok) {
        const data = await res.json()
        this.items = data.items || []
        this.indexTitles()
        return
      }
    } catch {
      // fallback to legacy scraped.json
    }
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}scraped.json`)
      if (!res.ok) return
      const data = await res.json()
      this.items = data.items || [data]
      // Legacy: chapters are in the same file
      if (data.chapters) {
        this.indexLegacyChapters(data.chapters)
      }
      this.indexTitles()
    } catch {
      // no scraped data available yet
    }
  }

  private async ensureLoaded() {
    if (this.loadPromise) await this.loadPromise
  }

  /** Load chapters for a specific title on demand. */
  private async loadTitleChapters(titleId: string): Promise<void> {
    if (this.titleChaptersLoaded.has(titleId)) return
    // Extract source_id from titleId (format: "scraped:<source_id>")
    const sourceId = titleId.replace(/^scraped:/, '')
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}titles/${sourceId}.json`)
      if (!res.ok) return
      const data = await res.json()
      if (data.chapters) {
        this.indexChaptersForTitle(titleId, data.chapters)
      }
      this.titleChaptersLoaded.add(titleId)
    } catch {
      // title chapters not available
    }
  }

  /** Index titles only (no chapters — lazy loaded). */
  private indexTitles() {
    for (const item of this.items) {
      const title: Title = {
        id: `scraped:${item.source_id}`,
        providerId: 'scraped',
        title: pickTitle(item),
        alternativeTitles: item.alt_titles,
        type: toKind(item.source_id),
        description: item.description,
        coverUrl: proxyImageUrl(item.cover_url),
        author: item.authors?.[0],
        artist: item.authors?.[1],
        genres: item.genres,
        tags: [],
        status: STATUS_MAP[(item.status ?? '').toLowerCase()] || 'UNKNOWN',
        chapterCount: item.chapter_count ? Number(item.chapter_count) : undefined,
        officialUrl: item.url,
      }
      this.titlesById.set(title.id, title)
    }
  }

  /** Index chapters for a single title. */
  private indexChaptersForTitle(titleId: string, scrapedChapters: ScrapedChapter[]) {
    scrapedChapters.sort((a, b) => a.number - b.number)
    const chapters: Chapter[] = scrapedChapters.map((ch, idx) => ({
      id: ch.chapter_id,
      providerId: 'scraped',
      titleId,
      chapterNumber: ch.number,
      title: ch.title || `Chapter ${ch.number}`,
      publishedAt: undefined,
      updatedAt: Date.now() - (scrapedChapters.length - idx) * 86400000,
      available: true,
      pageCount: ch.pages.length,
    }))
    this.chaptersByTitleId.set(titleId, chapters)
  }

  /** Legacy: index chapters from the old scraped.json format. */
  private indexLegacyChapters(chapters: ScrapedChapter[]) {
    const chaptersBySeries = new Map<string, ScrapedChapter[]>()
    for (const ch of chapters) {
      const arr = chaptersBySeries.get(ch.series_id) || []
      arr.push(ch)
      chaptersBySeries.set(ch.series_id, arr)
    }
    for (const [seriesId, chs] of chaptersBySeries) {
      const titleId = `scraped:${seriesId}`
      this.indexChaptersForTitle(titleId, chs)
      this.titleChaptersLoaded.add(titleId)
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
    await this.loadTitleChapters(titleId)
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
    // Find the chapter's titleId from loaded chapters
    for (const [titleId, chs] of this.chaptersByTitleId) {
      const found = chs.find(c => c.id === chapterId)
      if (found) {
        // Ensure this title's chapters are loaded
        await this.loadTitleChapters(titleId)
        // Now find the raw chapter data for page URLs
        const rawChapters = await this.getRawChaptersForTitle(titleId)
        const rawCh = rawChapters.find(c => c.chapter_id === chapterId)
        if (rawCh) {
          return rawCh.pages.map((url, idx) => ({
            id: `${chapterId}:p${idx + 1}`,
            chapterId,
            pageNumber: idx + 1,
            imageUrl: proxyImageUrl(url) || url,
            width: undefined,
            height: undefined,
            alt: `Page ${idx + 1}`,
            source: 'scraped',
          }))
        }
      }
    }
    return []
  }

  /** Fetch raw scraped chapter data (with page URLs) for a title. */
  private async getRawChaptersForTitle(titleId: string): Promise<ScrapedChapter[]> {
    const sourceId = titleId.replace(/^scraped:/, '')
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}titles/${sourceId}.json`)
      if (!res.ok) return []
      const data = await res.json()
      return data.chapters || []
    } catch {
      return []
    }
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
