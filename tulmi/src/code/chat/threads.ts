/**
 * THE CONVERSATION ABOUT A PROJECT'S CODE: A SHORT ROLLING SUMMARY OF THE LAST TURNS, AND WHAT THE LAST ANSWER FOUND.
 *
 * A person asks "how does login work", then "and where is the logout?", then "ok, change it". Each of those means something only with the turns before it,
 * so each project chat THREAD (an id the app makes) keeps:
 *
 *   summary      a few lines on the last turns: what was asked and the files it was about. Rolled by code, for nothing: the oldest turn falls off the
 *                front when the summary is full. It holds questions and paths, not the code and not the answers' words
 *   last         the last question, the files and lines the last answer rested on (`cites`), and where a change would go (`located`, work/locate.ts):
 *                what a hand-off to a job carries, so the job does not look for the place again
 *   history      the last HISTORY_TURNS questions and answers word for word (an answer up to ANSWER_KEEP characters), so the chat shows them the way
 *                a chat does, and the front door knows what "??" or "why?" is about. Kept in the row's last_located jsonb beside the located files
 *                ({ located, history }), so no migration was needed; a row written before holds the located files alone, and reads as no history
 *
 * A thread can go on for ever and costs the same each turn: the model is shown the summary, and the last answer only on a follow-up, never the
 * history; the row holds at most HISTORY_TURNS turns; the chat shows the last few in full and folds the rest; "New chat" starts a thread afresh.
 *
 * The table is migration 0034 (code_chat_threads), behind one interface with a memory twin for tests and local runs, as the other stores are. Written with
 * the service key; a person's own token can only read their own rows. A thread is a person's and a project's: another person's id, or another project's,
 * is simply not found.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../auth/supabase.js";
import type { Located } from "../work/locate.js";

/** The summary is cut to this (the column's own limit is 2,000). */
export const SUMMARY_MAX = 1200;
/** The turns the summary goes back over. */
export const SUMMARY_TURNS = 5;
const QUESTION_MAX = 1000;
const CITES_MAX = 12;
const TURN_Q = 140;
/** The turns the chat shows, and the most of an answer kept. */
export const HISTORY_TURNS = 30;
const ANSWER_KEEP = 4_000;

/** One question and its answer, as the chat shows them. */
export interface ChatTurn { q: string; a: string; at: number }

export interface ChatThread {
  id: string;
  userId: string;
  projectId: string;
  summary: string;
  turns: number;
  lastQuestion: string;
  /** `path:line` of the last answer, each one that was checked against the code. */
  lastCites: string[];
  /** Where the last answer found the code to be: what a job made from this conversation is handed. */
  lastLocated: Located | null;
  /** The last HISTORY_TURNS turns, oldest first. */
  history: ChatTurn[];
  createdAt: number;
  updatedAt: number;
}

export interface ThreadStore {
  get(userId: string, projectId: string, id: string): Promise<ChatThread | null>;
  put(t: ChatThread): Promise<ChatThread>;
  /** The person's threads on a project, newest first. */
  list(userId: string, projectId: string, limit?: number): Promise<ChatThread[]>;
  delete(userId: string, projectId: string, id: string): Promise<boolean>;
}

export const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const oneLine = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/** A turn as the summary keeps it: the question, and the files its answer rested on. */
export function turnLine(question: string, cites: readonly string[]): string {
  const files = [...new Set(cites.map((c) => c.replace(/:\d+$/, "")))].slice(0, 4);
  return `- ${oneLine(question, TURN_Q)}${files.length ? ` (${files.join(", ")})` : ""}`;
}

/**
 * The summary after one more turn: the lines of the turns before it, the new one last, and only the last SUMMARY_TURNS of them, under SUMMARY_MAX
 * characters (the oldest line goes first). Pure, and free.
 */
export function rollSummary(summary: string, question: string, cites: readonly string[]): string {
  const lines = summary.split("\n").map((l) => l.trim()).filter(Boolean);
  lines.push(turnLine(question, cites));
  let kept = lines.slice(-SUMMARY_TURNS);
  while (kept.length > 1 && kept.join("\n").length > SUMMARY_MAX) kept = kept.slice(1);
  const out = kept.join("\n");
  return out.length > SUMMARY_MAX ? `${out.slice(0, SUMMARY_MAX - 1).trimEnd()}…` : out;
}

/** A thread after a turn. */
export function afterTurn(t: ChatThread, o: { question: string; shown?: string; cites: readonly string[]; located: Located | null; now: number; answer?: string }): ChatThread {
  const turn: ChatTurn = { q: (o.shown ?? o.question).trim().slice(0, QUESTION_MAX), a: (o.answer ?? "").trim().slice(0, ANSWER_KEEP), at: o.now };
  return {
    ...t,
    summary: rollSummary(t.summary, o.question, o.cites),
    turns: t.turns + 1,
    lastQuestion: oneLine(o.question, QUESTION_MAX),
    lastCites: [...new Set(o.cites)].slice(0, CITES_MAX),
    lastLocated: o.located,
    history: [...t.history, turn].slice(-HISTORY_TURNS),
    updatedAt: o.now,
  };
}

export function newThread(userId: string, projectId: string, id: string, now: number): ChatThread {
  return { id, userId, projectId, summary: "", turns: 0, lastQuestion: "", lastCites: [], lastLocated: null, history: [], createdAt: now, updatedAt: now };
}

