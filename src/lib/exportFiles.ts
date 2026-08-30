/**
 * File exports: turn chapter / title images into downloadable .zip and .pdf
 * files on top of the offline-reading cache.
 *
 * Pages are re-fetched through the /api/mfcdn proxy (CORS-enabled). When the
 * chapter has already been "downloaded" into the SW's mfcdn-pages-v1 cache the
 * Service Worker answers instantly, so exports keep working when offline.
 */

import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import type { Chapter, ChapterPage } from '@/types'

const PARALLEL_PAGES = 4

function sanitize(name: string): string {
  return (
    (name || 'chapter')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'chapter'
  )
}

/** Safe slice onto a plain ArrayBuffer (BlobPart-compatible on any TS lib version). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Sniff the real image format from magic bytes (blob.type can be empty on opaque/generic responses). */
function classify(bytes: Uint8Array): { ext: string; kind: 'jpg' | 'png' | 'webp' | 'other' } {
  if (bytes.length > 11 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      return { ext: 'webp', kind: 'webp' }
    }
  }
  if (bytes.length > 3 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: 'png', kind: 'png' }
  }
  if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return { ext: 'jpg', kind: 'jpg' }
  }
  return { ext: 'img', kind: 'other' }
}

async function fetchImageBytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Failed to fetch page (HTTP ${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

/** Fetch all page images in parallel workers, keep original order. */
export async function fetchPageBytes(
  pages: ChapterPage[],
  onProgress?: (done: number, total: number) => void,
  outgoingSignal?: AbortSignal,
): Promise<Uint8Array[]> {
  const controller = new AbortController()
  if (outgoingSignal) outgoingSignal.addEventListener('abort', () => controller.abort())
  const queue = pages.map((p, order) => ({ p, order }))
  const out = new Array<Uint8Array | undefined>(pages.length)
  let done = 0
  const total = pages.length
  const workers = Array.from({ length: Math.min(PARALLEL_PAGES, total) }, async () => {
    for (;;) {
      const job = queue.shift()
      if (!job) return
      controller.signal.throwIfAborted()
      const bytes = await fetchImageBytes(job.p.imageUrl, controller.signal)
      out[job.order] = bytes
      done += 1
      onProgress?.(done, total)
    }
  })
  await Promise.all(workers)
  return out.filter((b): b is Uint8Array => Boolean(b))
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

type ProgressCb = (done: number, total: number) => void

/** One chapter → organized .zip of raw images (p001.jpg, …). */
export async function downloadChapterZip(
  pages: ChapterPage[],
  baseName: string,
  onProgress?: ProgressCb,
  signal?: AbortSignal,
): Promise<void> {
  const bytes = await fetchPageBytes(pages, onProgress, signal)
  const zip = new JSZip()
  bytes.forEach((b, i) => {
    zip.file(`${String(i + 1).padStart(3, '0')}.${classify(b).ext}`, b)
  })
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  triggerDownload(blob, `${sanitize(baseName)}.zip`)
}

/** webp → canvas → jpeg so everything can go into a PDF. */
async function webpToJpeg(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const blob = new Blob([toArrayBuffer(bytes)], { type: 'image/webp' })
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(bitmap, 0, 0)
  const jpegBlob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG conversion failed'))), 'image/jpeg', 0.92),
  )
  bitmap.close()
  return new Uint8Array(await jpegBlob.arrayBuffer())
}

/** One chapter → single .pdf, one page per image. */
export async function downloadChapterPdf(
  pages: ChapterPage[],
  baseName: string,
  onProgress?: ProgressCb,
  signal?: AbortSignal,
): Promise<void> {
  const bytes = await fetchPageBytes(pages, onProgress, signal)
  const pdf = await PDFDocument.create()
  for (const raw of bytes) {
    const kind = classify(raw).kind
    let embed
    if (kind === 'png') embed = await pdf.embedPng(raw)
    else if (kind === 'webp') embed = await pdf.embedJpg(await webpToJpeg(raw))
    else embed = await pdf.embedJpg(raw)
    const page = pdf.addPage([embed.width, embed.height])
    page.drawImage(embed, { x: 0, y: 0, width: embed.width, height: embed.height })
  }
  const pdfBytes = await pdf.save()
  triggerDownload(new Blob([toArrayBuffer(pdfBytes)], { type: 'application/pdf' }), `${sanitize(baseName)}.pdf`)
}

/**
 * A whole title → one organized .zip with a folder per chapter
 * (`Title/Ch 01/p001.jpg`). Chapters are processed sequentially so every
 * fetched image is written into the archive in order.
 */
export async function downloadTitleZip(
  chapters: Chapter[],
  getPages: (chapter: Chapter) => Promise<ChapterPage[]>,
  titleName: string,
  onQueue?: ProgressCb,
  onProgress?: ProgressCb,
  signal?: AbortSignal,
): Promise<void> {
  const jobs = chapters.filter((c) => c.available && (c.pageCount ?? 0) > 0)
  const root = sanitize(titleName)
  const zip = new JSZip()
  let queued = 0
  const total = jobs.length
  for (const chapter of jobs) {
    signal?.throwIfAborted()
    onQueue?.(queued, total)
    const pages = await getPages(chapter)
    const label = `Ch ${chapter.chapterNumber}`
    const folder = zip.folder(`${root}/${label}`)
    if (!folder) continue
    const bytes = await fetchPageBytes(pages, onProgress, signal)
    bytes.forEach((b, i) => {
      folder.file(`${String(i + 1).padStart(3, '0')}.${classify(b).ext}`, b)
    })
    queued += 1
    onQueue?.(queued, total)
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  triggerDownload(blob, `${root} - all chapters.zip`)
}