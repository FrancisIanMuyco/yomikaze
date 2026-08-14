/**
 * Adaptive Controller — gradually scales HTTP workers and browser pages based
 * on live system resources, proxy health and request latency.
 *
 * Design rules (from the YOMIKAZE resource-control spec):
 *   - Start conservatively (3–4 HTTP workers, 2 browser pages on 8GB RAM).
 *   - Hardware (CPU/RAM/GPU) determines concurrency — NOT proxy count.
 *   - Scale gradually, one step at a time, with a cooldown so worker counts
 *     never oscillate rapidly (hysteresis).
 *   - When critical: drop to minimum and stop new work (pipeline gate).
 *   - When recovered: ramp back up one step at a time.
 */
import type { RequestQueue } from './queue.js'
import type { RateLimiter } from './ratelimit.js'
import type { SystemMonitor } from './resources.js'
import type { ProxyPool } from './proxies.js'
import type { Logger } from './logger.js'

export interface AdaptiveControllerOptions {
  monitor: SystemMonitor
  queue: RequestQueue
  rateLimiter: RateLimiter
  proxyPool: ProxyPool
  logger: Logger
  /** Starting / min / max HTTP worker counts */
  httpWorkers?: number
  minHttpWorkers?: number
  maxHttpWorkers?: number
  /** Starting / min / max browser page counts */
  browserPages?: number
  minBrowserPages?: number
  maxBrowserPages?: number
  /** Min ms between worker-count changes (anti-oscillation) */
  changeCooldownMs?: number
  /** How many consecutive healthy ticks before scaling UP */
  scaleUpAfterTicks?: number
  /** How many consecutive hot ticks before scaling DOWN */
  scaleDownAfterTicks?: number
}

export class AdaptiveController {
  private httpWorkers: number
  private readonly minHttpWorkers: number
  private readonly maxHttpWorkers: number
  private browserPages: number
  private readonly minBrowserPages: number
  private readonly maxBrowserPages: number
  private readonly changeCooldownMs: number
  private readonly scaleUpAfterTicks: number
  private readonly scaleDownAfterTicks: number

  private healthyTicks = 0
  private hotTicks = 0
  private lastChangeAt = 0

  private readonly monitor: SystemMonitor
  private readonly queue: RequestQueue
  private readonly rateLimiter: RateLimiter
  private readonly proxyPool: ProxyPool
  private readonly logger: Logger

  constructor(opts: AdaptiveControllerOptions) {
    this.monitor = opts.monitor
    this.queue = opts.queue
    this.rateLimiter = opts.rateLimiter
    this.proxyPool = opts.proxyPool
    this.logger = opts.logger
    this.httpWorkers = opts.httpWorkers ?? 3
    this.minHttpWorkers = opts.minHttpWorkers ?? 1
    this.maxHttpWorkers = opts.maxHttpWorkers ?? 6
    this.browserPages = opts.browserPages ?? 2
    this.minBrowserPages = opts.minBrowserPages ?? 1
    this.maxBrowserPages = opts.maxBrowserPages ?? 3
    this.changeCooldownMs = opts.changeCooldownMs ?? 15_000
    this.scaleUpAfterTicks = opts.scaleUpAfterTicks ?? 2
    this.scaleDownAfterTicks = opts.scaleDownAfterTicks ?? 1
    this.apply()
  }

  get currentHttpWorkers(): number {
    return this.httpWorkers
  }

  get currentBrowserPages(): number {
    return this.browserPages
  }

  /** Push the current worker counts into the queue / rate limiter. */
  private apply(): void {
    this.queue.setConcurrency(this.httpWorkers)
    this.rateLimiter.setConcurrency('*', this.httpWorkers)
    // MangaDex is the fast HTTP source — let it use most of the worker pool
    // so chapter lists/page fetches run in parallel (x5 turbo).
    this.rateLimiter.setConcurrency('mangadex', Math.min(this.httpWorkers, 6))
    this.rateLimiter.setConcurrency('mangafire', Math.min(this.httpWorkers, 2))
    this.rateLimiter.setConcurrency('mangakakalot', Math.min(this.httpWorkers, 2))
  }

  /**
   * Re-evaluate resource health and scale workers by at most one step.
   * Called on every resource-monitor tick (~3s).
   */
  tick(): void {
    const snap = this.monitor.snapshot()
    const now = Date.now()

    // Critical → drop straight to minimum and pause new work.
    if (snap.mode === 'PAUSED') {
      this.healthyTicks = 0
      this.hotTicks += 1
      if (this.hotTicks >= this.scaleDownAfterTicks) {
        this.scaleDown()
        this.hotTicks = 0
        this.lastChangeAt = now
      }
      return
    }

    // Healthy check: resources normal AND enough healthy proxies AND
    // queue not backed up AND latency acceptable.
    const stats = this.proxyPool.stats()
    const healthyProxies = Number(stats.active ?? stats.total ?? 0)
    const queueBacklog = this.queue.pendingCount
    const avgLatency = Number(stats.avgLatencyMs ?? 0)
    const proxiesOk = !this.proxyPool.size || healthyProxies >= Math.min(2, this.proxyPool.size)
    const latencyOk = avgLatency === 0 || avgLatency < 8000
    const healthy = snap.mode === 'NORMAL' && proxiesOk && latencyOk && queueBacklog < 20

    if (healthy) {
      this.hotTicks = 0
      this.healthyTicks += 1
      if (this.healthyTicks >= this.scaleUpAfterTicks && now - this.lastChangeAt >= this.changeCooldownMs) {
        this.scaleUp()
        this.healthyTicks = 0
        this.lastChangeAt = now
      }
    } else {
      this.healthyTicks = 0
      this.hotTicks += 1
      if (this.hotTicks >= this.scaleDownAfterTicks && now - this.lastChangeAt >= this.changeCooldownMs) {
        this.scaleDown()
        this.hotTicks = 0
        this.lastChangeAt = now
      }
    }
  }

  /** One step up (only when below the hardware-based max). */
  private scaleUp(): void {
    if (this.httpWorkers < this.maxHttpWorkers || this.browserPages < this.maxBrowserPages) {
      if (this.httpWorkers < this.maxHttpWorkers) this.httpWorkers += 1
      if (this.browserPages < this.maxBrowserPages) this.browserPages += 1
      this.apply()
      this.logger.info(
        `adaptive: scaled up → http workers ${this.httpWorkers}, browser pages ${this.browserPages}`,
      )
    }
  }

  /** One step down (never below the safe minimum). */
  private scaleDown(): void {
    if (this.httpWorkers > this.minHttpWorkers || this.browserPages > this.minBrowserPages) {
      if (this.httpWorkers > this.minHttpWorkers) this.httpWorkers -= 1
      if (this.browserPages > this.minBrowserPages) this.browserPages -= 1
      this.apply()
      this.logger.warn(
        `adaptive: scaled down → http workers ${this.httpWorkers}, browser pages ${this.browserPages} (resource pressure)`,
      )
    }
  }

  status(): Record<string, number> {
    return {
      httpWorkers: this.httpWorkers,
      minHttpWorkers: this.minHttpWorkers,
      maxHttpWorkers: this.maxHttpWorkers,
      browserPages: this.browserPages,
      minBrowserPages: this.minBrowserPages,
      maxBrowserPages: this.maxBrowserPages,
    }
  }
}
