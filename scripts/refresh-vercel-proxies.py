#!/usr/bin/env python3
"""
Refresh the Vercel MFCDN_PROXIES env var from the working proxy list.

The Vercel /api/mfcdn function fetches MangaFire CDN images through these
proxies (the CDN blocks big cloud IPs but allows small datacenter IPs).
When the proxy checker refreshes proxy_checker/working_proxies.txt, run:

    python scripts/refresh-vercel-proxies.py

Reads VERCEL_TOKEN from the VERCEL_TOKEN env var (GitHub Actions secret) or
from .env (local, gitignored).
"""

import json
import os
import re
import sys
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # YOMIKAZE/
ENV_FILE = os.path.join(ROOT, ".env")
PROXY_FILE = os.path.join(ROOT, "proxy_checker", "working_proxies.txt")
TEAM = "team_8k0hj4en3nPW8iI6HyZaEaWf"
PROJECT = "yomikaze"
KEY = "MFCDN_PROXIES"


def get_token():
    token = os.environ.get("VERCEL_TOKEN")
    if token:
        return token.strip()
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, encoding="utf-8") as f:
            for line in f:
                m = re.match(r"\s*VERCEL_TOKEN\s*=\s*(\S+)", line)
                if m:
                    return m.group(1)
    sys.exit("VERCEL_TOKEN not found in env or .env")


def api(token, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"https://api.vercel.com{path}?teamId={TEAM}",
        method=method, data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        })
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, json.loads(raw.decode()) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def main():
    token = get_token()
    with open(PROXY_FILE, encoding="utf-8", errors="ignore") as f:
        proxies = [ln.strip() for ln in f if ln.strip()]
    if not proxies:
        sys.exit(f"no proxies found in {PROXY_FILE}")
    value = "\n".join(proxies)
    print(f"proxies: {len(proxies)} ({len(value)} chars)")

    # Remove existing entries so we don't accumulate duplicates.
    _, envs = api(token, "GET", f"/v9/projects/{PROJECT}/env")
    for e in (envs.get("envs") or []):
        if e.get("key") == KEY:
            _, _ = api(token, "DELETE", f"/v9/projects/{PROJECT}/env/{e.get('id')}")

    status, resp = api(token, "POST", f"/v10/projects/{PROJECT}/env", {
        "key": KEY,
        "value": value,
        "type": "encrypted",
        "target": ["production", "preview"],
    })
    print(f"status: {status} - {KEY} updated ({resp.get('key') or resp})")


if __name__ == "__main__":
    main()
