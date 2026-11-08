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
//
// Correções (v1.5.1):
// - Dono por id (lanePorId): resultado para id de OUTRA lane é recusado mesmo
//   depois que o comando sai do histórico (antes, id na janela global
//   `respondidos` fora da janela de results aceitava resultado de qualquer token).
// - Resultado com data gigante, DOIS cortes (v1.5.2): a MEMÓRIA guarda data
//   até 10M chars — o teto de 200k da v1.5.1 destruiu os pedaços do download
//   (pedaço de 4-6 MB vira 5-8M chars em base64 e o /results entregava
//   {_cortado}; o "pegar" gravava 0 bytes em silêncio). 10M = o máximo que o
//   próprio agente manda (ele recusa resultado >10,5 MB). O SNAPSHOT em disco
//   continua cortando em 200k — o .ponte-estado.json fica enxuto; após restart,
//   payloads grandes do HISTÓRICO voltam {_cortado} (entregues em tempo real
//   são sempre íntegros).
// - Poll entrega no máximo ~32 MB de args por chamada (resto fica pendente).
// - Persistência falhou → comando novo é recusado com 503 (não aceita em
//   silêncio um id que o restart perderia).
// - Mensagem de lane sem token não sugere mais env com hífen (env não aceita).

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
  // id do comando → { t: timestamp do claim, lease: duracao do lease }
  // (v1.18.0: o lease virou por-comando, para caber no timeout do run_command)
  claimed: Map<number, { t: number; lease: number }>;
  lanePorId: Map<number, LaneId>; // v1.5.1: id do comando → lane dona (sobrevive à poda do histórico)
  lanes: Record<string, LaneState>;
  startedAt: number;
  totalCommands: number;
  totalResults: number;
}

const g = globalThis as unknown as {
  __ponteState2?: PonteState;
  __pontePersistTimer?: ReturnType<typeof setInterval>;
  __pontePersistTimerGen?: object; // v1.5.1: geração do módulo dona do timer (HMR)
  __ponteDirty?: boolean;
  __pontePersistFalha?: string | null; // v1.5.1: última falha de persistência (null = ok)
};

// Identidade desta instância do módulo (v1.5.1): após HMR, o timer do módulo
// velho seguia vivo e gravava snapshot no formato antigo por cima do novo
// (perdia lanePorId). A geração deixa o módulo atual replantar o timer.

const GERACAO_MODULO = {};

const MAX_RESULTS = 400;
const MAX_PENDING = 100; // por lane
const MAX_COMMANDS = 2000;
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000; // pendente com mais de 24h morre
const CLAIM_LEASE_MS = 120_000; // se o agente não responder em 2 min, libera de novo
// v1.18.0: o lease fixo de 2 min era MENOR que o timeout padrao do
// run_command (3 min) — um comando legitimo de 2+ min era reentregue e
// executava DUAS vezes. Agora o lease acompanha o timeout pedido.
const LEASE_MAX_MS = 32 * 60 * 1000; // teto: run_command chega a 30 min
// um comando esta claimed enquanto o lease NAO expirou
function estaClaimed(
  s: { claimed: Map<number, { t: number; lease: number } | number> },
  id: number,
  now: number
): boolean {
  const v = s.claimed.get(id);
  if (!v) return false;
  if (typeof v === "number") return now - v < CLAIM_LEASE_MS; // formato antigo
  return now - v.t < v.lease;
}

function leaseDoComando(c: { args?: Record<string, unknown> }): number {
  const t = Number(c?.args?.timeoutMin);
  if (isFinite(t) && t > 0) return Math.min(LEASE_MAX_MS, Math.max(CLAIM_LEASE_MS, t * 60_000 + 60_000));
  return CLAIM_LEASE_MS;
}
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

export const PONTE_VERSION = "1.5.2";
export const CONNECTED_WINDOW_MS = 45_000;

// Arquivos de estado ao lado do projeto (funciona em qualquer deploy):
// PONTE_DATA_DIR sobrepõe (containers/VPS com volume próprio).
// Antes eram caminhos absolutos da máquina do autor — em qualquer outro
// lugar a escrita falhava EACCES e o catch {} escondia o prejuízo.
const DATA_DIR = process.env.PONTE_DATA_DIR || process.cwd();
// v1.18.0: a pasta de dados nunca era criada. saveSeq/saveSnapshot falhavam
// com ENOENT — e o PRIMEIRO comando era aceito (200) e nunca existia
// (nem para o agente, nem depois de um restart); o segundo ja virava 503.
// Criar a pasta no boot evita os dois.
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (_) {
  /* sem permissao: o relay segue, mas o /cmd recusa (503) e avisa */
}
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
  lanePorId: [number, LaneId][]; // v1.5.1: dono de cada id (sobrevive à poda dos comandos)
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
      lanePorId: (Array.isArray(raw.lanePorId) ? (raw.lanePorId as unknown[]) : [])
        .filter(
          (p): p is [number, LaneId] =>
            Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "string" && LANE_RE.test(p[1])
        )
        .slice(-2000),
      lanes,
      totalCommands: typeof raw.totalCommands === "number" ? raw.totalCommands : 0,
      totalResults: typeof raw.totalResults === "number" ? raw.totalResults : 0,
    };
  } catch {
    return null; // arquivo ausente/corrompido = estado novo (comportamento antigo)
  }
}

