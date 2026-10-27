# Ponte Local — Agente

Este agente conecta o seu computador à "Ponte": um canal pelo qual eu (a IA da
nossa conversa) consigo ver e organizar os seus arquivos **de dentro da minha
VM**, sem você precisar copiar nada manualmente.

## Como funciona

1. O agente roda no seu PC e pergunta ao relay (uma vez a cada 1,5 s):
   "tem comando novo?"
2. Quando eu mando um comando, o agente executa **localmente no seu disco**.
3. O resultado (listagens, caminhos, confirmações) volta pela ponte.
   **Seus arquivos nunca são enviados para lugar nenhum** — só texto de
   comandos e respostas trafega.

## Requisitos

- **Windows 10/11** ou **Linux** com Node.js 18+:
  - Linux (Arch/CachyOS): `sudo pacman -S --needed nodejs`
  - Windows: `winget install OpenJS.NodeJS.LTS` (ou instalador do nodejs.org)
  - Windows: instalou o Node agora? **Feche e reabra o PowerShell** antes de rodar o agente — só janelas novas enxergam o `node` no PATH

## Como rodar (primeira vez)

1. Abra o terminal na pasta onde está este arquivo (no Windows, PowerShell).
2. Rode o comando que te passei no chat (ele já vem com servidor e token
   preenchidos — você não configura nada à mão):

   **Linux:**

   ```bash
   node agent.js --server https://SEU-LINK-DE-PREVIEW --token SEU_TOKEN --save
   ```

   **Windows (PowerShell):**

   ```powershell
   node agent.js --server https://SEU-LINK-DE-PREVIEW --token SEU_TOKEN --save
   ```

   O `--save` grava a configuração em `ponte.config.json`, então das próximas
   vezes é só rodar:

   ```bash
   node agent.js
   ```

3. Deixe a janela aberta. Quando o agente conectar, o banner dele mostra modo,
   escopo e proteções — e do lado da IA o status já responde `connected:true`.
   (O painel do relay, quando existe, é só um visor mínimo — specs da máquina
   e luz de conexão; nada da instalação depende dele.)

Para encerrar: `Ctrl+C` (sai direto, sem relatório). Para religar: `node agent.js`.

**No Windows**, depois da primeira configuração, prefira o `rodar.bat` (duplo
clique) — veja a seção abaixo. Ele resolve um problema clássico do console
do Windows que congelava o agente.

## Uma ponte, várias máquinas — cada uma com seu token

Se mais de um computador seu conecta na mesma ponte (ex.: um netbook Linux e
um PC Windows), **cada máquina recebe o SEU token** — a IA entrega um
diferente no chat privado na instalação de cada uma. O token define a "lane"
do relay: a fila de comandos da sua máquina é independente da fila das
outras, e um comando destinado a uma máquina **nunca executa na outra**.

Precisou trocar o token de uma máquina (migração, rotação)? Duas formas,
as duas com o agente religando sozinho na sequência:

- religar com o token novo: `node agent.js --token NOVO_TOKEN --save`
- ou editar `ponte.config.json` (campo `"token"`) e religar o agente.

No Windows o dia a dia continua sendo pelo `rodar.bat` — a troca de token é
um comando no PowerShell, uma vez só.

## Windows sem congelamentos (rodar.bat + watchdog.bat)

**O problema:** o console do Windows tem o "Modo de Edição Rápida" (QuickEdit).
Um clique dentro da janela entra em modo de seleção e **congela a saída do
node — o agente para de responder com a janela parecendo normal** até você
apertar Enter ou clicar de novo. Foi a causa provável dos congelamentos com
janela aberta.

**A solução pronta (dois arquivos na pasta do agente):**

- **`rodar.bat`** (duplo clique) — é o jeito certo de rodar no Windows:
  - desliga o QuickEdit para consoles novos (`reg add HKCU\Console ... QuickEdit = 0`);
  - manda TODA a saída do agente para `ponte-agent.log` em vez do console —
    com o node sem escrever no console, clique nenhum tem efeito sobre ele;
  - a janela pode ficar minimizada; para encerrar, feche-a.
  - Na primeira vez ele avisa: a configuração (`--server`/`--token`/`--save`)
    continua sendo um comando no PowerShell, uma vez só.
- **`watchdog.bat`** (deixe aberto, pode minimizar) — a cada 30 s confere se
  existe um `node agent.js` rodando; se não tem, religa sozinho o `rodar.bat`.
  Contra agente morto. (Contra congelamento, a proteção é o log em arquivo
  do `rodar.bat` — o watchdog não precisa detectar trava.)

