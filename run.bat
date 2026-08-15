@echo off
rem ============================================
rem  AI Tag Recorder - one-click tools
rem  Usage: run.bat [dev|build|package|install|smoke]
rem  Double-click for interactive menu
rem ============================================
setlocal
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
title AI Tag Recorder Tools

if "%~1"=="" goto menu
if /i "%~1"=="dev" goto dev
if /i "%~1"=="build" goto build
if /i "%~1"=="package" goto package
if /i "%~1"=="install" goto install
if /i "%~1"=="smoke" goto smoke
echo Unknown command: %~1
goto end

:menu
echo.
echo  ============================================
echo    AI Tag Recorder - One-Click Tools
echo  ============================================
echo    1. Install dependencies
echo    2. Dev test  (hot reload + devtools)
echo    3. Build     (renderer + main process)
echo    4. Package   (portable exe)
echo    5. Smoke test (data layer)
echo  ============================================
echo.
set /p c="  Select [1-5]: "
if "%c%"=="1" goto install
if "%c%"=="2" goto dev
if "%c%"=="3" goto build
if "%c%"=="4" goto package
if "%c%"=="5" goto smoke
goto end

:install
echo.
echo  === [install] npm install ===
call npm install --no-audit --no-fund
goto end

:dev
echo.
echo  === [dev] vite + electron ===
call node scripts/dev.js
goto end

:build
echo.
echo  === [build] vite build + copy main/preload ===
call node scripts/build.js
goto end

:package
echo.
echo  === [package] build + electron-builder ===
call node scripts/build.js
if errorlevel 1 goto end
call npx electron-builder --win
goto end

:smoke
echo.
echo  === [smoke] electron data-layer test ===
call node_modules\electron\dist\electron.exe . --smoke
if errorlevel 1 (
  echo  SMOKE TEST FAILED
) else (
  echo  SMOKE TEST PASSED
)
goto end

:end
echo.
pause
endlocal
