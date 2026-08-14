/**
 * System Resource Monitor — auto hardware detection + live CPU/RAM/GPU usage.
 *
 * Detects the machine's CPU cores/threads, total/available RAM, and GPU
 * availability (via nvidia-smi when present), then samples usage on an
 * interval so the pipeline can throttle / pause automatically:
 *
 *   NORMAL      → full speed
 *   THROTTLING  → CPU or RAM above the warning threshold (slow down)
 *   PAUSED      → CPU or RAM above the critical threshold (stop new work)
 *
 * Nothing here is hardcoded to a specific machine — every threshold is
 * configurable through JukuConfig / env vars.
 */
import { availableParallelism, cpus, freemem, totalmem } from 'node:os'
import { execFile } from 'node:child_process'
import type { Logger } from './logger.js'

export type ResourceMode = 'NORMAL' | 'THROTTLING' | 'PAUSED'

export interface ResourceSnapshot {
  cpuPct: number
  ramPct: number
  gpuPct: number | null
  cores: number
  threads: number
  totalRamGb: number
  availableRamGb: number
  mode: ResourceMode
}

export interface SystemMonitorOptions {
  cpuWarn?: number
  cpuCritical?: number
  ramWarn?: number
  ramCritical?: number
  gpuMonitor?: boolean
  intervalMs?: number
  logger?: Logger
  /** Called after every sample tick (e.g. to redraw the status line). */
  onTick?: (snapshot: ResourceSnapshot) => void
}

const sleep = (ms: number): Promise<void> => new Promise(res => setTimeout(res, ms))

export class SystemMonitor {
  private readonly cpuWarn: number
  private readonly cpuCritical: number
  private readonly ramWarn: number
  private readonly ramCritical: number
  private readonly gpuMonitor: boolean
  private readonly intervalMs: number
  private readonly logger?: Logger
  private onTick?: (snapshot: ResourceSnapshot) => void

  private timer: NodeJS.Timeout | null = null
  private cpuPct = 0
  private ramPct = 0
  private gpuPct: number | null = null
  private gpuChecked = false
  private gpuAvailable = false
  private prevCpu: { idle: number; total: number } | null = null

  constructor(opts: SystemMonitorOptions = {}) {
    this.cpuWarn = opts.cpuWarn ?? 70
    this.cpuCritical = opts.cpuCritical ?? 85
    this.ramWarn = opts.ramWarn ?? 75
    this.ramCritical = opts.ramCritical ?? 85
    this.gpuMonitor = opts.gpuMonitor ?? true
    this.intervalMs = opts.intervalMs ?? 3000
    this.logger = opts.logger
    this.onTick = opts.onTick
    this.sample()
  }

  /** Detect hardware: CPU cores/threads + RAM (always available on Node). */
  hardware(): { cores: number; threads: number; totalRamGb: number } {
    let threads = 0
    try {
      threads = availableParallelism()
    } catch {
      threads = cpus().length
    }
    return {
      cores: cpus().length,
      threads,
      totalRamGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    }
  }

  /** Start the sampling loop (idempotent). */
  start(): void {
    if (this.timer) return
    this.sample()
    this.timer = setInterval(() => this.sample(), this.intervalMs)
  }

  /** Attach a callback that fires after every sample tick. */
  setOnTick(fn: (snapshot: ResourceSnapshot) => void): void {
    this.onTick = fn
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** One sample pass: CPU delta, RAM usage, GPU (throttled nvidia-smi probe). */
  private sample(): void {
    this.sampleCpu()
    this.sampleRam()
    this.maybeSampleGpu()
    this.onTick?.(this.snapshot())
  }

  private sampleCpu(): void {
    const cores = cpus()
    let idle = 0
    let total = 0
    for (const c of cores) {
      idle += c.times.idle
      total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq
    }
    if (this.prevCpu) {
      const dIdle = idle - this.prevCpu.idle
      const dTotal = total - this.prevCpu.total
      this.cpuPct = dTotal > 0 ? Math.min(100, Math.max(0, 100 * (1 - dIdle / dTotal))) : 0
    }
    this.prevCpu = { idle, total }
  }

  private sampleRam(): void {
    const total = totalmem()
    const free = freemem()
    this.ramPct = total > 0 ? Math.round(((total - free) / total) * 100) : 0
  }

  /**
   * Probe GPU usage through nvidia-smi (NVIDIA GPUs on Windows/Linux).
   * Probes availability once; only runs the command every ~5th tick so we
   * never hammer the GPU driver. Returns null when no NVIDIA GPU is found.
   */
  private maybeSampleGpu(): void {
    if (!this.gpuMonitor) return
    if (!this.gpuChecked) {
      this.gpuChecked = true
      execFile(
        'nvidia-smi',
        ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'],
        { timeout: 3000, windowsHide: true },
        (err, stdout) => {
          if (err) {
            this.gpuAvailable = false
            this.gpuPct = null
            return
          }
          this.gpuAvailable = true
          const m = /(\d+)/.exec(stdout)
          this.gpuPct = m ? Math.min(100, Number(m[1])) : null
        },
      )
      return
    }
    if (!this.gpuAvailable) return
    // Sample at most every 5 ticks (~15s) to avoid hammering nvidia-smi.
    if (this.tickCount % 5 !== 0) return
    execFile(
      'nvidia-smi',
      ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'],
      { timeout: 3000, windowsHide: true },
      (_err, stdout) => {
        const m = /(\d+)/.exec(stdout)
        this.gpuPct = m ? Math.min(100, Number(m[1])) : null
      },
    )
  }

  private tickCount = 0

  /** Current snapshot: usage percentages + detected hardware + mode. */
  snapshot(): ResourceSnapshot {
    this.tickCount += 1
    const hw = this.hardware()
    let mode: ResourceMode = 'NORMAL'
    if (this.cpuPct >= this.cpuCritical || this.ramPct >= this.ramCritical) {
      mode = 'PAUSED'
    } else if (this.cpuPct >= this.cpuWarn || this.ramPct >= this.ramWarn) {
      mode = 'THROTTLING'
    }
    return {
      cpuPct: Math.round(this.cpuPct),
      ramPct: this.ramPct,
      gpuPct: this.gpuPct,
      cores: hw.cores,
      threads: hw.threads,
      totalRamGb: hw.totalRamGb,
      availableRamGb: Math.round((freemem() / 1024 ** 3) * 10) / 10,
      mode,
    }
  }

  /**
   * Block until the system is below the critical threshold again. Used as a
   * gate before starting new work so a hot machine pauses instead of failing.
   */
  async waitForHeadroom(maxWaitMs = 120_000): Promise<void> {
    const deadline = Date.now() + maxWaitMs
    while (Date.now() < deadline && this.snapshot().mode === 'PAUSED') {
      this.logger?.warn(
        `resource critical (CPU ${this.cpuPct}% RAM ${this.ramPct}%) — pausing new work until it cools down`,
      )
      await sleep(3000)
    }
    if (this.snapshot().mode === 'PAUSED') {
      this.logger?.error('resource still critical after wait — continuing anyway')
    }
  }

  /** One-line status summary (used by the resource monitor display). */
  describe(): string {
    const s = this.snapshot()
    const gpu = s.gpuPct === null ? 'GPU n/a' : `GPU ${s.gpuPct}%`
    return `CPU ${s.cpuPct}% | RAM ${s.ramPct}% | ${gpu} | ${s.cores} cores / ${s.threads} threads | Mode ${s.mode}`
  }
}
