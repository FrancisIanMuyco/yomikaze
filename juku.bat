@echo off
rem ============================================================
rem   JUKU - YOMIKAZE SCRAPER  v3  (BALANCED TURBO)
rem
rem   Node engine: Playwright + Axios + Cheerio + proxy pool +
rem   retry + rate limit + circuit breaker + CPU/RAM/GPU monitor.
rem
rem   x5 SPEED   - imports several titles IN PARALLEL using your
rem               working proxies (proxy_checker + scraper).
rem   BALANCED   - watches CPU/RAM/GPU and throttles/pauses when
rem               the PC gets hot, so YouTube/Facebook keep running.
rem   DEDUP      - titles/chapters already in the library are never
rem               re-scraped; only new/updated content is added.
rem   SEARCH     - searches MangaFire + MangaDex + MangaKakalot at
rem               once, merges duplicates, then scrapes ALL chapters
rem               of the title you pick.
rem ============================================================
rem Note: no chcp 65001 here - it breaks set /p input in cmd.exe.
title JUKU - YOMIKAZE SCRAPER [BALANCED TURBO]

rem ---- Locate the project root (works from Desktop or project dir) ----
if exist "%~dp0juku\dist\cli.js" (
    set "ROOT=%~dp0"
) else (
    set "ROOT=D:\MANGA MANHUA WEBSITE\YOMIKAZE"
)
cd /d "%ROOT%"

if not exist "node_modules\playwright" (
    echo  [ERROR] Dependencies not installed. Run:  npm install
    pause
    exit /b 1
)

rem ---- ANSI escape code (colors work on Windows 10+) ----
for /f %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"

rem ---- Mode profiles (persisted in juku\.mode) ----
if exist "juku\.mode" set /p MODE=<"juku\.mode"
if not defined MODE set "MODE=BALANCED"
call :set_mode_vars

rem ---- Build gate: compile only if dist is missing or stale ----
if not exist "juku\dist\cli.js" goto build
node -e "const fs=require('fs');const t=fs.statSync('juku/dist/cli.js').mtimeMs;const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(d+'/'+e.name):[d+'/'+e.name]);const stale=walk('juku/src').some(f=>f.endsWith('.ts')&&fs.statSync(f).mtimeMs>t);process.exit(stale?1:0)" && goto menu
:build
echo  [BUILD] Compiling JUKU engine (tsc)... only when source changed
call npm run juku:build

