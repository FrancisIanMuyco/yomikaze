#!/usr/bin/env python3
"""Scrape ALL chapters from mangafire.to using search + prev button navigation."""

from playwright.sync_api import sync_playwright
import time
import json
from urllib.parse import urljoin

def scrape_all_chapters(series_url, max_chapters=500):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 900},
            locale="en-US",
        )
        page = context.new_page()
        
        print(f"[*] Navigating to {series_url}...")
        page.goto(series_url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(3000)
        
        search_input = page.locator("input[placeholder*='chapter']").first
        if not search_input.is_visible(timeout=5000):
            print("[-] Chapter search not found")
            browser.close()
            return []
        
        print("[*] Searching for Ch. 1...")
        search_input.fill("1")
        search_input.press("Enter")
        page.wait_for_timeout(3000)
        
        ch1_link = page.locator("a[href*='/chapter/']").first
        if not ch1_link.is_visible(timeout=5000):
            print("[-] No chapter links found after search")
            browser.close()
            return []
        
        ch1_href = ch1_link.get_attribute("href")
        current_url = urljoin(series_url, ch1_href)
        print(f"[*] Ch. 1 URL: {current_url}")
        
        chapters = []
        visited = set()
        
        for i in range(max_chapters):
            if not current_url or current_url in visited:
                break
            
            visited.add(current_url)
            page.goto(current_url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(1500)
            
            ch_num = page.evaluate("""() => {
                const text = document.body.innerText;
                const match = text.match(/Ch\\.\\s*(\\d+)/);
                return match ? parseInt(match[1]) : null;
            }""")
            
            if ch_num is not None:
                chapters.append({
                    'number': ch_num,
                    'title': f"Ch. {ch_num}",
                    'url': page.evaluate("window.location.href"),
                })
                print(f"    Ch. {ch_num} ({len(chapters)}/{max_chapters})")
            
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
            
            if not has_prev:
                print("[*] No more previous chapters")
                break
            
            page.wait_for_timeout(2500)
            current_url = page.evaluate("window.location.href")
        
        browser.close()
        return chapters

if __name__ == "__main__":
    url = "https://mangafire.to/title/ro8ro-all-class-awakening-god-slayer"
    chapters = scrape_all_chapters(url)
    
    print(f"\n[*] Total chapters scraped: {len(chapters)}")
    if chapters:
        print(f"[*] First: Ch. {chapters[0]['number']}")
        print(f"[*] Last: Ch. {chapters[-1]['number']}")
    
    with open("D:/MANGA MANHUA WEBSITE/scraper/tests/all_chapters.json", "w", encoding="utf-8") as f:
        json.dump(chapters, f, indent=2)
    print("[*] Saved to tests/all_chapters.json")
