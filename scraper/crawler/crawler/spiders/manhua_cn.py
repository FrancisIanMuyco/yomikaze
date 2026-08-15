import re
from urllib.parse import urljoin, urlparse

import scrapy

from ..items import ChapterItem, SeriesItem

CHAPTER_SELECTOR = ".chapter-list a, .chapter li a, a[href*='chapter'], a[href*='comic']"
IMG_SELECTOR = (
    ".reader img::attr(data-original), #mangaFile img::attr(data-src), "
    "img::attr(data-original), img::attr(data-src), img::attr(src)"
)
CHROME_HINTS = ("logo", "icon", "banner", "avatar", "sprite", "ad")


class ChineseManhuaSpider(scrapy.Spider):
    name = "manhua_cn"
    allowed_domains = ["manhuagui.com", "manhuatai.com", "manhuaren.com"]

    custom_settings = {
        "DEFAULT_REQUEST_HEADERS": {
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Referer": "https://www.manhuagui.com/",
        },
        "RETRY_TIMES": 1,
    }

    def __init__(self, url=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.start_urls = [url] if url else []
        self.series_id = "unknown"
        self.seen_urls: set[str] = set()
        if url and ("127.0.0.1" in url or "localhost" in url):
            self.allowed_domains = []

    def parse(self, response):
        self.series_id = urlparse(response.url).path.strip("/").split("/")[-1] or "unknown"
        links = response.css(CHAPTER_SELECTOR)
        if not links:
            self.logger.warning(
                "No chapter links on %s — likely a JS anti-bot block.",
                response.url,
            )
            return

        yield SeriesItem(
            source=self._host(response.url),
            source_id=self.series_id,
            title=" ".join(response.css("h1::text").getall()).strip() or self.series_id,
            alt_titles=[],
            description=" ".join(
                response.css(".intro p::text, .detail p::text").getall()
            ).strip()
            or None,
            authors=[
                a.strip()
                for a in response.css(".detail li::text, .info li::text").getall()
                if a.strip()
            ][:3],
            genres=[],
            status=None,
            cover_url=response.css(".book img::attr(src), .cover img::attr(src)").get(),
            url=response.url,
            chapter_count=len(links),
        )

        for a in links:
            href = a.css("::attr(href)").get()
            if not href:
                continue
            url = urljoin(response.url, href)
            if url in self.seen_urls:
                continue
            self.seen_urls.add(url)
            text = " ".join(a.css("::text").getall()).strip()
            yield scrapy.Request(
                url,
                callback=self.parse_chapter,
                meta={"number": self._chapter_number(text), "title": text},
            )

    def parse_chapter(self, response):
        imgs = [
            urljoin(response.url, u)
            for u in response.css(IMG_SELECTOR).getall()
            if u
            and not u.startswith("data:")
            and not any(h in u.lower() for h in CHROME_HINTS)
        ]
        yield ChapterItem(
            source=self._host(response.url),
            series_id=self.series_id,
            chapter_id=urlparse(response.url).path.strip("/").split("/")[-1] or response.url,
            number=response.meta["number"],
            title=response.meta["title"],
            url=response.url,
            pages=imgs,
        )

    @staticmethod
    def _host(url):
        host = urlparse(url).netloc
        return host.replace("www.", "").split(".")[0] or "manhua_cn"

    @staticmethod
    def _chapter_number(text):
        m = re.search(r"(?:第\s*)?(\d+(?:\.\d+)?)\s*话", text)
        if not m:
            m = re.search(r"(?:chapter|episode)\s*(\d+(?:\.\d+)?)", text, re.I)
        if m:
            try:
                return float(m.group(1))
            except ValueError:
                pass
        return None
