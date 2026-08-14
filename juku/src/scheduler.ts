/**
 * Scheduler — runs automated jobs on an interval:
 *   - latest updates (discover new titles)
 *   - chapter checking (fetch new chapters for existing titles)
 *   - metadata refresh
 *   - source health checks (with circuit-breaker recovery)
 */
import type { Logger } from './logger.js'
import type { Pipeline } from './pipeline.js'

export interface SchedulerOptions {
  intervalMs: number
  jobs?: Array<'latest' | 'chapters' | 'metadata' | 'health'>
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private readonly logger: Logger
  private readonly pipeline: Pipeline
  private readonly opts: SchedulerOptions

  constructor(logger: Logger, pipeline: Pipeline, opts: SchedulerOptions) {
    this.logger = logger
    this.pipeline = pipeline
    this.opts = {
      intervalMs: opts.intervalMs,
      jobs: opts.jobs ?? ['latest', 'chapters', 'metadata', 'health'],
    }
  }

  start(): void {
    if (this.timer) return
    this.logger.info(`scheduler started (every ${Math.round(this.opts.intervalMs / 60_000)}min)`, { source: 'scheduler' })
    this.timer = setInterval(() => void this.tick(), this.opts.intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Run the scheduled jobs once. */
  async runOnce(): Promise<void> {
    await this.tick()
  }

  private async tick(): Promise<void> {
    if (this.running) {
      this.logger.debug('scheduler tick skipped (previous run still active)', { source: 'scheduler' })
      return
    }
    this.running = true
    try {
      for (const job of this.opts.jobs ?? []) {
        try {
          switch (job) {
            case 'latest':
              await this.pipeline.scheduledLatest()
              break
            case 'chapters':
              await this.pipeline.scheduledChapterCheck()
              break
            case 'metadata':
              await this.pipeline.scheduledMetadataRefresh()
              break
            case 'health':
              await this.pipeline.scheduledHealthCheck()
              break
          }
        } catch (err) {
          this.logger.error(`scheduled job ${job} failed`, {
            source: 'scheduler',
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    } finally {
      this.running = false
    }
  }
}
