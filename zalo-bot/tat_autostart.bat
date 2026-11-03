@echo off
title Huy bo Tu dong chay Bot Zalo tren Windows
powershell -Command "Remove-Item -Path ([Environment]::GetFolderPath('Startup') + '\ZaloBotLab.lnk') -ErrorAction SilentlyContinue"

echo ========================================================
echo  [DA XOA] Da huy bo tinh nang tu dong khoi dong tren Windows!
echo ========================================================
pause
