import { NextRequest } from "next/server";
import { isAdminAuthorized, LANE_IDS, LaneId, resultsSince } from "@/lib/ponte-store";

export const dynamic = "force-dynamic";

// GET /api/ponte/results?since=N&lane=netbook  (somente admin — x-ponte-admin)
// Resultados postados desde o cursor "since". Sem "lane", devolve de TODAS
// as lanes (visão do operador); com "lane", filtra a máquina.
export async function GET(req: NextRequest) {
  const token = req.headers.get("x-ponte-admin");
  if (!isAdminAuthorized(token)) {
    return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }
  const url = new URL(req.url);
  const since = Math.max(0, parseInt(url.searchParams.get("since") ?? "0", 10) || 0);
  const laneParam = url.searchParams.get("lane");
  let lane: LaneId | undefined;
  if (laneParam) {
    if (!LANE_IDS.includes(laneParam as LaneId)) {
      return Response.json(
        { ok: false, error: `Lane inválida "${laneParam}" — use netbook|windows|test` },
        { status: 400 }
      );
    }
    lane = laneParam as LaneId;
  }
  const results = resultsSince(since, lane);
  const lastId = results.length ? results[results.length - 1].id : since;
  return new Response(JSON.stringify({ ok: true, results, lastId, lane: lane ?? "todas" }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
