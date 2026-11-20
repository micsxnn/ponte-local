// Gera o manifesto da skill com hashes SHA-256 (+ assinatura opcional offline).
// Roda com: node scripts/gerar-manifesto.js [--sign chave_privada_base64]
// - Sem --sign: gera manifesto com hashes (sem assinatura).
// - Com --sign: assina o JSON (sem o campo "assinatura") e grava o campo
//   "assinatura" no manifesto.
//
// A chave publica (base64) fica fixa no agente para verificar futuras
// atualizacoes. A chave privada SO e usada AQUI, no momento de gerar o
// manifesto (offline, no repo do mantenedor).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const RAIZ = path.dirname(path.dirname(__filename));
const SKILL_DIR = path.join(RAIZ, "agente");

function sha256(caminho) {
  const conteudo = fs.readFileSync(caminho, "utf8");
  return crypto.createHash("sha256").update(conteudo).digest("hex");
}

function assinar(manifestoSemAssinatura, chavePrivadaBase64) {
  const k = Buffer.from(chavePrivadaBase64, "base64");
  const assinador = crypto.createSign("sha256");
  assinador.update(JSON.stringify(manifestoSemAssinatura, null, 2));
  assinador.end();
  return assinador.sign({ key: k, format: "der", type: "pkcs8" }).toString("base64");
}

function main() {
  const argv = process.argv.slice(2);
  let chavePrivada = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--sign" && argv[i + 1]) {
      chavePrivada = argv[i + 1];
      i++;
    }
  }

  const arquivos = [
    { origem: "SKILL.md", destino: "SKILL.md" },
    { origem: "agente/SKILL.md", destino: "SKILL-MAQUINA.md" },
    { origem: "agente/LEIA-ME.md", destino: "LEIA-ME.md" },
    { origem: "agente/agent.js", destino: "agent.js" }, // v1.20.2: o agente tambem entra no manifesto
  ];

  const versaoAtual = fs.readFileSync(path.join(RAIZ, "SKILL.md"), "utf8");
  const m = versaoAtual.match(/skill-version:\s*(\d+)\.(\d+)\.(\d+)/);
  const versao = m ? m[0].split(":")[1].trim() : "4.7.0";

  const manifest = {
    versao,
    descricao:
      "Pacote de arquivos da skill do Ponte Local. O agente usa este manifesto para manter a skill completa e atualizada na maquina do usuario (inclusive arquivos novos e recursos extras), e o comando 'npx ponte-local update' usa o mesmo manifesto para atualizar a instalacao do usuario.",
    arquivos: arquivos.map((a) => {
      const conteudo = fs.readFileSync(path.join(RAIZ, a.origem), "utf8");
      return {
        origem: a.origem,
        destino: a.destino,
        sha256: crypto.createHash("sha256").update(conteudo).digest("hex"),
        descricao:
          a.origem === "SKILL.md"
            ? "Especificacao principal da skill (a que a IA na VM leia)"
            : a.origem === "agente/SKILL.md"
            ? "Variante da skill para a IA que esta dentro da maquina do usuario"
            : a.origem === "agente/LEIA-ME.md"
            ? "Manual do agente para o usuario final"
            : "O proprio agent.js (auto-update com integridade)",
      };
    }),
  };

  if (chavePrivada) {
    const sig = assinar(manifest, chavePrivada);
    manifest.assinatura = {
      algoritmo: "Ed25519",
      chave_publica: "chave_publica_base64_aqui", // sera substituida pelo gerador
      assinatura_base64: sig,
    };
    // substituir chave_publica pela publica real derivada da privada
    const k = Buffer.from(chavePrivada, "base64");
    const pub = crypto.createPublicKey({ key: k, format: "der", type: "pkcs8" })
      .export({ format: "der", type: "spki" })
      .toString("base64");
    manifest.assinatura.chave_publica = pub;
  }

  fs.writeFileSync(
    path.join(RAIZ, "skill-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8"
  );
  console.log("skill-manifest.json gerado em " + path.join(RAIZ, "skill-manifest.json"));
  console.log("Versao: " + versao);
  if (chavePrivada) console.log("Assinado: sim (Ed25519)");
  else console.log("Assinado: nao (somente hashes)");
}

main();