const clone = (t: ChatThread): ChatThread => structuredClone(t);

export class MemoryThreadStore implements ThreadStore {
  private rows = new Map<string, ChatThread>();
  async get(userId: string, projectId: string, id: string) {
    const t = this.rows.get(id);
    return t && t.userId === userId && t.projectId === projectId ? clone(t) : null;
  }
  async put(t: ChatThread) {
    const had = this.rows.get(t.id);
    // A thread belongs to the person and the project that made it.
    if (had && (had.userId !== t.userId || had.projectId !== t.projectId)) throw new Error("code chat store: that thread is not theirs");
    this.rows.set(t.id, clone(t));
    return clone(t);
  }
  async list(userId: string, projectId: string, limit = 20) {
    return [...this.rows.values()].reverse().filter((t) => t.userId === userId && t.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit).map(clone);
  }
  async delete(userId: string, projectId: string, id: string) {
    const t = this.rows.get(id);
    if (!t || t.userId !== userId || t.projectId !== projectId) return false;
    return this.rows.delete(id);
  }
}

// ------------------------------------------------------------------ supabase

interface Row {
  id: string; user_id: string; project_id: string; summary: string | null; turns: number | null; last_question: string | null;
  last_cites: string[] | null; last_located: unknown; created_at: string; updated_at: string;
}

const ms = (v: unknown): number => { const n = typeof v === "string" ? Date.parse(v) : NaN; return Number.isFinite(n) ? n : 0; };

/** last_located as it is kept: { located, history }, or (a row written before the history) the located files alone. */
function lastOf(v: unknown): { located: Located | null; history: ChatTurn[] } {
  if (!v || typeof v !== "object") return { located: null, history: [] };
  const o = v as { located?: unknown; history?: unknown };
  if (!Array.isArray(o.history)) return { located: v as Located, history: [] };
  const history = o.history.filter((h): h is ChatTurn => !!h && typeof h === "object" && typeof (h as ChatTurn).q === "string" && typeof (h as ChatTurn).a === "string")
    .map((h) => ({ q: h.q, a: h.a, at: typeof h.at === "number" ? h.at : 0 }));
  return { located: o.located && typeof o.located === "object" ? (o.located as Located) : null, history };
}

const threadOf = (r: Row): ChatThread => {
  const last = lastOf(r.last_located);
  return {
    id: r.id, userId: r.user_id, projectId: r.project_id, summary: r.summary ?? "", turns: typeof r.turns === "number" ? r.turns : 0,
    lastQuestion: r.last_question ?? "", lastCites: Array.isArray(r.last_cites) ? r.last_cites.filter((c) => typeof c === "string") : [],
    lastLocated: last.located, history: last.history, createdAt: ms(r.created_at), updatedAt: ms(r.updated_at),
  };
};

function ok<T>(res: { data: T | null; error: { message: string } | null }): T | null {
  if (res.error) throw new Error(`code chat store: ${res.error.message}`);
  return res.data;
}

export class SupabaseThreadStore implements ThreadStore {
  constructor(private readonly sb: SupabaseClient) {}

  private ids(userId: string, projectId: string, id?: string): boolean {
    return THREAD_ID.test(userId) && THREAD_ID.test(projectId) && (id === undefined || THREAD_ID.test(id));
  }

  async get(userId: string, projectId: string, id: string) {
    if (!this.ids(userId, projectId, id)) return null;
    const r = ok(await this.sb.from("code_chat_threads").select("*").eq("id", id).eq("user_id", userId).eq("project_id", projectId).maybeSingle<Row>());
    return r ? threadOf(r) : null;
  }
  async put(t: ChatThread) {
    if (!this.ids(t.userId, t.projectId, t.id)) throw new Error("code chat store: not a thread of a signed-in person");
    const r = ok(await this.sb.from("code_chat_threads").upsert({
      id: t.id, user_id: t.userId, project_id: t.projectId, summary: t.summary.slice(0, 2000), turns: t.turns, last_question: t.lastQuestion.slice(0, 1000),
      last_cites: t.lastCites, last_located: { located: t.lastLocated, history: t.history.slice(-HISTORY_TURNS) }, updated_at: new Date(t.updatedAt).toISOString(),
    }, { onConflict: "id" }).select("*").single<Row>());
    return threadOf(r!);
  }
  async list(userId: string, projectId: string, limit = 20) {
    if (!this.ids(userId, projectId)) return [];
    const rows = ok(await this.sb.from("code_chat_threads").select("*").eq("user_id", userId).eq("project_id", projectId)
      .order("updated_at", { ascending: false }).limit(limit).returns<Row[]>());
    return (rows ?? []).map(threadOf);
  }
  async delete(userId: string, projectId: string, id: string) {
    if (!this.ids(userId, projectId, id)) return false;
    const gone = ok(await this.sb.from("code_chat_threads").delete().eq("id", id).eq("user_id", userId).eq("project_id", projectId).select("id").returns<Array<{ id: string }>>());
    return (gone ?? []).length > 0;
  }
}

// ------------------------------------------------------------------ the one

let current: ThreadStore | null = null;

/** Supabase when the service client exists, else memory (tests, local runs). */
export function threadStore(): ThreadStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseThreadStore(sb) : new MemoryThreadStore();
  }
  return current;
}

export function resetThreadStoreForTests(): void { current = null; }
