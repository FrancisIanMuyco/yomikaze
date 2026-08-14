/**
 * Configuration for the JUKU engine.
 * Everything is env-driven so the same engine can run in different setups.
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RateLimitConfig, SourceLimits } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** YOMIKAZE project root (one level above juku/) */
export const PROJECT_ROOT = resolve(__dirname, '..', '..')

export interface JukuConfig {
  /** Output file for the database writer (same store the frontend reads) */
  outputFile: string
  /** Persistent state (last successful scrape, errors, circuit breakers) */
  stateFile: string
  /** Persistent cache file */
  cacheFile: string
  /** Persistent proxy-health file (known-good proxies survive restarts) */
  proxyStateFile: string
  /** Global concurrency for the request queue */
  concurrency: number
  /** How many titles are imported in parallel within one batch (1 = sequential) */
  titleConcurrency: number
  /** Per-source queue limits */
  sourceLimits: Record<string, SourceLimits>
  /** Per-source rate limits (requests per second / minute) */
  rateLimits: Record<string, RateLimitConfig>
  /** HTTP timeout in ms */
  timeoutMs: number
  /** Base retry count for temporary failures */
  retries: number
  /** Exponential backoff base delay in ms */
  backoffBaseMs: number
  /** Max backoff delay in ms */
  backoffMaxMs: number
  /** Proxy list files (auto-discovered when empty) */
  proxyFiles: string[]
  /** Max proxies to use from the pool before giving up */
  maxProxies: number
  /** Use proxies when available */
  useProxies: boolean
  /** Circuit breaker: failures before a source is disabled */
  circuitBreakerThreshold: number
  /** Circuit breaker cooldown before auto-testing a disabled source (ms) */
  circuitBreakerCooldownMs: number
  /** Playwright: use system Chrome (channel) instead of bundled chromium */
  browserChannel: string
  headless: boolean
  /** Resource monitor: how often to sample CPU/RAM/GPU (ms) */
  resourceIntervalMs: number
  /** CPU% warning / critical thresholds for auto-throttling */
  cpuWarn: number
  cpuCritical: number
  /** RAM% warning / critical thresholds for auto-throttling */
  ramWarn: number
  ramCritical: number
  /** Try to monitor GPU usage (nvidia-smi) when available */
  gpuMonitor: boolean
  /** Adaptive worker (HTTP concurrency) start / min / max */
  httpWorkers: number
  minHttpWorkers: number
  maxHttpWorkers: number
  /** Adaptive browser page start / min / max */
  browserPages: number
  minBrowserPages: number
  maxBrowserPages: number
}

function envNum(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (!raw) return fallback
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function defaultProxyFiles(): string[] {
  const files: string[] = []
  const candidates = [
    join(PROJECT_ROOT, '..', 'proxy_checker', 'working_proxies.txt'),
    join(PROJECT_ROOT, '..', 'scraper', 'working proxies'),
    join(PROJECT_ROOT, '..', 'proxy_checker'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) files.push(c)
  }
  return files
}

export function loadConfig(overrides: Partial<JukuConfig> = {}): JukuConfig {
  const base: JukuConfig = {
    outputFile: process.env.JUKU_OUTPUT_FILE || join(PROJECT_ROOT, 'public', 'scraped.json'),
    stateFile: process.env.JUKU_STATE_FILE || join(__dirname, '..', 'state.json'),
    cacheFile: process.env.JUKU_CACHE_FILE || join(__dirname, '..', 'cache.json'),
    proxyStateFile: process.env.JUKU_PROXY_STATE_FILE || join(__dirname, '..', 'proxy-state.json'),
    concurrency: envNum('JUKU_CONCURRENCY', 4),
    // >1 imports several titles at once (turbo mode). The resource monitor
    // still throttles/pauses everything when CPU/RAM gets hot, so the PC
    // stays usable for YouTube/Facebook while it runs.
    titleConcurrency: envNum('JUKU_TITLE_CONCURRENCY', 1),
    sourceLimits: {
      mangafire: { maxConcurrent: 3 },
      mangadex: { maxConcurrent: 6 },
      local: { maxConcurrent: 4 },
    },
    rateLimits: {
      mangafire: {
        rps: envNum('JUKU_MANGAFIRE_RPS', 1),
        rpm: envNum('JUKU_MANGAFIRE_RPM', 60),
        concurrency: 1,
      },
      mangadex: {
        rps: envNum('JUKU_MANGADEX_RPS', 2),
        rpm: envNum('JUKU_MANGADEX_RPM', 120),
        concurrency: 2,
      },
      local: { rps: 0, rpm: 0, concurrency: 4 },
    },
    timeoutMs: envNum('JUKU_TIMEOUT_MS', 10_000),
    retries: envNum('JUKU_RETRIES', 3),
    backoffBaseMs: envNum('JUKU_BACKOFF_BASE_MS', 500),
    backoffMaxMs: envNum('JUKU_BACKOFF_MAX_MS', 15_000),
    proxyFiles: process.env.JUKU_PROXY_FILES
      ? process.env.JUKU_PROXY_FILES.split(',').map(s => s.trim()).filter(Boolean)
      : defaultProxyFiles(),
    maxProxies: envNum('JUKU_MAX_PROXIES', 60),
    useProxies: envBool('JUKU_USE_PROXIES', true),
    circuitBreakerThreshold: envNum('JUKU_CIRCUIT_THRESHOLD', 5),
    circuitBreakerCooldownMs: envNum('JUKU_CIRCUIT_COOLDOWN_MS', 60_000),
    browserChannel: process.env.JUKU_BROWSER_CHANNEL || 'chrome',
    headless: envBool('JUKU_HEADLESS', true),
    resourceIntervalMs: envNum('JUKU_RESOURCE_INTERVAL_MS', 3000),
    cpuWarn: envNum('JUKU_CPU_WARN', 70),
    cpuCritical: envNum('JUKU_CPU_CRITICAL', 85),
    ramWarn: envNum('JUKU_RAM_WARN', 75),
    ramCritical: envNum('JUKU_RAM_CRITICAL', 85),
    gpuMonitor: envBool('JUKU_GPU_MONITOR', true),
    httpWorkers: envNum('JUKU_HTTP_WORKERS', 3),
    minHttpWorkers: envNum('JUKU_MIN_HTTP_WORKERS', 1),
    maxHttpWorkers: envNum('JUKU_MAX_HTTP_WORKERS', 12),
    browserPages: envNum('JUKU_BROWSER_PAGES', 2),
    minBrowserPages: envNum('JUKU_MIN_BROWSER_PAGES', 1),
    maxBrowserPages: envNum('JUKU_MAX_BROWSER_PAGES', 6),
  }
  return { ...base, ...overrides }
}

export const config: JukuConfig = loadConfig()
