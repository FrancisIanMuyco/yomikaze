export interface RawScrapedItem {
  source: string
  source_id: string
  title: string
  /** manhua / manhwa / manga — from mangafire's own type field */
  type?: string
  alt_titles: string[]
  description?: string
  authors: string[]
  genres: string[]
  status?: string
  year?: number
  rating?: number
  rank?: number
  cover_url?: string
  url: string
  chapter_count?: string
}

export interface ScrapedChapter {
  source: string
  series_id: string
  chapter_id: string
  number: number
  title?: string
  url: string
  pages: string[]
}
