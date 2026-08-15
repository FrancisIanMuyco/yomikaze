#!/usr/bin/env python3
"""mangafire_multi.py — scrape MANY mangafire.to series into one scraped.json.

Reuses the API technique from mangafire_all_chapters.py (browser + in-page
getProtectionToken vrf tokens) but processes a LIST of title URLs and merges
everything into a single YOMIKAZE-compatible public/scraped.json.

Usage:
  python mangafire_multi.py <url1> <url2> ... [--output path/to/scraped.json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "YOMIKAZE" / "public" / "scraped.json"


def api_get(page, path: str, query: str = "") -> dict | None:
    """Call a mangafire API endpoint using an in-page generated vrf token."""
    token = page.evaluate(
        """(args) => {
            const t = window.getProtectionToken(args.path, args.query);
            return t ? String(t) : null;
        }""",
        {"path": path, "query": query},
    )
    if not token:
        return None
    sep = "&" if query else ""
    url = f"https://mangafire.to{path}?{query}{sep}vrf={token}"
    resp = page.request.get(url)
    if resp.status != 200:
        print(f"    [warn] API {path} -> HTTP {resp.status}", file=sys.stderr)
        return None
    try:
        return resp.json()
    except Exception:
        return None


def collect_all_chapters(page, title_url: str) -> list[dict]:
    """Click the chapter-list pager to load every chapter (all pages)."""
    page.goto(title_url, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(5000)

    items: dict[int, dict] = {}  # chapter number -> item
    last_page = 1
    for page_num in range(1, 50):
        rows = page.evaluate(
            """() => {
                const out = [];
                document.querySelectorAll('a[href*="/chapter/"]').forEach(a => {
                    const m = (a.textContent || '').match(/(\\d+)/);
                    const num = m ? parseInt(m[1]) : null;
                    const idm = (a.href || '').match(/chapter\\/(\\d+)/);
                    if (num && idm) out.push({ id: parseInt(idm[1]), number: num, url: a.href });
                });
                return out;
            }"""
        )
        for r in rows:
            items[r["number"]] = r
        print(f"    page {page_num}: {len(rows)} rows on page, {len(items)} unique so far")

        pagers = page.evaluate(
            """() => {
                const nums = Array.from(document.querySelectorAll('.npager__num'));
                return nums.map(b => parseInt((b.textContent||'').trim(), 10)).filter(n => !isNaN(n));
            }"""
        )
        if pagers:
            last_page = max(pagers)
        if page_num >= last_page:
            break

        clicked = page.evaluate(
            """(next) => {
                const btns = Array.from(document.querySelectorAll('.npager__num'));
                for (const b of btns) {
                    if (parseInt((b.textContent||'').trim(), 10) === next) {
                        b.click();
                        return true;
                    }
                }
                return false;
            }""",
            page_num + 1,
        )
        if not clicked:
            break
        page.wait_for_timeout(3000)

    return [items[n] for n in sorted(items)]


def scrape_title(page, title_url: str) -> tuple[dict | None, list[dict]]:
    """Scrape one title: returns (item, chapters). item may be None if meta failed."""
    hid_match = re.search(r"/title/([^/?#]+)", title_url)
    hid = hid_match.group(1).split("-")[0] if hid_match else ""

    print(f"\n=== {title_url} ===")
    chapters = collect_all_chapters(page, title_url)
    if not chapters:
        print("    [!] No chapters collected — skipping", file=sys.stderr)
        return None, []

    print(f"    collected {len(chapters)} chapters (Ch. {chapters[0]['number']} .. Ch. {chapters[-1]['number']})")

    title_info: dict = {}
    if hid:
        title_api = api_get(page, f"/api/titles/{hid}")
        if title_api and "data" in title_api:
            d = title_api["data"]
            poster = d.get("poster") or {}
            cover_url = poster.get("large") or poster.get("medium") or poster.get("small") or ""
            synopsis = re.sub("<[^>]+>", "", d.get("synopsisHtml") or "").strip()
            authors = [a.get("name", "") for a in (d.get("authors") or []) if a.get("name")]
            artists = [a.get("name", "") for a in (d.get("artists") or []) if a.get("name")]
            title_info = {
                "source": "mangafire",
                "source_id": d.get("title") or d.get("slug") or "untitled",
                "title": d.get("title") or d.get("slug") or "Untitled",
                "type": d.get("type") or "",          # manhua / manhwa / manga
                "alt_titles": d.get("altTitles") or [],
                "description": synopsis or "",
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
            print(f"    title: {title_info['title']} | type={title_info['type']} | rating={title_info['rating']} | {len(chapters)} chapters")
        else:
            print("    [warn] title API failed — using slug as name", file=sys.stderr)

    series_id = title_info.get("source_id") or (hid or "series")

    scraped_chapters = []
    total_pages = 0
    for i, ch in enumerate(chapters):
        detail = api_get(page, f"/api/chapters/{ch['id']}")
        pages = []
        if detail and "data" in detail:
            pages = [p.get("url", "") for p in (detail["data"].get("pages") or []) if p.get("url")]
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
        if (i + 1) % 10 == 0 or i == len(chapters) - 1:
            print(f"    chapter {i+1}/{len(chapters)}: Ch. {ch['number']} — {len(pages)} pages")

    return title_info or None, scraped_chapters


def main() -> int:
    parser = argparse.ArgumentParser(description="Scrape multiple mangafire.to series into one scraped.json")
    parser.add_argument("urls", nargs="+", help="Series page URLs")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output JSON path")
    args = parser.parse_args()

    all_items: list[dict] = []
    all_chapters: list[dict] = []
    total_pages = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        context = browser.new_context(
            user_agent=USER_AGENT,
            viewport={"width": 1440, "height": 900},
            locale="en-US",
        )
        page = context.new_page()
        try:
            for url in args.urls:
                try:
                    item, chapters = scrape_title(page, url)
                except Exception as exc:  # noqa: BLE001
                    print(f"    [!] Error scraping {url}: {exc}", file=sys.stderr)
                    continue
                if item and chapters:
                    all_items.append(item)
                    all_chapters.extend(chapters)
                    total_pages += sum(len(c["pages"]) for c in chapters)
            print("\n[*] All titles done.")
        finally:
            browser.close()

    if not all_items:
        print("[!] Nothing scraped.", file=sys.stderr)
        return 1

    data = {
        "items": all_items,
        "chapters": all_chapters,
        "total_chapters": len(all_chapters),
        "total_pages": total_pages,
    }
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n[*] Saved -> {out}")
    print(f"[*] Titles: {len(all_items)} · Chapters: {len(all_chapters)} · Pages: {total_pages}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
