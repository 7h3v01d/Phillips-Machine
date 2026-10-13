@echo off
rem SPDX-License-Identifier: Apache-2.0
rem Engine tests (Node 18+), then browser smoke tests (Python + Playwright) when installed.
cd /d "%~dp0"
node --test
if errorlevel 1 exit /b 1
python -c "import playwright, pytest" 2>nul
if errorlevel 1 (
  echo Browser smoke tests skipped. To enable:
  echo   python -m pip install -r tests\browser\requirements.txt
  echo   python -m playwright install chromium
  exit /b 0
)
python -m pytest tests\browser -q
