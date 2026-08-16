@echo off
rem Open a visible cmd window that runs a Python scraper live,
rem logs to scraper\logs\<name>.log, and pauses when done.
title YOMIKAZE SCRAPER - %~1
cd /d D:\MANGA MANHUA WEBSITE\scraper
if not exist logs mkdir logs
set "TS=%date:~10,4%%date:~4,2%%date:~7,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
set "TS=%TS: =0%"
call "D:\MANGA MANHUA WEBSITE\scraper\venv\Scripts\python.exe" logrun.py "D:\MANGA MANHUA WEBSITE\scraper\logs\%~1_%TS%.log" -- "D:\MANGA MANHUA WEBSITE\scraper\venv\Scripts\python.exe" %2 %3 %4 %5 %6 %7 %8 %9
echo.
echo ==== DONE - check the log above ====
pause
