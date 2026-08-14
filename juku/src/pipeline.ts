/**
 * JUKU Pipeline — the unified production scraping engine.
 *
 * Wires every mandatory component into one real pipeline:
 *
 *   Normal page: Proxy Pool → Rate Limiter → Request Queue → Axios → Cache
 *                → Cheerio/JSON → Normalizer → Deduplication → Database
 *   JS page:     Proxy Pool → Rate Limiter → Request Queue → Playwright
 *                → Network Observer → Normalizer → Deduplication → Database
 *   Failures:    Retry Manager → Proxy Rotation → Request Again
 *   Repeated failures: Circuit Breaker → Cooldown → Health Check → Recovery
 */
import { Logger } from './logger.js'
import { loadConfig, type JukuConfig } from './config.js'
import { Cache } from './cache.js'
import { Deduplicator, titleKey } from './dedup.js'
import { RateLimiter } from './ratelimit.js'
import { RequestQueue } from './queue.js'
import { ProxyPool } from './proxies.js'
import { HttpClient } from './http.js'
import { BrowserManager, NetworkObserver } from './browser.js'
import { htmlParser } from './html.js'
import { normalizer, type RawTitle, type RawChapter } from './normalizer.js'
import { pageExtractor } from './extractor.js'
import { CircuitBreaker } from './circuit.js'
import { DatabaseWriter } from './db.js'
import { SystemMonitor } from './resources.js'
import { AdaptiveController } from './controller.js'
import { BrowserScraper } from './browser.js'
import { registry, type SourceAdapter } from './sources/SourceAdapter.js'
import { MangaDexAdapter } from './sources/mangadex.js'
import { LocalJsonAdapter } from './sources/local.js'
import { MangaFireAdapter } from './sources/mangafire.js'
import { MangaKakalotAdapter } from './sources/mangakakalot.js'
import type { JukuTitle, PipelineStats, ScrapeMode } from './types.js'

export interface ImportOptions {
  limit?: number
  /** all | latest-N | none — which chapters get pages */
  chapters?: string
  source?: string
  fresh?: boolean
  mode?: ScrapeMode
  /** Live progress callback (used by the CLI progress bars). */
  onProgress?: (p: ImportProgress) => void
  /** Human-readable notice (duplicates skipped etc.) shown in the cmd window. */
  onNotice?: (msg: string) => void
  /** Update mode: re-check an existing title, skip only its existing chapters. */
  refresh?: boolean
}

export interface ImportProgress {
  /** title = within one title; batch = across titles */
  stage: 'title' | 'batch'
  title?: string
  /** 0..1 completion within the current scope */
  ratio: number
  /** current item index (1-based) */
  done: number
  total: number
  chaptersFound: number
  pagesFound: number
  /** running duplicate counts */
  skippedTitles?: number
  skippedChapters?: number
}

export interface ImportResult {
  title: JukuTitle | null
  addedTitle: boolean
  addedChapters: number
  skippedChapters: number
  pages: number
  /** true when the title was skipped as an existing duplicate */
  skippedTitle?: boolean
}

export class Pipeline {
  readonly config: JukuConfig
  readonly logger: Logger
  readonly cache: Cache
  readonly dedup: Deduplicator
  readonly rateLimiter: RateLimiter
  readonly queue: RequestQueue
  readonly proxyPool: ProxyPool
  readonly http: HttpClient
  readonly browser: BrowserManager
  readonly observer: NetworkObserver
  readonly circuitBreaker: CircuitBreaker
  readonly db: DatabaseWriter
  readonly monitor: SystemMonitor
  readonly controller: AdaptiveController
  readonly browserScraper: BrowserScraper

  private stats = new Map<string, PipelineStats>()
  private browserReady = false

