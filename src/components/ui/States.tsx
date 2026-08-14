import { Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-flame-400', className)} aria-label="Loading" />
}

export function PageSpinner() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status">
      <Spinner className="h-8 w-8" />
      <span className="sr-only">Loading…</span>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode
  title: string
  message?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-black/10 bg-white/60 px-6 py-16 text-center dark:border-white/10 dark:bg-night-850/50">
      {icon ? <div className="text-zinc-500">{icon}</div> : null}
      <h3 className="font-display text-xl font-bold text-zinc-200">{title}</h3>
      {message ? <p className="max-w-md text-sm text-zinc-500">{message}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string
  message?: string
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-flame-500/20 bg-flame-500/5 px-6 py-14 text-center">
      <TriangleAlert className="h-8 w-8 text-flame-400" />
      <h3 className="font-display text-xl font-bold text-zinc-200">{title}</h3>
      {message ? <p className="max-w-md text-sm text-zinc-500">{message}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-flame-500/40 bg-flame-500/10 px-4 py-2 text-sm font-semibold text-flame-300 transition-colors hover:bg-flame-500/20"
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
      ) : null}
    </div>
  )
}

export function SectionHeader({
  title,
  kanji,
  action,
}: {
  title: string
  kanji?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="h-8 w-1 rounded-full bg-flame-500 shadow-lg shadow-flame-500/50" aria-hidden="true" />
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            {title}
          </h2>
          {kanji ? (
            <p className="text-xs font-medium tracking-widest text-zinc-500 dark:text-zinc-500">{kanji}</p>
          ) : null}
        </div>
      </div>
      {action}
    </div>
  )
}
