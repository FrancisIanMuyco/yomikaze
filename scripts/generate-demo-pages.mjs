/**
 * YOMIKAZE — demo page generator.
 *
 * Generates ORIGINAL, deterministic SVG artwork for the Demo Reader:
 *   3 titles × 3 chapters × 6 pages, plus cover + banner per title.
 *
 * All artwork is created here from scratch (abstract, manga-inspired
 * compositions). Nothing is copied from any licensed manga.
 *
 * Usage:  node scripts/generate-demo-pages.mjs
 * Output: public/demo/<slug>/**​/*.svg
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'demo')
const W = 800
const H = 1200

/* ---------------- seeded PRNG so output is deterministic ---------------- */
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------ helpers ------------------------------ */
const serif = `font-family="'Noto Serif JP','Hiragino Mincho ProN',Georgia,serif"`
const mono = `font-family="'Inter',ui-sans-serif,system-ui,sans-serif"`

function round(n) {
  return Math.round(n * 100) / 100
}

function defs(palette) {
  return `<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${palette.bg[0]}"/>
    <stop offset="1" stop-color="${palette.bg[1]}"/>
  </linearGradient>
  <linearGradient id="moonG" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${palette.moon[0]}"/>
    <stop offset="1" stop-color="${palette.moon[1]}"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="${palette.accent}" stop-opacity="0.5"/>
    <stop offset="1" stop-color="${palette.accent}" stop-opacity="0"/>
  </radialGradient>
  <pattern id="halftone" width="14" height="14" patternUnits="userSpaceOnUse">
    <circle cx="4" cy="4" r="2.6" fill="${palette.ink[1]}" opacity="0.55"/>
  </pattern>
  <clipPath id="pageClip"><rect width="${W}" height="${H}"/></clipPath>
</defs>`
}

function footer(titleLine, chapterLabel, pageNumber) {
  const label = `DEMO READER — ${chapterLabel} · PAGE ${pageNumber}`
  return `
  <g ${mono} font-size="15" fill="#8a8a94" letter-spacing="2">
    <text x="40" y="${H - 46}">${label}</text>
    <text x="${W - 40}" y="${H - 46}" text-anchor="end" font-size="13" fill="#5c5c66">YOMIKAZE</text>
    <text x="40" y="${H - 24}" font-size="12" fill="#55555e">${titleLine} — original artwork</text>
  </g>
  <g ${mono} font-size="17" fill="#f2f2f5" opacity="0.92" letter-spacing="4">
    <text x="40" y="${H - 66}">${String(pageNumber).padStart(2, '0')}</text>
  </g>`
}

function watermark(kanji) {
  return `<g opacity="0.05" ${serif} font-size="300" font-weight="900">
    <text x="${W / 2}" y="${H / 2 + 100}" text-anchor="middle" fill="#ffffff">${kanji}</text>
  </g>`
}

function speedLines(cx, cy, color, seed, spread = 640) {
  const rnd = mulberry32(seed)
  const lines = []
  const count = 26
  for (let i = 0; i < count; i += 1) {
    const angle = rnd() * Math.PI * 2
    const len = 80 + rnd() * 240
    const x1 = cx + Math.cos(angle) * (10 + rnd() * 30)
    const y1 = cy + Math.sin(angle) * (10 + rnd() * 30)
    const x2 = cx + Math.cos(angle) * (spread + rnd() * 300)
    const y2 = cy + Math.sin(angle) * (spread + rnd() * 300)
    lines.push(
      `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${color}" stroke-width="${0.8 + rnd() * 1.6}" opacity="${0.25 + rnd() * 0.4}"/>`,
    )
  }
  return `<g stroke-linecap="round">${lines.join('')}</g>`
}

function mountains(baseline, palette, seed, amp = 240) {
  const rnd = mulberry32(seed)
  const layers = []
  const layersN = 3
  for (let l = 0; l < layersN; l += 1) {
    const yBase = baseline - l * 70
    const color = palette.ink[l % palette.ink.length]
    let d = `M0 ${yBase}`
    let x = 0
    while (x < W) {
      const w = 160 + rnd() * 220
      const peak = yBase - (amp / (l + 1)) * (0.55 + rnd() * 0.6)
      d += ` L${round(x + w / 2)} ${round(peak)} L${round(x + w)} ${round(yBase)}`
      x += w
    }
    d += ` L${W} ${H} L0 ${H} Z`
    layers.push(`<path d="${d}" fill="${color}" opacity="${0.85 + l * 0.08}"/>`)
  }
  return layers.join('')
}

