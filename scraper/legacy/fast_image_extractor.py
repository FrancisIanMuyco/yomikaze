#!/usr/bin/env python3
"""
fast_image_extractor.py — Ultra-fast Playwright image URL extractor (NO downloads).

Features:
  - Resource blocking (CSS, fonts, media) for speed
  - Dynamic auto-scroll to trigger lazy-loaded images
  - Saves JSON per chapter to manga_data/<Manga_Title>/<Chapter>.json
  - Zero image downloads — only direct URLs

Usage:
  python fast_image_extractor.py "https://mangafire.to/title/xxx"
  python fast_image_extractor.py "https://example.com/chapter-1" --title "My Manhua"
  python fast_image_extractor.py --chapter-urls URL1 URL2 URL3 --title "My Manhua"
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path
from urllib.parse import urljoin, urlparse

from playwright.async_api import async_playwright

try:
    if sys.stdout and sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if sys.stderr and sys.stderr.encoding and sys.stderr.encoding.lower() not in ("utf-8", "utf8"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

VERSION = "1.0.0"
BANNER = fr"""
   ____  _                          __
  / __ \| |                        / /_ _____ ___  ___
 / / _` | |      __ _ _ __  _   _ / // // _ \/ _ \/ _ \
| | (_| | |     / _` | '_ \| | | / // //  __/  __/  __/
 \ \__,_|_|    | (_| | |_) | |_|/_//_/ \___|\___|\___|
  \____/      (_)___|_| .__/ \__,/  ultra-fast extractor v{VERSION}
                       |_|    |___/
