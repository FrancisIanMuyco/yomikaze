import scrapy
from urllib.parse import quote

from ..items import SeriesItem

JIKAN = "https://api.jikan.moe/v4"

STATUS_MAP = {
    "Finished": "completed",
    "Currently Publishing": "ongoing",
    "On Hiatus": "hiatus",
    "Discontinued": "hiatus",
    "Not yet published": "hiatus",
}


class MyAnimeListSpider(scrapy.Spider):
    name = "myanimelist"
    allowed_domains = ["api.jikan.moe"]

    custom_settings = {
        "ROBOTSTXT_OBEY": False,
        "DOWNLOAD_DELAY": 1.0,
        "AUTOTHROTTLE_TARGET_CONCURRENCY": 1.0,
    }

    def __init__(self, query=None, mal_id=None, search_limit="5", *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.query = query
        self.mal_id = mal_id
        self.search_limit = int(search_limit or 5)

    async def start(self):
        for request in self.start_requests():
            yield request

    def start_requests(self):
        if self.mal_id:
            yield scrapy.Request(
                f"{JIKAN}/manga/{self.mal_id}/full", callback=self.parse_manga
            )
        elif self.query:
            yield scrapy.Request(
                f"{JIKAN}/manga?q={quote(self.query)}&limit={self.search_limit}"
                "&order_by=members&sort=desc",
                callback=self.parse_search,
            )
        else:
            self.logger.error('Provide -a mal_id=<id> or -a query="<title>"')

    def parse_search(self, response):
        data = (response.json() or {}).get("data") or []
        for m in data:
            yield scrapy.Request(
                f"{JIKAN}/manga/{m['mal_id']}/full", callback=self.parse_manga
            )

    def parse_manga(self, response):
        m = (response.json() or {}).get("data")
        if not m:
            self.logger.error("Manga not found: %s", response.url)
            return

        yield SeriesItem(
            source="myanimelist",
            source_id=m.get("mal_id"),
            title=m.get("title"),
            alt_titles=[t for t in (m.get("title_english"), m.get("title_japanese")) if t],
            description=m.get("synopsis"),
            authors=[a["name"] for a in m.get("authors", [])],
            genres=[g["name"] for g in m.get("genres", [])],
            status=STATUS_MAP.get(m.get("status"), m.get("status")),
            cover_url=(m.get("images", {}).get("jpg", {}) or {}).get("large_image_url"),
            url=m.get("url"),
            chapter_count=m.get("chapters"),
        )
