#!/usr/bin/env node
/*
 * Ponte Local — Agente v1.16.0 (Windows + Linux + macOS + Termux)
 * Roda no SEU computador e executa, sob comando do relay, uma lista FIXA de
 * operações de arquivo. run_command roda em shell de verdade (cmd.exe/bash -c)
 * — por isso a trava anticatástrofe bloqueia os vetores destrutivos conhecidos
 * (alvos catastróficos inclusive a home literal, encadeamento com &, $(),
 * backticks, pipes para interpretadores, xargs de destruição, aliases PS).
 * Sem rede além do próprio relay.
 *
 *   npx ponte-local --server https://SEU-LINK --token SEU_TOKEN --save
 *   (ou, com o agent.js na mão: node agent.js --server ... --token ... --save)
 *
 * Garantias:
 *  - Escopo: somente a sua home (pastas sensíveis bloqueadas)
 *  - Exclusões vão para a lixeira XDG do sistema (recuperáveis)
 *  - Tudo é registrado em ponte-log.jsonl (com desfazer)
 *  - Zero dependências: apenas Node.js puro
 *  - Leitura universal (v1.4.0): qualquer FORMATO (identificado por magic
 *    bytes) e qualquer TAMANHO (read_text/read_binary leem em pedaços com
 *    offset + maxBytes e devolvem proximoOffset)
 *  - modo deus (v1.5.1): run_command SEM confirmação s/N — a ativação é
 *    CONVERSACIONAL: a IA pergunta ao usuário NO CHAT depois de conectar e,
 *    com o aceite dele, envia god_mode {"enabled":true}; zero prompt no
 *    terminal; trava anticatástrofe permanece
 *  - Relatório da tarefa (v1.8.0): a IA fecha a tarefa com
 *    task_done e um RESUMO do que foi feito; o relatório mostra esse resumo
 *    (não lista comandos) e abre no editor de texto do usuário (Windows:
 *    start; Linux: xdg-open; macOS: open); quando a tarefa seguinte começa,
 *    a janela do relatório anterior é FECHADA na tela e o txt é apagado
 *  - Relatório OBRIGATÓRIO (v1.10.0, blindado na v1.10.5): não depende mais
 *    da IA mandar task_done — pausa longa entre comandos (padrão 3 min,
 *    PONTE_TAREFA_GAP_MS) ou o encerramento do agente fecham a tarefa
 *    sozinhos, com relatório aberto na tela do usuário do mesmo jeito.
 *    v1.10.5 corrige a falha real: o fechamento automático não depende mais
 *    de chegar COMANDO NOVO — o próprio loop de poll (a cada 1,5 s) vê a
 *    pausa e abre o relatório sozinho. Antes, com o agente como serviço
 *    (systemd), tarefa esquecida podia ficar SEM relatório para sempre.
 *  - Skill auto-atualizada (v1.5.0, otimizada na v1.9.1): baixa a SKILL.md do
 *    repo no boot e a cada 60 s → ~/ponte-agent/SKILL.md (ação skill_update
 *    força na hora). Otimizações v1.9.1: ETag/If-None-Match (304 = zero bytes
 *    baixados quando nada mudou), escrita ATÔMICA (tmp + rename — queda no
 *    meio nunca deixa SKILL.md truncado), backoff progressivo até 15 min em
 *    falhas de rede e aviso único de falha/recuperação (sem spam a cada minuto)
 *  - Saída visual (v1.9.0): spinner "rodando:" em toda ação em execução e
 *    caixa "output" com stdout/stderr/código ao fim de cada run_command.
 *    Adapta-se ao terminal: ANSI no Linux; no Windows o agente ATIVA o VT do
 *    console sozinho (PowerShell + P/Invoke, sem dependências) e, se não
 *    conseguir (console antigo), cai para \r + ASCII — nunca quebra. Sem TTY
 *    (saída redirecionada/app desktop) o spinner fica desligado.
 *  - Logo no terminal (v1.10.0): arte "PONTE AGENTE" em blocos no boot;
 *    degrada para banner ASCII em console antigo, locale sem UTF-8 ou
 *    terminal estreito — nunca sai embarreirado.
 *  - Termux/Android (v1.10.1): run_command resolve o bash sozinho
 *    (/bin/bash no desktop, $PREFIX/bin/bash no Termux — o Android não
 *    tem /bin). Lixeira XDG e tudo o mais funcionam dentro da home do
 *    Termux como uma máquina normal da ponte (lane própria).
 *  - Largura REAL do terminal (v1.10.4): caixa de output, banner e spinner
 *    medem a janela e SE ADAPTAM — o piso de 40 colunas forçava moldura
 *    mais larga que a janela (Termux em pé com fonte maior quebrava a
 *    moldura). Janela estreita = caixa estreita; só o texto quebra dentro.
 *    TTY sem "columns" usa getWindowSize(); piso 20 contra degenerescência;
 *    cap 100 em ultra-wide; pipe/arquivo segue no padrão 80.
 *
 *  - Screenshot (v1.13.0): as ações screenshot e screenshot_window tiram
 *    print da tela do usuário e devolvem a imagem em base64. ZERO dependência
 *    npm: o agente usa o que a distro JÁ traz — no Linux tenta import
 *    (ImageMagick), scrot, maim, gnome-screenshot, spectacle e grim; no
 *    Windows usa PowerShell + System.Drawing (nativo, sempre presente); no
 *    macOS usa screencapture; no Termux usa termux-screenshot. No X11 a
 *    janela pedida (por id, título ou classe) é capturada exatamente; no
 *    Wayland o compositor não expõe isso de forma genérica, então a janela
 *    EM FOCO é capturada e a resposta avisa. O título da janela vem da IA
 *    e NUNCA entra num shell (execFile com array de args) — sem injeção.
 *  - Mouse (v1.14.0): as ações mouse_position, mouse_move, mouse_click,
 *    mouse_scroll e mouse_drag mexem no cursor do usuário. ZERO dependência
 *    npm: no Windows usa PowerShell + user32 (nativo), no X11 o xdotool, no
 *    Wayland o ydotool/dotool, no Termux o `input` do Android, no macOS o
 *    cliclick. Coordenadas são inteiros validados e NUNCA entram num shell
 *    (execFile com array de args) — sem injeção possível.
 *  - Teclado (v1.16.0): as ações keyboard_type (digita texto) e keyboard_key
 *    (dispara atalhos: enter, tab, backspace, ctrl+c, ctrl+v...) mexem no
 *    teclado do usuário. ZERO dependência npm: no Wayland o ydotool (uinput),
 *    no X11 o xdotool, no Windows PowerShell + SendInput (nativo), no Termux
 *    o `input` do Android. SEGURANÇA: o texto digitado passa pelo MESMO
 *    dangerCheck do run_command (digitar "rm -rf /" num terminal é tão
 *    destrutivo quanto executar) e a ação exige o modo habilitado — a
 *    escalada continua física, digitada pelo usuário.
 *  - Segurança v1.11.0 (audit com subagentes + skills security-review/
 *    security-and-hardening): trava anticatástrofe cobre && no meio do
 *    comando, flags com hífen interno (--no-preserve-root), find -delete,
 *    xargs destrutivo, tee/redirect para /dev/*, curl|bash, chmod/chown -R
 *    em pasta do sistema e rm com $VAR/".."; escopo valida realpath
 *    (symlink/junction não fura mais a home); credenciais (.env, .npmrc,
 *    .git-credentials, config e log do agente) bloqueadas para leitura
 *    remota; resultado do comando reenvia com retry e o cursor só avança
 *    com confirmação (rede caiu ≠ comando perdido); overwrite:true recusa
 *    pasta; timeout mata o GRUPO de processos; token aceito via env
 *    PONTE_AGENT_TOKEN; config com permissão 0600.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");
const { execFile, exec, spawn } = require("child_process");

const VERSION = "1.16.0";
const REQUEST_TIMEOUT_MS = 15000;

// SCRIPT_DIR = pasta do PACOTE (só para achar recursos que vêm com ele).
// Via npx isso é ~/.npm/_npx/<hash>/node_modules/... — efêmera! Então
// NADA que o agente produz (config, log, relatório, skill baixada) pode
// morar aqui: ia sumir no próximo `npx` com hash diferente.
const SCRIPT_DIR = __dirname;

// DATA_DIR = pasta do USUÁRIO, persistente. Config (com o token), log de
// auditoria, relatório da tarefa e a SKILL.md baixada moram aqui.
// Padrão: ~/ponte-agent (a mesma pasta da instalação manual) — ou
// $PONTE_HOME, se o usuário preferir outro lugar.
const DATA_DIR = (() => {
  const env = process.env.PONTE_HOME;
  if (env) return path.resolve(String(env));
  return path.join(os.homedir(), "ponte-agent");
})();

// garante que a pasta existe (0700: o token mora ali dentro)
try {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
} catch (_) {
  /* sem permissão: os writes vão falhar com mensagem própria */
}

const CONFIG_FILE = path.join(DATA_DIR, "ponte.config.json");
const LOG_FILE = path.join(DATA_DIR, "ponte-log.jsonl");
const RELATORIO_FILE = path.join(DATA_DIR, "relatorio-ponte.txt");
const SKILL_URL =
  "https://raw.githubusercontent.com/micsxnn/ponte-local/main/SKILL.md";
const SKILL_FILE = path.join(DATA_DIR, "SKILL.md");
const SKILL_CHECK_MS = 60 * 1000; // no boot + a cada 60 s
const SKILL_BACKOFF_MAX_MS = 15 * 60 * 1000; // teto do backoff em falhas seguidas

let cfg = null; // preenchido no main()

// BUFFER DE LINHA DO TECLADO (v1.16.0)
// A trava anticatástrofe olha o texto digitado. Sem buffer, a IA burlaria
// digitando "rm -rf" (inofensivo sozinho), depois "/", depois Enter — cada
// parte passaria, mas a LINHA COMPLETA é destrutiva. O buffer acumula o que
// foi digitado e o Enter valida a linha inteira, como um terminal de verdade.
let bufferLinha = "";

