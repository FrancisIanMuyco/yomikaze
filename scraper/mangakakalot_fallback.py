#!/usr/bin/env python3
"""mangakakalot_fallback.py — fallback source for mangafire_catalog.py.

When mangafire.to blocks a title with captchas even after proxy rotation,
this module searches mangakakalot.gg for the SAME title and scrapes its
metadata, chapter list and page images there — so no title gets skipped.

The site is Cloudflare-protected (same as mangafire), so it is driven with
the real Chrome browser + rotating proxies, reusing the generic
network-response image capture from response_scraper as the reliable page
image source, with classic mangakakalot DOM selectors as the fast path.

Usage (standalone debug):
    python mangakakalot_fallback.py "Solo Leveling" --proxy http://ip:port

Integrated use:
    from mangakakalot_fallback import try_fallback_title
    item, chapters = try_fallback_title(page, context, title_query, ...)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

# Force UTF-8 so CJK chars don't crash Windows consoles.
try:
    if sys.stdout and sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if sys.stderr and sys.stderr.encoding and sys.stderr.encoding.lower() not in ("utf-8", "utf8"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from response_scraper.response_scraper import capture_images_in_context
    RESPONSE_FALLBACK = True
except Exception:
    RESPONSE_FALLBACK = False

DOMAIN = "https://www.mangakakalot.gg"

# ---------------------------------------------------------------------------
# Selectors (classic mangakakalot / manganato clone layout — several fallbacks)
# ---------------------------------------------------------------------------

SEARCH_URL = f"{DOMAIN}/search/story/{{query}}"

RESULT_SELECTORS = [
    'div.story_item a[href*="/manga/"]',
    'div.story-item a[href*="/manga/"]',
    'div.item-img a[href*="/manga/"]',
    'a[href*="/manga/"]',
]

TITLE_SELECTORS = [
    "div.story-info-right h1",
    "div.story-info-right .story-title",
    "h1",
    "meta[property='og:title']",
]

DESC_SELECTORS = [
    "div#panel-story-info-description",
    "div.story-info-right .story-info-right-extent",
    "div.story-info-right .description",
    "meta[name='description']",
]

GENRE_SELECTORS = [
    'div.story-info-right a[href*="/genre/"]',
    'div.genres a[href*="/genre/"]',
    'a[href*="/genre/"]',
]

AUTHOR_SELECTORS = [
    'a[href*="/author/"]',
    'div.story-info-right .author a',
]

COVER_SELECTORS = [
    "div.story-info-left img",
    "div.story-info-right img",
    "meta[property='og:image']",
]

CHAPTER_LINK_SELECTORS = [
    "div.chapter-list div.row a.chapter-name",
    "div.chapter-list a.chapter-name",
    "ul.row-content-chapter li a.chapter-name",
    'a[href*="/chapter/"]',
]

IMG_SELECTORS = [
    "div.vung-doc img",
    "#vungdoc img",
    ".container-chapter-reader img",
    ".reading-content img",
    "img.chapter-img",
]

IMAGE_EXTS_RE = re.compile(r"\.(?:jpe?g|png|webp|gif|avif)(?:\?|$)", re.I)
IGNORED_HINTS = ("logo", "favicon", "avatar", "banner", "thumb", "icon")


def _first_text(page, selectors: list[str], attr: str | None = None, default: str = "") -> str:
    """Return the first non-empty text (or attribute) matching any selector."""
    for sel in selectors:
        try:
            if attr:
                val = page.evaluate(
                    f"""() => {{
                        const el = document.querySelector({sel!r});
                        return el ? (el.getAttribute({attr!r}) || el.content || '') : '';
                    }}"""
                )
            else:
                val = page.evaluate(
                    f"""() => {{
                        const el = document.querySelector({sel!r});
                        return el ? (el.innerText || el.textContent || '').trim() : '';
                    }}"""
                )
            if val:
                return str(val).strip()
        except Exception:
            continue
    return default


def _all_texts(page, selectors: list[str], attr: str | None = None) -> list[str]:
    """Collect text/attributes from ALL matching elements across selectors."""
    out: list[str] = []
    seen: set[str] = set()
    for sel in selectors:
        try:
            if attr:
                vals = page.evaluate(
                    f"""() => Array.from(document.querySelectorAll({sel!r}))
                        .map(el => el.getAttribute({attr!r}) || el.content || '').filter(Boolean)"""
                )
            else:
                vals = page.evaluate(
                    f"""() => Array.from(document.querySelectorAll({sel!r}))
                        .map(el => (el.innerText || el.textContent || '').trim()).filter(Boolean)"""
                )
            for v in vals:
                if v and v not in seen:
                    seen.add(v)
                    out.append(str(v))
        except Exception:
            continue
    return out


# ---------------------------------------------------------------------------
# Chapter discovery
# ---------------------------------------------------------------------------

def collect_chapters_kk(page, detail_url: str, timeout_s: int = 60) -> list[dict]:
    """Return [{number, url}] for every chapter on the detail page (reverse order fixed)."""
    try:
        page.goto(detail_url, wait_until="domcontentloaded", timeout=timeout_s * 1000)
        page.wait_for_timeout(3500)
    except Exception as exc:
        print(f"    [kk][warn] goto {detail_url} failed: {exc}", file=sys.stderr)
        return []

    links: list[tuple[str, str]] = []  # (text, href)
    for sel in CHAPTER_LINK_SELECTORS:
        try:
            rows = page.evaluate(
                f"""() => Array.from(document.querySelectorAll({sel!r}))
                    .map(a => ({{ text: (a.textContent || '').trim(), href: a.href }})).filter(x => x.href)"""
            )
        except Exception:
            continue
        if rows:
            links = [(r["text"], r["href"]) for r in rows]
            break

    if not links:
        print("    [kk][warn] no chapter links found on detail page", file=sys.stderr)
        return []

    chapters: dict[str, dict] = {}  # href -> chapter
    for text, href in links:
        m = re.search(r"(\d+(?:\.\d+)?)", text or "")
        if not m:
            continue
        num = float(m.group(1))
        chapters[href] = {"number": num, "url": href}

    # Classic mangakakalot lists newest-first; store ascending by number.
    ordered = sorted(chapters.values(), key=lambda c: c["number"])
    print(f"    [kk] found {len(ordered)} chapters on mangakakalot.gg")
    return ordered


# ---------------------------------------------------------------------------
# Page images
# ---------------------------------------------------------------------------

def _grab_dom_images(page) -> list[str]:
    """Fast path: read <img> src / data-src from the reader page."""
    try:
        urls = page.evaluate(
            """() => Array.from(document.querySelectorAll('img')).map(img =>
                img.currentSrc || img.src || img.getAttribute('data-src') ||
                img.getAttribute('data-original') || img.getAttribute('data-lazy-src') || ''
            ).filter(u => u && u.startsWith('http'))"""
        )
    except Exception:
        return []
    out: list[str] = []
    for u in urls:
        low = u.lower()
        if IMAGE_EXTS_RE.search(low) and not any(h in low for h in IGNORED_HINTS):
            if u not in out:
                out.append(u)
    return out


def fetch_chapter_pages_kk(page, context, chapter_url: str) -> list[str]:
    """Page images for one mangakakalot chapter: DOM fast path, network capture fallback."""
    try:
        page.goto(chapter_url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(3000)
    except Exception as exc:
        print(f"    [kk][warn] chapter goto failed: {exc}", file=sys.stderr)
        return []

    pages = _grab_dom_images(page)
    if pages:
        return pages

    if RESPONSE_FALLBACK and context is not None:
        print("    [kk][fallback] no DOM images - using network-response capture...")
        try:
            pages = capture_images_in_context(context, chapter_url)
            print(f"    [kk][fallback] captured {len(pages)} pages")
        except Exception as exc:
            print(f"    [kk][fallback] capture failed: {exc}", file=sys.stderr)
    return pages


# ---------------------------------------------------------------------------
# Full title scrape (returns data in the same shape as mangafire_catalog.py)
# ---------------------------------------------------------------------------

def scrape_title_kk(
    page,
    context,
    title_query: str,
    chapters_mode: str = "all",
    delay: float = 0.5,
    existing_chapter_ids: set[str] | None = None,
) -> tuple[dict | None, list[dict]]:
    """Search mangakakalot.gg for title_query and scrape metadata + chapters.

    Returns (item, chapters) in the same shape mangafire_catalog.merge_and_write
    expects (item uses 'mangakakalot' as source, chapters use series_id =
    the mangakakalot slug so they never collide with mangafire ids).
    """
    existing_chapter_ids = existing_chapter_ids or set()
    query = (title_query or "").strip()
    if not query:
        return None, []

    # 1) Search
    from urllib.parse import quote
    search_url = SEARCH_URL.format(query=quote(query))
    print(f"    [kk] searching mangakakalot.gg: {search_url}")
    try:
        page.goto(search_url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(4000)
    except Exception as exc:
        print(f"    [kk][warn] search failed: {exc}", file=sys.stderr)
        return None, []

    result_links: list[tuple[str, str]] = []
    for sel in RESULT_SELECTORS:
        try:
            rows = page.evaluate(
                f"""() => Array.from(document.querySelectorAll({sel!r}))
                    .map(a => ({{ text: (a.textContent || a.title || '').trim(), href: a.href }}))
                    .filter(x => x.href && x.href.includes('/manga/'))"""
            )
        except Exception:
            continue
        if rows:
            result_links = [(r["text"], r["href"]) for r in rows]
            break

    if not result_links:
        print("    [kk][warn] no search results", file=sys.stderr)
        return None, []

    # Prefer an exact-ish title match; otherwise take the first result.
    q_low = query.lower()
    best = None
    for text, href in result_links:
        if q_low in (text or "").lower():
            best = (text, href)
            break
    if best is None:
        best = result_links[0]
    detail_url = best[1]
    print(f"    [kk] picked: {best[0]} -> {detail_url}")

    # 2) Chapters
    chapters = collect_chapters_kk(page, detail_url)
    if not chapters:
        print("    [kk][warn] no chapters collected - giving up on this title", file=sys.stderr)
        return None, []

    # 3) Metadata
    hid = detail_url.rstrip("/").split("/")[-1]
    item = {
        "source": "mangakakalot",
        "source_id": hid,
        "title": _first_text(page, TITLE_SELECTORS) or best[0] or title_query,
        "type": "manga",
        "alt_titles": [],
        "description": _first_text(page, DESC_SELECTORS) or "",
        "authors": _all_texts(page, AUTHOR_SELECTORS),
        "genres": _all_texts(page, GENRE_SELECTORS),
        "status": "releasing",
        "year": None,
        "rating": None,
        "rank": None,
        "cover_url": _first_text(page, COVER_SELECTORS, attr="src") or _first_text(page, COVER_SELECTORS, attr="content"),
        "url": detail_url,
        "chapter_count": str(len(chapters)),
    }

    # 4) Chapter pages — iterate ALL chapters (so the full list is stored),
    #    but fetch page images only for the selected subset (matches mangafire).
    if chapters_mode == "all":
        selected = chapters
    elif chapters_mode == "none":
        selected = []
    else:  # latest-N
        try:
            n = int(chapters_mode.split("-")[1])
        except Exception:
            n = 20
        selected = chapters[-n:]
    selected_urls = {c["url"] for c in selected}

    scraped_chapters: list[dict] = []
    total_pages = 0
    for i, ch in enumerate(chapters, 1):
        # Keep decimal chapter numbers (e.g. 1.5) so ids never collide.
        num = ch["number"]
        num_s = str(int(num)) if float(num).is_integer() else str(num)
        # Resume: skip pages already merged into scraped.json for this chapter.
        ch_id = f"{hid}-{num_s}"
        if ch_id in existing_chapter_ids:
            print(f"    [kk] skip Ch. {num_s} (already downloaded)")
            continue
        pages = fetch_chapter_pages_kk(page, context, ch["url"]) if ch["url"] in selected_urls else []
        time.sleep(delay)
        total_pages += len(pages)
        scraped_chapters.append({
            "source": "mangakakalot",
            "series_id": hid,
            "chapter_id": ch_id,
            "number": num,
            "title": f"Chapter {num_s}",
            "url": ch["url"],
            "pages": pages,
        })
        if i % 10 == 0:
            print(f"    [kk] {i}/{len(chapters)} chapters, {total_pages} pages so far")

    print(f"    [kk] done: {len(scraped_chapters)} chapters, {total_pages} pages")
    return item, scraped_chapters


# ---------------------------------------------------------------------------
# Standalone CLI (debugging a single title)
# ---------------------------------------------------------------------------

def main() -> int:
    from playwright.sync_api import sync_playwright

    parser = argparse.ArgumentParser(description="mangakakalot.gg fallback scraper (debug)")
    parser.add_argument("title", help="Title to search for on mangakakalot.gg")
    parser.add_argument("--proxy", default=None, help="Proxy, e.g. http://ip:port")
    parser.add_argument("--chapters", default="all", help="all | none | latest-N")
    parser.add_argument("--output", default=None, help="Save result JSON to this path")
    args = parser.parse_args()

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        ctx_kwargs = {"user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"}
        if args.proxy:
            ctx_kwargs["proxy"] = {"server": args.proxy}
        ctx = browser.new_context(**ctx_kwargs)
        page = ctx.new_page()
        try:
            item, chapters = scrape_title_kk(page, ctx, args.title, chapters_mode=args.chapters)
        finally:
            browser.close()

    if not item:
        print("[!] Nothing scraped.", file=sys.stderr)
        return 1
    print(json.dumps({"item": item, "chapters": chapters}, indent=2, ensure_ascii=False)[:4000])
    if args.output:
        Path(args.output).write_text(
            json.dumps({"item": item, "chapters": chapters}, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
