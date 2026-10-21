/**
 * WHERE CONNECTIONS, TASKS AND THE AUDIT TRAIL ARE KEPT.
 *
 * Three tables (supabase/migrations/0017_connectors.sql), behind one
 * interface so everything above it runs against the in-memory twin in tests
 * and local runs, as the other stores do. Written with the service key: the
 * tables' policies only let a person READ their own rows, so level, auto_ok
 * and tokens change nowhere but in this server's code.
 *
 * The audit trail holds what ran, never what it was about: the tool, its risk,
 * how it ended and a few words. No arguments, no message text, no results.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import type { Level, Risk } from "./risk.js";

export type TaskState = "running" | "waiting" | "done" | "failed" | "cancelled";
export const TERMINAL_STATES: readonly TaskState[] = ["done", "failed", "cancelled"];

export interface Connection {
  userId: string;
  connectorId: string;
  level: Level;
  /** Encrypted JSON: the OAuth tokens, or the pasted URL. Null until connected. */
  tokensEnc: string | null;
  /** Encrypted PKCE verifier, between starting a sign-in and finishing it. */
  verifierEnc: string | null;
  clientInfo: unknown | null;
  /** Tools the person let it do without asking. */
  autoOk: string[];
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type ConnectionPatch = Partial<Pick<Connection, "level" | "tokensEnc" | "verifierEnc" | "clientInfo" | "autoOk" | "lastUsedAt">>;

export interface Approval {
  id: string;
  connector: string;
  tool: string;
  risk: Risk;
  /** The exact words, recipient or target, in plain words, for the confirm card. */
  preview: string;
  /** The call itself, kept until it runs or is refused. Never in an API response. */
  args: Record<string, unknown>;
  at: number;
}

export interface TaskStep { at: number; text: string }

export interface Task {
  id: string;
  userId: string;
  runId: string | null;
  state: TaskState;
  title: string;
  steps: TaskStep[];
  approval: Approval | null;
  createdAt: number;
  updatedAt: number;
}

export type TaskPatch = Partial<Pick<Task, "state" | "title" | "steps" | "approval">>;

export interface AuditRow {
  taskId: string;
  userId: string;
  connectorId: string;
  tool: string;
  risk: Risk;
  outcome: "ok" | "failed" | "denied";
  summary: string;
  at: number;
}

/** Thrown when this caller has no account row for connections to belong to (a static token, the dev user). */
export class ConnectorsNeedAccount extends Error {
  constructor() { super("Sign in to connect apps."); }
}

export interface ConnectorStore {
  getConnection(userId: string, connectorId: string): Promise<Connection | null>;
  listConnections(userId: string): Promise<Connection[]>;
  /** Creates the row (level "look") if there is none, then applies the patch. */
  upsertConnection(userId: string, connectorId: string, patch: ConnectionPatch): Promise<Connection>;
  deleteConnection(userId: string, connectorId: string): Promise<void>;
  createTask(userId: string, t: { runId?: string; title: string }): Promise<Task>;
  getTask(userId: string, id: string): Promise<Task | null>;
  /** The newest task of this run that has not finished. */
  openTaskForRun(userId: string, runId: string): Promise<Task | null>;
  listTasks(userId: string, limit: number): Promise<Task[]>;
  updateTask(userId: string, id: string, patch: TaskPatch): Promise<Task | null>;
  /** waiting -> running, once, for whoever gets there first. Null for everyone else. */
  claimWaiting(userId: string, id: string): Promise<Task | null>;
  addAudit(row: AuditRow): Promise<void>;
  listAudit(userId: string, taskId: string): Promise<AuditRow[]>;
}

// -------------------------------------------------------------------- memory

export class MemoryConnectorStore implements ConnectorStore {
  private conns = new Map<string, Connection>();
  private tasks = new Map<string, Task>();
  private audit: AuditRow[] = [];

