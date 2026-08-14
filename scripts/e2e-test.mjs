/**
 * YOMIKAZE E2E smoke test (uses system Chrome via puppeteer-core).
 * Run with the preview server on http://localhost:4173.
 *
 *   node scripts/e2e-test.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:4173'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const SHOT_DIR = 'e2e-shots'
mkdirSync(SHOT_DIR, { recursive: true })

const consoleLogs = []
const pageErrors = []
const failedRequests = []

const report = {}
let browser

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function capture(page, name) {
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`), fullPage: false })
}

async function text(page, selector) {
  try {
    return await page.$eval(selector, (el) => (el.innerText ?? '').trim().slice(0, 300))
  } catch {
    return null
  }
}

function attach(page, tag) {
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') consoleLogs.push(`[${tag}] ${msg.type()}: ${msg.text()}`)
  })
  page.on('pageerror', (err) => pageErrors.push(`[${tag}] ${err.message}`))
  page.on('requestfailed', (req) => failedRequests.push(`[${tag}] ${req.url()} :: ${req.failure()?.errorText ?? ''}`))
}

try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })

  /* ------------------------------ 1. Home ------------------------------ */
  {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    attach(page, 'home')
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await sleep(12000) // allow AniList fetches

    report.home = {
      title: await page.title(),
      heroTitle: await text(page, 'main h1'),
      hasStartReading: !!(await page.$('main h1')) && (await page.evaluate(() => document.body.innerText.includes('START READING'))),
      hasViewDetails: await page.evaluate(() => document.body.innerText.includes('VIEW DETAILS')),
      sections: {
        trendingManga: await page.evaluate(() => document.body.innerText.includes('Trending Manga')),
        trendingManhua: await page.evaluate(() => document.body.innerText.includes('Trending Manhua')),
        popular: await page.evaluate(() => document.body.innerText.includes('Popular Right Now')),
        latest: await page.evaluate(() => document.body.innerText.includes('Latest Updates')),
        genres: await page.evaluate(() => document.body.innerText.includes('Popular Genres')),
      },
      demoBadge: await page.evaluate(() => document.body.innerText.toUpperCase().includes('DEMO READER')),
      cardCount: await page.$$eval('main a[href^="/title/"]', (els) => els.length),
    }
    await capture(page, 'home')
    await page.close()
  }

  /* -------------------- 2. Demo title detail + reader -------------------- */
  let readerUrl = null
  {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    attach(page, 'detail')
    await page.goto(`${BASE}/title/demo:kagemusha`, { waitUntil: 'domcontentloaded' })
    await sleep(2000)

    report.detail = {
      title: await text(page, 'main h1'),
      hasDescription: await page.evaluate(() => document.body.innerText.includes('shadow warrior') || document.body.innerText.length > 400),
      startReadingBtn: await page.evaluate(() => document.body.innerText.includes('START READING')),
      chapters: await page.$$eval('main li a[href^="/reader/"]', (els) => els.length),
      demoBadge: await page.evaluate(() => document.body.innerText.toUpperCase().includes('DEMO READER')),
    }
    await capture(page, 'detail')

    // Open reader via first chapter link
    const href = await page.$eval('main li a[href^="/reader/"]', (el) => el.getAttribute('href'))
    readerUrl = href
    await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' })
    await sleep(3500)
    await capture(page, 'reader-1')

    const imgState = await page.evaluate(() => {
      const img = document.querySelector('main img, .page-in img, div[class*="overflow"] img')
      if (!img) return { found: false }
      return { found: true, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, src: img.src.slice(-40) }
    })

    const pageCounter = await text(page, 'footer') ?? await page.evaluate(() => document.body.innerText.match(/Page \d+ \/ \d+/)?.[0] ?? null)

    report.reader = { url: readerUrl, pageCounter, imgState }
    report.reader.pageAdvance = false

    // Click next page (bottom bar right arrow)
    const nextBtn = await page.$('footer button[aria-label="Next page"]')
    if (nextBtn) {
      await nextBtn.click()
      await sleep(800)
      const counter2 = await page.evaluate(() => document.body.innerText.match(/Page \d+ \/ \d+/)?.[0] ?? null)
      report.reader.pageAdvance = counter2
    }

    // Chapter drawer
    await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Chapter list"]')
      btn?.click()
    })
    await sleep(600)
    report.reader.chapterDrawer = await page.evaluate(() => document.body.innerText.includes('Chapters') && document.body.innerText.toUpperCase().includes('READING'))
    await capture(page, 'reader-drawer')
    await page.close()
  }

  /* --------------------------- 3. Library page --------------------------- */
  {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    attach(page, 'library')
    await page.goto(`${BASE}/manga`, { waitUntil: 'domcontentloaded' })
    await sleep(10000)
    report.library = {
      heading: await text(page, 'main h1'),
      cards: await page.$$eval('main a[href^="/title/"]', (els) => els.length),
      searchBox: !!(await page.$('input[type="search"]')),
      sortSelect: !!(await page.$('select')),
      filtersBtn: await page.evaluate(() => document.body.innerText.includes('Filters')),
    }
    await capture(page, 'library')
    await page.close()
  }

  /* ------------------------------ 4. Search ------------------------------ */
  {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    attach(page, 'search')
    await page.goto(`${BASE}/search?q=dragon`, { waitUntil: 'domcontentloaded' })
    await sleep(6000)
    report.search = {
      hasResults: await page.evaluate(() => document.body.innerText.includes('results for')),
      resultCount: await page.$$eval('main a[href^="/title/"]', (els) => els.length),
      dragonFound: await page.evaluate(() => document.body.innerText.toLowerCase().includes('dragon vein')),
    }
    await capture(page, 'search')
    await page.close()
  }

  /* ------------------------- 5. Mobile layout ------------------------- */
  {
    const page = await browser.newPage()
    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true })
    attach(page, 'mobile')
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await sleep(9000)
    report.mobile = {
      bottomTabs: await page.evaluate(() => ['Home', 'Manga', 'Manhua', 'Shelf', 'Menu'].every((t) => document.body.innerText.includes(t))),
      horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
      scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth),
      viewport: await page.evaluate(() => window.innerWidth),
    }
    await capture(page, 'mobile')
    await page.close()
  }

  /* ------------------------------ 6. Theme ------------------------------ */
  {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    attach(page, 'theme')
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await sleep(2000)
    const before = await page.evaluate(() => document.documentElement.classList.contains('dark'))
    await page.click('button[aria-label*="light mode"], button[aria-label*="dark mode"]')
    await sleep(700)
    const after = await page.evaluate(() => document.documentElement.classList.contains('dark'))
    report.theme = { before, after }
    await page.close()
  }
} catch (err) {
  report.fatal = String(err)
} finally {
  if (browser) await browser.close()
}

report.consoleErrors = [...new Set(consoleLogs)].slice(0, 25)
report.pageErrors = [...new Set(pageErrors)].slice(0, 15)
report.failedRequests = [...new Set(failedRequests)].slice(0, 15)

writeFileSync(join(SHOT_DIR, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
