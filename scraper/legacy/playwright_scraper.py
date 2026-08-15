#!/usr/bin/env python3
"""
playwright_scraper — JS-rendering chapter downloader (multi-threaded, CBZ/PDF).

Where scraper.py (requests + bs4) cannot see content that needs JavaScript
(Cloudflare challenges, lazy-loading readers, SPA/JS-built sites), this tool
drives a real Chromium browser to render each page, then extracts chapters and
page images and downloads them — with tqdm progress bars, Pillow verification
of every image, optional multi-threaded downloads, and CBZ/PDF export.

Same CLI shape and manifest.json format as scraper.py, so the two tools are
interchangeable for any site:

  python playwright_scraper.py "https://example.com/manga/xxx"                            # scan only
  python playwright_scraper.py "https://example.com/manga/xxx" --download --output ./dl   # raw image folders
  python playwright_scraper.py "https://example.com/manga/xxx" --format cbz --workers 8   # multi-threaded → .cbz per chapter
  python playwright_scraper.py "https://example.com/manga/xxx" --format pdf --chapters 1-5
  python playwright_scraper.py "https://mangafire.to/title/xxx" --all-chapters           # scrape ALL chapters

Browser setup:
  python -m playwright install chromium        # bundled browser (needs ~500 MB disk)
  or pass --channel chrome to use your installed Google Chrome (no extra disk).

Honest caveats:
  * Headless browsers still get caught by the most aggressive anti-bot stacks
    (TLS fingerprinting / Cloudflare Turnstile). If a site blocks you, try
    --headful, and never scrape sites whose ToS you must break.
  * Playwright scrapes the *web frontend* of a site — if it has an official
    API (MangaDex, Jikan), prefer the Scrapy spiders in crawler/ instead.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import sys
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from PIL import Image
from tqdm import tqdm

VERSION = "1.2.0"

# Windows consoles default to cp1252 — force UTF-8 so CJK titles don't crash.
try:
    if sys.stdout and sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if sys.stderr and sys.stderr.encoding and sys.stderr.encoding.lower() not in ("utf-8", "utf8"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BANNER = fr"""\
   ____  _                          __
  / __ \| |                        / /_ _____ ___  ___
 / / _` | |      __ _ _ __  _   _  / // // _ \/ _ \/ _ \
| | (_| | |     / _` | '_ \| | | |/ // //  __/  __/  __/
 \ \__,_|_|    | (_| | |_) | |_| /_//_/ \___|\___|\___/
  \____/      (_)___|_| .__/ \__, /  JS-rendering chapter scraper v{VERSION}
                      |_|    |___/
