@echo off
rem PONTE LOCAL - inicia o agente no Windows com log em ARQUIVO.
rem Por que assim: clique acidental dentro do console (QuickEdit) congela o
rem stdout de processos de console e trava o node "com a janela normal".
rem Com a saida indo para ponte-agent.log, o node nunca escreve no console
rem e o clique nao tem efeito sobre ele.
title ponte-agente
cd /d "%~dp0"
rem Cinto e suspendor: desliga o QuickEdit para consoles NOVOS desta maquina.
rem (Consoles ja abertos precisam ser fechados e reabertos.)
reg add "HKCU\Console" /v QuickEdit /t REG_DWORD /d 0 /f >nul 2>nul
where node >nul 2>nul
if errorlevel 1 (
  echo [ponte] Node.js nao encontrado no PATH. Instale o LTS em https://nodejs.org e rode de novo.
  pause
  exit /b 1
)
if not exist agent.js (
  echo [ponte] agent.js nao esta nesta pasta (%CD%^). Extraia o pacote ponte-agent aqui.
  pause
  exit /b 1
)
if not exist ponte.config.json (
  echo [ponte] Primeira vez? Configure uma vez no PowerShell, dentro desta pasta:
  echo [ponte]   node agent.js --server URL-DO-RELAY --token SEU-TOKEN --save
  echo [ponte] Depois rode este rodar.bat de novo. Veja o LEIA-ME.md.
  pause
  exit /b 1
)
echo [ponte] agente iniciando. Log: %CD%\ponte-agent.log
echo [ponte] Pode minimizar esta janela. Para encerrar o agente, feche-a ou use Ctrl+C.
node agent.js >> ponte-agent.log 2>&1
echo.
echo [ponte] agente encerrou em %date% %time%. Ultimas linhas do log:
powershell -NoProfile -Command "Get-Content -Path 'ponte-agent.log' -Tail 15"
pause
