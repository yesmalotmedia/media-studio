@echo off
chcp 65001 >nul
echo Starting Shiur Studio...
start "" http://localhost:3000
call npm run dev
