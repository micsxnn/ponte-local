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
// - Poll sem cursor (reconexão) NÃO pula a fila — entrega os pendentes com
//   menos de 24h da lane (enfileirados na queda).
// - Lease de 2 min (v1.18.0: lease acompanha o timeout do run_command, teto
//   32 min) — comando não é reentregue enquanto o agente não responder.
// - v1.5.1: identidade do modulo (HMR) — timer do modulo velho nao sobrescreve
//   o snapshot do novo.
// - v1.5.1: persistência quebrada = comando recusado (503), não aceito em silêncio.
// - v1.5.2: resultados grandes (base64) — memoria guarda ate 10M chars; snapshot
//   corta em 200k para nao inflar o disco.
// - v1.20.2 (v1.5.3): permissoes 0600/0700 no estado, aviso se relay em http://.

import fs from "fs";
import path from "path";
import { createHash, timingSafeEqual } from "crypto";

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
  lastSeen: number;
  agentInfo: Record<string, unknown> | null;
  semToken?: boolean; // v1.5.1: lane que existia mas perdeu o token no .env
}

interface Snapshot {
  v: number;
  savedAt: number;
  seq: number;
  commands: PonteCommand[];
  results: Array<Omit<PonteResult, "lane"> & { lane: LaneId }>;
  respondidos: number[];
  lanePorId: Array<[number, LaneId]>;
  lanes: Record<LaneId, LaneState>;
  totalCommands: number;
  totalResults: number;
}

interface PonteState {
  seq: number;
  commands: PonteCommand[];
  results: PonteResult[];
  respondidos: number[];
  lanePorId: Map<number, LaneId>;
  lanes: Record<LaneId, LaneState>;
  totalCommands: number;
  totalResults: number;
}

const g: {
  __ponteState2?: PonteState;
  __pontePersistTimer?: ReturnType<typeof setInterval>;
  __pontePersistTimerGen?: object;
  __ponteDirty?: boolean;
  __pontePersistFalha?: string | null;
} = {};

const GERACAO_MODULO = {};

const MAX_RESULTS = 400;
const MAX_PENDING = 100; // por lane
const MAX_COMMANDS = 2000;
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000; // pendente com mais de 24h morre
const CLAIM_LEASE_MS = 120_000; // se o agente não responder em 2 min, libera de novo
const LEASE_MAX_MS = 32 * 60 * 1000; // teto: run_command chega a 30 min
const SNAPSHOT_EVERY_MS = 4000; // debounce das escritas não críticas

function estaClaimed(
  s: { claimed: Map<number, { t: number; lease: number } | number> },
  id: number,
  now: number
): boolean {
  const v = s.claimed.get(id);
  if (!v) return false;
  if (typeof v === "number") return now - v < CLAIM_LEASE_MS;
  return now - v.t < v.lease;
}

function leaseDoComando(c: { args?: Record<string, unknown> }): number {
  const t = Number(c?.args?.timeoutMin);
  if (isFinite(t) && t > 0) return Math.min(LEASE_MAX_MS, Math.max(CLAIM_LEASE_MS, t * 60_000 + 60_000));
  return CLAIM_LEASE_MS;
}

// PONTE_DATA_DIR sobrepõe (containers/VPS com volume próprio).
// Antes eram caminhos absolutos da máquina do autor — em qualquer outro
// lugar a escrita falhava EACCES e o catch {} escondia o prejuízo.
const DATA_DIR = process.env.PONTE_DATA_DIR || process.cwd();
// v1.20.2: pasta de dados com 0700 para proteger snapshot/contador/token
try {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(DATA_DIR, 0o700);
  } catch (_) {
    /* volume sem suporte a chmod: segue */
  }
} catch (_) {
  /* sem permissao: o relay segue, mas o /cmd recusa (503) e avisa */
}
const SEQ_FILE = path.join(DATA_DIR, ".ponte-seq");
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
    // v1.20.2: contador em 0600
    fs.writeFileSync(SEQ_FILE, String(n), { mode: 0o600 });
    try {
      fs.chmodSync(SEQ_FILE, 0o600);
    } catch (_) {
      /* volume sem suporte a chmod: segue */
    }
  } catch (e) {
    avisaFalhaPersist("seq", e);
  }
}

function loadSnapshot(): Snapshot | null {
  try {
    const raw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8")) as Record<string, unknown>;
    if (raw.v !== 2) return null; // v2 = com lanePorId (v1.5.1)
    const snap = raw as Snapshot;
    // v1.20.2: snapshot com permissao 0600
    try {
      fs.chmodSync(SNAPSHOT_FILE, 0o600);
    } catch (_) {}
    return snap;
  } catch {
    return null;
  }
}

