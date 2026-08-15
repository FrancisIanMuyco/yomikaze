#!/usr/bin/env python3
"""
run_scraper.py — one entry point for all scraper modes.

Usage:
    python run_scraper.py "https://..."

Just paste the URL. It auto-tries Normal first; if blocked (Cloudflare /
anti-bot), it falls back to Bypass automatically.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

BASE = Path(__file__).parent
OUT = BASE.parent / "downloads"

try:
    if sys.stdout and sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if sys.stderr and sys.stderr.encoding and sys.stderr.encoding.lower() not in ("utf-8", "utf8"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BANNER = r"""
   ____                        ____ ____ ____ ____ ____ ____
  / ___|  __ _ _ __ ___  _ __ / ___/ ___/ ___/ ___/ ___/ ___|
  \___ \ / _` | '_ ` _ \| '_ \\___ \\___ \\___ \\___ \\___ \\___ \\
   ___) | (_| | | | | | | | | |___) |___) |___) |___) |___) |
  |____/ \__,_|_| |_| |_| |_|_|____/____/____/____/____/____/
  universal manga / manhua scraper
"""

DOCKER_AVAILABLE = shutil.which("docker") is not None


def is_blocked_series(url: str) -> bool:
    """Quick probe with requests to guess if Cloudflare/anti-bot is blocking."""
    try:
        import requests
        from bs4 import BeautifulSoup
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                           "AppleWebKit/537.36 (KHTML, like Gecko) "
                           "Chrome/126.0.0.0 Safari/537.36"
        }
        r = requests.get(url, headers=headers, timeout=20, allow_redirects=True)
        if r.status_code != 200:
            return True
        text = r.text.lower()
        cf_markers = [
            "attention required! | cloudflare",
            "cloudflare ray id:",
            "access denied | cloudflare",
            "verify you are human",
            "captcha",
            "cloudflare.com/",
            "challenge-platform",
        ]
        return any(m in text for m in cf_markers)
    except Exception:
        return True


def is_mangafire(url: str) -> bool:
    return "mangafire.to" in urlparse(url).netloc


def run_py(script: str, args: list[str]) -> int:
    cmd = [sys.executable, str(BASE / script)] + args
    print(f"\n[>] Running: {' '.join(cmd)}\n")
    result = subprocess.run(cmd)
    return result.returncode


def ensure_cf_bypass() -> bool:
    if not DOCKER_AVAILABLE:
        print("[!] Docker not found. Cannot start cf_bypass.")
        return False
    print("[*] Checking cf_bypass container...")
    rc = subprocess.run(
        ["docker", "ps", "-a", "--filter", "name=cf_bypass", "--format", "{{.Names}}"],
        capture_output=True, text=True
    )
    name = rc.stdout.strip()
    if name == "cf_bypass":
        state = subprocess.run(
            ["docker", "ps", "--filter", "name=cf_bypass", "--format", "{{.Names}}"],
            capture_output=True, text=True
        )
        if state.stdout.strip() == "cf_bypass":
            print("[*] cf_bypass already running on port 8000")
            return True
        print("[*] Starting existing cf_bypass container...")
        subprocess.run(["docker", "start", "cf_bypass"], check=False)
    else:
        print("[*] Creating and starting cf_bypass container (first run downloads ~500MB)...")
        subprocess.run([
            "docker", "run", "-d", "-p", "8000:8000",
            "--name", "cf_bypass",
            "-e", "CLOAKBROWSER_AUTO_UPDATE=false",
            "ghcr.io/sarperavci/cloudflarebypassforscraping:latest"
        ], check=False)
    print("[*] Waiting for cf_bypass to initialize (up to 90s)...")
    for _ in range(18):
        time.sleep(5)
        try:
            import requests
            r = requests.get("http://localhost:8000/html?url=https://example.com", timeout=5)
            if r.status_code == 200:
                print("[*] cf_bypass is ready!")
                return True
        except Exception:
            continue
    print("[!] cf_bypass did not become ready in time.")
    return False


def main() -> int:
    print(BANNER)

    if len(sys.argv) > 1:
        url = " ".join(sys.argv[1:])
    else:
        url = input("PASTE ANG URL SA MANGA / MANHUA: ").strip()

    if not url:
        print("[!] Wala ka nag-paste og URL.")
        return 1

    OUT.mkdir(parents=True, exist_ok=True)

    print(f"\n[*] Target: {url}\n")

    # mangafire.to has its own all-chapters logic in playwright_scraper
    if is_mangafire(url):
        print("[*] Detected mangafire.to — using Playwright with ALL-chapters mode.")
        return run_py("playwright_scraper.py", [
            url, "--download", "--output", str(OUT),
            "--all-chapters", "--page-selector", ".reader img", "--format", "cbz"
        ])

    # Probe normal scraper
    print("[*] Probing with Normal Scraper...")
    blocked = is_blocked_series(url)

    if blocked:
        print("[!] Site is blocking direct requests (Cloudflare / anti-bot).")
        print("[*] Falling back to Bypass Mode...")
        ready = ensure_cf_bypass()
        if ready:
            return run_py("scraper_bypass.py", [
                url, "--download", "--output", str(OUT)
            ])
        print("[!] Bypass not available. Trying Playwright as last resort...")
        return run_py("playwright_scraper.py", [
            url, "--download", "--output", str(OUT), "--headful"
        ])

    # Not blocked — use normal scraper
    print("[*] Site looks accessible. Using Normal Scraper.")
    return run_py("scraper.py", [
        url, "--download", "--output", str(OUT)
    ])


if __name__ == "__main__":
    sys.exit(main())
