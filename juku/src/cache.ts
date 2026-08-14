/**
 * Cache — TTL-based, URL-keyed, with request deduplication and optional
 * persistent storage on disk (survives restarts).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Logger } from './logger.js'

interface CacheEntry {
  value: unknown
  expiresAt: number
}

export class Cache {
  private store = new Map<string, CacheEntry>()
  private inflight = new Map<string, Promise<unknown>>()
  private readonly ttlMs: number
  private readonly file: string
  private readonly logger: Logger
  hits = 0
  misses = 0

  constructor(opts: { ttlMs?: number; file?: string; logger: Logger }) {
    this.ttlMs = opts.ttlMs ?? 5 * 60_000
    this.file = opts.file ?? ''
    this.logger = opts.logger
    this.load()
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf-8')) as Record<string, CacheEntry>
      const now = Date.now()
      for (const [key, entry] of Object.entries(raw)) {
        if (entry && entry.expiresAt > now) this.store.set(key, entry)
      }
      this.logger.debug('cache loaded from disk', { entries: this.store.size })
    } catch {
      this.logger.warn('cache file unreadable, starting empty')
    }
  }

  /** Persist the cache to disk (call before exit, or on interval). */
  persist(): void {
    if (!this.file) return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.store)))
    } catch {
      this.logger.warn('could not persist cache')
    }
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) {
      this.misses += 1
      return undefined
    }
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key)
      this.misses += 1
      return undefined
    }
    this.hits += 1
    return entry.value as T
  }

  set(key: string, value: unknown, ttlMs = this.ttlMs): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs })
  }

  delete(key: string): void {
    this.store.delete(key)
  }

  /** Invalidate every key with the given prefix (cache invalidation). */
  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key)
    }
  }

  clear(): void {
    this.store.clear()
  }

  get size(): number {
    return this.store.size
  }

  /**
   * Run `fn`, memoizing the result under `key` until it expires.
   * Concurrent callers for the same key share a single in-flight promise —
   * that is the request deduplication layer.
   */
  async wrap<T>(key: string, fn: () => Promise<T>, ttlMs = this.ttlMs): Promise<T> {
    const hit = this.get<T>(key)
    if (hit !== undefined) return hit

    const existing = this.inflight.get(key)
    if (existing) return existing as Promise<T>

    const promise = fn()
      .then(value => {
        this.set(key, value, ttlMs)
        return value
      })
      .finally(() => {
        this.inflight.delete(key)
      })
    this.inflight.set(key, promise)
    return promise
  }
}
