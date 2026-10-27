@echo off
rem PONTE LOCAL - vigia o agente e RELIGA sozinho se ele morrer.
rem Deixe esta janela aberta (pode minimizar). Ela roda para sempre.
rem Nota: isso cobre o agente MORTO. Contra o congelamento por clique no
rem console, o proprio rodar.bat ja protege (log em arquivo + QuickEdit off).
title ponte-watchdog
cd /d "%~dp0"
set INTERVALO=30
echo [watchdog] Vigia o agente a cada %INTERVALO%s. Deixe esta janela aberta.
:loop
timeout /t %INTERVALO% /nobreak >nul
powershell -NoProfile -Command "if (Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*agent.js*' }) { exit 0 } else { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo [watchdog] %date% %time% - agente NAO esta rodando. Religando...
  start "ponte-agente" /MIN cmd /c rodar.bat
) else (
  echo [watchdog] %date% %time% - agente rodando.
)
goto loop
