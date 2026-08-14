import { cacheWrap } from '@/lib/cache'
import { stripHtml } from '@/lib/utils'
import type { ContentProvider } from '@/providers/ContentProvider'
import { graphql } from '@/providers/anilist/anilistClient'
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
/* Raw shapes returned by AniList                                      */
/* ------------------------------------------------------------------ */

interface AniTitle {
  romaji?: string | null
  english?: string | null
  native?: string | null
}

interface AniCoverImage {
  extraLarge?: string | null
  large?: string | null
  color?: string | null
}

interface AniTag {
  name: string
}

interface AniDate {
  year?: number | null
  month?: number | null
  day?: number | null
}

interface AniStaffEdge {
  role?: string | null
  node?: { name?: { full?: string | null } | null } | null
}

interface AniMedia {
  id: number
  idMal?: number | null
  title?: AniTitle | null
  description?: string | null
  coverImage?: AniCoverImage | null
  bannerImage?: string | null
  genres?: string[] | null
  tags?: AniTag[] | null
  averageScore?: number | null
  popularity?: number | null
  status?: string | null
  format?: string | null
  countryOfOrigin?: string | null
  startDate?: AniDate | null
  endDate?: AniDate | null
  chapters?: number | null
  volumes?: number | null
  trending?: number | null
  updatedAt?: number | null
  siteUrl?: string | null
  staff?: { edges?: AniStaffEdge[] | null } | null
}

interface PageInfo {
  hasNextPage: boolean
}

interface MediaPageResponse {
  Page: {
    pageInfo: PageInfo
    media: AniMedia[]
  }
}

interface MediaByIdResponse {
  Page: { media: AniMedia[] }
}

