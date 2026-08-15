import scrapy


class SeriesItem(scrapy.Item):
    source = scrapy.Field()
    source_id = scrapy.Field()
    title = scrapy.Field()
    alt_titles = scrapy.Field()
    description = scrapy.Field()
    authors = scrapy.Field()
    genres = scrapy.Field()
    status = scrapy.Field()
    cover_url = scrapy.Field()
    url = scrapy.Field()
    chapter_count = scrapy.Field()


class ChapterItem(scrapy.Item):
    source = scrapy.Field()
    series_id = scrapy.Field()
    chapter_id = scrapy.Field()
    number = scrapy.Field()
    title = scrapy.Field()
    url = scrapy.Field()
    pages = scrapy.Field()
