import { NextRequest } from "next/server";
import {
  isAgentAuthorized,
  laneForAgent,
  markSeen,
  pollCommands,
  pollFresh,
  PONTE_VERSION,
} from "@/lib/ponte-store";

export const dynamic = "force-dynamic";

// GET /api/ponte/poll?cursor=N  (agente, header x-ponte-token)
// O agente pergunta: "tem comando novo pra minha lane?" e o relay responde.
// A lane é determinada pelo TOKEN do agente — uma lane por máquina.
export async function GET(req: NextRequest) {
  const token = req.headers.get("x-ponte-token");
  const lane = laneForAgent(token);
  if (!isAgentAuthorized(token) || !lane) {
    return Response.json(
      { ok: false, error: "Token inválido ou ausente" },
      { status: 401 }
    );
  }
  markSeen(lane);
  const url = new URL(req.url);

  // Primeiro poll do agente (sem cursor): reconexão. NÃO pula a fila —
  // entrega os pendentes com menos de 24h da lane (enfileirados na queda).
  if (!url.searchParams.has("cursor")) {
    const { commands, nextCursor } = pollFresh(lane);
    return new Response(
      JSON.stringify({
        ok: true,
        commands,
        nextCursor,
        fresh: true,
        pollMs: 1500,
        version: PONTE_VERSION,
        lane,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      }
    );
  }

  const cursor = Math.max(0, parseInt(url.searchParams.get("cursor") ?? "0", 10) || 0);
  const { commands, nextCursor } = pollCommands(cursor, lane);
  return new Response(
    JSON.stringify({ ok: true, commands, nextCursor, pollMs: 1500, version: PONTE_VERSION, lane }),
    {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    }
  );
}
