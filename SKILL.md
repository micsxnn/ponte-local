---
name: ponte-local
description: >-
  Operar o PC do usuário (Windows ou Linux) remotamente pelo chat. Instalar a
  ponte (relay Next.js + agente Node.js zero-dependências), mostrar ao usuário
  o que ele precisa instalar, validar a conexão e executar operações de
  arquivos e comandos, com modos supervisionado/autônomo, lixeira com undo,
  trava anticatástrofe e uma lane por máquina (cada PC com token e fila
  próprios — comando de uma máquina nunca executa na outra). Use quando o usuário pedir para você mexer no
  computador dele: organizar arquivos, procurar coisas, rodar comandos,
  trocar configurações do desktop, automatizar tarefas locais, ler arquivos
  de qualquer formato ou tamanho (leitura por pedaços com file_info/offset),
  com modo deus opcional (run_command sem confirmações s/N — a IA pergunta
  ao usuário NO CHAT logo após conectar e ativa; nada no terminal) e skill
  que o agente atualiza sozinho do repo. Se a
  ponte já está no ar, qualquer IA (Claude, Manus…) opera só com a URL e
  o ADMIN_TOKEN — sem hospedar nada.
---

<!-- skill-version: 3.1.1 -->

# Ponte Local — skill de operação remota do PC do usuário

Você (a IA) comanda um relay que fala com um agente instalado no PC do usuário.
O agente faz **poll** a cada 1,5 s, executa e devolve o resultado. Ele só abre
conexões de **saída** — nada de portas abertas, firewall, port forwarding ou VPN.
O relay tem uma **lane por máquina** (v1.3.0): cada agente autentica com o token
da SUA máquina e as filas são independentes — comando destinado a uma máquina
nunca executa na outra. Tokens via ambiente do relay (`PONTE_TOKEN_NETBOOK`,
`PONTE_TOKEN_WINDOWS`), um por máquina, entregues no chat privado.
O relay tem uma **lane por máquina** (v1.3.0): cada agente autentica com o token
da SUA máquina e as filas são independentes — comando destinado a uma máquina
nunca executa na outra. Tokens via ambiente do relay (`PONTE_TOKEN_NETBOOK`,
`PONTE_TOKEN_WINDOWS`), um por máquina, entregues no chat privado.

```
┌──────────────┐   poll (1,5s)    ┌─────────────────────┐   admin    ┌──────────┐
│ PC do usuário │ ◄──────────────► │ relay Next.js       │ ◄────────► │   VOCÊ   │
│  agent.js     │  GET  /poll      │ /api/ponte/*        │ injeta cmd │ (IA que  │
│ (zero deps)   │  POST /result    │ URL pública https   │ + lê res.  │ lê isto) │
└──────────────┘                  └─────────────────────┘            └──────────┘
```

## Regras de ouro — leia antes de operar

0. **Windows ou Linux? Pergunte antes.** Antes de gerar QUALQUER comando de
   instalação, pergunte ao usuário: *"seu PC é Windows ou Linux (qual distro)?"*
   Os comandos mudam completamente entre eles — nunca assuma, nunca misture.
1. **Destrutivo = confirmado.** Antes de qualquer operação em massa
   (`apply_plan`, muitos `move`/`write_text`), mostre o plano ao usuário e espere
   o OK. Exclusão via `apply_plan`/`delete` vai para a **lixeira** (tem
   `undo_last`), mas mesmo assim confirme.
2. **A trava anticatástrofe é intransponível.** O agente recusa localmente
   fork bomb, `mkfs`, `wipefs`, `dd of=/dev/*`, `shred` em dispositivo, escrita
   em `/dev/sd*` e `rm -r` em alvo de sistema (`/`, `/*`, `/home`, `~`,
   `/boot`, `/etc`, `/usr`, `/var`, `/lib`, `/opt`, `/mnt`, `/media`).
   **Nunca tente contornar** (nem em modo supervisionado com aprovação).
3. **Escopo: a home do usuário.** Pastas sensíveis são bloqueadas no agente:
   `.ssh`, `.gnupg`, `.config`, `.password-store`, `.aws`, `.kube`, `ponte-agent`.
4. **Tokens e senhas nunca aparecem em log.** Token do agente via flag
   `--token` (salva em `ponte.config.json` local). Senha de sudo: só pelo
   padrão seguro da seção "Sudo sem expor senha" (Linux).
5. **Caminhos absolutos.** Caminhos relativos resolvem contra o CWD do agente
   (a pasta onde ele foi iniciado, tipicamente `~/ponte-agent` ou
   `%USERPROFILE%\ponte-agent`) — use sempre `/home/usuario/...` no Linux ou
   `C:\Users\usuario\...` no Windows.
6. **Um comando por vez de qualidade.** Prefira comandos pequenos e legíveis.
   Combine com `&&`/`;` quando fizer sentido (no Windows PowerShell, use `;`).
7. **Instalação sem interface, sem etapa manual.** A configuração do agente são
   dois valores — a URL pública e o `PONTE_AGENT_TOKEN` — e é VOCÊ quem os
   embute no bloco de comandos que entrega ao usuário (Fase 2). Ele só copia,
   cola e roda: não digita token, não abre página, não preenche placeholder.
   O painel do relay é só um visor mínimo (specs da máquina + luz de conexão) —
   nada da instalação ou da operação depende dele.
