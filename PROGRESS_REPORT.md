# YOMIKAZE — Progress Report

> **Purpose of this file:** summary sa kahimtang sa website, unsay nabag-o sa kada
> session, ug unsay sunod buhaton — para dali ra kaayo mag-update ug magpadayon.
> Update this file after every working session.

Last updated: **2026-08-14** · Status: ✅ **LIVE** on GitHub Pages + builds green + design polished

---

## 1 · Quick status (TL;DR)

| Area | Status |
|---|---|
| 🌐 **Live site** | ✅ **https://francisianmuyco.github.io/yomikaze/** (GitHub Pages, auto-deploy sa kada push sa `main`) |
| **Git repo** | ✅ `github.com/FrancisIanMuyco/yomikaze` (public) |
| `npm run build` | ✅ **~2–15s** (gikan sa >5min nga hang — na-fix) |
| `npm run typecheck` | ✅ green (app + juku) |
| Content provider | `mangadex` default (real metadata + real pages) |
| Scraped store | `public/scraped.json` — 28 titles, 1,697 chapters |
| Local page cache | `manga-cache/` (34k images, gitignored) |
| Design | Dark cinematic theme, polished this session |
| Reader | Paged/vertical, fit width/height, fullscreen, keyboard, auto-hide controls, page-turn animations |

---

## 2 · Unsa ang nabag-o sa last session (2026-08-14)

### 🌐 Deployment (GitHub Pages) — NEW
- **Live URL:** https://francisianmuyco.github.io/yomikaze/
- Repo: `FrancisIanMuyco/yomikaze` (public) — initial commit + push done.
- **Auto-deploy:** `.github/workflows/deploy.yml` → on every push to `main`, GitHub Actions
  runs `npm ci` + `VITE_BASE_PATH=/yomikaze/ npm run build` and publishes `dist/` to Pages.
- **SPA routing:** `vite.config.ts` sets `base` (via `VITE_BASE_PATH`) + a build plugin copies
  `index.html → 404.html` (GitHub Pages fallback), so deep links (`/title/...`, `/reader/...`)
  work. `App.tsx` BrowserRouter uses `import.meta.env.BASE_URL` as basename.
- **Env var:** `VITE_BASE_PATH=/yomikaze/` kung mag-deploy sa GitHub Pages sub-path; sa dev
  walay set (default `/`).

### 🐛 Build fix (dako kaayo nga improvement)
- **Problema:** ang `npm run build` nag-hang (5+ min, wala mahuman). Ang hinungdan:
  `public/manga/` naay **34,273 ka image files** nga gi-copy sa Vite sa `dist/` kada build,
  bisan wala man gireference sa `scraped.json` (tanang chapter pages kay remote CDN URLs).
- **Fix:**
  - Gi-move ang cache: `public/manga/` → **`manga-cache/`** (project root).
  - Gidugang ang `mangaCacheMiddleware()` sa `vite.config.ts` — nag-serve sa `/manga/*`
    images sa **dev ug preview** (sama sa naa na nga mfcdn proxy), mao nga ang
    downloader pipeline (debug_download.py) padayon ra nga molihok.
  - Na-update ang `debug_download.py` (cache dir) ug `.gitignore` (`manga-cache`).
- **Resulta:** build 5+ min → **2–15s**.

### 🎨 Design polish (dark theme, mas professional)
- **Animations system** (`src/styles/index.css`):
  - `page-enter` — smooth page transition sa tanang route change (gikapot sa `MainLayout`).
  - `ken-burns` — slow zoom sa hero background.
  - `float` — floating kanji watermark.
  - `hero-rise` + `.hero-stagger` — staggered entrance sa hero content.
  - `gradient-shift` — animated gradient sa "Start Reading" button.
  - `page-turn` — subtle slide+fade sa reader pages.
  - `shine` — shimmer sa covers.
- **Home page:** ken-burns hero bg, staggered hero, animated CTA, floating kanji,
  animated progress bars, hover-lift genre pills.
- **Cards:** hover glow ring + flame border sa `TitleCard`, staggered grid entrances
  (home, library, search, favorites).
- **Genres:** mas taas ang hover lift sa genre cards.
- **Reader:** auto-hide top/bottom bars after 2.6s idle (mobalik sa mouse move/scroll/tap,
  naa sa Settings drawer, persisted sa localStorage), page-turn animation sa paged ug
  vertical mode, fixed fragile ASI formatting (saveProgress/recordHistory — latent bug).
- **Title details:** sliding play icon sa chapter rows.

---

## 3 · Unsaon pag-run ug pag-update

```bash
npm install              # una lang (kung bag-o ang machine)
npm run dev              # dev server → http://localhost:5173
npm run build            # typecheck + production build (pas pas na karon)
npm run preview          # test ang build → http://localhost:4173
npm run typecheck        # typecheck ra
```

### Pag-update sa content (scraping)
- **JUKU engine** (Node/TS, `juku/`): `npm run juku -- import --rail latest --limit 10`
  → nagsulat sa `public/scraped.json` nga mabasa dayon sa frontend.
- **Python downloader** (`debug_download.py`): nag-download sa chapter pages ngadto sa
  `manga-cache/` ug gi-rewrite ang `scraped.json` URLs ngadto sa local `/manga/...` paths
  (i-serve sa middleware sa dev/preview).

> **⚠️ Importante:** Ayaw ibalik ang `manga-cache/` ngadto sa `public/` — mao nay
> hinungdan sa hanging build. Kung gusto og offline pages sa production deploy, i-copy
> ang `manga-cache/` sa server ug i-configure ang web server nga mo-serve sa `/manga/*`.

