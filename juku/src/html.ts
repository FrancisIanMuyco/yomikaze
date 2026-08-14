/**
 * HTML parser — Cheerio wrapper used to parse HTML responses and extract
 * structured information (metadata, chapter links, page images).
 */
import * as cheerio from 'cheerio'
import type { AnyNode } from 'domhandler'

export type CheerioRoot = ReturnType<typeof cheerio.load>

export class HtmlParser {
  load(html: string): CheerioRoot {
    return cheerio.load(html)
  }

  /** Extract the text content of the first matching selector. */
  text($: CheerioRoot, selector: string): string {
    return $(selector).first().text().trim()
  }

  /** Extract an attribute from the first matching selector. */
  attr($: CheerioRoot, selector: string, attribute: string): string | undefined {
    return $(selector).first().attr(attribute)?.trim()
  }

  /** All href values matching a selector. */
  hrefs($: CheerioRoot, selector: string): string[] {
    const out: string[] = []
    $(selector).each((_, el) => {
      const href = $(el).attr('href')
      if (href) out.push(href.trim())
    })
    return out
  }

  /** Absolute URLs for every element matching `selector` + `attribute`. */
  absoluteUrls(
    $: CheerioRoot,
    selector: string,
    attribute: string,
    baseUrl: string,
  ): string[] {
    const out: string[] = []
    $(selector).each((_, el) => {
      const raw = $(el).attr(attribute)
      if (!raw) return
      try {
        out.push(new URL(raw.trim(), baseUrl).href)
      } catch {
        /* ignore malformed URLs */
      }
    })
    return out
  }

  /** Extract JSON-LD structured data blocks. */
  jsonLd($: CheerioRoot): unknown[] {
    const out: unknown[] = []
    $('script[type="application/ld+json"]').each((_, el) => {
      const raw = $(el as AnyNode).contents().text().trim()
      if (!raw) return
      try {
        out.push(JSON.parse(raw))
      } catch {
        /* ignore malformed JSON-LD */
      }
    })
    return out
  }

  /** Meta tag content by name or property. */
  meta($: CheerioRoot, key: string): string | undefined {
    return (
      $(`meta[name="${key}"], meta[property="${key}"]`).first().attr('content')?.trim() ??
      undefined
    )
  }
}

export const htmlParser = new HtmlParser()
