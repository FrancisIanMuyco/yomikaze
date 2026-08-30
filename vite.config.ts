import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import type { Connect, Plugin } from 'vite'

// ---------------------------------------------------------------------------
// mangafire.to CDN proxy
//
// MangaFire's image CDN (mfcdn*.xyz) returns HTTP 403 unless the request
// carries a `Referer: https://mangafire.to/` header. Browsers send the origin
// of the site instead (e.g. http://localhost:5173), so hotlinked images load
// blank. This middleware re-serves mangafire images from a local path
// (/mfcdn/<host>/<path>) with the correct Referer, so the reader works.
//
// Images are referenced as /mfcdn/<cdn-host>/<original-path> and proxied
// server-side. Only active on the Vite dev server and vite preview.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Local manga page cache
//
// The scraper pipeline (debug_download.py / yomikaze_downloader) downloads
// chapter pages into `manga-cache/` and rewrites scraped.json URLs to local
// `/manga/<slug>/ch-<n>-0/page-<nnn>.jpg` paths. That folder used to live in
// `public/`, but with tens of thousands of images every `npm run build` spent
// minutes copying them into dist. The cache now lives at the project root
// (gitignored) and this middleware serves it in dev AND preview, so local
// chapter URLs keep working exactly as before.
// ---------------------------------------------------------------------------

const MANGA_CACHE_DIR = join(import.meta.dirname, 'manga-cache')

function mangaCacheMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = req.url ?? ''
    if (!url.startsWith('/manga/')) return next()
    const filePath = join(MANGA_CACHE_DIR, url.replace(/^\/manga\//, ''))
    // Prevent path traversal outside the cache dir.
    if (!filePath.startsWith(MANGA_CACHE_DIR + sep)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    if (!existsSync(filePath)) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    res.writeHead(200, {
      'Content-Type': url.endsWith('.webp') ? 'image/webp' : url.endsWith('.png') ? 'image/png' : 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(readFileSync(filePath))
  }
}

const MFCDN_REFERER = 'https://mangafire.to/'
const MFCDN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

function mangafireImageProxy(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    const url = req.url ?? ''

    // Current format (see proxyImageUrl in src/lib/utils.ts):
    //   /api/mfcdn?url=<encoded https://host/path>
    let target: URL | null = null
    try {
      const u = new URL(url, 'http://localhost')
      if (u.pathname === '/api/mfcdn') {
        const t = u.searchParams.get('url')
        if (t) target = new URL(t)
      }
    } catch {
      target = null
    }

    // Legacy format: /mfcdn/<host>/<path>
    if (!target) {
      const match = /^\/mfcdn\/([^/]+)\/(.+)$/.exec(url)
      if (match) {
        try {
          target = new URL(`https://${match[1]}/${match[2]}`)
        } catch {
          target = null
        }
      }
    }

    if (!target || target.protocol !== 'https:' || !/mfcdn/i.test(target.hostname)) {
      return next()
    }

    try {
      const upstream = await fetch(target.toString(), {
        headers: {
          Referer: MFCDN_REFERER,
          'User-Agent': MFCDN_UA,
          Accept: 'image/*',
        },
      })
      if (!upstream.ok) {
        res.statusCode = upstream.status
        res.end()
        return
      }
      const buf = Buffer.from(await upstream.arrayBuffer())
      res.writeHead(200, {
        'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      })
      res.end(buf)
    } catch {
      res.writeHead(502)
      res.end('mfcdn proxy error')
    }
  }
}

// GitHub Pages serves the site from a sub-path (/yomikaze/) unless a custom
// domain is configured. Vite's `base` must match so asset URLs resolve.
// In dev this is '/' (no sub-path), and the built app works on any static host.
const BASE = process.env.VITE_BASE_PATH || '/'

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    tailwindcss(),
    // PWA (2026-08-22): installable app + offline support.
    // - App shell cached on first visit; SPA navigations served offline.
    // - Chapter images (/api/mfcdn) cached CacheFirst — visited pages stay
    //   readable even offline, and repeat visits load instantly.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'pwa-192.png', 'pwa-512.png'],
      manifest: {
        name: 'YOMIKAZE — Read. Discover. Escape.',
        short_name: 'YOMIKAZE',
        description: 'A modern manga + manhua discovery and reading platform.',
        theme_color: '#0b0b12',
        background_color: '#0b0b12',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // Chapter page images via the mfcdn proxy — CacheFirst.
            urlPattern: /\/api\/mfcdn\?url=/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mfcdn-pages-v1',
              // Generous limit: this cache doubles as the offline-download
              // store (src/lib/offline.ts writes here too).
              expiration: { maxEntries: 20000, maxAgeSeconds: 60 * 60 * 24 * 60, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: false,
            },
          },
        ],
      },
    }),
    // GitHub Pages SPA fallback: unknown paths (e.g. /title/xxx, /reader/...)
    // serve 404.html instead of a hard 404, and since 404.html is a copy of
    // index.html, React Router picks the route up client-side.
    {
      name: 'gh-pages-404-fallback',
      apply: 'build',
      closeBundle() {
        const outDir = 'dist'
        copyFileSync(join(outDir, 'index.html'), join(outDir, '404.html'))
      },
    } satisfies Plugin,
    // Local proxy so mangafire CDN images load in the reader (see above).
    {
      name: 'mfcdn-image-proxy',
      configureServer(server) {
        server.middlewares.use(mangafireImageProxy())
      },
      configurePreviewServer(server) {
        server.middlewares.use(mangafireImageProxy())
      },
    } satisfies Plugin,
    // Serve the local chapter-page cache (manga-cache/) in dev + preview.
    {
      name: 'manga-cache-middleware',
      configureServer(server) {
        server.middlewares.use(mangaCacheMiddleware())
      },
      configurePreviewServer(server) {
        server.middlewares.use(mangaCacheMiddleware())
      },
    } satisfies Plugin,
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
    // The site can be exposed publicly via a Cloudflare quick tunnel
    // (trycloudflare.com) so chapter images load from a residential IP.
    // Allow those hosts through Vite's preview host allowlist.
    allowedHosts: ['.trycloudflare.com'],
  },
})
