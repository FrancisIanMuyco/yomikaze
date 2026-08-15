#!/usr/bin/env python3
"""
Fetch fresh raw proxy lists from free public sources into proxy_checker/.

The proxy checker (proxy_checker/checker.py) then tests these against a real
target and writes the working subset to proxy_checker/working_proxies.txt,
which refresh-vercel-proxies.py pushes to the Vercel MFCDN_PROXIES env var.

Sources (all free, no key):
  - TheSpeedX/PROXY-List  (http, socks4, socks5)
  - monosans/proxy-list   (http, socks4, socks5)
  - proxyscrape           (http, https, socks4, socks5)
  - proxy-list.download   (http, https, socks4, socks5)

Usage:
    python scripts/fetch-fresh-proxies.py
"""

import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # YOMIKAZE/
PROXY_DIR = os.path.join(ROOT, "proxy_checker")

TIMEOUT = 30

# protocol -> list of (name, url) sources
SOURCES = {
    "http": [
        ("thespeedx", "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt"),
        ("monosans", "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt"),
        ("proxyscrape", "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=3000&country=all&ssl=all&anonymity=all"),
        ("proxy-list.download", "https://www.proxy-list.download/api/v1/get?type=http"),
    ],
    "https": [
        ("proxyscrape", "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=https&timeout=3000&country=all&ssl=all&anonymity=all"),
        ("proxy-list.download", "https://www.proxy-list.download/api/v1/get?type=https"),
    ],
    "socks4": [
        ("thespeedx", "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt"),
        ("monosans", "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks4.txt"),
        ("proxyscrape", "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks4&timeout=3000&country=all"),
        ("proxy-list.download", "https://www.proxy-list.download/api/v1/get?type=socks4"),
    ],
    "socks5": [
        ("thespeedx", "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt"),
        ("monosans", "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt"),
        ("proxyscrape", "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=3000&country=all"),
        ("proxy-list.download", "https://www.proxy-list.download/api/v1/get?type=socks5"),
    ],
}


def fetch(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.read().decode("utf-8", errors="ignore")
    except Exception as e:
        print(f"  [skip] {url} -> {e}")
        return ""


def main():
    os.makedirs(PROXY_DIR, exist_ok=True)
    for protocol, sources in SOURCES.items():
        out_path = os.path.join(PROXY_DIR, f"proxies_{protocol}.txt")
        seen = set()
        lines = []
        for name, url in sources:
            print(f"[{protocol}] fetching {name} ...")
            text = fetch(url)
            for ln in text.splitlines():
                ln = ln.strip()
                if not ln or ln.startswith("#"):
                    continue
                # normalize: strip protocol prefix, keep ip:port or ip:port:user:pass
                if "://" in ln:
                    ln = ln.split("://", 1)[1]
                if ln not in seen:
                    seen.add(ln)
                    lines.append(ln)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        print(f"[{protocol}] {len(lines)} unique proxies -> {out_path}")


if __name__ == "__main__":
    sys.exit(main())
