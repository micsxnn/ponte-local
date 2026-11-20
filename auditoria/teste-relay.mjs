// Verificacao local do relay (v1.20.1): importa o ponte-store.ts (type
// stripping nativo do Node), enfileira um comando, grava um resultado e
// confere as PERMISSOES do snapshot e da pasta de dados.
// Roda com: node --experimental-strip-types auditoria/teste-relay.mjs
import fs from "fs";
import path from "path";
import os from "os";

const RAIZ = path.dirname(new URL(import.meta.url).pathname);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "ponte-relay-"));
process.env.PONTE_DATA_DIR = DATA;
process.env.PONTE_ADMIN_TOKEN = "admin-teste";
process.env.PONTE_TOKEN_MAQUINA_1 = "token-maquina-1";

const mod = await import("../relay/ponte-store.ts");

let falhas = 0;
const ok = (cond, msg) => {
  if (!cond) {
    falhas++;
    console.log("FALHOU: " + msg);
  } else {
    console.log("ok: " + msg);
  }
};

ok(mod.PONTE_VERSION === "1.5.3", "versao do relay = 1.5.3 (obtida: " + mod.PONTE_VERSION + ")");

// lane derivada do env: PONTE_TOKEN_MAQUINA_1 -> maquina_1
ok(mod.laneTemToken("maquina_1"), "lane maquina_1 nasceu do env");
ok(!mod.laneTemToken("maquina_2"), "lane inexistente nao tem token");

// autenticacao
ok(mod.isAdminAuthorized("admin-teste"), "admin token autentica");
ok(!mod.isAdminAuthorized("admin-errado"), "admin token errado e recusado");
ok(mod.isAgentAuthorized("token-maquina-1"), "token de agente autentica");
ok(!mod.isAgentAuthorized("token-errado"), "token de agente errado e recusado");

// comando na lane certa
const cmd = mod.addCommand("ping", {}, "maquina_1");
ok(!!cmd.id, "comando enfileirado (id " + cmd.id + ")");
const polled = mod.pollCommands(0, "maquina_1");
ok(polled.commands.some((c) => c.id === cmd.id), "poll da maquina_1 entrega o comando");
const polledOutra = mod.pollCommands(0, "maquina_2");
ok(!polledOutra.commands.some((c) => c.id === cmd.id), "outra lane nao ve o comando");

// resultado na lane certa
mod.pushResult({ id: cmd.id, ok: true, data: { teste: 1 }, ts: Date.now(), lane: "maquina_1" });
const res = mod.resultsSince(0, "maquina_1");
ok(res.some((r) => r.id === cmd.id), "resultado aparece na lane da maquina");
ok(!mod.resultsSince(0, "maquina_2").some((r) => r.id === cmd.id), "resultado nao vaza para outra lane");

// persistencia e permissoes (v1.20.1)
mod.saveSnapshot(mod.ponte());
const snap = path.join(DATA, ".ponte-estado.json");
const seq = path.join(DATA, ".ponte-seq");
ok(fs.existsSync(snap), "snapshot gravado");
const modoSnap = fs.statSync(snap).mode & 0o777;
ok(modoSnap === 0o600, "snapshot em 0600 (obtido: " + modoSnap.toString(8) + ")");
const modoDir = fs.statSync(DATA).mode & 0o777;
ok(modoDir === 0o700, "pasta de dados em 0700 (obtido: " + modoDir.toString(8) + ")");
if (fs.existsSync(seq)) {
  const modoSeq = fs.statSync(seq).mode & 0o777;
  ok(modoSeq === 0o600, "contador .ponte-seq em 0600 (obtido: " + modoSeq.toString(8) + ")");
}

// limpeza
fs.rmSync(DATA, { recursive: true, force: true });

console.log(falhas === 0 ? "PASSOU — relay íntegro" : "RESULTADO: " + falhas + " FALHA(S)");
process.exit(falhas === 0 ? 0 : 1);
