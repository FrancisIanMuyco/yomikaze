import { Search, SearchX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Chip } from '@/components/ui/Badge'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { SkeletonGrid } from '@/components/ui/Skeletons'
import { TitleCard } from '@/components/ui/TitleCard'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { getErrorMessage } from '@/lib/errors'
import { provider } from '@/providers/ProviderFactory'
import type { MediaKind, Title } from '@/types'

type TypeTab = 'ALL' | MediaKind

const TABS: Array<{ value: TypeTab; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'MANGA', label: 'Manga' },
  { value: 'MANHUA', label: 'Manhua' },
  { value: 'MANHWA', label: 'Manhwa' },
]

type Status = 'idle' | 'searching' | 'done' | 'error'

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [input, setInput] = useState(searchParams.get('q') ?? '')
  const debounced = useDebouncedValue(input, 400)
  const [tab, setTab] = useState<TypeTab>('ALL')
  const [results, setResults] = useState<Title[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    if (debounced) setSearchParams({ q: debounced }, { replace: true })
  }, [debounced, setSearchParams])

  useEffect(() => {
    let alive = true
    const q = debounced.trim()
    if (!q) {
      setStatus('idle')
      setResults([])
      return
    }
    setStatus('searching')
    provider
      .searchTitles(q)
      .then((titles) => {
        if (!alive) return
        setResults(titles)
        setStatus('done')
        setError(null)
      })
      .catch((e) => {
        if (!alive) return
        setError(getErrorMessage(e))
        setStatus('error')
      })
    return () => {
      alive = false
    }
  }, [debounced, retryKey])

  const filtered = tab === 'ALL' ? results : results.filter((t) => t.type === tab)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-black tracking-tight text-zinc-900 dark:text-white md:text-4xl">
          Search
        </h1>
        <p className="text-sm text-zinc-500">検索 — find titles by name, author or genre.</p>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search title, author, or genre…"
          autoFocus
          aria-label="Search titles"
          className="w-full rounded-2xl border border-black/10 bg-white py-4 pl-12 pr-4 text-base shadow-sm outline-none transition-all placeholder:text-zinc-400 focus:border-flame-500/60 focus:ring-2 focus:ring-flame-500/20 dark:border-white/10 dark:bg-night-850 dark:text-white"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Chip key={t.value} active={tab === t.value} onClick={() => setTab(t.value)}>
            {t.label}
          </Chip>
        ))}
      </div>

      {status === 'idle' ? (
        <EmptyState
          icon={<Search className="h-10 w-10" />}
          title="Search the YOMIKAZE catalog"
          message="Search for manga, manhua or manhwa — by title, alternative title, author or genre."
        />
      ) : status === 'searching' ? (
        <div>
          <p className="mb-4 text-sm text-zinc-500">Searching…</p>
          <SkeletonGrid count={12} />
        </div>
      ) : status === 'error' ? (
        <ErrorState message={error ?? 'Search failed.'} onRetry={() => setRetryKey((k) => k + 1)} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<SearchX className="h-10 w-10" />}
          title="No results found"
          message={`Nothing matched “${debounced}”. Try a different spelling or a broader term.`}
        />
      ) : (
        <>
          <p className="text-sm text-zinc-500">
            {filtered.length} result{filtered.length === 1 ? '' : 's'} for “{debounced}”
          </p>
          <div className="stagger-children grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {filtered.map((t) => (
              <TitleCard key={t.id} title={t} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
