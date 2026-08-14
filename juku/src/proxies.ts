/**
 * Centralized Proxy Pool Manager.
 *
 * Loads the user's existing working proxies (HTTP/HTTPS + SOCKS4/SOCKS5,
 * with or without authentication, including the legacy `ip:port:user:pass`
 * batch format), then provides:
 *   - proxy rotation
 *   - health checking (live latency test)
 *   - latency tracking
 *   - failed-proxy tracking
 *   - cooldown after repeated failures
 *   - automatic recovery / re-testing of cooled-down proxies
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import axios from 'axios'
import { Logger } from './logger.js'

export type ProxyStatus = 'ACTIVE' | 'FAILED' | 'COOLDOWN'

export interface ProxyEntry {
  raw: string
  /** scheme://host:port (auth stripped, for Playwright) */
  server: string
  scheme: 'http' | 'https' | 'socks4' | 'socks5'
  host: string
  port: number
  username?: string
  password?: string
  failures: number
  /** ms timestamp until which the proxy is cooled down */
  cooldownUntil: number
  /** last measured latency in ms */
  latencyMs?: number
  lastUsedAt?: number
  /** lifetime counters for proxy statistics */
  successCount: number
  failureCount: number
  lastSuccessAt?: number
  lastFailureAt?: number
  lastCheckedAt?: number
}

/**
 * Parse one proxy line into a ProxyEntry.
 * Accepts: http://host:port, https://host:port, socks5://host:port,
 * http://user:pass@host:port, plain host:port, and the legacy
 * `ip:port:user:pass` (4-part) paid-batch format.
 */
export function parseProxyLine(raw: string): ProxyEntry | null {
  let line = raw.trim()
  if (!line) return null

  let scheme: ProxyEntry['scheme'] = 'http'
  let rest = line

  const schemeMatch = /^(https?|socks4|socks5):\/\//i.exec(line)
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase() as ProxyEntry['scheme']
    rest = line.slice(schemeMatch[0].length)
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d{2,5}(:|\s|$)/.test(line)) {
    // Plain ip:port or legacy ip:port:user:pass
    const parts = line.split(/[:@]/)
    if (parts.length >= 4 && !line.includes('@')) {
      // ip:port:user:pass
      const [ip, port, username, password] = parts
    return {
      raw: line,
      server: `http://${ip}:${port}`,
      scheme: 'http',
      host: ip,
      port: Number(port),
      username,
      password,
      failures: 0,
      cooldownUntil: 0,
      successCount: 0,
      failureCount: 0,
    }
    }
    rest = line
  } else {
    return null
  }

  let username: string | undefined
  let password: string | undefined
  let hostPort = rest
  const at = rest.lastIndexOf('@')
  if (at !== -1) {
    const auth = rest.slice(0, at)
    hostPort = rest.slice(at + 1)
    const colon = auth.indexOf(':')
    if (colon === -1) {
      username = auth
    } else {
      username = auth.slice(0, colon)
      password = auth.slice(colon + 1)
    }
  }

  const m = /^([^:]+):(\d{1,5})$/.exec(hostPort.trim())
  if (!m) return null
  const port = Number(m[2])
  if (port <= 0 || port > 65535) return null

  return {
    raw: line,
    server: `${scheme}://${hostPort}`,
    scheme,
    host: m[1],
    port,
    username,
    password,
    failures: 0,
    cooldownUntil: 0,
    successCount: 0,
    failureCount: 0,
  }
}

/** Build an axios agent for a given proxy + target URL scheme. */
export function agentFor(proxy: ProxyEntry, targetIsHttps: boolean): unknown {
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}${proxy.password ? `:${encodeURIComponent(proxy.password)}` : ''}@`
    : ''
  const target = `${proxy.scheme}://${auth}${proxy.host}:${proxy.port}`
  if (proxy.scheme === 'socks4' || proxy.scheme === 'socks5') {
    const socks = new SocksProxyAgent(target)
    return socks
  }
  if (proxy.scheme === 'https') {
    return new HttpsProxyAgent(target)
  }
  // http proxy
  return targetIsHttps ? new HttpsProxyAgent(target) : new HttpProxyAgent(target)
}

export class ProxyPool {
  private proxies: ProxyEntry[] = []
  private cursor = 0
  private readonly logger: Logger
  private readonly maxProxies: number
  /** probe URL for health checks */
  probeUrl: string

  constructor(opts: { logger: Logger; maxProxies?: number; probeUrl?: string }) {
    this.logger = opts.logger
    this.maxProxies = opts.maxProxies ?? 60
    this.probeUrl = opts.probeUrl ?? 'https://api.mangadex.org/ping'
  }

