import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

export function Skeleton({
  className,
  delayMs,
}: {
  className?: string
  delayMs?: number
}) {
  const style =
    delayMs !== undefined
      ? ({ '--shimmer-delay': `${delayMs}ms` } as CSSProperties)
      : undefined
  return (
    <div className={cn('skeleton rounded-lg', className)} style={style} aria-hidden="true" />
  )
}

export function SkeletonCard({ index = 0 }: { index?: number }) {
  return (
    <div className="space-y-2">
      <Skeleton className="aspect-[2/3] w-full rounded-xl" delayMs={index * 90} />
      <Skeleton className="h-4 w-4/5" delayMs={index * 90 + 60} />
      <Skeleton className="h-3 w-1/2" delayMs={index * 90 + 120} />
    </div>
  )
}

export function SkeletonGrid({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} index={i} />
      ))}
    </div>
  )
}

export function SkeletonHero() {
  return (
    <div className="relative overflow-hidden rounded-3xl">
      <Skeleton className="h-[420px] w-full md:h-[520px]" />
      <div className="absolute inset-0 flex flex-col justify-end gap-3 p-6 md:p-10">
        <Skeleton className="h-6 w-28" delayMs={100} />
        <Skeleton className="h-10 w-3/4 max-w-xl" delayMs={200} />
        <Skeleton className="h-4 w-full max-w-lg" delayMs={300} />
        <Skeleton className="h-4 w-2/3 max-w-md" delayMs={400} />
        <div className="mt-2 flex gap-3">
          <Skeleton className="h-11 w-40" delayMs={500} />
          <Skeleton className="h-11 w-36" delayMs={600} />
        </div>
      </div>
    </div>
  )
}

export function SkeletonDetail() {
  return (
    <div className="grid gap-8 md:grid-cols-[240px_1fr]">
      <Skeleton className="aspect-[2/3] w-full rounded-2xl md:w-[240px]" />
      <div className="space-y-4">
        <Skeleton className="h-9 w-3/4" delayMs={100} />
        <Skeleton className="h-4 w-1/2" delayMs={200} />
        <div className="flex gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-20" delayMs={300 + i * 90} />
          ))}
        </div>
        <Skeleton className="h-4 w-full" delayMs={550} />
        <Skeleton className="h-4 w-full" delayMs={650} />
        <Skeleton className="h-4 w-2/3" delayMs={750} />
        <div className="flex gap-3">
          <Skeleton className="h-12 w-44" delayMs={850} />
          <Skeleton className="h-12 w-44" delayMs={950} />
        </div>
      </div>
    </div>
  )
}

function SkeletonChapterRow({ index = 0 }: { index?: number }) {
  const d = index * 70
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <Skeleton className="h-10 w-10 shrink-0 rounded-lg" delayMs={d} />
      <span className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-3/5 rounded-md" delayMs={d + 60} />
        <Skeleton className="h-2.5 w-2/5 rounded-md" delayMs={d + 120} />
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Skeleton className="hidden h-5 w-12 rounded-full sm:block" delayMs={d + 180} />
        <Skeleton className="h-4 w-4 rounded-full" delayMs={d + 240} />
      </span>
    </div>
  )
}

export function SkeletonChapterList({ count = 8 }: { count?: number }) {
  return (
    <div className="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonChapterRow key={i} index={i} />
      ))}
    </div>
  )
}
