#!/usr/bin/env python3
"""
yomikaze_downloader.py - Beautiful terminal-based MangaFire image downloader for YOMIKAZE.

Features:
- Rich terminal UI with progress bars
- Auto-allow popups
- Downloads ALL chapters from chapter 1 to last
- Skips Solo Leveling (already in YOMIKAZE)
- Downloads images directly to YOMIKAZE public/manga/
- Updates scraped.json with local paths
- Proxy rotation support (auto-loads working_proxies.txt)
- Async Playwright for speed

Usage:
    python yomikaze_downloader.py
    python yomikaze_downloader.py --proxy-file working_proxies.txt --workers 8
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import aiohttp
from rich.console import Console
from rich.panel import Panel
from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TaskProgressColumn,
    TextColumn,
    TimeElapsedColumn,
)
from rich.table import Table
from rich.text import Text
from rich.theme import Theme

# YOMIKAZE paths
YOMIKAZE_DIR = Path(r"d:\MANGA MANHUA WEBSITE\YOMIKAZE")
PUBLIC_DIR = YOMIKAZE_DIR / "public"
SCRAPED_JSON = PUBLIC_DIR / "scraped.json"
MANGA_CACHE_DIR = PUBLIC_DIR / "manga"

# Constants
MAX_WORKERS = 8
REQUEST_TIMEOUT = 45
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)
DEFAULT_PROXY_FILE = Path(r"C:\Users\Administrator\Desktop\proxy_checker\working_proxies.txt")

# Rich theme
custom_theme = Theme({
    "info": "cyan",
    "success": "green",
    "warning": "yellow",
    "error": "bold red",
    "highlight": "bold magenta",
    "manga": "bold blue",
})

console = Console(theme=custom_theme)


def slugify(s: str, max_len: int = 80) -> str:
    s = re.sub(r"[^\w\s-]", "", s).strip().lower()
    s = re.sub(r"[\s-]+", "-", s)
    return s[:max_len] or "chapter"


def load_proxies(path: str) -> list[str]:
    p = Path(path)
    if not p.exists():
        console.print(f"[warning]Proxy file not found: {path}[/warning]")
        return []
    proxies = []
    for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line:
            continue
        if "://" not in line:
            line = f"http://{line}"
        if line.startswith(("http://", "https://", "socks5://", "socks4://")):
            proxies.append(line)
    console.print(f"[success]Loaded {len(proxies)} proxies from {path}[/success]")
    return proxies


class ProxyRotator:
    def __init__(self, proxies: list[str]):
        self.proxies = proxies
        self._idx = 0
        self._lock = asyncio.Lock()

    async def next(self) -> str | None:
        if not self.proxies:
            return None
        async with self._lock:
            proxy = self.proxies[self._idx % len(self.proxies)]
            self._idx += 1
            return proxy


async def download_image(
    session: aiohttp.ClientSession,
    url: str,
    dest: Path,
    referer: str,
    semaphore: asyncio.Semaphore,
    proxy_rotator: ProxyRotator | None = None,
    max_retries: int = 3,
) -> bool:
    ext = urlparse(url).path.split(".")[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"):
        ext = "jpg"

    dest = dest.with_suffix(f".{ext}")
    headers = {"User-Agent": USER_AGENT, "Referer": referer}

    async with semaphore:
        for attempt in range(1, max_retries + 1):
            proxy = await proxy_rotator.next() if proxy_rotator else None
            try:
                await asyncio.sleep(random.uniform(0.05, 0.25))
                async with session.get(url, headers=headers, timeout=REQUEST_TIMEOUT, proxy=proxy) as resp:
                    if resp.status == 429:
                        wait = min(10 * attempt, 60)
                        await asyncio.sleep(wait)
                        continue
                    resp.raise_for_status()
                    data = await resp.read()

                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
                return True

            except Exception as exc:
                if attempt == max_retries:
                    raise RuntimeError(f"Failed after {max_retries} attempts: {exc}") from exc
                wait = min(2 * attempt, 20)
                await asyncio.sleep(wait)

    return False


def update_scraped_json(scraped_path: Path, chapter_url: str, local_urls: list[str]):
    try:
        if not scraped_path.exists():
            return
        data = json.loads(scraped_path.read_text(encoding="utf-8"))
        chapters = data.get("chapters", [])
        updated = False
        for ch in chapters:
            if ch.get("url") == chapter_url:
                ch["pages"] = local_urls
                updated = True
                break
        if updated:
            scraped_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        else:
            console.print(f"[warning]Chapter not found in scraped.json: {chapter_url}[/warning]")
    except Exception as exc:
        console.print(f"[error]Failed to update scraped.json: {exc}[/error]")


async def process_chapter(
    chapter_url: str,
    series_id: str,
    chapter_num: float,
    chapter_title: str,
    page_urls: list[str],
    manga_cache_dir: Path,
    semaphore: asyncio.Semaphore,
    session: aiohttp.ClientSession,
    proxy_rotator: ProxyRotator | None = None,
    scraped_json_path: Path | None = None,
) -> list[str]:
    manga_slug = slugify(series_id)
    chapter_slug = f"ch-{chapter_num:03.1f}".replace(".", "-")
    chapter_dir = manga_cache_dir / manga_slug / chapter_slug
    chapter_dir.mkdir(parents=True, exist_ok=True)

    local_urls = []
    tasks = []
    remote_indices = []

    for idx, url in enumerate(page_urls, 1):
        if not url or url.startswith("data:"):
            local_urls.append(url)
            continue
        if url.startswith("/manga/"):
            local_urls.append(url)
            continue

        ext = urlparse(url).path.split(".")[-1].lower()
        if ext not in ("jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"):
            ext = "jpg"
        dest = chapter_dir / f"page-{idx:03d}.{ext}"
        local_url = f"/manga/{manga_slug}/{chapter_slug}/page-{idx:03d}.{ext}"
        local_urls.append(local_url)
        tasks.append(
            download_image(session, url, dest, referer=chapter_url, semaphore=semaphore, proxy_rotator=proxy_rotator)
        )
        remote_indices.append(idx - 1)

    if not tasks:
        console.print(f"[yellow]Skipping {chapter_title} - all pages already local[/yellow]")
        return local_urls

    results = await asyncio.gather(*tasks, return_exceptions=True)

    failed = 0
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            failed += 1
            local_urls[remote_indices[i]] = page_urls[remote_indices[i]]

    saved = len(tasks) - failed
    total_pages = len(page_urls)
    console.print(f"[success]✓[/success] [manga]{chapter_title}[/manga] - [cyan]{saved}/{total_pages}[/cyan] pages saved")

    if saved > 0 and scraped_json_path:
        update_scraped_json(scraped_json_path, chapter_url, local_urls)

    return local_urls


async def async_main(args) -> int:
    console.print(Panel.fit("[bold cyan]YOMIKAZE Image Downloader[/bold cyan]\n[dim]MangaFire -> Local Cache[/dim]", border_style="cyan"))

    # Load proxies
    proxy_file = args.proxy_file or str(DEFAULT_PROXY_FILE)
    proxies = load_proxies(proxy_file)
    proxy_rotator = ProxyRotator(proxies) if proxies else None

    if not SCRAPED_JSON.exists():
        console.print(f"[error]scraped.json not found: {SCRAPED_JSON}[/error]")
        return 1

    # Load data
    console.print(f"[info]Loading scraped.json: {SCRAPED_JSON}[/info]")
    data = json.loads(SCRAPED_JSON.read_text(encoding="utf-8"))
    chapters = data.get("chapters", [])
    if not chapters:
        console.print("[error]No chapters in scraped.json[/error]")
        return 1

    # Sort chapters by number (ascending: 1, 2, 3...)
    chapters.sort(key=lambda c: float(c.get("number", 0)))

    # Filter out Solo Leveling
    original_count = len(chapters)
    chapters = [c for c in chapters if "solo" not in c.get("series_id", "").lower() and "52x0" not in c.get("series_id", "").lower()]
    skipped = original_count - len(chapters)
    console.print(f"[success]Total chapters: {len(chapters)}[/success] [dim](skipped {skipped} Solo Leveling chapters)[/dim]")

    if not chapters:
        console.print("[warning]No chapters to download.[/warning]")
        return 0

    # Show chapter range
    first_ch = chapters[0].get("number", "?")
    last_ch = chapters[-1].get("number", "?")
    console.print(f"[info]Download range: Chapter {first_ch} → Chapter {last_ch}[/info]")

    manga_cache_dir = MANGA_CACHE_DIR
    manga_cache_dir.mkdir(parents=True, exist_ok=True)

    semaphore = asyncio.Semaphore(args.workers)
    connector = aiohttp.TCPConnector(limit=args.workers, ssl=False)
    timeout = aiohttp.ClientTimeout(total=REQUEST_TIMEOUT)

    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            TimeElapsedColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("Starting...", total=len(chapters))

            for ch in chapters:
                chapter_url = ch.get("url", "")
                series_id = ch.get("series_id", "unknown")
                chapter_num = ch.get("number", 0)
                chapter_title = ch.get("title", f"Chapter {chapter_num}")
                page_urls = ch.get("pages", [])

                if not chapter_url or not page_urls:
                    progress.update(task, advance=1)
                    continue

                progress.update(task, description=f"[cyan]{chapter_title}[/cyan]")

                try:
                    await process_chapter(
                        chapter_url,
                        series_id,
                        chapter_num,
                        chapter_title,
                        page_urls,
                        manga_cache_dir,
                        semaphore,
                        session,
                        proxy_rotator,
                        SCRAPED_JSON,
                    )
                except Exception as exc:
                    console.print(f"[error]Failed {chapter_title}: {exc}[/error]")

                progress.update(task, advance=1)

    # Summary table
    table = Table(title="Download Summary", show_header=True, header_style="bold magenta")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="green")

    total_pages = sum(len(c.get("pages", [])) for c in chapters)
    local_pages = sum(1 for c in chapters for url in c.get("pages", []) if url and url.startswith("/manga/"))

    table.add_row("Total Chapters", str(len(chapters)))
    table.add_row("Total Pages", str(total_pages))
    table.add_row("Local Pages", str(local_pages))
    table.add_row("Cache Directory", str(manga_cache_dir))

    console.print(table)
    console.print(f"[success]Done! Open YOMIKAZE at: http://localhost:5174[/success]")

    return 0


def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description="Download ALL MangaFire chapters locally for YOMIKAZE",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--proxy-file", default=str(DEFAULT_PROXY_FILE), help="Path to proxy list file")
    p.add_argument("--workers", type=int, default=MAX_WORKERS, help="Parallel download threads")
    p.add_argument("--timeout", type=int, default=REQUEST_TIMEOUT, help="HTTP request timeout (s)")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    return asyncio.run(async_main(args))


if __name__ == "__main__":
    sys.exit(main())
