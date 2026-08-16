import {
  ArrowLeft,
  ArrowLeftCircle,
  ArrowRight,
  ArrowRightCircle,
  BookOpen,
  ChevronUp,
  Expand,
  ExternalLink,
  Eye,
  EyeOff,
  ImageOff,
  List,
  Maximize2,
  Minimize2,
  RefreshCw,
  Settings2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ErrorState, PageSpinner } from '@/components/ui/States'
import { useHistory } from '@/hooks/useHistory'
import { useReadingProgress } from '@/hooks/useReadingProgress'
import { useSeo } from '@/hooks/useSeo'
import { getErrorMessage } from '@/lib/errors'
import { cn, normalizeId, readLocalJson, writeLocalJson } from '@/lib/utils'
import { provider } from '@/providers/ProviderFactory'
import type { Chapter, ChapterPage, Title } from '@/types'

type ReaderMode = 'paged' | 'vertical'
type FitMode = 'width' | 'height'

function readSetting<T>(key: string, fallback: T): T {
  return readLocalJson<T>(key, fallback)
}

/* ------------------------------------------------------------------ */
/* Stale-link resolution                                               */
/* ------------------------------------------------------------------ */

/**
 * Try to resolve a stale reader link (old mangafire slug format, dead
 * history snapshots) against the current library by normalized fuzzy
 * matching, and navigate to the correct URL when a match is found.
 */
