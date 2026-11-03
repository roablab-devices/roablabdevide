@echo off
title Zalo Bot Lab - Windows
cd /d "%~dp0"

echo ========================================================
echo   KHOI DONG ZALO BOT LAB (WINDOWS)
echo ========================================================
echo.

node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [LOI] Khong tim thay Node.js! Vui long cai dat Node.js tai https://nodejs.org
    pause
    exit /b
)

if not exist node_modules (
    echo [INFO] Dang cai dat thu vien can thiet...
    npm install
)

echo [INFO] Dang chay bot...
node index.js

pause