8. **modo deus: a pergunta é SUA, no CHAT, logo após conectar.** Assim que a
   conexão estiver de pé (`connected:true`), envie um `ping`. Se vier
   `modoDeus:false` e `godModeDeclined` não for `true`, pergunte ao usuário
   AQUI NA CONVERSA — nunca peça para ele digitar nada no terminal:
   *"quer ativar o modo deus? Com ele eu executo comandos sem pedir s/N — a
   trava anticatástrofe, a lixeira e o log continuam valendo."* Ele aceitou →
   envie `god_mode {"enabled":true}` e confirme o resultado. Ele recusou →
   envie `god_mode {"declined":true}` (fica registrado e você NÃO pergunta
   de novo nas próximas sessões; basta ele pedir quando quiser). Se
   `modoDeus` já vier `true`, apenas informe que o modo deus segue ativo.
9. **Feche toda tarefa com `task_done` — sem isso o usuário não vê relatório.** Quando o trabalho termina (última resposta entregue, nada pendente), envie `{"action":"task_done","args":{"resumo":"O QUE foi feito, em 1-4 linhas, linguagem simples para o usuário"}}` como ÚLTIMO comando: o relatório que abre na tela dele mostra esse resumo (NÃO mostra a lista de comandos — seção chama "O QUE FOI FEITO"). Se vier `abriuRelatorio:false`, não houve comandos de trabalho; siga. Quando a PRÓXIMA tarefa começa, o agente sozinho fecha a janela do relatório anterior e apaga o txt.
10. **Comando enfileirado não se perde mais — e não reenvie às cegas.** O relay entrega os pendentes com menos de 24h no reconnect (poll sem cursor) e persiste o estado em `.ponte-estado.json`: queda de rede, agente reiniciado ou Next reiniciado não gera mais comandos órfãos. Antes de reenviar um comando sem resposta, confira `results`/`pending` no `/status` — reenvio duplicado é execução dupla.
11. **Mande o comando para a lane certa.** `POST /cmd` aceita `"lane":"netbook"|"windows"|"test"` — a fila é POR MÁQUINA. Sem lane, o relay 1.3.x usa `netbook` (transição do token único antigo) e logo passa a REJEITAR — informe sempre. Não sabe qual máquina está em cada lane? `/status` mostra (`lanes.<lane>.agentInfo.maquina`). Máquina nova na ponte = token novo para ela (Fase 2) = lane própria nasce junto.

## A ponte já existe? Opere sem hospedar (Claude, Manus, qualquer IA)

As Fases 1 e 2 (relay, túnel, busca de URL, instalação do agente) servem para
quem vai **hospedar** a ponte. Se ela já está no ar — instalada por outra
sessão, outra IA ou outra plataforma — você não cria URL nem token nenhum e
não precisa de interface nem de Python: a ponte é **API HTTP pura**, e qualquer
IA com `curl` opera de qualquer lugar do mundo.

1. Peça ao usuário os dois valores (quem instalou a ponte os entregou prontos
   no bloco de comandos): a **URL pública** e o **ADMIN_TOKEN**.
2. Valide e opere com curl puro — exemplo real, ponta a ponta:

```bash
export PONTE_URL=https://A-URL
export PONTE_ADMIN_TOKEN=o-token-de-admin

# o PC está conectado? (rota PRIVADA do operador — sempre com o header de admin)
curl -s $PONTE_URL/api/ponte/status -H "x-ponte-admin: $PONTE_ADMIN_TOKEN"

# enfileira um comando — diga A QUAL MÁQUINA (lane);
# resposta: {"ok":true,"id":77,"lane":"netbook"}
curl -s -X POST $PONTE_URL/api/ponte/cmd \
  -H "x-ponte-admin: $PONTE_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"lane":"netbook","action":"ping","args":{}}'

# alguns segundos depois (o agente polla a cada 1,5 s), leia desde id-1
curl -s "$PONTE_URL/api/ponte/results?since=76" \
  -H "x-ponte-admin: $PONTE_ADMIN_TOKEN"
```

3. `results?since=X` devolve `{"ok":true,"results":[...],"lastId":M}` — o
   `lastId` é o seu próximo cursor `since`; com `&lane=netbook` (ou `windows`)
   filtra a máquina; sem `lane`, devolve todas. Resultado vazio: ou o agente ainda
   não pollou (releia em 3–5 s) ou está offline (`status` mostra
   `connected:false` — peça ao usuário para religar o agente). Ponte com mais de uma máquina? Confira
   no `/status` qual lane está `conectado:true` antes de mirar.
4. Daí em diante, a tabela da **Fase 4** vale igual — mesmas ações, mesmos
   limites. Texto, JSON e base64 cabem no curl; para arquivos grandes use
   `read_binary`/`read_text` por pedaços (funciona no curl) ou o `ponte.py
   enviar/pegar` na SUA máquina, se tiver Python.

**Sobre a URL de quem hospeda:** a ponte pode rodar num preview de plataforma
(ex.: z.ai) e mesmo assim ser operada por Claude, Manus ou um terminal
qualquer — o relay não sabe nem importa de onde vem o `curl`. Mas a URL é da
plataforma que hospeda: se ela mudar ou sair do ar, só a sessão hospedeira
reemite o bloco com a URL nova. Para uso permanente e independente de
plataforma, hospede o relay num serviço com domínio fixo (VPS, Render,
Railway, Fly.io) — o repo tem tudo em `relay/RESTAURAR.md` — e a URL nunca
mais muda.

## Pré-requisitos — mostre isto ao usuário

No **PC do usuário**, ele precisa de Node.js **18+**, `curl` (Linux) ou
`curl.exe` (Windows já traz nativo) e um terminal. Confira/instale conforme o SO:

