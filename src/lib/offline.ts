/**
 * Offline chapter downloads.
 *
 * Chapter page images are mangafire-CDN-backed and always fetched THROUGH the
 * `/api/mfcdn?url=...` proxy (hotlink protection needs the mangafire Referer,
 * which the browser can't send). Downloaded pages are stored in the SAME cache
 * the Service Worker uses for its runtime Caching (`mfcdn-pages-v1`) — so
 * once cached, the SW serves them offline (CacheFirst) with no extra work.
 *
 * `localStorage` keeps a small index of downloaded chapters (per-device) for
 * the ✓ indicators, delete support and the download-all progress tracker.
 */

import type { Chapter, ChapterPage, Title } from '@/types'

const CACHE_NAME = 'mfcdn-pages-v1'
const INDEX_KEY = 'yomikaze:downloads:v1'
const PARALLEL_PAGES = 4 // simultaneous image fetches inside one chapter

export interface DownloadRecord {
  chapterId: string
  titleId: string
  title: string
  chapterLabel: string
  pageCount: number
  urls: string[]
  bytes: number
  downloadedAt: number
}

export type DownloadPhase = 'idle' | 'downloading' | 'downloaded'

type Index = Record<string, DownloadRecord>

const listeners = new Set<() => void>()
const active = new Map<string, AbortController>()

function notify() {
  for (const fn of listeners) listeners.forEach(fn)
}

export function subscribeDownloads(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function loadIndex(): Index {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) || '{}') as Index
  } catch {
    return {}
  }
}

function saveIndex(index: Index) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index))
  } catch {
    // storage full / unavailable — downloads still work, indicators may not
  }
}

export function isSupported(): boolean {
  return typeof caches !== 'undefined' && typeof caches.open === 'function'
}

/** Proxy (or otherwise relative) image URLs must be absolute to be cache keys. */
function absolutize(url: string): string {
  return new URL(url, location.href).toString()
}

export function phaseFor(chapterId: string): DownloadPhase {
  if (active.has(chapterId)) return 'downloading'
  return loadIndex()[chapterId] ? 'downloaded' : 'idle'
}

export function recordFor(chapterId: string): DownloadRecord | null {
  return loadIndex()[chapterId] || null
}

export function recordsForTitle(titleId: string): DownloadRecord[] {
  const index = loadIndex()
  return Object.values(index)
    .filter((r) => r.titleId === titleId)
    .sort((a, b) => a.downloadedAt - b.downloadedAt)
}

async function cachePut(cache: Cache, url: string, response: Response): Promise<number> {
  let bytes = 0
  try {
    const blob = await response.clone().blob()
    bytes = blob.size
  } catch {
    // body already consumed upstream — size unknown, fine
  }
  await cache.put(url, response.clone())
  return bytes
}

async function cacheMatch(cache: Cache, url: string): Promise<boolean> {
  try {
    return Boolean(await cache.match(url))
  } catch {
    return false
  }
}

/** Download one chapter's pages into the SW cache. `onPage` fires per page. */
export async function downloadChapter(
  chapterId: string,
  pages: ChapterPage[],
  meta: Pick<DownloadRecord, 'titleId' | 'title' | 'chapterLabel'>,
  onPage?: (done: number, total: number) => void,
): Promise<DownloadRecord> {
  if (!isSupported()) throw new Error('Offline downloads are not supported in this browser')
  const controller = new AbortController()
  active.set(chapterId, controller)
  notify()

  const cache = await caches.open(CACHE_NAME)
  const urls: string[] = []
  let bytes = 0
  let done = 0
  const total = pages.length

  try {
    const queue = [...pages]
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL_PAGES, total) }, async () => {
        while (queue.length) {
          controller.signal.throwIfAborted()
          const page = queue.shift()!
          const url = absolutize(page.imageUrl)
          if (await cacheMatch(cache, url)) {
            done++
            onPage?.(done, total)
            continue
          }
          const response = await fetch(url, { signal: controller.signal })
          if (!response.ok && response.status !== 0) {
            throw new Error(`Failed to fetch page (HTTP ${response.status})`)
          }
          try {
            bytes += await cachePut(cache, url, response)
          } catch (err) {
            // opaque (cross-origin) responses can't always be re-read — but the
            // SW already stored the bytes, so counting it as done is fine.
            if (!(err instanceof TypeError)) throw err
          }
          urls.push(url)
          done++
          onPage?.(done, total)
        }
      }),
    )

    const record: DownloadRecord = {
      chapterId,
      titleId: meta.titleId,
      title: meta.title,
      chapterLabel: meta.chapterLabel,
      pageCount: total,
      urls,
      bytes,
      downloadedAt: Date.now(),
    }
    const index = loadIndex()
    index[chapterId] = record
    saveIndex(index)
    return record
  } finally {
    active.delete(chapterId)
    notify()
  }
}

/** Remove a chapter's cached pages (and its index entry). */
export async function removeDownload(chapterId: string): Promise<void> {
  const record = recordFor(chapterId)
  if (!record) {
    notify()
    return
  }
  const cache = await caches.open(CACHE_NAME)
  await Promise.all(record.urls.map((u) => cache.delete(absolutize(u)).catch(() => false)))
  const index = loadIndex()
  delete index[chapterId]
  saveIndex(index)
  notify()
}

/** Abort an in-progress chapter download. */
export function cancelDownload(chapterId: string): void {
  active.get(chapterId)?.abort()
}

export function isAnyDownloadingFor(titleId: string): boolean {
  return Array.from(active.keys()).some((id) => recordFor(id)?.titleId === titleId || active.has(id))
}

/** Download every chapter of a title (newest→oldest). `onQueue` fires per chapter. */
export async function downloadTitleChapters(
  title: Title,
  chapters: Chapter[],
  getPages: (chapter: Chapter) => Promise<ChapterPage[]>,
  onQueue?: (queued: number, total: number) => void,
  onAbort?: () => void,
): Promise<void> {
  const available = chapters.filter((c) => c.available)
  let done = 0
  const total = available.length
  try {
    for (const chapter of available) {
      onQueue?.(done, total)
      const pages = await getPages(chapter)
      await downloadChapter(chapter.id, pages, {
        titleId: title.id,
        title: title.title,
        chapterLabel: chapter.title ?? `Chapter ${chapter.chapterNumber}`,
      })
      done++
      onQueue?.(done, total)
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') onAbort?.()
    throw err
  }
}

export function cancelAllForTitle(titleId: string): void {
  for (const [id] of active) {
    if (recordFor(id)?.titleId === titleId) active.get(id)?.abort()
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  const est = await navigator.storage.estimate()
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 }
}

/** Ask the browser to make our cache persistent (survives storage pressure). */
export async function persistStorage(): Promise<void> {
  if (navigator.storage?.persist) {
    try {
      await navigator.storage.persist()
    } catch {
      // ignore — persistence is a hint, not a requirement
    }
  }
}