  async getConnection(userId: string, connectorId: string) {
    return structuredClone(this.conns.get(`${userId}|${connectorId}`) ?? null);
  }
  async listConnections(userId: string) {
    return [...this.conns.values()].filter((c) => c.userId === userId).map((c) => structuredClone(c));
  }
  async upsertConnection(userId: string, connectorId: string, patch: ConnectionPatch) {
    const key = `${userId}|${connectorId}`;
    const now = Date.now();
    const cur = this.conns.get(key) ?? {
      userId, connectorId, level: "look" as Level, tokensEnc: null, verifierEnc: null, clientInfo: null,
      autoOk: [], lastUsedAt: null, createdAt: now, updatedAt: now,
    };
    const next: Connection = { ...cur, ...structuredClone(patch), updatedAt: now };
    this.conns.set(key, next);
    return structuredClone(next);
  }
  async deleteConnection(userId: string, connectorId: string) {
    this.conns.delete(`${userId}|${connectorId}`);
  }
  async createTask(userId: string, t: { runId?: string; title: string }) {
    const now = Date.now();
    const task: Task = {
      id: randomUUID(), userId, runId: t.runId ?? null, state: "running", title: t.title,
      steps: [], approval: null, createdAt: now, updatedAt: now,
    };
    this.tasks.set(task.id, task);
    return structuredClone(task);
  }
  async getTask(userId: string, id: string) {
    const t = this.tasks.get(id);
    return t && t.userId === userId ? structuredClone(t) : null;
  }
  async openTaskForRun(userId: string, runId: string) {
    const open = [...this.tasks.values()]
      .filter((t) => t.userId === userId && t.runId === runId && !TERMINAL_STATES.includes(t.state))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    return open ? structuredClone(open) : null;
  }
  async listTasks(userId: string, limit: number) {
    return [...this.tasks.values()]
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map((t) => structuredClone(t));
  }
  async updateTask(userId: string, id: string, patch: TaskPatch) {
    const t = this.tasks.get(id);
    if (!t || t.userId !== userId) return null;
    Object.assign(t, structuredClone(patch), { updatedAt: Date.now() });
    return structuredClone(t);
  }
  async claimWaiting(userId: string, id: string) {
    const t = this.tasks.get(id);
    if (!t || t.userId !== userId || t.state !== "waiting") return null;
    t.state = "running";
    t.updatedAt = Date.now();
    return structuredClone(t);
  }
  async addAudit(row: AuditRow) { this.audit.push({ ...row }); }
  async listAudit(userId: string, taskId: string) {
    return this.audit.filter((a) => a.userId === userId && a.taskId === taskId).map((a) => ({ ...a }));
  }
}

