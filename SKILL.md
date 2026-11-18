---
name: ponte-local
description: >-
  Opera o PC do usuário pelo chat (Windows, Linux, macOS ou Termux):
  arquivos, busca, organização, screenshot, mouse, teclado e comandos,
  com lixeira, undo e trava anticatástrofe. Use quando pedirem para mexer
  no computador, no desktop, em Downloads, ou citarem Ponte Local, ponte,
  agent.js ou o PC deles. Se a ponte já estiver no ar, opere com a URL e
  o ADMIN_TOKEN. Não rode `npx ponte-local start` você mesmo: esse
  comando é só no PC do usuário.
compatibility: >-
  A IA precisa de saída HTTPS (curl ou Python 3). O PC do usuário precisa
  de Node.js 18+. `npx ponte-local start` roda só no PC físico, nunca na
  VM da IA.
metadata:
  version: "4.7.0"
---

<!-- skill-version: 4.7.0 -->

# Ponte Local — operação remota do PC do usuário

A versão desta skill (`skill-version`) e a versão do npm (`package.json`,
hoje a do agente) são numeradas separado. Não as iguale.

Este arquivo é a spec de entrada. O manual longo não está aqui de propósito:
rode `npx ponte-local skill <secao>` ou abra o arquivo em `references/`.
`npx ponte-local skill` sem argumento imprime só este arquivo.

## QUAL COMANDO É O MEU? (leia antes de tudo)

O pacote `ponte-local` é híbrido. Você, IA, roda só o lado de leitura, na
sua VM. O lado que executa é o do usuário, no PC físico.

| | **O SEU (na VM)** | **DO USUÁRIO (no PC)** |
|---|---|---|
| **Comando** | `npx ponte-local skill` e `npx ponte-local acoes` | `npx ponte-local start` |
| **Executa?** | não — só leitura | sim — único lado que executa |
| **Grava config?** | nunca | sim (`~/ponte-agent/`) |
| **Abre socket?** | nunca | sim (só saída, para o relay) |

```bash
npx ponte-local skill                  # este arquivo
npx ponte-local skill <secao>          # uma seção (skill --lista mostra o índice)
npx ponte-local acoes                  # manual das ações; o total impresso é o certo
npx ponte-local acoes mouse_click      # uma ação
npx ponte-local acoes --json
```

O comando do usuário, para ele colar. Sem `--auto`:

```bash
npx ponte-local start --server https://URL_DA_PONTE --token TOKEN_DA_MAQUINA_X --save
```

`--auto` liga execução direta e fica gravado em `ponte.config.json`. Só
entre no bloco depois de um "pode" explícito no chat. Nunca rode `start`
na sua VM: você enfileira (`POST /api/ponte/cmd`) e o agente de lá executa.

## 0. A ponte em 60 segundos

- **Relay** — Next.js num servidor. Guarda a fila e os resultados.
- **Agente** — `agent.js`, zero dependências, no PC do usuário. Poll a cada
  1,5 s. Só conexão de saída: sem porta aberta, VPN ou port forwarding.
- **Você** — opera por HTTPS (`curl` ou `operador/ponte.py`).

Um comando: `POST /cmd` com a **lane** → o agente executa → `GET /results?since=N`.

**Lane** = uma máquina. 1 token = 1 lane = 1 fila. Comando de uma máquina
nunca executa na outra. O nome sai do sufixo: `PONTE_TOKEN_MAQUINA_1` cria
a lane `maquina_1` (minúsculas, só `a-z`, `0-9` e `_`, no máximo 32
caracteres). Hífen não nasce. Token novo no `.env` só vale depois de
reiniciar o relay.

| Termo | Significado |
|---|---|
| `ADMIN_TOKEN` | o seu token, no header `x-ponte-admin` |
| `modo deus` | `run_command` sem caixa s/N; só com aceite no chat, nunca oferecido na conexão |
| `trava anticatástrofe` | bloqueio no agente; modo deus não contorna |
| `s/N` | confirmação no terminal do usuário, 60 s, só no modo supervisionado |

