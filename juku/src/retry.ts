/**
 * Retry manager — exponential backoff with jitter.
 * Retries network errors, timeouts, temporary HTTP errors (429/5xx) and
 * proxy failures. Configurable retry count and delays.
 */
import { Logger } from './logger.js'

export type RetriableErrorKind = 'network' | 'timeout' | 'http' | 'proxy' | 'unknown'

export class RetryError extends Error {
  readonly kind: RetriableErrorKind
  readonly status?: number
  readonly attempts: number

  constructor(message: string, kind: RetriableErrorKind, status?: number, attempts = 1) {
    super(message)
    this.name = 'RetryError'
    this.kind = kind
    this.status = status
    this.attempts = attempts
  }
}

export function classifyError(err: unknown): RetriableErrorKind {
  const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined
  const msg = err instanceof Error ? err.message : String(err)
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout/i.test(msg)) return 'timeout'
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    /socket hang up|proxy|tunnel|econn/i.test(msg)
  ) {
    return 'network'
  }
  return 'unknown'
}

/** True for HTTP statuses that are worth retrying (temporary failures). */
export function isTemporaryHttpStatus(status?: number): boolean {
  if (!status) return false
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)
}

export interface RetryOptions {
  attempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  jitter?: boolean
  /** Optional hook: called before each retry (e.g. to rotate the proxy). */
  onRetry?: (attempt: number, err: unknown) => void
}

export class RetryManager {
  constructor(
    private readonly opts: RetryOptions = {},
    private readonly logger?: Logger,
  ) {}

  private delayMs(attempt: number): number {
    const base = this.opts.baseDelayMs ?? 500
    const max = this.opts.maxDelayMs ?? 15_000
    const exp = Math.min(max, base * 2 ** (attempt - 1))
    if (this.opts.jitter === false) return exp
    return Math.round(exp * (0.5 + Math.random() * 0.5))
  }

  /**
   * Run `fn` with exponential backoff.
   * `shouldRetry` decides per-attempt; default retries network/timeout errors
   * and temporary HTTP errors.
   */
  async run<T>(
    fn: (attempt: number) => Promise<T>,
    shouldRetry?: (err: RetryError, attempt: number) => boolean,
  ): Promise<T> {
    const attempts = this.opts.attempts ?? 3
    let lastErr: RetryError | null = null

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await fn(attempt)
      } catch (err) {
        const kind = classifyError(err)
        const status = (err as { status?: number })?.status
        const retryErr = err instanceof RetryError ? err : new RetryError(
          err instanceof Error ? err.message : String(err),
          kind,
          status,
          attempt,
        )
        lastErr = retryErr
        if (attempt >= attempts) break

        const defaultRetry =
          kind === 'network' || kind === 'timeout' || (status !== undefined && isTemporaryHttpStatus(status))
        const ok = shouldRetry ? shouldRetry(retryErr, attempt) : defaultRetry
        if (!ok) break

        this.logger?.warn(`retry ${attempt}/${attempts - 1} for ${retryErr.kind}`, {
          retryCount: attempt,
          status: retryErr.status,
          error: retryErr.message,
        })
        this.opts.onRetry?.(attempt, retryErr)
        await new Promise<void>(res => setTimeout(res, this.delayMs(attempt)))
      }
    }

    throw lastErr ?? new RetryError('retry failed', 'unknown', undefined, attempts)
  }
}
