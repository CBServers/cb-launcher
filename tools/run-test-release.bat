@echo off
setlocal
set SRC_DIR=%~dp0..\src\launcher-ui
set DEST_DIR=%LOCALAPPDATA%\cbservers\data\launcher-ui
set EXE=%~dp0..\build\bin\x64\Release\cb-launcher.exe

if not exist "%DEST_DIR%" mkdir "%DEST_DIR%"
xcopy /E /Y /I "%SRC_DIR%" "%DEST_DIR%"

start %EXE% -noupdate