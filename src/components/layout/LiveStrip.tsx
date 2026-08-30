import { Link } from 'react-router-dom'

import { usePresence } from '@/presence/PresenceContext'
import { formatNumber } from '@/lib/utils'

/**
 * Slim "LIVE" strip pinned above the header — the always-visible face of the
 * reader stats. Renders nothing when the stats API is unavailable (GitHub
 * Pages mirror, local dev, no Upstash creds).
 */
export function LiveStrip() {
  const { viewers, monthlyReads } = usePresence()
  if (viewers == null) return null

  return (
    <Link
      to="/stats"
      className="group flex h-8 items-center justify-center gap-2 border-b border-jade-500/20 bg-gradient-to-r from-transparent via-jade-500/10 to-transparent px-3 text-[11px] font-semibold tracking-wide text-zinc-600 transition-colors hover:from-jade-500/15 hover:via-jade-500/20 hover:to-jade-500/15 dark:text-zinc-300"
      aria-label="Live reader stats — see details"
    >
      <span className="inline-flex items-center rounded-sm bg-jade-500 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-white">
        Live
      </span>

      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-jade-500 opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-jade-500" />
      </span>

      <span key={viewers} className="tabular-nums">
        {formatNumber(viewers)} reading now
      </span>

      {monthlyReads != null ? (
        <span className="hidden text-zinc-500 transition-colors group-hover:text-jade-600 sm:inline dark:text-zinc-500">
          · {formatNumber(monthlyReads)} reads this month
        </span>
      ) : null}
    </Link>
  )
}