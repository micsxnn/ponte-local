import { NextRequest } from "next/server";
import {
  isAdminAuthorized,
  isConnected,
  laneTemToken,
  pendentesDaLane,
  ponte,
  PONTE_VERSION,
} from "@/lib/ponte-store";

export const dynamic = "force-dynamic";

// GET /api/ponte/status  (PRIVADO — somente o operador, header x-ponte-admin).
// Era público até v1.3.0: expunha a existência das máquinas, nomes de
// usuário, home e specs para qualquer um com a URL. VAZAMENTO — corrigido
// na v1.3.1 (e o atalho ?admin= caiu na v1.4.0: token em URL vira log).
// Sem token válido: 401, zero informação.
//
// v1.5.0: lanes dinâmicas — lista a UNIÃO das lanes com token no .env e das
// lanes que já têm histórico no snapshot. Lane antiga cujo token saiu do
// .env continua visível, marcada semToken:true (histórico não desaparece).
export async function GET(req: NextRequest) {
  // SOMENTE header (v1.4.0): o fallback ?admin= que existia aqui colocava o
  // token de operador em URL — que vira registro em log de gateway/túnel.
  const token = req.headers.get("x-ponte-admin");
  if (!isAdminAuthorized(token)) {
    return Response.json(
      { ok: false, error: "Painel privado do operador — token ausente ou inválido" },
      { status: 401 }
    );
  }
  const s = ponte();
  const agora = Date.now();
  const ids = Array.from(new Set([...Object.keys(s.lanes)]));
  const lanes: Record<string, unknown> = {};
  let conectado = false;
  for (const id of ids) {
    const ls = s.lanes[id] ?? { lastSeen: 0, agentInfo: null };
    const on = isConnected(id);
    if (on) conectado = true;
    lanes[id] = {
      conectado: on,
      lastSeenAgoS: ls.lastSeen ? Math.round((agora - ls.lastSeen) / 1000) : null,
      agentInfo: ls.agentInfo,
      pending: pendentesDaLane(s, id),
      semToken: !laneTemToken(id),
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
