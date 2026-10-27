import { NextRequest } from "next/server";
import { addCommand, isAdminAuthorized, LANE_IDS, LaneId } from "@/lib/ponte-store";

const MAX_BODY = 12_000_000; // 12 MB (comandos podem carregar base64 p/ write_binary)

export const dynamic = "force-dynamic";

// POST /api/ponte/cmd  (somente admin — header x-ponte-admin)
// Corpo: { lane: "netbook"|"windows"|"test", action: string, args?: object }
// A lane diz A QUAL MÁQUINA o comando se destina — filas são independentes.
// Transição (relay 1.3.x): sem lane o comando cai em "netbook" (comportamento
// antigo, token único) e a resposta ecoa a lane usada. Depois da migração do
// Windows para o token próprio, a lane passa a ser OBRIGATÓRIA.
export async function POST(req: NextRequest) {
  const token = req.headers.get("x-ponte-admin");
  if (!isAdminAuthorized(token)) {
    return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
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
  let lane: LaneId = "netbook";
  if (body.lane != null && body.lane !== "") {
    if (!LANE_IDS.includes(body.lane as LaneId)) {
      return Response.json(
        { ok: false, error: `Lane inválida "${body.lane}" — use netbook|windows|test` },
        { status: 400 }
      );
    }
    lane = body.lane as LaneId;
  }
  try {
    const cmd = addCommand(body.action, body.args, lane);
    return Response.json({ ok: true, id: cmd.id, lane });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "Erro ao enfileirar" },
      { status: 429 }
    );
  }
}