function resultadoParaSnapshot(r: PonteResult): Omit<PonteResult, "lane"> & { lane: LaneId } {
  // v1.5.2: resultado grande (base64) — memoria guarda ate 10M chars; snapshot
  // corta em 200k para nao inflar o disco.
  const MAX_DATA_SNAPSHOT = 200_000;
  const data = r.data;
  let _cortado = false;
  let dataSnap = data;
  if (typeof data === "string" && data.length > MAX_DATA_SNAPSHOT) {
    _cortado = true;
    dataSnap = data.slice(0, MAX_DATA_SNAPSHOT) + "\n\n[_cortado no snapshot — payload inteiro entregue em tempo real]";
  }
  return {
    id: r.id,
    ok: r.ok,
    data: dataSnap,
    error: r.error,
    durationMs: r.durationMs,
    ts: r.ts,
    lane: r.lane,
    _cortado,
  };
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
      lanePorId: Array.from(s.lanePorId.entries()).slice(-2000),
      lanes: s.lanes,
      totalCommands: s.totalCommands,
      totalResults: s.totalResults,
    };
    const tmp = SNAPSHOT_FILE + ".tmp";
    // v1.20.2: snapshot em 0600
    fs.writeFileSync(tmp, JSON.stringify(snap), { mode: 0o600 });
    try {
      fs.chmodSync(tmp, 0o600);
    } catch (_) {
      /* volume sem suporte a chmod: segue */
    }
    fs.renameSync(tmp, SNAPSHOT_FILE); // atômico: nunca deixa arquivo pela metade
    g.__pontePersistFalha = null; // v1.5.1: persistência voltou — libera addCommand
  } catch (e) {
    g.__pontePersistFalha = e instanceof Error ? e.message : String(e);
    avisaFalhaPersist("snapshot", e);
  }
}

function markDirty(): void {
  g.__ponteDirty = true;
}

function startAutoPersist(): void {
  if (g.__pontePersistTimer && g.__pontePersistTimerGen === GERACAO_MODULO) return;
  if (g.__pontePersistTimer) clearInterval(g.__pontePersistTimer); // timer de módulo velho (HMR)
  g.__pontePersistTimerGen = GERACAO_MODULO;
  g.__pontePersistTimer = setInterval(() => {
    // v1.5.1: com falha de persistência ativa, tenta de novo mesmo sem
    // mudança — é o caminho de recuperação que libera addCommand de novo.
    if (g.__ponteDirty || g.__pontePersistFalha) {
      g.__ponteDirty = false;
      saveSnapshot(ponte());
    }
  }, SNAPSHOT_EVERY_MS);
}

export function ponte(): PonteState {
  if (!g.__ponteState2) {
    const snap = loadSnapshot();
    if (snap) {
      g.__ponteState2 = {
        seq: snap.seq,
        commands: snap.commands,
        results: snap.results,
        respondidos: snap.respondidos,
        lanePorId: new Map(snap.lanePorId),
        lanes: snap.lanes,
        totalCommands: snap.totalCommands,
        totalResults: snap.totalResults,
      };
    } else {
      g.__ponteState2 = {
        seq: loadSeq(),
        commands: [],
        results: [],
        respondidos: [],
        lanePorId: new Map(),
        lanes: {},
        totalCommands: 0,
        totalResults: 0,
      };
    }
    // garante que todas as lanes do .env existem (v1.5.1: semToken para as que sumiram)
    const lanesPadrao = lanesFromEnv();
    for (const id of Object.keys(lanesPadrao)) {
      if (!g.__ponteState2.lanes[id]) g.__ponteState2.lanes[id] = { lastSeen: 0, agentInfo: null };
    }
    startAutoPersist(); // v1.5.1: assumir o timer também após HMR (troca de geração)
    return g.__ponteState2;
  }
  // HMR: se as lanes do .env mudaram, re-sincroniza
  const lanesPadrao = lanesFromEnv();
  for (const id of Object.keys(lanesPadrao)) {
    if (!g.__ponteState2!.lanes[id]) g.__ponteState2!.lanes[id] = { lastSeen: 0, agentInfo: null };
  }
  return g.__ponteState2;
}

// Comparação em tempo constante: hash antes do timingSafeEqual para igualar
// os comprimentos (v1.4.0 — igualdade de string pura respondia a timing)
function tokenIgual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

