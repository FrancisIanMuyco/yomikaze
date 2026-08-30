import { ChevronLeft, ChevronRight, Flame, Play, Star } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { StatusBadge, TypeBadge } from '@/components/ui/Badge'
import { CoverImage } from '@/components/ui/CoverImage'
import { cn, formatNumber } from '@/lib/utils'
import { provider } from '@/providers/ProviderFactory'
import type { Chapter, Title } from '@/types'

const AUTOPLAY_MS = 6000
const isPrefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface Props {
  slides: Title[]
}

/** Auto-sliding "Trending Now" hero banner (premium infinite carousel). */
export function HeroCarousel({ slides }: Props) {
  const navigate = useNavigate()
  const n = slides.length
  // [last, ...slides, first] + seamless wrap = near-infinite forward/back loop
  const extended = useMemo(() => (n > 1 ? [slides[n - 1], ...slides, slides[0]] : slides), [slides, n])
  const [idx, setIdx] = useState(n > 1 ? 1 : 0)
  const [smooth, setSmooth] = useState(true)
  const [paused, setPaused] = useState(false)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const chaptersRef = useRef<Map<string, Chapter[]>>(new Map())
  const pointerX = useRef<number | null>(null)

  const active = extended[idx]

  const jumpTo = useCallback((to: number) => {
    // Teleport (both slots show the same title) without a visible transition.
    setSmooth(false)
    setIdx(to)
    window.setTimeout(() => setSmooth(true), 60)
  }, [])

  const go = useCallback(
    (dir: 1 | -1) => {
      if (n < 2) return
      if (dir === 1 && idx >= n + 1) return jumpTo(1)
      if (dir === -1 && idx <= 0) return jumpTo(n)
      setIdx(idx + dir)
    },
    [idx, n, jumpTo],
  )

  const select = useCallback((i: number) => setIdx(i + 1), [])

  const dotActive = idx === 0 ? n - 1 : idx === n + 1 ? 0 : idx - 1

  useEffect(() => {
    if (n < 2 || paused || isPrefersReducedMotion()) return
    const t = window.setInterval(() => go(1), AUTOPLAY_MS)
    return () => window.clearInterval(t)
  }, [go, n, paused])

  // Lazy-load chapters for the active slide so "Start Reading" always works.
  useEffect(() => {
    if (!active) return
    const cached = chaptersRef.current.get(active.id)
    if (cached) {
      setChapters(cached)
      return
    }
    let alive = true
    provider
      .getChapters(active.id)
      .then((cs) => {
        if (!alive) return
        chaptersRef.current.set(active.id, cs)
        setChapters(cs)
      })
      .catch(() => {
        if (alive) setChapters([])
      })
    return () => {
      alive = false
    }
  }, [active])

  const startReading = useCallback(() => {
    if (!active) return
    const first = [...chapters].sort((a, b) => a.chapterNumber - b.chapterNumber).find((c) => c.available)
    navigate(first ? `/reader/${active.id}/${first.id}` : `/title/${active.id}`)
  }, [active, chapters, navigate])

  if (!active) return null

  const arrowBtn =
    'btn-press inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-sm transition-all duration-200 hover:border-flame-500/60 hover:bg-flame-600/40 active:scale-95'

  return (
    <section
      className="group relative overflow-hidden rounded-3xl border border-black/5 shadow-2xl shadow-black/30 dark:border-white/5"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onPointerDown={(e) => {
        pointerX.current = e.clientX
      }}
      onPointerUp={(e) => {
        if (pointerX.current == null || n < 2) return
        const delta = e.clientX - pointerX.current
        if (Math.abs(delta) > 40) go(delta < 0 ? 1 : -1)
        pointerX.current = null
      }}
      aria-roledescription="carousel"
      aria-label="Trending now"
    >
      <div
        className="flex"
        style={{
          transform: `translateX(-${idx * 100}%)`,
          transition: smooth ? 'transform 900ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
        }}
      >
        {extended.map((t, i) => (
          <div
            key={`${t.id}-${i}`}
            className={cn('relative w-full shrink-0', i !== idx && 'pointer-events-none opacity-0 transition-opacity duration-500')}
            aria-hidden={i !== idx}
          >
            {/* Background */}
            <div className="absolute inset-0">
              <CoverImage
                src={t.bannerUrl ?? t.coverUrl}
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

            <div
              key={t.id}
              className="hero-stagger relative flex min-h-[440px] flex-col justify-end gap-5 p-6 pb-8 md:min-h-[520px] md:p-10"
            >
              <div className="flex flex-wrap items-center gap-2">
                <TypeBadge type={t.type} className="!bg-black/50 text-white" />
                <StatusBadge status={t.status} className="!bg-black/50 text-white" />
                <span className="flex items-center gap-1 text-sm font-bold text-gold-300">
                  <Star className="h-4 w-4 fill-gold-400 text-gold-400" />
                  {t.rating !== undefined ? (t.rating / 10).toFixed(1) : '—'}
                  <span className="ml-1 text-xs font-medium text-zinc-400">· {formatNumber(t.popularity)}</span>
                </span>
              </div>

              <h1 className="max-w-2xl font-display text-4xl font-black leading-tight tracking-tight text-white drop-shadow-lg md:text-6xl">
                {t.title}
              </h1>

              <p className="line-clamp-3 max-w-xl text-sm leading-relaxed text-zinc-300 md:text-base">{t.description}</p>

              <div className="flex flex-wrap gap-2">
                {t.genres.slice(0, 5).map((genre) => (
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
                  className="gradient-shift btn-press inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-flame-600 via-flame-500 to-rose-500 px-6 py-3 text-sm font-bold uppercase tracking-wider text-white shadow-lg shadow-flame-600/40 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-flame-500/50"
                >
                  <Play className="h-4 w-4 fill-current" />
                  Start Reading
                </button>
                <Link
                  to={`/title/${t.id}`}
                  className="btn-press inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-bold uppercase tracking-wider text-white backdrop-blur-sm transition-all duration-200 hover:border-white/40 hover:bg-white/10"
                >
                  View Details
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Trending chip */}
      <span className="pointer-events-none absolute left-6 top-6 z-10 inline-flex items-center gap-1.5 rounded-full border border-flame-500/40 bg-black/40 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-flame-300 backdrop-blur-sm">
        <Flame className="h-3.5 w-3.5 fill-flame-400 text-flame-400" />
        Trending
        <span className="ml-1 font-mono text-zinc-400">
          {String(dotActive + 1).padStart(2, '0')}/{String(n).padStart(2, '0')}
        </span>
      </span>

      {/* Dots */}
      {n > 1 && (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => select(i)}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                dotActive === i ? 'w-7 bg-flame-500' : 'w-1.5 bg-white/40 hover:bg-white/70',
              )}
            />
          ))}
        </div>
      )}

      {/* Arrows */}
      {n > 1 && (
        <div className="absolute bottom-4 right-6 z-10 flex gap-2">
          <button type="button" aria-label="Previous slide" onClick={() => go(-1)} className={arrowBtn}>
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" aria-label="Next slide" onClick={() => go(1)} className={arrowBtn}>
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Slide progress */}
      {n > 1 && (
        <div className="absolute bottom-0 left-0 right-0 z-10 h-0.5 bg-white/10">
          <span
            key={active.id}
            className="hero-progress block h-full bg-gradient-to-r from-flame-500 to-rose-500"
            style={{
              animationDuration: `${AUTOPLAY_MS}ms`,
              animationPlayState: paused || isPrefersReducedMotion() ? 'paused' : 'running',
            }}
          />
        </div>
      )}
    </section>
  )
}