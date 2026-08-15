#!/usr/bin/env python3
"""image_extractor — async Playwright image URL extractor for manhua chapters."""

from __future__ import annotations

import asyncio
import aiohttp
import json
import logging
import os
import random
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urljoin, urlparse

from playwright.async_api import Browser, BrowserContext, Page, Playwright, async_playwright
from tqdm.asyncio import tqdm

logger = logging.getLogger("image_extractor")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

BLOCKED_RESOURCE_TYPES = {"stylesheet", "font", "media"}

# Extensions that indicate a direct image URL
IMAGE_EXT_RE = re.compile(r"\.(jpe?g|png|webp|gif|avif|bmp)(\?.*)?$", re.I)

# Patterns that indicate the URL is NOT a page image (logos, icons, ads, etc.)
EXCLUDE_PATTERNS = re.compile(
    r"(logo|icon|banner|avatar|sprite|thumb|ad-|ads|google|analytics|tracking|\.svg)",
    re.I,
)

# Default reader selectors tried in order until images are found
READER_IMG_SELECTORS = [
    ".reading-content img",
    ".container-chapter-reader img",
    "#readerarea img",
    ".chapter-content img",
    "img.wp-manga-chapter-img",
    ".reader img",
    "img",
]


@dataclass
class ChapterInfo:
    """Metadata for a single chapter."""

    url: str
    title: str
    image_urls: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "title": self.title,
            "total_pages": len(self.image_urls),
            "pages": self.image_urls,
        }


@dataclass
class MangaInfo:
    """Metadata for a manga series."""

    title: str
    base_url: str
    chapters: list[ChapterInfo] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "manga_title": self.title,
            "base_url": self.base_url,
            "total_chapters": len(self.chapters),
            "chapters": [ch.to_dict() for ch in self.chapters],
        }


class SiteAdapter:
    """Base adapter for site-specific scraping logic."""

    name: str = "generic"
    chapter_link_selector: str | None = None
    page_image_selector: str | None = None
    requires_js_navigation: bool = False

    def __init__(self, delay: float = 1.0, retries: int = 3, timeout: int = 30):
        self.delay = delay
        self.retries = retries
        self.timeout = timeout

    async def discover_chapters(self, page: Page, series_url: str) -> list[dict]:
        """Return list of {"url": ..., "title": ...} for chapters."""
        raise NotImplementedError

    def filter_image_url(self, url: str) -> bool:
        """Return True if URL looks like a real page image."""
        if not url or url.startswith("data:"):
            return False
        if EXCLUDE_PATTERNS.search(url):
            return False
        return True


