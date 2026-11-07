#!/usr/bin/env node
/*
 * Ponte Local — Agente v1.12.0 (Windows + Linux)
 * Roda no SEU computador e executa, sob comando do relay, uma lista FIXA de
 * operações de arquivo. run_command roda em shell de verdade (cmd.exe/bash -c)
 * — por isso a trava anticatástrofe bloqueia os vetores destrutivos conhecidos
 * (alvos catastróficos inclusive a home literal, encadeamento com &, $(),
 * backticks, pipes para interpretadores, xargs de destruição, aliases PS).
 * Sem rede além do próprio relay.
 *
 *   node agent.js --server https://SEU-LINK --token SEU_TOKEN --save
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
const { execFile, exec } = require("child_process");

const VERSION = "1.12.0";
const REQUEST_TIMEOUT_MS = 15000;
const SCRIPT_DIR = __dirname;
const CONFIG_FILE = path.join(SCRIPT_DIR, "ponte.config.json");
const LOG_FILE = path.join(SCRIPT_DIR, "ponte-log.jsonl");
const RELATORIO_FILE = path.join(SCRIPT_DIR, "relatorio-ponte.txt");
const SKILL_URL =
  "https://raw.githubusercontent.com/micsxnn/ponte-local/main/SKILL.md";
const SKILL_FILE = path.join(SCRIPT_DIR, "SKILL.md");
const SKILL_CHECK_MS = 60 * 1000; // no boot + a cada 60 s
const SKILL_BACKOFF_MAX_MS = 15 * 60 * 1000; // teto do backoff em falhas seguidas

let cfg = null; // preenchido no main()

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
        "  node agent.js --server https://SEU-LINK-DE-PREVIEW --token SEU_TOKEN --save\n" +
        "(link e token estão no chat)"
    );
  if (!c.token)
    fail("Falta o token. Pegue-o no chat e rode de novo com --token SEU_TOKEN --save");
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
function caminhoProtegido(rp) {
  return CAMINHOS_PROTEGIDOS.has(rp) || String(rp).startsWith(LOG_PREFIXO_PROTEGIDO);
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
        "run_command DESLIGADO. No terminal do agente: Ctrl+C e religue com node agent.js --auto --save (autônomo) ou node agent.js --allow-run --save (supervisionado)"
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
  screenshot: async () => {
    const platform = process.platform;
    let imagemBase64 = "";
    if (platform === "linux") {
      try {
        const tmpPath = path.join(SCRIPT_DIR, "tmp-screenshot.png");
        execFile("scrot", ["-q", "100", tmpPath], { timeout: 10000 }, (err) => {
          if (err) throw err;
        });
        await sleep(500);
        if (fs.existsSync(tmpPath)) {
          const buf = fs.readFileSync(tmpPath);
          fs.unlinkSync(tmpPath); // limpa arquivo temporário
          imagemBase64 = buf.toString("base64");
        }
      } catch (e) {
        throw new Error("Falha ao capturar screenshot: " + (e && e.message ? e.message : String(e)));
      }
    } else {
      throw new Error("Screenshot não suportado nesta plataforma: " + platform);
    }
    return { plataforma, dados: imagemBase64, tamanhoBytes: Buffer.byteLength(Buffer.from(imagemBase64, "base64")) };
  screenshot_window: async (args) => {
    const platform = process.platform;
    let imagemBase64 = "";
    let infoJanela = null;
    if (platform === "linux") {
      try {
        let windowId = args.window_id || null;
        if (!windowId && args.window_title) {
          const result = execSync('xdotool search --name "' + args.window_title + '" | head -1', { encoding: 'utf8' }).trim();
          windowId = result || null;
        }
        if (!windowId && args.window_class) {
          const result = execSync('xdotool search --class "' + args.window_class + '" | head -1', { encoding: 'utf8' }).trim();
          windowId = result || null;
        }
        if (!windowId) {
          const wmctrl = execSync('wmctrl -l', { encoding: 'utf8' }).split('\n');
          for (const linha of wmctrl) {
            const partes = linha.split(/\s+/);
            if (partes.length >= 2) {
              const id = partes[0];
              const titulo = (partes.slice(2).join(' ') || '');
              if (args.window_title && titulo.toLowerCase().includes(args.window_title.toLowerCase())) {
                windowId = id;
                break;
              }
            }
          }
        }
        if (windowId) {
          const tmpPath = path.join(SCRIPT_DIR, "tmp-screenshot-window.png");
          execSync('import -window ' + windowId + ' ' + tmpPath);
          if (fs.existsSync(tmpPath)) {
            const buf = fs.readFileSync(tmpPath);
            fs.unlinkSync(tmpPath);
            imagemBase64 = buf.toString("base64");
            infoJanela = { id: windowId };
            try {
              const wmctrl = execSync('wmctrl -l', { encoding: 'utf8' }).split('\n');
              for (const linha of wmctrl) {
                const partes = linha.split(/\s+/);
                if (partes[0] === windowId) {
                  infoJanela.titulo = partes.slice(2).join(' ');
                  break;
                }
              }
            } catch (_) {}
          } else {
            throw new Error("Janela não encontrada ou captura falhou");
          }
        } else {
          throw new Error("Nenhuma janela encontrada com os critérios fornecidos");
        }
      } catch (e) {
        throw new Error("Falha ao capturar janela: " + (e && e.message ? e.message : String(e)));
      }
    } else if (platform === "win32") {
      try {
        const tmpPath = path.join(SCRIPT_DIR, "tmp-screenshot-window.png");
        execSync('powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $list = [System.Windows.Forms.Screen]::AllScreens; foreach($s in $list) { if($s.Primary) { continue } }"', { timeout: 5000 });
        throw new Error("Screenshot de janela não implementado para Windows neste momento");
      } catch (e) {
        if (e.message.includes("não implementado")) throw e;
        throw new Error("Falha ao capturar janela no Windows: " + (e && e.message ? e.message : String(e)));
      }
    } else {
      throw new Error("Screenshot de janela não suportado nesta plataforma: " + platform);
    }
    return { 
      plataforma, 
      dados: imagemBase64, 
      tamanhoBytes: Buffer.byteLength(Buffer.from(imagemBase64, "base64")),
      janela: infoJanela
    };
  },
  },
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
    for (const f of fs.readdirSync(SCRIPT_DIR)) {
      if (!/^relatorio-ponte.*\.txt$/.test(f)) continue;
      try {
        fs.unlinkSync(path.join(SCRIPT_DIR, f));
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
    destino = path.join(SCRIPT_DIR, "relatorio-ponte-" + Date.now() + ".txt");
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
          log("[x] RELAY RECUSOU O TOKEN (" + e.message + "). Corrija a config:\n    node agent.js --server URL_DO_RELAY --token SEU_TOKEN --save");
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
