import { NextRequest } from "next/server";
import { isAdminAuthorized, LANE_RE, resultsSince } from "@/lib/ponte-store";

export const dynamic = "force-dynamic";

// GET /api/ponte/results?since=N&lane=nome  (somente admin — x-ponte-admin)
// Resultados postados desde o cursor "since". Sem "lane", devolve de TODAS
// as lanes (visão do operador); com "lane", filtra a máquina.
//
// v1.5.0: o filtro aceita QUALQUER nome de lane (as lanes são dinâmicas —
// nascem de PONTE_TOKEN_<NOME>). Antes havia uma lista fixa que envelhecia
// mal: a mensagem de erro chegou a anunciar "netbook|windows|test" com a
// lane "celular" já existindo. Lane desconhecida simplesmente devolve vazio.
export async function GET(req: NextRequest) {
  const token = req.headers.get("x-ponte-admin");
  if (!isAdminAuthorized(token)) {
    return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }
  const url = new URL(req.url);
  const since = Math.max(0, parseInt(url.searchParams.get("since") ?? "0", 10) || 0);
  const laneParam = url.searchParams.get("lane");
  let lane: string | undefined;
  if (laneParam) {
    if (!LANE_RE.test(laneParam)) {
      return Response.json(
        { ok: false, error: `Lane inválida "${laneParam}" — use a-z, 0-9, "-" e "_"` },
        { status: 400 }
      );
    }
    lane = laneParam;
  }
  const results = resultsSince(since, lane);
  const lastId = results.length ? results[results.length - 1].id : since;
  return new Response(JSON.stringify({ ok: true, results, lastId, lane: lane ?? "todas" }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
