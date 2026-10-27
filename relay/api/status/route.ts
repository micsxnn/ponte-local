import { NextRequest } from "next/server";
import {
  isAdminAuthorized,
  isConnected,
  LANE_IDS,
  pendentesDaLane,
  ponte,
  PONTE_VERSION,
} from "@/lib/ponte-store";

export const dynamic = "force-dynamic";

// GET /api/ponte/status  (PRIVADO — somente o operador, header x-ponte-admin
// ou ?admin=). Era público até v1.3.0: expunha a existência das máquinas,
// nomes de usuário, home e specs para qualquer um com a URL. VAZAMENTO —
// corrigido na v1.3.1. Sem token válido: 401, zero informação.
export async function GET(req: NextRequest) {
  const token =
    req.headers.get("x-ponte-admin") ?? new URL(req.url).searchParams.get("admin");
  if (!isAdminAuthorized(token)) {
    return Response.json(
      { ok: false, error: "Painel privado do operador — token ausente ou inválido" },
      { status: 401 }
    );
  }
  const s = ponte();
  const agora = Date.now();
  const lanes: Record<string, unknown> = {};
  let conectado = false;
  for (const id of LANE_IDS) {
    const ls = s.lanes[id];
    const on = isConnected(id);
    if (on) conectado = true;
    lanes[id] = {
      conectado: on,
      lastSeenAgoS: ls.lastSeen ? Math.round((agora - ls.lastSeen) / 1000) : null,
      agentInfo: ls.agentInfo,
      pending: pendentesDaLane(s, id),
    };
  }
  return new Response(
    JSON.stringify({
      ok: true,
      connected: conectado,
      lanes,
      totalCommands: s.totalCommands,
      totalResults: s.totalResults,
      uptimeS: Math.round((agora - s.startedAt) / 1000),
      version: PONTE_VERSION,
    }),
    {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    }
  );
}
