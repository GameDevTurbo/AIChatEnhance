@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ========================================
echo  Task Planner - 一键打包 .vsix
echo ========================================
echo.

:: 可选版本参数: package.bat 0.2.0
set "VERSION=%~1"

:: Step 1: 编译 TypeScript
echo [1/3] 编译 TypeScript ...
call npx tsc -p .
if %errorlevel% neq 0 (
    echo [FAIL] TypeScript 编译失败，中止打包。
    goto :fail
)
echo [OK] 编译成功。
echo.

:: Step 2: 运行测试
echo [2/3] 运行测试 ...
call node test/test-pure.js
if %errorlevel% neq 0 (
    echo [FAIL] test-pure 测试失败，中止打包。
    goto :fail
)
call node test/integration.js
if %errorlevel% neq 0 (
    echo [FAIL] integration 测试失败，中止打包。
    goto :fail
)
call node test/integration-extra.js
if %errorlevel% neq 0 (
    echo [FAIL] integration-extra 测试失败，中止打包。
    goto :fail
)
echo [OK] 所有测试通过。
echo.

:: Step 3: 打包 .vsix
echo [3/3] 生成 .vsix 包 ...
if not exist dist mkdir dist

if defined VERSION (
    echo      使用指定版本: %VERSION%
    call npx vsce package %VERSION% -o dist\
) else (
    call npx vsce package -o dist\
)
if %errorlevel% neq 0 (
    echo [FAIL] vsce package 失败。
    goto :fail
)

echo.
echo ========================================
echo  [OK] 打包完成！ .vsix 文件已输出到 dist\ 目录
echo.
dir /b dist\*.vsix 2>nul
echo.
echo  安装方式:
echo    VS Code: 扩展面板 -^> ... -^> 从 VSIX 安装
echo    命令行:  code --install-extension dist\task-planner-*.vsix
echo ========================================
goto :end

:fail
echo.
echo ========================================
echo  [FAIL] 打包流程中止，请检查上方错误信息。
echo ========================================

:end
endlocal
pause