  /** Load proxies from a file path or directory (auto-discovery). */
  loadFile(path: string): number {
    if (!existsSync(path)) return 0
    let added = 0
    try {
      if (isDir(path)) {
        const files = readdirSync(path)
          .filter(f => extname(f).toLowerCase() === '.txt')
          .sort()
        for (const f of files) added += this.loadFile(join(path, f))
        return added
      }
      const text = readFileSync(path, 'utf-8')
      for (const line of text.split(/\r?\n/)) {
        const entry = parseProxyLine(line)
        if (!entry) continue
        // Skip exact duplicates.
        if (this.proxies.some(p => p.server === entry.server && p.username === entry.username)) continue
        this.proxies.push(entry)
        added += 1
      }
      this.logger.info(`loaded ${added} proxies from ${basename(path)}`, { source: 'proxy-pool' })
    } catch (err) {
      this.logger.error(`failed to load proxies from ${path}`, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return added
  }

  get size(): number {
    return this.proxies.length
  }

  get entries(): ProxyEntry[] {
    return this.proxies
  }

  /**
   * Pick the next usable proxy, preferring ones that have already proven to
   * work (successCount > 0, lowest latency first) across the WHOLE pool.
   * Untested proxies are only used when nothing has proven itself yet — and
   * even then rotation stays inside a bounded window so we don't re-pick the
   * same dead bulk-list entry back-to-back.
   */
  next(): ProxyEntry | null {
    const now = Date.now()
    const alive = this.proxies.filter(p => p.cooldownUntil <= now)
    if (alive.length === 0) return null
    const knownGood = alive
      .filter(p => p.successCount > 0)
      .sort((a, b) => (a.latencyMs ?? Number.MAX_SAFE_INTEGER) - (b.latencyMs ?? Number.MAX_SAFE_INTEGER))
    let pool: ProxyEntry[]
    if (knownGood.length > 0) {
      pool = knownGood
    } else {
      pool = alive
        .sort((a, b) => a.failures - b.failures)
        .slice(0, Math.min(this.maxProxies, alive.length))
    }
    const p = pool[this.cursor % pool.length]
    this.cursor = (this.cursor + 1) % pool.length
    p.lastUsedAt = now
    return p
  }

  /**
   * Fire-and-forget warm-up: test the first `n` untested proxies so the pool
   * learns which ones work within seconds instead of during real requests.
   */
  async warmUp(n = 20, concurrency = 10): Promise<void> {
    const untested = this.proxies.filter(p => p.successCount === 0 && p.failures === 0).slice(0, n)
    if (untested.length === 0) return
    let idx = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = idx
        idx += 1
        if (i >= untested.length) return
        const p = untested[i]
        const latency = await this.checkOne(p, 10_000)
        if (latency !== null) this.markSuccess(p, latency)
        else p.failures += 1
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, untested.length) }, worker))
    const good = untested.filter(p => p.successCount > 0).length
    this.logger.info(`proxy warm-up: ${good}/${untested.length} live`, { source: 'proxy-pool' })
  }

  /**
   * Persist proxy health (success counts, latency, failures, cooldowns) so
   * the next run starts with known-good proxies instead of 0 latency data.
   */
  saveState(file: string): void {
    try {
      const data = this.proxies.map(p => ({
        server: p.server,
        username: p.username,
        successCount: p.successCount,
        failureCount: p.failureCount,
        failures: p.failures,
        latencyMs: p.latencyMs,
        cooldownUntil: p.cooldownUntil,
      }))
      writeFileSync(file, JSON.stringify(data))
    } catch (err) {
      this.logger.error(`failed to save proxy state to ${file}`, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /** Restore proxy health previously saved by saveState(). */
  loadState(file: string): void {
    if (!existsSync(file)) return
    try {
      const saved = JSON.parse(readFileSync(file, 'utf-8')) as Array<{
        server: string
        username?: string
        successCount?: number
        failureCount?: number
        failures?: number
        latencyMs?: number
        cooldownUntil?: number
      }>
      let restored = 0
      for (const s of saved) {
        const p = this.proxies.find(
          x => x.server === s.server && (x.username ?? undefined) === (s.username ?? undefined),
        )
        if (!p) continue
        if (s.successCount) p.successCount = s.successCount
        if (s.failureCount) p.failureCount = s.failureCount
        if (s.failures) p.failures = s.failures
        if (s.latencyMs !== undefined) p.latencyMs = s.latencyMs
        if (s.cooldownUntil) p.cooldownUntil = s.cooldownUntil
        restored += 1
      }
      this.logger.info(`proxy state restored for ${restored} proxies`, { source: 'proxy-pool' })
    } catch (err) {
      this.logger.warn(`failed to load proxy state from ${file}`, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  markSuccess(proxy: ProxyEntry, latencyMs?: number): void {
    proxy.failures = 0
    proxy.cooldownUntil = 0
    proxy.successCount += 1
    proxy.lastSuccessAt = Date.now()
    proxy.lastCheckedAt = Date.now()
    if (latencyMs !== undefined) proxy.latencyMs = latencyMs
  }

  markFailure(proxy: ProxyEntry): void {
    proxy.failures += 1
    proxy.failureCount += 1
    proxy.lastFailureAt = Date.now()
    proxy.lastCheckedAt = Date.now()
    if (proxy.failures >= 3) {
      proxy.cooldownUntil = Date.now() + 60_000 // 1 min cooldown
      this.logger.warn(`proxy cooled down after ${proxy.failures} failures`, {
        source: 'proxy-pool',
        url: proxy.server,
      })
    }
  }

  /** Current state of a proxy (ACTIVE / FAILED / COOLDOWN). */
  status(proxy: ProxyEntry): ProxyStatus {
    if (proxy.cooldownUntil > Date.now()) return 'COOLDOWN'
    if (proxy.failures >= 3) return 'FAILED'
    return 'ACTIVE'
  }

  /** Lightweight connectivity check that is throttled per proxy — it only
   * re-tests a proxy when it has not been checked within `minIntervalMs`.
   * Returns latency ms on success, null on failure. */
  async validateProxy(proxy: ProxyEntry, timeoutMs = 10_000, minIntervalMs = 30_000): Promise<number | null> {
    const now = Date.now()
    if (proxy.lastCheckedAt && now - proxy.lastCheckedAt < minIntervalMs) {
      // Don't hammer proxy test endpoints — reuse the last result.
      return proxy.failures >= 3 ? null : (proxy.latencyMs ?? 0)
    }
    const latency = await this.checkOne(proxy, timeoutMs)
    proxy.lastCheckedAt = now
    if (latency !== null) this.markSuccess(proxy, latency)
    else this.markFailure(proxy)
    return latency
  }

  /** Health-check a single proxy against the probe URL; returns latency ms or null. */
  async checkOne(proxy: ProxyEntry, timeoutMs = 10_000): Promise<number | null> {
    try {
      const agent = agentFor(proxy, this.probeUrl.startsWith('https'))
      const start = Date.now()
      await axios.get(this.probeUrl, {
        httpAgent: agent,
        httpsAgent: agent,
        proxy: false,
        timeout: timeoutMs,
        validateStatus: (s: number) => s >= 200 && s < 500,
      })
      return Date.now() - start
    } catch {
      return null
    }
  }

  /** Health-check all proxies with limited concurrency; returns count healthy. */
  async healthCheckAll(concurrency = 10, timeoutMs = 10_000): Promise<number> {
    const queue = [...this.proxies].slice(0, this.maxProxies)
    let idx = 0
    let healthy = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = idx
        idx += 1
        if (i >= queue.length) return
        const p = queue[i]
        const latency = await this.checkOne(p, timeoutMs)
        if (latency !== null) {
          this.markSuccess(p, latency)
          healthy += 1
        } else {
          p.failures += 1
          this.logger.warn(`proxy check failed: ${p.server}`, { source: 'proxy-pool', url: p.server })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
    return healthy
  }

  /** Automatically re-test cooled-down proxies (recovery). */
  async recoverCooledDown(timeoutMs = 10_000): Promise<number> {
    const now = Date.now()
    const cooled = this.proxies.filter(p => p.cooldownUntil > now)
    if (cooled.length === 0) return 0
    let recovered = 0
    for (const p of cooled) {
      const latency = await this.checkOne(p, timeoutMs)
      if (latency !== null) {
        this.markSuccess(p, latency)
        recovered += 1
      } else {
        p.cooldownUntil = now + 60_000
      }
    }
    this.logger.info(`proxy recovery: ${recovered}/${cooled.length} cooled-down proxies recovered`, {
      source: 'proxy-pool',
    })
    return recovered
  }

  stats(): Record<string, number | string> {
    const now = Date.now()
    const entries = this.proxies
    const active = entries.filter(p => p.cooldownUntil <= now && p.failures < 3).length
    const failed = entries.filter(p => p.cooldownUntil <= now && p.failures >= 3).length
    const coolingDown = entries.filter(p => p.cooldownUntil > now).length
    const withLatency = entries.filter(p => p.latencyMs !== undefined).length
    const successCount = entries.reduce((a, p) => a + p.successCount, 0)
    const failureCount = entries.reduce((a, p) => a + p.failureCount, 0)
    const totalChecks = successCount + failureCount
    return {
      total: this.proxies.length,
      active,
      failed,
      coolingDown,
      withLatency,
      avgLatencyMs: entries.length
        ? Math.round(entries.reduce((a, p) => a + (p.latencyMs ?? 0), 0) / entries.length)
        : 0,
      successRate: totalChecks > 0 ? Math.round((successCount / totalChecks) * 100) : 0,
    }
  }
}

function isDir(path: string): boolean {
  try {
    return readdirSync(path).length >= 0
  } catch {
    return false
  }
}
