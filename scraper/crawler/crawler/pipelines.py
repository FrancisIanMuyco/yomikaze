from crawler.middlewares import BlockDetectorMiddleware

DOWNLOADER_MIDDLEWARES = {
    "crawler.middlewares.BlockDetectorMiddleware": 560,
}

ITEM_PIPELINES = {
    "crawler.pipelines.ChapterFilesPipeline": 300,
}
