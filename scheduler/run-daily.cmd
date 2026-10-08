@echo off
REM Run by Windows Task Scheduler daily. Double-click to run manually.
chcp 65001 >nul
cd /d "%~dp0.."
if not exist logs mkdir logs
echo ===== %date% %time% ===== >> logs\scheduler.log
node runner\run.js %* >> logs\scheduler.log 2>&1
echo exit code %errorlevel% >> logs\scheduler.log