| SO/Distro     | Comando para instalar |
|---------------|-----------------------|
| Windows 10/11 | `winget install OpenJS.NodeJS.LTS` (ou baixe do nodejs.org) — `curl.exe` já vem no sistema |
| Arch/CachyOS  | `sudo pacman -S --needed nodejs curl` |
| Debian/Ubuntu | `sudo apt install -y curl && curl -fsSL https://deb.nodesource.com/setup_20.x \| sudo -E bash - && sudo apt install -y nodejs` |
| Fedora        | `sudo dnf install -y nodejs curl` |
| openSUSE      | `sudo zypper install -y nodejs20 curl` |

Verificação: `node --version` (≥ 18) e `curl --version` (Linux) ou
`curl.exe --version` (Windows, no PowerShell use **sempre** `curl.exe` com a
extensão — `curl` sem `.exe` pode ser um alias do `Invoke-WebRequest`).

**Windows: Node instalado agora? Feche e reabra o PowerShell antes de seguir.** `winget` e o instalador do nodejs.org atualizam o PATH do sistema, mas janelas de terminal já abertas continuam sem enxergar o `node` — o comando só passa a existir para janelas NOVAS. Peça ao usuário para fechar TODAS as janelas do PowerShell e abrir uma nova antes de qualquer passo seguinte.

No **servidor onde VOCÊ roda** (VM, container, seu próprio servidor):

- Node.js 18+ (para o relay Next.js) e Python 3 (opcional, para o operador CLI)
- Uma **URL pública HTTPS** apontando para o relay (preview da plataforma,
  túnel como `ngrok`/`cloudflared`, ou servidor próprio) — como descobrir na
  seção **"A URL pública — descubra, nunca adivinhe"** abaixo. O PC do usuário
  só precisa alcançar essa URL.
- `openssl` para gerar os tokens.

## Fase 1 — Subir o relay

```bash
CI=1 npx create-next-app@latest ponte-relay --typescript --app --no-eslint --src-dir --import-alias "@/*"
cd ponte-relay
# copie os arquivos do repo (tabela abaixo), depois:
export PONTE_TOKEN_NETBOOK=$(openssl rand -hex 12)  # agente da máquina 1 (entregue no chat privado)
export PONTE_TOKEN_WINDOWS=$(openssl rand -hex 16)  # agente da máquina 2, se houver
export PONTE_TOKEN_TEST=$(openssl rand -hex 12)     # opcional: agentes de teste na VM
export PONTE_ADMIN_TOKEN=$(openssl rand -hex 16)    # só você usa
npm run dev                                        # porta 3000
```

Tokens um POR MÁQUINA (lane própria) e sempre via ambiente — de preferência no
`.env` do projeto (o Next lê sozinho); nada hardcoded no código, nada
versionado no repo.

**Regra de ouro (houve incidente real de vazamento — não repita):** token
nenhum vai para o repo, para a SKILL.md, para screenshot ou para chat além da
entrega privada inicial ao usuário. `.env`, `.ponte-estado.json`,
`.ponte-seq`, `worklog.md`, logs e o `db/` ficam FORA do git — confira o
`.gitignore` ANTES do primeiro push. Token que apareceu em arquivo versionado
é token QUEIMADO: gere outro (`openssl rand -hex 16`), troque no `.env` da VM
e reinstale na máquina afetada. O `/status` e o painel são PRIVADOS desde o
relay 1.3.1 (header `x-ponte-admin` ou `?admin=`): sem token válido respondem
401 e não revelam nem que as máquinas existem.

Na sua VM, rode o dev server **em background e deixe no ar** (`nohup npm run dev &`,
`setsid` ou `tmux`) — se a sessão morrer, a ponte cai e o agente fica esperando.
Se a porta 3000 estiver ocupada, use `PORT=3001 npm run dev` e espalhe a nova URL
para agente e operador.

| Arquivo deste repo          | Destino no projeto Next.js           |
|-----------------------------|--------------------------------------|
| `relay/ponte-store.ts`      | `src/lib/ponte-store.ts`             |
| `relay/api/poll/route.ts`   | `src/app/api/ponte/poll/route.ts`    |
| `relay/api/result/route.ts` | `src/app/api/ponte/result/route.ts`  |
| `relay/api/cmd/route.ts`    | `src/app/api/ponte/cmd/route.ts`     |
| `relay/api/results/route.ts`| `src/app/api/ponte/results/route.ts` |
| `relay/api/status/route.ts` | `src/app/api/ponte/status/route.ts`  |
| `relay/api/download/route.ts`| `src/app/api/ponte/download/route.ts`|
| `relay/painel/page.tsx`     | `src/app/page.tsx` (painel mínimo de status) |
| `agente/agent.js`           | `download/ponte-agent/agent.js` (a rota `/api/ponte/download` serve este caminho) |

**Next.js 16+ (obrigatório):** versões novas do `create-next-app` vêm com
`cacheComponents: true` no `next.config.ts`, e isso é **incompatível** com o
`export const dynamic = "force-dynamic"` das routes (erro: *Route segment
config "dynamic" is not compatible with nextConfig.cacheComponents*).
Edite `next.config.ts` e deixe apenas `cacheComponents: false`; se existir a
linha `partialPrefetching: true`, **remova-a também** (depende de
`cacheComponents`). Depois reinicie o `npm run dev`.

Valide **local** primeiro: `curl -s -H "x-ponte-admin: $PONTE_ADMIN_TOKEN"
http://127.0.0.1:3000/api/ponte/status` → deve responder
`{"ok":true,"connected":false,...}`; SEM o header deve responder **401** (rota
privada). Se vier HTML de erro 500, releia o log do dev — quase sempre é o
`cacheComponents` do tópico acima.
A validação **pública** (URL que o agente vai usar) vem na seção abaixo — faça
antes da Fase 2.

