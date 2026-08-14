/**
 * Playwright integration — browser lifecycle and the network observer.
 *
 * Used for JavaScript-rendered websites, dynamic/lazy-loaded content and
 * observing the page's own public network traffic (fetch / XHR / JSON / HTML)
 * to find chapter/page data. Only publicly accessible traffic is observed —
 * no authentication bypass, CAPTCHA solving or access-control circumvention.
 */
import { chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright'
import type { Logger } from './logger.js'
import type { ProxyEntry } from './proxies.js'

export class BrowserManager {
  private browser: Browser | null = null
  private readonly logger: Logger
  private readonly channel: string
  private readonly headless: boolean
  /** Max concurrent pages (RAM protection). Defaults to 2. */
  private maxPages = 2
  private activePages = 0
  private pageWaiters: Array<() => void> = []

  constructor(opts: { logger: Logger; channel?: string; headless?: boolean; maxPages?: number }) {
    this.logger = opts.logger
    this.channel = opts.channel ?? 'chrome'
    this.headless = opts.headless ?? true
    if (opts.maxPages && opts.maxPages > 0) this.maxPages = opts.maxPages
  }

  /** Dynamically adjust the page limit (used by the adaptive controller). */
  setMaxPages(n: number): void {
    const next = Math.max(1, Math.floor(n))
    if (next === this.maxPages) return
    this.maxPages = next
    this.logger.debug(`browser max pages → ${next}`)
    // Wake waiters that can now proceed.
    while (this.activePages < this.maxPages && this.pageWaiters.length) {
      const w = this.pageWaiters.shift()
      w?.()
    }
  }

  get maxPagesValue(): number {
    return this.maxPages
  }

  get activePagesValue(): number {
    return this.activePages
  }

  /** Reserve a page slot; resolves when under the page limit. */
  private async acquirePageSlot(): Promise<void> {
    if (this.activePages < this.maxPages) {
      this.activePages += 1
      return
    }
    await new Promise<void>(res => this.pageWaiters.push(res))
    this.activePages += 1
  }

  private releasePageSlot(): void {
    this.activePages = Math.max(0, this.activePages - 1)
    if (this.activePages < this.maxPages && this.pageWaiters.length) {
      const w = this.pageWaiters.shift()
      w?.()
    }
  }

  async launch(): Promise<Browser> {
    if (this.browser) return this.browser
    const launchOptions: Parameters<typeof chromium.launch>[0] = {
      headless: this.headless,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    }
    try {
      this.browser = await chromium.launch({ ...launchOptions, channel: this.channel })
      this.logger.info(`playwright launched (channel=${this.channel})`)
    } catch {
      // Fall back to bundled chromium when the system channel is missing.
      this.logger.warn(`channel "${this.channel}" unavailable, falling back to bundled chromium`)
      this.browser = await chromium.launch(launchOptions)
    }
    return this.browser
  }

  async newContext(proxy?: ProxyEntry | null): Promise<BrowserContext> {
    const browser = await this.launch()
    return browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      proxy: proxy
        ? {
            server: proxy.server,
            username: proxy.username,
            password: proxy.password,
          }
        : undefined,
    })
  }

  async newPage(proxy?: ProxyEntry | null): Promise<Page> {
    await this.acquirePageSlot()
    try {
      const context = await this.newContext(proxy)
      return await context.newPage()
    } catch (err) {
      this.releasePageSlot()
      throw err
    }
  }

  /** Close a page created by newPage() and release its slot. */
  async closePage(page: Page): Promise<void> {
    try {
      await page.close().catch(() => undefined)
    } finally {
      this.releasePageSlot()
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => undefined)
      this.browser = null
    }
    this.activePages = 0
    this.pageWaiters = []
  }
}

export interface ObservedResponse {
  url: string
  status: number
  contentType: string
  isJson: boolean
  isHtml: boolean
  json?: unknown
  body?: string
}

export interface ObserveOptions {
  url: string
  waitMs?: number
  /** Only capture responses matching this URL predicate */
  capture?: (url: string, contentType: string) => boolean
  /** Only JSON responses (fetch/XHR) */
  jsonOnly?: boolean
  /** Collect the HTML body of the final page too */
  collectHtml?: boolean
  maxResponses?: number
}

export class NetworkObserver {
  constructor(
    private readonly logger: Logger,
    private readonly browser: BrowserManager,
  ) {}