Se você prefere o PowerShell puro: sem `rodar.bat`, desligue o QuickEdit à mão
(Propriedades do console → desmarcar "Modo de Edição Rápida"), ou rode
`reg add HKCU\Console /v QuickEdit /t REG_DWORD /d 0 /f` e reabra o console.
No Windows Terminal o problema não existe (não há QuickEdit).

## O que o agente PODE fazer (lista fixa — nada além disso)

| Ação             | O que faz                                                          |
| ---------------- | ------------------------------------------------------------------ |
| `ping`           | Identifica a máquina (usuário, CPU, RAM, home, modo ativo)          |
| `list`           | Lista o conteúdo de uma pasta                                       |
| `tree`           | Visão em árvore de pastas (até 4 níveis)                            |
| `file_info`      | Diz o tipo REAL do arquivo (png, pdf, exe, mp4, zip…) pelo conteúdo + encoding se for texto |
| `read_text`      | Lê texto de arquivos de QUALQUER tamanho, em pedaços (siga `proximoOffset`); detecta utf-8, cp1252, utf-16 e latin1 |
| `write_text`     | Cria/sobrescreve arquivos de texto (antigo vai pra lixeira)         |
| `read_binary`    | Lê binário em base64 por pedaços — arquivo de qualquer tamanho      |
| `write_binary`   | Recebe arquivo binário (até 8 MB) da ponte                          |
| `search`         | Busca por nome ou por conteúdo em toda a home                       |
| `mkdir`          | Cria pastas                                                         |
| `move`/`rename`  | Move/renomeia arquivos e pastas                                     |
| `delete`         | Manda para a **lixeira do agente** (nunca apaga de verdade)         |
| `restore`        | Restaura item da lixeira                                            |
| `organize_plan`  | Gera um plano de organização por tipo de arquivo                    |
| `apply_plan`     | Executa o plano (com desfazer)                                      |
| `duplicates`     | Acha arquivos duplicados por tamanho + hash                         |
| `disk_usage`     | Mostra as pastas que mais ocupam espaço                             |
| `undo_last`      | Desfaz a última ação reversível                                     |
| `free_space`     | Mostra espaço livre em disco                                        |
| `run_command`    | Executa um comando de shell. Depende do modo (veja abaixo): **supervisionado** pede `s/N` no terminal; **autônomo** executa direto, exceto padrões catastróficos |
| `task_done`      | Fecha a tarefa: o agente grava `relatorio-ponte.txt` com o que foi feito (resumo que a IA envia) e abre na sua tela (a IA manda quando conclui) |

## Os 3 modos do run_command

| Modo | Como ativar | O que acontece |
| ---- | ----------- | -------------- |
| **Desligado** (padrão) | — | Nenhum comando de shell roda. Só operações de arquivo. |
| **Supervisionado** | `node agent.js --allow-run --save` | Cada comando aparece numa caixa no terminal e roda só com `s` + Enter (60s para responder). |
| **Autônomo** | `node agent.js --auto --save` | A IA executa os comandos SOZINHA, sem perguntar. O terminal só registra `[AUTO] $ comando`. Uma trava anticatástrofe recusa sempre: `rm -rf` na raiz/home/sistema, `mkfs`, `dd` em disco, fork bomb, `wipefs`, `shred` em dispositivo. |

A escalada de permissão é sempre FÍSICA: é você quem digita `--allow-run`
ou `--auto` no SEU terminal — a IA não consegue ligar modos sozinha.

## Modo supervisionado — detalhe

1. Você religa o agente com `--allow-run --save` (uma vez só; fica salvo)
2. Quando a IA propor um comando, ele aparece numa caixa no terminal do agente
3. Você lê o comando e digita `s` (executar) ou `n`/Enter (recusar)
4. Sem resposta em 60s = recusado automaticamente
5. A saída do comando volta pela ponte pra IA analisar

A trava é física: o comando só roda se VOCÊ apertar Enter no SEU teclado.
Se o agente rodar em background (sem terminal), nada é executado.

## modo deus (opcional — a decisão é sua, no chat)

O **modo deus** desliga as confirmações `s/N` do `run_command`: a IA passa a
executar comandos sem você apertar nada. O que continua igual de jeito
nenhum: a trava anticatástrofe (recusa `rm -rf` na raiz/home/sistema, `mkfs`,
`dd` em disco etc.), pastas sensíveis bloqueadas, exclusão só via lixeira
com `undo_last`, e tudo registrado em `ponte-log.jsonl`.

