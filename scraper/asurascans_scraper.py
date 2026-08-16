#!/usr/bin/env python3
"""asurascans_scraper.py — scrape the new AsuraScans site into YOMIKAZE public/scraped.json.

Uses Scrapling (pip install "scrapling[fetchers]") for fast stealthy HTTP fetches and
parsel-style CSS/XPath parsing. AsuraScans is a server-rendered Astro site, so this needs
NO browser and NO proxies — it is far lighter and faster than the MangaFire scraper
(no Chrome, no CPU/RAM burn → laptop stays smooth).

Discovery:
  latest  → homepage "Latest Updates" Astro island (300 most recent chapter releases)
  popular → homepage series cards (Trending + Popular sections)

Per title:
  /comics/{slug}-{hash}            → ComicSeries JSON-LD (title, alt titles, description,
                                     cover, genres, author, illustrator, rating) + status/type
  chapter list                      → same page, <a href="/comics/{slug}/chapter/{N}">
  chapter pages                     → /comics/{slug}/chapter/{N}, <img class="w-full block">

Merges into public/scraped.json keeping existing titles/chapters (duplicates never re-scraped).

Usage:
  python asurascans_scraper.py                          # 25 NEW titles, ALL chapters
  python asurascans_scraper.py --limit 50
  python asurascans_scraper.py --chapters latest-20     # last 20 chapters per title
  python asurascans_scraper.py --rail popular
  python asurascans_scraper.py --search "solo leveling"
  python asurascans_scraper.py --fresh                  # overwrite scraped.json
  python asurascans_scraper.py --output test.json       # write elsewhere (no live merge)
"""

from __future__ import annotations

import argparse
import html as html_lib
import json
import re
import sys
import time
from pathlib import Path

from scrapling.fetchers import FetcherSession

BASE = "https://asurascans.com"
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "YOMIKAZE" / "public" / "scraped.json"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


# ---------------------------------------------------------------------------
# Astro island props decoder
# ---------------------------------------------------------------------------

def astro_decode(v):
    """Decode Astro's serialized-signal format (e.g. props="[1,[[0,{...}]]]")."""
    if isinstance(v, list):
        if not v or not isinstance(v[0], int):
            return [astro_decode(x) for x in v]
        t = v[0]
        val = v[1] if len(v) > 1 else None
        if t == 0:
            return astro_decode(val)
        if t == 1:
            return [astro_decode(x) for x in (val or [])]
        if t == 2:
            return {k: astro_decode(vv) for k, vv in (val or {}).items()}
        if t == 4:
            return {astro_decode(x) for x in (val or [])}
        if t == 5:
            return {k: astro_decode(vv) for k, vv in (val or [])}
        return val
    if isinstance(v, dict):
        return {k: astro_decode(vv) for k, vv in v.items()}
    return v


def island_props(html: str, component: str) -> dict | None:
    """Extract + decode the props of an <astro-island> whose component-url contains `component`."""
    idx = html.find(component)
    if idx < 0:
        return None
    tag_start = html.rfind("<astro-island", 0, idx)
    if tag_start < 0:
        return None
    tag_end = html.find(">", tag_start)
    tag = html[tag_start:tag_end]
    m = re.search(r'props="([^"]*)"', tag)
    if not m:
        return None
    try:
        raw = html_lib.unescape(m.group(1))
        return astro_decode(json.loads(raw))
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Scraper
# ---------------------------------------------------------------------------

def fetch(session: FetcherSession, url: str, delay: float):
    """GET a page through the shared session with a small politeness delay."""
    time.sleep(delay)
    page = session.get(url, stealthy_headers=True)
    if page.status != 200:
        raise RuntimeError(f"{url} -> HTTP {page.status}")
    return page


def latest_updates(session: FetcherSession, delay: float, limit: int):
    """Top `limit` unique series from the homepage Latest Updates island."""
    page = fetch(session, BASE + "/", delay)
    props = island_props(page.html_content, "LatestUpdates")
    if not props:
        return []
    seen = set()
    out = []
    for ch in props.get("chapters", []):
        url = ch.get("comic_public_url")
        if not url or url in seen:
            continue
        seen.add(url)
        out.append({
            "title": ch.get("comic_name"),
            "url": url,
            "cover": ch.get("comic_cover"),
            "type": ch.get("type"),
        })
        if len(out) >= limit:
            break
    return out