  /**
   * Open a page, observe its network traffic, and return captured responses.
   * `capture` defaults to capturing JSON (fetch/XHR) responses.
   */
  async observe(opts: ObserveOptions): Promise<{ responses: ObservedResponse[]; pageHtml?: string; finalUrl: string }> {
    const page = await this.browser.newPage()
    const responses: ObservedResponse[] = []
    const max = opts.maxResponses ?? 200
    this.logger.debug(`network observer: ${opts.url}`)

    const onResponse = async (res: Response): Promise<void> => {
      try {
        if (responses.length >= max) return
        const contentType = res.headers()['content-type'] ?? ''
        const isJson = contentType.includes('json')
        const isHtml = contentType.includes('html')
        if (opts.jsonOnly && !isJson) return
        if (opts.capture && !opts.capture(res.url(), contentType)) return

        const record: ObservedResponse = { url: res.url(), status: res.status(), contentType, isJson, isHtml }
        if (isJson && res.status() < 400) {
          try {
            record.json = await res.json()
          } catch {
            /* not parseable JSON */
          }
        } else if (isHtml && res.status() < 400) {
          try {
            record.body = (await res.text()).slice(0, 200_000)
          } catch {
            /* body too large / streamed */
          }
        }
        responses.push(record)
      } catch {
        /* observer must never break navigation */
      }
    }

    page.on('response', onResponse)
    try {
      await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await page.waitForTimeout(opts.waitMs ?? 3000)
      // Scroll a few times to trigger lazy-loaded content.
      for (let i = 0; i < 3; i += 1) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => undefined)
        await page.waitForTimeout(700)
      }
      const finalUrl = page.url()
      let pageHtml: string | undefined
      if (opts.collectHtml) {
        pageHtml = await page.content().catch(() => undefined)
      }
      return { responses, pageHtml, finalUrl }
    } finally {
      await this.browser.closePage(page).catch(() => undefined)
    }
  }

  /** Extract JSON bodies from observed responses (network-response capture). */
  jsonBodies(responses: ObservedResponse[]): unknown[] {
    return responses.filter(r => r.isJson && r.json !== undefined).map(r => r.json)
  }

  /** Find the first JSON response for a URL substring. */
  findJson(responses: ObservedResponse[], urlPart: string): unknown | undefined {
    const hit = responses.find(r => r.isJson && r.url.includes(urlPart))
    return hit?.json
  }
}

/**
 * BrowserScraper — high-level browser automation for JS/WAF-protected sources
 * (mangafire.to, mangakakalot.gg). Reuses the shared BrowserManager (one
 * browser, bounded pages), navigates, evaluates DOM/JS, and closes pages
 * cleanly so RAM stays flat.
 *
 * Anti-block: every navigation is checked for a WAF/Cloudflare challenge
 * page (mangafire `@waf` shape captcha, Cloudflare "Just a moment..."); when
 * one is detected the proxy is marked failed and the whole call is retried
 * with the next proxy from the pool (up to `proxyAttempts`), mirroring what
 * the Python mangafire_catalog / mangakakalot_fallback scrapers already do.
 */
export interface BrowserScraperOptions {
  getProxy?: () => ProxyEntry | null
  markProxyFailure?: (p: ProxyEntry) => void
  markProxySuccess?: (p: ProxyEntry, latencyMs?: number) => void
  /** Resource gate — awaited before every browser attempt so the scraper
   * pauses when CPU/RAM is critical (auto throttling on the browser path). */
  gate?: () => Promise<void>
}

export class BrowserScraper {
  constructor(
    private readonly browser: BrowserManager,
    private readonly logger: Logger,
    private readonly opts: BrowserScraperOptions = {},
  ) {}