**Importante:** o dev server precisa **herdar** os tokens exportados. Se
reiniciar o server, reexporte antes. A URL pública do preview pode mudar a
cada rebuild — confira e, se mudar, o agente precisa ser religado com a URL
nova (`--server NOVA_URL --save`).

**Resiliência (relay v1.2.0):** o estado do relay (fila pendente, últimos
resultados, specs do agente, lastSeen) persiste em `.ponte-estado.json` —
editar arquivo/reiniciar o Next não amputa mais histórico nem deixa comandos
órfãos, e a janela de "conectado" é de 45 s (soluço de rede não apaga a luz).

## A URL pública — descubra, nunca adivinhe

> **Você é só o operador (a ponte já existe)?** Esta seção — e a Fase 1 — são
> para quem hospeda o relay. Vá direto para **"A ponte já existe? Opere sem
> hospedar"**: você não precisa de URL nova nem de token novo.

O agente precisa de uma URL pública HTTPS que chegue ao relay. Descubra nesta
ordem — e **nunca teste candidatos inventados** (wildcard, id chutado, grep em
processos): URL errada devolve 404 e só queima tempo e chamadas de ferramenta.

1. **Contexto da plataforma.** Em previews por sessão (ex.: z.ai/space-z), a
   URL é `https://preview-chat-<CHAT_ID>.space-z.ai/` — o `CHAT_ID` é o campo
   `chat_id` do metadata da conversa, que vem anexado ao contexto de CADA
   mensagem. Montar a URL é determinístico — nada de "criar" ou adivinhar: em
   chat da plataforma você sempre o tem. Se a URL mudar (rebuild, nova
   sessão), reenvie o bloco da Fase 2 com a URL nova; o `--save` regrava a
   config do agente sozinho.
2. **Variáveis de ambiente:** `env | grep -iE 'preview|url|host|domain|bot'` —
   muitas plataformas exportam o domínio público ou o id dele.
3. **Pergunte ao usuário** — ele vê a URL na própria janela: *"me cola a URL
   de preview que aparece aí no navegador"*.
4. **Plano B — túnel rápido, sem conta** (se nada acima existir):

   ```bash
   curl -fLo cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
   chmod +x cloudflared && ./cloudflared tunnel --url http://localhost:3000
   ```

   Anote a `https://...trycloudflare.com` impressa no log. (ngrok também
   serve, mas exige conta/authtoken.) Se o túnel cair, reexecute — a URL muda
   a cada execução e o agente precisa ser religado com a nova.

Valide a URL escolhida **antes da Fase 2** — local e público devem responder
o mesmo JSON:

```bash
curl -s http://127.0.0.1:3000/api/ponte/status -H "x-ponte-admin: $PONTE_ADMIN_TOKEN"  # relay no ar
curl -s https://A-URL/api/ponte/status -H "x-ponte-admin: $PONTE_ADMIN_TOKEN"          # roteamento externo OK
# sem o header, ambas devem responder 401 — o status é privado (relay 1.3.1+)
```

Local ok + público 404 = o relay está bem; o problema é roteamento/gateway.
Volte aos passos 1–3 ou use o túnel (4). **Só siga para a Fase 2 com o público
respondendo** — senão o agente do usuário vai pollar para o nada.

## Entrega da configuração — URL e token junto com os comandos

A configuração inteira do agente são dois valores: a URL pública validada
acima e o token DA MÁQUINA (`PONTE_TOKEN_NETBOOK` ou `PONTE_TOKEN_WINDOWS` —
uma lane por máquina; instale cada máquina com o token dela, nunca o mesmo
para as duas). **Não existe etapa de configurar por interface**:
é você quem os embute no bloco de comandos da Fase 2 e entrega pronto ao
usuário. Ele copia, cola e roda — não digita token, não abre página, não
preenche placeholder. O mesmo bloco funciona em bash e no PowerShell e segue
funcionando depois: se a URL de preview mudar, você reenvia o bloco atualizado
e o `--save` regrava a config sozinho.

O painel do relay (`/`) é só um visor: specs da máquina e luz de conexão.
Não existe página de configuração — nenhuma etapa de instalação ou operação
depende de interface — nunca mande ninguém "pegar o token numa página": quem
preenche é você.

## Fase 2 — Instalar o agente no PC do usuário

### Linux

Entregue ao usuário **este bloco com URL e token JÁ preenchidos por você** (a
URL pública validada + o `PONTE_AGENT_TOKEN`) — ele só copia e cola:

```bash
mkdir -p ~/ponte-agent && cd ~/ponte-agent
curl -fso agent.js https://SEU-RELAY/api/ponte/download
node agent.js --server https://SEU-RELAY --token PONTE_AGENT_TOKEN --save
```

### Windows (PowerShell)

```powershell
mkdir "$HOME\ponte-agent" -Force; cd "$HOME\ponte-agent"
curl.exe -fso agent.js https://SEU-RELAY/api/ponte/download
node agent.js --server https://SEU-RELAY --token PONTE_AGENT_TOKEN --save
```

No Windows, caminhos absolutos são `C:\Users\usuario\...`; para religar depois:
`cd $HOME\ponte-agent; node agent.js`. **Nunca** digite `curl` sem `.exe` no
PowerShell antigo — é outro programa. Se o usuário não tem `winget`, o Node vem
do instalador do nodejs.org (marcar "Add to PATH"). Instalou o Node agora? **Feche e reabra o PowerShell** — o PATH novo só entra em janelas abertas depois da instalação; na antiga, `node agent.js` devolve "o termo node não é reconhecido".

