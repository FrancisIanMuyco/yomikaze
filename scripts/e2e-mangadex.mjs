/**
 * YOMIKAZE E2E — MangaDex provider flow (real chapter images).
 * Requires preview server on http://localhost:4173 (default build).
 */
import { writeFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:4173'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const consoleLogs = []
const pageErrors = []
const report = {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
function attach(page, tag) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleLogs.push(`[${tag}] ${msg.text()}`)
  })
  page.on('pageerror', (err) => pageErrors.push(`[${tag}] ${err.message}`))
}

/* --------- 1. Homepage (MangaDex content) --------- */
{
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  attach(page, 'home')
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await sleep(12000)
  report.home = {
    heroTitle: await page.evaluate(() => document.querySelector('main h1')?.innerText ?? null),
    sections: await page.evaluate(() =>
      ['Trending Manga', 'Popular Right Now', 'Latest Updates'].every((s) => document.body.innerText.includes(s)),
    ),
    cards: await page.$$eval('main a[href^="/title/"]', (els) => els.length),
    noDemoBadge: await page.evaluate(() => !document.body.innerText.toUpperCase().includes('DEMO READER')),
  }
  await page.close()
}

/* --------- 2. Search → find a title with readable chapters --------- */
let readerTest = null
{
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  attach(page, 'search')
  await page.goto(`${BASE}/search?q=chainsaw%20man`, { waitUntil: 'domcontentloaded' })
  await sleep(7000)
  const hrefs = await page.$$eval('main a[href^="/title/"]', (els) =>
    els.slice(0, 8).map((el) => el.getAttribute('href')),
  )
  report.search = {
    query: 'chainsaw man',
    resultLinks: hrefs.length,
    found: await page.evaluate(() => document.body.innerText.toLowerCase().includes('chainsaw man')),
  }
  await page.close()

  // iterate: open each title, count chapters, open first readable chapter
  for (const href of hrefs ?? []) {
    const p = await browser.newPage()
    await p.setViewport({ width: 1280, height: 900 })
    attach(p, 'detail')
    await p.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' })
    await sleep(5000)
    const title = await p.evaluate(() => document.querySelector('main h1')?.innerText ?? null)
    const chapters = await p.$$eval('main li a[href^="/reader/"]', (els) => els.length)
    const noReadOfficially = await p.evaluate(() => !document.body.innerText.toUpperCase().includes('READ OFFICIALLY'))
    if (chapters > 0) {
      // Prefer a chapter whose row shows a page count (hosted on MangaDex).
      const chapterHref = await p.evaluate(() => {
        const rows = [...document.querySelectorAll('main li a[href^="/reader/"]')]
        const real = rows.find((el) => /\d+ pages/i.test(el.innerText))
        return (real ?? rows[0]).getAttribute('href')
      })
      report.detail = { title, chapters, noReadOfficially, picked: href }
      await p.close()

      const r = await browser.newPage()
      await r.setViewport({ width: 1280, height: 900 })
      attach(r, 'reader')
      await r.goto(`${BASE}${chapterHref}`, { waitUntil: 'domcontentloaded' })
      await sleep(10000) // MangaDex At-Home images
      const img = await r.evaluate(() => {
        const el = document.querySelector('img[alt^="MangaDex"], main img, .page-in img')
        if (!el) return null
        return { src: el.src.slice(0, 90), naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight }
      })
      const counter = await r.evaluate(() => document.body.innerText.match(/\d+ \/ \d+/)?.[0] ?? null)
      const credit = await r.evaluate(() => document.body.innerText.includes('Chapter pages via MangaDex'))
      report.reader = { url: chapterHref, counter, img, credit, pageAdvance: null }
      const nextBtn = await r.$('footer button[aria-label="Next page"]')
      if (nextBtn) {
        await nextBtn.click()
        await sleep(1500)
        report.reader.pageAdvance = await r.evaluate(() => document.body.innerText.match(/\d+ \/ \d+/)?.[0] ?? null)
      }
      await r.close()
      break
    } else {
      report.detail = { title, chapters, skipped: 'no readable chapters' }
      await p.close()
    }
  }
}

await browser.close()
report.consoleErrors = [...new Set(consoleLogs)]
report.pageErrors = [...new Set(pageErrors)]
writeFileSync('e2e-shots/mangadex-report.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