Diga assim, na instalação: "instalei um programinha que me deixa organizar
arquivos e rodar comandos no seu PC pelo chat. Ele só faz conexão de saída
— não abre porta, não precisa de VPN nem mexer no roteador."

## 1. AS 5 LEIS — valem mais que tudo que vem depois

**Lei 1 — Toda tarefa termina com `task_done`.** Última ação, sem exceção:

```json
{"action":"task_done","args":{"resumo":"O QUE foi feito, em 1-4 linhas, linguagem simples para o usuário"}}
```

O agente grava `relatorio-ponte.txt` e abre na tela (seção **O QUE FOI
FEITO**, sem lista de comandos; **FALHAS** só se algo errou). Pausa de 3 min
(`PONTE_TAREFA_GAP_MS`, mínimo 1 s) ou encerrar o agente também fecha a
tarefa — isso não é licença para esquecer. A tarefa seguinte apaga o txt;
o boot também. Sem interface gráfica, salve o txt antes de religar.
`ping` e `task_done` não contam como trabalho. Na primeira tarefa, avise
que uma janela de relatório abre no fim.

**Lei 2 — Todo comando vai na lane da máquina certa.** `POST /cmd` sem
`"lane"` é rejeitado. Não invente o nome: `/status` mostra
`lanes.<lane>.agentInfo.maquina`. Confira `conectado:true` antes.

**Lei 3 — Modo deus não se oferece.** Não pergunte no primeiro `ping`.
Só pergunte se o usuário pedir para parar de confirmar, ou se a caixa s/N
estiver impedindo uma tarefa que ele já autorizou. A pergunta é no chat,
nunca no terminal:

> "quer ativar o modo deus? Com ele eu executo comandos sem pedir s/N — a trava anticatástrofe, a lixeira e o log continuam valendo."

Aceitou → `god_mode {"enabled":true}`. Recusou → `god_mode {"declined":true}`
(não pergunte de novo; um aceite novo limpa a recusa). Desligar é livre:
`god_mode {"enabled":false}`. O aceite no chat também habilita
`run_command` numa ponte instalada sem `--auto` nem `--allow-run`.

**Lei 4 — A trava anticatástrofe é intransponível onde ela roda.** Ela
cobre ação perigosa, não só o texto: `rm`/`mv` com glob, `mv` de alvo de
sistema, `sudo` com `-n`/`-i`/`-u`, `bash -lc`, `eval`, `python -c` /
`perl -e` / `node -e`, `source`, alias, `!!`, leitura de `/etc/shadow` ou
`~/.ssh` / `~/.aws` / `~/.npmrc`, `cmd /c rd /s`, aliases do PowerShell
(`rm`, `rd`, `del`, `erase`), `$env:windir`, `reg delete`, `net user`,
`takeown`, `icacls`, `bcdedit`. Se parece destrutivo e a trava não pegou,
confirme no chat em vez de executar.

A trava roda no autônomo e no modo deus — nenhum dos dois contorna, nem
com aprovação. No supervisionado a trava não roda: quem protege é o
usuário, com `s`. Bloqueados: fork bomb, `$( )`, backtick, `>( )`, `mkfs`,
`wipefs`, `dd of=` e `shred` em `sd*`/`nvme*`/`mmcblk*`/`hd*`/`vd*`/`loop*`,
escrita em `/dev/*`, `find -delete`, `xargs` destrutivo, pipe para
interpretador (`| sh`, `| python`), `curl | sh`, `chmod`/`chown -R` em
pasta de sistema, `rm -r` em `/`, `/*`, `/home`, `~`, `$HOME`, `/boot`,
`/etc`, `/usr`, `/var`, `/lib`, `/opt`, `/mnt`, `/media`, variável não
resolvida, `.`/`..` e a home literal. Windows: `format`, `diskpart`,
`cipher /w`, `vssadmin delete shadows`, `rd`/`rmdir /s`, `del /s`,
`Remove-Item -Recurse` e o alias `ri` na raiz de drive, `C:\Windows`,
`C:\Program Files` (inclui `C:\PROGRA~1`), `%USERPROFILE%` e home literal.
Fora dessa lista não há garantia (disco fora do padrão, `/dev/mapper`,
apagador exótico): confirme o alvo no chat. Nunca tente contornar.

