import { Link } from 'react-router-dom'

import { RatingBadge, TypeBadge } from '@/components/ui/Badge'
import { CoverImage } from '@/components/ui/CoverImage'
import { cn } from '@/lib/utils'
import type { ReadingProgress, Title } from '@/types'

interface TitleCardProps {
  title: Title
  progress?: ReadingProgress | null
  className?: string
}

export function TitleCard({ title, progress, className }: TitleCardProps) {
  const pct = progress ? Math.round(progress.progress * 100) : 0

  return (
    <Link
      to={`/title/${title.id}`}
      className={cn(
        'group relative block overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm card-hover img-zoom',
        'hover:border-flame-500/40 hover:shadow-flame-500/10 dark:border-white/5 dark:bg-night-850 dark:hover:border-flame-500/30 dark:hover:shadow-flame-500/5',
        className,
      )}
      aria-label={title.title}
    >
      <CoverImage
        src={title.coverUrl}
        alt={`${title.title} cover`}
        className="rounded-b-none"
        aspectClassName="aspect-[2/3]"
      />

      {/* Top-left badges */}
      <div className="absolute left-2.5 top-2.5 z-10 flex flex-col items-start gap-1.5">
        <TypeBadge type={title.type} className="shadow-lg shadow-black/30" />
      </div>

      {/* Hover glow ring */}
      <div
        className="pointer-events-none absolute inset-0 z-[5] rounded-2xl opacity-0 ring-2 ring-inset ring-flame-500/0 transition-all duration-300 group-hover:opacity-100 group-hover:ring-flame-500/40"
        aria-hidden="true"
      />

      {/* Rating */}
      <div className="absolute right-2.5 top-2.5">
        <RatingBadge rating={title.rating} className="shadow-lg shadow-black/30" />
      </div>

      {/* Bottom gradient + title */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent p-3 pt-12">
        <h3 className="line-clamp-2 font-display text-sm font-bold leading-snug text-white drop-shadow">
          {title.title}
        </h3>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-300">
          {title.chapterCount !== undefined ? (
            <span>{title.chapterCount} chapters</span>
          ) : (
            <span>{title.author ?? title.country ?? ''}</span>
          )}
        </div>
      </div>

      {/* Continue reading progress */}
      {progress ? (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
          <div
            className="h-full bg-flame-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
            aria-hidden="true"
          />
        </div>
      ) : null}
    </Link>
  )
}
