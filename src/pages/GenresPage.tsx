import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { EmptyState, ErrorState, PageSpinner } from '@/components/ui/States'
import { getErrorMessage } from '@/lib/errors'
import { provider } from '@/providers/ProviderFactory'

const CURATED: Array<{ genre: string; kanji: string }> = [
  { genre: 'Action', kanji: 'アクション' },
  { genre: 'Adventure', kanji: '冒険' },
  { genre: 'Comedy', kanji: 'コメディ' },
  { genre: 'Drama', kanji: 'ドラマ' },
  { genre: 'Fantasy', kanji: 'ファンタジー' },
  { genre: 'Romance', kanji: '恋愛' },
  { genre: 'Martial Arts', kanji: '格闘' },
  { genre: 'School Life', kanji: '学園' },
  { genre: 'Mystery', kanji: 'ミステリー' },
  { genre: 'Horror', kanji: 'ホラー' },
  { genre: 'Historical', kanji: '歴史' },
  { genre: 'Sci-Fi', kanji: 'SF' },
]

export function GenresPage() {
  const [genres, setGenres] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    provider
      .getGenres()
      .then((g) => {
        if (alive) {
          setGenres([...new Set([...g])].sort())
          setError(null)
        }
      })
      .catch((e) => {
        if (alive) setError(getErrorMessage(e))
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-black tracking-tight text-zinc-900 dark:text-white md:text-4xl">
          Genres
        </h1>
        <p className="text-sm text-zinc-500">ジャンル — pick a genre to explore matching titles.</p>
      </header>

      <section>
        <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-zinc-500">Popular genres</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {CURATED.map(({ genre, kanji }) => (
            <Link
              key={genre}
              to={`/manga?genre=${encodeURIComponent(genre)}`}
              className="group relative overflow-hidden rounded-2xl border border-black/10 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:border-flame-500/50 hover:shadow-xl hover:shadow-flame-500/10 dark:border-white/10 dark:bg-night-850"
            >
              <span className="pointer-events-none absolute -right-2 -top-3 select-none font-display text-5xl font-black text-black/[0.04] transition-colors group-hover:text-flame-500/10 dark:text-white/5 dark:group-hover:text-flame-500/10">
                {kanji}
              </span>
              <p className="font-display text-lg font-bold text-zinc-900 transition-colors group-hover:text-flame-500 dark:text-white dark:group-hover:text-flame-400">
                {genre}
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">Browse titles →</p>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-zinc-500">All genres</h2>
        {genres === null ? (
          error ? (
            <ErrorState message={error} onRetry={() => window.location.reload()} />
          ) : (
            <PageSpinner />
          )
        ) : genres.length === 0 ? (
          <EmptyState title="No genres available" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {genres.map((genre) => (
              <Link
                key={genre}
                to={`/manga?genre=${encodeURIComponent(genre)}`}
                className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-zinc-600 transition-all duration-200 hover:border-flame-500/50 hover:text-flame-500 dark:border-white/10 dark:bg-night-850 dark:text-zinc-300 dark:hover:text-flame-400"
              >
                {genre}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