"""

LEGAL_NOTE = (
    "  [!] Legal note: only scrape sites you are allowed to scrape. Copyrighted\n"
    "      chapters are protected content — check the site's ToS before running.\n"
)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# Fallback selectors tried when the user-supplied selector matches nothing.
CHAPTER_FALLBACK_SELECTORS = [
    "a.chapter-link",  # the classic generic-reader template class
    "a.chapter-name",
    "a.chapter",
    "li.wp-manga-chapter a",
    "li.chapter a",
    'a[href*="/chapter-"]',
    'a[href*="/chapter/"]',
    'a[href*="read/"]',
    'a[href*="/episode-"]',
]

PAGE_LINK_SELECTOR = "a.chapter-page-link, a[data-page]"
READER_IMG_SELECTOR = (
    ".reading-content img, .container-chapter-reader img, #readerarea img, "
    ".chapter-content img, img.wp-manga-chapter-img"
)

IMAGE_EXT_RE = re.compile(r"\.(jpe?g|png|webp|gif|avif|bmp)(\?.*)?$", re.I)
CHROME_HINTS = ("logo", "icon", "banner", "avatar", "sprite", ".svg")

# Extensions accepted when packaging CBZ/PDF.
PACK_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif")


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
    archive: str | None = None  # relative path of packaged .cbz/.pdf, if any

    def to_dict(self) -> dict:
        d = {
            "number": self.number,
            "title": self.title,
            "url": self.url,
            "pages": [p.to_dict() for p in self.pages],
        }
        if self.archive:
            d["archive"] = self.archive
        return d


class BrowserScraper:
    """Playwright-driven scraper: render → extract → download (multi-threaded)."""

    def __init__(self, channel=None, headful=False, delay=1.0, timeout=20, wait=1.0):
        self.channel = channel
        self.headful = headful
        self.delay = delay
        self.timeout = timeout
        self.wait = wait

    # ── browser lifecycle ───────────────────────────────────────────────
    def launch(self, playwright):
        """Launch the best available browser: --channel → bundled → system Chrome."""
        candidates = []
        if self.channel:
            candidates.append({"channel": self.channel, "headless": not self.headful})
        candidates.append({"headless": not self.headful})
        candidates.append({"channel": "chrome", "headless": not self.headful})
        last = None
        for kwargs in candidates:
            try:
                return playwright.chromium.launch(**kwargs)
            except Exception as exc:  # noqa: BLE001 — try the next browser
                last = exc
        raise RuntimeError(
            f"No usable browser. Run `python -m playwright install chromium` "
            f"or use --channel chrome. ({last})"
        )

    def new_page(self, browser):
        context = browser.new_context(
            user_agent=USER_AGENT,
            viewport={"width": 1440, "height": 900},
            locale="en-US",
        )
        return context.new_page()

    # ── navigation ──────────────────────────────────────────────────────
    def goto(self, page, url):
        page.goto(url, wait_until="domcontentloaded", timeout=self.timeout * 1000)
        try:
            page.wait_for_load_state("networkidle", timeout=6000)
        except Exception:  # noqa: BLE001 — networkidle can time out on chatty sites
            pass
        if self.wait > 0:
            page.wait_for_timeout(int(self.wait * 1000))

    # ── chapter discovery ───────────────────────────────────────────────
    def find_chapters(self, page, series_url, chapter_selector):
        self.goto(page, series_url)
        
        # mangafire.to-specific: intercept chapters API to get ALL chapters
        chapters = self._find_chapters_via_api(page, series_url)
        if chapters:
            return chapters
        
        selectors = ([chapter_selector] if chapter_selector else []) + CHAPTER_FALLBACK_SELECTORS
        links = self._collect(page, selectors)

        chapters = []
        seen: set[str] = set()
        for link in links:
            href = link.get("href") or ""
            if not href:
                continue
            url = urljoin(series_url, href)
            if url in seen:
                continue
            seen.add(url)
            text = (link.get("text") or "").strip()
            chapters.append(
                Chapter(number=self._chapter_number(text, len(chapters)), title=text or url, url=url)
            )
        chapters.sort(key=lambda c: c.number)
        return chapters

    def _find_chapters_via_api(self, page, series_url: str) -> list[Chapter]:
        """For mangafire.to: start from latest chapter, then click Previous."""
        parsed = urlparse(series_url)
        if "mangafire.to" not in parsed.netloc or "/title/" not in parsed.path:
            return []
        
        self.goto(page, series_url)
        page.wait_for_timeout(2000)
        
        latest_href = page.evaluate("""() => {
            const links = document.querySelectorAll('a[href*=\"/chapter/\"]');
            return links.length > 0 ? links[0].href : null;
        }""")
        if not latest_href:
            return []
        
        current_url = urljoin(series_url, latest_href)
        chapters: list[Chapter] = []
        seen: set[str] = set()
        max_chapters = 500
        
        for _ in range(max_chapters):
            if not current_url or current_url in seen:
                break
            seen.add(current_url)
            
            page.goto(current_url, wait_until="domcontentloaded", timeout=self.timeout * 1000)
            page.wait_for_timeout(1500)
            self._scroll_to_bottom(page)
            
            ch_num = page.evaluate("""() => {
                const text = document.body.innerText;
                const match = text.match(/Ch\\.\\s*(\\d+)/);
                return match ? parseInt(match[1]) : null;
            }""")
            
            chapter_url = page.evaluate("window.location.href")
            
            if ch_num is not None:
                chapter = Chapter(
                    number=float(ch_num),
                    title=f"Ch. {ch_num}",
                    url=chapter_url,
                )
                try:
                    chapter.pages = self._extract_pages_from_current(page, chapter_url)
                except Exception:
                    pass
                chapters.append(chapter)
            
            has_prev = page.evaluate("""() => {
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
            
            page.wait_for_timeout(2500)
            current_url = page.evaluate("window.location.href")
        
        chapters.sort(key=lambda c: c.number)
        return chapters

    def _extract_pages_from_current(self, page, base_url: str) -> list[Page]:
        self._scroll_to_bottom(page)
        selector = READER_IMG_SELECTOR
        imgs = self._extract_imgs(page, base_url, selector)
        if imgs:
            return [Page(index=i, title=f"Page {i}", url=u) for i, u in enumerate(imgs, 1)]
        return []

    # ── page discovery ──────────────────────────────────────────────────
    def find_pages(self, page, chapter, page_selector):
        self.goto(page, chapter.url)
        page.wait_for_timeout(300)
        self._scroll_to_bottom(page)

        # 1) page links pointing straight at image files
        try:
            hrefs = page.eval_on_selector_all(
                page_selector or PAGE_LINK_SELECTOR,
                "els => els.map(e => e.href).filter(Boolean)",
            )
        except Exception:  # noqa: BLE001 — malformed selector
            hrefs = []
        direct = [urljoin(chapter.url, h) for h in hrefs if IMAGE_EXT_RE.search(h)]
        if direct:
            return [Page(index=i, title=f"Page {i}", url=u) for i, u in enumerate(direct, 1)]

        # 2) <img> tags inside reader containers (or any real-looking page image)
        selector = page_selector or READER_IMG_SELECTOR
        imgs = self._extract_imgs(page, chapter.url, selector)
        if imgs:
            return [Page(index=i, title=f"Page {i}", url=u) for i, u in enumerate(imgs, 1)]

        # 3) HTML page links → resolve each page's first real image by navigating
        if hrefs:
            pages: list[Page] = []
            for href in hrefs:
                u = urljoin(chapter.url, href)
                img = self._resolve_html_page(page, u)
                pages.append(Page(index=len(pages) + 1, title=f"Page {len(pages) + 1}", url=img or u))
            return pages
        return []

    def _resolve_html_page(self, page, url):
        try:
            self.goto(page, url)
            # Known reader containers first, then any <img> (many readers use
            # arbitrary wrapper divs — e.g. <div class="page"><img …>).
            for selector in (READER_IMG_SELECTOR, "img"):
                imgs = self._extract_imgs(page, url, selector)
                if imgs:
                    return imgs[0]
            return url
        except Exception:
            return url

    # ── helpers ─────────────────────────────────────────────────────────
    def _collect(self, page, selectors):
        """Try each selector in order; return the first non-empty list."""
        for selector in selectors:
            try:
                nodes = page.query_selector_all(selector)
            except Exception:
                continue
            if nodes:
                return [
                    {"href": n.get_attribute("href"), "text": (n.inner_text() or "").strip()}
                    for n in nodes
                ]
        return []

    def _scroll_to_bottom(self, page):
        prev = 0
        for _ in range(40):
            page.evaluate("window.scrollBy(0, window.innerHeight)")
            page.wait_for_timeout(250)
            cur = page.evaluate("document.body.scrollHeight")
            if cur == prev:
                break
            prev = cur

    def _extract_imgs(self, page, base_url, selector):
        try:
            imgs = page.query_selector_all(f"{selector} img")
        except Exception:
            imgs = []
        if not imgs:
            try:
                imgs = page.query_selector_all(selector)
            except Exception:
                return []
        urls = []
        for img in imgs:
            src = img.get_attribute("src") or img.get_attribute("data-src") or ""
            if not src:
                continue
            full = urljoin(base_url, src)
            if not any(hint in full.lower() for hint in CHROME_HINTS) and full not in urls:
                urls.append(full)
        return urls

    @staticmethod
    def _chapter_number(text, fallback_index):
        for pattern in (r"chapter\s*(\d+(?:\.\d+)?)", r"(\d+(?:\.\d+)?)"):
            m = re.search(pattern, text, re.I)
            if m:
                try:
                    return float(m.group(1))
                except ValueError:
                    pass
        return float(fallback_index + 1)

    # ── download ─────────────────────────────────────────────────────────
    def download_chapter(self, chapter, out_dir, fmt, workers, progress):
        """Download pages for one chapter, optionally package to CBZ/PDF."""
        if not chapter.pages:
            return 0

        chapter_dir = out_dir / slugify(chapter.title)
        chapter_dir.mkdir(parents=True, exist_ok=True)

        urls = []
        files = []
        for pg in chapter.pages:
            ext = _ext_for_url(pg.url)
            dest = chapter_dir / f"page-{pg.index:03d}.{ext}"
            urls.append(pg.url)
            files.append(dest)

        failed = 0
        if workers > 1:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = {pool.submit(self._download_one, url, dest): dest for url, dest in zip(urls, files)}
                for fut in tqdm(as_completed(futures), total=len(futures), desc=f"    [⚡] Downloading ({workers} threads)", unit="pg", leave=False, disable=not progress):
                    try:
                        fut.result()
                    except Exception:  # noqa: BLE001
                        failed += 1
        else:
            for url, dest in tqdm(zip(urls, files), total=len(urls), desc="    [⬇] Downloading", unit="pg", leave=False, disable=not progress):
                try:
                    self._download_one(url, dest)
                except Exception:  # noqa: BLE001
                    failed += 1

        chapter.archive = None
        if fmt == "cbz":
            cbz_name = f"{slugify(chapter.title)}.cbz"
            cbz_path = out_dir / cbz_name
            count = convert_to_cbz(chapter_dir, cbz_path)
            if count:
                chapter.archive = cbz_name
                shutil.rmtree(chapter_dir, ignore_errors=True)
        elif fmt == "pdf":
            pdf_name = f"{slugify(chapter.title)}.pdf"
            pdf_path = out_dir / pdf_name
            count = convert_to_pdf(chapter_dir, pdf_path)
            if count:
                chapter.archive = pdf_name
                shutil.rmtree(chapter_dir, ignore_errors=True)

        return failed

    def _download_one(self, url, dest):
        if dest.exists() and dest.stat().st_size > 0:
            return
        resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
        try:
            Image.open(dest).verify()
        except Exception as exc:
            dest.unlink(missing_ok=True)
            raise RuntimeError(f"bad image {url}: {exc}") from exc


# ── helpers ─────────────────────────────────────────────────────────────
def _ext_for_url(url: str) -> str:
    """Best-effort image extension from a URL path, falling back to jpg."""
    ext = os.path.splitext(urlparse(url).path)[1].lstrip(".").lower()
    if ext in ("jpg", "jpeg", "png", "webp", "gif", "avif", "bmp"):
        return "jpg" if ext == "jpeg" else ext
    return "jpg"


def convert_to_cbz(folder: Path, cbz_path: Path) -> int:
    """Zip all images in folder into a .cbz (images at zip root, page order)."""
    image_files = sorted(
        f for f in folder.iterdir() if f.suffix.lower() in PACK_EXTENSIONS
    )
    if not image_files:
        return 0
    with zipfile.ZipFile(cbz_path, "w", zipfile.ZIP_DEFLATED) as cbz:
        for file in tqdm(image_files, desc="    [📦] Packaging to CBZ", leave=False):
            cbz.write(file, arcname=file.name)
    return len(image_files)


def convert_to_pdf(folder: Path, pdf_path: Path) -> int:
    """Convert all images in folder into a single .pdf (page order = filename)."""
    image_files = sorted(
        f for f in folder.iterdir() if f.suffix.lower() in PACK_EXTENSIONS
    )
    pages: list[Image.Image] = []
    for path in tqdm(image_files, desc="    [📄] Preparing PDF pages", leave=False):
        try:
            img = Image.open(path)
            # CMYK scans (common!) cannot be embedded in PDFs by Pillow.
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            pages.append(img)
        except Exception:  # noqa: BLE001 — skip unreadable image
            continue
    if not pages:
        return 0
    pages[0].save(pdf_path, save_all=True, append_images=pages[1:])
    return len(pages)


def parse_chapter_selection(spec: str | None, count: int) -> list[int]:
    """Parse 'ALL', '1-5', '1,3', or '3' into a list of chapter indexes."""
    spec = (spec or "ALL").strip().upper()
    if spec == "ALL":
        return list(range(count))
    if "-" in spec:
        try:
            start, end = (int(x) for x in spec.split("-", 1))
        except ValueError:
            return []
        return [i for i in range(start - 1, end) if 0 <= i < count]
    if "," in spec:
        out = []
        for part in spec.split(","):
            p = part.strip()
            if p.isdigit():
                i = int(p) - 1
                if 0 <= i < count:
                    out.append(i)
        return list(dict.fromkeys(out))  # dedupe, keep order
    if spec.isdigit():
        i = int(spec) - 1
        return [i] if 0 <= i < count else []
    return []


def slugify(s, max_len=60):
    s = re.sub(r"[^\w\s-]", "", s).strip().lower()
    s = re.sub(r"[\s-]+", "-", s)
    return s[:max_len] or "chapter"


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Render JS-heavy manga pages with Playwright and download chapters.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("url", help="Series page URL")
    p.add_argument("--output", default="./downloads", help="Folder for manifest + images")
    p.add_argument("--download", action="store_true", help="Download page images")
    p.add_argument(
        "--format",
        choices=["folder", "cbz", "pdf"],
        default="folder",
        help="Output format: raw image folder, CBZ, or PDF (implies --download)",
    )
    p.add_argument(
        "--workers",
        type=int,
        default=8,
        help="Parallel download threads per chapter (1 disables threading)",
    )
    p.add_argument(
        "--chapters",
        default=None,
        help="Which chapters to process: ALL, range '1-5', list '1,3', or single '3'",
    )
    p.add_argument("--limit", type=int, default=0, help="Only process the first N chapters")
    p.add_argument("--delay", type=float, default=1.0, help="Seconds between chapters")
    p.add_argument("--timeout", type=int, default=20, help="Navigation timeout (s)")
    p.add_argument("--wait", type=float, default=1.0, help="Extra seconds to let readers settle")
    p.add_argument("--chapter-selector", default=None, help="CSS selector for chapter links")
    p.add_argument("--page-selector", default=None, help="CSS selector for page links/images")
    p.add_argument("--channel", default=None, help="Browser channel (e.g. 'chrome' for system Chrome)")
    p.add_argument("--headful", action="store_true", help="Show the browser window")
    p.add_argument("--no-progress", action="store_true", help="Disable tqdm progress bars")
    p.add_argument("--no-banner", action="store_true", help="Hide banner + legal note")
    p.add_argument("--all-chapters", action="store_true", help="Scrape ALL chapters (mangafire.to: uses prev-button navigation)")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)

    if not args.no_banner:
        print(BANNER)
        print(LEGAL_NOTE)

    # Imported lazily so --help works even if Playwright isn't installed yet.
    from playwright.sync_api import sync_playwright

    scraper = BrowserScraper(
        channel=args.channel,
        headful=args.headful,
        delay=args.delay,
        timeout=args.timeout,
        wait=args.wait,
    )

    print(f"[*] Series: {args.url}\n")

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)
    progress = not args.no_progress

    with sync_playwright() as pw:
        browser = scraper.launch(pw)
        page = scraper.new_page(browser)
        try:
            try:
                if args.all_chapters:
                    chapters = scraper._find_chapters_via_api(page, args.url)
                else:
                    chapters = scraper.find_chapters(page, args.url, args.chapter_selector)
            except Exception as exc:  # noqa: BLE001 — blocked site / bad URL
                print(f"[!] Could not load the series page: {exc}", file=sys.stderr)
                print(
                    "    The site may be blocking automated browsers, or the URL "
                    "may be wrong. Try --headful or --channel chrome.",
                    file=sys.stderr,
                )
                return 1

            if not chapters:
                print(
                    "[!] No chapter links found — the site may use a different "
                    "structure, or its anti-bot blocked headless browsing. Try "
                    "--headful or a custom --chapter-selector.",
                    file=sys.stderr,
                )
                return 1

            print(f"[*] Found {len(chapters)} chapters\n")
            if args.limit:
                args.limit = max(0, args.limit)
                chapters = chapters[: args.limit]
                print(f"[*] Processing first {len(chapters)} (--limit {args.limit})\n")
            if args.chapters:
                selected = parse_chapter_selection(args.chapters, len(chapters))
                if not selected:
                    print("[!] Invalid --chapters selection — nothing to process.", file=sys.stderr)
                    return 1
                chapters = [chapters[i] for i in selected]
                print(f"[*] Processing {len(chapters)} selected chapter(s)\n")

            do_download = args.download or args.format != "folder"
            for ch in tqdm(chapters, desc="Chapters", unit="ch", disable=not progress):
                print(f"\nChapter Title: {ch.title}")
                print(f"Chapter URL:   {ch.url}")
                try:
                    if not ch.pages:
                        ch.pages = scraper.find_pages(page, ch, args.page_selector)
                except Exception as exc:  # noqa: BLE001 — keep going on failures
                    print(f"  [!] {exc}")
                    continue
                if not ch.pages:
                    print("  [!] No pages found in this chapter")
                    continue
                if do_download:
                    failed = scraper.download_chapter(
                        ch, out_dir, args.format, args.workers, progress
                    )
                    if failed:
                        print(f"  [!] {failed} page download(s) failed")
                for pg in ch.pages:
                    print(f"    Chapter Page Title: {pg.title or f'Page {pg.index}'}")
                    print(f"    Chapter Page URL:   {pg.url}")
                if args.delay > 0 and ch is not chapters[-1]:
                    time.sleep(args.delay)
        finally:
            browser.close()

    manifest = {
        "tool": "playwright_scraper",
        "version": VERSION,
        "series_url": args.url,
        "chapters": [c.to_dict() for c in chapters],
        "total_chapters": len(chapters),
        "total_pages": sum(len(c.pages) for c in chapters),
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n[*] Manifest saved → {manifest_path}")
    print(f"[*] Chapters: {len(chapters)} · Pages: {manifest['total_pages']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
