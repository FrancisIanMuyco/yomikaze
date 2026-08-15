#!/usr/bin/env python3
"""
mangafire_scraper.py — class-based MangaFire scraper (rotational UA + human delays).

Anti-bot hardening:
  - Rotational user agents (updated browser UAs)
  - Human-like random delays before/during/after navigation
  - Sequential step-by-step smooth scroll so page order is preserved and
    lazy-loading triggers for every image
  - Network-response capture (real image URLs from CDN responses)

Integrated into mangafire_all_chapters.py as a SECOND fallback tier
(`capture_in_context`) when the chapters API and the fast response capture
return no pages. Can also be used standalone:

Usage:
  python mangafire_scraper.py <chapter-url> [--proxy http://ip:port]
  python mangafire_scraper.py <chapter-url> --proxy-file ..\\..\\proxy_checker\\working_proxies.txt
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
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

# Reuse shared constants/helpers from the sibling response_scraper module.
from response_scraper.response_scraper import IMAGE_EXTS, IGNORED_HINTS, load_proxies, is_challenge

SEQUENTIAL_SCROLL_JS = """
async () => {
    await new Promise((resolve) => {
        let totalHeight = 0;
        let distance = 350;   // Scroll distance in pixels per step
        let timer = setInterval(() => {
            let scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;
            if (totalHeight >= scrollHeight) {
                clearInterval(timer);
                resolve();
            }
        }, 120);              // Smooth timing interval (ms)
    });
}
"""


class MangaFireScraper:
    """Scrape MangaFire chapter page images via network responses."""

    def __init__(self, proxy: str | None = None, proxy_file: str | None = None):
        # Rotational User-Agents (Updated Browsers)
        self.ua_list = [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        ]
        self.proxy = proxy
        self.proxies = load_proxies(proxy_file)

    # ── helpers ────────────────────────────────────────────────────────
    def _delay(self, min_sec=1.0, max_sec=2.5):
        """Random delay to mimic natural human reading/browsing behavior."""
        time.sleep(random.uniform(min_sec, max_sec))

    def _sequential_smooth_scroll(self, page):
        """Sequential step-by-step scroll so page order is preserved and
        lazy-loading triggers for every image."""
        print("[*] Human-like sequential scrolling triggered...")
        try:
            page.evaluate(SEQUENTIAL_SCROLL_JS)
        except Exception as exc:
            print(f"    [warn] sequential scroll failed: {exc}", file=sys.stderr)

    def _wait_out_challenge(self, page):
        for _ in range(10):
            if not is_challenge(page):
                break
            page.wait_for_timeout(2000)

    # ── capture (shared logic for standalone + integrated) ─────────────
    def _capture(self, page, chapter_url: str) -> list[str]:
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

        print(f"[*] Navigating to: {chapter_url}")
        page.goto(chapter_url, wait_until="domcontentloaded", timeout=60000)

        # Human delay for Cloudflare screen check
        self._delay(3.0, 5.0)
        self._wait_out_challenge(page)
        page.wait_for_timeout(2000)

        # Sequential smooth scroll
        self._sequential_smooth_scroll(page)

        # Final buffer for remaining requests
        self._delay(2.0, 3.5)
        page.wait_for_timeout(1500)

        return image_urls

    # ── standalone: launch own browser ─────────────────────────────────
    def scrape_images(self, chapter_url: str) -> list[str]:
        """Launch a fresh browser and return the page image URLs."""
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            selected_ua = random.choice(self.ua_list)
            context_kwargs = {
                "user_agent": selected_ua,
                "viewport": {"width": 1920, "height": 1080},
                "device_scale_factor": 1,
                "has_touch": False,
                "is_mobile": False,
            }
            if self.proxy:
                context_kwargs["proxy"] = {"server": self.proxy}

            context = browser.new_context(**context_kwargs)
            page = context.new_page()

            # Prime cookies on the homepage (best-effort, clears WAF).
            try:
                page.goto("https://mangafire.to/", wait_until="domcontentloaded", timeout=15000)
                self._wait_out_challenge(page)
                page.wait_for_timeout(2000)
            except Exception:
                pass

            try:
                images = self._capture(page, chapter_url)
            finally:
                browser.close()

        print(f"[✓] Successfully captured {len(images)} page URLs!")
        return images

    # ── integrated: reuse an existing context (for fallback) ───────────
    def capture_in_context(self, context, chapter_url: str) -> list[str]:
        """Capture page images using an EXISTING browser context.

        Reuses the already-authenticated proxy session so no fresh browser
        launch is needed per chapter.
        """
        page = context.new_page()
        try:
            return self._capture(page, chapter_url)
        finally:
            page.close()

    # ── save ───────────────────────────────────────────────────────────
    def save_to_json(self, chapter_url: str, image_urls: list[str], output_dir: str = "mangafire_output"):
        """Save the captured URLs to a JSON file."""
        if not image_urls:
            print("[!] Walay images nga ma-save.")
            return
        os.makedirs(output_dir, exist_ok=True)
        clean_name = re.sub(r'[\\/*?:"<>|]', "_", chapter_url.split("/")[-1])
        output_file = os.path.join(output_dir, f"{clean_name}.json")
        data = {
            "source": "MangaFire.to",
            "url": chapter_url,
            "total_pages": len(image_urls),
            "pages": image_urls,
        }
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        print(f"[✓] Saved JSON to {output_file}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Class-based MangaFire image URL extractor (rotational UA + human delays).")
    parser.add_argument("url", help="Chapter URL (e.g. https://mangafire.to/read/.../en/chapter-1)")
    parser.add_argument("--proxy", default=None, help="Single proxy, e.g. http://ip:port")
    parser.add_argument("--proxy-file", default=None, help="Proxy list file (one per line)")
    parser.add_argument("--output", default=None, help="Also save JSON output to this directory")
    args = parser.parse_args()

    scraper = MangaFireScraper(proxy=args.proxy, proxy_file=args.proxy_file)

    # Try explicit proxy first, then file proxies, then direct.
    candidates = ([args.proxy] if args.proxy else []) + scraper.proxies + [None]
    images: list[str] = []
    last_error = None
    for proxy in candidates:
        try:
            print(f"\n[*] Trying proxy: {proxy or '(direct)'}")
            scraper.proxy = proxy
            images = scraper.scrape_images(args.url)
            if images:
                print(f"[✓] Got {len(images)} images via {proxy or '(direct)'}")
                break
            print("    [warn] no images, trying next proxy...")
        except Exception as exc:
            last_error = exc
            print(f"    [warn] failed: {exc}")

    if not images:
        print(f"[!] No images captured. Last error: {last_error}", file=sys.stderr)
        return 1

    print(f"\n[✓] Nakit-an nga {len(images)} ka images:")
    for idx, img in enumerate(images, 1):
        print(f"Page {idx}: {img}")

    if args.output:
        scraper.save_to_json(args.url, images, args.output)

    return 0


if __name__ == "__main__":
    sys.exit(main())
