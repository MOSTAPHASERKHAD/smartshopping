@echo off
echo === Smart Kiosk Deploy ===
cd /d "%~dp0"
git add -A
git commit -m "update: %date% %time%"
git push origin main
echo.
echo === Done! GitHub Pages will update in ~1 min ===
pause
