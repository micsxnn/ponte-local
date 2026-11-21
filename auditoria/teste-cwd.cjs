#!/usr/bin/env node
// Teste de validação de cwd em run_command (v1.20.3).
// Verifica que caminhos ABSOLUTOS são rejeitados (bug: path.resolve(home, "/etc")
// retornava "/etc", ignorando a home do usuário).
// Roda com: node auditoria/teste-cwd.cjs

const path = require("path");
const fs = require("fs");
const os = require("os");

let falhas = 0;

function ok(cond, msg) {
  if (!cond) {
    falhas++;
    console.log("FALHOU: " + msg);
  } else {
    console.log("ok: " + msg);
  }
}

// Simula a lógica de validação de cwd corrigida (código do agente v1.20.3)
function validarCwd(cwdArg, home) {
  const homeRes = path.resolve(home);
  let cwd;
  if (!cwdArg) {
    cwd = homeRes;
  } else if (path.isAbsolute(String(cwdArg))) {
    throw new Error("cwd absoluto não permitido — use um caminho relativo à sua home (ex.: \"Downloads\")");
  } else {
    cwd = path.resolve(home, String(cwdArg));
    if (cwd !== homeRes && !cwd.startsWith(homeRes + path.sep)) {
      throw new Error("cwd fora do escopo: só posso rodar dentro de " + homeRes);
    }
  }
  return cwd;
}

const HOME = "/home/usuario";

// Deve funcionar: caminhos relativos dentro da home
ok(validarCwd(null, HOME) === HOME, "cwd nulo → home");
ok(validarCwd("", HOME) === HOME, "cwd vazio → home");
ok(validarCwd("Downloads", HOME) === path.join(HOME, "Downloads"), "cwd relativo 'Downloads'");
ok(validarCwd("projeto/sub", HOME) === path.join(HOME, "projeto", "sub"), "cwd relativo aninhado");
ok(validarCwd("./Downloads", HOME) === path.join(HOME, "Downloads"), "cwd com ./");

// Deve FALHAR: caminhos absolutos (bug v1.20.2)
function tentaAbs(cwdArg) {
  try {
    validarCwd(cwdArg, HOME);
    return null;
  } catch (e) {
    return e.message;
  }
}
ok(tentaAbs("/etc") !== null, "cwd absoluto /etc rejeitado");
ok(tentaAbs("/") !== null, "cwd absoluto / rejeitado");
ok(tentaAbs("/home/usuario/../etc") !== null, "cwd absoluto com .. rejeitado");
// caminhos absolutos Windows só são detectados no Windows
if (process.platform === "win32") {
  ok(tentaAbs("C:\\Windows") !== null, "cwd absoluto Windows rejeitado");
} else {
  ok(!path.isAbsolute("C:\\Windows"), "Linux: C:\\Windows não é absoluto (OK, plataforma diferente)");
}

// Deve FALHAR: caminho relativo que escapa da home
ok(tentaAbs("../../../etc") !== null, "cwd relativo ../../../etc rejeitado");
ok(tentaAbs("../etc") !== null, "cwd relativo ../etc rejeitado");

// Windows
if (process.platform === "win32") {
  ok(tentaAbs("C:\\") !== null, "cwd C:\\ rejeitado");
  ok(tentaAbs("D:\\Windows") !== null, "cwd D:\\Windows rejeitado");
} else {
  ok(!path.isAbsolute("C:\\"), "Linux: C:\\ não é absoluto (OK)");
  ok(!path.isAbsolute("D:\\Windows"), "Linux: D:\\Windows não é absoluto (OK)");
}

// ----- verificação com pasta real -----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ponte-cwd-"));
try {
  ok(validarCwd(null, tmp) === tmp, "tmp home: cwd nulo → home real");
  ok(validarCwd("subpasta", tmp) === path.join(tmp, "subpasta"), "tmp home: cwd relativo");
  const absErro = tentaAbs("/etc/passwd");
  ok(absErro !== null, "tmp home: /etc/passwd rejeitado");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("");
if (falhas === 0) {
  console.log("PASSOU — validação de cwd íntegra");
  process.exit(0);
} else {
  console.log("RESULTADO: " + falhas + " FALHA(S)");
  process.exit(1);
}
