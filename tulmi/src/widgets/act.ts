/**
 * ANSWERING FROM OUTSIDE THE APP: POST /v1/widgets/act, the one door a widget's button, a notification's button and a reply typed
 * into a notification all go through (routes/widgets.ts). It does what the app's own screens do, through the same services and
 * the same checks, and nothing else:
 *
 *   a0, a1…   answer a bot's question with its first, second… answer           job:<id>:<q>          needs.answer
 *   yes / no  say yes or no to a connected app's call waiting for one            task:<id>[:<approval>] needs.answer
 *   done      tick a task or plan someone in a space gave you                    stask:<space>:<task>   task.done
 *   reply     send a message to a chat (the words come with it)                  thread:<id>            session only
 *
 * WHO MAY. Everything is the person's own: the services check it again (a job is its owner's, a task's yes is its owner's, a space
 * task only for whom it is for, a chat only for who may write there). A widget's token (token.ts) may only do what its scopes say,
 * and only in the ways `widgets.needs.modes` lets a widget answer in place. A yes a connected app waits for is answered from outside
 * the app only at the risks in `widgets.needs.inPlaceRisks` (never a payment, never a deletion, by default), from a widget or a
 * notification alike. A question's answer is its OWN answer, read again here: a button sends `a0`, never words, and an item minted
 * for one question (its fingerprint) never answers the next.
 *
 * ONCE. Each answer is claimed under a key before it runs (the app's own key, or the item and the button): a retry of one that
 * went through gets the first answer (`repeat: true`), one still out gets 409 in_progress, and one that failed is let go so trying
 * again does try again. A reply must bring its own key (two "ok"s minutes apart are two messages). Migration 0058 (quick_actions),
 * with a memory twin; kept for KEEP_DAYS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import { parseItem, questionMark, type QuickItem } from "./items.js";
import type { WidgetScope } from "./token.js";

export const KEEP_DAYS = 7;
export const STALE_MS = 2 * 60_000;
/** An idempotency key, as the apps make it. */
export const KEY_RE = /^[A-Za-z0-9_.:-]{8,120}$/;

// ------------------------------------------------------------------ once

export type ActClaim = { state: "new" } | { state: "sending" } | { state: "sent"; reply: unknown };

export interface QuickActionStore {
  claim(userId: string, key: string, now: number): Promise<ActClaim>;
  done(userId: string, key: string, reply: unknown, now: number): Promise<void>;
  release(userId: string, key: string): Promise<void>;
}

export class MemoryQuickActionStore implements QuickActionStore {
  private rows = new Map<string, { state: "sending" | "sent"; at: number; reply: unknown }>();
  private k = (u: string, key: string) => `${u}\u0000${key}`;
  async claim(userId: string, key: string, now: number): Promise<ActClaim> {
    const r = this.rows.get(this.k(userId, key));
    if (r?.state === "sent") return { state: "sent", reply: r.reply };
    if (r && now - r.at < STALE_MS) return { state: "sending" };
    this.rows.set(this.k(userId, key), { state: "sending", at: now, reply: null });
    return { state: "new" };
  }
  async done(userId: string, key: string, reply: unknown, now: number) {
    this.rows.set(this.k(userId, key), { state: "sent", at: now, reply });
    for (const [k, r] of this.rows) if (now - r.at > KEEP_DAYS * 86_400_000) this.rows.delete(k);
  }
  async release(userId: string, key: string) {
    const k = this.k(userId, key);
    if (this.rows.get(k)?.state === "sending") this.rows.delete(k);
  }
}

const TABLE = "quick_actions";
interface DbRow { state: "sending" | "sent"; claimed_at: string; reply: unknown }

export class SupabaseQuickActionStore implements QuickActionStore {
  constructor(private readonly sb: SupabaseClient) {}

  async claim(userId: string, key: string, now: number, again = true): Promise<ActClaim> {
    const at = new Date(now).toISOString();
    const { error } = await this.sb.from(TABLE).insert({ user_id: userId, key, state: "sending", claimed_at: at });
    if (!error) return { state: "new" };
    if (error.code !== "23505") throw new Error(`${TABLE}: claim failed: ${error.message}`);
    const { data, error: readError } = await this.sb.from(TABLE).select("state, claimed_at, reply").eq("user_id", userId).eq("key", key).maybeSingle<DbRow>();
    if (readError) throw new Error(`${TABLE}: read failed: ${readError.message}`);
    if (!data) return again ? this.claim(userId, key, now, false) : { state: "sending" };
    if (data.state === "sent") return { state: "sent", reply: data.reply };
    if (now - Date.parse(data.claimed_at) < STALE_MS) return { state: "sending" };
    // Abandoned mid-way: taken again only by whoever moves its time first.
    const { data: took, error: takeError } = await this.sb.from(TABLE).update({ claimed_at: at })
      .eq("user_id", userId).eq("key", key).eq("state", "sending").eq("claimed_at", data.claimed_at).select("key");
    if (takeError) throw new Error(`${TABLE}: claim failed: ${takeError.message}`);
    return (took ?? []).length ? { state: "new" } : { state: "sending" };
  }