// DOIS cortes (v1.5.2) — ver o comentário das correções no topo do arquivo:
// resultadoParaMemoria (pushResult) mantém pedaços de download íntegros;
// resultadoParaSnapshot (saveSnapshot) mantém o arquivo de estado enxuto.
function resultadoParaMemoria(r: PonteResult): PonteResult {
  // v1.18.0: o campo `error` nao tinha teto (so o `data` era cortado). Um
  // agente podia mandar um error de ~12 MB; com 400 resultados na memoria,
  // isso dava GBs. Agora o error tambem e cortado.
  const erroLimite = 200_000;
  let saida = r;
  if (typeof r.error === "string" && r.error.length > erroLimite) {
    saida = { ...saida, error: r.error.slice(0, erroLimite) + "…[erro cortado]" };
  }
  if (saida.data === undefined || saida.data === null) return saida;
  try {
    if (JSON.stringify(saida.data).length <= 10_000_000) return saida;
  } catch {
    return { ...saida, data: undefined };
  }
  return { ...saida, data: { _cortado: "payload grande não armazenado (>10M chars)" } };
}

function resultadoParaSnapshot(r: PonteResult): PonteResult {
  if (r.data === undefined || r.data === null) return r;
  try {
    if (JSON.stringify(r.data).length <= 200_000) return r;
  } catch {
    return { ...r, data: undefined };
  }
  return { ...r, data: { _cortado: "payload grande não armazenado (>200k chars)" } };
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
    fs.writeFileSync(tmp, JSON.stringify(snap));
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
    g.__ponteState2 = {
      seq: Math.max(loadSeq(), snap?.seq ?? 0),
      commands: snap?.commands ?? [],
      results: snap?.results ?? [],
      respondidos: snap?.respondidos ?? [],
      claimed: new Map(), // lease não persiste: restart = entrega liberada (é o que queríamos)
      lanePorId: new Map(snap?.lanePorId ?? []), // v1.5.1: dono por id sobrevive ao restart
      lanes: snap?.lanes ?? lanesPadrao(),
      startedAt: Date.now(),
      totalCommands: snap?.totalCommands ?? 0,
      totalResults: snap?.totalResults ?? 0,
    };
  }
  const s = g.__ponteState2;
  // Defesa contra HMR/estados antigos em memória
  if (!s.claimed) s.claimed = new Map();
  if (!(s.lanePorId instanceof Map)) s.lanePorId = new Map(); // v1.5.1
  if (!Array.isArray(s.commands)) s.commands = [];
  if (!Array.isArray(s.results)) s.results = [];
  if (!Array.isArray(s.respondidos)) s.respondidos = [];
  if (!s.lanes) s.lanes = lanesPadrao();
  else for (const id of LANE_IDS) if (!s.lanes[id]) s.lanes[id] = { lastSeen: 0, agentInfo: null };
  startAutoPersist(); // v1.5.1: assumir o timer também após HMR (troca de geração)
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

// v1.5.1: persistência quebrada = comando recusado, não aceito em silêncio.
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
  // restart perdia (seq/snapshot antigos) — comando nunca entregue e reuso de
  // id. O timer de snapshot tenta de novo a cada 4 s; sucesso libera de novo.
  if (g.__pontePersistFalha) {
    throw new ErroPersistencia(
      `Relay sem persistência (última falha: ${g.__pontePersistFalha}) — comando recusado para não criar id que se perde no restart. Resolva o disco/PONTE_DATA_DIR; o relay tenta gravar de novo a cada ${SNAPSHOT_EVERY_MS / 1000}s e volta a aceitar.`
    );
  }
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
  s.lanePorId.set(cmd.id, lane); // v1.5.1: dono do id sobrevive à poda do histórico
  if (s.lanePorId.size > 2000) {
    const maisVelho = s.lanePorId.keys().next().value;
    if (maisVelho !== undefined) s.lanePorId.delete(maisVelho);
  }
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
    // v1.5.1: espaco=0 fazia slice(-0) === slice(0) devolver TODOS os feitos
    // (histórico crescia além do teto). Ternário explícito.
    const feitos = espaco > 0 ? s.commands.filter((c) => temResultado(s, c.id)).slice(-espaco) : [];
    s.commands = [...pendentes, ...feitos].sort((a, b) => a.id - b.id);
  }
}

