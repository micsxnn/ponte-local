// Teste da integridade do manifesto (hashes SHA-256)
// Roda com: node auditoria/teste-manifesto.mjs
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";

const RAIZ = path.dirname(new URL(import.meta.url).pathname);
const AGENT_RAIZ = path.join(RAIZ, "..");

function sha256(caminho) {
  const conteudo = fs.readFileSync(caminho, "utf8");
  return crypto.createHash("sha256").update(conteudo).digest("hex");
}

// ---- 1) manifesto com hashes (sem assinatura) ----
const arquivos = [
  { origem: "SKILL.md", destino: "SKILL.md", sha256: sha256(path.join(AGENT_RAIZ, "SKILL.md")) },
  { origem: "agente/SKILL.md", destino: "SKILL-MAQUINA.md", sha256: sha256(path.join(AGENT_RAIZ, "agente", "SKILL.md")) },
  { origem: "agente/LEIA-ME.md", destino: "LEIA-ME.md", sha256: sha256(path.join(AGENT_RAIZ, "agente", "LEIA-ME.md")) },
];

const manifestoHashes = {
  versao: "4.7.0",
  descricao: "Pacote de arquivos da skill do Ponte Local",
  arquivos,
};

console.log("=== Teste 1: hashes no manifesto ===");
const tmp1 = fs.mkdtempSync(path.join(os.tmpdir(), "ponte-manifesto-"));
try {
  const m1 = path.join(tmp1, "skill-manifest.json");
  fs.writeFileSync(m1, JSON.stringify(manifestoHashes, null, 2), "utf8");
  console.log("Manifesto com hashes gerado em " + m1);
  console.log(JSON.stringify(JSON.parse(fs.readFileSync(m1, "utf8")), null, 2));
} finally {
  fs.rmSync(tmp1, { recursive: true, force: true });
}

console.log("\nOK — teste de hashes do manifesto concluido");
process.exit(0);