async function resolveStaleReaderLink(
  titleId: string,
  chapterId: string,
  navigate: ReturnType<typeof useNavigate>,
): Promise<boolean> {
  try {
    const titles = await provider.getTitles()
    const reqTitleNorm = normalizeId(titleId)
    // Find a title whose normalized id contains the requested one (or vice
    // versa) — covers old slug drops like "God Level Assassin" →
    // "God-Level Assassin, I'm the Shadow".
    const match = titles.find(t => {
      const norm = normalizeId(t.id)
      return reqTitleNorm.length > 0 && (norm.includes(reqTitleNorm) || reqTitleNorm.includes(norm))
    })
    if (!match) return false
    // Match the chapter by trailing number (old ids end with `-114`).
    const numMatch = /-(\d+)$/.exec(chapterId)
    const chapters = await provider.getChapters(match.id)
    const target = numMatch
      ? chapters.find(c => c.chapterNumber === Number(numMatch[1]))
      : chapters.find(c => normalizeId(c.id) === normalizeId(chapterId))
    if (!target) return false
    navigate(`/reader/${match.id}/${target.id}`, { replace: true })
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* Per-page image with skeleton + broken-image fallback                */
/* ------------------------------------------------------------------ */

function ReaderPageImage({
  page,
  eager = false,
  fit = 'width',
  fitClass,
  zoom = 1,
}: {
  page: ChapterPage
  eager?: boolean
  fit?: 'width' | 'height'
  fitClass?: string
  zoom?: number
}) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const heightFit = fit === 'height'

  // Zoom: fit-width images are capped at ~56rem so they don't fill the whole
  // screen on big monitors; fit-height scales by the zoom factor.
  const zoomStyle = heightFit
    ? { height: `${zoom * 100}%` }
    : { maxWidth: `min(100%, ${Math.round(56 * 16 * zoom)}px)` }

  return (
    <div
      className={cn('relative flex w-full items-center justify-center', fitClass)}
      style={{ aspectRatio: page.width && page.height ? `${page.width} / ${page.height}` : undefined }}
    >
      {status !== 'loaded' ? (
        <div className={cn('skeleton absolute inset-0 rounded-md', status === 'error' && '!bg-transparent')}>
          {status === 'error' ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-md bg-black/60 p-6 text-center">
              <ImageOff className="h-8 w-8 text-zinc-500" />
              <p className="text-sm text-zinc-400">This page could not be loaded.</p>
              <button
                type="button"
                onClick={() => {
                  setAttempt((a) => a + 1)
                  setStatus('loading')
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-flame-500/50 hover:text-flame-300"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry page
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <img
        key={`${page.imageUrl}:${attempt}`}
        src={page.imageUrl}
        alt={page.alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
        className={cn(
          'select-none object-contain transition-opacity duration-300',
          status === 'loaded' ? 'opacity-100' : 'opacity-0',
          heightFit ? 'h-full max-w-full w-auto' : 'w-full h-auto',
        )}
        style={zoomStyle}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Reader                                                              */
/* ------------------------------------------------------------------ */

export function ReaderPage() {
  const { titleId = '', chapterId = '' } = useParams()
  const navigate = useNavigate()
  const { saveProgress, progress } = useReadingProgress()
  const { recordHistory } = useHistory()

  const [title, setTitle] = useState<Title | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [pages, setPages] = useState<ChapterPage[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  const [mode, setMode] = useState<ReaderMode>(() => readSetting('yomikaze:reader-mode', 'vertical'))
  const [fit, setFit] = useState<FitMode>(() => readSetting('yomikaze:reader-fit', 'width'))
  const [zoom, setZoom] = useState(() => readSetting('yomikaze:reader-zoom', 1))
  const [currentPage, setCurrentPage] = useState(0)
  const [controlsHidden, setControlsHidden] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState<'chapters' | 'settings' | null>(null)

  // Auto-hide the top/bottom bars while reading: any mousemove, scroll or tap
  // shows them again, then they fade out after a short idle period.
  const [autoHide, setAutoHide] = useState(() => readSetting('yomikaze:reader-auto-hide', true))
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const wakeControls = useCallback(() => {
    setControlsHidden(false)
    if (!autoHide) return
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      setControlsHidden(true)
    }, 2600)
  }, [autoHide])

  useEffect(() => {
    wakeControls()
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, wakeControls])

  const changeAutoHide = (v: boolean) => {
    setAutoHide(v)
    writeLocalJson('yomikaze:reader-auto-hide', v)
    if (v) wakeControls()
    else {
      setControlsHidden(false)
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Array<HTMLDivElement | null>>([])
  const pagedScrollRef = useRef<HTMLDivElement>(null)
  const touchX = useRef<number | null>(null)

  useSeo({
    title: chapter ? `${chapter.title ?? `Chapter ${chapter.chapterNumber}`} · ${title?.title ?? 'Reading'}` : 'Reader',
  })

  /* ------------------------------ load ------------------------------ */
  useEffect(() => {
    let alive = true
    setStatus('loading')
    setError(null)
    setTitle(null)
    setChapter(null)
    setPages([])
    ;(async () => {
      try {
        const [t, chs, ch, pgs] = await Promise.all([
          provider.getTitle(titleId),
          provider.getChapters(titleId),
          provider.getChapter(chapterId),
          provider.getChapterPages(chapterId),
        ])
        if (!alive) return
        if (!t || !ch) {
          // Stale link (old slug format / dead history snapshot) — try to
          // resolve against the current library before giving up.
          const resolved = await resolveStaleReaderLink(titleId, chapterId, navigate)
          if (!alive) return
          if (resolved) return
          setStatus('error')
          setError('This chapter could not be found.')
          return
        }
        setTitle(t)
        setChapters(chs)
        setChapter(ch)
        setPages(pgs)

        const saved = progress[titleId]
        const resume =
          saved && saved.chapterId === chapterId
            ? Math.max(0, Math.min(saved.pageNumber - 1, Math.max(pgs.length - 1, 0)))
            : 0
        setCurrentPage(resume)
        setStatus('ready')
      } catch (e) {
        if (alive) {
          setError(getErrorMessage(e))
          setStatus('error')
        }
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleId, chapterId, retryKey])

  /* ------------------------ chapter navigation ------------------------ */
  const sortedChapters = useMemo(
    () => [...chapters].sort((a, b) => a.chapterNumber - b.chapterNumber),
    [chapters],
  )
  const chapterIndex = sortedChapters.findIndex((c) => c.id === chapterId)
  const prevChapter = chapterIndex > 0 ? sortedChapters[chapterIndex - 1] : null
  const nextChapter = chapterIndex >= 0 && chapterIndex < sortedChapters.length - 1 ? sortedChapters[chapterIndex + 1] : null

  const goToChapter = useCallback(
    (c: Chapter) => {
      if (!c) return
      setDrawerOpen(null)
      navigate(`/reader/${titleId}/${c.id}`)
    },
    [navigate, titleId],
  )

  /* ------------------------- progress + history ------------------------ */
  const progressPct = pages.length > 0 ? (currentPage + 1) / pages.length : 0

  useEffect(() => {
    if (status !== 'ready' || pages.length === 0 || !chapter || !title) return
    saveProgress({
      titleId: title.id,
      chapterId: chapter.id,
      pageNumber: currentPage + 1,
      progress: progressPct,
    })
    recordHistory({
      titleId: title.id,
      title: {
        id: title.id,
        title: title.title,
        coverUrl: title.coverUrl,
        type: title.type,
      },
      chapterId: chapter.id,
      chapterNumber: chapter.chapterNumber,
      chapterTitle: chapter.title,
      pageNumber: currentPage + 1,
      totalPages: pages.length,
      progress: progressPct,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, status, chapter?.id, pages.length])

  /* ------------------------------- paging ------------------------------- */
  const nextPage = useCallback(() => {
    setCurrentPage((prev) => {
      if (pages.length === 0) return prev
      if (prev >= pages.length - 1) return prev
      return prev + 1
    })
  }, [pages.length])

  // When moving between pages in paged mode, start from the top of the page
  // (tall fit-width pages are scrollable inside the reader).
  useEffect(() => {
    if (mode === 'paged' && pagedScrollRef.current) {
      pagedScrollRef.current.scrollTop = 0
    }
  }, [mode, currentPage])

  const prevPage = useCallback(() => {
    setCurrentPage((prev) => Math.max(0, prev - 1))
  }, [])

  // Tap the middle of the reader to show/hide the control bars.
  const toggleControls = useCallback(() => {
    setControlsHidden((hidden) => {
      if (hidden) wakeControls()
      return !hidden
    })
  }, [wakeControls])

  // Jump to an arbitrary page from the seek slider: scroll in vertical mode,
  // flip in paged mode.
  const seekPage = useCallback(
    (i: number) => {
      const idx = Math.max(0, Math.min(i, pages.length - 1))
      if (mode === 'vertical' && scrollRef.current && pageRefs.current[idx]) {
        pageRefs.current[idx]?.scrollIntoView({ block: 'nearest' })
      } else {
        setCurrentPage(idx)
      }
    },
    [mode, pages.length],
  )

  /* --------------------------- image preloading --------------------------- */
  // Warm the browser cache for the next few pages so turning/scrolling into
  // them is instant (works for both paged and vertical modes).
  useEffect(() => {
    if (status !== 'ready' || pages.length === 0) return
    const urls = new Set<string>()
    for (let i = currentPage + 1; i <= Math.min(currentPage + 4, pages.length - 1); i++) {
      const url = pages[i].imageUrl
      if (url) urls.add(url)
    }
    urls.forEach((url) => {
      const img = new Image()
      img.src = url
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pages, status])

  /* --------------------------- vertical scroll --------------------------- */
  const handleScroll = useCallback(() => {
    if (mode !== 'vertical' || !scrollRef.current) return
    const container = scrollRef.current
    const mid = container.getBoundingClientRect().top + container.clientHeight / 2
    let best = 0
    let bestDist = Number.POSITIVE_INFINITY
    pageRefs.current.forEach((el, i) => {
      if (!el) return
      const rect = el.getBoundingClientRect()
      const center = rect.top + rect.height / 2
      const dist = Math.abs(center - mid)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    })
    setCurrentPage((prev) => (prev === best ? prev : best))
  }, [mode])

  /* ------------------------------ keyboard ------------------------------ */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
        setDrawerOpen(null)
        return
      }
      if (drawerOpen) return
      // Don't hijack keys while an interactive control has focus (e.g. Space on a button).
      if (e.target instanceof HTMLElement && e.target.closest('button, a, select, input, textarea, [role="button"]')) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (mode === 'vertical') {
          scrollRef.current?.scrollBy({ top: -(scrollRef.current.clientHeight * 0.85) })
        } else {
          prevPage()
        }
      } else if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault()
        if (mode === 'vertical') {
          scrollRef.current?.scrollBy({ top: scrollRef.current.clientHeight * 0.85 })
        } else if (mode === 'paged') {
          // Scroll tall fit-width pages first; only advance at the bottom.
          const scroller = pagedScrollRef.current
          const nearBottom = scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60
          if (scroller && !nearBottom && e.key === ' ') {
            scroller.scrollBy({ top: scroller.clientHeight * 0.85 })
          } else {
            nextPage()
          }
        } else {
          nextPage()
        }
      } else if (e.key === 'PageDown') {
        e.preventDefault()
        if (mode === 'vertical') {
          scrollRef.current?.scrollBy({ top: scrollRef.current.clientHeight * 0.9 })
        } else {
          nextPage()
        }
      } else if (e.key === 'PageUp') {
        e.preventDefault()
        if (mode === 'vertical') {
          scrollRef.current?.scrollBy({ top: -(scrollRef.current.clientHeight * 0.9) })
        } else {
          prevPage()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prevPage, nextPage, mode, drawerOpen])

  /* ------------------------------ fullscreen ------------------------------ */
  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
    } else {
      void el.requestFullscreen().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  /* ---------------------------- mode/fit persist ---------------------------- */
  const changeMode = (m: ReaderMode) => {
    setMode(m)
    writeLocalJson('yomikaze:reader-mode', m)
  }
  const changeFit = (f: FitMode) => {
    setFit(f)
    writeLocalJson('yomikaze:reader-fit', f)
  }
  const changeZoom = (z: number) => {
    const clamped = Math.round(Math.min(1.5, Math.max(0.5, z)) * 100) / 100
    setZoom(clamped)
    writeLocalJson('yomikaze:reader-zoom', clamped)
  }

  /* ------------------------------ touch swipe ------------------------------ */
  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0]?.clientX ?? null
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (mode !== 'paged' || touchX.current === null) return
    const endX = e.changedTouches[0]?.clientX ?? touchX.current
    const delta = endX - touchX.current
    if (Math.abs(delta) > 60) {
      if (delta < 0) nextPage()
      else prevPage()
    }
    touchX.current = null
  }

  /* ------------------------------ rendering ------------------------------ */
  const controlsClass = cn(
    'transition-all duration-300',
    controlsHidden ? 'pointer-events-none -translate-y-2 opacity-0' : 'opacity-100',
  )

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-night-950 text-zinc-300">
        <PageSpinner />
        <p className="text-sm text-zinc-500">Loading chapter…</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-night-950 px-6">
        <ErrorState title="Reader error" message={error ?? 'Could not load this chapter.'} onRetry={() => setRetryKey((k) => k + 1)} />
        <div className="flex gap-3">
          <Link
            to={`/title/${titleId}`}
            className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-white/30"
          >
            Back to title
          </Link>
          <Link
            to="/"
            className="rounded-xl bg-flame-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-flame-500"
          >
            Back home
          </Link>
        </div>
      </div>
    )
  }

  /* ------------------- content unavailable (no blank reader) ------------------- */
  if (pages.length === 0) {
    const externalUrl = chapter?.officialUrl ?? title?.officialUrl
    // Label the source link by where it actually points (mangadex external
    // chapters lead to the official site, e.g. webnovel.com — the legitimate
    // place to read).
    const externalLabel = externalUrl?.includes('mangadex.org')
      ? 'Open on MangaDex'
      : chapter?.providerId === 'mangafire' || title?.providerId === 'mangafire'
        ? 'Open on MangaFire'
        : chapter?.providerId === 'mangadex' || title?.providerId === 'mangadex'
          ? 'Open on MangaDex'
          : 'Open original source'
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-night-950 px-6 text-center">
        <BookOpen className="h-12 w-12 text-zinc-700" />
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-bold text-zinc-100">Chapter content unavailable.</h1>
          <p className="mx-auto max-w-md text-sm text-zinc-500">
            {title?.title} — {chapter?.title ?? `Chapter ${chapter?.chapterNumber}`} is listed by the metadata provider
            but readable pages are not available on YOMIKAZE.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          {externalUrl ? (
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-flame-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-flame-500"
            >
              <ExternalLink className="h-4 w-4" />
              {externalLabel}
            </a>
          ) : null}
          <Link
            to={`/title/${titleId}`}
            className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-white/30"
          >
            Back to title
          </Link>
          <Link
            to="/manga"
            className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-white/30"
          >
            Browse manga
          </Link>
        </div>
      </div>
    )
  }

  const atFirstPage = currentPage === 0
  const atLastPage = currentPage >= pages.length - 1

  return (
    <div
      ref={containerRef}
      onMouseMove={wakeControls}
      className="flex h-dvh flex-col touch-manipulation bg-night-950 text-zinc-100"
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      {/* ------------------------------- Top bar ------------------------------- */}
      <header
        className={cn(
          'relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-white/5 glass-subtle px-3',
          controlsClass,
        )}
      >
        <Link
          to={`/title/${titleId}`}
          className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
          aria-label="Back to title"
        >
          <ArrowLeft className="h-5 w-5" />
          <span className="hidden font-display text-sm font-black tracking-tight text-white md:inline">
            YOMI<span className="text-flame-500">KAZE</span>
          </span>
        </Link>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-white">{title?.title}</p>
          <p className="truncate text-xs text-zinc-500">
            {chapter?.title ?? `Chapter ${chapter?.chapterNumber}`} · Page {currentPage + 1} / {pages.length}
          </p>
        </div>

        <div className="flex items-center gap-1">
          {/* Chapter selector — mangafire style "Ch. X / Y" pill */}
          <button
            type="button"
            onClick={() => setDrawerOpen((d) => (d === 'chapters' ? null : 'chapters'))}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-bold transition-colors',
              drawerOpen === 'chapters'
                ? 'bg-flame-500/15 text-flame-400'
                : 'text-zinc-300 hover:bg-white/5 hover:text-white',
            )}
            aria-label="Chapter list"
          >
            <List className="h-4 w-4" />
            <span className="hidden sm:inline">
              Ch. {chapter?.chapterNumber} / {sortedChapters.length || '–'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => prevChapter && goToChapter(prevChapter)}
            disabled={!prevChapter}
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-30 sm:flex"
            aria-label="Previous chapter"
          >
            <ArrowLeftCircle className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => nextChapter && goToChapter(nextChapter)}
            disabled={!nextChapter}
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-30 sm:flex"
            aria-label="Next chapter"
          >
            <ArrowRightCircle className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setDrawerOpen((d) => (d === 'settings' ? null : 'settings'))}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
              drawerOpen === 'settings' ? 'bg-flame-500/15 text-flame-400' : 'text-zinc-400 hover:bg-white/5 hover:text-white',
            )}
            aria-label="Reader settings"
          >
            <Settings2 className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white sm:flex"
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {fullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={() => setControlsHidden((c) => !c)}
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white sm:flex"
            aria-label={controlsHidden ? 'Show controls' : 'Hide controls'}
          >
            {controlsHidden ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
          </button>
        </div>
      </header>

      {/* Progress bar */}
      <div className="relative z-30 h-0.5 shrink-0 bg-white/5">
        <div
          className="absolute inset-y-0 left-0 bg-flame-500 transition-all duration-300"
          style={{ width: `${Math.round(progressPct * 100)}%` }}
          aria-hidden="true"
        />
      </div>

      {/* Credit line (MangaDex AUP) */}
      {chapter?.scanlationGroup || chapter?.providerId === 'mangadex' ? (
        <p className="shrink-0 border-b border-white/5 px-4 py-1 text-center text-[10px] text-zinc-600">
          Chapter pages via MangaDex{chapter?.scanlationGroup ? ` · Scanlated by ${chapter.scanlationGroup}` : ''}
        </p>
      ) : null}

      {/* ------------------------------- Reader ------------------------------- */}
      {mode === 'paged' ? (
        <div
          className="relative flex-1 overflow-hidden"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {/* Scrollable page area — fit-width pages can be very tall (webtoon style) */}
          <div
            ref={pagedScrollRef}
            className="absolute inset-0 overflow-y-auto overscroll-contain"
          >
            <div
              className={cn(
                'flex p-2',
                fit === 'height' ? 'h-full items-center justify-center' : 'min-h-full items-center justify-center',
              )}
            >
              <ReaderPageImage
                key={pages[currentPage].id}
                page={pages[currentPage]}
                eager
                fit={fit}
                zoom={zoom}
                fitClass={cn('page-turn', fit === 'height' ? 'h-full' : 'min-h-[60vh]')}
              />
            </div>
          </div>

          {/* Tap zones: left = prev, center = toggle controls, right = next */}
          <button
            type="button"
            onClick={prevPage}
            disabled={atFirstPage}
            className="absolute inset-y-0 left-0 z-10 w-1/4 cursor-pointer disabled:cursor-default"
            aria-label="Previous page"
            tabIndex={-1}
          />
          <button
            type="button"
            onClick={toggleControls}
            className="absolute inset-y-0 left-1/4 z-10 w-1/2 cursor-pointer"
            aria-label={controlsHidden ? 'Show controls' : 'Hide controls'}
            tabIndex={-1}
          />
          <button
            type="button"
            onClick={() => (atLastPage ? (nextChapter ? goToChapter(nextChapter) : null) : nextPage())}
            disabled={atLastPage && !nextChapter}
            className="absolute inset-y-0 right-0 z-10 w-1/4 cursor-pointer disabled:cursor-default"
            aria-label={atLastPage && nextChapter ? 'Next chapter' : 'Next page'}
            tabIndex={-1}
          />

          {/* Edge arrows */}
          {!atFirstPage ? (
            <button
              type="button"
              onClick={prevPage}
              className={cn(
                'absolute left-3 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/70 backdrop-blur-sm transition-opacity hover:text-white',
                controlsClass,
              )}
              aria-label="Previous page"
            >
              <ArrowLeftCircle className="h-8 w-8" />
            </button>
          ) : null}
          {!atLastPage ? (
            <button
              type="button"
              onClick={nextPage}
              className={cn(
                'absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/70 backdrop-blur-sm transition-opacity hover:text-white',
                controlsClass,
              )}
              aria-label="Next page"
            >
              <ArrowRightCircle className="h-8 w-8" />
            </button>
          ) : null}

          {/* End of chapter */}
          {atLastPage ? (
            <div className="page-in absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-6 pt-16 text-center">
              <Expand className="h-6 w-6 text-zinc-500" />
              <p className="font-display text-lg font-bold text-white">End of chapter</p>
              <div className="flex flex-wrap justify-center gap-3">
                {nextChapter ? (
                  <button
                    type="button"
                    onClick={() => goToChapter(nextChapter)}
                    className="inline-flex items-center gap-2 rounded-xl bg-flame-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-flame-500"
                  >
                    Next chapter
                    <ArrowRight className="h-4 w-4" />
                  </button>
                ) : null}
                <Link
                  to={`/title/${titleId}`}
                  className="rounded-xl border border-white/20 px-5 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-white/40"
                >
                  Back to title
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {/* ------------------------------ Vertical ------------------------------ */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            onClick={toggleControls}
            className="flex-1 overflow-y-auto overscroll-contain"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
          <div className="mx-auto flex flex-col items-center py-2" style={{ maxWidth: `${Math.round(900 * zoom)}px` }}>
            {pages.map((page, i) => (
              <div
                key={page.id}
                ref={(el) => {
                  pageRefs.current[i] = el
                }}
                className="w-full"
              >
                <ReaderPageImage page={page} eager={i === 0} zoom={zoom} fitClass="page-turn" />
              </div>
            ))}
            <div className="flex w-full flex-col items-center gap-3 py-8 text-center">
              <Expand className="h-6 w-6 text-zinc-600" />
              <p className="font-display text-lg font-bold text-white">End of chapter</p>
              <div className="flex flex-wrap justify-center gap-3">
                {nextChapter ? (
                  <button
                    type="button"
                    onClick={() => {
                      scrollRef.current?.scrollTo({ top: 0 })
                      goToChapter(nextChapter)
                    }}
                    className="inline-flex items-center gap-2 rounded-xl bg-flame-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-flame-500"
                  >
                    Next chapter
                    <ArrowRight className="h-4 w-4" />
                  </button>
                ) : null}
                <Link
                  to={`/title/${titleId}`}
                  className="rounded-xl border border-white/20 px-5 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-white/40"
                >
                  Back to title
                </Link>
              </div>
            </div>
          </div>
        </div>
        </>
      )}

      {/* ------------------------------ Bottom bar ------------------------------ */}
      <footer
        className={cn(
          'relative z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-t border-white/5 glass-subtle px-3',
          controlsClass,
        )}
      >
        <button
          type="button"
          onClick={() => prevChapter && goToChapter(prevChapter)}
          disabled={!prevChapter}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Prev ch.</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={prevPage}
            disabled={atFirstPage}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-zinc-200 transition-colors hover:bg-white/10 disabled:opacity-30"
            aria-label="Previous page"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-[6.5rem] text-center text-xs font-semibold text-zinc-300">
            {currentPage + 1} / {pages.length}
            <span className="text-flame-400"> · {Math.round(progressPct * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(pages.length - 1, 0)}
            value={currentPage}
            onChange={(e) => seekPage(Number(e.target.value))}
            className="hidden w-24 cursor-pointer accent-flame-500 md:block lg:w-44"
            aria-label="Jump to page"
          />
          <button
            type="button"
            onClick={() => (atLastPage ? (nextChapter ? goToChapter(nextChapter) : null) : nextPage())}
            disabled={atLastPage && !nextChapter}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-flame-600 text-white transition-colors hover:bg-flame-500 disabled:opacity-30"
            aria-label={atLastPage && nextChapter ? 'Next chapter' : 'Next page'}
          >
            <ArrowRight className="h-5 w-5" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => nextChapter && goToChapter(nextChapter)}
          disabled={!nextChapter}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
        >
          <span className="hidden sm:inline">Next ch.</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </footer>

      {/* ----------------------------- Drawer ----------------------------- */}
      {drawerOpen ? (
        <div className="absolute inset-0 z-40" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDrawerOpen(null)}
            aria-label="Close panel"
          />
          <aside
            className="absolute top-14 bottom-14 right-0 w-80 max-w-[85vw] overflow-hidden rounded-l-2xl border border-white/10 bg-night-900/95 shadow-2xl transition-all duration-300"
          >
            <div className="flex h-12 items-center justify-between border-b border-white/10 px-4">
              <h2 className="font-display text-sm font-bold text-white">
                {drawerOpen === 'chapters' ? 'Chapters' : 'Settings'}
              </h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(null)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {drawerOpen === 'chapters' ? (
              <ul className="h-full overflow-y-auto p-2">
                {[...sortedChapters].reverse().map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => goToChapter(c)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                        c.id === chapterId
                          ? 'bg-flame-500/15 font-bold text-flame-400'
                          : 'text-zinc-300 hover:bg-white/5',
                      )}
                    >
                      <span className="w-8 shrink-0 text-center font-display">{c.chapterNumber}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {c.title ?? `Chapter ${c.chapterNumber}`}
                        {c.id === chapterId ? <span className="ml-2 text-[10px] font-bold uppercase">Reading</span> : null}
                      </span>
                      {!c.available ? <ChevronUp className="h-3.5 w-3.5 rotate-180 text-zinc-600" /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="h-full space-y-6 overflow-y-auto p-5">
                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">Reading mode</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {(['paged', 'vertical'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => changeMode(m)}
                        className={cn(
                          'rounded-xl border px-3 py-2.5 text-sm font-semibold capitalize transition-colors',
                          mode === m
                            ? 'border-flame-500/60 bg-flame-500/10 text-flame-400'
                            : 'border-white/10 text-zinc-300 hover:border-white/25',
                        )}
                      >
                        {m === 'paged' ? 'Single page' : 'Vertical scroll'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">Fit</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {(['width', 'height'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => changeFit(f)}
                        className={cn(
                          'rounded-xl border px-3 py-2.5 text-sm font-semibold capitalize transition-colors',
                          fit === f
                            ? 'border-flame-500/60 bg-flame-500/10 text-flame-400'
                            : 'border-white/10 text-zinc-300 hover:border-white/25',
                        )}
                      >
                        Fit {f}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">Image size</h3>
                  <div className="flex items-center gap-3 rounded-xl border border-white/10 px-3 py-2.5">
                    <input
                      type="range"
                      min={0.5}
                      max={1.5}
                      step={0.05}
                      value={zoom}
                      onChange={(e) => changeZoom(Number(e.target.value))}
                      className="h-1.5 flex-1 cursor-pointer accent-flame-500"
                      aria-label="Image size"
                    />
                    <span className="w-11 shrink-0 text-right text-xs font-bold text-zinc-300">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => changeZoom(1)}
                      className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">Display</h3>
                  <button
                    type="button"
                    onClick={() => changeAutoHide(!autoHide)}
                    className="flex w-full items-center justify-between rounded-xl border border-white/10 px-3 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:border-white/25"
                  >
                    Auto-hide controls
                    <span className={cn('h-4 w-8 rounded-full p-0.5 transition-colors', autoHide ? 'bg-flame-600' : 'bg-white/15')}>
                      <span
                        className={cn(
                          'block h-3 w-3 rounded-full bg-white transition-transform',
                          autoHide && 'translate-x-4',
                        )}
                      />
                    </span>
                  </button>
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">Quick tips</h3>
                  <ul className="space-y-1.5 text-xs leading-relaxed text-zinc-400">
                    <li>Tap the center of the page to show or hide the controls.</li>
                    <li>Swipe left / right (or use ← → keys) to flip pages.</li>
                    <li>Space / PageDown scrolls, PageUp goes back.</li>
                    <li>On the last page, tap Next to jump straight into the next chapter.</li>
                  </ul>
                </div>
              </div>
            )}
          </aside>
        </div>
      ) : null}

      {/* Mobile fullscreen shortcut */}
      <button
        type="button"
        onClick={toggleFullscreen}
        className={cn(
          'absolute bottom-20 right-3 z-30 flex h-10 w-10 items-center justify-center rounded-xl bg-black/50 text-zinc-300 backdrop-blur-sm transition-colors hover:text-white sm:hidden',
          controlsClass,
        )}
        aria-label="Toggle fullscreen"
      >
        <Maximize2 className="h-5 w-5" />
      </button>
    </div>
  )
}
