<!-- referência da skill ponte-local. A spec de entrada é ../SKILL.md. -->

Versão desta skill (`skill-version` na SKILL.md) e versão do npm
(`package.json`) são numeradas separado. Não as iguale.

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
| 401 | tudo, EXCETO `/api/ponte/download` (pública por desenho — o PC baixa o agent.js sem token) | token ausente/inválido (admin ou agente) |
| 400 | `/cmd`, `/result`, `/results` | JSON inválido, ação/id/lane ausente ou inválida; no `/cmd`, **lane sem token** (a mensagem ensina: crie `PONTE_TOKEN_<SUFIXO>` e reinicie o relay) |
| 403 | `/result` | resultado pertence a outra lane |
| 404 | `/result` | resultado para comando desconhecido nesta lane |
| 411 | `/cmd` | requisição chunked sem content-length |
| 413 | `/cmd`, `/result` | corpo acima de 12 MB |
| 429 | `/cmd` | fila da lane cheia (100) |
| 503 | `/cmd` | persistência falhou — o comando não foi aceito; tente de novo |

**Limites técnicos:**

| Limite | Valor |
|--------|-------|
| Corpo de requisição (2 sentidos) | 12 MB |
| Pedaço de `read_text` | 2 MB por chamada (padrão 200 KB) |
| Pedaço de `read_binary` | 6 MB por chamada (padrão 4 MB em arquivos grandes) |
| Tamanho do ARQUIVO lido | ilimitado via `read_binary` em pedaços; o `pegar` do ponte.py desiste por segurança após 200 pedaços (≈1,2 GB) e deixa o arquivo parcial |
| `write_text` / `write_binary` | 1 MB / 8 MB |
| Comando (`run_command.command`) | 4.000 caracteres |
| Timeout por `run_command` | padrão 3 min; teto 30 min (`timeoutMin`) |
| stdout/stderr de `run_command` | cortados em 150.000 caracteres cada (maxBuffer 8 MB — stdout maior mata o comando) |
| Resultado total (agente) | recusado acima de ~10,5 MB ("refine o comando") |
| `screenshot` / `screenshot_window` | base64 ≤ 9 MB — acima disso use `format:"jpg"` e `quality` menor |
| `mouse_*` | coordenadas inteiras de -100.000 a 100.000; `count` de 1 a 10; `amount` de scroll de -1.000 a 1.000 |
| `keyboard_type` | texto de até 4.000 caracteres; sem TAB; cada linha validada contra a trava |
| `keyboard_key` | uma tecla ou combinação (`ctrl+shift+t`); colar e atalhos destrutivos bloqueados |
| pacote da skill | manifesto `skill-manifest.json`; o agente baixa o pacote INTEIRO (tudo ou nada) e remove o que saiu da skill nova |
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
| `tree` / `disk_usage` / `duplicates` | teto interno: 800 entradas (teto 3.000) / top 30 pastas / 200 grupos (top 100) |
| `free_space` | precisa de `fs.statfs` (Node ≥ 18.15; Node 18.0–18.14 falha e o erro sugere `df -h`) |
| `search` | 300 hits por nome (casa no caminho completo) / 200 por conteúdo; pula >2 MB, binários e vazios; pula `node_modules`, `.git`, `.cache`, `Trash`, `__pycache__`… |
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
- **Atualizar o agente (instalação `npx`):** é automático — o `npx` resolve
  a versão mais nova do pacote a cada execução. Se o usuário quiser fixar:
  `npx ponte-local start@1.19.0 ...`.
- **Atualizar o agent.js na máquina (sem npm):** automático — o próprio agente
  checa a cada 30 min, baixa a versão nova, valida com `node --check` e a
  aplica no próximo boot (backup em `agent.js.bak`). Manual, se precisar:
  `bash agente/atualizar.sh` (Linux/macOS/Termux) ou
  `agente\atualizar.bat` (Windows).
- **Atualizar o agente (instalação manual):** baixe o `agente/agent.js` novo
  do repo, envie ao PC com `write_binary` para `~/Downloads/` (ou
  `C:\Users\u\Downloads`), e lá:
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

## 6.1 Publicar uma nova versão (o mantenedor do repo)

O repo tem um script que faz o fluxo INTEIRO de release: bumpeia a versão,
roda os testes, commita, cria a tag, faz push, **publica no npm** e cria a
release no GitHub (com o `agent.js` anexado).

```bash
cd ~/Área\ de\ trabalho/ponte-local     # o repo
./publicar.sh minor "adiciona a ação que_missing"
./publicar.sh patch "corrige o X"
./publicar.sh --dry-run minor "só pra ver"      # mostra o que faria
```

Credenciais: `npm` usa o `~/.npmrc`; `gh` usa `gh auth login` (ou
`GH_TOKEN`). Release notes customizadas: copie
`RELEASE_NOTES.exemplo.md` para `RELEASE_NOTES.md` e escreva o que quiser
(a primeira linha vira o resumo do título). Sem ele, o corpo sai automático
com os commits desde a última tag.

**IMPORTANTE — o npm é um registry separado do GitHub:** commit e release
NÃO atualizam o npm. Só o `npm publish` publica. Mas o `npx` revalida o
registry a cada uso, então assim que publica, todo mundo que roda
`npx ponte-local start` pega a versão nova sem reinstalar nada. A propagação
demora ~5-20 min.

