@echo off
cd /d "%~dp0"
set "PYTHONIOENCODING=utf-8"
backend\.venv\Scripts\python.exe backend\main.py
