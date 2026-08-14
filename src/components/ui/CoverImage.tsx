import { ImageOff, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { cn, proxyImageUrl } from '@/lib/utils'

interface CoverImageProps {
  src?: string
  alt: string
  className?: string
  imgClassName?: string
  eager?: boolean
  /** Tailwind aspect class, e.g. "aspect-[2/3]" (covers). Defaults to 2/3. */
  aspectClassName?: string
}

export function CoverImage({
  src,
  alt,
  className,
  imgClassName,
  eager = false,
  aspectClassName = 'aspect-[2/3]',
}: CoverImageProps) {
  // Route mangafire CDN covers through the local /mfcdn/ proxy so they load
  // with the correct Referer (fixes hotlink-blocked covers everywhere,
  // including Continue Reading / History snapshots stored in localStorage).
  const proxiedSrc = proxyImageUrl(src)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(proxiedSrc ? 'loading' : 'error')
  const [attempt, setAttempt] = useState(0)

  const retry = () => {
    setAttempt((a) => a + 1)
    setStatus('loading')
  }

  return (
    <div className={cn('relative overflow-hidden', aspectClassName, className)}>
      {status !== 'loaded' ? (
        <div className={cn('skeleton absolute inset-0', status === 'error' && '!bg-transparent')}>
          {status === 'error' ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-night-800/80 p-3 text-center dark:bg-night-800/80">
              <ImageOff className="h-6 w-6 text-zinc-600" />
              <span className="text-[11px] leading-tight text-zinc-500">Image unavailable</span>
              <button
                type="button"
                onClick={retry}
                aria-label={`Retry loading image for ${alt}`}
                className="rounded border border-white/10 p-1 text-zinc-400 transition-colors hover:border-flame-500/50 hover:text-flame-300"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {proxiedSrc ? (
        <img
          key={`${proxiedSrc}:${attempt}`}
          src={proxiedSrc}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
          className={cn(
            'h-full w-full object-cover transition-opacity duration-300',
            status === 'loaded' ? 'opacity-100' : 'opacity-0',
            imgClassName,
          )}
        />
      ) : null}
    </div>
  )
}