function waves(y, palette, seed, amp = 60) {
  const rnd = mulberry32(seed)
  let d = `M0 ${y}`
  let x = 0
  while (x < W) {
    const w = 90 + rnd() * 120
    const peak = y - amp * (0.4 + rnd() * 0.7)
    d += ` Q${round(x + w / 2)} ${round(peak)} ${round(x + w)} ${y}`
    x += w
  }
  d += ` L${W} ${H} L0 ${H} Z`
  return `<path d="${d}" fill="${palette.ink[1]}" opacity="0.9"/>`
}

function moon(x, y, r, palette, glow = true) {
  return `${glow ? `<circle cx="${x}" cy="${y}" r="${r * 1.7}" fill="url(#glow)"/>` : ''}
  <circle cx="${x}" cy="${y}" r="${r}" fill="url(#moonG)" opacity="0.96"/>`
}

function kanjiGlyph(ch, x, y, size, fill) {
  return `<text x="${x}" y="${y}" text-anchor="middle" ${serif} font-size="${size}" font-weight="900" fill="${fill}">${ch}</text>`
}

/* ------------------------------ palettes ------------------------------ */
const PALETTES = {
  kagemusha: {
    bg: ['#241419', '#0a0608'],
    moon: ['#f2e3c2', '#c79a6b'],
    ink: ['#1a0f12', '#3a1b1f', '#5c2a2e'],
    accent: '#b3222f',
    accent2: '#c9a05f',
    kanji: ['月', '影', '侍', '闘'],
  },
  'dragon-vein': {
    bg: ['#0c2b23', '#04100c'],
    moon: ['#f4e8be', '#c4a35a'],
    ink: ['#0f3a2f', '#1d5c4a', '#2e8063'],
    accent: '#3fae7f',
    accent2: '#d4af37',
    kanji: ['龍', '山', '気', '天'],
  },
  'neon-afterlight': {
    bg: ['#170a24', '#040209'],
    moon: ['#ff2e97', '#7a1f6e'],
    ink: ['#241038', '#3a1b52', '#51226e'],
    accent: '#00e5ff',
    accent2: '#ff2e97',
    kanji: ['夜', '電', '幻', '終'],
  },
}

