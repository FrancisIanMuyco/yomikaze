#!/usr/bin/env python3
"""
scraper_bypass — scraper.py extended with Cloudflare bypass via cf_bypass.

If cf_bypass is running on localhost:8000, all page fetches go through its
/html endpoint so Cloudflare clearance is handled automatically.
If cf_bypass is not available, falls back to direct requests.
"""

from __future__ import annotations

import json
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote_plus, urljoin

import requests
from bs4 import BeautifulSoup

try:
    if sys.stdout and sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if sys.stderr and sys.stderr.encoding and sys.stderr.encoding.lower() not in ("utf-8", "utf8"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

VERSION = "1.0.0"
BYPASS_BASE = "http://localhost:8000"

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

CHAPTER_FALLBACK_SELECTORS = [
    "a.chapter-link",
    "a.chapter-name",
    "a.chapter",
    "li.wp-manga-chapter a",
    "li.chapter a",
    'a[href*="/chapter-"]',
    'a[href*="/chapter/"]',
    'a[href*="read/"]',
    'a[href*="/episode-"]',
]

PAGE_FALLBACK_SELECTORS = [
    "a.chapter-page-link",
    "a[data-page]",
    ".container-chapter-reader img",
    "#readerarea img",
    ".reading-content img",
    ".chapter-content img",
    "img.wp-manga-chapter-img",
]

IMAGE_EXT_RE = re.compile(r"\.(jpe?g|png|webp|gif|avif|bmp)(\?.*)?$", re.I)
IMAGE_MAGIC = (
    b"\xff\xd8\xff",
    b"\x89PNG\r\n\x1a\n",
    b"GIF87a", b"GIF89a",
    b"RIFF",
    b"BM",
)


@dataclass
class Page:
    index: int
    title: str
    url: str
    file: str | None = None

    def to_dict(self) -> dict:
        return {"index": self.index, "title": self.title, "url": self.url, "file": self.file}


@dataclass
class Chapter:
    number: float
    title: str
    url: str
    pages: list[Page] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "number": self.number,
            "title": self.title,
            "url": self.url,
            "pages": [p.to_dict() for p in self.pages],
        }


class BypassScraper:
    def __init__(self, delay: float = 1.0, retries: int = 3, timeout: int = 30):
        self.session = requests.Session()
        self.session.headers.update(DEFAULT_HEADERS)
        self.delay = delay
        self.retries = retries
        self.timeout = timeout
        self.bypass_available = self._check_bypass()

    def _check_bypass(self) -> bool:
        try:
            r = self.session.get(f"{BYPASS_BASE}/html?url=https://example.com", timeout=5)
            return r.status_code == 200
        except Exception:
            return False

    def get(self, url: str) -> requests.Response:
        last_err: Exception | None = None
        for attempt in range(1, self.retries + 1):
            try:
                if self.bypass_available:
                    resp = self._bypass_get(url)
                else:
                    resp = self.session.get(url, timeout=self.timeout)
                if resp.status_code == 200:
                    return resp
                last_err = RuntimeError(f"HTTP {resp.status_code} for {url}")
            except requests.RequestException as exc:
                last_err = exc
            if attempt < self.retries:
                time.sleep(self.delay * attempt)
        raise RuntimeError(f"Failed to fetch {url}: {last_err}")

    def _bypass_get(self, url: str) -> requests.Response:
        encoded = quote_plus(url)
        bypass_url = f"{BYPASS_BASE}/html?url={encoded}"
        resp = self.session.get(bypass_url, timeout=self.timeout)
        if resp.status_code == 200:
            return resp
        raise RuntimeError(f"Bypass returned HTTP {resp.status_code} for {url}")

    def _select_nodes(self, soup, primary, fallbacks, href_fallback=False):
        if primary:
            found = soup.select(primary)
            if found:
                return found
        for sel in fallbacks:
            found = soup.select(sel)
            if found:
                return found
        if href_fallback:
            return [
                a for a in soup.find_all("a", href=True)
                if re.search(r"(chapter|episode|read)(-|/|\d)", a["href"], re.I)
            ]
        return []

    def find_chapters(self, series_url, chapter_selector):
        resp = self.get(series_url)
        soup = BeautifulSoup(resp.text, "html.parser")
        links = self._select_nodes(soup, chapter_selector, CHAPTER_FALLBACK_SELECTORS, href_fallback=True)
        chapters = []
        seen = set()
        for a in links:
            href = a.get("href")
            if not href:
                continue
            url = urljoin(series_url, href)
            if url in seen:
                continue
            seen.add(url)
            text = " ".join(a.get_text(" ", strip=True).split())
            num = self._chapter_number(text, len(chapters))
            chapters.append(Chapter(number=num, title=text or url, url=url))
        chapters.sort(key=lambda c: c.number)
        return chapters

    @staticmethod
    def _chapter_number(text, fallback_index):
        for pattern in (r"chapter\s*(\d+(?:\.\d+)?)", r"(\d+(?:\.\d+)?)"):
            m = re.search(pattern, text, re.I)
            if m:
                return float(m.group(1))
        return float(fallback_index + 1)

    def find_pages(self, chapter, page_selector):
        resp = self.get(chapter.url)
        soup = BeautifulSoup(resp.text, "html.parser")
        nodes = self._select_nodes(soup, page_selector, PAGE_FALLBACK_SELECTORS)
        pages = []
        for i, node in enumerate(nodes, start=1):
            if node.name == "img":
                url = self._img_src(node, chapter.url)
                if not url:
                    continue
                pages.append(Page(index=i, title=node.get("alt") or f"Page {i}", url=url))
                continue
            href = node.get("href")
            url = urljoin(chapter.url, href) if href else ""
            text = " ".join(node.get_text(" ", strip=True).split())
            if not url:
                img = node.find("img")
                if img:
                    url = self._img_src(img, chapter.url)
            if not url:
                continue
            pages.append(Page(index=i, title=text or url, url=url))
        if not pages:
            return self._pages_from_images(soup, chapter.url)
        return pages

    def _pages_from_images(self, soup, base_url):
        images = []
        for img in soup.find_all("img"):
            src = self._img_src(img, base_url)
            if src and src not in images and self._is_page_image(src):
                images.append(src)
        return [Page(index=i, title=f"Page {i}", url=u) for i, u in enumerate(images, start=1)]

    @staticmethod
    def _img_src(img, base_url):
        for attr in ("src", "data-src", "data-original", "data-lazy-src", "data-url"):
            src = img.get(attr)
            if src:
                return urljoin(base_url, src)
        return None

    @staticmethod
    def _is_page_image(url):
        if url.startswith("data:"):
            return False
        return not re.search(r"(logo|icon|banner|avatar|sprite|\.svg)", url, re.I)

    def resolve_page_image(self, page):
        if IMAGE_EXT_RE.search(page.url):
            return page.url
        try:
            resp = self.get(page.url)
        except RuntimeError:
            return page.url
        soup = BeautifulSoup(resp.text, "html.parser")
        images = [
            u for img in soup.find_all("img")
            if (u := self._img_src(img, page.url)) and self._is_page_image(u)
        ]
        return images[0] if images else page.url

    def download_page(self, url, dest):
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() and dest.stat().st_size > 0:
            return
        resp = self.get(url)
        if not any(resp.content.startswith(magic) for magic in IMAGE_MAGIC):
            raise RuntimeError(f"response for {url} is not an image")
        dest.write_bytes(resp.content)


