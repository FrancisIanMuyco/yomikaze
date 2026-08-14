import { BookOpen, Star } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { formatRating, statusLabel, typeLabel } from '@/lib/utils'

export function TypeBadge({ type, className }: { type: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider shadow-sm',
        type === 'MANHUA' && 'bg-jade-500/20 text-jade-400',
        type === 'MANHWA' && 'bg-sky-500/20 text-sky-400',
        type === 'MANGA' && 'bg-flame-500/20 text-flame-400',
        className,
      )}
    >
      <BookOpen className="h-3 w-3" />
      {typeLabel(type)}
    </span>
  )
}

export function RatingBadge({ rating, className }: { rating?: number; className?: string }) {
  if (rating === undefined || rating === null) return null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-bold text-gold-300 backdrop-blur-sm',
        className,
      )}
      title={`${rating}/100 average score`}
    >
      <Star className="h-3 w-3 fill-gold-400 text-gold-400" />
      {formatRating(rating)}
    </span>
  )
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const label = statusLabel(status)
  const tone =
    status === 'RELEASING'
      ? 'bg-emerald-500/15 text-emerald-400'
      : status === 'FINISHED'
        ? 'bg-sky-500/15 text-sky-400'
        : status === 'HIATUS'
          ? 'bg-amber-500/15 text-amber-400'
          : status === 'CANCELLED'
            ? 'bg-red-500/15 text-red-400'
            : 'bg-white/10 text-zinc-400'
  return (
    <span className={cn('inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold', tone, className)}>
      {label}
    </span>
  )
}

export function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active?: boolean
  onClick?: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-200',
        active
          ? 'border-flame-500 bg-flame-500/15 text-flame-300'
          : 'border-black/10 bg-white text-zinc-600 hover:border-black/25 hover:text-zinc-900 dark:border-white/10 dark:bg-night-800 dark:text-zinc-400 dark:hover:border-white/25 dark:hover:text-zinc-200',
        className,
      )}
    >
      {children}
    </button>
  )
}
