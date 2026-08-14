import type { Chapter, ChapterPage, Title } from '@/types'

/**
 * demoData.ts — demo provider dataset.
 *
 * NOTE: this module was missing from the repository, which broke the app's
 * build (ProviderFactory imports DemoReaderProvider eagerly, which imports
 * this file). This minimal dataset keeps the demo provider compilable and
 * functional without inventing fake reading content. The default provider
 * is `scraped` (reads public/scraped.json), so this data is only shown when
 * VITE_CONTENT_PROVIDER=demo is explicitly selected.
 */

export const DEMO_GENRES: string[] = []

export const ALL_DEMO_TITLES: Title[] = []

export function demoTitleById(_id: string): Title | null {
  return null
}

export function demoChaptersForTitle(_titleId: string): Chapter[] {
  return []
}

export function demoChapterById(_chapterId: string): Chapter | null {
  return null
}

export function demoPagesForChapter(_chapterId: string): ChapterPage[] {
  return []
}
