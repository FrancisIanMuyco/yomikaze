import { Heart, HeartOff } from 'lucide-react'
import { Link } from 'react-router-dom'

import { TypeBadge } from '@/components/ui/Badge'
import { CoverImage } from '@/components/ui/CoverImage'
import { EmptyState } from '@/components/ui/States'
import { useFavorites } from '@/hooks/useFavorites'
import { useSeo } from '@/hooks/useSeo'

export function FavoritesPage() {
  const { favorites, removeFavorite } = useFavorites()
  useSeo({ title: 'Favorites' })

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-black tracking-tight text-zinc-900 dark:text-white md:text-4xl">
          Favorites
        </h1>
        <p className="text-sm text-zinc-500">お気に入り — your saved titles, stored locally on this device.</p>
      </header>

      {favorites.length === 0 ? (
        <EmptyState
          icon={<Heart className="h-10 w-10" />}
          title="Nothing saved yet"
          message="Tap “Add to Favorites” on any title to build your personal shelf."
          action={
            <Link
              to="/manga"
              className="rounded-xl bg-flame-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-flame-500"
            >
              Browse manga
            </Link>
          }
        />
      ) : (
        <div className="stagger-children grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {favorites.map((title) => (
            <div
              key={title.id}
              className="group relative overflow-hidden rounded-xl border border-black/5 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl dark:border-white/5 dark:bg-night-850"
            >
              <Link to={`/title/${title.id}`} aria-label={title.title}>
                <CoverImage src={title.coverUrl} alt={`${title.title} cover`} className="aspect-[2/3]" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-3 pt-10">
                  <h3 className="line-clamp-2 font-display text-sm font-bold text-white">{title.title}</h3>
                  <p className="mt-1 text-[11px] text-zinc-400">{title.chapterCount ?? '—'} chapters</p>
                </div>
              </Link>
              <div className="absolute left-2 top-2">
                <TypeBadge type={title.type} className="shadow-lg shadow-black/30" />
              </div>
              <button
                type="button"
                onClick={() => removeFavorite(title.id)}
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white/70 backdrop-blur-sm transition-all hover:bg-flame-600 hover:text-white"
                aria-label={`Remove ${title.title} from favorites`}
                title="Remove from favorites"
              >
                <HeartOff className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
