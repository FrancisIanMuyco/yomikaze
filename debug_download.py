import sys, json, asyncio, aiohttp
from pathlib import Path
import time

sys.path.insert(0, r'C:\Users\Administrator\Desktop\scraper')
import yomikaze_downloader as yd

async def test():
    print('Loading scraped.json...')
    t0 = time.time()
    scraped_path = Path('public/scraped.json')
    data = json.loads(scraped_path.read_text(encoding='utf-8'))
    chapters = data.get('chapters', [])[:2]
    print(f'Loaded {len(chapters)} chapters in {time.time()-t0:.1f}s')

    for ch in chapters:
        title = ch.get('title', 'Chapter')
        pages = ch.get('pages', [])
        print(f'Chapter: {title} - {len(pages)} pages')
        page_urls = pages[:2]
        local = [u for u in page_urls if u and u.startswith('/manga/')]
        print(f'  Local URLs: {len(local)}/{len(page_urls)}')

        if len(local) < len(page_urls):
            print('  Starting download...')
            manga_cache_dir = Path('manga-cache')
            semaphore = asyncio.Semaphore(2)
            connector = aiohttp.TCPConnector(limit=2, ssl=False)
            timeout = aiohttp.ClientTimeout(total=30)

            async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
                result = await yd.process_chapter(
                    ch.get('url', ''),
                    ch.get('series_id', 'unknown'),
                    ch.get('number', 0),
                    title,
                    page_urls,
                    manga_cache_dir,
                    semaphore,
                    session,
                    None,
                    scraped_path,
                )
                print(f'  Done: {len(result)} URLs')
        else:
            print('  Skipping - all local')

if __name__ == '__main__':
    asyncio.run(test())
