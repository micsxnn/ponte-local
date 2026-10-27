import { NextRequest } from "next/server";
import { isAgentAuthorized, laneForAgent, markSeen, pushResult, setAgentInfo } from "@/lib/ponte-store";

export const dynamic = "force-dynamic";

const MAX_BODY = 12_000_000; // 12 MB (resultados podem carregar base64 p/ read_binary)

// POST /api/ponte/result  (agente, header x-ponte-token)
// Corpo: { id, ok, data?, error?, durationMs?, announce? }
// "announce" é enviado junto ao resultado do ping com as infos da máquina.
// O resultado cai na lane do token — máquina não vê resultado da outra.
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
  const len = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (len > MAX_BODY) {
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
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  if (typeof body.id !== "number") {
    return Response.json({ ok: false, error: "Falta o id do comando" }, { status: 400 });
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
