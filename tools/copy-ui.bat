@echo off
setlocal

if "%1"=="" (
    echo Usage: copy-ui.bat [Debug^|Release]
    exit /b 1
)

set CONFIG=%1
set SRC_DIR=%~dp0..\src\launcher-ui

if /i "%CONFIG%"=="Debug" (
    set DEST_DIR=%LOCALAPPDATA%\cbservers_debug\data\launcher-ui
) else if /i "%CONFIG%"=="Release" (
    set DEST_DIR=%LOCALAPPDATA%\cbservers\data\launcher-ui
) else (
    echo Invalid configuration: %CONFIG%
    echo Use Debug or Release
    exit /b 1
)

echo Copying launcher-ui to %DEST_DIR%...
if not exist "%DEST_DIR%" mkdir "%DEST_DIR%"
xcopy /E /Y /I "%SRC_DIR%" "%DEST_DIR%"
echo Done.
