@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js first: https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run: installing dependencies, please wait...
  call npm install
)
echo Starting Scheduled Agent...
call npm start
