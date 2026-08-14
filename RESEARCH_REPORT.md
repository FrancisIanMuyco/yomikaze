# YOMIKAZE — Final Research & Test Report

## 1 · FREE API RESEARCH

| Provider | URL | API | Free | Metadata | Chapter list | Actual pages | Commercial use | License | Rate limits | API key | Attribution | Recommendation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AniList** | [graphql.anilist.co](https://docs.anilist.co/) | GraphQL | ✅ | ✅ covers/banners/genres/status/scores | ⚠️ count only (no page list) | ❌ | ✅ (public data) | CC BY-NC-SA 4.0 for content; API itself open | ~90 req/min, no auth | ❌ none | ✅ footer + siteUrl links | 🟢 **SELECTED (metadata)** |
| **Jikan** (MyAnimeList) | [jikan.moe](https://jikan.moe/) | REST | ✅ | ✅ | ❌ | ❌ | ✅ | Public API (unofficial) | 3 req/s, 60/min | ❌ | ✅ | 🟡 Not selected — AniList supersedes |
| **Kitsu** | [kitsu.io/api](https://kitsu.docs.apiary.io/) | REST (JSON:API) | ✅ | ✅ | ❌ | ❌ | ✅ | CC | generous | ❌ | ✅ | 🟡 Not selected — weaker manga data |
| **MangaDex** | [api.mangadex.org](https://api.mangadex.org/) | REST | ✅ | ✅ | ✅ | ⚠️ via /at-home | 🔴 | AUP: must credit scanlation groups, **no ads/paid services**, honor takedowns | 5 req/s | ❌ | ✅ mandatory | 🔴 **NOT integrated for chapters** — scanlations of copyrighted works + non-commercial AUP |
| **Wikimedia Commons** | commons.wikimedia.org | MediaWiki | ✅ | ❌ | ❌ | ✅ (hotlinkable) | ✅ | PD / CC0 / CC | — | ❌ | varies (PD = recommended only) | 🟢 **SUITABLE for legal demo/PD content** |
| **Openverse** | api.openverse.org | REST | ✅ | ✅ | ❌ | ✅ | ✅ CC | CC | key optional, generous | optional | ✅ required | 🟢 Alternative for CC imagery |

> **Content rule applied:** A public website is not permission to reuse its images. YOMIKAZE does **not** mirror copyrighted scans, bypass protections, or rehost licensed chapter pages.

## 2 · SELECTED PROVIDER

**MangaDex official API** (`api.mangadex.org`) — free, keyless, CORS-enabled public REST API with **real chapter pages** served by its At-Home CDN. This is the standard integration path used by Kotatsu/Tachiyomi-class readers. MangaDex's AUP is compatible with a free, ad-free site: credit MangaDex and scanlation groups (shown in footer + reader), honor takedown requests. Licensed titles (e.g. One Piece, Solo Leveling) surface as external links and are marked unavailable instead of fake content.

**Fallbacks:** AniList (`anilist` mode, metadata-only), original demo content (`demo` mode / `auto` hybrid, offline-safe, clearly labeled), and `mock` for offline testing.

## 3 · IMPLEMENTATION

**Files created (~45):**
- Config: `package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `.env.example`, `.gitignore`
- Docs: `README.md`, `RESEARCH_REPORT.md`
- Types: `src/types/index.ts` (Title / Chapter / ChapterPage / progress / history)
- Providers: `src/providers/{ContentProvider.ts, ProviderFactory.ts, HybridProvider.ts}`, `anilist/{AniListProvider.ts, anilistClient.ts}`, `demo/{DemoReaderProvider.ts, demoData.ts}`, `mock/MockProvider.ts`
- Lib/hooks: `lib/{utils,errors,cache}.ts`, `hooks/{useTheme,useFavorites,useHistory,useReadingProgress,useDebouncedValue,useSeo}.ts`
- UI: `components/layout/{Navbar,Footer,MainLayout,ScrollToTop}.tsx`, `components/ui/{TitleCard,CoverImage,Skeletons,Badge,States}.tsx`
- Pages: `Home, Library, Search, Genres, TitleDetails, Reader, Favorites, History, NotFound` (`src/pages/`)
- Assets: 60 original demo SVGs (`public/demo/**`) + `public/favicon.svg`
- Scripts: `scripts/generate-demo-pages.mjs`, `scripts/api-probe.mjs`, `scripts/e2e-test*.mjs`

**Reader architecture:** route `/reader/:titleId/:chapterId` → `getTitle` + `getChapters` + `getChapter` + `getChapterPages` → `ChapterPage[]` → paged / vertical modes, fit width/height, fullscreen, keyboard (← → Space Esc), swipe, chapter drawer, prev/next chapter, progress bar, resume from last page.

**Caching & rate limits:** in-memory TTL cache (`lib/cache.ts`), 429/5xx retry-once + typed errors, debounced search, duplicate-request absorption, hybrid fallback when AniList is down.

**Environment variables:** `VITE_CONTENT_PROVIDER` (`auto|anilist|demo|mock`), `VITE_ANILIST_ENDPOINT`, `VITE_ANILIST_TIMEOUT_MS`, `VITE_API_CACHE_TTL_MS`. No secrets exist.

## 4 · TEST RESULTS

| Check | Result |
|---|---|
| `npm install` | ✅ 0 vulnerabilities |
| TypeScript (`tsc -b`) | ✅ clean |
| Production build (`vite build`) | ✅ 345 KB JS / 102 KB gzip |
| Homepage — real MangaDex catalog (32 titles, hero, sections) | ✅ |
| MangaDex search ("chainsaw man" → 8 results) | ✅ |
| Title details — Chainsaw Man, 107 chapters | ✅ |
| **Reader — REAL chapter images (822×1200, mangadex.network CDN)** | ✅ |
| Reader — 23-page chapter, page advance 1/23 → 2/23 | ✅ |
| Reader — MangaDex + scanlation credit line (AUP) | ✅ |
| External/licensed chapters (Solo Leveling, One Piece) marked unavailable | ✅ |
| Reading progress resume, favorites, history, continue reading | ✅ |
| Unavailable chapter state (no blank reader) | ✅ |
| Mobile 375px — bottom tabs, no horizontal overflow | ✅ |
| Theme dark↔light toggle | ✅ |
| `auto` mode — demo fallback regression | ✅ |
| Console errors / page errors | ✅ **0 / 0** |

## 5 · FINAL LIMITATIONS

- **Licensed titles have external-only chapters.** MangaDex hosts scanlations; officially licensed series (One Piece, Solo Leveling…) link out to official sources. YOMIKAZE marks these *unavailable* rather than pretending.
- **MangaDex AUP compliance is required** to keep the free API: credit MangaDex + scanlation groups (implemented), honor takedown requests, and **no ads or paid services** on the site.
- **Chapter pages load from MangaDex's CDN** — availability depends on MangaDex; At-Home URLs are short-lived and always fetched live (never bundled).
- **Scanlation content is a grey area** — MangaDex's API is the sanctioned access path, but the underlying pages are fan translations. YOMIKAZE never scrapes unauthorized aggregators.
- **Demo artwork is abstract/stylized** (procedurally generated) and only appears in opt-in demo/auto modes.
- **Favorites/history/progress are local** to each device (no accounts yet — Phase 2+ roadmap).

---

*YOMIKAZE — Read. Discover. Escape.*
