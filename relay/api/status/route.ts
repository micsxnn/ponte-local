import { NextRequest } from "next/server";
import { isAdminAuthorized, isConnected, lanesComToken, ponte, PONTE_VERSION } from "@/lib/ponte-store";

export const dynamic = "force-dynamic";

// GET /api/ponte/status  (somente admin — x-ponte-admin)
// Estado geral do relay: versão, lanes, conectadas, pending, total.
export async function GET(req: NextRequest) {
  const token = req.headers.get("x-ponte-admin");
  if (!isAdminAuthorized(token)) {
    return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }
  const s = await import("@/lib/ponte-store").then((m) => m.ponte());
  const agora = Date.now();
  const ids = lanesComToken();
  const lanes: Record<string, unknown> = {};
  let conectado = 0;
  for (const id of ids) {
    const l = s.lanes[id];
    const on = isConnected(id);
    if (on) conectado++;
    lanes[id] = {
      conectada: on,
      lastSeen: l ? l.lastSeen : 0,
      specs: l ? l.agentInfo : null,
      pendentes: s.commands.filter((c) => c.lane === id && !s.results.some((r) => r.id === c.id) && agora - c.ts <= 24 * 60 * 60 * 1000).length,
      semToken: false,
    };
  }
  // lanes que existiam mas perderam o token no .env (v1.5.1)
  for (const [id, l] of Object.entries(s.lanes)) {
    if (!ids.includes(id)) {
      lanes[id] = {
        conectada: false,
        lastSeen: l ? l.lastSeen : 0,
        specs: l ? l.agentInfo : null,
        pendentes: s.commands.filter((c) => c.lane === id && !s.results.some((r) => r.id === c.id) && agora - c.ts <= 24 * 60 * 60 * 1000).length,
        semToken: true,
      };
    }
  }
  return new Response(
    JSON.stringify({ ok: true, version: PONTE_VERSION, lanes, total: ids.length, conectado }),
    {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    }
  );
}
