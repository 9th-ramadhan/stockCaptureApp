@echo off
cd /d "%~dp0"
set PATH=D:\DevTools\nodejs;%PATH%
if not exist "logs" mkdir logs
node src\scripts\runDailyCapture.js >> logs\task_scheduler.log 2>&1
