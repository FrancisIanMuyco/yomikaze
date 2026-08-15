#!/usr/bin/env python3
"""
mangafire_captcha_solver.py - OpenCV-based WAF captcha solver for mangafire.to
"""

import time
import sys
import os
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import cv2
import numpy as np

CHROME_ARGUMENTS = [
    "--no-first-run",
    "--disable-background-mode",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-usage-stats",
    "--disable-crash-reporter",
    "--accept-lang=en-US",
]


def create_driver(headless: bool = False):
    """Create a Chrome driver with stealth settings."""
    options = Options()
    for arg in CHROME_ARGUMENTS:
        options.add_argument(arg)
    if headless:
        options.add_argument("--headless=new")
    
    driver = webdriver.Chrome(options=options)
    driver.set_window_size(1280, 900)
    return driver


def detect_shapes(self, image_path):
    """Detect shapes in image using OpenCV."""
    img = cv2.imread(image_path)
    if img is None:
        print(f"    [error] Could not read image: {image_path}")
        return []
    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
    
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    shapes = []
    
    for cnt in contours:
        approx = cv2.approxPolyDP(cnt, 0.02 * cv2.arcLength(cnt, True), True)
        x, y, w, h = cv2.boundingRect(approx)
        
        if w < 10 or h < 10:
            continue
        
        if len(approx) == 3:
            shapes.append(('triangle', x + w//2, y + h//2))
        elif len(approx) == 4:
            shapes.append(('square', x + w//2, y + h//2))
        else:
            shapes.append(('circle', x + w//2, y + h//2))
            
    return sorted(shapes, key=lambda x: x[2])


def solve_captcha(driver, url: str, timeout: int = 180) -> bool:
    """Solve the mangafire WAF captcha."""
    print(f"[*] Navigating to {url}")
    driver.get(url)
    
    waited = 0
    while waited < timeout:
        try:
            current_url = driver.current_url
            if "@waf" in current_url or "challenge" in current_url.lower():
                if waited % 15 == 0:
                    print(f"    [captcha] Waiting... ({waited}s/{timeout}s)")
                time.sleep(5)
                waited += 5
                continue
            
            body_text = driver.find_element(By.TAG_NAME, "body").text.lower()
            if "verify you're human" in body_text or "click the shapes" in body_text:
                if waited % 15 == 0:
                    print(f"    [captcha] Waiting... ({waited}s/{timeout}s)")
                time.sleep(5)
                waited += 5
                continue
            
            return True
        except Exception:
            time.sleep(5)
            waited += 5
    
    return False


def inspect_captcha(driver):
    """Inspect the captcha page structure."""
    print("\n=== CAPTCHA PAGE INSPECTION ===")
    
    try:
        # Get all elements
        body = driver.find_element(By.TAG_NAME, "body")
        body_html = body.get_attribute("innerHTML")
        print(f"Body HTML length: {len(body_html)}")
        
        # Check for specific elements
        ids = ["stage", "main", "thumb", "submit", "reset", "refresh"]
        for id_name in ids:
            try:
                elem = driver.find_element(By.ID, id_name)
                print(f"  #{id_name}: found")
            except:
                print(f"  #{id_name}: NOT found")
        
        # Check for classes
        classes = ["marker", "shape", "captcha"]
        for class_name in classes:
            try:
                elems = driver.find_elements(By.CLASS_NAME, class_name)
                print(f"  .{class_name}: {len(elems)} found")
            except:
                print(f"  .{class_name}: NOT found")
        
        # Check for data attributes
        try:
            elems = driver.find_elements(By.CSS_SELECTOR, "[data-shape]")
            print(f"  [data-shape]: {len(elems)} found")
        except:
            pass
            
    except Exception as e:
        print(f"  Inspection error: {e}")


def main():
    print("[*] Launching browser...")
    driver = create_driver(headless=False)
    
    try:
        url = "https://mangafire.to/@waf/challenge?return=%2Ftitle%2F52x0-solo-leveling"
        print(f"[*] Navigating to: {url}")
        driver.get(url)
        
        time.sleep(5)
        inspect_captcha(driver)
        
        if solve_captcha(driver, url, timeout=180):
            print("[+] Captcha solved!")
            print(f"    URL: {driver.current_url}")
            print(f"    Title: {driver.title}")
        else:
            print("[-] Captcha timeout")
            return 1
            
    finally:
        print("[*] Closing browser...")
        driver.quit()
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
