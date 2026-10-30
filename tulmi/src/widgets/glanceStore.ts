/**
 * WHAT THE X0 WIDGET REMEMBERS PER PERSON (docs/widget-glance-v2.md), and the Live Activity tokens its pushes go to (section 6).
 *
 *   glance state     seen     what the person has seen of what finished: one time per thing (id -> ms) and `all` (everything that ended
 *                             before it). A finished job is "the last thing done" only while it ended after both. Marked when they open
 *                             the job's page or Activity in the app (server.ts), and when they answer from outside it (routes/widgets.ts)
 *                    lastAt   their newest glance; sinceAt the end of their look before (glances closer than x0.lookGapMin are one look),
 *                             what "since you last looked" counts from
 *                    digest   the AI digest's line for one set of changes (digest.ts): written once per change, read until the next
 *   activity tokens  one per person and Code bot job: the Live Activity's APNs push token, its environment, the app's language (English or
 *                    Hinglish), and the last state sent (a
 *                    signature, so a change nobody would see is not pushed). Dropped when the job ends or Apple says the token is gone
 *
 * Migration 0059 (widget_glance, widget_activity_tokens), with memory twins for tests and a server with no Supabase (a restart forgets: the
 * widget then shows a finished job until it is opened, and the Live Activity is updated by the app alone until it registers again). Written
 * with the service key; no person's token reads either table.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";

/** Things remembered as seen, at most (the newest are kept). */
export const SEEN_MAX = 100;

export interface GlanceState {
  seen: Record<string, number>;
  /** Everything that ended at or before this was seen (ms; 0: nothing). */
  all: number;
  lastAt: number | null;
  sinceAt: number | null;
  digest?: { sig: string; line: string | null; at: number };
}

export const emptyGlanceState = (): GlanceState => ({ seen: {}, all: 0, lastAt: null, sinceAt: null });

export interface GlanceStore {
  get(userId: string): Promise<GlanceState>;
  /** Read, change and write one person's state. The change is pure; a lost race loses a seen mark at worst. */
  update(userId: string, fn: (s: GlanceState) => GlanceState): Promise<GlanceState>;
}

/** A state read back from storage, whatever it holds: what is wrong is left out. */
export function cleanGlanceState(raw: unknown): GlanceState {
  const s = emptyGlanceState();
  if (!raw || typeof raw !== "object") return s;
  const r = raw as Record<string, unknown>;
  const ms = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  if (r.seen && typeof r.seen === "object") {
    for (const [k, v] of Object.entries(r.seen as Record<string, unknown>)) if (k.length <= 120 && ms(v)) s.seen[k] = v as number;
  }
  s.all = ms(r.all) ?? 0;
  s.lastAt = ms(r.lastAt);
  s.sinceAt = ms(r.sinceAt);
  const d = r.digest as { sig?: unknown; line?: unknown; at?: unknown } | undefined;
  if (d && typeof d.sig === "string" && (typeof d.line === "string" || d.line === null) && ms(d.at)) s.digest = { sig: d.sig, line: d.line, at: d.at as number };
  return s;
}

/** Seen: these things now, or (`all`) everything that has ended until now. The newest SEEN_MAX are kept. */
export function withSeen(s: GlanceState, o: { ids?: readonly string[]; all?: boolean }, now: number): GlanceState {
  const seen = { ...s.seen };
  for (const id of o.ids ?? []) if (id && id.length <= 120) seen[id] = now;
  const kept = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, SEEN_MAX);
  return { ...s, seen: Object.fromEntries(kept), all: o.all ? Math.max(s.all, now) : s.all };
}

/** A glance at `now`: the look before ends where the last glance was, unless this one is part of the same look (closer than gapMs). */
export function withGlance(s: GlanceState, now: number, gapMs: number): GlanceState {
  const newLook = s.lastAt === null || now - s.lastAt >= gapMs;
  return { ...s, sinceAt: newLook ? s.lastAt : s.sinceAt, lastAt: now };
}

/** Whether a thing that ended at `endedAt` is still unseen. */
export function unseen(s: Pick<GlanceState, "seen" | "all">, id: string, endedAt: number): boolean {
  return endedAt > s.all && endedAt > (s.seen[id] ?? 0);
}

export class MemoryGlanceStore implements GlanceStore {
  private rows = new Map<string, GlanceState>();
  async get(userId: string): Promise<GlanceState> { return structuredClone(this.rows.get(userId) ?? emptyGlanceState()); }
  async update(userId: string, fn: (s: GlanceState) => GlanceState): Promise<GlanceState> {
    const next = cleanGlanceState(fn(await this.get(userId)));
    this.rows.set(userId, next);
    return structuredClone(next);
  }
}

const GLANCE = "widget_glance";