  constructor(config: JukuConfig = loadConfig()) {
    this.config = config
    this.logger = new Logger()
    this.cache = new Cache({ ttlMs: 5 * 60_000, file: config.cacheFile, logger: this.logger })
    this.dedup = new Deduplicator()
    this.rateLimiter = new RateLimiter(config.rateLimits)
    this.queue = new RequestQueue({ concurrency: config.concurrency, sourceLimits: config.sourceLimits, logger: this.logger })
    this.proxyPool = new ProxyPool({ logger: this.logger, maxProxies: config.maxProxies })
    this.circuitBreaker = new CircuitBreaker({
      threshold: config.circuitBreakerThreshold,
      cooldownMs: config.circuitBreakerCooldownMs,
      logger: this.logger,
    })
    this.db = new DatabaseWriter(config.outputFile, config.stateFile, this.logger)
    this.browser = new BrowserManager({
      logger: this.logger,
      channel: config.browserChannel,
      headless: config.headless,
      maxPages: config.browserPages,
    })
    this.observer = new NetworkObserver(this.logger, this.browser)
    this.browserScraper = new BrowserScraper(this.browser, this.logger, {
      getProxy: () => this.proxyPool.next(),
      markProxyFailure: p => this.proxyPool.markFailure(p),
      markProxySuccess: (p, lat) => this.proxyPool.markSuccess(p, lat),
      // The browser path throttles/pauses too, so MangaFire/MangaKakalot
      // scrapes never peg the CPU while YouTube / Facebook are open.
      gate: () => this.monitor.waitForHeadroom(),
    })
    this.monitor = new SystemMonitor({
      cpuWarn: config.cpuWarn,
      cpuCritical: config.cpuCritical,
      ramWarn: config.ramWarn,
      ramCritical: config.ramCritical,
      gpuMonitor: config.gpuMonitor,
      intervalMs: config.resourceIntervalMs,
      logger: this.logger,
    })
    this.controller = new AdaptiveController({
      monitor: this.monitor,
      queue: this.queue,
      rateLimiter: this.rateLimiter,
      proxyPool: this.proxyPool,
      logger: this.logger,
      httpWorkers: config.httpWorkers,
      minHttpWorkers: config.minHttpWorkers,
      maxHttpWorkers: config.maxHttpWorkers,
      browserPages: config.browserPages,
      minBrowserPages: config.minBrowserPages,
      maxBrowserPages: config.maxBrowserPages,
    })

    // Load the user's existing working proxies + restore known-good health
    // from the last run so the first requests skip dead bulk-list entries.
    if (config.useProxies) {
      for (const file of config.proxyFiles) this.proxyPool.loadFile(file)
      this.proxyPool.loadState(config.proxyStateFile)
      this.logger.info(`proxy pool ready with ${this.proxyPool.size} proxies`, { source: 'proxy-pool' })
      // Learn which proxies are live in the background — next() prefers them.
      void this.proxyPool.warmUp(25, 10).catch(() => undefined)
    }

    this.http = new HttpClient({
      logger: this.logger,
      rateLimiter: this.rateLimiter,
      queue: this.queue,
      cache: this.cache,
      circuitBreaker: this.circuitBreaker,
      getProxy: () => this.proxyPool.next(),
      markProxySuccess: (p, lat) => this.proxyPool.markSuccess(p, lat),
      markProxyFailure: p => this.proxyPool.markFailure(p),
      browserFetch: (url, opts) => this.browserFetch(url, opts.source),
      // Auto throttling: pause new requests while CPU/RAM is critical.
      gate: () => this.monitor.waitForHeadroom(),
    })

    // Source adapter system.
    registry.register(new MangaDexAdapter(this.http, this.logger))
    registry.register(new LocalJsonAdapter(config.outputFile))
    registry.register(new MangaFireAdapter(this.browserScraper))
    registry.register(new MangaKakalotAdapter(this.browserScraper))

    // Auto hardware detection + adaptive workers.
    this.monitor.start()
    this.controller.tick()
    this.monitor.setOnTick(() => this.controller.tick())
  }

  source(id: string): SourceAdapter {
    return registry.get(id)
  }

  private track(source: string): PipelineStats {
    let s = this.stats.get(source)
    if (!s) {
      s = { source, requests: 0, cacheHits: 0, errors: 0, titlesFound: 0, chaptersFound: 0, pagesFound: 0 }
      this.stats.set(source, s)
    }
    return s
  }

