#!/usr/bin/env python3
"""mangafire_all_chapters.py — collect ALL chapters of a mangafire.to series.

Uses the site's own JSON API (via the browser, so the vrf tokens are valid):

  1. Open the title page, click the chapter-list pager buttons (npager__num)
     to load EVERY page of chapters (site returns 20 per page). Collects from
     Chapter 1 all the way to the latest chapter.
  2. For every chapter, call GET /api/chapters/<id>?vrf=... (token generated
     in-page via window.getProtectionToken) to get the real page image URLs.
  3. Write a YOMIKAZE-compatible JSON (items + chapters).

Anti-block hardening:
  - WAF captcha detection + waiting (solve manually with --headful)
  - navigation retries when the page loads without chapter links
  - API calls retry with exponential backoff
  - optional proxy rotation from a proxy list file

Usage:
  python mangafire_all_chapters.py <title-url> [--output path/to.json] [--proxy-file proxies.txt]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright
from tqdm import tqdm

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "YOMIKAZE" / "public" / "scraped.json"

# Network-response fallbacks (capture page images even when the API fails).
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from response_scraper.response_scraper import capture_images_in_context
    from response_scraper.mangafire_scraper import MangaFireScraper
    RESPONSE_FALLBACK = True
except Exception:
    RESPONSE_FALLBACK = False
    print("[!] response_scraper not importable — network fallback disabled", file=sys.stderr)

HEADFUL = False  # set by --headful

API_RETRIES = 3
CHALLENGE_MARKERS = ("@waf", "challenge", "verify you're human", "click the shapes")


def load_proxies(proxy_file: str | None) -> list[str]:
    proxies: list[str] = []
    if proxy_file and Path(proxy_file).exists():
        with open(proxy_file, "r", encoding="utf-8") as f:
            proxies = [line.strip() for line in f if line.strip() and not line.startswith("#")]
        print(f"[*] Loaded {len(proxies)} proxies from {proxy_file}")
    return proxies


def is_challenge(page) -> bool:
    """True when mangafire is showing its interactive WAF captcha."""
    try:
        url = page.url
        if "@waf" in url or "challenge" in url.lower():
            return True
        txt = page.evaluate("() => (document.body ? document.body.innerText : '')")
        low = txt.lower()
        return "verify you're human" in low or "click the shapes" in low
    except Exception:
        return False


def wait_out_challenge(page, timeout: int = 600) -> bool:
    """Wait while mangafire shows its captcha (solve by hand in --headful)."""
    waited = 0
    while is_challenge(page) and waited < timeout:
        if waited % 15 == 0:
            if HEADFUL:
                print(
                    "    [captcha] SOLVE THE CAPTCHA IN THE BROWSER WINDOW (click the shapes)...",
                    file=sys.stderr,
                )
            else:
                print(
                    "    [captcha] mangafire is showing a captcha - re-run with --headful to solve it manually.",
                    file=sys.stderr,
                )
        page.wait_for_timeout(5000)
        waited += 5
    return not is_challenge(page)


def api_get(page, path: str, query: str = "", delay: float = 0.4) -> dict | None:
    """Call a mangafire API endpoint using an in-page vrf token, with retries."""
    for attempt in range(API_RETRIES):
        token = page.evaluate(
            """(args) => {
                const t = window.getProtectionToken(args.path, args.query);
                return t ? String(t) : null;
            }""",
            {"path": path, "query": query},
        )
        if token:
            sep = "&" if query else ""
            url = f"https://mangafire.to{path}?{query}{sep}vrf={token}"
            resp = page.request.get(url)
            if resp.status == 200:
                try:
                    return resp.json()
                except Exception:
                    pass
            code = resp.status
        else:
            code = "no-token"
        if attempt < API_RETRIES - 1:
            wait = 3 * (2 ** attempt)
            print(f"    [retry] {path} -> {code}, waiting {wait}s (attempt {attempt + 1}/{API_RETRIES})", file=sys.stderr)
            time.sleep(wait)
            try:
                page.goto("https://mangafire.to/", wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(2500)
            except Exception:
                pass
    return None


CHAPTER_ROWS_JS = """() => {
    const out = [];
    document.querySelectorAll('a[href*="/chapter/"]').forEach(a => {
        const m = (a.textContent || '').match(/(\\d+)/);
        const num = m ? parseInt(m[1]) : null;
        const idm = (a.href || '').match(/chapter\\/(\\d+)/);
        if (num && idm) out.push({ id: parseInt(idm[1]), number: num, url: a.href });
    });
    return out;
}"""

PAGERS_JS = """() => {
    const nums = Array.from(document.querySelectorAll('.npager__num'));
    return nums.map(b => parseInt((b.textContent||'').trim(), 10)).filter(n => !isNaN(n));
}"""

CLICK_PAGE_JS = """(next) => {
    const btns = Array.from(document.querySelectorAll('.npager__num'));
    for (const b of btns) {
        if (parseInt((b.textContent||'').trim(), 10) === next) {
            b.click();
            return true;
        }
    }
    return false;
}"""


def _active_pager(page) -> int | None:
    """Return the currently active pager number, or None."""
    try:
        return page.evaluate(
            """() => {
                const b = document.querySelector('.npager__num.is-active');
                return b ? parseInt(b.textContent.trim(), 10) : null;
            }"""
        )
    except Exception:
        return None


def _walk_pager(page, items: dict[int, dict]) -> dict[int, dict]:
    """Walk the chapter-list pager on the CURRENT page, collecting all rows.

    After clicking the next page, polls until the active pager updates (up to
    12s) so lazy-loaded rows are present before extracting.
    """
    last_page = 1
    for page_num in range(1, 50):
        rows = page.evaluate(CHAPTER_ROWS_JS)
        for r in rows:
            items[r["number"]] = r
        print(f"    page {page_num}: {len(rows)} rows on page, {len(items)} unique so far")

        if not items:
            break

        pagers = page.evaluate(PAGERS_JS)
        if pagers:
            last_page = max(pagers)
        if page_num >= last_page:
            break
        clicked = page.evaluate(CLICK_PAGE_JS, page_num + 1)
        if not clicked:
            break
        # Poll until the pager actually switches to the next page.
        target = page_num + 1
        switched = False
        for _ in range(24):
            page.wait_for_timeout(500)
            if _active_pager(page) == target:
                switched = True
                break
        if not switched:
            print(f"    [warn] pager did not switch to {target}", file=sys.stderr)
            break
        # Extra settle time for the rows to render.
        page.wait_for_timeout(1500)
    return items


def collect_all_chapters(page, title_url: str, already_loaded: bool = False, delay: float = 0.4) -> list[dict]:
    """Collect ALL chapters from Chapter 1 to the latest, walking the pager.

    If `already_loaded` is True the caller has already navigated to the title
    page (and confirmed chapter rows exist) — we reuse that page instead of
    reloading, which would re-trigger mangafire's WAF. Otherwise retries
    navigation a few times (anti-bot block pages / slow loads / captcha).
    """
    items: dict[int, dict] = {}  # chapter number -> item

    # First pass may reuse the already-loaded probe page (skip the goto).
    # Later passes always navigate, so the retry logic actually runs.
    for attempt in range(4):
        do_nav = not (already_loaded and attempt == 0)
        if do_nav:
            try:
                page.goto(title_url, wait_until="domcontentloaded", timeout=60000)
                page.wait_for_timeout(4000)
                if not wait_out_challenge(page, timeout=120 if HEADFUL else 20):
                    print(f"    [warn] captcha on nav attempt {attempt + 1}/3", file=sys.stderr)
                    time.sleep(5)
                    continue
            except Exception as exc:
                print(f"    [warn] goto failed: {exc}", file=sys.stderr)
                time.sleep(4)
                continue

        items = _walk_pager(page, {})
        if items:
            # Sorted ascending: Chapter 1 first, latest last.
            return [items[n] for n in sorted(items)]

        already_loaded = False
        # No chapter links found — likely a block page or slow load.
        print(f"    [warn] no chapters on nav attempt {attempt + 1}/4", file=sys.stderr)
        time.sleep(6)

    return []


def build_scraped_json(page, title_url: str, chapters: list[dict], delay: float = 0.4, context=None) -> dict:
    """Fetch per-chapter page URLs + title metadata, build YOMIKAZE JSON."""
    hid_match = re.search(r"/title/([^/?#]+)", title_url)
    title_info: dict = {}
    if hid_match:
        hid = hid_match.group(1).split("-")[0]
        title_api = api_get(page, f"/api/titles/{hid}", delay=delay)
        if title_api and "data" in title_api:
            d = title_api["data"]
            poster = d.get("poster") or {}
            cover_url = (
                poster.get("large")
                or poster.get("medium")
                or poster.get("small")
                or ""
            )
            synopsis = re.sub("<[^>]+>", "", d.get("synopsisHtml") or "").strip()
            authors = [a.get("name", "") for a in (d.get("authors") or []) if a.get("name")]
            artists = [a.get("name", "") for a in (d.get("artists") or []) if a.get("name")]
            title_info = {
                "source": "mangafire",
                "source_id": d.get("title") or d.get("slug") or "untitled",
                "title": d.get("title") or d.get("slug") or "Untitled",
                "type": d.get("type") or "",
                "alt_titles": d.get("altTitles") or [],
                "description": synopsis or d.get("description") or "",
                "authors": authors + [a for a in artists if a not in authors],
                "genres": [g.get("title", "") for g in (d.get("genres") or []) if g.get("title")],
                "status": d.get("status") or "releasing",
                "year": d.get("year"),
                "rating": d.get("rating"),
                "rank": d.get("rank"),
                "cover_url": cover_url,
                "url": f"https://mangafire.to{d.get('url') or ''}",
                "chapter_count": str(len(chapters)),
            }
            print(f"    title: {title_info['title']} ({len(chapters)} chapters)")

    series_id = title_info.get("source_id")
    if not series_id and hid_match:
        series_id = hid_match.group(1).split("-")[0]
    if not series_id:
        series_id = "series"

    scraped_chapters = []
    total_pages = 0
    scraper_human = MangaFireScraper() if RESPONSE_FALLBACK else None

    # Live progress bar: current chapter / total + running page total.
    pbar = tqdm(
        chapters,
        desc="Fetching pages",
        unit="ch",
        bar_format="{desc}: {n_fmt}/{total_fmt} [{percentage:3.0f}%] {bar} | pages={postfix[0]} | {rate_fmt}",
        postfix=["0"],
        dynamic_ncols=True,
    )

    for i, ch in enumerate(pbar):
        detail = api_get(page, f"/api/chapters/{ch['id']}", delay=delay)
        pages = []
        if detail and "data" in detail:
            pages = [p.get("url", "") for p in (detail["data"].get("pages") or []) if p.get("url")]

        # ── Fallback: network-response capture when the API gives no pages ──
        if not pages and RESPONSE_FALLBACK and context is not None:
            print(f"    [fallback] API gave 0 pages for Ch. {ch['number']} — using response capture...")
            try:
                pages = capture_images_in_context(context, ch["url"])
                print(f"    [fallback] captured {len(pages)} pages for Ch. {ch['number']}")
            except Exception as exc:
                print(f"    [fallback] fast capture failed for Ch. {ch['number']}: {exc}", file=sys.stderr)

        # ── Fallback 2: class-based humanized capture (human delays) ──
        if not pages and RESPONSE_FALLBACK and context is not None and scraper_human is not None:
            print(f"    [fallback] trying humanized capture for Ch. {ch['number']}...")
            try:
                pages = scraper_human.capture_in_context(context, ch["url"])
                print(f"    [fallback] humanized capture got {len(pages)} pages for Ch. {ch['number']}")
            except Exception as exc:
                print(f"    [fallback] humanized capture failed for Ch. {ch['number']}: {exc}", file=sys.stderr)

        total_pages += len(pages)
        scraped_chapters.append(
            {
                "source": "mangafire",
                "series_id": series_id,
                "chapter_id": f"{series_id}-{ch['number']}",
                "number": ch["number"],
                "title": f"Chapter {ch['number']}",
                "url": ch["url"],
                "pages": pages,
            }
        )
        pbar.set_postfix_str(str(total_pages))
        time.sleep(delay)

    pbar.close()

    return {
        "items": [title_info] if title_info else [],
        "chapters": scraped_chapters,
        "total_chapters": len(chapters),
        "total_pages": total_pages,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect ALL mangafire.to chapters into YOMIKAZE scraped.json")
    parser.add_argument("url", help="Series page URL, e.g. https://mangafire.to/title/kxozr-...")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output JSON path")
    parser.add_argument("--proxy-file", default=None, help="Proxy list file (one per line, e.g. working_proxies.txt)")
    parser.add_argument("--headful", action="store_true", help="Show the browser so you can solve mangafire's captcha by hand")
    args = parser.parse_args()

    global HEADFUL
    HEADFUL = args.headful

    proxies = load_proxies(args.proxy_file)

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=not HEADFUL)
        context_kwargs = dict(
            user_agent=USER_AGENT,
            viewport={"width": 1440, "height": 900},
            locale="en-US",
        )

        # Try each proxy until one survives the title page load without a
        # Cloudflare challenge and shows chapter rows.
        context = None
        page = None
        last_error = None
        for proxy in ([None] + proxies) if proxies else [None]:
            try:
                if proxy:
                    context_kwargs["proxy"] = {"server": proxy}
                context = browser.new_context(**context_kwargs)
                page = context.new_page()
                print(f"[*] Probing proxy: {proxy or '(direct)'}")
                page.goto(args.url, wait_until="domcontentloaded", timeout=45000)
                # Cloudflare "Just a moment..." can auto-resolve; wait it out.
                for _ in range(10):
                    if not is_challenge(page):
                        break
                    page.wait_for_timeout(2000)
                page.wait_for_timeout(2000)
                rows = page.evaluate(
                    """() => {
                        const out = [];
                        document.querySelectorAll('a[href*="/chapter/"]').forEach(a => {
                            const m = (a.textContent || '').match(/(\\d+)/);
                            if (m) out.push(m[1]);
                        });
                        return out.length;
                    }"""
                )
                if rows > 0:
                    print(f"[*] Using proxy: {proxy or '(direct)'}")
                    break
                print(f"    [warn] no chapter rows via {proxy or '(direct)'}")
                context.close()
            except Exception as exc:
                last_error = exc
                print(f"    [warn] proxy failed: {exc}")
                if context:
                    try:
                        context.close()
                    except Exception:
                        pass
        if page is None:
            print(f"[!] All proxies failed: {last_error}", file=sys.stderr)
            return 1

        try:
            print("[*] Collecting chapter list (from Chapter 1 to latest)...")
            # The proxy probe already loaded the title page with chapter rows,
            # so reuse it (reloading would re-trigger mangafire's WAF).
            chapters = collect_all_chapters(page, args.url, already_loaded=True)
            if not chapters:
                print("[!] No chapters collected.", file=sys.stderr)
                return 1
            print(f"[*] {len(chapters)} chapters: Ch. {chapters[0]['number']} .. Ch. {chapters[-1]['number']}\n")

            print("[*] Fetching page URLs for each chapter...")
            data = build_scraped_json(page, args.url, chapters, context=context)

            out = Path(args.output)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"\n[*] Saved -> {out}")
            print(f"[*] Chapters: {len(chapters)} · Pages: {data.get('total_pages', 0)}")
            return 0
        finally:
            browser.close()


if __name__ == "__main__":
    sys.exit(main())
