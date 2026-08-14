import { Link } from 'react-router-dom'

import { useSeo } from '@/hooks/useSeo'

export function NotFoundPage() {
  useSeo({ title: '404 — Page Not Found', description: 'The page you were looking for does not exist.' })

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 py-16 text-center">
      <span className="select-none font-display text-8xl font-black text-black/5 dark:text-white/5" aria-hidden="true">
        見つからない
      </span>
      <div className="-mt-10 space-y-2">
        <h1 className="font-display text-6xl font-black tracking-tight text-zinc-900 dark:text-white md:text-8xl">
          404
        </h1>
        <p className="text-lg font-semibold text-zinc-700 dark:text-zinc-300">Page Not Found</p>
        <p className="mx-auto max-w-md text-sm text-zinc-500">
          The page you're looking for drifted into the void. Let's get you back to solid ground.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Link
          to="/"
          className="rounded-xl bg-flame-600 px-6 py-3 text-sm font-bold uppercase tracking-wider text-white shadow-lg shadow-flame-600/25 transition-all hover:-translate-y-0.5 hover:bg-flame-500"
        >
          Back home
        </Link>
        <Link
          to="/manga"
          className="rounded-xl border border-black/10 bg-white px-6 py-3 text-sm font-bold uppercase tracking-wider text-zinc-700 transition-all hover:-translate-y-0.5 hover:border-flame-500/50 hover:text-flame-500 dark:border-white/10 dark:bg-night-850 dark:text-zinc-200 dark:hover:text-flame-400"
        >
          Browse manga
        </Link>
        <Link
          to="/manhua"
          className="rounded-xl border border-black/10 bg-white px-6 py-3 text-sm font-bold uppercase tracking-wider text-zinc-700 transition-all hover:-translate-y-0.5 hover:border-flame-500/50 hover:text-flame-500 dark:border-white/10 dark:bg-night-850 dark:text-zinc-200 dark:hover:text-flame-400"
        >
          Browse manhua
        </Link>
      </div>
    </div>
  )
}
