@echo off
chcp 65001 >nul
echo Starting Shiur Studio...
start "" http://localhost:3001
call npm run dev
