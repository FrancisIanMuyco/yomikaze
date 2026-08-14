import type { ContentProvider } from '@/providers/ContentProvider'
import {
  ALL_DEMO_TITLES,
  DEMO_GENRES,
  demoChapterById,
  demoChaptersForTitle,
  demoPagesForChapter,
  demoTitleById,
} from '@/providers/demo/demoData'
import type { Chapter, ChapterPage, LibraryQuery, LibraryResult, Title } from '@/types'

function matchesQuery(title: Title, query: LibraryQuery): boolean {
  const q = query.search?.trim().toLowerCase()
  if (q) {
    const haystack = [
      title.title,
      ...title.alternativeTitles,
      title.author ?? '',
      ...title.genres,
    ]
      .join(' ')
      .toLowerCase()
    if (!haystack.includes(q)) return false
  }
  if (query.genre && !title.genres.includes(query.genre)) return false
  if (query.status && query.status !== 'ALL' && title.status !== query.status) return false
  if (query.year && title.year !== query.year) return false
  if (query.kind === 'MANHUA') {
    if (title.type !== 'MANHUA' && title.type !== 'MANHWA') return false
  } else if (query.kind && query.kind !== 'ALL' && title.type !== query.kind) {
    return false
  }
  return true
}

function sortTitles(titles: Title[], sort: LibraryQuery['sort']): Title[] {
  const copy = [...titles]
  switch (sort) {
    case 'POPULAR':
      return copy.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    case 'RATING':
      return copy.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    case 'A_Z':
      return copy.sort((a, b) => a.title.localeCompare(b.title))
    case 'LATEST':
    default:
      return copy.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }
}

export class DemoReaderProvider implements ContentProvider {
  readonly id = 'demo'
  readonly label = 'Demo Reader (original content)'

  async getTitles(): Promise<Title[]> {
    return ALL_DEMO_TITLES
  }

  async searchTitles(query: string): Promise<Title[]> {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return ALL_DEMO_TITLES.filter((t) =>
      [t.title, ...t.alternativeTitles, t.author ?? '', ...t.genres].join(' ').toLowerCase().includes(q),
    )
  }

  async getTitle(id: string): Promise<Title | null> {
    return demoTitleById(id) ?? null
  }

  async getChapters(titleId: string): Promise<Chapter[]> {
    return demoChaptersForTitle(titleId)
  }

  async getChapter(chapterId: string): Promise<Chapter | null> {
    return demoChapterById(chapterId)
  }

  async getChapterPages(chapterId: string): Promise<ChapterPage[]> {
    return demoPagesForChapter(chapterId)
  }

  async getGenres(): Promise<string[]> {
    return DEMO_GENRES
  }

  async getTrending(): Promise<Title[]> {
    return ALL_DEMO_TITLES.filter((t) => t.trending)
  }

  async getPopular(): Promise<Title[]> {
    return sortTitles(ALL_DEMO_TITLES, 'POPULAR')
  }

  async getLatest(): Promise<Title[]> {
    return sortTitles(ALL_DEMO_TITLES, 'LATEST')
  }

  async getLibrary(query: LibraryQuery): Promise<LibraryResult> {
    const filtered = sortTitles(ALL_DEMO_TITLES.filter((t) => matchesQuery(t, query)), query.sort)
    return { titles: filtered, hasNextPage: false }
  }
}
