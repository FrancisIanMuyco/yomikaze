import {
  Archive,
  ArrowDownAZ,
  ArrowUpAZ,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  Download,
  FileText,
  Heart,
  Loader2,
  Play,
  Star,
  User,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { downloadChapterPdf, downloadChapterZip, downloadTitleZip } from '@/lib/exportFiles'
import {
  cancelAllForTitle,
  cancelDownload,
  downloadChapter,
  downloadTitleChapters,
  isSupported,
  persistStorage,
  phaseFor,
  removeDownload,
  subscribeDownloads,
} from '@/lib/offline'
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

  /* --------------------------- offline downloads --------------------------- */
  const [dlTick, setDlTick] = useState(0)
  const [dlAll, setDlAll] = useState<{ done: number; total: number } | null>(null)
  const [dlMessage, setDlMessage] = useState<string | null>(null)

  /* --------------------------- file exports (zip / pdf) --------------------------- */
  const [exp, setExp] = useState<{
    scope: 'chapter' | 'all'
    id?: string
    kind: 'zip' | 'pdf'
    done: number
    total: number
  } | null>(null)
  const [expMessage, setExpMessage] = useState<string | null>(null)

  useEffect(() => subscribeDownloads(() => setDlTick((t) => t + 1)), [])

  const downloadedCount = useMemo(
    () => chapters.filter((c) => phaseFor(c.id) === 'downloaded').length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chapters, dlTick],
  )

  const downloadableChapters = useMemo(
    () => chapters.filter((c) => c.available && (c.pageCount ?? 0) > 0),
    [chapters],
  )

  const startChapterDownload = useCallback(
    async (chapter: Chapter) => {
      const phase = phaseFor(chapter.id)
      if (phase === 'downloading') {
        cancelDownload(chapter.id)
        return
      }
      if (phase === 'downloaded') {
        if (window.confirm('Remove this downloaded chapter?')) {
          void removeDownload(chapter.id).catch(() => undefined)
        }
        return
      }
      if ((chapter.pageCount ?? 0) === 0) return
      if (!isSupported()) {
        setDlMessage('Offline downloads are not supported in this browser')
        return
      }
      setDlMessage(null)
      void persistStorage()
      try {
        const titleId = title?.id ?? ''
        const chapterPages = await provider.getChapterPages(chapter.id)
        await downloadChapter(chapter.id, chapterPages, {
          titleId,
          title: title?.title ?? chapter.title ?? '',
          chapterLabel: chapter.title ?? `Chapter ${chapter.chapterNumber}`,
        })
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setDlMessage('Chapter download failed — check your connection')
      }
    },
    [title],
  )

  const startAllDownload = useCallback(() => {
    if (!title) return
    if (dlAll) {
      cancelAllForTitle(title.id)
      return
    }
    if (downloadableChapters.length === 0) {
      setDlMessage('No chapters with readable pages to download')
      return
    }
    setDlMessage(null)
    setDlAll({ done: 0, total: downloadableChapters.length })
    void persistStorage()
    downloadTitleChapters(
      title,
      downloadableChapters,
      (ch) => provider.getChapterPages(ch.id),
      (done, total) => setDlAll({ done, total }),
      () => setDlAll(null),
    )
      .then(() => setDlAll(null))
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') {
          setDlAll(null)
          setDlMessage('Download stopped — some chapters failed')
        }
      })
  }, [title, dlAll, downloadableChapters])

  const startChapterExport = useCallback(
    async (chapter: Chapter, kind: 'zip' | 'pdf') => {
      if ((chapter.pageCount ?? 0) === 0 || exp) return
      setExpMessage(null)
      try {
        const pages = await provider.getChapterPages(chapter.id)
        if (pages.length === 0) return
        setExp({ scope: 'chapter', id: chapter.id, kind, done: 0, total: pages.length })
        const base = `${title?.title ?? 'chapter'} - Ch ${chapter.chapterNumber}`
        const onProgress = (done: number, total: number) =>
          setExp((e) => (e ? { ...e, done, total } : e))
        if (kind === 'zip') {
          await downloadChapterZip(pages, base, onProgress)
        } else {
          await downloadChapterPdf(pages, base, onProgress)
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setExpMessage(typeof err === 'string' ? err : ((err as Error)?.message ?? 'Export failed'))
        }
      } finally {
        setExp(null)
      }
    },
    [exp, title],
  )

  const startAllExport = useCallback(async () => {
    if (!title || exp || downloadableChapters.length === 0) return
    setExpMessage(null)
    setExp({ scope: 'all', kind: 'zip', done: 0, total: downloadableChapters.length })
    try {
      await downloadTitleZip(
        downloadableChapters,
        (ch) => provider.getChapterPages(ch.id),
        title.title,
        (done, total) => setExp((e) => (e ? { ...e, done, total } : e)),
      )
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setExpMessage(typeof err === 'string' ? err : ((err as Error)?.message ?? 'Export failed'))
      }
    } finally {
      setExp(null)
    }
  }, [exp, title, downloadableChapters])

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
          <h2 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Chapters
            <span className="ml-2 text-base font-medium text-zinc-500">
              ({chapters.length}
              {downloadedCount > 0 ? ` · ${downloadedCount} saved` : ''})
            </span>
          </h2>
          <div className="flex items-center gap-2">
            {dlMessage ? (
              <span className="hidden max-w-[220px] truncate text-xs text-rose-500 sm:inline dark:text-rose-400">
                {dlMessage}
              </span>
            ) : expMessage ? (
              <span className="hidden max-w-[220px] truncate text-xs text-rose-500 sm:inline dark:text-rose-400">
                {expMessage}
              </span>
            ) : null}
            <button
              type="button"
              onClick={startAllDownload}
              disabled={!isSupported() || downloadableChapters.length === 0}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40',
                dlAll
                  ? 'border border-flame-500/40 bg-flame-500/10 text-flame-500 dark:text-flame-400'
                  : downloadedCount > 0
                    ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border border-black/10 bg-white text-zinc-600 hover:border-flame-500/50 hover:text-flame-500 dark:border-white/10 dark:bg-night-850 dark:text-zinc-300 dark:hover:text-flame-400',
              )}
              aria-label={dlAll ? 'Cancel download of all chapters' : 'Download all chapters for offline reading'}
            >
              {dlAll ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : downloadedCount > 0 ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {dlAll ? (
                `Stop ${dlAll.done}/${dlAll.total}`
              ) : downloadedCount > 0 ? (
                `Saved ${downloadedCount}`
              ) : (
                `Download all${downloadableChapters.length ? ` (${downloadableChapters.length})` : ''}`
              )}
            </button>
            <button
              type="button"
              onClick={() => void startAllExport()}
              disabled={!!exp || downloadableChapters.length === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-zinc-600 transition-colors hover:border-flame-500/50 hover:text-flame-500 disabled:pointer-events-none disabled:opacity-40 dark:border-white/10 dark:bg-night-850 dark:text-zinc-300 dark:hover:text-flame-400"
              aria-label="Download every chapter as one organized ZIP file"
            >
              {exp?.scope === 'all' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Archive className="h-4 w-4" />
              )}
              {exp?.scope === 'all'
                ? `ZIP ${exp.done}/${exp.total}`
                : `All chapters (ZIP)`}
            </button>
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
              const dlPhase = phaseFor(chapter.id)
              const hasPages = (chapter.pageCount ?? 0) > 0
              return (
                <li key={chapter.id} className="flex items-center">
                  <Link
                    to={`/reader/${title.id}/${chapter.id}`}
                    className="group flex min-w-0 flex-1 items-center gap-4 px-4 py-3.5 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
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
                            {hasPages ? `${chapter.pageCount} pages` : 'No readable pages'}
                            {chapter.publishedAt ? ` · ${formatDate(chapter.publishedAt)}` : ''}
                          </>
                        ) : (
                          <>
                            Content not available on this provider
                            {chapter.publishedAt ? ` · ${formatDate(chapter.publishedAt)}` : ''}
                          </>
                        )}
                        {isCurrent ? ' · Reading' : ''}
                        {dlPhase === 'downloaded' ? ' · Downloaded' : ''}
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
                  <span className="flex shrink-0 items-center gap-1 pr-4">
                    <button
                      type="button"
                      onClick={() => void startChapterExport(chapter, 'zip')}
                      disabled={!!exp || !hasPages}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-black/5 hover:text-flame-500 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-white/5 dark:hover:text-flame-400"
                      aria-label={`Save Chapter ${chapter.chapterNumber} as a ZIP file`}
                      title={hasPages ? 'Save as ZIP file' : 'No readable pages'}
                    >
                      {exp?.scope === 'chapter' && exp.id === chapter.id && exp.kind === 'zip' ? (
                        <Loader2 className="h-4 w-4 animate-spin text-flame-400" />
                      ) : (
                        <Archive className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void startChapterExport(chapter, 'pdf')}
                      disabled={!!exp || !hasPages}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-black/5 hover:text-flame-500 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-white/5 dark:hover:text-flame-400"
                      aria-label={`Save Chapter ${chapter.chapterNumber} as a PDF file`}
                      title={hasPages ? 'Save as PDF file' : 'No readable pages'}
                    >
                      {exp?.scope === 'chapter' && exp.id === chapter.id && exp.kind === 'pdf' ? (
                        <Loader2 className="h-4 w-4 animate-spin text-flame-400" />
                      ) : (
                        <FileText className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void startChapterDownload(chapter)}
                      disabled={!isSupported() || !hasPages}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-black/5 hover:text-white disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-white/5"
                      aria-label={
                        dlPhase === 'downloading'
                          ? `Cancel download of Chapter ${chapter.chapterNumber}`
                          : dlPhase === 'downloaded'
                            ? `Remove download of Chapter ${chapter.chapterNumber}`
                            : `Download Chapter ${chapter.chapterNumber}`
                      }
                      title={
                        dlPhase === 'downloading'
                          ? 'Downloading — tap to cancel'
                          : dlPhase === 'downloaded'
                            ? 'Downloaded — tap to remove'
                            : hasPages
                              ? 'Download for offline reading'
                              : 'No readable pages'
                      }
                    >
                      {dlPhase === 'downloading' ? (
                        <Loader2 className="h-4 w-4 animate-spin text-flame-400" />
                      ) : dlPhase === 'downloaded' ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </button>
                  </span>
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
