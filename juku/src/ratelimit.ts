/**
 * Rate limiter — enforces configurable limits per source/domain:
 * requests-per-second, requests-per-minute and per-source concurrency.
 * All limits are derived from JukuConfig.rateLimits.
 */
import type { RateLimitConfig } from './types.js'

interface SourceState {
  window: number // sliding window start (ms)
  count: number // requests in the current window
  active: number // in-flight requests for concurrency limiting
}

export class RateLimiter {
  private readonly defaults: RateLimitConfig
  private readonly perSource = new Map<string, RateLimitConfig>()
  private readonly state = new Map<string, SourceState>()
  private readonly waiters: Array<{ source: string; resolve: () => void }> = []

  constructor(rateLimits: Record<string, RateLimitConfig>) {
    this.defaults = rateLimits['*'] ?? { rps: 5, rpm: 300, concurrency: 5 }
    for (const [name, cfg] of Object.entries(rateLimits)) {
      if (name === '*') continue
      this.perSource.set(name, cfg)
    }
  }

  private configFor(source: string): RateLimitConfig {
    return this.perSource.get(source) ?? this.defaults
  }

  /**
   * Dynamically adjust concurrency for a source (used by the adaptive
   * controller). `'*'` updates the defaults every unnamed source uses.
   */
  setConcurrency(source: string, n: number): void {
    const next = Math.max(1, Math.floor(n))
    if (source === '*') {
      this.defaults.concurrency = next
      return
    }
    const cfg = this.perSource.get(source)
    if (cfg) {
      cfg.concurrency = next
    } else {
      this.perSource.set(source, { ...this.defaults, concurrency: next })
    }
  }

  private stateFor(source: string): SourceState {
    let s = this.state.get(source)
    if (!s) {
      s = { window: Date.now(), count: 0, active: 0 }
      this.state.set(source, s)
    }
    return s
  }

  /**
   * Acquire a slot for a request on `source`. Resolves as soon as the request
   * is allowed by the rps / rpm / concurrency limits.
   */
  async acquire(source: string): Promise<void> {
    const cfg = this.configFor(source)
    const s = this.stateFor(source)
    const now = Date.now()

    // Refresh the sliding window every minute.
    if (now - s.window >= 60_000) {
      s.window = now
      s.count = 0
    }

    // Concurrency gate (per-source + global).
    while (s.active >= (cfg.concurrency || 1)) {
      await new Promise<void>(res => this.waiters.push({ source, resolve: res }))
    }

    // rps + rpm gate.
    for (;;) {
      const nowMs = Date.now()
      if (nowMs - s.window >= 60_000) {
        s.window = nowMs
        s.count = 0
      }
      const overRps = cfg.rps > 0 && s.count >= cfg.rps
      const overRpm = cfg.rpm > 0 && s.count >= cfg.rpm
      if (!overRps && !overRpm) break
      await new Promise<void>(res => setTimeout(res, 100))
    }

    s.active += 1
    s.count += 1
  }

  /** Release the slot after the request finished. */
  release(source: string): void {
    const s = this.stateFor(source)
    s.active = Math.max(0, s.active - 1)
    // Wake a waiter for this source if any.
    const idx = this.waiters.findIndex(w => w.source === source)
    if (idx !== -1) {
      const [waiter] = this.waiters.splice(idx, 1)
      waiter.resolve()
    }
  }
}
