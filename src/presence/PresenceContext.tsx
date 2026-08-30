import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/**
 * Live presence / reader stats, backed by the Vercel serverless functions
 * (`api/stats.ts` + `api/beacon.ts`) and Upstash Redis.
 *
 * - Beacon `view` every 45s → key `presence:<clientId>` (TTL 120s) → the
 *   `/api/stats` endpoint counts those keys = "reading right now".
 * - Beacon `read` once per chapter → INCR `<month>` counter = "reads this
 *   month".
 * - On GitHub Pages / local dev there is no `/api` → stats stay `null` and
 *   every badge hides itself gracefully.
 */

const CLIENT_KEY = 'yomikaze:client-id'
const HEARTBEAT_MS = 45000
const STATS_MS = 60000

interface PresenceState {
  /** Active readers in the last ~2 minutes, or null when the API is off. */
  viewers: number | null
  /** Chapter opens this calendar month, or null when the API is off. */
  monthlyReads: number | null
  /** Flag a chapter open (fires only once per chapter id per session). */
  reportRead: (chapterId: string) => void
}

const PresenceContext = createContext<PresenceState>({
  viewers: null,
  monthlyReads: null,
  reportRead: () => {},
})

function getClientId(): string {
  try {
    let id = window.localStorage.getItem(CLIENT_KEY)
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `c-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
      window.localStorage.setItem(CLIENT_KEY, id)
    }
    return id
  } catch {
    return ''
  }
}

export function PresenceProvider({ children }: { children: ReactNode }) {
  const clientIdRef = useRef('')
  const reported = useRef<Set<string>>(new Set())
  const [viewers, setViewers] = useState<number | null>(null)
  const [monthlyReads, setMonthlyReads] = useState<number | null>(null)

  useEffect(() => {
    clientIdRef.current = getClientId()
  }, [])

  const beacon = useCallback((kind: 'view' | 'read') => {
    const clientId = clientIdRef.current
    if (!clientId) return
    void fetch('/api/beacon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, clientId }),
    }).catch(() => {})
  }, [])

  const refresh = useCallback(() => {
    void fetch('/api/stats')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`stats ${r.status}`))))
      .then((d) => {
        if (d && d.enabled) {
          setViewers(typeof d.viewers === 'number' ? d.viewers : null)
          setMonthlyReads(typeof d.monthlyReads === 'number' ? d.monthlyReads : null)
        } else {
          setViewers(null)
          setMonthlyReads(null)
        }
      })
      .catch(() => {
        setViewers(null)
        setMonthlyReads(null)
      })
  }, [])

  // Initial presence ping, then keep the session alive + poll stats.
  useEffect(() => {
    beacon('view')
    refresh()
    const hb = window.setInterval(() => {
      beacon('view')
      refresh()
    }, HEARTBEAT_MS)
    const stats = window.setInterval(refresh, STATS_MS)
    return () => {
      window.clearInterval(hb)
      window.clearInterval(stats)
    }
  }, [beacon, refresh])

  const reportRead = useCallback(
    (chapterId: string) => {
      if (!chapterId || reported.current.has(chapterId)) return
      reported.current.add(chapterId)
      beacon('read')
    },
    [beacon],
  )

  const value = useMemo(
    () => ({ viewers, monthlyReads, reportRead }),
    [viewers, monthlyReads, reportRead],
  )
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>
}

export function usePresence(): PresenceState {
  return useContext(PresenceContext)
}