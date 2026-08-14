import { cacheWrap } from '@/lib/cache'
import { stripHtml } from '@/lib/utils'
import type { ContentProvider } from '@/providers/ContentProvider'
import { mdGet } from '@/providers/mangadex/mangadexClient'
import type {
  Chapter,
  ChapterPage,
  LibraryQuery,
  LibraryResult,
  MediaKind,
  Title,
  TitleStatus,
} from '@/types'

/* ------------------------------------------------------------------ */
/* Raw MangaDex shapes                                                 */
/* ------------------------------------------------------------------ */

interface MDTag {
  id: string
  attributes: { name: Record<string, string>; group: string }
}

interface MDAttrs {
  title: Record<string, string>
  altTitles?: Array<Record<string, string>>
  description?: Record<string, string>
  originalLanguage?: string
  lastVolume?: string
  lastChapter?: string
  publicationDemographic?: string
  status?: string
  year?: number | null
  contentRating?: string
  tags?: MDTag[]
  followedCount?: number
  latestUploadedChapter?: string
  createdAt?: string
}

interface MDRelationship {
  type: string
  id: string
  attributes?: { name?: string; fileName?: string }
}

interface MDManga {
  id: string
  type: string
  attributes: MDAttrs
  relationships?: MDRelationship[]
}

interface MDChapter {
  id: string
  type: string
  attributes: {
    chapter?: string | null
    title?: string | null
    pages?: number | null
    publishAt?: string
    translatedLanguage?: string
    externalUrl?: string | null
  }
  relationships?: Array<{ type: string; attributes?: { name?: string } }>
}

interface MDCollection<T> {
  result: string
  data: T[]
  limit?: number
  offset?: number
  total?: number
}

interface MDAtHome {
  baseUrl: string
  chapter: { hash: string; data: string[]; dataSaver: string[] }
}

interface MDTagResponse {
  result: string
  data: MDTag[]
}

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

const COVER_BASE = 'https://uploads.mangadex.org/covers'

function pickLocalized(map: Record<string, string> | undefined): string {
  if (!map) return ''
  for (const lang of ['en', 'en-us', 'ja', 'ko', 'zh', 'zh-hk', 'ja-ro', 'ko-ro', 'zh-ro']) {
    if (map[lang]) return map[lang]
  }
  const first = Object.values(map)[0]
  return first ?? ''
}

function toKind(lang: string | undefined): MediaKind {
  if (lang === 'zh') return 'MANHUA'
  if (lang === 'ko') return 'MANHWA'
  return 'MANGA'
}

function toStatus(status: string | undefined): TitleStatus {
  switch (status) {
    case 'ongoing':
      return 'RELEASING'
    case 'completed':
      return 'FINISHED'
    case 'hiatus':
      return 'HIATUS'
    case 'cancelled':
    case 'paused':
      return 'CANCELLED'
    default:
      return 'UNKNOWN'
  }
}

function mangaToTitle(m: MDManga): Title {
  const attrs = m.attributes
  const rels = m.relationships ?? []

  const coverRel = rels.find((r) => r.type === 'cover_art' && r.attributes?.fileName)
  const authors = rels
    .filter((r) => r.type === 'author' && r.attributes?.name)
    .map((r) => r.attributes?.name ?? '')
  const artists = rels
    .filter((r) => r.type === 'artist' && r.attributes?.name)
    .map((r) => r.attributes?.name ?? '')

  const genres = (attrs.tags ?? [])
    .filter((t) => t.attributes.group === 'genre')
    .map((t) => pickLocalized(t.attributes.name))
    .filter(Boolean)
  const tags = (attrs.tags ?? [])
    .filter((t) => t.attributes.group !== 'genre')
    .map((t) => pickLocalized(t.attributes.name))
    .filter(Boolean)

  const altTitles: string[] = []
  for (const alt of attrs.altTitles ?? []) {
    const v = pickLocalized(alt)
    if (v && !altTitles.includes(v)) altTitles.push(v)
  }

  const lastChapterNum = Number.parseFloat(attrs.lastChapter ?? '')

  return {
    id: m.id,
    providerId: 'mangadex',
    title: pickLocalized(attrs.title) || `MangaDex ${m.id.slice(0, 8)}`,
    alternativeTitles: altTitles,
    nativeTitle: attrs.originalLanguage ? attrs.title?.[attrs.originalLanguage] ?? undefined : undefined,
    type: toKind(attrs.originalLanguage),
    description: stripHtml(pickLocalized(attrs.description)) || undefined,
    coverUrl: coverRel?.attributes?.fileName
      ? `${COVER_BASE}/${m.id}/${coverRel.attributes.fileName}.512.jpg`
      : undefined,
    author: authors[0] ?? undefined,
    artist: artists[0] ?? authors[1] ?? undefined,
    genres,
    tags,
    status: toStatus(attrs.status),
    popularity: attrs.followedCount ?? undefined,
    year: attrs.year ?? undefined,
    country: attrs.originalLanguage,
    chapterCount: Number.isFinite(lastChapterNum) ? Math.ceil(lastChapterNum) : undefined,
    volumeCount: attrs.lastVolume ? Number.parseFloat(attrs.lastVolume) || undefined : undefined,
    updatedAt: attrs.latestUploadedChapter ? Date.parse(attrs.latestUploadedChapter) : undefined,
    officialUrl: `https://mangadex.org/title/${m.id}`,
  }
}

