import { Loader2, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { cn } from '@/lib/utils'
import { provider } from '@/providers/ProviderFactory'
import type { Title } from '@/types'

interface Props {
  className?: string
  /** Stretch the input to fill its container (mobile overlay). */
  fullWidth?: boolean
  autoFocus?: boolean
  /** Called after navigating anywhere (lets overlays close themselves). */
  onDone?: () => void
}

/** Navbar search with an instant suggestion dropdown (type-ahead, like Google). */
export function NavSearchAutocomplete({ className, fullWidth = false, autoFocus = false, onDone }: Props) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Title[]>([])
  const [active, setActive] = useState(-1)
  const itemRefs = useRef<Array<HTMLLIElement | null>>([])
  // Remembers that the dropdown was open when the page started scrolling, so it
  // can auto-reopen once the page is back at the top (see scroll effect below).
  const pendingRef = useRef(false)
  const scrollTimer = useRef<number | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const debounced = useDebouncedValue(query, 350)

  useEffect(() => {
    const q = debounced.trim()
    if (!q) {
      setResults([])
      setBusy(false)
      return
    }
    setBusy(true)
    let alive = true
    provider
      .searchTitles(q)
      .then((titles) => {
        if (!alive) return
        setResults(titles)
        setBusy(false)
        setActive(-1)
      })
      .catch(() => {
        if (alive) {
          setResults([])
          setBusy(false)
        }
      })
    return () => {
      alive = false
    }
  }, [debounced])

  useEffect(() => {
    // While the PAGE scrolls, hide the floating suggestions; when the user
    // scrolls back to the top the dropdown reopens on its own (query kept).
    // The dropdown's own internal scroll (target = the <ul>) is ignored.
    const onScroll = (e: Event) => {
      const t = e.target
      if (!(t === document || t === window || t === document.documentElement || t === document.body)) return
      if (open) {
        pendingRef.current = true
        setOpen(false)
      } else if (!pendingRef.current) {
        return
      }
      if (scrollTimer.current) window.clearTimeout(scrollTimer.current)
      scrollTimer.current = window.setTimeout(() => {
        if (pendingRef.current && query.trim() && window.scrollY <= 4) {
          pendingRef.current = false
          setOpen(true)
          inputRef.current?.focus({ preventScroll: true })
        }
      }, 250)
    }
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
      if (scrollTimer.current) window.clearTimeout(scrollTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query])

  // Clicking away after blurring the input (e.g. picking a nav link) must drop
  // any scroll-reopen memory — otherwise the dropdown could pop back on the
  // next page once scrolled to the top.
  useEffect(() => {
    pendingRef.current = false
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (active >= 0) itemRefs.current[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const close = () => setOpen(false)

  // Hard dismiss (Escape / form submit / finished navigation): forget the
  // scroll-reopen memory too.
  const dismiss = () => {
    pendingRef.current = false
    setOpen(false)
  }

  const finish = () => {
    dismiss()
    setQuery('')
    onDone?.()
  }

  const goSearch = () => {
    const term = query.trim()
    navigate(term ? `/search?q=${encodeURIComponent(term)}` : '/search')
    finish()
  }

  const pickTitle = (t: Title) => {
    navigate(`/title/${t.id}`)
    finish()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      dismiss()
      return
    }
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % results.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a - 1 + results.length) % results.length)
      return
    }
    if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      pickTitle(results[active])
    }
  }

  const showDrop = open && query.trim().length > 0
  const trimmed = query.trim()

  return (
    <form
      role="search"
      className={cn('relative', className)}
      onSubmit={(e) => {
        e.preventDefault()
        goSearch()
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          // A blur on touch often happens WHILE scrolling starts (before any
          // scroll event). Keep the scroll-reopen memory alive in that case so
          // the dropdown still comes back when the page returns to the top.
          if (showDrop) pendingRef.current = true
          close()
        }
      }}
    >
      <div className="relative group">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 transition-colors group-focus-within:text-flame-400" />
        <input
          type="search"
          value={query}
          ref={inputRef}
          autoFocus={autoFocus}
          aria-label="Search titles"
          aria-autocomplete="list"
          aria-expanded={showDrop}
          aria-controls={showDrop ? 'nav-search-results' : undefined}
          onChange={(e) => {
            pendingRef.current = false
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            pendingRef.current = false
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          placeholder="Search manga & manhua…"
          className={cn(
            'rounded-full border border-black/10 bg-black/[0.03] py-2 pl-9 pr-4 text-sm text-zinc-900 outline-none transition-all duration-200 placeholder:text-zinc-400 focus:border-flame-500/50 focus:bg-white focus:shadow-lg focus:shadow-flame-500/10 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:bg-night-800',
            fullWidth ? 'w-full focus:w-full' : 'w-72 focus:w-80 lg:w-72 lg:focus:w-80 xl:w-80 xl:focus:w-[22rem]',
          )}
        />
      </div>

      {showDrop ? (
        <ul
          id="nav-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[min(60vh,26rem)] overflow-y-auto rounded-2xl border border-black/10 bg-white p-1.5 shadow-2xl shadow-black/20 dark:border-white/10 dark:bg-night-800"
        >
          {busy ? (
            <li className="flex items-center gap-2 px-3 py-3 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </li>
          ) : results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-zinc-500">No titles match “{trimmed}”</li>
          ) : (
            results.map((t, i) => (
              <li
                key={t.id}
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                role="option"
                aria-selected={i === active}
              >
                <button
                  type="button"
                  onClick={() => pickTitle(t)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors',
                    i === active && 'bg-black/5 dark:bg-white/10',
                  )}
                >
                  <img src={t.coverUrl} alt="" loading="lazy" className="h-12 w-9 shrink-0 rounded-md object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-white">{t.title}</span>
                    <span className="block text-xs text-zinc-500">
                      {t.type}
                      {t.chapterCount ? ` · ${t.chapterCount} chapters` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
          <li>
            <button
              type="button"
              onClick={goSearch}
              className="mt-1 flex w-full items-center gap-2 rounded-xl border-t border-black/5 px-2 py-2.5 text-sm font-semibold text-flame-500 hover:bg-flame-500/5 dark:border-white/5 dark:text-flame-400"
            >
              <Search className="h-4 w-4" /> See all results for “{trimmed}”
            </button>
          </li>
        </ul>
      ) : null}
    </form>
  )
}