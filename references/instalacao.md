<!-- referência da skill ponte-local. A spec de entrada é ../SKILL.md. -->

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
│                          painel/, RESTAURAR.md (reconstruir o relay após
│                          reset da VM de preview)
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
# NÃO ponha comentário na MESMA linha do valor: o comando de validação
# abaixo faz cut no "=" e um "# ..." na linha suja o header (401 falso).
PONTE_ADMIN_TOKEN=cole-aqui-o-valor-gerado
PONTE_TOKEN_MAQUINA_1=cole-aqui-o-valor-gerado
# PONTE_TOKEN_MAQUINA_2=cole-aqui-o-valor-gerado   ← só se houver 2ª máquina
```

> **`relay/iniciar-relay.sh` não está neste repo.** O texto abaixo cita o
> script como caminho para hospedagem que apaga `.env`. Se o arquivo não
> existir, não invente o conteúdo: suba com `nohup npm run dev` e exporte
> os tokens no ambiente do processo antes. Não recoloque `PONTE_*` num
> `.env` que a plataforma apaga.

> **Hospedagem que apaga credencial de `.env`?** Algumas sandboxes/VMs de
> plataforma fazem isso — o relay recarrega e as lanes caem (o "token que
> some toda hora"). Nelas use o mecanismo **tokens eternos**: os tokens
> moram num arquivo irmão `.env.ponte` (que essas plataformas ignoram) e são
> **exportados no ambiente do processo** pelo `relay/iniciar-relay.sh` do
> repo (ele sobe, espera e valida o relay; `--reiniciar` força). Nesse modo
> o `.env` fica SEM `PONTE_*` de propósito — estado correto, não defeito:
> NÃO re-adicione. Os comandos abaixo funcionam nos dois modos (o `grep`
> consulta `.env` e `.env.ponte`).

Carregue o token de admin AGORA — os curls dos Passos 2, 3 e 5 usam
`$PONTE_ADMIN_TOKEN` (exportar só no § 4 é tarde):

```bash
# ONDE: no seu servidor/VM (na pasta do relay)
export PONTE_ADMIN_TOKEN=$(grep -hE '^PONTE_ADMIN_TOKEN=' .env .env.ponte 2>/dev/null | head -n1 | cut -d= -f2-)
```

**Regras do nome da lane (onde TODO agente se confunde — leia devagar):**

- O nome da lane vem do **sufixo** da variável, em minúsculas:
  `PONTE_TOKEN_MAQUINA_1` cria a lane `maquina_1`. Quer `escritorio`?
  `PONTE_TOKEN_ESCRITORIO`.
- O sufixo só aceita **A-Z, 0-9 e `_`** — variável de ambiente NÃO aceita
  hífen. Uma lane "maquina-1" nunca vai existir; a certa é `maquina_1`.
- Teto de TAMANHO: a lane (sufixo em minúsculas) tem no máximo 32 caracteres —
  sufixo maior é descartado EM SILÊNCIO no boot; sintoma: "lane sem token" com
  a linha certa no `.env`.
- Máquina nova = linha nova no `.env` (ou no `.env.ponte`, no modo tokens
  eternos). Nunca o mesmo token em duas máquinas — a lane É a máquina.
- Aliases legados que ainda valem (transição do token único):
  `PONTE_AGENT_TOKEN` → lane `netbook`; `PONTE_TEST_TOKEN` → lane `test`.
- **Trocou ou criou token no `.env`? REINICIE o relay.** A lane nasce no boot;
  sem restart o `/cmd` responde "lane sem token" e você vai achar que é erro
  de digitação. (É para reiniciar que serve esta lista: token criado, token
  trocado, máquina nova no `.env` — sempre restart.) No modo tokens eternos,
  edite o `.env.ponte` e reinicie com `bash relay/iniciar-relay.sh --reiniciar`.

Suba o relay **já em background** (se a sessão morrer, a ponte cai):

```bash
# ONDE: no seu servidor/VM
nohup npm run dev > relay.log 2>&1 &   # porta 3000 (ocupada? PORT=3001 npm run dev)
# hospedagem que limpa .env? em vez do nohup acima:
bash relay/iniciar-relay.sh            # sobe com os tokens no ambiente do processo
```

Subiu em outra porta? Troque o `3000` em TODOS os comandos seguintes — curls
de validação, túnel do Passo 3 e exemplos do § 4 (o `PONTE_URL` do `ponte.py`
também aponta para `http://127.0.0.1:3000` por padrão).

