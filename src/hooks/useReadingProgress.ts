import { useCallback, useEffect, useState } from 'react'

import { readLocalJson, writeLocalJson } from '@/lib/utils'
import type { ReadingProgress } from '@/types'

const PROGRESS_KEY = 'yomikaze:progress'

function readProgress(): Record<string, ReadingProgress> {
  return readLocalJson<Record<string, ReadingProgress>>(PROGRESS_KEY, {})
}

export function useReadingProgress() {
  const [progress, setProgress] = useState<Record<string, ReadingProgress>>(readProgress)

  useEffect(() => {
    writeLocalJson(PROGRESS_KEY, progress)
  }, [progress])

  /** Keyed by titleId so "Continue reading" is per-title. */
  const saveProgress = useCallback((entry: Omit<ReadingProgress, 'timestamp'>) => {
    setProgress((prev) => ({
      ...prev,
      [entry.titleId]: { ...entry, timestamp: Date.now() },
    }))
  }, [])

  const getProgress = useCallback(
    (titleId: string) => progress[titleId] ?? null,
    [progress],
  )

  const clearProgress = useCallback(
    (titleId: string) => {
      setProgress((prev) => {
        const next = { ...prev }
        delete next[titleId]
        return next
      })
    },
    [],
  )

  return { progress, saveProgress, getProgress, clearProgress }
}
