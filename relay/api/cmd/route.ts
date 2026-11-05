import { NextRequest } from "next/server";
import {
  addCommand,
  ErroPersistencia,
  isAdminAuthorized,
  laneTemToken,
  lanesComToken,
  LANE_RE,
} from "@/lib/ponte-store";

const MAX_BODY = 12_000_000; // 12 MB (comandos podem carregar base64 p/ write_binary)

export const dynamic = "force-dynamic";

// POST /api/ponte/cmd  (somente admin — header x-ponte-admin)
// Corpo: { lane: string, action: string, args?: object }
// A lane diz A QUAL MÁQUINA o comando se destina — filas são independentes.
//
// v1.5.0: lane OBRIGATÓRIA (a transição do token único acabou — sem lane
// gerava comando órfão na "netbook" por padrão implícito) e nome LIVRE:
// qualquer lane com token registrado vale (a lane nasce de PONTE_TOKEN_<NOME>).
// Enfileirar para lane SEM token é recusado — comando sem destinatário só
// envelhece 24h e morre na fila.
export async function POST(req: NextRequest) {
  const token = req.headers.get("x-ponte-admin");
  if (!isAdminAuthorized(token)) {
    return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }
  // TETO REAL do corpo (v1.4.0): a constante declarada 12 MB nunca era
  // aplicada — um POST gigante era inteiramente lido/parsedo em memória.
  const len = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (len > MAX_BODY) {
    return Response.json({ ok: false, error: "Corpo grande demais (limite 12 MB)" }, { status: 413 });
  }
  if (!len && (req.headers.get("transfer-encoding") ?? "").toLowerCase().includes("chunked")) {
    return Response.json(
      { ok: false, error: "Chunked sem content-length não é aceito (limite não verificável)" },
      { status: 411 }
    );
  }
  let body: { lane?: string; action?: string; args?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  if (!body.action || typeof body.action !== "string") {
    return Response.json({ ok: false, error: "Falta a ação" }, { status: 400 });
  }
  if (!/^[a-z_]{1,32}$/.test(body.action)) {
    return Response.json(
      { ok: false, error: "Ação inválida (a-z e _, até 32 caracteres)" },
      { status: 400 }
    );
  }
  if (!body.lane || typeof body.lane !== "string") {
    return Response.json(
      {
        ok: false,
        error: `Lane obrigatória — informe a máquina no corpo: "lane":"<nome>". Lanes com token: ${lanesComToken().join(", ") || "(nenhuma — crie PONTE_TOKEN_<NOME> no .env)"}`,
      },
      { status: 400 }
    );
  }
  if (!LANE_RE.test(body.lane)) {
    return Response.json(
      { ok: false, error: `Lane inválida "${body.lane}" — use a-z, 0-9, "-" e "_" (começando com letra ou número)` },
      { status: 400 }
    );
  }
  if (!laneTemToken(body.lane)) {
    // v1.5.1: o sufixo do env só aceita A-Z, 0-9 e _ — sugerir o nome da lane
    // em caixa alta puro (ex.: PONTE_TOKEN_MAQUINA-99) era receita inválida.
    const sufixo = body.lane.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    const hifen = body.lane.includes("-")
      ? ` Obs.: lane com "-" nunca nasce de PONTE_TOKEN_* — prefira o nome com "_".`
      : "";
    return Response.json(
      {
        ok: false,
        error: `Lane "${body.lane}" sem token — crie PONTE_TOKEN_${sufixo} no .env do relay (sufixo só com A-Z, 0-9 e _; a lane nasce com o sufixo em minúsculas, ex.: PONTE_TOKEN_MAQUINA_1 → lane maquina_1) e reinicie o relay.${hifen} Lanes atuais: ${lanesComToken().join(", ") || "(nenhuma)"}`,
      },
      { status: 400 }
    );
  }
  try {
    const cmd = addCommand(body.action, body.args, body.lane);
    return Response.json({ ok: true, id: cmd.id, lane: cmd.lane });
  } catch (e) {
    // v1.5.1: falha de persistência recusa o comando com 503 (não aceita em
    // silêncio um id que o restart perderia); demais erros seguem 429.
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Erro ao enfileirar" },
      { status: e instanceof ErroPersistencia ? 503 : 429 }
    );
  }
}