Valide **local**:

```bash
# ONDE: no seu servidor/VM
curl -s -H "x-ponte-admin: $(grep -hE '^PONTE_ADMIN_TOKEN=' .env .env.ponte 2>/dev/null | head -n1 | cut -d= -f2-)" \
  http://127.0.0.1:3000/api/ponte/status
# esperado: {"ok":true,"connected":false,"lanes":{...},"version":"..."}
# SEM o header: 401 — o status é privado. 401 COM header? valor sujo
# (comentário na linha do .env) ou .env não recarregado — reinicie o relay.
# HTML 500? Veja o cacheComponents acima.
```

O estado do relay persiste em `.ponte-estado.json` (fila pendente, últimos
resultados, specs): editar arquivo/reiniciar o Next não amputa histórico, e a
janela de "conectado" é de 45 s (soluço de rede não apaga a luz). Para escolher
a pasta de estado em VPS/container: `PONTE_DATA_DIR`.

### Passo 3 — URL pública: descubra, valide, nunca adivinhe

O agente precisa de uma URL pública HTTPS que chegue ao relay. Descubra NESTA
ordem — nunca teste candidatos inventados (URL errada = 404 e tempo queimado):

1. **Contexto da plataforma** (SÓ vale em preview de plataforma, tipo
   z.ai/space-z): a URL é `https://preview-chat-<CHAT_ID>.space-z.ai/` — o
   `CHAT_ID` vem no metadata de cada mensagem da conversa. Determinístico;
   nada de adivinhar. Em VPS ou outra plataforma, pule direto para o 2 ou 3.
2. **Variáveis de ambiente:** `env | grep -iE 'preview|url|host|domain|bot'`.
3. **Pergunte ao usuário** — **Diga assim:** "me cola a URL de preview que
   aparece aí no topo do navegador".
4. **Plano B — túnel sem conta:**

```bash
# ONDE: no seu servidor/VM — túnel em SEGUNDO plano (primeiro plano trava o shell)
curl -fLo cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x cloudflared
nohup ./cloudflared tunnel --url http://localhost:3000 > tunel.log 2>&1 &
grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' tunel.log | head -1
# ngrok também serve; exige conta
```

ATENCAO: A URL do trycloudflare **MUDA a cada execução do túnel**: caiu, a ponte
cai — reerga e religue o agente com `--server NOVA_URL --save` (§ 6). Por
isso, URL de plataforma ou domínio fixo vencem o túnel sempre.

Valide local E público num bloco só (mesmo JSON nos dois = roteamento OK):

```bash
# ONDE: no seu servidor/VM
curl -s http://127.0.0.1:3000/api/ponte/status -H "x-ponte-admin: $PONTE_ADMIN_TOKEN"  # relay no ar
curl -s https://URL_DA_PONTE/api/ponte/status   -H "x-ponte-admin: $PONTE_ADMIN_TOKEN" # roteamento externo OK
# ambas sem header → 401. Local ok + público 404 = problema de roteamento/gateway.
```

**Portão do Passo 3 — atravesse só com as 3 PROVAS:**

1. `curl` LOCAL devolve JSON `ok:true`;
2. `curl` PÚBLICO devolve o MESMO JSON;
3. `curl -fsS https://URL_DA_PONTE/api/ponte/download | head -c 40` devolve
   **JavaScript** (começa com `const`/`#!`…), NÃO um JSON de erro — JSON de
   erro aqui = faltou copiar `agente/agent.js → download/ponte-agent/`
   (tabela do Passo 2).

