@echo off
chcp 65001 >nul
title 比宝的手（关掉这个窗口就停）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0hands-server.ps1"
pause
