import { BookOpen, Clock, Flame, TrendingUp } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { CoverImage } from '@/components/ui/CoverImage'
import { EmptyState } from '@/components/ui/States'
import { useReadingProgress } from '@/hooks/useReadingProgress'
import { useHistory } from '@/hooks/useHistory'
import { useFavorites } from '@/hooks/useFavorites'
import { formatDate } from '@/lib/utils'

/** Calculate reading streak (consecutive days with reading activity). */
function calculateStreak(timestamps: number[]): number {
  if (timestamps.length === 0) return 0

  // Get unique days (YYYY-MM-DD)
  const days = new Set(
    timestamps.map((t) => new Date(t).toISOString().split('T')[0])
  )
  const sortedDays = Array.from(days).sort().reverse()

  let streak = 1
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

  // Streak must include today or yesterday
  if (sortedDays[0] !== today && sortedDays[0] !== yesterday) return 0

  for (let i = 0; i < sortedDays.length - 1; i++) {
    const current = new Date(sortedDays[i])
    const next = new Date(sortedDays[i + 1])
    const diffDays = Math.floor((current.getTime() - next.getTime()) / 86400000)
    if (diffDays === 1) {
      streak++
    } else {
      break
    }
  }

  return streak
}

/** Estimate reading time (avg ~30 seconds per page). */
function estimateReadingTime(pagesRead: number): string {
  const totalSeconds = pagesRead * 30
  if (totalSeconds < 60) return `${totalSeconds}s`
  if (totalSeconds < 3600) return `${Math.floor(totalSeconds / 60)}m`
  const hours = Math.floor(totalSeconds / 3600)
  const mins = Math.floor((totalSeconds % 3600) / 60)
  return `${hours}h ${mins}m`
}

export function StatsPage() {
  const { progress } = useReadingProgress()
  const { history } = useHistory()
  const { favorites } = useFavorites()

  const stats = useMemo(() => {
    const progressEntries = Object.values(progress)
    const uniqueTitles = new Set(progressEntries.map((p) => p.titleId))
    const totalPages = progressEntries.reduce((sum, p) => sum + p.pageNumber, 0)
    const allTimestamps = history.map((h) => h.timestamp)
    const streak = calculateStreak(allTimestamps)

    // Titles in progress (not finished)
    const inProgress = progressEntries
      .filter((p) => p.progress < 1)
      .sort((a, b) => b.timestamp - a.timestamp)

    // Recently read
    const recent = history.slice(0, 10)

    return {
      titlesRead: uniqueTitles.size,
      chaptersRead: history.length,
      pagesRead: totalPages,
      streak,
      readingTime: estimateReadingTime(totalPages),
      favoritesCount: favorites.length,
      inProgress,
      recent,
    }
  }, [progress, history, favorites])

  if (history.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-3xl font-bold">Reading Stats</h1>
        <EmptyState
          title="No reading history yet"
          message="Start reading manga and your stats will appear here!"
        />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl font-bold">Reading Stats</h1>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          icon={<BookOpen className="h-5 w-5" />}
          label="Chapters Read"
          value={stats.chaptersRead.toLocaleString()}
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Pages Read"
          value={stats.pagesRead.toLocaleString()}
        />
        <StatCard
          icon={<Flame className="h-5 w-5 text-flame-500" />}
          label="Day Streak"
          value={stats.streak.toString()}
          highlight={stats.streak >= 3}
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          label="Est. Reading Time"
          value={stats.readingTime}
        />
      </div>

      {/* Quick Stats */}
      <div className="flex gap-6 text-sm text-zinc-500 dark:text-zinc-400">
        <span>
          <strong className="text-zinc-900 dark:text-white">{stats.titlesRead}</strong> titles read
        </span>
        <span>
          <strong className="text-zinc-900 dark:text-white">{stats.favoritesCount}</strong> favorites
        </span>
      </div>

      {/* In Progress */}
      {stats.inProgress.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Continue Reading</h2>
          <div className="space-y-3">
            {stats.inProgress.map((entry) => (
              <Link
                key={entry.titleId}
                to={`/reader/${entry.titleId}/${entry.chapterId}`}
                className="flex items-center gap-4 rounded-xl border border-black/5 bg-white p-3 transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-white/5 dark:bg-night-850"
              >
                <div className="h-16 w-12 flex-shrink-0 overflow-hidden rounded-lg">
                  <CoverImage
                    src={entry.titleId ? undefined : undefined}
                    alt=""
                    className="h-full w-full"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {entry.titleId.replace(/-/g, ' ')}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Chapter {entry.chapterId.split('-').pop()} · Page {entry.pageNumber}
                  </p>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-night-700">
                    <div
                      className="h-full rounded-full bg-flame-500 transition-all"
                      style={{ width: `${Math.min(entry.progress * 100, 100)}%` }}
                    />
                  </div>
                </div>
                <span className="text-xs text-zinc-400">
                  {formatDate(entry.timestamp)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Recent Activity */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Recent Activity</h2>
        <div className="space-y-2">
          {stats.recent.map((entry, i) => (
            <Link
              key={`${entry.titleId}-${entry.chapterId}-${i}`}
              to={`/reader/${entry.titleId}/${entry.chapterId}`}
              className="flex items-center gap-3 rounded-lg border border-black/5 bg-white px-4 py-3 transition-all hover:-translate-y-0.5 hover:shadow-sm dark:border-white/5 dark:bg-night-850"
            >
              <div className="h-10 w-8 flex-shrink-0 overflow-hidden rounded">
                {entry.title.coverUrl ? (
                  <CoverImage
                    src={entry.title.coverUrl}
                    alt=""
                    className="h-full w-full"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-night-700 text-xs text-zinc-400">
                    📖
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{entry.title.title}</p>
                <p className="text-xs text-zinc-500">
                  Ch. {entry.chapterNumber} · {Math.round(entry.progress * 100)}%
                </p>
              </div>
              <span className="text-xs text-zinc-400">{formatDate(entry.timestamp)}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  highlight = false,
}: {
  icon: React.ReactNode
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        highlight
          ? 'border-flame-500/30 bg-flame-50 dark:bg-flame-500/10'
          : 'border-black/5 bg-white dark:border-white/5 dark:bg-night-850'
      }`}
    >
      <div className="mb-2 text-zinc-500 dark:text-zinc-400">{icon}</div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
    </div>
  )
}
