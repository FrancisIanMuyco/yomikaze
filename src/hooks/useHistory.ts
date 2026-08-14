import { useCallback, useEffect, useState } from 'react'

import { readLocalJson, writeLocalJson } from '@/lib/utils'
import type { HistoryEntry } from '@/types'

const HISTORY_KEY = 'yomikaze:history'

function readHistory(): HistoryEntry[] {
  return readLocalJson<HistoryEntry[]>(HISTORY_KEY, [])
}

export function useHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>(readHistory)

  useEffect(() => {
    writeLocalJson(HISTORY_KEY, history)
  }, [history])

  /** Add or update the most recent entry for a title. */
  const recordHistory = useCallback((entry: Omit<HistoryEntry, 'timestamp'>) => {
    setHistory((prev) => {
      const rest = prev.filter((h) => h.titleId !== entry.titleId)
      return [{ ...entry, timestamp: Date.now() }, ...rest].slice(0, 50)
    })
  }, [])

  const removeEntry = useCallback((titleId: string) => {
    setHistory((prev) => prev.filter((h) => h.titleId !== titleId))
  }, [])

  const clearHistory = useCallback(() => setHistory([]), [])

  return { history, recordHistory, removeEntry, clearHistory }
}
