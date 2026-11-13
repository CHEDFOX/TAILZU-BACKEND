/**
 * WHAT THE X0 WIDGET REMEMBERS PER PERSON (docs/widget-glance-v2.md), and the Live Activity tokens its pushes go to (section 6).
 *
 *   glance state     seen     what the person has seen of what finished: one time per thing (id -> ms) and `all` (everything that ended
 *                             before it). A finished job is "the last thing done" only while it ended after both. Marked when they open
 *                             the job's page or Activity in the app (routes/app/appScreens.ts), and when they answer from outside it (routes/bots/widgets.ts)
 *                    lastAt   their newest glance; sinceAt the end of their look before (glances closer than x0.lookGapMin are one look),
 *                             what "since you last looked" counts from
 *                    digest   the AI digest's line for one set of changes (digest.ts): written once per change, read until the next
 *   activity tokens  one per person and Xode job: the Live Activity's APNs push token, its environment, the app's language (English or
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
const SEEN_MAX = 100;
/** Bad design ids remembered, at most. More than this and something is wrong with the catalog, not with one design. */
const BAD_LOOKS_MAX = 40;
/** A design id, as shared/types/nlook.ts NLOOK_LIMITS.idPattern spells it. */
const DESIGN_ID_RE = /^[a-z0-9._-]{1,40}$/;

export interface GlanceState {
  seen: Record<string, number>;
  /** Everything that ended at or before this was seen (ms; 0: nothing). */
  all: number;
  lastAt: number | null;
  sinceAt: number | null;
  digest?: { sig: string; line: string | null; at: number };
  /**
   * nlook designs this person's widgets marked BAD: the id, when it was reported, and the design's `since` AS IT WAS THEN
   * (experience/native/*; native/SPEC.md 3.7).
   * A widget writes a crash marker before it builds a design's root view and clears it after the snapshot pass; a marker from
   * another launch found at the next provider call is a strike, and two strikes mark the design bad. The app then tells us here
   * and the server stops naming that design — for this PERSON, not only for the phone that crashed, because a design that killed
   * one of their widgets is not something to try on their other phone either.
   *
   * The `since` is what makes the mark FORGETTABLE. A mark is only an id, and an id is reused: the design is fixed and
   * republished under the same name. Remembering the `since` it carried when it crashed means a LATER `since` — new
   * content under that id — is tried again, while the broken copy stays out. A mark with `since: 0` (an old row, written
   * before this field) is never forgotten, because nothing is known about which copy broke.
   */
  badLooks?: Record<string, BadLook>;
}

/** One reported-bad design: when it was reported, and the `since` the copy that crashed carried (0: not known). */
export interface BadLook { at: number; since: number }

/*
 * NOTHING ABOUT A PHONE IS REMEMBERED HERE. There was an `nl` and an `hg`, for the Android notice's data pushes to read.
 * Both are gone: `nl` is per PHONE and this row is per PERSON, so an iPhone's glance would write the number an Android
 * notice is then judged by, and it could only ever go up, which is the one direction that breaks target.ts's promise after
 * a reinstall. The notice's design is now named on the glance itself (the request that carries that phone's real `nl` and
 * `can`), and its language comes from the profile, like every other push.
 */

export const emptyGlanceState = (): GlanceState => ({ seen: {}, all: 0, lastAt: null, sinceAt: null });

export interface GlanceStore {
  get(userId: string): Promise<GlanceState>;
  /** Read, change and write one person's state. The change is pure; a lost race loses a seen mark at worst. */
  update(userId: string, fn: (s: GlanceState) => GlanceState): Promise<GlanceState>;
}

/** A state read back from storage, whatever it holds: what is wrong is left out. */
function cleanGlanceState(raw: unknown): GlanceState {
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
  if (r.badLooks && typeof r.badLooks === "object") {
    const bad: Record<string, BadLook> = {};
    for (const [k, v] of Object.entries(r.badLooks as Record<string, unknown>)) {
      if (!DESIGN_ID_RE.test(k)) continue;
      // A plain number is a row written before `since` was remembered: kept, and never forgotten.
      const at = ms(typeof v === "object" && v ? (v as { at?: unknown }).at : v);
      if (!at) continue;
      const since = typeof v === "object" && v ? Number((v as { since?: unknown }).since) : 0;
      bad[k] = { at, since: Number.isFinite(since) && since > 0 ? since : 0 };
    }
    const kept = Object.entries(bad).sort((a, b) => b[1].at - a[1].at).slice(0, BAD_LOOKS_MAX);
    if (kept.length) s.badLooks = Object.fromEntries(kept);
  }
  return s;
}

/** Seen: these things now, or (`all`) everything that has ended until now. The newest SEEN_MAX are kept. */
export function withSeen(s: GlanceState, o: { ids?: readonly string[]; all?: boolean }, now: number): GlanceState {
  const seen = { ...s.seen };
  for (const id of o.ids ?? []) if (id && id.length <= 120) seen[id] = now;
  const kept = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, SEEN_MAX);
  return { ...s, seen: Object.fromEntries(kept), all: o.all ? Math.max(s.all, now) : s.all };
}

