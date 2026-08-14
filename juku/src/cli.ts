#!/usr/bin/env node
/**
 * JUKU — YOMIKAZE scraping engine CLI.
 *
  *   juku search "one punch man" [--sources mangafire,mangadex,mangakakalot] [--limit 10]
 *   juku import [--rail latest|popular] [--limit 20] [--chapters latest-20|all|none]
  *               [--source mangafire] [--fresh]
 *   juku update [--chapters latest-10]
  *   juku health [--source mangafire]
 *   juku proxies [--check] [--recover]
 *   juku scheduler [--once] [--interval 60]
 *   juku status
 */
import { createInterface } from 'readline'
import { Pipeline } from './pipeline.js'
import { Progress } from './progress.js'
import { Scheduler } from './scheduler.js'
import { registry } from './sources/SourceAdapter.js'
import type { ImportProgress } from './pipeline.js'
import type { RawTitle } from './normalizer.js'

function argValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(`--${name}`)
  if (idx === -1 || idx + 1 >= args.length) return undefined
  return args[idx + 1]
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`)
}

function parseArgs(args: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (!a.startsWith('--')) continue
    const name = a.slice(2)
    const next = args[i + 1]
    if (next && !next.startsWith('--')) {
      out[name] = next
      i += 1
    } else {
      out[name] = 'true'
    }
  }
  return out
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const command = args.find(a => !a.startsWith('--'))
  if (!command) {
    printHelp()
    return 0
  }

  const pipeline = new Pipeline()

  try {
    switch (command) {
      case 'search': {
        const query = args[args.indexOf('search') + 1]
        if (!query) {
          console.error('usage: juku search "<query>" [--sources mangafire,mangadex,mangakakalot] [--limit 10]')
          return 1
        }
        const single = argValue(args, 'source')
        const sources = single
          ? [single]
          : (argValue(args, 'sources') ?? 'mangafire,mangadex,mangakakalot')
              .split(',')
              .map(s => s.trim())
              .filter(Boolean)
        const limit = Number(argValue(args, 'limit') ?? 10)
        const res = await pipeline.searchMulti(sources, query, limit)
        await showTitles(pipeline, res.titles, `for "${query}" across [${sources.join(', ')}]`, res.failures)
        return 0
      }

      case 'recommend': {
        const opts = parseArgs(args)
        const sources = (opts.sources ?? 'mangadex,mangafire,mangakakalot')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
        const limit = Number(opts.limit ?? 10)
        console.log(`\n[JUKU] fetching recommended (trending/popular) titles from [${sources.join(', ')}]...`)
        const res = await pipeline.recommend(sources, limit)
        await showTitles(pipeline, res.titles, `recommended from [${sources.join(', ')}]`, res.failures)
        return 0
      }

      case 'import': {
        const opts = parseArgs(args)
        const source = opts.source ?? 'mangafire'
        const rail = (opts.rail as 'latest' | 'popular') ?? 'latest'
        const limit = Number(opts.limit ?? 20)
        const chapters = opts.chapters ?? 'latest-20'
        const fresh = opts.fresh === 'true'
        const bar = new Progress()
        console.log(`\n[JUKU] importing ${limit} ${rail} titles from ${source} (chapters: ${chapters})...`)
        const onNotice = (msg: string): void => {
          if (bar.isEnabled) {
            // Notices would corrupt the progress bars — show them as suffix.
            bar.set([{ label: 'Dupes', current: 1, total: 1, suffix: msg.replace(/\[skip\] /, '') }])
          } else {
            console.log(msg)
          }
        }
        const onProgress = (p: ImportProgress): void => {
          if (p.stage === 'title') {
            bar.set(
              [
                {
                  label: p.title ? `  ${p.title.slice(0, 24)}` : 'Chapter',
                  current: p.done,
                  total: p.total,
                  suffix: `${p.pagesFound} pages${p.skippedChapters ? ` · ${p.skippedChapters} dupes skipped` : ''}`,
                },
              ],
              { pages: p.pagesFound, chapters: p.chaptersFound },
            )
          } else {
            bar.set(
              [{ label: 'Titles', current: p.done, total: p.total, suffix: `${p.chaptersFound} chapters · ${p.pagesFound} pages` }],
              { pages: p.pagesFound, chapters: p.chaptersFound, titles: p.done },
            )
          }
        }
        const result = await pipeline.importBatch(source, { rail, limit, chapters, fresh, onProgress, onNotice })
        bar.done()
        console.log(
          `\n[JUKU] done: ${result.titles} titles, ${result.chapters} chapters, ${result.pages} pages → ${pipeline.config.outputFile}`,
        )
        if (result.skippedTitles > 0 || result.skippedChapters > 0) {
          console.log(
            `[JUKU] duplicates skipped: ${result.skippedTitles} title(s) · ${result.skippedChapters} chapter(s) — wala na balik-balik ✅`,
          )
        }
        return 0
      }

      case 'update': {
        const chapters = argValue(args, 'chapters') ?? 'latest-10'
        const bar = new Progress()
        console.log(`\n[JUKU] updating library (new chapters: ${chapters})...`)
        const onNotice = (msg: string): void => {
          if (bar.isEnabled) {
            bar.set([{ label: 'Dupes', current: 1, total: 1, suffix: msg.replace(/\[skip\] /, '') }])
          } else {
            console.log(msg)
          }
        }
        const onProgress = (p: ImportProgress): void => {
          if (p.stage === 'title') {
            bar.set(
              [{ label: p.title ? `  ${p.title.slice(0, 24)}` : 'Chapter', current: p.done, total: p.total, suffix: `${p.pagesFound} pages${p.skippedChapters ? ` · ${p.skippedChapters} dupes skipped` : ''}` }],
              { pages: p.pagesFound, chapters: p.chaptersFound },
            )
          } else {
            bar.set(
              [{ label: 'Titles', current: p.done, total: p.total, suffix: `${p.chaptersFound} new chapters${p.skippedTitles ? ` · ${p.skippedTitles} skipped` : ''}` }],
              { pages: p.pagesFound, chapters: p.chaptersFound, titles: p.done },
            )
          }
        }
        const result = await pipeline.updateLibrary({ chapters, onProgress, onNotice })
        bar.done()
        console.log(`\n[JUKU] update done: ${result.titles} titles checked, +${result.chapters} chapters, ${result.pages} pages`)
        if (result.skipped > 0) {
          console.log(`[JUKU] ${result.skipped} title(s) skipped — non-MangaDex source (gamita ang Python scraper para ana)`)
        }
        return 0
      }

      case 'health': {
        const source = argValue(args, 'source') ?? 'mangafire'
        const ok = await pipeline.healthCheck(source)
        console.log(`\n[JUKU] health check ${source}: ${ok ? 'OK ✅' : 'FAILED ❌'}`)
        return ok ? 0 : 1
      }

      case 'proxies': {
        const doCheck = hasFlag(args, 'check') || args.length === 2
        const doRecover = hasFlag(args, 'recover')
        if (doCheck) {
          console.log(`\n[JUKU] health-checking ${pipeline.proxyPool.size} proxies...\n`)
          const healthy = await pipeline.proxyPool.healthCheckAll()
          console.log(`\n[JUKU] proxies: ${healthy}/${pipeline.proxyPool.size} healthy`)
          console.log(`  ${JSON.stringify(pipeline.proxyPool.stats(), null, 2)}`)
        }
        if (doRecover) {
          const recovered = await pipeline.proxyPool.recoverCooledDown()
          console.log(`\n[JUKU] recovered ${recovered} cooled-down proxies`)
        }
        if (!doCheck && !doRecover) {
          console.log(`\n[JUKU] proxy pool: ${pipeline.proxyPool.size} proxies loaded`)
          console.log(`  ${JSON.stringify(pipeline.proxyPool.stats(), null, 2)}`)
        }
        return 0
      }

      case 'scheduler': {
        const once = hasFlag(args, 'once')
        const intervalMin = Number(argValue(args, 'interval') ?? 60)
        if (once) {
          await pipeline.scheduledLatest()
          await pipeline.scheduledChapterCheck()
          await pipeline.scheduledHealthCheck()
          console.log('\n[JUKU] scheduler ran once.')
          return 0
        }
        const scheduler = new Scheduler(pipeline.logger, pipeline, { intervalMs: intervalMin * 60_000 })
        scheduler.start()
        console.log(`\n[JUKU] scheduler running every ${intervalMin}min. Ctrl+C to stop.`)
        await new Promise<void>(() => {}) // run forever
        scheduler.stop()
        return 0
      }

      case 'status': {
        const st = pipeline.status()
        const s = st.resources as { cpuPct: number; ramPct: number; gpuPct: number | null; mode: string }
        const gpu = s.gpuPct === null ? 'n/a' : `${s.gpuPct}%`
        console.log('\n[JUKU] engine status:')
        console.log(`  resources : CPU ${s.cpuPct}% | RAM ${s.ramPct}% | GPU ${gpu} | mode ${s.mode}`)
        console.log(`  hardware  : ${JSON.stringify(st.hardware)}`)
        console.log(`  adaptive  : ${JSON.stringify(st.adaptive)}`)
        console.log(`  proxies   : ${JSON.stringify(st.proxyPool)}`)
        console.log(`  queue     : ${JSON.stringify(st.queue)}`)
        console.log(`  store     : ${JSON.stringify(st.store)}`)
        console.log(`  sources   : ${JSON.stringify(st.sources)}`)
        console.log(`  circuits  : ${JSON.stringify(st.circuitBreakers)}`)
        return 0
      }

      case 'auto': {
        const opts = parseArgs(args)
        const once = opts.once === 'true'
        const intervalMin = Number(opts.interval ?? 60)
        const limit = Number(opts.limit ?? 10)
        const chapters = opts.chapters ?? 'latest-20'
        const rail = (opts.rail as 'latest' | 'popular' | 'both') ?? 'both'
        const sources = (opts.sources ?? 'mangafire,mangadex,mangakakalot').split(',').map(s => s.trim()).filter(Boolean)

        const sleep = (ms: number): Promise<void> => new Promise(res => setTimeout(res, ms))
        let lastLine = ''
        const statusTimer = setInterval(() => {
          const line = `\r${pipeline.resourceLine()}      `
          if (line !== lastLine) {
            process.stdout.write(line)
            lastLine = line
          }
        }, 3000)

        const stopStatus = (): void => {
          clearInterval(statusTimer)
          if (lastLine) {
            process.stdout.write('\r' + ' '.repeat(lastLine.length) + '\r')
          }
        }

        const onNotice = (msg: string): void => console.log(`  ${msg}`)
        const runCycle = async (): Promise<void> => {
          stopStatus()
          console.log(`\n[JUKU] auto cycle — sources: ${sources.join(', ')} rail: ${rail} limit: ${limit} chapters: ${chapters}`)
          for (const source of sources) {
            if (!registry.has(source)) {
              console.log(`  [skip] unknown source "${source}" — available: ${registry.list().map(s => s.id).join(', ')}`)
              continue
            }
            if (rail === 'both' || rail === 'latest') {
              const r = await pipeline.importBatch(source, { rail: 'latest', limit, chapters, onNotice })
              console.log(`  [${source}] latest → ${r.titles} titles · ${r.chapters} chapters · ${r.pages} pages`)
              pipeline.persist()
            }
            if (rail === 'both' || rail === 'popular') {
              const r = await pipeline.importBatch(source, { rail: 'popular', limit, chapters, onNotice })
              console.log(`  [${source}] popular → ${r.titles} titles · ${r.chapters} chapters · ${r.pages} pages`)
              pipeline.persist()
            }
          }
          const upd = await pipeline.updateLibrary({ chapters: 'latest-10', onNotice })
          console.log(`  update → ${upd.titles} titles checked · +${upd.chapters} chapters · +${upd.pages} pages`)
          pipeline.persist()
          const size = pipeline.db.size
          console.log(`  library now: ${size.titles} titles · ${size.chapters} chapters · ${size.pages} pages`)
        }

        if (once) {
          await runCycle()
          stopStatus()
          return 0
        }

        console.log(`\n[JUKU] AUTO MODE — running every ${intervalMin} min. Ctrl+C to stop.`)
        console.log('  CPU/GPU/RAM auto-detected — the scraper throttles and pauses itself when the machine is busy.')
        for (;;) {
          await pipeline.monitor.waitForHeadroom()
          await runCycle()
          const s = pipeline.monitor.snapshot()
          console.log(`\n  next cycle in ${intervalMin} min — CPU ${s.cpuPct}% RAM ${s.ramPct}% ${s.gpuPct === null ? '' : `GPU ${s.gpuPct}% `}(Ctrl+C to stop)`)
          for (let i = 0; i < intervalMin * 20; i += 1) {
            await sleep(3000)
            if (pipeline.monitor.snapshot().mode === 'PAUSED') {
              console.log('\r  resource critical — pausing until it cools down...   ')
              await pipeline.monitor.waitForHeadroom()
              console.log('\r  recovered — resuming cycle timer.                      ')
            }
          }
        }
      }

      default:
        printHelp()
        return 1
    }
  } finally {
    await pipeline.close()
  }
}

function printHelp(): void {
  console.log(`JUKU — YOMIKAZE scraping engine

