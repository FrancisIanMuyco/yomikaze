/**
 * YOMIKAZE — MangaFire image proxy (Deno Deploy)
 *
 * MangaFire's chapter image CDN (*.mfcdn*.xyz) is behind Cloudflare, and its
 * WAF blocks requests from Cloudflare's own IPs (a Cloudflare Worker gets 403
 * even with the correct Referer). This proxy runs on Deno Deploy (NOT
 * Cloudflare IPs), fetches the image with the mangafire Referer, and returns
 * it to the browser.
 *
 * Deploy (free, no credit card):
 *   1. https://dash.deno.com → New Playground
 *   2. Delete all default code, paste THIS file's contents
 *   3. Name it yomikaze-img-proxy → Deploy
 *   4. URL: https://yomikaze-img-proxy.deno.dev
 *
 * Only route: /mfcdn/<host>/<path> → https://<host>/<path> with the Referer.
 */

const MFCDN_REFERER = 'https://mangafire.to/'
const MFCDN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
}

Deno.serve(async (request) => {
  const url = new URL(request.url)
  const path = url.pathname

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (!path.startsWith('/mfcdn/')) {
    return new Response('Not found', { status: 404 })
  }

  const rest = path.slice('/mfcdn/'.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return new Response('Bad mfcdn path', { status: 400 })
  const host = rest.slice(0, slash)
  const imgPath = rest.slice(slash)
  if (!/mfcdn/i.test(host)) return new Response('Bad host', { status: 400 })

  const headers = new Headers()
  headers.set('Referer', MFCDN_REFERER)
  headers.set('User-Agent', MFCDN_UA)
  headers.set('Accept', 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8')
  headers.set('Accept-Language', 'en-US,en;q=0.9')
  headers.set('Sec-Fetch-Dest', 'image')
  headers.set('Sec-Fetch-Mode', 'no-cors')
  headers.set('Sec-Fetch-Site', 'cross-site')

  const upstream = await fetch(`https://${host}${imgPath}`, {
    headers,
    redirect: 'follow',
  })
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
})
