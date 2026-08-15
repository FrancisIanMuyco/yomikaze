import os
import requests
import sys
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

DEFAULT_TARGET = "http://ipinfo.io/ip"

# MangaFire's CDN (mfcdn*.xyz) is hotlink-protected — it 403s requests that
# lack the mangafire Referer. Any CDN validation must send these headers or
# every proxy looks dead.
MFCDN_HEADERS = {
    "Referer": "https://mangafire.to/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
}


def mask_proxy(proxy: str) -> str:
    """Hide the password part of an authenticated proxy line in output."""
    if "://" in proxy and "@" in proxy:
        scheme, rest = proxy.split("://", 1)
        auth, hostport = rest.rsplit("@", 1)
        if ":" in auth:
            user, _, pwd = auth.partition(":")
            if pwd:
                return f"{scheme}://{user}:****@{hostport}"
    return proxy


def check_proxy(proxy, target):
    try:
        headers = MFCDN_HEADERS if target != DEFAULT_TARGET else {}
        r = requests.get(target, proxies={"http": proxy, "https": proxy},
                         headers=headers, timeout=8)
        # Any HTTP response (even 403/404) proves the proxy tunnels — but for
        # the mfcdn CDN target we specifically want 200 (image fetched OK).
        if target == DEFAULT_TARGET:
            return r.text.strip() or "ok"
        return str(r.status_code) if r.status_code == 200 else None
    except:
        return None

def load_proxies_from_files(proxy_dir):
    import os
    files = ["proxies_http.txt", "proxies_https.txt", "proxies_socks4.txt", "proxies_socks5.txt"]
    proxies = []
    for fname in files:
        fpath = os.path.join(proxy_dir, fname)
        if os.path.exists(fpath):
            with open(fpath) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    if "://" not in line:
                        parts = line.split(":", 3)
                        if len(parts) == 4:  # ip:port:user:pass -> authenticated URL
                            line = f"http://{parts[2]}:{parts[3]}@{parts[0]}:{parts[1]}"
                    proxies.append(line)
    return proxies

def main():
    parser = argparse.ArgumentParser(description="Check proxies and write working ones to working_proxies.txt")
    parser.add_argument("--target", default=DEFAULT_TARGET,
                        help="URL to fetch through each proxy (default ipinfo.io/ip). "
                             "For MangaFire CDN validation pass a real mfcdn2.xyz image URL.")
    parser.add_argument("--min-working", type=int, default=0,
                        help="Fail (exit 1) if fewer than N working proxies (for CI).")
    parser.add_argument("proxies", nargs="*", help="Optional explicit proxy list (defaults to proxies_*.txt)")
    args = parser.parse_args()

    # Default to this script's own folder (the one holding proxies_*.txt and
    # working_proxies.txt) instead of a hardcoded Desktop path.
    proxy_dir = str(Path(__file__).resolve().parent)

    if args.proxies:
        proxies = [p.strip() for p in args.proxies if p.strip()]
    else:
        proxies = load_proxies_from_files(proxy_dir)

    # ALWAYS keep the previously-working list in the candidate pool. Free raw
    # lists are ~95% dead, so replacing the good list with fresh-only would
    # regress the site. Merge + dedupe instead.
    working_path = os.path.join(proxy_dir, "working_proxies.txt")
    if os.path.exists(working_path):
        with open(working_path, encoding="utf-8", errors="ignore") as f:
            for ln in f:
                ln = ln.strip()
                if ln and ln not in proxies:
                    proxies.append(ln)

    if not proxies:
        print("No proxies to check.")
        return

    print(f"Checking {len(proxies)} proxies with 10 threads against {args.target}...")
    working = []
    dead = []

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(check_proxy, p, args.target): p for p in proxies}
        for future in as_completed(futures):
            proxy = futures[future]
            try:
                result = future.result()
                if result:
                    print(f"[WORKING] {mask_proxy(proxy)} -> {result}")
                    working.append(proxy)
                else:
                    dead.append(proxy)
            except Exception as e:
                dead.append(proxy)

    print(f"\nResults: {len(working)} working, {len(dead)} dead")
    if working:
        out_path = os.path.join(proxy_dir, "working_proxies.txt")
        with open(out_path, "w") as f:
            f.write("\n".join(working))
        print(f"Saved working proxies to {out_path}")
    if args.min_working and len(working) < args.min_working:
        sys.exit(f"Only {len(working)} working proxies — below --min-working {args.min_working}")

if __name__ == "__main__":
    main()
