import { Clock3 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { CoverImage } from '@/components/ui/CoverImage'
import { normalizeId } from '@/lib/utils'
import { EmptyState, ErrorState, SectionHeader } from '@/components/ui/States'
import { SkeletonGrid, SkeletonHero } from '@/components/ui/Skeletons'
import { Reveal } from '@/components/ui/Reveal'
import { TitleCard } from '@/components/ui/TitleCard'
import { HeroCarousel } from '@/components/home/HeroCarousel'
import { useHistory } from '@/hooks/useHistory'
import { useLibraryIndex } from '@/hooks/useLibraryIndex'
import { getErrorMessage } from '@/lib/errors'
import { provider } from '@/providers/ProviderFactory'
import type { Title } from '@/types'

const POPULAR_GENRES = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Fantasy',
  'Romance',
  'Martial Arts',
  'School Life',
  'Mystery',
  'Horror',
  'Historical',
  'Sci-Fi',
]

// Recently imported manga, newest first. Kept in code so the row is stable and
// intentional — flip forward whenever a new batch lands in the library.
const NEW_TO_YOMIKAZE = [
  'Naruto',
  'One Piece',
  'Hunter x Hunter',
  'One Punch-Man',
  'Tenchura! Tensei Shitara Slime Datta Ken',
  'My Isekai Life: I Gained a Second Character Class and Became the Strongest Sage in the World!',
  'A Savage Proposal',
  'Hero Organization',
]

function GenreRail() {
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      {POPULAR_GENRES.map((genre) => (
        <Link
          key={genre}
          to={`/manga?genre=${encodeURIComponent(genre)}`}
          className="btn-press shrink-0 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-zinc-600 transition-all duration-200 hover:-translate-y-0.5 hover:border-flame-500/50 hover:text-flame-500 hover:shadow-lg hover:shadow-flame-500/10 dark:border-white/10 dark:bg-night-800 dark:text-zinc-400 dark:hover:border-flame-500/50 dark:hover:text-flame-400"
        >
          {genre}
        </Link>
      ))}
    </div>
  )
}

function TitleGrid({ titles, className }: { titles: Title[]; className?: string }) {
  return (
    <div
      className={`stagger-children grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 ${className ?? ''}`}
    >
      {titles.map((title) => (
        <TitleCard key={title.id} title={title} />
      ))}
    </div>
  )
}

