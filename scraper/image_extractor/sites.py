"""Site-specific adapters for image_extractor."""

from __future__ import annotations

from typing import ClassVar

from .extractor import SiteAdapter


class MangadexAdapter(SiteAdapter):
    """Adapter for MangaDex (uses API)."""

    name = "mangadex"

    async def discover_chapters(self, page, series_url: str) -> list[dict]:
        # MangaDex has an API; real implementation would call it directly.
        # For now fall back to generic page scraping.
        return await super().discover_chapters(page, series_url)


class MangafireAdapter(SiteAdapter):
    """Adapter for mangafire.to (uses search + prev-button navigation)."""

    name = "mangafire"
    requires_js_navigation: bool = True

    async def discover_chapters(self, page, series_url: str) -> list[dict]:
        # Placeholder: mangafire needs search-box interaction.
        # Real implementation: click search, type chapter number, navigate prev.
        return await super().discover_chapters(page, series_url)


class GenericReaderAdapter(SiteAdapter):
    """Adapter for generic WordPress-based manga readers."""

    name = "generic-reader"

    CHAPTER_FALLBACKS = [
        "li.wp-manga-chapter a",
        "a.chapter-link",
        'a[href*="/chapter-"]',
        'a[href*="/chapter/"]',
    ]

    PAGE_FALLBACKS = [
        ".reading-content img",
        ".container-chapter-reader img",
        "#readerarea img",
        ".chapter-content img",
        "img.wp-manga-chapter-img",
    ]

    async def discover_chapters(self, page, series_url: str) -> list[dict]:
        return await super().discover_chapters(page, series_url)


ADAPTERS: ClassVar[dict[str, type[SiteAdapter]]] = {
    "mangadex": MangadexAdapter,
    "mangafire": MangafireAdapter,
    "generic": GenericReaderAdapter,
}


def get_adapter(name: str) -> SiteAdapter:
    return ADAPTERS.get(name, GenericReaderAdapter)()