function tokensEnv(...nomes: string[]): string[] {
  const vals = [];
  for (const n of nomes) {
    const v = process.env[n];
    if (v) vals.push(...v.split(",").map((t) => t.trim()).filter(Boolean));
  }
  return vals;
}

function lanesFromEnv(): Record<string, string[]> {
  const lanes: Record<string, string[]> = {};
  const m = Object.entries(process.env).filter(([k]) => k.startsWith("PONTE_TOKEN_"));
  for (const [k, v] of m) {
    const sufixo = k.replace("PONTE_TOKEN_", "").toLowerCase().replace(/-/g, "_");
    if (!LANE_RE.test(sufixo)) continue;
    const toks = v.split(",").map((t) => t.trim()).filter(Boolean);
    if (toks.length) lanes[sufixo] = toks;
  }
  // aliases legados (token unico v1.4.0)
  const legacy = tokensEnv("PONTE_AGENT_TOKEN", "PONTE_TEST_TOKEN");
  if (legacy.length) lanes["netbook"] = legacy.filter((_, i) => i === 0 ? true : lanes["netbook"]?.includes(legacy[i]) ? false : true);
  if (legacy.length > 1) lanes["test"] = legacy.filter((_, i) => i === 1 ? true : false);
  return lanes;
}

const LANE_TOKENS: Record<string, string[]> = lanesFromEnv();
export const LANE_IDS: string[] = Object.keys(LANE_TOKENS).sort();

export function laneTemToken(lane: string): boolean {
  return !!LANE_TOKENS[lane] && LANE_TOKENS[lane].length > 0;
}

export function lanesComToken(): string[] {
  return LANE_IDS;
}

export const ADMIN_TOKEN = tokensEnv("PONTE_ADMIN_TOKEN")[0] ?? "";
export const PONTE_VERSION = "1.5.3";
export const CONNECTED_WINDOW_MS = 45_000;

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

export class ErroPersistencia extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroPersistencia";
  }
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
  // v1.5.1: aceitar comando com a última persistência falhada criava id que o
  // restart perderia — recusa com 503.
  if (g.__pontePersistFalha) {
    throw new ErroPersistencia(
      `Relay sem persistência (última falha: ${g.__pontePersistFalha}) — comando recusado para não criar id que se perde no restart. Resolva o disco/PONTE_DATA_DIR; o relay tenta gravar de novo a cada ${SNAPSHOT_EVERY_MS / 1000}s e volta a aceitar.`
    );
  }
  if (!laneTemToken(lane)) {
    const sufixo = lane.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    const hifen = lane.includes("-")
      ? ` Obs.: lane com "-" nunca nasce de PONTE_TOKEN_* — prefira o nome com "_".`
      : "";
    throw new Error(
      `Lane "${lane}" sem token — crie PONTE_TOKEN_${sufixo} no .env do relay (sufixo só com A-Z, 0-9 e _; a lane nasce com o sufixo em minúsculas, ex.: PONTE_TOKEN_MAQUINA_1 → lane maquina_1) e reinicie o relay.${hifen} Lanes atuais: ${lanesComToken().join(", ") || "(nenhuma)"}`
    );
  }
  // v1.18.0: os args nao eram validados como objeto — uma string chegava
  // ao agente, que fazia args.path sobre uma string
  if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) {
    throw new Error('args deve ser um objeto (ex.: {"path":"/home/u"}), ou omitido');
  }
  s.seq++;
  saveSeq(s.seq);
  const cmd: PonteCommand = { id: s.seq, action, args: args ?? {}, ts: Date.now(), lane };
  // v1.5.1: marca o dono do comando POR ID (lanePorId) — resultado de OUTRA
  // lane é recusado mesmo com o comando fora do histórico (janela respondidos).
  s.lanePorId.set(cmd.id, lane);
  // v1.3.0: cada lane tem a sua fila (antes era uma so). limite por lane.
  const pendentesLane = s.commands.filter((c) => c.lane === lane && !temResultado(s, c.id)).length;
  if (pendentesLane >= MAX_PENDING) {
    throw new Error("Fila da lane cheia (" + MAX_PENDING + " pendentes) — o agente nao esta consumindo");
  }
  if (s.commands.length >= MAX_COMMANDS) {
    throw new Error("Fila global cheia (" + MAX_COMMANDS + ")");
  }
  s.commands.push(cmd);
  s.totalCommands++;
  markDirty(); // snapshot debounced
  return cmd;
}

