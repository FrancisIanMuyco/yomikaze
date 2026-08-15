#!/usr/bin/env python3
"""Scrape a chapter URL and output YOMIKAZE-compatible JSON."""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path
from urllib.parse import urljoin, urlparse

# Add scraper folder to path so we can import image_extractor
sys.path.insert(0, str(Path(__file__).parent))

from image_extractor.extractor import (
    GenericAdapter,
    ImageExtractor,
    MangaInfo,
    ChapterInfo,
    slugify,
)

YOMIKAZE_PUBLIC = Path(__file__).parent.parent / "YOMIKAZE" / "public"
SCRAPED_JSON = YOMIKAZE_PUBLIC / "scraped.json"


def extract_chapter_info_from_url(url: str) -> dict:
    """Extract basic metadata from URL."""
    parsed = urlparse(url)
    path_parts = [p for p in parsed.path.split("/") if p]

    chapter_title = "Chapter 1"
    chapter_number = 1

    for part in reversed(path_parts):
        m = re.search(r"(\d+(?:\.\d+)?)", part)
        if m:
            chapter_number = float(m.group(1))
            chapter_title = f"Chapter {m.group(1)}"
            break

    domain = parsed.netloc.replace("www.", "").replace(".", " ").title()
    manga_title = domain

    return {
        "manga_title": manga_title,
        "chapter_title": chapter_title,
        "chapter_number": chapter_number,
        "source_url": url,
    }


async def scrape_url(url: str, output_dir: str = "manga_data") -> dict:
    """Scrape a single chapter URL and return YOMIKAZE-compatible data."""
    info = extract_chapter_info_from_url(url)

    adapter = GenericAdapter(delay=1.0, retries=3, timeout=30)
    extractor = ImageExtractor(
        adapter=adapter,
        headless=True,
        output_dir=output_dir,
    )

    chapters = [{"url": url, "title": info["chapter_title"]}]
    manga = await extractor.run(chapters, info["manga_title"], download_images=False)

    if not manga.chapters:
        raise RuntimeError(f"No images found at {url}")

    chapter = manga.chapters[0]

    return {
        "source": "scraped",
        "source_id": f"scraped-{slugify(info['manga_title'])}",
        "series_id": f"scraped-{slugify(info['manga_title'])}",
        "chapter_id": f"scraped-{slugify(info['manga_title'])}-{info['chapter_number']}",
        "title": info["manga_title"],
        "alt_titles": [],
        "description": f"Scraped from {url}",
        "authors": [],
        "genres": [],
        "status": "UNKNOWN",
        "cover_url": "",
        "url": url,
        "chapter_count": "1",
        "chapters": [
            {
                "source": "scraped",
                "series_id": f"scraped-{slugify(info['manga_title'])}",
                "chapter_id": f"scraped-{slugify(info['manga_title'])}-{info['chapter_number']}",
                "number": info["chapter_number"],
                "title": info["chapter_title"],
                "url": url,
                "pages": chapter.image_urls,
            }
        ],
    }


def save_yomikaze_json(data: dict, output_path: Path = SCRAPED_JSON) -> Path:
    """Save scraped data to YOMIKAZE public folder."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"[*] Scraped data saved to {output_path}")
    return output_path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Scrape a chapter URL and generate YOMIKAZE-compatible JSON."
    )
    parser.add_argument("url", help="Chapter URL to scrape")
    parser.add_argument(
        "--output",
        default=str(SCRAPED_JSON),
        help="Output JSON path (default: YOMIKAZE/public/scraped.json)",
    )
    parser.add_argument(
        "--download",
        action="store_true",
        help="Also download images to output_dir",
    )
    args = parser.parse_args()

    try:
        data = asyncio.run(scrape_url(args.url))
        save_yomikaze_json(data, Path(args.output))

        chapter = data["chapters"][0]
        print(f"[*] Title:   {data['title']}")
        print(f"[*] Chapter: {chapter['title']}")
        print(f"[*] Pages:   {len(chapter['pages'])}")
        print(f"\n[*] To view in YOMIKAZE:")
        print(f"    1. Set VITE_CONTENT_PROVIDER=scraped")
        print(f"    2. Run: npm run dev")
        print(f"    3. Open: http://localhost:5173/reader/{data['series_id']}/{chapter['chapter_id']}")

        return 0
    except Exception as exc:
        print(f"[!] Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
