#!/usr/bin/env python3
"""
scrape_solo_leveling.py - Scrape ALL Solo Leveling chapters (1-200) from mangafire.to.
Saves progress incrementally so it can resume if interrupted.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

from playwright.sync_api import sync_playwright
from tqdm import tqdm

YOMIKAZE_DIR = Path(r"d:\MANGA MANHUA WEBSITE\YOMIKAZE")
SCRAPED_JSON = YOMIKAZE_DIR / "public" / "scraped.json"
PROGRESS_FILE = YOMIKAZE_DIR / "public" / "solo_leveling_progress.json"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)

MANGA_URL = "https://mangafire.to/title/52x0-solo-leveling"
WORKING_PROXY = "http://66.163.119.55:10006"


def slugify(s: str, max_len: int = 80) -> str:
    s = re.sub(r"[^\w\s-]", "", s).strip().lower()
    s = re.sub(r"[\s-]+", "-", s)
    return s[:max_len] or "chapter"


def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        try:
            return json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"chapters": {}, "completed": False}


def save_progress(progress: dict):
    PROGRESS_FILE.write_text(json.dumps(progress, indent=2, ensure_ascii=False), encoding="utf-8")


def load_existing(out_path: Path) -> dict:
    if out_path.exists():
        try:
            return json.loads(out_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"items": [], "chapters": []}


def merge_and_write(data: dict, out_path: Path, fresh: bool = False) -> None:
    existing = {"items": [], "chapters": []} if fresh else load_existing(out_path)

    if not fresh:
        existing_items = {item.get("source_id"): item for item in existing.get("items", []) if item.get("source_id")}
        existing_chapters = {ch.get("chapter_id"): ch for ch in existing.get("chapters", []) if ch.get("chapter_id")}
    else:
        existing_items = {}
        existing_chapters = {}

    for item in data.get("items", []):
        sid = item.get("source_id")
        if sid:
            existing_items[sid] = item

    for ch in data.get("chapters", []):
        cid = ch.get("chapter_id")
        if cid:
            existing_chapters[cid] = ch

    merged = {
        "items": list(existing_items.values()),
        "chapters": list(existing_chapters.values()),
    }

    out_path.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[*] Saved to {out_path}")
    print(f"    Items: {len(merged['items'])}, Chapters: {len(merged['chapters'])}")


def wait_out_challenge(page, timeout: int = 120) -> bool:
    """Wait while mangafire shows its captcha."""
    waited = 0
    while waited < timeout:
        url = page.url
        if "@waf" in url or "challenge" in url.lower():
            print("    [captcha] WAF challenge detected, waiting...")
            sys.stdout.flush()
            time.sleep(5)
            waited += 5
            continue
        try:
            txt = page.evaluate("() => (document.body ? document.body.innerText : '')")
            if "verify you're human" in txt.lower() or "click the shapes" in txt.lower():
                print("    [captcha] WAF challenge detected, waiting...")
                sys.stdout.flush()
                time.sleep(5)
                waited += 5
                continue
        except Exception:
            pass
        return True
    return False


def api_get(page, path: str, query: str = "", delay: float = 0.4) -> dict | None:
    """Call mangafire API with vrf token."""
    for attempt in range(3):
        try:
            token = page.evaluate(
                """(args) => {
                    if (typeof window.getProtectionToken !== 'function') {
                        return null;
                    }
                    const t = window.getProtectionToken(args.path, args.query);
                    return t ? String(t) : null;
                }""",
                {"path": path, "query": query},
            )
        except Exception:
            token = None
        
        if not token:
            time.sleep(2)
            continue
            
        sep = "&" if query else ""
        url = f"https://mangafire.to{path}?{query}{sep}vrf={token}"
        resp = page.request.get(url)
        if resp.status == 200:
            try:
                return resp.json()
            except Exception:
                pass
        if attempt < 2:
            wait = 3 * (2 ** attempt)
            print(f"    [retry] {path} -> HTTP {resp.status}, waiting {wait}s")
            sys.stdout.flush()
            time.sleep(wait)
    return None


def collect_all_chapters(page, title_url: str) -> list[dict]:
    """Collect ALL chapter links from a title page with pagination."""
    items: dict[int, dict] = {}

    for nav_attempt in range(3):
        try:
            page.goto(title_url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(4000)
            if not wait_out_challenge(page, timeout=60):
                print(f"    [warn] captcha on nav attempt {nav_attempt + 1}/3")
                time.sleep(5)
                continue
        except Exception as exc:
            print(f"    [warn] goto failed: {exc}")
            time.sleep(4)
            continue

        items.clear()
        
        # Get all chapters with pagination
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

            # Try to click next page
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

        if items:
            print(f"[*] Collected {len(items)} chapters from {page_num} pages")
            sys.stdout.flush()
            return [items[n] for n in sorted(items)]

        print(f"    [warn] no chapters on nav attempt {nav_attempt + 1}/3")
        time.sleep(6)

    return []


def fetch_title_meta(page, hid: str) -> dict:
    """Fetch title metadata from API."""
    title_api = api_get(page, f"/api/titles/{hid}", delay=0.5)
    if not title_api or "data" not in title_api:
        return {}
    d = title_api["data"]
    poster = d.get("poster") or {}
    cover_url = poster.get("large") or poster.get("medium") or poster.get("small") or ""
    synopsis = re.sub("<[^>]+>", "", d.get("synopsisHtml") or "").strip()
    authors = [a.get("name", "") for a in (d.get("authors") or []) if a.get("name")]
    artists = [a.get("name", "") for a in (d.get("artists") or []) if a.get("name")]
    
    # Use URL slug as source_id so it matches the frontend routing
    url_slug = d.get("url", "").rstrip("/").split("/")[-1] or hid
    
    return {
        "source": "mangafire",
        "source_id": url_slug,
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
        "chapter_count": "0",
    }


def fetch_chapter_pages(page, chapter_id: int, delay: float = 0.5, max_retries: int = 3) -> list[str]:
    """Fetch page URLs for a chapter with retries."""
    for attempt in range(max_retries):
        try:
            detail = api_get(page, f"/api/chapters/{chapter_id}", delay=delay)
            if detail and "data" in detail:
                return [p.get("url", "") for p in (detail["data"].get("pages") or []) if p.get("url")]
            return []
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(2 * (attempt + 1))
            else:
                print(f"\n    [warn] Failed to fetch chapter {chapter_id} after {max_retries} attempts: {e}")
                sys.stdout.flush()
                return []
    return []


def main():
    parser = argparse.ArgumentParser(description="Scrape ALL Solo Leveling chapters into YOMIKAZE")
    parser.add_argument("--url", default=MANGA_URL, help="MangaFire title URL")
    parser.add_argument("--proxy", default=WORKING_PROXY, help="Proxy to use")
    parser.add_argument("--fresh", action="store_true", help="Overwrite scraped.json")
    parser.add_argument("--resume", action="store_true", help="Resume from last progress")
    args = parser.parse_args()

    url = args.url
    hid = urlparse(url).path.split("/")[-1].split("-")[0]
    print(f"[*] Scraping: {url}")
    print(f"[*] HID: {hid}")
    print(f"[*] Proxy: {args.proxy}")
    sys.stdout.flush()

    # Load progress
    progress = load_progress() if args.resume else {"chapters": {}, "completed": False}
    
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=USER_AGENT,
            proxy={"server": args.proxy},
            viewport={"width": 1280, "height": 900},
        )
        page = context.new_page()

        try:
            # First load mangafire.to to get protection token
            print("[*] Loading mangafire.to...")
            sys.stdout.flush()
            page.goto("https://mangafire.to/", wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(3000)

            # Get all chapters
            print("[*] Collecting all chapters...")
            sys.stdout.flush()
            chapters = collect_all_chapters(page, url)
            if not chapters:
                print("[!] No chapters found")
                return 1

            print(f"[*] Found {len(chapters)} chapters")
            sys.stdout.flush()

            # Get metadata
            meta = fetch_title_meta(page, hid)
            if meta:
                meta["chapter_count"] = str(len(chapters))
                print(f"[*] Title: {meta['title']} | Type: {meta.get('type')} | Rating: {meta.get('rating')}")
                sys.stdout.flush()
            else:
                print("[!] Failed to fetch metadata, using defaults")
                meta = {
                    "source": "mangafire",
                    "source_id": hid,
                    "title": "Solo Leveling",
                    "type": "manhwa",
                    "alt_titles": [],
                    "description": "",
                    "authors": [],
                    "genres": [],
                    "status": "releasing",
                    "url": url,
                    "chapter_count": str(len(chapters)),
                }

            series_id = meta.get("source_id") or hid
            selected = chapters  # All chapters

            scraped_chapters = []
            total = len(chapters)
            failed_chapters = []
            
            print(f"[*] Starting download: {total} chapters")
            print(f"[*] This will take a while...")
            sys.stdout.flush()
            
            pbar = tqdm(total=total, desc="Scraping", unit="chapter")
            
            for i, ch in enumerate(chapters):
                ch_num = ch["number"]
                ch_id = f"{series_id}-{ch_num}"
                
                # Skip if already completed
                if args.resume and ch_id in progress["chapters"]:
                    scraped_chapters.append(progress["chapters"][ch_id])
                    pbar.update(1)
                    continue
                
                # Fetch pages with retries
                pages = []
                for retry in range(3):
                    try:
                        pages = fetch_chapter_pages(page, ch["id"], delay=0.3)
                        break
                    except Exception as e:
                        if retry < 2:
                            time.sleep(2 * (retry + 1))
                        else:
                            failed_chapters.append(ch_num)
                            print(f"\n[!] Failed Ch. {ch_num} after 3 retries: {e}")
                            sys.stdout.flush()
                
                time.sleep(0.2)
                
                chapter_data = {
                    "source": "mangafire",
                    "series_id": series_id,
                    "chapter_id": ch_id,
                    "number": ch_num,
                    "title": f"Chapter {ch_num}",
                    "url": ch["url"],
                    "pages": pages,
                }
                scraped_chapters.append(chapter_data)
                progress["chapters"][ch_id] = chapter_data
                
                # Update progress bar
                pbar.update(1)
                pbar.set_postfix({"current": f"Ch.{ch_num}", "pages": len(pages)})
                
                # Save progress every 10 chapters
                if (i + 1) % 10 == 0:
                    save_progress(progress)
                    print(f"\n[*] Progress saved: {i+1}/{total} chapters")
                    sys.stdout.flush()
            
            pbar.close()

            data = {
                "items": [meta],
                "chapters": scraped_chapters,
            }

            merge_and_write(data, SCRAPED_JSON, fresh=args.fresh)
            print("[+] DONE! All chapters scraped successfully.")
            return 0

        finally:
            context.close()
            browser.close()


if __name__ == "__main__":
    sys.exit(main())
