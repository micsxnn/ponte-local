import { NextRequest } from "next/server";
import {
  isAgentAuthorized,
  laneForAgent,
  markSeen,
  ponte,
  pushResult,
  setAgentInfo,
} from "@/lib/ponte-store";

export const dynamic = "force-dynamic";

const MAX_BODY = 12_000_000; // 12 MB (resultados podem carregar base64 p/ read_binary)

// POST /api/ponte/result  (agente, header x-ponte-token)
// Corpo: { id, ok, data?, error?, durationMs?, announce? }
// "announce" é enviado junto ao resultado do ping com as infos da máquina.
// O resultado cai na lane do token — máquina não vê resultado da outra.
//
// v1.5.0: resultado DUPLICADO é idempotente — o agente 1.11.0 tem retry de
// resultado (rede falhou depois do comando rodar), então o mesmo id pode
// chegar duas vezes. Antes o retry inflava histórico e totalResults.
// v1.5.1: dono por id (lanePorId no store) — resultado para id de OUTRA lane
// é recusado mesmo com o comando fora do histórico (janela respondidos).
export async function POST(req: NextRequest) {
  const token = req.headers.get("x-ponte-token");
  const lane = laneForAgent(token);
  if (!isAgentAuthorized(token) || !lane) {
    return Response.json(
      { ok: false, error: "Token inválido ou ausente" },
      { status: 401 }
    );
  }
  markSeen(lane);
  // Validação por CONTEÚDO (v1.4.0): o content-length é burlável com chunked
  const raw = await req.text();
  if (raw.length > MAX_BODY) {
    return Response.json({ ok: false, error: "Corpo grande demais" }, { status: 413 });
  }
  let body: {
    id?: number;
    ok?: boolean;
    data?: unknown;
    error?: string;
    durationMs?: number;
    announce?: Record<string, unknown>;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  if (typeof body.id !== "number" || !Number.isInteger(body.id) || body.id <= 0) {
    return Response.json({ ok: false, error: "Falta o id do comando" }, { status: 400 });
  }
  // Resultado só vale para comando DESTA lane (v1.4.0): antes um resultado
  // com id de comando de OUTRA máquina marcava o comando como respondido e
  // ele nunca mais era entregue à lane dona.
  const s = ponte();
  const cmd = s.commands.find((c) => c.id === body.id);
  if (cmd && cmd.lane !== lane) {
    return Response.json({ ok: false, error: "Esse comando pertence a outra lane" }, { status: 403 });
  }
  // v1.5.1: dono por id (lanePorId) — cobre o comando que JÁ SAIU do histórico:
  // antes, id na janela global `respondidos` (fora da janela de results)
  // aceitava resultado de token de qualquer lane.
  const dona = s.lanePorId.get(body.id);
  if (dona && dona !== lane) {
    return Response.json({ ok: false, error: "Esse comando pertence a outra lane" }, { status: 403 });
  }
  const jáTem = s.results.find((r) => r.id === body.id);
  if (jáTem && jáTem.lane !== lane) {
    return Response.json({ ok: false, error: "Esse resultado pertence a outra lane" }, { status: 403 });
  }
  // v1.5.1: dona === lane também libera (resultado atrasado de comando podado
  // da PRÓPRIA lane vale); id sem rastro de dono mantém o comportamento antigo.
  if (!cmd && !jáTem && dona !== lane && !s.respondidos.includes(body.id)) {
    return Response.json(
      { ok: false, error: "Comando desconhecido nesta lane — resultado recusado" },
      { status: 404 }
    );
  }
  if (jáTem) {
    // Retry do agente chegando com resultado já registrado (v1.5.0):
    // confirma recebimento sem duplicar histórico/contagem.
    if (body.announce && typeof body.announce === "object") setAgentInfo(lane, body.announce);
    return Response.json({ ok: true, duplicado: true });
  }
  pushResult({
    id: body.id,
    ok: !!body.ok,
    data: body.data,
    error: body.error,
    durationMs: body.durationMs,
    ts: Date.now(),
    lane,
  });
  if (body.announce && typeof body.announce === "object") {
    setAgentInfo(lane, body.announce);
  }
  return Response.json({ ok: true });
}
