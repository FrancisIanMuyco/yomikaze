import { Link } from 'react-router-dom'

import { usePresence } from '@/presence/PresenceContext'
import { formatNumber } from '@/lib/utils'

/**
 * Live "reading now" pill for the navbar. Renders nothing when the stats API
 * is unavailable (GitHub Pages mirror, local dev, no Upstash creds yet).
 */
export function PresenceBadge() {
  const { viewers, monthlyReads } = usePresence()
  if (viewers == null) return null

  return (
    <Link
      to="/stats"
      title="Live readers right now — see stats"
      className="hidden shrink-0 items-center gap-1.5 rounded-full border border-jade-500/30 bg-jade-500/5 px-3 py-1.5 text-[11px] font-semibold text-jade-500 transition-all duration-200 hover:border-jade-500/60 hover:bg-jade-500/10 xl:inline-flex dark:border-jade-400/25 dark:bg-jade-400/5 dark:text-jade-400"
    >
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-jade-500 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-jade-500" />
      </span>
      {formatNumber(viewers)} reading now
      {monthlyReads != null ? (
        <span className="font-medium text-zinc-400 dark:text-zinc-500">
          · {formatNumber(monthlyReads)}/mo
        </span>
      ) : null}
    </Link>
  )
}