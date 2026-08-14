/**
 * YOMIKAZE E2E round 2 — unavailable chapter state + reading progress resume.
 * Requires preview server on http://localhost:4173.
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

/* --------- 1. AniList chapter -> unavailable state (spec 18) --------- */
{
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  attach(page, 'anilist')
  // One Piece (105778) is a popular AniList title
  await page.goto(`${BASE}/title/105778`, { waitUntil: 'domcontentloaded' })
  await sleep(12000)
  report.anilistDetail = {
    title: await page.evaluate(() => document.querySelector('main h1')?.innerText ?? null),
    chapterRows: await page.$$eval('main li a[href^="/reader/"]', (els) => els.length),
    readOfficially: await page.evaluate(() => document.body.innerText.includes('Read Officially')),
  }
  const href = await page.$eval('main li a[href^="/reader/"]', (el) => el.getAttribute('href'))
  await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' })
  await sleep(3000)
  report.unavailable = {
    message: await page.evaluate(() => document.body.innerText.includes('Chapter content unavailable')),
    backToTitle: await page.evaluate(() => document.body.innerText.includes('Back to title')),
    authorizedLink: await page.evaluate(() => document.body.innerText.includes('Read from authorized source')),
    blankScreen: await page.evaluate(() => document.body.innerText.trim().length < 50),
  }
  await page.close()
}

/* --------- 2. Reading progress resume (spec 24) --------- */
{
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  attach(page, 'resume')
  // fresh state — clear once, not on every navigation
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${BASE}/reader/demo:kagemusha/demo:kagemusha:ch1`, { waitUntil: 'domcontentloaded' })
  await sleep(3500)
  const counter1 = await page.evaluate(() => document.body.innerText.match(/Page \d+ \/ \d+/)?.[0] ?? document.body.innerText.match(/\d+ \/ \d+ · \d+%/)?.[0] ?? null)
  // go to page 3
  for (let i = 0; i < 2; i += 1) {
    await page.click('footer button[aria-label="Next page"]')
    await sleep(400)
  }
  const counter2 = await page.evaluate(() => document.body.innerText.match(/\d+ \/ \d+/)?.[0] ?? null)
  // leave and come back
  await page.goto(`${BASE}/title/demo:kagemusha`, { waitUntil: 'domcontentloaded' })
  await sleep(2500)
  await page.goto(`${BASE}/reader/demo:kagemusha/demo:kagemusha:ch1`, { waitUntil: 'domcontentloaded' })
  await sleep(3500)
  const counter3 = await page.evaluate(() => document.body.innerText.match(/\d+ \/ \d+/)?.[0] ?? null)
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('yomikaze:progress')
    try {
      return raw ? JSON.parse(raw) : null
    } catch {
      return raw
    }
  })
  report.resume = { counter1, counter2, counter3, resumedToPage3: counter3 === '3 / 6', stored }
  await page.close()
}

/* --------- 3. Continue Reading on home (uses history snapshot) --------- */
{
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  attach(page, 'continue')
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await sleep(6000)
  report.continueReading = await page.evaluate(() => document.body.innerText.includes('Continue Reading'))
  await page.close()
}

await browser.close()

report.consoleErrors = [...new Set(consoleLogs)]
report.pageErrors = [...new Set(pageErrors)]
writeFileSync('e2e-shots/report2.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