const MAX_CHAPTER_PAGES = 3 // 3 × 100 chapters

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

const CONTENT_RATINGS = ['safe', 'suggestive']

export class MangaDexProvider implements ContentProvider {
  readonly id = 'mangadex'
  readonly label = 'MangaDex (official API)'

  private static BASE_PARAMS = {
    includes: ['cover_art', 'author'],
    contentRating: CONTENT_RATINGS,
  }

  private mangaParams(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { ...MangaDexProvider.BASE_PARAMS, ...extra }
  }

  private async fetchManga(params: Record<string, unknown>): Promise<{ manga: MDManga[]; total: number }> {
    const key = `mangadex:manga:${JSON.stringify(params)}`
    return cacheWrap(key, async () => {
      const res = await mdGet<MDCollection<MDManga>>('/manga', this.mangaParams(params))
      return { manga: res.data ?? [], total: res.total ?? 0 }
    })
  }

  private static tagNameToIdCache: Record<string, string> | null = null

  private async getTagIdMap(): Promise<Record<string, string>> {
    if (MangaDexProvider.tagNameToIdCache) return MangaDexProvider.tagNameToIdCache
    const res = await cacheWrap('mangadex:tags', async () => mdGet<MDTagResponse>('/manga/tag', { limit: 100 }))
    const map: Record<string, string> = {}
    for (const tag of res.data ?? []) {
      const name = pickLocalized(tag.attributes.name)
      if (name && tag.attributes.group === 'genre') map[name] = tag.id
    }
    MangaDexProvider.tagNameToIdCache = map
    return map
  }

  async getTitles(): Promise<Title[]> {
    const { manga } = await this.fetchManga({ order: { followedCount: 'desc' }, limit: 30 })
    return manga.map(mangaToTitle)
  }

  async searchTitles(query: string): Promise<Title[]> {
    const q = query.trim()
    if (!q) return []
    const { manga } = await this.fetchManga({ title: q, limit: 24 })
    return manga.map(mangaToTitle)
  }

  async getTitle(id: string): Promise<Title | null> {
    const res = await cacheWrap(`mangadex:title:${id}`, async () =>
      mdGet<{ result: string; data: MDManga }>(`/manga/${id}`, this.mangaParams()),
    )
    return res.data ? mangaToTitle(res.data) : null
  }

  async getChapters(titleId: string): Promise<Chapter[]> {
    return cacheWrap(`mangadex:chapters:${titleId}`, async () => {
      const chapters: Chapter[] = []
      let offset = 0
      for (let page = 0; page < MAX_CHAPTER_PAGES; page += 1) {
        const res = await mdGet<MDCollection<MDChapter>>(`/manga/${titleId}/feed`, {
          translatedLanguage: ['en'],
          'order[chapter]': 'asc',
          limit: 100,
          offset,
        })
        const items = res.data ?? []
        for (const ch of items) {
          const num = Number.parseFloat(ch.attributes.chapter ?? '')
          const group = ch.relationships?.find((r) => r.type === 'scanlation_group')?.attributes?.name
          // External chapters (e.g. hosted on Webnovel) have no MangaDex pages.
          const isExternal = Boolean(ch.attributes.externalUrl)
          chapters.push({
            id: ch.id,
            providerId: 'mangadex',
            titleId,
            chapterNumber: Number.isFinite(num) ? num : 0,
            title: ch.attributes.title ?? (ch.attributes.chapter ? `Chapter ${ch.attributes.chapter}` : 'One-shot'),
            publishedAt: ch.attributes.publishAt ? Date.parse(ch.attributes.publishAt) : undefined,
            available: !isExternal,
            pageCount: isExternal ? 0 : (ch.attributes.pages ?? 0),
            scanlationGroup: group,
          })
        }
        offset += items.length
        if (items.length === 0 || offset >= (res.total ?? 0)) break
      }
      return chapters
    })
  }

