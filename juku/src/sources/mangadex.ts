/**
 * MangaDex adapter — the primary production source.
 *
 * Uses MangaDex's official public API (no key required for public reads),
 * which matches YOMIKAZE's content policy. Every request flows through the
 * JUKU pipeline: proxy pool → rate limiter → request queue → axios/cache →
 * normalizer. Chapters and page lists are fetched from the public API and
 * the At-Home servers.
 *
 * Public API docs: https://api.mangadex.org/docs/
 */
import type { RawChapter, RawTitle } from '../normalizer.js'
import { stripHtml } from '../normalizer.js'
import type { HttpClient, HttpOptions } from '../http.js'
import type { Logger } from '../logger.js'
import type { SourceAdapter } from './SourceAdapter.js'

const API = 'https://api.mangadex.org'

interface MangaDexManga {
  id: string
  attributes: {
    title?: Record<string, string>
    altTitles?: Array<Record<string, string>>
    description?: Record<string, string>
    status?: string
    year?: number
    tags?: Array<{ attributes: { group: string; name: Record<string, string> } }>
    originalLanguage?: string
    contentRating?: string
  }
  relationships?: Array<{
    type: string
    id: string
    attributes?: { fileName?: string; name?: string }
  }>
}

interface MangaDexChapter {
  id: string
  attributes: {
    chapter?: string
    title?: string
    volume?: string
    publishedAt?: string
    pages?: number
  }
}

