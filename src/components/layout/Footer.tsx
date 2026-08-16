import { Link } from 'react-router-dom'

import { provider } from '@/providers/ProviderFactory'

const explore = [
  { to: '/', label: 'Home' },
  { to: '/manga', label: 'Manga' },
  { to: '/manhua', label: 'Manhua' },
  { to: '/genres', label: 'Genres' },
]

const library = [
  { to: '/search', label: 'Search' },
  { to: '/favorites', label: 'Favorites' },
  { to: '/history', label: 'History' },
]

export function Footer() {
  return (
    <footer className="mt-16 border-t border-black/5 bg-white pb-20 lg:pb-0 dark:border-white/5 dark:bg-night-950">
      <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <p className="font-display text-2xl font-black tracking-tight text-zinc-900 dark:text-white">
              YOMI<span className="text-flame-500">KAZE</span>
            </p>
            <p className="mt-1 text-sm font-medium tracking-[0.3em] text-zinc-500">READ · DISCOVER · ESCAPE</p>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              A modern Manga + Manhua discovery and reading platform. Explore thousands of titles and read in a
              beautiful, distraction-free reader.
            </p>
            <p className="mt-4 text-xs text-zinc-500">
              Content provider: <span className="font-semibold">{provider.label}</span>
            </p>
          </div>

          <nav aria-label="Explore">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-500">Explore</h3>
            <ul className="space-y-2">
              {explore.map((l) => (
                <li key={l.to}>
                  <Link
                    to={l.to}
                    className="text-sm text-zinc-600 transition-colors hover:text-flame-500 dark:text-zinc-400 dark:hover:text-flame-400"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Library">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-500">Library</h3>
            <ul className="space-y-2">
              {library.map((l) => (
                <li key={l.to}>
                  <Link
                    to={l.to}
                    className="text-sm text-zinc-600 transition-colors hover:text-flame-500 dark:text-zinc-400 dark:hover:text-flame-400"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-10 border-t border-black/5 pt-6 dark:border-white/5">
          <p className="text-xs leading-relaxed text-zinc-500">
            Chapters &amp; metadata: aggregated from community sources —{' '}
            <span className="font-medium text-zinc-600 dark:text-zinc-400">MangaFire</span> (mangafire.to) and{' '}
            <span className="font-medium text-zinc-600 dark:text-zinc-400">AsuraScans</span> (asurascans.com). Credit
            to the scanlation groups and translators whose uploads appear in the reader. YOMIKAZE is an unofficial fan
            project — all titles remain the property of their respective authors and publishers.
          </p>
          <p className="mt-3 text-xs text-zinc-500">
            © {new Date().getFullYear()} YOMIKAZE — Read. Discover. Escape.
          </p>
        </div>
      </div>
    </footer>
  )
}
