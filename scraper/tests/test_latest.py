from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')
    page = context.new_page()
    
    print('Navigating...')
    page.goto('https://mangafire.to/title/ro8ro-all-class-awakening-god-slayer', wait_until='domcontentloaded', timeout=60000)
    page.wait_for_timeout(5000)
    
    print('Finding latest chapter via JS...')
    href = page.evaluate("""() => {
        const links = document.querySelectorAll('a[href*=\"/chapter/\"]');
        return links.length > 0 ? links[0].href : null;
    }""")
    print(f'Latest: {href}')
    
    browser.close()
