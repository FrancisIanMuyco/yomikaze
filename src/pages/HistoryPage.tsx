import { Clock3, Play, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'

import { CoverImage } from '@/components/ui/CoverImage'
import { EmptyState } from '@/components/ui/States'
import { useHistory } from '@/hooks/useHistory'
import { useLibraryIndex } from '@/hooks/useLibraryIndex'
import { useSeo } from '@/hooks/useSeo'
import { formatRelativeTime } from '@/lib/utils'

export function HistoryPage() {
  const { history, removeEntry, clearHistory } = useHistory()
  const { resolve: resolveTitle } = useLibraryIndex()
  useSeo({ title: 'History' })

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-3xl font-black tracking-tight text-zinc-900 dark:text-white md:text-4xl">
            History
          </h1>
          <p className="text-sm text-zinc-500">履歴 — pick up exactly where you left off.</p>
        </div>
        {history.length > 0 ? (
          <button
            type="button"
            onClick={clearHistory}
            className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-2 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/15"
          >
            <Trash2 className="h-4 w-4" />
            Clear all
          </button>
        ) : null}
      </header>

      {history.length === 0 ? (
        <EmptyState
          icon={<Clock3 className="h-10 w-10" />}
          title="No reading history yet"
          message="Chapters you open will show up here so you can continue where you stopped."
          action={
            <Link
              to="/manga"
              className="rounded-xl bg-flame-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-flame-500"
            >
              Discover titles
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {history.map((entry) => {
            const pct = Math.round(entry.progress * 100)
            const current = resolveTitle(entry.titleId)
            const titleId = current?.id ?? entry.titleId
            const titleName = current?.title ?? entry.title.title
            const coverUrl = current?.coverUrl ?? entry.title.coverUrl
            return (
              <li
                key={entry.titleId}
                className="flex items-center gap-4 rounded-2xl border border-black/10 bg-white p-3 shadow-sm transition-all hover:border-flame-500/40 dark:border-white/10 dark:bg-night-850"
              >
                <Link to={`/title/${titleId}`} className="shrink-0" aria-label={titleName}>
                  <CoverImage
                    src={coverUrl}
                    alt={`${titleName} cover`}
                    className="w-16 rounded-lg"
                    aspectClassName="aspect-[2/3]"
                  />
                </Link>

                <div className="min-w-0 flex-1">
                  <Link
                    to={`/title/${titleId}`}
                    className="line-clamp-1 font-display text-sm font-bold text-zinc-900 transition-colors hover:text-flame-500 dark:text-white dark:hover:text-flame-400"
                  >
                    {titleName}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    Chapter {entry.chapterNumber}
                    {entry.chapterTitle ? ` — ${entry.chapterTitle}` : ''} · Page {entry.pageNumber} of{' '}
                    {entry.totalPages}
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-400">Last read {formatRelativeTime(entry.timestamp)}</p>
                  <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                    <div className="h-full rounded-full bg-flame-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    to={`/reader/${entry.titleId}/${entry.chapterId}`}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-flame-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-flame-500"
                    aria-label={`Continue ${entry.title.title} chapter ${entry.chapterNumber}`}
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Continue
                  </Link>
                  <button
                    type="button"
                    onClick={() => removeEntry(entry.titleId)}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 text-zinc-500 transition-colors hover:border-red-500/40 hover:text-red-400 dark:border-white/10"
                    aria-label={`Remove ${entry.title.title} from history`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
