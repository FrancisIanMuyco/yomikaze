import { useEffect } from 'react'

function setMeta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

/**
 * Sets document title + meta description + Open Graph tags per page.
 * Example: `[Title] — YOMIKAZE` (spec section 44).
 */
export function useSeo(options: { title?: string; description?: string }): void {
  useEffect(() => {
    const fullTitle = options.title ? `${options.title} — YOMIKAZE` : 'YOMIKAZE — Read. Discover. Escape.'
    document.title = fullTitle
    const description =
      options.description ?? 'Read. Discover. Escape. A modern Manga + Manhua discovery and reading platform.'
    setMeta('name', 'description', description)
    setMeta('property', 'og:title', fullTitle)
    setMeta('property', 'og:description', description)
  }, [options.title, options.description])
}
