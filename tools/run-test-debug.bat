@echo off
setlocal
set SRC_DIR=%~dp0..\src\launcher-ui
set DEST_DIR=%LOCALAPPDATA%\cbservers_debug\data\launcher-ui
set EXE=%~dp0..\build\bin\x64\Debug\cb-launcher.exe

echo Copying launcher-ui to %DEST_DIR%...
if not exist "%DEST_DIR%" mkdir "%DEST_DIR%"
xcopy /E /Y /I "%SRC_DIR%" "%DEST_DIR%"

start %EXE% -noupdate