No Windows, o dia a dia é pelo **`rodar.bat`** (duplo clique): ele desliga o
QuickEdit do console e manda a saída para `ponte-agent.log` — clique acidental
dentro da janela NÃO congela mais o node (causa provável de agente "travado
com a janela normal"). Para o agente religar sozinho se morrer, deixe o
**`watchdog.bat`** aberto (confere a cada 30 s e religa). Os dois vêm no
repo (`agente/`) e no pacote — a primeira configuração continua sendo o
comando com `--server`/`--token`/`--save` no PowerShell, uma vez só.

A partir do agente **v1.3.0**, o `run_command` funciona nos dois sistemas: no
Linux via `/bin/bash`, no Windows via `cmd.exe` (o shell que o Node usa
nativamente — comandos ensinados ao usuário no Windows devem ser cmd/PowerShell).
A lixeira do agente no Windows é uma **pasta interna**
(`%USERPROFILE%\.local\share\Trash`) com `undo_last` — **não** é a Lixeira do
Windows; diga isso ao usuário se ele perguntar. A trava anticatástrofe também
cobre Windows: bloqueia `format`, `diskpart`, `cipher /w`, `vssadmin delete
shadows` e `rd /s`/`del /s`/`Remove-Item -Recurse` apontando para raiz de
drive, `C:\Windows`, `C:\Program Files` ou `$HOME`.

### Nos dois casos

- Alternativa quando este repo é público:
  `curl -fso agent.js https://raw.githubusercontent.com/micsxnn/ponte-local/main/agente/agent.js`
- Peça para ele **manter o terminal aberto** (o agente roda em primeiro plano;
  o banner mostra modo, escopo e proteções).
- Próximas vezes: `~/ponte-agent/rodar.sh` (Linux, relê `ponte.config.json`) ou
  `cd $HOME\ponte-agent; node agent.js` (Windows).
- URL e token vão **juntos, no mesmo bloco**, preenchidos por você no canal
  privado onde o usuário roda os comandos. Nunca versionados — e nunca
  "pegue numa página": quem preenche é você.

## Fase 3 — Validar a conexão

```bash
python3 operador/ponte.py --status      # connected:true + info da máquina
python3 operador/ponte.py ping          # latência + CPU/RAM/Node
```

O operador `ponte.py` enfileira um comando, espera o resultado (150 s padrão)
e imprime o JSON. Configure antes:

```bash
export PONTE_URL=https://SEU-RELAY
export PONTE_ADMIN_TOKEN=<o mesmo do relay>
export PONTE_LANE=netbook   # a máquina alvo (netbook|windows|test)
```

Detalhe: o primeiro poll do agente (reconexão) **não pula mais a fila**: o
relay entrega os pendentes com menos de 24h do canal dele — o que foi
enfileirado durante a queda chega no reconnect em vez de virar órfão.
Comando com mais de 24h é considerado morto e descartado (nada de lixo de
sessão antiga executando). O `nextCursor` salta para o último id conhecido e
o poll segue normal pelo cursor.

## Fase 4 — Operar (referência das ações)

Envie comandos por `POST /api/ponte/cmd` com header `x-ponte-admin: ADMIN_TOKEN`,
corpo `{"lane":"netbook","action":"...","args":{...}}` (a lane é a máquina alvo;
sem lane o relay 1.3.x usa `netbook` e logo passa a exigir) — ou via `ponte.py`:

```bash
python3 ponte.py <ação> '<args-json>'
python3 ponte.py enviar <arquivo-local> <destino-absoluto-remoto>   # write_binary
python3 ponte.py pegar <origem-absoluta-remota> <arquivo-local>     # read_binary
python3 ponte.py --drain      # lê resultados pendentes
PONTE_WAIT_S=300 python3 ponte.py ...   # espera mais (modo supervisionado)
```

No Windows, os caminhos das ações viram `C:\Users\usuario\...` — o agente
aceita ambos os estilos conforme o SO dele.

| Ação | Args (JSON) | O que faz |
|------|-------------|-----------|
| `ping` | `{}` | Latência, CPU, RAM, Node, modo do agente |
| `list` | `{"path":"C:\\Users\\u\\Downloads"}` | Lista pasta (nome, pasta?, bytes, mtime) |
| `tree` | `{"path":"...","depth":2}` | Árvore (profundidade máx. 4) |
| `read_text` | `{"path":"...","offset":0,"maxBytes":200000,"encoding":"auto"}` | Lê texto de QUALQUER tamanho em pedaços (siga `proximoOffset`); detecta utf-8/cp1252/utf-16/latin1; se for binário, responde com o TIPO em vez de cuspir lixo |
| `write_text` | `{"path":"...","content":"...","overwrite":true}` | Cria/sobrescreve (antigo → lixeira) |
| `search` | `{"path":"...","query":"termo","mode":"name"\|"content"}` | Busca por nome ou conteúdo |
| `mkdir` | `{"path":"..."}` | Cria pasta(s) |
| `move` | `{"from":"...","to":"..."}` | Move/renomeia |
| `rename` | `{"path":"...","newName":"novo.ext"}` | Renomeia no mesmo lugar |
| `delete` | `{"path":"..."}` ou `{"paths":["...","..."]}` | Move para a lixeira do agente (recuperável); recusa apagar a home inteira |
| `restore` | `{"trashName":"..."}` | Restaura item da lixeira no lugar original (use o `trashName` devolvido pelo delete) |
| `organize_plan` | `{"path":"/home/u/Downloads"}` | Propõe plano de organização por tipo (não executa!) |
| `apply_plan` | `{"plan":[{"de":"/a/b.txt","para":"/c/b.txt"}]}` | Executa movimentos em lote (mostre o plano antes) |
| `undo_last` | `{}` | Desfaz a última operação (lixeira/lote) |
| `free_space` | `{}` | Espaço livre/total dos discos |
| `disk_usage` | `{"path":"...","depth":2}` | Tamanho por subpasta |
| `duplicates` | `{"path":"...","minSizeBytes":1048576}` | Duplicados (tamanho→md5) + espaço recuperável |
| `read_binary` | `{"path":"...","offset":0,"maxBytes":4194304}` | Binário em base64 por pedaços (≤ 6 MB/chamada) — junte os base64 NA ORDEM; o arquivo pode ter qualquer tamanho |
| `file_info` | `{"path":"..."}` | Tipo REAL do arquivo (magic bytes: png, jpeg, pdf, zip, exe, mp4, sqlite, gzip, iso…) + tamanho + encoding se for texto + dica de como ler |
| `write_binary` | `{"path":"...","base64":"...","overwrite":true}` | Grava binário (máx 8 MB) |
| `run_command` | `{"command":"...","cwd":"C:\\Users\\u","timeoutMin":3}` | Shell — exige modo habilitado (abaixo) |
| `god_mode` | `{"enabled":true}` / `{"enabled":false}` / `{"declined":true}` | modo deus: liga (APENAS após o usuário aceitar NO CHAT — a IA pergunta, zero prompt no terminal) / desliga (direto) / registra recusa — seção própria abaixo |
| `skill_update` | `{}` | Força o download da SKILL.md mais recente deste repo; devolve `atualizou`, `de`, `para`, `versaoLocal` (o agente também atualiza sozinho no boot e a cada 60 s) |
| `task_done` | `{"resumo":"..."}` | **Fecha a tarefa** — grava `relatorio-ponte.txt` mostrando O QUE FOI FEITO (o seu `resumo` em texto; sem lista de comandos; seção `FALHAS` só se algo errou) e abre no editor do usuário (Windows `start`, Linux `xdg-open`, macOS `open`); ÚLTIMO comando de toda tarefa; devolve `abriuRelatorio`; a tarefa seguinte fecha a janela anterior e apaga o txt |

Resposta de cada comando: `{"id","ok","data"|"error","durationMs","ts"}`.

## Lendo qualquer arquivo — formato e tamanho (agente v1.4.0)

Não existe mais "arquivo grande demais" nem "formato desconhecido". A receita,
igual no Linux e no Windows:

1. **Pergunte o que é**: `file_info` → tipo real por magic bytes (png, jpeg,
   pdf, zip, exe, mp4, sqlite, ole/doc-antigo, gzip, iso…), tamanho e, se for
   texto, o encoding detectado (utf-8, windows-1252, utf-16le/be, latin1).
2. **Texto**: `read_text` e siga `proximoOffset` até vir `null` — cada resposta
   traz `encoding`, `lidos`, `truncado` e `caracteres`. Se o encoding não for
   `utf-8`, passe `"encoding"` explícito nos pedaços seguintes (a própria
   `dica` da resposta avisa — importante para cp1252/utf-16 byte-exato).
3. **Binário**: `read_binary` com `{"offset": proximoOffset}` e junte os
   `base64` NA ORDEM. Pedaço máximo 6 MB (padrão 4 MB em arquivos grandes);
   arquivos até 6 MB continuam vindo inteiros numa chamada só, como antes.
4. `read_text` em binário NÃO devolve lixo: responde `{"provavelBinario":
   true, "tipo": "png", ...}` — mude para `read_binary`/`file_info`.
5. Texto utf-16 sem BOM é marcado como binário pela amostra — use
   `file_info` + `encoding` explícito; com BOM, o `auto` decodifica direto.

Exemplo — confirmar o formato de um vídeo de 2 GB e espiar o header, sem
nunca carregar o arquivo inteiro:

```json
{"action":"file_info","args":{"path":"C:\\Users\\u\\Videos\\a.mp4"}}
{"action":"read_binary","args":{"path":"C:\\Users\\u\\Videos\\a.mp4","maxBytes":65536}}
```

`file_info` responde `{"tipo":"mp4","bytes":2147483648,...}` e o primeiro
pedaço traz os bytes do cabeçalho em base64. O mesmo funciona para log de
1 GB (`read_text` em pedaços de 200 KB) e para ISO/imagem de disco.

## `run_command` — os 3 modos (escalada é FÍSICA)

| Modo | O usuário religa com | Comportamento |
|------|----------------------|---------------|
| Desligado (padrão) | `node agent.js` | `run_command` negado; só operações de arquivo |
| Supervisionado | `node agent.js --allow-run --save` | Caixa no terminal dele, `s`/`N` em 60 s; sem resposta = rejeita |
| Autônomo | `node agent.js --auto --save` | Executa direto, loga `[AUTO] $ cmd`, trava anticatástrofe ativa |
| **modo deus** | a IA pergunta NO CHAT após conectar e, com o aceite do usuário, envia `god_mode {"enabled":true}` | Igual ao autônomo: sem `s/N` (log `[deus] $ cmd`); trava anticatástrofe, lixeira e log continuam; desliga com `god_mode {"enabled":false}` — nada é digitado no terminal |

Só o usuário pode trocar de modo (digitar o flag no terminal DELE). Peça com
clareza, ex.: *"Ctrl+C no terminal do agente e rode `node agent.js --auto --save`
— isso me dá execução direta com a trava anticatástrofe, ok?"* (no Windows,
`Ctrl+C` e o mesmo comando no PowerShell).

