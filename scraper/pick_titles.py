#!/usr/bin/env python3
"""pick_titles.py — interactive title picker for YOMIKAZE.

Instead of auto-scraping N random titles, this tool:
  1. discovers a batch of titles from mangafire.to (random mix of new + old)
  2. prints them as a numbered list
  3. lets YOU type which ones to download (e.g. "2 5 9" or "1-4, 7")
  4. scrapes exactly those titles (proxy rotation + mangakakalot fallback
     included) and merges them into YOMIKAZE's public/scraped.json

Usage:
  python pick_titles.py                         # 40 titles to choose from
  python pick_titles.py --show 60               # show more candidates
  python pick_titles.py --pages-deep 4          # crawl more listing pages (slower, more variety)
  python pick_titles.py --chapters latest-20    # only fetch newest 20 chapters
  python pick_titles.py --headful               # visible browser (solve captcha by hand)
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from playwright.sync_api import sync_playwright  # noqa: E402

import mangafire_catalog  # noqa: E402
from mangafire_catalog import (  # noqa: E402
    DISCOVERY_RETRIES,
    DEFAULT_OUTPUT,
    DEFAULT_PROXY_FILE,
    discover_candidates,
    hid_from_url,
    load_existing,
    load_proxies,
    merge_and_write,
    new_context,
    normalize_title,
    open_working_context,
    scrape_one_title,
    search_candidates,
)


def parse_choice(text: str, max_index: int) -> list[int]:
    """Parse '1 3 5-7,10' into a list of 1-based indexes within range."""
    selected: set[int] = set()
    for part in re.split(r"[,\s]+", text.strip()):
        if not part:
            continue
        if "-" in part:
            a, _, b = part.partition("-")
            if a.isdigit() and b.isdigit():
                for n in range(int(a), int(b) + 1):
                    if 1 <= n <= max_index:
                        selected.add(n)
        elif part.isdigit():
            n = int(part)
            if 1 <= n <= max_index:
                selected.add(n)
    return sorted(selected)


def main() -> int:
    parser = argparse.ArgumentParser(description="Pick which titles to download into YOMIKAZE")
    parser.add_argument("--show", type=int, default=40, help="How many candidates to list (default 40)")
    parser.add_argument("--pages-deep", type=int, default=2, help="Listing pages to crawl during discovery (default 2; higher = slower but more old/rare titles)")
    parser.add_argument("--chapters", default="all", help="all | none | latest-N (which chapters get images)")
    parser.add_argument("--delay", type=float, default=0.5, help="Seconds between chapter API calls")
    parser.add_argument("--headful", action="store_true", help="Show the browser so you can solve captchas by hand")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output JSON path")
    parser.add_argument("--proxy-file", default=str(DEFAULT_PROXY_FILE), help="Path to proxy list file")
    parser.add_argument("--max-proxies", type=int, default=60, help="Max proxies to try before giving up")
    parser.add_argument("--search", default="", help="Search mangafire for this keyword and list ONLY those matches")
    args = parser.parse_args()

    # --headful must reach mangafire_catalog's own module flag (it controls
    # wait_out_challenge / new_context behaviour there).
    mangafire_catalog.HEADFUL = args.headful
    # Option 1 only needs a handful of candidates to pick from, so crawl fewer
    # listing pages (2 instead of 6) — list appears in ~1-2 min instead of ~5-7.
    mangafire_catalog.LISTING_PAGES_DEEP = max(1, args.pages_deep)

    proxies = load_proxies(args.proxy_file)
    if not proxies:
        print("[!] No proxies loaded. Run proxy_checker.py first or provide --proxy-file")
        return 1

    out_path = Path(args.output)
    existing = load_existing(out_path)
    existing_hids = set()
    for it in existing.get("items", []):
        h = hid_from_url(it.get("url", ""))
        if h:
            existing_hids.add(h)
    existing_titles = {
        t for it in existing.get("items", [])
        for t in [normalize_title(it.get("title", ""))] + [normalize_title(a) for a in it.get("alt_titles", [])]
        if t
    }
    existing_chapter_ids = set(c["chapter_id"] for c in existing.get("chapters", []) if c.get("chapter_id"))
    if existing_titles or existing_hids:
        print(f"[*] Library already has {len(existing_titles)} titles - those won't be listed.")

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=not mangafire_catalog.HEADFUL)
        ctx, page, current_proxy = open_working_context(browser, proxies, args.max_proxies)
        if page is None:
            print("[!] All proxies failed, trying without proxy...")
            ctx, page = new_context(browser, None)
        try:
            # Discover candidates: either search for a specific keyword or the
            # usual random batch. Then filter out titles already in the library.
            candidates = []
            if args.search:
                print(f"[*] Searching mangafire for '{args.search}'...")
                for d_attempt in range(1, DISCOVERY_RETRIES + 1):
                    candidates = search_candidates(page, args.search, limit=args.show)
                    if candidates:
                        break
                    if d_attempt < DISCOVERY_RETRIES:
                        ctx, page, current_proxy = open_working_context(browser, proxies, args.max_proxies, avoid=current_proxy, old_ctx=ctx)
                        if page is None:
                            break
            else:
                for d_attempt in range(1, DISCOVERY_RETRIES + 1):
                    print(f"[*] Discovering candidates (attempt {d_attempt}/{DISCOVERY_RETRIES})...")
                    candidates = discover_candidates(page, args.show)
                    if candidates:
                        break
                    if d_attempt < DISCOVERY_RETRIES:
                        ctx, page, current_proxy = open_working_context(browser, proxies, args.max_proxies, avoid=current_proxy, old_ctx=ctx)
                        if page is None:
                            break
            if not candidates:
                print("[!] No candidates discovered.", file=sys.stderr)
                return 1

            fresh = [
                c for c in candidates
                if c["hid"] not in existing_hids
                and normalize_title(c.get("title") or c["hid"]) not in existing_titles
            ]
            shown = fresh[: args.show]
            if not shown:
                print("[!] Everything discovered is already in the library - nothing to pick.", file=sys.stderr)
                return 0

            # Show the numbered list.
            print("\n" + "=" * 70)
            print("  PICK TITLES TO DOWNLOAD")
            print("=" * 70)
            for idx, c in enumerate(shown, 1):
                t = c.get("title") or c["hid"]
                kind = c.get("type") or ""
                print(f"  {idx:>3}. {t}" + (f"  [{kind}]" if kind else ""))
            print("=" * 70)
            print(f"  {len(shown)} titles available.")
            print("  Type HOW MANY titles to download (e.g. 2 = grab 2 titles), or pick specific ones:")
            print('  Examples:  3   or   1 3 5   or   2-6   or   1,4,9   (a = ALL, q = quit)')
            print("=" * 70)

            raw = input("  > ").strip().lower()
            if raw in ("q", "quit", "exit", ""):
                print("  Nothing selected. Bye!")
                return 0
            if raw == "a":
                selected_idx = list(range(1, len(shown) + 1))
            elif raw.isdigit():
                # A single plain number = CUSTOM COUNT: grab that many titles
                # from the list (the list is already shuffled, so this is a
                # random-ish pick of N titles).
                n = min(int(raw), len(shown))
                if n < 1:
                    print("  Nothing selected. Bye!")
                    return 0
                selected_idx = list(range(1, n + 1))
                print(f"  [*] Grabbing {n} title(s).")
            else:
                selected_idx = parse_choice(raw, len(shown))
            if not selected_idx:
                print("  No valid numbers - nothing to download.")
                return 0

            print(f"\n[*] Downloading {len(selected_idx)} title(s)...")
            added = 0
            total_pages = 0
            for pos, idx in enumerate(selected_idx, 1):
                cand = shown[idx - 1]
                title_label = cand.get("title") or cand["hid"]
                print(f"\n--- [{pos}/{len(selected_idx)}] {title_label}")
                item, chapters, ctx, page, current_proxy = scrape_one_title(
                    page, ctx, current_proxy, cand,
                    args.chapters, args.delay,
                    existing_chapter_ids, existing_titles, browser, proxies, args.max_proxies,
                )
                if item and chapters:
                    merge_and_write({"items": [item], "chapters": chapters}, out_path, False)
                    added += 1
                    total_pages += sum(len(c["pages"]) for c in chapters)
                else:
                    print(f"    [!] '{title_label}' could not be scraped from any source - skipping", file=sys.stderr)

            print(f"\n[*] Done: added {added} title(s), {total_pages} pages.")
            if added == 0:
                print("[!] Nothing was added.", file=sys.stderr)
                return 1
            return 0
        finally:
            try:
                ctx.close()
            except Exception:
                pass
            browser.close()


if __name__ == "__main__":
    sys.exit(main())
