from playwright.sync_api import sync_playwright
import time

proxy = 'http://172.171.83.26:8080'
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', proxy={'server': proxy})
    page = ctx.new_page()
    page.goto('https://mangafire.to/manga', wait_until='domcontentloaded', timeout=30000)
    time.sleep(3)
    
    # Test the selector from the code
    hrefs = page.evaluate("""() => Array.from(document.querySelectorAll('a[href*="/title/"]')).map(a => a.getAttribute('href'))""")
    print('Title links found:', len(hrefs))
    if hrefs:
        print('First 5:', hrefs[:5])
    
    # Test chapter links
    chapters = page.evaluate("""() => {
        const out = [];
        document.querySelectorAll('a[href*="/chapter/"]').forEach(a => {
            const m = (a.textContent || '').match(/(\\d+)/);
            const num = m ? parseInt(m[1]) : null;
            const idm = (a.href || '').match(/chapter\\/(\\d+)/);
            if (num && idm) out.push({ id: parseInt(idm[1]), number: num, url: a.href });
        });
        return out;
    }""")
    print('Chapter links found:', len(chapters))
    
    ctx.close()
    browser.close()