class GenericAdapter(SiteAdapter):
    """Adapter that uses CSS selectors and fallbacks."""

    CHAPTER_FALLBACKS = [
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

    async def discover_chapters(self, page: Page, series_url: str) -> list[dict]:
        selectors = (
            [self.chapter_link_selector] if self.chapter_link_selector else []
        ) + self.CHAPTER_FALLBACKS

        for sel in selectors:
            try:
                nodes = await page.query_selector_all(sel)
            except Exception:
                continue
            if nodes:
                chapters = []
                seen: set[str] = set()
                for node in nodes:
                    href = await node.get_attribute("href")
                    if not href:
                        continue
                    url = urljoin(series_url, href)
                    if url in seen:
                        continue
                    seen.add(url)
                    text = (await node.inner_text()) or ""
                    title = " ".join(text.split()) or url
                    chapters.append({"url": url, "title": title})
                if chapters:
                    return chapters

        # Fallback: scan all anchors for chapter-like hrefs
        anchors = await page.query_selector_all("a[href]")
        chapters = []
        seen = set()
        for a in anchors:
            href = await a.get_attribute("href")
            if not href:
                continue
            url = urljoin(series_url, href)
            if url in seen:
                continue
            if re.search(r"(chapter|episode|read)(-|/|\d)", href, re.I):
                seen.add(url)
                text = (await a.inner_text()) or ""
                title = " ".join(text.split()) or url
                chapters.append({"url": url, "title": title})
        return chapters


class ImageExtractor:
    """Extracts image URLs from manhua chapter pages using Playwright."""

    def __init__(
        self,
        adapter: SiteAdapter | None = None,
        headless: bool = True,
        browser_channel: str | None = None,
        slow_mo: int = 0,
        output_dir: str = "manga_data",
    ):
        self.adapter = adapter or GenericAdapter()
        self.headless = headless
        self.browser_channel = browser_channel
        self.slow_mo = slow_mo
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    async def _setup_browser(self, playwright: Playwright) -> tuple[Browser, BrowserContext]:
        browser = await playwright.chromium.launch(
            headless=self.headless,
            channel=self.browser_channel,
            slow_mo=self.slow_mo,
        )
        context = await browser.new_context(
            user_agent=USER_AGENT,
            viewport={"width": 1440, "height": 900},
            locale="en-US",
            java_script_enabled=True,
        )
        return browser, context

    async def _block_resources(self, page: Page) -> None:
        """Block heavy non-essential resources for faster loading."""

        async def route_handler(route):
            req = route.request
            if req.resource_type in BLOCKED_RESOURCE_TYPES:
                await route.abort()
            else:
                await route.continue_()

        await page.route("**/*", route_handler)

    async def _auto_scroll(self, page: Page, pause: float = 2.0, max_scrolls: int = 50) -> None:
        """Scroll to bottom to trigger lazy-loaded images."""
        last_height = await page.evaluate("document.body.scrollHeight")
        scrolls = 0
        while scrolls < max_scrolls:
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await asyncio.sleep(pause)
            new_height = await page.evaluate("document.body.scrollHeight")
            if new_height == last_height:
                break
            last_height = new_height
            scrolls += 1

    async def _extract_img_srcs(self, page: Page) -> list[str]:
        """Extract image URLs from the page using multiple strategies."""
        urls: set[str] = set()

        # Strategy 1: query all img elements
        img_elements = await page.query_selector_all("img")
        for el in img_elements:
            for attr in ("src", "data-src", "data-original", "data-lazy-src", "data-url"):
                src = await el.get_attribute(attr)
                if src:
                    full_url = urljoin(page.url, src)
                    urls.add(full_url)

        # Strategy 2: srcset attribute
        srcset_elements = await page.query_selector_all("img[srcset]")
        for el in srcset_elements:
            srcset = await el.get_attribute("srcset")
            if srcset:
                for part in srcset.split(","):
                    url = part.strip().split()[0]
                    full_url = urljoin(page.url, url)
                    urls.add(full_url)

        # Strategy 3: open graph / twitter meta tags
        for prop in ("og:image", "twitter:image"):
            meta = await page.query_selector(f'meta[property="{prop}"], meta[name="{prop}"]')
            if meta:
                content = await meta.get_attribute("content")
                if content:
                    urls.add(urljoin(page.url, content))

        return list(urls)

    async def _select_reader_images(self, page: Page, chapter_url: str) -> list[str]:
        """Try site-specific selectors first, then fall back to generic extraction."""
        for selector in READER_IMG_SELECTORS:
            try:
                nodes = await page.query_selector_all(selector)
            except Exception:
                continue

            if not nodes:
                continue

            urls: set[str] = set()
            for el in nodes:
                for attr in ("src", "data-src", "data-original", "data-lazy-src", "data-url"):
                    src = await el.get_attribute(attr)
                    if src:
                        urls.add(urljoin(chapter_url, src))

                srcset = await el.get_attribute("srcset")
                if srcset:
                    for part in srcset.split(","):
                        url = part.strip().split()[0]
                        urls.add(urljoin(chapter_url, url))

            filtered = [u for u in urls if self.adapter.filter_image_url(u)]
            if filtered:
                return filtered

        return []

    async def _download_image(self, session: aiohttp.ClientSession, url: str, dest: Path, semaphore: asyncio.Semaphore) -> None:
        """Download a single image with retry logic."""
        async with semaphore:
            for attempt in range(1, self.adapter.retries + 1):
                try:
                    async with session.get(url, follow_redirects=True, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                        if resp.status != 200:
                            raise RuntimeError(f"HTTP {resp.status}")
                        data = await resp.read()
                        if not data or len(data) < 1024:
                            raise RuntimeError("Empty or too small response")
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        dest.write_bytes(data)
                        return
                except Exception as exc:
                    if attempt < self.adapter.retries:
                        await asyncio.sleep(self.adapter.delay * attempt)
                    else:
                        logger.warning("Failed to download %s: %s", url, exc)

    async def extract_chapter(
        self,
        page: Page,
        session: aiohttp.ClientSession,
        chapter_url: str,
        chapter_title: str,
        download_images: bool = False,
        download_limit: int = 0,
    ) -> ChapterInfo:
        """Extract image URLs from a single chapter page."""
        logger.info("Navigating to %s", chapter_url)
        await page.goto(chapter_url, wait_until="domcontentloaded", timeout=self.adapter.timeout * 1000)
        await asyncio.sleep(1)  # let JS settle

        # Auto-scroll for lazy loading
        await self._auto_scroll(page)

        # Try reader-specific selectors first
        image_urls = await self._select_reader_images(page, chapter_url)

        # Fallback: generic img extraction
        if not image_urls:
            image_urls = await self._extract_img_srcs(page)
            image_urls = [u for u in image_urls if self.adapter.filter_image_url(u)]

        # Deduplicate while preserving order
        seen: set[str] = set()
        deduped: list[str] = []
        for u in image_urls:
            if u not in seen:
                seen.add(u)
                deduped.append(u)

        logger.info("Found %d images in %s", len(deduped), chapter_title)
        chapter = ChapterInfo(url=chapter_url, title=chapter_title, image_urls=deduped)

        if download_images and deduped:
            limit = download_limit if download_limit > 0 else len(deduped)
            to_download = deduped[:limit]
            semaphore = asyncio.Semaphore(5)

            tasks = []
            for i, img_url in enumerate(to_download, start=1):
                ext = "jpg"
                match = IMAGE_EXT_RE.search(img_url)
                if match:
                    ext = match.group(1).lower()
                    ext = "jpg" if ext == "jpeg" else ext
                filename = f"page-{i:03d}.{ext}"
                dest = self.output_dir / chapter_title / filename
                tasks.append(self._download_image(session, img_url, dest, semaphore))

            if tasks:
                await tqdm.gather(*tasks, desc=f"  Downloading {chapter_title}")

        return chapter

    async def run(
        self,
        chapters: list[dict[str, str]],
        manga_title: str,
        download_images: bool = False,
        download_limit: int = 0,
    ) -> MangaInfo:
        """Run extraction for all chapters."""
        manga = MangaInfo(title=manga_title, base_url=chapters[0]["url"] if chapters else "")

        async with async_playwright() as p:
            browser, context = await self._setup_browser(p)

            async with aiohttp.ClientSession(
                headers={"User-Agent": USER_AGENT},
                connector=aiohttp.TCPConnector(limit=10),
            ) as session:
                try:
                    for i, ch in enumerate(chapters):
                        if i > 0:
                            await asyncio.sleep(self.adapter.delay)

                        page = await context.new_page()
                        await self._block_resources(page)

                        try:
                            chapter_info = await self.extract_chapter(
                                page,
                                session,
                                ch["url"],
                                ch.get("title", f"Chapter {i+1}"),
                                download_images=download_images,
                                download_limit=download_limit,
                            )
                            manga.chapters.append(chapter_info)
                        finally:
                            await page.close()
                finally:
                    await context.close()
                    await browser.close()

        return manga

    def save_manifest(self, manga: MangaInfo, output_path: str | None = None) -> Path:
        """Save manga manifest to JSON."""
        if output_path is None:
            output_path = self.output_dir / "manifest.json"
        else:
            output_path = Path(output_path)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(manga.to_dict(), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        logger.info("Manifest saved to %s", output_path)
        return output_path


def slugify(s: str, max_len: int = 60) -> str:
    s = re.sub(r"[^\w\s-]", "", s).strip().lower()
    s = re.sub(r"[\s-]+", "-", s)
    return s[:max_len] or "chapter"


def run_scraper(
    chapters: list[dict[str, str]],
    manga_title: str,
    output_dir: str = "manga_data",
    download_images: bool = False,
    download_limit: int = 0,
    headless: bool = True,
    browser_channel: str | None = None,
    delay: float = 1.0,
    retries: int = 3,
    timeout: int = 30,
) -> MangaInfo:
    """Synchronous wrapper for running the async extractor."""
    extractor = ImageExtractor(
        adapter=GenericAdapter(delay=delay, retries=retries, timeout=timeout),
        headless=headless,
        browser_channel=browser_channel,
        output_dir=output_dir,
    )
    return asyncio.run(
        extractor.run(
            chapters,
            manga_title,
            download_images=download_images,
            download_limit=download_limit,
        )
    )
