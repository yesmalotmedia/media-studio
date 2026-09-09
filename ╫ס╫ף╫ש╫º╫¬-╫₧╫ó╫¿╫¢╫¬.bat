@echo off
chcp 65001 >nul
echo == Checking Node and ffmpeg ==
where node >nul 2>&1 && (node -v) || echo [MISSING] Node.js - install from nodejs.org
where ffmpeg >nul 2>&1 && (ffmpeg -version ^| findstr /B "ffmpeg") || echo [MISSING] ffmpeg - add to PATH
where ffprobe >nul 2>&1 && echo ffprobe OK || echo [MISSING] ffprobe - add to PATH
pause
