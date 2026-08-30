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
 * Speed: ALL attempts (direct + up to 8 proxies) fire in PARALLEL and the
 * first one to return a usable image wins — a single dead proxy can no longer
 * stall the whole request for its 25s timeout. The last working proxy is
 * remembered per warm instance so repeat requests go straight to a winner.
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
const ATTEMPT_TIMEOUT = 8000 // ms per attempt — fail fast on dead proxies
const MAX_ATTEMPTS = 8

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

// Remembered across requests on a warm instance: try this proxy first.
let lastGoodProxy = null

const BLOCKED = (code) =>
  code === 403 || code === 407 || code === 408 || code === 429 || code >= 500

function toResult(res) {
  if (BLOCKED(res.status)) return null // blocked/transient → not a usable answer
  return {
    status: res.status,
    data: Buffer.from(res.data),
    contentType: res.headers['content-type'] || 'image/jpeg',
  }
}

async function fetchVia(targetUrl, agent, timeout = ATTEMPT_TIMEOUT) {
  try {
    const res = await axios.get(targetUrl, {
      headers: HEADERS,
      httpsAgent: agent,
      proxy: false,
      responseType: 'arraybuffer',
      timeout,
      maxRedirects: 5,
      validateStatus: () => true,
    })
    return toResult(res)
  } catch {
    return null
  }
}

/** Return the FIRST non-null result across all in-flight attempts. */
function firstResult(attempts) {
  return new Promise((resolve, reject) => {
    let pending = attempts.length
    let settled = false
    for (const fn of attempts) {
      Promise.resolve()
        .then(fn)
        .then((v) => {
          if (!settled && v) {
            settled = true
            resolve(v)
          }
        })
        .catch(() => {})
        .then(() => {
          if (!settled && --pending === 0) reject(new Error('all attempts failed'))
        })
    }
  })
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

  const targetStr = upstreamUrl.toString()
  try {
    const attempts = [() => fetchVia(targetStr, null)] // Vercel's own egress, no agent
    const pool = lastGoodProxy ? [lastGoodProxy, ...PROXIES.filter((p) => p !== lastGoodProxy)] : PROXIES
    for (const proxy of pool.slice(0, MAX_ATTEMPTS)) {
      const agent = new HttpsProxyAgent(proxy)
      attempts.push(() =>
        fetchVia(targetStr, agent).then((res) => {
          if (res) lastGoodProxy = proxy
          return res
        })
      )
    }

    const upstream = await firstResult(attempts)
    res.setHeader('Content-Type', upstream.contentType)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.status(upstream.status).end(upstream.data)
  } catch {
    res.status(502).end('mfcdn proxy error')
  }
}