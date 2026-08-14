import { useCallback, useEffect, useState } from 'react'

import { readLocalJson, writeLocalJson } from '@/lib/utils'
import type { Title } from '@/types'

const FAVORITES_KEY = 'yomikaze:favorites'

function readFavorites(): Title[] {
  return readLocalJson<Title[]>(FAVORITES_KEY, [])
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<Title[]>(readFavorites)

  useEffect(() => {
    writeLocalJson(FAVORITES_KEY, favorites)
  }, [favorites])

  const isFavorite = useCallback(
    (titleId: string) => favorites.some((t) => t.id === titleId),
    [favorites],
  )

  const addFavorite = useCallback((title: Title) => {
    setFavorites((prev) => (prev.some((t) => t.id === title.id) ? prev : [title, ...prev]))
  }, [])

  const removeFavorite = useCallback((titleId: string) => {
    setFavorites((prev) => prev.filter((t) => t.id !== titleId))
  }, [])

  const toggleFavorite = useCallback(
    (title: Title) => {
      setFavorites((prev) =>
        prev.some((t) => t.id === title.id)
          ? prev.filter((t) => t.id !== title.id)
          : [title, ...prev],
      )
    },
    [],
  )

  return { favorites, isFavorite, addFavorite, removeFavorite, toggleFavorite }
}