def slugify(s, max_len=60):
    s = re.sub(r"[^\w\s-]", "", s).strip().lower()
    s = re.sub(r"[-\s]+", "-", s)
    return s[:max_len] or "chapter"


def parse_args(argv=None):
    import argparse
    p = argparse.ArgumentParser(description="Scraper with Cloudflare bypass support.")
    p.add_argument("url", help="Series page URL")
    p.add_argument("--output", default="./downloads", help="Folder for manifest + images")
    p.add_argument("--download", action="store_true", help="Download page images")
    p.add_argument("--limit", type=int, default=0, help="Only first N chapters")
    p.add_argument("--delay", type=float, default=1.0, help="Seconds between requests")
    p.add_argument("--retries", type=int, default=3, help="Request retries")
    p.add_argument("--timeout", type=int, default=30, help="Request timeout (s)")
    p.add_argument("--chapter-selector", default=None)
    p.add_argument("--page-selector", default=None)
    p.add_argument("--no-banner", action="store_true")
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)

    banner = f"""
   ____                        ____ ____ ____ ____ ____ ____
  / ___|  __ _ _ __ ___  _ __ / ___/ ___/ ___/ ___/ ___/ ___|
  \\___ \\ / _` | '_ ` _ \\| '_ \\\\___ \\\\___ \\\\___ \\\\___ \\\\___ \\\\___ \\
   ___) | (_| | | | | | | | | |___) |___) |___) |___) |___) |
  |____/ \\__,_|_| |_| |_| |_|_|____/____/____/____/____/____/
  bypass scraper v{VERSION}
"""
    print(banner)

    scraper = BypassScraper(delay=args.delay, retries=args.retries, timeout=args.timeout)
    status = "[DIRECT]" if not scraper.bypass_available else "[BYPASS]"
    print(f"[*] {status} Series: {args.url}\n")

    try:
        chapters = scraper.find_chapters(args.url, args.chapter_selector)
    except RuntimeError as exc:
        print(f"[!] {exc}", file=sys.stderr)
        return 1

    if not chapters:
        print("[!] No chapter links found.", file=sys.stderr)
        return 1

    print(f"[*] Found {len(chapters)} chapters\n")
    if args.limit:
        chapters = chapters[: args.limit]
        print(f"[*] Processing first {len(chapters)} (--limit {args.limit})\n")

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    for ch in chapters:
        print(f"Chapter Title: {ch.title}")
        print(f"Chapter URL:   {ch.url}")
        try:
            ch.pages = scraper.find_pages(ch, args.page_selector)
        except RuntimeError as exc:
            print(f"  [!] {exc}")
            continue
        if not ch.pages:
            print("  [!] No pages found")
            print()
            continue
        for pg in ch.pages:
            image_url = scraper.resolve_page_image(pg)
            if args.download:
                ext = IMAGE_EXT_RE.search(image_url)
                ext = (ext.group(1) if ext else "jpg").lower()
                if ext == "jpeg":
                    ext = "jpg"
                dest = out_dir / slugify(ch.title) / f"page-{pg.index:03d}.{ext}"
                try:
                    scraper.download_page(image_url, dest)
                    pg.file = dest.relative_to(out_dir).as_posix()
                except RuntimeError as exc:
                    print(f"  [!] download failed page {pg.index}: {exc}")
            pg.url = image_url
            print(f"  Chapter Page Title: {pg.title or f'Page {pg.index}'}")
            print(f"  Chapter Page URL:   {image_url}")
        print()

    manifest = {
        "tool": "mangascraper-bypass",
        "version": VERSION,
        "bypass": scraper.bypass_available,
        "series_url": args.url,
        "chapters": [c.to_dict() for c in chapters],
        "total_chapters": len(chapters),
        "total_pages": sum(len(c.pages) for c in chapters),
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"[*] Manifest saved -> {manifest_path}")
    print(f"[*] Chapters: {len(chapters)} · Pages: {manifest['total_pages']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