/* ------------------------------ motifs ------------------------------ */
const MOTIFS = {
  kagemusha: {
    ch1: (p) => `${mountains(700, p, 11)}<path d="M0 760 Q400 640 800 760 L800 1200 L0 1200 Z" fill="#000"/>`,
    ch2: (p) => {
      const castle = `
        <g fill="#0b0608">
          <rect x="210" y="560" width="380" height="260"/>
          <path d="M180 560 L400 430 L620 560 Z"/>
          <rect x="250" y="520" width="60" height="300"/>
          <rect x="490" y="520" width="60" height="300"/>
          <path d="M160 560 h40 v40 h-40 z M600 560 h40 v40 h-40 z" fill="${p.accent}"/>
        </g>
        <g fill="#0d0709">${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M${320 + i * 30} 520 q6 -12 14 -14 q-8 -8 -18 -4 q-6 6 -2 14 z"/>`).join('')}</g>`
      return castle
    },
    ch3: (p) => `
      <g stroke="${p.accent}" stroke-width="16" stroke-linecap="round" opacity="0.9">
        <line x1="180" y1="760" x2="620" y2="340" transform="rotate(-8 400 550)"/>
        <line x1="180" y1="340" x2="620" y2="760" transform="rotate(8 400 550)"/>
      </g>
      <g stroke="${p.accent2}" stroke-width="5" stroke-linecap="round" opacity="0.8">
        ${Array.from({ length: 9 }, (_, i) => `<line x1="${120 + i * 70}" y1="200" x2="${120 + i * 70}" y2="${880 + (i % 3) * 40}" />`).join('')}
      </g>`,
  },
  'dragon-vein': {
    ch1: (p) => `
      ${mountains(820, p, 21, 200)}
      <path d="M400 480 q-40 -70 20 -90 q60 -16 40 -70 q-10 -30 -45 -30 q60 -14 80 20 q30 46 -30 70 q-20 10 -30 30 z" fill="${p.accent}" opacity="0.9"/>
      <circle cx="420" cy="300" r="7" fill="${p.accent2}"/>`,
    ch2: (p) => `
      <g fill="#0a241c">
        <rect x="300" y="520" width="200" height="300"/>
        <path d="M260 520 Q400 420 540 520 Z"/>
        <path d="M260 520 h44 v36 h-44 z M496 520 h44 v36 h-44 z" fill="${p.accent}"/>
      </g>
      <polyline points="430,180 380,320 470,360 330,560" fill="none" stroke="${p.accent2}" stroke-width="9" stroke-linejoin="round" opacity="0.95"/>`,
    ch3: (p) => `
      ${waves(560, p, 31, 46)}
      <path d="M400 480 q-50 -90 10 -120 q60 -28 46 -96 q-6 -30 -40 -34 q80 -14 96 28 q26 60 -40 94 q-24 12 -36 34 z" fill="${p.accent}"/>
      <g stroke="${p.accent2}" stroke-width="4" opacity="0.8">
        ${Array.from({ length: 7 }, (_, i) => `<line x1="${200 + i * 70}" y1="${210 + i * 8}" x2="${200 + i * 70}" y2="${160 + i * 14}" />`).join('')}
      </g>`,
  },
  'neon-afterlight': {
    ch1: (p) => {
      const rnd = mulberry32(41)
      const rects = []
      for (let i = 0; i < 16; i += 1) {
        const bw = 34 + rnd() * 60
        const bh = 120 + rnd() * 260
        const x = 40 + i * 46
        const y = 780 - bh * 0.5
        const win = Math.floor(rnd() * 6)
        let wincells = ''
        for (let w = 0; w < win; w += 1) {
          wincells += `<rect x="${x + 6 + (w % 3) * 12}" y="${y + 40 + Math.floor(w / 3) * 30}" width="7" height="18" fill="${w % 2 ? p.accent : p.accent2}" opacity="0.9"/>`
        }
        rects.push(`<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="${p.ink[i % 3]}" stroke="${p.accent}" stroke-opacity="0.35" stroke-width="2"/>${wincells}`)
      }
      return `${rects.join('')}
      <g stroke="#9be8ff" stroke-width="2.4" opacity="0.5">
        ${Array.from({ length: 24 }, (_, i) => `<line x1="${(i * 37) % 800}" y1="0" x2="${(i * 37) % 800 - 14}" y2="900" />`).join('')}
      </g>
      <circle cx="660" cy="200" r="120" fill="none" stroke="${p.accent2}" stroke-width="3" opacity="0.6"/>`
    },
    ch2: (p) => `
      <g fill="none" stroke="${p.accent}" stroke-width="3" opacity="0.75">
        ${Array.from({ length: 8 }, (_, i) => `<path d="M${90 + i * 90} 760 h${40 + (i % 3) * 22} v-${70 + i * 26} h${30 + (i % 2) * 18} v-${50 + i * 18} h${36}" />`).join('')}
      </g>
      <g stroke="${p.accent2}" stroke-width="8" opacity="0.85">
        ${[0, 1, 2, 3, 4].map((i) => `<line x1="${220 + i * 90}" y1="${430 + i * 6}" x2="${220 + i * 90}" y2="${300 + i * 26}" />`).join('')}
      </g>
      <circle cx="400" cy="520" r="86" fill="${p.ink[2]}" stroke="${p.accent}" stroke-width="4"/>
      <circle cx="400" cy="520" r="30" fill="${p.accent}"/>`,
    ch3: (p) => `
      <circle cx="400" cy="400" r="150" fill="url(#moonG)" opacity="0.9"/>
      <rect x="380" y="560" width="40" height="300" fill="${p.ink[2]}"/>
      <path d="M360 560 h80 l-16 -60 h-48 z" fill="${p.ink[1]}"/>
      <g fill="none" stroke="${p.accent}" stroke-width="5" opacity="0.85">
        <path d="M400 300 q40 -26 0 -52 q-40 -26 0 -52 q40 -26 0 -52"/>
      </g>
      <g fill="${p.accent2}">
        ${Array.from({ length: 10 }, (_, i) => `<rect x="${40 + i * 76}" y="${780 + (i % 3) * 26}" width="34" height="${10 + (i % 2) * 6}" opacity="0.8"/>`).join('')}
      </g>`,
  },
}

/* ------------------------------ layouts ------------------------------ */
function layout0(palette, motif, kanji, seed) {
  const rnd = mulberry32(seed)
  const r = 150 + rnd() * 40
  const mx = 240 + rnd() * 220
  const my = 220 + rnd() * 60
  return `
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  ${watermark(kanji)}
  ${moon(mx, my, r, palette)}
  ${speedLines(mx, my, palette.accent, seed)}
  ${motif}
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#halftone)" opacity="0.14"/>
  <rect width="${W}" height="${H}" fill="none" stroke="${palette.accent}" stroke-width="3" opacity="0.5"/>`
}

function layout1(palette, motif, kanji, seed) {
  const rnd = mulberry32(seed)
  const horizon = 560 + rnd() * 120
  return `
  <rect width="${W}" height="${H}" fill="${palette.bg[1]}"/>
  <rect x="34" y="34" width="${W - 68}" height="${H - 68}" fill="url(#sky)" stroke="${palette.accent2}" stroke-width="3"/>
  <rect x="46" y="46" width="${W - 92}" height="${H - 92}" fill="none" stroke="${palette.accent}" stroke-width="1.5" opacity="0.6"/>
  ${moon(W / 2, 220 + rnd() * 60, 130, palette)}
  ${speedLines(W / 2, horizon, palette.accent, seed, 520)}
  <g clip-path="url(#pageClip)">
    <rect x="46" y="${horizon}" width="${W - 92}" height="${H - horizon - 100}" fill="${palette.ink[0]}"/>
    ${motif}
  </g>
  ${watermark(kanji)}`
}

function layout2(palette, motif, kanji, seed) {
  const rnd = mulberry32(seed)
  const angle = 62 + rnd() * 18
  return `
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <rect x="0" y="0" width="${W}" height="${H}" fill="${palette.ink[0]}" opacity="0.86" clip-path="url(#pageClip)"/>
  <polygon points="0,0 ${W},0 ${W},${H * 0.52} 0,${H * 0.72}" fill="url(#sky)"/>
  <polygon points="0,${H * 0.72} ${W},${H * 0.52} ${W},${H} 0,${H}" fill="${palette.ink[1]}" opacity="0.9"/>
  <g transform="rotate(${angle} 400 600)">
    <line x1="400" y1="120" x2="400" y2="1080" stroke="${palette.accent2}" stroke-width="3" opacity="0.7"/>
    <line x1="330" y1="240" x2="470" y2="240" stroke="${palette.accent}" stroke-width="3" opacity="0.7"/>
  </g>
  ${moon(600, 240, 150, palette)}
  ${watermark(kanji)}
  ${motif}`
}

function layout3(palette, motif, kanji, seed) {
  const rnd = mulberry32(seed)
  const cx = 340 + rnd() * 120
  const cy = 480 + rnd() * 120
  return `
  <rect width="${W}" height="${H}" fill="${palette.bg[1]}"/>
  ${speedLines(cx, cy, palette.accent2, seed, 700)}
  <circle cx="${cx}" cy="${cy}" r="200" fill="url(#moonG)"/>
  <circle cx="${cx}" cy="${cy}" r="150" fill="${palette.ink[1]}"/>
  ${watermark(kanji)}
  ${motif}`
}

function layout4(palette, motif, kanji, seed) {
  const rnd = mulberry32(seed)
  const y = 500 + rnd() * 80
  return `
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <rect x="0" y="0" width="${W}" height="${y}" fill="url(#halftone)" opacity="0.35"/>
  <rect x="0" y="${y}" width="${W}" height="${H - y}" fill="${palette.ink[0]}"/>
  ${moon(W / 2, 260, 140, palette)}
  ${waves(y + 120, palette, seed + 1)}
  ${watermark(kanji)}
  ${motif}`
}

function layout5(palette, motif, kanji, seed) {
  const rnd = mulberry32(seed)
  return `
  <rect width="${W}" height="${H}" fill="${palette.bg[1]}"/>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#sky)" opacity="0.9"/>
  ${kanjiGlyph(kanji, W / 2, 430, 360, palette.accent)}
  <rect x="140" y="520" width="${W - 280}" height="6" fill="${palette.accent2}" opacity="0.8"/>
  ${speedLines(W / 2, 480, palette.accent, seed, 620)}
  ${watermark(kanji)}
  ${motif}`
}

const LAYOUTS = [layout0, layout1, layout2, layout3, layout4, layout5]

/* ------------------------------ titles ------------------------------ */
const TITLES = [
  {
    slug: 'kagemusha',
    name: 'Kagemusha: Moon Shadow',
    subtitle: '影武者・月影',
    chapterLabels: ['Chapter 1 — The Ronin', 'Chapter 2 — Blood Moon', 'Chapter 3 — The Duel'],
  },
  {
    slug: 'dragon-vein',
    name: 'Dragon Vein',
    subtitle: '龙脉',
    chapterLabels: ['Chapter 1 — Awakening', 'Chapter 2 — The Trial', 'Chapter 3 — Ascension'],
  },
  {
    slug: 'neon-afterlight',
    name: 'Neon Afterlight',
    subtitle: 'ネオン残光',
    chapterLabels: ['Chapter 1 — Glitch City', 'Chapter 2 — Ghost Protocol', 'Chapter 3 — Last Signal'],
  },
]

/* ------------------------------ builders ------------------------------ */
function buildPage(t, chIndex, pageNumber) {
  const palette = PALETTES[t.slug]
  const motif = MOTIFS[t.slug][`ch${chIndex + 1}`](palette)
  const kanji = palette.kanji[(pageNumber + chIndex) % palette.kanji.length]
  const seed = t.slug.length * 131 + chIndex * 79 + pageNumber * 23
  const layout = LAYOUTS[(pageNumber - 1) % LAYOUTS.length]
  const body = layout(palette, motif, kanji, seed)
  const titleLine = `${t.name} · ${t.chapterLabels[chIndex]}`
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${titleLine} — page ${pageNumber}">
  ${defs(palette)}
  <g clip-path="url(#pageClip)">${body}</g>
  ${footer(titleLine, t.chapterLabels[chIndex], pageNumber)}
</svg>
`
}

