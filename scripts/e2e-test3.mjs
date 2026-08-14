/**
 * YOMIKAZE E2E round 3 — manhua library, genre filter, 404, reader modes, light mode.
 * Requires preview server on http://localhost:4173.
 */
import { writeFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:4173'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const consoleLogs = []
const report = {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })

function attach(page, tag) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleLogs.push(`[${tag}] ${msg.text()}`)
  })
}

/* --------- 1. /manhua library --------- */
{
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  attach(page, 'manhua')
  await page.goto(`${BASE}/manhua`, { waitUntil: 'domcontentloaded' })
  await sleep(10000)
  report.manhua = {
    heading: await page.evaluate(() => document.querySelector('main h1')?.innerText ?? null),
    cards: await page.$$eval('main a[href^="/title/"]', (els) => els.length),
    hasDragonVein: await page.evaluate(() => document.body.innerText.toLowerCase().includes('dragon vein')),
  }
  await page.close()
}

/* --------- 2. genre filter via URL --------- */
{
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  attach(page, 'genre')
  await page.goto(`${BASE}/manga?genre=Action`, { waitUntil: 'domcontentloaded' })
  await sleep(10000)
  // open the filters panel to confirm the chip state
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim().startsWith('Filters'))
    btn?.click()
  })
  await sleep(800)
  report.genreFilter = {
    actionChipActive: await page.evaluate(() =>
      [...document.querySelectorAll('button[aria-pressed="true"]')].some((b) => b.innerText.trim() === 'Action'),
    ),
    cards: await page.$$eval('main a[href^="/title/"]', (els) => els.length),
  }
  await page.close()
}

/* --------- 3. 404 page --------- */
{
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  attach(page, '404')
  await page.goto(`${BASE}/does-not-exist`, { waitUntil: 'domcontentloaded' })
  await sleep(1500)
  report.notFound = {
    has404: await page.evaluate(() => document.body.innerText.includes('404')),
    backHome: await page.evaluate(() => document.body.innerText.toUpperCase().includes('BACK HOME')),
    browseManga: await page.evaluate(() => document.body.innerText.toUpperCase().includes('BROWSE MANGA')),
  }
  await page.close()
}

/* --------- 4. reader vertical mode + fullscreen button --------- */
{
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  attach(page, 'reader-modes')
  await page.goto(`${BASE}/reader/demo:dragon-vein/demo:dragon-vein:ch2`, { waitUntil: 'domcontentloaded' })
  await sleep(3500)
  // open settings
  await page.evaluate(() => document.querySelector('button[aria-label="Reader settings"]')?.click())
  await sleep(500)
  const settings = await page.evaluate(() => document.body.innerText.toUpperCase().includes('VERTICAL SCROLL'))
  // switch to vertical
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter((b) =>
      b.innerText.toUpperCase().includes('VERTICAL SCROLL'),
    )
    btns[0]?.click()
  })
  await sleep(800)
  const verticalImages = await page.$$eval('img', (els) => els.filter((i) => i.src.includes('/demo/')).length)
  const fsBtn = await page.evaluate(() => !!document.querySelector('button[aria-label="Enter fullscreen"], button[aria-label*="fullscreen"]'))
  report.readerModes = { settings, verticalImages, fsBtn }
  await page.close()
}

/* --------- 5. light mode visual spot check --------- */
{
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  attach(page, 'light')
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await sleep(4000)
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Switch to light mode"]')
    btn?.click()
  })
  await sleep(800)
  report.light = {
    darkClassGone: await page.evaluate(() => !document.documentElement.classList.contains('dark')),
    bodyBg: await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  }
  await page.close()
}

await browser.close()
report.consoleErrors = [...new Set(consoleLogs)]
writeFileSync('e2e-shots/report3.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
