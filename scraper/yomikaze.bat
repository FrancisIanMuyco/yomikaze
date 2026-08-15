@echo off
rem Note: no chcp 65001 here - it breaks set /p input in cmd.exe.
rem IMPORTANT: we use the dedicated venv python (full path) because bare
rem "python" in a double-clicked cmd resolves to the Microsoft Store stub
rem which has NO playwright installed.
set "PY=D:\MANGA MANHUA WEBSITE\scraper\venv\Scripts\python.exe"
if not exist "%PY%" (
    echo  [ERROR] Venv python not found: %PY%
    echo  Recreate it with:  python -m venv scraper\venv
    echo  Then:  scraper\venv\Scripts\python -m pip install playwright==1.62.0 tqdm requests beautifulsoup4 pillow aiohttp
    pause
    exit /b 1
)
title YOMIKAZE - MANGA MANAGER
cd /d "D:\MANGA MANHUA WEBSITE\scraper"

:menu
cls
echo ============================================================
echo            YOMIKAZE - MANGA MANAGER
echo ============================================================
echo    1. Pick titles to download   (choose from a list)
echo    2. Auto-add new titles       (random, asks how many)
echo    3. Check progress            (is scraper running + library)
echo    4. God Slayer update         (scrape + merge God Slayer)
echo    5. Open website              (start the site + open browser)
echo    6. Update ALL titles         (fetch new chapters for your library)
echo    7. Search a specific title   (search by name)
echo    8. Exit
echo ============================================================
if exist "D:\MANGA MANHUA WEBSITE\YOMIKAZE\public\scraped.json" node -e "const d=require('D:/MANGA MANHUA WEBSITE/YOMIKAZE/public/scraped.json'); console.log('  Library: ' + d.items.length + ' titles | ' + d.total_chapters + ' chapters | ' + d.total_pages + ' pages');"
echo ============================================================
set /p CHOICE=  Choose 1-8: 

if "%CHOICE%"=="1" goto pick
if "%CHOICE%"=="2" goto add
if "%CHOICE%"=="3" goto check
if "%CHOICE%"=="4" goto godslayer
if "%CHOICE%"=="5" goto website
if "%CHOICE%"=="6" goto update
if "%CHOICE%"=="7" goto search
if "%CHOICE%"=="8" exit /b 0
echo  Invalid choice - try again.
pause
goto menu

:pick
echo.
echo  Loading title list - this can take a minute...
"%PY%" logrun.py "logs\pick.log" -- "%PY%" pick_titles.py --proxy-file "D:\MANGA MANHUA WEBSITE\proxy_checker\working_proxies.txt"
pause
goto menu

:add
echo.
set /p LIMIT=  How many NEW titles to add (default 25): 
if "%LIMIT%"=="" set LIMIT=25
echo.
set /p CHMODE=  Chapters per title?  [all = full | latest-20 = fast] (default all): 
if "%CHMODE%"=="" set CHMODE=all
echo.
echo  Scraping up to %LIMIT% new titles (%CHMODE% chapters each)...
"%PY%" logrun.py "logs\add.log" -- "%PY%" mangafire_catalog.py --limit %LIMIT% --chapters %CHMODE% --proxy-file "D:\MANGA MANHUA WEBSITE\proxy_checker\working_proxies.txt"
pause
goto menu

:check
echo.
tasklist /FI "IMAGENAME eq python.exe" 2>nul | "%SystemRoot%\System32\find.exe" /I "python.exe" >nul
if %errorlevel%==0 echo  [RUNNING] Scraper is still active.
if not %errorlevel%==0 echo  [STOPPED] No scraper process found - it may be done or closed.
if exist "D:\MANGA MANHUA WEBSITE\YOMIKAZE\public\scraped.json" node -e "const d=require('D:/MANGA MANHUA WEBSITE/YOMIKAZE/public/scraped.json'); console.log('  Library now: Titles: ' + d.items.length + ' | Chapters: ' + d.total_chapters + ' | Pages: ' + d.total_pages);"
pause
goto menu

:godslayer
echo.
echo  Scraping All-Class Awakening: God Slayer...
"%PY%" logrun.py "logs\godslayer.log" -- "%PY%" legacy/mangafire_all_chapters.py "https://mangafire.to/title/ro8ro-all-class-awakening-god-slayer" --output "D:\MANGA MANHUA WEBSITE\scraper\_godslayer_new.json" --proxy-file "D:\MANGA MANHUA WEBSITE\proxy_checker\working_proxies.txt"
if errorlevel 1 (
    echo  [FAIL] God Slayer scrape failed.
    pause
    goto menu
)
node legacy/merge-scraped.mjs "_godslayer_new.json"
if errorlevel 1 (
    echo  [FAIL] Merge failed.
    pause
    goto menu
)
del /q "_godslayer_new.json" >nul 2>&1
echo  [done] God Slayer updated - Solo Leveling and others kept.
pause
goto menu

:website
echo.
curl -s -o nul http://localhost:5173
if %errorlevel%==0 goto webopen
echo  Starting the dev server (first time can take ~10s)...
start "YOMIKAZE server" cmd /k "cd /d D:\MANGA MANHUA WEBSITE\YOMIKAZE && npm run dev"
ping -n 7 127.0.0.1 >nul
:webopen
start "" http://localhost:5173
echo  [done] Website opened in your browser.
cd /d "D:\MANGA MANHUA WEBSITE\scraper"
pause
goto menu

:update
echo.
set /p UPDCH=  Chapters per title?  [all | latest-20] (default latest-20): 
if "%UPDCH%"=="" set UPDCH=latest-20
echo.
echo  Refreshing all titles in the library (%UPDCH% chapters each)...
"%PY%" logrun.py "logs\update.log" -- "%PY%" mangafire_catalog.py --update --limit 100 --chapters %UPDCH% --proxy-file "D:\MANGA MANHUA WEBSITE\proxy_checker\working_proxies.txt"
pause
goto menu

:search
echo.
set /p KEYWORD=  Type a title name to search (e.g. One Punch Man): 
if not "%KEYWORD%"=="" goto search_ok
echo  Nothing typed - back to menu.
pause
goto menu
:search_ok
echo.
echo  Searching mangafire for: %KEYWORD%
"%PY%" logrun.py "logs\search.log" -- "%PY%" pick_titles.py --search "%KEYWORD%" --proxy-file "D:\MANGA MANHUA WEBSITE\proxy_checker\working_proxies.txt"
pause
goto menu
