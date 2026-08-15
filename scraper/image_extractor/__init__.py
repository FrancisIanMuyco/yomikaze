"""image_extractor — async Playwright image URL extractor for manhua chapters."""

from __future__ import annotations

from .extractor import (
    ChapterInfo,
    GenericAdapter,
    ImageExtractor,
    MangaInfo,
    SiteAdapter,
    run_scraper,
    slugify,
)
from .sites import ADAPTERS, get_adapter

__all__ = [
    "ChapterInfo",
    "GenericAdapter",
    "ImageExtractor",
    "MangaInfo",
    "SiteAdapter",
    "run_scraper",
    "slugify",
    "ADAPTERS",
    "get_adapter",
]
