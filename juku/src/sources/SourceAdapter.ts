/**
 * Source Adapter System — every source implements this interface.
 * Adapters return raw results; the Normalizer converts them to Juku schema.
 */
import type { RawChapter, RawTitle } from '../normalizer.js'

export interface SearchResult {
  titles: RawTitle[]
}

export interface SourceAdapter {
  readonly id: string
  readonly label: string
  /** http = axios path, browser = Playwright path */
  readonly mode: 'http' | 'browser'
  /** Sources that need JS rendering use the Playwright network observer. */
  readonly usesBrowser: boolean

  search(query: string, limit?: number): Promise<SearchResult>
  getDetails(ref: string): Promise<RawTitle | null>
  getChapters(ref: string): Promise<RawChapter[]>
  getChapterPages(ref: string): Promise<string[]>
  getLatest(limit?: number): Promise<RawTitle[]>
  getPopular(limit?: number): Promise<RawTitle[]>
  /** Optional cheap chapter count (null when it would need a full scrape). */
  getChapterCount?(ref: string): Promise<number | null>
}

export class SourceRegistry {
  private sources = new Map<string, SourceAdapter>()

  register(adapter: SourceAdapter): void {
    this.sources.set(adapter.id, adapter)
  }

  get(id: string): SourceAdapter {
    const s = this.sources.get(id)
    if (!s) throw new Error(`unknown source adapter: ${id}`)
    return s
  }

  has(id: string): boolean {
    return this.sources.has(id)
  }

  list(): SourceAdapter[] {
    return [...this.sources.values()]
  }
}

export const registry = new SourceRegistry()
