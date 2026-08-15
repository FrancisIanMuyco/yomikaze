#!/usr/bin/env python3
"""run_spiders — run one or more Scrapy spiders in sequence or parallel."""

from __future__ import annotations

import argparse
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed


SPIDERS = {
    "mangadex": "crawler.spiders.mangadex.MangaDexSpider",
    "myanimelist": "crawler.spiders.myanimelist.MyAnimeListSpider",
    "mangaplus": "crawler.spiders.mangaplus.MangaPlusSpider",
    "manhwatop": "crawler.spiders.manhwatop.ManhwaTopSpider",
    "manhua_cn": "crawler.spiders.manhua_cn.ChineseManhuaSpider",
}


def run_spider(name: str, args: list[str]) -> int:
    cmd = [
        sys.executable,
        "-m",
        "scrapy",
        "crawl",
        name,
        "-s",
        "LOG_LEVEL=INFO",
    ] + args
    print(f"[runner] Starting spider: {name}")
    result = subprocess.run(cmd, cwd="crawler")
    return result.returncode


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Run crawler spiders.")
    p.add_argument("spiders", nargs="+", choices=list(SPIDERS.keys()), help="Spider names to run")
    p.add_argument("--parallel", action="store_true", help="Run spiders in parallel")
    p.add_argument("--args", nargs=argparse.REMAINDER, default=[], help="Extra args passed to each spider")
    args = p.parse_args(argv)

    if args.parallel:
        with ThreadPoolExecutor(max_workers=len(args.spiders)) as pool:
            futures = {pool.submit(run_spider, name, args.args): name for name in args.spiders}
            for fut in as_completed(futures):
                name = futures[fut]
                try:
                    code = fut.result()
                    print(f"[runner] {name} exited with {code}")
                except Exception as exc:
                    print(f"[runner] {name} failed: {exc}")
    else:
        for name in args.spiders:
            code = run_spider(name, args.args)
            print(f"[runner] {name} exited with {code}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
