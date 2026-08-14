import { useCallback, useEffect, useState } from 'react'

import { readLocalJson, writeLocalJson } from '@/lib/utils'

export type Theme = 'dark' | 'light'

const THEME_KEY = 'yomikaze:theme'

function getInitialTheme(): Theme {
  const stored = readLocalJson<Theme | null>(THEME_KEY, null)
  if (stored === 'dark' || stored === 'light') return stored
  // Default: dark (spec section 34). Respect OS preference only as fallback.
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light'
  }
  return 'dark'
}

export function useTheme(): { theme: Theme; toggleTheme: () => void; setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
    writeLocalJson(THEME_KEY, theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#08080d' : '#f7f4ee')
  }, [theme])

  const setTheme = useCallback((t: Theme) => setThemeState(t), [])
  const toggleTheme = useCallback(() => setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark')), [])

  return { theme, toggleTheme, setTheme }
}
