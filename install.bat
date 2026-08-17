@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Portfolio - Installer

set "REPO_ZIP=https://github.com/FactorScreener/portfolio/archive/refs/heads/master.zip"
set "APP_URL=http://localhost:8787"

echo.
echo  ============================================================
echo    Portfolio installer
echo.
echo    This runs a one-time setup on your computer:
echo      1. Install Bun - the free engine that runs the app
echo      2. Download the app to your Downloads folder
echo      3. Build it
echo      4. Start it and open your browser
echo.
echo    Nothing is uploaded anywhere. Your data stays on this PC.
echo  ============================================================
echo.

rem ---- 1. Bun -----------------------------------------------------------
set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
if exist "%BUN%" goto :bun_ok
where bun >nul 2>nul
if not errorlevel 1 (
  set "BUN=bun"
  goto :bun_ok
)
echo  [1/5] Bun is not installed. Installing it now...
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
if errorlevel 1 goto :bun_failed
if not exist "%BUN%" goto :bun_failed
echo  Done.
goto :bun_ok

:bun_failed
echo.
echo  Bun did not finish installing. You can install it yourself from
echo  https://bun.sh and then run this installer again.
echo.
pause
exit /b 1

:bun_ok
echo.
echo  [1/5] Bun is ready.

rem ---- 2. Where to install ----------------------------------------------
set "DEFAULT_DIR=%USERPROFILE%\Downloads"
set "APP_DIR="
echo.
echo  [2/5] Where should the app be saved?
set /p "APP_DIR=Press Enter for %DEFAULT_DIR%, or type another folder: "
if not defined APP_DIR set "APP_DIR=%DEFAULT_DIR%"
set "APP_DIR=!APP_DIR:"=!"
if not exist "!APP_DIR!" (
  echo  Creating folder: !APP_DIR!
  mkdir "!APP_DIR!" >nul 2>nul
)
if not exist "!APP_DIR!" (
  echo  Could not create "!APP_DIR!". Please try again with a different folder.
  pause
  exit /b 1
)

rem ---- 3. Download ------------------------------------------------------
echo.
echo  [3/5] Downloading the app from GitHub...
set "ZIP=!APP_DIR!\portfolio-master.zip"
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%REPO_ZIP%' -OutFile '%ZIP%' -UseBasicParsing"
if errorlevel 1 (
  echo.
  echo  Download failed. Check your internet connection and try again.
  pause
  exit /b 1
)

rem ---- 4. Unpack --------------------------------------------------------
echo.
echo  [4/5] Unpacking the app...
set "APP_PATH=!APP_DIR!\FactorScreener.com Portfolio"
set "UNPACKED=!APP_DIR!\portfolio-master"
set "OLD_DB=!APP_PATH!\data\portfolio.sqlite"
set "DB_BACKUP=%TEMP%\portfolio-sqlite-backup"
if exist "!OLD_DB!" copy /y "!OLD_DB!" "%DB_BACKUP%" >nul
if exist "!APP_PATH!" (
  echo  Replacing an older copy in: !APP_PATH!
  rmdir /s /q "!APP_PATH!"
)
if exist "!UNPACKED!" rmdir /s /q "!UNPACKED!"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%ZIP%' -DestinationPath '!APP_DIR!' -Force"
if errorlevel 1 (
  echo.
  echo  Could not unpack the download. Please run this installer again.
  pause
  exit /b 1
)
del "!ZIP!" >nul 2>nul
move "!UNPACKED!" "!APP_PATH!" >nul
if exist "%DB_BACKUP%" (
  if not exist "!APP_PATH!\data" mkdir "!APP_PATH!\data"
  copy /y "%DB_BACKUP%" "!APP_PATH!\data\portfolio.sqlite" >nul
  del "%DB_BACKUP%" >nul
  echo  Kept your saved settings from the previous install.
)

rem ---- 5. Build ---------------------------------------------------------
echo.
echo  [5/5] Installing packages and building. First run takes a minute...
cd /d "!APP_PATH!"
"%BUN%" install
if errorlevel 1 goto :build_failed
"%BUN%" run build
if errorlevel 1 goto :build_failed

rem ---- Start now --------------------------------------------------------
echo.
echo  ============================================================
echo    Setup complete. Starting the app now...
echo.
echo    A minimized "Portfolio server" window keeps the app
echo    running. Close it when you are done.
echo.
echo    Your browser should open at %APP_URL% shortly.
echo.
echo    NEXT TIME, double-click this installer again - it updates
echo    the app to the latest version and starts it.
echo  ============================================================
echo.
start "Portfolio server" /min "%BUN%" start
timeout /t 3 /nobreak >nul
start "" "%APP_URL%"
echo  All done. Enjoy!
echo.
pause
exit /b 0

:build_failed
echo.
echo  The build step failed. You can retry by opening a terminal in
echo  "!APP_PATH!" and typing:
echo      bun install
echo      bun run build
echo      bun start
echo.
pause
exit /b 1
