@echo off
rem ============================================================
rem  run_asura_visible.bat - launch AsuraScans scrape in a visible
rem  cmd window via run_visible.bat (logrun.py live output + log).
rem  The quoting is done HERE (inside a .bat) so paths with spaces
rem  never split:  "D:\MANGA MANHUA WEBSITE\..." MUST stay quoted.
rem ============================================================
call "D:\MANGA MANHUA WEBSITE\scraper\run_visible.bat" asurascans "D:\MANGA MANHUA WEBSITE\scraper\asurascans_scraper.py" --limit 25
