#!/usr/bin/env python3
"""
scraper_main.py — Premium manga/manhua scraper with proxies, progressbar, and nice cmd design.

Usage:
    python scraper_main.py "https://mangafire.to/title/xxx"
    python scraper_main.py --batch urls.txt
    python scraper_main.py --proxy-file working_proxies.txt
    python scraper_main.py --proxy-dir "C:\path\to\proxy_checker"
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urljoin, urlparse

# Force UTF-8 on Windows consoles
try:
    if sys.stdout and sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if sys.stderr and sys.stderr.encoding and sys.stderr.encoding.lower() not in ("utf-8", "utf8"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# ── ANSI colors (works on Windows 10+ cmd.exe) ──────────────────────────────
class Colors:
    HEADER = "\033[95m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    END = "\033[0m"
    BOLD = "\033[1m"
    UNDERLINE = "\033[4m"
    DIM = "\033[2m"

def c(text: str, color: str) -> str:
    return f"{color}{text}{Colors.END}"

# ── Banner ──────────────────────────────────────────────────────────────────
BANNER = f"""
{c("╔══════════════════════════════════════════════════════════════════════╗", Colors.HEADER)}
{c("║", Colors.HEADER)} {c("███╗", Colors.BLUE)}   {c("██╗", Colors.CYAN)}  {c("██████╗", Colors.BLUE)} {c("██╗", Colors.CYAN)}   {c("██████╗", Colors.BLUE)} {c("██╗", Colors.CYAN)}   {c("██████╗", Colors.BLUE)} {c("██╗", Colors.CYAN)}   {c("██████╗", Colors.BLUE)} {c("██╗", Colors.CYAN)}        {c("║", Colors.HEADER)}
{c("║", Colors.HEADER)} {c("████╗", Colors.BLUE)}  {c("██║", Colors.CYAN)}  {c("██╔═══██╗", Colors.BLUE)}{c("██║", Colors.CYAN)}  {c("██╔═══██╗", Colors.BLUE)}{c("██║", Colors.CYAN)}  {c("██╔═══██╗", Colors.BLUE)}{c("██║", Colors.CYAN)}  {c("██╔═══██╗", Colors.BLUE)}{c("██║", Colors.CYAN)}        {c("║", Colors.HEADER)}
{c("║", Colors.HEADER)} {c("██╔██╗", Colors.BLUE)}{c("██║", Colors.CYAN)}  {c("██║", Colors.BLUE)}   {c("██║", Colors.CYAN)}  {c("██║", Colors.BLUE)}   {c("██║", Colors.CYAN)}  {c("██║", Colors.BLUE)}   {c("██║", Colors.CYAN)}  {c("██║", Colors.BLUE)}   {c("██║", Colors.CYAN)}  {c("██║", Colors.BLUE)}   {c("██║", Colors.CYAN)}  {c("██████╔╝", Colors.BLUE)}{c("██║", Colors.CYAN)}        {c("║", Colors.HEADER)}
{c("║", Colors.HEADER)} {c("██║╚██╗", Colors.BLUE)}{c("██║", Colors.CYAN)}  {c("██║", Colors.BLUE)}   {c("██║", Colors.CYAN)}  {c("██║", Colors.BLUE)}   {c("██║", Colors.CYAN)}  {c("██║", Colors.BLUE)}   {c("██║", Colors.CYAN)}  {c("██║", Colors.BLUE)}   {c("██║", Colors.CYAN)}  {c("██║", Colors.BLUE)}   {c("██║", Colors.CYAN)}  {c("██╔═══██╗", Colors.BLUE)}{c("██║", Colors.CYAN)}        {c("║", Colors.HEADER)}
{c("║", Colors.HEADER)} {c("██║", Colors.BLUE)} {c("╚████║", Colors.BLUE)}  {c("██████╔╝", Colors.BLUE)} {c("██║", Colors.CYAN)}  {c("██████╔╝", Colors.BLUE)} {c("██║", Colors.CYAN)}  {c("██████╔╝", Colors.BLUE)} {c("██║", Colors.CYAN)}  {c("██║", Colors.BLUE)}   {c("██║", Colors.CYAN)}  {c("██║", Colors.BLUE)}   {c("██║", Colors.CYAN)} {c("██████╔╝", Colors.BLUE)} {c("██║", Colors.CYAN)}        {c("║", Colors.HEADER)}
{c("║", Colors.HEADER)} {c("╚═╝", Colors.BLUE)}  {c("╚═══╝", Colors.BLUE)}   {c("╚════╝", Colors.BLUE)}  {c("╚═╝", Colors.CYAN)}   {c("╚════╝", Colors.BLUE)}  {c("╚═╝", Colors.CYAN)}   {c("╚════╝", Colors.BLUE)}  {c("╚═╝", Colors.CYAN)}   {c("╚═╝", Colors.BLUE)}   {c("╚═╝", Colors.CYAN)}  {c("╚════╝", Colors.BLUE)}  {c("╚═╝", Colors.CYAN)}        {c("║", Colors.HEADER)}
{c("║", Colors.HEADER)}                                                                          {c("║", Colors.HEADER)}
{c("║", Colors.HEADER)}      {c("MANGA / MANHUA / MANHWA", Colors.GREEN)} {c("SCRAPER", Colors.YELLOW)} {c("v2.0", Colors.CYAN)}               {c("║", Colors.HEADER)}
{c("╚══════════════════════════════════════════════════════════════════════╝", Colors.HEADER)}
"""

LEGAL_NOTE = (
    f"\n{c('[!] Legal note:', Colors.YELLOW)} {c('Only scrape sites you are allowed to scrape.', Colors.CYAN)}\n"
    f"      Copyrighted chapters are protected content — check the site's ToS before running.\n"
)

# ── Skip list ───────────────────────────────────────────────────────────────
SKIP_TITLES = ["solo leveling", "solo-leveling"]

# ── Proxy loader ────────────────────────────────────────────────────────────
def load_proxies(proxy_file: str | None = None, proxy_dir: str | None = None) -> list[str]:
    proxies = []
    if proxy_file and Path(proxy_file).exists():
        with open(proxy_file, "r", encoding="utf-8") as f:
            proxies = [line.strip() for line in f if line.strip() and not line.startswith("#")]
        print(f"[*] Loaded {len(proxies)} proxies from {proxy_file}")
        return proxies

    if proxy_dir:
        files = ["proxies_http.txt", "proxies_https.txt", "proxies_socks4.txt", "proxies_socks5.txt"]
        for fname in files:
            fpath = Path(proxy_dir) / fname
            if fpath.exists():
                with open(fpath, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#"):
                            proxies.append(line)
        if proxies:
            print(f"[*] Loaded {len(proxies)} proxies from {proxy_dir}")
        return proxies

    default_dir = Path(__file__).parent.parent / "proxy_checker"
    if default_dir.exists():
        return load_proxies(proxy_dir=str(default_dir))

    return []

# ── URL checker ─────────────────────────────────────────────────────────────
def check_url_alive(url: str, timeout: int = 15) -> bool:
    try:
        import requests
        resp = requests.head(url, allow_redirects=True, timeout=timeout,
                             headers={"User-Agent": "Mozilla/5.0"})
        return resp.status_code < 400
    except Exception:
        return False

def should_skip(url: str) -> tuple[bool, str]:
    """Return (should_skip, reason)."""
    parsed = urlparse(url)
    path = parsed.path.lower()
    if "solo-leveling" in path or "solo_leveling" in path:
        return True, "Already available in YOMIKAZE"
    return False, ""

# ── Scrape one URL (integrated Playwright + proxy) ──────────────────────────
def scrape_one(url: str, proxy: str | None, output_dir: Path, headful: bool = False, proxy_list: list[str] | None = None) -> dict:
    """Run Playwright scraper for one URL with optional proxy. Retries with other proxies on failure."""
    proxies_to_try = []
    if proxy:
        proxies_to_try.append(proxy)
    if proxy_list:
        for p in proxy_list:
            if p not in proxies_to_try:
                proxies_to_try.append(p)

    # Always try without proxy at least once
    proxies_to_try.append(None)

    last_error = None
    for current_proxy in proxies_to_try:
        try:
            return _scrape_with_proxy(url, current_proxy, output_dir, headful)
        except Exception as exc:
            err_msg = str(exc)
            last_error = err_msg
            if "ERR_TUNNEL_CONNECTION_FAILED" in err_msg or "No chapter links found" in err_msg:
                continue
            raise

    return {"url": url, "proxy": proxy, "ok": False, "pages": 0, "error": last_error or "All proxies failed"}


def _scrape_with_proxy(url: str, proxy: str | None, output_dir: Path, headful: bool = False) -> dict:
    """Run Playwright scraper for one URL with optional proxy."""
    from playwright.sync_api import sync_playwright
    import requests
    from bs4 import BeautifulSoup
    from PIL import Image
    import zipfile
    import io

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
        ".reader img, .reading-content img, .container-chapter-reader img, "
        "#readerarea img, .chapter-content img, img.wp-manga-chapter-img"
    )

    IMAGE_EXT_RE = re.compile(r"\.(jpe?g|png|webp|gif|avif|bmp)(\?.*)?$", re.I)
    CHROME_HINTS = ("logo", "icon", "banner", "avatar", "sprite", ".svg")
    PACK_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif")

    def slugify(s, max_len=60):
        s = re.sub(r"[^\w\s-]", "", s).strip().lower()
        s = re.sub(r"[\s-]+", "-", s)
        return s[:max_len] or "chapter"

    def _ext_for_url(url):
        ext = os.path.splitext(urlparse(url).path)[1].lstrip(".").lower()
        if ext in ("jpg", "jpeg", "png", "webp", "gif", "avif", "bmp"):
            return "jpg" if ext == "jpeg" else ext
        return "jpg"

    def convert_to_cbz(folder, cbz_path):
        image_files = sorted(f for f in folder.iterdir() if f.suffix.lower() in PACK_EXTENSIONS)
        if not image_files:
            return 0
        with zipfile.ZipFile(cbz_path, "w", zipfile.ZIP_DEFLATED) as cbz:
            for file in image_files:
                cbz.write(file, arcname=file.name)
        return len(image_files)

    print(f"\n{c('[→]', Colors.CYAN)} Scraping: {url}")
    if proxy:
        print(f"    {c('Proxy:', Colors.DIM)} {proxy}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headful)
        context_kwargs = {
            "user_agent": USER_AGENT,
            "viewport": {"width": 1440, "height": 900},
            "locale": "en-US",
        }
        if proxy:
            context_kwargs["proxy"] = {"server": proxy}

        context = browser.new_context(ignore_https_errors=True, **context_kwargs)
        page = context.new_page()

        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(2000)

        # Find chapters
        links = []
        for sel in CHAPTER_FALLBACK_SELECTORS:
            try:
                nodes = page.query_selector_all(sel)
            except Exception:
                continue
            if nodes:
                links = nodes
                break

        if not links:
            browser.close()
            raise RuntimeError("No chapter links found")

        chapters = []
        seen = set()
        for node in links:
            href = node.get_attribute("href")
            if not href:
                continue
            chapter_url = urljoin(url, href)
            if chapter_url in seen:
                continue
            seen.add(chapter_url)
            text = (node.inner_text() or "").strip()
            m = re.search(r"chapter\s*(\d+(?:\.\d+)?)", text, re.I)
            num = float(m.group(1)) if m else len(chapters) + 1
            chapters.append({"number": num, "title": text or chapter_url, "url": chapter_url})

        chapters.sort(key=lambda c: c["number"])
        total_chapters = len(chapters)
        total_pages = 0

        print(f"    {c('[+]', Colors.GREEN)} Found {c(str(total_chapters), Colors.CYAN)} chapters")

        for ch in chapters:
            print(f"\n    {c('[ch]', Colors.BLUE)} {ch['title']}")
            page.goto(ch["url"], wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(1500)

            # Lazy-loaded readers (mangafire etc.) need scrolling to hydrate imgs.
            prev_height = 0
            for _ in range(60):
                page.evaluate("window.scrollBy(0, window.innerHeight)")
                page.wait_for_timeout(250)
                cur_height = page.evaluate("document.body.scrollHeight")
                if cur_height == prev_height:
                    break
                prev_height = cur_height
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
                    src = (
                        img.get_attribute("src")
                        or img.get_attribute("data-src")
                        or img.get_attribute("data-original")
                        or img.get_attribute("data-lazy-src")
                        or ""
                    )
                    if not src:
                        continue
                    full = urljoin(ch["url"], src)
                    if not any(h in full.lower() for h in CHROME_HINTS) and full not in imgs:
                        imgs.append(full)
                if imgs:
                    break

            if not imgs:
                print(f"      {c('[!] No pages found', Colors.YELLOW)}")
                continue

            ch_dir = output_dir / slugify(ch["title"])
            ch_dir.mkdir(parents=True, exist_ok=True)
            files = [ch_dir / f"page-{i+1:03d}.{_ext_for_url(u)}" for i, u in enumerate(imgs)]

            for img_url, dest in zip(imgs, files):
                if dest.exists() and dest.stat().st_size > 0:
                    total_pages += 1
                    continue
                try:
                    resp = requests.get(img_url, headers={"User-Agent": USER_AGENT}, timeout=30)
                    resp.raise_for_status()
                    dest.write_bytes(resp.content)
                    Image.open(dest).verify()
                    total_pages += 1
                except Exception:
                    pass

            cbz = output_dir / f"{slugify(ch['title'])}.cbz"
            convert_to_cbz(ch_dir, cbz)
            print(f"      {c('[✓]', Colors.GREEN)} CBZ ready ({len(imgs)} pages)")

        browser.close()
        print(f"\n    {c('[✓]', Colors.GREEN)} Done: {total_pages} pages downloaded")
        return {"url": url, "proxy": proxy, "ok": True, "pages": total_pages, "error": None}

# ── Progress bar wrapper ────────────────────────────────────────────────────
def progress_bar(iterable, desc="Processing", **kwargs):
    try:
        from tqdm import tqdm
        return tqdm(iterable, desc=desc, **kwargs)
    except ImportError:
        return iterable

# ── Main ────────────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(
        description="Premium manga/manhua scraper with proxies + progressbar.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("urls", nargs="*", help="Series URLs to scrape")
    parser.add_argument("--batch", help="Text file with one URL per line")
    parser.add_argument("--proxy-file", help="File with proxy list (one per line)")
    parser.add_argument("--proxy-dir", help="Directory with proxy files")
    parser.add_argument("--output", default="D:/MANGA MANHUA WEBSITE/downloads",
                        help="Output folder for downloads")
    parser.add_argument("--workers", type=int, default=2,
                        help="Parallel scraper workers (keep low to avoid blocks)")
    parser.add_argument("--no-color", action="store_true", help="Disable ANSI colors")
    parser.add_argument("--skip-check", action="store_true", help="Skip URL alive check")
    parser.add_argument("--headful", action="store_true", help="Show browser window")
    args = parser.parse_args()

    # Collect URLs
    urls = list(args.urls)
    if args.batch and Path(args.batch).exists():
        with open(args.batch, "r", encoding="utf-8") as f:
            urls.extend([line.strip() for line in f if line.strip() and not line.startswith("#")])

    if not urls:
        print(c("[!] No URLs provided. Pass URLs or use --batch urls.txt", Colors.RED))
        return 1

    # Colors
    use_color = not args.no_color and sys.stdout.isatty()
    if not use_color:
        Colors.HEADER = Colors.BLUE = Colors.CYAN = Colors.GREEN = Colors.YELLOW = Colors.RED = Colors.END = Colors.BOLD = Colors.UNDERLINE = Colors.DIM = ""

    print(BANNER)
    print(LEGAL_NOTE)

    # Filter skipped
    filtered = []
    skipped = []
    for url in urls:
        skip, reason = should_skip(url)
        if skip:
            skipped.append((url, reason))
        else:
            filtered.append(url)

    if skipped:
        print(f"\n{c('[skip]', Colors.YELLOW)} Skipping {len(skipped)} URL(s):")
        for url, reason in skipped:
            print(f"  {c('→', Colors.CYAN)} {url}")
            print(f"      {c(reason, Colors.YELLOW)}")

    if not filtered:
        print(f"\n{c('[!] All URLs were skipped. Nothing to scrape.', Colors.RED)}")
        return 0

    # Load proxies
    proxies = load_proxies(args.proxy_file, args.proxy_dir)
    if not proxies:
        print(f"{c('[!]', Colors.RED)} No proxies found — scraping without proxy (slower, higher block risk).")

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{c('[+]', Colors.GREEN)} {c('Ready to scrape:', Colors.BOLD)} {c(str(len(filtered)), Colors.CYAN)} URL(s)")
    print(f"    {c('Output:', Colors.DIM)} {out_dir}")
    print(f"    {c('Workers:', Colors.DIM)} {args.workers}")
    print(f"    {c('Proxies:', Colors.DIM)} {len(proxies)}")
    print(f"    {c('Headful:', Colors.DIM)} {args.headful}")
    print()

    # Check URLs alive
    if not args.skip_check:
        print(c("[*] Checking URLs...", Colors.BLUE))
        alive = []
        for url in progress_bar(filtered, desc="  Checking", unit="url", disable=not sys.stdout.isatty()):
            ok = check_url_alive(url)
            status = c("✓", Colors.GREEN) if ok else c("✗", Colors.RED)
            print(f"  {status} {url}")
            if ok:
                alive.append(url)
            else:
                print(f"      {c('Warning: URL may be down or blocked', Colors.YELLOW)}")
                alive.append(url)
        filtered = alive
        print()

    # Scrape with proxy rotation
    print(c("[*] Starting scrape...", Colors.BLUE))
    print("─" * 60)

    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {}
        for i, url in enumerate(filtered):
            proxy = proxies[i % len(proxies)] if proxies else None
            future = executor.submit(scrape_one, url, proxy, out_dir, args.headful, proxies)
            futures[future] = url

        for future in progress_bar(as_completed(futures), desc="  Scraping", unit="url", disable=not sys.stdout.isatty()):
            url = futures[future]
            try:
                result = future.result()
                results.append(result)
            except Exception as exc:
                results.append({"url": url, "ok": False, "pages": 0, "error": str(exc)})

    # Summary
    print("\n" + "─" * 60)
    print(c(f"\n[+] Summary", Colors.GREEN) + c("═" * 40, Colors.HEADER))

    ok_count = sum(1 for r in results if r["ok"])
    fail_count = len(results) - ok_count
    total_pages = sum(r["pages"] for r in results)

    for r in results:
        status = c("✓", Colors.GREEN) if r["ok"] else c("✗", Colors.RED)
        proxy_info = f" via {r['proxy']}" if r.get("proxy") else ""
        print(f"  {status} {r['url']}{proxy_info}")
        if r["ok"]:
            print(f"      Pages: {r['pages']}")
        else:
            print(f"      Error: {r.get('error', 'Unknown')}")

    print(f"\n{c('Total:', Colors.BOLD)} {c(str(len(results)), Colors.CYAN)} scraped | "
          f"{c(str(ok_count), Colors.GREEN)} succeeded | "
          f"{c(str(fail_count), Colors.RED)} failed | "
          f"{c(str(total_pages), Colors.YELLOW)} pages")

    if ok_count == len(results):
        print(c("\n[✓] All done! Check your downloads folder.", Colors.GREEN))
    else:
        print(f"\n{c('[!] Some scrapes failed. Check errors above.', Colors.YELLOW)}")

    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
