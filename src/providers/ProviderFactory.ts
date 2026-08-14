import type { ContentProvider } from '@/providers/ContentProvider'
import { AniListProvider } from '@/providers/anilist/AniListProvider'
import { DemoReaderProvider } from '@/providers/demo/DemoReaderProvider'
import { HybridProvider } from '@/providers/HybridProvider'
import { MangaDexProvider } from '@/providers/mangadex/MangaDexProvider'
import { MockProvider } from '@/providers/mock/MockProvider'
import { MangaFireProvider } from '@/providers/mangafire/MangaFireProvider'
import { ScrapedProvider } from '@/providers/scraped/ScrapedProvider'

export type ProviderMode = 'mangadex' | 'auto' | 'anilist' | 'demo' | 'mock' | 'mangafire' | 'scraped'

/**
 * Selects the active content provider from the environment:
 *
 *   VITE_CONTENT_PROVIDER=mangadex → MangaDex official API (default)
 *   VITE_CONTENT_PROVIDER=auto     → MangaDex + fallback handling
 *   VITE_CONTENT_PROVIDER=anilist  → AniList metadata only
 *   VITE_CONTENT_PROVIDER=demo     → original demo content only (offline)
 *   VITE_CONTENT_PROVIDER=mock     → built-in mock metadata only (offline)
 *   VITE_CONTENT_PROVIDER=mangafire → MangaFire scraped data
 */
export function createProvider(mode?: ProviderMode): ContentProvider {
  const raw = (mode ?? import.meta.env.VITE_CONTENT_PROVIDER ?? 'mangadex').toLowerCase()
  switch (raw) {
    case 'auto':
      return new HybridProvider()
    case 'anilist':
      return new AniListProvider()
    case 'demo':
      return new DemoReaderProvider()
    case 'mock':
      return new MockProvider()
    case 'mangafire':
      return new MangaFireProvider()
    case 'scraped':
      return new ScrapedProvider()
    case 'mangadex':
    default:
      return new MangaDexProvider()
  }
}

export const provider: ContentProvider = createProvider()
