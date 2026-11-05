---
name: ponte-local
description: >-
  Operar o PC do usuário (Windows ou Linux) remotamente pelo chat. Instalar a
  ponte (relay Next.js + agente Node.js zero-dependências), mostrar ao usuário
  o que ele precisa instalar, validar a conexão e executar operações de
  arquivos e comandos, com modos supervisionado/autônomo, lixeira com undo,
  trava anticatástrofe e uma lane por máquina (cada PC com token e fila
  próprios — comando de uma máquina nunca executa na outra). Use quando o
  usuário pedir para você mexer no computador dele: organizar arquivos,
  procurar coisas, rodar comandos, trocar configurações do desktop, automatizar
  tarefas locais, ler arquivos de qualquer formato ou tamanho (leitura por
  pedaços), com modo deus opcional (run_command sem confirmações s/N — a IA
  pergunta ao usuário NO CHAT logo após conectar e ativa; nada no terminal) e
  skill que o agente atualiza sozinho do repo. Se a ponte já está no ar,
  qualquer IA (Claude, Manus…) opera só com a URL e o ADMIN_TOKEN — sem
  hospedar nada.
---

<!-- skill-version: 4.0.0 -->

# Ponte Local — operação remota do PC do usuário

## 0. A ponte em 60 segundos

Três personagens:

- **RELAY** — a central. Um app Next.js rodando num servidor (VM, preview de
  plataforma ou VPS). Guarda as filas de comandos e os resultados.
- **AGENTE** — o mordomo. Um arquivo só, `agent.js`, sem dependências, rodando
  no PC do usuário. Ele **poll** (checa de tempo em tempo, a cada 1,5 s) o
  relay, executa o que chega e devolve o resultado. Só abre conexão de
  **saída** — nada de porta aberta, firewall, port forwarding ou VPN.
- **VOCÊ** — a IA que lê isto. Opera por HTTPS com `curl` (ou o `ponte.py`),
  de qualquer lugar do mundo.

```
┌──────────────┐   poll (1,5s)    ┌─────────────────────┐   admin    ┌──────────┐
│ PC do usuário │ ◄──────────────► │ relay Next.js       │ ◄────────► │   VOCÊ   │
│  agent.js     │  GET  /poll      │ /api/ponte/*        │ injeta cmd │ (IA que  │
│ (zero deps)   │  POST /result    │ URL pública https   │ + lê res.  │ lê isto) │
└──────────────┘                  └─────────────────────┘            └──────────┘
```

O ciclo de UM comando: você faz `POST /cmd` dizendo a **lane** → o agente da
lane polla, executa → responde `POST /result` → você lê em
`GET /results?since=N`. Pronto.

**Lane** é a linha privada que liga você a UMA máquina: 1 máquina = 1 token =
1 lane = 1 fila. Comando destinado a uma máquina nunca executa na outra.

**Glossário** (os termos abaixo são usados no arquivo inteiro):

| Termo | Significado em 1 frase |
|---|---|
| `relay` | a central (Next.js) que guarda filas e resultados, hospedada num servidor |
| `agente` | o `agent.js` no PC do usuário; executa e devolve |
| `lane` | a fila de UMA máquina; o nome nasce do sufixo de `PONTE_TOKEN_<NOME>` |
| `poll` | o agente checar o relay a cada 1,5 s ("tem coisa pra mim?") |
| `token` | senha de 24+ caracteres; um por máquina (`PONTE_TOKEN_*`) + um seu (`PONTE_ADMIN_TOKEN`) |
| `ADMIN_TOKEN` | o SEU token de operador — usado no header `x-ponte-admin` |
| `.env` | arquivo de variáveis do relay no servidor; é lá que os tokens nascem |
| `/status` | o painel privado do operador (JSON): versão, lanes, quem está conectado |
| `pedaço` / `proximoOffset` | leitura de arquivo fatiada; cada resposta traz o offset do próximo pedaço |
| `modo deus` | agente para de pedir s/N para `run_command`; ativado só com aceite do usuário NO CHAT |
| `trava anticatástrofe` | bloqueio FÍSICO no agente dos comandos destrutivos (veja a Lei 4) |
| `s/N` | caixa de confirmação que aparece no terminal do usuário em modo supervisionado (60 s) |

**Diga assim ao usuário (apresentação em 2 frases):**
> "Instalei aí um programinha que me deixa organizar arquivos e rodar comandos
> no seu PC pelo nosso chat. Ele só faz conexão de saída para o meu servidor —
> não abre porta no seu computador, não precisa de VPN nem mexer no roteador."

## 1. AS 5 LEIS — valem mais que tudo que vem depois

**Lei 1 — Toda tarefa termina com `task_done`.** Última ação de toda tarefa,
sem exceção:

```json
{"action":"task_done","args":{"resumo":"O QUE foi feito, em 1-4 linhas, linguagem simples para o usuário"}}
```

O agente grava `relatorio-ponte.txt` e abre na tela do usuário com a seção
**O QUE FOI FEITO** (o seu resumo, sem lista de comandos) e **FALHAS** (só se
algo errou). Para ele, "a ponte funcionou" = a janela abrir. Redes de
segurança do agente (não são licença para esquecer): pausa de 3 min entre
comandos fecha a tarefa sozinha (env `PONTE_TAREFA_GAP_MS`, mínimo 1 s) e o
encerramento do agente gera o relatório antes de sair. A tarefa seguinte (ou o
boot do agente) fecha a janela anterior e apaga o txt — se a máquina não tem
interface gráfica e o relatório nunca abriu, o txt NÃO é apagado: é a única
cópia e o caminho fica impresso no terminal. `ping` e `task_done` não contam
como trabalho; `task_done` sem comando de trabalho devolve `abriuRelatorio:false`.
**Diga assim, na primeira tarefa:** "quando eu terminar, uma janela de
relatório abre na sua tela. Se não abrir, me avisa."