// ---------------------------------------------------------------- utilidades
function stamp() {
  return new Date().toISOString();
}
function log(msg) {
  // %s em console.log trata a linha como formato (%d, %s do output do usuário
  // sumiriam) — escrever direto no stream é à prova disso
  const linha = "[" + stamp().slice(11, 19) + "] " + msg;
  if (tela.tty && tela.spinAtivo) {
    spinnerLimpaLinha();
    escreve(linha + "\n");
    spinnerDesenha();
  } else {
    escreve(linha + "\n");
  }
}
function fail(msg) {
  console.error("\n[x] " + msg + "\n");
  process.exit(1);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function audit(entry) {
  try {
    // rotação simples (v1.11.0): log > 20 MB vira .old — o append não pode
    // crescer sem teto; undo_last só lê a cauda de qualquer forma
    try {
      if (fs.statSync(LOG_FILE).size > 20 * 1024 * 1024)
        fs.renameSync(LOG_FILE, LOG_FILE + ".old");
    } catch (_) {}
    fs.appendFileSync(LOG_FILE, JSON.stringify(Object.assign({ ts: stamp() }, entry)) + "\n");
  } catch (_) {
    /* o log nunca deve derrubar o agente */
  }
}

// cauda do log p/ undo_last: lê no máximo 512 KB do fim (v1.11.0 — antes o
// undo carregava o log INTEIRO na memória; com meses de uso isso estourava)
function caudaLog(maxBytes) {
  const teto = maxBytes || 512 * 1024;
  try {
    const st = fs.statSync(LOG_FILE);
    const size = Math.min(st.size, teto);
    const buf = Buffer.alloc(size);
    const fd = fs.openSync(LOG_FILE, "r");
    try {
      fs.readSync(fd, buf, 0, size, st.size - size);
    } finally {
      fs.closeSync(fd);
    }
    const linhas = buf.toString("utf8").split("\n").filter(Boolean);
    return st.size > teto ? linhas.slice(1) : linhas; // 1ª linha pode estar cortada
  } catch (_) {
    return [];
  }
}

// ------------------------------------------- tela: spinner + caixa (v1.9.0)
// Linux/macOS: ANSI sempre existiu em terminal de distro. Windows: o cmd.exe
// clássico vem com o modo VT DESLIGADO — o agente tenta ativá-lo sozinho e,
// se não conseguir, tudo degrada para \r + ASCII. Nada aqui pode quebrar o
// agente: toda escrita é protegida e todo recurso tem fallback.
const tela = {
  tty: !!process.stdout.isTTY,
  vt: process.platform !== "win32",
  plataforma: process.platform,
  // braille no Linux (padrão npm/yarn); ASCII no Windows — o conhost com
  // fonte Consolas/raster não tem glifos braille, e "|/-\" renderiza em
  // qualquer fonte e codepage
  frames:
    process.platform === "win32"
      ? ["-", "\\", "|", "/"]
      : ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  spinTimer: null,
  spinAtivo: false,
  spinRotulo: "",
  spinLargura: 0,
  spinInicio: 0,
};

function escreve(s) {
  try {
    process.stdout.write(s);
  } catch (_) {
    /* stream fechado — o agente continua */
  }
}

function larguraTerminal() {
  const out = process.stdout;
  let c = Number(out && out.columns) || 0;
  // TTY que ainda não preencheu "columns": pergunta a janela direto
  if (!c && out && out.isTTY && typeof out.getWindowSize === "function") {
    try {
      c = Number(out.getWindowSize()[0]) || 0; // [0]=colunas ([1]=linhas)
    } catch (_) {
      c = 0;
    }
  }
  if (!c) c = 80; // pipe/arquivo/janela de log: sem info de largura, padrão antigo
  // v1.10.4 — a moldura TEM que caber na janela REAL: nada de piso alto
  // (o piso de 40 forçava caixa de 38 colunas em janela de 35 — quebrava).
  // Piso 20 só contra degenerescência; cap 100 mantém a caixa legível
  // em ultra-wide. Janela de 30 cols? Caixa de 28, moldura íntegra.
  return Math.max(20, Math.min(c, 100));
}

// ------------------------------------------------------------------ logo (v1.10.0)
// PONTE AGENTE — arte em blocos (U+2588 e U+2591) com reflexo nas duas
// ultimas linhas. Renderiza em qualquer terminal UTF-8 do Linux (inclusive
// o console virtual) e no cmd/PowerShell do Windows 10+ (fonte Consolas,
// que tem os blocos; o Node escreve Unicode via WriteConsoleW, sem depender
// de codepage). Onde nao tem garantia (Windows 7/8 com fonte raster, janela
// de log do app desktop, locale sem UTF-8, terminal estreito) o banner cai
// para uma versao 100% ASCII — a arte nunca sai embarreirada na tela.
const LOGO = [
  "████   ███  █   █ █████ █████    █      ███   ███   ███  █",
  "█░░░█ █ ░░█ ██  █░ ░█░░░█░░░░░   █░    █ ░░█ █ ░░░ █ ░░█ █░",
  "████░░█░ ░█░█░█ █░░ █░░░████░░░  █░░   █░ ░█░█░ ░░░█████░█░░",
  "█░░░░ █░░ █░█░░██░░ █░░ █░░░░    █░░   █░░ █░█░░   █░░░█░█░░",
  "█░░░░░ ███ ░█░░ █░░ █░░ █████░   █████  ███ ░░███  █░░░█░█████",
  " ░░     ░░░ ░░░  ░░  ░░  ░░░░░    ░░░░░  ░░░ ░ ░░░  ░░  ░░░░░░░",
  "  ░      ░░░  ░   ░   ░   ░░░░░    ░░░░░  ░░░   ░░░  ░   ░ ░░░░░",
];
const LOGO_LARGURA = Math.max.apply(
  null,
  LOGO.map((l) => l.length)
);

// Decisão de suporte: TTY Linux = UTF-8 por padrão há mais de uma década
// (só recua se o locale for explicitamente não-UTF); Windows = só com TTY e
// Win10+ (Consolas tem os blocos; Win7/8 usa fonte raster que não tem).
function terminalSuportaLogo() {
  if (process.platform === "win32") {
    if (!process.stdout.isTTY) return false; // janela de log do app: fonte desconhecida
    const maj = parseInt(String(os.release()).split(".")[0], 10) || 0;
    return maj >= 10;
  }
  if (!process.stdout.isTTY) return true; // arquivo/pipe: UTF-8 no disco, sem risco de fonte
  const l = String(
    process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || ""
  ).toLowerCase();
  return !l || l.includes("utf") || l.includes("65001");
}

function montarBanner(opts) {
  const unicode = !!(opts && opts.unicode);
  const largura = Math.max(
    40,
    Math.min(Number(opts && opts.largura) || 80, 100)
  );
  if (unicode && largura >= LOGO_LARGURA + 1) {
    return LOGO.map((l) => l.padEnd(LOGO_LARGURA));
  }
  const barra = "=".repeat(Math.min(largura - 2, 50));
  return [barra, "  P O N T E   A G E N T E", barra];
}

// tira escapes ANSI/OSC e \r do output dos comandos (ls --color, curl -#,
// barras de progresso) para caber limpo dentro da caixa
function limpaAnsi(s) {
  return String(s || "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-_]/g, "")
    .replace(/\r/g, "");
}

// Windows: liga ENABLE_VIRTUAL_TERMINAL_PROCESSING (bit 0x0004) no console.
// O modo de console é da SESSÃO — o PowerShell filho seta e o cmd onde o
// agente roda recebe de graça. EncodedCommand (base64 UTF-16LE) elimina
// qualquer dor de quoting. Só devolve OK se o bit foi RELIDO de verdade:
// no Win7/8 o SetConsoleMode falha com esse flag (não existe lá) — sem essa
// re-leitura o agente acharia que tem VT e imprimiria lixo num console mudo.
function fonteVTWindows() {
  const mem =
    '[DllImport("kernel32.dll")]public static extern IntPtr GetStdHandle(int h);' +
    '[DllImport("kernel32.dll")]public static extern bool GetConsoleMode(IntPtr h,out int m);' +
    '[DllImport("kernel32.dll")]public static extern bool SetConsoleMode(IntPtr h,int m);';
  return (
    "try{" +
    "Add-Type -Namespace P -Name K -MemberDefinition '" +
    mem +
    "';" +
    "$h=[P.K]::GetStdHandle(-11);$m=0;" +
    "[void][P.K]::GetConsoleMode($h,[ref]$m);" +
    "[void][P.K]::SetConsoleMode($h,$m -bor 4);" +
    "$m2=0;[void][P.K]::GetConsoleMode($h,[ref]$m2);" +
    "Write-Output $(if($m2 -band 4){'OK'}else{'ERRO'})" +
    "}catch{Write-Output ERRO}"
  );
}

function ativaVTWindows() {
  if (tela.plataforma !== "win32" || !tela.tty || tela.vt) return;
  try {
    execFile(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(fonteVTWindows(), "utf16le").toString("base64"),
      ],
      { timeout: 10000, windowsHide: true, encoding: "utf8" },
      (err, so) => {
        if (!err && /OK/.test(String(so))) tela.vt = true;
      }
    );
  } catch (_) {
    /* sem powershell — segue no modo compatível */
  }
}

// ------------------------------------------------------------------ spinner
function spinnerDesenha() {
  const s = Math.floor((Date.now() - tela.spinInicio) / 1000);
  const f = tela.frames[Math.floor(Date.now() / 110) % tela.frames.length];
  let txt = f + " rodando: " + tela.spinRotulo + (s >= 1 ? " (" + s + "s)" : "");
  // NUNCA passar da largura do terminal — linha que quebra estraga o redesenho
  const max = Math.max(16, larguraTerminal() - 1);
  if (txt.length > max) txt = txt.slice(0, max - 3) + "...";
  if (tela.vt) escreve("\r\x1b[2K" + txt);
  else escreve("\r" + txt + " ".repeat(Math.max(0, tela.spinLargura - txt.length)));
  if (txt.length > tela.spinLargura) tela.spinLargura = txt.length;
}

function spinnerLimpaLinha() {
  if (tela.vt) escreve("\r\x1b[2K");
  else escreve("\r" + " ".repeat(Math.max(0, tela.spinLargura)) + "\r");
}

function spinnerInicio(rotulo) {
  if (!tela.tty || tela.spinTimer) return;
  tela.spinAtivo = true;
  tela.spinInicio = Date.now();
  tela.spinRotulo = String(rotulo || "").replace(/\s+/g, " ").trim();
  tela.spinLargura = 0;
  spinnerDesenha();
  tela.spinTimer = setInterval(spinnerDesenha, 110);
  if (tela.spinTimer.unref) tela.spinTimer.unref();
}

function spinnerFim() {
  if (tela.spinTimer) {
    clearInterval(tela.spinTimer);
    tela.spinTimer = null;
  }
  if (tela.spinAtivo) spinnerLimpaLinha();
  tela.spinAtivo = false;
  tela.spinRotulo = "";
  tela.spinLargura = 0;
}

// v1.10.2 — o spinner precisa ser PERCEBIDO: uma ação instantânea (list de
// 13 ms) ligava e desligava o girador antes do olho humano captar, e o
// usuário julgava que ele não existia. Ao fechar, segura o girador até
// completar este mínimo (só em TTY — sem TTY o spinner nem liga).
const SPIN_MINIMO_MS = 600;
const esperaMs = (ms) => new Promise((r) => setTimeout(r, ms));
async function spinnerGaranteMinimo() {
  if (!tela.tty || !tela.spinAtivo) return;
  const restante = SPIN_MINIMO_MS - (Date.now() - tela.spinInicio);
  if (restante > 0) await esperaMs(restante);
}

// ------------------------------------------------------------ caixa de output
// Imprime UMA vez, quando o comando termina — nada de redesenho, funciona do
// cmd.exe com fonte raster do Win7 ao Windows Terminal. Sem VT: caixa ASCII.
// v1.10.3 — NADA de truncar: linha maior que a largura QUEBRA (no espaço,
// se houver) e continua na linha seguinte, dentro da moldura. E a largura
// total da caixa fica 2 colunas abaixo do terminal: preencher a última
// coluna ativa o wrap automático do terminal e desalinha a moldura inteira
// (bug visto no Termux com o free -h).
// v1.10.4 — a largura passa a ser a LARGURA REAL da janela (larguraTerminal
// sem piso 40): terminal estreito = caixa estreita; só o texto quebra.
function quebraLargura(txt, larg) {
  const saida = [];
  for (const bruta of limpaAnsi(String(txt == null ? "" : txt)).replace(/\t/g, "    ").split("\n")) {
    const chars = [...bruta];
    if (chars.length <= larg) {
      saida.push(bruta);
      continue;
    }
    // linear (v1.12.0): antes re-espalhava a string a cada volta — O(n²),
    // e um stdout de 8 MB em linha única congelava o agente por minutos
    let start = 0;
    while (start < chars.length) {
      let pos = -1;
      for (let i = Math.min(start + larg, chars.length - 1); i > start; i--) {
        if (chars[i] === " ") {
          pos = i;
          break;
        }
      }
      if (pos <= start) pos = start + larg;
      saida.push(chars.slice(start, pos).join(""));
      start = pos;
      while (start < chars.length && chars[start] === " ") start++;
    }
  }
  return saida;
}

function caixaOutput(titulo, stdout, stderr, codigo) {
  const L = larguraTerminal();
  const interna = Math.max(12, L - 6);
  const gl = tela.vt
    ? { st: "┌", hr: "─", mi: "│", ml: "├", mr: "┤", sm: "┐", sl: "└", sr: "┘" }
    : { st: "+", hr: "-", mi: "|", ml: "+", mr: "+", sm: "+", sl: "+", sr: "+" };
  const encaixa = (v) => {
    const s = String(v);
    return s + " ".repeat(Math.max(0, interna - [...s].length));
  };
  const linha = (v) => gl.mi + " " + encaixa(v) + " " + gl.mi;
  const centro = (rot) => {
    const t = [...String(rot || "")].slice(0, interna - 2).join("");
    const fill = Math.max(1, interna - [...t].length - 1);
    return gl.st + gl.hr + " " + t + " " + gl.hr.repeat(fill) + gl.sm;
  };
  const linhasDe = (txt, cap) => {
    const quebradas = quebraLargura(txt, interna);
    while (quebradas.length && !quebradas[quebradas.length - 1].trim()) quebradas.pop();
    const fora = quebradas.slice(0, cap).map(linha);
    if (quebradas.length > cap)
      fora.push(linha("… (mais " + (quebradas.length - cap) + " linhas)"));
    return fora;
  };

  const fora = [];
  fora.push(
    centro(String(titulo || "output") + (codigo != null && codigo !== 0 ? " (código " + codigo + ")" : ""))
  );
  const so = linhasDe(stdout, 60);
  const se = linhasDe(stderr, 30);
  if (!so.length && !se.length) fora.push(linha("(sem saída)"));
  else {
    for (const l of so) fora.push(l);
    if (se.length) {
      fora.push(gl.ml + gl.hr + " stderr " + gl.hr.repeat(Math.max(1, interna - 7)) + gl.mr);
      for (const l of se) fora.push(l);
    }
  }
  fora.push(gl.sl + gl.hr.repeat(interna + 2) + gl.sr);
  return fora.join("\n");
}

// ---------------------------------------------------------------- config
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

function loadConfig(cli) {
  let c = {};
  try {
    c = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (_) {}
  if (cli.server) c.server = cli.server;
  if (cli.token) c.token = cli.token;
  if (!c.token && process.env.PONTE_AGENT_TOKEN)
    c.token = String(process.env.PONTE_AGENT_TOKEN); // token via env: não aparece no ps
  if (cli.home) c.home = cli.home;
  if (!c.server)
    fail(
      "Falta o servidor. Rode:\n" +
        "  npx ponte-local --server https://SEU-LINK-DE-PREVIEW --token SEU_TOKEN --save\n" +
        "  (ou, se você tem o agent.js na mão: node agent.js --server ... --token ... --save)\n" +
        "(link e token estão no chat)"
    );
  if (!c.token)
    fail(
      "Falta o token. Pegue-o no chat e rode de novo com --token SEU_TOKEN --save:\n" +
        "  npx ponte-local --server https://SEU-LINK --token SEU_TOKEN --save"
    );
  if (!/^https?:\/\//i.test(c.server)) c.server = "https://" + c.server;
  c.server = String(c.server).replace(/\/+$/, "");
  c.home = c.home ? path.resolve(String(c.home)) : os.homedir();
  try { fs.chmodSync(CONFIG_FILE, 0o600); } catch (_) {} // config guarda token: só o dono lê (v1.11.0)
  // Modo supervisionado: run_command só funciona se ativado explicitamente.
  if (cli["allow-run"]) c.run = true;
  // Modo autônomo (--auto): run_command SEM confirmação (implica --allow-run).
  // A escalada de permissão é sempre FÍSICA — digitada por você no terminal.
  if (cli.auto) {
    c.run = true;
    c.auto = true;
  }
  // modo deus (v1.5.1): vive em ponte.config.json e implica run habilitado.
  // Nunca ativa via CLI flag — só god_mode enviado pela IA depois de o
  // usuário ACEITAR na conversa (a IA pergunta no chat, nunca no terminal).
  if (c.godMode) c.run = true;
  return c;
}

function saveConfig(c) {
  // v1.13.0: a config mora na pasta de DADOS do usuário (fora do pacote
  // npx). Se a escrita falhar, o erro precisa aparecer — antes a exceção
  // subia e era engolida pelo uncaughtException, e o modo deus "sumia"
  // sem ninguém perceber.
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  } catch (_) {}
  try {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify({
        server: c.server,
        token: c.token,
        home: c.home,
        run: !!c.run,
        auto: !!c.auto,
        godMode: !!c.godMode,
        godModeDeclined: !!c.godModeDeclined,
      }),
      { encoding: "utf8", mode: 0o600 } // token em texto plano: só o dono lê
      // (v1.12.0: as opções iam parar no JSON.stringify e o arquivo nascia 0644;
      //  o chmod do boot consertava na releitura — agora nasce certo)
    );
    return true;
  } catch (e) {
    log("ERRO ao gravar a config em " + CONFIG_FILE + ": " + (e && e.message));
    log("A ponte NÃO vai lembrar do servidor/token no próximo boot. Verifique as permissões dessa pasta.");
    return false;
  }
}

// ---------------------------------------------------------------- HTTP
function apiCall(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(cfg.server + urlPath);
    } catch (e) {
      return reject(new Error("URL inválida: " + cfg.server + urlPath));
    }
    const lib = u.protocol === "https:" ? https : http;
    const payload = body ? Buffer.from(JSON.stringify(body), "utf8") : null;
    // POST grande (read_binary ~10 MB) não cabe em 15 s em link lento:
    // 15 s + 30 s por MB acima de 512 KB (v1.11.0 — resultado não se perde
    // nem o relay re-entrega o comando por timeout do agente)
    const timeoutMs =
      payload && payload.length > 512 * 1024
        ? REQUEST_TIMEOUT_MS + Math.ceil(payload.length / (1024 * 1024)) * 30000
        : REQUEST_TIMEOUT_MS;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method,
        timeout: timeoutMs,
        headers: Object.assign(
          { "x-ponte-token": cfg.token },
          payload
            ? { "content-type": "application/json", "content-length": payload.length }
            : {}
        ),
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > 3 * 1024 * 1024) {
            req.destroy();
            reject(new Error("Resposta grande demais"));
          } else chunks.push(c);
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve(JSON.parse(text));
          } catch (_) {
            reject(new Error("Resposta não é JSON (HTTP " + res.statusCode + ")"));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("Tempo esgotado")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------- escopo
const BLOCKED_DIRS = new Set([
  ".ssh", ".gnupg", ".config", ".password-store", ".aws", ".kube",
  ".ponte-agent", "ponte-agent", ".docker", ".mozilla", "keyrings",
]);
// arquivos que carregam credencial direto — leitura remota NUNCA (v1.11.0)
const BLOCKED_FILES = new Set([
  ".env", ".npmrc", ".netrc", ".git-credentials", ".wgetrc", ".pypirc", ".htpasswd",
]);
// config e log do agente levam token/histórico: bloqueados por CAMINHO REAL,
// não por nome de pasta (antes bastava instalar fora de ~/ponte-agent)
const CAMINHOS_PROTEGIDOS = new Set([path.resolve(CONFIG_FILE), path.resolve(LOG_FILE)]);
// família do log (v1.12.0): a rotação cria ponte-log.jsonl.old — proteja o
// prefixo inteiro, não só o nome exato (o .old escapava da leitura remota)
const LOG_PREFIXO_PROTEGIDO = path.join(path.dirname(path.resolve(LOG_FILE)), "ponte-log.jsonl");
// v1.13.0: a pasta de DADOS do agente (config, log, relatório, skill
// baixada) é inteira bloqueada para leitura remota. Antes os caminhos
// protegidos saíam de __dirname — via npx isso aponta para o cache
// efêmero e a proteção não cobria nada.
const DATA_DIR_RESOLVIDO = path.resolve(DATA_DIR);
function caminhoProtegido(rp) {
  const r = path.resolve(rp);
  return (
    CAMINHOS_PROTEGIDOS.has(r) ||
    String(r).startsWith(LOG_PREFIXO_PROTEGIDO) ||
    r === DATA_DIR_RESOLVIDO ||
    r.startsWith(DATA_DIR_RESOLVIDO + path.sep)
  );
}

function assertAllowed(p) {
  let s = String(p);
  // ~ e %USERPROFILE% viram a home de verdade (v1.11.0 — antes "~/x" era
  // resolvido contra o cwd e variava conforme onde o agente nasceu)
  s = s.replace(/^~(?=\/|\\|$)/, cfg.home).replace(/^%USERPROFILE%(?=\/|\\|$)/i, cfg.home);
  let rp = path.resolve(s);
  const home = path.resolve(cfg.home);
  const foraDoEscopo = (caminho) =>
    caminho !== home && !caminho.startsWith(home + path.sep);
  if (foraDoEscopo(rp)) {
    throw new Error("Fora do escopo: só opero dentro de " + home);
  }
  // realpath (v1.11.0): symlink/junction dentro da home apontando pra fora
  // não fura mais o escopo — valida o caminho REAL, não só o lexical
  try {
    const real = fs.realpathSync(rp);
    if (real !== rp) {
      if (foraDoEscopo(real))
        throw new Error("Caminho real fora do escopo (symlink/junction): " + real);
      rp = real;
    }
  } catch (e) {
    if (e.message && e.message.indexOf("escopo") !== -1) throw e;
    // caminho ainda não existe (write): valida o ancestral existente mais próximo
    let anc = path.dirname(rp);
    for (let i = 0; i < 40 && anc !== path.dirname(anc); i++) {
      try {
        const real = fs.realpathSync(anc);
        if (foraDoEscopo(real))
          throw new Error("Ancestral do caminho é symlink para fora do escopo: " + real);
        break;
      } catch (e2) {
        if (e2.message && e2.message.indexOf("escopo") !== -1) throw e2;
        anc = path.dirname(anc);
      }
    }
  }
  const rel = path.relative(home, rp);
  const parts = rel.split(path.sep).filter(Boolean);
  if (parts.some((part) => BLOCKED_DIRS.has(part)))
    throw new Error("Pasta protegida no caminho");
  if (BLOCKED_FILES.has(path.basename(rp)) || caminhoProtegido(rp))
    throw new Error("Arquivo protegido (credenciais/config do agente) — acesso remoto bloqueado");
  return rp;
}

const SKIP_WALK = new Set([
  "node_modules", ".git", ".cache", "cache", ".thumbnails", "Trash",
  ".steam", ".var", "snap", "__pycache__", ".cargo", ".rustup", ".npm",
  "Cache", "Code Cache",
]);

function walk(rootRp, opts, cb) {
  const t0 = Date.now();
  const queue = [{ p: rootRp, depth: 0 }];
  let visited = 0;
  while (queue.length) {
    const { p, depth } = queue.shift();
    if (depth > (opts.maxDepth || 10)) return visited;
    if (opts.timeCapMs && visited % 400 === 0 && Date.now() - t0 > opts.timeCapMs) return visited;
    let entries;
    try {
      entries = fs.readdirSync(p, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const ent of entries) {
      visited++;
      if (visited > (opts.maxEntries || 80000)) return visited;
      const full = path.join(p, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_WALK.has(ent.name) && !BLOCKED_DIRS.has(ent.name))
          queue.push({ p: full, depth: depth + 1 });
        continue;
      }
      if (ent.isFile()) cb(full);
    }
  }
  return visited;
}

function looksBinary(rp) {
  const fd = fs.openSync(rp, "r");
  try {
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, 8192, 0);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

// ------------------------------------------------- leitura universal (v1.4.0)
// FORMATO: identifica o tipo pela assinatura (magic bytes). TAMANHO:
// read_text/read_binary aceitam offset+maxBytes e devolvem proximoOffset —
// arquivos de qualquer tamanho são lidos em pedaços, sem estourar memória
// nem o limite de corpo da ponte (12 MB).

// Pura: identifica o formato pelos primeiros bytes (até 16). null = sem assinatura.
function tipoPorAssinatura(head) {
  const hex = head.toString("hex");
  const txt = (o, l) => head.subarray(o, o + l).toString("latin1");
  if (hex.startsWith("89504e470d0a1a0a")) return "png";
  if (hex.startsWith("ffd8ff")) return "jpeg";
  if (hex.startsWith("47494638")) return "gif";
  if (hex.startsWith("424d")) return "bmp";
  if (txt(0, 4) === "RIFF") {
    const f = txt(8, 4);
    if (f === "WEBP") return "webp";
    if (f === "WAVE") return "wav";
    if (f === "AVI ") return "avi";
  }
  if (txt(4, 4) === "ftyp") return "mp4"; // mp4/mov/m4a (assinatura no byte 4)
  if (hex.startsWith("25504446")) return "pdf";
  if (hex.startsWith("504b0304") || hex.startsWith("504b0506") || hex.startsWith("504b0708"))
    return "zip"; // zip/docx/xlsx/jar/apk
  if (hex.startsWith("1f8b")) return "gzip";
  if (hex.startsWith("425a68")) return "bzip2";
  if (hex.startsWith("fd377a585a00")) return "xz";
  if (hex.startsWith("377abcaf271c")) return "7z";
  if (hex.startsWith("526172211a07")) return "rar";
  if (hex.startsWith("d0cf11e0a1b11ae1")) return "ole"; // .doc/.xls/.ppt antigos
  if (hex.startsWith("494433")) return "mp3";
  if (hex.startsWith("4f676753")) return "ogg";
  if (hex.startsWith("664c6143")) return "flac";
  if (hex.startsWith("7f454c46")) return "elf";
  if (hex.startsWith("4d5a")) return "exe"; // MZ — .exe/.dll do Windows
  if (hex.startsWith("00000100")) return "ico";
  if (hex.startsWith("53514c69746520")) return "sqlite";
  if (hex.startsWith("0061736d")) return "wasm";
  if (hex.startsWith("cafebabe")) return "class"; // bytecode java
  if (txt(0, 4) === "wOFF") return "woff";
  if (txt(0, 4) === "wOF2") return "woff2";
  if (hex.startsWith("00010000") || txt(0, 4) === "OTTO") return "fonte"; // ttf/otf
  if (txt(0, 7) === "!<arch>") return "ar"; // .a/.deb
  if (txt(0, 4) === "%!PS") return "postscript";
  if (hex.startsWith("4c000000")) return "lnk"; // atalho .lnk do Windows
  return null;
}

// Lê o início do arquivo e classifica: assinatura → tipo; sem assinatura →
// texto (com encoding) ou binário genérico. Nunca joga erro em caso estranho.
function sniffTipo(rp, size) {
  if (size === 0) return { tipo: "vazio", provavelTexto: true, encoding: null };
  const fd = fs.openSync(rp, "r");
  let head;
  try {
    head = Buffer.alloc(Math.min(16, size));
    fs.readSync(fd, head, 0, head.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  const assinado = tipoPorAssinatura(head);
  if (assinado) return { tipo: assinado, provavelTexto: false, encoding: null };
  // ISO9660 esconde a assinatura em 0x8001
  if (size > 0x8006) {
    const fd2 = fs.openSync(rp, "r");
    try {
      const b = Buffer.alloc(5);
      fs.readSync(fd2, b, 0, 5, 0x8001);
      if (b.toString("latin1") === "CD001") return { tipo: "iso", provavelTexto: false, encoding: null };
    } finally {
      fs.closeSync(fd2);
    }
  }
  // sem assinatura conhecida: amostra decide texto × binário
  const fd3 = fs.openSync(rp, "r");
  try {
    const amostra = Buffer.alloc(Math.min(65536, size));
    const n = fs.readSync(fd3, amostra, 0, amostra.length, 0);
    const a = amostra.subarray(0, n);
    if (a.length >= 2 && a[0] === 0xff && a[1] === 0xfe)
      return { tipo: "texto", provavelTexto: true, encoding: "utf-16le" };
    if (a.length >= 2 && a[0] === 0xfe && a[1] === 0xff)
      return { tipo: "texto", provavelTexto: true, encoding: "utf-16be" };
    let ruins = 0;
    for (let i = 0; i < a.length; i++) {
      const c = a[i];
      if (c === 0 || (c < 32 && c !== 9 && c !== 10 && c !== 11 && c !== 12 && c !== 13) || c === 127)
        ruins++;
    }
    if (ruins / a.length > 0.02) return { tipo: "desconhecido", provavelTexto: false, encoding: null };
    return { tipo: "texto", provavelTexto: true, encoding: detectarEncoding(a) };
  } finally {
    fs.closeSync(fd3);
  }
}

// Detecta encoding de uma amostra: BOM → utf-8 estrito → cp1252 → latin1.
// A amostra pode ter sido cortada no meio do último caractere — o trim do
// decodificador utf-8 (temMais=true) cuida disso antes de desistir do utf-8.
function detectarEncoding(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return "utf-16le";
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return "utf-16be";
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return "utf-8";
  if (decodificarUtf8Estrito(buf, true).ok) return "utf-8";
  try {
    new TextDecoder("windows-1252", { fatal: true }).decode(buf);
    return "windows-1252";
  } catch (_) {}
  return "latin1";
}

// utf-8 ESTRITO de um buffer. Se o pedaço termina no meio de um caractere e
// existem mais bytes no arquivo, corta o rabinho (o próximo read recomeça nele).
function decodificarUtf8Estrito(buf, temMais) {
  let fim = buf.length;
  if (temMais && fim > 0) {
    let i = fim - 1;
    while (i >= 0 && (buf[i] & 0xc0) === 0x80) i--;
    const nCont = fim - 1 - i;
    if (i >= 0 && (buf[i] & 0x80) !== 0) {
      // byte líder (11xxxxxx) no fim: se anuncia mais bytes do que existem,
      // o caractere está incompleto — corta (o próximo read recomeça nele)
      const lead = buf[i];
      let esperado = 1;
      if ((lead & 0xe0) === 0xc0) esperado = 2;
      else if ((lead & 0xf0) === 0xe0) esperado = 3;
      else if ((lead & 0xf8) === 0xf0) esperado = 4;
      if (esperado > nCont + 1) fim = i;
    }
  }
  if (fim === 0) return { ok: true, texto: "", usados: 0 };
  try {
    return { ok: true, texto: new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(0, fim)), usados: fim };
  } catch (_) {
    return { ok: false, texto: "", usados: 0 };
  }
}

// utf-16: dados já alinhados em limite de unidade (2 bytes). Corta byte ímpar
// e surrogate alta sem par do fim — ambos voltam no próximo pedaço.
function decodificarUtf16Pedaco(dados, enc, temMais) {
  let fim = dados.length - (dados.length % 2);
  if (temMais && fim >= 2) {
    const unidade =
      enc === "utf-16be"
        ? (dados[fim - 2] << 8) | dados[fim - 1]
        : dados[fim - 2] | (dados[fim - 1] << 8);
    if ((unidade & 0xfc00) === 0xd800) fim -= 2; // surrogate alta órfã
  }
  try {
    const texto = new TextDecoder(enc, { fatal: false }).decode(dados.subarray(0, fim));
    return { ok: true, texto, usados: fim };
  } catch (_) {
    return { ok: false, texto: "", usados: fim }; // build sem ICU completa
  }
}

// Coração do read_text: transforma um pedaço de bytes em texto decente.
// encoding "auto" detecta (BOM/utf-8/cp1252/latin1); ou força um fixo.
// Retorna { encoding, conteudo, consumidos } — consumidos em BYTES do arquivo.
function decodificarPedaco(buf, inicioAbs, temMais, encoding) {
  const auto = !encoding || encoding === "auto";
  if (!buf.length)
    return { encoding: auto ? "utf-8" : encoding, conteudo: "", consumidos: 0 };

  if (!auto && (encoding === "utf-16le" || encoding === "utf-16be")) {
    let dados = buf;
    let extras = 0;
    if (
      inicioAbs === 0 &&
      buf.length >= 2 &&
      ((encoding === "utf-16le" && buf[0] === 0xff && buf[1] === 0xfe) ||
        (encoding === "utf-16be" && buf[0] === 0xfe && buf[1] === 0xff))
    ) {
      dados = buf.subarray(2);
      extras = 2;
    }
    const r = decodificarUtf16Pedaco(dados, encoding, temMais);
    if (!r.ok) throw new Error("Este Node não tem decodificador " + encoding + " — use read_binary");
    return { encoding, conteudo: r.texto, consumidos: r.usados + extras };
  }

  if (!auto && (encoding === "windows-1252" || encoding === "latin1")) {
    // 1 byte = 1 caractere: sem fronteiras, lê tudo
    if (encoding === "latin1")
      return { encoding, conteudo: buf.toString("latin1"), consumidos: buf.length };
    try {
      return { encoding, conteudo: new TextDecoder("windows-1252", { fatal: true }).decode(buf), consumidos: buf.length };
    } catch (_) {
      return { encoding: "latin1", conteudo: buf.toString("latin1"), consumidos: buf.length };
    }
  }

  // auto: BOM utf-16 no primeiro pedaço declara o formato — decodifica direto
  if (auto && inicioAbs === 0 && buf.length >= 2 && (buf[0] === 0xff || buf[0] === 0xfe)) {
    if (buf[0] === 0xff && buf[1] === 0xfe && !(buf[2] === 0 && buf[3] === 0)) {
      const r = decodificarUtf16Pedaco(buf.subarray(2), "utf-16le", temMais);
      if (r.ok) return { encoding: "utf-16le", conteudo: r.texto, consumidos: r.usados + 2 };
    } else if (buf[0] === 0xfe && buf[1] === 0xff && !(buf[2] === 0 && buf[3] === 0)) {
      const r = decodificarUtf16Pedaco(buf.subarray(2), "utf-16be", temMais);
      if (r.ok) return { encoding: "utf-16be", conteudo: r.texto, consumidos: r.usados + 2 };
    }
  }

  // utf-8: primeiro pedaço pode ter BOM — tira
  let dados = buf;
  let extras = 0;
  if (inicioAbs === 0 && dados.length >= 3 && dados[0] === 0xef && dados[1] === 0xbb && dados[2] === 0xbf) {
    dados = dados.subarray(3);
    extras = 3;
  }
  const prim = decodificarUtf8Estrito(dados, temMais);
  if (prim.ok) return { encoding: "utf-8", conteudo: prim.texto, consumidos: prim.usados + extras };
  // continuação de caractere cortado na fronteira do pedaço anterior: pula até 3 bytes
  if (inicioAbs > 0) {
    let pula = 0;
    while (pula < 3 && pula < dados.length && (dados[pula] & 0xc0) === 0x80) pula++;
    if (pula > 0) {
      const r = decodificarUtf8Estrito(dados.subarray(pula), temMais);
      if (r.ok) return { encoding: "utf-8", conteudo: r.texto, consumidos: r.usados + pula + extras };
    }
  }
  // não é utf-8: textos antigos do Windows e depois latin1 puro
  try {
    return { encoding: "windows-1252", conteudo: new TextDecoder("windows-1252", { fatal: true }).decode(dados), consumidos: dados.length + extras };
  } catch (_) {}
  return { encoding: "latin1", conteudo: dados.toString("latin1"), consumidos: dados.length + extras };
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  for (let i = 2; i < 10000; i++) {
    const cand = path.join(dir, base + "." + i + ext);
    if (!fs.existsSync(cand)) return cand;
  }
  throw new Error("Sem nome livre para " + p);
}

function fmtMB(n) {
  return +(n / 1048576).toFixed(1) + " MB";
}

// ------------------------------------------------- trava anticatástrofe
// No modo autônomo os comandos rodam SEM confirmação — mas os padrões abaixo
// são recusados sempre: destroem o sistema de uma vez e não têm desfazer.
// No modo supervisionado não se aplica (quem decide é o humano, com o aviso).
const ALVO_SISTEMA = /^(~\/?|\$HOME\/?|\/\*?|\/home\/?|\/home\/\*|\/boot(\/.*)?|\/etc(\/.*)?|\/usr(\/.*)?|\/var(\/.*)?|\/lib(\/.*)?|\/opt(\/.*)?|\/mnt(\/.*)?|\/media(\/.*)?|\*)$/;

// Alvos catastróficos no Windows (raiz de drive, pastas do sistema, home).
const ALVO_SISTEMA_WIN = /^(?:[a-z]:\\?|[a-z]:\\windows(?:\\.*)?|[a-z]:\\program files(?: \(x86\))?(?:\\.*)?|\$home|~\/?|%systemroot%)$/i;

function dangerCheck(cmdline, ctx) {
  const homeRes = ctx && ctx.home ? path.resolve(String(ctx.home)) : null;
  const cwdRes = ctx && ctx.cwd ? path.resolve(String(ctx.cwd)) : homeRes;
  const homeRaw = ctx && ctx.home ? String(ctx.home) : null; // cru: no Linux, resolve() embaralha caminho Windows
  // fork bomb clássico: :(){ :|:& };:
  if (/:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?/.test(cmdline)) return "fork bomb";
  // expansão aninhada esconde o comando real do analisador (v1.12.0)
  if (/\$\(/.test(cmdline) || /`/.test(cmdline) || />\(/.test(cmdline))
    return "expansão de comando ($( ), backtick ou >() — reformule sem aninhamento";
  // formatar / apagar assinaturas de filesystem
  if (/\bmkfs(\.[a-z0-9]+)?\b/i.test(cmdline)) return "mkfs (formatar filesystem)";
  if (/\bwipefs\b/i.test(cmdline)) return "wipefs";
  // escrever direto em dispositivo de bloco
  if (/\bdd\b[^|;&]*\bof\s*=\s*\/dev\/(sd|nvme|mmcblk|hd|vd|loop)/i.test(cmdline))
    return "dd escrevendo em dispositivo";
  if (/\bshred\b[^|;&]*\/dev\/(sd|nvme|mmcblk|hd|vd)/i.test(cmdline))
    return "shred em dispositivo";
  if (/(^|[^a-z0-9])>\s*\/dev\/(sd|nvme|mmcblk|hd|vd)/i.test(cmdline))
    return "escrita direta em dispositivo";
  // destruição em massa além do rm (v1.11.0): find -delete, xargs destrutivo,
  // tee/redirect para dispositivo, script da internet direto no shell,
  // chmod/chown -R em pasta do sistema
  if (/\bfind\b[^|;&]*\s-delete\b/i.test(cmdline)) return "find -delete (remoção em massa)";
  if (/\bxargs\b\s+(?:-0\s+)?(?:sudo\s+)?(rm|dd|mkfs|shred)\b/i.test(cmdline))
    return "xargs com comando destrutivo";
  // xargs com flags no meio (v1.12.0): "ls / | xargs -I{} rm -rf {}" passava
  if (/\bxargs\b[^|;&]*\b(rm|dd|mkfs|shred)\b/i.test(cmdline))
    return "xargs com comando destrutivo (flags no meio)";
  if (/(\||^)\s*(sudo\s+)?tee\s+[^|;&]*\/dev\/(sd|nvme|mmcblk|hd|vd|mapper)/i.test(cmdline))
    return "tee escrevendo em dispositivo";
  if (/(^|[^a-z0-9])>>?\s*\/dev\/(sd|nvme|mmcblk|hd|vd|mapper)/i.test(cmdline))
    return "escrita direta em dispositivo";
  if (/\bcp\b[^|;&]*\s\/dev\/(sd|nvme|mmcblk|hd|vd|mapper)/i.test(cmdline))
    return "cp escrevendo em dispositivo";
  if (/\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/i.test(cmdline))
    return "script da internet executado direto no shell";
  // pipe para interpretador de qualquer origem (v1.12.0): base64 -d|sh etc.
  if (/\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/i.test(cmdline)) return "execução de shell via pipe";
  if (/\|\s*(?:sudo\s+)?(?:python\d?|perl|ruby|php)\b/i.test(cmdline))
    return "execução de interpretador via pipe";
  if (/\b(chmod|chown)\b\s+(-R|--recursive)\b[^|;&]*\s+\/(etc|usr|boot|var|lib|bin|sbin|opt)\b/i.test(cmdline))
    return "chmod/chown recursivo em pasta do sistema";
  // ---- v1.16.0: a lista e de "STRINGS perigosas"; o requisito real e
  // "ACOES perigosas". Estes padroes executam um comando destrutivo
  // ESCONDIDO dentro de outra coisa — e a travacao do run_command tambem
  // os deixava passar.
  //
  // As regras olham o COMANDO PRINCIPAL de cada segmento (o primeiro token
  // depois de "sudo"), nao a palavra solta: "echo shutdown" so imprime a
  // palavra e tem que passar.
  const principalDe = (seg) => {
    const t = seg.trim().replace(/^(?:sudo\s+)+/i, "").replace(/^\(\s*/i, "").split(/\s+/)[0] || "";
    return t.replace(/["']/g, "").toLowerCase();
  };
  const segmentosCmd = cmdline.split(/\n|;|&&|\|\||\||&/);
  const algumPrincipal = (...nomes) => segmentosCmd.some((seg) => nomes.includes(principalDe(seg)));

  // shell dentro de shell: bash -c 'rm -rf /'
  if (/\b(?:ba|z|k|da|c)?sh\b\s+-c\s+['"]/.test(cmdline))
    return "shell dentro de shell (-c) — o comando real fica escondido";
  // find com -exec/-execdir rodando um destrutivo
  if (/\bfind\b[^|;&]*\s-(?:exec|execdir)\b[^|;&]*\b(rm|dd|mkfs|shred|chmod|chown)\b/i.test(cmdline))
    return "find com -exec destrutivo";
  // execucao de script: sh x.sh, bash x.sh (o sh tem que ser o COMANDO)
  if (algumPrincipal("sh", "bash", "zsh", "ksh", "dash", "csh", "tcsh") && /\.(?:sh|bash)\b/.test(cmdline))
    return "execucao de script";
  // download + execucao (o pipe ja e coberto; falta o && / ; / ||)
  if (/\b(curl|wget)\b[^|;&]*\b(?:ba|z|k|da|c)?sh\b/i.test(cmdline))
    return "download + execucao de script";
  // derrubar a maquina (so quando e o comando principal)
  if (algumPrincipal("shutdown", "reboot", "halt", "poweroff"))
    return "desligar/reiniciar a maquina";
  // parar/desabilitar servico (so quando e o comando principal)
  if (algumPrincipal("systemctl") && /\bsystemctl\s+(?:stop|disable|mask)\b/i.test(cmdline))
    return "parar/desabilitar servico";
  // ler credenciais do sistema (so quando o cat e o comando principal)
  if (algumPrincipal("cat") && /\/(?:etc\/shadow|etc\/sudoers)\b/.test(cmdline))
    return "leitura de arquivo de credenciais";
  // v1.16.0: chmod/chown na RAIZ ("/", com ou sem -R) e recursivo na HOME
  // passavam — a regex acima so pegava /etc, /usr, /boot... A trava e o
  // digitacao de teclado usam esta mesma funcao, entao a lacuna valia pros
  // dois lados.
  {
    const ehRec = (seg) => /\b(chmod|chown)\b\s+(-R|--recursive)\b/i.test(seg);
    // so o segmento em que chmod/chown e o COMANDO PRINCIPAL: "echo chmod /"
    // so imprime a palavra e tem que passar
    const segChmod = cmdline
      .split(/\n|;|&&|\|\||\||&/)
      .find((seg) => {
        if (!/\b(chmod|chown)\b/i.test(seg)) return false;
        const primeiro = (seg.trim().replace(/^(?:sudo\s+)+/i, "").split(/\s+/)[0] || "").replace(/["']/g, "").toLowerCase();
        return primeiro === "chmod" || primeiro === "chown";
      });
    if (segChmod) {
      const recursivo = ehRec(segChmod);
      const toksChmod = segChmod.trim().split(/\s+/);
      for (const t of toksChmod) {
        if (t.startsWith("-")) continue;
        const limpo = t.replace(/["']/g, "");
        if (!limpo) continue;
        // "/" e "/*" sao a raiz; "/." e "/.." tambem (a mesma raiz, escrito
        // de outro jeito) — e "$HOME" e a home
        const ehRaiz = limpo === "/" || limpo === "/*" || limpo === "/." || limpo === "/..";
        let ehHome = false;
        if (homeRes) {
          const exp = /^~/.test(limpo) ? path.join(homeRes, limpo.slice(1)) : limpo;
          const resolvido = path.isAbsolute(exp) ? path.resolve(exp) : path.resolve(cwdRes || homeRes, exp);
          ehHome = resolvido === homeRes;
        }
        // variavel nao resolvida: o alvo real e desconhecido (mesma regra
        // do rm recursivo)
        if (/\$/.test(limpo))
          return "chmod/chown com variavel nao resolvida (" + t + ") — use caminho literal";
        // na raiz, com ou sem recursivo, muda a permissão de tudo: catástrofe
        if (ehRaiz) return "chmod/chown na raiz do sistema";
        // na home, so quando e recursivo (o resto da home e do usuario)
        if (ehHome && recursivo) return "chmod/chown recursivo na sua home";
      }
    }
  }
  // particionador de disco: mesma classe do mkfs/wipefs (formata ou
  // apaga a tabela de particoes do dispositivo)
  if (/\b(fdisk|sfdisk|cfdisk|parted|gdisk|sgdisk)\b/i.test(cmdline) && /\/dev\/(sd|nvme|mmcblk|hd|vd|mapper)/i.test(cmdline))
    return "particionador de disco (fdisk/parted/gdisk em dispositivo)";

  // rm recursivo em alvo de sistema inteiro — divide por ; | && || e nova
  // linha (&& entrou na v1.11.0: "echo oi && rm -rf /" burlava o split)
  const ehRecursivo = (f) => {
    if (/^--/.test(f)) return /^--recursive($|[=\s])/i.test(f);
    if (/^-/.test(f)) return /r/i.test(f.slice(1));
    return false;
  };
  const segmentos = cmdline.split(/\n|;|&&|\|\||\||&/);
  for (const seg of segmentos) {
    const m = seg.trim().match(/^(?:sudo\s+)?rm\s+(.+)$/);
    if (!m) continue;
    const toks = m[1].split(/\s+/);
    const flags = toks.filter((t) => /^-{1,2}\S/.test(t));
    const alvos = toks.filter((t) => t && !/^-{1,2}/.test(t));
    if (!flags.some(ehRecursivo)) continue; // só interessa rm recursivo
    for (const alvo of alvos) {
      const limpo = alvo.replace(/["']/g, "");
      if (!limpo || limpo.startsWith("-")) continue;
      if (/\$/.test(limpo))
        return "rm recursivo com variável não resolvida (" + alvo + ") — use caminho literal";
      if (/(^|\/)\.\.?(\/|$)/.test(limpo))
        return "rm recursivo com '.'/'..' no alvo (" + alvo + ")";
      if (ALVO_SISTEMA.test(limpo))
        return "rm recursivo em alvo de sistema (" + alvo + ")";
      // home literal e alvo relativo (v1.12.0): "rm -rf /home/u" e
      // "cd / && rm -rf etc" passavam — resolve contra o cwd e re-testa
      if (homeRes) {
        const exp = /^~/.test(limpo) ? path.join(homeRes, limpo.slice(1)) : limpo;
        const resolvido = path.isAbsolute(exp)
          ? path.resolve(exp)
          : path.resolve(cwdRes || homeRes, exp);
        if (resolvido === homeRes || ALVO_SISTEMA.test(resolvido))
          return "rm recursivo em alvo catastrófico (" + alvo + " → " + resolvido + ")";
      }
    }
  }
  // ---- Windows (cmd.exe / PowerShell): catástrofes equivalentes ----
  if (/\bformat\s+[a-z]:/i.test(cmdline)) return "format (formatar volume)";
  if (/\bdiskpart\b/i.test(cmdline)) return "diskpart (gerenciamento de disco)";
  if (/\bvssadmin\b[^|;&]*delete\s+shadows/i.test(cmdline))
    return "vssadmin delete shadows (apagar backups de sombra)";
  if (/\bcipher\b\s+\/w/i.test(cmdline)) return "cipher /w (apagamento seguro do disco)";
  // Alvo do Windows é catastrófico se (após tirar aspas e wildcards finais)
  // é raiz de drive, pasta do sistema ou home. Testa tokens isolados E pares
  // adjacentes — senão "C:\Program Files\app" quebra em "C:\Program"+"Files\app".
  const catWin = (alvo) => {
    let a = alvo.replace(/["']/g, "").trim();
    a = a.replace(/^\\\\\?\\/, ""); // \\?\C:\ → C:\
    if (homeRaw) a = a.replace(/^%USERPROFILE%(?=\\|\/|$)/i, homeRaw); // v1.12.0
    a = a.replace(/\\?\*(?:\.\*)?$/, "").trim().replace(/[\\/]+$/, ""); // C:\*.* → C:\ ; C:\* → C:\
    if (!a) return false;
    // home literal (v1.12.0): "rd /s /q C:\Users\u" passava — compara com a
    // home real, além dos padrões ~/$HOME/%SYSTEMROOT%
    if (homeRaw && a.toLowerCase() === homeRaw.replace(/[\\/]+$/, "").toLowerCase())
      return true;
    if (/^[a-z]:\\?(?:progra|program)~[12]$/i.test(a)) return true; // 8.3: PROGRA~1 (6 letras) — "program~" nunca casava (suíte 3-a)
    return ALVO_SISTEMA_WIN.test(a);
  };
  const acharAlvo = (resto, ehFlag) => {
    const toks = resto.trim().split(/\s+/);
    for (let i = 0; i < toks.length; i++) {
      if (!toks[i] || ehFlag(toks[i])) continue;
      if (catWin(toks[i])) return toks[i];
      if (i + 1 < toks.length && !ehFlag(toks[i + 1]) && catWin(toks[i] + " " + toks[i + 1]))
        return toks[i] + " " + toks[i + 1];
    }
    return null;
  };
  for (const seg of cmdline.split(/\n|;|&&|\|\||\||&/)) {
    const s = seg.trim();
    // /s em QUALQUER posição (v1.12.0): "rd C:\ /s /q" passava — cmd.exe
    // aceita a flag DEPOIS do alvo
    const mRd = s.match(/^(?:rd|rmdir)\s+(.+)$/i);
    if (mRd && /(?:^|\s)\/s\b/i.test(mRd[1])) {
      const alvo = acharAlvo(mRd[1], (t) => t.startsWith("/"));
      if (alvo) return "rd recursivo em alvo de sistema (" + alvo + ")";
    }
    const mDel = s.match(/^del\s+(.+)$/i);
    if (mDel && /(?:^|\s)\/s\b/i.test(mDel[1])) {
      const alvo = acharAlvo(mDel[1], (t) => t.startsWith("/"));
      if (alvo) return "del /s em alvo de sistema (" + alvo + ")";
    }
    // aliases PowerShell (v1.12.0): ri/del/erase = Remove-Item; -r = -Recurse
    const psNorm = s
      .replace(/\bri\b/gi, "Remove-Item")
      .replace(/\s-r\b(?![a-z-])/gi, " -Recurse");
    if (/\bremove-item\b/i.test(psNorm) && /-recurse/i.test(psNorm)) {
      const depois = psNorm.replace(/^[\s\S]*?\bremove-item\b\s*/i, "");
      const alvo = acharAlvo(depois, (t) => t.startsWith("-"));
      if (alvo) return "Remove-Item recursivo em alvo de sistema (" + alvo + ")";
    }
  }
  return null;
}

// bash resolvido dinamicamente (v1.10.1): Linux desktop tem /bin/bash, mas
// o Termux (Android) NÃO tem /bin — o bash dele vive em $PREFIX/bin/bash.
// O primeiro candidato existente vence; "bash" solto cai na busca de PATH.
const BASH = [
  "/bin/bash",
  "/usr/bin/bash",
  "/usr/local/bin/bash",
  process.env.PREFIX ? process.env.PREFIX + "/bin/bash" : null,
  "/data/data/com.termux/files/usr/bin/bash",
].find((p) => p && fs.existsSync(p)) || "bash";

function executarComando(cmdline, cwd, timeoutMin) {
  const t0 = Date.now();
  const win = process.platform === "win32";
  return new Promise((resolve) => {
    let timerGrupo = null; // limpo no fim natural; no timeout é que ele DEVE disparar
    const fim = (err, stdout, stderr) => {
      const morto = !!(err && err.killed);
      if (!morto && timerGrupo) {
        clearTimeout(timerGrupo);
        timerGrupo = null;
      }
      resolve({
        code: err && typeof err.code === "number" ? err.code : err ? 1 : 0,
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        // só é timeout se o relógio confirma (v1.12.0: err.killed também
        // acontece no estouro do maxBuffer, que não é timeout)
        mortoPorTimeout: morto && Date.now() - t0 >= timeoutMin * 60000 - 1500,
        ms: Date.now() - t0,
      });
    };
    const opts = {
      cwd,
      timeout: timeoutMin * 60000,
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8",
      windowsHide: true,
      detached: !win, // líder de grupo no POSIX: dá pra matar os NETOS também
    };
    let child = null;
    // mata o GRUPO inteiro no timeout (v1.11.0 — o kill padrão do exec só
    // acerta o shell; "servidor &" e netos ficavam órfãos rodando)
    const matarGrupo = () => {
      try {
        if (win && child && child.pid) {
          execFile("taskkill", ["/T", "/F", "/PID", String(child.pid)], () => {});
        } else if (child && child.pid) {
          process.kill(-child.pid, "SIGKILL");
        }
      } catch (_) {}
    };
    if (win) {
      // Windows: exec usa o ComSpec (cmd.exe), exatamente como o Node faz
      // nativamente. stdin não pode ser "inherit" em exec — e o cmd não
      // precisa dele (prompt interativo de sudo é coisa de Linux).
      child = exec(cmdline, opts, fim);
    } else {
      // Linux/macOS/Termux: bash explícito (resolvido pelo BASH), stdin
      // herdado (sudo -S precisa).
      child = execFile(BASH, ["-c", cmdline], { ...opts, stdio: ["inherit", "pipe", "pipe"] }, fim);
    }
    if (child && typeof child.on === "function") {
      child.on("spawn", () => {
        timerGrupo = setTimeout(matarGrupo, timeoutMin * 60000 + 500);
        if (timerGrupo.unref) timerGrupo.unref();
      });
    }
  });
}

const corta150k = (s) => (s.length > 150000 ? s.slice(0, 150000) + "\n…[saída cortada]" : s);

// Caixa "output" no terminal do usuário quando o run_command termina (v1.9.0).
// O JSON com stdout/stderr segue indo para a IA como sempre — isto aqui é só
// o feedback visível para quem está olhando o terminal.
function mostraOutput(out) {
  if (!out) return;
  try {
    // trunca ANTES da caixa (v1.12.0): a quebra de linha era O(n²) e um
    // stdout de linha única grande congelava o agente por minutos
    const vis = { stdout: corta150k(String(out.stdout || "")), stderr: corta150k(String(out.stderr || "")) };
    escreve("\n");
    escreve(caixaOutput("output", vis.stdout, vis.stderr, out.code) + "\n\n");
    if (out.mortoPorTimeout)
      log("O comando foi morto por timeout — a caixa acima pode estar incompleta.");
  } catch (_) {
    /* visual nunca derruba o agente */
  }
}

// Pergunta s/N no terminal local, com tempo limite (para AUTO-REJEITAR).
// Sem TTY (agente rodando em background), a resposta nunca chega e o
// comando é rejeitado — supervisão não pode ser burlada.
function askYesNo(timeoutS) {
  return new Promise((resolve) => {
    let done = false;
    const onData = (buf) => {
      const t = buf.toString().trim().toLowerCase();
      cleanup();
      if (!done) {
        done = true;
        resolve(t);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      if (!done) {
        done = true;
        console.log("\n(sem resposta em " + timeoutS + "s — tratado como NÃO)");
        resolve("n");
      }
    }, timeoutS * 1000);
    function cleanup() {
      clearTimeout(timer);
      process.stdin.removeListener("data", onData);
      process.stdin.pause();
    }
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

// Hash rápido (md5) para detecção de duplicados.
// Até 100 MB: hash completo em blocos. Acima disso: começo + fim (8 MB cada).
function hashFile(f, size) {
  const crypto = require("crypto");
  const h = crypto.createHash("md5");
  const fd = fs.openSync(f, "r");
  try {
    const CHUNK = 4 * 1024 * 1024;
    if (size <= 100 * 1024 * 1024) {
      const buf = Buffer.alloc(CHUNK);
      let off = 0;
      while (off < size) {
        const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, size - off), off);
        if (n <= 0) break;
        h.update(buf.subarray(0, n));
        off += n;
      }
    } else {
      const head = Buffer.alloc(8 * 1024 * 1024);
      const n1 = fs.readSync(fd, head, 0, head.length, 0);
      h.update(head.subarray(0, n1));
      const tail = Buffer.alloc(8 * 1024 * 1024);
      const n2 = fs.readSync(fd, tail, 0, tail.length, Math.max(0, size - tail.length));
      h.update(tail.subarray(0, n2));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

function moveItem(fromRp, toRp) {
  const dest = fs.existsSync(toRp) ? uniquePath(toRp) : toRp;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(fromRp, dest);
  } catch (e) {
    if (e.code === "EXDEV") {
      fs.copyFileSync(fromRp, dest);
      fs.unlinkSync(fromRp);
    } else throw e;
  }
  return dest;
}

// ---------------------------------------------------------------- lixeira XDG
function trashDirs() {
  const base = path.join(path.resolve(cfg.home), ".local", "share", "Trash");
  return { files: path.join(base, "files"), info: path.join(base, "info") };
}

function trashMove(rp) {
  const t = trashDirs();
  fs.mkdirSync(t.files, { recursive: true });
  fs.mkdirSync(t.info, { recursive: true });
  const target = uniquePath(path.join(t.files, path.basename(rp)));
  const infoFile = path.join(t.info, path.basename(target) + ".trashinfo");
  // .trashinfo ANTES do move (v1.11.0): crash no meio nunca deixa item
  // irrecuperável na lixeira; se o move falhar, o info sai junto
  fs.writeFileSync(
    infoFile,
    "[Trash Info]\nPath=" + encodeURI(rp) + "\nDeletionDate=" +
      new Date().toISOString().replace(/\..+/, "") + "\n",
    "utf8"
  );
  try {
    fs.renameSync(rp, target);
  } catch (e) {
    try { fs.unlinkSync(infoFile); } catch (_) {}
    if (e.code === "EXDEV" && fs.statSync(rp).isFile()) {
      // outro volume: copia+apaga (v1.11.0 — rename não atravessa mount)
      try {
        fs.copyFileSync(rp, target);
        fs.unlinkSync(rp);
        fs.writeFileSync(infoFile, "[Trash Info]\nPath=" + encodeURI(rp) + "\nDeletionDate=" +
          new Date().toISOString().replace(/\..+/, "") + "\n", "utf8");
      } catch (e2) {
        try { fs.unlinkSync(target); } catch (_) {}
        throw e2;
      }
    } else {
      throw e;
    }
  }
  return { trashName: path.basename(target), trashPath: target };
}

function restoreFromTrash(trashName) {
  const t = trashDirs();
  const infoFile = path.join(t.info, trashName + ".trashinfo");
  const trashPath = path.join(t.files, trashName);
  if (!fs.existsSync(infoFile) || !fs.existsSync(trashPath))
    throw new Error("Item não encontrado na lixeira: " + trashName);
  const raw = fs.readFileSync(infoFile, "utf8");
  const m = raw.match(/^Path=(.+)$/m);
  if (!m) throw new Error("Registro da lixeira corrompido: " + trashName);
  const orig = decodeURI(m[1]);
  assertAllowed(orig); // o destino precisa continuar dentro do escopo
  fs.mkdirSync(path.dirname(orig), { recursive: true });
  const dest = uniquePath(orig);
  fs.renameSync(trashPath, dest);
  try {
    fs.unlinkSync(infoFile);
  } catch (_) {}
  return dest;
}

// ---------------------------------------------------------------- grupos
const GROUPS = [
  ["Imagens", ["jpg", "jpeg", "png", "gif", "webp", "svg", "heic", "heif", "avif", "bmp", "tiff", "ico"]],
  ["Documentos", ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "txt", "md", "csv", "epub", "mobi", "rtf", "tex"]],
  ["Vídeos", ["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v", "ts"]],
  ["Áudios", ["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus", "wma"]],
  ["Compactados", ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst", "tgz"]],
  ["Instaladores", ["deb", "rpm", "appimage", "exe", "msi", "iso"]],
  ["Código", ["js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "sh", "c", "cpp", "h", "hpp", "java", "rs", "go", "rb", "php", "html", "css", "scss", "json", "yml", "yaml", "toml", "sql", "lua"]],
  ["Fontes", ["ttf", "otf", "woff", "woff2"]],
];
const EXT_TO_GROUP = {};
for (const [label, exts] of GROUPS) for (const e of exts) EXT_TO_GROUP[e] = label;

// ------------------------------------------- modo deus + skill (v1.5.0)
function versaoDe(texto) {
  // aceita o conteúdo da SKILL.md (marcador "skill-version: X.Y.Z") OU uma
  // versão pelada "3.1.1"/"v3.1.1" (é o que versaoSkillLocal devolve — antes
  // a comparação sempre falhava e o agente relogava "skill atualizada" a cada
  // ciclo de 60 s sem haver mudança nenhuma)
  const s = String(texto || "");
  const m =
    s.match(/skill-version:\s*(\d+)\.(\d+)\.(\d+)/) ||
    s.match(/^\s*v?(\d+)\.(\d+)\.(\d+)\s*$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function versaoSkillLocal() {
  try {
    const v = versaoDe(fs.readFileSync(SKILL_FILE, "utf8"));
    return v ? v.join(".") : null;
  } catch (_) {
    return null;
  }
}

function versaoMaisNova(a, b) {
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

function httpsGetTexto(url, redirecoes, ifNoneMatch) {
  // ifNoneMatch (v1.9.1): ETag da resposta anterior → servidor responde 304
  // sem corpo quando o conteúdo não mudou (economia de banda e de disco)
  redirecoes = redirecoes || 0;
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return reject(new Error("URL inválida"));
    }
    const headers = { "user-agent": "ponte-agent/" + VERSION };
    if (ifNoneMatch) headers["if-none-match"] = ifNoneMatch;
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: "GET",
        timeout: 15000,
        headers,
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.statusCode !== 304 &&
          res.headers.location &&
          redirecoes < 3
        )
          return resolve(
            httpsGetTexto(new URL(res.headers.location, url).toString(), redirecoes + 1, ifNoneMatch)
          );
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > 2 * 1024 * 1024) {
            req.destroy();
            reject(new Error("Resposta grande demais"));
          } else chunks.push(c);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            texto: Buffer.concat(chunks).toString("utf8"),
            etag: res.headers.etag || null,
          })
        );
      }
    );
    req.on("timeout", () => req.destroy(new Error("Tempo esgotado")));
    req.on("error", reject);
    req.end();
  });
}

// ---- estado do auto-update (v1.9.1): ETag da última resposta, intervalo
// ---- atual (com backoff) e flag de aviso único de falha
let skillEtag = null;
let skillIntervalo = SKILL_CHECK_MS;
let skillFalhasSeguidas = 0;
let skillFalhaAvisada = false;

function escreveArquivoAtomico(arquivo, conteudo) {
  // grava em .tmp-<pid> e renomeia: uma queda no meio da escrita nunca deixa
  // um arquivo truncado (o rename substitui o destino no Linux e no Windows;
  // se o rename for barrado — antivírus/backup segurando o arquivo — cai para
  // a escrita direta, que sempre funcionou)
  const tmp = arquivo + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, conteudo);
  try {
    fs.renameSync(tmp, arquivo);
  } catch (_) {
    fs.writeFileSync(arquivo, conteudo);
    try {
      fs.unlinkSync(tmp);
    } catch (_) {
      /* tmp sobrando não derruba o agente */
    }
  }
}

async function atualizarSkill(origem) {
  const r = {
    atualizou: false,
    notModified: false,
    de: versaoSkillLocal(),
    para: null,
    origem: origem || "auto",
    erro: null,
  };
  try {
    // ETag (v1.9.1): só faz sentido mandar If-None-Match se já baixamos uma
    // resposta com ETag E o arquivo local existe — um 304 contra arquivo
    // apagado mentiria sobre o estado real
    const pode304 = !!(skillEtag && fs.existsSync(SKILL_FILE));
    const { status, texto, etag } = await httpsGetTexto(
      SKILL_URL,
      0,
      pode304 ? skillEtag : null
    );
    if (status === 304 && pode304) {
      // nada mudou no repo: sem corpo, sem escrita, sem log
      r.notModified = true;
      r.para = r.de;
      return r;
    }
    if (status !== 200) {
      r.erro = "HTTP " + status;
      return r;
    }
    if (etag) skillEtag = etag;
    const remota = versaoDe(texto);
    if (!remota) {
      r.erro = "skill remota sem marcador de versão";
      return r;
    }
    r.para = remota.join(".");
    const local = versaoDe(r.de);
    if (!local || versaoMaisNova(remota, local)) {
      escreveArquivoAtomico(SKILL_FILE, texto);
      const antes = r.de;
      r.de = antes || "nenhuma";
      r.atualizou = true;
      audit({
        action: "skill_update",
        resumo: antes
          ? "skill atualizada v" + antes + " → v" + r.para
          : "skill baixada v" + r.para,
      });
      log(
        antes
          ? "Skill atualizada: v" + antes + " → v" + r.para
          : "Skill baixada: v" + r.para
      );
    }
  } catch (e) {
    r.erro = e.message;
  }
  return r;
}

function skillAgendaProxima() {
  const t = setTimeout(async () => {
    const r = await atualizarSkill("periodico").catch(() => null);
    if (!r || r.erro) {
      // falha: dobra o intervalo (60 s → 120 s → … teto 15 min) para não
      // martelar o GitHub com a rede fora — e avisa UMA vez só
      skillFalhasSeguidas++;
      skillIntervalo = Math.min(
        SKILL_BACKOFF_MAX_MS,
        SKILL_CHECK_MS * Math.pow(2, skillFalhasSeguidas)
      );
      if (!skillFalhaAvisada) {
        skillFalhaAvisada = true;
        const motivo = r ? r.erro : "erro inesperado";
        log(
          "Aviso: checagem da skill falhou (" +
            motivo +
            ") — tentando de novo em " +
            Math.round(skillIntervalo / 1000) +
            " s"
        );
      }
    } else {
      // voltou (ou nunca falhou): intervalo base e aviso de recuperação único
      if (skillFalhaAvisada) {
        skillFalhaAvisada = false;
        log("Checagem da skill voltou a funcionar.");
      }
      skillFalhasSeguidas = 0;
      skillIntervalo = SKILL_CHECK_MS;
    }
    skillAgendaProxima();
  }, skillIntervalo);
  if (t.unref) t.unref();
}

function skillAutoUpdateLoop() {
  atualizarSkill("boot")
    .catch(() => {})
    .then(() => skillAgendaProxima());
}

function salvarGodMode(on) {
  cfg.godMode = !!on;
  if (cfg.godMode) {
    cfg.run = true;
    cfg.godModeDeclined = false; // aceite novo limpa recusa antiga
  }
  saveConfig(cfg);
}

// ------------------------------------------------------- screenshot (v1.13.0)
// A IA pede um print da tela do usuário. O agente continua com ZERO
// dependências npm: o que faz o trabalho é o que a distro JÁ traz.
// Cada plataforma tem uma lista de candidatos, tentados em ordem até um
// produzir um PNG de verdade:
//
//  - Linux (X11):     import (ImageMagick) · scrot · maim · gnome-screenshot
//  - Linux (Wayland): grim · gnome-screenshot (portal) · spectacle · import
//  - Windows:         PowerShell + System.Drawing (nativo, sempre presente)
//  - macOS:           screencapture (nativo)
//  - Termux/Android:  termux-screenshot (pacote termux-api)
//
// O título da janela vem da IA e NUNCA entra num shell: tudo roda via
// execFile com array de argumentos (sem shell), então não existe injeção
// de comando possível pelo título.

function normalizarFormato(f) {
  const s = String(f == null ? "png" : f).toLowerCase();
  return s === "jpg" || s === "jpeg" ? "jpg" : "png";
}

// Teto do base64 no resultado: o relay recusa acima de ~10,5 MB e o
// histórico em disco corta payloads grandes. Pedir jpg resolve.
const SCREENSHOT_MAX_BASE64 = 9000000;

// roda um binário SEM shell (execFile + array de args)
function executarBin(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs || 20000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        resolve({
          code: err && typeof err.code === "number" ? err.code : err ? 1 : 0,
          // "ENOENT" = o binário não existe na máquina (ferramenta ausente)
          faltaBinario: !!err && err.code === "ENOENT",
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
        });
      }
    );
  });
}

// mesma coisa, mas devolvendo bytes crus (termux-screenshot solta PNG no stdout)
function executarBinBuf(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout: timeoutMs || 20000, maxBuffer: 32 * 1024 * 1024, encoding: "buffer", windowsHide: true },
      (err, stdout, stderr) => {
        resolve({
          code: err && typeof err.code === "number" ? err.code : err ? 1 : 0,
          stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0),
          stderr: Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr || ""),
        });
      }
    );
  });
}

function ehPng(buf) {
  return !!buf && buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

function ehJpg(buf) {
  return !!buf && buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

// lê o arquivo, apaga e devolve só se for imagem de verdade
function arquivoImagem(caminho) {
  let buf = null;
  try {
    buf = fs.readFileSync(caminho);
  } catch (_) {
    buf = null;
  }
  try {
    fs.unlinkSync(caminho);
  } catch (_) {}
  if (ehPng(buf) || ehJpg(buf)) return buf;
  return null;
}

// caminho temporário fora da home (não é arquivo do usuário)
function caminhoTemp(sufixo) {
  const dir = os.tmpdir && os.tmpdir() ? os.tmpdir() : DATA_DIR;
  return path.join(dir, "ponte-shot-" + sufixo + "-" + process.pid + "-" + Date.now());
}

// ---------------------------------------------------------------- Linux
async function capturarLinuxTela(destino) {
  const tentativas = [
    ["import", ["-window", "root", destino]],
    ["scrot", ["-q", "100", destino]],
    ["maim", [destino]],
    ["gnome-screenshot", ["-f", destino]],
    ["spectacle", ["-b", "-n", "-o", destino]],
    ["grim", [destino]],
  ];
  const erros = [];
  for (const par of tentativas) {
    const bin = par[0];
    const args = par[1];
    const r = await executarBin(bin, args, 25000);
    if (r.code === 0) {
      const buf = arquivoImagem(destino);
      if (buf) return { ok: true, buf: buf, ferramenta: bin };
      erros.push(bin + ": saiu sem gerar imagem válida");
    } else {
      const msg = (r.stderr || r.stdout || "falhou").trim().split("\n")[0].slice(0, 100);
      erros.push(bin + ": " + msg);
    }
  }
  return { ok: false, erros: erros };
}

async function janelasLinux() {
  const r = await executarBin("wmctrl", ["-l"], 10000);
  if (r.code !== 0) return [];
  const out = [];
  for (const linha of r.stdout.split("\n")) {
    const m = linha.trim().match(/^(0x[0-9a-fA-F]+)\s+(-?\d+)\s+(\S+)\s+(.*)$/);
    if (m) out.push({ id: m[1], titulo: m[4] });
  }
  return out;
}

// xdotool devolve id DECIMAL; o ImageMagick espera o id X11 (que o wmctrl
// mostra em hex). Converte para hex — os dois são o mesmo número.
function idParaHex(id) {
  const s = String(id || "").trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith("0x")) return s;
  const n = Number(s);
  if (!isFinite(n)) return null;
  return "0x" + n.toString(16);
}

// Procura a janela pedida. No X11 dá para achar pelo título/classe e
// capturar o ID exato. No Wayland o compositor não expõe isso de forma
// genérica — aí o melhor é a janela EM FOCO (spectacle -a / hyprshot).
async function acharJanelaLinux(opts) {
  if (opts.windowId) {
    const hex = idParaHex(opts.windowId);
    return hex ? { id: hex, titulo: null } : null;
  }
  if (opts.windowTitle) {
    // xdotool (X11) e kdotool (KDE/Wayland) fazem a mesma busca
    for (const busca of [
      ["xdotool", ["search", "--name", opts.windowTitle]],
      ["kdotool", ["search", "--name", opts.windowTitle]],
    ]) {
      const r = await executarBin(busca[0], busca[1], 10000);
      if (r.code === 0) {
        const primeiro = r.stdout.trim().split("\n")[0];
        const hex = idParaHex(primeiro);
        if (hex) return { id: hex, titulo: opts.windowTitle, via: busca[0] };
      }
    }
    // wmctrl (X11): id em hexadecimal, casa o título sem diferenciar caixa
    const janelas = await janelasLinux();
    const alvo = opts.windowTitle.toLowerCase();
    const achada = janelas.find((j) => j.titulo.toLowerCase().indexOf(alvo) >= 0);
    if (achada) return { id: achada.id, titulo: achada.titulo, via: "wmctrl" };
  }
  if (opts.windowClass) {
    for (const busca of [
      ["xdotool", ["search", "--class", opts.windowClass]],
      ["kdotool", ["search", "--class", opts.windowClass]],
    ]) {
      const r = await executarBin(busca[0], busca[1], 10000);
      if (r.code === 0) {
        const primeiro = r.stdout.trim().split("\n")[0];
        const hex = idParaHex(primeiro);
        if (hex) return { id: hex, titulo: null, via: busca[0] };
      }
    }
  }
  // sem filtro → a janela que está em foco
  for (const bin of ["xdotool", "kdotool"]) {
    const r = await executarBin(bin, ["getactivewindow"], 10000);
    if (r.code === 0) {
      const hex = idParaHex(r.stdout.trim());
      if (hex) return { id: hex, titulo: null, via: bin };
    }
  }
  return null;
}

// Captura a janela pedida. Duas rotas:
//  1) achou o ID (X11) → ImageMagick captura SÓ aquela janela
//  2) não achou (Wayland) → captura a janela EM FOCO e avisa na resposta
async function capturarLinuxJanela(destino, opts) {
  const erros = [];
  const janela = await acharJanelaLinux(opts);

  if (janela) {
    const r = await executarBin("import", ["-window", janela.id, destino], 25000);
    if (r.code === 0) {
      const buf = arquivoImagem(destino);
      if (buf) return { ok: true, buf: buf, ferramenta: "import", janela: janela };
      erros.push("import: saiu sem gerar imagem válida");
    } else {
      erros.push("import: " + (r.stderr || r.stdout || "falhou").trim().split("\n")[0].slice(0, 90));
    }
  } else {
    erros.push("nenhuma janela localizada por id/título/classe");
  }

  // Wayland (KDE/Hyprland): a janela em foco
  for (const par of [
    ["spectacle", ["-a", "-b", "-n", "-o", destino]],
    ["hyprshot", ["-m", "active", "-o", destino]],
  ]) {
    const r = await executarBin(par[0], par[1], 25000);
    if (r.code === 0) {
      const buf = arquivoImagem(destino);
      if (buf) {
        return {
          ok: true,
          buf: buf,
          ferramenta: par[0] + " (janela em foco)",
          janela: {
            titulo: null,
            modo: "janela-em-foco",
            aviso: opts.windowTitle
              ? "Wayland não permite capturar uma janela pelo título: foi capturada a janela EM FOCO"
              : "capturada a janela em foco",
          },
        };
      }
    }
  }

  return {
    ok: false,
    erros: erros.concat([
      "Wayland: spectre a janela em foco com spectacle/hyprshot (instale um deles)",
      "X11: instale xdotool + imagemagick para capturar por título",
    ]),
  };
}

// ---------------------------------------------------------------- Windows
// O script vai para um .ps1 em arquivo: sem escapamento de aspas no comando
// e sem risco de o título da janela virar código.
const PS_CAPTURA = [
  "param([string]$Out,[string]$Title,[string]$Hwnd,[string]$Format,[int]$Quality,[string]$Modo)",
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.Windows.Forms",
  "Add-Type -AssemblyName System.Drawing",
  "$src = @'",
  "using System;",
  "using System.Text;",
  "using System.Runtime.InteropServices;",
  "public class PonteWin {",
  "  public delegate bool EnumProc(IntPtr h, IntPtr l);",
  "  [DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);",
  "  [DllImport(\"user32.dll\")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);",
  "  [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr h);",
  "  [DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr h, out RECT r);",
  "  [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
  "  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }",
  "}",
  "'@",
  "Add-Type -TypeDefinition $src",
  "function Salvar-Img($bmp, $path) {",
  "  if ($Format -eq 'jpg') {",
  "    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }",
  "    $enc = New-Object System.Drawing.Imaging.EncoderParameters 1",
  "    $enc.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)",
  "    $bmp.Save($path, $codec, $enc)",
  "  } else {",
  "    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)",
  "  }",
  "}",
  "if ($Modo -ne 'janela') {",
  "  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen",
  "  $bmp = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height",
  "  $g = [System.Drawing.Graphics]::FromImage($bmp)",
  "  $g.CopyFromScreen($vs.Left, $vs.Top, 0, 0, $bmp.Size)",
  "  Salvar-Img $bmp $Out",
  "  $g.Dispose()",
  "  $bmp.Dispose()",
  "  Write-Output ('tela ' + $vs.Width + 'x' + $vs.Height)",
  "  exit 0",
  "}",
  "$script:target = [IntPtr]::Zero",
  "$script:found = ''",
  "if ($Hwnd -ne '') {",
  "  $script:target = [IntPtr]::new([int64]$Hwnd)",
  "} elseif ($Title -ne '') {",
  "  $cb = [PonteWin+EnumProc]{",
  "    param($h, $l)",
  "    if ([PonteWin]::IsWindowVisible($h)) {",
  "      $sb = New-Object System.Text.StringBuilder 512",
  "      [void][PonteWin]::GetWindowText($h, $sb, $sb.Capacity)",
  "      $t = $sb.ToString()",
  "      if ($t -ne '' -and $t.IndexOf($Title, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {",
  "        $script:target = $h",
  "        $script:found = $t",
  "        return $false",
  "      }",
  "    }",
  "    return $true",
  "  }",
  "  [void][PonteWin]::EnumWindows($cb, [IntPtr]::Zero)",
  "} else {",
  "  $script:target = [PonteWin]::GetForegroundWindow()",
  "}",
  "if ($script:target -eq [IntPtr]::Zero) { Write-Error 'janela nao encontrada'; exit 2 }",
  "$r = New-Object PonteWin+RECT",
  "[void][PonteWin]::GetWindowRect($script:target, [ref]$r)",
  "$w = $r.Right - $r.Left",
  "$h = $r.Bottom - $r.Top",
  "if ($w -le 0 -or $h -le 0) { Write-Error 'janela sem area visivel'; exit 3 }",
  "$bmp = New-Object System.Drawing.Bitmap $w, $h",
  "$g = [System.Drawing.Graphics]::FromImage($bmp)",
  "$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)",
  "Salvar-Img $bmp $Out",
  "$g.Dispose()",
  "$bmp.Dispose()",
  "if ($script:found -ne '') { Write-Output $script:found }",
  "",
].join("\n");

// Roda o .ps1 no shell do Windows que existir (powershell = PS 5.1, que
// SEMPRE tem System.Drawing; pwsh = PS 7). O script vai num arquivo, então
// não existe escapamento de aspas nem o título da janela virar código.
async function executarPowershell(ps1, params, timeoutMs) {
  const shells = ["powershell", "pwsh"];
  let ultimo = null;
  for (const shell of shells) {
    const r = await executarBin(
      shell,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1].concat(params),
      timeoutMs || 40000
    );
    if (r.code === 0) return { ok: true, stdout: r.stdout, stderr: r.stderr };
    ultimo = r;
    // o shell não existe nesta máquina → tenta o próximo
    if (r.faltaBinario) continue;
    return { ok: false, stdout: r.stdout, stderr: r.stderr };
  }
  return {
    ok: false,
    stdout: ultimo ? ultimo.stdout : "",
    stderr: ultimo ? ultimo.stderr : "nem powershell nem pwsh disponíveis",
  };
}

async function capturarWindows(destino, formato, qualidade, opts) {
  const ps1 = caminhoTemp("captura.ps1");
  try {
    fs.writeFileSync(ps1, PS_CAPTURA, "utf8");
    const titulo = opts.janela ? (opts.windowTitle || "") : "";
    const hwnd = opts.janela ? (opts.windowId || "") : "";
    const r = await executarPowershell(
      ps1,
      [
        "-Out", destino,
        "-Title", titulo,
        "-Hwnd", hwnd,
        "-Format", formato,
        "-Quality", String(qualidade),
        "-Modo", opts.janela ? "janela" : "tela",
      ],
      40000
    );
    if (!r.ok) {
      const msg = (r.stderr || r.stdout || "falhou").trim().split("\n")[0].slice(0, 140);
      return { ok: false, erros: ["PowerShell/System.Drawing: " + msg] };
    }
    const buf = arquivoImagem(destino);
    if (!buf) return { ok: false, erros: ["PowerShell não gerou imagem válida"] };
    return { ok: true, buf: buf, ferramenta: "powershell", janela: { titulo: (r.stdout || "").trim() || null } };
  } catch (e) {
    return { ok: false, erros: ["falha ao rodar PowerShell: " + (e && e.message ? e.message : String(e))] };
  } finally {
    try {
      fs.unlinkSync(ps1);
    } catch (_) {}
  }
}

// ---------------------------------------------------------------- macOS
async function capturarMacTela(destino) {
  const r = await executarBin("screencapture", ["-x", "-t", "png", destino], 25000);
  if (r.code !== 0) {
    const msg = (r.stderr || r.stdout || "falhou").trim().split("\n")[0].slice(0, 100);
    return { ok: false, erros: ["screencapture: " + msg] };
  }
  const buf = arquivoImagem(destino);
  if (!buf) return { ok: false, erros: ["screencapture não gerou imagem válida"] };
  return { ok: true, buf: buf, ferramenta: "screencapture" };
}

async function capturarMacJanela(destino, opts) {
  // AppleScript dá o retângulo da janela; o screencapture recorta a área
  const script = opts.windowTitle
    ? 'tell application "System Events" to tell (first process whose frontmost is true) to get {position, size} of window 1'
    : 'tell application "System Events" to tell (first process whose frontmost is true) to get {position, size} of window 1';
  const r = await executarBin("osascript", ["-e", script], 15000);
  if (r.code !== 0) {
    return {
      ok: false,
      erros: ["osascript falhou — o macOS pede permissão de Acessibilidade para ler a janela: " + (r.stderr || "").trim().split("\n")[0].slice(0, 100)],
    };
  }
  const nums = (r.stdout.match(/-?\d+/g) || []).map(Number);
  if (nums.length < 4) return { ok: false, erros: ["não consegui ler o retângulo da janela"] };
  const x = nums[0];
  const y = nums[1];
  const w = nums[2];
  const h = nums[3];
  const rr = await executarBin("screencapture", ["-x", "-R" + x + "," + y + "," + w + "," + h, destino], 25000);
  if (rr.code !== 0) return { ok: false, erros: ["screencapture: " + (rr.stderr || "").trim().split("\n")[0].slice(0, 100)] };
  const buf = arquivoImagem(destino);
  if (!buf) return { ok: false, erros: ["screencapture não gerou imagem válida"] };
  return { ok: true, buf: buf, ferramenta: "screencapture", janela: { retangulo: [x, y, w, h] } };
}

// ---------------------------------------------------------------- Termux
async function capturarTermux(destino) {
  // termux-screenshot solta o PNG no stdout (ou escreve com -o)
  const r = await executarBinBuf("termux-screenshot", [], 30000);
  if (r.code === 0 && r.stdout && r.stdout.length > 100 && ehPng(r.stdout)) {
    return { ok: true, buf: r.stdout, ferramenta: "termux-screenshot" };
  }
  const r2 = await executarBin("termux-screenshot", ["-o", destino], 30000);
  if (r2.code === 0) {
    const buf = arquivoImagem(destino);
    if (buf) return { ok: true, buf: buf, ferramenta: "termux-screenshot" };
  }
  return {
    ok: false,
    erros: ["termux-screenshot falhou — instale o pacote: pkg install termux-api e o app Termux:API da F-Droid"],
  };
}

// ---------------------------------------------------------------- JPG
async function converterParaJpg(pngBuf, destino, qualidade) {
  // tenta ImageMagick e depois o sips do macOS
  const orig = destino + ".png";
  try {
    fs.writeFileSync(orig, pngBuf);
  } catch (_) {
    return null;
  }
  const tentativas = [
    ["convert", [orig, "-quality", String(qualidade), destino]],
    ["magick", [orig, "-quality", String(qualidade), destino]],
    ["sips", ["-s", "format", "jpeg", orig, "--out", destino]],
  ];
  for (const par of tentativas) {
    const r = await executarBin(par[0], par[1], 30000);
    if (r.code === 0) {
      const buf = arquivoImagem(destino);
      try {
        fs.unlinkSync(orig);
      } catch (_) {}
      if (buf) return buf;
    }
  }
  try {
    fs.unlinkSync(orig);
  } catch (_) {}
  return null;
}

// ---------------------------------------------------------------- ação
async function capturarScreenshot(opts) {
  const plataforma = process.platform;
  const formato = normalizarFormato(opts.format);
  const qualidade = Math.min(100, Math.max(1, Number(opts.quality) || 85));
  const destino = caminhoTemp(formato === "jpg" ? "shot.jpg" : "shot.png");
  let r = { ok: false, erros: [] };

  if (plataforma === "linux") {
    r = opts.janela ? await capturarLinuxJanela(destino, opts) : await capturarLinuxTela(destino);
  } else if (plataforma === "win32") {
    r = await capturarWindows(destino, formato, qualidade, opts);
  } else if (plataforma === "darwin") {
    r = opts.janela ? await capturarMacJanela(destino, opts) : await capturarMacTela(destino);
  } else if (plataforma === "android" || process.env.TERMUX_VERSION) {
    r = await capturarTermux(destino);
  } else {
    throw new Error("Screenshot não suportado nesta plataforma: " + plataforma);
  }

  if (!r.ok) {
    const dica = opts.janela
      ? "no Linux instale: xdotool + imagemagick (X11, captura por título) ou spectacle (KDE/Wayland, janela em foco)"
      : "no Linux instale: scrot · imagemagick · maim · gnome-screenshot · spectacle";
    throw new Error(
      "Não consegui capturar a tela. Tentativas: " + (r.erros || []).join(" | ") + " — " + dica
    );
  }

  let buf = r.buf;
  let formatoFinal = ehJpg(buf) ? "jpg" : "png";
  if (formato === "jpg" && formatoFinal !== "jpg") {
    const jpg = await converterParaJpg(buf, caminhoTemp("shot.jpg"), qualidade);
    if (jpg) {
      buf = jpg;
      formatoFinal = "jpg";
    }
  }

  const base64 = buf.toString("base64");
  if (base64.length > SCREENSHOT_MAX_BASE64) {
    throw new Error(
      "Imagem grande demais para a ponte (" + fmtMB(base64.length) + " em base64) — refaça com format:\"jpg\" e quality menor (ex.: 60)"
    );
  }

  const resp = {
    plataforma: plataforma,
    formato: formatoFinal,
    bytes: buf.length,
    tamanhoBase64: base64.length,
    dados: base64,
    ferramenta: r.ferramenta || null,
  };
  if (r.janela) resp.janela = r.janela;
  if (opts.janela && !resp.janela) {
    // devolve as janelas disponíveis para a IA tentar de novo com o título exato
    const janelas = await janelasLinux();
    if (janelas.length) resp.janelasDisponiveis = janelas.slice(0, 40);
  }
  return resp;
}

// ------------------------------------------------------- mouse (v1.14.0)
// Mexer no mouse do usuário: mover, clicar, rolar, arrastar e ler a
// posição. Como as ações de screenshot, ZERO dependência npm: o agente
// usa o que o sistema já tem.
//
//  - Windows:      PowerShell + user32.dll (SetCursorPos/mouse_event) —
//                  nativo, sempre presente
//  - Linux/X11:    xdotool (mousemove/click/scroll/getmouselocation)
//  - Linux/Wayland: ydotool ou dotool (falam com o compositor via uinput)
//  - Termux:       `input` do Android (tap/swipe/roll)
//  - macOS:        AppleScript (click at) — mover exige `cliclick`
//
// Coordenadas são inteiros validados e NUNCA entram num shell: tudo via
// execFile com array de argumentos (sem shell), sem injeção possível.

const BOTOES_MOUSE = { left: 1, middle: 2, right: 3, meio: 2, dir: 3, esq: 1 };

function normalizarBotao(b) {
  const s = String(b == null ? "left" : b).toLowerCase().trim();
  if (BOTOES_MOUSE[s]) return BOTOES_MOUSE[s];
  if (s === "1" || s === "2" || s === "3") return Number(s);
  throw new Error('Botão inválido: "' + s + '" — use left (1), middle (2) ou right (3)');
}

// coordenada: inteiro, dentro de um teto sanatório (o SO recusa fora da tela)
function coord(nome, v) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) throw new Error("Coordenada inválida em " + nome + ": " + v);
  if (n < -100000 || n > 100000)
    throw new Error("Coordenada fora do intervalo em " + nome + ": " + n);
  return n;
}

function amountScroll(v, padrao) {
  const n = Math.round(Number(v == null ? padrao : v));
  if (!isFinite(n)) throw new Error("amount inválido: " + v);
  if (n < -1000 || n > 1000) throw new Error("amount fora do intervalo (-1000..1000): " + n);
  return n;
}

// ---------------------------------------------------------------- Windows
const PS_MOUSE = [
  "param([string]$Op,[int]$X,[int]$Y,[int]$X2,[int]$Y2,[int]$Botao,[int]$Amount,[int]$Count,[int]$Delta)",
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.Windows.Forms",
  "$src = @'",
  "using System;",
  "using System.Runtime.InteropServices;",
  "public class PonteMouse {",
  "  [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int x, int y);",
  "  [DllImport(\"user32.dll\")] public static extern bool GetCursorPos(out POINT p);",
  "  [DllImport(\"user32.dll\")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr extra);",
  "  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }",
  "}",
  "'@",
  "Add-Type -TypeDefinition $src",
  "$DOWN = @{ 1 = 0x02; 2 = 0x20; 3 = 0x08 }",
  "$UP = @{ 1 = 0x04; 2 = 0x40; 3 = 0x10 }",
  "if ($Op -eq 'position') {",
  "  $p = New-Object PonteMouse+POINT",
  "  [void][PonteMouse]::GetCursorPos([ref]$p)",
  "  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen",
  "  Write-Output ('POS ' + $p.X + ' ' + $p.Y + ' ' + $vs.Width + ' ' + $vs.Height)",
  "  exit 0",
  "}",
  "if ($Op -eq 'scroll') {",
  "  $f = 0x0800",
  "  $passo = 1",
  "  if ($Delta -lt 0) { $passo = -1 }",
  "  $n = [Math]::Abs($Delta)",
  "  if ($n -eq 0) { $n = 1 }",
  "  for ($i = 0; $i -lt $n; $i++) {",
  "    [PonteMouse]::mouse_event($f, 0, 0, $passo, [IntPtr]::Zero)",
  "    Start-Sleep -Milliseconds 30",
  "  }",
  "  exit 0",
  "}",
  "if ($Op -eq 'drag') {",
  "  [void][PonteMouse]::SetCursorPos($X, $Y)",
  "  Start-Sleep -Milliseconds 60",
  "  [PonteMouse]::mouse_event($DOWN[$Botao], 0, 0, 0, [IntPtr]::Zero)",
  "  Start-Sleep -Milliseconds 60",
  "  [void][PonteMouse]::SetCursorPos($X2, $Y2)",
  "  Start-Sleep -Milliseconds 60",
  "  [PonteMouse]::mouse_event($UP[$Botao], 0, 0, 0, [IntPtr]::Zero)",
  "  exit 0",
  "}",
  "[void][PonteMouse]::SetCursorPos($X, $Y)",
  "Start-Sleep -Milliseconds 40",
  "for ($i = 0; $i -lt $Count; $i++) {",
  "  [PonteMouse]::mouse_event($DOWN[$Botao], 0, 0, 0, [IntPtr]::Zero)",
  "  [PonteMouse]::mouse_event($UP[$Botao], 0, 0, 0, [IntPtr]::Zero)",
  "  if ($Count -gt 1) { Start-Sleep -Milliseconds 80 }",
  "}",
  "",
].join("\n");

async function mouseWindows(op, o) {
  const ps1 = caminhoTemp("mouse.ps1");
  try {
    fs.writeFileSync(ps1, PS_MOUSE, "utf8");
    const args = [
      "-Op", op,
      "-X", String(o.x || 0),
      "-Y", String(o.y || 0),
      "-X2", String(o.x2 || 0),
      "-Y2", String(o.y2 || 0),
      "-Botao", String(o.botao || 1),
      "-Amount", String(o.amount || 0),
      "-Count", String(o.count || 1),
      "-Delta", String(o.delta || 0),
    ];
    const r = await executarPowershell(ps1, args, 30000);
    if (!r.ok) {
      const msg = (r.stderr || r.stdout || "falhou").trim().split("\n")[0].slice(0, 140);
      return { ok: false, erros: ["PowerShell/user32: " + msg] };
    }
    const m = (r.stdout || "").match(/POS\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/);
    const saida = { ok: true, ferramenta: "powershell/user32" };
    if (m) {
      saida.x = Number(m[1]);
      saida.y = Number(m[2]);
      saida.larguraTela = Number(m[3]);
      saida.alturaTela = Number(m[4]);
    }
    return saida;
  } catch (e) {
    return { ok: false, erros: ["falha ao rodar PowerShell: " + (e && e.message ? e.message : String(e))] };
  } finally {
    try {
      fs.unlinkSync(ps1);
    } catch (_) {}
  }
}

// ---------------------------------------------------------------- Linux
// X11: xdotool. Wayland: ydotool (uinput) ou dotool (Rust).
// O ydotool fala com um daemon (ydotoold) via socket. Se o daemon não
// estiver de pé, o comando falha com "failed to connect socket" — aqui a
// gente sobe o daemon e tenta de novo.
function subirYdotoald() {
  try {
    const p = spawn("ydotoald", [], { detached: true, stdio: "ignore" });
    // o erro do spawn chega ASSÍNCRONO: sem este handler, um "ENOENT"
    // (binário ausente) vira uncaughtException e polui o log do agente
    p.on("error", () => {});
    p.unref();
    return true;
  } catch (_) {
    return false;
  }
}

async function garantirYdotoald() {
  const teste = await executarBin("ydotool", ["mousemove", "--", "0", "0"], 5000);
  if (teste.code === 0) return true; // já está de pé
  if (!subirYdotoald()) return false;
  await sleep(700); // o daemon precisa subir
  const outro = await executarBin("ydotool", ["mousemove", "--", "0", "0"], 5000);
  return outro.code === 0;
}

async function mouseLinux(op, o) {
  const erros = [];
  const wayland = ehSessaoWayland();
  if (wayland) {
    const ok = await garantirYdotoald();
    if (!ok) erros.push("ydotoald: não subiu (o usuário precisa estar no grupo 'input' e ter /dev/uinput)");
  }
  // NO WAYLAND o xdotool "funciona" mas mexe só no cursor do XWayland — o
  // cursor real do compositor não se move. Por isso a ordem muda: ydotool /
  // dotool (uinput) primeiro, xdotool só como último recurso (e a resposta
  // avisa).
  const ordem = wayland ? ["ydotool", "dotool", "xdotool"] : ["xdotool", "ydotool", "dotool"];

  const tentativas = {
    position: {
      xdotool: async () => {
        const r = await executarBin("xdotool", ["getmouselocation", "--shell"], 10000);
        if (r.code !== 0) return null;
        const x = (r.stdout.match(/^X=(\d+)/m) || [])[1];
        const y = (r.stdout.match(/^Y=(\d+)/m) || [])[1];
        if (x === undefined || y === undefined) return null;
        return { x: Number(x), y: Number(y), ...(await tamanhoTelaLinux()) };
      },
      ydotool: async () => null, // ydotool não lê a posição
      dotool: async () => null,
    },
    move: {
      xdotool: async () => {
        const r = await executarBin("xdotool", ["mousemove", String(o.x), String(o.y)], 10000);
        return r.code === 0 ? { x: o.x, y: o.y } : null;
      },
      ydotool: async () => {
        const r = await executarBin("ydotool", ["mousemove", "--", String(o.x), String(o.y)], 10000);
        return r.code === 0 ? { x: o.x, y: o.y } : null;
      },
      dotool: async () => {
        const r = await executarBin("dotool", ["mousemove", "--absolute", String(o.x), String(o.y)], 10000);
        return r.code === 0 ? { x: o.x, y: o.y } : null;
      },
    },
    click: {
      xdotool: async () => {
        const args = [];
        if (o.count > 1) args.push("--repeat", String(o.count), "--delay", "90");
        args.push(String(o.botao));
        const r = await executarBin("xdotool", ["click"].concat(args), 15000);
        return r.code === 0 ? { botao: o.botao, cliques: o.count } : null;
      },
      ydotool: async () => {
        // ydotool usa bitmask: esq=0x01, dir=0x02, meio=0x04
        const mask = { 1: "0x01", 2: "0x04", 3: "0x02" }[o.botao];
        let ok = false;
        for (let i = 0; i < o.count; i++) {
          const r = await executarBin("ydotool", ["click", mask], 10000);
          if (r.code !== 0) return ok ? { botao: o.botao, cliques: i } : null;
          ok = true;
          if (o.count > 1) await sleep(90);
        }
        return ok ? { botao: o.botao, cliques: o.count } : null;
      },
      dotool: async () => null,
    },
    scroll: {
      xdotool: async () => {
        // botões 4 (cima), 5 (baixo), 6 (esquerda), 7 (direita)
        const botao = o.direcao === "up" ? 4 : o.direcao === "down" ? 5 : o.direcao === "left" ? 6 : 7;
        const n = Math.abs(o.amount) || 1;
        const args = [];
        if (n > 1) args.push("--repeat", String(n), "--delay", "40");
        args.push(String(botao));
        const r = await executarBin("xdotool", ["click"].concat(args), 20000);
        return r.code === 0 ? { direcao: o.direcao, amount: o.amount } : null;
      },
      ydotool: async () => {
        const r = await executarBin("ydotool", ["wheel", String(o.amount)], 10000);
        return r.code === 0 ? { direcao: o.direcao, amount: o.amount } : null;
      },
      dotool: async () => null,
    },
    drag: {
      xdotool: async () => {
        const r = await executarBin(
          "xdotool",
          [
            "mousemove", String(o.x), String(o.y),
            "mousedown", String(o.botao),
            "mousemove", String(o.x2), String(o.y2),
            "mouseup", String(o.botao),
          ],
          20000
        );
        return r.code === 0 ? { de: [o.x, o.y], para: [o.x2, o.y2] } : null;
      },
      ydotool: async () => {
        const mask = { 1: "0x01", 2: "0x04", 3: "0x02" }[o.botao];
        const m1 = await executarBin("ydotool", ["mousemove", "--", String(o.x), String(o.y)], 10000);
        if (m1.code !== 0) return null;
        const d1 = await executarBin("ydotool", ["mousedown", mask], 10000);
        if (d1.code !== 0) return null;
        await executarBin("ydotool", ["mousemove", "--", String(o.x2), String(o.y2)], 10000);
        await executarBin("ydotool", ["mouseup", mask], 10000);
        return { de: [o.x, o.y], para: [o.x2, o.y2] };
      },
      dotool: async () => null,
    },
  };

  const plano = tentativas[op];
  if (!plano) return { ok: false, erros: ["operação de mouse desconhecida: " + op] };

  for (const bin of ordem) {
    const f = plano[bin];
    if (!f) continue;
    const r = await f();
    if (r) {
      const aviso = avisoSessao(bin);
      return Object.assign({ ok: true, ferramenta: bin }, r, aviso ? { aviso: aviso } : {});
    }
    const p = await executarBin(bin, ["--version"], 5000);
    erros.push(p.faltaBinario ? bin + ": não instalado" : bin + ": falhou");
  }

  return {
    ok: false,
    erros: erros.concat([
      wayland
        ? "no Wayland instale: ydotool (sudo pacman -S --needed ydotool) ou dotool — o usuário precisa estar no grupo 'input' e o daemon ydotoald de pé (systemctl --user enable --now ydotool)"
        : "no X11 instale: xdotool (sudo pacman -S --needed xdotool)",
    ]),
  };
}

function ehSessaoWayland() {
  return (
    !!process.env.WAYLAND_DISPLAY ||
    String(process.env.XDG_SESSION_TYPE || "").toLowerCase() === "wayland"
  );
}

// No Wayland, o xdotool só mexe no cursor do XWayland (aplicativos X11),
// NÃO no cursor real do compositor. Sem avisar, a IA acha que moveu o mouse
// e age sobre a tela errada.
function avisoSessao(ferramenta) {
  if (ehSessaoWayland() && ferramenta === "xdotool") {
    return "ATENÇÃO: sessão Wayland — o xdotool move só o cursor do XWayland, não o cursor real do compositor. Use ydotool ou dotool para controlar o mouse de verdade.";
  }
  return null;
}

async function tamanhoTelaLinux() {
  const r = await executarBin("xrandr", ["--current"], 10000);
  if (r.code !== 0) return {};
  const m = r.stdout.match(/(\d+)x(\d+)\+/);
  if (!m) return {};
  return { larguraTela: Number(m[1]), alturaTela: Number(m[2]) };
}

// ---------------------------------------------------------------- Termux
async function mouseTermux(op, o) {
  // `input` do Android: tap / swipe / roll
  if (op === "position") {
    const r = await executarBin("dumpsys", ["input"], 20000);
    const m = r.stdout && r.stdout.match(/Pointer\s*\(.*?\)\s*:\s*(-?\d+),\s*(-?\d+)/);
    if (m) return { ok: true, ferramenta: "dumpsys input", x: Number(m[1]), y: Number(m[2]) };
    return { ok: false, erros: ["não consegui ler a posição do ponteiro (dumpsys input)"] };
  }
  if (op === "move") {
    // Android não tem "mover sem clicar": o mais perto é um swipe de 1px
    const r = await executarBin("input", ["swipe", String(o.x), String(o.y), String(o.x), String(o.y), "60"], 15000);
    if (r.code === 0) return { ok: true, ferramenta: "input swipe", x: o.x, y: o.y, nota: "no Android o 'mover' é um toque sem deslocamento" };
    return { ok: false, erros: ["input swipe falhou: " + (r.stderr || "").trim().slice(0, 80)] };
  }
  if (op === "click") {
    const r = await executarBin("input", ["tap", String(o.x), String(o.y)], 15000);
    if (r.code === 0) return { ok: true, ferramenta: "input tap", botao: 1, cliques: 1 };
    return { ok: false, erros: ["input tap falhou: " + (r.stderr || "").trim().slice(0, 80)] };
  }
  if (op === "scroll") {
    const r = await executarBin("input", ["roll", String(o.amount)], 15000);
    if (r.code === 0) return { ok: true, ferramenta: "input roll", direcao: o.direcao, amount: o.amount };
    return { ok: false, erros: ["input roll falhou: " + (r.stderr || "").trim().slice(0, 80)] };
  }
  if (op === "drag") {
    const r = await executarBin("input", ["swipe", String(o.x), String(o.y), String(o.x2), String(o.y2), "600"], 20000);
    if (r.code === 0) return { ok: true, ferramenta: "input swipe", de: [o.x, o.y], para: [o.x2, o.y2] };
    return { ok: false, erros: ["input swipe falhou: " + (r.stderr || "").trim().slice(0, 80)] };
  }
  return { ok: false, erros: ["operação de mouse não suportada no Termux: " + op] };
}

// ---------------------------------------------------------------- macOS
async function mouseMac(op, o) {
  // AppleScript (System Events) faz clique por coordenada; mover o cursor
  // sem clicar exige o cliclick (brew install cliclick).
  if (op === "position") {
    const r = await executarBin("cliclick", ["p"], 10000);
    if (r.code === 0) {
      const nums = (r.stdout.match(/-?\d+/g) || []).map(Number);
      if (nums.length >= 2) return { ok: true, ferramenta: "cliclick", x: nums[0], y: nums[1] };
    }
    return { ok: false, erros: ["no macOS a posição do mouse exige o cliclick (brew install cliclick)"] };
  }
  if (op === "move") {
    const r = await executarBin("cliclick", ["m:" + o.x + "," + o.y], 10000);
    if (r.code === 0) return { ok: true, ferramenta: "cliclick", x: o.x, y: o.y };
    return { ok: false, erros: ["no macOS mover o mouse exige o cliclick (brew install cliclick)"] };
  }
  if (op === "click") {
    const r = await executarBin("cliclick", ["c:" + o.x + "," + o.y], 10000);
    if (r.code === 0) return { ok: true, ferramenta: "cliclick", botao: o.botao, cliques: o.count };
    // fallback: AppleScript click at
    const as = await executarBin(
      "osascript",
      ["-e", 'tell application "System Events" to click at {' + o.x + ", " + o.y + "}"],
      10000
    );
    if (as.code === 0) return { ok: true, ferramenta: "osascript", botao: o.botao, cliques: o.count };
    return { ok: false, erros: ["cliclick e AppleScript falharam: " + (as.stderr || "").trim().split("\n")[0].slice(0, 90)] };
  }
  return { ok: false, erros: ["operação de mouse não suportada no macOS: " + op + " (use o cliclick)"] };
}

// ---------------------------------------------------------------- ação
async function executarMouse(op, opts) {
  const plataforma = process.platform;
  const o = {
    x: coord("x", opts.x || 0),
    y: coord("y", opts.y || 0),
    x2: coord("x2", opts.x2 || 0),
    y2: coord("y2", opts.y2 || 0),
    botao: normalizarBotao(opts.button),
    amount: amountScroll(opts.amount, 3),
    count: Math.min(10, Math.max(1, Math.round(Number(opts.count) || 1))),
    direcao: ["up", "down", "left", "right"].includes(String(opts.direction || "").toLowerCase())
      ? String(opts.direction).toLowerCase()
      : "down",
  };
  // delta com sinal: positivo = scroll para cima, negativo = para baixo
  o.delta = (o.direcao === "up" ? 1 : o.direcao === "down" ? -1 : 0) * Math.abs(o.amount);

  let r;
  if (plataforma === "linux") r = await mouseLinux(op, o);
  else if (plataforma === "win32") r = await mouseWindows(op, o);
  else if (plataforma === "darwin") r = await mouseMac(op, o);
  else if (plataforma === "android" || process.env.TERMUX_VERSION) r = await mouseTermux(op, o);
  else throw new Error("Mouse não suportado nesta plataforma: " + plataforma);

  if (!r.ok) {
    throw new Error(
      "Não consegui " + op + " no mouse. Tentativas: " + (r.erros || []).join(" | ") +
        " — no Linux instale: xdotool (X11) ou ydotool/dotool (Wayland); no Windows não é preciso nada; no Termux use o pacote termux-api"
    );
  }
  const resp = Object.assign({ acao: op, plataforma: plataforma }, r);
  if (!resp.aviso) {
    const aviso = avisoSessao(r.ferramenta);
    if (aviso) resp.aviso = aviso;
  }
  return resp;
}

// ------------------------------------------------------- teclado (v1.16.0)
// A IA digita no teclado do usuário e dispara atalhos. Como as ações de
// mouse e de screenshot, ZERO dependência npm: usa o que o sistema tem.
//
//  - Linux/Wayland: ydotool (uinput) → wtype → xdotool (X11)
//  - Linux/X11:     xdotool
//  - Windows:       PowerShell + user32 (SendInput) — nativo, sem dependência
//  - Termux:        `input` do Android (keyevent/text)
//
// SEGURANÇA — o texto digitado passa pelo MESMO dangerCheck do run_command:
// digitar "rm -rf /" num terminal é tão destrutivo quanto executar isso. E a
// ação exige o modo habilitado (cfg.run), igual ao run_command: subir a
// escalada é FÍSICO, digitado pelo usuário no terminal dele.
//
// Coordenadas/texto NUNCA entram num shell: tudo via execFile com array de
// argumentos, sem shell.

const TECLAS_ESPECIAIS = {
  enter: "enter", retorno: "enter", return: "enter", cr: "enter",
  tab: "tab", tabulacao: "tab",
  backspace: "backspace", bs: "backspace",
  delete: "delete", del: "delete",
  escape: "escape", esc: "escape",
  space: "space", espaco: "space",
  shift: "shift", ctrl: "ctrl", control: "ctrl", alt: "alt",
  altgr: "altgr", super: "super", meta: "super", win: "super", cmd: "super",
  up: "up", seta_cima: "up", down: "down", seta_baixo: "down",
  left: "left", seta_esq: "left", right: "right", seta_dir: "right",
  home: "home", end: "end", pageup: "pageup", pagedown: "pagedown",
  insert: "insert", capslock: "capslock", menu: "menu", pause: "pause",
  printscreen: "printscreen", scrolllock: "scrolllock", numlock: "numlock",
};

// keycodes do kernel (linux/input-event-codes.h) — o ydotool usa esses
const KEYCODES_LINUX = {
  escape: 1, esc: 1,
  backspace: 14, tab: 15, enter: 28, cr: 28,
  leftctrl: 29, ctrl: 29, control: 29,
  leftshift: 42, shift: 42,
  leftalt: 56, alt: 56,
  space: 57,
  f1: 59, f2: 60, f3: 61, f4: 62, f5: 63, f6: 64,
  f7: 65, f8: 66, f9: 67, f10: 68,
  f11: 87, f12: 88,
  rightctrl: 97,
  home: 102, up: 103, pageup: 104, left: 105, right: 106,
  end: 107, down: 108, pagedown: 109, insert: 110, delete: 111,
  numlock: 69, scrolllock: 70, sysrq: 99, pause: 119,
  leftmeta: 125, super: 125, meta: 125, win: 125, cmd: 125,
  rightmeta: 126, menu: 139,
};

// teclas de função: F1..F12 (o ydotool e o xdotool usam nomes proprios)
const TECLAS_F = /^f([1-9]|1[0-2])$/i;

// letras e digitos: keycode do kernel (linux/input-event-codes.h).
// A letra MINUSCULA usa o mesmo keycode da maiuscula — quem faz a diferenca
// e o Shift. Sem este mapa, "ctrl+c" nao tinha keycode e o atalho falhava.
const KEYCODES_LETRAS = {
  a: 30, b: 48, c: 46, d: 32, e: 18, f: 33, g: 34, h: 35, i: 23, j: 36,
  k: 37, l: 38, m: 50, n: 49, o: 24, p: 25, q: 16, r: 19, s: 31, t: 20,
  u: 22, v: 47, w: 17, x: 45, y: 21, z: 44,
  "0": 11, "1": 2, "2": 3, "3": 4, "4": 5, "5": 6, "6": 7, "7": 8, "8": 9, "9": 10,
};

// nome canonico de uma tecla
function normalizarTecla(t) {
  const s = String(t == null ? "" : t).toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (!s) throw new Error("Tecla vazia");
  if (TECLAS_ESPECIAIS[s]) return TECLAS_ESPECIAIS[s];
  if (TECLAS_F.test(s)) return s.toLowerCase();
  if (/^f\d{1,2}$/.test(s)) {
    const n = Number(s.slice(1));
    if (n >= 1 && n <= 12) return "f" + n;
  }
  // caractere único = a própria tecla
  if ([...s].length === 1) return s;
  throw new Error(
    'Tecla desconhecida: "' + t + '" — use enter, tab, backspace, delete, escape, ' +
      "space, shift, ctrl, alt, super, up, down, left, right, home, end, " +
      "pageup, pagedown, insert, f1..f12 ou um caractere único"
  );
}

// nome de tecla -> keycode do kernel (ydotool)
function keycodeLinux(nome) {
  // o mapa vem PRIMEIRO: F11=87 e F12=88 nao seguem a formula 58+N
  // (que so vale ate F10 — F11 daria 69 = KEY_NUMLOCK)
  const c = KEYCODES_LINUX[nome];
  if (c) return c;
  if (TECLAS_F.test(nome)) return 58 + Number(nome.slice(1));
  const letra = KEYCODES_LETRAS[nome];
  if (letra !== undefined) return letra;
  throw new Error('Tecla sem keycode no Linux: "' + nome + '"');
}

// nome de tecla -> nome de tecla do xdotool (type/key)
function nomeXdotool(nome) {
  const mapa = {
    enter: "Return", return: "Return", cr: "Return",
    tab: "Tab", backspace: "BackSpace", delete: "Delete", del: "Delete",
    escape: "Escape", esc: "Escape", space: "space",
    shift: "shift", ctrl: "ctrl", control: "ctrl", alt: "alt",
    altgr: "ISO_Level3_Shift", super: "super", meta: "super",
    win: "super", cmd: "super",
    up: "Up", down: "Down", left: "Left", right: "Right",
    home: "Home", end: "End", pageup: "Prior", pagedown: "Next",
    insert: "Insert", capslock: "Caps_Lock", menu: "Menu", pause: "Pause",
    printscreen: "Print", scrolllock: "Scroll_Lock", numlock: "Num_Lock",
  };
  if (mapa[nome]) return mapa[nome];
  if (TECLAS_F.test(nome)) return nome.toUpperCase();
  return nome;
}

// nome de tecla -> Virtual Key do Windows (user32)
const VK_WINDOWS = {
  enter: 0x0D, return: 0x0D, cr: 0x0D,
  tab: 0x09, backspace: 0x08, delete: 0x2E, del: 0x2E,
  escape: 0x1B, esc: 0x1B, space: 0x20,
  shift: 0x10, ctrl: 0x11, control: 0x11, alt: 0x12,
  altgr: 0x12, super: 0x5B, meta: 0x5B, win: 0x5B, cmd: 0x5B,
  up: 0x26, down: 0x28, left: 0x25, right: 0x27,
  home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, insert: 0x2D,
  printscreen: 0x2C, scrolllock: 0x91, numlock: 0x90, pause: 0x13,
  capslock: 0x14, menu: 0x5D,
};
const VK_F = { f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f6: 0x75, f7: 0x76, f8: 0x77, f9: 0x78, f10: 0x79, f11: 0x7A, f12: 0x7B };

// VK de letras (A-Z = 0x41..0x5A) e digitos (0-9 = 0x30..0x39).
// Sem este mapa, "ctrl+c" no Windows era impossivel: vkWindows("c") lancava.
const VK_LETRAS = {
  a: 0x41, b: 0x42, c: 0x43, d: 0x44, e: 0x45, f: 0x46, g: 0x47, h: 0x48,
  i: 0x49, j: 0x4A, k: 0x4B, l: 0x4C, m: 0x4D, n: 0x4E, o: 0x4F, p: 0x50,
  q: 0x51, r: 0x52, s: 0x53, t: 0x54, u: 0x55, v: 0x56, w: 0x57, x: 0x58,
  y: 0x59, z: 0x5A,
  "0": 0x30, "1": 0x31, "2": 0x32, "3": 0x33, "4": 0x34,
  "5": 0x35, "6": 0x36, "7": 0x37, "8": 0x38, "9": 0x39,
};

function vkWindows(nome) {
  if (VK_F[nome]) return VK_F[nome];
  const v = VK_WINDOWS[nome];
  if (v) return v;
  const letra = VK_LETRAS[nome];
  if (letra !== undefined) return letra;
  throw new Error('Tecla sem VK no Windows: "' + nome + '"');
}

// separa "ctrl+c" em ["ctrl","c"], "Ctrl+Shift+T" em ["ctrl","shift","t"]
function parseAtalho(spec) {
  const partes = String(spec == null ? "" : spec)
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!partes.length) throw new Error("Atalho vazio");
  const teclas = partes.map(normalizarTecla);
  // a última é a tecla principal; as demais são modificadores
  const modificadores = teclas.slice(0, -1);
  const principal = teclas[teclas.length - 1];
  const modsValidos = ["ctrl", "shift", "alt", "altgr", "super"];
  for (const m of modificadores) {
    if (!modsValidos.includes(m))
      throw new Error('Modificador inválido: "' + m + '" — use ctrl, shift, alt, altgr ou super');
  }
  return { modificadores: modificadores, principal: principal };
}

// ---------------------------------------------------------------- Linux
async function tecladoLinuxType(texto) {
  const erros = [];
  const wayland = ehSessaoWayland();

  // 1) ydotool: funciona em Wayland (uinput) e em X11
  const y = await executarBin("ydotool", ["type", "--", texto], 20000);
  if (y.code === 0) return { ok: true, ferramenta: "ydotool", caracteres: texto.length };
  erros.push(y.faltaBinario ? "ydotool não instalado" : "ydotool: " + (y.stderr || "").trim().split("\n")[0].slice(0, 80));

  // 2) wtype: wlroots, digita texto direto (Wayland)
  const w = await executarBin("wtype", ["--", texto], 15000);
  if (w.code === 0) return { ok: true, ferramenta: "wtype", caracteres: texto.length };
  erros.push(w.faltaBinario ? "wtype não instalado" : "wtype: " + (w.stderr || "").trim().split("\n")[0].slice(0, 80));

  // 3) xdotool: X11
  const x = await executarBin("xdotool", ["type", "--clearmodifiers", "--", texto], 20000);
  if (x.code === 0) return { ok: true, ferramenta: "xdotool", caracteres: texto.length };
  erros.push(x.faltaBinario ? "xdotool não instalado" : "xdotool: " + (x.stderr || "").trim().split("\n")[0].slice(0, 80));

  return { ok: false, erros: erros };
}

async function tecladoLinuxKey(atalho) {
  const erros = [];
  const { modificadores, principal } = parseAtalho(atalho);
  const wayland = ehSessaoWayland();

  // ydotool: keycodes, com :1 = pressionado e :0 = solto
  const seq = [];
  for (const m of modificadores) seq.push(keycodeLinux(m) + ":1");
  seq.push(keycodeLinux(principal) + ":1");
  seq.push(keycodeLinux(principal) + ":0");
  for (const m of modificadores.slice().reverse()) seq.push(keycodeLinux(m) + ":0");
  const y = await executarBin("ydotool", ["key"].concat(seq), 15000);
  if (y.code === 0)
    return { ok: true, ferramenta: "ydotool", atalho: modificadores.concat([principal]).join("+") };
  erros.push(y.faltaBinario ? "ydotool não instalado" : "ydotool: " + (y.stderr || "").trim().split("\n")[0].slice(0, 80));

  // xdotool: key --clearmodifiers ctrl+c
  const xargs = ["key", "--clearmodifiers"];
  for (const m of modificadores) xargs.push(nomeXdotool(m));
  xargs.push(nomeXdotool(principal));
  const x = await executarBin("xdotool", xargs, 15000);
  if (x.code === 0)
    return { ok: true, ferramenta: "xdotool", atalho: modificadores.concat([principal]).join("+") };
  erros.push(x.faltaBinario ? "xdotool não instalado" : "xdotool: " + (x.stderr || "").trim().split("\n")[0].slice(0, 80));

  return { ok: false, erros: erros };
}

// ---------------------------------------------------------------- Windows
// SendInput:unicode digita qualquer caractere (inclusive acento e emoji);
// SendInput:vk dispara teclas de verdade (Ctrl+C, Enter, F5...).
const PS_TECLADO = [
  "param([string]$Modo,[string]$Texto,[string]$Atalho,[string]$VK,[string]$Mods)",
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.Windows.Forms",
  "$src = @'",
  "using System;",
  "using System.Text;",
  "using System.Runtime.InteropServices;",
  "public class PonteTeclado {",
  "  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion U; }",
  "  [StructLayout(LayoutKind.Explicit)] public struct InputUnion {",
  "    [FieldOffset(0)] public KEYBDINPUT ki;",
  "    [FieldOffset(0)] public MOUSEINPUT mi;",
  "    [FieldOffset(0)] public HARDWAREINPUT hi;",
  "  }",
  "  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }",
  "  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }",
  "  [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }",
  "  [DllImport(\"user32.dll\", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] p, int cb);",
  "  public const uint KEYEVENTF_KEYUP = 0x0002;",
  "  public const uint KEYEVENTF_UNICODE = 0x0004;",
  "}",
  "'@",
  "Add-Type -TypeDefinition $src",
  "function Tecla-Down($vk) {",
  "  $i = New-Object PonteTeclado+INPUT",
  "  $i.type = 1",
  "  $i.U.ki.wVk = [uint16]$vk",
  "  $i.U.ki.wScan = 0",
  "  $i.U.ki.dwFlags = 0",
  "  $i.U.ki.time = 0",
  "  $i.U.ki.dwExtraInfo = [IntPtr]::Zero",
  "  [void][PonteTeclado]::SendInput(1, @($i), [System.Runtime.InteropServices.Marshal]::SizeOf([type]([PonteTeclado+INPUT])))",
  "}",
  "function Tecla-Up($vk) {",
  "  $i = New-Object PonteTeclado+INPUT",
  "  $i.type = 1",
  "  $i.U.ki.wVk = [uint16]$vk",
  "  $i.U.ki.wScan = 0",
  "  $i.U.ki.dwFlags = [PonteTeclado]::KEYEVENTF_KEYUP",
  "  $i.U.ki.time = 0",
  "  $i.U.ki.dwExtraInfo = [IntPtr]::Zero",
  "  [void][PonteTeclado]::SendInput(1, @($i), [System.Runtime.InteropServices.Marshal]::SizeOf([type]([PonteTeclado+INPUT])))",
  "}",
  "function Char-Unicode($ch) {",
  "  $i = New-Object PonteTeclado+INPUT",
  "  $i.type = 1",
  "  $i.U.ki.wVk = 0",
  "  $i.U.ki.wScan = [uint16][char]$ch",
  "  $i.U.ki.dwFlags = [PonteTeclado]::KEYEVENTF_UNICODE",
  "  $i.U.ki.time = 0",
  "  $i.U.ki.dwExtraInfo = [IntPtr]::Zero",
  "  [void][PonteTeclado]::SendInput(1, @($i), [System.Runtime.InteropServices.Marshal]::SizeOf([type]([PonteTeclado+INPUT])))",
  "  $j = New-Object PonteTeclado+INPUT",
  "  $j.type = 1",
  "  $j.U.ki.wVk = 0",
  "  $j.U.ki.wScan = [uint16][char]$ch",
  "  $j.U.ki.dwFlags = ([PonteTeclado]::KEYEVENTF_UNICODE -bor [PonteTeclado]::KEYEVENTF_KEYUP)",
  "  $j.U.ki.time = 0",
  "  $j.U.ki.dwExtraInfo = [IntPtr]::Zero",
  "  [void][PonteTeclado]::SendInput(1, @($j), [System.Runtime.InteropServices.Marshal]::SizeOf([type]([PonteTeclado+INPUT])))",
  "}",
  "if ($Modo -eq 'type') {",
  "  foreach ($ch in $Texto.ToCharArray()) {",
  "    Char-Unicode $ch",
  "    Start-Sleep -Milliseconds 8",
  "  }",
  "  exit 0",
  "}",
  "$mods = @()",
  "if ($Mods -ne '') { $mods = $Mods -split ',' }",
  "$vk = [int]$VK",
  "foreach ($m in $mods) {",
  "  if ($m -eq 'ctrl') { Tecla-Down 0x11 }",
  "  elseif ($m -eq 'shift') { Tecla-Down 0x10 }",
  "  elseif ($m -eq 'alt') { Tecla-Down 0x12 }",
  "  elseif ($m -eq 'super') { Tecla-Down 0x5B }",
  "}",
  "Tecla-Down $vk",
  "Start-Sleep -Milliseconds 20",
  "Tecla-Up $vk",
  "if ($mods -contains 'super') { Tecla-Up 0x5B }",
  "if ($mods -contains 'alt') { Tecla-Up 0x12 }",
  "if ($mods -contains 'shift') { Tecla-Up 0x10 }",
  "if ($mods -contains 'ctrl') { Tecla-Up 0x11 }",
  "",
].join("\n");

async function tecladoWindowsType(texto) {
  const ps1 = caminhoTemp("teclado.ps1");
  try {
    fs.writeFileSync(ps1, PS_TECLADO, "utf8");
    const r = await executarPowershell(ps1, ["-Modo", "type", "-Texto", texto], 60000);
    if (!r.ok) {
      const msg = (r.stderr || r.stdout || "falhou").trim().split("\n")[0].slice(0, 140);
      return { ok: false, erros: ["PowerShell/SendInput: " + msg] };
    }
    return { ok: true, ferramenta: "powershell/SendInput", caracteres: texto.length };
  } catch (e) {
    return { ok: false, erros: ["falha ao rodar PowerShell: " + (e && e.message ? e.message : String(e))] };
  } finally {
    try {
      fs.unlinkSync(ps1);
    } catch (_) {}
  }
}

async function tecladoWindowsKey(atalho) {
  const { modificadores, principal } = parseAtalho(atalho);
  const ps1 = caminhoTemp("teclado.ps1");
  try {
    fs.writeFileSync(ps1, PS_TECLADO, "utf8");
    const modsWin = { ctrl: "ctrl", shift: "shift", alt: "alt", altgr: "alt", super: "super" };
    const mods = modificadores.map((m) => modsWin[m]).join(",");
    const r = await executarPowershell(
      ps1,
      ["-Modo", "key", "-VK", String(vkWindows(principal)), "-Mods", mods],
      40000
    );
    if (!r.ok) {
      const msg = (r.stderr || r.stdout || "falhou").trim().split("\n")[0].slice(0, 140);
      return { ok: false, erros: ["PowerShell/SendInput: " + msg] };
    }
    return { ok: true, ferramenta: "powershell/SendInput", atalho: modificadores.concat([principal]).join("+") };
  } catch (e) {
    return { ok: false, erros: ["falha ao rodar PowerShell: " + (e && e.message ? e.message : String(e))] };
  } finally {
    try {
      fs.unlinkSync(ps1);
    } catch (_) {}
  }
}

// ---------------------------------------------------------------- Termux
async function tecladoTermuxType(texto) {
  // `input text` nao aceita espacos como argumento separado: usa %s
  const escapado = texto.replace(/ /g, "%s");
  const r = await executarBin("input", ["text", escapado], 30000);
  if (r.code === 0) return { ok: true, ferramenta: "input text", caracteres: texto.length };
  return { ok: false, erros: ["input text falhou: " + (r.stderr || "").trim().split("\n")[0].slice(0, 80)] };
}

async function tecladoTermuxKey(atalho) {
  const { modificadores, principal } = parseAtalho(atalho);
  // keyevent do Android: KEYCODE_ENTER=66, TAB=61, DEL=67, ESCAPE=111,
  // DPAD_UP=19, DOWN=20, LEFT=21, RIGHT=22
  const codigos = {
    enter: 66, return: 66, tab: 61, backspace: 67, delete: 67,
    escape: 111, esc: 111, space: 62,
    up: 19, down: 20, left: 21, right: 22,
    home: 122, end: 123, pageup: 92, pagedown: 93,
  };
  const meta = {
    ctrl: 113, // KEYCODE_CTRL_LEFT
    shift: 59, // KEYCODE_SHIFT_LEFT
    alt: 57, // KEYCODE_ALT_LEFT
    altgr: 113, // KEYCODE_CTRL_LEFT (AltGr = Ctrl+Alt no Android)
    super: 117, // KEYCODE_META_LEFT
  };
  let principalCodigo = codigos[principal];
  if (principalCodigo === undefined) {
    // caractere: no Android, digita via `input text`
    const r = await executarBin("input", ["text", principal.replace(/ /g, "%s")], 15000);
    return r.code === 0
      ? { ok: true, ferramenta: "input text", atalho: principal }
      : { ok: false, erros: ["input text falhou"] };
  }
  // "input keyevent" faz press+release de CADA tecla: o modificador ja foi
  // solto quando a tecla principal entra, entao ctrl+c nao virava ctrl+c.
  // "input keycombination" pressiona todas juntas — e o jeito certo.
  const combo = modificadores.map((m) => meta[m]).concat([principalCodigo]);
  const r = await executarBin("input", ["keycombination"].concat(combo.map(String)), 15000);
  if (r.code === 0)
    return { ok: true, ferramenta: "input keycombination", atalho: modificadores.concat([principal]).join("+") };
  return {
    ok: false,
    erros: ["input keycombination falhou: " + (r.stderr || "").trim().split("\n")[0].slice(0, 80)],
  };
}

// ---------------------------------------------------------------- buffer de linha
// A trava anticatástrofe olha o TEXTO. Sem buffer, a IA burlaria digitando
// "rm -rf" (inofensivo sozinho), depois "/", depois Enter — cada parte
// passaria, mas a LINHA COMPLETA e destrutiva. O buffer modela a linha do
// prompt e o Enter valida a linha inteira, como um terminal de verdade.
//
// O buffer e um MODELO do prompt, nao a verdade: o shell expande (~, $VAR,
// globs, TAB). Por isso o que a IA digita passa pela trava SEMPRE, e o que
// ela cola (ctrl+v) e bloqueado — colar e o bypass classico.

// teto: o buffer nao cresce sem limite (DoS de memoria/payload)
const TECLADO_MAX_BUFFER = 4000;

// atalhos que fecham janela / reiniciam / apagam — nao sao "digitar", sao
// "destruir o estado do usuario". Bloqueados mesmo com o modo ligado.
const ATALHOS_BLOQUEADOS = {
  "alt+f4": "fecha a janela (perde trabalho nao salvo)",
  "ctrl+alt+delete": "reinicia a maquina / abre o gerenciador de tarefa",
  "ctrl+shift+delete": "apaga dados do sistema",
  "super+r": "reinicia o desktop",
  "super+q": "encerra a sessao",
  "super+l": "trava a tela",
  "ctrl+w": "fecha a aba",
};

// devolve o texto da linha atual (o que o Enter vai executar)
function linhaAtual() {
  return bufferLinha.replace(/\s+$/, "");
}

// um Enter limpa a linha (o comando foi executado)
function bufferAcumula(texto) {
  bufferLinha += texto;
  if (bufferLinha.length > TECLADO_MAX_BUFFER)
    bufferLinha = bufferLinha.slice(-TECLADO_MAX_BUFFER);
  // newline no texto digitado tambem fecha a linha
  if (texto.includes("\n")) bufferLinha = "";
}

function bufferLimpa() {
  bufferLinha = "";
}

// valida uma linha do prompt contra a trava. devolve o motivo do bloqueio
// ou null se a linha pode ser executada.
function validarLinhaDigitada(linha) {
  if (!linha || !linha.trim()) return null;
  return dangerCheck(linha, { home: cfg.home, cwd: cfg.home });
}

// ---------------------------------------------------------------- ação
async function executarTeclado(op, opts) {
  const plataforma = process.platform;

  // ---- TRAVA DE SEGURANÇA ----
  // Digitar "rm -rf /" num terminal é tão destrutivo quanto executar. O
  // texto passa pelo MESMO dangerCheck do run_command, e a ação exige o
  // modo habilitado (cfg.run) — a escalada é física, digitada pelo
  // usuário no terminal dele.
  if (!cfg.run)
    throw new Error(
      "Teclado DESLIGADO. No terminal do agente: Ctrl+C e religue com " +
        "npx ponte-local start --allow-run --save (supervisionado, pede s/N a cada tecla) " +
        "ou --auto --save (autônomo, com a trava anticatástrofe ativa)"
    );

  if (op === "type") {
    const texto = String(opts.text == null ? "" : opts.text);
    if (!texto) throw new Error("Texto vazio — use {\"text\":\"o que digitar\"}");
    if (texto.length > 4000) throw new Error("Texto longo demais (" + texto.length + " caracteres, máximo 4000)");
    // TAB completa o comando no shell: o buffer nao reflete a expansao,
    // entao a trava nao conseguiria ver o comando real. Digite o texto sem
    // TAB e use keyboard_key {"key":"tab"} (que valida a linha antes).
    if (texto.includes("\t"))
      throw new Error(
        "TAB dentro do texto e recusado: no shell ele COMPLETA o comando e a " +
          "trava nao veria o resultado. Digite sem TAB e use " +
          "keyboard_key {\"key\":\"tab\"}."
      );
    // TRAVA: valida CADA LINHA do texto, considerando o que ja estava no
    // buffer. Um "\n" no meio do texto e um Enter no terminal — entao a
    // linha seguinte e validada como linha nova (o "\n" fecha a anterior).
    const partes = texto.split("\n");
    let acumulado = bufferLinha;
    for (const parte of partes) {
      const perigo = validarLinhaDigitada(acumulado + parte);
      if (perigo)
        throw new Error(
          "Digitação BLOQUEADA pela trava anticatástrofe (" + perigo + "). " +
            "O mesmo texto que o run_command recusaria é recusado aqui: digitar " +
            "'rm -rf /' num terminal é tão destrutivo quanto executar. " +
            "Linha: \"" + (acumulado + parte).slice(0, 120) + "\""
        );
      acumulado = "";
    }
  } else {
    // atalho: valida o formato (e a tecla)
    const { modificadores, principal } = parseAtalho(opts.key);
    const atalho = modificadores.concat([principal]).join("+");

    // ---- ATALHOS DESTRUTIVOS ----
    if (ATALHOS_BLOQUEADOS[atalho])
      throw new Error(
        "Atalho BLOQUEADO (" + atalho + "): " + ATALHOS_BLOQUEADOS[atalho] +
          ". Use uma ação menos destrutiva."
      );

    // ---- COLAR (ctrl+v) ----
    // O conteudo colado nao passa pelo buffer nem pela trava: e o bypass
    // classico (a IA monta "rm -rf /" num arquivo, copia e cola). A IA tem
    // que DIGITAR o texto — e o texto digitado passa pela trava.
    if (principal === "v" && modificadores.includes("ctrl"))
      throw new Error(
        "Colar (ctrl+v) é BLOQUEADO: o conteúdo colado não passa pela trava " +
          "anticatástrofe. Use keyboard_type para digitar o texto."
      );

    // ---- ENTER (com ou sem modificador) e TAB ----
    // A linha acumulada e o que o Enter vai executar. Qualquer enter conta
    // (shift+enter tambem executa em varios terminais). O TAB completa o
    // comando: a linha tambem precisa estar limpa antes de completar.
    const completaPrompt = principal === "enter" || principal === "tab";
    if (completaPrompt) {
      const linha = linhaAtual();
      const perigo = validarLinhaDigitada(linha);
      if (perigo)
        throw new Error(
          (principal === "enter" ? "Enter" : "TAB") +
            " BLOQUEADO pela trava anticatástrofe: a linha digitada é " +
            "catastrófica (" + perigo + "). Linha: \"" + linha.slice(0, 120) + "\". " +
            "A tecla que a executaria foi recusada."
        );
    }
  }

  // ---- MODO SUPERVISIONADO: o usuario aprova CADA digitacao ----
  // A mensagem de "teclado desligado" promete s/N no supervisionado — aqui
  // a promessa e cumprida de verdade (o run_command tambem pede).
  if (cfg.run && !cfg.auto) {
    const descricao =
      op === "type"
        ? "digitar " + JSON.stringify(String(opts.text || "").slice(0, 120))
        : "pressionar " + String(opts.key || "");
    console.log("");
    console.log("╔═══════════════════════════════════════════════════════╗");
    console.log("║  PEDIDO DE TECLADO — MODO SUPERVISIONADO              ║");
    console.log("╚═══════════════════════════════════════════════════════╝");
    console.log("  Ação: " + descricao);
    const resposta = await askYesNo(60);
    if (!["s", "sim", "y", "yes"].includes(resposta)) {
      audit({ action: "keyboard_" + op, resumo: "REJEITADO: " + descricao });
      throw new Error(
        "Você rejeitou a digitação no terminal (resposta: " + (resposta || "vazia") + ")"
      );
    }
  }

  let r;
  if (op === "type") {
    const texto = String(opts.text == null ? "" : opts.text);
    if (plataforma === "linux") r = await tecladoLinuxType(texto);
    else if (plataforma === "win32") r = await tecladoWindowsType(texto);
    else if (plataforma === "android" || process.env.TERMUX_VERSION) r = await tecladoTermuxType(texto);
    else throw new Error("Teclado não suportado nesta plataforma: " + plataforma);
  } else {
    const atalho = String(opts.key == null ? "" : opts.key);
    if (plataforma === "linux") r = await tecladoLinuxKey(atalho);
    else if (plataforma === "win32") r = await tecladoWindowsKey(atalho);
    else if (plataforma === "android" || process.env.TERMUX_VERSION) r = await tecladoTermuxKey(atalho);
    else throw new Error("Teclado não suportado nesta plataforma: " + plataforma);
  }

  if (!r.ok) {
    throw new Error(
      "Não consegui " + (op === "type" ? "digitar" : "disparar o atalho") + ". Tentativas: " +
        (r.erros || []).join(" | ") +
        " — no Linux instale: ydotool (Wayland) ou xdotool (X11); no Windows não é preciso nada; no Termux use o pacote termux-api"
    );
  }
  // auditoria: o que foi digitado fica no log (como o run_command)
  audit({
    action: "keyboard_" + op,
    resumo: op === "type" ? String(opts.text || "").slice(0, 200) : String(opts.key || ""),
    ferramenta: r.ferramenta || null,
  });

  // buffer de linha: o que foi digitado alimenta a trava do próximo Enter
  if (op === "type") {
    bufferAcumula(String(opts.text == null ? "" : opts.text));
  } else {
    const { modificadores, principal } = parseAtalho(opts.key);
    // Enter (sem modificador) executa a linha: a trava já validou antes.
    // Enter COM modificador (shift+enter) tambem executa em varios terminais
    // — por isso ele tambem limpa a linha depois de validado.
    if (principal === "enter") bufferLimpa();
    // backspace remove o ultimo caractere; delete (avanco) NAO mexe no
    // buffer — apagar para frente nao muda o que ja foi digitado
    else if (principal === "backspace") bufferLinha = bufferLinha.slice(0, -1);
  }

  const resp = Object.assign({ acao: op, plataforma: plataforma }, r);
  if (!resp.aviso) {
    const aviso = avisoSessao(r.ferramenta);
    if (aviso) resp.aviso = aviso;
  }
  resp.linhaAtual = linhaAtual().slice(0, 200);
  return resp;
}

// ---------------------------------------------------------------- ações (whitelist fixa)
const ACTIONS = {
  ping: async () => {
    const cpus = os.cpus();
    return {
      agente: "ponte-agent/" + VERSION,
      modo: !cfg.run
        ? "arquivos apenas (run_command desligado)"
        : cfg.auto
          ? "autônomo (run_command SEM confirmação · trava anticatástrofe ativa)"
          : cfg.godMode
            ? "modo deus (run_command SEM confirmação · trava anticatástrofe ativa)"
            : "supervisionado (run_command ATIVO)",
      usuario: os.userInfo().username,
      maquina: os.hostname(),
      plataforma: os.platform() + " " + os.arch() + " · " + os.release(),
      home: cfg.home,
      node: process.version,
      cpus: cpus.length + "x " + (cpus[0] ? cpus[0].model.trim().split("@")[0].trim().slice(0, 40) : "?"),
      ramTotalGB: +(os.totalmem() / 2 ** 30).toFixed(2),
      ramLivreGB: +(os.freemem() / 2 ** 30).toFixed(1),
      escopo: "somente " + cfg.home + " (pastas sensíveis bloqueadas)",
      modoDeus: !!cfg.godMode,
      godModeDeclined: !!cfg.godModeDeclined,
      skill: versaoSkillLocal() || "ainda não baixada",
    };
  },

  list: async (args) => {
    const rp = assertAllowed(args.path || cfg.home);
    if (!fs.statSync(rp).isDirectory()) throw new Error("Não é uma pasta: " + rp);
    const total = fs.readdirSync(rp).length;
    const names = fs.readdirSync(rp).filter((n) => !BLOCKED_DIRS.has(n)).slice(0, 4000);
    const all = [];
    for (const name of names) {
      let s;
      try {
        s = fs.statSync(path.join(rp, name));
      } catch (_) {
        continue;
      }
      all.push({ nome: name, pasta: s.isDirectory(), bytes: s.size, mtime: s.mtime.toISOString() });
    }
    all.sort((a, b) => (a.pasta !== b.pasta ? (a.pasta ? -1 : 1) : a.nome.localeCompare(b.nome, "pt-BR")));
    const offset = Math.max(0, args.offset | 0);
    const limit = Math.min(2000, Math.max(1, args.limit || 400));
    const entries = all.slice(offset, offset + limit);
    return { path: rp, total, visiveis: entries.length, entradas: entries };
  },

  read_text: async (args) => {
    if (!args.path) throw new Error("Falta o caminho");
    const rp = assertAllowed(args.path);
    const s = fs.statSync(rp);
    if (!s.isFile()) throw new Error("Não é um arquivo");
    const MAX_PEDACO = 2 * 1024 * 1024; // 2 MB por chamada — arquivo pode ter QUALQUER tamanho
    const maxBytes = Math.min(MAX_PEDACO, Math.max(1, Number(args.maxBytes) || 200000));
    const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
    const enc = args.encoding ? String(args.encoding) : "auto";
    if (!["auto", "utf-8", "utf-16le", "utf-16be", "windows-1252", "latin1"].includes(enc))
      throw new Error('encoding inválido: "' + enc + '" — use auto, utf-8, utf-16le, utf-16be, windows-1252 ou latin1');
    if (offset >= s.size)
      return { path: rp, bytes: s.size, encoding: enc === "auto" ? null : enc, offset, lidos: 0, caracteres: 0, truncado: false, proximoOffset: null, conteudo: "" };
    if ((enc === "utf-16le" || enc === "utf-16be") && offset % 2 !== 0)
      throw new Error("offset ímpar desalinha utf-16 — siga o proximoOffset devolvido nos pedaços anteriores");
    // binário de verdade? avise com o tipo em vez de cuspir lixo
    if (enc === "auto") {
      const sn = sniffTipo(rp, s.size);
      if (!sn.provavelTexto)
        return {
          path: rp,
          bytes: s.size,
          provavelBinario: true,
          tipo: sn.tipo,
          dica:
            "Não é texto (tipo: " + sn.tipo + "). Use file_info para detalhes, " +
            'read_binary {"path", "offset", "maxBytes"} para ler em base64 por pedaços, ' +
            'ou read_text com encoding forçado se souber que é texto não-utf-8.',
        };
    }
    const fd = fs.openSync(rp, "r");
    try {
      const buf = Buffer.alloc(Math.min(maxBytes, s.size - offset));
      const n = fs.readSync(fd, buf, 0, buf.length, offset);
      const r = decodificarPedaco(buf.subarray(0, n), offset, offset + n < s.size, enc);
      const temMais = offset + r.consumidos < s.size;
      const resp = {
        path: rp,
        bytes: s.size,
        encoding: r.encoding,
        offset,
        lidos: r.consumidos,
        caracteres: r.conteudo.length,
        truncado: temMais,
        proximoOffset: temMais ? offset + r.consumidos : null,
        conteudo: r.conteudo,
      };
      if (temMais)
        resp.dica =
          'Ainda há ' + fmtMB(s.size - offset - r.consumidos) + ' — continue com read_text {"path":"' + rp + '","offset":' + (offset + r.consumidos) + '}';
      if (r.encoding !== "utf-8")
        resp.dica = (resp.dica ? resp.dica + ' · ' : "") + 'arquivo não é utf-8 (' + r.encoding + ') — nos próximos pedaços passe encoding:"' + r.encoding + '" para leitura byte-exata';
      return resp;
    } finally {
      fs.closeSync(fd);
    }
  },

  write_text: async (args) => {
    if (!args.path) throw new Error("Falta o caminho");
    const rp = assertAllowed(args.path);
    const content = String(args.content == null ? "" : args.content);
    if (content.length > 1024 * 1024) throw new Error("Conteúdo maior que 1 MB");
    const existed = fs.existsSync(rp);
    if (existed) {
      // overwrite:true numa PASTA mandaria a subárvore inteira pra lixeira
      // e criaria um arquivo no lugar — recusar sempre (v1.11.0)
      let st = null;
      try { st = fs.statSync(rp); } catch (_) {}
      if (st && st.isDirectory())
        throw new Error("O caminho é uma PASTA — write_text cria arquivo. Escolha outro nome ou remova a pasta manualmente.");
      if (!args.overwrite)
        throw new Error("Já existe. Se quiser substituir, mande overwrite:true (o antigo vai pra lixeira)");
    }
    fs.mkdirSync(path.dirname(rp), { recursive: true });
    if (existed) {
      const { trashName } = trashMove(rp);
      audit({ action: "write_text", resumo: "substituiu " + rp, undo: { kind: "trash", trashName } });
    } else {
      audit({ action: "write_text", resumo: "criou " + rp, undo: { kind: "create", path: rp } });
    }
    fs.writeFileSync(rp, content, "utf8");
    return { path: rp, bytes: Buffer.byteLength(content), substituiu: existed };
  },

  search: async (args) => {
    const rp = assertAllowed(args.path || cfg.home);
    const query = String(args.query == null ? "" : args.query).toLowerCase();
    if (!query) throw new Error("Busca vazia");
    const mode = args.mode === "content" ? "content" : "name";
    const max = Math.min(500, args.max || (mode === "name" ? 300 : 200));
    const hits = [];
    let scanned = 0;
    walk(rp, { timeCapMs: 20000, maxDepth: 12 }, (full) => {
      scanned++;
      if (hits.length >= max) return;
      let s;
      try {
        s = fs.statSync(full);
      } catch (_) {
        return;
      }
      if (mode === "name") {
        if (full.toLowerCase().includes(query)) hits.push({ path: full, bytes: s.size });
      } else {
        if (s.size > 2 * 1024 * 1024 || s.size === 0) return;
        if (looksBinary(full)) return;
        let text;
        try {
          text = fs.readFileSync(full, "utf8");
        } catch (_) {
          return;
        }
        const lines = text.split("\n");
        for (let i = 0; i < lines.length && hits.length < max; i++) {
          if (lines[i].toLowerCase().includes(query))
            hits.push({ path: full, linha: i + 1, trecho: lines[i].trim().slice(0, 200) });
        }
      }
    });
    return { modo: mode, busca: args.query, escaneados: scanned, encontrados: hits.length, resultados: hits };
  },

  mkdir: async (args) => {
    if (!args.path) throw new Error("Falta o caminho");
    const rp = assertAllowed(args.path);
    fs.mkdirSync(rp, { recursive: true });
    audit({ action: "mkdir", resumo: rp });
    return { path: rp };
  },

  move: async (args) => {
    if (!args.from || !args.to) throw new Error("Falta origem/destino");
    const from = assertAllowed(args.from);
    const to = assertAllowed(args.to);
    if (!fs.existsSync(from)) throw new Error("Origem não existe: " + from);
    const dest = moveItem(from, to);
    audit({ action: "move", resumo: from + " → " + dest, undo: { kind: "move", from, to: dest } });
    return { de: from, para: dest };
  },

  rename: async (args) => {
    if (!args.path || !args.newName) throw new Error("Falta caminho/nome");
    const rp = assertAllowed(args.path);
    const newName = String(args.newName);
    if (newName.includes("/") || newName.includes("\\") || newName === "." || newName === "..")
      throw new Error("Nome inválido");
    const to = path.join(path.dirname(rp), newName);
    const dest = moveItem(rp, to);
    audit({ action: "rename", resumo: rp + " → " + dest, undo: { kind: "move", from: rp, to: dest } });
    return { de: rp, para: dest };
  },

  "delete": async (args) => {
    const paths = Array.isArray(args.paths) ? args.paths : args.path ? [args.path] : [];
    if (!paths.length) throw new Error("Nada para apagar");
    const home = path.resolve(cfg.home);
    const feitos = [];
    for (const p of paths) {
      const rp = assertAllowed(p);
      if (rp === home) throw new Error("Não apago a home inteira");
      if (!fs.existsSync(rp)) {
        feitos.push({ path: rp, erro: "não existe" });
        continue;
      }
      const { trashName } = trashMove(rp);
      audit({ action: "delete", resumo: rp + " → lixeira", undo: { kind: "trash", trashName } });
      feitos.push({ path: rp, lixeira: trashName });
    }
    return { itens: feitos, nota: "tudo foi para a lixeira do agente — recuperável (restore/undo_last)" };
  },

  restore: async (args) => {
    if (!args.trashName) throw new Error("Falta o trashName");
    const dest = restoreFromTrash(String(args.trashName));
    audit({ action: "restore", resumo: "restaurou " + dest });
    return { restaurado: dest };
  },

  organize_plan: async (args) => {
    if (!args.path) throw new Error("Falta o caminho");
    const rp = assertAllowed(args.path);
    if (!fs.statSync(rp).isDirectory()) throw new Error("Não é uma pasta");
    const labels = new Set(GROUPS.map((g) => g[0]));
    const plan = [];
    for (const ent of fs.readdirSync(rp, { withFileTypes: true })) {
      if (!ent.isFile() || ent.name.startsWith(".") || labels.has(ent.name)) continue;
      const parts = ent.name.toLowerCase().split(".");
      const group = EXT_TO_GROUP[parts[parts.length - 1]] || "Outros";
      plan.push({ de: path.join(rp, ent.name), para: path.join(rp, group, ent.name), grupo: group });
      if (plan.length >= 3000) break;
    }
    const porGrupo = {};
    for (const item of plan) porGrupo[item.grupo] = (porGrupo[item.grupo] || 0) + 1;
    return { pasta: rp, total: plan.length, porGrupo, plano: plan };
  },

  apply_plan: async (args) => {
    const plan = Array.isArray(args.plan) ? args.plan : [];
    if (!plan.length) throw new Error("Plano vazio");
    const movidos = [];
    const erros = [];
    const moves = [];
    for (const item of plan) {
      try {
        const from = assertAllowed(item.de);
        const to = assertAllowed(item.para);
        if (from === to || !fs.existsSync(from)) continue;
        const dest = moveItem(from, to);
        moves.push({ from, to: dest });
        movidos.push(dest);
      } catch (e) {
        erros.push({ de: item.de, erro: e.message });
      }
    }
    audit({
      action: "apply_plan",
      resumo: movidos.length + " arquivo(s) movido(s)",
      undo: moves.length ? { kind: "batch", moves } : null,
    });
    return {
      movidos: movidos.length,
      erros: erros.length,
      detalhes: movidos.slice(0, 200),
      listaErros: erros.slice(0, 50),
    };
  },

  undo_last: async () => {
    const lines = caudaLog().reverse(); // só a cauda do log (v1.11.0)
    if (!lines.length) throw new Error("Log vazio — nada para desfazer");
    for (const line of lines) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch (_) {
        continue;
      }
      const u = entry.undo;
      if (!u) continue;
      if (u.kind === "move") {
        // entrada quebrada não trava o undo pra sempre: pula e tenta a
        // anterior (v1.11.0 — antes lançava erro e TODA chamada futura
        // falhava no mesmo lugar)
        if (!fs.existsSync(u.to)) {
          audit({ action: "undo", erro: "entrada pulada (alvo sumiu): " + entry.resumo });
          continue;
        }
        const dest = moveItem(u.to, u.from);
        audit({ action: "undo", resumo: "reverteu: " + entry.resumo });
        return { revertido: entry.action, para: dest };
      }
      if (u.kind === "batch") {
        let n = 0;
        const detalhes = [];
        for (const m of u.moves.slice().reverse()) {
          if (fs.existsSync(m.to)) {
            detalhes.push(moveItem(m.to, m.from));
            n++;
          }
        }
        audit({ action: "undo", resumo: "reverteu lote (" + n + " itens)" });
        return { revertido: entry.action, itens: n, detalhes: detalhes.slice(0, 50) };
      }
      if (u.kind === "trash") {
        const dest = restoreFromTrash(u.trashName);
        audit({ action: "undo", resumo: "restaurou da lixeira: " + dest });
        return { revertido: entry.action, restaurado: dest };
      }
      if (u.kind === "create" && fs.existsSync(u.path)) {
        const { trashName } = trashMove(u.path);
        audit({ action: "undo", resumo: "removeu arquivo criado: " + u.path });
        return { revertido: entry.action, lixeira: trashName };
      }
    }
    throw new Error("Nenhuma ação reversível encontrada no log");
  },

  free_space: async () => {
    if (typeof fs.statfs !== "function")
      throw new Error("Esta versão do Node não tem fs.statfs — rode 'df -h' no terminal");
    return new Promise((resolve, reject) => {
      fs.statfs(path.resolve(cfg.home), (err, st) => {
        if (err) return reject(err);
        const total = st.blocks * st.bsize;
        const livre = st.bavail * st.bsize;
        resolve({
          totalGB: +(total / 2 ** 30).toFixed(1),
          livreGB: +(livre / 2 ** 30).toFixed(1),
          usoPercentual: Math.round((100 * (total - livre)) / total),
        });
      });
    });
  },

  task_done: async (args) => {
    const resumo =
      args && args.resumo != null ? String(args.resumo).slice(0, 4000) : "";
    const r = fecharTarefa(resumo);
    audit({
      action: "task_done",
      resumo: r.abriuRelatorio
        ? "tarefa fechada pela IA; relatório aberto no PC (" + r.comandos + " comandos)"
        : "task_done sem comandos de trabalho",
    });
    return r;
  },
  god_mode: async (args) => {
    // Ativação CONVERSACIONAL: a IA pergunta ao usuário NO CHAT; com o
    // aceite dele, envia {"enabled":true} e o agente aplica direto — sem
    // caixa s/N no terminal. Recusa também é conversacional: a IA registra
    // {"declined":true} para não insistir em sessões futuras.
    if (args.declined === true || args.declined === "true") {
      cfg.godModeDeclined = true;
      saveConfig(cfg);
      audit({ action: "god_mode", resumo: "usuário recusou no chat (registrado pela IA)" });
      return {
        godMode: false,
        godModeDeclined: true,
        mensagem: "Registrado: usuário recusou o modo deus. A IA não pergunta de novo; basta ele pedir quando quiser.",
      };
    }
    const querLigar = args.enabled === true || args.enabled === "true";
    const querDesligar = args.enabled === false || args.enabled === "false";
    if (!querLigar && !querDesligar)
      return {
        godMode: !!cfg.godMode,
        godModeDeclined: !!cfg.godModeDeclined,
        dica: 'use {"enabled": true} para ativar, {"enabled": false} para desligar, {"declined": true} para registrar recusa',
      };
    if (querDesligar) {
      salvarGodMode(false);
      audit({ action: "god_mode", resumo: "desativado pela IA" });
      log("modo deus DESATIVADO — run_command volta ao modo anterior.");
      return {
        godMode: false,
        mensagem: "modo deus desativado (tornar mais seguro nunca pede confirmação).",
      };
    }
    // Ativação: a IA JÁ perguntou ao usuário no chat e ele aceitou — o
    // agente aplica direto, sem prompt no terminal.
    salvarGodMode(true);
    audit({ action: "god_mode", resumo: "ATIVADO pela IA após aceite do usuário no chat" });
    log("modo deus ATIVO — a IA perguntou no chat, o usuário aceitou; run_command sem confirmação.");
    console.log("  [deus] ativado pela IA após aceite do usuário no chat.");
    return { godMode: true, mensagem: "modo deus ativado — aceite do usuário confirmado pela IA no chat." };
  },

  skill_update: async () => {
    const r = await atualizarSkill("comando");
    r.versaoLocal = versaoSkillLocal();
    r.arquivo = SKILL_FILE;
    r.rotina =
      "boot + a cada 60 s (ETag/304; backoff ate 15 min se a rede falhar)";
    return r;
  },

  tree: async (args) => {
    const rp = assertAllowed(args.path || cfg.home);
    const maxDepth = Math.min(4, Number(args.depth) || 2);
    const maxEntries = Math.min(3000, Number(args.maxEntries) || 800);
    let count = 0;
    function build(dir, d) {
      if (d > maxDepth || count >= maxEntries) return null;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return null;
      }
      entries.sort((a, b) =>
        a.isDirectory() !== b.isDirectory()
          ? a.isDirectory() ? -1 : 1
          : a.name.localeCompare(b.name, "pt-BR")
      );
      const nodes = [];
      for (const ent of entries) {
        if (count >= maxEntries) break;
        if (BLOCKED_DIRS.has(ent.name) || SKIP_WALK.has(ent.name)) continue;
        count++;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          nodes.push({ nome: ent.name, pasta: true, filhos: build(full, d + 1) });
        } else {
          let s = null;
          try { s = fs.statSync(full); } catch (_) {}
          nodes.push({ nome: ent.name, bytes: s ? s.size : null });
        }
      }
      return nodes;
    }
    return { path: rp, arvore: build(rp, 1), limite: count >= maxEntries ? "cortado no maxEntries" : null };
  },

  disk_usage: async (args) => {
    const rp = assertAllowed(args.path || cfg.home);
    const maxDepth = Math.min(4, Number(args.depth) || 2);
    const t0 = Date.now();
    const sizes = new Map();
    walk(rp, { timeCapMs: 120000, maxDepth: 12 }, (full) => {
      let s;
      try { s = fs.statSync(full); } catch (_) { return; }
      if (!s.isFile()) return;
      let d = path.dirname(full);
      while (true) {
        const rel = path.relative(rp, d);
        const depthNow = rel === "" ? 0 : rel.split(path.sep).length;
        if (depthNow <= maxDepth) sizes.set(d, (sizes.get(d) || 0) + s.size);
        if (d === rp) break;
        d = path.dirname(d);
      }
    });
    const top = [...sizes.entries()]
      .map(([p, bytes]) => ({ pasta: p, mb: +(bytes / 1048576).toFixed(1) }))
      .sort((a, b) => b.mb - a.mb)
      .slice(0, 30);
    return {
      path: rp,
      totalMB: +((sizes.get(rp) || 0) / 1048576).toFixed(1),
      topPastas: top,
      ms: Date.now() - t0,
      nota: "aproximado — ignora links simbólicos",
    };
  },

  duplicates: async (args) => {
    const rp = assertAllowed(args.path || cfg.home);
    const minSize = Math.max(1, Number(args.minSizeBytes) || 1024);
    const bySize = new Map();
    let escaneados = 0;
    walk(rp, { timeCapMs: 60000, maxDepth: 14 }, (full) => {
      escaneados++;
      let s;
      try { s = fs.statSync(full); } catch (_) { return; }
      if (!s.isFile() || s.size < minSize) return;
      if (!bySize.has(s.size)) bySize.set(s.size, []);
      bySize.get(s.size).push(full);
    });
    let hasheados = 0;
    const grupos = [];
    for (const [size, files] of bySize) {
      if (files.length < 2) continue;
      if (grupos.length >= 200 || hasheados > 20000) break;
      const byHash = new Map();
      for (const f of files) {
        try {
          hasheados++;
          const h = hashFile(f, size);
          if (!byHash.has(h)) byHash.set(h, []);
          byHash.get(h).push(f);
        } catch (_) {}
      }
      for (const fs2 of byHash.values()) {
        if (fs2.length >= 2) grupos.push({ bytes: size, arquivos: fs2 });
      }
    }
    grupos.sort((a, b) => b.bytes * b.arquivos.length - a.bytes * a.arquivos.length);
    const gasto = grupos.reduce((acc, g) => acc + g.bytes * (g.arquivos.length - 1), 0);
    return {
      pasta: rp,
      escaneados,
      hasheados,
      grupos: grupos.length,
      espacoRecuperavelMB: +(gasto / 1048576).toFixed(1),
      duplicados: grupos.slice(0, 100),
      nota: "eu não apago nada por conta própria — você escolhe o que fazer com cada grupo",
    };
  },

  read_binary: async (args) => {
    if (!args.path) throw new Error("Falta o caminho");
    const rp = assertAllowed(args.path);
    const s = fs.statSync(rp);
    if (!s.isFile()) throw new Error("Não é um arquivo");
    const MAX_PEDACO = 6 * 1024 * 1024; // base64 ~8 MB — cabe na ponte (corpo 12 MB)
    const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
    const maxBytes = Math.min(
      MAX_PEDACO,
      Math.max(1, Number(args.maxBytes) || (s.size <= MAX_PEDACO ? MAX_PEDACO : 4 * 1024 * 1024))
    );
    const tipo = sniffTipo(rp, s.size).tipo;
    if (offset >= s.size)
      return { path: rp, bytes: s.size, tipo, offset, lidos: 0, temMais: false, proximoOffset: null, base64: "" };
    const fd = fs.openSync(rp, "r");
    try {
      const buf = Buffer.alloc(Math.min(maxBytes, s.size - offset));
      fs.readSync(fd, buf, 0, buf.length, offset);
      const temMais = offset + buf.length < s.size;
      const resp = {
        path: rp,
        bytes: s.size,
        tipo,
        offset,
        lidos: buf.length,
        temMais,
        proximoOffset: temMais ? offset + buf.length : null,
        base64: buf.toString("base64"),
      };
      if (temMais)
        resp.dica = 'Continue com read_binary {"path":"' + rp + '","offset":' + (offset + buf.length) + '} e junte os base64 na ordem';
      return resp;
    } finally {
      fs.closeSync(fd);
    }
  },

  file_info: async (args) => {
    if (!args.path) throw new Error("Falta o caminho");
    const rp = assertAllowed(args.path);
    const s = fs.statSync(rp);
    const info = { path: rp, pasta: s.isDirectory(), bytes: s.size, mtime: s.mtime.toISOString() };
    if (!s.isFile()) {
      info.tipo = "pasta";
      info.dica = "Use list/tree para explorar pastas";
      return info;
    }
    const sn = sniffTipo(rp, s.size);
    info.tipo = sn.tipo;
    info.provavelTexto = sn.provavelTexto;
    if (sn.encoding) info.encoding = sn.encoding;
    if (sn.tipo === "vazio") info.dica = "Arquivo com 0 bytes";
    else if (sn.provavelTexto)
      info.dica =
        "Texto" + (sn.encoding && sn.encoding !== "utf-8" ? " (" + sn.encoding + ")" : "") +
        " — use read_text; se for grande, siga o proximoOffset em pedaços" +
        (sn.encoding && sn.encoding !== "utf-8" ? ' passando encoding:"' + sn.encoding + '"' : "");
    else
      info.dica = "Binário (" + sn.tipo + ") — read_binary {offset, maxBytes} lê em pedaços base64; junte na ordem para reconstruir";
    return info;
  },

  write_binary: async (args) => {
    if (!args.path) throw new Error("Falta o caminho");
    const rp = assertAllowed(args.path);
    const b64 = String(args.base64 == null ? "" : args.base64).replace(/\s+/g, "");
    const buf = Buffer.from(b64, "base64");
    if (!buf.length) throw new Error("Conteúdo vazio ou base64 inválido");
    if (buf.length > 8 * 1024 * 1024)
      throw new Error("Maior que 8 MB — a ponte não é pra transferência pesada");
    const existed = fs.existsSync(rp);
    if (existed) {
      // overwrite:true numa PASTA mandaria a subárvore inteira pra lixeira
      // e criaria um binário no lugar — recusar sempre (v1.11.0)
      let st = null;
      try { st = fs.statSync(rp); } catch (_) {}
      if (st && st.isDirectory())
        throw new Error("O caminho é uma PASTA — write_binary cria arquivo. Escolha outro nome ou remova a pasta manualmente.");
      if (!args.overwrite)
        throw new Error("Já existe. Sobrescrever exige overwrite:true (o antigo vai pra lixeira)");
    }
    fs.mkdirSync(path.dirname(rp), { recursive: true });
    if (existed) {
      const { trashName } = trashMove(rp);
      audit({ action: "write_binary", resumo: "substituiu " + rp, undo: { kind: "trash", trashName } });
    } else {
      audit({
        action: "write_binary",
        resumo: "criou " + rp + " (" + fmtMB(buf.length) + ")",
        undo: { kind: "create", path: rp },
      });
    }
    fs.writeFileSync(rp, buf);
    return { path: rp, bytes: buf.length, substituiu: existed };
  },

  run_command: async (args) => {
    if (!cfg.run)
      throw new Error(
        "run_command DESLIGADO. No terminal do agente: Ctrl+C e religue com npx ponte-local --auto --save (autônomo) ou npx ponte-local --allow-run --save (supervisionado)"
      );
    const cmdline = String(args.command == null ? "" : args.command).trim();
    if (!cmdline) throw new Error("Comando vazio");
    if (cmdline.length > 4000) throw new Error("Comando grande demais (limite 4000 caracteres)");
    const cwd = args.cwd ? path.resolve(cfg.home, String(args.cwd)) : cfg.home;
    const timeoutMin = Math.min(30, Number(args.timeoutMin) || 3);

    // ---- modo autônomo/modo deus: executa direto, exceto padrões catastróficos
    if (cfg.auto || cfg.godMode) {
      const perigo = dangerCheck(cmdline, { home: cfg.home, cwd });
      if (perigo) {
        audit({ action: "run_command", resumo: "AUTO-BLOQUEADO (" + perigo + "): " + cmdline.slice(0, 200) });
        throw new Error(
          "AUTO-BLOQUEADO pela trava anticatástrofe (" +
            perigo +
            "). Se for isso mesmo que você quer, religue em modo supervisionado e aprove com s/N."
        );
      }
      console.log("");
      console.log(
        "  [" + (cfg.auto ? "AUTO" : "deus") + "] $ " + cmdline.replace(/\s*\n\s*/g, " && ")
      );
      spinnerInicio(cmdline);
      const out = await executarComando(cmdline, cwd, timeoutMin);
      await spinnerGaranteMinimo();
      spinnerFim();
      mostraOutput(out);
      audit({
        action: "run_command",
        modo: cfg.auto ? "auto" : "deus",
        resumo: cmdline.slice(0, 200),
        exitCode: out.code,
        ms: out.ms,
      });
      return {
        comando: cmdline,
        cwd,
        exitCode: out.code,
        mortoPorTimeout: out.mortoPorTimeout,
        ms: out.ms,
        stdout: corta150k(out.stdout),
        stderr: corta150k(out.stderr),
      };
    }

    // ---- modo supervisionado: caixa + confirmação física s/N
    console.log("");
    console.log("╔═══════════════════════════════════════════════════════╗");
    console.log("║  PEDIDO DE COMANDO — MODO SUPERVISIONADO              ║");
    console.log("╚═══════════════════════════════════════════════════════╝");
    console.log("  Diretório: " + cwd);
    console.log("  Timeout  : " + timeoutMin + " min");
    console.log("  ┌── comando proposto pela IA ──────────────");
    for (const linha of cmdline.split("\n")) console.log("  │ " + linha);
    console.log("  └───────────────────────────────────────");
    const resposta = await askYesNo(60);
    if (!["s", "sim", "y", "yes"].includes(resposta)) {
      audit({ action: "run_command", resumo: "REJEITADO: " + cmdline.slice(0, 200) });
      throw new Error("Você rejeitou o comando no terminal (resposta: " + (resposta || "vazia") + ")");
    }
    spinnerInicio(cmdline);
    const out = await executarComando(cmdline, cwd, timeoutMin);
    await spinnerGaranteMinimo();
    spinnerFim();
    mostraOutput(out);
    audit({ action: "run_command", resumo: cmdline.slice(0, 200), exitCode: out.code, ms: out.ms });
    return {
      comando: cmdline,
      cwd,
      exitCode: out.code,
      mortoPorTimeout: out.mortoPorTimeout,
      ms: out.ms,
      stdout: corta150k(out.stdout),
      stderr: corta150k(out.stderr),
    };
  },
  screenshot: async (args) => {
    return capturarScreenshot({
      janela: false,
      format: args.format,
      quality: args.quality,
      windowTitle: null,
      windowClass: null,
      windowId: null,
    });
  },
  screenshot_window: async (args) => {
    return capturarScreenshot({
      janela: true,
      format: args.format,
      quality: args.quality,
      windowTitle: args.window_title ? String(args.window_title) : null,
      windowClass: args.window_class ? String(args.window_class) : null,
      windowId: args.window_id ? String(args.window_id) : null,
    });
  },
  mouse_position: async () => {
    return executarMouse("position", {});
  },
  mouse_move: async (args) => {
    if (args.x === undefined || args.y === undefined)
      throw new Error('Falta a posição: use {"x":1200,"y":800}');
    return executarMouse("move", args);
  },
  mouse_click: async (args) => {
    if (args.x === undefined || args.y === undefined)
      throw new Error('Falta a posição: use {"x":1200,"y":800,"button":"left"}');
    return executarMouse("click", args);
  },
  mouse_scroll: async (args) => {
    return executarMouse("scroll", args);
  },
  mouse_drag: async (args) => {
    if (args.x === undefined || args.y === undefined || args.x2 === undefined || args.y2 === undefined)
      throw new Error('Falta o caminho: use {"x":100,"y":100,"x2":800,"y2":600}');
    return executarMouse("drag", args);
  },
  keyboard_type: async (args) => {
    return executarTeclado("type", args);
  },
  keyboard_key: async (args) => {
    if (!args.key) throw new Error('Falta a tecla: use {"key":"enter"} ou {"key":"ctrl+c"}');
    return executarTeclado("key", args);
  },
};

// ---------------------------------------------------------------- relatório da tarefa (v1.8.0)
// A IA fecha a tarefa com a ação task_done e o agente abre o relatório na
// tela do usuário na hora; sem task_done, quem fecha é o agente (v1.10.0+).
let lote = null; // comandos da tarefa em andamento (ping e task_done não entram)
// RELATÓRIO OBRIGATÓRIO (v1.10.0): o agente não depende mais da IA mandar
// task_done — pausa longa entre comandos ou o encerramento do agente fecham
// a tarefa sozinhos, sempre gerando e abrindo o relatório na tela.
// (v1.10.5) a pausa é vigiada PELO LOOP de poll (fechaRelatorioVencido()):
// não precisa mais de comando novo chegando para disparar o fechamento.
const TAREFA_GAP_MS = (() => {
  const n = Number(process.env.PONTE_TAREFA_GAP_MS);
  return n >= 1000 ? n : 3 * 60 * 1000; // pausa que fecha a tarefa anterior
})();
let relatorioEmTela = false; // há um relatório aberto na tela agora

let matancaEditor = 0; // kills de editor em andamento (fecharJanelaRelatorio)

function fecharJanelaRelatorio() {
  // fecha o editor que estiver com o relatório aberto na tela (melhor esforço);
  // a contagem de kills em curso serve para o open do relatório NOVO esperar
  // o fim do pkill — senão o kill mata o open recém-nascido (o padrão é o
  // mesmo caminho "relatorio-ponte")
  const terminou = () => {
    if (matancaEditor > 0) matancaEditor--;
  };
  try {
    matancaEditor++;
    if (process.platform === "win32") {
      exec(
        'powershell -NoProfile -Command "Get-Process | Where-Object { $_.MainWindowTitle -like \'*relatorio-ponte*\' } | Stop-Process -Force"',
        { timeout: 8000 },
        terminou
      );
    } else {
      // [e] no padrão evita o pkill matar o próprio shell que executa o comando
      exec('pkill -f "relatorio-pont[e]" 2>/dev/null', { timeout: 8000 }, terminou);
    }
  } catch (_) {
    terminou();
    /* sem pkill/sem GUI — segue */
  }
}

function fecharRelatorioAnterior() {
  fecharJanelaRelatorio(); // tarefa nova: relatório anterior sai da frente
  let apagados = 0;
  try {
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (!/^relatorio-ponte.*\.txt$/.test(f)) continue;
      try {
        fs.unlinkSync(path.join(DATA_DIR, f));
        apagados++;
      } catch (_) {
        /* pode estar aberto no editor — a gravação nova contorna */
      }
    }
  } catch (_) {}
  if (apagados) log("Relatório anterior: janela fechada na tela e arquivo apagado.");
}

function dois(n) {
  return String(n).padStart(2, "0");
}

function dataBr(d) {
  return (
    dois(d.getDate()) + "/" + dois(d.getMonth() + 1) + "/" + d.getFullYear() +
    " " + dois(d.getHours()) + ":" + dois(d.getMinutes()) + ":" + dois(d.getSeconds())
  );
}

function quebraTexto(s, larg) {
  const saida = [];
  for (const bruta of String(s).split("\n")) {
    const linha = bruta.trim();
    if (!linha) {
      saida.push("");
      continue;
    }
    let atual = "";
    for (const p of linha.split(/\s+/)) {
      if (!atual) atual = p;
      else if ((atual + " " + p).length <= larg) atual += " " + p;
      else {
        saida.push(atual);
        atual = p;
      }
    }
    if (atual) saida.push(atual);
  }
  return saida;
}

function rotuloAcao(a) {
  // rótulos em linguagem de gente para o resumo automático do relatório
  const rotulos = {
    run_command: "comandos no terminal",
    read_text: "leituras de arquivo (texto)",
    read_binary: "leituras de arquivo (binário)",
    file_info: "consultas de metadados de arquivo",
    list: "listagens de pasta",
    tree: "árvores de pastas",
    search: "buscas de arquivos",
    write_text: "gravações de texto",
    write_binary: "gravações de binário",
    mkdir: "criações de pasta",
    move: "movimentações de arquivo",
    rename: "renomeações",
    restore: "restaurações da lixeira",
    organize_plan: "planos de organização",
    apply_plan: "planos aplicados",
    undo_last: "operações de desfazer",
    duplicates: "buscas de duplicados",
    disk_usage: "análises de uso de disco",
    free_space: "consultas de espaço livre",
    skill_update: "atualizações da skill",
    god_mode: "mudanças de modo",
    screenshot: "capturas de tela",
    window_screenshot: "capturas de janela",
    mouse_position: "leituras da posição do mouse",
    mouse_move: "movimentações do mouse",
    mouse_click: "cliques do mouse",
    mouse_scroll: "rolagens do mouse",
    mouse_drag: "arrastos do mouse",
    keyboard_type: "digitação de texto",
    keyboard_key: "atalhos de teclado",
    window_screenshot: "capturas de janela",
  };
  return rotulos[a] || 'ações "' + a + '"';
}

function resumoAutomatico(l) {
  // sem task_done, o relatório mostra um resumo FACTUAL por tipo de operação
  const cont = {};
  for (const c of l.comandos) cont[c.action] = (cont[c.action] || 0) + 1;
  const itens = Object.keys(cont)
    .sort((x, y) => cont[y] - cont[x])
    .map((a) => "- " + cont[a] + "x " + rotuloAcao(a));
  return [
    "(A IA não fechou esta tarefa — o agente fechou sozinho. As operações",
    "desta tarefa fizeram:)",
    ...itens,
  ].join("\n");
}

function montarRelatorioTexto(l, fim, resumo, automatico) {
  const total = l.comandos.length;
  const erros = l.comandos.filter((c) => !c.ok).length;
  const msTotal = fim - l.inicio;
  const durMin = Math.floor(msTotal / 60000);
  const durSeg = Math.round((msTotal % 60000) / 1000);
  const modo = !cfg.run
    ? "arquivos apenas"
    : cfg.auto
      ? "autônomo"
      : cfg.godMode
        ? "modo deus"
        : "supervisionado";
  const barra = "=".repeat(60);

  // ---- O QUE FOI FEITO: descrição da IA em linguagem de gente (sem comandos);
  // ---- sem task_done, o agente gera um resumo factual por tipo de operação
  const feitas = [];
  if (resumo && resumo.trim()) {
    const itens = resumo
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
    itens.forEach((item, i) => {
      quebraTexto(item, 68).forEach((ln, j) => {
        feitas.push((j === 0 ? "  " + (i + 1) + ". " : "     ") + ln);
      });
    });
  } else {
    resumoAutomatico(l)
      .split("\n")
      .forEach((t) => feitas.push("  " + t));
  }

  // ---- FALHAS: só aparece se algo deu errado na tarefa ----
  const falhas = l.comandos.filter((c) => !c.ok);
  const blocoFalhas = falhas.length
    ? [
        "",
        "FALHAS (para a IA corrigir)",
        "",
        ...falhas.map(
          (c) =>
            "  #" + c.id + " " + c.action + ": " + (c.erro || "erro desconhecido")
        ),
      ]
    : [];

  return [
    barra,
    "PONTE LOCAL — RELATÓRIO DA TAREFA",
    barra,
    "Máquina : " + os.userInfo().username + "@" + os.hostname() + " (" + process.platform + ")",
    "Início  : " + dataBr(l.inicio),
    "Fim     : " + dataBr(fim),
    "Duração : " + durMin + " min " + durSeg + " s",
    "Modo    : " + modo,
    "Fechamento: " + (automatico ? "automático pelo agente (a IA não enviou task_done)" : "pela IA (task_done)"),
    "Comandos: " + total + " (" + (total - erros) + " ok, " + erros + " com erro)",
    "",
    "O QUE FOI FEITO",
    "",
    ...feitas,
    ...blocoFalhas,
    "",
    barra,
    "Proteções ativas a tarefa inteira: escopo na home, pastas sensíveis",
    "bloqueadas, exclusão só via lixeira (com desfazer) e trava",
    "anticatástrofe. Registro técnico completo: ponte-log.jsonl.",
    "Gerado pelo agente v" + VERSION + ". Quando a próxima tarefa começa,",
    "este relatório é fechado da tela e apagado.",
  ].join("\n");
}

function fecharTarefa(resumo, automatico) {
  // v1.16.0: o buffer de linha do teclado NAO pode vazar de uma tarefa para
  // a outra — o texto digitado antes pertence ao prompt antigo.
  bufferLimpa();
  if (!lote || lote.comandos.length === 0) {
    lote = null;
    return { abriuRelatorio: false, comandos: 0, motivo: "sem comandos de trabalho nesta tarefa" };
  }
  // relatório anterior na tela? mata o editor e apaga os txts — um relatório
  // por vez; o open do relatório NOVO só nasce quando o kill terminar
  const tinhaNaTela = relatorioEmTela;
  if (tinhaNaTela) {
    fecharRelatorioAnterior();
    relatorioEmTela = false;
  }
  const fim = new Date();
  const texto = montarRelatorioTexto(lote, fim, resumo, automatico);
  let destino = RELATORIO_FILE;
  try {
    escreveArquivoAtomico(destino, texto);
  } catch (_) {
    destino = path.join(DATA_DIR, "relatorio-ponte-" + Date.now() + ".txt");
    try {
      escreveArquivoAtomico(destino, texto);
    } catch (_2) {
      lote = null;
      return { abriuRelatorio: false, comandos: 0, motivo: "não consegui gravar o relatório" };
    }
  }
  const total = lote.comandos.length;
  lote = null;
  log(
    (automatico
      ? "Tarefa fechada pelo agente (a IA não enviou task_done) — relatório aberto: "
      : "Tarefa concluída pela IA — relatório aberto: ") +
      path.basename(destino) +
      " (" + total + " comando(s))"
  );
  const abrirNovo = () => {
    relatorioEmTela = true; // otimista; se o open falhar, volta para false
    abrirNoNavegador(destino, (abriu) => {
      if (!abriu) {
        relatorioEmTela = false; // nada foi aberto: o txt é a única cópia — não deixar apagar
        log("Sem app de texto disponível — o relatório está em " + destino);
      }
    });
  };
  if (tinhaNaTela) {
    // o kill emitido lá em cima está correndo: abrir antes dele terminar
    // faria o pkill/Stop-Process matar o open recém-nascido
    const quandoPuderAbrir = (t) => {
      if (t > 600) return abrirNovo(); // teto ~30 s: o pkill preso não segura o relatório
      if (matancaEditor > 0) return setTimeout(quandoPuderAbrir, 50, t + 1);
      abrirNovo();
    };
    quandoPuderAbrir(0);
  } else {
    abrirNovo();
  }
  return {
    abriuRelatorio: true,
    automatico: !!automatico,
    comandos: total,
    arquivo: path.basename(destino),
    caminho: destino,
  };
}

function garantirTarefaPara() {
  // ciclo OBRIGATÓRIO da tarefa: cria, renova (pausa longa = tarefa anterior
  // fechada com relatório) ou apenas atualiza a atividade
  const agora = Date.now();
  if (!lote) {
    // tarefa nova de verdade: o relatório anterior sai da TELA e o txt sai do
    // DISCO (o usuário pediu: agente vai fazer algo novo = relatório anterior
    // vai embora)
    if (relatorioEmTela) {
      fecharRelatorioAnterior();
      relatorioEmTela = false;
    }
    lote = { inicio: new Date(), comandos: [], ultimaAtividade: agora };
  } else if (agora - lote.ultimaAtividade >= TAREFA_GAP_MS) {
    // pausa longa = a tarefa anterior acabou SEM task_done: o agente fecha
    // sozinho (relatório é obrigatório) e a tarefa nova começa na sequência.
    // O relatório que acabou de abrir fica na tela: fecharRelatorioAnterior
    // só roda no fechamento da PRÓXIMA tarefa.
    fecharTarefa(null, true);
    lote = { inicio: new Date(), comandos: [], ultimaAtividade: agora };
  } else {
    lote.ultimaAtividade = agora;
  }
}

function fechaRelatorioVencido() {
  // (v1.10.5) vigia a pausa SEM depender de comando novo: chamado a cada
  // iteração do loop de poll (a cada ~1,5 s). Tarefa com trabalho feito e
  // parada há mais de TAREFA_GAP_MS fecha com relatório automático — era
  // exatamente o buraco que fazia o usuário ficar sem relatório: a v1.10.0
  // só fechava quando o PRÓXIMO comando chegava, e com o agente como serviço
  // (systemd, nunca encerra) uma tarefa esquecida podia não gerar relatório
  // NUNCA. Roda fora de processCommand, então nenhum comando está em voo
  // (o loop é sequencial: enquanto um comando executa, não passa aqui).
  if (!lote || !lote.comandos.length) return;
  const silencioMs = Date.now() - lote.ultimaAtividade;
  if (silencioMs < TAREFA_GAP_MS) return;
  log(
    "Tarefa parada há " + Math.round(silencioMs / 1000) + " s sem task_done da IA — fechando com relatório automático."
  );
  fecharTarefa(null, true);
}

let desligando = false;
function desligarComRelatorio(sinal) {
  // encerramento (Ctrl+C / SIGTERM): tarefa pendente gera relatório ANTES de
  // sair — o relatório é obrigatório até no último instante
  if (desligando) return;
  desligando = true;
  try {
    if (lote && lote.comandos.length) {
      fecharTarefa(null, true);
      log("Agente encerrado (" + sinal + ") com tarefa em andamento — relatório gerado antes de sair.");
    }
  } catch (_) {
    /* encerrar é o compromisso; relatório aqui é melhor esforço */
  }
  console.log("\nPonte encerrada. Até já!");
  // espera o abrir (start/xdg-open) disparar antes de sair
  setTimeout(() => process.exit(0), process.platform === "win32" ? 2500 : 1500);
}

function abrirNoNavegador(arquivo, cb) {
  const alvo = '"' + arquivo + '"';
  const lista =
    process.platform === "win32"
      ? ['start "" ' + alvo, "explorer.exe " + alvo, "notepad.exe " + alvo]
      : process.platform === "darwin"
        ? ["open " + alvo]
        : ["xdg-open " + alvo, "gio open " + alvo, "kde-open5 " + alvo, "kde-open " + alvo];
  let i = 0;
  const tentar = () => {
    if (i >= lista.length) return cb && cb(false);
    const cmd = lista[i++];
    exec(cmd, { timeout: 10000 }, (err) => (err ? tentar() : cb && cb(true)));
  };
  tentar();
}

// ---------------------------------------------------------------- loop principal
let cursor = null; // null = primeiro poll (pula histórico antigo)
let connectedOnce = false;

async function processCommand(c) {
  const t0 = Date.now();
  const fn = ACTIONS[c.action];
  let payload;
  if (!fn) {
    payload = {
      id: c.id,
      ok: false,
      error: "Ação desconhecida: " + c.action + " (fora da lista fixa permitida)",
    };
  } else {
    // spinner para ações de arquivo etc.; run_command cuida do próprio
    // (começa só depois do s/N, na hora de executar); ping/task_done mudos
    const gira =
      c.action !== "ping" && c.action !== "task_done" && c.action !== "run_command";
    if (gira) spinnerInicio(c.action);
    try {
      const data = await fn(c.args || {});
      payload = { id: c.id, ok: true, data, durationMs: Date.now() - t0 };
      if (c.action === "ping") payload.announce = data;
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      audit({ action: c.action, ok: false, erro: msg });
      payload = { id: c.id, ok: false, error: msg, durationMs: Date.now() - t0 };
    } finally {
      if (gira) {
        await spinnerGaranteMinimo();
        spinnerFim();
      }
    }
  }
  if (c.action !== "ping" && c.action !== "task_done") {
    // controle de tarefa nunca pode derrubar o comando nem o POST do
    // resultado (v1.11.0 — exceção aqui apagava o resultado do comando)
    try {
      garantirTarefaPara(); // cria a tarefa ou fecha a anterior (relatório obrigatório)
      lote.comandos.push({
        id: c.id,
        action: c.action,
        ok: !!payload.ok,
        erro: payload.ok ? null : String(payload.error || "").slice(0, 160),
        ms: Date.now() - t0,
        ts: Date.now(),
      });
      lote.ultimaAtividade = Date.now();
    } catch (e) {
      audit({ action: c.action, erro: "controle de tarefa falhou (não afeta o resultado): " + e.message });
    }
  }
  let json = JSON.stringify(payload);
  if (json.length > 10500000) {
    payload = {
      id: c.id,
      ok: payload.ok,
      error: "Resultado grande demais (" + Math.round(json.length / 1000) + " KB) — refine o comando",
    };
  }
  // o resultado TEM que chegar: 3 tentativas com backoff (v1.11.0 — rede
  // caiu não apaga o resultado nem descarta o resto do lote)
  let entregue = false;
  let ultimoErro = null;
  let recusaDefinitiva = null;
  for (let tent = 0; tent < 3 && !entregue; tent++) {
    try {
      const resPost = await apiCall("POST", "/api/ponte/result", payload);
      entregue = true;
      // recusa DEFINITIVA do relay (403/404 = comando de outra lane ou
      // desconhecido): re-entrega nunca vai resolver — segue o lote (v1.11.0)
      if (resPost && resPost.ok === false) {
        recusaDefinitiva = resPost.error || "recusado";
        log("Relay recusou o resultado do #" + c.id + " (" + recusaDefinitiva + ") — seguindo.");
      }
    } catch (e) {
      ultimoErro = e;
      if (tent < 2) await sleep(2000 * (tent + 1));
    }
  }
  if (!entregue) {
    log("Resultado do comando #" + c.id + " NÃO chegou ao relay (3 tentativas: " + ultimoErro.message + ") — o comando voltará pela fila.");
    audit({ action: c.action, ok: false, erro: "resultado não entregue: " + ultimoErro.message });
    return { entregue: false, id: c.id };
  }
  const estado = payload.ok ? "ok" : "ERRO: " + payload.error;
  log("Comando #" + c.id + " (" + c.action + ") → " + estado);
  return { entregue: true, id: c.id };
}

// o agente é um serviço: exceção imprevista registra e CONTINUA (v1.11.0)
process.on("uncaughtException", (e) => {
  try { audit({ action: "uncaughtException", erro: e && e.message }); } catch (_) {}
  log("Erro não capturado (o agente continua): " + (e && e.message));
});
process.on("unhandledRejection", (e) => {
  try { audit({ action: "unhandledRejection", erro: e && (e.message || String(e)) }); } catch (_) {}
  log("Promise rejeitada sem tratamento (o agente continua): " + ((e && e.message) || e));
});

async function main() {
  cfg = loadConfig(parseArgs(process.argv.slice(2)));
  const cli = parseArgs(process.argv.slice(2));
  if (cli.save) saveConfig(cfg);

  console.log("──────────────────────────────────────────────");
  for (const linha of montarBanner({ unicode: terminalSuportaLogo(), largura: larguraTerminal() })) {
    console.log(linha);
  }
  console.log("──────────────────────────────────────────────");
  console.log("  Ponte Local — agente v" + VERSION);
  console.log("  Servidor : " + cfg.server);
  console.log(
    "  Modo     : " +
      (!cfg.run
        ? "arquivos apenas"
        : cfg.auto
          ? "autônomo (run_command sem confirmação)"
          : cfg.godMode
            ? "modo deus (run_command sem confirmação)"
            : "supervisionado (s/N)")
  );
  console.log("  Escopo   : somente " + cfg.home);
  console.log("  Proteções: pastas sensíveis bloqueadas · exclusões vão para");
  console.log(
    "             a lixeira · " +
      (cfg.run
        ? cfg.auto || cfg.godMode
          ? "trava anticatástrofe"
          : "run_command com s/N"
        : "sem shell/execução")
  );
  console.log("──────────────────────────────────────────────");

  ativaVTWindows(); // Windows: liga o ANSI do console (no-op no Linux)

  process.on("SIGINT", () => desligarComRelatorio("Ctrl+C"));
  process.on("SIGTERM", () => desligarComRelatorio("SIGTERM"));

  fecharRelatorioAnterior();
  skillAutoUpdateLoop();          // baixa a SKILL.md agora e a cada 60 s

  let errosSeguidos = 0;
  let avisosToken = 0;
  while (true) {
    try {
      const q = cursor === null ? "/api/ponte/poll" : "/api/ponte/poll?cursor=" + cursor;
      const res = await apiCall("GET", q, null);
      if (!res.ok) throw new Error(res.error || "relay recusou o poll");
      errosSeguidos = 0;
      // processa o lote inteiro mesmo se um comando falhar; o cursor só
      // avança até o último resultado CONFIRMADO — comando cujo resultado
      // não chegou volta pela fila do relay em vez de sumir (v1.11.0)
      let primeiroSemResultado = null;
      for (const c of res.commands || []) {
        const r = await processCommand(c);
        if (r && r.entregue === false && primeiroSemResultado == null)
          primeiroSemResultado = c.id;
      }
      cursor =
        primeiroSemResultado != null
          ? Math.max(0, primeiroSemResultado - 1)
          : res.nextCursor != null
            ? res.nextCursor
            : cursor || 0;
      fechaRelatorioVencido(); // relatório obrigatório: não depende de comando novo (v1.10.5)
      if (!connectedOnce) {
        log("Conectado à ponte. Deixe esta janela aberta — é por aqui que eu trabalho.");
        connectedOnce = true;
      }
      await sleep(res.pollMs || 1500);
    } catch (e) {
      try { fechaRelatorioVencido(); } catch (_) {} // relay fora do ar também não adia o relatório
      errosSeguidos++;
      const recusa = /token/i.test(e.message || "");
      if (recusa) {
        // 401 não é rede: é config errada — aviso forte, sem martelar mudo
        if (avisosToken === 0)
          log("[x] RELAY RECUSOU O TOKEN (" + e.message + "). Corrija a config:\n    npx ponte-local --server URL_DO_RELAY --token SEU_TOKEN --save");
        else if (avisosToken % 12 === 0)
          log("Ainda recusando o token (" + avisosToken + " tentativas) — a config continua errada.");
        avisosToken++;
      } else if (connectedOnce) {
        const espera = Math.min(60, 5 * errosSeguidos);
        log("Conexão caiu (" + e.message + "). Tentando de novo em " + espera + "s...");
        connectedOnce = false;
      }
      await sleep(Math.min(60000, 5000 * errosSeguidos));
    }
  }
}

if (require.main === module) main().catch((e) => fail(e.message));
// Exporta apenas para testes automatizados (nada roda quando requerido).
module.exports = {
  main,
  loadConfig,
  saveConfig,
  parseArgs,
  DATA_DIR,
  CONFIG_FILE,
  dangerCheck,
  caminhoProtegido,
  ALVO_SISTEMA,
  ALVO_SISTEMA_WIN,
  VERSION,
  tipoPorAssinatura,
  detectarEncoding,
  decodificarPedaco,
  tela,
  log,
  spinnerInicio,
  spinnerFim,
  spinnerDesenha,
  spinnerLimpaLinha,
  spinnerGaranteMinimo,
  SPIN_MINIMO_MS,
  caixaOutput,
  quebraLargura,
  larguraTerminal,
  limpaAnsi,
  ativaVTWindows,
  fonteVTWindows,
  versaoDe,
  versaoSkillLocal,
  versaoMaisNova,
  escreveArquivoAtomico,
  atualizarSkill,
  LOGO,
  LOGO_LARGURA,
  montarBanner,
  terminalSuportaLogo,
  montarRelatorioTexto,
  rotuloAcao,
  resumoAutomatico,
  fecharTarefa,
  garantirTarefaPara,
  fechaRelatorioVencido,
  desligarComRelatorio,
  estadoTarefa: () => ({
    loteAberto: !!lote,
    comandos: lote ? lote.comandos.length : 0,
    relatorioEmTela,
    gapMs: TAREFA_GAP_MS,
    desligando,
  }),
};