"""

LEGAL_NOTE = (
    "  [!] Legal note: only scrape sites you are allowed to scrape.\n"
)

DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

BLOCKED_RESOURCE_TYPES = {"stylesheet", "font", "media"}

SCROLL_JS = """
() => {
  window.scrollBy(0, window.innerHeight);
  return document.body.scrollHeight;
}
"""

COUNT_IMAGES_JS = """
() => {
  const imgs = document.querySelectorAll('img');
  const urls = new Set();
  imgs.forEach(img => {
    const src = img.currentSrc || img.src || img.dataset.src || img.dataset.original || img.dataset.lazySrc || '';
    if (src && !src.startsWith('data:') && !src.includes('.svg') && !src.includes('logo') && !src.includes('icon') && !src.includes('banner') && !src.includes('avatar') && !src.includes('sprite')) {
      urls.add(src);
    }
  });
  return urls.size;
}
"""

EXTRACT_IMAGES_JS = """
() => {
  const imgs = document.querySelectorAll('img');
  const urls = [];
  const seen = new Set();
  imgs.forEach(img => {
    const src = img.currentSrc || img.src || img.dataset.src || img.dataset.original || img.dataset.lazySrc || '';
    if (src && !src.startsWith('data:') && !src.includes('.svg') && !src.includes('logo') && !src.includes('icon') && !src.includes('banner') && !src.includes('avatar') && !src.includes('sprite')) {
      if (!seen.has(src)) {
        seen.add(src);
        urls.push(src);
      }
    }
  });
  return urls;
}
"""


def slugify(s: str, max_len: int = 60) -> str:
    s = re.sub(r"[^\w\s-]", "", s).strip().lower()
    s = re.sub(r"[-\s]+", "-", s)
    return s[:max_len] or "chapter"


async def block_resources(route):
    if route.request.resource_type in BLOCKED_RESOURCE_TYPES:
        await route.abort()
    else:
        await route.continue_()


async def auto_scroll(page, max_scrolls: int = 100, wait_ms: int = 200):
    last_count = 0
    stable_rounds = 0
    for _ in range(max_scrolls):
        count = await page.evaluate(COUNT_IMAGES_JS)
        if count == last_count:
            stable_rounds += 1
            if stable_rounds >= 2:
                break
        else:
            stable_rounds = 0
        last_count = count
        await page.evaluate(SCROLL_JS)
        await page.wait_for_timeout(wait_ms)
    return await page.evaluate(COUNT_IMAGES_JS)


async def extract_images(page) -> list[str]:
    return await page.evaluate(EXTRACT_IMAGES_JS)


async def navigate_and_extract(page, url: str, timeout: int, wait_ms: int) -> list[str]:
    await page.goto(url, wait_until="domcontentloaded", timeout=timeout * 1000)
    await page.wait_for_timeout(500)
    await auto_scroll(page, wait_ms=wait_ms)
    return await extract_images(page)


async def discover_chapters(page, series_url: str, limit: int = 0, timeout: int = 20) -> list[dict]:
    await page.goto(series_url, wait_until="domcontentloaded", timeout=timeout * 1000)
    await page.wait_for_timeout(1000)
    
    chapters = await page.evaluate("""(limit) => {
      const links = Array.from(document.querySelectorAll('a[href*="chapter"], a[href*="read"], a[href*="/ch/"]'));
      const seen = new Set();
      const result = [];
      for (const a of links) {
        const href = a.href;
        if (!href || seen.has(href)) continue;
        seen.add(href);
        const text = (a.textContent || '').trim();
        result.push({ url: href, title: text || href });
        if (limit > 0 && result.length >= limit) break;
      }
      return result;
    }""", limit)
    
    return chapters


async def discover_chapters_mangafire(page, series_url: str, limit: int = 0, timeout: int = 20, wait_ms: int = 200, headful: bool = False) -> list[dict]:
    """For mangafire.to: start from latest chapter, navigate back via Previous button."""
    await page.goto(series_url, wait_until="domcontentloaded", timeout=timeout * 1000)
    
    if await is_challenge(page):
        print("    [captcha] mangafire is showing a security check - solve it in the browser window...")
        if not await wait_out_challenge(page, timeout=120 if headful else 20):
            print("    [!] Captcha did not resolve - skipping", file=sys.stderr)
            return []
    
    await page.wait_for_timeout(2000)
    
    latest_href = await page.evaluate("""() => {
      const links = document.querySelectorAll('a[href*="/chapter/"]');
      return links.length > 0 ? links[0].href : null;
    }""")
    
    if not latest_href:
        return []
    
    current_url = latest_href
    chapters: list[dict] = []
    seen: set = set()
    max_chapters = 500 if limit == 0 else limit
    
    for _ in range(max_chapters):
        if not current_url or current_url in seen:
            break
        seen.add(current_url)
        
        await page.goto(current_url, wait_until="domcontentloaded", timeout=timeout * 1000)
        await page.wait_for_timeout(1500)
        await auto_scroll(page, wait_ms=wait_ms)
        
        ch_num = await page.evaluate("""() => {
          const text = document.body.innerText;
          const match = text.match(/Ch\\.\\s*(\\d+)/);
          return match ? parseInt(match[1]) : null;
        }""")
        
        chapter_url = await page.evaluate("window.location.href")
        
        if ch_num is not None:
            chapters.append({
                "url": chapter_url,
                "title": f"Ch. {ch_num}",
            })
        
        has_prev = await page.evaluate("""() => {
          const btns = document.querySelectorAll('button.reader__end-btn');
          for (const btn of btns) {
            if (btn.textContent.toLowerCase().includes('previous')) {
              btn.click();
              return true;
            }
          }
          return false;
        }""")
        
        if not has_prev:
            break
        
        await page.wait_for_timeout(2500)
        current_url = await page.evaluate("window.location.href")
    
    chapters.reverse()
    return chapters


async def wait_out_challenge(page, timeout: int = 120) -> bool:
    """Wait while mangafire shows its captcha. Returns True when page is clear."""
    waited = 0
    while waited < timeout:
        try:
            title = await page.title()
            if "Security check" not in title and "challenge" not in title.lower():
                return True
        except Exception:
            pass
        await page.wait_for_timeout(5000)
        waited += 5
    return False


async def is_challenge(page) -> bool:
    try:
        title = await page.title()
        return "Security check" in title or "challenge" in title.lower()
    except Exception:
        return False


async def run_extraction(args) -> int:
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=not args.headful,
            channel=args.channel,
            args=["--disable-web-security", "--disable-features=IsolateOrigins,site-per-process"]
        )
        context = await browser.new_context(
            user_agent=DEFAULT_UA,
            viewport={"width": 1920, "height": 1080},
            locale="en-US",
        )
        await context.route("**/*", block_resources)
        
        page = await context.new_page()
        page.set_default_timeout(args.timeout * 1000)
        
        out_base = Path(args.output)
        out_base.mkdir(parents=True, exist_ok=True)
        
        chapters_to_process = []
        
        if args.chapter_urls:
            names = args.chapter_names or [f"Chapter {i+1}" for i in range(len(args.chapter_urls))]
            for url, name in zip(args.chapter_urls, args.chapter_names):
                chapters_to_process.append({"url": url, "title": name})
        elif args.url:
            is_mangafire = "mangafire.to" in urlparse(args.url).netloc and "/title/" in urlparse(args.url).path
            if args.discover or is_mangafire:
                print(f"[*] Discovering chapters from: {args.url}")
                if is_mangafire:
                    discovered = await discover_chapters_mangafire(
                        page, args.url, limit=args.limit, timeout=args.timeout, wait_ms=args.wait, headful=args.headful
                    )
                else:
                    discovered = await discover_chapters(page, args.url, limit=args.limit, timeout=args.timeout)
                if not discovered:
                    print("[!] No chapters found on series page.", file=sys.stderr)
                    return 1
                print(f"[*] Found {len(discovered)} chapters")
                chapters_to_process = discovered
                if args.limit:
                    chapters_to_process = chapters_to_process[: args.limit]
            else:
                chapters_to_process.append({"url": args.url, "title": "Chapter"})
        else:
            print("[!] Provide a URL or --chapter-urls", file=sys.stderr)
            return 1
        
        manga_title = args.title or "manga"
        manga_slug = slugify(manga_title)
        
        for i, ch in enumerate(chapters_to_process):
            print(f"[*] Processing: {ch['title']} ({i+1}/{len(chapters_to_process)})")
            try:
                urls = await navigate_and_extract(page, ch["url"], args.timeout, args.wait)
            except Exception as exc:
                print(f"  [!] Failed: {exc}", file=sys.stderr)
                continue
            
            if not urls:
                print("  [!] No images found")
                continue
            
            ch_title = ch["title"]
            ch_slug = slugify(ch_title)
            
            manga_dir = out_base / manga_slug
            manga_dir.mkdir(parents=True, exist_ok=True)
            out_file = manga_dir / f"{ch_slug}.json"
            
            data = {
                "manga_title": manga_title,
                "chapter_title": ch_title,
                "total_pages": len(urls),
                "pages": urls,
            }
            out_file.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"  [OK] {len(urls)} pages -> {out_file}")
        
        await browser.close()
    return 0


def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description="Ultra-fast Playwright image URL extractor (no downloads).",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("url", nargs="?", help="Series page or direct chapter URL")
    p.add_argument("--chapter-urls", nargs="*", help="Explicit chapter URLs")
    p.add_argument("--chapter-names", nargs="*", help="Chapter names (must match --chapter-urls)")
    p.add_argument("--title", help="Manga title (auto-derived from URL if omitted)")
    p.add_argument("--output", default="./manga_data", help="Output folder")
    p.add_argument("--limit", type=int, default=0, help="Max chapters to process")
    p.add_argument("--timeout", type=int, default=20, help="Navigation timeout (s)")
    p.add_argument("--wait", type=int, default=200, help="Lazy-load settle time after scroll (ms)")
    p.add_argument("--headful", action="store_true", help="Show browser window")
    p.add_argument("--channel", default=None, help="Browser channel (e.g. chrome)")
    p.add_argument("--discover", action="store_true", help="Discover chapters from series URL")
    p.add_argument("--no-banner", action="store_true", help="Hide banner")
    p.add_argument("--version", action="version", version=f"%(prog)s {VERSION}")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    
    if not args.no_banner:
        print(BANNER)
        print(LEGAL_NOTE)
    
    return asyncio.run(run_extraction(args))


if __name__ == "__main__":
    sys.exit(main())
