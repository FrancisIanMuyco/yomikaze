/**
 * Normalizer — converts every source's raw results into Juku's common schema
 * (JukuTitle / JukuChapter / JukuPage), so adapters and the rest of the
 * pipeline never need to know about source-specific field names.
 */
import type { JukuChapter, JukuPage, JukuTitle } from './types.js'
import { htmlParser } from './html.js'

export interface RawTitle {
  title?: string
  alternativeTitles?: string[]
  slug?: string
  description?: string
  cover?: string
  author?: string
  artist?: string
  genres?: string[]
  status?: string
  rating?: number
  type?: string
  year?: number
  source: string
  sourceUrl?: string
  chapters?: RawChapter[]
  [key: string]: unknown
}

export interface RawChapter {
  chapterNumber: number
  chapterTitle?: string
  chapterUrl?: string
  publishedAt?: number
  pages?: (string | { url?: string })[]
}

/** Strip HTML from a description (MangaDex sends HTML in descriptions). */
export function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined
  const $ = htmlParser.load(html)
  return $.text().replace(/\s+/g, ' ').trim() || undefined
}

export class Normalizer {
  /** Normalize a raw title into the Juku schema. */
  title(raw: RawTitle): JukuTitle {
    const chapters = (raw.chapters ?? []).map(ch => this.chapter(ch))
    return {
      title: raw.title ?? raw.slug ?? 'Untitled',
      alternativeTitles: raw.alternativeTitles ?? [],
      slug: raw.slug ?? raw.title ?? 'untitled',
      description: stripHtml(raw.description),
      cover: raw.cover,
      author: raw.author,
      artist: raw.artist,
      genres: raw.genres ?? [],
      status: raw.status,
      rating: raw.rating,
      type: raw.type,
      year: raw.year,
      source: raw.source,
      sourceUrl: raw.sourceUrl,
      chapters,
    }
  }

  chapter(raw: RawChapter): JukuChapter {
    const pages: JukuPage[] = (raw.pages ?? []).map((p, i) => ({
      pageNumber: i + 1,
      imageUrl: typeof p === 'string' ? p : (p.url ?? ''),
    }))
    return {
      chapterNumber: raw.chapterNumber,
      chapterTitle: raw.chapterTitle,
      chapterUrl: raw.chapterUrl,
      publishedAt: raw.publishedAt,
      pages,
    }
  }

  /** Serialize a JukuTitle into the store's `items` entry shape. */
  toStoreItem(t: JukuTitle): Record<string, unknown> {
    return {
      source: t.source,
      source_id: t.slug,
      title: t.title,
      alt_titles: t.alternativeTitles,
      description: t.description,
      authors: [t.author, t.artist].filter((x): x is string => Boolean(x)),
      genres: t.genres,
      status: t.status,
      year: t.year,
      rating: t.rating,
      cover_url: t.cover,
      url: t.sourceUrl,
      chapter_count: String(t.chapters.length),
      type: t.type,
    }
  }

  /** Serialize a JukuChapter into the store's `chapters` entry shape. */
  toStoreChapter(t: JukuTitle, ch: JukuChapter): Record<string, unknown> {
    return {
      source: t.source,
      series_id: t.slug,
      chapter_id: `${t.slug}-${ch.chapterNumber}`,
      number: ch.chapterNumber,
      title: ch.chapterTitle ?? `Chapter ${ch.chapterNumber}`,
      url: ch.chapterUrl,
      pages: ch.pages.map(p => p.imageUrl),
    }
  }
}

export const normalizer = new Normalizer()
