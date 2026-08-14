/**
 * YOMIKAZE — domain models
 * Models follow the Content Provider contract: providers return these shapes
 * and the UI never talks to provider APIs directly.
 */

export type MediaKind = 'MANGA' | 'MANHUA' | 'MANHWA'

export type TitleStatus =
  | 'RELEASING'
  | 'FINISHED'
  | 'NOT_YET_RELEASED'
  | 'CANCELLED'
  | 'HIATUS'
  | 'UNKNOWN'

export interface Title {
  id: string
  providerId: string
  title: string
  alternativeTitles: string[]
  nativeTitle?: string
  type: MediaKind
  description?: string
  coverUrl?: string
  bannerUrl?: string
  author?: string
  artist?: string
  genres: string[]
  tags: string[]
  status: TitleStatus
  rating?: number
  popularity?: number
  year?: number
  country?: string
  chapterCount?: number
  volumeCount?: number
  latestChapter?: string
  updatedAt?: number
  featured?: boolean
  trending?: boolean
  /** Optional official / authorized reading destination */
  officialUrl?: string
}

export interface Chapter {
  id: string
  providerId: string
  titleId: string
  chapterNumber: number
  title?: string
  volume?: number
  publishedAt?: number
  updatedAt?: number
  /** Metadata-only chapters (no page source) are still listable but flagged */
  available: boolean
  pageCount: number
  /** Direct link to this chapter on its source site (used when no pages are cached) */
  officialUrl?: string
  /** Scanlation group credit (MangaDex AUP requires attributing groups) */
  scanlationGroup?: string
}

export interface ChapterPage {
  id: string
  chapterId: string
  pageNumber: number
  imageUrl: string
  width?: number
  height?: number
  alt: string
  source: string
}

/** Locally-stored reading position for a single chapter. */
export interface ReadingProgress {
  titleId: string
  chapterId: string
  pageNumber: number
  progress: number
  timestamp: number
}

/** Snapshot used by Continue Reading / History so we don't need network access. */
export interface TitleSnapshot {
  id: string
  title: string
  coverUrl?: string
  type: MediaKind
}

export interface HistoryEntry {
  titleId: string
  title: TitleSnapshot
  chapterId: string
  chapterNumber: number
  chapterTitle?: string
  pageNumber: number
  totalPages: number
  progress: number
  timestamp: number
}

export interface LibraryQuery {
  kind?: MediaKind | 'ALL'
  search?: string
  genre?: string
  status?: TitleStatus | 'ALL'
  year?: number
  sort: 'LATEST' | 'POPULAR' | 'RATING' | 'A_Z'
  page: number
}

export interface LibraryResult {
  titles: Title[]
  hasNextPage: boolean
}
