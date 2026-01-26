@echo off
setlocal
set SRC_DIR=%~dp0..\src\launcher-ui

set DEST_DIR=%LOCALAPPDATA%\cbservers_debug\data\launcher-ui

echo Copying launcher-ui to %DEST_DIR%...
if not exist "%DEST_DIR%" mkdir "%DEST_DIR%"
xcopy /E /Y /I "%SRC_DIR%" "%DEST_DIR%"

set DEST_DIR=%LOCALAPPDATA%\cbservers\data\launcher-ui

echo Copying launcher-ui to %DEST_DIR%...
if not exist "%DEST_DIR%" mkdir "%DEST_DIR%"
xcopy /E /Y /I "%SRC_DIR%" "%DEST_DIR%"
echo Done.
