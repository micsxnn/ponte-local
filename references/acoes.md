<!-- referência da skill ponte-local. A spec de entrada é ../SKILL.md. -->

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
| `read_text` | `{"path":"...","offset":0,"maxBytes":200000,"encoding":"auto"}` | Texto de QUALQUER tamanho em pedaços (≤ 2 MB/pedaço, padrão 200 KB); detecta utf-8/windows-1252/utf-16/latin1 (o nome é por extenso — `"encoding":"cp1252"` é recusado); siga `proximoOffset` até `null` |
| `write_text` | `{"path":"...","content":"...","overwrite":true}` | Cria/sobrescreve (≤ 1 MB; antigo → lixeira) |
| `search` | `{"path":"...","query":"termo","mode":"name"\|"content"}` | Busca por nome — casa no CAMINHO COMPLETO, não só no nome do arquivo — (padrão 300 hits) ou conteúdo (200) — teto 500 via `max`; pula arquivos > 2 MB, binários e vazios |
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
| `duplicates` | `{"path":"...","minSizeBytes":1048576}` | Duplicados (tamanho→md5) + espaço recuperável (default de `minSizeBytes`: 1024) |
| `read_binary` | `{"path":"...","offset":0,"maxBytes":4194304}` | Binário em base64 por pedaços (≤ 6 MB/pedaço; padrão 4 MB em arquivos grandes) — junte os base64 NA ORDEM |
| `file_info` | `{"path":"..."}` | Tipo REAL por magic bytes (png, jpeg, pdf, zip, exe, mp4, sqlite, gzip, iso…) + tamanho + encoding se for texto |
| `write_binary` | `{"path":"...","base64":"...","overwrite":true}` | Grava binário (máx 8 MB) |
| `screenshot` | `{"format":"png","quality":85}` | Print da TELA INTEIRA, em base64 (`dados`). `format`: `png` (padrão) ou `jpg` (bem menor — use em tela grande). Linux: usa o que a distro já tem (import/scrot/maim/gnome-screenshot/spectacle/grim); Windows: PowerShell + System.Drawing (nativo); macOS: screencapture; Termux: termux-screenshot |
| `screenshot_window` | `{"window_title":"Firefox","window_class":"","window_id":"","format":"png"}` | Print de UMA janela. Sem argumento: a janela em foco. Por `window_title`/`window_class`/`window_id`: no X11 e no Windows a janela exata; no Wayland o compositor não expõe isso, então a IA recebe a janela em foco e a resposta avisa (`janela.aviso`) |
| `mouse_position` | `{}` | Onde está o cursor agora: `{x, y}` + `larguraTela`/`alturaTela` quando a ferramenta sabe |
| `mouse_move` | `{"x":1200,"y":800}` | Move o cursor para (x, y) — não clica |
| `mouse_click` | `{"x":1200,"y":800,"button":"left","count":1}` | Clica em (x, y). `button`: `left` (1), `middle` (2), `right` (3). `count`: cliques repetidos (duplo = 2) |
| `mouse_scroll` | `{"amount":3,"direction":"down"}` | Rola. `direction`: `up`, `down`, `left`, `right`; `amount`: notches (padrão 3) |
| `mouse_drag` | `{"x":100,"y":100,"x2":800,"y2":600}` | Arrasta de (x, y) até (x2, y2) com o botão pressionado |
| `keyboard_type` | `{"text":"ola mundo"}` | Digita texto no teclado do usuário (base64 não, é texto puro). O texto passa pela MESMA trava anticatástrofe do `run_command`: digitar `rm -rf /` num terminal é tão destrutivo quanto executar, e é recusado. TAB dentro do texto é recusado (no shell ele completa o comando e a trava não veria o resultado) |
| `keyboard_key` | `{"key":"enter"}` | Dispara uma tecla ou atalho: `enter`, `backspace`, `delete`, `escape`, `space`, `up`/`down`/`left`/`right`, `home`/`end`, `pageup`/`pagedown`, `f1`..`f12`, e combinações como `ctrl+c`, `ctrl+shift+t`. **Colar (`ctrl+v`, `shift+insert`), TAB e atalhos destrutivos são bloqueados** |
| `run_command` | `{"command":"...","cwd":"C:\\Users\\u","timeoutMin":3}` | Shell — exige modo habilitado (§ 4.4) |
| `god_mode` | `{"enabled":true}` / `{"enabled":false}` / `{"declined":true}` | Protocolo da Lei 3 |
| `skill_update` | `{}` | Força a atualização do PACOTE INTEIRO da skill (spec principal, variante da máquina, manual do usuário e recursos novos — via o manifesto do repo). Roda sozinho no boot e a cada 60 s |
| `task_done` | `{"resumo":"..."}` | **Fecha a tarefa** (Lei 1) — ÚLTIMO comando de toda tarefa |

`search`, `tree`, `disk_usage` e `duplicates` **pulam por desenho** as pastas
`node_modules`, `.git`, `.cache`, `cache`, `.thumbnails`, `Trash`, `.steam`,
`.var`, `snap`, `__pycache__`, `.cargo`, `.rustup`, `.npm`, `Cache`,
`Code Cache`: "não achou" NÃO é "não existe" — em dúvida, `list` direto na
pasta suspeita.

Resposta de cada comando: `{"id","ok","data"|"error","durationMs","ts"}`.

### 4.3 Ler qualquer arquivo — formato e tamanho

Não existe "arquivo grande demais" nem "formato desconhecido". A receita, igual
no Linux e no Windows:

1. **Pergunte o que é:** `file_info` → tipo real, tamanho e, se for texto, o
   encoding detectado.
2. **Texto:** `read_text` (≤ 2 MB/pedaço, padrão 200 KB) e siga
   `proximoOffset` até `null` — cada resposta traz `encoding`, `lidos`,
   `truncado`, `caracteres`. Encoding não-utf-8? Passe `"encoding"` explícito
   nos pedaços seguintes (a `dica` da resposta avisa; o nome é por extenso:
   `windows-1252`, não `cp1252`).
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
