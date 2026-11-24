@echo off
cd /d "%~dp0"
set PATH=D:\DevTools\nodejs;%PATH%
if not exist "logs" mkdir logs
node src\scripts\runDailyBroksum.js >> logs\daily_broksum.log 2>&1
