#!/usr/bin/env node
/*
 * Ponte Local — ponto de entrada do pacote npm (`npx ponte-local`).
 *
 * ESTE PACOTE É HÍBRIDO: o mesmo `npx` é usado em DOIS lugares diferentes,
 * por duas pessoas diferentes, com escopos OPOSTOS. Este arquivo é a
 * fronteira que separa os dois — e por isso o roteamento de subcomandos
 * é a primeira coisa que ele faz.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  MODO USUÁRIO (HOST) — o PC FÍSICO do usuário               │
 *   │  npx ponte-local start                                      │
 *   │  Sobe o agente local: liga a trava anticatástrofe, o escopo   │
 *   │  na home, a lixeira, o log, e abre a ponte de comunicação.   │
 *   │  É o ÚNICO lado que executa coisa no computador.             │
 *   └──────────────────────────────────────────────────────────────┘
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  ATUALIZAÇÃO — em qualquer lado                              │
 *   │  npx ponte-local update                                     │
 *   │  Baixa o agente novo e o PACOTE INTEIRO da skill (via o      │
 *   │  manifesto do repo) e aplica em ~/ponte-agent. Vale para     │
 *   │  arquivos NOVOS que a skill traga, não só para os mesmos.    │
 *   └──────────────────────────────────────────────────────────────┘
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  MODO AGENTE (REMOTO) — a VM / o servidor da IA             │
 *   │  npx ponte-local skill        → a especificação da skill    │
 *   │  npx ponte-local acoes [nome] → o manual das ações          │
 *   │  SÓ LEITURA. Não sobe agente, não abre socket, não executa  │
 *   │  nada, não grava config. Roda na VM, não no PC do usuário.  │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Por que existe um wrapper:
 *  - o agente.js mora no PACOTE (node_modules/ponte-local/agente/agent.js).
 *    Via npx essa pasta é um cache EFÊMERO (~/.npm/_npx/<hash>/...), que
 *    some quando o npx re-resolve o pacote. Por isso os DADOS do agente
 *    (config com o token, log de auditoria, relatório, SKILL.md baixada)
 *    vão para ~/ponte-agent (ou $PONTE_HOME) — resolvido aqui e repassado
 *    ao agente por variável de ambiente.
 *  - todo caminho de recurso do PACOTE é resolvido por __dirname — o
 *    comando funciona de qualquer diretório, inclusive de um temporário.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");

// ---- caminhos ABSOLUTOS baseados no pacote (nunca no CWD) --------------
const PKG_DIR = path.resolve(__dirname, ".."); // raiz do pacote instalado
const AGENT_FILE = path.join(PKG_DIR, "agente", "agent.js");
const SKILL_FILE = path.join(PKG_DIR, "SKILL.md"); // skill principal (raiz)
const SKILL_AGENTE_FILE = path.join(PKG_DIR, "agente", "SKILL.md"); // variante "dentro da máquina"

// ---- pasta de DADOS do usuário (persistente, fora do pacote) -----------
function resolverDataDir() {
  const env = process.env.PONTE_HOME;
  if (env) return path.resolve(String(env));
  return path.join(os.homedir(), "ponte-agent");
}
const DATA_DIR = resolverDataDir();
const CONFIG_FILE = path.join(DATA_DIR, "ponte.config.json");

function existeAgente() {
  try {
    return fs.statSync(AGENT_FILE).isFile();
  } catch (_) {
    return false;
  }
}

function pkg() {
  return require(path.join(PKG_DIR, "package.json"));
}

// ==================================================================
//  SELO DE ESCOPO — toda saída diz de que lado você está
// ==================================================================
const SELO_USUARIO = (cor) => `
╔═══════════════════════════════════════════════════════╗
║  MODO USUÁRIO (HOST) — o seu PC físico               ║
╚═══════════════════════════════════════════════════════╝
  Este comando SOBE O AGENTE no seu computador.
  A trava anticatástrofe, o escopo na sua home, a lixeira
  e o log de auditoria ficam ATIVOS daqui pra frente.
  O agente conversa com a sua IA pelo relay.
`;

const SELO_UPDATE = () => `
╔═══════════════════════════════════════════════════════╗
║  MODO ATUALIZAÇÃO — o seu PC físico                  ║
╚═══════════════════════════════════════════════════════╝
  Este comando baixa a versão nova do agente e o PACOTE
  INTEIRO da skill (inclusive arquivos novos) e aplica
  em ~/ponte-agent. Ele NÃO sobe o agente — só atualiza.
`;

const SELO_AGENTE = (cor) => `
╔═══════════════════════════════════════════════════════╗
║  MODO AGENTE (REMOTO) — VM / servidor da IA          ║
╚═══════════════════════════════════════════════════════╝
  Este comando é SÓ LEITURA: imprime a especificação da
  skill e o manual das ações. Ele NÃO sobe agente, NÃO
  abre socket, NÃO executa nada e NÃO grava config.
  Para o AGENTE subir no PC do usuário, o comando é outro:
      npx ponte-local start
`;

// ==================================================================
//  MODO AGENTE — a spec e o manual das ações
// ==================================================================

// extrai uma seção (## ou ###) da SKILL.md pelo título
function secoes(md) {
  const linhas = md.split("\n");
  const achadas = [];
  let atual = null;
  for (const linha of linhas) {
    const m = linha.match(/^(#{2,3})\s+(.*)$/);
    if (m) {
      if (atual) achadas.push(atual);
      atual = { nivel: m[1].length, titulo: m[2].trim(), linhas: [linha] };
    } else if (atual) {
      atual.linhas.push(linha);
    }
  }
  if (atual) achadas.push(atual);
  return achadas;
}

// aliases curtos → padrões que casam com o título da seção
const ALIASES_SECAO = {
  leis: "LEIS",
  "5-leis": "LEIS",
  ponte: "A ponte em 60 segundos",
  visao: "A ponte em 60 segundos",
  overview: "A ponte em 60 segundos",
  preparar: "Preparar do zero",
  do_zero: "Preparar do zero",
  instalacao: "Passo 4",
  instalar: "Passo 4",
  passo4: "Passo 4",
  relay: "Passo 2",
  url: "Passo 3",
  validar: "Passo 5",
  operacao: "Operar",
  operar: "Operar",
  acoes: "4.2 As ações",
  "4-2": "4.2 As ações",
  tabela: "4.2 As ações",
  arquivos: "Ler qualquer arquivo",
  leitura: "Ler qualquer arquivo",
  "4-3": "Ler qualquer arquivo",
  run: "run_command",
  comando: "run_command",
  "4-4": "4.4",
  sudo: "Sudo sem expor senha",
  referencia: "Referência rápida",
  limites: "Referência rápida",
  manutencao: "Manutenção",
  release: "Publicar uma nova versão",
  troubleshooting: "Troubleshooting",
  problemas: "Troubleshooting",
  seguranca: "Segurança e privacidade",
  privacidade: "Segurança e privacidade",
  "apendice-a": "Apêndice A",
  apendicea: "Apêndice A",
  "apendice-b": "Apêndice B",
  apendiceb: "Apêndice B",
  terminal: "O que o usuário vê no terminal",
};

function acharSecao(nome) {
  let md;
  try {
    md = fs.readFileSync(SKILL_FILE, "utf8");
  } catch (_) {
    return null;
  }
  const alvo = (ALIASES_SECAO[nome] || nome).toLowerCase();
  const lista = secoes(md);
  // casa exata primeiro
  let achada = lista.find((s) => s.titulo.toLowerCase() === alvo);
  // depois, por conter
  if (!achada) achada = lista.find((s) => s.titulo.toLowerCase().includes(alvo));
  if (!achada) return null;
  // se a seção achada tem subseções (###), pega até a próxima do mesmo nível
  const idx = lista.indexOf(achada);
  const bloco = [achada];
  for (let i = idx + 1; i < lista.length; i++) {
    if (lista[i].nivel <= achada.nivel) break;
    bloco.push(lista[i]);
  }
  return bloco.map((s) => s.linhas.join("\n")).join("\n");
}

// a tabela de ações da SKILL.md → lista estruturada
function tabelaAcoes() {
  let md;
  try {
    md = fs.readFileSync(SKILL_FILE, "utf8");
  } catch (_) {
    return [];
  }
  const acoes = [];
  for (const linha of md.split("\n")) {
    const m = linha.match(/^\|\s*`([a-z_]+)`\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/);
    if (!m) continue;
    const nome = m[1];
    if (["acao", "args"].includes(nome.toLowerCase())) continue;
    acoes.push({ acao: nome, args: m[2].replace(/`/g, ""), descricao: m[3] });
  }
  return acoes;
}

function imprimirAcoes(filtro, comoJson) {
  const acoes = tabelaAcoes();
  if (!acoes.length) {
    console.error("[x] Não consegui ler a tabela de ações da SKILL.md do pacote.");
    process.exit(1);
  }
  let lista = acoes;
  if (filtro) {
    const alvo = filtro.toLowerCase();
    lista = acoes.filter((a) => a.acao === alvo || a.acao.includes(alvo));
    if (!lista.length) {
      console.error('[x] Ação não encontrada: "' + filtro + '"');
      console.error("    existentas: " + acoes.map((a) => a.acao).join(", "));
      process.exit(1);
    }
  }
  if (comoJson) {
    console.log(JSON.stringify({ total: lista.length, acoes: lista }, null, 2));
    return;
  }
  console.log(SELO_AGENTE());
  if (filtro) {
    console.log("── AÇÃO: " + filtro + " ──\n");
    for (const a of lista) {
      console.log("acao      : " + a.acao);
      console.log("args      : " + a.args);
      console.log("o que faz : " + a.descricao);
      console.log("");
    }
    return;
  }
  console.log("── MANUAL DAS AÇÕES (" + lista.length + ") ──\n");
  const grupos = [
    ["Explorar", ["ping", "list", "tree", "search", "free_space", "disk_usage", "file_info"]],
    ["Arquivos", ["read_text", "write_text", "mkdir", "move", "rename", "delete", "restore", "undo_last"]],
    ["Organizar", ["organize_plan", "apply_plan", "duplicates"]],
    ["Binários", ["read_binary", "write_binary"]],
    ["Tela", ["screenshot", "screenshot_window"]],
    ["Mouse", ["mouse_position", "mouse_move", "mouse_click", "mouse_scroll", "mouse_drag"]],
    ["Teclado", ["keyboard_type", "keyboard_key"]],
    ["Comando", ["run_command"]],
    ["Controle", ["god_mode", "skill_update", "task_done"]],
  ];
  const nomes = new Set(lista.map((a) => a.acao));
  for (const [grupo, membros] of grupos) {
    const dentro = membros.filter((n) => nomes.has(n));
    if (!dentro.length) continue;
    console.log("▸ " + grupo + ": " + dentro.join(" · "));
  }
  const fora = lista.map((a) => a.acao).filter((n) => !grupos.some(([, m]) => m.includes(n)));
  if (fora.length) console.log("▸ Outros: " + fora.join(" · "));
  console.log("");
  console.log("Detalhe de uma ação:   npx ponte-local acoes <nome>");
  console.log("Tudo em JSON:          npx ponte-local acoes --json");
  console.log("");
}

function imprimirSkill(argumento, comoJson, forcarLista) {
  const secoesDisponiveis = [];
  try {
    const md = fs.readFileSync(SKILL_FILE, "utf8");
    for (const s of secoes(md)) {
      if (s.nivel === 2) secoesDisponiveis.push(s.titulo);
    }
  } catch (_) {
    console.error("[x] SKILL.md não encontrado no pacote: " + SKILL_FILE);
    process.exit(1);
  }

  if (forcarLista || argumento === "--lista" || argumento === "--list" || argumento === "lista") {
    console.log(SELO_AGENTE());
    console.log("── SEÇÕES DA SKILL ──\n");
    for (const s of secoesDisponiveis) console.log("  " + s);
    console.log("");
    console.log("Uma seção:  npx ponte-local skill <secao>");
    console.log("Índice completo da skill: https://github.com/micsxnn/ponte-local/blob/main/SKILL.md");
    console.log("");
    return;
  }

  if (argumento) {
    const bloco = acharSecao(argumento);
    if (!bloco) {
      console.error('[x] Seção não encontrada: "' + argumento + '"');
      console.error("    Use: npx ponte-local skill --lista");
      process.exit(1);
    }
    console.log(SELO_AGENTE());
    console.log(bloco);
    console.log("");
    return;
  }

  // sem argumento → a skill inteira
  let md;
  try {
    md = fs.readFileSync(SKILL_FILE, "utf8");
  } catch (_) {
    console.error("[x] SKILL.md não encontrado no pacote: " + SKILL_FILE);
    process.exit(1);
  }
  if (comoJson) {
    console.log(JSON.stringify({ skill: md, secoes: secoesDisponiveis }, null, 2));
    return;
  }
  console.log(SELO_AGENTE());
  console.log(md);
  console.log("");
}

// ==================================================================
//  MODO USUÁRIO (HOST) — sobe o agente no PC físico
// ==================================================================
function lerConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (_) {
    return {};
  }
}

function gravarConfig(c) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  } catch (_) {}
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2), { encoding: "utf8", mode: 0o600 });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const chave = a.slice(2);
      const proximo = argv[i + 1];
      if (!proximo || proximo.startsWith("--")) out[chave] = true;
      else {
        out[chave] = proximo;
        i++;
      }
    }
  }
  return out;
}

function perguntar(rl, pergunta) {
  return new Promise((resolve) => rl.question(pergunta, (r) => resolve(String(r || "").trim())));
}

// assistente de primeiro boot: pergunta servidor + token e grava a config
async function primeiroBoot(cli) {
  console.log(SELO_USUARIO());
  console.log("  Primeira configuração — a URL e o token da ponte estão");
  console.log("  no CHAT com a sua IA. (o token da ponte NÃO é a senha");
  console.log("  da sua conta GitHub)");
  console.log("");

  const cfg = lerConfig();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let server = cli.server || cfg.server || "";
  if (!server) server = await perguntar(rl, "  URL do relay (https://...): ");
  let token = cli.token || cfg.token || process.env.PONTE_AGENT_TOKEN || "";
  if (!token) token = await perguntar(rl, "  Token da sua máquina: ");

  let modo = cli.auto ? "autonomous" : cli["allow-run"] ? "supervised" : "";
  if (!modo && cfg.run) modo = cfg.auto ? "autonomous" : "supervised";

  rl.close();

  if (!server) {
    console.error("\n[x] Sem a URL do relay não dá para conectar. Rode de novo com:");
    console.error("    npx ponte-local start --server https://SEU-RELAY --token SEU_TOKEN --save");
    process.exit(1);
  }
  if (!token) {
    console.error("\n[x] Sem o token não dá para conectar. Pegue-o no chat e rode de novo:");
    console.error("    npx ponte-local start --server https://SEU-RELAY --token SEU_TOKEN --save");
    process.exit(1);
  }

  const novo = {
    server: String(server).replace(/\/+$/, ""),
    token: String(token),
    home: cfg.home || os.homedir(),
    run: modo === "autonomous" || modo === "supervised",
    auto: modo === "autonomous",
    godMode: !!cfg.godMode,
    godModeDeclined: !!cfg.godModeDeclined,
  };
  gravarConfig(novo);
  console.log("");
  console.log("  Config salva em " + CONFIG_FILE);
  console.log("     Da próxima vez é só: npx ponte-local start");
  console.log("");
  return novo;
}

// ==================================================================
//  AJUDA
// ==================================================================
function mostrarAjuda() {
  const p = pkg();
  console.log(`
Ponte Local v${p.version} — sua IA opera o seu PC pelo chat.

ESTE PACOTE É HÍBRIDO: são DOIS comandos para DOIS lados diferentes.
Leia qual é o seu antes de rodar.

┌──────────────────────────────────────────────────────────────┐
│ MODO USUÁRIO (HOST) — roda no SEU PC físico                  │
│                                                              │
│   npx ponte-local start                                      │
│       Sobe o agente local. Trava anticatástrofe, escopo na   │
│       sua home, lixeira e log ATIVOS. Abre a ponte com a IA.│
│                                                              │
│   npx ponte-local start --server URL --token TOKEN --save   │
│       Primeira vez: configura e conecta.                    │
│   npx ponte-local start --auto --save                       │
│       Modo autônomo (executa direto, trava ativa).         │
│   npx ponte-local start --allow-run --save                  │
│       Modo supervisionado (cada comando pede s/N).          │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ MODO AGENTE (REMOTO) — roda na VM / servidor da IA          │
│                                                              │
│   npx ponte-local skill                                     │
│       A especificação completa da skill (como operar).      │
│   npx ponte-local skill <secao>                             │
│       Uma seção só (ex.: skill operacao, skill install).    │
│   npx ponte-local skill --lista                             │
│       Índice das seções disponíveis.                        │
│   npx ponte-local acoes                                     │
│       Manual das ações (mouse, tela, arquivo, comando...).  │
│   npx ponte-local acoes mouse_click                         │
│       Detalhe de UMA ação.                                  │
│   npx ponte-local acoes --json                              │
│       Todas as ações em JSON (fácil de parsear).            │
│                                                              │
│   Só leitura: NÃO sobe agente, NÃO abre socket, NÃO        │
│   executa nada, NÃO grava config.                           │
└──────────────────────────────────────────────────────────────┘

OPÇÕES DO MODO USUÁRIO (start)
  --server URL      relay da ponte (https://...)
  --token TOKEN     token da sua máquina (NÃO é a senha do GitHub)
  --save            grava a config em ${CONFIG_FILE}
  --auto            executa comandos direto (trava anticatástrofe ativa)
  --allow-run       supervisionado: cada comando pede s/N no terminal
  --home PATH       escopo de arquivos (padrão: sua home)

OUTROS
  npx ponte-local update     atualiza o agente E a skill completa (inclusive
                             arquivos novos da skill) na sua máquina
  npx ponte-local help       esta ajuda
  npx ponte-local version    só a versão

ONDE OS DADOS DO AGENTE FICAM (só no modo start)
  config, log, relatório, skill : ${DATA_DIR}
  (defina PONTE_HOME para mudar)
`);
}

// ---------------------------------------------------------------- update
// Atualização completa do lado do USUÁRIO: baixa o pacote novo da skill
// (via manifesto) e o agent.js novo, e aplica na pasta de dados
// (~/ponte-agent). Funciona mesmo sem npm — é o caminho para quem
// instalou o agente na mão.
//
// Fonte: o repo no GitHub (raw.githubusercontent). O relay também serve o
// agent.js em /api/ponte/download, mas o manifesto vem do repo — por isso
// a base do repo é a referência dos dois.

const REPO_BASE = "https://raw.githubusercontent.com/micsxnn/ponte-local/main/";

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? require("https") : require("http");
    const u = new URL(url);
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: "GET",
        timeout: 20000,
        headers: { "user-agent": "ponte-local/" + pkg().version },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(httpsGet(new URL(res.headers.location, url).toString()));
        }
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > 8 * 1024 * 1024) {
            req.destroy();
            reject(new Error("resposta grande demais"));
          } else chunks.push(c);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            texto: Buffer.concat(chunks).toString("utf8"),
          })
        );
      }
    );
    req.on("timeout", () => req.destroy(new Error("tempo esgotado")));
    req.on("error", reject);
    req.end();
  });
}

function atomicWrite(arquivo, conteudo) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = arquivo + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, conteudo);
  try {
    fs.renameSync(tmp, arquivo);
  } catch (_) {
    fs.writeFileSync(arquivo, conteudo);
    try {
      fs.unlinkSync(tmp);
    } catch (_) {}
  }
}

function manifestoInstalado() {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "skill-manifest.json"), "utf8"));
    if (m && Array.isArray(m.arquivos)) return m;
  } catch (_) {}
  return null;
}

async function cmdUpdate(args) {
  console.log(SELO_UPDATE());
  console.log("  Atualizando o agente e a skill...");
  console.log("");

  const resultado = {
    atualizou: false,
    skill: { de: null, para: null, arquivos: [], removidos: [] },
    agente: { de: null, para: null, atualizou: false },
    erro: null,
  };

  try {
    // ---- 1) manifesto ----
    const mResp = await httpsGet(REPO_BASE + "skill-manifest.json");
    if (mResp.status !== 200) throw new Error("HTTP " + mResp.status + " ao baixar o manifesto");
    const manifesto = JSON.parse(mResp.texto);
    if (!manifesto || !Array.isArray(manifesto.arquivos) || !manifesto.versao)
      throw new Error("manifesto da skill invalido");

    const instalado = manifestoInstalado();
    resultado.skill.de = instalado && instalado.versao ? String(instalado.versao) : "nenhuma";
    resultado.skill.para = String(manifesto.versao);

    // ---- 2) agent.js (o binario que roda) ----
    const agenteDestino = path.join(DATA_DIR, "agent.js");
    let versaoAgenteLocal = null;
    try {
      const atual = fs.readFileSync(agenteDestino, "utf8");
      const m = atual.match(/const VERSION = "([\d.]+)"/);
      if (m) versaoAgenteLocal = m[1];
    } catch (_) {}
    resultado.agente.de = versaoAgenteLocal || "nenhuma";
    const aResp = await httpsGet(REPO_BASE + "agente/agent.js");
    if (aResp.status !== 200) throw new Error("HTTP " + aResp.status + " ao baixar o agent.js");
    const mAg = aResp.texto.match(/const VERSION = "([\d.]+)"/);
    resultado.agente.para = mAg ? mAg[1] : null;

    const versaoSkillLocal = instalado && instalado.versao ? String(instalado.versao) : null;
    const skillNova = versaoSkillLocal !== String(manifesto.versao);
    const agenteNovo = resultado.agente.para && resultado.agente.para !== versaoAgenteLocal;

    if (!skillNova && !agenteNovo) {
      console.log("  Tudo atualizado (skill v" + resultado.skill.para + ", agente v" + (resultado.agente.para || "?") + ").");
      return resultado;
    }

    // ---- 3) baixa os arquivos da skill para uma pasta temporaria ----
    const stage = path.join(DATA_DIR, ".update-stage-" + process.pid);
    const baixados = [];
    try {
      fs.mkdirSync(stage, { recursive: true });
      for (const item of manifesto.arquivos) {
        const origem = String(item && item.origem ? item.origem : "");
        const destino = String(item && item.destino ? item.destino : "");
        if (!origem || !destino) continue;
        const destinoAbs = path.resolve(DATA_DIR, destino);
        if (!destinoAbs.startsWith(path.resolve(DATA_DIR) + path.sep))
          throw new Error("destino invalido no manifesto: " + destino);
        const r = await httpsGet(REPO_BASE + origem);
        if (r.status !== 200) throw new Error("HTTP " + r.status + " ao baixar " + origem);
        const tmp = path.join(stage, destino);
        fs.mkdirSync(path.dirname(tmp), { recursive: true });
        fs.writeFileSync(tmp, r.texto, "utf8");
        baixados.push({ destino: destino, conteudo: r.texto });
      }
    } catch (e) {
      try {
        fs.rmSync(stage, { recursive: true, force: true });
      } catch (_) {}
      throw e;
    }

    // ---- 4) aplica a skill ----
    for (const b of baixados) {
      const destinoAbs = path.resolve(DATA_DIR, b.destino);
      atomicWrite(destinoAbs, b.conteudo);
      resultado.skill.arquivos.push(b.destino);
    }
    // remove o que o manifesto novo nao lista mais
    if (instalado) {
      const novos = new Set(manifesto.arquivos.map((i) => String(i.destino)));
      for (const item of instalado.arquivos) {
        const d = String(item && item.destino ? item.destino : "");
        if (!d || novos.has(d)) continue;
        try {
          const abs = path.resolve(DATA_DIR, d);
          if (abs.startsWith(path.resolve(DATA_DIR) + path.sep) && fs.existsSync(abs)) {
            fs.unlinkSync(abs);
            resultado.skill.removidos.push(d);
          }
        } catch (_) {}
      }
    }
    atomicWrite(
      path.join(DATA_DIR, "skill-manifest.json"),
      JSON.stringify(
        { versao: String(manifesto.versao), atualizadoEm: new Date().toISOString(), arquivos: manifesto.arquivos },
        null,
        2
      )
    );

    // ---- 5) aplica o agent.js (por ultimo: e o programa que roda) ----
    if (agenteNovo) {
      atomicWrite(agenteDestino, aResp.texto);
      try {
        fs.chmodSync(agenteDestino, 0o755);
      } catch (_) {}
      resultado.agente.atualizou = true;
    }

    try {
      fs.rmSync(stage, { recursive: true, force: true });
    } catch (_) {}
    resultado.atualizou = true;
  } catch (e) {
    resultado.erro = e.message;
  }

  // ---- aviso SIMPLES para o usuario ----
  console.log("");
  if (resultado.erro) {
    console.log("  [x] Nao deu para atualizar: " + resultado.erro);
    console.log("");
    console.log("  O que fazer: check a internet e rode de novo. Se continuar assim,");
    console.log("  baixe manualmente em github.com/micsxnn/ponte-local/releases");
    console.log("");
    return resultado;
  }
  if (resultado.atualizou) {
    // ---- AVISO SIMPLES PARA O USUÁRIO ----
    console.log("  ┌──────────────────────────────────────────────┐");
    console.log("  │  Atualizacao concluida                       │");
    console.log("  └──────────────────────────────────────────────┘");
    console.log("");
    console.log(
      "  Skill: v" + resultado.skill.de + " -> v" + resultado.skill.para +
      "  (" + resultado.skill.arquivos.length + " arquivo(s))"
    );
    const novos = resultado.skill.arquivos.filter((a) => a !== "SKILL.md");
    if (novos.length) {
      console.log("    arquivos novos da skill:");
      for (const a of novos) console.log("      + " + a);
    }
    if (resultado.skill.removidos.length) {
      console.log("    arquivos que sairam da skill:");
      for (const rm of resultado.skill.removidos) console.log("      - " + rm);
    }
    if (resultado.agente.atualizou) {
      console.log("");
      console.log("  Agente: v" + resultado.agente.de + " -> v" + resultado.agente.para);
    }
    console.log("");
    console.log("  Se o agente estava rodando, reinicie para ele usar a versao nova.");
  }
  console.log("");
  return resultado;
}

// ==================================================================
//  MAIN — o roteador
// ==================================================================
async function main() {
  const argv = process.argv.slice(2);
  const primeiro = argv[0];

  // --- atalhos globais -------------------------------------------------
  if (primeiro === "help" || primeiro === "--help" || primeiro === "-h") {
    mostrarAjuda();
    return;
  }
  if (primeiro === "version" || primeiro === "--version" || primeiro === "-v") {
    console.log(pkg().version);
    return;
  }

  // --- MODO AGENTE (remoto): só leitura -------------------------------
  if (primeiro === "skill" || primeiro === "--agent") {
    const rest = argv.slice(1);
    const comoJson = rest.includes("--json");
    const querLista = rest.includes("--lista") || rest.includes("--list") || rest.includes("lista");
    const alvo = querLista ? null : rest.find((a) => !a.startsWith("--"));
    imprimirSkill(alvo || null, comoJson, querLista);
    return;
  }
  if (primeiro === "acoes" || primeiro === "--actions") {
    const rest = argv.slice(1);
    const comoJson = rest.includes("--json");
    const alvo = rest.find((a) => !a.startsWith("--"));
    imprimirAcoes(alvo || null, comoJson);
    return;
  }

  // --- ATUALIZAÇÃO (lado do usuário) -----------------------------------
  if (primeiro === "update" || primeiro === "--update" || primeiro === "atualizar") {
    await cmdUpdate(argv.slice(1));
    return;
  }

  // --- MODO USUÁRIO (host): sobe o agente ------------------------------
  // sem subcomando = start (compatibilidade com quem já usa `npx ponte-local`)
  const ehStart = primeiro === "start" || primeiro === "--host" || primeiro === undefined;
  if (!ehStart) {
    console.error('[x] Subcomando desconhecido: "' + primeiro + '"');
    console.error("");
    console.error("    Este pacote é híbrido — são dois comandos:");
    console.error("      npx ponte-local start   → no SEU PC (sobe o agente)");
    console.error("      npx ponte-local skill   → na VM da IA (só a spec)");
    console.error("");
    console.error("    Use `npx ponte-local help` para a lista completa.");
    process.exit(1);
  }

  const args = ehStart && primeiro !== undefined ? argv.slice(1) : argv;

  if (!existeAgente()) {
    console.error("[x] O agente não foi encontrado em " + AGENT_FILE);
    console.error("    O pacote instalado está incompleto. Tente: npx ponte-local@latest");
    process.exit(1);
  }

  // os dados do agente vivem na pasta do USUÁRIO, nunca no pacote npx
  process.env.PONTE_HOME = DATA_DIR;

  const cli = parseArgs(args);
  const cfg = lerConfig();

  console.log(SELO_USUARIO());

  const temServer = cli.server || cfg.server || process.env.PONTE_AGENT_TOKEN;
  const temToken = cli.token || cfg.token || process.env.PONTE_AGENT_TOKEN;
  if (!temServer || !temToken) {
    if (!process.stdin.isTTY) {
      console.error("[x] Falta a configuração da ponte. Rode:");
      console.error("    npx ponte-local start --server https://SEU-RELAY --token SEU_TOKEN --save");
      console.error("    (a URL e o token estão no chat com a sua IA)");
      process.exit(1);
    }
    await primeiroBoot(cli);
  } else if (cli.save) {
    gravarConfig({
      server: String(cli.server || cfg.server).replace(/\/+$/, ""),
      token: String(cli.token || cfg.token || process.env.PONTE_AGENT_TOKEN),
      home: cli.home || cfg.home || os.homedir(),
      run: !!(cli.auto || cli["allow-run"] || cfg.run),
      auto: !!(cli.auto || cfg.auto),
      godMode: !!cfg.godMode,
      godModeDeclined: !!cfg.godModeDeclined,
    });
  }

  // ---- inicia o agente (trava anticatástrofe, escopo, lixeira, log) ----
  const agente = require(AGENT_FILE);
  if (typeof agente.main !== "function") {
    console.error("[x] O agent.js não exporta main() — pacote inconsistente.");
    process.exit(1);
  }
  await agente.main();
}

main().catch((e) => {
  console.error("\n[x] " + (e && e.message ? e.message : String(e)) + "\n");
  process.exit(1);
});
