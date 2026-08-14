import { useCallback, useEffect, useMemo, useState } from 'react'

import { normalizeId } from '@/lib/utils'
import { provider } from '@/providers/ProviderFactory'
import type { Title } from '@/types'

/**
 * Index of the live library keyed by title id.
 *
 * Continue Reading / History store a title snapshot (name, cover, id) in
 * localStorage when a chapter is opened. Those snapshots go stale — old
 * mangafire slugs (`mangafire:God Level Assassin`), replaced covers, dead
 * CDN links — so we resolve the current Title from the provider and fall
 * back to the snapshot only when the title is no longer in the library.
 */
export function useLibraryIndex(): {
  index: Map<string, Title>
  /** Resolve a (possibly stale) title id to the current Title. */
  resolve: (id: string | undefined) => Title | undefined
} {
  const [index, setIndex] = useState<Map<string, Title>>(new Map())

  useEffect(() => {
    let alive = true
    provider
      .getTitles()
      .then(titles => {
        if (!alive) return
        const map = new Map<string, Title>()
        for (const t of titles) {
          if (t.id) map.set(t.id, t)
        }
        setIndex(map)
      })
      .catch(() => {
        // keep snapshot data on provider errors
      })
    return () => {
      alive = false
    }
  }, [])

  const resolve = useCallback(
    (id: string | undefined): Title | undefined => {
      if (!id) return undefined
      // Exact match first (the common case — fresh links).
      const exact = index.get(id)
      if (exact) return exact
      // Fuzzy match for stale slugs: normalize both sides and look for a
      // contains relationship, e.g. `mangafire:God Level Assassin` →
      // `mangafire:God-Level Assassin, I'm the Shadow`.
      const norm = normalizeId(id)
      if (!norm) return undefined
      for (const t of index.values()) {
        const tn = normalizeId(t.id)
        if (tn.length > 0 && (tn.includes(norm) || norm.includes(tn))) return t
      }
      return undefined
    },
    [index],
  )

  return useMemo(() => ({ index, resolve }), [index, resolve])
}
