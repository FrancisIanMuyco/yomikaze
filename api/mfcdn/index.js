/**
 * YOMIKAZE — MangaFire image proxy (Vercel serverless function)
 *
 * Why: MangaFire's chapter image CDN (*.mfcdn*.xyz) is behind Cloudflare and
 * its WAF blocks requests from big cloud providers — Cloudflare's own IPs and
 * AWS (Vercel's egress) both get 403 "Attention Required". Only smaller
 * datacenter IPs (and residential IPs) are allowed.
 *
 * Solution: route the upstream fetch through the user's WORKING PROXY LIST
 * (small US datacenters, which the CDN allows). The list is provided as the
 * MFCDN_PROXIES environment variable (newline-separated
 * http://user:pass@ip:port entries, refreshed from the scraper's checker).
 *
 * Note: Vercel's global `fetch` ignores the undici `agent` option, so we use
 * axios + https-proxy-agent (both already project dependencies) to guarantee
 * the request actually tunnels through the proxy.
 *
 * URL scheme (matches the frontend's proxyImageUrl output):
 *   /api/mfcdn?url=<encoded https URL>   →  fetch that URL with the Referer
 */

import axios from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'

const MFCDN_REFERER = 'https://mangafire.to/'
const MFCDN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const PROXIES = (process.env.MFCDN_PROXIES || '')
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean)

const HEADERS = {
  Referer: MFCDN_REFERER,
  'User-Agent': MFCDN_UA,
  Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

async function fetchViaProxies(targetUrl, attempts = 8) {
  const order = [...PROXIES].sort(() => Math.random() - 0.5).slice(0, attempts)
  let lastErr
  for (const proxy of order) {
    try {
      const agent = new HttpsProxyAgent(proxy)
      const res = await axios.get(targetUrl, {
        headers: HEADERS,
        httpsAgent: agent,
        proxy: false, // tunnel via the agent; don't let axios use env proxies
        responseType: 'arraybuffer',
        timeout: 25000,
        maxRedirects: 5,
        validateStatus: () => true, // handle statuses ourselves below
      })
      // 403 = CDN blocked this proxy's IP; 407 = stale proxy credentials;
      // 408/429/5xx = transient failures → try the next proxy.
      // Anything else (200, 404, …) is a real result to return.
      if (res.status === 403 || res.status === 407 || res.status === 408 || res.status === 429 || res.status >= 500) {
        lastErr = new Error(`status ${res.status}`)
        continue
      }
      return {
        status: res.status,
        data: Buffer.from(res.data),
        contentType: res.headers['content-type'] || 'image/jpeg',
      }
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

export default async function handler(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const target = url.searchParams.get('url')
  if (!target) return res.status(400).end('Bad request: missing url')

  let upstreamUrl
  try {
    upstreamUrl = new URL(target)
  } catch {
    return res.status(400).end('Bad url')
  }
  if (upstreamUrl.protocol !== 'https:' || !/mfcdn/i.test(upstreamUrl.hostname)) {
    return res.status(400).end('Bad host')
  }

  try {
    const upstream = await fetchViaProxies(upstreamUrl.toString())
    res.setHeader('Content-Type', upstream.contentType)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.status(upstream.status).end(upstream.data)
  } catch {
    res.status(502).end('mfcdn proxy error')
  }
}
