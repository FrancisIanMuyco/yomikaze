"""response_scraper — network-response based image capture for MangaFire chapters."""

from .response_scraper import capture_images, capture_images_in_context
from .mangafire_scraper import MangaFireScraper

__all__ = ["capture_images", "capture_images_in_context", "MangaFireScraper"]
