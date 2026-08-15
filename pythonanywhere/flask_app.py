"""
YOMIKAZE — MangaFire image proxy for PythonAnywhere (free, always-on)

Why: MangaFire's chapter image CDN (*.mfcdn*.xyz) is behind Cloudflare and
blocks requests from big cloud providers (Cloudflare IPs, AWS/Vercel IPs).
PythonAnywhere runs on its own (small, independent) infrastructure, so its
egress IPs are much more likely to be allowed — same reason the user's free
datacenter proxies work.

Deploy:
  1. Sign up at pythonanywhere.com (free, no credit card)
  2. Dashboard → Web tab → Add a new web app → Flask → Python 3.11/3.12
  3. Open flask_app.py in the editor, replace ALL content with this file
  4. Click Reload → your URL is https://<username>.pythonanywhere.com
  5. Tell the dev the URL → they point VITE_IMAGE_PROXY_BASE at it.

URL scheme (matches the frontend's proxyImageUrl output):
  /api/mfcdn?url=<encoded https URL>
"""

from flask import Flask, Response, request

import requests

app = Flask(__name__)

MFCDN_REFERER = "https://mangafire.to/"
MFCDN_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


@app.route("/api/mfcdn")
def mfcdn():
    url = request.args.get("url", "")
    try:
        host = url.split("/")[2]
    except IndexError:
        host = ""
    if not url.startswith("https://") or "mfcdn" not in host.lower():
        return Response("Bad request", status=400)
    try:
        r = requests.get(
            url,
            headers={
                "Referer": MFCDN_REFERER,
                "User-Agent": MFCDN_UA,
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            },
            timeout=40,
        )
        resp = Response(
            r.content,
            status=r.status_code,
            content_type=r.headers.get("content-type", "image/jpeg"),
        )
        resp.headers["Cache-Control"] = "public, max-age=86400"
        resp.headers["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception:
        return Response("proxy error", status=502)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