Ao comandar em modo supervisionado, use `PONTE_WAIT_S=150` (ou mais) — a
espera padrão do operador precisa cobrir os 60 s do prompt + execução.

## modo deus + skill que se atualiza sozinha (agente v1.5.1)

**modo deus** = o agente para de pedir confirmação `s/N` para `run_command`.
O que NÃO muda de jeito nenhum: trava anticatástrofe (bloqueio físico de
`rm -rf` em raiz/home/sistema, `mkfs`, `dd` em disco, fork bomb…), pastas
sensíveis bloqueadas, exclusões via lixeira com `undo_last` e o log
`ponte-log.jsonl`.

- **Ativação — conversacional, e a pergunta é OBRIGATÓRIA.** Nada de caixa
  s/N no terminal: a decisão acontece AQUI na conversa. Assim que a ponte
  estiver conectada (`connected:true`), mande um `ping` — se vier
  `modoDeus:false` e `godModeDeclined` não for `true`, pergunte ao usuário
  no chat (explique: comandos sem s/N; trava anticatástrofe, lixeira e log
  continuam). Com o aceite, envie
  `{"action":"god_mode","args":{"enabled":true}}` — o agente aplica na hora
  e devolve `godMode:true`. Confirme para o usuário.
- **Recusa também é conversacional.** Usuário disse não? Envie
  `{"action":"god_mode","args":{"declined":true}}` — fica registrado e você
  NÃO pergunta de novo nas sessões seguintes (basta ele pedir quando
  quiser). Um aceite novo limpa a recusa sozinho.
