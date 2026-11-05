// Ponte Local — estado compartilhado do relay.
// O relay guarda comandos a serem executados pelos agentes nos PCs do usuário
// e os resultados devolvidos por eles. Nada de arquivos trafega aqui —
// apenas JSON de metadados/operações.
//
// Lanes (v1.3.0) — uma lane por máquina, fim do token único:
// - Cada agente autentica com SEU token; o token determina a lane.
//   Fila, lastSeen e specs são POR LANE: comando de uma máquina nunca
//   atravessa para a outra.
//
// Lanes DINÂMICAS (v1.5.0) — fim da lista fixa no código:
// - A lane nasce da variável de ambiente: PONTE_TOKEN_<NOME> cria a lane
//   "nome" (sufixo em minúsculas). Máquina nova = linha nova no .env, sem
//   editar fonte. Nomes pessoais deixaram de estar hardcoded no projeto
//   público — exemplos de documentação viram "maquina_1", "pc" etc.
// - Aliases legados mantidos: PONTE_AGENT_TOKEN (= netbook) e
//   PONTE_TEST_TOKEN (= test) — transição da era do token único.
// - Lanes antigas que sumiram do .env não perdem o histórico: o snapshot
//   as preserva e /status as mostra marcadas com semToken:true.
//
// Tokens (v1.4.0, mantido): SEMPRE via ambiente, NUNCA no repo. Uma lane
// aceita uma LISTA de tokens separados por vírgula (transição de migração:
// token velho e novo convivem até a máquina trocar; aí o velho sai). O token
// de cada máquina é entregue ao usuário no chat privado; o ADMIN é usado
// apenas pelo operador (dentro da VM ou IA autorizada).
//
// Resiliência (v1.2.0, mantida):
// - Estado sobrevive a restart do processo: snapshot em .ponte-estado.json
//   (fila pendente, resultados recentes, lastSeen/specs por lane, contadores).
//   Escrita síncrona em addCommand/pushResult (comando não pode se perder nem
//   ser reexecutado por engano) e debouncada em markSeen/agentInfo.
// - Poll sem cursor (reconexão) NÃO pula a fila: entrega os pendentes
//   com menos de 24h da lane. Comando enfileirado durante queda deixa de
//   virar órfão. Comando com mais de 24h é considerado morto.
// - Janela de "conectado" de 45 s (soluços de rede não apagam a luz).

import fs from "fs";
import path from "path";
import { createHash, timingSafeEqual } from "crypto";

// Lane = nome curto dado pelo usuário (v1.5.0): a-z0-9, depois pode ter - e _.
export type LaneId = string;
export const LANE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export interface PonteCommand {
  id: number;
  action: string;
  args?: Record<string, unknown>;
  ts: number;
  lane: LaneId;
}

export interface PonteResult {
  id: number;
  ok: boolean;
  data?: unknown;
  error?: string;
  durationMs?: number;
  ts: number;
  lane: LaneId;
}

export interface LaneState {
  lastSeen: number; // último contato de um agente DESTA lane (epoch ms)
  agentInfo: Record<string, unknown> | null; // preenchido pelo "ping"
}

interface PonteState {
  seq: number;
  commands: PonteCommand[]; // histórico (agente usa cursor; pendentes protegidos)
  results: PonteResult[]; // histórico (capado)
  respondidos: number[]; // ids com resultado confirmado — sobrevive à poda dos 400 resultados
  claimed: Map<number, number>; // id do comando → timestamp do claim (entrega exclusiva)
  lanes: Record<string, LaneState>;
  startedAt: number;
  totalCommands: number;
  totalResults: number;
}

const g = globalThis as unknown as {
  __ponteState2?: PonteState;
  __pontePersistTimer?: ReturnType<typeof setInterval>;
  __ponteDirty?: boolean;
};

const MAX_RESULTS = 400;
const MAX_PENDING = 100; // por lane
const MAX_COMMANDS = 2000;
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000; // pendente com mais de 24h morre
const CLAIM_LEASE_MS = 120_000; // se o agente não responder em 2 min, libera de novo
const SNAPSHOT_EVERY_MS = 4000; // debounce das escritas não críticas

