import {
  ArrowDownAZ,
  ArrowUpAZ,
  BookOpen,
  Calendar,
  ChevronLeft,
  Heart,
  Play,
  Star,
  User,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { RatingBadge, StatusBadge, TypeBadge } from '@/components/ui/Badge'
import { CoverImage } from '@/components/ui/CoverImage'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { SkeletonChapterList, SkeletonDetail } from '@/components/ui/Skeletons'
import { useFavorites } from '@/hooks/useFavorites'
import { useHistory } from '@/hooks/useHistory'
import { useReadingProgress } from '@/hooks/useReadingProgress'
import { useSeo } from '@/hooks/useSeo'
import { getErrorMessage } from '@/lib/errors'
import { cn, formatDate, formatNumber, typeLabel } from '@/lib/utils'
import { provider } from '@/providers/ProviderFactory'
import type { Chapter, Title } from '@/types'

export function TitleDetailsPage() {
  const { id } = useParams<{ id: string }>()
  const [title, setTitle] = useState<Title | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [descExpanded, setDescExpanded] = useState(false)
  const [chapterSortAsc, setChapterSortAsc] = useState(false)

  const { isFavorite, toggleFavorite } = useFavorites()
  const { progress } = useReadingProgress()
  const { history } = useHistory()

  useSeo({
    title: title?.title,
    description: title?.description?.slice(0, 160),
    image: title?.coverUrl,
  })

  useEffect(() => {
    let alive = true
    if (!id) return
    setStatus('loading')
    setTitle(null)
    setChapters([])
    Promise.all([provider.getTitle(id), provider.getChapters(id)])
      .then(([t, chs]) => {
        if (!alive) return
        if (!t) {
          setStatus('error')
          setError('This title could not be found. It may have been removed.')
          return
        }
        setTitle(t)
        setChapters(chs)
        setStatus('done')
      })
      .catch((e) => {
        if (!alive) return
        setError(getErrorMessage(e))
        setStatus('error')
      })
    return () => {
      alive = false
    }
  }, [id])

  const sortedChapters = useMemo(() => {
    return [...chapters].sort((a, b) =>
      chapterSortAsc ? a.chapterNumber - b.chapterNumber : b.chapterNumber - a.chapterNumber,
    )
  }, [chapters, chapterSortAsc])

  const myProgress = title ? progress[title.id] : null
  const historyEntry = title ? history.find((h) => h.titleId === title.id) : null

  const firstAvailable = useMemo(
    () => [...chapters].sort((a, b) => a.chapterNumber - b.chapterNumber).find((c) => c.available),
    [chapters],
  )

  if (status === 'loading') {
    return (
      <div className="space-y-8">
        <SkeletonDetail />
        <div>
          <div className="skeleton mb-4 h-8 w-56 rounded-lg" />
          <SkeletonChapterList count={10} />
        </div>
      </div>
    )
  }

  if (status === 'error' || !title) {
    return (
      <div className="space-y-4">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-500 hover:text-flame-500"
        >
          <ChevronLeft className="h-4 w-4" /> Back home
        </Link>
        <ErrorState title="Title unavailable" message={error ?? undefined} />
      </div>
    )
  }

  const fav = isFavorite(title.id)
  const continueChapter = myProgress
    ? chapters.find((c) => c.id === myProgress.chapterId) ?? null
    : null

  return (
    <div className="space-y-8">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-500 transition-colors hover:text-flame-500"
      >
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>

      {/* Banner */}
      <div className="relative -mx-4 h-44 overflow-hidden rounded-3xl sm:mx-0 md:h-64">
        {title.bannerUrl ? (
          <>
            <CoverImage
              src={title.bannerUrl}
              alt=""
              eager
              aspectClassName="aspect-auto"
              className="h-full w-full"
              imgClassName="object-cover object-top"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-paper-50 via-paper-50/60 to-transparent dark:from-night-950 dark:via-night-950/70 dark:to-transparent" />
          </>
        ) : title.coverUrl ? (
          // No banner in the scraped data — use the cover as a blurred backdrop
          // so the header never shows a permanent loading skeleton.
          <>
            <CoverImage
              src={title.coverUrl}
              alt=""
              eager
              aspectClassName="aspect-auto"
              className="h-full w-full"
              imgClassName="scale-110 object-cover object-top opacity-40 blur-2xl"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-paper-50 via-paper-50/40 to-transparent dark:from-night-950 dark:via-night-950/60 dark:to-transparent" />
          </>
        ) : (
          <div className="h-full w-full bg-black/5 dark:bg-white/5" />
        )}
      </div>

      {/* Main info */}
      <div className="relative grid gap-8 md:grid-cols-[220px_1fr]">
        <div className="-mt-28 mx-auto w-44 shrink-0 md:mx-0 md:-mt-24 md:w-[220px]">
          <CoverImage
            src={title.coverUrl}
            alt={`${title.title} cover`}
            eager
            className="rounded-2xl border-4 border-white shadow-2xl shadow-black/40 dark:border-night-900"
            aspectClassName="aspect-[2/3]"
          />
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge type={title.type} />
            <StatusBadge status={title.status} />
            <RatingBadge rating={title.rating} />
          </div>

          <div>
            <h1 className="font-display text-3xl font-black tracking-tight text-zinc-900 dark:text-white md:text-5xl">
              {title.title}
            </h1>
            {title.alternativeTitles.length > 0 ? (
              <p className="mt-2 text-sm text-zinc-500">
                {title.alternativeTitles.join(' · ')}
                {title.nativeTitle ? <span className="ml-2 text-zinc-400">({title.nativeTitle})</span> : null}
              </p>
            ) : null}
          </div>

          {/* Stat row */}
          <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
            {title.rating !== undefined ? (
              <div>
                <dt className="text-xs uppercase tracking-wider text-zinc-500">Score</dt>
                <dd className="mt-0.5 flex items-center gap-1 font-bold text-gold-500 dark:text-gold-400">
                  <Star className="h-4 w-4 fill-gold-400 text-gold-400" />
                  {(title.rating / 10).toFixed(1)}
                </dd>
              </div>
            ) : null}
            {title.popularity !== undefined ? (
              <div>
                <dt className="text-xs uppercase tracking-wider text-zinc-500">Popularity</dt>
                <dd className="mt-0.5 font-bold">{formatNumber(title.popularity)}</dd>
              </div>
            ) : null}
            {title.year ? (
              <div>
                <dt className="text-xs uppercase tracking-wider text-zinc-500">Year</dt>
                <dd className="mt-0.5 flex items-center gap-1 font-bold">
                  <Calendar className="h-4 w-4 text-zinc-400" />
                  {title.year}
                </dd>
              </div>
            ) : null}
            {title.chapterCount !== undefined ? (
              <div>
                <dt className="text-xs uppercase tracking-wider text-zinc-500">Chapters</dt>
                <dd className="mt-0.5 flex items-center gap-1 font-bold">
                  <BookOpen className="h-4 w-4 text-zinc-400" />
                  {title.chapterCount}
                </dd>
              </div>
            ) : null}
            {title.author ? (
              <div>
                <dt className="text-xs uppercase tracking-wider text-zinc-500">Author</dt>
                <dd className="mt-0.5 flex items-center gap-1 font-bold">
                  <User className="h-4 w-4 text-zinc-400" />
                  {title.author}
                </dd>
              </div>
            ) : null}
          </dl>

          {/* Genres */}
          {title.genres.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {title.genres.map((genre) => (
                <Link
                  key={genre}
                  to={`/manga?genre=${encodeURIComponent(genre)}`}
                  className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-semibold text-zinc-600 transition-colors hover:border-flame-500/50 hover:text-flame-500 dark:border-white/10 dark:bg-night-800 dark:text-zinc-300 dark:hover:text-flame-400"
                >
                  {genre}
                </Link>
              ))}
            </div>
          ) : null}

          {/* Actions */}
          <div className="flex flex-wrap gap-3 pt-1">
            {firstAvailable ? (
              <Link
                to={`/reader/${title.id}/${firstAvailable.id}`}
                className="inline-flex items-center gap-2 rounded-xl bg-flame-600 px-5 py-3 text-sm font-bold uppercase tracking-wider text-white shadow-lg shadow-flame-600/25 transition-all hover:-translate-y-0.5 hover:bg-flame-500"
              >
                <Play className="h-4 w-4 fill-current" />
                Start Reading
              </Link>
            ) : chapters.length > 0 ? (
              <Link
                to={`/reader/${title.id}/${chapters[0].id}`}
                className="inline-flex items-center gap-2 rounded-xl bg-flame-600 px-5 py-3 text-sm font-bold uppercase tracking-wider text-white shadow-lg shadow-flame-600/25 transition-all hover:-translate-y-0.5 hover:bg-flame-500"
              >
                <Play className="h-4 w-4 fill-current" />
                Read Chapter {chapters[0].chapterNumber}
              </Link>
            ) : null}

            {continueChapter && myProgress ? (
              <Link
                to={`/reader/${title.id}/${continueChapter.id}`}
                className="inline-flex items-center gap-2 rounded-xl border border-gold-400/40 bg-gold-400/10 px-5 py-3 text-sm font-bold uppercase tracking-wider text-gold-500 transition-all hover:-translate-y-0.5 hover:bg-gold-400/20 dark:text-gold-300"
              >
                Continue — {Math.round(myProgress.progress * 100)}%
              </Link>
            ) : null}

            <button
              type="button"
              onClick={() => toggleFavorite(title)}
              aria-pressed={fav}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl border px-5 py-3 text-sm font-bold uppercase tracking-wider transition-all hover:-translate-y-0.5',
                fav
                  ? 'border-flame-500/60 bg-flame-500/15 text-flame-500 dark:text-flame-400'
                  : 'border-black/10 bg-white text-zinc-600 hover:border-flame-500/50 hover:text-flame-500 dark:border-white/10 dark:bg-night-850 dark:text-zinc-300',
              )}
            >
              <Heart className={cn('h-4 w-4', fav && 'fill-current')} />
              {fav ? 'Saved' : 'Add to Favorites'}
            </button>

          </div>

          {/* Description */}
          {title.description ? (
            <div className="max-w-3xl">
              <p
                className={cn(
                  'text-sm leading-relaxed text-zinc-600 dark:text-zinc-400',
                  !descExpanded && 'line-clamp-4',
                )}
              >
                {title.description}
              </p>
              {title.description.length > 280 ? (
                <button
                  type="button"
                  onClick={() => setDescExpanded((d) => !d)}
                  className="mt-1 text-xs font-bold text-flame-500 hover:text-flame-400"
                >
                  {descExpanded ? 'Show less' : 'Show more'}
                </button>
              ) : null}
            </div>
          ) : null}

          {title.updatedAt ? (
            <p className="text-xs text-zinc-500">Last updated {formatDate(title.updatedAt)}</p>
          ) : null}
        </div>
      </div>

      {/* Chapters */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Chapters
            <span className="ml-2 text-base font-medium text-zinc-500">({chapters.length})</span>
          </h2>
          <button
            type="button"
            onClick={() => setChapterSortAsc((a) => !a)}
            className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-zinc-600 transition-colors hover:border-flame-500/50 hover:text-flame-500 dark:border-white/10 dark:bg-night-850 dark:text-zinc-300 dark:hover:text-flame-400"
            aria-label={chapterSortAsc ? 'Sort chapters descending' : 'Sort chapters ascending'}
          >
            {chapterSortAsc ? <ArrowUpAZ className="h-4 w-4" /> : <ArrowDownAZ className="h-4 w-4" />}
            {chapterSortAsc ? 'Oldest first' : 'Newest first'}
          </button>
        </div>

        {chapters.length === 0 ? (
          <EmptyState
            title="No chapters listed"
            message={
              'This title has chapter count metadata but no chapter list is available from the provider.'
            }
          />
        ) : (
          <ul className="divide-y divide-black/5 overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:divide-white/5 dark:border-white/10 dark:bg-night-850">
            {sortedChapters.map((chapter) => {
              const isCurrent = myProgress?.chapterId === chapter.id
              const pct = isCurrent && myProgress ? Math.round(myProgress.progress * 100) : 0
              return (
                <li key={chapter.id}>
                  <Link
                    to={`/reader/${title.id}/${chapter.id}`}
                    className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                    aria-label={`Read ${chapter.title ?? `Chapter ${chapter.chapterNumber}`}`}
                  >
                    <span
                      className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-display text-sm font-bold',
                        chapter.available
                          ? 'bg-flame-500/10 text-flame-500 dark:text-flame-400'
                          : 'bg-black/5 text-zinc-400 dark:bg-white/5 dark:text-zinc-500',
                      )}
                    >
                      {chapter.chapterNumber}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                        {chapter.title ?? `Chapter ${chapter.chapterNumber}`}
                      </span>
                      <span className="block text-xs text-zinc-500">
                        {chapter.available ? (
                          <>
                            {chapter.pageCount} pages
                            {chapter.publishedAt ? ` · ${formatDate(chapter.publishedAt)}` : ''}
                          </>
                        ) : (
                          <>
                            Content not available on this provider
                            {chapter.publishedAt ? ` · ${formatDate(chapter.publishedAt)}` : ''}
                          </>
                        )}
                        {isCurrent ? ' · Reading' : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {isCurrent && pct > 0 ? (
                        <span className="rounded-full bg-gold-400/10 px-2 py-1 text-[11px] font-bold text-gold-500 dark:text-gold-300">
                          {pct}%
                        </span>
                      ) : null}
                      {!chapter.available ? (
                        <span
                          className="hidden rounded-full border border-black/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 sm:inline dark:border-white/10"
                          title="Chapter metadata only — no readable pages from this provider"
                        >
                          Metadata only
                        </span>
                      ) : null}
                      <Play className="h-4 w-4 text-zinc-300 transition-all group-hover:-translate-x-0.5 group-hover:text-flame-500" />
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}

        {chapters.length > 0 && historyEntry && (
          <p className="text-xs text-zinc-500">
            Last read {formatDate(historyEntry.timestamp)} · {typeLabel(title.type)} ·{' '}
            {title.genres.slice(0, 4).join(', ') || 'No genres listed'}
          </p>
        )}
      </section>
    </div>
  )
}