**Lei 5 — Token nenhum vaza.** Tokens nascem no `.env` do relay (ou em
`.env.ponte`, se a hospedagem apaga `.env`) e vão ao usuário uma vez, no
chat privado, um bloco por máquina. Nunca em repo, screenshot, log ou chat
público. Token versionado está queimado: `openssl rand -hex 16`, troque e
reinstale. `/status` sem `x-ponte-admin` responde 401. Não use token em
URL (`?admin=` saiu do ar).

## 2. A ponte já está no ar?

Se outra sessão já instalou, não hospede nada e não gere token. Vá ao
**Apêndice A** com a URL pública e o `ADMIN_TOKEN` que o usuário tiver.
O resto deste capítulo é para quem está montando agora.

## 3. Preparar do zero — siga a sequência

Não pule passo. O procedimento longo (copiar o relay, túnel, teclado,
mouse, Termux) está em `references/instalacao.md`.

### Passo 0 — Duas perguntas antes de tudo

1. A ponte já existe? Se sim, Apêndice A e pare.
2. Qual é o PC: Windows, Linux (qual distro), macOS ou Termux? Pergunte.
   Não assuma.

Anuncie o que ele vai fazer: colar um bloco; no Windows, se o Node acabar
de ser instalado, fechar e abrir o PowerShell; deixar a janela do agente
aberta; apertar `s` ou `n` se uma caixa aparecer; no fim, uma janela de
relatório abre sozinha.

Entregue este bloco, com URL e token já preenchidos (nada de placeholder):

```bash
npx ponte-local start --server "https://URL_DA_PONTE" --token "TOKEN_DA_MAQUINA_X" --save
```

Checklist: URL pública (não localhost), token da lane dessa máquina, quem
cola é o dono dessa máquina. Diga que a janela precisa ficar aberta.

Para montar o relay, achar a URL e o bloco manual (sem npx): 
`npx ponte-local skill relay`, `skill url`, `skill instalacao`.

## 4. Operar

### 4.1 Mandar comando e ler resultado

```bash
export PONTE_URL=https://URL_DA_PONTE
export PONTE_ADMIN_TOKEN=o-token-de-admin

curl -s -X POST $PONTE_URL/api/ponte/cmd \
  -H "x-ponte-admin: $PONTE_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"lane":"maquina_1","action":"ping","args":{}}'

curl -s "$PONTE_URL/api/ponte/results?since=76&lane=maquina_1" \
  -H "x-ponte-admin: $PONTE_ADMIN_TOKEN"
```

`results?since=X` devolve no máximo 100 itens. `lastId` é o próximo
`since`. Vazio: o agente ainda não pollou (releia em 3–5 s) ou está
offline. Duas máquinas: um `since` por lane.

Com Python, prefira o `ponte.py` (lane, baseline e pedaços ficam resolvidos):

```bash
export PONTE_URL=https://URL_DA_PONTE
export PONTE_ADMIN_TOKEN=o-token-de-admin
export PONTE_LANE=maquina_1
python3 ponte.py ping
python3 ponte.py '<ação>' '<args-json>'
python3 ponte.py enviar <local> <destino-absoluto-remoto>
python3 ponte.py pegar <origem-absoluta-remota> <local>
python3 ponte.py --status
python3 ponte.py --drain
```

Esperas: ações genéricas usam `PONTE_WAIT_S` (padrão 150 s, cobre a caixa
s/N). `enviar` espera 60 s fixos. `pegar` espera 60 s por pedaço.
`--drain` corta em 3.000 caracteres. `enviar` sobrescreve (o antigo vai
para a lixeira).

Resultado não veio, nesta ordem:

1. `/status` → `pending` da lane. Pendente com menos de 24 h entrega no
   reconnect.
2. Não reenvie às cegas. Lease de 120 s reentrega sozinho. Reenvio é
   execução dupla. Resultado repetido volta `duplicado:true`, mas a
   máquina executa de novo.
3. "Resultado grande demais (>10,5 MB)": `maxBytes` menor, uma pasta por vez.
4. `data` com `_cortado` é histórico depois de restart. O ao vivo é íntegro.
5. `TEMPO ESGOTADO` com agente conectado: `npx ponte-local skill troubleshooting`.

