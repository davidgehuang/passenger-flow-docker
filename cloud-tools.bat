@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\cloud\cloud-tools.ps1" %*
set "result=%errorlevel%"
if "%~1"=="" pause
exit /b %result%