/**
 * Designs a person's widgets reported bad, marked now, each with the `since` that copy carried. An id that is not a design
 * id is ignored rather than stored. `sinceOf` is the catalog's (experience/native/catalog.ts); absent, nothing is known
 * about the copy and the mark never expires.
 */
export function withBadLooks(s: GlanceState, ids: readonly string[], now: number, sinceOf?: (id: string) => number | undefined): GlanceState {
  const badLooks = { ...(s.badLooks ?? {}) };
  for (const id of ids) if (DESIGN_ID_RE.test(id)) badLooks[id] = { at: now, since: Number(sinceOf?.(id)) || 0 };
  const kept = Object.entries(badLooks).sort((a, b) => b[1].at - a[1].at).slice(0, BAD_LOOKS_MAX);
  return { ...s, badLooks: Object.fromEntries(kept) };
}

/**
 * The ids to keep OUT for this person: every mark whose design has not been republished since it crashed. A mark with no
 * `since` of its own, or one on a design the catalog no longer holds, stays — forgetting a mark is the unsafe direction.
 */
export function badLookIds(s: Pick<GlanceState, "badLooks">, sinceOf?: (id: string) => number | undefined): string[] {
  return Object.entries(s.badLooks ?? {})
    .filter(([id, m]) => {
      if (!m.since) return true;
      const now = Number(sinceOf?.(id));
      return !Number.isFinite(now) || now <= m.since;
    })
    .map(([id]) => id);
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

class SupabaseGlanceStore implements GlanceStore {
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

/**
 * `hg`: the app's language was Hinglish when it registered (the fill-in lines it is pushed in).
 * `nl`: the nlook catalog version that phone HELD then (migration 0088). A push names a design only when its `since` is at or
 * below this, so a phone can never be told to draw something it has not downloaded. 0 means it holds none.
 */
export interface ActivityToken { token: string; env: ApnsEnv; hg: boolean; nl: number; sent: string | null; at: number }

/**
 * The reserved job id that holds a person's PUSH-TO-START token (iOS 17.2+). It is one per person, not per job, because it starts
 * an activity for a job that has none yet. Job ids are made by the job stores and never look like this.
 */
export const START_TOKEN_JOB = "__start__";

/*
 * ONE ACCOUNT PER PHONE, for the start token. A sign-out is supposed to post `{ token: null }` first, but a session that
 * expires, an account deleted elsewhere and an offline sign-out all skip that. So when a start token is written for one
 * person, the SAME token is dropped from everyone else: the next account's first registration takes the phone over, and a
 * person who signed out of this phone can never have an activity started on it. (push_tokens does the same thing.)
 */

export interface ActivityTokenStore {
  put(userId: string, jobId: string, token: string, env: ApnsEnv, hg: boolean, now: number, nl?: number): Promise<void>;
  get(userId: string, jobId: string): Promise<ActivityToken | null>;
  /** The signature of the state last pushed. */
  sent(userId: string, jobId: string, sig: string, now: number): Promise<void>;
  drop(userId: string, jobId: string): Promise<void>;
  /**
   * The jobs of this person that have a live activity right now (never the push-to-start row). Push-to-start reads it to keep
   * its one rule: a person never gets a second "Bots at work" banner while one is already on their Lock Screen. Optional, so a
   * test's fake store needs it only when it tests that rule.
   */
  live?(userId: string): Promise<string[]>;
}

export class MemoryActivityTokenStore implements ActivityTokenStore {
  private rows = new Map<string, ActivityToken>();
  private k = (u: string, j: string) => `${u}\u0000${j}`;
  async put(userId: string, jobId: string, token: string, env: ApnsEnv, hg: boolean, now: number, nl = 0) {
    const before = this.rows.get(this.k(userId, jobId));
    if (jobId === START_TOKEN_JOB) {
      for (const [key, row] of [...this.rows]) {
        const [u, j] = key.split("\u0000");
        if (j === START_TOKEN_JOB && u !== userId && row.token === token) this.rows.delete(key);
      }
    }
    // A new token for the same activity starts over: the state it last had was sent to the old one.
    this.rows.set(this.k(userId, jobId), { token, env, hg, nl, sent: before?.token === token ? before.sent : null, at: now });
  }
  async get(userId: string, jobId: string) { const r = this.rows.get(this.k(userId, jobId)); return r ? { ...r } : null; }
  async sent(userId: string, jobId: string, sig: string, now: number) {
    const r = this.rows.get(this.k(userId, jobId));
    if (r) this.rows.set(this.k(userId, jobId), { ...r, sent: sig, at: now });
  }
  async drop(userId: string, jobId: string) { this.rows.delete(this.k(userId, jobId)); }
  async live(userId: string) {
    const out: string[] = [];
    for (const key of this.rows.keys()) {
      const [u, j] = key.split("\u0000");
      if (u === userId && j && j !== START_TOKEN_JOB) out.push(j);
    }
    return out;
  }
}

const TOKENS = "widget_activity_tokens";
interface TokenRow { token: string; env: ApnsEnv; hg: boolean | null; nl: number | null; sent: string | null; updated_at: string }

/** A PostgREST error that means "that column is not there": migration 0088 has not run on this database yet. */
const COLUMN_MISSING = /does not exist|could not find|schema cache/i;

export class SupabaseActivityTokenStore implements ActivityTokenStore {
  /**
   * Migration 0088 (widget_activity_tokens.nl) not run yet: the rows are read and written WITHOUT it, so every push still
   * goes out. `nl` then reads as 0, which means "this phone holds no catalog", so no design is ever named — the safe
   * direction, and the one the migration's own header promises. Per process, the same shape as push/store.ts's capsMissing.
   *
   * Without this, deploying this backend before 0088 broke the Live Activity for EVERY build, new and old: every read threw,
   * ActivityPusher read that as "no token" and pushed nothing at all.
   */
  private nlMissing = false;

  constructor(private readonly sb: SupabaseClient, private readonly warn: (msg: string) => void = console.warn) {}

  private noted(where: string): void {
    this.nlMissing = true;
    this.warn(`[widgets] widget_activity_tokens.nl missing — run migration 0088. ${where} without it until then; no design is named.`);
  }

  async put(userId: string, jobId: string, token: string, env: ApnsEnv, hg: boolean, now: number, nl = 0) {
    const before = await this.get(userId, jobId);
    if (jobId === START_TOKEN_JOB) {
      // Taken from the others FIRST, so a failed write below leaves nobody able to start an activity on this phone rather
      // than the person who just signed out of it.
      const drop = await this.sb.from(TOKENS).delete().eq("job_id", START_TOKEN_JOB).eq("token", token).neq("user_id", userId);
      if (drop.error) throw new Error(`${TOKENS}: could not take the start token from other accounts: ${drop.error.message}`);
    }
    const row: Record<string, unknown> = {
      user_id: userId, job_id: jobId, token, env, hg, sent: before?.token === token ? before.sent : null, updated_at: new Date(now).toISOString(),
    };
    const write = (withNl: boolean) => this.sb.from(TOKENS).upsert(withNl ? { ...row, nl } : row, { onConflict: "user_id,job_id" });
    let { error } = await write(!this.nlMissing);
    if (error && !this.nlMissing && COLUMN_MISSING.test(error.message)) {
      this.noted("Writing tokens");
      ({ error } = await write(false));
    }
    if (error) throw new Error(`${TOKENS}: write failed: ${error.message}`);
  }

  async get(userId: string, jobId: string): Promise<ActivityToken | null> {
    const read = (withNl: boolean) => this.sb
      .from(TOKENS).select(withNl ? "token, env, hg, nl, sent, updated_at" : "token, env, hg, sent, updated_at")
      .eq("user_id", userId).eq("job_id", jobId).maybeSingle<TokenRow>();
    let { data, error } = await read(!this.nlMissing);
    if (error && !this.nlMissing && COLUMN_MISSING.test(error.message)) {
      this.noted("Reading tokens");
      ({ data, error } = await read(false));
    }
    if (error) throw new Error(`${TOKENS}: read failed: ${error.message}`);
    return data ? {
      token: data.token, env: data.env === "sandbox" ? "sandbox" : "production", hg: data.hg === true,
      nl: Number(data.nl) || 0, sent: data.sent ?? null, at: Date.parse(data.updated_at) || 0,
    } : null;
  }
  async sent(userId: string, jobId: string, sig: string, now: number) {
    const { error } = await this.sb.from(TOKENS).update({ sent: sig, updated_at: new Date(now).toISOString() }).eq("user_id", userId).eq("job_id", jobId);
    if (error) throw new Error(`${TOKENS}: write failed: ${error.message}`);
  }
  async drop(userId: string, jobId: string) {
    const { error } = await this.sb.from(TOKENS).delete().eq("user_id", userId).eq("job_id", jobId);
    if (error) throw new Error(`${TOKENS}: delete failed: ${error.message}`);
  }
  async live(userId: string) {
    const { data, error } = await this.sb.from(TOKENS).select("job_id").eq("user_id", userId).neq("job_id", START_TOKEN_JOB).limit(20);
    if (error) throw new Error(`${TOKENS}: read failed: ${error.message}`);
    return (data ?? []).map((r) => String((r as { job_id: unknown }).job_id));
  }
}

let tokens: ActivityTokenStore | null = null;
export function activityTokenStore(): ActivityTokenStore {
  if (!tokens) { const sb = supabase(); tokens = sb ? new SupabaseActivityTokenStore(sb) : new MemoryActivityTokenStore(); }
  return tokens;
}

