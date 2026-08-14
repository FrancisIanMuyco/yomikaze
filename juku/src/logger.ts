/**
 * Structured logger — every scrape event is recorded as one JSON line with
 * the fields required by the JUKU spec (source, url, jobId, duration, status,
 * retry count, success/failure, errors, chapters/pages found).
 *
 * SECURITY: secrets (proxy passwords, cookies, authorization tokens) are
 * never logged — values are redacted before they reach any sink.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogFields {
  source?: string
  url?: string
  jobId?: string
  durationMs?: number
  status?: number | string
  retryCount?: number
  success?: boolean
  error?: string
  chaptersFound?: number
  pagesFound?: number
  titlesFound?: number
  [key: string]: unknown
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOG_DIR = join(__dirname, '..', 'logs')

/** Redact anything that looks like credentials before logging. */
export function redact(value: unknown): unknown {
  if (typeof value !== 'string') return value
  return value
    .replace(/(https?|socks5|socks4):\/\/[^/@\s]+:[^/@\s]+@/gi, '$1://***:***@')
    .replace(/(password|passwd|token|authorization|cookie)\s*[=:]\s*[^\s,;&"'{}]+/gi, '$1=***')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***')
}

export class Logger {
  private fileHandle: string | null = null
  readonly level: LogLevel

  constructor(opts: { level?: LogLevel; logFile?: boolean } = {}) {
    this.level = opts.level ?? 'info'
    if (opts.logFile !== false) {
      try {
        mkdirSync(LOG_DIR, { recursive: true })
        this.fileHandle = join(LOG_DIR, 'juku.log')
      } catch {
        this.fileHandle = null
      }
    }
  }

  private emit(level: LogLevel, message: string, fields: LogFields): void {
    const entry = {
      ts: new Date().toISOString(),
      level,
      message,
      ...fields,
    }
    const line = JSON.stringify(entry)
    // All structured logs go to stderr so stdout stays clean for CLI output
    // (search results, progress bars).
    if (this.level === 'debug' || level !== 'debug') {
      process.stderr.write(line + '\n')
    }
    if (this.fileHandle) {
      try {
        appendFileSync(this.fileHandle, line + '\n')
      } catch {
        /* logging must never break scraping */
      }
    }
  }

  debug(message: string, fields: LogFields = {}): void {
    this.emit('debug', message, redact(fields) as LogFields)
  }

  info(message: string, fields: LogFields = {}): void {
    this.emit('info', message, redact(fields) as LogFields)
  }

  warn(message: string, fields: LogFields = {}): void {
    this.emit('warn', message, redact(fields) as LogFields)
  }

  error(message: string, fields: LogFields = {}): void {
    this.emit('error', message, redact(fields) as LogFields)
  }

  /** Wrap an async call with duration + result logging. */
  async timed<T>(
    message: string,
    fields: LogFields,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = Date.now()
    try {
      const result = await fn()
      this.info(message, { ...fields, durationMs: Date.now() - start, success: true })
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.error(message, {
        ...fields,
        durationMs: Date.now() - start,
        success: false,
        error: msg,
      })
      throw err
    }
  }
}

export const logger = new Logger()