**Lei 2 — Todo comando vai na lane da máquina certa.** `POST /cmd` EXIGE
`"lane":"<nome>"` (sem lane o relay REJEITA). Não invente nome: o `/status`
mostra as lanes que existem e qual máquina está em cada uma
(`lanes.<lane>.agentInfo.maquina`). Antes de mirar, confira
`conectado:true` na lane alvo.

**Lei 3 — modo deus se pergunta NO CHAT.** Assim que conectar, envie um
`ping`: se vier `modoDeus:false` e `godModeDeclined:false`, pergunte AQUI na
conversa — nunca nada digitado no terminal do usuário:

> "quer ativar o modo deus? Com ele eu executo comandos sem pedir s/N — a
> trava anticatástrofe, a lixeira e o log continuam valendo."

Aceitou → `god_mode {"enabled":true}` e confirme. Recusou →
`god_mode {"declined":true}` (fica registrado e você não pergunta de novo; um
aceite novo limpa a recusa). Desligar é livre, sem pergunta:
`god_mode {"enabled":false}`. O aceite do usuário NO CHAT também habilita o
`run_command` de uma ponte instalada sem `--auto`/`--allow-run` — a decisão
sempre é dele, o terminal é que não precisa de flag.

**Lei 4 — A trava anticatástrofe é intransponível.** O agente recusa
localmente, em qualquer modo (nem modo deus contorna, nem com aprovação):
fork bomb, expansão de comando (`$( )`, backtick, `>( )`), `mkfs`, `wipefs`,
`dd of=/dev/*`, `shred` em dispositivo, escrita em `/dev/*`, `find -delete`,
`xargs` com comando destrutivo (com ou sem flags no meio), pipe para
interpretador (`| sh`, `| python`…), `curl | sh`, `chmod/chown -R` em pasta do
sistema, `rm -r` em `/`, `/*`, `/home`, `~`, `$HOME`, `/boot`, `/etc`, `/usr`,
`/var`, `/lib`, `/opt`, `/mnt`, `/media`, variável não resolvida, `.`/`..` e a
home literal. Windows: `format`, `diskpart`, `cipher /w`,
`vssadmin delete shadows`, `rd|rmdir /s` e `del /s` (flag em qualquer
posição), `Remove-Item -Recurse` e aliases (`ri`, `del`, `erase`, `-r`) na
raiz de drive, `C:\Windows`, `C:\Program Files` (inclui `C:\PROGRA~1`),
`%USERPROFILE%` e home literal. **Nunca tente contornar.**

**Lei 5 — Token nenhum vaza.** Tokens vivem no `.env` do relay e vão ao
usuário uma única vez, NO CHAT PRIVADO, **um bloco por máquina** (só o token
daquela máquina). Nunca em repo, screenshot, log ou chat público. Token que
apareceu em arquivo versionado é token QUEIMADO: gere outro
(`openssl rand -hex 16`), troque no `.env` e reinstale na máquina. O `/status`
e o painel são privados: respondem 401 sem o header `x-ponte-admin` e não
revelam nem que as máquinas existem. O atalho `?admin=` saiu do ar (token em
URL vira registro em log de gateway) — é só o header.

## 2. A ponte já está no ar?

Se outra sessão, outra IA ou outra plataforma já instalou a ponte, você não
hospeda nada nem gera token: vá direto ao **Apêndice A** com a URL pública e o
ADMIN_TOKEN que o usuário tiver. O resto deste capítulo é para quem está
montando a ponte agora.

## 3. Preparar do zero — siga a sequência

Os passos abaixo são A ORDEM. Não pule; cada um valida o anterior.

### Passo 0 — Duas perguntas antes de tudo

1. **A ponte já existe?** (capítulo 2 — sim → Apêndice A e pare aqui.)
2. **O PC do usuário é Windows ou Linux (qual distro)?** Os comandos mudam
   completamente. Pergunte, nunca assuma.
   **Diga assim:** "seu PC é Windows ou Linux? Se for Linux, qual distro
   (Ubuntu, Arch/CachyOS…)?"

**O que o usuário vai fazer durante a instalação (anuncie logo):**
> "Você vai colar 1 ou 2 blocos de comando que eu te mando; se for Windows e
> o Node for instalado agora, fechar e abrir o PowerShell de novo no meio;
> deixar a janela do agente aberta; e, quando eu estiver trabalhando aí,
> apertar `s` ou `n` numa caixa que pode aparecer. No fim de cada tarefa uma
> janela de relatório abre sozinha."

### Passo 1 — Obtenha o repo e saiba o que é cada pasta

```bash
# ONDE: no seu servidor/VM
git clone https://github.com/micsxnn/ponte-local.git
```

```
ponte-local/
├── SKILL.md            ← este arquivo (instruções para você, IA)
├── agente/             ← LADO DO PC: agent.js (o agente inteiro), SKILL.md
│                          (variante para IA dentro da máquina), LEIA-ME.md,
│                          rodar.sh, atualizar.sh, rodar.bat, watchdog.bat,
│                          teste-trava.cjs
├── relay/              ← LADO DO SERVIDOR: ponte-store.ts, api/<rota>/route.ts,
│                          painel/, RESTAURAR.md (hospedar em VPS com domínio fixo)
└── operador/           ← CLI sua na VM: ponte.py, teste-pegar-mock.py
```

### Passo 2 — Relay no ar

**Pré-requisitos do SERVIDOR** (onde você roda): Node.js 18+, `openssl`, e uma
URL pública HTTPS (Passo 3). Python 3 é opcional (só para o `ponte.py`).

```bash
# ONDE: no seu servidor/VM — crie o projeto e copie os arquivos do repo
CI=1 npx create-next-app@latest ponte-relay --typescript --app --no-eslint --src-dir --import-alias "@/*"
cd ponte-relay
```

