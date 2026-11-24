@echo off
cd /d "%~dp0"
set PATH=D:\DevTools\nodejs;%PATH%
if not exist "logs" mkdir logs
node src\scripts\runOrderbookStream.js >> logs\orderbook_stream.log 2>&1