def popular_titles(session: FetcherSession, delay: float, limit: int):
    """Series cards from the homepage (Trending + Popular sections)."""
    page = fetch(session, BASE + "/", delay)
    seen = set()
    out = []
    for a in page.css('a[href^="/comics/"]'):
        href = a.attrib.get("href") or ""
        if "/chapter/" in href or href in seen:
            continue
        img = a.css("img::attr(src)").get()
        alt = a.css("img::attr(alt)").get() or (a.text or "").strip()
        if not img or not alt:
            continue
        seen.add(href)
        out.append({"title": alt, "url": href, "cover": img.replace("-400.webp", ".webp"), "type": None})
        if len(out) >= limit:
            break
    return out


def search_titles(session: FetcherSession, delay: float, query: str, limit: int):
    """Search via the browse page (?search=)."""
    url = BASE + "/browse?search=" + query.replace(" ", "+")
    page = fetch(session, url, delay)
    out = []
    for card in page.css("#series-grid .series-card"):
        a = card.css('a[href^="/comics/"]').first
        if not a:
            continue
        href = a.attrib.get("href") or ""
        if "/chapter/" in href:
            continue
        img = a.css("img::attr(src)").get()
        title = a.css("img::attr(alt)").get() or (a.text or "").strip()
        out.append({"title": title, "url": href, "cover": (img or "").replace("-400.webp", ".webp"), "type": None})
        if len(out) >= limit:
            break
    return out


def series_details(session: FetcherSession, ref: str, delay: float) -> dict:
    """Full metadata from the /comics/{slug} page (ComicSeries JSON-LD + DOM/state)."""
    url = BASE + ref if ref.startswith("/") else ref
    page = fetch(session, url, delay)
    html_text = page.html_content

    info: dict = {"url": url, "cover": None, "title": None, "alt_titles": [], "description": None,
                  "genres": [], "author": None, "artist": None, "rating": None, "status": None,
                  "type": None, "chapter_count": None}

    # ComicSeries JSON-LD is the most reliable source.
    for m in re.finditer(r'<script[^>]*type="application/ld\+json"[^>]*>([\s\S]*?)</script>', html_text):
        try:
            data = json.loads(html_lib.unescape(m.group(1)))
        except Exception:
            continue
        if not isinstance(data, dict) or data.get("@type") not in ("ComicSeries", "Article"):
            continue
        if data.get("numberOfEpisodes"):
            info["chapter_count"] = int(data.get("numberOfEpisodes"))
        if data.get("name") and not info["title"]:
            info["title"] = data.get("name")
        if data.get("alternativeHeadline") or data.get("alternateName"):
            raw = data.get("alternateName") or data.get("alternativeHeadline") or ""
            info["alt_titles"] = [s.strip() for s in str(raw).split("•") if s.strip()]
        if data.get("description") and not info["description"]:
            info["description"] = data.get("description")
        if data.get("image") and not info["cover"]:
            img = data.get("image")
            info["cover"] = img.get("url") if isinstance(img, dict) else str(img)
        genres = data.get("genre")
        if isinstance(genres, list):
            info["genres"] = [g for g in genres if isinstance(g, str)]
        author = data.get("author")
        if isinstance(author, dict) and author.get("name"):
            info["author"] = author.get("name")
        illustrator = data.get("illustrator")
        if isinstance(illustrator, dict) and illustrator.get("name"):
            info["artist"] = illustrator.get("name")
        rating = data.get("aggregateRating")
        if isinstance(rating, dict) and rating.get("ratingValue"):
            try:
                info["rating"] = float(rating.get("ratingValue"))
            except (TypeError, ValueError):
                pass

    # Status + type from the serialized island state (HTML-entity encoded).
    st = re.search(r'status.{0,40}?(ongoing|completed|cancelled|hiatus|dropped)', html_text, re.I)
    if st:
        info["status"] = st.group(1).lower()
    ty = re.search(r'type.{0,30}?(manga|manhwa|manhua)', html_text, re.I)
    if ty:
        info["type"] = ty.group(1).lower()

    # Genre / author / artist links as fallback (visible DOM).
    if not info["genres"]:
        info["genres"] = list(dict.fromkeys(re.findall(r'href="/browse\?genres=([a-z0-9-]+)"', html_text)))
    if not info["author"]:
        am = re.search(r'href="/browse\?author=([^"]+)"[^>]*>([^<]+)</a>', html_text)
        if am:
            info["author"] = html_lib.unescape(am.group(2)).strip()
    if not info["artist"]:
        im = re.search(r'href="/browse\?artist=([^"]+)"[^>]*>([^<]+)</a>', html_text)
        if im:
            info["artist"] = html_lib.unescape(im.group(2)).strip()
    if not info["cover"]:
        og = re.search(r'property="og:image" content="([^"]+)"', html_text, re.I)
        if og:
            info["cover"] = og.group(1)

    return info


