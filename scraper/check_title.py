#!/usr/bin/env python3
"""check_title.py — check chapters for mangafire titles via proxies, waiting out Cloudflare."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mangafire_catalog import open_working_context, is_challenge, new_context
from playwright.sync_api import sync_playwright

URLS = [
    "https://mangafire.to/title/j2yly-top-rankers-life-guide-for-aspiring-writers",
    "https://mangafire.to/title/60lv9-the-top-rankers-aspiring-writer-life-manual",
]
PROXIES = list(
    Path(r"D:\MANGA MANHUA WEBSITE\proxy_checker\working_proxies.txt").read_text(encoding="utf-8", errors="ignore").splitlines()
)


def page_state(page):
    return page.evaluate(
        """() => {
            const t = document.title || '';
            const b = (document.body ? document.body.innerText : '') || '';
            return {
                title: t,
                url: location.href,
                chapterLinks: document.querySelectorAll('a[href*="/chapter/"]').length,
                cloudflare: /just a moment|performing security verification|cloudflare/i.test(t + ' ' + b),
                snippet: b.slice(0, 120),
            };
        }"""
    )


def count_chapters(page, url):
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3000)
    for i in range(12):  # wait up to ~60s for the Cloudflare interstitial to clear
        st = page_state(page)
        if st["chapterLinks"] or not st["cloudflare"]:
            return st
        print(f"    still Cloudflare (wait {5 * (i + 1)}s)... title='{st['title']}'")
        page.wait_for_timeout(5000)
    return page_state(page)


with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    for url in URLS:
        print(f"\n=== {url}")
        for proxy_attempt in range(2):
            ctx, page, proxy = open_working_context(browser, PROXIES, 60, avoid=(proxy if 'proxy' in locals() else None))
            if page is None:
                ctx, page = new_context(browser, None)
            st = count_chapters(page, url)
            print("proxy:", proxy)
            print("page title:", st["title"])
            print("chapter links:", st["chapterCount"] if (st := st) and False else st["chapterLinks"])
            print("cloudflare?", st["cloudflare"])
            if not st["cloudflare"] and st["chapterLinks"]:
                print("GOOD - title loads with chapters")
                break
            print("blocked - rotating proxy...")
            try:
                ctx.close()
            except Exception:
                pass
        else:
            continue
        break
    browser.close()
