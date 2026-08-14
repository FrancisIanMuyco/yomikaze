/**
 * Deduplication — prevents duplicate requests, jobs, anime, chapters, pages
 * and URLs across the whole pipeline.
 */

export type DedupKind =
  | 'request' // URL-based request dedup
  | 'job' // queue job dedup
  | 'title' // anime / title dedup (source + slug)
  | 'chapter' // chapter dedup (source + series + number)
  | 'page' // page dedup (chapter + page number + URL)
  | 'url' // raw URL dedup

export class Deduplicator {
  private sets = new Map<DedupKind, Set<string>>()

  constructor() {
    for (const kind of ['request', 'job', 'title', 'chapter', 'page', 'url'] as DedupKind[]) {
      this.sets.set(kind, new Set())
    }
  }

  private set(kind: DedupKind): Set<string> {
    let s = this.sets.get(kind)
    if (!s) {
      s = new Set()
      this.sets.set(kind, s)
    }
    return s
  }

  /** True when this key was already seen (does not mark). */
  has(kind: DedupKind, key: string): boolean {
    return this.set(kind).has(key)
  }

  /** Mark a key as seen. */
  mark(kind: DedupKind, key: string): void {
    this.set(kind).add(key)
  }

  /** True when the key is new AND marks it. */
  isNew(kind: DedupKind, key: string): boolean {
    if (this.has(kind, key)) return false
    this.mark(kind, key)
    return true
  }

  /** Remove a key (e.g. release a job id once the job finished). */
  remove(kind: DedupKind, key: string): void {
    this.set(kind).delete(key)
  }

  size(kind: DedupKind): number {
    return this.set(kind).size
  }

  clear(kind?: DedupKind): void {
    if (kind) this.set(kind).clear()
    else for (const s of this.sets.values()) s.clear()
  }
}

/** Stable key builders shared by the pipeline. */
export function urlKey(url: string): string {
  return `url:${url}`
}

export function titleKey(source: string, slug: string): string {
  return `${source}:${slug.toLowerCase()}`
}

export function chapterKey(source: string, seriesId: string, number: number): string {
  return `${source}:${seriesId}:${number}`
}

export function pageKey(chapterKey: string, pageNumber: number, imageUrl: string): string {
  return `${chapterKey}:${pageNumber}:${imageUrl}`
}
