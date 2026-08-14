/**
 * Live progress bars for the CLI (no dependencies).
 *
 * Renders stacked bars (titles / chapters / pages) in place, updating every
 * frame, with elapsed time, per-bar speed + ETA, and a footer showing
 * aggregate pages/s + chapters/s. Auto-disables when stdout is not a TTY
 * (e.g. piped output) so logs stay clean in scripts.
 */

export interface BarSpec {
  label: string
  current: number
  total: number
  suffix?: string
}

/** Extra counters for the footer speed line (e.g. pages, chapters). */
export interface ProgressMetrics {
  pages?: number
  chapters?: number
  titles?: number
}

const CLEAR_LINE = '\x1b[2K'
const CURSOR_UP = '\x1b[A'
const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'
const BAR_WIDTH = 22

/** ANSI colors — only emitted when stdout is a TTY. */
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

function drawBar(spec: BarSpec, elapsedSec: number, useColor: boolean): string {
  const pct = spec.total > 0 ? Math.min(1, spec.current / spec.total) : 0
  const filled = Math.round(BAR_WIDTH * pct)
  const barFill = '█'.repeat(filled)
  const barEmpty = '░'.repeat(BAR_WIDTH - filled)
  const pctStr = `${(pct * 100).toFixed(0).padStart(3)}%`
  const rate = elapsedSec > 0 && spec.current > 0 ? spec.current / elapsedSec : 0
  const speed = rate > 0 ? `${rate >= 10 ? Math.round(rate) : rate.toFixed(1)}/s` : ''
  const eta = rate > 0 && spec.current < spec.total ? `ETA ${fmtDuration((spec.total - spec.current) / rate)}` : ''
  const suffix = spec.suffix ? `  ${spec.suffix}` : ''
  const label = spec.label.padEnd(10)

  if (!useColor) {
    return `${label} [${barFill}${barEmpty}] ${pctStr}  ${spec.current}/${spec.total}${speed ? `  ${speed}` : ''}${eta ? ` · ${eta}` : ''}${suffix}`
  }
  const fillColor = pct >= 1 ? C.green : pct >= 0.9 ? C.yellow : C.green
  return (
    `${C.bold}${label}${C.reset} [${fillColor}${barFill}${C.reset}${C.gray}${barEmpty}${C.reset}] ` +
    `${C.bold}${pctStr}${C.reset}  ${spec.current}/${spec.total}` +
    `${speed ? `  ${C.cyan}${speed}${C.reset}` : ''}` +
    `${eta ? ` · ${C.dim}${eta}${C.reset}` : ''}${suffix}`
  )
}

export class Progress {
  private bars: BarSpec[] = []
  private metrics: ProgressMetrics = {}
  private rendered = false
  private finished = false
  private lastFrame = 0
  private readonly enabled: boolean
  private readonly useColor: boolean
  private readonly start = Date.now()

  constructor(enabled = process.stdout.isTTY === true) {
    this.enabled = enabled
    this.useColor = enabled
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  /** Replace the bar set and redraw (throttled to ~20fps). */
  set(bars: BarSpec[], metrics: ProgressMetrics = {}): void {
    if (!this.enabled || this.finished) return
    this.bars = bars
    this.metrics = metrics
    const now = Date.now()
    if (now - this.lastFrame < 50) return
    this.lastFrame = now
    this.render()
  }

  private elapsedLabel(): string {
    return fmtDuration((Date.now() - this.start) / 1000)
  }

  private footer(): string {
    const sec = Math.max(1, (Date.now() - this.start) / 1000)
    const parts: string[] = [`Elapsed ${this.elapsedLabel()}`]
    if (this.metrics.pages) {
      parts.push(`${C.cyan}${(this.metrics.pages / sec).toFixed(1)} pages/s${C.reset}`)
    }
    if (this.metrics.chapters) {
      parts.push(`${C.cyan}${(this.metrics.chapters / sec).toFixed(2)} ch/s${C.reset}`)
    }
    const b = this.bars[0]
    if (b && b.current > 0 && b.total > b.current) {
      const rate = b.current / sec
      parts.push(`${C.dim}ETA ${fmtDuration((b.total - b.current) / rate)}${C.reset}`)
    }
    return parts.join(' · ')
  }

  private render(): void {
    if (!this.enabled || this.finished) return
    if (this.rendered) {
      // Move cursor back up over the previously drawn lines.
      process.stdout.write(CURSOR_UP.repeat(this.bars.length + 1))
    }
    process.stdout.write(HIDE_CURSOR)
    const elapsedSec = Math.max(1, (Date.now() - this.start) / 1000)
    const lines = [...this.bars.map(b => drawBar(b, elapsedSec, this.useColor)), this.footer()]
    for (const line of lines) {
      process.stdout.write(CLEAR_LINE + line + '\n')
    }
    this.rendered = true
  }

  /** Finish: redraw the final state and restore the cursor. */
  done(): void {
    if (!this.enabled || this.finished) return
    this.finished = true
    this.render()
    process.stdout.write(SHOW_CURSOR)
    this.rendered = false
  }
}
