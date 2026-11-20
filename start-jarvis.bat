@echo off
REM JARVIS one-click dev launcher: backend + frontend.
title JARVIS launcher

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "PYTHON=%BACKEND%\.venv\Scripts\python.exe"

if not exist "%PYTHON%" (
  echo [jarvis] backend venv missing - creating it once...
  python -m venv "%BACKEND%\.venv"
  "%BACKEND%\.venv\Scripts\python.exe" -m pip install -r "%BACKEND%\requirements.txt"
)

if not exist "%BACKEND%\.env" (
  echo [jarvis] backend .env missing - copying example...
  copy "%BACKEND%\.env.example" "%BACKEND%\.env" >nul
  echo [jarvis] ADD YOUR OPENROUTER KEY TO backend\.env
)

echo [jarvis] starting backend on http://127.0.0.1:8420 ...
start "JARVIS backend" /D "%BACKEND%" "%PYTHON%" main.py

echo [jarvis] starting frontend on http://localhost:1420 ...
cd /d "%ROOT%"
call npm run dev
