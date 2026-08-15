# YOMIKAZE Scraper

Feeds the YOMIKAZE app (`YOMIKAZE/public/scraped.json`) by scraping manga /
manhua / manhwa from **mangafire.to**, with automatic fallback to
**mangakakalot.gg** and proxy rotation when blocked.

## 🚀 The one command: `yomikaze.bat`

Double-click **`yomikaze.bat`** — everything lives behind this one menu.

> ⚠️ **IMPORTANT — the bat uses its own Python (`scraper/venv/`).**
> Bare `python` in a double-clicked cmd on Windows resolves to the Microsoft
> Store stub which has **no playwright** — so the scraper would fail with
> `ModuleNotFoundError: No module named 'playwright'`. The bat therefore
> calls `scraper/venv/Scripts/python.exe` directly (full path). The venv is
> already set up; if you ever need to recreate it:
> ```bat
> python -m venv scraper\venv
> scraper\venv\Scripts\python -m pip install playwright==1.62.0 tqdm requests beautifulsoup4 pillow aiohttp
> ```

```
   1. Pick titles to download   (see a list → type numbers → only those)
   2. Auto-add new titles       (random mix of new + old, asks how many)
   3. Check progress            (is the scraper running + library count)
   4. God Slayer update         (scrape + merge God Slayer)
   5. Open website              (start the site + open your browser)
   6. Update ALL titles         (fetch NEW chapters for titles you already have)
   7. Search a specific title   (type a name → list matches → download)
   8. Exit
```

Extra features built in:
- **Live stats**: the menu itself shows `Library: N titles | M chapters`.
- **Tipid mode**: option 2 asks `all` (full) or `latest-20` (fast) chapters.
- **Run logs**: every scrape output is saved to `scraper/logs/` (via
  `logrun.py`) while still showing live on screen.

Nothing is ever downloaded twice: titles already in `scraped.json` are
skipped (matched by URL slug **and** normalized title / alt titles), and
finished chapters are skipped on resume.

## 📁 Folder layout

```
scraper/
  yomikaze.bat            ← THE entry point (menu above)
  mangafire_catalog.py    ← main catalog scraper (discover → scrape → merge)
  pick_titles.py          ← interactive title picker (menu option 1)
  mangakakalot_fallback.py← fallback source when mangafire blocks a title
  response_scraper/       ← network-response image capture helpers
  bypass_tools/           ← Cloudflare & reCAPTCHA bypass toolkits
  crawler/                ← Scrapy framework (MangaDex, MAL, MangaPlus, ...)
  image_extractor/        ← async Playwright image URL extractor
  tests/                  ← test suite + fixtures
  legacy/                 ← old one-off scripts from earlier versions (archived)
  requirements.txt
  README.md
```

### Active system

- **`mangafire_catalog.py`** — discovers titles from the whole catalog
  (6 pages deep of each listing, **random** mix of new + old each run).
  Per-title flow: mangafire → retry with next proxy on captcha/block →
  mangakakalot.gg fallback. Results are merged into `scraped.json`.
  `--update` refreshes every title already in the library instead.
- **`pick_titles.py`** — shows a numbered list of candidates; type `1 3 5`,
  `2-6`, `a` (all) or `q` (quit) to choose exactly which titles to scrape.
  `--search "keyword"` lists only search matches.
- **`mangakakalot_fallback.py`** — standalone fallback scraper with the same
  proxy-rotation + response-capture machinery.
- **`logrun.py`** — helper that runs a command while teeing its output to a
  log file (`logs/`) and to the console.

## 🔧 Direct CLI usage (advanced)

```bash
# Auto-add N random new titles
python mangafire_catalog.py --limit 30 --proxy-file "D:\MANGA MANHUA WEBSITE\proxy_checker\working_proxies.txt"

# Only the newest 20 chapters per title (much faster)
python mangafire_catalog.py --limit 30 --chapters latest-20

# Metadata only (no chapter pages)
python mangafire_catalog.py --limit 30 --chapters none

# UPDATE: refresh all titles already in the library (new chapters only)
python mangafire_catalog.py --update --chapters latest-20

# Interactive picker (random list)
python pick_titles.py

# Interactive picker searching for a specific title
python pick_titles.py --search "One Punch Man"

# Run anything while saving output to a log
python logrun.py "logs\run.log" -- python mangafire_catalog.py --limit 10
```

`mangafire_catalog.py` options:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--limit` | `30` | Max titles to import |
| `--chapters` | `all` | `all` \| `latest-5/10/20/50` \| `none` |
| `--output` | `YOMIKAZE/public/scraped.json` | Output path |
| `--fresh` | off | Overwrite `scraped.json` instead of merging |
| `--delay` | `0.3` | Seconds between chapter API calls |
| `--no-random` | off | Use trending-first order instead of random |
| `--proxy-file` | auto | Proxy list for rotation (captcha/block recovery) |

> 🛡️ **Authenticated / residential proxies supported.** Lines may be plain
> `http://ip:port` OR `http://user:pass@host:port` (also `socks5://`). The
> scraper splits the credentials and passes them to Playwright correctly, and
> passwords are masked in logs. Put your best proxies on top of
> `proxy_checker/working_proxies.txt` — they get tried first, with the free
> ones as fallback. The old `ip:port:user:pass` (4-colon) format from
> `scraper/working proxies/*.txt` batches is also understood — each line is
> auto-converted to `http://user:pass@ip:port`.
| `--max-proxies` | `60` | Max proxies to try before giving up |
| `--headful` | off | Show the browser window (better against anti-bot) |
| `--update` | off | Refresh existing library titles instead of adding new ones |

`pick_titles.py` extra option:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--search` | `""` | Search mangafire for this keyword and list only those matches |

## 🕸️ Bypass tools

- `bypass_tools/cf_bypass/` — self-contained Cloudflare bypass service
  (Docker + FastAPI). See its `README.md`.
- `bypass_tools/recaptcha_bypass/` — reCAPTCHA solver (CV-based).

## 🧪 Tests

```bash
cd tests && python -m pytest          # if pytest is installed
```

Fixtures in `tests/fixtures/` let the end-to-end test run with no internet.

## 📦 Legacy (archived)

`legacy/` holds one-off scripts from earlier scraper versions — kept for
reference, not needed for day-to-day use:

`scraper.py`, `playwright_scraper.py`, `scrape_all_chapters.py`,
`fast_downloader.py`, `fast_image_extractor.py`, `manga_scraper.py`,
`mangafire_all_chapters.py`, `mangafire_captcha_solver.py`,
`mangafire_multi.py`, `run_scraper.py`, `scrape_solo_leveling.py`,
`scrape_to_yomikaze.py`, `scraper_bypass.py`, `scraper_main.py`,
`yomikaze_downloader.py`, `chapter_downloader.py`, `merge-scraped.mjs`,
`viewer.html`, old run logs (`catalog_run*.err/.log`), and old tests
(`test_captcha.py`, `test_selectors.py`).

## ⚖️ Legal note

Scraping copyrighted manga/manhua/manhwa is almost always against the target
site's Terms of Service and may breach copyright law. Use these tools only on
sites you own or are explicitly allowed to scrape.
