from __future__ import annotations

import logging
from typing import Any

from scrapy import Request, Spider
from scrapy.http import Response

logger = logging.getLogger(__name__)


class BlockDetectorMiddleware:
    """Honest anti-bot reporter: logs 403/429/503 and optional Cloudflare hints."""

    BLOCK_STATUSES = {403, 429, 503}

    def process_response(self, request: Request, response: Response, spider: Spider) -> Any:
        if response.status in self.BLOCK_STATUSES:
            logger.warning(
                "BlockDetector: %s on %s (spider=%s)",
                response.status,
                response.url,
                spider.name,
            )
            body = response.text or ""
            if "cloudflare" in body.lower() or "challenge-platform" in body.lower():
                logger.warning("BlockDetector: Cloudflare challenge detected on %s", response.url)
            elif "captcha" in body.lower():
                logger.warning("BlockDetector: CAPTCHA detected on %s", response.url)
        return response

    def process_exception(self, request: Request, exception: Exception, spider: Spider) -> Any:
        if "403" in str(exception) or "429" in str(exception):
            logger.warning("BlockDetector exception on %s: %s", request.url, exception)
        return None
