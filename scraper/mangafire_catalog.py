#!/usr/bin/env python3
"""mangafire_catalog.py — bulk-import the MangaFire catalog into YOMIKAZE.

Discovers the most popular manga / manhua / manhwa on mangafire.to by itself
(no manual URL list needed), scrapes full metadata + chapter page images, and
merges everything into YOMIKAZE's public/scraped.json while KEEPING titles that
are already in the library.

Anti-block hardening (added after a first run that got rate-limited ~9 titles in):
  - every mangafire API call retries with exponential backoff
  - empty chapter lists are retried with re-navigation before being skipped
  - the browser context is rotated every few titles (fresh anti-bot clearance)
  - proxy rotation from working_proxies.txt to bypass captchas
  - when a title hits a captcha/block, the proxy is rotated and the SAME title
    is retried (TITLE_RETRIES times) instead of being skipped
  - if mangafire still blocks the title, it falls back to mangakakalot.gg
    (mangakakalot_fallback.py) with its own proxy rotation
  - chapters already present in the output file are skipped (safe resume)
  - titles already present in the output file are skipped (safe to re-run)

Discovery sources (ranked by popularity priority):
  1. /api/top-titles?type=trending&days=1|7|30&limit=30   (no vrf needed)
  2. /manga, /manhua, /manhwa, /latest and /filter listing pages (DOM, scrolled)

Usage:
  python mangafire_catalog.py                       # 30 NEW titles, ALL chapters
  python mangafire_catalog.py --limit 60
  python mangafire_catalog.py --chapters latest-20  # last 20 chapters per title
  python mangafire_catalog.py --chapters none       # metadata only (fast)
  python mangafire_catalog.py --limit 10 --fresh    # overwrite scraped.json
  python mangafire_catalog.py --proxy-file working_proxies.txt  # use proxies
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
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright
from tqdm import tqdm

# Network-response fallbacks (capture page images even when the API fails).
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from response_scraper.response_scraper import capture_images_in_context
    from response_scraper.mangafire_scraper import MangaFireScraper
    RESPONSE_FALLBACK = True
except Exception:
    RESPONSE_FALLBACK = False
    print("[!] response_scraper not importable - network fallback disabled", file=sys.stderr)

try:
    from mangakakalot_fallback import scrape_title_kk
    MANGAKAKALOT_FALLBACK = True
except Exception as exc:
    MANGAKAKALOT_FALLBACK = False
    print(f"[!] mangakakalot_fallback not importable - fallback source disabled ({exc})", file=sys.stderr)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "YOMIKAZE" / "public" / "scraped.json"
DEFAULT_PROXY_FILE = Path(__file__).resolve().parent.parent.parent / "proxy_checker" / "working_proxies.txt"

TRENDING_DAYS = (1, 7, 30)
LISTING_PAGES = ("/manga", "/manhua", "/manhwa", "/latest", "/filter")
LISTING_SCROLLS = 3  # extra infinite-scroll loads per listing page
# Walk several pages of each listing (mangafire supports ?page=N) so OLDER
# titles are reached too, not just the newest/trending ones.
LISTING_PAGES_DEEP = 6
CONTEXT_ROTATE_EVERY = 10  # fresh browser context every N titles (higher = fewer captchas)
API_RETRIES = 3
TITLE_RETRIES = 3        # retry the SAME title with a fresh proxy when captcha/block hits
DISCOVERY_RETRIES = 2    # rotate proxy and retry discovery when no candidates come back

# Set by main() -- controls whether the browser window is visible so the user
# can solve mangafire's interactive captcha ("click the shapes") by hand.
HEADFUL = False

CHALLENGE_MARKERS = ("@waf", "challenge", "verify you're human", "click the shapes")


def parse_proxy(raw: str) -> tuple[str, str | None, str | None]:
    """Split 'scheme://user:pass@host:port' into (server, username, password).

    Playwright needs proxy credentials as separate fields — credentials
    embedded in the server URL are not reliably used for authentication.
    Plain 'http://host:port' (no auth) returns username/password = None.
    Works for http(s) and socks4/socks5 lines alike.
    """
    server, username, password = raw, None, None
    if "://" in raw:
        scheme, rest = raw.split("://", 1)
        if "@" in rest:
            auth, hostport = rest.rsplit("@", 1)
            server = f"{scheme}://{hostport}"
            username, _, password = auth.partition(":")
            username = username or None
            password = password or None
    return server, username, password


def mask_proxy(raw: str) -> str:
    """Show a proxy line in logs without leaking its password."""
    server, username, password = parse_proxy(raw)
    if username and password and server != raw:
        scheme = raw.split("://", 1)[0]
        return f"{scheme}://{username}:****@{server.split('://', 1)[1]}"
    return raw


def load_proxies(path: str) -> list[str]:
    """Load proxies from a file (one per line: http://ip:port, ip:port,
    http://user:pass@host:port, or the legacy ip:port:user:pass format from
    paid-proxy batches — that last one is auto-converted)."""
    p = Path(path)
    if not p.exists():
        print(f"[WARN] Proxy file not found: {path}")
        return []
    proxies = []
    for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line:
            continue
        if "://" not in line:
            parts = line.split(":", 3)
            if len(parts) == 4:  # ip:port:user:pass
                line = f"http://{parts[2]}:{parts[3]}@{parts[0]}:{parts[1]}"
            else:
                line = f"http://{line}"
        if line.startswith(("http://", "https://", "socks5://", "socks4://")):
            proxies.append(line)
    print(f"[*] Loaded {len(proxies)} proxies from {path}")
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
    """Wait (polling) while mangafire shows its captcha, so the user can solve
    it in the visible browser window. Returns True when the page is clear."""
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


# ---------------------------------------------------------------------------
# mangafire API helpers (same technique as mangafire_all_chapters.py)
# ---------------------------------------------------------------------------

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
            # Re-prime the page in case the token helper went stale.
            try:
                page.goto("https://mangafire.to/", wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(2500)
            except Exception:
                pass
    return None


def collect_all_chapters(page, title_url: str, delay: float = 0.4) -> list[dict]:
    """Click the chapter-list pager to load every chapter (all pages).

    Retries navigation a few times if the page comes back without chapter
    links (anti-bot block pages / slow loads).
    """
    if not wait_out_challenge(page, timeout=120 if HEADFUL else 20):
        print("    [!] Captcha did not resolve - skipping", file=sys.stderr)
        return []
    items: dict[int, dict] = {}  # chapter number -> item

    for nav_attempt in range(3):
        try:
            page.goto(title_url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(4000)
            if not wait_out_challenge(page, timeout=120 if HEADFUL else 20):
                print(f"    [warn] captcha on nav attempt {nav_attempt + 1}/3", file=sys.stderr)
                time.sleep(5)
                continue
        except Exception as exc:
            print(f"    [warn] goto failed: {exc}", file=sys.stderr)
            time.sleep(4)
            continue

        items.clear()
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

            if items:
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
            else:
                break

        if items:
            return [items[n] for n in sorted(items)]

        # No chapter links found — likely a block page or slow load.
        print(f"    [warn] no chapters on nav attempt {nav_attempt + 1}/3", file=sys.stderr)
        time.sleep(6)

    return []


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

def hid_from_url(url: str) -> str:
    m = re.search(r"/title/([^/?#]+)", url)
    return m.group(1).split("-")[0] if m else ""


def normalize_title(title: str) -> str:
    """Lowercase, keep letters/digits/spaces so titles compare across sources."""
    t = re.sub(r"[^a-z0-9 ]+", " ", (title or "").lower())
    return re.sub(r"\s+", " ", t).strip()


def discover_candidates(page, limit: int, randomize: bool = True) -> list[dict]:
    """Return a deduped list of candidate title dicts.

    Scrapes the WHOLE catalog (trending rails + many pages deep of the manga /
    manhua / manhwa listings, including OLD titles) and, by default, SHUFFLES
    the candidates randomly so each run adds a different mix of new + old
    titles instead of always the newest. Titles already in the library are
    filtered out later by hid, so nothing is ever downloaded twice.
    """
    found: dict[str, dict] = {}

    def add(url: str, priority: int, rank: int | None = None, extra: dict | None = None):
        hid = hid_from_url(url)
        if not hid or hid in found:
            return
        found[hid] = {
            "hid": hid,
            "url": f"https://mangafire.to/title/{hid}",
            "priority": priority,
            "rank": rank,
            **(extra or {}),
        }

    # 1) Trending rails - no vrf token needed, ordered by popularity.
    for i, days in enumerate(TRENDING_DAYS):
        try:
            resp = page.request.get(
                f"https://mangafire.to/api/top-titles?type=trending&days={days}&limit=30",
                timeout=30000,
            )
            if resp.status != 200:
                print(f"    [warn] top-titles days={days} -> HTTP {resp.status}", file=sys.stderr)
                continue
            items = resp.json().get("items", [])
        except Exception as exc:  # noqa: BLE001 - network hiccups (ECONNRESET etc.) must not kill discovery
            print(f"    [warn] top-titles days={days} failed: {exc}", file=sys.stderr)
            continue
        for item in items:
            url = item.get("url")
            if not url:
                continue
            add(
                f"https://mangafire.to{url}",
                priority=i,
                rank=item.get("rank"),
                extra={"title": item.get("title"), "type": item.get("type")},
            )
        print(f"    trending days={days}: {len(items)} candidates")

    # 2) Listing pages - DOM scrape, walking several ?page=N pages deep so
    #    older titles (not just the newest ones) are discovered too. If a
    #    listing ignores ?page=N (returns the same titles again), we stop.
    for j, path in enumerate(LISTING_PAGES):
        seen_hrefs: set[str] = set()
        for page_num in range(1, LISTING_PAGES_DEEP + 1):
            url = f"https://mangafire.to{path}" if page_num == 1 else f"https://mangafire.to{path}?page={page_num}"
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=60000)
                page.wait_for_timeout(2500)
                if not wait_out_challenge(page, timeout=120 if HEADFUL else 20):
                    print(f"    [warn] captcha on {url} - skipping", file=sys.stderr)
                    break
            except Exception as exc:
                print(f"    [warn] {url} failed: {exc}", file=sys.stderr)
                break
            hrefs: set[str] = set()
            titles: dict[str, str] = {}
            for _ in range(LISTING_SCROLLS):
                for href, text in page.evaluate(
                    "() => Array.from(document.querySelectorAll('a[href*=\"/title/\"]')).map(a => { const img = a.querySelector('img'); const t = a.getAttribute('title') || (img ? img.getAttribute('alt') : '') || (a.textContent || '').replace(/\\s+/g, ' ').trim(); return [a.getAttribute('href'), (t || '').trim()]; })"
                ):
                    if href:
                        hrefs.add(href)
                        if text and text != href.split('/').pop():
                            titles[href] = text
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                page.wait_for_timeout(2000)
            new_hrefs = hrefs - seen_hrefs
            if not hrefs:
                break  # no more pages / blocked
            if not new_hrefs:
                print(f"    {path} page {page_num}: no NEW titles (pagination stopped) - stopping")
                break
            seen_hrefs.update(hrefs)
            for href in new_hrefs:
                add(f"https://mangafire.to{href}", priority=3 + j, extra={"title": titles.get(href, "")})
            print(f"    {path} page {page_num}: {len(new_hrefs)} new candidates")

    ranked = list(found.values())
    # Dedup by normalized title too — the same series can have several URL
    # slugs on mangafire (different hids), which would otherwise show up as
    # duplicate entries in the pick list / library. Keep the first occurrence
    # but prefer one that has a real title over a bare-hid fallback.
    by_title: dict[str, dict] = {}
    for c in ranked:
        key = normalize_title(c.get("title") or c["hid"]) or c["hid"]
        # Only dedup on titles that are distinctive enough — short generic
        # names (e.g. "Boy", "Love") can legitimately belong to several
        # different series, so those fall back to hid-based uniqueness.
        if len(key) < 4:
            key = c["hid"]
        prev = by_title.get(key)
        if prev is None or (not prev.get("title") and c.get("title")):
            by_title[key] = c
    ranked = list(by_title.values())
    if randomize:
        random.shuffle(ranked)
    else:
        ranked.sort(key=lambda c: (c["priority"], c["rank"] if c["rank"] is not None else 9999))
    print(f"    total unique candidates: {len(ranked)} (shuffled={randomize})")
    return ranked[: max(limit * 3, 90)]


def search_candidates(page, keyword: str, limit: int = 40) -> list[dict]:
    """Search mangafire.to for a keyword and return matching title dicts.

    Uses the /filter page with ?keyword= (the site's search surface) and
    scrapes title links with the same DOM technique as the listing pages.
    Deduped by hid. Returns [] if nothing was found or the page blocked us.
    """
    from urllib.parse import quote

    found: dict[str, dict] = {}
    for kind in ("manga", "manhua", "manhwa"):
        url = f"https://mangafire.to/filter?keyword={quote(keyword)}&type={kind}"
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(2500)
            if not wait_out_challenge(page, timeout=120 if HEADFUL else 20):
                print(f"    [warn] captcha on search '{keyword}' - skipping", file=sys.stderr)
                continue
        except Exception as exc:
            print(f"    [warn] search '{keyword}' failed: {exc}", file=sys.stderr)
            continue
        links: list[tuple[str, str]] = []  # (href, title text)
        for _ in range(LISTING_SCROLLS):
            links.extend(
                page.evaluate(
                    """() => Array.from(document.querySelectorAll('a[href*="/title/"]'))
                        .map(a => {
                            const img = a.querySelector('img');
                            const t = a.getAttribute('title') || (img ? img.getAttribute('alt') : '') || (a.textContent || '').replace(/\s+/g, ' ').trim();
                            return [a.getAttribute('href'), (t || '').trim()];
                        })"""
                )
            )
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(2000)
        for href, text in links:
            hid = hid_from_url(f"https://mangafire.to{href}")
            if not hid or hid in found:
                continue
            found[hid] = {
                "hid": hid,
                "url": f"https://mangafire.to/title/{hid}",
                "priority": 0,
                "rank": None,
                "title": text or hid,
                "type": "",
            }
            if len(found) >= limit:
                break
        if len(found) >= limit:
            break
    print(f"    search '{keyword}': {len(found)} unique candidates")
    return list(found.values())[:limit]


# ---------------------------------------------------------------------------
# Per-title scraping
# ---------------------------------------------------------------------------

def fetch_title_meta(page, hid: str, delay: float) -> dict:
    """Full metadata for one title (empty dict if the API fails)."""
    title_api = api_get(page, f"/api/titles/{hid}", delay=delay)
    if not title_api or "data" not in title_api:
        return {}
    d = title_api["data"]
    poster = d.get("poster") or {}
    cover_url = poster.get("large") or poster.get("medium") or poster.get("small") or ""
    synopsis = re.sub("<[^>]+>", "", d.get("synopsisHtml") or "").strip()
    authors = [a.get("name", "") for a in (d.get("authors") or []) if a.get("name")]
    artists = [a.get("name", "") for a in (d.get("artists") or []) if a.get("name")]
    return {
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
        "chapter_count": "0",
    }


def fetch_chapter_pages(page, chapter_id: int, delay: float) -> list[str]:
    detail = api_get(page, f"/api/chapters/{chapter_id}", delay=delay)
    if detail and "data" in detail:
        return [p.get("url", "") for p in (detail["data"].get("pages") or []) if p.get("url")]
    return []


def scrape_title(page, candidate: dict, chapters_mode: str, delay: float, context=None, existing_chapter_ids: set | None = None) -> tuple[dict | None, list[dict]]:
    """Scrape one title: returns (item, scraped_chapters).

    Chapters whose chapter_id is already in existing_chapter_ids are skipped
    (resume support) so interrupted runs don't re-download finished chapters.
    """
    existing_chapter_ids = existing_chapter_ids or set()
    hid = candidate["hid"]
    title = candidate.get("title") or hid
    print(f"\n=== {title} - {candidate['url']} ===")

    chapters = collect_all_chapters(page, candidate["url"], delay)
    if not chapters:
        print("    [!] No chapters collected - skipping", file=sys.stderr)
        return None, []

    meta = fetch_title_meta(page, hid, delay)
    if meta:
        meta["chapter_count"] = str(len(chapters))
        print(
            f"    {meta['title']} | type={meta.get('type')} | "
            f"rating={meta.get('rating')} | {len(chapters)} chapters"
        )
    else:
        print("    [warn] title API failed - using slug as name", file=sys.stderr)

    series_id = meta.get("source_id") or hid

    if chapters_mode == "all":
        selected = chapters
    elif chapters_mode == "none":
        selected = []
    else:  # latest-N
        n = int(chapters_mode.split("-")[1])
        selected = chapters[-n:]

    scraper_human = MangaFireScraper() if RESPONSE_FALLBACK else None

    scraped_chapters = []
    total_pages = 0
    pbar = tqdm(
        chapters,
        desc=f"Fetching pages ({title[:26]})",
        unit="ch",
        bar_format="{desc}: {n_fmt}/{total_fmt} [{percentage:3.0f}%] {bar} | {postfix} | {rate_fmt}",
        postfix="pages=0",
        dynamic_ncols=True,
        leave=False,  # don't leave a stale bar after each title
    )
    for i, ch in enumerate(pbar):
        chapter_id = f"{series_id}-{ch['number']}"
        # Resume also matches chapter ids built from the hid (used when the
        # title API failed and series_id fell back to the URL slug prefix).
        if chapter_id in existing_chapter_ids or f"{hid}-{ch['number']}" in existing_chapter_ids:
            print(f"    [skip] Ch. {ch['number']} already downloaded - skipping")
            continue
        pages = fetch_chapter_pages(page, ch["id"], delay) if ch in selected else []

        # Fallback 1: network-response capture when the API gives no pages.
        if not pages and ch in selected and RESPONSE_FALLBACK and context is not None:
            print(f"    [fallback] API gave 0 pages for Ch. {ch['number']} - using response capture...")
            try:
                pages = capture_images_in_context(context, ch["url"])
                print(f"    [fallback] captured {len(pages)} pages for Ch. {ch['number']}")
            except Exception as exc:
                print(f"    [fallback] fast capture failed for Ch. {ch['number']}: {exc}", file=sys.stderr)
            # Fallback 2: class-based humanized capture.
            if not pages and scraper_human is not None:
                print(f"    [fallback] trying humanized capture for Ch. {ch['number']}...")
                try:
                    pages = scraper_human.capture_in_context(context, ch["url"])
                    print(f"    [fallback] humanized capture got {len(pages)} pages for Ch. {ch['number']}")
                except Exception as exc:
                    print(f"    [fallback] humanized capture failed for Ch. {ch['number']}: {exc}", file=sys.stderr)

        time.sleep(delay)
        total_pages += len(pages)
        scraped_chapters.append(
            {
                "source": "mangafire",
                "series_id": series_id,
                "chapter_id": chapter_id,
                "number": ch["number"],
                "title": f"Chapter {ch['number']}",
                "url": ch["url"],
                "pages": pages,
            }
        )
        pbar.set_postfix_str(f"pages={total_pages}")
    pbar.close()

    return meta or None, scraped_chapters


# ---------------------------------------------------------------------------
# Merge + write
# ---------------------------------------------------------------------------

def load_existing(out_path: Path) -> dict:
    if out_path.exists():
        try:
            return json.loads(out_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"items": [], "chapters": []}


def merge_and_write(data: dict, out_path: Path, fresh: bool) -> None:
    existing = {"items": [], "chapters": []} if fresh else load_existing(out_path)

    items = {it["source_id"]: it for it in existing.get("items", []) if it.get("source_id")}
    chapters = {c["chapter_id"]: c for c in existing.get("chapters", []) if c.get("chapter_id")}

    added_titles = 0
    added_chapters = 0
    # Guard against title duplicates: the same series can arrive under
    # different source_ids (different URL slugs / sources), so also dedup by
    # normalized title. Chapters of a rejected duplicate item are skipped too
    # (otherwise they'd be orphaned with no matching item).
    # Only dedup on distinctive titles (>= 4 normalized chars); short generic
    # names like "Boy" can legitimately be different series.
    known_titles = {normalize_title(it.get("title", "")) for it in items.values() if len(normalize_title(it.get("title", ""))) >= 4}
    skipped_series: set[str] = set()
    for it in data.get("items", []):
        sid = it.get("source_id")
        tkey = normalize_title(it.get("title", ""))
        if sid and sid not in items and (not tkey or len(tkey) < 4 or tkey not in known_titles):
            items[sid] = it
            added_titles += 1
            if len(tkey) >= 4:
                known_titles.add(tkey)
        elif sid:
            skipped_series.add(sid)
    for c in data.get("chapters", []):
        if c.get("chapter_id") and c["chapter_id"] not in chapters and c.get("series_id") not in skipped_series:
            chapters[c["chapter_id"]] = c
            added_chapters += 1

    merged = {
        "items": list(items.values()),
        "chapters": list(chapters.values()),
        "total_chapters": len(chapters),
        "total_pages": sum(len(c["pages"]) for c in chapters.values()),
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # Atomic write: write a temp file first, then replace — if the process is
    # interrupted mid-write, scraped.json (with Solo Leveling + God Slayer)
    # stays intact and is never left truncated.
    tmp = out_path.with_suffix(out_path.suffix + ".tmp")
    tmp.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, out_path)
    print(f"\n[*] Saved -> {out_path}")
    print(
        f"[*] Titles: {len(merged['items'])} (+{added_titles}) - "
        f"Chapters: {len(merged['chapters'])} (+{added_chapters}) - "
        f"Pages: {merged['total_pages']}"
    )


def new_context(browser, proxy: str | None = None):
    ctx_args = {
        "user_agent": USER_AGENT,
        "viewport": {"width": 1440, "height": 900},
        "locale": "en-US",
    }
    if proxy:
        server, username, password = parse_proxy(proxy)
        proxy_cfg: dict = {"server": server}
        if username and password:
            proxy_cfg["username"] = username
            proxy_cfg["password"] = password
        ctx_args["proxy"] = proxy_cfg
    ctx = browser.new_context(**ctx_args)
    page = ctx.new_page()
    page.goto("https://mangafire.to/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3000)
    wait_out_challenge(page, timeout=120 if HEADFUL else 20)
    return ctx, page


def open_working_context(browser, proxies: list[str], max_proxies: int, avoid: str | None = None, old_ctx=None):
    """Close the old context (if any) and open a fresh one on a WORKING proxy.

    Tries proxies (skipping `avoid` first) until one loads mangafire without a
    captcha. Returns (ctx, page, proxy) or (None, None, None) if all fail.
    """
    if old_ctx is not None:
        try:
            old_ctx.close()
        except Exception:
            pass
    if not proxies:
        # Direct mode (--no-proxy, e.g. system on ExpressVPN): opening a
        # fresh context = the "rotation" (new anti-bot clearance).
        ctx, page = new_context(browser, None)
        return ctx, page, None
    ordered = [p for p in proxies[:max_proxies] if p != avoid] + [p for p in proxies[:max_proxies] if p == avoid]
    for proxy in ordered:
        try:
            print(f"[*] Trying proxy: {mask_proxy(proxy)}")
            ctx, page = new_context(browser, proxy)
            page.goto("https://mangafire.to/", wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(2000)
            if not is_challenge(page):
                print(f"[+] Proxy working: {mask_proxy(proxy)}")
                return ctx, page, proxy
            print(f"[-] Proxy {mask_proxy(proxy)} got captcha, trying next...")
            try:
                ctx.close()
            except Exception:
                pass
        except Exception as exc:
            print(f"[-] Proxy {mask_proxy(proxy)} failed: {exc}")
            try:
                ctx.close()
            except Exception:
                pass
            continue
    return None, None, None


def scrape_one_title(page, ctx, current_proxy, cand, chapters_mode: str, delay: float,
                     existing_chapter_ids: set, existing_titles: set, browser, proxies, max_proxies):
    """Scrape ONE title with everything built in: mangafire retry with fresh
    proxies on block, then mangakakalot.gg fallback if mangafire keeps blocking.

    Returns (item, chapters, ctx, page, current_proxy) so callers can keep
    using the rotated context/proxy state.
    """
    title_label = cand.get("title") or cand["hid"]
    item, chapters = None, []

    # 1) mangafire: retry the SAME title with fresh proxies on block.
    for attempt in range(1, TITLE_RETRIES + 1):
        try:
            item, chapters = scrape_title(page, cand, chapters_mode, delay, context=ctx, existing_chapter_ids=existing_chapter_ids)
        except Exception as exc:  # noqa: BLE001
            print(f"    [!] Error: {exc}", file=sys.stderr)
            item, chapters = None, []
        if item and chapters:
            break
        if attempt < TITLE_RETRIES:
            print(f"    [*] Blocked on '{title_label}' (attempt {attempt}) - rotating proxy, retrying SAME title...")
            ctx, page, current_proxy = open_working_context(browser, proxies, max_proxies, avoid=current_proxy, old_ctx=ctx)
            if page is None:
                print("    [!] No more working proxies - skipping title", file=sys.stderr)
                break

    # 2) Fallback source: mangakakalot.gg (same title, own proxy rotation).
    #    Guard: never add a mangakakalot copy of a title that already
    #    exists in the library under another source_id.
    already_by_title = normalize_title(title_label) in existing_titles
    if not (item and chapters) and MANGAKAKALOT_FALLBACK and not already_by_title:
        print(f"\n[*] mangafire blocked '{title_label}' - falling back to mangakakalot.gg...")
        for attempt in range(1, TITLE_RETRIES + 1):
            try:
                item, chapters = scrape_title_kk(
                    page, ctx, title_label,
                    chapters_mode=chapters_mode,
                    delay=delay,
                    existing_chapter_ids=existing_chapter_ids,
                )
            except Exception as exc:  # noqa: BLE001
                print(f"    [!] mangakakalot error: {exc}", file=sys.stderr)
                item, chapters = None, []
            if item and chapters:
                break
            if attempt < TITLE_RETRIES:
                print(f"    [*] mangakakalot blocked too (attempt {attempt}) - rotating proxy...")
                ctx, page, current_proxy = open_working_context(browser, proxies, max_proxies, avoid=current_proxy, old_ctx=ctx)
                if page is None:
                    break

    return item, chapters, ctx, page, current_proxy


def main() -> int:
    parser = argparse.ArgumentParser(description="Bulk-import mangafire.to's catalog into YOMIKAZE")
    parser.add_argument("--limit", type=int, default=30, help="Max NEW titles to import (default 30)")
    parser.add_argument(
        "--chapters",
        default="all",
        choices=["all", "none"] + [f"latest-{n}" for n in (5, 10, 20, 50)],
        help="Which chapters get page images (default all)",
    )
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output JSON path")
    parser.add_argument("--fresh", action="store_true", help="Overwrite scraped.json instead of merging")
    parser.add_argument("--delay", type=float, default=0.5, help="Seconds between chapter API calls")
    parser.add_argument("--headful", action="store_true", help="Show the browser so you can solve mangafire's captcha by hand")
    parser.add_argument("--proxy-file", default=str(DEFAULT_PROXY_FILE), help="Path to proxy list file (one proxy per line)")
    parser.add_argument("--no-proxy", action="store_true", help="Run DIRECT (no proxies) - e.g. when the system is on ExpressVPN or another VPN")
    parser.add_argument("--max-proxies", type=int, default=60, help="Max proxies to try before giving up")
    parser.add_argument("--no-random", action="store_true", help="Pick newest/trending first instead of random titles from the whole catalog")
    parser.add_argument("--update", action="store_true", help="Refresh EXISTING library titles (fetch new chapters) instead of adding new titles")
    args = parser.parse_args()

    global HEADFUL
    HEADFUL = args.headful

    proxies = [] if args.no_proxy else load_proxies(args.proxy_file)
    if not proxies and not args.no_proxy:
        print("[!] No proxies loaded. Run proxy_checker.py first, provide --proxy-file, or use --no-proxy to go direct (e.g. through ExpressVPN)")
        return 1
    if args.no_proxy:
        print("[*] --no-proxy: running DIRECT through the system connection (VPN = your exit IP).")

    out_path = Path(args.output)
    existing = load_existing(out_path)
    existing_ids = set(it["source_id"] for it in existing.get("items", []) if it.get("source_id"))
    # Also index by hid (URL slug prefix) — candidates are matched by hid, so
    # this is what actually prevents re-scraping Solo Leveling / God Slayer.
    existing_hids = set()
    for it in existing.get("items", []):
        h = hid_from_url(it.get("url", ""))
        if h:
            existing_hids.add(h)
    if existing_ids or existing_hids:
        print(
            f"[*] {len(existing_ids)} titles already in library "
            f"({len(existing_hids)} hids) - those will be skipped."
        )

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=not HEADFUL)

        # Try proxies until one works
        current_proxy = None
        ctx, page, current_proxy = open_working_context(browser, proxies, args.max_proxies)
        if page is None:
            print("[!] All proxies failed, trying without proxy...")
            ctx, page = new_context(browser, None)
        try:
            existing_titles = {
                t for it in existing.get("items", [])
                for t in [normalize_title(it.get("title", ""))] + [normalize_title(a) for a in it.get("alt_titles", [])]
                if t
            }

            # UPDATE MODE: refresh every title already in the library instead
            # of adding new ones. Candidates are built from the existing items
            # themselves, and the chapter resume logic skips chapters that are
            # already downloaded — so this only fetches NEW chapters.
            if args.update:
                candidates = [
                    {
                        "hid": h,
                        "url": it.get("url") or f"https://mangafire.to/title/{h}",
                        "title": it.get("title") or h,
                        "priority": 0,
                        "rank": None,
                    }
                    for it in existing.get("items", [])
                    for h in [hid_from_url(it.get("url", ""))]
                    if h
                ]
                fresh = candidates
                print(f"[*] UPDATE MODE: refreshing {len(candidates)} existing titles")
            else:
                # Discovery with proxy-rotation retries (the last run died here).
                candidates: list[dict] = []
                for d_attempt in range(1, DISCOVERY_RETRIES + 1):
                    print(f"[*] Discovering candidates (attempt {d_attempt}/{DISCOVERY_RETRIES})...")
                    candidates = discover_candidates(page, args.limit, randomize=not args.no_random)
                    if candidates:
                        break
                    if d_attempt < DISCOVERY_RETRIES:
                        print("[*] No candidates - rotating proxy and retrying discovery...")
                        ctx, page, current_proxy = open_working_context(browser, proxies, args.max_proxies, avoid=current_proxy, old_ctx=ctx)
                        if page is None:
                            break
                if not candidates:
                    print("[!] No candidates discovered.", file=sys.stderr)
                    return 1

                # Keep only titles not already in the library. Match by hid (the
                # URL slug prefix) AND by normalized title — the title check
                # catches titles that entered the library from mangakakalot, so
                # nothing is ever downloaded twice even across sources.
                fresh = [
                    c for c in candidates
                    if c["hid"] not in existing_hids
                    and normalize_title(c.get("title") or c["hid"]) not in existing_titles
                ]
                print(f"[*] {len(candidates)} candidates, {len(candidates) - len(fresh)} already in library, taking {min(args.limit, len(fresh))}.")

            # Update mode refreshes EVERY library title (the limit is irrelevant
            # there); add mode caps how many NEW titles get scraped.
            selected = fresh if args.update else fresh[: args.limit]
            if not selected:
                print("[!] No titles to process - nothing to do.", file=sys.stderr)
                return 0

            existing_chapter_ids = set(c["chapter_id"] for c in existing.get("chapters", []) if c.get("chapter_id"))
            total_pages = 0
            added_titles = 0

            pbar_titles = tqdm(
                selected,
                desc="Titles",
                unit="title",
                bar_format="{desc}: {n_fmt}/{total_fmt} [{percentage:3.0f}%] {bar} | {postfix} | {rate_fmt}",
                postfix="pages=0",
                dynamic_ncols=True,
            )

            for i, cand in enumerate(pbar_titles, 1):
                title_label = cand.get("title") or cand["hid"]

                # Rotate the browser context regularly to dodge rate limits.
                if i > 1 and (i - 1) % CONTEXT_ROTATE_EVERY == 0:
                    print("\n[*] Rotating browser context (fresh anti-bot clearance)...")
                    ctx, page, current_proxy = open_working_context(browser, proxies, args.max_proxies, avoid=current_proxy, old_ctx=ctx)
                    if page is None:
                        print("[!] All proxies failed during rotation", file=sys.stderr)
                        return 1

                print(f"\n--- [{i}/{len(selected)}] {title_label}")
                item, chapters, ctx, page, current_proxy = scrape_one_title(
                    page, ctx, current_proxy, cand,
                    args.chapters, args.delay,
                    existing_chapter_ids, existing_titles, browser, proxies, args.max_proxies,
                )

                if item and chapters:
                    total_pages += sum(len(c["pages"]) for c in chapters)
                    added_titles += 1
                    # Save immediately per title so nothing is lost on interrupt.
                    # --fresh only applies to the very first title of the run.
                    merge_and_write(
                        {"items": [item], "chapters": chapters},
                        out_path,
                        args.fresh and added_titles == 1,
                    )
                else:
                    print(f"    [!] '{title_label}' could not be scraped from any source - skipping", file=sys.stderr)

                pbar_titles.set_postfix_str(f"pages={total_pages}")
                time.sleep(2)

            pbar_titles.close()

            if added_titles == 0:
                print("[!] Nothing scraped.", file=sys.stderr)
                return 1
            print(f"[*] Added {added_titles} new titles this run ({total_pages} pages).")
            return 0
        finally:
            try:
                ctx.close()
            except Exception:
                pass
            browser.close()


if __name__ == "__main__":
    sys.exit(main())