export class MangaDexAdapter implements SourceAdapter {
  readonly id = 'mangadex'
  readonly label = 'MangaDex (official API)'
  readonly mode = 'http' as const
  readonly usesBrowser = false

  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly ttlMs = 5 * 60_000,
  ) {}

  private get<T>(path: string, opts: Partial<HttpOptions> = {}): Promise<T> {
    return this.http
      .getJson<T>(`${API}${path}`, { source: 'mangadex', cacheTtlMs: this.ttlMs, ...opts })
      .then(r => r.data)
  }

  private coverUrl(manga: MangaDexManga): string | undefined {
    const cover = manga.relationships?.find(r => r.type === 'cover_art')
    const fileName = cover?.attributes?.fileName
    if (!fileName) return undefined
    return `https://uploads.mangadex.org/covers/${manga.id}/${fileName}.256.jpg`
  }

  private name(manga: MangaDexManga): string {
    const t = manga.attributes.title
    if (!t) return 'Untitled'
    return t.en ?? Object.values(t)[0] ?? 'Untitled'
  }

  private toRawTitle(manga: MangaDexManga): RawTitle {
    const attrs = manga.attributes
    const altTitles: string[] = []
    for (const alt of attrs.altTitles ?? []) {
      for (const v of Object.values(alt)) {
        if (typeof v === 'string' && !altTitles.includes(v)) altTitles.push(v)
      }
    }
    const genres = (attrs.tags ?? [])
      .filter(t => t.attributes.group === 'genre')
      .map(t => t.attributes.name.en ?? Object.values(t.attributes.name)[0])
      .filter(Boolean)

    const authors = manga.relationships?.filter(r => r.type === 'author').map(r => r.attributes?.name).filter(Boolean) ?? []
    const artists = manga.relationships?.filter(r => r.type === 'artist').map(r => r.attributes?.name).filter(Boolean) ?? []

    const desc = attrs.description?.en
    const lang = (attrs.originalLanguage ?? '').toLowerCase()
    const type = lang === 'ko' ? 'manhwa' : lang === 'zh' ? 'manhua' : 'manga'

    return {
      title: this.name(manga),
      alternativeTitles: altTitles,
      slug: manga.id,
      description: stripHtml(desc),
      cover: this.coverUrl(manga),
      author: authors[0],
      artist: artists[0] ?? authors[1],
      genres,
      status: attrs.status,
      year: attrs.year,
      type,
      source: this.id,
      sourceUrl: `https://mangadex.org/title/${manga.id}`,
      chapters: [],
    }
  }

  async search(query: string, limit = 20): Promise<{ titles: RawTitle[] }> {
    const data = await this.get<{ data: MangaDexManga[] }>(
      `/manga?title=${encodeURIComponent(query)}&limit=${limit}&includes[]=cover_art&includes[]=author&includes[]=artist&order[relevance]=desc`,
    )
    return { titles: (data.data ?? []).map(m => this.toRawTitle(m)) }
  }

  async getDetails(ref: string): Promise<RawTitle | null> {
    try {
      const data = await this.get<{ data: MangaDexManga }>(
        `/manga/${encodeURIComponent(ref)}?includes[]=cover_art&includes[]=author&includes[]=artist`,
      )
      return this.toRawTitle(data.data)
    } catch (err) {
      this.logger.warn(`getDetails failed for ${ref}`, { source: this.id, error: String(err) })
      return null
    }
  }

  async getChapters(ref: string): Promise<RawChapter[]> {
    // MangaDex feed endpoint pages through results; gather all English chapters.
    const out: RawChapter[] = []
    let offset = 0
    const limit = 100
    for (;;) {
      const data = await this.get<{ data: MangaDexChapter[] }>(
        `/manga/${encodeURIComponent(ref)}/feed?translatedLanguage[]=en&order[chapter]=asc&limit=${limit}&offset=${offset}&includes[]=scanlation_group`,
      )
      const batch = data.data ?? []
      for (const ch of batch) {
        const num = Number(ch.attributes.chapter)
        if (!Number.isFinite(num)) continue
        out.push({
          chapterNumber: num,
          chapterTitle: ch.attributes.title || undefined,
          chapterUrl: `https://mangadex.org/chapter/${ch.id}`,
          publishedAt: ch.attributes.publishedAt ? Date.parse(ch.attributes.publishedAt) : undefined,
          pages: [],
        })
      }
      if (batch.length < limit) break
      offset += limit
    }
    return out
  }

  async getChapterPages(ref: string): Promise<string[]> {
    // ref may be a chapter id or a full mangadex.org/chapter/<id> URL.
    let id = ref
    if (/^https?:\/\//.test(ref)) {
      const m = /\/chapter\/([a-f0-9-]+)/i.exec(ref)
      if (!m) return []
      id = m[1]
    }
    // Use the public At-Home server (official image CDN).
    const data = await this.get<{
      baseUrl: string
      chapter: { hash: string; data: string[]; dataSaver: string[] }
    }>(`/at-home/server/${encodeURIComponent(id)}`)
    const ch = data?.chapter
    if (!ch) return []
    const files = ch.data.length ? ch.data : ch.dataSaver
    return files.map(f => `${data.baseUrl}/data/${ch.hash}/${f}`)
  }

  /** Cheap English-chapter count via the feed endpoint (limit=1 → `total`). */
  async getChapterCount(ref: string): Promise<number | null> {
    try {
      const data = await this.get<{ total?: number }>(
        `/manga/${encodeURIComponent(ref)}/feed?translatedLanguage[]=en&limit=1`,
      )
      return typeof data?.total === 'number' ? data.total : null
    } catch {
      return null
    }
  }

  async getLatest(limit = 20): Promise<RawTitle[]> {
    const data = await this.get<{ data: MangaDexManga[] }>(
      `/manga?limit=${limit}&includes[]=cover_art&includes[]=author&includes[]=artist&order[latestUploadedChapter]=desc`,
    )
    return (data.data ?? []).map(m => this.toRawTitle(m))
  }

  async getPopular(limit = 20): Promise<RawTitle[]> {
    const data = await this.get<{ data: MangaDexManga[] }>(
      `/manga?limit=${limit}&includes[]=cover_art&includes[]=author&includes[]=artist&order[followedCount]=desc`,
    )
    return (data.data ?? []).map(m => this.toRawTitle(m))
  }
}
