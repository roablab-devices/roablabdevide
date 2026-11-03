@echo off
title Cai dat Tu dong chay Bot Zalo tren Windows
cd /d "%~dp0"

echo Dang cai dat tu dong chay cung Windows...
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Startup') + '\ZaloBotLab.lnk'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"' + (Get-Location).Path + '\start_silent.vbs\"'; $s.WorkingDirectory = (Get-Location).Path; $s.Save()"

if %errorlevel% equ 0 (
    echo.
    echo ========================================================
    echo  [THANH CONG] Da cai dat xong!
    echo  Tu nay moi khi ban bat may vao Windows, Bot Zalo se
    echo  tu dong chay ngam duoi nen (khong hien cua so den).
    echo ========================================================
) else (
    echo [LOI] Khong the tao phim tat Startup.
)
echo.
pause
