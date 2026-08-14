import type { ContentProvider } from '@/providers/ContentProvider'
import type { Chapter, ChapterPage, LibraryQuery, LibraryResult, Title } from '@/types'

/**
 * MockProvider — small built-in metadata set so the app is fully usable
 * offline (e.g. `VITE_CONTENT_PROVIDER=mock`). Metadata only; chapters
 * are listed but content is unavailable (no fake pages).
 */

const BASE_TS = 1_720_000_000_000

const MOCK_TITLES: Title[] = [
  {
    id: 'mock:1',
    providerId: 'mock',
    title: 'Blade of the Crimson Moon',
    alternativeTitles: ['Kurenai Tsuki no Yaiba', '紅月の刃'],
    nativeTitle: '紅月の刃',
    type: 'MANGA',
    description:
      'When the crimson moon rises, the imperial capital falls silent. One swordsman walks the empty streets seeking the blade that shattered his clan. Mock metadata — the reader is not available for this title.',
    author: 'Mock Studio',
    genres: ['Action', 'Historical', 'Drama'],
    tags: ['Swordplay', 'Moon', 'Revenge'],
    status: 'RELEASING',
    rating: 88,
    popularity: 15200,
    year: 2023,
    country: 'JP',
    chapterCount: 24,
    volumeCount: 3,
    trending: true,
  },
  {
    id: 'mock:2',
    providerId: 'mock',
    title: 'Immortal Ascension Sect',
    alternativeTitles: ['长生仙门'],
    nativeTitle: '长生仙门',
    type: 'MANHUA',
    description:
      'A mortal disciple discovers the sect’s forbidden ninth scroll and becomes the target of every elder. Mock metadata — the reader is not available for this title.',
    author: 'Mock Studio',
    genres: ['Action', 'Fantasy', 'Martial Arts'],
    tags: ['Cultivation', 'Sect Politics'],
    status: 'RELEASING',
    rating: 84,
    popularity: 19800,
    year: 2024,
    country: 'CN',
    chapterCount: 96,
    volumeCount: 4,
  },
  {
    id: 'mock:3',
    providerId: 'mock',
    title: 'Neon Requiem',
    alternativeTitles: ['ネオン・レクイエム'],
    nativeTitle: 'ネオン・レクイエム',
    type: 'MANHWA',
    description:
      'A dead detective’s backup drive wakes up inside a courier’s implant. Together they hunt the algorithm that erased her memory. Mock metadata — the reader is not available for this title.',
    author: 'Mock Studio',
    genres: ['Sci-Fi', 'Mystery', 'Thriller'],
    tags: ['Cyberpunk', 'Memory'],
    status: 'FINISHED',
    rating: 90,
    popularity: 12100,
    year: 2022,
    country: 'KR',
    chapterCount: 40,
    volumeCount: 2,
    trending: true,
  },
  {
    id: 'mock:4',
    providerId: 'mock',
    title: 'The Chef of the Jade Palace',
    alternativeTitles: ['玉宫御厨'],
    nativeTitle: '玉宫御厨',
    type: 'MANHUA',
    description:
      'The empire’s most dangerous dish is served once a century. The new imperial chef is about to learn why. Mock metadata — the reader is not available for this title.',
    author: 'Mock Studio',
    genres: ['Comedy', 'Drama', 'Romance'],
    tags: ['Cooking', 'Imperial Court'],
    status: 'HIATUS',
    rating: 82,
    popularity: 9800,
    year: 2023,
    country: 'CN',
    chapterCount: 18,
    volumeCount: 1,
  },
]

export class MockProvider implements ContentProvider {
  readonly id = 'mock'
  readonly label = 'Mock (offline metadata)'

  async getTitles(): Promise<Title[]> {
    return MOCK_TITLES
  }

  async searchTitles(query: string): Promise<Title[]> {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return MOCK_TITLES.filter((t) => [t.title, ...t.alternativeTitles, ...t.genres].join(' ').toLowerCase().includes(q))
  }

  async getTitle(id: string): Promise<Title | null> {
    return MOCK_TITLES.find((t) => t.id === id) ?? null
  }

  async getChapters(titleId: string): Promise<Chapter[]> {
    const title = MOCK_TITLES.find((t) => t.id === titleId)
    if (!title || !title.chapterCount) return []
    return Array.from({ length: Math.min(title.chapterCount, 50) }, (_, i) => ({
      id: `mock-c-${titleId}-${i + 1}`,
      providerId: 'mock',
      titleId,
      chapterNumber: i + 1,
      title: `Chapter ${i + 1}`,
      available: false,
      pageCount: 0,
    }))
  }

  async getChapter(chapterId: string): Promise<Chapter | null> {
    const match = /^mock-c-(mock:\d+)-(\d+)$/.exec(chapterId)
    if (!match) return null
    const chapters = await this.getChapters(match[1])
    return chapters.find((c) => c.chapterNumber === Number(match[2])) ?? null
  }

  async getChapterPages(_chapterId: string): Promise<ChapterPage[]> {
    return []
  }

  async getGenres(): Promise<string[]> {
    return [...new Set(MOCK_TITLES.flatMap((t) => t.genres))].sort()
  }

  async getTrending(): Promise<Title[]> {
    return MOCK_TITLES.filter((t) => t.trending)
  }

  async getPopular(): Promise<Title[]> {
    return [...MOCK_TITLES].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
  }

  async getLatest(): Promise<Title[]> {
    return [...MOCK_TITLES].sort((a, b) => (b.updatedAt ?? BASE_TS) - (a.updatedAt ?? BASE_TS))
  }

  async getLibrary(query: LibraryQuery): Promise<LibraryResult> {
    let titles = MOCK_TITLES.filter((t) => {
      if (query.kind === 'MANHUA') {
        if (t.type !== 'MANHUA' && t.type !== 'MANHWA') return false
      } else if (query.kind && query.kind !== 'ALL' && t.type !== query.kind) {
        return false
      }
      if (query.genre && !t.genres.includes(query.genre)) return false
      if (query.status && query.status !== 'ALL' && t.status !== query.status) return false
      if (query.year && t.year !== query.year) return false
      if (query.search) {
        const q = query.search.toLowerCase()
        if (![t.title, ...t.alternativeTitles, ...t.genres].join(' ').toLowerCase().includes(q)) return false
      }
      return true
    })
    titles = [...titles].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    return { titles, hasNextPage: false }
  }
}
