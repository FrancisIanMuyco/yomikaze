import asyncio
from playwright.async_api import async_playwright

async def test():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')
        page = await ctx.new_page()
        await page.goto('https://mangafire.to/title/52x0-solo-leveling', wait_until='domcontentloaded', timeout=60000)
        await page.wait_for_timeout(5000)
        
        content = await page.content()
        captcha_markers = ['@waf', 'challenge', 'verify you\'re human', 'click the shapes', 'captcha']
        has_captcha = any(marker in content.lower() for marker in captcha_markers)
        
        print('Has captcha:', has_captcha)
        print('Page title:', await page.title())
        print('URL:', page.url)
        
        chapters = await page.query_selector_all('a[href*="/chapter/"]')
        print('Chapter links found:', len(chapters))
        
        await ctx.close()
        await browser.close()

asyncio.run(test())
