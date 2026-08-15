@echo off
title YOMIKAZE Relay
cd /d "%~dp0"

echo ============================================================
echo  YOMIKAZE - Local relay (working chapter images)
echo ============================================================
echo.
echo  Step 1: Building site (mangafire provider)...
setlocal
set VITE_CONTENT_PROVIDER=mangafire
call npm run build
if errorlevel 1 (
  echo Build failed. Check the errors above.
  pause
  exit /b 1
)

echo.
echo  Step 2: Starting site server on port 4173...
start "YOMIKAZE Server" cmd /k "cd /d %~dp0 && npm run preview"
timeout /t 6 /nobreak >nul

echo  Step 3: Opening public tunnel...
start "YOMIKAZE Tunnel" cmd /k ""%~dp0.tools\cloudflared.exe" tunnel --url http://localhost:4173 --no-autoupdate"

echo.
echo  DONE! The public URL is in the "YOMIKAZE Tunnel" window
echo  (look for https://....trycloudflare.com)
echo.
echo  IMPORTANT: Keep BOTH windows open while using the site.
echo  Close them to stop. The URL changes every time you restart.
echo.
pause