Ações: não decore a tabela. `npx ponte-local acoes` e
`npx ponte-local acoes <nome>`. Corpo: `{"lane","action","args"}`.
`search`, `tree`, `disk_usage` e `duplicates` pulam `node_modules`, `.git`,
`.cache` e afins — "não achou" não é "não existe".

Ler arquivo, em qualquer tamanho: `file_info`, depois `read_text` seguindo
`proximoOffset` (encoding por extenso, `windows-1252`, não `cp1252`), ou
`read_binary` juntando o base64 na ordem. `ponte.py pegar` faz o binário
sozinho. Receita completa: `npx ponte-local skill arquivos`.

### 4.4 `run_command` — os 4 estados (escalada é física)

| Estado | Como chega lá | Comportamento |
|---|---|---|
| Desligado (padrão) | `npx ponte-local start` | `run_command` negado; só arquivo |
| Supervisionado | usuário religa com `--allow-run --save` | caixa s/N, 60 s; sem resposta = rejeita |
| Autônomo | usuário religa com `--auto --save`, depois de aceitar no chat | executa direto, log `[AUTO]`; trava ativa |
| Modo deus | Lei 3: só se ele pedir | igual ao autônomo, log `[deus]`; trava, lixeira e log continuam |

Trocar de modo (exceto deus) é no terminal dele. Fechar a janela corta o
acesso; avise que é rápido. O `--save` grava o modo: `start` puro depois
de `--auto --save` **não** volta ao desligado, e `--allow-run --save`
também não rebaixa. Para rebaixar, edite `ponte.config.json` (`"auto": false`
é supervisionado; `"run": false, "auto": false` é desligado) ou apague o
arquivo. Nunca use `--auto=false`: a flag conta como presente e liga o
autônomo. Desligar o modo deus deixa o agente no modo que estava gravado.

No supervisionado use `PONTE_WAIT_S=150`. Avise a primeira caixa: aperta
`s` em 60 s, ou `n` para negar.

Sudo sem deixar senha em log: `npx ponte-local skill sudo`.

## Apêndice A — Operar uma ponte que já existe (sem hospedar)

Com a URL pública e o `ADMIN_TOKEN`, qualquer IA opera por `curl`. Não
gere token e não suba relay.

```bash
export PONTE_URL=https://A-URL
export PONTE_ADMIN_TOKEN=o-token-de-admin

curl -s $PONTE_URL/api/ponte/status -H "x-ponte-admin: $PONTE_ADMIN_TOKEN"
curl -s -X POST $PONTE_URL/api/ponte/cmd \
  -H "x-ponte-admin: $PONTE_ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"lane":"maquina_1","action":"ping","args":{}}'
curl -s "$PONTE_URL/api/ponte/results?since=0&lane=maquina_1" \
  -H "x-ponte-admin: $PONTE_ADMIN_TOKEN"
```

As 5 leis valem igual. Para a URL não mudar, o relay precisa de domínio
fixo (VPS, Render, Railway, Fly.io). Reconstruir um preview que resetou:
`relay/RESTAURAR.md`.

## Onde está o resto

| Preciso de | Comando |
|---|---|
| Relay, tokens, lane | `npx ponte-local skill relay` |
| URL pública e túnel | `npx ponte-local skill url` |
| Instalar no PC (npx e manual) | `npx ponte-local skill instalacao` |
| Teclado / mouse / bloco por SO | `npx ponte-local skill teclado` ou `skill mouse` |
| Tabela de ações | `npx ponte-local acoes` |
| Ler arquivo grande | `npx ponte-local skill arquivos` |
| Sudo | `npx ponte-local skill sudo` |
| Limites, manutenção, publicar | `npx ponte-local skill referencia` |
| Erro concreto | `npx ponte-local skill troubleshooting` |
| Escopo, lixeira, pastas bloqueadas | `npx ponte-local skill seguranca` |
| O que aparece no terminal dele | `npx ponte-local skill terminal` |

Arquivos: `references/instalacao.md`, `references/acoes.md`,
`references/comando.md`, `references/referencia.md`.
