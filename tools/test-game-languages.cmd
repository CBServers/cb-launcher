@echo off
setlocal
cd /d "%~dp0.."

rem A Developer Command Prompt already supplies cl. Otherwise locate Build Tools
rem or Visual Studio without assuming a drive, version, or installation folder.
where cl >nul 2>nul
if errorlevel 1 (
    set "CB_LANGUAGE_VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
    if not exist "%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" (
        echo Visual Studio C++ Build Tools are required. Run from a Developer Command Prompt.
        exit /b 1
    )
    for /f "usebackq tokens=*" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "CB_LANGUAGE_VS=%%i"
    if not defined CB_LANGUAGE_VS (
        echo No installed Visual Studio x64 C++ toolset was found.
        exit /b 1
    )
    call "%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find Common7\Tools\VsDevCmd.bat >build-language-vsdev.tmp
    for /f "usebackq tokens=*" %%i in ("build-language-vsdev.tmp") do call "%%i" -arch=x64 -host_arch=x64 >nul
    del /q build-language-vsdev.tmp
)
where cl >nul 2>nul
if errorlevel 1 exit /b 1
if not exist "build\bin\x64\Release\libtomcrypt.lib" (
    echo Build the x64 Release solution first, including its dependencies.
    exit /b 1
)
if not exist "build\language-tests" mkdir "build\language-tests"
cl /nologo /std:c++20 /EHsc /MT /W4 /WX /DCB_LANGUAGE_TESTS /DNOMINMAX /DWRAPPING_CEF_SHARED /DUSING_CEF_SHARED /DLTC_NO_FAST /DLTC_NO_PROTOTYPES /DLTC_NO_RSA_BLINDING /DLTC_NO_FILE /DARGTYPE=4 /Isrc/launcher /Isrc/common /Ideps/cef /Ideps/curl/include /Ideps/rapidjson/include /Ideps/libtomcrypt/src/headers /Ideps/libtommath /Ibuild/src src/launcher/languages/game_languages_tests.cpp build/bin/x64/Release/libtomcrypt.lib build/bin/x64/Release/libtommath.lib /Fe:build/language-tests/game-language-fixtures.exe /Fo:build/language-tests/game-language-fixtures.obj /link /OPT:REF /LTCG
if errorlevel 1 exit /b %errorlevel%
"build\language-tests\game-language-fixtures.exe"
exit /b %errorlevel%