  async done(userId: string, key: string, reply: unknown, now: number) {
    const { error } = await this.sb.from(TABLE).update({ state: "sent", reply, claimed_at: new Date(now).toISOString() }).eq("user_id", userId).eq("key", key);
    if (error) throw new Error(`${TABLE}: done failed: ${error.message}`);
    void this.sb.from(TABLE).delete().eq("user_id", userId).lt("claimed_at", new Date(now - KEEP_DAYS * 86_400_000).toISOString()).then(() => undefined, () => undefined);
  }

  async release(userId: string, key: string) {
    const { error } = await this.sb.from(TABLE).delete().eq("user_id", userId).eq("key", key).eq("state", "sending");
    if (error) throw new Error(`${TABLE}: release failed: ${error.message}`);
  }
}

let current: QuickActionStore | null = null;
export function quickActionStore(): QuickActionStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseQuickActionStore(sb) : new MemoryQuickActionStore();
  }
  return current;
}
export function resetQuickActionStoreForTests(): void { current = null; }

// ------------------------------------------------------------------ doing it

/** The services an answer goes through: the same ones the app's own routes use. Any may be absent (its feature is off). */
export interface ActParts {
  /** A space's task: Done, for the person's own part (spaceTasks.ts answer). */
  spaceTasks: { answer(userId: string, spaceId: string, id: string, b: Record<string, unknown>): Promise<unknown> } | null;
  /** A chat: a message (threads.ts send). */
  threads: { send(userId: string, threadId: string, o: { text?: unknown }): Promise<unknown> } | null;
  /** A connected app's waiting call: what it is (its risk), and yes or no (connectors/tasks.ts). */
  approvals: {
    risk(userId: string, taskId: string): Promise<{ risk: string; approvalId: string; waiting: boolean } | null>;
    approve(userId: string, taskId: string, approvalId?: string): Promise<{ status: string; error?: { message?: string } }>;
    deny(userId: string, taskId: string): Promise<{ status: string }>;
  } | null;
  /** A Xode job: its question now (jobs/router.ts + deps.ts jobLite), and the answer (agent/orchestrator.ts answer). */
  jobs: {
    question(userId: string, jobId: string): Promise<{ text: string; options: string[] } | null>;
    answer(userId: string, jobId: string, answer: string): Promise<unknown>;
  } | null;
}

export interface ActPolicy {
  /** Risks a connected app's yes may be given at from outside the app. */
  inPlaceRisks: string[];
  /** Per kind: "inPlace" or "open" (a widget may only answer in place where it is "inPlace"). */
  modes: Record<string, unknown>;
  /** Answering with a widget token at all. */
  tokenEnabled: boolean;
}

export type ActVia = { kind: "session" } | { kind: "widget"; scopes: WidgetScope[] };

export interface ActRequest { item: unknown; action: unknown; text?: unknown; key?: unknown }

export interface ActResult { status: number; body: Record<string, unknown> }

const MAX_REPLY = 4000;
const ok = (state: string, extra: Record<string, unknown> = {}): ActResult => ({ status: 200, body: { ok: true, state, ...extra } });
const no = (status: number, code: string, message: string): ActResult => ({ status, body: { ok: false, code, message } });

/** Which kind of row an item is, for widgets.needs.modes. */
function modeKind(item: QuickItem): string {
  return item.kind === "job" ? "question" : item.kind === "task" ? "approval" : item.kind === "stask" ? "task" : item.kind;
}

/** What a button needs to be allowed, by what answers it. */
function scopeFor(item: QuickItem, action: string): WidgetScope | "session" | null {
  if (item.kind === "job" && /^a\d{1,2}$/.test(action)) return "needs.answer";
  if (item.kind === "task" && (action === "yes" || action === "no")) return "needs.answer";
  if (item.kind === "stask" && action === "done") return "task.done";
  if (item.kind === "thread" && action === "reply") return "session";
  return null;
}

