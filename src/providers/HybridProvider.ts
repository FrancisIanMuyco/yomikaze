import type { ContentProvider } from '@/providers/ContentProvider'
import { MangaDexProvider } from '@/providers/mangadex/MangaDexProvider'
import type { Chapter, ChapterPage, LibraryQuery, LibraryResult, Title } from '@/types'

/**
 * HybridProvider — "auto" mode: real MangaDex chapters (official API)
 * with safe fallback to empty results when MangaDex is unavailable.
 */
export class HybridProvider implements ContentProvider {
  readonly id = 'auto'
  readonly label = 'MangaDex (with fallback)'

  private readonly mangadex = new MangaDexProvider()

  async getTitles(): Promise<Title[]> {
    return safeMangaDex(() => this.mangadex.getTitles(), [])
  }

  async searchTitles(query: string): Promise<Title[]> {
    return safeMangaDex(() => this.mangadex.searchTitles(query), [])
  }

  async getTitle(id: string): Promise<Title | null> {
    return safeMangaDex(() => this.mangadex.getTitle(id), null)
  }

  async getChapters(titleId: string): Promise<Chapter[]> {
    return safeMangaDex(() => this.mangadex.getChapters(titleId), [])
  }

  async getChapter(chapterId: string): Promise<Chapter | null> {
    return safeMangaDex(() => this.mangadex.getChapter(chapterId), null)
  }

  async getChapterPages(chapterId: string): Promise<ChapterPage[]> {
    return safeMangaDex(() => this.mangadex.getChapterPages(chapterId), [])
  }

  async getGenres(): Promise<string[]> {
    return safeMangaDex(() => this.mangadex.getGenres(), [])
  }

  async getTrending(): Promise<Title[]> {
    return safeMangaDex(() => this.mangadex.getTrending(), [])
  }

  async getPopular(): Promise<Title[]> {
    return safeMangaDex(() => this.mangadex.getPopular(), [])
  }

  async getLatest(): Promise<Title[]> {
    return safeMangaDex(() => this.mangadex.getLatest(), [])
  }

  async getLibrary(query: LibraryQuery): Promise<LibraryResult> {
    return safeMangaDex(() => this.mangadex.getLibrary(query), { titles: [], hasNextPage: false })
  }
}

async function safeMangaDex<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}
