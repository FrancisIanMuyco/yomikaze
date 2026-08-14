/**
 * YOMIKAZE — MangaDex proxy (Cloudflare Worker)
 *
 * Why this exists:
 *   Some ISPs/networks block api.mangadex.org and uploads.mangadex.org over
 *   HTTPS (SNI-based TLS filtering), so the site shows "Could not load
 *   content" on those networks even though MangaDex is up globally.
 *
 *   This worker runs on Cloudflare's network (never blocked), fetches MangaDex
 *   server-side, and returns the response to the browser with CORS headers.
 *
 * Routing:
 *   /md/*       → https://api.mangadex.org/*         (JSON API)
 *   /covers/*   → https://uploads.mangadex.org/covers/*  (MangaDex covers)
 *   /mfcdn/*    → https://<host>/<path> with Referer: mangafire.to (MangaFire
 *                 CDN images are hotlink-protected — the browser can't send
 *                 the Referer, so we fetch server-side and pass it through)
 *
 * Deploy (free tier, 100k requests/day):
 *   1. Go to https://dash.cloudflare.com → Workers & Pages → Create → Worker
 *   2. Replace the default code with THIS file's contents
 *   3. Name it e.g. `yomikaze-md-proxy` → Deploy
 *   4. Your proxy URL is https://yomikaze-md-proxy.<subdomain>.workers.dev
 *   5. Tell the dev the URL — they'll wire it into the site build.
 */

const API_ORIGIN = 'https://api.mangadex.org'
const COVERS_ORIGIN = 'https://uploads.mangadex.org/covers'

// MangaFire CDN images require a `Referer: https://mangafire.to/` header or
// they return 403. The browser sends the site's origin instead, so we fetch
// them here (server-side) with the correct Referer and pass the bytes through.
const MFCDN_REFERER = 'https://mangafire.to/'
const MFCDN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type, User-Agent',
  'Access-Control-Max-Age': '86400',
}

async function proxy(request, targetUrl) {
  // Forward the Accept header (MangaDex expects JSON) and any User-Agent we set.
  const headers = new Headers()
  const accept = request.headers.get('Accept')
  if (accept) headers.set('Accept', accept)
  headers.set('User-Agent', 'YOMIKAZE/1.0 (manga reader; Cloudflare Worker proxy)')

  const upstream = await fetch(targetUrl.toString(), {
    method: request.method,
    headers,
    redirect: 'follow',
  })

  const body = await upstream.arrayBuffer()
  const response = new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
  })

  // Copy through useful upstream headers, then add CORS.
  const contentType = upstream.headers.get('content-type')
  if (contentType) response.headers.set('content-type', contentType)
  const cacheControl = upstream.headers.get('cache-control')
  if (cacheControl) response.headers.set('cache-control', cacheControl)
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    response.headers.set(k, v)
  }
  return response
}

export default {
  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname

    // OPTIONS preflight (browsers send this for cross-origin fetches)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    // /md/<path>?<query> → https://api.mangadex.org/<path>?<query>
    if (path.startsWith('/md/')) {
      const target = new URL(API_ORIGIN)
      target.pathname = path.slice('/md'.length) // keep the leading slash
      target.search = url.search
      return proxy(request, target)
    }

    // /covers/<rest> → https://uploads.mangadex.org/covers/<rest>
    if (path.startsWith('/covers/')) {
      const target = new URL(COVERS_ORIGIN)
      target.pathname = path // /covers/... already matches
      target.search = url.search
      return proxy(request, target)
    }

    // /mfcdn/<host>/<path> → https://<host>/<path> with a mangafire Referer
    // (hotlink-protected MangaFire CDN images — dev uses vite middleware with
    // the same trick; this makes it work on static hosting like GitHub Pages).
    if (path.startsWith('/mfcdn/')) {
      const rest = path.slice('/mfcdn/'.length)
      const slash = rest.indexOf('/')
      if (slash <= 0) return new Response('Bad mfcdn path', { status: 400 })
      const host = rest.slice(0, slash)
      const imgPath = rest.slice(slash)
      if (!/^[a-z0-9.-]+\.(mfcdn\d*\.)?[a-z0-9.-]+$/i.test(host) && !/mfcdn/i.test(host)) {
        return new Response('Bad host', { status: 400 })
      }
      const target = new URL(`https://${host}${imgPath}`)
      const headers = new Headers()
      headers.set('Referer', MFCDN_REFERER)
      headers.set('User-Agent', MFCDN_UA)
      headers.set('Accept', 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8')
      headers.set('Accept-Language', 'en-US,en;q=0.9')
      headers.set('Sec-Fetch-Dest', 'image')
      headers.set('Sec-Fetch-Mode', 'no-cors')
      headers.set('Sec-Fetch-Site', 'cross-site')
      headers.set('Cache-Control', 'no-cache')
      const upstream = await fetch(target.toString(), { headers, redirect: 'follow' })
      const body = await upstream.arrayBuffer()
      const response = new Response(body, {
        status: upstream.status,
        statusText: upstream.statusText,
      })
      const contentType = upstream.headers.get('content-type')
      if (contentType) response.headers.set('content-type', contentType)
      response.headers.set('Cache-Control', 'public, max-age=86400')
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }

    return new Response('Not found', { status: 404 })
  },
}
