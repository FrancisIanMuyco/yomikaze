/**
 * Circuit breaker — temporarily disables a source that keeps failing and
 * automatically tests / recovers it later (half-open probe).
 */
import { Logger } from './logger.js'

export type CircuitState = 'closed' | 'open' | 'half-open'

interface SourceCircuit {
  state: CircuitState
  failures: number
  openedAt: number
  lastTestAt: number
  consecutiveSuccesses: number
}

export class CircuitBreaker {
  private circuits = new Map<string, SourceCircuit>()
  private readonly threshold: number
  private readonly cooldownMs: number
  private readonly logger: Logger

  constructor(opts: { threshold: number; cooldownMs: number; logger: Logger }) {
    this.threshold = opts.threshold
    this.cooldownMs = opts.cooldownMs
    this.logger = opts.logger
  }

  private circuitFor(source: string): SourceCircuit {
    let c = this.circuits.get(source)
    if (!c) {
      c = { state: 'closed', failures: 0, openedAt: 0, lastTestAt: 0, consecutiveSuccesses: 0 }
      this.circuits.set(source, c)
    }
    return c
  }

  /**
   * Throws when the source circuit is open. In half-open state one probe
   * request is allowed through to test recovery.
   */
  allow(source: string): void {
    const c = this.circuitFor(source)
    if (c.state === 'closed') return
    if (c.state === 'open') {
      // Cooldown elapsed → allow a single probe (half-open).
      if (Date.now() - c.openedAt >= this.cooldownMs) {
        c.state = 'half-open'
        c.lastTestAt = Date.now()
        this.logger.info(`circuit breaker half-open, probing source ${source}`, { source })
        return
      }
      throw new Error(`source ${source} disabled by circuit breaker (open since ${new Date(c.openedAt).toISOString()})`)
    }
    // half-open: only one probe at a time
    if (Date.now() - c.lastTestAt < 5_000) {
      throw new Error(`source ${source} in half-open probe (waiting for test result)`)
    }
    c.lastTestAt = Date.now()
  }

  recordSuccess(source: string): void {
    const c = this.circuitFor(source)
    c.failures = 0
    c.consecutiveSuccesses += 1
    if (c.state !== 'closed' && c.consecutiveSuccesses >= 2) {
      c.state = 'closed'
      this.logger.info(`circuit breaker closed, source ${source} recovered`, { source })
    }
  }

  recordFailure(source: string): void {
    const c = this.circuitFor(source)
    c.failures += 1
    c.consecutiveSuccesses = 0
    if (c.state === 'half-open') {
      c.state = 'open'
      c.openedAt = Date.now()
      this.logger.warn(`circuit breaker probe failed, re-opening source ${source}`, { source })
    } else if (c.failures >= this.threshold && c.state === 'closed') {
      c.state = 'open'
      c.openedAt = Date.now()
      this.logger.warn(`circuit breaker OPEN for source ${source} after ${c.failures} failures`, { source })
    }
  }

  state(source: string): CircuitState {
    return this.circuitFor(source).state
  }

  reset(source: string): void {
    this.circuits.delete(source)
  }

  /** Explicit health check → used by the scheduler to force recovery. */
  async healthCheck(source: string, probe: () => Promise<void>): Promise<boolean> {
    const c = this.circuitFor(source)
    if (c.state === 'closed') {
      // Still verify liveness periodically.
      try {
        await probe()
        this.recordSuccess(source)
        return true
      } catch (err) {
        this.recordFailure(source)
        this.logger.error(`health check failed for ${source}`, {
          source,
          error: err instanceof Error ? err.message : String(err),
        })
        return false
      }
    }
    // open or half-open: allow a probe and recover on success
    try {
      await probe()
      this.recordSuccess(source)
      this.logger.info(`source ${source} recovered by health check`, { source })
      return true
    } catch {
      c.state = 'open'
      c.openedAt = Date.now()
      return false
    }
  }

  snapshot(): Record<string, CircuitState> {
    const out: Record<string, CircuitState> = {}
    for (const [src, c] of this.circuits) out[src] = c.state
    return out
  }
}