**Regra de versão:** a versão do **agente** (e do npm) é `1.x.y`; a tag do
**repo** é `v2.x.y`. Bump `patch` no agente → bump `patch` na tag; bump
`minor`/`major` → bump `minor` na tag.

## 7. Troubleshooting

| Sintoma | Causa | Correção |
|---------|-------|----------|
| `Lane "x" sem token — crie PONTE_TOKEN_… e reinicie o relay` (400 no /cmd) | lane inexistente, token não carregado, ou sufixo > 32 caracteres (descartado em silêncio) | crie a linha no `.env` e **REINICIE o relay**; nome com `-` nunca nasce de env — use `_`; encurte o sufixo |
| 401 na validação com o `.env` aparentemente certo | comentário inline após o valor (`TOKEN=valor # nota`) suja o `cut` do header | tire o comentário da linha do valor, reexporte o token, teste de novo |
| `Comando vazio` no `run_command` | chave errada no args | a chave é **`command`**, não `comando` |
| `Pasta protegida no caminho` | caminho relativo resolveu contra o CWD do agente (a pasta dele é bloqueada), ou pasta sensível (`.ssh`, `.config`, …) | use **caminho absoluto** (`/home/u/...` ou `C:\Users\u\...`); pasta sensível é bloqueada mesmo absoluta — respeite |
| `Arquivo protegido (credenciais/config do agente)` | o arquivo é config/log do próprio agente ou credencial conhecida (`.env`, `.npmrc`, …) | não é para ler mesmo; peça o que precisa ao usuário por outro caminho |
| PowerShell: "o termo curl não é reconhecido" ou resposta HTML | `curl` sem `.exe` virou `Invoke-WebRequest` | use **`curl.exe`** (com a extensão) |
| PowerShell: "o termo node não é reconhecido" logo após instalar o Node | PATH novo não entra em janelas já abertas | feche TODAS as janelas do PowerShell, abra uma nova e repita |
| Agente não conecta (`conectado:false`) | URL/token errados, relay sem o token no `.env`, ou agente fechado | confira `--server`, confira `.env` + restart do relay, religue o agente |
| `node agent.js` no PC falha com SyntaxError (instalação manual) | o `curl -o agent.js` gravou um JSON de erro (rota `/download` 404) | copie `agente/agent.js` para `download/ponte-agent/` no relay; valide com `curl -fsS URL/api/ponte/download \| head -c 40` |
| Local responde, público dá connection refused | relay subiu em outra porta (ex.: `PORT=3001`) e os curls/túnel apontam 3000 | alinhe a porta em TODOS os comandos (e no túnel) |
| Ponte morreu sozinha horas depois | túnel efêmero (trycloudflare) mudou de URL ou morreu | reerga o túnel e religue o agente com `--server NOVA_URL --save` |
| `TEMPO ESGOTADO` com agente conectado | baseline do operador maior que os ids da instância nova | apague `.ponte_since_<nome-da-lane>` na pasta do `ponte.py` (ou em `PONTE_STATE_DIR`, se definido) |
| `TEMPO ESGOTADO` em modo supervisionado | prompt s/N + execução passaram da espera do operador | reenvie com `PONTE_WAIT_S=150+` (sem resposta na caixa, o agente auto-rejeita com erro próprio) |
| `Você rejeitou o comando no terminal (resposta: n)` | ninguém confirmou a caixa s/N em 60 s | reenvie; **Diga assim:** "vai aparecer a caixa de novo — aperta `s` quando ela vier" |
| Religuei com `npx ponte-local start` e ele segue executando sozinho | modo gravado no `ponte.config.json` pelo `--save` | edite o config (`"auto": false`) ou apague-o e religue com as flags desejadas; NUNCA `--auto=false` (ativa!) |
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
- **Token sem aparecer no `ps`/histórico do shell:**
  `PONTE_AGENT_TOKEN=… node agent.js --server URL` (a env só vale se a config
  ainda não tem token; `--home` troca a pasta base do agente).
- **O `.gitignore` do repo já cobre** `.env`, `.ponte-estado.json`,
  `.ponte-seq`, `ponte-log.jsonl*`, `__pycache__/` e `*.pyc`. Se você usar
  `worklog.md`, `db/` ou logs próprios no seu fork, adicione-os ANTES do
  primeiro push (Lei 5).


## Apêndice B — O que o usuário vê no terminal

No boot, arte **PONTE AGENTE** em blocos (terminal Linux UTF-8 e
cmd/PowerShell do Windows 10+ com fonte Consolas; janela estreita (<65
colunas) ou console antigo → banner ASCII — no Windows também com log de app;
no Linux com saída redirecionada o banner Unicode é mantido). Toda ação em
andamento mostra um spinner `⠏ rodando: <rótulo> (Ns)` (ASCII `|/-\` no cmd).
Ao fim de cada `run_command`, uma caixa `output` com stdout, stderr e código
de saída (truncada em 60/30 linhas — a IA continua recebendo o JSON completo;
o corte é só visual). Sem TTY (saída redirecionada), o spinner fica desligado.
Nada disso muda o protocolo nem os payloads.
