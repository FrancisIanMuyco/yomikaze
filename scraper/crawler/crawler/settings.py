BOT_NAME = "crawler"
SPIDER_MODULES = ["crawler.spiders"]
NEWSPIDER_MODULE = "crawler.spiders"

ROBOTSTXT_OBEY = True
DOWNLOAD_DELAY = 1.0
AUTOTHROTTLE_ENABLED = True
AUTOTHROTTLE_START_DELAY = 1.0
AUTOTHROTTLE_MAX_DELAY = 10.0
AUTOTHROTTLE_TARGET_CONCURRENCY = 2.0
RETRY_TIMES = 2
RETRY_HTTP_CODES = [429, 500, 502, 503, 504]

FEEDS = {
    "output/scraped.json": {"format": "json", "encoding": "utf8", "overwrite": True},
}

# Redis distribution (optional — install scrapy-redis to enable)
# SCHEDULER = "scrapy_redis.scheduler.Scheduler"
# DUPEFILTER_CLASS = "scrapy_redis.dupefilter.RFPDupeFilter"
# REDIS_URL = "redis://localhost:6379"