function tokensEnv(...nomes: string[]): string[] {
  for (const n of nomes) {
    const v = process.env[n];
    if (typeof v === "string" && v.trim()) {
      return v.split(",").map((t) => t.trim()).filter(Boolean);
    }
  }
  return [];
}

// Varre PONTE_TOKEN_<SUFIXO>: o sufixo em minúsculas vira o nome da lane
// (v1.5.0). "PONTE_TOKEN_PC" cria a lane "pc"; "PONTE_TOKEN_MAQUINA_2" cria
// "maquina_2". Antes a lista era fixa no código — máquina nova exigia editar
// fonte, e o repo público carregava nomes pessoais (netbook, celular...).
function lanesFromEnv(): Record<string, string[]> {
  const lanes: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(process.env)) {
    const m = /^PONTE_TOKEN_([A-Za-z0-9_]+)$/.exec(k);
    if (!m || typeof v !== "string") continue;
    const lane = m[1].toLowerCase();
    if (!LANE_RE.test(lane)) continue;
    const lista = v.split(",").map((t) => t.trim()).filter(Boolean);
    if (lista.length) lanes[lane] = lista;
  }
  // Aliases legados (token único da era 1.x) — só valem se a lane explícita não existe
  if (!lanes.netbook) {
    const t = tokensEnv("PONTE_AGENT_TOKEN");
    if (t.length) lanes.netbook = t;
  }
  if (!lanes.test) {
    const t = tokensEnv("PONTE_TEST_TOKEN");
    if (t.length) lanes.test = t;
  }
  return lanes;
}

export const LANE_TOKENS: Record<string, string[]> = lanesFromEnv();
export const LANE_IDS: string[] = Object.keys(LANE_TOKENS).sort();

export function laneTemToken(lane: string): boolean {
  return (LANE_TOKENS[lane] ?? []).length > 0;
}

export function lanesComToken(): string[] {
  return LANE_IDS.filter(laneTemToken);
}

export const ADMIN_TOKEN = tokensEnv("PONTE_ADMIN_TOKEN")[0] ?? "";

export const PONTE_VERSION = "1.5.0";
export const CONNECTED_WINDOW_MS = 45_000;

// Arquivos de estado ao lado do projeto (funciona em qualquer deploy):
// PONTE_DATA_DIR sobrepõe (containers/VPS com volume próprio).
// Antes eram caminhos absolutos da máquina do autor — em qualquer outro
// lugar a escrita falhava EACCES e o catch {} escondia o prejuízo.
const DATA_DIR = process.env.PONTE_DATA_DIR || process.cwd();
const SEQ_FILE = path.join(DATA_DIR, ".ponte-seq");

// Snapshot completo do relay (fila + histórico + specs por lane) — o arquivo
// que mata a amnésia: o Next reinicia, o relay reencontra o estado aqui.
const SNAPSHOT_FILE = path.join(DATA_DIR, ".ponte-estado.json");
let avisouFalhaPersist = false;
function avisaFalhaPersist(onde: string, e: unknown): void {
  if (avisouFalhaPersist) return;
  avisouFalhaPersist = true;
  console.warn(
    "[ponte] falha ao persistir estado (" + onde + "):",
    e instanceof Error ? e.message : e,
    "— o relay funciona, mas NÃO sobrevive a restart. Ajuste PONTE_DATA_DIR/permissões."
  );
}

