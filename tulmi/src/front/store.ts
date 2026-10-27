/**
 * THE DECISION LOG: ONE ROW FOR EVERY MESSAGE THE FRONT DOOR ANSWERED, AND WHAT BECAME OF IT.
 *
 * Each message that was decided and answered leaves one row: whose, when, what it was taken for (intent), where it went (route, tier),
 * which visual was made (if any), how sure the front door was, what it cost in paise, how long it took, and its OUTCOME:
 *
 *   ok             nothing happened to it after (the default)
 *   rephrased      the same person sent a similar message within 60 seconds: the answer did not do
 *   visual_closed  they closed the visual that came with the answer
 *   visual_kept    they kept it (saved it, opened it, built it)
 *   thumbs_up / thumbs_down
 *
 * NOTHING THEY SAID OR WERE ANSWERED IS KEPT: a row holds the categories and numbers above, never the message, the reply or a file's name.
 * That is why it can be kept at all, and why learn.ts can learn from it without anyone reading anyone's words.
 *
 * It is written with the service key only; a person's own token can read their own rows (migration 0033, owner-read RLS). The memory
 * twin is what tests and local runs use. Both are bounded: the summary reads at most the last SUMMARY_ROWS rows of the last 30 days.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { supabase } from "../auth/supabase.js";
import type { ModelTier } from "../code/brain/tiers.js";
import { INTENTS, OUTCOMES, VISUAL_KINDS, type Intent, type Outcome, type RouteName, type Via, type VisualKind } from "./types.js";

export interface DecisionRow {
  id: string;
  userId: string;
  at: number;
  intent: Intent;
  route: RouteName;
  tier: ModelTier;
  visual: VisualKind | null;
  confidence: number;
  costPaise: number;
  latencyMs: number;
  outcome: Outcome;
  via: Via;
}

export type NewRow = Omit<DecisionRow, "id" | "outcome"> & { outcome?: Outcome };

/** What learn.ts needs to know of a person's past, as counts. */
export interface Summary {
  rows: number;
  visual: { kept: number; closed: number };
  byIntent: Partial<Record<Intent, { n: number; rephrased: number; down: number; up: number }>>;
}

export const SUMMARY_ROWS = 300;
export const SUMMARY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** An outcome from the person (a tap) replaces any other; "rephrased" only replaces "ok". */
const PERSON_OUTCOMES: readonly Outcome[] = ["visual_closed", "visual_kept", "thumbs_up", "thumbs_down"];

export interface FrontStore {
  add(row: NewRow): Promise<string>;
  /** Sets the outcome of one of the person's rows. False when it is not theirs, or it is "rephrased" and the row had already moved on. */
  setOutcome(userId: string, id: string, outcome: Outcome): Promise<boolean>;
  summary(userId: string, now?: number): Promise<Summary>;
  /** The person's latest rows, newest first (for tests and the admin). */
  recent(userId: string, limit?: number): Promise<DecisionRow[]>;
}

export function summarise(rows: readonly Pick<DecisionRow, "intent" | "visual" | "outcome">[]): Summary {
  const s: Summary = { rows: rows.length, visual: { kept: 0, closed: 0 }, byIntent: {} };
  for (const r of rows) {
    const b = (s.byIntent[r.intent] ??= { n: 0, rephrased: 0, down: 0, up: 0 });
    b.n += 1;
    if (r.outcome === "rephrased") b.rephrased += 1;
    else if (r.outcome === "thumbs_down") b.down += 1;
    else if (r.outcome === "thumbs_up") b.up += 1;
    if (r.outcome === "visual_kept") s.visual.kept += 1;
    else if (r.outcome === "visual_closed") s.visual.closed += 1;
  }
  return s;
}

const clean = (row: NewRow): NewRow => ({
  ...row,
  confidence: Math.min(1, Math.max(0, Number.isFinite(row.confidence) ? row.confidence : 0)),
  costPaise: Math.max(0, Math.round(row.costPaise) || 0),
  latencyMs: Math.max(0, Math.round(row.latencyMs) || 0),
});

// -------------------------------------------------------------------- memory

const MEMORY_ROWS_MAX = 20_000;

