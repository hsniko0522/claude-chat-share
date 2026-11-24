@echo off
chcp 65001 >nul
rem chat-share: run setup-double-click.ps1 without changing the system execution policy, and keep the window open.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-double-click.ps1"
echo.
echo Done. Press any key to close this window.
pause >nul
