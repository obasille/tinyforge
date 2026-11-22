@echo off
rem Link apps\classic\assets to the shared assets\ folder at the repo root, so
rem static servers rooted at apps\classic (VS Code Live Server) find
rem ./assets/... like the deployed site does.
rem
rem It creates a directory junction (mklink /J), which needs no admin rights
rem and no Developer Mode. Safe to run more than once.

setlocal
set "ROOT=%~dp0.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"
set "TARGET=%ROOT%\assets"
set "LINK=%ROOT%\apps\classic\assets"

if not exist "%TARGET%\" (
  echo Shared assets folder not found: "%TARGET%"
  exit /b 1
)

if exist "%LINK%\" (
  echo "%LINK%" already exists, nothing to do.
  exit /b 0
)

mklink /J "%LINK%" "%TARGET%"
if errorlevel 1 (
  echo Failed to create the junction.
  exit /b 1
)
echo Done. Live Server can now serve apps\classic with its assets.
