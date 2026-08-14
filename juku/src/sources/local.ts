/**
 * Local JSON adapter — treats the existing `public/scraped.json` store as a
 * read-only source. Used for testing, offline runs, and merging existing data.
 */
import { existsSync, readFileSync } from 'node:fs'
import type { RawChapter, RawTitle } from '../normalizer.js'
import type { SourceAdapter } from './SourceAdapter.js'

interface StoreItem {
  source: string
  source_id: string
  title: string
  alt_titles?: string[]
  description?: string
  authors?: string[]
  genres?: string[]
  status?: string
  year?: number
  rating?: number
  cover_url?: string
  url?: string
  type?: string
}

interface StoreChapter {
  source: string
  series_id: string
  chapter_id: string
  number: number
  title?: string
  url?: string
  pages: string[]
}

export class LocalJsonAdapter implements SourceAdapter {
  readonly id = 'local'
  readonly label = 'Local scraped.json'
  readonly mode = 'http' as const
  readonly usesBrowser = false

  private items: StoreItem[] = []
  private chapters: StoreChapter[] = []
  private loaded = false

  constructor(private readonly file: string) {}

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    if (!existsSync(this.file)) return
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf-8')) as {
        items?: StoreItem[]
        chapters?: StoreChapter[]
      }
      this.items = data.items ?? []
      this.chapters = data.chapters ?? []
    } catch {
      this.items = []
      this.chapters = []
    }
  }

  private toRaw(item: StoreItem): RawTitle {
    return {
      title: item.title,
      alternativeTitles: item.alt_titles ?? [],
      slug: item.source_id,
      description: item.description,
      cover: item.cover_url,
      author: item.authors?.[0],
      artist: item.authors?.[1],
      genres: item.genres ?? [],
      status: item.status,
      rating: item.rating,
      year: item.year,
      type: item.type,
      source: this.id,
      sourceUrl: item.url,
      chapters: [],
    }
  }

  async search(query: string, limit = 20): Promise<{ titles: RawTitle[] }> {
    this.ensureLoaded()
    const q = query.toLowerCase()
    const matches = this.items
      .filter(i => i.title.toLowerCase().includes(q) || (i.alt_titles ?? []).some(a => a.toLowerCase().includes(q)))
      .slice(0, limit)
    return { titles: matches.map(m => this.toRaw(m)) }
  }

  async getDetails(ref: string): Promise<RawTitle | null> {
    this.ensureLoaded()
    const item = this.items.find(i => i.source_id === ref)
    return item ? this.toRaw(item) : null
  }

  async getChapters(ref: string): Promise<RawChapter[]> {
    this.ensureLoaded()
    return this.chapters
      .filter(c => c.series_id === ref)
      .sort((a, b) => a.number - b.number)
      .map(c => ({
        chapterNumber: c.number,
        chapterTitle: c.title,
        chapterUrl: c.url,
        pages: c.pages ?? [],
      }))
  }

  async getChapterPages(ref: string): Promise<string[]> {
    this.ensureLoaded()
    const ch = this.chapters.find(c => c.chapter_id === ref)
    return ch?.pages ?? []
  }

  async getLatest(limit = 20): Promise<RawTitle[]> {
    this.ensureLoaded()
    return this.items.slice(0, limit).map(i => this.toRaw(i))
  }

  async getPopular(limit = 20): Promise<RawTitle[]> {
    this.ensureLoaded()
    return this.items.slice(0, limit).map(i => this.toRaw(i))
  }
}
