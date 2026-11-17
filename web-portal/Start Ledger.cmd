@echo off
setlocal
cd /d "%~dp0"
set "LEDGER_NODE=node"
where node >nul 2>&1
if errorlevel 1 set "LEDGER_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not "%LEDGER_NODE%"=="node" if not exist "%LEDGER_NODE%" goto missing
"%LEDGER_NODE%" -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if errorlevel 1 goto missing
"%LEDGER_NODE%" server.mjs --open %*
if errorlevel 1 pause
exit /b
:missing
echo Party Ledger needs Node.js 24 or newer. Install Node.js 24 LTS from https://nodejs.org/ then open this file again.
pause