def series_chapters(session: FetcherSession, ref: str, delay: float) -> list[dict]:
    """All chapter refs from the series page, sorted ascending by number."""
    url = BASE + ref if ref.startswith("/") else ref
    page = fetch(session, url, delay)
    nums: dict[int, str] = {}
    for m in re.finditer(r'href="(/comics/[^"]+/chapter/(\d+))"', page.html_content):
        full, num = m.group(1), int(m.group(2))
        nums[num] = BASE + full
    return [{"number": n, "url": nums[n]} for n in sorted(nums)]


def chapter_pages(session: FetcherSession, chapter_url: str, delay: float) -> list[str]:
    """Page image URLs from the chapter page."""
    page = fetch(session, chapter_url, delay)
    urls = page.css('img.w-full.block::attr(src)').getall()
    if not urls:
        urls = [u for u in page.css("img::attr(src)").getall() if "/asura-images/chapters/" in u]
    return urls


def slug_of(ref: str) -> str:
    """Clean source_id from /comics/{slug}-{hash} → {slug} (strip the site hash suffix)."""
    m = re.search(r"/comics/([^/?#]+)", ref)
    if not m:
        return ref.strip("/")
    return re.sub(r"-[0-9a-f]{7,8}$", "", m.group(1))


# ---------------------------------------------------------------------------
# Store merge + write
# ---------------------------------------------------------------------------

def load_store(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"items": [], "chapters": []}


def norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).strip()


