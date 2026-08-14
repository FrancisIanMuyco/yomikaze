/**
 * One-off JUKU script: fetch pages for chapters that have none in the store
 * (public/scraped.json) and persist them back. Used to make "metadata-only"
 * chapters readable. Safe to delete after use.
 */
import { Pipeline } from './dist/pipeline.js'
import { pageExtractor } from './dist/extractor.js'

async function main() {
  const pipeline = new Pipeline()

  try {
    const store = pipeline.db.storeData
    const missing = (store.chapters ?? []).filter(c => !c.pages || c.pages.length === 0)
    console.log(`missing pages: ${missing.length} chapter(s)`)
    if (!missing.length) {
      console.log('nothing to do')
      return
    }

  let fixed = 0
  for (const ch of missing) {
    const sourceId = String(ch.source ?? 'mangafire')
    const label = `${sourceId}:${ch.series_id} ch ${ch.number}`
    try {
      const source = pipeline.source(sourceId)
      const urls = await source.getChapterPages(ch.url || String(ch.chapter_id ?? ''))
      const extracted = pageExtractor.extract(urls, { chapterKey: `${ch.series_id}:${ch.number}` })
      const pages = extracted.map(p => p.imageUrl)
      if (pages.length) {
        ch.pages = pages
        fixed += 1
        console.log(`OK   ${label} → ${pages.length} pages`)
      } else {
        console.log(`EMPTY ${label} → no pages returned`)
      }
    } catch (err) {
      console.log(`FAIL ${label} → ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (fixed) {
    pipeline.persist()
    const size = pipeline.db.size
    console.log(`persisted — fixed ${fixed}/${missing.length} → store now ${size.titles} titles · ${size.chapters} chapters · ${size.pages} pages`)
  } else {
    console.log('nothing persisted')
  }  } finally {
    await pipeline.close()
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('fatal:', err instanceof Error ? err.message : err)
    process.exit(1)
  })