- **Desativação — livre.** `{"action":"god_mode","args":{"enabled":false}}`
  desliga na hora (tornar mais seguro nunca pede confirmação); ao desligar,
  o `run_command` volta ao modo anterior (supervisionado volta a pedir
  `s/N`). O estado atual aparece no `ping` (`modoDeus`, `godModeDeclined`)
  e no banner do agente.

**Skill auto-atualizada.** O agente baixa a `SKILL.md` mais recente deste
repo (raw.githubusercontent) no boot e a cada 60 s, salvando em
`~/ponte-agent/SKILL.md` (Windows: `%USERPROFILE%\ponte-agent\SKILL.md`).
A IA que opera DENTRO do PC do usuário deve preferir esse arquivo local —
é sempre a versão vigente. A versão da skill vai no marcador
`<!-- skill-version: X.Y.Z -->` no topo do arquivo. Verifique/force com
`{"action":"skill_update","args":{}}` (devolve `atualizou`, `de`, `para`,
`versaoLocal`); o `ping` também traz `skill`, `modoDeus` e `godModeDeclined`. Detalhe de
operador: logo após um commit novo, o cache do raw.githubusercontent pode
levar ~5 min para expirar — o `skill_update` devolve erro elegante ("sem
marcador") e basta tentar de novo minutos depois.

**Relatório da tarefa (agente v1.8.0) — sem cronômetro e sem lista de comandos.** Quem decide que a tarefa acabou é VOCÊ: feche com `task_done` e um `resumo` em texto (o QUE foi feito, linguagem para o usuário) e o agente, na hora, grava `relatorio-ponte.txt` na pasta dele — cabeçalho (máquina, início/fim, duração, modo, contagem de comandos), seção **O QUE FOI FEITO** com o seu resumo numerado, seção **FALHAS** só se algum comando errou — e abre no editor de texto padrão do usuário: Windows via `start` (fallback `explorer.exe`), Linux via `xdg-open` (fallbacks `gio open`, `kde-open5`/`kde-open`), macOS via `open`. Quando a tarefa SEGUINTE começa (primeira ação de trabalho), o agente FECHA a janela do relatório anterior na tela e apaga o txt (inclusive sobras `relatorio-ponte-*.txt`); no boot do agente, idem. `ping` e `task_done` não entram na contagem; `task_done` sem comandos de trabalho devolve `abriuRelatorio:false`, não abre nada e não mexe no relatório anterior. Ao encerrar (`Ctrl+C`) o agente sai direto, sem relatório. Para a IA: o usuário verá o relatório abrir sozinho na tela dele — confirme o resultado no chat em uma frase, sem repetir o resumo inteiro.

## Sudo sem expor senha (padrão seguro) — Linux, só com autorização explícita

*(No Windows não há sudo: `run_command` roda com os privilégios do usuário do
terminal. Se um comando precisar de admin, peça para o usuário fechar o agente
e reabrir o PowerShell com "Executar como administrador" antes de religar — a
decisão continua sendo fisicamente dele.)*

Quando um comando precisa de sudo e o usuário autorizou (idealmente forneceu a
senha ou já configurou NOPASSWD):

1. `write_text` → `/home/u/Downloads/.tmp-senha` com `content: "SENHA\n"`
   (a senha viaja no corpo do comando, **nunca** dentro de um shell em log)
2. `run_command` → `sudo -S bash -c 'COMANDO_REAL' < /home/u/Downloads/.tmp-senha`
3. `run_command` → `rm -f /home/u/Downloads/.tmp-senha` (rm real via shell —
   a ação `delete` iria para a lixeira e a senha ficaria recuperável!)

Se o usuário quiser NOPASSWD permanente, só com pedido explícito dele:

```bash
sudo -S bash -c 'echo "usuario ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/90-nopasswd \
  && chmod 440 /etc/sudoers.d/90-nopasswd \
  && (visudo -c >/dev/null 2>&1 && echo OK || rm -f /etc/sudoers.d/90-nopasswd)' < .tmp-senha
```

`visudo -c` valida e o rollback remove o arquivo se a sintaxe estiver errada —
**nunca deixe um sudoers inválido no disco** (quebra o sudo da máquina).

## Troubleshooting

| Sintoma | Causa | Correção |
|---------|-------|----------|
| `Comando vazio` no `run_command` | chave errada no args | a chave é **`command`**, não `comando` |
| `Pasta protegida no caminho: ponte-agent` | caminho relativo resolveu contra o CWD do agente (a pasta dele é bloqueada) | use **caminho absoluto** (`/home/u/...` ou `C:\Users\u\...`) |
| `Pasta protegida: .ssh/.config/...` | pasta sensível bloqueada | respeite; peça ao usuário, se preciso, por outro caminho |
| PowerShell: "o termo curl não é reconhecido" ou resposta HTML | `curl` sem `.exe` virou `Invoke-WebRequest` | use **`curl.exe`** (com a extensão) |
| PowerShell: "o termo node não é reconhecido" logo após instalar o Node | o PATH novo não entra em janelas de terminal já abertas | feche TODAS as janelas do PowerShell, abra uma nova e repita o comando |
| Relatório da tarefa não abriu | Linux sem ambiente gráfico (SSH/servidor) | o arquivo está em `~/ponte-agent/relatorio-ponte.txt` — o agente avisa no terminal; abra no editor do usuário |
| Agente não conecta (`connected:false`) | URL/token errados ou server reiniciou sem tokens | confira `--server`, reexporte tokens, religue o agente |
| `TEMPO ESGOTADO` com agente conectado | baseline do operador maior que os ids da instância nova | apague `.ponte_since_prod` em `PONTE_STATE_DIR` (corrigido: fallback é 0) |
| `TEMPO ESGOTADO` em modo supervisionado | ninguém apertou `s` | reenvie; use `PONTE_WAIT_S=150+` |
| `Fila de comandos cheia` | agente offline/travado acumulando além de 100 | verifique `--status`; religue o agente — pendentes <24h drenam sozinhos no reconnect |
| Agente Windows "congela" com a janela parecendo normal | QuickEdit do console: um clique dentro da janela congela o stdout do node | rode pelo `rodar.bat` (log em arquivo + QuickEdit off); opcional: `watchdog.bat` religa sozinho |
| Relay reiniciou e perdeu fila/histórico | relay < v1.2.0 (estado só em RAM) | atualize `relay/` do repo: snapshot em `.ponte-estado.json` sobrevive a restart |
| `Lane inválida "x"` (400 no /cmd) | lane fora da lista ou digitada errada | use `netbook`, `windows` ou `test`; o `/status` mostra as lanes e qual máquina está em cada uma |
| `Fora do escopo` | caminho fora da home | só a home do usuário é permitida (Linux: `/home/u/**`; Windows: `C:\Users\u\**`) |
| Pedaço de leitura falha | pedaço > 6 MB (`read_binary`) ou > 2 MB (`read_text`) | o ARQUIVO pode ter qualquer tamanho — reduza só o `maxBytes` do pedaço e siga o `proximoOffset` |
| Comando some após rebuild do relay | URL de preview mudou | religue agente com `--server NOVA_URL --save` |

## Limites técnicos

| Limite | Valor |
|--------|-------|
| Corpo de requisição na ponte | 12 MB |
| Pedaço de `read_text` | 2 MB por chamada (padrão 200 KB) |
| Pedaço de `read_binary` | 6 MB por chamada (padrão 4 MB em arquivos grandes) |
| Tamanho do ARQUIVO lido | ilimitado — leitura por pedaços (`offset` → `proximoOffset`) |
| Binário gravado (`write_binary`) | 8 MB |
| Timeout por `run_command` | 30 min |
| Resposta do comando | 150.000 caracteres |
| Tamanho do comando | 4.000 caracteres |
| Fila de comandos pendentes | 100 |
| Histórico de resultados | 400 |
| Janela "conectado" | 45 s sem poll |
| Pendente na fila | entregue no reconnect se <24h; mais velho que isso é descartado |
| Snapshot do relay | `.ponte-estado.json` (fila pendente + últimos 400 resultados; sobrevive a restart) |
| Lanes | 3 por relay (`netbook`, `windows`, `test`) — uma fila independente por máquina |

## Atualizar o agente no PC do usuário

```bash
# nova versão deste repo: baixe e envie via write_binary para ~/Downloads/ (ou C:\Users\u\Downloads)
# no PC do usuário (Linux):
cp ~/Downloads/agent-vNOVA.js ~/ponte-agent/agent.js
# no PC do usuário (Windows/PowerShell):
copy "$HOME\Downloads\agent-vNOVA.js" "$HOME\ponte-agent\agent.js"
# Ctrl+C no agente e religue no modo escolhido (--auto --save / --allow-run --save)
# ao religar, entregue URL e token JÁ preenchidos no mesmo comando:
#   node agent.js --server https://URL-ATUAL --token AGENT_TOKEN --save
```

## Estrutura deste repo

```
SKILL.md       ← este arquivo (instruções para você, IA)
agente/        agent.js + LEIA-ME.md + rodar.sh + atualizar.sh + rodar.bat + watchdog.bat  (lado do PC)
relay/         ponte-store.ts + api/ponte/*/route.ts + painel/ + RESTAURAR.md (lado do servidor)
operador/      ponte.py + teste-ponte*.sh  (CLI da IA na VM)
```
