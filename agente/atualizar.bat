@echo off
rem PONTE LOCAL - atualiza o agent.js COM VALIDACAO e backup (Windows)
rem Equivalente ao atualizar.sh do Linux/macOS.
rem
rem   bat atualizar.bat [URL-DO-RELAY]
rem Sem argumento, usa o server salvo no ponte.config.json local.
rem
rem Baixa o agent.js, valida com "node --check" e so entao substitui.
rem O download vem do relay (/api/ponte/download) ou, se voce preferir,
rem do repo: https://raw.githubusercontent.com/micsxnn/ponte-local/main/agente/agent.js
setlocal enabledelayedexpansion

set "DIR=%~dp0"
if "%DIR:~-1%"=="\" set "DIR=%DIR:~0,-1%"

rem ---- a pasta de DADOS (config, log, agent.js) -------------------------
if "%PONTE_HOME%"=="" (
  set "DATA_DIR=%USERPROFILE%\ponte-agent"
) else (
  set "DATA_DIR=%PONTE_HOME%"
)

set "SRC=%~1"
if "%SRC%"=="" (
  if exist "%DATA_DIR%\ponte.config.json" (
    for /f "usebackq delims=" %%L in (`node -e "try{console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).server||'')}catch(e){}" "%DATA_DIR%\ponte.config.json"`) do set "SRC=%%L"
  )
)
if "%SRC%"=="" (
  echo [x] uso: atualizar.bat URL-DO-RELAY ^(ex.: https://seu-relay^)
  echo     ou use o npx: npx ponte-local update
  exit /b 1
)
set "SRC=%SRC:/=%"

where node >nul 2>nul
if errorlevel 1 (
  echo [x] Node.js nao encontrado no PATH. Instale o LTS em https://nodejs.org
  exit /b 1
)

rem ---- onde esta o agent.js ---------------------------------------------
set "DEST="
if exist "%DIR%\agent.js" set "DEST=%DIR%"
if not defined DEST if exist "%DATA_DIR%\agent.js" set "DEST=%DATA_DIR%"
if not defined DEST (
  echo [x] agent.js nao encontrado ^(nem em %DIR% nem em %DATA_DIR%^)
  exit /b 1
)

set "TMP=%DATA_DIR%\agent.js.download"
echo [*] baixando agente de: %SRC%/api/ponte/download
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri '%SRC%/api/ponte/download' -OutFile '%TMP%' -UseBasicParsing -TimeoutSec 60 } catch { try { Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/micsxnn/ponte-local/main/agente/agent.js' -OutFile '%TMP%' -UseBasicParsing -TimeoutSec 60 } catch { exit 1 } }"
if errorlevel 1 (
  echo [x] download falhou - versao atual INTACTA
  del "%TMP%" >nul 2>nul
  exit /b 1
)

node --check "%TMP%"
if errorlevel 1 (
  echo [x] agent.js baixado e invalido ^(node --check falhou^) - NADA foi trocado
  del "%TMP%" >nul 2>nul
  exit /b 1
)

if exist "%DEST%\agent.js" copy /y "%DEST%\agent.js" "%DEST%\agent.js.bak" >nul
copy /y "%TMP%" "%DEST%\agent.js" >nul
del "%TMP%" >nul 2>nul

for /f %%V in (`node -e "try{console.log(require(process.argv[1]).VERSION)}catch(e){console.log('?')}" "%DEST%\agent.js"`) do set "NOVA=%%V"

echo.
echo [ok] Agente atualizado: v%NOVA% em %DEST%
echo     Backup da anterior: agent.js.bak ^(rollback: copy agent.js.bak agent.js^)
echo.
echo PROXIMO PASSO - reinicie o agente no modo que preferir:
echo   1^) Ctrl+C no terminal onde o agente esta rodando
echo   2^) escolha um dos modos:
echo        npx ponte-local start                          # arquivos apenas ^(padrao^)
echo        npx ponte-local start --allow-run --save      # supervisionado ^(aperta s/N^)
echo        npx ponte-local start --auto --save           # autonomo ^(com trava anticatastrofe^)
endlocal
