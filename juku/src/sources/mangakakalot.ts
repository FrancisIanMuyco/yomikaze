/**
 * MangaKakalot adapter — browser-based source (mangakakalot.gg).
 *
 * The site is Cloudflare-protected, so everything is scraped through the
 * shared BrowserScraper (reused browser, bounded pages) using the classic
 * mangakakalot DOM selectors — the same ones the project's Python
 * mangakakalot_fallback.py already uses, ported to TypeScript.
 */
import type { RawChapter, RawTitle } from '../normalizer.js'
import type { BrowserScraper } from '../browser.js'
import type { SearchResult, SourceAdapter } from './SourceAdapter.js'

const DOMAIN = 'https://www.mangakakalot.gg'

interface LinkItem {
  href: string
  text: string
}

interface ChapterRow {
  number: number
  url: string
}

interface DetailRow {
  title: string
  description: string
  authors: string[]
  genres: string[]
  cover: string
  status: string
}

/** Extract selectors from the page (returns first non-empty per selector). */
const EVAL_SCRAPE =
  '() => {\n' +
  '  const text = (sel) => { const el = document.querySelector(sel); return el ? (el.innerText || el.textContent || "").trim() : ""; };\n' +
  '  const attr = (sel, a) => { const el = document.querySelector(sel); return el ? (el.getAttribute(a) || el.content || "") : ""; };\n' +
  '  const all = (sel, a) => Array.from(document.querySelectorAll(sel)).map(el => a ? (el.getAttribute(a) || "") : (el.innerText || el.textContent || "").trim()).filter(Boolean);\n' +
  '  return {\n' +
  '    title: text("div.story-info-right h1") || text("div.story-info-right .story-title") || text("h1") || attr("meta[property=\'og:title\']", "content"),\n' +
  '    description: text("div#panel-story-info-description") || text("div.story-info-right .story-info-right-extent") || attr("meta[name=\'description\']", "content"),\n' +
  '    authors: all("a[href*=\'/author/\']"),\n' +
  '    genres: all("a[href*=\'/genre/\']"),\n' +
  '    cover: attr("div.story-info-left img", "src") || attr("meta[property=\'og:image\']", "content"),\n' +
  '    status: text("div.story-info-right .story-status") || text("div.story-info-right li:last-child"),\n' +
  '  };\n' +
  '}'

const EVAL_LINKS =
  '() => Array.from(document.querySelectorAll("a[href*=\'/manga/\']")).map(a => ({ href: a.getAttribute("href") || "", text: (a.getAttribute("title") || (a.querySelector("img") ? a.querySelector("img").getAttribute("alt") : "") || (a.textContent || "").replace(/\\s+/g, " ").trim()).trim() })).filter(x => x.href)'

const EVAL_CHAPTERS =
  '() => {\n' +
  '  const out = [];\n' +
  '  const links = document.querySelectorAll("div.chapter-list div.row a.chapter-name, div.chapter-list a.chapter-name, ul.row-content-chapter li a.chapter-name, a[href*=\'/chapter/\']");\n' +
  '  links.forEach(a => {\n' +
  '    const m = (a.textContent || "").match(/(\\d+(?:\\.\\d+)?)/);\n' +
  '    if (m && a.href) out.push({ number: parseFloat(m[1]), url: a.href });\n' +
  '  });\n' +
  '  return out;\n' +
  '}'

const EVAL_PAGES =
  '() => {\n' +
  '  const out = [];\n' +
  '  document.querySelectorAll("div.vung-doc img, #vungdoc img, .container-chapter-reader img, .reading-content img, img.chapter-img").forEach(img => {\n' +
  '    const u = img.currentSrc || img.src || img.getAttribute("data-src") || img.getAttribute("data-original") || img.getAttribute("data-lazy-src") || "";\n' +
  '    if (u && u.startsWith("http") && !/logo|favicon|avatar|banner|thumb|icon/i.test(u)) out.push(u);\n' +
  '  });\n' +
  '  return out;\n' +
  '}'

export class MangaKakalotAdapter implements SourceAdapter {
  readonly id = 'mangakakalot'
  readonly label = 'MangaKakalot (browser)'
  readonly mode = 'browser' as const
  readonly usesBrowser = true