  /** Count one request + cache-hit accounting. */
  private countRequest(source: string, fromCache: boolean, error = false): void {
    const s = this.track(source)
    s.requests += 1
    if (fromCache) s.cacheHits += 1
    if (error) s.errors += 1
  }

  /**
   * Playwright path — used by the HttpClient for JS-rendered pages and by
   * source health checks. Observes only publicly accessible network traffic.
   */
  private async browserFetch(url: string, source: string): Promise<{
    status: number
    headers: Record<string, string>
    data: unknown
    fromCache: boolean
    durationMs: number
  }> {
    this.browserReady = true
    const start = Date.now()
    const { responses, pageHtml, finalUrl } = await this.observer.observe({
      url,
      jsonOnly: true,
      collectHtml: true,
      capture: u => u.includes('api.') || u.includes('/api/') || u.endsWith('.json'),
      waitMs: 2500,
    })
    // JSON bodies from the observed API/XHR traffic are the primary data.
    const body = this.observer.findJson(responses, '') ?? responses.find(r => r.json !== undefined)?.json

    // HTML responses are parsed with Cheerio for structured data (metadata,
    // chapter links) — the JS-page path of the pipeline.
    let parsed: Record<string, unknown> | undefined
    if (pageHtml) {
      const $ = htmlParser.load(pageHtml)
      parsed = {
        title: htmlParser.text($, 'title') || undefined,
        metaDescription: htmlParser.meta($, 'description') || undefined,
        canonical: htmlParser.attr($, 'link[rel=canonical]', 'href') || undefined,
        links: htmlParser.hrefs($, 'a[href]').slice(0, 50),
      }
    }

    this.logger.info(`browser fetch observed ${responses.length} responses`, {
      source,
      url: finalUrl,
      durationMs: Date.now() - start,
      chaptersFound: responses.length,
      pagesFound: parsed ? Object.keys(parsed).length : 0,
    })
    return {
      status: 200,
      headers: {},
      data: parsed ?? body ?? {},
      fromCache: false,
      durationMs: Date.now() - start,
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async search(sourceId: string, query: string, limit = 20): Promise<RawTitle[]> {
    const source = this.source(sourceId)
    const raw = await source.search(query, limit)
    this.track(sourceId).titlesFound += raw.titles.length
    return raw.titles
  }

  /**
   * Recommended (trending/popular) titles from several sources, merged +
   * deduplicated by normalized title. Failures in one source never block
   * the others — they are reported through `failures`.
   */
  async recommend(
    sourceIds: string[],
    limit = 10,
  ): Promise<{ titles: RawTitle[]; failures: string[] }> {
    const norm = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const seen = new Map<string, RawTitle>()
    const failures: string[] = []
    const perSource = Math.max(5, Math.ceil(limit * 1.5))
    await Promise.all(
      sourceIds.map(async sid => {
        if (!registry.has(sid)) {
          failures.push(`unknown source "${sid}"`)
          return
        }
        const source = this.source(sid)
        try {
          const raw = await source.getPopular(perSource)
          this.track(sid).titlesFound += raw.length
          for (const t of raw) {
            const key = norm(t.title ?? '')
            if (!key || seen.has(key)) continue
            seen.set(key, { ...t, source: sid })
          }
        } catch (err) {
          failures.push(sid)
          this.logger.warn(`recommend failed on ${sid}`, {
            source: sid,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }),
    )
    return { titles: [...seen.values()].slice(0, limit), failures }
  }

  /** Chapter count for a title: exact from the store when already imported,
   * otherwise the source's cheap API count (null when it would need a full
   * scrape — browser-only sources). */
  async chapterCount(sourceId: string, ref: string): Promise<number | null> {
    const source = this.source(sourceId)
    if (typeof source.getChapterCount === 'function') {
      try {
        return await source.getChapterCount(ref)
      } catch (err) {
        this.logger.warn(`chapter count failed on ${sourceId}`, {
          source: sourceId,
          error: err instanceof Error ? err.message : String(err),
        })
        return null
      }
    }
    return null
  }

  /**
   * Search several sources IN PARALLEL and merge the results, deduplicating
   * by normalized title (same series found on MangaFire + MangaDex +
   * MangaKakalot shows up once). Failures in one source never block the
   * others — they are reported through `failures`.
   */
  async searchMulti(
    sourceIds: string[],
    query: string,
    limitPerSource = 10,
  ): Promise<{ titles: RawTitle[]; failures: string[] }> {
    const norm = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const seen = new Map<string, RawTitle>()
    const failures: string[] = []
    await Promise.all(
      sourceIds.map(async sid => {
        if (!registry.has(sid)) {
          failures.push(`unknown source "${sid}"`)
          return
        }
        const source = this.source(sid)
        try {
          const res = await source.search(query, limitPerSource)
          this.track(sid).titlesFound += res.titles.length
          for (const t of res.titles) {
            const key = norm(t.title ?? '')
            if (!key || seen.has(key)) continue
            seen.set(key, { ...t, source: sid })
          }
        } catch (err) {
          failures.push(sid)
          this.logger.warn(`search failed on ${sid}`, {
            source: sid,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }),
    )
    return { titles: [...seen.values()], failures }
  }

  /**
   * Full import of one title: details → chapters → chapter pages → store.
   * `chapters` mode: 'all' | 'latest-N' | 'none' (controls page fetching).
   *
   * Deduplication (permanent):
   *   - titles already in the store (same source_id OR same normalized title)
   *     are skipped entirely — never re-scraped, never duplicated;
   *   - chapters already in the store are never re-fetched;
   *   - every skip is reported through `onNotice`.
   */
  async importTitle(sourceId: string, ref: string, opts: ImportOptions = {}): Promise<ImportResult> {
    const source = this.source(sourceId)
    const notice = opts.onNotice ?? (() => undefined)

    // Circuit breaker gate.
    this.circuitBreaker.allow(sourceId)

    // Per-run dedup (same title twice in one run).
    if (!this.dedup.isNew('title', titleKey(sourceId, ref))) {
      this.logger.debug(`title already processed this run, skipping ${ref}`, { source: sourceId })
      return { title: null, addedTitle: false, addedChapters: 0, skippedChapters: 0, pages: 0, skippedTitle: true }
    }

    // Cross-run dedup by source_id — skip before any network call.
    // (refresh mode re-checks existing titles, so the title skip is bypassed.)
    if (!opts.fresh && !opts.refresh && this.db.hasTitle(sourceId, ref)) {
      notice(`[skip] duplicate title "${ref}" (${sourceId}) already in library — skipped`)
      return { title: null, addedTitle: false, addedChapters: 0, skippedChapters: 0, pages: 0, skippedTitle: true }
    }

    const rawTitle = await source.getDetails(ref)
    if (!rawTitle) {
      this.circuitBreaker.recordFailure(sourceId)
      this.countRequest(sourceId, false, true)
      this.db.recordError(sourceId, `getDetails returned nothing for ${ref}`)
      return { title: null, addedTitle: false, addedChapters: 0, skippedChapters: 0, pages: 0 }
    }
    this.circuitBreaker.recordSuccess(sourceId)

    // Cross-run dedup by normalized title (same series, different source).
    if (!opts.fresh && !opts.refresh && this.db.hasTitleByNormalizedName(rawTitle.title ?? '')) {
      notice(`[skip] duplicate title "${rawTitle.title}" already in library (same series, other source) — skipped`)
      return { title: null, addedTitle: false, addedChapters: 0, skippedChapters: 0, pages: 0, skippedTitle: true }
    }

    const chapters = await source.getChapters(ref)
    this.track(sourceId).chaptersFound += chapters.length

    // Decide which chapters get pages.
    const chaptersMode = opts.chapters ?? 'latest-20'
    let pageTargets: RawChapter[] = chapters
    if (chaptersMode === 'none') pageTargets = []
    else if (chaptersMode.startsWith('latest-')) {
      const n = Number(chaptersMode.split('-')[1]) || 20
      pageTargets = chapters.slice(-n)
    }

    // Skip chapters that already exist in the store — never re-fetch pages.
    let skippedChapters = 0
    const freshChapters: RawChapter[] = []
    for (const ch of pageTargets) {
      if (this.db.hasChapter(sourceId, rawTitle.slug ?? '', ch.chapterNumber)) {
        skippedChapters += 1
      } else {
        freshChapters.push(ch)
      }
    }
    if (skippedChapters > 0) {
      notice(`[skip] ${skippedChapters} chapter(s) of "${rawTitle.title}" already in library — skipping`)
    }

    let pages = 0
    const chapterKeyBase = `${sourceId}:${rawTitle.slug}`
    const totalTargets = freshChapters.length
    for (let ci = 0; ci < freshChapters.length; ci += 1) {
      const ch = freshChapters[ci]
      opts.onProgress?.({
        stage: 'title',
        title: rawTitle.title,
        ratio: totalTargets ? (ci + 1) / totalTargets : 1,
        done: ci + 1,
        total: totalTargets,
        chaptersFound: chapters.length,
        pagesFound: pages,
        skippedChapters,
      })
      try {
        // Resource gate: pause page fetching while the machine is hot so
        // YouTube / Facebook / games stay smooth.
        await this.monitor.waitForHeadroom()
        const urls = await source.getChapterPages(ch.chapterUrl ?? '')
        const extracted = pageExtractor.extract(urls, { chapterKey: `${chapterKeyBase}:${ch.chapterNumber}` })
        ch.pages = extracted.map(p => p.imageUrl)
        pages += extracted.length
        this.track(sourceId).pagesFound += extracted.length
        // Adaptive pacing: no fixed delay when the PC is idle (x5 speed);
        // a gentle delay only while throttling keeps browsing smooth.
        if (this.monitor.snapshot().mode === 'THROTTLING') {
          await new Promise<void>(res => setTimeout(res, 350))
        }
      } catch (err) {
        this.logger.warn(`chapter ${ch.chapterNumber} pages failed`, {
          source: sourceId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const title = normalizer.title({ ...rawTitle, chapters: freshChapters })
    const result = this.db.upsertTitle(title, { fresh: opts.fresh })
    this.db.recordSuccess(sourceId, result.addedTitle ? 1 : 0, result.addedChapters)
    this.logger.info(`imported "${title.title}"`, {
      source: sourceId,
      url: title.sourceUrl,
      chaptersFound: chapters.length,
      pagesFound: pages,
      success: true,
    })
    return { title, ...result, pages, skippedTitle: false }
  }

  /**
   * Discover + import a batch (latest or popular rail).
   *
   * With `config.titleConcurrency > 1` (JUKU_TITLE_CONCURRENCY) titles are
   * imported in parallel — the request queue, per-source rate limiters, the
   * browser page pool and the resource monitor (CPU/RAM/GPU auto-throttle)
   * all still gate the work, so turbo mode keeps the PC usable while it runs.
   */
  async importBatch(sourceId: string, opts: ImportOptions & { rail?: 'latest' | 'popular' } = {}): Promise<{
    titles: number
    chapters: number
    pages: number
    skippedTitles: number
    skippedChapters: number
  }> {
    const source = this.source(sourceId)
    const rail = opts.rail ?? 'latest'
    const limit = opts.limit ?? 20
    const raws = rail === 'popular' ? await source.getPopular(limit) : await source.getLatest(limit)
    this.track(sourceId).titlesFound += raws.length
    this.logger.info(`discovered ${raws.length} titles (${rail})`, { source: sourceId, titlesFound: raws.length })

    const total = raws.length
    const concurrency = Math.max(1, Math.min(this.config.titleConcurrency, total))
    const counts = { titles: 0, chapters: 0, pages: 0, skippedTitles: 0, skippedChapters: 0, done: 0 }
    const report = (title?: string): void => {
      opts.onProgress?.({
        stage: 'batch',
        title,
        ratio: total ? counts.done / total : 1,
        done: counts.done,
        total,
        chaptersFound: counts.chapters,
        pagesFound: counts.pages,
        skippedTitles: counts.skippedTitles,
        skippedChapters: counts.skippedChapters,
      })
    }

    const runOne = async (i: number): Promise<void> => {
      const raw = raws[i]
      const result = await this.importTitle(sourceId, raw.slug ?? raw.title ?? '', {
        ...opts,
        // --fresh wipes the store once (first slot) so the batch re-scrapes.
        fresh: opts.fresh && i === 0,
      })
      if (result.title) counts.titles += 1
      counts.chapters += result.addedChapters
      counts.skippedChapters += result.skippedChapters
      counts.pages += result.pages
      if (result.skippedTitle) counts.skippedTitles += 1
      counts.done += 1
      this.persist()
      report(raw.title)
    }

    if (concurrency === 1) {
      for (let i = 0; i < total; i += 1) await runOne(i)
    } else {
      this.logger.info(`importing ${total} titles in parallel (${concurrency} at a time)`, { source: sourceId })
      let next = 0
      const workers = Array.from({ length: concurrency }, async () => {
        for (;;) {
          const i = next
          next += 1
          if (i >= total) return
          await runOne(i)
        }
      })
      await Promise.all(workers)
    }
    return {
      titles: counts.titles,
      chapters: counts.chapters,
      pages: counts.pages,
      skippedTitles: counts.skippedTitles,
      skippedChapters: counts.skippedChapters,
    }
  }

  /**
   * Update existing library titles with new chapters (chapter checking).
   *
   * Refreshes every title whose source adapter is registered (MangaDex,
   * MangaFire, MangaKakalot). Titles from unregistered/unknown sources are
   * skipped with a notice — they are never duplicated.
   */
  async updateLibrary(opts: ImportOptions = {}): Promise<{ titles: number; chapters: number; pages: number; skipped: number }> {
    const store = this.db.storeData
    const items = store.items ?? []
    const notice = opts.onNotice ?? (() => undefined)
    this.logger.info(`update library: ${items.length} titles to check`, { source: 'update' })

    const counts = { titles: 0, chapters: 0, pages: 0, skipped: 0, done: 0 }
    const total = items.length
    const report = (title?: string): void => {
      opts.onProgress?.({
        stage: 'batch',
        title,
        ratio: total ? counts.done / total : 1,
        done: counts.done,
        total,
        chaptersFound: counts.chapters,
        pagesFound: counts.pages,
        skippedTitles: counts.skipped,
      })
    }

    const runOne = async (item: Record<string, unknown>): Promise<void> => {
      const ref = String(item.source_id ?? '')
      const sourceId = String(item.source ?? 'mangadex')
      if (!ref || !registry.has(sourceId)) {
        counts.skipped += 1
        counts.done += 1
        notice(
          `[skip] "${String(item.title ?? '')}" is ${sourceId}-sourced — no adapter registered for it (use the Python scraper for ${sourceId})`,
        )
        report(String(item.title ?? ''))
        return
      }
      // refresh: re-check the chapter feed but never re-fetch existing pages.
      const result = await this.importTitle(sourceId, ref, {
        ...opts,
        refresh: true,
        chapters: opts.chapters ?? 'latest-10',
      })
      if (result.title) counts.titles += 1
      counts.chapters += result.addedChapters
      counts.pages += result.pages
      counts.done += 1
      this.persist()
      report(String(item.title ?? ''))
    }

    // x5 turbo: check several titles in parallel (bounded by titleConcurrency),
    // same as importBatch — resource monitor still throttles everything.
    const concurrency = Math.max(1, Math.min(this.config.titleConcurrency, total || 1))
    if (concurrency === 1) {
      for (const item of items) await runOne(item)
    } else {
      let next = 0
      const workers = Array.from({ length: concurrency }, async () => {
        for (;;) {
          const i = next
          next += 1
          if (i >= total) return
          await runOne(items[i])
        }
      })
      await Promise.all(workers)
    }
    return counts
  }

  /** Run the source health check with Playwright + circuit breaker recovery. */
  async healthCheck(sourceId = 'mangadex'): Promise<boolean> {
    const source = this.source(sourceId)
    this.logger.info(`health check for ${sourceId}`, { source: sourceId })
    const ok = await this.circuitBreaker.healthCheck(sourceId, async () => {
      if (source.usesBrowser || this.browserReady) {
        // Real Playwright visit: observe public network traffic.
        await this.browserFetch(`https://mangadex.org`, sourceId)
      } else {
        const r = await this.http.request('https://api.mangadex.org/ping', { source: sourceId, noCache: true })
        if (r.status !== 200) throw new Error(`ping returned ${r.status}`)
      }
    })
    this.logger.info(`health check ${sourceId}: ${ok ? 'OK' : 'FAILED'}`, { source: sourceId, success: ok })
    return ok
  }

  // -------------------------------------------------------------------------
  // Scheduler hooks
  // -------------------------------------------------------------------------

  async scheduledLatest(): Promise<void> {
    this.logger.info('scheduled job: latest updates', { source: 'scheduler' })
    await this.importBatch('mangadex', { rail: 'latest', limit: 10, chapters: 'latest-5' })
  }

  async scheduledChapterCheck(): Promise<void> {
    this.logger.info('scheduled job: chapter checking', { source: 'scheduler' })
    await this.updateLibrary({ chapters: 'latest-5' })
  }

  async scheduledMetadataRefresh(): Promise<void> {
    this.logger.info('scheduled job: metadata refresh', { source: 'scheduler' })
    // Re-persist with fresh timestamps (the upsert refreshes metadata).
    this.db.persist()
  }

  async scheduledHealthCheck(): Promise<void> {
    this.logger.info('scheduled job: source health checks', { source: 'scheduler' })
    await this.healthCheck('mangadex')
  }

  // -------------------------------------------------------------------------
  // Status / lifecycle
  // -------------------------------------------------------------------------

  status(): Record<string, unknown> {
    return {
      hardware: this.monitor.hardware(),
      resources: this.monitor.snapshot(),
      adaptive: this.controller.status(),
      proxyPool: this.proxyPool.stats(),
      cache: { size: this.cache.size, hits: this.cache.hits, misses: this.cache.misses },
      dedup: {
        titles: this.dedup.size('title'),
        chapters: this.dedup.size('chapter'),
        pages: this.dedup.size('page'),
        urls: this.dedup.size('url'),
      },
      queue: {
        pending: this.queue.pendingCount,
        running: this.queue.runningCount,
        concurrency: this.queue.concurrency,
      },
      sources: registry.list().map(s => s.id),
      circuitBreakers: this.circuitBreaker.snapshot(),
      store: this.db.size,
      stats: [...this.stats.values()],
    }
  }

  /** One-line resource monitor status (3s cadence display). */
  resourceLine(): string {
    const s = this.monitor.snapshot()
    const ps = this.proxyPool.stats()
    const gpu = s.gpuPct === null ? 'n/a' : `${s.gpuPct}%`
    const modeColor = s.mode === 'NORMAL' ? '\x1b[32m' : s.mode === 'THROTTLING' ? '\x1b[33m' : '\x1b[31m'
    return (
      `CPU: ${s.cpuPct}% RAM: ${s.ramPct}% GPU: ${gpu} Workers: ${this.controller.currentHttpWorkers} ` +
      `Active Proxies: ${ps.active} Failed Proxies: ${ps.failed} Queue: ${this.queue.pendingCount + this.queue.runningCount} ` +
      `Mode: ${modeColor}${s.mode}\x1b[0m`
    )
  }

  persist(): void {
    this.db.persist()
    this.cache.persist()
  }

  async close(): Promise<void> {
    this.monitor.stop()
    await this.queue.idle()
    this.persist()
    this.proxyPool.saveState(this.config.proxyStateFile)
    await this.browser.close()
  }
}
