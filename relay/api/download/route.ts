import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

// Serve o agent.js para instalação direta via curl — permite instalar do zero
// em qualquer máquina, sem zip nem etapas manuais: a IA entrega o bloco de
// comandos pronto e o usuário copia, cola e roda.
export async function GET() {
  try {
    const file = path.join(process.cwd(), "download", "ponte-agent", "agent.js");
    const conteudo = await readFile(file, "utf8");
    return new NextResponse(conteudo, {
      status: 200,
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "content-disposition": 'attachment; filename="agent.js"',
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Arquivo do agente não encontrado no servidor" },
      { status: 404 }
    );
  }
}