function loadSeq(): number {
  try {
    return parseInt(fs.readFileSync(SEQ_FILE, "utf8").trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function saveSeq(n: number): void {
  try {
    fs.writeFileSync(SEQ_FILE, String(n));
  } catch (e) {
    avisaFalhaPersist("seq", e);
  }
}

interface Snapshot {
  v: number;
  savedAt: number;
  seq: number;
  commands: PonteCommand[]; // só pendentes <24h — o resto é histórico morto
  results: PonteResult[];
  respondidos: number[]; // ids JÁ respondidos (sobrevive à poda do histórico)
  lanes: Record<string, LaneState>;
  totalCommands: number;
  totalResults: number;
}

function lanesPadrao(): Record<string, LaneState> {
  const lanes: Record<string, LaneState> = {};
  for (const id of LANE_IDS) lanes[id] = { lastSeen: 0, agentInfo: null };
  return lanes;
}

// lane vinda de arquivo/legado: garante nome sanitizado (defesa contra
// snapshot corrompido ou key estranha no JSON)
function laneSanitaria(x: unknown): LaneId {
  const s = String(x ?? "");
  return LANE_RE.test(s) ? s : "netbook";
}

// channel (v1.x) → lane: "prod" era a lane única de produção = netbook.
function laneLegada(c: unknown): LaneId {
  return c === "test" ? "test" : "netbook";
}

function loadSnapshot(): Snapshot | null {
  try {
    const raw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8")) as Record<string, unknown>;
    if (!raw || !Array.isArray(raw.commands) || !Array.isArray(raw.results)) return null;
    const agora = Date.now();
    const verso = typeof raw.v === "number" ? raw.v : 1;

    const commands = (raw.commands as Record<string, unknown>[])
      .filter((c) => c && typeof c.id === "number" && agora - ((c.ts as number) ?? 0) <= PENDING_MAX_AGE_MS)
      .map((c) => ({
        id: c.id as number,
        action: String(c.action ?? ""),
        args: (c.args as Record<string, unknown>) ?? {},
        ts: (c.ts as number) ?? 0,
        lane: verso >= 2 ? laneSanitaria(c.lane) : laneLegada(c.channel),
      }));
    const results = (raw.results as Record<string, unknown>[])
      .filter((r) => r && typeof r.id === "number")
      .slice(-MAX_RESULTS)
      .map((r) => ({
        id: r.id as number,
        ok: !!r.ok,
        data: r.data,
        error: r.error as string | undefined,
        durationMs: r.durationMs as number | undefined,
        ts: (r.ts as number) ?? 0,
        lane: verso >= 2 ? laneSanitaria(r.lane) : laneLegada(r.channel),
      }));

    let lanes = lanesPadrao();
    if (verso >= 2 && raw.lanes && typeof raw.lanes === "object") {
      const l = raw.lanes as Record<string, LaneState>;
      // Qualquer lane já vista entra (v1.5.0): máquina renomeada ou com token
      // removido não perde histórico — /status a mostra com semToken:true.
      for (const [id, st] of Object.entries(l)) {
        if (!LANE_RE.test(id) || !st || typeof st !== "object") continue;
        lanes[id] = {
          lastSeen: typeof st.lastSeen === "number" ? st.lastSeen : 0,
          agentInfo:
            st.agentInfo && typeof st.agentInfo === "object"
              ? (st.agentInfo as Record<string, unknown>)
              : null,
        };
      }
    } else {
      // v1 → v2: slot único virava lane netbook
      lanes.netbook = {
        lastSeen: typeof raw.lastSeen === "number" ? raw.lastSeen : 0,
        agentInfo:
          raw.agentInfo && typeof raw.agentInfo === "object"
            ? (raw.agentInfo as Record<string, unknown>)
            : null,
      };
    }

    return {
      v: 2,
      savedAt: (raw.savedAt as number) ?? 0,
      seq: typeof raw.seq === "number" ? raw.seq : 0,
      commands,
      results,
      respondidos: Array.isArray(raw.respondidos)
        ? (raw.respondidos as unknown[]).filter((x): x is number => typeof x === "number").slice(-2000)
        : [],
      lanes,
      totalCommands: typeof raw.totalCommands === "number" ? raw.totalCommands : 0,
      totalResults: typeof raw.totalResults === "number" ? raw.totalResults : 0,
    };
  } catch {
    return null; // arquivo ausente/corrompido = estado novo (comportamento antigo)
  }
}

// Resultado com data gigante (base64 de read_binary etc.) entra no snapshot
// sem o payload — histórico útil, arquivo enxuto.
function resultadoParaSnapshot(r: PonteResult): PonteResult {
  if (r.data === undefined || r.data === null) return r;
  try {
    if (JSON.stringify(r.data).length <= 200_000) return r;
  } catch {
    return { ...r, data: undefined };
  }
  return { ...r, data: { _cortado: "payload grande não persistido (ver resultado ao vivo)" } };
}

export function saveSnapshot(s: PonteState): void {
  try {
    const agora = Date.now();
    const pendentes = s.commands.filter(
      (c) => !temResultado(s, c.id) && agora - c.ts <= PENDING_MAX_AGE_MS
    );
    const snap: Snapshot = {
      v: 2,
      savedAt: agora,
      seq: s.seq,
      commands: pendentes,
      results: s.results.slice(-MAX_RESULTS).map(resultadoParaSnapshot),
      respondidos: s.respondidos.slice(-2000),
      lanes: s.lanes,
      totalCommands: s.totalCommands,
      totalResults: s.totalResults,
    };
    const tmp = SNAPSHOT_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(snap));
    fs.renameSync(tmp, SNAPSHOT_FILE); // atômico: nunca deixa arquivo pela metade
  } catch (e) {
    avisaFalhaPersist("snapshot", e);
  }
}

function markDirty(): void {
  g.__ponteDirty = true;
}

function startAutoPersist(): void {
  if (g.__pontePersistTimer) return;
  g.__pontePersistTimer = setInterval(() => {
    if (g.__ponteDirty) {
      g.__ponteDirty = false;
      saveSnapshot(ponte());
    }
  }, SNAPSHOT_EVERY_MS);
}

export function ponte(): PonteState {
  if (!g.__ponteState2) {
    const snap = loadSnapshot();
    g.__ponteState2 = {
      seq: Math.max(loadSeq(), snap?.seq ?? 0),
      commands: snap?.commands ?? [],
      results: snap?.results ?? [],
      respondidos: snap?.respondidos ?? [],
      claimed: new Map(), // lease não persiste: restart = entrega liberada (é o que queríamos)
      lanes: snap?.lanes ?? lanesPadrao(),
      startedAt: Date.now(),
      totalCommands: snap?.totalCommands ?? 0,
      totalResults: snap?.totalResults ?? 0,
    };
    startAutoPersist();
  }
  const s = g.__ponteState2;
  // Defesa contra HMR/estados antigos em memória
  if (!s.claimed) s.claimed = new Map();
  if (!Array.isArray(s.commands)) s.commands = [];
  if (!Array.isArray(s.results)) s.results = [];
  if (!Array.isArray(s.respondidos)) s.respondidos = [];
  if (!s.lanes) s.lanes = lanesPadrao();
  else for (const id of LANE_IDS) if (!s.lanes[id]) s.lanes[id] = { lastSeen: 0, agentInfo: null };
  return s;
}

// Comparação em tempo constante: hash antes do timingSafeEqual para igualar
// os comprimentos (v1.4.0 — igualdade de string pura respondia a timing)
function tokenIgual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function laneForAgent(token: string | null): LaneId | null {
  if (!token) return null;
  for (const id of LANE_IDS) {
    if (LANE_TOKENS[id].some((t) => tokenIgual(t, token))) return id;
  }
  return null;
}

export function isAgentAuthorized(token: string | null): boolean {
  return laneForAgent(token) !== null;
}

export function isAdminAuthorized(token: string | null): boolean {
  return !!ADMIN_TOKEN && !!token && tokenIgual(ADMIN_TOKEN, token);
}

function temResultado(s: PonteState, id: number): boolean {
  return s.results.some((r) => r.id === id) || s.respondidos.includes(id);
}

export function addCommand(
  action: string,
  args?: Record<string, unknown>,
  lane?: LaneId
): PonteCommand {
  if (!lane || !LANE_RE.test(lane)) {
    throw new Error("Lane ausente ou inválida");
  }
  const s = ponte();
  podarCommands(s);
  const pending = s.commands.filter((c) => c.lane === lane && !temResultado(s, c.id));
  if (pending.length >= MAX_PENDING) {
    throw new Error(`Fila de comandos cheia na lane "${lane}" (agente não está respondendo?)`);
  }
  s.seq += 1;
  s.totalCommands += 1;
  saveSeq(s.seq);
  const cmd: PonteCommand = { id: s.seq, action, args: args ?? {}, ts: Date.now(), lane };
  s.commands.push(cmd);
  saveSnapshot(s); // comando é precioso (tem efeito real): persiste na hora
  return cmd;
}

// Casa limpa: pendentes vencidos (>24h) morrem; concluídos saem por idade
// (o id fica em respondidos — não volta a ser "pendente" se o resultado
// histórico for podado) e, se o histórico estourar MAX_COMMANDS, o corte
// é do FIM velho dos RESPONDIDOS (pendentes nunca são cortados por espaço).
function podarCommands(s: PonteState): void {
  const agora = Date.now();
  s.commands = s.commands.filter((c) => agora - c.ts <= PENDING_MAX_AGE_MS);
  if (s.commands.length > MAX_COMMANDS) {
    const pendentes = s.commands.filter((c) => !temResultado(s, c.id));
    const espaco = Math.max(0, MAX_COMMANDS - pendentes.length);
    const feitos = s.commands.filter((c) => temResultado(s, c.id)).slice(-espaco);
    s.commands = [...pendentes, ...feitos].sort((a, b) => a.id - b.id);
  }
}

export function pollCommands(
  cursor: number,
  lane: LaneId
): { commands: PonteCommand[]; nextCursor: number } {
  const s = ponte();
  const now = Date.now();
  const mine = s.commands.filter((c) => c.lane === lane);
  const pending = mine.filter((c) => {
    if (c.id <= cursor) return false;
    if (now - c.ts > PENDING_MAX_AGE_MS) return false; // comando velho não persegue agente
    if (temResultado(s, c.id)) return false;
    const claimedAt = s.claimed.get(c.id);
    if (claimedAt && now - claimedAt < CLAIM_LEASE_MS) return false;
    return true;
  });
  for (const c of pending) s.claimed.set(c.id, now);
  if (s.claimed.size > 500) {
    for (const [id, t] of s.claimed) if (now - t > CLAIM_LEASE_MS) s.claimed.delete(id);
  }
  const maxId = s.commands.length ? s.commands[s.commands.length - 1].id : cursor;
  return { commands: pending, nextCursor: Math.max(maxId, cursor) };
}

// Reconexão (poll sem cursor): NÃO pula a fila. Entrega os pendentes
// com menos de 24h DA LANE — o enfileirado durante a queda chega no
// reconnect em vez de virar órfão para sempre. nextCursor segue no fim.
export function pollFresh(lane: LaneId): { commands: PonteCommand[]; nextCursor: number } {
  const s = ponte();
  const now = Date.now();
  const pendings = s.commands.filter((c) => {
    if (c.lane !== lane) return false;
    if (now - c.ts > PENDING_MAX_AGE_MS) return false;
    if (temResultado(s, c.id)) return false;
    const claimedAt = s.claimed.get(c.id);
    if (claimedAt && now - claimedAt < CLAIM_LEASE_MS) return false;
    return true;
  });
  for (const c of pendings) s.claimed.set(c.id, now);
  const maxId = s.commands.length ? s.commands[s.commands.length - 1].id : 0;
  return { commands: pendings, nextCursor: maxId };
}

export function pushResult(r: PonteResult): void {
  const s = ponte();
  s.totalResults += 1;
  s.results.push(r);
  if (s.results.length > MAX_RESULTS) s.results = s.results.slice(-MAX_RESULTS);
  if (!s.respondidos.includes(r.id)) {
    s.respondidos.push(r.id);
    if (s.respondidos.length > 2000) s.respondidos = s.respondidos.slice(-2000);
  }
  s.claimed.delete(r.id);
  saveSnapshot(s); // resultado registrado em disco: comando não é reexecutado após restart
}

export function resultsSince(since: number, lane?: LaneId): PonteResult[] {
  return ponte()
    .results.filter((r) => r.id > since && (!lane || r.lane === lane))
    .slice(0, 100);
}

function garanteLane(s: PonteState, lane: LaneId): void {
  if (!s.lanes[lane]) s.lanes[lane] = { lastSeen: 0, agentInfo: null };
}

export function markSeen(lane: LaneId): void {
  const s = ponte();
  garanteLane(s, lane); // lane pode ter sido criada agora (token novo sem restart de rota)
  s.lanes[lane].lastSeen = Date.now();
  markDirty(); // lastSeen/agentInfo vão para o snapshot no debounce (4 s)
}

export function setAgentInfo(lane: LaneId, info: Record<string, unknown>): void {
  const s = ponte();
  garanteLane(s, lane);
  s.lanes[lane].agentInfo = info;
  markDirty();
}

export function isConnected(lane: LaneId): boolean {
  const ls = ponte().lanes[lane];
  return !!ls && Date.now() - ls.lastSeen < CONNECTED_WINDOW_MS;
}

export function pendentesDaLane(s: PonteState, lane: LaneId): number {
  return s.commands.filter((c) => c.lane === lane && !s.results.some((r) => r.id === c.id)).length;
}