- **A IA pergunta você NO CHAT**, logo depois que a ponte conecta — nada de
  digitar s/N no terminal. Você aceita na conversa, a IA envia o comando e
  pronto: fica salvo em `ponte.config.json` (`"godMode": true`).
- Se você recusar, a IA registra a recusa e não pergunta de novo — mas
  basta você pedir ("ativa o modo deus") que ela ativa na hora.
- **Desligar é livre e imediato**: a IA manda `god_mode {"enabled": false}`
  ou você edita o `ponte.config.json`. Desligado, o `run_command` volta ao
  modo anterior (supervisionado volta a pedir `s/N`).

## A skill se atualiza sozinha

O agente baixa a `SKILL.md` mais recente do repo no boot e a cada 60 s e
salva aqui na pasta dele (`SKILL.md`, junto com o `agent.js`). É a versão
vigente das instruções para qualquer IA que opera a ponte — nada de copiar
à mão. Para forçar na hora, a IA manda `{"action":"skill_update","args":{}}`
e recebe de volta a versão antiga e a nova. O `ping` também mostra a versão
da skill e se o modo deus está ativo.

## Relatório da tarefa (a IA fecha com `task_done`)

Quem decide que a tarefa acabou é a IA — sem cronômetro. Quando ela termina
o trabalho, manda o comando `task_done` com um `resumo` em texto do que foi
feito e o agente, na hora, grava `relatorio-ponte.txt` na pasta dele e abre
na sua tela: duração, modo ativo, quantos comandos rodaram e, em linguagem
de gente, **O QUE FOI FEITO** — sem lista de comandos. Se algo deu errado,
aparece uma seção "FALHAS" no fim. Quando a TAREFA SEGUINTE começa, o agente
fecha a janela do relatório anterior sozinho e apaga o txt (também no boot
do agente); encerrar com `Ctrl+C` sai direto, sem relatório. Se aparecer
`abriuRelatorio:false`, não houve comando de trabalho.

Comandos exatos que ele usa para abrir, por plataforma:

- **Windows:** `start "" "relatorio-ponte.txt"` (fallback: `explorer.exe`)
- **Linux:** `xdg-open relatorio-ponte.txt` (fallbacks: `gio open`, `kde-open5`, `kde-open`)
- **macOS:** `open relatorio-ponte.txt`

Sem ambiente gráfico (SSH, servidor), ele só salva o arquivo e avisa no terminal.

## Atualizar o agente à mão (comandos exatos)

A skill se atualiza sozinha; o `agent.js` não. Para trocar a versão dele:

- **Linux:** `cd ~/ponte-agent && bash atualizar.sh` — ou direto:
  `curl -fso agent.js https://raw.githubusercontent.com/micsxnn/ponte-local/main/agente/agent.js`
- **Windows (PowerShell):**
  `curl.exe -fso agent.js https://raw.githubusercontent.com/micsxnn/ponte-local/main/agente/agent.js`

Depois é só encerrar (`Ctrl+C`) e religar (`node agent.js`).

## O que o agente NUNCA faz

- **Com o run_command desligado** (padrão): não executa nenhum comando de shell
- **No modo supervisionado**: nenhum comando roda sem você digitar "s" no terminal — e cada comando aparece por completo antes
- **No modo autônomo**: comandos rodam sem confirmação, MAS a trava anticatástrofe recusa os que destroem o sistema de uma vez (no Windows: `format`, `diskpart`, `rd /s` em raiz de drive etc.), e TUDO fica registrado em `ponte-log.jsonl`
- **No modo deus**: igual ao autônomo — sem `s/N`, mas a trava anticatástrofe segue recusando padrões de destruição, e a ativação só aconteceu porque você aceitou no chat
- Não acessa nada fora da sua home (ações de arquivo)
- Não toca em pastas sensíveis: `.ssh`, `.gnupg`, `.config`, `.password-store`,
  `.aws`, `.kube`
- Não apaga arquivos permanentemente (sempre lixeira, sempre recuperável)

## Arquivos gerados aqui

- `ponte.config.json` — servidor, token, escopo e modo deus (criado com `--save` / perguntas)
- `ponte-log.jsonl` — registro local de tudo que aconteceu, com informação de
  desfazer
- `SKILL.md` — instruções mais recentes da ponte, baixadas sozinhas do repo
- `ponte-agent.log` (só no Windows, via `rodar.bat`) — a saída do agente que
  iria para o console; é para lá que você olha se algo estranhar

Você pode ler os dois com qualquer editor. O código do agente é um arquivo só
e está aberto — vale a pena conferir.