### Environment variables
`.env.example` → `.env` (optional, naay defaults):

| Variable | Default | Purpose |
|---|---|---|
| `VITE_CONTENT_PROVIDER` | `mangadex` | `mangadex` \| `auto` \| `anilist` \| `demo` \| `mock` \| `mangafire` \| `scraped` |
| `VITE_MANGADEX_ENDPOINT` | `https://api.mangadex.org` | MangaDex API |
| `VITE_MANGADEX_TIMEOUT_MS` | `15000` | per-request timeout |
| `VITE_ANILIST_ENDPOINT` | `https://graphql.anilist.co` | AniList (anilist mode) |
| `VITE_API_CACHE_TTL_MS` | `300000` | in-memory cache TTL |

No secrets exist in this project — never put API keys in `VITE_*`.

---

## 4 · Architecture (short map, para dali mag-update)

```
src/
  providers/           ContentProvider interface + implementations
    mangadex/          MangaDex official API (default) — real metadata + real pages
    mangafire/         MangaFire scraped data (reads public/scraped.json)
    scraped/           ScrapedProvider (local JSON store)
    anilist/           AniList metadata only
    demo/ + mock/      Offline fallbacks
    ProviderFactory.ts Env-driven selection (VITE_CONTENT_PROVIDER)
  components/
    layout/            Navbar (desktop + mobile tabs), Footer, MainLayout, ScrollToTop
    ui/                TitleCard, CoverImage, Badge, Skeletons, States
  hooks/               theme, favorites, history, reading progress, seo, library index
  pages/               Home, Library, Search, Genres, TitleDetails, Reader,
                       Favorites, History, NotFound, Scrape
  lib/                 utils (cn, normalizeId, proxyImageUrl, format*), errors, TTL cache
  types/               Title / Chapter / ChapterPage models
  styles/index.css     Tailwind 4 + theme tokens + animation keyframes
juku/                  Scraping engine (Node+TS): sources, proxies, queue, db, CLI
manga-cache/           Local chapter-page images (gitignored, served via middleware)
public/                scraped.json + favicon + demo assets (keep small!)
```

---

## 5 · Known issues / gotchas

0. **MangaDex connectivity (2026-08-14) — FIXED ✅:** ang ISP nag-block sa `api.mangadex.org`
   ug `uploads.mangadex.org` (SNI-based TLS filtering). Na-fix pinaagi sa **Cloudflare Worker
   proxy** (`cloudflare-worker/worker.js`, deployed sa `yomikaze-md-proxy.yomikaze-md.workers.dev`):
   ang browser → Cloudflare (dili blocked) → MangaDex (dili blocked) → balik sa browser. Ang
   site build kay nag-use sa proxy via GitHub Actions secrets:
   - `VITE_MANGADEX_ENDPOINT` = `https://yomikaze-md-proxy.yomikaze-md.workers.dev/md`
   - `VITE_MANGADEX_COVER_ENDPOINT` = `https://yomikaze-md-proxy.yomikaze-md.workers.dev/covers`
   Verified: 31 title cards + covers nag-load na sa live site.

1. **Dev server lock:** kung magdagan ang `npm run dev`, dili ma-move/rename ang
   `manga-cache/` (locked). Stop sa server una.
2. **ScrapePage `/api/scrape`:** wala nay backend middleware para sa `/api/scrape` —
   ang page mismo nag-ingon nga i-run ang scraper directly kung wala ang middleware.
3. **Production deploy:** ang `/mfcdn/` proxy ug `/manga/` middleware kay dev/preview-only.
   Para production, kinahanglan i-serve sa hosting server (o CDN) ang mga images.
4. **No git repo** sa `YOMIKAZE/` karon (walay `.git`) — `git status` returns fatal.
   Kung gusto og version control, i-run `git init` (suggested next step).
5. **JUKU state:** last successful scrape sa mangadex/mangafire kay 2026-08-14; naay
   mga "getDetails returned nothing" errors sa mangafire (ro8ro) — kung mag-import,
   check `juku/state.json` ug `juku/logs/juku.log`.

---

## 6 · Next steps (roadmap suggestions)

**Priority (functional):**
- [ ] `git init` + first commit (para naay backup/history sa mga changes)
- [ ] Production deploy setup (Netlify/Vercel/Cloudflare Pages + static serving sa images)
- [ ] ScrapePage backend middleware (para molihok ang paste-URL nga feature sa production)

**Design/UX (pwede ra sunod):**
- [ ] Scroll-reveal animations (IntersectionObserver) para sa long pages
- [ ] Skeleton shimmer para sa chapter list
- [ ] Loading bar sa top (pag-navigate)
- [ ] Reading statistics (total chapters read, time spent)

**Content:**
- [ ] Regular JUKU import (latest updates) aron fresh ang library
- [ ] Re-run downloader para ma-local ang pages (offline-capable)

---

## 7 · Session log

| Date | Changes |
|---|---|
| 2026-08-14 | Build hang fix (manga-cache move + middleware), design polish (animations, hero, cards, reader auto-hide + page-turn), ReaderPage ASI fix, PROGRESS_REPORT.md |
| 2026-08-14 | **Deployed to GitHub Pages** (live: francisianmuyco.github.io/yomikaze) — repo created, Actions workflow, base path + 404 fallback, verified live |
| 2026-08-14 | **Cloudflare Worker MangaDex proxy** — na-fix ang ISP block (SNI filtering); API + covers mo-agi sa workers.dev; live content verified (31 titles loading) |