  /** True when the current page is a WAF/Cloudflare challenge instead of real content. */
  private async isChallenge(page: Page): Promise<boolean> {
    try {
      const url = page.url()
      if (/@waf|challenge/i.test(url)) return true
      const title = await page.title().catch(() => '')
      if (/just a moment|security verification|verify you're human/i.test(title)) return true
      const text = await page
        .evaluate(() => (document.body ? document.body.innerText : ''))
        .catch(() => '')
      const low = text.toLowerCase()
      return (
        low.includes("verify you're human") ||
        low.includes('click the shapes') ||
        low.includes('performing security verification') ||
        low.includes('just a moment')
      )
    } catch {
      return false
    }
  }

  /**
   * Open a page, run `fn` against it, then close the page and release its
   * slot. Retries with the next proxy when the page is a WAF/Cloudflare
   * challenge or `fn` throws (e.g. an API 403). Returns `null` once every
   * attempt fails (callers treat null as "no data").
   *
   * `challengeWaitMs`: how long to poll for a challenge to auto-resolve
   * (Cloudflare's "Just a moment..." often passes itself in real Chrome)
   * before declaring the proxy blocked and rotating.
   */
  async withPage<T>(
    fn: (page: Page) => Promise<T> | T,
    opts: { url?: string; waitMs?: number; proxyAttempts?: number; challengeWaitMs?: number } = {},
  ): Promise<T | null> {
    // Default to more attempts: the pool is large and mostly bulk lists, so
    // round-robin hits dead proxies — rotation needs room to find a live one.
    const attempts = Math.max(1, opts.proxyAttempts ?? 6)
    const challengeBudgetMs = Math.max(0, opts.challengeWaitMs ?? 12_000)
    let lastError: unknown = null
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      // Resource gate: never open a browser page while the machine is hot
      // (YouTube / Facebook / games get priority).
      if (this.opts.gate) await this.opts.gate()
      const proxy = this.opts.getProxy ? this.opts.getProxy() : null
      let page: Page | null = null
      try {
        page = await this.browser.newPage(proxy)
        if (opts.url) {
          // Shorter timeout so dead proxies fail fast and rotation moves on.
          await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          await page.waitForTimeout(opts.waitMs ?? 2500)
        }
        if (await this.isChallenge(page)) {
          // Poll for the challenge to auto-resolve before rotating.
          const waited = await this.waitOutChallenge(page, challengeBudgetMs)
          if (!waited) {
            this.logger.warn(`browser challenge not resolved (${page.url()}) — rotating proxy`, {
              source: 'browser',
              url: opts.url,
              attempt: attempt + 1,
            })
            if (proxy) this.opts.markProxyFailure?.(proxy)
            continue
          }
        }
        const result = await fn(page)
        if (proxy) this.opts.markProxySuccess?.(proxy)
        return result
      } catch (err) {
        lastError = err
        this.logger.warn(`browser scrape failed for ${opts.url ?? '(blank)'}`, {
          source: 'browser',
          error: err instanceof Error ? err.message : String(err),
          attempt: attempt + 1,
        })
        if (proxy) this.opts.markProxyFailure?.(proxy)
      } finally {
        if (page) await this.browser.closePage(page).catch(() => undefined)
      }
    }
    if (lastError) {
      this.logger.warn(`browser scrape exhausted ${attempts} attempt(s) for ${opts.url ?? '(blank)'}`, {
        source: 'browser',
        error: lastError instanceof Error ? lastError.message : String(lastError),
      })
    }
    return null
  }

  /** Poll until the challenge page clears or the budget runs out. */
  private async waitOutChallenge(page: Page, budgetMs: number): Promise<boolean> {
    const deadline = Date.now() + budgetMs
    while (Date.now() < deadline) {
      await page.waitForTimeout(2000)
      if (!(await this.isChallenge(page))) return true
    }
    return false
  }

  /**
   * Fetch a site API that requires a `vrf` protection token (mangafire).
   * The token is generated by the site's own `window.getProtectionToken`
   * helper, so the page must be primed on the site first.
   *
   * 429/403 responses are retried with exponential backoff (same proxy) —
   * the site rate-limits fast bursts — and only after the backoff budget is
   * exhausted is the error rethrown so `withPage` rotates the proxy.
   */
  async apiGet<T = Record<string, unknown>>(
    baseUrl: string,
    path: string,
    query = '',
  ): Promise<T | null> {
    return this.withPage<T | null>(
      async page => {
        let backoff = 1500
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const token = await page.evaluate(
            ([p, q]) => {
              const w = window as unknown as { getProtectionToken?: (path: string, query: string) => unknown }
              const t = w.getProtectionToken ? w.getProtectionToken(p, q) : null
              return t ? String(t) : null
            },
            [path, query],
          )
          if (!token) return null
          const sep = query ? '&' : ''
          const url = `${baseUrl}${path}?${query}${sep}vrf=${encodeURIComponent(token)}`
          const resp = await page.request.get(url, { timeout: 15_000 })
          if (resp.status() === 200) {
            try {
              return (await resp.json()) as T
            } catch {
              return null
            }
          }
          // 403/429 = rate-limited or WAF-blocked — back off, then rotate.
          if (resp.status() === 403 || resp.status() === 429) {
            if (attempt < 3) {
              await page.waitForTimeout(backoff)
              backoff *= 2
              continue
            }
            throw new Error(`apiGet ${path} returned ${resp.status()} (blocked)`)
          }
          return null
        }
        return null
      },
      { url: baseUrl, waitMs: 2500 },
    )
  }
}
