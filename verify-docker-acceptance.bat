@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\docker-local.ps1" -Action Verify -Acceptance %*
set "result=%errorlevel%"
if not "%result%"=="0" echo Acceptance verification failed. See the message above.
if /I not "%PASSENGER_NO_PAUSE%"=="1" pause
exit /b %result%