export class SupabaseGlanceStore implements GlanceStore {
  constructor(private readonly sb: SupabaseClient) {}
  async get(userId: string): Promise<GlanceState> {
    const { data, error } = await this.sb.from(GLANCE).select("state").eq("user_id", userId).maybeSingle<{ state: unknown }>();
    if (error) throw new Error(`${GLANCE}: read failed: ${error.message}`);
    return cleanGlanceState(data?.state);
  }
  async update(userId: string, fn: (s: GlanceState) => GlanceState): Promise<GlanceState> {
    const next = cleanGlanceState(fn(await this.get(userId)));
    const { error } = await this.sb.from(GLANCE).upsert({ user_id: userId, state: next, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw new Error(`${GLANCE}: write failed: ${error.message}`);
    return next;
  }
}

let glance: GlanceStore | null = null;
/** Supabase when the server has it, else memory. */
export function glanceStore(): GlanceStore {
  if (!glance) { const sb = supabase(); glance = sb ? new SupabaseGlanceStore(sb) : new MemoryGlanceStore(); }
  return glance;
}

/** Mark things seen for a person. Never throws: a lost mark shows a finished job a little longer. */
export async function markSeen(userId: string, o: { ids?: readonly string[]; all?: boolean }, now = Date.now(), store: GlanceStore = glanceStore()): Promise<void> {
  if (!userId || (!o.ids?.length && !o.all)) return;
  await store.update(userId, (s) => withSeen(s, o, now)).catch(() => undefined);
}

// ------------------------------------------------------------------ Live Activity tokens

export type ApnsEnv = "production" | "sandbox";

/** A Live Activity push token as iOS gives it: hex. */
export const ACTIVITY_TOKEN_RE = /^[0-9a-f]{32,512}$/;
/** A job id, as the stores make them. */
export const JOB_ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;

/** `hg`: the app's language was Hinglish when it registered (the fill-in lines it is pushed in). */
export interface ActivityToken { token: string; env: ApnsEnv; hg: boolean; sent: string | null; at: number }

export interface ActivityTokenStore {
  put(userId: string, jobId: string, token: string, env: ApnsEnv, hg: boolean, now: number): Promise<void>;
  get(userId: string, jobId: string): Promise<ActivityToken | null>;
  /** The signature of the state last pushed. */
  sent(userId: string, jobId: string, sig: string, now: number): Promise<void>;
  drop(userId: string, jobId: string): Promise<void>;
}

export class MemoryActivityTokenStore implements ActivityTokenStore {
  private rows = new Map<string, ActivityToken>();
  private k = (u: string, j: string) => `${u}\u0000${j}`;
  async put(userId: string, jobId: string, token: string, env: ApnsEnv, hg: boolean, now: number) {
    const before = this.rows.get(this.k(userId, jobId));
    // A new token for the same activity starts over: the state it last had was sent to the old one.
    this.rows.set(this.k(userId, jobId), { token, env, hg, sent: before?.token === token ? before.sent : null, at: now });
  }
  async get(userId: string, jobId: string) { const r = this.rows.get(this.k(userId, jobId)); return r ? { ...r } : null; }
  async sent(userId: string, jobId: string, sig: string, now: number) {
    const r = this.rows.get(this.k(userId, jobId));
    if (r) this.rows.set(this.k(userId, jobId), { ...r, sent: sig, at: now });
  }
  async drop(userId: string, jobId: string) { this.rows.delete(this.k(userId, jobId)); }
}

const TOKENS = "widget_activity_tokens";
interface TokenRow { token: string; env: ApnsEnv; hg: boolean | null; sent: string | null; updated_at: string }

export class SupabaseActivityTokenStore implements ActivityTokenStore {
  constructor(private readonly sb: SupabaseClient) {}
  async put(userId: string, jobId: string, token: string, env: ApnsEnv, hg: boolean, now: number) {
    const before = await this.get(userId, jobId);
    const { error } = await this.sb.from(TOKENS).upsert({
      user_id: userId, job_id: jobId, token, env, hg, sent: before?.token === token ? before.sent : null, updated_at: new Date(now).toISOString(),
    }, { onConflict: "user_id,job_id" });
    if (error) throw new Error(`${TOKENS}: write failed: ${error.message}`);
  }
  async get(userId: string, jobId: string): Promise<ActivityToken | null> {
    const { data, error } = await this.sb.from(TOKENS).select("token, env, hg, sent, updated_at").eq("user_id", userId).eq("job_id", jobId).maybeSingle<TokenRow>();
    if (error) throw new Error(`${TOKENS}: read failed: ${error.message}`);
    return data ? { token: data.token, env: data.env === "sandbox" ? "sandbox" : "production", hg: data.hg === true, sent: data.sent ?? null, at: Date.parse(data.updated_at) || 0 } : null;
  }
  async sent(userId: string, jobId: string, sig: string, now: number) {
    const { error } = await this.sb.from(TOKENS).update({ sent: sig, updated_at: new Date(now).toISOString() }).eq("user_id", userId).eq("job_id", jobId);
    if (error) throw new Error(`${TOKENS}: write failed: ${error.message}`);
  }
  async drop(userId: string, jobId: string) {
    const { error } = await this.sb.from(TOKENS).delete().eq("user_id", userId).eq("job_id", jobId);
    if (error) throw new Error(`${TOKENS}: delete failed: ${error.message}`);
  }
}

let tokens: ActivityTokenStore | null = null;
export function activityTokenStore(): ActivityTokenStore {
  if (!tokens) { const sb = supabase(); tokens = sb ? new SupabaseActivityTokenStore(sb) : new MemoryActivityTokenStore(); }
  return tokens;
}

export function resetGlanceStoresForTests(): void { glance = null; tokens = null; }
