#!/usr/bin/env node
/*
 * Ponte Local — ponto de entrada do pacote npm (`npx ponte-local`).
 *
 * Este arquivo é o que o npm/npx executa. Ele NÃO é o agente: é a
 * PORTA que resolve caminhos e prepara o primeiro boot.
 *
 * Por que existe um wrapper:
 *  - o agente.js mora no PACOTE (node_modules/ponte-local/agente/agent.js).
 *    Via npx essa pasta é um cache EFÊMERO (~/.npm/_npx/<hash>/...), que
 *    some quando o npx re-resolve o pacote. Por isso os DADOS do agente
 *    (config com o token, log de auditoria, relatório, SKILL.md baixada)
 *    vão para ~/ponte-agent (ou $PONTE_HOME) — resolvido aqui e repassado
 *    ao agente por variável de ambiente.
 *  - o primeiro boot via npx ainda é manual: este wrapper oferece um
 *    assistente de configuração (servidor + token) que grava a config.
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

// ---------------------------------------------------------------- ajuda
function mostrarAjuda() {
  const pkg = require(path.join(PKG_DIR, "package.json"));
  console.log(`
Ponte Local v${pkg.version} — sua IA opera o seu PC pelo chat.

USO
  npx ponte-local                              conecta usando a config salva
  npx ponte-local --server URL --token TOKEN    configura e conecta
  npx ponte-local --auto --save                modo autônomo (executa direto)
  npx ponte-local --allow-run --save          modo supervisionado (pede s/N)
  npx ponte-local --help                       esta ajuda
  npx ponte-local --version                    só a versão

OPÇÕES
  --server URL      relay da ponte (https://...)
  --token TOKEN     token da sua máquina (NÃO é a senha do GitHub)
  --save            grava a config em ${CONFIG_FILE}
  --auto            executa comandos direto (trava anticatástrofe ativa)
  --allow-run       supervisionado: cada comando pede s/N no terminal
  --home PATH       escopo de arquivos (padrão: sua home)

ONDE OS DADOS FICAM
  config, log, relatório, skill : ${DATA_DIR}
  (defina PONTE_HOME para mudar)

IMPORTANTE
  O token da ponte é o que a IA te deu no chat. A senha da sua conta
  GitHub/qualquer outra NÃO funciona aqui.
`);
}

// ---------------------------------------------------------------- config
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
  console.log("");
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║  PONTE LOCAL — primeira configuração                    ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log("");
  console.log("  A URL e o token da ponte estão no CHAT com a sua IA.");
  console.log("  (o token da ponte NÃO é a senha da sua conta GitHub)");
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
    console.error("    npx ponte-local --server https://SEU-RELAY --token SEU_TOKEN --save");
    process.exit(1);
  }
  if (!token) {
    console.error("\n[x] Sem o token não dá para conectar. Pegue-o no chat e rode de novo:");
    console.error("    npx ponte-local --server https://SEU-RELAY --token SEU_TOKEN --save");
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
  console.log("  ✅ Config salva em " + CONFIG_FILE);
  console.log("     Da próxima vez é só: npx ponte-local");
  console.log("");
  return novo;
}

// ---------------------------------------------------------------- main
async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    mostrarAjuda();
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(require(path.join(PKG_DIR, "package.json")).version);
    return;
  }

  if (!existeAgente()) {
    console.error("[x] O agente não foi encontrado em " + AGENT_FILE);
    console.error("    O pacote instalado está incompleto. Tente: npx ponte-local@latest");
    process.exit(1);
  }

  // os dados do agente vivem na pasta do USUÁRIO, nunca no pacote npx
  process.env.PONTE_HOME = DATA_DIR;

  const cli = parseArgs(argv);
  const cfg = lerConfig();

  // falta servidor ou token? => primeiro boot (assistido ou por flags)
  const temServer = cli.server || cfg.server || process.env.PONTE_AGENT_TOKEN;
  const temToken = cli.token || cfg.token || process.env.PONTE_AGENT_TOKEN;
  if (!temServer || !temToken) {
    if (!process.stdin.isTTY) {
      console.error("");
      console.error("[x] Falta a configuração da ponte. Rode:");
      console.error("    npx ponte-local --server https://SEU-RELAY --token SEU_TOKEN --save");
      console.error("    (a URL e o token estão no chat com a sua IA)");
      process.exit(1);
    }
    await primeiroBoot(cli);
  } else if (cli.save) {
    // --save com server/token: grava e segue
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

  // ---- inicia o agente (ele cuida do resto: banner, poll, skill, etc.) ----
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