// v1.5.1: teto agregado dos args entregues por poll (~32 MB). Uma enxurrada de
// comandos com base64 não pode estourar a memória do agente numa entrega só:
// entrega por ordem de id os que couberem; o resto fica para o próximo poll.
const POLL_TETO_ARGS = 32 * 1024 * 1024;

function pesoArgs(c: PonteCommand): number {
  try {
    return JSON.stringify(c.args ?? {}).length;
  } catch {
    return 0;
  }
}

function cabemNoTeto(cmds: PonteCommand[]): { entregues: PonteCommand[]; cortado: boolean } {
  const ordenados = [...cmds].sort((a, b) => a.id - b.id);
  const entregues: PonteCommand[] = [];
  let total = 0;
  for (const c of ordenados) {
    const peso = pesoArgs(c);
    // o primeiro comando sempre passa (entrega única maior que o teto não
    // pode travar a fila para sempre; /cmd limita corpo a 12 MB)
    if (entregues.length > 0 && total + peso > POLL_TETO_ARGS) {
      return { entregues, cortado: true };
    }
    entregues.push(c);
    total += peso;
  }
  return { entregues, cortado: false };
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
    if (estaClaimed(s, c.id, now)) return false;
    return true;
  });
  const { entregues, cortado } = cabemNoTeto(pending); // v1.5.1: teto por poll
  // v1.18.0: o lease acompanha o timeout do comando (um run_command de 3 min
  // nao podia ser reentregue em 2 min e executado DUAS vezes)
  for (const c of entregues) s.claimed.set(c.id, { t: now, lease: leaseDoComando(c) });
  if (s.claimed.size > 500) {
    for (const [id, v] of s.claimed) {
      const t = typeof v === "object" && v !== null ? v.t : v;
      const lease = typeof v === "object" && v !== null ? v.lease : CLAIM_LEASE_MS;
      if (now - t > lease) s.claimed.delete(id);
    }
  }
  // v1.18.0: o cursor NUNCA pode passar de um comando PENDENTE da lane.
  // Antes o nextCursor era o id maximo do store inteiro: um comando
  // normalmente entregue (lease ativo) era pulado e sumia PARA SEMPRE —
  // o filtro "id <= cursor" o descartava nas polls seguintes.
  //
  // O calculo usa os NAO CONCLUIDOS (sem resultado), e nao o `pending`:
  // o `pending` ja exclui os claimed, ou seja, os que foram entregues e
  // ainda nao responderam — que sao exatamente os que nao podem ser
  // pulados.
  const naoConcluidos = mine.filter((c) => {
    if (c.id <= cursor) return false;
    if (now - c.ts > PENDING_MAX_AGE_MS) return false;
    if (temResultado(s, c.id)) return false;
    return true;
  });
  const menorPendente = naoConcluidos.length ? Math.min(...naoConcluidos.map((c) => c.id)) : 0;
  const maiorEntregue = entregues.length ? entregues[entregues.length - 1].id : cursor;
  const nextCursor = menorPendente
    ? Math.max(0, menorPendente - 1)
    : Math.max(cursor, maiorEntregue);
  return { commands: entregues, nextCursor };
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
    if (estaClaimed(s, c.id, now)) return false;
    return true;
  });
  const { entregues, cortado } = cabemNoTeto(pendings); // v1.5.1: teto por poll
  for (const c of entregues) s.claimed.set(c.id, { t: now, lease: leaseDoComando(c) });
  // v1.18.0: o cursor nao passa dos pendentes (o id maximo do store
  // inteiro pulava comandos de outras lanes e da propria lane)
  const naoConcluidos = pendings.filter((c) => !temResultado(s, c.id));
  const menores = naoConcluidos.map((c) => c.id);
  const menorPendente = menores.length ? Math.min(...menores) : 0;
  const maiorEntregue = entregues.length ? entregues[entregues.length - 1].id : 0;
  return {
    commands: entregues,
    nextCursor: menorPendente ? Math.max(0, menorPendente - 1) : maiorEntregue,
  };
}

export function pushResult(r: PonteResult): void {
  const s = ponte();
  s.totalResults += 1;
  s.results.push(resultadoParaMemoria(r)); // v1.5.2: pedaços íntegros na memória; snapshot corta à parte
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
  // v1.5.1: usa temResultado (results + respondidos) — olhar só `results`
  // contava pendente fantasma para id respondido já podado do histórico.
  return s.commands.filter((c) => c.lane === lane && !temResultado(s, c.id)).length;
}

// (reload trigger: ambiente restaurado após reboot da VM — nenhuma mudança de lógica)
