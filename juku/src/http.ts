/**
 * HTTP client (axios) — the fast direct-request path of the pipeline.
 *
 * Execution flow for a normal page:
 *   Proxy Pool → Rate Limiter → Request Queue → Axios → Cache
 * With retries: Retry Manager → Proxy Rotation → Request again.
 */
import axios, { AxiosError, type AxiosRequestConfig } from 'axios'
import http from 'node:http'
import https from 'node:https'
import type { Logger } from './logger.js'
import type { ProxyEntry } from './proxies.js'
import { agentFor } from './proxies.js'
import { RetryManager, RetryError } from './retry.js'
import type { RateLimiter } from './ratelimit.js'
import type { RequestQueue } from './queue.js'
import type { Cache } from './cache.js'
import type { CircuitBreaker } from './circuit.js'

// Shared keep-alive agents → connection reuse across requests (HTTP mode
// session pooling). One agent pair for the whole client keeps memory low
// instead of creating a new socket per request.
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 32 })
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 32 })
const sharedAxios = axios.create({
  httpAgent,
  httpsAgent,
})

export interface HttpResponse<T = unknown> {
  status: number
  headers: Record<string, string>
  data: T
  fromCache: boolean
  durationMs: number
  proxy?: string
}

export interface HttpOptions {
  method?: 'GET' | 'POST' | 'HEAD'
  headers?: Record<string, string>
  data?: unknown
  timeoutMs?: number
  /** Use a specific proxy instead of rotating from the pool */
  proxy?: ProxyEntry | null
  /** Do not use any proxy */
  noProxy?: boolean
  /** Cache the response under this key (URL-based) */
  cacheKey?: string
  /** Cache TTL in ms */
  cacheTtlMs?: number
  /** Skip the cache entirely */
  noCache?: boolean
  /** Source name for rate limiting / circuit breaker */
  source: string
  /** Queue priority (lower = first) */
  priority?: number
  /** Retry attempts for this request */
  retries?: number
  /** Force the browser path (Playwright) for JS-rendered pages */
  useBrowser?: boolean
}

export interface HttpClientDeps {
  logger: Logger
  rateLimiter: RateLimiter
  queue: RequestQueue
  cache: Cache
  circuitBreaker: CircuitBreaker
  getProxy: () => ProxyEntry | null
  markProxySuccess: (p: ProxyEntry, latencyMs?: number) => void
  markProxyFailure: (p: ProxyEntry) => void
  browserFetch: (url: string, opts: HttpOptions) => Promise<HttpResponse>
  /** Resource gate — awaited before every request so the scraper pauses
   * when CPU/RAM is critical (auto throttling). */
  gate?: () => Promise<void>
}

export class HttpClient {
  constructor(private readonly opts: HttpClientDeps) {}

  async request<T>(url: string, opts: HttpOptions): Promise<HttpResponse<T>> {
    const source = opts.source
    const cacheKey = opts.noCache ? undefined : (opts.cacheKey ?? `http:${opts.method ?? 'GET'}:${url}`)

    // Resource gate: pause before starting new work when the system is hot.
    if (this.opts.gate) await this.opts.gate()

    // Cache check first (with request dedup via cache.wrap).
    if (cacheKey) {
      const cached = this.opts.cache.get<T>(cacheKey)
      if (cached !== undefined) {
        return { status: 200, headers: {}, data: cached, fromCache: true, durationMs: 0 }
      }
    }

    // Circuit breaker gate — repeated failures disable the source.
    this.opts.circuitBreaker.allow(source)

    const retries = opts.retries ?? 3
    const requestTimeoutMs = opts.timeoutMs ?? 20_000
    const manager = new RetryManager(
      {
        attempts: retries,
        baseDelayMs: 500,
        maxDelayMs: 15_000,
        onRetry: () => {
          // Proxy rotation happens naturally: next() advances the cursor.
        },
      },
      this.opts.logger,
    )

    // The queue job timeout must cover every retry attempt + backoff, or the
    // whole job dies mid-retry.
    const jobTimeoutMs = requestTimeoutMs * (retries + 1) + 20_000
    const response = await this.opts.queue.add<HttpResponse<T>>({
      id: cacheKey ?? `http:${Date.now()}:${url}`,
      source,
      priority: opts.priority ?? 0,
      timeoutMs: jobTimeoutMs,
      retries: 1,
      run: async () => {
        await this.opts.rateLimiter.acquire(source)
        try {
          const result = await manager.run<HttpResponse<T>>(async attempt => {
            if (opts.useBrowser) {
              const r = (await this.opts.browserFetch(url, opts)) as HttpResponse<T>
              this.opts.circuitBreaker.recordSuccess(source)
              return r
            }
            const proxy = opts.noProxy ? null : (opts.proxy ?? this.opts.getProxy())
            const config: AxiosRequestConfig = {
              method: opts.method ?? 'GET',
              url,
              headers: opts.headers,
              data: opts.data,
              timeout: requestTimeoutMs,
              validateStatus: (s: number) => s >= 200 && s < 500,
            }
            if (proxy) {
              const agent = agentFor(proxy, url.startsWith('https'))
              config.httpAgent = agent
              config.httpsAgent = agent
              config.proxy = false
            }
            try {
              const start = Date.now()
              const res = await sharedAxios.request(config)
              const latency = Date.now() - start
              if (proxy) this.opts.markProxySuccess(proxy, latency)
              this.opts.circuitBreaker.recordSuccess(source)
              return {
                status: res.status,
                headers: res.headers as Record<string, string>,
                data: res.data as T,
                fromCache: false,
                durationMs: latency,
                proxy: proxy?.server,
              }
            } catch (err) {
              if (proxy) this.opts.markProxyFailure(proxy)
              const status = err instanceof AxiosError ? err.response?.status : undefined
              throw new RetryError(
                err instanceof Error ? err.message : String(err),
                status !== undefined ? 'http' : 'network',
                status,
                attempt,
              )
            }
          })
          return result
        } finally {
          this.opts.rateLimiter.release(source)
        }
      },
    })

    if (cacheKey && !opts.noCache) {
      this.opts.cache.set(cacheKey, response.data, opts.cacheTtlMs)
    }
    return response
  }

  async getJson<T>(url: string, opts: HttpOptions): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...opts, headers: { Accept: 'application/json', ...opts.headers } })
  }

  async getHtml(url: string, opts: HttpOptions): Promise<HttpResponse<string>> {
    const res = await this.request<string>(url, opts)
    return res
  }
}