export function HomePage() {
  const { history } = useHistory()
  const { index, resolve: resolveTitle } = useLibraryIndex()
  const [trending, setTrending] = useState<Title[] | null>(null)
  const [popular, setPopular] = useState<Title[] | null>(null)
  const [latest, setLatest] = useState<Title[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let alive = true
    setError(null)
    setTrending(null)
    ;(async () => {
      try {
        const [t, p, l] = await Promise.all([
          provider.getTrending(),
          provider.getPopular(),
          provider.getLatest(),
        ])
        if (!alive) return
        setTrending(t)
        setPopular(p)
        setLatest(l)
      } catch (e) {
        if (alive) setError(getErrorMessage(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [retryKey])

  // Slides for the auto-playing hero carousel: prefer titles with real banners
  // (premium look); fall back to the trending list, then popular.
  const heroSlides = useMemo(() => {
    const t = trending ?? []
    const source = t.length ? (t.filter((x) => x.bannerUrl).length >= 2 ? t.filter((x) => x.bannerUrl) : t) : (popular ?? [])
    return source.slice(0, 6)
  }, [trending, popular])

  // Resolve stale snapshots against the live library, drop chapters that are
  // 100%% complete (nahuman na — naa ra sila sa History page), and dedupe by
  // resolved title id (a stale slug + the current slug resolve to one series).
  const continueReading = useMemo(() => {
    const seen = new Set<string>()
    const out: Array<(typeof history)[number] & { current?: Title }> = []
    for (const h of history) {
      if (!(h.progress > 0 && h.progress < 1)) continue
      const current = resolveTitle(h.titleId)
      // Dedupe key: the resolved title id when available, else the raw id.
      const key = current?.id ?? h.titleId
      if (seen.has(key)) continue
      seen.add(key)
      out.push(current ? { ...h, current } : h)
      if (out.length >= 8) break
    }
    return out
  }, [history, resolveTitle])

  // Resolve stale chapter ids for Continue Reading entries (old slug format
  // e.g. `God Level Assassin-114` vs current `God-Level Assassin, I'm the
  // Shadow-114`) so the links point at the live chapter directly.
  const [resolvedChapters, setResolvedChapters] = useState<Record<string, string>>({})
  useEffect(() => {
    let alive = true
    ;(async () => {
      const next: Record<string, string> = {}
      for (const entry of continueReading) {
        const key = `${entry.titleId}:${entry.chapterId}`
        const resolvedTitle = resolveTitle(entry.titleId)
        if (!resolvedTitle) continue
        // Chapter ids are `<slug>-<number>` in the scraped store; when the
        // slug changed, rebuild the current id from the chapter number.
        const num = /-(\d+)$/.exec(entry.chapterId)?.[1]
        if (!num) continue
        const chapters = await provider.getChapters(resolvedTitle.id).catch(() => [])
        const target =
          chapters.find((c) => c.chapterNumber === Number(num)) ??
          chapters.find((c) => normalizeId(c.id) === normalizeId(entry.chapterId))
        if (target) next[key] = target.id
        if (!alive) return
      }
      if (alive) setResolvedChapters(next)
    })()
    return () => {
      alive = false
    }
  }, [continueReading, resolveTitle])

  const trendingManga = useMemo(() => (trending ?? []).filter((t) => t.type === 'MANGA').slice(0, 10), [trending])
  const trendingManhua = useMemo(
    () => (trending ?? []).filter((t) => t.type === 'MANHUA' || t.type === 'MANHWA').slice(0, 10),
    [trending],
  )

  const newTitles = useMemo(() => {
    const byTitle = new Map<string, Title>()
    for (const t of index.values()) byTitle.set(normalizeId(t.title), t)
    const out: Title[] = []
    for (const name of NEW_TO_YOMIKAZE) {
      const t = byTitle.get(normalizeId(name))
      if (t) out.push(t)
    }
    return out
  }, [index])

  return (
    <div className="space-y-12">
      {/* ------------------------------ Hero ------------------------------ */}
      {error ? (
        <ErrorState title="Could not load content" message={error} onRetry={() => setRetryKey((k) => k + 1)} />
      ) : heroSlides.length === 0 ? (
        <SkeletonHero />
      ) : (
        <HeroCarousel slides={heroSlides} />
      )}

      {/* ------------------------------ New to Yomikaze ------------------------------ */}
      {newTitles.length > 0 ? (
        <Reveal>
          <section>
            <SectionHeader
              title="New to Yomikaze"
              kanji="新着"
              action={
                <Link to="/manga" className="text-sm font-semibold text-flame-500 hover:text-flame-400">
                  View all
                </Link>
              }
            />
            <TitleGrid titles={newTitles} />
          </section>
        </Reveal>
      ) : null}

      {/* -------------------------- Continue reading -------------------------- */}
      {continueReading.length > 0 ? (
        <Reveal>
        <section>
          <SectionHeader title="Continue Reading" kanji="続きから" action={
            <Link to="/history" className="text-sm font-semibold text-flame-500 hover:text-flame-400">
              View history
            </Link>
          } />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {continueReading.map((entry) => {
              const resolved = 'current' in entry ? entry.current : undefined
              const titleId = resolved?.id ?? entry.titleId
              const titleName = resolved?.title ?? entry.title.title
              const coverUrl = resolved?.coverUrl ?? entry.title.coverUrl
              const chapterId = resolvedChapters[`${entry.titleId}:${entry.chapterId}`] ?? entry.chapterId
              const pct = Math.round(entry.progress * 100)
              return (
                <Link
                  key={entry.titleId}
                  to={`/reader/${titleId}/${chapterId}`}
                  className="group relative overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm card-hover img-zoom dark:border-white/5 dark:bg-night-850"
                >
                  <CoverImage
                    src={coverUrl}
                    alt={`${titleName} cover`}
                    className="aspect-[2/3]"
                  />
                  <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/40 to-transparent p-3">
                    <h3 className="line-clamp-2 font-display text-sm font-bold text-white">{titleName}</h3>
                    <p className="mt-0.5 text-[11px] text-zinc-300">Chapter {entry.chapterNumber}</p>
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-flame-300">
                      <Clock3 className="h-3 w-3" />
                      {pct >= 100 ? 'Completed — Read again' : `${pct}% — Continue`}
                    </div>
                  </div>
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
                    <div
                      className="h-full bg-gradient-to-r from-flame-600 to-flame-400 transition-all duration-700 ease-out"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      </Reveal>
      ) : null}

      {/* ------------------------------ Trending ------------------------------ */}
      <Reveal>
        <section>
        <SectionHeader
          title="Trending Manga"
          kanji="人気漫画"
          action={
            <Link to="/manga" className="text-sm font-semibold text-flame-500 hover:text-flame-400">
              View all
            </Link>
          }
        />
        {trending === null ? (
          <SkeletonGrid count={10} />
        ) : trendingManga.length > 0 ? (
          <TitleGrid titles={trendingManga} />
        ) : (
          <EmptyState title="No manga trending right now" />
        )}
      </section>
      </Reveal>

      {/* --------------------------- Trending manhua --------------------------- */}
      <Reveal>
        <section>
        <SectionHeader
          title="Trending Manhua & Manhwa"
          kanji="人気漫画（中国・韓国）"
          action={
            <Link to="/manhua" className="text-sm font-semibold text-flame-500 hover:text-flame-400">
              View all
            </Link>
          }
        />
        {trending === null ? (
          <SkeletonGrid count={10} />
        ) : trendingManhua.length > 0 ? (
          <TitleGrid titles={trendingManhua} />
        ) : (
          <EmptyState title="No manhua trending right now" />
        )}
      </section>
      </Reveal>

      {/* ------------------------------- Popular ------------------------------- */}
      <Reveal>
        <section>
        <SectionHeader title="Popular Right Now" kanji="今人気" />
        {popular === null ? <SkeletonGrid count={10} /> : <TitleGrid titles={(popular ?? []).slice(0, 10)} />}
      </section>
      </Reveal>

      {/* ------------------------------ Latest ------------------------------ */}
      <Reveal>
        <section>
        <SectionHeader
          title="Latest Updates"
          kanji="最新更新"
          action={
            <Link to="/manga?sort=LATEST" className="text-sm font-semibold text-flame-500 hover:text-flame-400">
              View all
            </Link>
          }
        />
        {latest === null ? <SkeletonGrid count={10} /> : <TitleGrid titles={(latest ?? []).slice(0, 10)} />}
      </section>
      </Reveal>

      {/* ---------------------------- Popular genres ---------------------------- */}
      <Reveal>
        <section>
        <SectionHeader
          title="Popular Genres"
          kanji="ジャンル"
          action={
            <Link to="/genres" className="text-sm font-semibold text-flame-500 hover:text-flame-400">
              All genres
            </Link>
          }
        />
        <GenreRail />
      </section>
      </Reveal>
    </div>
  )
}
