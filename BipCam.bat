@echo off
setlocal EnableExtensions
title BipCam
cd /d "%~dp0"

rem ==========================================================================
rem  BipCam launcher
rem    first run : installs Node.js / .NET SDK if missing, then runs npm install
rem    every run : npm run build:vcam  ->  npm run dev
rem  To force the first-time setup again, delete  node_modules\.bipcam-ready
rem ==========================================================================

set "MARKER=node_modules\.bipcam-ready"

if not exist "%MARKER%" goto :setup
rem package.json changed since the last setup (new dependencies)? then set up again.
powershell -NoProfile -Command "if ((Get-Item 'package.json').LastWriteTime -gt (Get-Item '%MARKER%').LastWriteTime) { exit 1 } else { exit 0 }" >nul 2>nul
if errorlevel 1 goto :setup
goto :run

:setup
echo.
echo ============================================================
echo   BipCam - first-time setup (this only happens once)
echo ============================================================
echo.

call :ensure node "OpenJS.NodeJS.LTS" "Node.js 20 or newer"
if errorlevel 1 goto :fail
for /f "usebackq delims=" %%V in (`node -p "process.versions.node.split('.')[0]"`) do set "NODEMAJOR=%%V"
if %NODEMAJOR% LSS 20 (
  echo Node.js %NODEMAJOR% is too old, BipCam needs Node.js 20 or newer. Installing the current LTS...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  call :refreshpath
)

call :ensure dotnet "Microsoft.DotNet.SDK.10" ".NET 10 SDK"
if errorlevel 1 goto :fail
for /f "tokens=1 delims=." %%V in ('dotnet --version') do set "DNMAJOR=%%V"
if %DNMAJOR% LSS 10 (
  echo .NET SDK %DNMAJOR% found, BipCam needs the .NET 10 SDK. Installing it...
  winget install -e --id Microsoft.DotNet.SDK.10 --accept-source-agreements --accept-package-agreements
  call :refreshpath
)

echo.
echo Installing BipCam dependencies (npm install)...
call npm install
if errorlevel 1 goto :fail

echo ready> "%MARKER%"
echo.
echo Setup finished.

:run
echo.
echo ============================================================
echo   Building the Windows virtual camera (npm run build:vcam)
echo ============================================================
call npm run build:vcam
if errorlevel 1 (
  echo.
  echo WARNING: the virtual camera build failed. BipCam will still start,
  echo          but the Windows virtual camera may be missing or out of date.
  echo.
)

echo.
echo ============================================================
echo   Starting BipCam (npm run dev)
echo ============================================================
call npm run dev
if errorlevel 1 pause
exit /b 0

rem --------------------------------------------------------------------------
:ensure
rem  %1 = command to look for, %2 = winget package id, %3 = friendly name
where %1 >nul 2>nul
if not errorlevel 1 exit /b 0
echo %~3 was not found. Installing it with winget...
where winget >nul 2>nul
if errorlevel 1 (
  echo winget is not available on this PC. Please install %~3 manually and run BipCam.bat again.
  exit /b 1
)
winget install -e --id %~2 --accept-source-agreements --accept-package-agreements
call :refreshpath
where %1 >nul 2>nul
if errorlevel 1 (
  echo %~3 was installed but is not visible yet. Please close this window and run BipCam.bat again.
  exit /b 1
)
exit /b 0

:refreshpath
rem  Pick up PATH changes made by installers without needing a new window.
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')"`) do set "PATH=%%P"
exit /b 0

:fail
echo.
echo Setup did not finish. Fix the problem above and run BipCam.bat again.
pause
exit /b 1
