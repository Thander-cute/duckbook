@echo off
rem Opens duckbook. Starts its small local server in the background if it is not running yet.
rem   Duckbook.cmd --stop       stop the background server
rem   Duckbook.cmd --shortcut   add a Duckbook shortcut to the desktop
cd /d "%~dp0"
where node >nul 2>nul || (echo duckbook needs Node.js 24 or newer: https://nodejs.org & pause & exit /b 1)
node scripts\launch.ts %*
if errorlevel 1 pause
