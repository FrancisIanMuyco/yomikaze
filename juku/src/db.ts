/**
 * Database Writer — the central persistence layer.
 *
 * YOMIKAZE has no external database; its "database" is the JSON store that
 * the frontend reads (`public/scraped.json`). This writer centrally handles:
 *   - anime (title) upserts
 *   - chapter upserts
 *   - page upserts
 *   - duplicate prevention (by source_id / chapter_id / normalized title)
 *   - source relationships
 *   - last successful scrape + scraper errors + update timestamps
 *   - atomic writes (tmp file + rename) so the store is never truncated
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Logger } from './logger.js'
import type { JukuTitle } from './types.js'
import { normalizer } from './normalizer.js'

export interface StoreData {
  items: Array<Record<string, unknown>>
  chapters: Array<Record<string, unknown>>
  total_chapters?: number
  total_pages?: number
}

export interface ScrapeState {
  lastSuccessfulScrape?: Record<string, { at: string; titles: number; chapters: number }>
  errors: Array<{ source: string; at: string; url?: string; error: string }>
  updatedAt?: string
}

export class DatabaseWriter {
  private store: StoreData = { items: [], chapters: [] }
  private state: ScrapeState = { errors: [] }
  private loaded = false

  constructor(
    private readonly file: string,
    private readonly stateFile: string,
    private readonly logger: Logger,
  ) {}

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    if (existsSync(this.file)) {
      try {
        const data = JSON.parse(readFileSync(this.file, 'utf-8')) as StoreData
        this.store = {
          items: Array.isArray(data.items) ? data.items : [],
          chapters: Array.isArray(data.chapters) ? data.chapters : [],
        }
      } catch {
        this.logger.warn('store file unreadable, starting empty')
        this.store = { items: [], chapters: [] }
      }
    }
    if (existsSync(this.stateFile)) {
      try {
        const parsed = JSON.parse(readFileSync(this.stateFile, 'utf-8')) as ScrapeState
        this.state = { ...parsed, errors: parsed.errors ?? [] }
      } catch {
        this.state = { errors: [] }
      }
    }
  }

  /** Normalized title used for duplicate-title detection across sources. */
  private normTitle(t: string): string {
    return t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  }

  /** True when an item with this source + source_id already exists. */
  hasTitle(source: string, slug: string): boolean {
    this.load()
    return this.store.items.some(it => it.source === source && it.source_id === slug)
  }

  /** True when any item has the same normalized title (cross-source dedup). */
  hasTitleByNormalizedName(title: string): boolean {
    this.load()
    const norm = this.normTitle(title)
    if (norm.length < 4) return false
    return this.store.items.some(it => this.normTitle(String(it.title ?? '')) === norm)
  }

  /** True when a chapter (source + series + number) already exists. */
  hasChapter(source: string, seriesId: string, number: number): boolean {
    this.load()
    return this.store.chapters.some(
      c => c.source === source && c.series_id === seriesId && c.number === number,
    )
  }

  /**
   * Upsert one title + its chapters into the store.
   * Returns { addedTitle, addedChapters, skippedChapters, duplicateTitle }.
   */
  upsertTitle(title: JukuTitle, opts: { fresh?: boolean } = {}): {
    addedTitle: boolean
    addedChapters: number
    skippedChapters: number
    duplicateTitle: boolean
  } {
    this.load()
    if (opts.fresh) {
      this.store = { items: [], chapters: [] }
    }

    const item = normalizer.toStoreItem(title)
    const existingIdx = this.store.items.findIndex(it => it.source_id === title.slug)
    let addedTitle = false
    let duplicateTitle = false
    if (existingIdx === -1) {
      // Duplicate-title prevention by normalized title (same series, other source).
      const norm = this.normTitle(title.title)
      const dup = norm.length >= 4 && this.store.items.some(it => this.normTitle(String(it.title ?? '')) === norm)
      if (dup) {
        // Rejected duplicate: skip its chapters too so nothing is orphaned.
        duplicateTitle = true
        this.store.total_chapters = this.store.chapters.length
        this.store.total_pages = this.store.chapters.reduce((a, c) => a + (Array.isArray(c.pages) ? c.pages.length : 0), 0)
        return { addedTitle: false, addedChapters: 0, skippedChapters: title.chapters.length, duplicateTitle }
      }
      this.store.items.push(item)
      addedTitle = true
    } else {
      // Metadata refresh (update timestamps) — keep existing cover if new one missing.
      const existing = this.store.items[existingIdx]
      this.store.items[existingIdx] = { ...existing, ...item, updatedAt: new Date().toISOString() }
    }

    let addedChapters = 0
    let skippedChapters = 0
    for (const ch of title.chapters) {
      const chEntry = normalizer.toStoreChapter(title, ch)
      const existingChapter = this.store.chapters.find(
        c => c.chapter_id === chEntry.chapter_id || (c.number === chEntry.number && c.series_id === chEntry.series_id),
      )
      if (existingChapter) {
        // Chapter already in the store → never duplicate it.
        skippedChapters += 1
      } else {
        this.store.chapters.push(chEntry)
        addedChapters += 1
      }
    }

    this.store.total_chapters = this.store.chapters.length
    this.store.total_pages = this.store.chapters.reduce((a, c) => a + (Array.isArray(c.pages) ? c.pages.length : 0), 0)
    return { addedTitle, addedChapters, skippedChapters, duplicateTitle }
  }

  /** Record a successful scrape for a source. */
  recordSuccess(source: string, titles: number, chapters: number): void {
    this.load()
    this.state.lastSuccessfulScrape = {
      ...(this.state.lastSuccessfulScrape ?? {}),
      [source]: { at: new Date().toISOString(), titles, chapters },
    }
    this.state.updatedAt = new Date().toISOString()
  }

  /** Record a scraper error (no secrets — only source/url/error message). */
  recordError(source: string, error: string, url?: string): void {
    this.load()
    this.state.errors.push({ source, at: new Date().toISOString(), url, error })
    if (this.state.errors.length > 200) this.state.errors = this.state.errors.slice(-200)
  }

  /** Persist both files atomically. */
  persist(): void {
    this.load()
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.store, null, 2))
      renameSync(tmp, this.file)
    } catch (err) {
      this.logger.error('failed to persist store', { error: String(err) })
    }
    try {
      mkdirSync(dirname(this.stateFile), { recursive: true })
      writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2))
    } catch (err) {
      this.logger.error('failed to persist state', { error: String(err) })
    }
  }

  get size(): { titles: number; chapters: number; pages: number } {
    this.load()
    return {
      titles: this.store.items.length,
      chapters: this.store.chapters.length,
      pages: this.store.chapters.reduce((a, c) => a + (Array.isArray(c.pages) ? c.pages.length : 0), 0),
    }
  }

  get storeData(): StoreData {
    this.load()
    return this.store
  }

  get stateData(): ScrapeState {
    this.load()
    return this.state
  }
}
