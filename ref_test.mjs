import { chromium } from 'playwright'

const IMG = 'https://k99.mfcdn2.xyz/mf/12a3db61fa0e4f41a6cc794d81a7e8069135a14754bba1b34b5a37edf329c58d235ddf1e496423eaff35/h/p.jpg'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()

// 1) fetch() with custom referrer + unsafe-url policy
const r1 = await page.evaluate(async (url) => {
  try {
    const res = await fetch(url, {
      referrer: 'https://mangafire.to/',
      referrerPolicy: 'unsafe-url',
    })
    return { status: res.status, type: res.type, len: (await res.blob()).size }
  } catch (e) {
    return { error: String(e) }
  }
}, IMG)
console.log('fetch custom referrer:', JSON.stringify(r1))

// 2) plain <img> without any referrer manipulation
const r2 = await page.evaluate(async (url) => {
  return await new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ ok: true, w: img.naturalWidth })
    img.onerror = () => resolve({ ok: false })
    img.src = url
    setTimeout(() => resolve({ ok: false, timeout: true }), 15000)
  })
}, IMG)
console.log('plain img:', JSON.stringify(r2))

await browser.close()
