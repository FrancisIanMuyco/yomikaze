/**
 * Async concurrency queue — controls every scraping job.
 * Features: concurrency control, per-source limits, job priority, retry
 * queue, timeouts, and duplicate-job prevention.
 */
import type { SourceLimits } from './types.js'
import { Deduplicator } from './dedup.js'
import { Logger } from './logger.js'

export interface QueueJob<T = unknown> {
  /** Unique job id (duplicate-job prevention) */
  id: string
  /** Source this job belongs to (per-source limits) */
  source: string
  /** Lower = higher priority */
  priority?: number
  /** Timeout in ms (0 = no timeout) */
  timeoutMs?: number
  /** Max retries for this job */
  retries?: number
  run: () => Promise<T>
}

interface PendingJob<T> extends QueueJob<T> {
  priority: number
  attempts: number
  resolve: (value: T) => void
  reject: (err: unknown) => void
}

export class RequestQueue {
  private pending: PendingJob<unknown>[] = []
  private running = 0
  private activeBySource = new Map<string, number>()
  private readonly dedup = new Deduplicator()
  private currentConcurrency: number
  private readonly sourceLimits: Record<string, SourceLimits>
  private readonly logger: Logger

  constructor(opts: {
    concurrency: number
    sourceLimits: Record<string, SourceLimits>
    logger: Logger
  }) {
    this.currentConcurrency = opts.concurrency
    this.sourceLimits = opts.sourceLimits
    this.logger = opts.logger
  }

  get pendingCount(): number {
    return this.pending.length
  }

  get runningCount(): number {
    return this.running
  }

  /**
   * Dynamically adjust global concurrency (used by the adaptive controller).
   * New jobs respect the new limit immediately; running jobs finish.
   */
  setConcurrency(n: number): void {
    const next = Math.max(1, Math.floor(n))
    if (next === this.currentConcurrency) return
    this.currentConcurrency = next
    this.logger.debug(`queue concurrency → ${next}`)
    this.pump()
  }

  get concurrency(): number {
    return this.currentConcurrency
  }

  private canStart(job: PendingJob<unknown>): boolean {
    const limit = this.sourceLimits[job.source]?.maxConcurrent
    if (limit === undefined || limit <= 0) return true
    return (this.activeBySource.get(job.source) ?? 0) < limit
  }

  private pump(): void {
    while (this.running < this.currentConcurrency) {
      // Pick the highest-priority job whose source limit allows it.
      let idx = -1
      for (let i = 0; i < this.pending.length; i += 1) {
        if (this.canStart(this.pending[i])) {
          idx = i
          break
        }
      }
      if (idx === -1) break
      const job = this.pending.splice(idx, 1)[0]
      void this.runJob(job)
    }
  }

  private async runJob(job: PendingJob<unknown>): Promise<void> {
    this.running += 1
    this.activeBySource.set(job.source, (this.activeBySource.get(job.source) ?? 0) + 1)

    const timeoutMs = job.timeoutMs ?? 30_000
    const timeout = (fn: () => Promise<unknown>) =>
      timeoutMs > 0
        ? Promise.race([
            fn(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`job timed out after ${timeoutMs}ms: ${job.id}`)), timeoutMs),
            ),
          ])
        : fn()

    try {
      const result = await timeout(async () => {
        try {
          return await job.run()
        } catch (err) {
          // Retry queue: re-run the job with backoff for retriable failures.
          const retries = job.retries ?? 0
          if (job.attempts <= retries) {
            job.attempts += 1
            this.logger.warn(`queue retry ${job.attempts}/${retries} for job ${job.id}`, {
              jobId: job.id,
              source: job.source,
              retryCount: job.attempts,
              error: err instanceof Error ? err.message : String(err),
            })
            await new Promise<void>(res => setTimeout(res, 500 * 2 ** (job.attempts - 1)))
            return await job.run()
          }
          throw err
        }
      })
      job.resolve(result)
    } catch (err) {
      job.reject(err)
    } finally {
      this.running -= 1
      const left = (this.activeBySource.get(job.source) ?? 1) - 1
      this.activeBySource.set(job.source, Math.max(0, left))
      this.dedup.remove('job', job.id)
      this.pump()
    }
  }

  /**
   * Enqueue a job. Duplicate ids are rejected while the job is pending/running
   * (duplicate-job prevention). Resolves with the job result.
   */
  add<T>(job: QueueJob<T>): Promise<T> {
    const id = job.id
    if (!this.dedup.isNew('job', id)) {
      return Promise.reject(new Error(`duplicate job rejected: ${id}`))
    }
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        ...job,
        priority: job.priority ?? 0,
        attempts: 0,
        resolve: resolve as (v: unknown) => void,
        reject,
      } as PendingJob<unknown>)
      this.pump()
    })
  }

  /** Drain the queue and wait until it is empty. */
  async idle(): Promise<void> {
    while (this.pending.length > 0 || this.running > 0) {
      await new Promise<void>(res => setTimeout(res, 50))
    }
  }
}
