@echo off
rem SPDX-License-Identifier: Apache-2.0
rem Serve the simulation at http://localhost:8000 (you can also just double-click src\index.html).
cd /d "%~dp0"
echo Phillips Machine running at http://localhost:8000  (Ctrl+C to stop)
start "" http://localhost:8000
python -m http.server 8000 --directory src
