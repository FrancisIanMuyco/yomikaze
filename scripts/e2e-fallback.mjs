/**
 * Verifies the hybrid provider fallback: with AniList unreachable,
 * the home page must still render demo content (no error screen).
 * Requires preview server on http://localhost:4173 serving a build
 * made with VITE_ANILIST_ENDPOINT pointing at a dead URL.
 */
import { writeFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:4173'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const consoleLogs = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleLogs.push(msg.text())
})

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
await sleep(10000)

const report = {
  heroTitle: await page.evaluate(() => document.querySelector('main h1')?.innerText ?? null),
  noErrorState: await page.evaluate(() => !document.body.innerText.includes('Could not load content')),
  demoTitleVisible: await page.evaluate(() => document.body.innerText.includes('Kagemusha')),
  cards: await page.$$eval('main a[href^="/title/"]', (els) => els.length),
  demoBadge: await page.evaluate(() => document.body.innerText.toUpperCase().includes('DEMO READER')),
  consoleErrors: [...new Set(consoleLogs)],
}
writeFileSync('e2e-shots/fallback-report.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()
