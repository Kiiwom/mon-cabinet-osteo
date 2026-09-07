@echo off
setlocal
set "CABINET_PYTHON=python"
if exist "%~dp0.venv\Scripts\python.exe" set "CABINET_PYTHON=%~dp0.venv\Scripts\python.exe"
"%CABINET_PYTHON%" "%~dp0lancer.py" --demo %*
if errorlevel 1 pause