export function pollCommands(
  cursor: number,
  lane: LaneId
): { commands: PonteCommand[]; nextCursor: number } {
  const s = ponte();
  const agora = Date.now();
  // v1.18.0: comandos com mais de 24h sem resposta MORREM (nao sao reentregues)
  const validos = s.commands.filter(
    (c) => c.lane === lane && !temResultado(s, c.id) && agora - c.ts <= PENDING_MAX_AGE_MS
  );
  const entregues = validos.filter((c) => c.id > cursor);
  return { commands: entregues, nextCursor: cursor + entregues.length };
}

export function pollFresh(lane: LaneId): { commands: PonteCommand[]; nextCursor: number } {
  const s = ponte();
  const agora = Date.now();
  const pendentes = s.commands.filter(
    (c) => c.lane === lane && !temResultado(s, c.id) && agora - c.ts <= PENDING_MAX_AGE_MS
  );
  return { commands: pendentes, nextCursor: pendentes.length };
}

export function pushResult(r: PonteResult): void {
  const s = ponte();
  // v1.5.0: resultado DUPLICADO é idempotente — o agente 1.11.0 tem retry de
  // resultado (rede falhou depois do comando rodar), então o mesmo id pode
  // chegar duas vezes. Antes o retry inflava histórico e totalResults.
  // v1.5.1: dono por id (lanePorId no store) — resultado para id de OUTRA lane
  // é recusado mesmo com o comando fora do histórico (janela respondidos).
  const cmd = s.commands.find((c) => c.id === r.id);
  if (cmd && cmd.lane !== r.lane) {
    return; // drop silencioso: resultado de lane errada
  }
  // v1.5.1: dono por id (lanePorId) — cobre o comando que JÁ SAIU do histórico:
  // antes, id na janela global `respondidos` (fora da janela de results)
  // aceitava resultado de token de qualquer lane.
  const dona = s.lanePorId.get(r.id);
  if (dona && dona !== r.lane) {
    return;
  }
  const jáTem = s.results.find((rr) => rr.id === r.id);
  if (jáTem && jáTem.lane !== r.lane) {
    return;
  }
  // v1.5.1: dona === lane também libera (resultado atrasado de comando podado
  // da PRÓPRIA lane vale); id sem rastro de dono mantém o comportamento antigo.
  if (!cmd && !jáTem && dona !== r.lane && !s.respondidos.includes(r.id)) {
    return;
  }
  if (jáTem) {
    // Retry do agente chegando com resultado já registrado (v1.5.0):
    // confirma recebimento sem duplicar histórico/contagem.
    if (r.announce && typeof r.announce === "object") setAgentInfo(r.lane, r.announce);
    return;
  }
  s.results.push({
    id: r.id,
    ok: r.ok === true, // v1.18.0: !!body.ok tratava a string "false" como true
    data: r.data,
    error: r.error,
    durationMs: r.durationMs,
    ts: Date.now(),
    lane: r.lane,
  });
  s.respondidos.push(r.id);
  if (s.respondidos.length > 2000) s.respondidos = s.respondidos.slice(-2000);
  if (s.lanePorId.size > 2000) {
    const entries = Array.from(s.lanePorId.entries()).slice(-2000);
    s.lanePorId.clear();
    for (const [k, v] of entries) s.lanePorId.set(k, v);
  }
  s.totalResults++;
  markDirty(); // snapshot debounced
}

export function resultsSince(since: number, lane?: LaneId): PonteResult[] {
  const s = ponte();
  let res = s.results.filter((r) => r.id > since);
  if (lane) res = res.filter((r) => r.lane === lane);
  return res;
}

export function markSeen(lane: LaneId): void {
  const s = ponte();
  if (s.lanes[lane]) s.lanes[lane].lastSeen = Date.now();
  markDirty(); // snapshot debounced
}

export function setAgentInfo(lane: LaneId, info: Record<string, unknown>): void {
  const s = ponte();
  if (s.lanes[lane]) s.lanes[lane].agentInfo = info;
  markDirty(); // snapshot debounced
}

export function isConnected(lane: LaneId): boolean {
  const s = ponte();
  const l = s.lanes[lane];
  return !!l && Date.now() - l.lastSeen < CONNECTED_WINDOW_MS;
}

export function pendentesDaLane(s: PonteState, lane: LaneId): number {
  const agora = Date.now();
  return s.commands.filter(
    (c) => c.lane === lane && !temResultado(s, c.id) && agora - c.ts <= PENDING_MAX_AGE_MS
  ).length;
}
