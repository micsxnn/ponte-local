#!/usr/bin/env node
/*
 * Gera o skill-manifest.json — a fonte da verdade do PACOTE da skill.
 *
 * O manifesto lista tudo o que precisa estar na máquina do usuário:
 * a spec principal, a variante "dentro da máquina", o manual do usuário e
 * qualquer recurso novo que estiver na pasta skill/. Como a pasta skill/
 * é varrida inteira, um arquivo NOVO entra no manifesto sem precisar
 * editar nada aqui.
 *
 *   node scripts/gerar-manifesto.js [versao-da-skill]
 *
 * Sem argumento, usa o marcador `skill-version:` do SKILL.md.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");
const SKILL_DIR = "skill";

function versaoDoSkillMd() {
  try {
    const m = fs.readFileSync(path.join(RAIZ, "SKILL.md"), "utf8").match(/skill-version:\s*([\d.]+)/);
    if (m) return m[1];
  } catch (_) {}
  return "0.0.0";
}

// varre skill/ recursivamente: tudo que for texto/codigo entra
function recursosSkill(dir, prefixo, out) {
  let entradas;
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const e of entradas) {
    if (e.name.startsWith(".")) continue;
    const rel = prefixo + e.name;
    if (e.isDirectory()) {
      recursosSkill(path.join(dir, e.name), rel + "/", out);
    } else if (/\.(md|txt|json|js|cjs|sh|bat|py|ts|tsx)$/.test(e.name)) {
      out.push({
        origem: SKILL_DIR + "/" + rel,
        destino: SKILL_DIR + "/" + rel,
        descricao: "Recurso da skill",
      });
    }
  }
  return out;
}

function main() {
  const versao = process.argv[2] || versaoDoSkillMd();
  const arquivos = [
    {
      origem: "SKILL.md",
      destino: "SKILL.md",
      descricao: "Especificacao principal da skill (a que a IA na VM leia)",
    },
    {
      origem: "agente/SKILL.md",
      destino: "SKILL-MAQUINA.md",
      descricao: "Variante da skill para a IA que esta dentro da maquina do usuario",
    },
    {
      origem: "agente/LEIA-ME.md",
      destino: "LEIA-ME.md",
      descricao: "Manual do agente para o usuario final",
    },
  ];
  recursosSkill(path.join(RAIZ, SKILL_DIR), "", arquivos);

  const manifesto = {
    versao: String(versao),
    descricao:
      "Pacote de arquivos da skill do Ponte Local. O agente usa este manifesto " +
      "para manter a skill completa e atualizada na maquina do usuario " +
      "(inclusive arquivos novos e recursos extras), e o comando " +
      "'npx ponte-local update' usa o mesmo manifesto para atualizar a " +
      "instalacao do usuario.",
    arquivos: arquivos,
  };

  const destino = path.join(RAIZ, "skill-manifest.json");
  fs.writeFileSync(destino, JSON.stringify(manifesto, null, 2) + "\n");
  console.log(
    "manifesto da skill gerado: " +
      arquivos.length +
      " arquivo(s), versao " +
      manifesto.versao
  );
}

main();
