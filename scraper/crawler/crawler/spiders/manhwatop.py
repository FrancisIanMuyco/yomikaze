import re
from urllib.parse import urljoin, urlparse

import scrapy

from ..items import ChapterItem, SeriesItem

IMAGE_EXT = re.compile(r"\.(jpe?g|png|webp|gif|avif|bmp)(\?|$)", re.I)
CHAPTER_LINK_SELECTOR = (
    "a.chapter-link, a.chapter-name, a.chapter, li.wp-manga-chapter a, "
    "li.chapter a, a[href*='/chapter-'], a[href*='/read/'], a[href*='-chapter-']"
)
PAGE_LINK_SELECTOR = "a.chapter-page-link::attr(href), a[data-page]::attr(href)"
READER_IMG_SELECTOR = (
    ".reading-content img::attr(src), .container-chapter-reader img::attr(src), "
    "#readerarea img::attr(src), .chapter-content img::attr(src), "
    "img.wp-manga-chapter-img::attr(src)"
)
CHROME_HINTS = ("logo", "icon", "banner", "avatar", "sprite", "emoji")


class ManhwaTopSpider(scrapy.Spider):
    name = "manhwatop"
    allowed_domains = ["manhwatop.com"]

    def __init__(self, url=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.start_urls = [url] if url else []
        self.series_id = "unknown"
        self.seen_urls: set[str] = set()
        if url and ("127.0.0.1" in url or "localhost" in url):
            self.allowed_domains = []

    def parse(self, response):
        self.series_id = urlparse(response.url).path.strip("/").split("/")[-1] or "unknown"

        chapters = response.css(CHAPTER_LINK_SELECTOR)
        if not chapters:
            chapters = response.css('a[href*="chapter"], a[href*="episode"]')
        if not chapters:
            self.logger.warning("No chapter links found on %s", response.url)
            return

        yield SeriesItem(
            source="manhwatop",
            source_id=self.series_id,
            title=" ".join(
                response.css("h1::text, .post-title h1::text, .entry-title::text").getall()
            ).strip()
            or self.series_id,
            alt_titles=[],
            description=" ".join(
                response.css(".summary__content::text, .entry-content p::text").getall()
            ).strip()
            or None,
            authors=[],
            genres=[],
            status=None,
            cover_url=response.css(
                ".summary_image img::attr(src), .post-content img::attr(src)"
            ).get(),
            url=response.url,
            chapter_count=len(chapters),
        )

        for a in chapters:
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
        number = response.meta["number"]
        title = response.meta["title"]
        base = dict(
            source="manhwatop",
            series_id=self.series_id,
            chapter_id=urlparse(response.url).path.strip("/").split("/")[-1] or response.url,
            number=number,
            title=title,
            url=response.url,
        )

        hrefs = response.css(PAGE_LINK_SELECTOR).getall()
        direct = [urljoin(response.url, h) for h in hrefs if IMAGE_EXT.search(h)]
        if direct:
            yield ChapterItem(**base, pages=direct)
            return

        imgs = [
            urljoin(response.url, u)
            for u in response.css(READER_IMG_SELECTOR).getall()
            if not any(h in u.lower() for h in CHROME_HINTS)
        ]
        if imgs:
            yield ChapterItem(**base, pages=imgs)
            return

        html_links = [urljoin(response.url, h) for h in hrefs]
        if html_links:
            item = ChapterItem(**base, pages=[])
            shared = {"item": item, "pages": [], "done": [], "pending": len(html_links)}
            for u in html_links:
                yield scrapy.Request(u, callback=self.parse_page_link, meta=shared)
        else:
            yield ChapterItem(**base, pages=[])

    def parse_page_link(self, response):
        meta = response.meta
        img = response.css(".page img::attr(src), img::attr(src)").get()
        if img and not any(h in img.lower() for h in CHROME_HINTS):
            url = urljoin(response.url, img)
            if url not in meta["pages"]:
                meta["pages"].append(url)
        meta["done"].append(response.url)
        if len(meta["done"]) >= meta["pending"]:
            meta["item"]["pages"] = meta["pages"]
            yield meta["item"]

    @staticmethod
    def _chapter_number(text):
        m = re.search(r"(?:chapter|episode)\s*(\d+(?:\.\d+)?)", text, re.I)
        if m:
            try:
                return float(m.group(1))
            except ValueError:
                pass
        return None