| Arquivo do repo             | Destino no projeto Next.js             |
|-----------------------------|----------------------------------------|
| `relay/ponte-store.ts`      | `src/lib/ponte-store.ts`               |
| `relay/api/poll/route.ts`   | `src/app/api/ponte/poll/route.ts`      |
| `relay/api/result/route.ts` | `src/app/api/ponte/result/route.ts`    |
| `relay/api/cmd/route.ts`    | `src/app/api/ponte/cmd/route.ts`       |
| `relay/api/results/route.ts`| `src/app/api/ponte/results/route.ts`   |
| `relay/api/status/route.ts` | `src/app/api/ponte/status/route.ts`    |
| `relay/api/download/route.ts`| `src/app/api/ponte/download/route.ts` |
| `relay/painel/page.tsx`     | `src/app/page.tsx`                     |
| `agente/agent.js`           | `download/ponte-agent/agent.js` (a rota `/api/ponte/download` serve este caminho) |

**Next.js 16+:** edite `next.config.ts` e deixe `cacheComponents: false`
(e remova `partialPrefetching: true` se existir) — senão as rotas quebram com
*"Route segment config "dynamic" is not compatible"*.

**Tokens: um por máquina, no `.env`** (o Next lê sozinho; nada hardcoded).
Gere primeiro, cole depois — o `.env` não executa comando:

```bash
# ONDE: no seu servidor/VM — gere um valor por linha (copie cada saída)
openssl rand -hex 16
```

```ini
# ONDE: no seu servidor/VM — arquivo .env do projeto (a pasta do relay)
PONTE_ADMIN_TOKEN=cole-aqui-o-valor-gerado        # só seu
PONTE_TOKEN_MAQUINA_1=cole-aqui-o-valor-gerado    # lane maquina_1
PONTE_TOKEN_MAQUINA_2=cole-aqui-o-valor-gerado    # só se houver 2ª máquina
```

**Regras do nome da lane (onde TODO agente se confunde — leia devagar):**

- O nome da lane vem do **sufixo** da variável, em minúsculas:
  `PONTE_TOKEN_MAQUINA_1` cria a lane `maquina_1`. Quer `escritorio`?
  `PONTE_TOKEN_ESCRITORIO`.
- O sufixo só aceita **A-Z, 0-9 e `_`** — variável de ambiente NÃO aceita
  hífen. Uma lane "maquina-1" nunca vai existir; a certa é `maquina_1`.
- Máquina nova = linha nova no `.env`. Nunca o mesmo token em duas máquinas —
  a lane É a máquina.
- Aliases legados que ainda valem (transição do token único):
  `PONTE_AGENT_TOKEN` → lane `netbook`; `PONTE_TEST_TOKEN` → lane `test`.
- **Trocou ou criou token no `.env`? REINICIE o relay.** A lane nasce no boot;
  sem restart o `/cmd` responde "lane sem token" e você vai achar que é erro
  de digitação. (É para reiniciar que serve esta lista: token criado, token
  trocado, máquina nova no `.env` — sempre restart.)

Suba o relay **já em background** (se a sessão morrer, a ponte cai):

```bash
# ONDE: no seu servidor/VM
nohup npm run dev > relay.log 2>&1 &   # porta 3000 (ocupada? PORT=3001 npm run dev)
```

Valide **local**:

```bash
# ONDE: no seu servidor/VM
curl -s -H "x-ponte-admin: $(grep PONTE_ADMIN_TOKEN .env | cut -d= -f2)" \
  http://127.0.0.1:3000/api/ponte/status
# esperado: {"ok":true,"connected":false,"lanes":{...},"version":"..."}
# SEM o header: 401 — o status é privado. HTML 500? Veja o cacheComponents acima.
```

O estado do relay persiste em `.ponte-estado.json` (fila pendente, últimos
resultados, specs): editar arquivo/reiniciar o Next não amputa histórico, e a
janela de "conectado" é de 45 s (soluço de rede não apaga a luz). Para escolher
a pasta de estado em VPS/container: `PONTE_DATA_DIR`.

### Passo 3 — URL pública: descubra, valide, nunca adivinhe

O agente precisa de uma URL pública HTTPS que chegue ao relay. Descubra NESTA
ordem — nunca teste candidatos inventados (URL errada = 404 e tempo queimado):

1. **Contexto da plataforma.** Em previews por sessão (ex.: z.ai/space-z) a
   URL é `https://preview-chat-<CHAT_ID>.space-z.ai/` — o `CHAT_ID` vem no
   metadata de cada mensagem da conversa. Determinístico; nada de adivinhar.
2. **Variáveis de ambiente:** `env | grep -iE 'preview|url|host|domain|bot'`.
3. **Pergunte ao usuário** — **Diga assim:** "me cola a URL de preview que
   aparece aí no topo do navegador".
4. **Plano B — túnel sem conta:**

```bash
# ONDE: no seu servidor/VM
curl -fLo cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x cloudflared && ./cloudflared tunnel --url http://localhost:3000
# anote a https://...trycloudflare.com do log (ngrok também serve; exige conta)
```

Valide local E público num bloco só (mesmo JSON nos dois = roteamento OK):

```bash
# ONDE: no seu servidor/VM
curl -s http://127.0.0.1:3000/api/ponte/status -H "x-ponte-admin: $PONTE_ADMIN_TOKEN"  # relay no ar
curl -s https://URL_DA_PONTE/api/ponte/status   -H "x-ponte-admin: $PONTE_ADMIN_TOKEN" # roteamento externo OK
# ambas sem header → 401. Local ok + público 404 = problema de roteamento/gateway.
```

**Só siga ao Passo 4 com o público respondendo** — senão o agente do usuário
vai pollar para o nada.

### Passo 4 — Instalar o agente NA MÁQUINA do usuário

**Pré-requisitos no PC do usuário:** Node.js 18+ e um terminal. Confira/instale:

| SO/Distro     | Comando para instalar |
|---------------|-----------------------|
| Windows 10/11 | `winget install OpenJS.NodeJS.LTS` (ou nodejs.org) — `curl.exe` já vem no sistema |
| Arch/CachyOS  | `sudo pacman -S --needed nodejs curl` |
| Debian/Ubuntu | `sudo apt install -y curl && curl -fsSL https://deb.nodesource.com/setup_20.x \| sudo -E bash - && sudo apt install -y nodejs` |
| Fedora        | `sudo dnf install -y nodejs curl` |
| openSUSE      | `sudo zypper install -y nodejs20 curl` |