Usage: juku <command> [options]

Commands:
  search "<query>"          Search all sources in parallel (--sources a,b,c,
                            --limit N). Shows chapter counts + ✓ in-library
                            marks; duplicate titles across sources are merged.
  recommend                 Recommended (trending/popular) titles from all
                            sources with chapter counts — pick one to scrape
                            (--sources a,b,c, --limit N).
  import                    Discover + import titles (--rail latest|popular,
                            --limit, --chapters latest-N|all|none, --source, --fresh)
  update                    Update existing library with new chapters
                            (x5 parallel, duplicates skipped)
  health                    Source health check with circuit-breaker recovery
  proxies                   Show proxy pool (--check to health-check, --recover)
  scheduler [--once] [--interval MIN]   Run scheduled jobs
  auto                      Continuous auto-import from all sources with
                            CPU/RAM/GPU auto-throttling (--once, --interval MIN,
                            --limit N, --chapters latest-N|all, --rail latest|popular|both,
                             --sources mangafire,mangadex,mangakakalot)
  status                    Engine status (resources, adaptive workers, proxies,
                            cache, queue, circuit breakers, store)
`)
}

/**
 * Chapter count for a search/recommend result: exact from the library store
 * when already imported, otherwise the source's cheap API count (null when
 * it would need a full browser scrape).
 */
async function chapterCountFor(pipeline: Pipeline, t: RawTitle, inLib: boolean): Promise<number | null> {
  if (inLib) {
    let n = 0
    for (const c of pipeline.db.storeData.chapters) {
      if (c.source === t.source && c.series_id === t.slug) n += 1
    }
    return n
  }
  return pipeline.chapterCount(t.source, t.slug ?? '')
}

/**
 * Print a search/recommend result list (with chapter counts + in-library
 * marks) and let the user pick one to download ALL its chapters.
 */
async function showTitles(
  pipeline: Pipeline,
  titles: RawTitle[],
  label: string,
  failures: string[] = [],
): Promise<void> {
  const counts = await Promise.all(
    titles.map(async t => {
      const inLib =
        pipeline.db.hasTitle(t.source, t.slug ?? '') || pipeline.db.hasTitleByNormalizedName(t.title ?? '')
      return { inLib, count: await chapterCountFor(pipeline, t, inLib) }
    }),
  )
  console.log(`\n${titles.length} result(s) ${label}:\n`)
  const GREEN = '\x1b[32m'
  const YELLOW = '\x1b[33m'
  const DIM = '\x1b[2m'
  const RESET = '\x1b[0m'
  if (failures.length > 0) {
    console.log(`  ${YELLOW}[warn] ${failures.join(', ')}: request failed (proxies may need re-checking)${RESET}`)
  }
  for (let i = 0; i < titles.length; i++) {
    const t = titles[i]
    const c = counts[i]
    const chStr = c.count !== null && c.count !== undefined ? ` · ${c.count} chapters` : ''
    const mark = c.inLib ? `  ${GREEN}✓ in library${RESET}` : ''
    console.log(`  ${String(i + 1).padStart(2)}. ${t.title}${DIM}  [${t.type ?? '?'}]  (${t.source})${RESET}${chStr}${mark}`)
    if (t.genres?.length) console.log(`      ${DIM}genres: ${t.genres.slice(0, 6).join(', ')}${RESET}`)
    if (t.description) console.log(`      ${t.description.slice(0, 120)}${t.description.length > 120 ? '…' : ''}`)
    console.log(`      ${DIM}${t.sourceUrl ?? ''}${RESET}`)
  }
  await pickAndImport(pipeline, titles)
}

/** Prompt to pick one result and import ALL its chapters (duplicates skipped). */
async function pickAndImport(pipeline: Pipeline, titles: RawTitle[]): Promise<void> {
  if (titles.length === 0) return
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const pick = await new Promise<string>(resolve => {
      rl.question('\n  Pick a number to download ALL chapters (or press Enter to cancel): ', ans => {
        resolve(ans.trim())
      })
    })
    rl.close()
    if (!pick) return
    const idx = Number(pick) - 1
    if (idx < 0 || idx >= titles.length) {
      console.log('  Invalid pick.')
      return
    }
    const chosen = titles[idx]
    console.log(`\n[JUKU] importing ALL chapters of "${chosen.title}"...`)
    const bar = new Progress()
    const result = await pipeline.importTitle(chosen.source ?? 'mangadex', chosen.slug ?? chosen.title ?? '', {
      chapters: 'all',
      refresh: true,
      onProgress: (p: ImportProgress) => {
        if (p.stage === 'title') {
          bar.set(
            [
              {
                label: p.title ? `  ${p.title.slice(0, 24)}` : 'Chapter',
                current: p.done,
                total: p.total,
                suffix: `${p.pagesFound} pages${p.skippedChapters ? ` · ${p.skippedChapters} dupes skipped` : ''}`,
              },
            ],
            { pages: p.pagesFound, chapters: p.chaptersFound },
          )
        } else {
          bar.set(
            [{ label: 'Titles', current: p.done, total: p.total, suffix: `${p.chaptersFound} chapters · ${p.pagesFound} pages` }],
            { pages: p.pagesFound, chapters: p.chaptersFound, titles: p.done },
          )
        }
      },
      onNotice: (msg: string) => {
        if (bar.isEnabled) {
          bar.set([{ label: 'Dupes', current: 1, total: 1, suffix: msg.replace(/\[skip\] /, '') }])
        } else {
          console.log(msg)
        }
      },
    })
    bar.done()
    if (result.title) {
      console.log(`\n[JUKU] done: ${result.addedChapters} chapters, ${result.pages} pages → ${pipeline.config.outputFile}`)
    } else if (result.skippedTitle) {
      console.log('\n[JUKU] skipped: title already in library')
    } else {
      console.log('\n[JUKU] failed to import')
    }
  } catch (err) {
    rl.close()
    console.error('  Error:', err instanceof Error ? err.message : String(err))
  }
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error('\n[JUKU] fatal:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