/** A thrown error of the services, as a status and plain words. */
function failed(err: unknown): ActResult {
  const e = err as { status?: unknown; code?: unknown; message?: unknown };
  const code = typeof e?.code === "string" ? e.code : "";
  // A BotError says its status; a ConnectorError only its code.
  const byCode: Record<string, number> = { bad_request: 400, not_found: 404, not_allowed: 403, too_large: 413 };
  const status = typeof e?.status === "number" && e.status >= 400 && e.status < 500 ? e.status : byCode[code] ?? 0;
  const message = typeof e?.message === "string" ? e.message : "";
  if (code === "not_waiting" || /isn't waiting|not waiting/i.test(message)) return no(409, "not_waiting", "That was already answered.");
  if (status) return no(status, code || "refused", message || "Couldn't do that.");
  return no(500, "failed", "Couldn't do that just now.");
}

export class QuickActs {
  constructor(
    private readonly parts: ActParts,
    private readonly store: QuickActionStore = quickActionStore(),
    private readonly now: () => number = Date.now,
  ) {}

  /** One answer, by one person, through one door. Never throws: every outcome is a status and a body. */
  async run(userId: string, req: ActRequest, via: ActVia, policy: ActPolicy): Promise<ActResult> {
    const item = parseItem(req.item);
    const action = typeof req.action === "string" ? req.action : "";
    if (!item || !/^[a-z0-9_]{1,24}$/.test(action)) return no(400, "bad_request", "That isn't something that can be answered here.");
    const need = scopeFor(item, action);
    if (!need) return no(400, "bad_request", "That button doesn't do anything here.");
    if (via.kind === "widget") {
      // A widget's token: only its scopes, only where the server lets a widget answer in place, never a reply.
      if (!policy.tokenEnabled) return no(403, "open_app", "Open X0 to answer.");
      if (need === "session" || !via.scopes.includes(need)) return no(403, "not_allowed", "Open X0 to do that.");
      if (policy.modes[modeKind(item)] === "open") return no(403, "open_app", "Open X0 to answer.");
    }
    const text = typeof req.text === "string" ? req.text.replace(/\r/g, "").trim() : "";
    if (action === "reply" && !text) return no(400, "bad_request", "Type something first.");
    if (text.length > MAX_REPLY) return no(413, "too_large", `A message can be ${MAX_REPLY} characters.`);
    const given = typeof req.key === "string" && KEY_RE.test(req.key) ? req.key : "";
    if (action === "reply" && !given) return no(400, "bad_request", "A reply needs its key.");
    const key = given || `${typeof req.item === "string" ? req.item : ""}|${action}`;

    const now = this.now();
    let claim: ActClaim;
    try { claim = await this.store.claim(userId, key, now); } catch { return no(503, "busy", "Couldn't do that just now."); }
    if (claim.state === "sent") return { status: 200, body: { ...(claim.reply as Record<string, unknown>), repeat: true } };
    if (claim.state === "sending") return no(409, "in_progress", "That's being done now.");

    let out: ActResult;
    try { out = await this.perform(userId, item, action, text, policy); } catch (err) { out = failed(err); }
    try {
      if (out.status === 200) await this.store.done(userId, key, out.body, this.now());
      else await this.store.release(userId, key);
    } catch { /* the answer stands; only a retry's shortcut is lost */ }
    return out;
  }

  private async perform(userId: string, item: QuickItem, action: string, text: string, policy: ActPolicy): Promise<ActResult> {
    switch (item.kind) {
      case "stask": {
        if (!this.parts.spaceTasks) return no(404, "off", "That isn't there any more.");
        await this.parts.spaceTasks.answer(userId, item.spaceId, item.taskId, { status: "done" });
        return ok("done");
      }
      case "thread": {
        if (!this.parts.threads) return no(404, "off", "That chat isn't there any more.");
        await this.parts.threads.send(userId, item.threadId, { text });
        return ok("sent");
      }
      case "task": {
        const a = this.parts.approvals;
        if (!a) return no(404, "off", "That isn't there any more.");
        const now = await a.risk(userId, item.taskId);
        if (!now) return no(404, "not_found", "That isn't there any more.");
        if (!now.waiting || (item.approvalId && item.approvalId !== now.approvalId)) return no(409, "not_waiting", "That was already answered.");
        if (!policy.inPlaceRisks.includes(now.risk)) return no(403, "open_app", "Open X0 to answer this one.");
        if (action === "no") {
          const r = await a.deny(userId, item.taskId);
          return r.status === "ok" ? ok("done") : r.status === "not_waiting" ? no(409, "not_waiting", "That was already answered.") : no(404, "not_found", "That isn't there any more.");
        }
        const r = await a.approve(userId, item.taskId, item.approvalId ?? now.approvalId);
        if (r.status === "ok") return ok("done");
        if (r.status === "not_waiting") return no(409, "not_waiting", "That was already answered.");
        if (r.status === "expired") return no(410, "expired", "That request ran out. Ask again in X0.");
        if (r.status === "failed") return ok("failed", { message: r.error?.message ?? "It didn't go through." });
        return no(404, "not_found", "That isn't there any more.");
      }
      case "job": {
        const j = this.parts.jobs;
        if (!j) return no(404, "off", "That isn't there any more.");
        const q = await j.question(userId, item.jobId);
        if (!q) return no(409, "not_waiting", "That was already answered.");
        if (questionMark(q.text) !== item.q) return no(409, "changed", "The question changed. Open X0 to see it.");
        const said = q.options.map((o) => o.trim()).filter(Boolean)[Number(action.slice(1))];
        if (!said) return no(400, "bad_request", "That isn't one of its answers.");
        await j.answer(userId, item.jobId, said);
        return ok("done");
      }
      default:
        return no(400, "bad_request", "That can only be opened.");
    }
  }
}