Verificação: `node --version` (≥ 18). **Diga assim:** "seu PC precisa do
Node; cola isso no terminal, demora ~1 min."

⚠️ **Windows: Node instalado AGORA? Feche TODAS as janelas do PowerShell e
abra uma NOVA antes de seguir.** O PATH novo não entra em janelas que já
estavam abertas — na janela velha, `node agent.js` devolve "o termo node não
é reconhecido". **Diga assim:** "fechou todas as janelas do PowerShell? abre
uma nova, aí sim cola o bloco abaixo".

**O BLOCO DE ENTREGA (modelo canônico — único do arquivo).** Um bloco POR
máquina, com URL e token JÁ preenchidos por você; o usuário só copia, cola e
roda (não digita token, não abre página, não preenche placeholder). O bloco
instala em modo **autônomo** (`--auto`): você executa comandos direto, com a
trava anticatástrofe ativa — o usuário pode trocar o modo depois (§ 4.4), e a
Lei 3 continua valendo.

**Máquina X — rode este comando NELA** (o token abaixo é SÓ dela):

```bash
# ONDE: no PC DO USUÁRIO (Linux/macOS/Termux) — copie TUDO, cole, Enter
mkdir -p ~/ponte-agent; cd ~/ponte-agent
curl -fsSL "URL_DA_PONTE/api/ponte/download" -o agent.js
node agent.js --server "URL_DA_PONTE" --token TOKEN_DA_MAQUINA_X --auto --save
node agent.js
```

```powershell
# ONDE: no PC DO USUÁRIO (Windows PowerShell — curl.exe COM a extensão)
mkdir "$HOME\ponte-agent" -Force; cd "$HOME\ponte-agent"
curl.exe -fso agent.js "URL_DA_PONTE/api/ponte/download"
node agent.js --server "URL_DA_PONTE" --token TOKEN_DA_MAQUINA_X --auto --save
node agent.js
```

Checklist ANTES de entregar: a URL é a PÚBLICA (não localhost), o token é o da
lane certa, quem roda é a máquina certa. Onde o repo é público, a alternativa
de download é
`curl -fso agent.js https://raw.githubusercontent.com/micsxnn/ponte-local/main/agente/agent.js`.
**Diga assim:** "copia tudo, cola e Enter. O token aí é só da tua máquina —
não compartilha. Deixa essa janela aberta: é por ela que eu trabalho; fechou,
meu acesso cai (depois é só rodar `~/ponte-agent/rodar.sh`, Linux, ou dar
duplo clique no `rodar.bat`, Windows)."

Notas por plataforma (o resto é igual):

- **Windows — dia a dia:** caminhos absolutos são `C:\Users\usuario\...`. O
  `rodar.bat` (duplo clique) desliga o QuickEdit do console e loga em
  `ponte-agent.log` — clique acidental dentro da janela NÃO congela mais o
  node. O `watchdog.bat` religa sozinho se o agente morrer (confere a cada
  30 s). Ambos vêm na pasta `agente/` do repo — baixe e envie com
  `write_binary` se o usuário quiser usá-los. Se um comando precisar de
  admin, o usuário fecha o agente e reabre o PowerShell com "Executar como
  administrador" (a decisão é fisicamente dele).
- **Termux (Android):** lane própria, token próprio:

```bash
# ONDE: no TERMIUX do usuário — copie TUDO, cole, Enter
pkg update -y && pkg install -y nodejs-lts
termux-setup-storage   # ⚠️ VAI APARECER UM PEDIDO DE PERMISSÃO DO ANDROID: aceite
mkdir -p ~/ponte-agent
curl -fso ~/ponte-agent/agent.js "URL_DA_PONTE/api/ponte/download"
termux-wake-lock
node ~/ponte-agent/agent.js --server "URL_DA_PONTE" --token TOKEN_DO_APARELHO --auto --save
node ~/ponte-agent/agent.js
```

  **Diga assim (Termux):** "no meio vai aparecer um pedido de permissão de
  acesso aos arquivos do Android — toca em PERMITIR". Mantenha vivo:
  `termux-wake-lock` antes de religar, Termux FORA da otimização de bateria
  (Ajustes → bateria sem restrição) e a sessão aberta — o Android mata
  processo em segundo plano. O `run_command` resolve o bash sozinho; com o
  pacote Termux:API (`pkg install termux-api` + app do F-Droid) funcionam
  `termux-battery-status`, `termux-notification`, `termux-toast`,
  `termux-camera-photo` e `am start` para abrir apps; o armazenamento fica em
  `~/storage/shared`. O relatório não abre app: fica em
  `~/ponte-agent/relatorio-ponte.txt` (`cat` ou `termux-open`).

### Passo 5 — Validar a conexão e ativar

```bash
# ONDE: no seu servidor/VM
curl -s https://URL_DA_PONTE/api/ponte/status -H "x-ponte-admin: $PONTE_ADMIN_TOKEN"
# lanes.<lane>.conectado:true + agentInfo.maquina = a máquina está na ponte
```

Depois de `conectado:true`, mande um `ping` (§ 4.2): ele traz as specs e o
estado do modo. Então aplique a **Lei 3** (pergunta do modo deus no chat).
Instalação pronta — daqui em diante é o dia a dia.

## 4. Operar

### 4.1 Mandar comando e ler resultado