def main() -> int:
    ap = argparse.ArgumentParser(description="AsuraScans scraper (Scrapling-based)")
    ap.add_argument("--limit", type=int, default=25, help="max NEW titles to import (default 25)")
    ap.add_argument("--chapters", default="all", help="all | latest-N | none (default all)")
    ap.add_argument("--rail", choices=["latest", "popular"], default="latest")
    ap.add_argument("--search", default=None, help="search instead of rails")
    ap.add_argument("--fresh", action="store_true", help="start from an empty store")
    ap.add_argument("--output", default=str(DEFAULT_OUTPUT), help="output scraped.json path")
    ap.add_argument("--delay", type=float, default=0.5, help="seconds between requests (default 0.5)")
    args = ap.parse_args()

    # Titles can contain characters the Windows console (cp1252) cannot encode.
    try:
        sys.stdout.reconfigure(errors="replace")
        sys.stderr.reconfigure(errors="replace")
    except Exception:
        pass

    out_path = Path(args.output)
    store = {"items": [], "chapters": []} if args.fresh else load_store(out_path)
    items = store.get("items", [])
    chapters = store.get("chapters", [])

    known_titles = set()
    known_slugs = set()
    for it in items:
        known_titles.add(norm_title(it.get("title", "")))
        known_slugs.add((it.get("source", ""), it.get("source_id", "")))
    existing_chapters = {(c.get("series_id"), c.get("number")) for c in chapters}

    added_titles = 0
    added_chapters = 0
    added_pages = 0
    skipped_titles = 0

    with FetcherSession(impersonate="chrome") as session:
        if args.search:
            print(f"\n[AsuraScans] searching '{args.search}'...")
            candidates = search_titles(session, args.delay, args.search, args.limit)
        elif args.rail == "popular":
            print("\n[AsuraScans] loading popular titles from homepage...")
            candidates = popular_titles(session, args.delay, args.limit * 3)
        else:
            print("\n[AsuraScans] loading latest updates...")
            candidates = latest_updates(session, args.delay, args.limit * 3)

        if not candidates:
            print("  [warn] no titles discovered (page structure changed? site blocked?)")
            return 1

        print(f"  {len(candidates)} candidate(s) - importing up to {args.limit} new titles")

        for cand in candidates:
            if added_titles >= args.limit:
                break
            ref = cand["url"]
            slug = slug_of(ref)
            if not slug or slug in {s for _, s in known_slugs} or norm_title(cand.get("title")) in known_titles:
                print(f"  [skip] already in library: {cand.get('title') or slug}")
                skipped_titles += 1
                continue

            try:
                info = series_details(session, ref, args.delay)
            except Exception as exc:
                print(f"  [warn] details failed for {slug}: {exc}")
                continue
            title = info.get("title") or cand.get("title") or slug

            # Re-check dedup after fetching the real title.
            if norm_title(title) in known_titles:
                print(f"  [skip] same series already in library: {title}")
                skipped_titles += 1
                continue

            try:
                chlist = series_chapters(session, ref, args.delay)
            except Exception as exc:
                print(f"  [warn] chapter list failed for {title}: {exc}")
                chlist = []

            # Decide which chapters get pages.
            if args.chapters == "none":
                targets = []
            elif args.chapters.startswith("latest-"):
                n = int(args.chapters.split("-")[1])
                targets = chlist[-n:]
            else:
                targets = chlist

            item = {
                "source": "asurascans",
                "source_id": slug,
                "title": title,
                "type": info.get("type") or cand.get("type"),
                "alt_titles": info.get("alt_titles") or [],
                "description": info.get("description"),
                "authors": [a for a in [info.get("author"), info.get("artist")] if a],
                "genres": info.get("genres") or [],
                "status": info.get("status"),
                "year": None,
                "rating": info.get("rating"),
                "rank": None,
                "cover_url": info.get("cover") or cand.get("cover"),
                "url": BASE + (ref if ref.startswith("/") else ""),
                "chapter_count": str(info.get("chapter_count") or len(chlist)),
            }
            item_chapters = []
            skipped = 0
            for ch in targets:
                key = (slug, ch["number"])
                if key in existing_chapters:
                    skipped += 1
                    continue
                try:
                    pages = chapter_pages(session, ch["url"], args.delay)
                except Exception as exc:
                    print(f"    [warn] chapter {ch['number']} pages failed: {exc}")
                    pages = []
                if not pages:
                    print(f"    [skip] chapter {ch['number']} has no pages (premium/locked?)")
                    continue
                item_chapters.append({
                    "source": "asurascans",
                    "series_id": slug,
                    "chapter_id": f"{slug}-{ch['number']}",
                    "number": ch["number"],
                    "title": f"Chapter {ch['number']}",
                    "url": ch["url"],
                    "pages": pages,
                })
                added_pages += len(pages)
                existing_chapters.add(key)

            items.append(item)
            chapters.extend(item_chapters)
            known_titles.add(norm_title(title))
            known_slugs.add(("asurascans", slug))
            added_titles += 1
            added_chapters += len(item_chapters)
            if skipped:
                print(f"  [skip] {skipped} chapter(s) of '{title}' already in library")
            print(f"  [+] {title}  ->  {len(item_chapters)} chapters | {sum(len(c['pages']) for c in item_chapters)} pages"
                  f"  (total {len(chlist)})")
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(json.dumps({
                "items": items,
                "chapters": chapters,
                "total_chapters": len(chapters),
                "total_pages": sum(len(c.get("pages", [])) for c in chapters),
            }, ensure_ascii=False), encoding="utf-8")

    print(f"\n[AsuraScans] done -> {out_path}")
    print(f"  added {added_titles} title(s), {added_chapters} chapter(s), {added_pages} page(s)"
          f" | skipped {skipped_titles} duplicate title(s)")
    print(f"  library now: {len(items)} titles - {len(chapters)} chapters")
    return 0


if __name__ == "__main__":
    sys.exit(main())