function buildCover(t) {
  const palette = PALETTES[t.slug]
  const kanji = t.slug === 'dragon-vein' ? '龍' : t.slug === 'neon-afterlight' ? '夜' : '月'
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${t.name} cover">
  ${defs(palette)}
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  ${speedLines(400, 620, palette.accent, 777, 760)}
  ${moon(600, 240, 170, palette)}
  <rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="${palette.accent2}" stroke-width="3"/>
  <rect x="52" y="52" width="${W - 104}" height="${H - 104}" fill="none" stroke="${palette.accent}" stroke-width="1.5" opacity="0.7"/>
  ${kanjiGlyph(kanji, W / 2, 560, 300, palette.accent)}
  <text x="${W / 2}" y="700" text-anchor="middle" ${serif} font-size="44" font-weight="900" fill="#ffffff" letter-spacing="2">${t.name}</text>
  <text x="${W / 2}" y="748" text-anchor="middle" ${mono} font-size="20" fill="${palette.accent2}" letter-spacing="6">${t.subtitle}</text>
  <rect x="${W / 2 - 90}" y="800" width="180" height="3" fill="${palette.accent2}"/>
  <text x="${W / 2}" y="1060" text-anchor="middle" ${mono} font-size="15" fill="#8a8a94" letter-spacing="4">YOMIKAZE DEMO</text>
</svg>
`
}

function buildBanner(t) {
  const palette = PALETTES[t.slug]
  const kanji = palette.kanji[0]
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 400" width="1600" height="400" role="img" aria-label="${t.name} banner">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.bg[0]}"/>
      <stop offset="1" stop-color="${palette.bg[1]}"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="400" fill="url(#sky)"/>
  <text x="1400" y="340" text-anchor="middle" ${serif} font-size="240" font-weight="900" fill="#ffffff" opacity="0.06">${kanji}</text>
  <text x="80" y="210" ${serif} font-size="58" font-weight="900" fill="#ffffff" letter-spacing="2">${t.name}</text>
  <text x="82" y="262" ${mono} font-size="20" fill="${palette.accent2}" letter-spacing="8">${t.subtitle}</text>
  <rect x="80" y="292" width="160" height="4" fill="${palette.accent}"/>
</svg>
`
}

/* ------------------------------ main ------------------------------ */
let count = 0
for (const t of TITLES) {
  const base = join(OUT, t.slug)
  mkdirSync(base, { recursive: true })

  writeFileSync(join(base, 'cover.svg'), buildCover(t))
  writeFileSync(join(base, 'banner.svg'), buildBanner(t))
  count += 2

  for (let ch = 0; ch < 3; ch += 1) {
    const dir = join(base, `ch${ch + 1}`)
    mkdirSync(dir, { recursive: true })
    for (let page = 1; page <= 6; page += 1) {
      writeFileSync(join(dir, `page-${page}.svg`), buildPage(t, ch, page))
      count += 1
    }
  }
}

console.log(`Generated ${count} demo SVGs in ${OUT}`)