  constructor(private readonly scraper: BrowserScraper) {}

  private slugFromUrl(url: string): string {
    return url.replace(/\/+$/, '').split('/').pop() ?? url
  }

  private toRawTitle(l: LinkItem): RawTitle {
    const slug = this.slugFromUrl(l.href)
    return {
      title: l.text || slug,
      alternativeTitles: [],
      slug,
      source: this.id,
      sourceUrl: l.href.startsWith('http') ? l.href : `${DOMAIN}${l.href}`,
      chapters: [],
    }
  }

  async search(query: string, limit = 20): Promise<SearchResult> {
    const url = `${DOMAIN}/search/story/${encodeURIComponent(query)}`
    const links = await this.scraper.withPage<LinkItem[]>(
      page => page.evaluate(EVAL_LINKS),
      { url, waitMs: 3500 },
    )
    const out: RawTitle[] = []
    const seen = new Set<string>()
    for (const l of links ?? []) {
      const slug = this.slugFromUrl(l.href)
      if (seen.has(slug)) continue
      seen.add(slug)
      out.push(this.toRawTitle(l))
      if (out.length >= limit) break
    }
    return { titles: out }
  }

  async getDetails(ref: string): Promise<RawTitle | null> {
    const url = ref.startsWith('http') ? ref : `${DOMAIN}/manga/${ref}`
    const d = await this.scraper.withPage<DetailRow>(
      page => page.evaluate(EVAL_SCRAPE),
      { url, waitMs: 3000 },
    )
    if (!d || (!d.title && !d.cover && !d.description)) {
      // Page didn't yield recognizable detail content — treat as blocked/missing.
      return null
    }
    return {
      title: d.title || ref,
      alternativeTitles: [],
      slug: this.slugFromUrl(url),
      description: d.description,
      cover: d.cover,
      author: d.authors[0],
      artist: d.authors[1],
      genres: d.genres,
      status: d.status,
      source: this.id,
      sourceUrl: url,
      chapters: [],
    }
  }

  async getChapters(ref: string): Promise<RawChapter[]> {
    const url = ref.startsWith('http') ? ref : `${DOMAIN}/manga/${ref}`
    const rows = await this.scraper.withPage<ChapterRow[]>(
      page => page.evaluate(EVAL_CHAPTERS),
      { url, waitMs: 3000 },
    )
    const seen = new Map<number, ChapterRow>()
    for (const r of rows ?? []) {
      if (!seen.has(r.number)) seen.set(r.number, r)
    }
    return [...seen.values()]
      .sort((a, b) => a.number - b.number)
      .map(c => ({
        chapterNumber: c.number,
        chapterTitle: `Chapter ${c.number}`,
        chapterUrl: c.url,
        pages: [],
      }))
  }

  async getChapterPages(ref: string): Promise<string[]> {
    const url = ref.startsWith('http') ? ref : `${DOMAIN}/chapter/${ref}`
    const pages = await this.scraper.withPage<string[]>(
      page => page.evaluate(EVAL_PAGES),
      { url, waitMs: 3500 },
    )
    return pages ?? []
  }

  async getLatest(limit = 20): Promise<RawTitle[]> {
    // The home page lists the most recent updates.
    const links = await this.scraper.withPage<LinkItem[]>(
      page => page.evaluate(EVAL_LINKS),
      { url: DOMAIN, waitMs: 3000 },
    )
    return this.dedupe(links, limit)
  }

  async getPopular(limit = 20): Promise<RawTitle[]> {
    // The full manga list sorted by views (most popular first).
    const url = `${DOMAIN}/manga-list/all/all/1`
    const links = await this.scraper.withPage<LinkItem[]>(
      page => page.evaluate(EVAL_LINKS),
      { url, waitMs: 3000 },
    )
    return this.dedupe(links, limit)
  }

  private dedupe(links: LinkItem[] | null, limit: number): RawTitle[] {
    const out: RawTitle[] = []
    const seen = new Set<string>()
    for (const l of links ?? []) {
      const slug = this.slugFromUrl(l.href)
      if (seen.has(slug)) continue
      seen.add(slug)
      out.push(this.toRawTitle(l))
      if (out.length >= limit) break
    }
    return out
  }
}