Sem as três, o agente do usuário vai pollar para o nada — ou instalar um
`agent.js` que nem é JavaScript.

### Passo 4 — Instalar o agente NA MÁQUINA do usuário

**Duas formas. Entregue o `npx` (forma A) — é o caminho oficial, não instala
nada e não depende de a IA montar bloco nenhum.**

#### Forma A — `npx` (oficial, recomendada)

O agente é o pacote npm `ponte-local`. O `npx` baixa e roda na hora:

```bash
npx ponte-local start --server https://URL_DA_PONTE --token TOKEN_DA_MAQUINA_X --save
```

- Na primeira vez, se rodar **sem** `--server`/`--token`, o `npx` pergunta a
  URL e o token no terminal e salva a config.
- Das próximas vezes é só `npx ponte-local start`.
- `npx ponte-local help` mostra todas as opções (e os dois lados).
- Os dados (config, log, relatório, SKILL.md baixada) ficam em
  `~/ponte-agent/` — **fora** do pacote, porque o cache do `npx` é efêmero.
  `PONTE_HOME` muda esse lugar.

**Diga assim:** "copia e cola esse comando no terminal. Ele baixa o
programinha e já conecta. Na próxima vez é só `npx ponte-local start`."

#### Forma B — manual (sem `npx`)

Só se o usuário disser que **não** pode usar `npx` (ou não tem internet para
baixar o pacote): baixe o `agent.js` e rode com `node` — bloco de entrega
logo abaixo.

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

**OPCIONAL — só se a IA quiser tirar print da tela** (`screenshot` /
`screenshot_window`): o resto do agente é zero-dependências, mas a captura
precisa de uma ferramenta que a distro já traz. No Windows não é preciso
nada (PowerShell + System.Drawing são nativos). No Linux:

| Sessão | Pacote | Janela por título? |
|--------|---------|--------------------|
| X11 | `imagemagick` (+ `xdotool`) | sim |
| X11 | `scrot` ou `maim` | não (só tela inteira) |
| Wayland/KDE | `spectacle` | janela em foco |
| Wayland/Hyprland | `hyprshot` | janela em foco |
| Wayland/GNOME | `gnome-screenshot` | janela em foco |
| Termux | `termux-api` | não |

```bash
sudo pacman -S --needed imagemagick xdotool   # Arch/CachyOS
sudo apt install -y imagemagick xdotool        # Debian/Ubuntu
sudo dnf install -y ImageMagick xdotool        # Fedora
```

ATENCAO: **No Wayland** o compositor não expõe as janelas de forma genérica: a
`screenshot_window` captura a janela **em foco** e avisa em `janela.aviso`.
No X11 e no Windows a janela pedida é capturada exata.

**REGRA DA IA — a captura depende do usuário instalar uma ferramenta.** As
ações `screenshot`/`screenshot_window` usam o que a distro tem; se a ação
voltar com "Não consegui capturar a tela" (ferramenta ausente), a IA **DEVE**:

1. **perguntar ao usuário** qual a distro e a sessão gráfica
   (`echo $XDG_SESSION_TYPE` → `x11` ou `wayland`);
2. **mandar o comando de instalação** da tabela acima (NUNCA inventar
   pacote: `import` é do `imagemagick`, `scrot` é do `scrot`);
3. **esperar a instalação** e só então repetir a ação;
4. **nunca** contornar com `run_command` e **nunca** dizer que capturou
   sem ter capturado.

Ofereça caminho sem print: "se preferir não instalar nada, eu sigo sem
tirar print — funciona igual".

### O agente e a skill se atualizam sozinhos

**A skill** (pacote inteiro, não só um arquivo)