:menu
cls
echo.
echo %ESC%[1;96m  ============================================================%ESC%[0m
echo %ESC%[1;93m      J U K U   -   Y O M I K A Z E   S C R A P E R   v3%ESC%[0m
echo %ESC%[1;96m  ============================================================%ESC%[0m
echo %ESC%[90m   x5 turbo  .  proxies ON  .  auto throttle  .  dedup  .  search%ESC%[0m
echo %ESC%[1;96m  ------------------------------------------------------------%ESC%[0m
echo %ESC%[92m   0%ESC%[0m  AUTO IMPORT   (mangafire + mangadex + mangakakalot)
echo %ESC%[92m   1%ESC%[0m  Import latest titles      (10 titles, latest 20 ch)
echo %ESC%[92m   2%ESC%[0m  Import popular titles     (10 titles, latest 20 ch)
echo %ESC%[92m   3%ESC%[0m  Import ALL chapters       (5 titles, full pages)
echo %ESC%[92m   4%ESC%[0m  Update library            (new chapters only - dedup)
echo %ESC%[92m   5%ESC%[0m  Search a title            (all sources, pick to scrape)
echo %ESC%[92m   R%ESC%[0m  Recommended titles       (popular now, pick to scrape)
echo %ESC%[92m   6%ESC%[0m  Fill missing chapter pages
echo %ESC%[92m   7%ESC%[0m  Source health check
echo %ESC%[92m   8%ESC%[0m  Proxy pool check
echo %ESC%[92m   9%ESC%[0m  Engine status
echo %ESC%[93m   M%ESC%[0m  Change mode        (currently: %ESC%[1;93m%MODE%%ESC%[0m)
echo %ESC%[92m   W%ESC%[0m  Open website
echo %ESC%[91m   Q%ESC%[0m  Exit
echo %ESC%[1;96m  ------------------------------------------------------------%ESC%[0m
if exist "public\scraped.json" node -e "const d=require('./public/scraped.json');const ch=d.chapters||[];const p=ch.reduce((a,c)=>a+(Array.isArray(c.pages)?c.pages.length:0),0);console.log('   Library: '+d.items.length+' titles | '+ch.length+' chapters | '+p+' pages');"
node -e "const fs=require('fs');const n=fs.readFileSync('..\\proxy_checker\\working_proxies.txt','utf-8').split(/\r?\n/).filter(l=>l.trim()).length;console.log('   Proxies: '+n+' working proxies loaded');" 2>nul
echo %ESC%[93m   Mode %MODE% - %MODE_DESC%%ESC%[0m
echo %ESC%[1;96m  ============================================================%ESC%[0m
set /p CHOICE=  Choose: 

if /i "%CHOICE%"=="0" goto auto_import
if /i "%CHOICE%"=="1" goto import_latest
if /i "%CHOICE%"=="2" goto import_popular
if /i "%CHOICE%"=="3" goto import_all
if /i "%CHOICE%"=="4" goto update
if /i "%CHOICE%"=="5" goto search
if /i "%CHOICE%"=="R" goto recommend
if /i "%CHOICE%"=="6" goto fill
if /i "%CHOICE%"=="7" goto health
if /i "%CHOICE%"=="8" goto proxies
if /i "%CHOICE%"=="9" goto status
if /i "%CHOICE%"=="M" goto mode_menu
if /i "%CHOICE%"=="W" goto website
if /i "%CHOICE%"=="Q" exit /b 0
echo  Invalid choice - try again.
pause
goto menu

:auto_import
echo.
echo %ESC%[1;93m  AUTO IMPORT - mangafire + mangadex + mangakakalot  (balanced turbo)%ESC%[0m
echo  CPU/RAM/GPU auto-detected - it throttles and pauses itself when
echo  the machine gets hot, so you can keep browsing / YouTube /
echo  Facebook and the PC never slows down. Duplicates are skipped.
echo.
curl -s -o nul http://localhost:5173 >nul 2>&1 || (
    echo  Starting the website (first time can take ~10s)...
    start "YOMIKAZE server" cmd /k "cd /d %ROOT% && npm run dev"
    ping -n 7 127.0.0.1 >nul
)
echo  Press Ctrl+C inside this window to stop the auto-import.
echo.
call node juku\dist\cli.js auto --rail both --limit 12 --chapters latest-20 --sources mangafire,mangadex,mangakakalot
pause
goto menu

:import_latest
echo.
echo %ESC%[1;93m  Importing latest titles from MangaDex (fast API + proxies)...%ESC%[0m
call node juku\dist\cli.js import --rail latest --limit 10 --chapters latest-20 --source mangadex
pause
goto menu

:import_popular
echo.
echo %ESC%[1;93m  Importing popular titles from MangaDex (fast API + proxies)...%ESC%[0m
call node juku\dist\cli.js import --rail popular --limit 10 --chapters latest-20 --source mangadex
pause
goto menu

:import_all
echo.
echo %ESC%[1;93m  Importing 5 titles with FULL chapters - this takes a while...%ESC%[0m
call node juku\dist\cli.js import --rail latest --limit 5 --chapters all --source mangadex
pause
goto menu

:update
echo.
echo %ESC%[1;93m  Updating library with new chapters (dedup: existing skipped)...%ESC%[0m
call node juku\dist\cli.js update --chapters latest-10
pause
goto menu

:search
echo.
set /p KEYWORD=  Type a title name (e.g. Solo Leveling): 
if not "%KEYWORD%"=="" goto search_ok
echo  Nothing typed - back to menu.
pause
goto menu
:search_ok
echo.
echo  Searching MangaFire + MangaDex + MangaKakalot for: %KEYWORD%
echo  (first search can take ~15-30s - browser sources load pages)
echo  Pick a number to download ALL chapters. Duplicates are skipped.
call node juku\dist\cli.js search "%KEYWORD%" --sources mangafire,mangadex,mangakakalot --limit 10
pause
goto menu

:recommend
echo.
echo %ESC%[1;93m  Recommended titles (trending/popular across sources)...%ESC%[0m
echo  Each result shows its chapter count. Pick a number to download
call node juku\dist\cli.js recommend --sources mangadex,mangafire,mangakakalot --limit 10
pause
goto menu

:fill
echo.
echo %ESC%[1;93m  Filling missing chapter pages (only chapters with no pages)...%ESC%[0m
call node juku\fill-pages.mjs
pause
goto menu

:health
echo.
echo %ESC%[1;93m  Running source health check (Playwright network observer)...%ESC%[0m
call node juku\dist\cli.js health --source mangafire
pause
goto menu

:proxies
echo.
echo %ESC%[1;93m  Health-checking your proxy pool...%ESC%[0m
call node juku\dist\cli.js proxies --check
pause
goto menu

:status
echo.
echo %ESC%[1;93m  Engine status...%ESC%[0m
call node juku\dist\cli.js status
pause
goto menu

:mode_menu
cls
echo.
echo %ESC%[1;96m  ============================================================%ESC%[0m
echo %ESC%[1;93m      SCRAPER MODE%ESC%[0m
echo %ESC%[1;96m  ============================================================%ESC%[0m
echo %ESC%[92m   1%ESC%[0m  BALANCED   - throttles when the PC gets busy (YouTube/Facebook safe)
echo %ESC%[92m   2%ESC%[0m  TURBO      - max x5+ speed, backs off only when really hot
echo %ESC%[92m   3%ESC%[0m  QUIET      - minimal CPU/RAM use, slowest
echo %ESC%[91m   0%ESC%[0m  Back to menu
echo %ESC%[1;96m  ------------------------------------------------------------%ESC%[0m
echo   Current: %MODE%  -  %MODE_DESC%
echo %ESC%[1;96m  ============================================================%ESC%[0m
set /p MODE_CHOICE=  Choose mode: 
if "%MODE_CHOICE%"=="1" set "MODE=BALANCED"
if "%MODE_CHOICE%"=="2" set "MODE=TURBO"
if "%MODE_CHOICE%"=="3" set "MODE=QUIET"
if "%MODE_CHOICE%"=="0" goto menu
if not defined MODE goto mode_menu
(echo %MODE%)> "juku\.mode"
call :set_mode_vars
echo.
echo  Mode set to %MODE% - %MODE_DESC%
pause
goto menu

:website
echo.
curl -s -o nul http://localhost:5173 >nul 2>&1
if %errorlevel%==0 goto webopen
echo  Starting the dev server (first time can take ~10s)...
start "YOMIKAZE server" cmd /k "cd /d %ROOT% && npm run dev"
ping -n 7 127.0.0.1 >nul
:webopen
start "" http://localhost:5173
echo  [done] Website opened in your browser.
pause
goto menu

rem ============================================================
rem  Mode profiles - applied at startup and after mode changes.
rem  BALANCED: fast x5, backs off the moment CPU/RAM gets warm
rem  TURBO:    maximum parallelism, only pauses when really hot
rem  QUIET:    one title at a time, tiny footprint
rem ============================================================
:set_mode_vars
if /i "%MODE%"=="TURBO" (
    set "MODE_DESC=MAX SPEED - backs off only when the PC is really hot"
    set "JUKU_TITLE_CONCURRENCY=8"
    set "JUKU_CONCURRENCY=30"
    set "JUKU_HTTP_WORKERS=12"
    set "JUKU_MAX_HTTP_WORKERS=16"
    set "JUKU_BROWSER_PAGES=8"
    set "JUKU_MAX_BROWSER_PAGES=10"
    set "JUKU_MANGAFIRE_RPS=5"
    set "JUKU_MANGAFIRE_RPM=300"
    set "JUKU_MANGADEX_RPS=12"
    set "JUKU_MANGADEX_RPM=720"
    set "JUKU_CPU_WARN=75"
    set "JUKU_CPU_CRITICAL=90"
    set "JUKU_RAM_WARN=90"
    set "JUKU_RAM_CRITICAL=95"
) else if /i "%MODE%"=="QUIET" (
    set "MODE_DESC=MINIMAL CPU/RAM - slowest, leaves the PC almost free"
    set "JUKU_TITLE_CONCURRENCY=1"
    set "JUKU_CONCURRENCY=4"
    set "JUKU_HTTP_WORKERS=2"
    set "JUKU_MAX_HTTP_WORKERS=4"
    set "JUKU_BROWSER_PAGES=2"
    set "JUKU_MAX_BROWSER_PAGES=3"
    set "JUKU_MANGAFIRE_RPS=1"
    set "JUKU_MANGAFIRE_RPM=60"
    set "JUKU_MANGADEX_RPS=2"
    set "JUKU_MANGADEX_RPM=120"
    set "JUKU_CPU_WARN=25"
    set "JUKU_CPU_CRITICAL=45"
    set "JUKU_RAM_WARN=75"
    set "JUKU_RAM_CRITICAL=88"
) else (
    set "MODE=BALANCED"
    set "MODE_DESC=watches CPU/RAM - throttles the moment the PC gets busy (YouTube/Facebook safe)"
    set "JUKU_TITLE_CONCURRENCY=5"
    set "JUKU_CONCURRENCY=20"
    set "JUKU_HTTP_WORKERS=8"
    set "JUKU_MAX_HTTP_WORKERS=12"
    set "JUKU_BROWSER_PAGES=5"
    set "JUKU_MAX_BROWSER_PAGES=8"
    set "JUKU_MANGAFIRE_RPS=3"
    set "JUKU_MANGAFIRE_RPM=180"
    set "JUKU_MANGADEX_RPS=8"
    set "JUKU_MANGADEX_RPM=480"
    set "JUKU_CPU_WARN=45"
    set "JUKU_CPU_CRITICAL=65"
    set "JUKU_RAM_WARN=85"
    set "JUKU_RAM_CRITICAL=92"
)
set "JUKU_RESOURCE_INTERVAL_MS=2000"
set "JUKU_USE_PROXIES=1"
goto :eof
