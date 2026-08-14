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
 *   /md/*   → https://api.mangadex.org/*         (JSON API)
 *   /covers/* → https://uploads.mangadex.org/covers/*  (cover images)
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

    return new Response('Not found', { status: 404 })
  },
}
