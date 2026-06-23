@echo off
echo Iniciando bot de Madapan...
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" node_modules\ts-node\dist\bin.js --transpile-only src/index.ts
pause
