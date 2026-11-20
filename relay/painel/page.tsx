import { isAdminAuthorized, LANE_RE, isConnected, lanesComToken, ponte, PONTE_VERSION } from "@/lib/ponte-store";

interface AgentInfo {
  agente: string;
  modo: string;
  usuario: string;
  maquina: string;
  plataforma: string;
  home: string;
  node: string;
  cpus: string;
  ramTotalGB: number;
  ramLivreGB: number;
  escopo: string;
  modoDeus: boolean;
  godModeDeclined: boolean;
  skill: string;
}

interface LaneStatus {
  conectada: boolean;
  lastSeen: number;
  specs: AgentInfo | null;
  pendentes: number;
  semToken: boolean;
}

interface Status {
  ok: boolean;
  version: string;
  lanes: Record<string, LaneStatus>;
  total: number;
  conectado: number;
}

function fmtGB(n?: number): string {
  if (!n) return "?";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

function CartaoMaquina({ id, status }: { id: string; status: LaneStatus }) {
  const conectada = status.conectada;
  const specs = status.specs;
  const pendentes = status.pendentes;
  const semToken = status.semToken;
  return (
    <div
      style={{
        border: "1px solid #333",
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
        background: conectada ? "#1a1a2e" : "#1a1a1a",
        opacity: semToken ? 0.6 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{id} {semToken && <span style={{ color: "#f59e0b", marginLeft: 8 }}>⚠ sem token no .env</span>}</h3>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: conectada ? "#3fb950" : "#ef4444",
          }}
        />
      </div>
      {specs && (
        <div style={{ fontSize: 13, color: "#ccc", lineHeight: 1.6 }}>
          <div>🤖 {specs.agente}</div>
          <div>👤 {specs.usuario} @ {specs.maquina}</div>
          <div>💻 {specs.plataforma}</div>
          <div>🏠 {specs.home}</div>
          <div>🔧 {specs.modo}</div>
          <div>🧠 {specs.cpus} · RAM {fmtGB(specs.ramTotalGB * 1024 * 1024 * 1024)} / livre {fmtGB(specs.ramLivreGB * 1024 * 1024 * 1024)}</div>
          <div>🔒 {specs.escopo}</div>
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: 13 }}>
        Pendentes: <strong>{pendentes}</strong> | Último visto: {status.lastSeen ? new Date(status.lastSeen).toLocaleString() : "nunca"}
      </div>
    </div>
  );
}

function TelaToken() {
  return (
    <div style={{ padding: 24, textAlign: "center" }}>
      <h2>Configure o token admin</h2>
      <p style={{ color: "#888" }}>Defina PONTE_ADMIN_TOKEN no .env e reinicie o relay.</p>
    </div>
  );
}

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const buscar = async () => {
      try {
        const token = localStorage.getItem("ponte_admin_token") || "";
        const res = await fetch("/api/ponte/status", {
          headers: { "x-ponte-admin": token },
          cache: "no-store",
        });
        if (!res.ok) {
          if (res.status === 401) setError("Token admin inválido ou ausente");
          else throw new Error("Falha ao buscar status");
          return;
        }
        const data = await res.json();
        setStatus(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    };
    buscar();
    const interval = setInterval(buscar, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div style={{ padding: 24 }}>Carregando...</div>;
  if (error) return <TelaToken />;
  if (!status) return <TelaToken />;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Ponte Local — Relay</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span>v{status.version}</span>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#3fb950" }} />
        </div>
      </div>
      <div style={{ marginBottom: 16, fontSize: 14, color: "#888" }}>
        {status.conectado} de {status.total} máquina(s) conectada(s)
      </div>
      {Object.entries(status.lanes).map(([id, st]) => (
        <CartaoMaquina key={id} id={id} status={st} />
      ))}
    </div>
  );
}

import { useState, useEffect } from "react";