export class MemoryFrontStore implements FrontStore {
  private rows: DecisionRow[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  async add(row: NewRow): Promise<string> {
    const r = clean(row);
    const id = randomUUID();
    this.rows.push({ ...r, id, outcome: r.outcome ?? "ok" });
    if (this.rows.length > MEMORY_ROWS_MAX) this.rows.splice(0, this.rows.length - MEMORY_ROWS_MAX);
    return id;
  }

  async setOutcome(userId: string, id: string, outcome: Outcome): Promise<boolean> {
    const r = this.rows.find((x) => x.id === id && x.userId === userId);
    if (!r) return false;
    if (outcome === "rephrased" && r.outcome !== "ok") return false;
    r.outcome = outcome;
    return true;
  }

  async summary(userId: string, now: number = this.now()): Promise<Summary> {
    const from = now - SUMMARY_DAYS * DAY_MS;
    return summarise(this.rows.filter((r) => r.userId === userId && r.at >= from).slice(-SUMMARY_ROWS));
  }

  async recent(userId: string, limit = 20): Promise<DecisionRow[]> {
    return this.rows.filter((r) => r.userId === userId).slice(-limit).reverse().map((r) => ({ ...r }));
  }
}

// ------------------------------------------------------------------ supabase

interface Row {
  id: string; user_id: string; at: string; intent: string; route: string; tier: string; visual: string | null; confidence: number;
  cost_paise: number; latency_ms: number; outcome: string; via: string;
}

const known = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => ((list as readonly string[]).includes(String(v)) ? (v as T) : fallback);

const rowOf = (r: Row): DecisionRow => ({
  id: r.id, userId: r.user_id, at: Date.parse(r.at) || 0, intent: known(INTENTS, r.intent, "unclear"), route: r.route as RouteName, tier: r.tier as ModelTier,
  visual: r.visual === null ? null : known(VISUAL_KINDS, r.visual, "table"), confidence: Number(r.confidence) || 0, costPaise: Number(r.cost_paise) || 0,
  latencyMs: Number(r.latency_ms) || 0, outcome: known(OUTCOMES, r.outcome, "ok"), via: r.via === "model" ? "model" : "rules",
});

export class SupabaseFrontStore implements FrontStore {
  constructor(private readonly sb: SupabaseClient) {}

  async add(row: NewRow): Promise<string> {
    const r = clean(row);
    const { data, error } = await this.sb.from("front_decisions").insert({
      user_id: r.userId, at: new Date(r.at).toISOString(), intent: r.intent, route: r.route, tier: r.tier, visual: r.visual, confidence: r.confidence,
      cost_paise: r.costPaise, latency_ms: r.latencyMs, outcome: r.outcome ?? "ok", via: r.via,
    }).select("id").single();
    if (error) throw new Error(`front store: ${error.message}`);
    return String((data as { id: string }).id);
  }

  async setOutcome(userId: string, id: string, outcome: Outcome): Promise<boolean> {
    let q = this.sb.from("front_decisions").update({ outcome }).eq("id", id).eq("user_id", userId);
    // "rephrased" is the quietest word: it never replaces what the person said with a tap.
    if (outcome === "rephrased") q = q.eq("outcome", "ok");
    else if (!PERSON_OUTCOMES.includes(outcome)) q = q.eq("outcome", "ok");
    const { data, error } = await q.select("id");
    if (error) throw new Error(`front store: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }

  async summary(userId: string, now: number = Date.now()): Promise<Summary> {
    const { data, error } = await this.sb.from("front_decisions").select("intent, visual, outcome")
      .eq("user_id", userId).gte("at", new Date(now - SUMMARY_DAYS * DAY_MS).toISOString()).order("at", { ascending: false }).limit(SUMMARY_ROWS)
      .returns<Array<Pick<Row, "intent" | "visual" | "outcome">>>();
    if (error) throw new Error(`front store: ${error.message}`);
    return summarise((data ?? []).map((r) => ({ intent: known(INTENTS, r.intent, "unclear"), visual: r.visual as VisualKind | null, outcome: known(OUTCOMES, r.outcome, "ok") })));
  }

  async recent(userId: string, limit = 20): Promise<DecisionRow[]> {
    const { data, error } = await this.sb.from("front_decisions").select("*").eq("user_id", userId).order("at", { ascending: false }).limit(limit).returns<Row[]>();
    if (error) throw new Error(`front store: ${error.message}`);
    return (data ?? []).map(rowOf);
  }
}

// ------------------------------------------------------------------ the one

let current: FrontStore | null = null;

/** Supabase when the service client exists, else memory (tests, local runs). */
export function frontStore(): FrontStore {
  if (!current) {
    const sb = supabase();
    current = sb ? new SupabaseFrontStore(sb) : new MemoryFrontStore();
  }
  return current;
}

export function resetFrontStoreForTests(): void { current = null; }
