from playwright.sync_api import sync_playwright
from urllib.parse import urljoin

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')
    page = context.new_page()
    
    print('1. Navigating...')
    page.goto('https://mangafire.to/title/ro8ro-all-class-awakening-god-slayer', wait_until='domcontentloaded', timeout=30000)
    page.wait_for_timeout(2000)
    
    print('2. Finding latest chapter...')
    latest_href = page.evaluate("""() => {
        const links = document.querySelectorAll('a[href*=\"/chapter/\"]');
        return links.length > 0 ? links[0].href : null;
    }""")
    print(f'Latest: {latest_href}')
    
    current_url = urljoin('https://mangafire.to/title/ro8ro-all-class-awakening-god-slayer', latest_href)
    chapters = []
    seen = set()
    
    for i in range(3):
        print(f'\n--- Iteration {i+1} ---')
        if not current_url or current_url in seen:
            print('Breaking: URL already seen')
            break
        seen.add(current_url)
        
        print(f'3. Navigating to: {current_url}')
        page.goto(current_url, wait_until='domcontentloaded', timeout=30000)
        page.wait_for_timeout(1500)
        
        print('4. Extracting chapter number...')
        ch_num = page.evaluate("""() => {
            const text = document.body.innerText;
            const match = text.match(/Ch\\.\\s*(\\d+)/);
            return match ? parseInt(match[1]) : null;
        }""")
        print(f'Chapter: {ch_num}')
        
        chapter_url = page.evaluate('window.location.href')
        print(f'URL: {chapter_url}')
        
        print('5. Scrolling...')
        for j in range(20):
            page.evaluate('window.scrollBy(0, window.innerHeight)')
            page.wait_for_timeout(250)
            cur = page.evaluate('document.body.scrollHeight')
            if j == 0:
                prev = cur
            if cur == prev:
                break
            prev = cur
        
        print('6. Finding images...')
        imgs = page.evaluate("""() => {
            const imgs = document.querySelectorAll('.reader img');
            return Array.from(imgs).map(img => img.src).filter(Boolean);
        }""")
        print(f'Found {len(imgs)} images')
        
        print('7. Clicking Previous...')
        has_prev = page.evaluate("""() => {
            const btns = document.querySelectorAll('button.reader__end-btn');
            for (const btn of btns) {
                if (btn.textContent.toLowerCase().includes('previous')) {
                    btn.click();
                    return true;
                }
            }
            return false;
        }""")
        print(f'Has previous: {has_prev}')
        
        if not has_prev:
            print('No more chapters')
            break
        
        page.wait_for_timeout(2500)
        current_url = page.evaluate('window.location.href')
        print(f'Next URL: {current_url}')
    
    browser.close()
    print(f'\nTotal chapters: {len(chapters)}')
