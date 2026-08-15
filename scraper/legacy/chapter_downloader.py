#!/usr/bin/env python3
"""chapter_downloader — threaded chapter downloader with CBZ packaging."""

from __future__ import annotations

import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urljoin

import requests
from PIL import Image
from playwright.sync_api import sync_playwright
from tqdm import tqdm

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
CHROME_HINTS = ("logo", "icon", "banner", "avatar", "sprite", ".svg")
PACK_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif")


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


def main():
    url = input("Enter series URL: ").strip()
    if not url:
        return

    fmt = input("Format (cbz/folder): ").strip().lower() or "cbz"
    workers = int(input("Workers (default 6): ").strip() or "6")

    out_base = Path("D:/Downloaded_Manga")
    out_base.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(user_agent=USER_AGENT, viewport={"width": 1440, "height": 900}, locale="en-US")
        page = context.new_page()

        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(2000)

        links = []
        for sel in CHAPTER_FALLBACK_SELECTORS:
            try:
                nodes = page.query_selector_all(sel)
            except Exception:
                continue
            if nodes:
                links = nodes
                break

        chapters = []
        seen = set()
        for node in links:
            href = node.get_attribute("href")
            if not href:
                continue
            u = urljoin(url, href)
            if u in seen:
                continue
            seen.add(u)
            text = (node.inner_text() or "").strip()
            m = re.search(r"chapter\s*(\d+(?:\.\d+)?)", text, re.I)
            num = float(m.group(1)) if m else len(chapters) + 1
            chapters.append({"number": num, "title": text or u, "url": u})

        chapters.sort(key=lambda c: c["number"])

        print(f"\nFound {len(chapters)} chapters:")
        for i, ch in enumerate(chapters, 1):
            print(f"  {i}. {ch['title']}")

        sel = input(f"\nEnter chapters to download (1-{len(chapters)}): ").strip()
        if "-" in sel:
            start, end = map(int, sel.split("-", 1))
            to_download = chapters[start-1:end]
        elif sel.isdigit():
            idx = int(sel) - 1
            to_download = [chapters[idx]] if 0 <= idx < len(chapters) else []
        else:
            to_download = chapters

        for ch in to_download:
            print(f"\nChapter: {ch['title']}")
            page.goto(ch["url"], wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(1000)

            imgs = []
            for sel in [READER_IMG_SELECTOR, "img"]:
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

            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = []
                for url, dest in zip(imgs, files):
                    if dest.exists() and dest.stat().st_size > 0:
                        continue
                    futures.append(pool.submit(lambda u, d: d.write_bytes(requests.get(u, headers={"User-Agent": USER_AGENT}, timeout=30).content), url, dest))
                for fut in tqdm(futures, desc="  Downloading", unit="pg", leave=False):
                    try:
                        fut.result()
                    except Exception:
                        pass

            if fmt == "cbz":
                cbz = out_base / f"{slugify(ch['title'])}.cbz"
                convert_to_cbz(ch_dir, cbz)
                print(f"  [✓] CBZ ready ({len(imgs)} pages)")
            else:
                print(f"  [✓] Saved {len(imgs)} pages to {ch_dir}")

        browser.close()
    print("\nDone!")


if __name__ == "__main__":
    main()