interface GenreCollectionResponse {
  GenreCollection: string[] | null
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

const MEDIA_PAGE_QUERY = `
  query MediaPage(
    $page: Int
    $perPage: Int
    $search: String
    $sort: [MediaSort]
    $genre: String
    $status: MediaStatus
  ) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage }
      media(type: MANGA, search: $search, sort: $sort, genre: $genre, status: $status) {
        id
        idMal
        title { romaji english native }
        description(asHtml: false)
        coverImage { extraLarge large color }
        bannerImage
        genres
        tags { name }
        averageScore
        popularity
        status
        format
        countryOfOrigin
        startDate { year month day }
        endDate { year month day }
        chapters
        volumes
        trending
        updatedAt
        siteUrl
        staff(sort: RELEVANCE) { edges { role node { name { full } } } }
      }
    }
  }
`

const MEDIA_BY_ID_QUERY = `
  query MediaById($id: Int) {
    Page(page: 1, perPage: 1) {
      media(type: MANGA, id: $id) {
        id
        idMal
        title { romaji english native }
        description(asHtml: false)
        coverImage { extraLarge large color }
        bannerImage
        genres
        tags { name }
        averageScore
        popularity
        status
        format
        countryOfOrigin
        startDate { year month day }
        endDate { year month day }
        chapters
        volumes
        trending
        updatedAt
        siteUrl
        staff(sort: RELEVANCE) { edges { role node { name { full } } } }
      }
    }
  }
`

const GENRE_COLLECTION_QUERY = `query GenreCollection { GenreCollection }`

/* ------------------------------------------------------------------ */
/* Mapping                                                             */
/* ------------------------------------------------------------------ */

const MAX_GENERATED_CHAPTERS = 300

function toKind(country: string | null | undefined): MediaKind {
  if (country === 'CN') return 'MANHUA'
  if (country === 'KR') return 'MANHWA'
  return 'MANGA'
}

function toStatus(status: string | null | undefined): TitleStatus {
  switch (status) {
    case 'RELEASING':
    case 'FINISHED':
    case 'HIATUS':
    case 'CANCELLED':
    case 'NOT_YET_RELEASED':
      return status
    default:
      return 'UNKNOWN'
  }
}

function mediaToTitle(m: AniMedia): Title {
  const country = m.countryOfOrigin ?? 'JP'
  const edges = m.staff?.edges ?? []
  const writer = edges.find((e) => /story|writer|author/i.test(e.role ?? ''))
  const artist = edges.find((e) => /art/i.test(e.role ?? ''))
  const first = edges[0]

  return {
    id: String(m.id),
    providerId: 'anilist',
    title: m.title?.english ?? m.title?.romaji ?? `Title #${m.id}`,
    alternativeTitles: [m.title?.romaji ?? '', m.title?.native ?? ''].filter(Boolean),
    nativeTitle: m.title?.native ?? undefined,
    type: toKind(country),
    description: stripHtml(m.description) || undefined,
    coverUrl: m.coverImage?.extraLarge ?? m.coverImage?.large ?? undefined,
    bannerUrl: m.bannerImage ?? undefined,
    author: writer?.node?.name?.full ?? first?.node?.name?.full ?? undefined,
    artist: artist?.node?.name?.full ?? undefined,
    genres: m.genres ?? [],
    tags: (m.tags ?? []).map((t) => t.name).slice(0, 24),
    status: toStatus(m.status),
    rating: m.averageScore ?? undefined,
    popularity: m.popularity ?? undefined,
    year: m.startDate?.year ?? undefined,
    country: country,
    chapterCount: m.chapters ?? undefined,
    volumeCount: m.volumes ?? undefined,
    updatedAt: m.updatedAt ? m.updatedAt * 1000 : undefined,
    trending: (m.trending ?? 0) > 0,
    officialUrl: m.siteUrl ?? undefined,
  }
}

function chapterIdFor(mediaId: string, n: number): string {
  return `al-c-${mediaId}-${n}`
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

const PER_PAGE = 30

export class AniListProvider implements ContentProvider {
  readonly id = 'anilist'
  readonly label = 'AniList (metadata)'

  private pageKey(variables: Record<string, unknown>): string {
    return `anilist:page:${JSON.stringify(variables)}`
  }

  private async fetchPage(
    variables: { search?: string; sort?: string[]; genre?: string; status?: string },
    perPage = PER_PAGE,
    page = 1,
  ): Promise<{ media: AniMedia[]; hasNextPage: boolean }> {
    const vars = { page, perPage, ...variables }
    return cacheWrap(this.pageKey(vars), async () => {
      const res = await graphql<MediaPageResponse>(MEDIA_PAGE_QUERY, vars)
      return {
        media: res.Page?.media ?? [],
        hasNextPage: res.Page?.pageInfo?.hasNextPage ?? false,
      }
    })
  }

  async getTitles(): Promise<Title[]> {
    const { media } = await this.fetchPage({ sort: ['POPULARITY_DESC'] })
    return media.map(mediaToTitle)
  }

  async searchTitles(query: string): Promise<Title[]> {
    const q = query.trim()
    if (!q) return []
    const { media } = await this.fetchPage({ search: q, sort: ['SEARCH_MATCH'] }, 24)
    return media.map(mediaToTitle)
  }

  async getTitle(id: string): Promise<Title | null> {
    const numeric = Number(id)
    if (!Number.isFinite(numeric)) return null
    const res = await cacheWrap(`anilist:title:${id}`, async () =>
      graphql<MediaByIdResponse>(MEDIA_BY_ID_QUERY, { id: numeric }),
    )
    const media = res.Page?.media?.[0]
    return media ? mediaToTitle(media) : null
  }

  async getChapters(titleId: string): Promise<Chapter[]> {
    const title = await this.getTitle(titleId)
    if (!title || !title.chapterCount || title.chapterCount <= 0) return []
    const count = Math.min(title.chapterCount, MAX_GENERATED_CHAPTERS)
    const chapters: Chapter[] = []
    for (let n = 1; n <= count; n += 1) {
      chapters.push({
        id: chapterIdFor(titleId, n),
        providerId: 'anilist',
        titleId,
        chapterNumber: n,
        title: `Chapter ${n}`,
        publishedAt: title.updatedAt,
        updatedAt: title.updatedAt,
        // AniList provides chapter *count* metadata, not readable pages.
        available: false,
        pageCount: 0,
      })
    }
    return chapters
  }

  async getChapter(chapterId: string): Promise<Chapter | null> {
    const match = /^al-c-(\d+)-(\d+)$/.exec(chapterId)
    if (!match) return null
    const titleId = match[1]
    const n = Number(match[2])
    const chapters = await this.getChapters(titleId)
    return chapters.find((c) => c.chapterNumber === n) ?? null
  }

  async getChapterPages(_chapterId: string): Promise<ChapterPage[]> {
    // Metadata provider: no readable chapter pages. The reader shows the
    // "content unavailable" state with an official-source link instead.
    return []
  }

  async getGenres(): Promise<string[]> {
    const res = await cacheWrap('anilist:genres', async () =>
      graphql<GenreCollectionResponse>(GENRE_COLLECTION_QUERY, {}),
    )
    return res.GenreCollection ?? []
  }

  async getTrending(): Promise<Title[]> {
    const { media } = await this.fetchPage({ sort: ['TRENDING_DESC'] }, 12)
    return media.map(mediaToTitle)
  }

  async getPopular(): Promise<Title[]> {
    const { media } = await this.fetchPage({ sort: ['POPULARITY_DESC'] }, 12)
    return media.map(mediaToTitle)
  }

  async getLatest(): Promise<Title[]> {
    const { media } = await this.fetchPage({ sort: ['UPDATED_AT_DESC'] }, 12)
    return media.map(mediaToTitle)
  }

  async getLibrary(query: LibraryQuery): Promise<LibraryResult> {
    const sortMap: Record<LibraryQuery['sort'], string[]> = {
      LATEST: ['UPDATED_AT_DESC'],
      POPULAR: ['POPULARITY_DESC'],
      RATING: ['SCORE_DESC'],
      A_Z: ['TITLE_ROMAJI'],
    }
    const status = query.status && query.status !== 'ALL' ? query.status : undefined

    const result = await this.fetchPage(
      {
        search: query.search?.trim() || undefined,
        sort: sortMap[query.sort],
        genre: query.genre || undefined,
        status,
      },
      PER_PAGE,
      query.page ?? 1,
    )

    let titles = result.media.map(mediaToTitle)

    if (query.year) titles = titles.filter((t) => t.year === query.year)
    if (query.kind === 'MANHUA') titles = titles.filter((t) => t.type === 'MANHUA' || t.type === 'MANHWA')
    else if (query.kind && query.kind !== 'ALL') titles = titles.filter((t) => t.type === query.kind)

    return { titles, hasNextPage: result.hasNextPage }
  }
}