```bash
# ONDE: no seu servidor/VM (ou onde você estiver — é API HTTP pura)
export PONTE_URL=https://URL_DA_PONTE
export PONTE_ADMIN_TOKEN=o-token-de-admin

# enfileira — diga A QUAL MÁQUINA (lane, veja no /status)
# resposta: {"ok":true,"id":77,"lane":"maquina_1"}
curl -s -X POST $PONTE_URL/api/ponte/cmd \
  -H "x-ponte-admin: $PONTE_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"lane":"maquina_1","action":"ping","args":{}}'

# leia desde id-1; o lastId da resposta é o seu próximo since
curl -s "$PONTE_URL/api/ponte/results?since=76&lane=maquina_1" \
  -H "x-ponte-admin: $PONTE_ADMIN_TOKEN"
```

`results?since=X` devolve `{"ok":true,"results":[...],"lastId":M}` — no máximo
**100 resultados por chamada**; com `&lane=<nome>` filtra a máquina, sem lane
devolve todas. Resultado vazio: o agente ainda não pollou (releia em 3–5 s) ou
está offline (`conectado:false` — **Diga assim:** "fecha e abre de novo o
programinha aí, ele parece ter desconectado").

**Duas ou mais máquinas na mesma tarefa:** use `&lane=<nome>` no `/results` e
guarde um `since` POR lane (variável `SINCE_MAQUINA_1=…`, `SINCE_MAQUINA_2=…`).
O campo `lane` vem dentro de cada resultado para conferência. O `ponte.py`
resolve isso sozinho (baseline por lane).

Com Python na sua VM, o `ponte.py` enfileira, espera e imprime o resultado:

```bash
# ONDE: no seu servidor/VM (pasta operador/ do repo)
export PONTE_URL=https://URL_DA_PONTE
export PONTE_ADMIN_TOKEN=o-token-de-admin
export PONTE_LANE=maquina_1        # a máquina alvo — OBRIGATÓRIA
python3 ponte.py ping              # espera o resultado e imprime o JSON
python3 ponte.py '<ação>' '<args-json>'
python3 ponte.py enviar <arquivo-local> <destino-absoluto-remoto>   # write_binary
python3 ponte.py pegar <origem-absoluta-remota> <arquivo-local>     # read_binary (segue os pedaços sozinho)
python3 ponte.py --status          # o mesmo JSON do /status
python3 ponte.py --drain           # lê resultados pendentes
PONTE_WAIT_S=300 python3 ponte.py ...   # espera mais (modo supervisionado)
```

A espera padrão do `ponte.py` é 150 s (`PONTE_WAIT_S`) — cobre os 60 s da
caixa s/N do modo supervisionado mais a execução.

**Conectado, mas o resultado não vem — playbook, nesta ordem:**

1. `/status` → `pending` da lane: quantos comandos estão na fila (não mostra
   quais). Pendente <24h é entregue no reconnect; mais velho que isso é
   descartado.
2. Não reenvie às cegas: o comando em execução que não confirmou resultado
   re-entrega sozinho após 120 s (lease) — reenvio duplicado é execução
   dupla. (Se precisar reenviar MESMO assim, o relay trata resultado repetido
   como idempotente: `{"ok":true,"duplicado":true}` — mas a máquina executa
   de novo.)
3. Erro "Resultado grande demais (>10,5 MB)" → refine: `maxBytes` menor, uma
   pasta de cada vez.
4. `data` veio `{"_cortado":...}` → é resultado do HISTÓRICO lido após um
   restart do relay (o snapshot em disco corta payloads grandes; os entregues
   em tempo real são sempre íntegros). Releia ao vivo ou refaça o comando.
5. Baseline do `ponte.py` (`TEMPO ESGOTADO` com agente conectado): veja § 7.

### 4.2 As ações

Envie por `POST /api/ponte/cmd` com header `x-ponte-admin`, corpo
`{"lane":"maquina_1","action":"...","args":{...}}` — ou via `ponte.py`. No
Windows os caminhos das ações viram `C:\Users\usuario\...`; o agente aceita
ambos os estilos conforme o SO dele.

| Ação | Args (JSON) | O que faz |
|------|-------------|-----------|
| `ping` | `{}` | Specs e estado: CPU, RAM, Node, usuário, máquina, modo (`modoDeus`, `godModeDeclined`), versão da skill (`skill`) |
| `list` | `{"path":"C:\\Users\\u\\Downloads"}` | Lista pasta (nome, pasta?, bytes, mtime); pagina com `offset`/`limit` (400 por página, limite 2.000, teto de 4.000 itens por pasta) |
| `tree` | `{"path":"...","depth":2}` | Árvore (profundidade máx. 4) |
| `read_text` | `{"path":"...","offset":0,"maxBytes":200000,"encoding":"auto"}` | Texto de QUALQUER tamanho em pedaços (≤ 2 MB/pedaço, padrão 200 KB); detecta utf-8/cp1252/utf-16/latin1; siga `proximoOffset` até `null` |
| `write_text` | `{"path":"...","content":"...","overwrite":true}` | Cria/sobrescreve (≤ 1 MB; antigo → lixeira) |
| `search` | `{"path":"...","query":"termo","mode":"name"\|"content"}` | Busca por nome (padrão 300 hits) ou conteúdo (200) — teto 500 via `max`; pula arquivos > 2 MB |
| `mkdir` | `{"path":"..."}` | Cria pasta(s) |
| `move` | `{"from":"...","to":"..."}` | Move/renomeia |
| `rename` | `{"path":"...","newName":"novo.ext"}` | Renomeia no mesmo lugar |
| `delete` | `{"path":"..."}` ou `{"paths":["...","..."]}` | Move para a lixeira do agente (recuperável); recusa apagar a home inteira |
| `restore` | `{"trashName":"..."}` | Restaura da lixeira no lugar original (use o `trashName` devolvido) |
| `organize_plan` | `{"path":"/home/u/Downloads"}` | Propõe plano de organização por tipo (NÃO executa!) |
| `apply_plan` | `{"plan":[{"de":"/a/b.txt","para":"/c/b.txt"}]}` | Executa movimentos em lote — mostre o plano antes (Lei: destrutivo = confirmado) |
| `undo_last` | `{}` | Desfaz a última operação (lixeira/lote) |
| `free_space` | `{}` | Espaço livre/total dos discos |
| `disk_usage` | `{"path":"...","depth":2}` | Tamanho por subpasta |
| `duplicates` | `{"path":"...","minSizeBytes":1048576}` | Duplicados (tamanho→md5) + espaço recuperável |
| `read_binary` | `{"path":"...","offset":0,"maxBytes":4194304}` | Binário em base64 por pedaços (≤ 6 MB/pedaço; padrão 4 MB em arquivos grandes) — junte os base64 NA ORDEM |
| `file_info` | `{"path":"..."}` | Tipo REAL por magic bytes (png, jpeg, pdf, zip, exe, mp4, sqlite, gzip, iso…) + tamanho + encoding se for texto |
| `write_binary` | `{"path":"...","base64":"...","overwrite":true}` | Grava binário (máx 8 MB) |
| `run_command` | `{"command":"...","cwd":"C:\\Users\\u","timeoutMin":3}` | Shell — exige modo habilitado (§ 4.4) |
| `god_mode` | `{"enabled":true}` / `{"enabled":false}` / `{"declined":true}` | Protocolo da Lei 3 |
| `skill_update` | `{}` | Força o download da SKILL.md deste repo (também roda sozinho no boot e a cada 60 s) |
| `task_done` | `{"resumo":"..."}` | **Fecha a tarefa** (Lei 1) — ÚLTIMO comando de toda tarefa |

Resposta de cada comando: `{"id","ok","data"|"error","durationMs","ts"}`.

### 4.3 Ler qualquer arquivo — formato e tamanho

Não existe "arquivo grande demais" nem "formato desconhecido". A receita, igual
no Linux e no Windows:

1. **Pergunte o que é:** `file_info` → tipo real, tamanho e, se for texto, o
   encoding detectado.
2. **Texto:** `read_text` (≤ 2 MB/pedaço, padrão 200 KB) e siga
   `proximoOffset` até `null` — cada resposta traz `encoding`, `lidos`,
   `truncado`, `caracteres`. Encoding não-utf-8? Passe `"encoding"` explícito
   nos pedaços seguintes (a `dica` da resposta avisa).
3. **Binário:** `read_binary` (≤ 6 MB/pedaço, padrão 4 MB) com
   `{"offset": proximoOffset}` e junte os `base64` NA ORDEM — ou deixe o
   `ponte.py pegar` fazer isso sozinho. Arquivos até 6 MB vêm inteiros numa
   chamada.
4. `read_text` em binário NÃO devolve lixo: responde
   `{"provavelBinario":true,"tipo":"png",...}` — mude para
   `read_binary`/`file_info`. utf-16 sem BOM é marcado como binário — use
   `file_info` + `encoding` explícito.

Exemplo — confirmar o formato de um vídeo de 2 GB e espiar o header:

```json
{"action":"file_info","args":{"path":"C:\\Users\\u\\Videos\\a.mp4"}}
{"action":"read_binary","args":{"path":"C:\\Users\\u\\Videos\\a.mp4","maxBytes":65536}}
```

### 4.4 `run_command` — os 4 estados (escalada é FÍSICA)

| Estado | Como chega lá | Comportamento |
|--------|---------------|---------------|
| Desligado (padrão) | `node agent.js` | `run_command` negado (o erro ensina as receitas); só operações de arquivo |
| Supervisionado | usuário religa com `--allow-run --save` | caixa s/N no terminal DELE, 60 s; **sem resposta = auto-rejeita** (erro "Você rejeitou o comando no terminal") |
| Autônomo | usuário religa com `--auto --save` | executa direto, log `[AUTO] $ cmd`; trava anticatástrofe ativa |
| **modo deus** | a IA pergunta NO CHAT após conectar; aceite → `god_mode {"enabled":true}` | igual ao autônomo (log `[deus] $ cmd`); trava, lixeira e log continuam; o aceite vale mesmo sem flag no terminal |

Trocar de modo (exceto modo deus, que é conversacional) exige o usuário
religar o agente no terminal DELE. **Diga assim:** "Ctrl+C no terminal do
agente e roda `node agent.js --auto --save` — isso me dá execução direta com a
trava anticatástrofe, ok?" (no Windows, mesmo comando no PowerShell). ⚠️ Fechar
a janela do agente me corta o acesso — avise que é normal e rápido.

Em modo supervisionado use `PONTE_WAIT_S=150` (ou mais) no `ponte.py`.
**Diga assim (primeira caixa s/N):** "vai aparecer uma caixa pedindo
confirmação aí no terminal — aperta `s` em até 60 segundos, ou `n` para
negar."

### 4.5 Sudo sem expor senha (Linux, só com autorização explícita)

*(No Windows não há sudo: `run_command` roda com os privilégios do usuário do
terminal.)*

1. `write_text` → `/home/u/Downloads/.tmp-senha` com `content: "SENHA\n"`
   (a senha viaja no corpo do comando, **nunca** dentro de um shell que vira log)
2. `run_command` → `sudo -S bash -c 'COMANDO_REAL' < /home/u/Downloads/.tmp-senha`
3. `run_command` → `rm -f /home/u/Downloads/.tmp-senha` (rm real via shell — a
   ação `delete` iria para a lixeira e a senha ficaria recuperável!)

NOPASSWD permanente só com pedido explícito do usuário, sempre validando:

```bash
sudo -S bash -c 'echo "usuario ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/90-nopasswd \
  && chmod 440 /etc/sudoers.d/90-nopasswd \
  && (visudo -c >/dev/null 2>&1 && echo OK || rm -f /etc/sudoers.d/90-nopasswd)' < .tmp-senha
```

## 5. Referência rápida

**As três versões e onde ver cada uma:** relay → campo `version` do `/status`;
agente → o `ping` traz a versão dele; skill → marcador `<!-- skill-version -->
` no topo deste arquivo (o agente baixa a versão mais recente sozinho).

**Dicionário do `/status`:**

| Campo | Significado |
|---|---|
| `connected` | alguma lane conectada (global) |
| `lanes.<lane>.conectado` | o agente da lane pollou nos últimos 45 s |
| `lanes.<lane>.lastSeenAgoS` | segundos desde o último poll (`null` = nunca conectou) |
| `lanes.<lane>.pending` | QUANTOS comandos estão na fila (não mostra quais) |
| `lanes.<lane>.agentInfo` | specs anunciadas pelo ping (`.maquina` diz quem é quem) |
| `lanes.<lane>.semToken` | lane histórica cujo token saiu do `.env` (histórico preservado) |
| `totalCommands` / `totalResults` | contadores desde o estado mais antigo retido |
| `uptimeS` / `version` | tempo de relay no ar / versão dele |

**Códigos HTTP que você vai ver:**

| Código | Onde | Significado |
|---|---|---|
| 401 | tudo | token ausente/inválido (admin ou agente) |
| 400 | `/cmd` | JSON inválido, ação ausente, lane ausente/inválida, **lane sem token** (a mensagem ensina: crie `PONTE_TOKEN_<SUFIXO>` e reinicie o relay) |
| 403 | `/result` | resultado pertence a outra lane |
| 404 | `/result` | resultado para comando desconhecido nesta lane |
| 411 | `/cmd`, `/result` | requisição chunked sem content-length |
| 413 | `/cmd`, `/result` | corpo acima de 12 MB |
| 429 | `/cmd` | fila da lane cheia (100) |
| 503 | `/cmd` | persistência falhou — o comando não foi aceito; tente de novo |

**Limites técnicos:**

| Limite | Valor |
|--------|-------|
| Corpo de requisição (2 sentidos) | 12 MB |
| Pedaço de `read_text` | 2 MB por chamada (padrão 200 KB) |
| Pedaço de `read_binary` | 6 MB por chamada (padrão 4 MB em arquivos grandes) |
| Tamanho do ARQUIVO lido | ilimitado (pedaços com `proximoOffset`) |
| `write_text` / `write_binary` | 1 MB / 8 MB |
| Comando (`run_command.command`) | 4.000 caracteres |
| Timeout por `run_command` | padrão 3 min; teto 30 min (`timeoutMin`) |
| stdout/stderr de `run_command` | cortados em 150.000 caracteres cada (maxBuffer 8 MB — stdout maior mata o comando) |
| Resultado total (agente) | recusado acima de ~10,5 MB ("refine o comando") |
| `resumo` do `task_done` | 4.000 caracteres |
| Fila de comandos pendentes | 100 por lane |
| Histórico de comandos / resultados | 2.000 / 400 |
| Resultados por chamada `/results` | 100 |
| Pendente na fila | entregue no reconnect se <24h; mais velho é descartado |
| Lease de re-entrega (resultado não confirmado) | 120 s |
| Janela "conectado" | 45 s sem poll |
| Poll do agente | a cada 1,5 s |
| Snapshot do relay | `.ponte-estado.json` (pendentes + resultados com data cortada em 200k; sobrevive a restart; `PONTE_DATA_DIR` muda a pasta) |
| `list` | 400 itens por página (máx. 2.000) |
| `search` | 300 hits por nome / 200 por conteúdo; pula arquivos > 2 MB |
| Checagem da skill pelo agente | boot + a cada 60 s (ETag: nada mudou = HTTP 304, zero bytes); falha de rede = backoff até 15 min |

## 6. Manutenção

- **Máquina nova:** linha nova `PONTE_TOKEN_<NOME>` no `.env` → **REINICIE o
  relay** → entregue o bloco do § 3 (Passo 4) com o token dela → `conectado:true`.
- **Token trocado/queimado:** gere (`openssl rand -hex 16`), troque no `.env`,
  **REINICIE o relay**, e na máquina religue o agente com
  `--token NOVO --save`. Lane antiga sem token não perde histórico (aparece
  `semToken:true`).
- **URL de preview mudou:** reenvie o bloco de instalação com a URL nova — o
  `--save` regrava a config sozinho.
- **Atualizar o agente:** baixe o `agente/agent.js` novo do repo, envie ao PC
  com `write_binary` para `~/Downloads/` (ou `C:\Users\u\Downloads`), e lá:
  `cp ~/Downloads/agent-vNOVO.js ~/ponte-agent/agent.js` (Windows: `copy`),
  Ctrl+C no agente e religue no modo escolhido.
- **Atualizar ESTA skill (na sua pasta de skills): desinstalação TOTAL
  primeiro.** Vendo que existe `skill-version` maior, NÃO sobrescreva: apague a
  pasta inteira da skill (SKILL.md e TODO arquivo auxiliar) e instale a nova
  do repo do zero — sobra de versão antiga mistura instruções contraditórias.
  Conferência final: só os arquivos da versão nova lá, e o marcador confere.
  (No PC do usuário não precisa fazer nada: o agente baixa e aplica sozinho.)
- **Cache do raw.githubusercontent:** logo após um commit novo, a versão nova
  pode levar ~5 min a aparecer; o `skill_update` devolve erro elegante
  ("skill remota sem marcador de versão") — tente de novo minutos depois.

## 7. Troubleshooting

| Sintoma | Causa | Correção |
|---------|-------|----------|
| `Lane "x" sem token — crie PONTE_TOKEN_… e reinicie o relay` (400 no /cmd) | lane inexistente ou token não carregado | crie a linha no `.env` e **REINICIE o relay**; nome com `-` nunca nasce de env — use `_` |
| `Comando vazio` no `run_command` | chave errada no args | a chave é **`command`**, não `comando` |
| `Pasta protegida no caminho` | caminho relativo resolveu contra o CWD do agente (a pasta dele é bloqueada), ou pasta sensível (`.ssh`, `.config`, …) | use **caminho absoluto** (`/home/u/...` ou `C:\Users\u\...`); pasta sensível é bloqueada mesmo absoluta — respeite |
| `Arquivo protegido (credenciais/config do agente)` | o arquivo é config/log do próprio agente ou credencial conhecida (`.env`, `.npmrc`, …) | não é para ler mesmo; peça o que precisa ao usuário por outro caminho |
| PowerShell: "o termo curl não é reconhecido" ou resposta HTML | `curl` sem `.exe` virou `Invoke-WebRequest` | use **`curl.exe`** (com a extensão) |
| PowerShell: "o termo node não é reconhecido" logo após instalar o Node | PATH novo não entra em janelas já abertas | feche TODAS as janelas do PowerShell, abra uma nova e repita |
| Agente não conecta (`conectado:false`) | URL/token errados, relay sem o token no `.env`, ou agente fechado | confira `--server`, confira `.env` + restart do relay, religue o agente |
| `TEMPO ESGOTADO` com agente conectado | baseline do operador maior que os ids da instância nova | apague `.ponte_since_<nome-da-lane>` na pasta do `ponte.py` (ou em `PONTE_STATE_DIR`, se definido) |
| `TEMPO ESGOTADO` em modo supervisionado | prompt s/N + execução passaram da espera do operador | reenvie com `PONTE_WAIT_S=150+` (sem resposta na caixa, o agente auto-rejeita com erro próprio) |
| `Você rejeitou o comando no terminal (resposta: n)` | ninguém confirmou a caixa s/N em 60 s | reenvie; **Diga assim:** "vai aparecer a caixa de novo — aperta `s` quando ela vier" |
| `Fila de comandos cheia` (429) | agente offline/travado acumulando além de 100 | religue o agente — pendentes <24h drenam sozinhos no reconnect |
| Agente Windows "congela" com a janela normal | QuickEdit do console: clique dentro da janela congela o stdout | rode pelo `rodar.bat` (log em arquivo + QuickEdit off); `watchdog.bat` religa sozinho |
| Relay reiniciou e perdeu fila/histórico | relay < 1.2.0 (estado só em RAM) | atualize o `relay/` do repo: snapshot em `.ponte-estado.json` sobrevive a restart |
| `Fora do escopo` | caminho fora da home | só a home do usuário é permitida (Linux `/home/u/**`; Windows `C:\Users\u\**`) |
| Pedaço de leitura falha | pedaço > 6 MB (`read_binary`) ou > 2 MB (`read_text`) | o ARQUIVO pode ter qualquer tamanho — reduza só o `maxBytes` do pedaço |
| Comando some após rebuild do relay | URL de preview mudou | religue o agente com `--server NOVA_URL --save` |

## 8. Segurança e privacidade

- **Escopo: a home do usuário.** Caminhos relativos resolvem contra o CWD do
  agente (tipicamente `~/ponte-agent`) — use sempre caminho absoluto.
- **Pastas sensíveis bloqueadas** (mesmo dentro da home): `.ssh`, `.gnupg`,
  `.config`, `.password-store`, `.aws`, `.kube`, `.docker`, `.mozilla`,
  `keyrings`, a pasta `ponte-agent`, e arquivos de credencial conhecidos
  (`.env`, `.npmrc`, `.netrc`, `.git-credentials`, `.wgetrc`, `.pypirc`,
  `.htpasswd`). Config e log do agente são bloqueados por caminho real (a
  rotação do log, `ponte-log.jsonl.old`, também) e a config nasce 0600.
- **Exclusão vai para a lixeira interna** do agente (XDG
  `~/.local/share/Trash`, também no Windows) com `undo_last` — **não é** a
  Lixeira do Windows. **Diga assim, se ele perguntar:** "eu apago para uma
  lixeira interna do programinha, dá para desfazer — a Lixeira do Windows não
  é usada."
- **Log:** tudo que o agente executa fica em `ponte-log.jsonl` na pasta dele.
- **O `.gitignore` do repo já cobre** `.env`, `.ponte-estado.json`,
  `.ponte-seq`, `ponte-log.jsonl*`, `__pycache__/` e `*.pyc`. Se você usar
  `worklog.md`, `db/` ou logs próprios no seu fork, adicione-os ANTES do
  primeiro push (Lei 5).

## Apêndice A — Operar uma ponte que já existe (sem hospedar)

A ponte é API HTTP pura: com a **URL pública** e o **ADMIN_TOKEN** (peça a
quem instalou), qualquer IA com `curl` opera de qualquer lugar. Valide e siga
a mesma régua do capítulo 4:

```bash
export PONTE_URL=https://A-URL
export PONTE_ADMIN_TOKEN=o-token-de-admin

curl -s $PONTE_URL/api/ponte/status -H "x-ponte-admin: $PONTE_ADMIN_TOKEN"  # quem está conectado
curl -s -X POST $PONTE_URL/api/ponte/cmd \
  -H "x-ponte-admin: $PONTE_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"lane":"maquina_1","action":"ping","args":{}}'
curl -s "$PONTE_URL/api/ponte/results?since=76&lane=maquina_1" \
  -H "x-ponte-admin: $PONTE_ADMIN_TOKEN"
```

As 5 Leis, a tabela de ações e os limites valem igual. Para uso permanente
independente de plataforma, hospede o relay num serviço com domínio fixo
(VPS, Render, Railway, Fly.io) — o repo tem tudo em `relay/RESTAURAR.md` — e
a URL nunca mais muda.

## Apêndice B — O que o usuário vê no terminal

No boot, arte **PONTE AGENTE** em blocos (terminal Linux UTF-8 e
cmd/PowerShell do Windows 10+ com fonte Consolas; janela estreita (<65
colunas), console antigo ou log de app → banner ASCII). Toda ação em
andamento mostra um spinner `⠏ rodando: <rótulo> (Ns)` (ASCII `|/-\` no cmd).
Ao fim de cada `run_command`, uma caixa `output` com stdout, stderr e código
de saída (truncada em 60/30 linhas — a IA continua recebendo o JSON completo;
o corte é só visual). Sem TTY (saída redirecionada), o spinner fica desligado.
Nada disso muda o protocolo nem os payloads.
