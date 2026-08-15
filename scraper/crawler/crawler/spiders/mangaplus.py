import scrapy

from ..items import SeriesItem

API = "https://jumpg-webapi.tokyo-cdn.com/api"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Referer": "https://mangaplus.shueisha.co.jp/",
    "Origin": "https://mangaplus.shueisha.co.jp",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}


class MangaPlusSpider(scrapy.Spider):
    name = "mangaplus"
    allowed_domains = ["jumpg-webapi.tokyo-cdn.com"]

    custom_settings = {
        "ROBOTSTXT_OBEY": False,
        "DOWNLOAD_DELAY": 1.0,
        "RETRY_TIMES": 1,
    }

    def __init__(self, title_id=None, search_limit="10", *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.title_id = title_id
        self.search_limit = int(search_limit or 10)

    async def start(self):
        for request in self.start_requests():
            yield request

    def start_requests(self):
        if self.title_id:
            yield scrapy.Request(
                f"{API}/title_detail?title_id={self.title_id}",
                headers=HEADERS,
                callback=self.parse_title,
            )
        else:
            yield scrapy.Request(
                f"{API}/title_list/all?lang=eng",
                headers=HEADERS,
                callback=self.parse_titles,
            )

    def _json(self, response):
        try:
            return response.json()
        except ValueError:
            self.logger.error(
                "Unparseable payload from %s (HTTP %s).",
                response.url,
                response.status,
            )
            return None

    def parse_titles(self, response):
        body = self._json(response)
        if not body:
            return
        titles = body.get("titles") or body.get("allTitles") or []
        self.logger.info("MangaPlus title list has %d titles", len(titles))
        for t in titles[: self.search_limit]:
            tid = t.get("titleId")
            yield SeriesItem(
                source="mangaplus",
                source_id=tid,
                title=t.get("name"),
                alt_titles=[t.get("englishName")] if t.get("englishName") else [],
                description=None,
                authors=[t["author"]] if t.get("author") else [],
                genres=[],
                status=None,
                cover_url=t.get("portraitImageUrl"),
                url=f"https://mangaplus.shueisha.co.jp/titles/{tid}" if tid else None,
                chapter_count=None,
            )
            if tid:
                yield scrapy.Request(
                    f"{API}/title_detail?title_id={tid}",
                    headers=HEADERS,
                    callback=self.parse_title,
                )

    def parse_title(self, response):
        body = self._json(response)
        if not body:
            return
        title = body.get("title") or {}
        tid = title.get("titleId")
        if not tid:
            self.logger.error("title_detail returned no title for %s", response.url)
            return
        yield SeriesItem(
            source="mangaplus",
            source_id=tid,
            title=title.get("name"),
            alt_titles=[title.get("englishName")] if title.get("englishName") else [],
            description=title.get("description"),
            authors=[title["author"]] if title.get("author") else [],
            genres=[],
            status=None,
            cover_url=title.get("portraitImageUrl"),
            url=f"https://mangaplus.shueisha.co.jp/titles/{tid}",
            chapter_count=len(title.get("lastChapterList") or []),
        )
