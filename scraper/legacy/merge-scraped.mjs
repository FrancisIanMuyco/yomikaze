#!/usr/bin/env node
/**
 * merge-scraped.mjs — merge a batch of freshly scraped titles into the existing
 * YOMIKAZE public/scraped.json (keeps titles already present).
 *
 * Usage: node merge-scraped.mjs <new-scraped.json>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// Script lives in scraper/legacy/, so YOMIKAZE is two levels up.
const target = resolve(here, '../../YOMIKAZE/public/scraped.json')
const src = process.argv[2]

if (!src || !existsSync(src)) {
  console.error('Usage: node merge-scraped.mjs <new-scraped.json>')
  process.exit(1)
}

const existing = JSON.parse(readFileSync(target, 'utf-8'))
const incoming = JSON.parse(readFileSync(src, 'utf-8'))

const existingItems = new Map(existing.items.map((it) => [it.source_id, it]))
const existingChapters = new Map(existing.chapters.map((c) => [c.chapter_id, c]))

let addedTitles = 0
let addedChapters = 0

for (const item of incoming.items) {
  if (!existingItems.has(item.source_id)) {
    existingItems.set(item.source_id, item)
    addedTitles++
  }
}
for (const ch of incoming.chapters) {
  if (!existingChapters.has(ch.chapter_id)) {
    existingChapters.set(ch.chapter_id, ch)
    addedChapters++
  }
}

const items = Array.from(existingItems.values())
const chapters = Array.from(existingChapters.values())

const merged = {
  items,
  chapters,
  total_chapters: chapters.length,
  total_pages: chapters.reduce((n, c) => n + c.pages.length, 0),
}

writeFileSync(target, JSON.stringify(merged, null, 2), 'utf-8')
console.log(`Merged -> ${target}`)
console.log(`Titles: ${items.length} (+${addedTitles}) · Chapters: ${chapters.length} (+${addedChapters}) · Pages: ${merged.total_pages}`)
