@echo off
title Livret scolaire unique
cd /d "%~dp0"
if not exist node_modules (
  echo Installation des dependances...
  call npm install
)
start "" http://localhost:4321
node server/index.js
pause
