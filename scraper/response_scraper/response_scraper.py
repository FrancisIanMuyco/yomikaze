#!/usr/bin/env python3
"""
response_scraper.py — capture manga page images via NETWORK RESPONSES.

Instead of trusting DOM selectors (which break when a reader lazy-loads or
uses JS-injected images), this script listens to the browser's actual network
responses while auto-scrolling the chapter page. Every 200 OK response that
looks like an image (.webp/.jpg/.jpeg/.png) is collected — in the order the
browser loaded it.

This is the FALLBACK method used by mangafire_all_chapters.py when the
site's JSON API returns no pages for a chapter.

Usage:
    python response_scraper.py "https://mangafire.to/read/<slug>/en/chapter-1"
    python response_scraper.py "<url>" --proxy http://ip:port
    python response_scraper.py "<url>" --proxy-file ..\\..\\proxy_checker\\working_proxies.txt
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

# Force UTF-8 so ✓/CJK chars don't crash Windows consoles.
try:
    if sys.stdout and sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if sys.stderr and sys.stderr.encoding and sys.stderr.encoding.lower() not in ("utf-8", "utf8"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

IMAGE_EXTS = (".webp", ".jpg", ".jpeg", ".png")
IGNORED_HINTS = ("logo", "favicon", "avatar", "banner", "thumb", "static.mfcdn.nl")

AUTO_SCROLL_JS = """
async () => {
    await new Promise((resolve) => {
        let totalHeight = 0;
        let distance = 400;   // Scroll 400px kada step
        let timer = setInterval(() => {
            let scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;
            if (totalHeight >= scrollHeight) {
                clearInterval(timer);
                resolve();
            }
        }, 150);              // Delay in ms per scroll step
    });
}
"""


def load_proxies(proxy_file: str | None) -> list[str]:
    """Load proxies from a file, one per line (http://, socks5://, ...)."""
    if not proxy_file or not Path(proxy_file).exists():
        return []
    proxies = []
    for line in Path(proxy_file).read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            if "://" not in line:
                line = f"http://{line}"
            if line.startswith(("http://", "https://", "socks4://", "socks5://")):
                proxies.append(line)
    return proxies


def is_challenge(page) -> bool:
    """True when the page is a Cloudflare/WAF challenge page."""
    try:
        title = page.title()
        if "Just a moment" in title or "Security check" in title or "challenge" in title.lower():
            return True
        txt = page.evaluate("() => (document.body ? document.body.innerText : '')")
        low = txt.lower()
        return "verify you're human" in low or "click the shapes" in low or "just a moment" in low
    except Exception:
        return True


def _capture_with_page(page, chapter_url: str) -> list[str]:
    """Collect image response URLs while loading + scrolling one chapter page."""
    image_urls: list[str] = []

    def handle_response(response):
        url = response.url
        if response.status == 200 and any(ext in url.lower() for ext in IMAGE_EXTS):
            if not any(ignored in url.lower() for ignored in IGNORED_HINTS):
                # Drop CDN thumbnails with a size suffix (e.g. @280.jpg).
                if re.search(r"@\d+(?:x\d+)?\.(?:jpg|jpeg|png|webp)$", url, re.I):
                    return
                if url not in image_urls:
                    image_urls.append(url)

    page.on("response", handle_response)
    print(f"[*] Opening MangaFire URL: {chapter_url}")
    page.goto(chapter_url, wait_until="domcontentloaded", timeout=60000)

    # Wait for Cloudflare verification (auto-resolves in a few seconds)
    for _ in range(10):
        if not is_challenge(page):
            break
        page.wait_for_timeout(2000)
    page.wait_for_timeout(4000)

    # Auto-scroll to trigger lazy loading on the whole chapter
    print("[*] Auto-scrolling page to load all lazy images...")
    try:
        page.evaluate(AUTO_SCROLL_JS)
    except Exception as exc:
        print(f"    [warn] auto-scroll failed: {exc}", file=sys.stderr)

    # Extra buffer for dynamic requests to finish
    page.wait_for_timeout(3000)
    return image_urls


def capture_images(chapter_url: str, proxy: str | None = None) -> list[str]:
    """Open a chapter URL and return the page image URLs seen on the network."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context_kwargs = {
            "user_agent": USER_AGENT,
            "viewport": {"width": 1280, "height": 900},
        }
        if proxy:
            context_kwargs["proxy"] = {"server": proxy}

        context = browser.new_context(**context_kwargs)
        page = context.new_page()
        # Prime cookies + getProtectionToken on the homepage (clears WAF).
        # Best-effort only — a short timeout keeps the happy path quiet.
        try:
            page.goto("https://mangafire.to/", wait_until="domcontentloaded", timeout=15000)
            for _ in range(10):
                if not is_challenge(page):
                    break
                page.wait_for_timeout(2000)
            page.wait_for_timeout(2500)
        except Exception:
            pass

        try:
            images = _capture_with_page(page, chapter_url)
        finally:
            browser.close()
        return images


def capture_images_in_context(context, chapter_url: str) -> list[str]:
    """Capture page images using an EXISTING browser context.

    Reuses the already-authenticated proxy session (cookies + cleared WAF) so
    each chapter does not need a fresh browser launch. Opens a new page in the
    same context, scrolls, collects image responses, then closes the page.
    """
    page = context.new_page()
    try:
        print(f"    [fallback] opening {chapter_url}")
        images = _capture_with_page(page, chapter_url)
        return images
    finally:
        page.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture manga page images via network responses.")
    parser.add_argument("url", help="Chapter URL (e.g. https://mangafire.to/read/.../en/chapter-1)")
    parser.add_argument("--proxy", default=None, help="Single proxy, e.g. http://ip:port")
    parser.add_argument("--proxy-file", default=None, help="Proxy list file (one per line)")
    parser.add_argument("--output", default=None, help="Save JSON output to this path")
    args = parser.parse_args()

    proxies = load_proxies(args.proxy_file)
    proxy_candidates = ([args.proxy] if args.proxy else []) + proxies
    proxy_candidates.append(None)  # always try direct last

    images: list[str] = []
    last_error = None
    for proxy in proxy_candidates:
        try:
            print(f"\n[*] Trying proxy: {proxy or '(direct)'}")
            images = capture_images(args.url, proxy)
            if images:
                print(f"[✓] Got {len(images)} images via {proxy or '(direct)'}")
                break
            print("    [warn] no images captured, trying next proxy...")
        except Exception as exc:
            last_error = exc
            print(f"    [warn] proxy failed: {exc}")

    if not images:
        print(f"[!] No images captured. Last error: {last_error}", file=sys.stderr)
        return 1

    print(f"\n[✓] Nakit-an nga {len(images)} ka images:")
    for idx, img in enumerate(images, 1):
        print(f"Page {idx}: {img}")

    if args.output:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(
            json.dumps({"url": args.url, "total_pages": len(images), "pages": images},
                       indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"\n[*] Saved -> {out}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