  async getChapter(chapterId: string): Promise<Chapter | null> {
    const res = await cacheWrap(`mangadex:chapter:${chapterId}`, async () =>
      mdGet<{ result: string; data: MDChapter }>(`/chapter/${chapterId}`),
    )
    const ch = res.data
    if (!ch) return null
    const num = Number.parseFloat(ch.attributes.chapter ?? '')
    return {
      id: ch.id,
      providerId: 'mangadex',
      titleId: '',
      chapterNumber: Number.isFinite(num) ? num : 0,
      title: ch.attributes.title ?? (ch.attributes.chapter ? `Chapter ${ch.attributes.chapter}` : 'One-shot'),
      publishedAt: ch.attributes.publishAt ? Date.parse(ch.attributes.publishAt) : undefined,
      available: true,
      pageCount: ch.attributes.pages ?? 0,
    }
  }

  async getChapterPages(chapterId: string): Promise<ChapterPage[]> {
    return cacheWrap(`mangadex:pages:${chapterId}`, async () => {
      const res = await mdGet<MDAtHome>(`/at-home/server/${chapterId}`)
      const hash = res.chapter?.hash
      const files = res.chapter?.data ?? []
      if (!res.baseUrl || !hash || files.length === 0) return []
      return files.map((file, i) => ({
        id: `${chapterId}:p${i + 1}`,
        chapterId,
        pageNumber: i + 1,
        imageUrl: `${res.baseUrl}/data/${hash}/${file}`,
        alt: `MangaDex chapter page ${i + 1}`,
        source: 'MangaDex',
      }))
    })
  }

  async getGenres(): Promise<string[]> {
    const map = await this.getTagIdMap()
    return Object.keys(map).sort()
  }

  async getTrending(): Promise<Title[]> {
    // Actively updating titles
    const { manga } = await this.fetchManga({ order: { latestUploadedChapter: 'desc' }, limit: 12 })
    return manga.map(mangaToTitle)
  }

  async getPopular(): Promise<Title[]> {
    // Most-followed titles (MangaDex has no score, follows are the popularity signal)
    const { manga } = await this.fetchManga({ order: { followedCount: 'desc' }, limit: 12 })
    return manga.map(mangaToTitle)
  }

  async getLatest(): Promise<Title[]> {
    const { manga } = await this.fetchManga({ order: { latestUploadedChapter: 'desc' }, limit: 12 })
    return manga.map(mangaToTitle)
  }

  async getLibrary(query: LibraryQuery): Promise<LibraryResult> {
    const orderMap: Record<LibraryQuery['sort'], Record<string, string>> = {
      POPULAR: { followedCount: 'desc' },
      LATEST: { latestUploadedChapter: 'desc' },
      RATING: { followedCount: 'desc' },
      A_Z: { title: 'asc' },
    }

    const params: Record<string, unknown> = {
      limit: 30,
      offset: ((query.page ?? 1) - 1) * 30,
      order: orderMap[query.sort],
    }
    if (query.search?.trim()) params.title = query.search.trim()
    if (query.genre) {
      const id = (await this.getTagIdMap())[query.genre]
      if (id) params.includedTags = [id]
    }
    const status = query.status && query.status !== 'ALL' ? query.status : undefined
    if (status) {
      const statusMap: Record<string, string> = {
        RELEASING: 'ongoing',
        FINISHED: 'completed',
        HIATUS: 'hiatus',
        CANCELLED: 'cancelled',
      }
      params.status = statusMap[status]
    }
    if (query.year) params.year = query.year

    const { manga, total } = await this.fetchManga(params)

    let titles = manga.map(mangaToTitle)
    if (query.kind === 'MANHUA') titles = titles.filter((t) => t.type === 'MANHUA' || t.type === 'MANHWA')
    else if (query.kind && query.kind !== 'ALL') titles = titles.filter((t) => t.type === query.kind)

    return {
      titles,
      hasNextPage: (query.page ?? 1) * 30 < total,
    }
  }
}
