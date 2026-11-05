"use client";

import { useEffect, useState } from "react";

// Painel do operador — PRIVADO desde o relay 1.3.1.
// Sem o token de operador, NENHUMA informação da ponte é exibida (nem a
// existência das máquinas). O token fica só no localStorage deste navegador.
// O seletor de visão permite mostrar uma máquina só — nada de juntar
// máquinas na tela de quem só quer ver uma.
//
// v1.5.0: o seletor de lanes é DINÂMICO — as lanes vêm do /status (elas
// nascem do .env do relay). Nada de lista fixa no código: máquina nova ou
// lane renomeada aparece sozinha, sem editar o painel.

interface AgentInfo {
  agente?: string;
  usuario?: string;
  maquina?: string;
  plataforma?: string;
  home?: string;
  node?: string;
  cpus?: string;
  ramTotalGB?: number;
  ramLivreGB?: number;
  escopo?: string;
}

interface LaneStatus {
  conectado: boolean;
  lastSeenAgoS: number | null;
  agentInfo: AgentInfo | null;
  pending: number;
  semToken?: boolean;
}

interface Status {
  ok: boolean;
  connected: boolean;
  lanes: Record<string, LaneStatus>;
}

const TOKEN_KEY = "ponte-admin-token";
const VIEW_KEY = "ponte-view";

function nomeBonito(lane: string): string {
  return lane.charAt(0).toUpperCase() + lane.slice(1);
}

function fmtGB(n?: number): string {
  return n == null ? "—" : n.toFixed(1).replace(".", ",") + " GB";
}

function CartaoMaquina({ lane, st }: { lane: string; st: LaneStatus | undefined }) {
  const a = st?.agentInfo ?? null;
  const conectado = st?.conectado === true;

  const specs: Array<[string, string]> = a
    ? [
        ["Agente", a.agente ?? "—"],
        ["Usuário", a.usuario ?? "—"],
        ["Máquina", a.maquina ?? "—"],
        ["Sistema", a.plataforma ?? "—"],
        ["CPU", a.cpus ?? "—"],
        ["RAM", `${fmtGB(a.ramLivreGB)} livres de ${fmtGB(a.ramTotalGB)}`],
        ["Node", a.node ?? "—"],
        ["Escopo", a.escopo ?? "—"],
      ]
    : [];

  return (
    <div className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-5 font-mono text-sm text-zinc-300">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-100">{nomeBonito(lane)}</h2>
        <div className="flex items-center gap-2">
          {st?.semToken && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
              sem token
            </span>
          )}
          {st != null && st.pending > 0 && (
            <span className="rounded bg-amber-950 px-1.5 py-0.5 text-[10px] text-amber-400">
              {st.pending} pendente{st.pending > 1 ? "s" : ""}
            </span>
          )}
          <span className="text-[10px] uppercase tracking-wider text-zinc-600">lane {lane}</span>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            st == null ? "bg-zinc-600" : conectado ? "bg-emerald-400" : "bg-red-500"
          }`}
        />
        <span className={st == null ? "text-zinc-400" : conectado ? "text-emerald-400" : "text-red-400"}>
          {st == null
            ? "Conectando…"
            : conectado
              ? "Conectado"
              : st.lastSeenAgoS != null
                ? `Desconectado — visto há ${st.lastSeenAgoS}s`
                : "Nunca conectou"}
        </span>
      </div>

      {specs.length > 0 && (
        <dl className="mt-4 space-y-1.5 border-t border-zinc-800 pt-4 text-xs">
          {specs.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="shrink-0 text-zinc-500">{k}</dt>
              <dd className="break-all text-right text-zinc-200">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {st != null && a == null && (
        <p className="mt-4 border-t border-zinc-800 pt-4 text-xs leading-5 text-zinc-500">
          Sem informações — agente desta lane ainda não conectou (PC desligado ou
          agente não iniciado).
        </p>
      )}
    </div>
  );
}

function TelaToken({ aoEntrar, erro }: { aoEntrar: (t: string) => void; erro: boolean }) {
  const [valor, setValor] = useState("");
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
      <form
        className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-6 font-mono"
        onSubmit={(e) => {
          e.preventDefault();
          aoEntrar(valor.trim());
        }}
      >
        <h1 className="text-sm font-semibold text-zinc-100">Ponte Local — painel do operador</h1>
        <p className="mt-2 text-xs leading-5 text-zinc-500">
          Painel privado. Digite o token de operador (x-ponte-admin). Sem ele,
          nenhuma informação da ponte é exibida.
        </p>
        <input
          className="mt-4 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
          type="password"
          autoFocus
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="token de operador"
        />
        {erro && (
          <p className="mt-2 text-xs text-red-400">Token recusado pelo relay.</p>
        )}
        <button
          className="mt-4 w-full rounded-lg bg-zinc-100 px-3 py-2 text-sm font-semibold text-zinc-900 hover:bg-white"
          type="submit"
        >
          Entrar
        </button>
      </form>
    </main>
  );
}

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [recusado, setRecusado] = useState(false);
  const [st, setSt] = useState<Status | null>(null);
  const [visao, setVisao] = useState<string>("todas");

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) setToken(t);
    const v = localStorage.getItem(VIEW_KEY);
    if (v) setVisao(v);
  }, []);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    const buscar = () => {
      fetch("/api/ponte/status", {
        cache: "no-store",
        headers: { "x-ponte-admin": token },
      })
        .then(async (r) => {
          if (r.status === 401) {
            localStorage.removeItem(TOKEN_KEY);
            setToken(null);
            setRecusado(true);
            return null;
          }
          return r.json();
        })
        .then((j) => {
          if (j && vivo) setSt(j);
        })
        .catch(() => {});
    };
    buscar();
    const t = setInterval(buscar, 5000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [token]);

  if (!token) {
    return (
      <TelaToken
        erro={recusado}
        aoEntrar={(t) => {
          localStorage.setItem(TOKEN_KEY, t);
          setRecusado(false);
          setToken(t);
        }}
      />
    );
  }

  // Lanes vêm do relay (v1.5.0) — o seletor acompanha o .env sozinho.
  // Visão salva no localStorage que não existe mais cai para "todas".
  const nomesLanes = st ? Object.keys(st.lanes).sort() : [];
  const visaoValida = visao === "todas" || nomesLanes.includes(visao) ? visao : "todas";
  const visiveis = visaoValida === "todas" ? nomesLanes : [visaoValida];

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
      <div className="w-full max-w-3xl">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h1 className="font-mono text-base font-semibold text-zinc-100">Ponte Local</h1>
          <div className="flex items-center gap-2 font-mono text-xs">
            <select
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-300 outline-none"
              value={visaoValida}
              onChange={(e) => {
                setVisao(e.target.value);
                localStorage.setItem(VIEW_KEY, e.target.value);
              }}
            >
              <option value="todas">ver: todas</option>
              {nomesLanes.map((lane) => (
                <option key={lane} value={lane}>
                  ver: só {lane}
                </option>
              ))}
            </select>
            <button
              className="rounded-lg border border-zinc-700 px-2 py-1.5 text-zinc-500 hover:text-zinc-200"
              onClick={() => {
                localStorage.removeItem(TOKEN_KEY);
                setSt(null);
                setToken(null);
              }}
            >
              sair
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          {visiveis.map((lane) => (
            <CartaoMaquina key={lane} lane={lane} st={st?.lanes?.[lane]} />
          ))}
        </div>
      </div>
    </main>
  );
}