// ------------------------------------------------------------------ supabase

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (n: number) => new Date(n).toISOString();
const ms = (v: unknown): number | null => {
  const n = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

interface ConnRow {
  user_id: string; connector_id: string; level: Level; tokens_enc: string | null; verifier_enc: string | null;
  client_info: unknown; auto_ok: string[] | null; last_used_at: string | null; created_at: string; updated_at: string;
}
interface TaskRow {
  id: string; user_id: string; run_id: string | null; state: TaskState; title: string;
  steps: TaskStep[] | null; approval: Approval | null; created_at: string; updated_at: string;
}

const connOf = (r: ConnRow): Connection => ({
  userId: r.user_id, connectorId: r.connector_id, level: r.level, tokensEnc: r.tokens_enc, verifierEnc: r.verifier_enc,
  clientInfo: r.client_info ?? null, autoOk: r.auto_ok ?? [], lastUsedAt: ms(r.last_used_at),
  createdAt: ms(r.created_at) ?? 0, updatedAt: ms(r.updated_at) ?? 0,
});
const taskOf = (r: TaskRow): Task => ({
  id: r.id, userId: r.user_id, runId: r.run_id, state: r.state, title: r.title,
  steps: Array.isArray(r.steps) ? r.steps : [], approval: r.approval ?? null,
  createdAt: ms(r.created_at) ?? 0, updatedAt: ms(r.updated_at) ?? 0,
});

function ok<T>(res: { data: T | null; error: { message: string } | null }): T | null {
  if (res.error) throw new Error(`connectors store: ${res.error.message}`);
  return res.data;
}

export class SupabaseConnectorStore implements ConnectorStore {
  constructor(private readonly sb: SupabaseClient) {}

  private who(userId: string): string {
    if (!UUID.test(userId)) throw new ConnectorsNeedAccount();
    return userId;
  }

  async getConnection(userId: string, connectorId: string) {
    const r = ok(await this.sb.from("connector_connections").select("*")
      .eq("user_id", this.who(userId)).eq("connector_id", connectorId).maybeSingle<ConnRow>());
    return r ? connOf(r) : null;
  }
  async listConnections(userId: string) {
    const rows = ok(await this.sb.from("connector_connections").select("*").eq("user_id", this.who(userId)).returns<ConnRow[]>());
    return (rows ?? []).map(connOf);
  }
  async upsertConnection(userId: string, connectorId: string, patch: ConnectionPatch) {
    const row: Record<string, unknown> = { user_id: this.who(userId), connector_id: connectorId, updated_at: iso(Date.now()) };
    if (patch.level !== undefined) row.level = patch.level;
    if (patch.tokensEnc !== undefined) row.tokens_enc = patch.tokensEnc;
    if (patch.verifierEnc !== undefined) row.verifier_enc = patch.verifierEnc;
    if (patch.clientInfo !== undefined) row.client_info = patch.clientInfo;
    if (patch.autoOk !== undefined) row.auto_ok = patch.autoOk;
    if (patch.lastUsedAt !== undefined) row.last_used_at = patch.lastUsedAt === null ? null : iso(patch.lastUsedAt);
    const r = ok(await this.sb.from("connector_connections").upsert(row, { onConflict: "user_id,connector_id" })
      .select("*").single<ConnRow>());
    return connOf(r!);
  }
  async deleteConnection(userId: string, connectorId: string) {
    ok(await this.sb.from("connector_connections").delete().eq("user_id", this.who(userId)).eq("connector_id", connectorId));
  }
  async createTask(userId: string, t: { runId?: string; title: string }) {
    const r = ok(await this.sb.from("assistant_tasks")
      .insert({ user_id: this.who(userId), run_id: t.runId ?? null, title: t.title }).select("*").single<TaskRow>());
    return taskOf(r!);
  }
  async getTask(userId: string, id: string) {
    if (!UUID.test(id)) return null;
    const r = ok(await this.sb.from("assistant_tasks").select("*").eq("user_id", this.who(userId)).eq("id", id).maybeSingle<TaskRow>());
    return r ? taskOf(r) : null;
  }
  async openTaskForRun(userId: string, runId: string) {
    const rows = ok(await this.sb.from("assistant_tasks").select("*").eq("user_id", this.who(userId)).eq("run_id", runId)
      .in("state", ["running", "waiting"]).order("created_at", { ascending: false }).limit(1).returns<TaskRow[]>());
    return rows?.[0] ? taskOf(rows[0]) : null;
  }
  async listTasks(userId: string, limit: number) {
    const rows = ok(await this.sb.from("assistant_tasks").select("*").eq("user_id", this.who(userId))
      .order("updated_at", { ascending: false }).limit(limit).returns<TaskRow[]>());
    return (rows ?? []).map(taskOf);
  }
  async updateTask(userId: string, id: string, patch: TaskPatch) {
    if (!UUID.test(id)) return null;
    const r = ok(await this.sb.from("assistant_tasks").update({ ...patch, updated_at: iso(Date.now()) })
      .eq("user_id", this.who(userId)).eq("id", id).select("*").maybeSingle<TaskRow>());
    return r ? taskOf(r) : null;
  }
  async claimWaiting(userId: string, id: string) {
    if (!UUID.test(id)) return null;
    const r = ok(await this.sb.from("assistant_tasks").update({ state: "running", updated_at: iso(Date.now()) })
      .eq("user_id", this.who(userId)).eq("id", id).eq("state", "waiting").select("*").maybeSingle<TaskRow>());
    return r ? taskOf(r) : null;
  }
  async addAudit(row: AuditRow) {
    ok(await this.sb.from("assistant_audit").insert({
      task_id: row.taskId, user_id: this.who(row.userId), connector_id: row.connectorId, tool: row.tool,
      risk: row.risk, outcome: row.outcome, summary: row.summary, at: iso(row.at),
    }));
  }
  async listAudit(userId: string, taskId: string) {
    const rows = ok(await this.sb.from("assistant_audit").select("*").eq("user_id", this.who(userId)).eq("task_id", taskId)
      .order("at").returns<Array<Record<string, string>>>());
    return (rows ?? []).map((r) => ({
      taskId: r.task_id!, userId: r.user_id!, connectorId: r.connector_id!, tool: r.tool!, risk: r.risk as Risk,
      outcome: r.outcome as AuditRow["outcome"], summary: r.summary ?? "", at: ms(r.at) ?? 0,
    }));
  }
}

// ------------------------------------------------------------------ the one

let current: ConnectorStore | null = null;

/** Supabase when the service client exists, else memory (tests, local runs). */
export function connectorStore(): ConnectorStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseConnectorStore(sb) : new MemoryConnectorStore();
  }
  return current;
}

export function resetConnectorStoreForTests(): void { current = null; }
