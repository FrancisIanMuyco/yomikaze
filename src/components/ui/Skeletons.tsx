import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-lg', className)} aria-hidden="true" />
}

export function SkeletonCard() {
  return (
    <div className="space-y-2">
      <Skeleton className="aspect-[2/3] w-full rounded-xl" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  )
}

export function SkeletonGrid({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}

export function SkeletonHero() {
  return (
    <div className="relative overflow-hidden rounded-3xl">
      <Skeleton className="h-[420px] w-full md:h-[520px]" />
      <div className="absolute inset-0 flex flex-col justify-end gap-3 p-6 md:p-10">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-10 w-3/4 max-w-xl" />
        <Skeleton className="h-4 w-full max-w-lg" />
        <Skeleton className="h-4 w-2/3 max-w-md" />
        <div className="mt-2 flex gap-3">
          <Skeleton className="h-11 w-40" />
          <Skeleton className="h-11 w-36" />
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
        <Skeleton className="h-9 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-20" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <div className="flex gap-3">
          <Skeleton className="h-12 w-44" />
          <Skeleton className="h-12 w-44" />
        </div>
      </div>
    </div>
  )
}

export function SkeletonChapterList({ count = 8 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}
