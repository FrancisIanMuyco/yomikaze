import type {
  Chapter,
  ChapterPage,
  LibraryQuery,
  LibraryResult,
  Title,
} from '@/types'

/**
 * Content Provider contract.
 * The UI must NEVER call provider APIs directly — everything flows
 * through this interface (spec section 10).
 */
export interface ContentProvider {
  readonly id: string
  readonly label: string

  getTitles(): Promise<Title[]>
  searchTitles(query: string): Promise<Title[]>
  getTitle(id: string): Promise<Title | null>
  getChapters(titleId: string): Promise<Chapter[]>
  getChapter(chapterId: string): Promise<Chapter | null>
  getChapterPages(chapterId: string): Promise<ChapterPage[]>
  getGenres(): Promise<string[]>
  getTrending(): Promise<Title[]>
  getPopular(): Promise<Title[]>
  getLatest(): Promise<Title[]>
  getLibrary(query: LibraryQuery): Promise<LibraryResult>
}
