#!/usr/bin/env python3
"""manga_scraper — standalone Playwright manga downloader (CBZ output)."""

from __future__ import annotations

import argparse
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urljoin

import requests
from PIL import Image
from playwright.sync_api import sync_playwright

VERSION = "1.0.0"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

CHAPTER_FALLBACK_SELECTORS = [
    "a.chapter-link", "a.chapter-name", "a.chapter",
    "li.wp-manga-chapter a", "li.chapter a",
    'a[href*="/chapter-"]', 'a[href*="/chapter/"]',
    'a[href*="read/"]', 'a[href*="/episode-"]',
]

READER_IMG_SELECTOR = (
    ".reading-content img, .container-chapter-reader img, #readerarea img, "
    ".chapter-content img, img.wp-manga-chapter-img"
)

IMAGE_EXT_RE = re.compile(r"\.(jpe?g|png|webp|gif|avif|bmp)(\?.*)?$", re.I)
CHROME_HINTS = ("logo", "icon", "banner", "avatar", "sprite", ".svg")
PACK_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif")


def parse_args(argv=None):
    p = argparse.ArgumentParser(description="Download manga chapters as CBZ via Playwright.")
    p.add_argument("url", help="Series page URL")
    p.add_argument("--limit", type=int, default=0, help="Max chapters")
    p.add_argument("--workers", type=int, default=6, help="Download threads")
    p.add_argument("--delay", type=float, default=1.0, help="Delay between chapters")
    p.add_argument("--channel", default=None, help="Browser channel")
    p.add_argument("--headful", action="store_true", help="Show browser window")
    p.add_argument("--output", default="D:/Downloaded_Manga", help="Output folder")
    p.add_argument("--chapter-selector", default=None, help="CSS selector for chapter links")
    p.add_argument("--page-selector", default=None, help="CSS selector for page images")
    return p.parse_args(argv)


def slugify(s, max_len=60):
    s = re.sub(r"[^\w\s-]", "", s).strip().lower()
    s = re.sub(r"[\s-]+", "-", s)
    return s[:max_len] or "chapter"


def _ext_for_url(url: str) -> str:
    ext = __import__("os").path.splitext(__import__("urllib.parse").parse.urlparse(url).path)[1].lstrip(".").lower()
    if ext in ("jpg", "jpeg", "png", "webp", "gif", "avif", "bmp"):
        return "jpg" if ext == "jpeg" else ext
    return "jpg"


def convert_to_cbz(folder: Path, cbz_path: Path) -> int:
    import zipfile
    from tqdm import tqdm
    image_files = sorted(f for f in folder.iterdir() if f.suffix.lower() in PACK_EXTENSIONS)
    if not image_files:
        return 0
    with zipfile.ZipFile(cbz_path, "w", zipfile.ZIP_DEFLATED) as cbz:
        for file in tqdm(image_files, desc="  Packaging", leave=False):
            cbz.write(file, arcname=file.name)
    return len(image_files)


def main(argv=None) -> int:
    args = parse_args(argv)

    out_base = Path(args.output)
    out_base.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headful, channel=args.channel or None)
        context = browser.new_context(user_agent=USER_AGENT, viewport={"width": 1440, "height": 900}, locale="en-US")
        page = context.new_page()

        print(f"[*] Series: {args.url}")
        page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(2000)

        selectors = ([args.chapter_selector] if args.chapter_selector else []) + CHAPTER_FALLBACK_SELECTORS
        links = []
        for sel in selectors:
            try:
                nodes = page.query_selector_all(sel)
            except Exception:
                continue
            if nodes:
                links = nodes
                break

        if not links:
            print("[-] No chapter links found")
            browser.close()
            return 1

        chapters = []
        seen = set()
        for node in links:
            href = node.get_attribute("href")
            if not href:
                continue
            url = urljoin(args.url, href)
            if url in seen:
                continue
            seen.add(url)
            text = (node.inner_text() or "").strip()
            m = re.search(r"chapter\s*(\d+(?:\.\d+)?)", text, re.I)
            num = float(m.group(1)) if m else len(chapters) + 1
            chapters.append({"number": num, "title": text or url, "url": url})

        chapters.sort(key=lambda c: c["number"])
        if args.limit:
            chapters = chapters[: args.limit]

        print(f"[*] Found {len(chapters)} chapters")

        for ch in chapters:
            print(f"\nChapter: {ch['title']}")
            page.goto(ch["url"], wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(1000)

            imgs = []
            for sel in [args.page_selector, READER_IMG_SELECTOR, "img"]:
                if not sel:
                    continue
                try:
                    nodes = page.query_selector_all(f"{sel} img")
                except Exception:
                    nodes = []
                if not nodes:
                    try:
                        nodes = page.query_selector_all(sel)
                    except Exception:
                        continue
                for img in nodes:
                    src = img.get_attribute("src") or img.get_attribute("data-src") or ""
                    if not src:
                        continue
                    full = urljoin(ch["url"], src)
                    if not any(h in full.lower() for h in CHROME_HINTS) and full not in imgs:
                        imgs.append(full)
                if imgs:
                    break

            if not imgs:
                print("  [!] No pages found")
                continue

            ch_dir = out_base / slugify(ch["title"])
            ch_dir.mkdir(parents=True, exist_ok=True)
            files = [ch_dir / f"page-{i+1:03d}.{_ext_for_url(u)}" for i, u in enumerate(imgs)]

            with ThreadPoolExecutor(max_workers=args.workers) as pool:
                futures = []
                for url, dest in zip(imgs, files):
                    if dest.exists() and dest.stat().st_size > 0:
                        continue
                    futures.append(pool.submit(lambda u, d: d.write_bytes(requests.get(u, headers={"User-Agent": USER_AGENT}, timeout=30).content), url, dest))
                for fut in futures:
                    try:
                        fut.result()
                    except Exception:
                        pass

            cbz = out_base / f"{slugify(ch['title'])}.cbz"
            convert_to_cbz(ch_dir, cbz)
            print(f"  [✓] CBZ ready ({len(imgs)} pages)")
            if args.delay > 0 and ch is not chapters[-1]:
                time.sleep(args.delay)

        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
