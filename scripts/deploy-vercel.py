#!/usr/bin/env python3
"""
Deploy YOMIKAZE to Vercel via the REST API (works in GitHub Actions and locally).

Flow (per Vercel docs — https://vercel.com/docs/rest-api/deployments/upload-deployment-files):
  1. Compute a SHA1 digest per file.
  2. POST /v2/files with the file bytes and `x-now-digest: <sha1>`.
     Vercel responds 200 either way — "File already uploaded" when the digest
     is already stored, so unchanged files cost nothing.
  3. POST /v13/deployments with files:[{file, sha}] (sha = SHA1) and
     projectSettings so the build + function detection run on Vercel's side.

Reads VERCEL_TOKEN from the VERCEL_TOKEN env var or from .env (gitignored).

Usage:
    python scripts/deploy-vercel.py           # production deploy
    python scripts/deploy-vercel.py --preview # preview deploy (no alias swap)
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent  # YOMIKAZE/
TEAM = "team_8k0hj4en3nPW8iI6HyZaEaWf"
PROJECT = "yomikaze"

SKIP_DIRS = {
    ".git", "node_modules", "dist", "dist-ssr", ".vercel", ".tools",
    "venv", ".venv", "logs", "__pycache__", ".wrangler", "manga-cache",
    # Proxy lists carry user:pass credentials — never ship them to a
    # deployment. The working list lives in the PROXY_LIST repo secret and
    # is only written to a temp file at runtime in CI.
    "proxy_checker",
}
SKIP_FILES = {
    ".env", ".env.local", ".env.development", ".env.cloudflare",
    # Any other dot-env variant (defense in depth)
    ".env.production", ".env.test",
}
SKIP_EXT = {".pyc", ".log", ".zip", ".exe"}

PROJECT_SETTINGS = {
    "framework": "vite",
    "installCommand": "npm install",
    "buildCommand": "npm run build",
    "outputDirectory": "dist",
}


def get_token():
    token = os.environ.get("VERCEL_TOKEN")
    if token:
        return token.strip()
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            m = re.match(r"\s*VERCEL_TOKEN\s*=\s*(\S+)", line)
            if m:
                return m.group(1)
    sys.exit("VERCEL_TOKEN not found in env or .env")


def api(token, method, path, body=None, raw=None, digest=None, timeout=180):
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    data = None
    if raw is not None:
        data = raw
        headers["Content-Type"] = "application/octet-stream"
        if digest:
            headers["x-now-digest"] = digest
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    url = f"https://api.vercel.com{path}?teamId={TEAM}"
    req = urllib.request.Request(url, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw_body = r.read()
            return r.status, json.loads(raw_body.decode()) if raw_body.strip() else {}
    except urllib.error.HTTPError as e:
        err = e.read().decode(errors="ignore")
        return e.code, (json.loads(err) if err.strip().startswith("{") else {"error": err})


def collect_files():
    """Return [{file, path, sha}] for every deployable file under ROOT."""
    out = []
    for p in sorted(ROOT.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(ROOT).as_posix()
        parts = set(p.relative_to(ROOT).parts)
        if parts & SKIP_DIRS or p.name in SKIP_FILES or p.suffix in SKIP_EXT:
            continue
        sha = hashlib.sha1(p.read_bytes()).hexdigest()  # docs: SHA1
        out.append({"file": rel, "path": p, "sha": sha})
    return out


def upload_files(token, files):
    """Upload every file; Vercel skips storage when the digest already exists."""
    uploaded = 0
    for f in files:
        status, _ = api(token, "POST", "/v2/files", raw=f["path"].read_bytes(), digest=f["sha"])
        if status != 200:
            print(f"[!] upload failed for {f['file']}: {status}", file=sys.stderr)
            sys.exit(1)
        uploaded += 1
        if uploaded % 200 == 0:
            print(f"  uploaded {uploaded}/{len(files)}")
    print(f"files: {len(files)} uploaded (unchanged ones deduped server-side)")
    return {f["file"]: f["sha"] for f in files}


def create_deployment(token, file_shas, preview=False):
    body = {
        "name": PROJECT,
        "project": PROJECT,
        "files": [{"file": f, "sha": sha} for f, sha in file_shas.items()],
        "projectSettings": PROJECT_SETTINGS,
    }
    if not preview:
        body["target"] = "production"
    status, resp = api(token, "POST", "/v13/deployments", body=body)
    if status not in (200, 201):
        print(f"[!] deployment create failed: {status} {resp}", file=sys.stderr)
        sys.exit(1)
    dep_id = resp.get("id") or resp.get("uid")
    url = resp.get("url") or resp.get("alias")
    print(f"deployment created: id={dep_id} url={url}")
    return dep_id, url


def poll(token, dep_id, timeout_min=25):
    deadline = time.time() + timeout_min * 60
    while time.time() < deadline:
        status, resp = api(token, "GET", f"/v13/deployments/{dep_id}")
        state = resp.get("readyState") or resp.get("status")
        if state in ("READY", "ERROR", "CANCELED", "ERRORED"):
            print(f"state: {state}")
            return state, resp
        print(f"  building... ({state})")
        time.sleep(10)
    print("[!] deploy timed out", file=sys.stderr)
    return "TIMEOUT", {}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", action="store_true", help="Deploy to preview (no alias swap)")
    args = parser.parse_args()

    token = get_token()
    print("collecting files...")
    files = collect_files()
    file_shas = upload_files(token, files)
    dep_id, url = create_deployment(token, file_shas, preview=args.preview)
    state, _ = poll(token, dep_id)
    if state != "READY":
        sys.exit(f"deploy failed: {state}")
    print(f"OK: {url}")


if __name__ == "__main__":
    main()
