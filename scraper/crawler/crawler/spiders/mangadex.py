import scrapy
from urllib.parse import quote

from ..items import SeriesItem

BASE = "https://api.mangadex.org"


class MangaDexSpider(scrapy.Spider):
    name = "mangadex"
    allowed_domains = ["api.mangadex.org", "mangadex.org"]

    custom_settings = {
        "ROBOTSTXT_OBEY": True,
        "DOWNLOAD_DELAY": 1.0,
        "AUTOTHROTTLE_ENABLED": True,
        "AUTOTHROTTLE_START_DELAY": 1.0,
        "AUTOTHROTTLE_MAX_DELAY": 10.0,
        "AUTOTHROTTLE_TARGET_CONCURRENCY": 2.0,
    }

    def __init__(self, query=None, title_id=None, limit="20", *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.query = query
        self.title_id = title_id
        self.limit = int(limit or 20)

    async def start(self):
        for request in self.start_requests():
            yield request

    def start_requests(self):
        if self.title_id:
            yield scrapy.Request(
                f"{BASE}/manga/{self.title_id}?includes[]=cover_art&includes[]=author",
                callback=self.parse_manga,
            )
        elif self.query:
            yield scrapy.Request(
                f"{BASE}/manga?title={quote(self.query)}&limit={self.limit}&includes[]=cover_art&includes[]=author&order[followedCount]=desc",
                callback=self.parse_search,
            )
        else:
            self.logger.error('Provide -a title_id=<id> or -a query="<title>"')

    def parse_search(self, response):
        data = response.json().get("data", [])
        for manga in data:
            yield scrapy.Request(
                f"{BASE}/manga/{manga['id']}?includes[]=cover_art&includes[]=author",
                callback=self.parse_manga,
            )

    def parse_manga(self, response):
        manga = response.json().get("data")
        if not manga:
            self.logger.error("Manga not found: %s", response.url)
            return

        attrs = manga.get("attributes", {})
        rels = manga.get("relationships", [])

        cover = next((r for r in rels if r["type"] == "cover_art"), None)
        authors = [r["attributes"]["name"] for r in rels if r["type"] == "author" and r.get("attributes", {}).get("name")]
        artists = [r["attributes"]["name"] for r in rels if r["type"] == "artist" and r.get("attributes", {}).get("name")]

        tags = attrs.get("tags", [])
        genres = [t["attributes"]["name"].get("en", "") for t in tags if t["attributes"]["group"] == "genre"]
        themes = [t["attributes"]["name"].get("en", "") for t in tags if t["attributes"]["group"] == "theme"]

        status_map = {
            "ongoing": "RELEASING",
            "completed": "FINISHED",
            "hiatus": "HIATUS",
            "cancelled": "CANCELLED",
        }

        cover_url = None
        if cover and cover.get("attributes", {}).get("fileName"):
            cover_url = f"https://uploads.mangadex.org/covers/{manga['id']}/{cover['attributes']['fileName']}.512.jpg"

        yield SeriesItem(
            source="mangadex",
            source_id=manga["id"],
            title=attrs.get("title", {}).get("en", attrs.get("title", {}).get("ja-ro", "")),
            alt_titles=[v for v in attrs.get("altTitles", [{}])[-1].values() if v],
            description=attrs.get("description", {}).get("en", attrs.get("description", {}).get("ja-ro", "")),
            authors=authors,
            genres=genres + themes,
            status=status_map.get(attrs.get("status"), "UNKNOWN"),
            cover_url=cover_url,
            url=f"https://mangadex.org/title/{manga['id']}",
            chapter_count=attrs.get("lastChapter"),
        )
