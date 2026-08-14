@echo off
rem dsh-LorebookMD installer launcher (forwards to install.ps1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
exit /b %ERRORLEVEL%
