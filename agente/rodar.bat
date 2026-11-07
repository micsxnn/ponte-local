@echo off
rem PONTE LOCAL - inicia o agente no Windows com log em ARQUIVO.
rem Por que assim: clique acidental dentro do console (QuickEdit) congela o
rem stdout de processos de console e trava o node "com a janela normal".
rem Com a saida indo para ponte-agent.log, o node nunca escreve no console
rem e o clique nao tem efeito sobre ele.
rem
rem Funciona nas duas formas de instalacao:
rem  - manual: agent.js nesta pasta (usa "node agent.js")
rem  - npx:    usa "npx ponte-local" (baixa o pacote na hora)
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

rem pasta de DADOS do usuario (config, log, relatorio, skill) - a mesma que
rem o agente usa; fora do pacote, porque o cache do npx e efemero
if "%PONTE_HOME%"=="" (
  set "DATA_DIR=%USERPROFILE%\ponte-agent"
) else (
  set "DATA_DIR=%PONTE_HOME%"
)
set "CONFIG=%DATA_DIR%\ponte.config.json"

rem o executavel: agent.js local se existir, senao npx
if exist agent.js (
  set "AGENTE=node agent.js"
) else (
  set "AGENTE=npx --yes ponte-local"
)

if not exist "%CONFIG%" (
  echo [ponte] Primeira vez? Configure uma vez:
  echo [ponte]   npx ponte-local --server URL-DO-RELAY --token SEU-TOKEN --save
  echo [ponte] Depois rode este rodar.bat de novo. Veja o LEIA-ME.md.
  pause
  exit /b 1
)
echo [ponte] agente iniciando. Log: %DATA_DIR%\ponte-agent.log
echo [ponte] Pode minimizar esta janela. Para encerrar o agente, feche-a ou use Ctrl+C.
%AGENTE% >> "%DATA_DIR%\ponte-agent.log" 2>&1
echo.
echo [ponte] agente encerrou em %date% %time%. Ultimas linhas do log:
powershell -NoProfile -Command "Get-Content -Path '%DATA_DIR%\ponte-agent.log' -Tail 15"
pause
