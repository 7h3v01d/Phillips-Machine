@echo off
rem SPDX-License-Identifier: Apache-2.0
rem Run the headless simulation tests (needs Node.js 18 or newer).
cd /d "%~dp0"
node --test
