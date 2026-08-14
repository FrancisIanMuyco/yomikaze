import { ChevronDown, FilterX, Loader2, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Chip } from '@/components/ui/Badge'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { SkeletonGrid } from '@/components/ui/Skeletons'
import { TitleCard } from '@/components/ui/TitleCard'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { provider } from '@/providers/ProviderFactory'
import type { LibraryQuery, Title, TitleStatus } from '@/types'

const SORTS: Array<{ value: LibraryQuery['sort']; label: string }> = [
  { value: 'POPULAR', label: 'Popular' },
  { value: 'LATEST', label: 'Latest' },
  { value: 'RATING', label: 'Rating' },
  { value: 'A_Z', label: 'A–Z' },
]

const STATUSES: Array<{ value: TitleStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Any status' },
  { value: 'RELEASING', label: 'Ongoing' },
  { value: 'FINISHED', label: 'Completed' },
  { value: 'HIATUS', label: 'On hiatus' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: CURRENT_YEAR - 1989 }, (_, i) => CURRENT_YEAR - i)

export function LibraryPage({ kind }: { kind: 'MANGA' | 'MANHUA' }) {
  const isManhua = kind === 'MANHUA'
  const [searchParams, setSearchParams] = useSearchParams()

  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '')
  const debouncedSearch = useDebouncedValue(searchInput, 400)
  const [genre, setGenre] = useState<string | undefined>(searchParams.get('genre') ?? undefined)
  const [status, setStatus] = useState<TitleStatus | 'ALL'>(() => {
    const s = searchParams.get('status')
    return s && STATUSES.some((x) => x.value === s) ? (s as TitleStatus) : 'ALL'
  })
  const [year, setYear] = useState<number | undefined>(() => {
    const y = searchParams.get('year')
    return y ? Number(y) || undefined : undefined
  })
  const [sort, setSort] = useState<LibraryQuery['sort']>(() => {
    const s = searchParams.get('sort')
    return SORTS.some((x) => x.value === s) ? (s as LibraryQuery['sort']) : 'POPULAR'
  })
  const [allGenres, setAllGenres] = useState<string[]>([])
  const [titles, setTitles] = useState<Title[]>([])
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const pageRef = useRef(1)
  const requestSeq = useRef(0)

  // Sync URL params
  useEffect(() => {
    const params = new URLSearchParams()
    if (debouncedSearch) params.set('q', debouncedSearch)
    if (genre) params.set('genre', genre)
    if (status !== 'ALL') params.set('status', status)
    if (year) params.set('year', String(year))
    if (sort !== 'POPULAR') params.set('sort', sort)
    setSearchParams(params, { replace: true })
  }, [debouncedSearch, genre, status, year, sort, setSearchParams])

  useEffect(() => {
    let alive = true
    setAllGenres([])
    provider
      .getGenres()
      .then((g) => {
        if (alive) setAllGenres(g)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const loadPage = useCallback(
    async (page: number, append: boolean) => {
      const seq = ++requestSeq.current
      const query: LibraryQuery = {
        kind,
        search: debouncedSearch || undefined,
        genre,
        status,
        year,
        sort,
        page,
      }
      if (append) setLoadingMore(true)
      else setLoading(true)
      try {
        const result = await provider.getLibrary(query)
        // Discard stale responses (e.g. a load-more landing after a filter reset).
        if (seq !== requestSeq.current) return
        pageRef.current = page
        setTitles((prev) => (append ? [...prev, ...result.titles] : result.titles))
        setHasNext(result.hasNextPage)
        setError(null)
      } catch (e) {
        if (seq === requestSeq.current) setError(getErrorMessage(e))
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [kind, debouncedSearch, genre, status, year, sort],
  )

  useEffect(() => {
    pageRef.current = 1
    void loadPage(1, false)
  }, [loadPage])

  const loadMore = () => void loadPage(pageRef.current + 1, true)

  const resetFilters = () => {
    setGenre(undefined)
    setStatus('ALL')
    setYear(undefined)
    setSearchInput('')
    setSort('POPULAR')
  }

  const hasActiveFilters = Boolean(genre || (status !== 'ALL') || year || debouncedSearch || sort !== 'POPULAR')

  const title = useMemo(
    () => (isManhua ? 'Manhua & Manhwa Library' : 'Manga Library'),
    [isManhua],
  )
  const kanji = useMemo(() => (isManhua ? '漫画・ウェブトゥーン' : '漫画'), [isManhua])

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-black tracking-tight text-zinc-900 dark:text-white md:text-4xl">
          {title}
        </h1>
        <p className="text-sm text-zinc-500">
          {kanji} — browse, filter and discover {isManhua ? 'Chinese & Korean' : 'Japanese'} titles.
        </p>
      </header>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={`Search ${isManhua ? 'manhua & manhwa' : 'manga'}…`}
          aria-label={`Search ${title}`}
          className="w-full rounded-2xl border border-black/10 bg-white py-3.5 pl-12 pr-4 text-sm shadow-sm outline-none transition-all placeholder:text-zinc-400 focus:border-flame-500/60 focus:ring-2 focus:ring-flame-500/20 dark:border-white/10 dark:bg-night-850 dark:text-white"
        />
      </div>

      {/* Sort + filters toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          className={cn(
            'inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors',
            filtersOpen
              ? 'border-flame-500/50 bg-flame-500/10 text-flame-500 dark:text-flame-400'
              : 'border-black/10 bg-white text-zinc-600 hover:border-flame-500/40 dark:border-white/10 dark:bg-night-850 dark:text-zinc-300',
          )}
          aria-expanded={filtersOpen}
        >
          <FilterX className="h-4 w-4" />
          Filters
          {hasActiveFilters ? <span className="h-1.5 w-1.5 rounded-full bg-flame-500" aria-hidden="true" /> : null}
        </button>

        <div className="flex items-center gap-2">
          <label htmlFor="lib-sort" className="sr-only">
            Sort
          </label>
          <div className="relative">
            <select
              id="lib-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as LibraryQuery['sort'])}
              className="appearance-none rounded-xl border border-black/10 bg-white py-2 pl-4 pr-9 text-sm font-semibold text-zinc-700 outline-none focus:border-flame-500/50 dark:border-white/10 dark:bg-night-850 dark:text-zinc-200"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>
      </div>

      {/* Filter panel */}
      {filtersOpen ? (
        <div className="space-y-4 rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-night-850">
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">Genre</h3>
            <div className="flex flex-wrap gap-2">
              <Chip active={!genre} onClick={() => setGenre(undefined)}>
                All
              </Chip>
              {allGenres.map((g) => (
                <Chip key={g} active={genre === g} onClick={() => setGenre(g)}>
                  {g}
                </Chip>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="lib-status" className="mb-2 block text-xs font-bold uppercase tracking-widest text-zinc-500">
                Status
              </label>
              <select
                id="lib-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as TitleStatus | 'ALL')}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 outline-none focus:border-flame-500/50 dark:border-white/10 dark:bg-night-800 dark:text-zinc-200"
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="lib-year" className="mb-2 block text-xs font-bold uppercase tracking-widest text-zinc-500">
                Year
              </label>
              <select
                id="lib-year"
                value={year ?? ''}
                onChange={(e) => setYear(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 outline-none focus:border-flame-500/50 dark:border-white/10 dark:bg-night-800 dark:text-zinc-200"
              >
                <option value="">Any year</option>
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ) : null}

      {/* Results */}
      {loading ? (
        <SkeletonGrid count={15} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void loadPage(1, false)} />
      ) : titles.length === 0 ? (
        <EmptyState
          title="No titles match your filters"
          message="Try removing a filter or searching for something else."
          action={
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-xl border border-flame-500/40 bg-flame-500/10 px-4 py-2 text-sm font-semibold text-flame-300 transition-colors hover:bg-flame-500/20"
            >
              Reset filters
            </button>
          }
        />
      ) : (
        <>
          <div className="stagger-children grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {titles.map((t) => (
              <TitleCard key={t.id} title={t} />
            ))}
          </div>
          <div className="flex justify-center pt-6">
            {hasNext ? (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-6 py-3 text-sm font-bold text-zinc-700 shadow-sm transition-all duration-200 hover:border-flame-500/50 hover:text-flame-500 disabled:opacity-50 dark:border-white/10 dark:bg-night-850 dark:text-zinc-200 dark:hover:text-flame-400 btn-press"
              >
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Load more
              </button>
            ) : titles.length > 12 ? (
              <p className="text-sm text-zinc-500">You're all caught up ✦</p>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
