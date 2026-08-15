#!/usr/bin/env python3
"""CLI for image_extractor."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from .extractor import GenericAdapter, ImageExtractor, MangaInfo, run_scraper, slugify

VERSION = "1.0.0"

BANNER = f"""
   ____ _       _   _            ____  _                       
  / ___| | ___ | |_| |__   ___  / ___|| |__   ___  __ _ _ __  
 | |  _| |/ _ \\| __| '_ \\ / _ \\ \\___ \\| '_ \\ / _ \\/ _` | '_ \\ 
 | |_| | | (_) | |_| | | |  __/  ___) | | | |  __/ (_| | | | |
  \\____|_|\\___/ \\__|_| |_|\\___| |____/|_| |_|\\___|\\__,_|_| |_|
  async Playwright image extractor v{VERSION}
"""

LEGAL_NOTE = (
    "  [!] Legal note: only scrape sites you are allowed to scrape. "
    "Copyrighted chapters are protected content.\n"
)


def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description="Extract image URLs from manhua chapter pages using Playwright.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("url", nargs="?", help="Series page URL")
    p.add_argument("--chapter-urls", nargs="*", help="Explicit chapter URLs (overrides discovery)")
    p.add_argument("--chapter-names", nargs="*", help="Chapter names (must match --chapter-urls)")
    p.add_argument("--title", help="Manga title (auto-derived from URL if omitted)")
    p.add_argument("--output", default="./manga_data", help="Output folder")
    p.add_argument("--download", action="store_true", help="Download page images")
    p.add_argument("--limit", type=int, default=0, help="Max chapters to process")
    p.add_argument("--download-limit", type=int, default=0, help="Max pages per chapter to download")
    p.add_argument("--delay", type=float, default=1.0, help="Delay between chapters (s)")
    p.add_argument("--retries", type=int, default=3, help="Retries per request")
    p.add_argument("--timeout", type=int, default=30, help="Navigation timeout (s)")
    p.add_argument("--headful", action="store_true", help="Show browser window")
    p.add_argument("--channel", default=None, help="Browser channel (e.g. chrome)")
    p.add_argument("--slow-mo", type=int, default=0, help="Slow down Playwright (ms)")
    p.add_argument("--chapter-selector", default=None, help="CSS selector for chapter links")
    p.add_argument("--page-selector", default=None, help="CSS selector for page images")
    p.add_argument("--no-banner", action="store_true", help="Hide banner")
    p.add_argument("--version", action="version", version=f"%(prog)s {VERSION}")
    return p.parse_args(argv)


async def discover_and_run(args) -> MangaInfo | None:
    if not args.url and not args.chapter_urls:
        print("[!] Provide a series URL or --chapter-urls", file=sys.stderr)
        return None

    adapter = GenericAdapter(delay=args.delay, retries=args.retries, timeout=args.timeout)
    if args.chapter_selector:
        adapter.chapter_link_selector = args.chapter_selector
    if args.page_selector:
        adapter.page_image_selector = args.page_selector

    extractor = ImageExtractor(
        adapter=adapter,
        headless=not args.headful,
        browser_channel=args.channel,
        slow_mo=args.slow_mo,
        output_dir=args.output,
    )

    manga_title = args.title or slugify(Path(args.url).parts[-1] if args.url else "manga")

    if args.chapter_urls:
        chapters = [
            {"url": u, "title": n or f"Chapter {i+1}"}
            for i, (u, n) in enumerate(
                zip(
                    args.chapter_urls,
                    args.chapter_names or [None] * len(args.chapter_urls),
                )
            )
        ]
    else:
        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            browser, context = await extractor._setup_browser(p)
            page = await context.new_page()
            await extractor._block_resources(page)
            try:
                discovered = await adapter.discover_chapters(page, args.url)
            finally:
                await page.close()
                await context.close()
                await browser.close()

        if not discovered:
            print("[!] No chapters discovered", file=sys.stderr)
            return None

        if args.limit:
            discovered = discovered[: args.limit]
        chapters = discovered

    return await extractor.run(
        chapters,
        manga_title,
        download_images=args.download,
        download_limit=args.download_limit,
    )


def main(argv=None) -> int:
    args = parse_args(argv)

    if not args.no_banner:
        print(BANNER)
        print(LEGAL_NOTE)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    manga = asyncio.run(discover_and_run(args))
    if manga is None:
        return 1

    extractor = ImageExtractor(output_dir=args.output)
    manifest_path = extractor.save_manifest(manga)
    print(f"\n[*] Manifest saved -> {manifest_path}")
    print(f"[*] Chapters: {len(manga.chapters)} · Pages: {sum(len(c.image_urls) for c in manga.chapters)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