A skill é um **PACOTE** de arquivos, não um `.md` solto. O repo publica um
**manifesto** (`skill-manifest.json`) que lista tudo o que deve estar na
máquina do usuário:

- `SKILL.md` — a spec que você (a IA) lê
- `agente/SKILL.md` — a variante para a IA dentro da máquina
- `agente/LEIA-ME.md` — o manual do usuário
- `skill/**` — qualquer recurso novo que o repo adicione

**Quem atualiza:**
- **O agente** (na máquina do usuário) baixa o pacote inteiro sozinho, no boot
  e a cada 60 s. Arquivo **novo** da skill chega sem precisar mudar código:
  o manifesto é a fonte da verdade.
- **O usuário** pode forçar a qualquer momento: `npx ponte-local update`
  (baixa o agente novo + o pacote inteiro da skill, inclusive arquivos novos).

**Quando o pacote muda, o que o usuário vê** (no terminal dele, sem entender
de manifesto):

```
  ┌──────────────────────────────────────────────┐
  │  Skill atualizada: v4.3.0 -> v4.4.0          │
  └──────────────────────────────────────────────┘
    4 arquivo(s) atualizado(s) (incluindo 2 novo(s))
    A IA ja usa a versao nova. Nada a fazer.
```

**Quando o usuário dispara `skill_update` pela IA**, a resposta traz a
versão antiga, a nova e a lista de arquivos que entraram/saíram.

**O `agent.js` também se atualiza sozinho** (v1.19.0): a cada 30 min o agente
checa se há versão nova no repo, baixa, valida com `node --check` e a deixa
pronta (`agent.novo.js`). No **próximo boot** ela entra em vigor, com o
arquivo anterior guardado como `agent.js.bak`. O agente não se troca em
execução (seria perigoso) — ele avisa no terminal:

```
  ┌──────────────────────────────────────────────┐
  │  Nova versao do agente: v1.19.0              │
  └──────────────────────────────────────────────┘
    Baixada e validada. Reinicie o agente para usar.
```

Tudo isso é **Node puro** (sem shell, sem `bash`, sem `curl`), então funciona
igual no Linux (qualquer distro), no Windows, no macOS e no Termux. Se o
usuário estiver rodando do cache do `npx`, o próprio `npx` já resolve a versão
nova do npm — o agente avisa e não mexe no cache.

### Digitar no teclado — o agente PRECISA ENSINAR o usuário a instalar

As ações `keyboard_type` e `keyboard_key` **não funcionam sozinhas**: elas
dependem de uma ferramenta de injeção de teclado que o sistema precisa ter.
O resto do agente é zero-dependências, mas o teclado não é.

