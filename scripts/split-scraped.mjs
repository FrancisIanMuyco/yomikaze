#!/usr/bin/env node
/**
 * split-scraped.mjs — Split scraped.json into per-title chunks.
 *
 * Output:
 *   public/titles.json           — lightweight index (items only, no chapters)
 *   public/titles/<source_id>.json — chapters for each title
 *
 * Usage: node scripts/split-scraped.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = import.meta.dirname
const PUBLIC = join(ROOT, '..', 'public')
const TITLES_DIR = join(PUBLIC, 'titles')
const INPUT = join(PUBLIC, 'scraped.json')

console.log('📖 Reading scraped.json…')
const raw = JSON.parse(readFileSync(INPUT, 'utf8'))
const items = raw.items || []
const chapters = raw.chapters || []

console.log(`   ${items.length} titles, ${chapters.length} chapters`)

// Group chapters by series_id
const chaptersBySeries = new Map()
for (const ch of chapters) {
  const arr = chaptersBySeries.get(ch.series_id) || []
  arr.push(ch)
  chaptersBySeries.set(ch.series_id, arr)
}

// Create titles directory (clean first)
if (existsSync(TITLES_DIR)) rmSync(TITLES_DIR, { recursive: true })
mkdirSync(TITLES_DIR, { recursive: true })

// Write per-title chapter files
let totalWritten = 0
for (const item of items) {
  const seriesId = item.source_id
  const titleChapters = chaptersBySeries.get(seriesId) || []

  // Sort chapters by number
  titleChapters.sort((a, b) => a.number - b.number)

  const fileName = `${seriesId}.json`
  const filePath = join(TITLES_DIR, fileName)

  writeFileSync(filePath, JSON.stringify({
    series_id: seriesId,
    chapters: titleChapters,
  }))

  totalWritten += titleChapters.length
}

// Write lightweight index (items only)
const index = {
  items,
  total_titles: items.length,
  total_chapters: totalWritten,
}

writeFileSync(join(PUBLIC, 'titles.json'), JSON.stringify(index))

console.log(`✅ Written ${items.length} title files to public/titles/`)
console.log(`✅ Written titles.json index (${totalWritten} chapters total)`)
console.log(`📊 Original: ${(Buffer.byteLength(JSON.stringify(raw)) / 1024 / 1024).toFixed(1)}MB`)
console.log(`📊 Index: ${(Buffer.byteLength(JSON.stringify(index)) / 1024).toFixed(0)}KB`)
