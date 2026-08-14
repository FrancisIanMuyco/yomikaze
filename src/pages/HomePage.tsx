import { ChevronRight, Clock3, Play, Star } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { StatusBadge, TypeBadge } from '@/components/ui/Badge'
import { CoverImage } from '@/components/ui/CoverImage'
import { normalizeId } from '@/lib/utils'
import { EmptyState, ErrorState, SectionHeader } from '@/components/ui/States'
import { SkeletonGrid, SkeletonHero } from '@/components/ui/Skeletons'
import { TitleCard } from '@/components/ui/TitleCard'
import { useHistory } from '@/hooks/useHistory'
import { useLibraryIndex } from '@/hooks/useLibraryIndex'
import { getErrorMessage } from '@/lib/errors'
import { formatNumber } from '@/lib/utils'
import { provider } from '@/providers/ProviderFactory'
import type { Chapter, Title } from '@/types'

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
  const navigate = useNavigate()
  const { history } = useHistory()
  const { resolve: resolveTitle } = useLibraryIndex()
  const [trending, setTrending] = useState<Title[] | null>(null)
  const [popular, setPopular] = useState<Title[] | null>(null)
  const [latest, setLatest] = useState<Title[] | null>(null)
  const [heroChapters, setHeroChapters] = useState<Chapter[]>([])
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
        const heroCandidate = t.find((x) => x.bannerUrl) ?? t[0] ?? p[0] ?? null
        if (heroCandidate) {
          try {
            const chapters = await provider.getChapters(heroCandidate.id)
            if (alive) setHeroChapters(chapters)
          } catch {
            if (alive) setHeroChapters([])
          }
        }
      } catch (e) {
        if (alive) setError(getErrorMessage(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [retryKey])

  const hero = useMemo(() => trending?.find((x) => x.bannerUrl) ?? trending?.[0] ?? popular?.[0] ?? null, [trending, popular])

  const startReading = useCallback(() => {
    if (!hero) return
    const first = [...heroChapters]
      .sort((a, b) => a.chapterNumber - b.chapterNumber)
      .find((c) => c.available)
    if (first) {
      navigate(`/reader/${hero.id}/${first.id}`)
    } else {
      navigate(`/title/${hero.id}`)
    }
  }, [hero, heroChapters, navigate])

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

  return (
    <div className="space-y-12">
      {/* ------------------------------ Hero ------------------------------ */}
      {error ? (
        <ErrorState title="Could not load content" message={error} onRetry={() => setRetryKey((k) => k + 1)} />
      ) : !hero ? (
        <SkeletonHero />
      ) : (
        <section className="group relative overflow-hidden rounded-3xl border border-black/5 shadow-2xl shadow-black/30 dark:border-white/5">
          {/* Background */}
          <div className="absolute inset-0">
            <CoverImage
              src={hero.bannerUrl ?? hero.coverUrl}
              alt=""
              eager
              aspectClassName="aspect-auto"
              className="h-full w-full"
              imgClassName="ken-burns object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-night-950/95 via-night-950/70 to-night-950/20 dark:from-night-950/95 dark:via-night-950/70 dark:to-night-950/20" />
            <div className="absolute inset-0 bg-gradient-to-t from-night-950/95 via-transparent to-night-950/40" />
          </div>

          {/* Kanji watermark */}
          <span
            className="float pointer-events-none absolute -right-4 top-4 select-none font-display text-[9rem] font-black leading-none text-white/5 md:text-[13rem]"
            aria-hidden="true"
          >
            漫画
          </span>

            <div className="hero-stagger relative flex min-h-[440px] flex-col justify-end gap-5 p-6 pb-8 md:min-h-[520px] md:p-10">
              <div className="flex flex-wrap items-center gap-2">
                <TypeBadge type={hero.type} className="!bg-black/50 text-white" />
                <StatusBadge status={hero.status} className="!bg-black/50 text-white" />
                <span className="flex items-center gap-1 text-sm font-bold text-gold-300">
                  <Star className="h-4 w-4 fill-gold-400 text-gold-400" />
                  {hero.rating !== undefined ? (hero.rating / 10).toFixed(1) : '—'}
                  <span className="ml-1 text-xs font-medium text-zinc-400">· {formatNumber(hero.popularity)}</span>
                </span>
              </div>

              <h1 className="max-w-2xl font-display text-4xl font-black leading-tight tracking-tight text-white drop-shadow-lg md:text-6xl">
                {hero.title}
              </h1>

              <p className="line-clamp-3 max-w-xl text-sm leading-relaxed text-zinc-300 md:text-base">
                {hero.description}
              </p>

              <div className="flex flex-wrap gap-2">
                {hero.genres.slice(0, 5).map((genre) => (
                  <span
                    key={genre}
                    className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-zinc-300 backdrop-blur-sm"
                  >
                    {genre}
                  </span>
                ))}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={startReading}
                  className="gradient-shift inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-flame-600 via-flame-500 to-rose-500 px-6 py-3 text-sm font-bold uppercase tracking-wider text-white shadow-lg shadow-flame-600/40 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-flame-500/50 btn-press"
                >
                  <Play className="h-4 w-4 fill-current" />
                  Start Reading
                </button>
                <Link
                  to={`/title/${hero.id}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-bold uppercase tracking-wider text-white backdrop-blur-sm transition-all duration-200 hover:border-white/40 hover:bg-white/10 btn-press"
                >
                  View Details
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
        </section>
      )}

      {/* -------------------------- Continue reading -------------------------- */}
      {continueReading.length > 0 ? (
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
      ) : null}

      {/* ------------------------------ Trending ------------------------------ */}
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

      {/* --------------------------- Trending manhua --------------------------- */}
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

      {/* ------------------------------- Popular ------------------------------- */}
      <section>
        <SectionHeader title="Popular Right Now" kanji="今人気" />
        {popular === null ? <SkeletonGrid count={10} /> : <TitleGrid titles={(popular ?? []).slice(0, 10)} />}
      </section>

      {/* ------------------------------ Latest ------------------------------ */}
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

      {/* ---------------------------- Popular genres ---------------------------- */}
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
    </div>
  )
}