**REGRA:** se a ação voltar com erro de "ferramenta ausente" (ou "Não consegui
digitar"), a IA **DEVE** pedir ao usuário para instalar — nunca fingir que
digitou, nunca contornar com `run_command`.

| Onde | Precisa de | Comando |
|------|-----------|---------|
| **Windows** | nada | PowerShell + SendInput já vêm no sistema |
| **Linux Wayland** | `ydotool` | `sudo pacman -S --needed ydotool` + `sudo usermod -aG input $USER` (relogin) |
| **Linux X11** | `xdotool` | `sudo pacman -S --needed xdotool` |
| **macOS** | `cliclick` | `brew install cliclick` |
| **Termux** | `input` do Android | requer aparelho rooteado (INJECT_EVENTS) |

**Como descobrir a sessão gráfica** (X11 ou Wayland) — peça para o usuário
rodar:

```bash
echo $XDG_SESSION_TYPE
```

**Diga assim ao usuário:** "para eu digitar no seu teclado, seu sistema
precisa de uma ferramenta de injeção — no seu caso é `sudo pacman -S --needed
ydotool`. É do sistema, não mexe em nada seu. Quer que eu instale?"

ATENÇÃO: **A TRAVA CONTINUA VALENDO PARA O TECLADO.** Digitar `rm -rf /` num
terminal é tão destrutivo quanto executar — e é recusado do mesmo jeito. O
agente mantém um **buffer da linha do prompt**: o que a IA digita vai
acumulando e a trava olha a linha inteira. Se a linha virar destrutiva, a
digitação é recusada na hora.

ATENÇÃO: **COLAR É BLOQUEADO** (`ctrl+v`, `shift+insert`, `ctrl+insert`):
o conteúdo colado não passaria pela trava. A IA tem que **digitar** o texto,
nunca colar.

ATENÇÃO: **TAB É BLOQUEADO**: no shell ele *completa* o comando, e a trava
nunca veria o resultado da completion. A IA digita o caminho inteiro.

ATENÇÃO: **ATALHOS DESTRUTIVOS SÃO BLOQUEADOS**: `alt+f4` (fecha a janela e
perde trabalho não salvo), `ctrl+alt+delete`, `ctrl+shift+delete`,
`super+r`, `super+q`, `super+l`, `ctrl+w`.

ATENÇÃO: **O TECLADO EXIGE O MODO HABILITADO** — igual ao `run_command`. No modo
supervisionado, o usuário aprova **cada digitação** com `s`/`N` no terminal
dele (60 s). No autônomo, vai direto, com a trava ativa.

ATENÇÃO: **O AGENTE NÃO SABE EM QUE APP VAI DIGITAR** (terminal? editor? caixa
de senha?). A trava presume um prompt de shell. Antes de digitar em algo
sensível, a IA deve **ler a tela** (`screenshot`) para saber o que é.

### Mexer no mouse — o agente PRECISA ENSINAR o usuário a instalar

As ações `mouse_move`, `mouse_click`, `mouse_scroll`, `mouse_drag` e
`mouse_position` **não funcionam sozinhas**: elas dependem de uma ferramenta
de controle do mouse que o sistema precisa ter. O resto do agente é
zero-dependências, mas o mouse não é.

**REGRA:** se a ação voltar com erro de "ferramenta ausente" (ou "Não consegui
... no mouse"), a IA **DEVE** pedir ao usuário para instalar — nunca fingir
que mexeu no mouse, nunca contornar com `run_command`.

| Onde | Precisa de | Comando |
|------|-----------|---------|
| **Windows** | nada | PowerShell + user32 já vêm no sistema |
| **Linux X11** | `xdotool` | `sudo pacman -S --needed xdotool` |
| **Linux Wayland** | `ydotool` ou `dotool` | `sudo pacman -S --needed ydotool` + `sudo usermod -aG input $USER` (relogin) + `systemctl --user enable --now ydotool` |
| **Termux** | `termux-api` | `pkg install termux-api` |
| **macOS** | `cliclick` | `brew install cliclick` |

**Como descobrir a sessão gráfica** (X11 ou Wayland) — peça para o usuário
rodar:

```bash
echo $XDG_SESSION_TYPE
```

ATENCAO: **No Wayland o `xdotool` NÃO serve**: ele mexe só no cursor do XWayland
(aplicativos X11), não no cursor real do compositor. O agente tenta o
`ydotool` primeiro e, se cair no `xdotool`, a resposta vem com `aviso` —
**a IA DEVE ler esse aviso** e, se ele estiver lá, avisar o usuário de que o
mouse não vai ser controlado de verdade.

**Diga assim ao usuário:** "para eu mexer no seu mouse, seu sistema precisa
de uma ferramenta de controle — no seu caso é `sudo pacman -S --needed
xdotool`. É do sistema, não mexe em nada seu. Quer que eu instale?"

ATENCAO: **CLIQUE É AÇÃO DE CONSEQUÊNCIA.** Um clique pode apertar "Apagar",
"Confirmar", "Finalizar compra", "Enviar". Antes de clicar, a IA **tem que
ler a tela** (`screenshot`) para saber o que está sob o cursor, e quando o
alvo for destrutivo ou irreversível, **confirmar com o usuário no chat**.

ATENCAO: **Windows: Node instalado AGORA? Feche TODAS as janelas do PowerShell e
abra uma NOVA antes de seguir.** O PATH novo não entra em janelas que já
estavam abertas — na janela velha, `node agent.js` devolve "o termo node não
é reconhecido". **Diga assim:** "fechou todas as janelas do PowerShell? abre
uma nova, aí sim cola o bloco abaixo".

**O BLOCO DE ENTREGA (modelo canônico — único do arquivo).** Um bloco POR
máquina, com URL e token JÁ preenchidos por você; o usuário só copia, cola e
roda (não digita token, não abre página, não preenche placeholder). Antes de
mandar, releia o bloco: TODO placeholder (`URL_DA_PONTE`, `TOKEN_DA_MAQUINA_X`)
tem que ter virado valor real — bloco com placeholder literal instala um
agente morto. O bloco **não** leva `--auto`: `run_command` nasce desligado
e as ações de arquivo funcionam. Shell só depois de um "pode" no chat
(supervisionado `--allow-run --save`, ou autônomo `--auto --save` — § 4.4).
Não ofereça modo deus na instalação.

**FORMA A — `npx` (entregue ESTE).** Funciona em Linux, macOS, Windows e
Termux — é o mesmo comando nos quatro:

```bash
# ONDE: no PC DO USUÁRIO (Linux/macOS/Windows/Termux) — copie TUDO, cole, Enter
npx ponte-local start --server "URL_DA_PONTE" --token "TOKEN_DA_MAQUINA_X" --save
```

Checklist ANTES de entregar: a URL é a PÚBLICA (não localhost), o token é o
da lane certa, quem roda é a máquina certa.
**Diga assim:** "copia tudo, cola e Enter. O token aí é só da tua máquina —
não compartilha. Deixa essa janela aberta: é por ela que eu trabalho; fechou,
meu acesso cai (depois é só rodar `npx ponte-local start` de novo)."

**FORMA B — manual (só se o usuário não puder usar `npx`).** Baixa o
`agent.js` e roda com `node`:

```bash
# ONDE: no PC DO USUÁRIO (Linux/macOS/Termux) — copie TUDO, cole, Enter
mkdir -p ~/ponte-agent; cd ~/ponte-agent
curl -fsSL "URL_DA_PONTE/api/ponte/download" -o agent.js
node agent.js --server "URL_DA_PONTE" --token TOKEN_DA_MAQUINA_X --save
node agent.js
```

```powershell
# ONDE: no PC DO USUÁRIO (Windows PowerShell — curl.exe COM a extensão)
mkdir "$HOME\ponte-agent" -Force; cd "$HOME\ponte-agent"
curl.exe -fso agent.js "URL_DA_PONTE/api/ponte/download"
node agent.js --server "URL_DA_PONTE" --token TOKEN_DA_MAQUINA_X --save
node agent.js
```

Nas duas formas a config cai em `~/ponte-agent/ponte.config.json` — dá para
trocar de uma para a outra sem reconfigurar nada. Onde o repo é público, a
alternativa de download é
`curl -fso agent.js https://raw.githubusercontent.com/micsxnn/ponte-local/main/agente/agent.js`.

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
termux-setup-storage   # ATENCAO: VAI APARECER UM PEDIDO DE PERMISSÃO DO ANDROID: aceite
termux-wake-lock
npx ponte-local start --server "URL_DA_PONTE" --token TOKEN_DO_APARELHO --save
```

(O Termux não tem `npx` por padrão: se der "comando não encontrado", use a
forma manual — `mkdir -p ~/ponte-agent`, baixe o `agent.js` e rode
`node ~/ponte-agent/agent.js --server ... --token ... --save`.)

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

Depois de `conectado:true`, mande um `ping`: ele traz as specs e o estado
do modo. Não ofereça modo deus. Instalação pronta — daqui em diante é o
dia a dia (seção Operar da SKILL.md).
