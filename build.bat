@echo off
cd /d "%~dp0"
call npx tsc -p .
if %errorlevel% equ 0 (
    echo [OK] Build succeeded.
) else (
    echo [FAIL] Build failed.
)
pause
