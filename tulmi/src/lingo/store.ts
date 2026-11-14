/**
 * WHAT LINGO KEEPS: THE LANGUAGES A PERSON IS LEARNING, AND EVERY WORD AND PHRASE IN EACH.
 *
 *   lingo_learners   one row a person a language (migration 0087): the pair, their level, the minutes a day they asked
 *                    for, whether the bot may ring them, the voice, the streak
 *   lingo_items      one row a word or phrase, with where the scheduler has got to and how often it has been SAID
 *
 * The person's own: they can only READ their rows (owner-only RLS), the server writes with the service key, and it all
 * goes with the account. The memory twin is what tests and a server with no Supabase use; it is bounded.
 *
 * No language is special here and none is named anywhere: a course is a pair of tags on a row.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";
import { freshMemory } from "./schedule.js";
import type { ItemKind, ItemSource, Learner, Level, LingoItem, MemoryState } from "./types.js";

/** The tables an account owns, for deleting an account and their data. */
export const LINGO_USER_TABLES = ["lingo_learners", "lingo_items", "lingo_left"] as const;

/** At most this many items a person a course. Past it the weakest unseen ones are dropped before more are added. */
export const ITEMS_MAX = 5_000;

export interface NewItem {
  item: string;
  kind: ItemKind;
  gloss: string;
  source: ItemSource;
}

export interface LingoStore {
  /** Every course this person is taking, the one they opened last first. */
  courses(userId: string): Promise<Learner[]>;
  /** One course, or null. */
  course(userId: string, target: string): Promise<Learner | null>;
  /** Start or change a course. Returns it as kept. */
  setCourse(userId: string, learner: Learner, now: number): Promise<Learner>;
  /** Every item of one course. */
  items(userId: string, target: string): Promise<LingoItem[]>;
  /** Add what is not there yet; an item already known is left exactly as it is. Returns how many were new. */
  add(userId: string, target: string, items: readonly NewItem[], now: number): Promise<number>;
  /** Write back items that have just been answered. */
  save(userId: string, target: string, items: readonly LingoItem[], now: number): Promise<void>;
  forget(userId: string, target?: string): Promise<void>;
  /**
   * Why they stopped a language, kept as one line after the course has gone (migration 0092). An empty reason is a
   * complete answer: it is what "Just clean up" means.
   */
  left(userId: string, row: Left): Promise<void>;
}

/** One line about a course somebody stopped. Counts only — not a word of what they were learning. */
export interface Left {
  target: string;
  reason: string;
  words: number;
  learned: number;
  streak: number;
  days: number;
  leftMs: number;
}

/** The thing itself, tidied the one way everything here agrees on, so the same word is never learned twice. */
export const keyOf = (item: string): string => item.normalize("NFC").trim().replace(/\s+/g, " ");

export class MemoryLingoStore implements LingoStore {
  private readonly learners = new Map<string, Learner>();
  private readonly rows = new Map<string, LingoItem>();

  private static ck = (u: string, t: string): string => `${u}\u0000${t}`;
  private static ik = (u: string, t: string, i: string): string => `${u}\u0000${t}\u0000${i}`;

  async courses(userId: string): Promise<Learner[]> {
    return [...this.learners.entries()]
      .filter(([k]) => k.startsWith(`${userId}\u0000`))
      .map(([, v]) => ({ ...v }))
      .sort((a, b) => b.usedMs - a.usedMs);
  }

  async course(userId: string, target: string): Promise<Learner | null> {
    const r = this.learners.get(MemoryLingoStore.ck(userId, target));
    return r ? { ...r } : null;
  }

  async setCourse(userId: string, learner: Learner, now: number): Promise<Learner> {
    const kept: Learner = { ...learner, updatedMs: now };
    this.learners.set(MemoryLingoStore.ck(userId, learner.target), kept);
    return { ...kept };
  }

  async items(userId: string, target: string): Promise<LingoItem[]> {
    const pre = `${userId}\u0000${target}\u0000`;
    return [...this.rows.entries()].filter(([k]) => k.startsWith(pre)).map(([, v]) => ({ ...v, memory: { ...v.memory } }));
  }

  async add(userId: string, target: string, items: readonly NewItem[], now: number): Promise<number> {
    let added = 0;
    for (const raw of items) {
      const item = keyOf(raw.item);
      if (!item) continue;
      const k = MemoryLingoStore.ik(userId, target, item);
      if (this.rows.has(k)) continue;
      if ((await this.items(userId, target)).length >= ITEMS_MAX) break;
      this.rows.set(k, { item, kind: raw.kind, gloss: raw.gloss, source: raw.source, spoken: 0, memory: freshMemory(now) });
      added++;
    }
    return added;
  }

  async save(userId: string, target: string, items: readonly LingoItem[], _now: number): Promise<void> {
    for (const it of items) {
      const k = MemoryLingoStore.ik(userId, target, keyOf(it.item));
      if (this.rows.has(k)) this.rows.set(k, { ...it, memory: { ...it.memory } });
    }
  }

  async forget(userId: string, target?: string): Promise<void> {
    const pre = target === undefined ? `${userId}\u0000` : `${userId}\u0000${target}`;
    for (const k of [...this.learners.keys()]) if (k.startsWith(pre)) this.learners.delete(k);
    for (const k of [...this.rows.keys()]) if (k.startsWith(pre)) this.rows.delete(k);
  }

  readonly leftRows: (Left & { userId: string })[] = [];

  async left(userId: string, row: Left): Promise<void> {
    this.leftRows.push({ ...row, userId });
  }
}

interface LearnerRow {
  target: string; from_lang: string; level: string; goal_min: number; calls: boolean; voice: string | null;
  streak_days: number; last_day: string | null; used_ms: number; updated_ms: number;
}

interface ItemRow {
  item: string; kind: string; gloss: string; source: string; spoken: number;
  stability: number; difficulty: number; reps: number; lapses: number; steps: number;
  state: string; due_ms: number; last_ms: number | null;
}

const LEARNER_COLS = "target, from_lang, level, goal_min, calls, voice, streak_days, last_day, used_ms, updated_ms";
const ITEM_COLS = "item, kind, gloss, source, spoken, stability, difficulty, reps, lapses, steps, state, due_ms, last_ms";

const toLearner = (r: LearnerRow): Learner => ({
  target: r.target, from: r.from_lang, level: r.level as Level, goalMin: r.goal_min, calls: r.calls, voice: r.voice,
  streakDays: r.streak_days, lastDay: r.last_day, usedMs: Number(r.used_ms), updatedMs: Number(r.updated_ms),
});

const toItem = (r: ItemRow): LingoItem => ({
  item: r.item, kind: r.kind as ItemKind, gloss: r.gloss, source: r.source as ItemSource, spoken: r.spoken,
  memory: {
    stability: r.stability, difficulty: r.difficulty, reps: r.reps, lapses: r.lapses, steps: r.steps,
    state: r.state as MemoryState, dueMs: Number(r.due_ms), lastMs: r.last_ms === null ? null : Number(r.last_ms),
  },
});

export class SupabaseLingoStore implements LingoStore {
  constructor(private readonly db: SupabaseClient) {}

  async courses(userId: string): Promise<Learner[]> {
    const { data, error } = await this.db.from("lingo_learners").select(LEARNER_COLS).eq("user_id", userId).order("used_ms", { ascending: false });
    if (error) throw new Error("lingo_learners read failed");
    return (data ?? []).map((r) => toLearner(r as unknown as LearnerRow));
  }

  async course(userId: string, target: string): Promise<Learner | null> {
    const { data, error } = await this.db.from("lingo_learners").select(LEARNER_COLS).eq("user_id", userId).eq("target", target).maybeSingle();
    if (error) throw new Error("lingo_learners read failed");
    return data ? toLearner(data as unknown as LearnerRow) : null;
  }

  async setCourse(userId: string, learner: Learner, now: number): Promise<Learner> {
    const row = {
      user_id: userId, target: learner.target, from_lang: learner.from, level: learner.level, goal_min: learner.goalMin,
      calls: learner.calls, voice: learner.voice, streak_days: learner.streakDays, last_day: learner.lastDay,
      used_ms: learner.usedMs, created_ms: now, updated_ms: now,
    };
    const { error } = await this.db.from("lingo_learners").upsert(row, { onConflict: "user_id,target" });
    if (error) throw new Error("lingo_learners write failed");
    return { ...learner, updatedMs: now };
  }

  async items(userId: string, target: string): Promise<LingoItem[]> {
    const { data, error } = await this.db.from("lingo_items").select(ITEM_COLS).eq("user_id", userId).eq("target", target).order("due_ms", { ascending: true }).limit(ITEMS_MAX);
    if (error) throw new Error("lingo_items read failed");
    return (data ?? []).map((r) => toItem(r as unknown as ItemRow));
  }

  async add(userId: string, target: string, items: readonly NewItem[], now: number): Promise<number> {
    const rows = items
      .map((r) => ({ ...r, item: keyOf(r.item) }))
      .filter((r) => r.item)
      .map((r) => ({
        user_id: userId, target, item: r.item, kind: r.kind, gloss: r.gloss, source: r.source, spoken: 0,
        stability: 0, difficulty: 0, reps: 0, lapses: 0, steps: 0, state: "new", due_ms: now, last_ms: null,
        created_ms: now, updated_ms: now,
      }));
    if (!rows.length) return 0;
    // An item already known is left exactly as it is: its scheduling is the person's history and must not be reset.
    const { data, error } = await this.db.from("lingo_items").upsert(rows, { onConflict: "user_id,target,item", ignoreDuplicates: true }).select("item");
    if (error) throw new Error("lingo_items write failed");
    return (data ?? []).length;
  }

  async save(userId: string, target: string, items: readonly LingoItem[], now: number): Promise<void> {
    if (!items.length) return;
    const rows = items.map((it) => ({
      user_id: userId, target, item: keyOf(it.item), kind: it.kind, gloss: it.gloss, source: it.source, spoken: it.spoken,
      stability: it.memory.stability, difficulty: it.memory.difficulty, reps: it.memory.reps, lapses: it.memory.lapses,
      steps: it.memory.steps, state: it.memory.state, due_ms: it.memory.dueMs, last_ms: it.memory.lastMs,
      created_ms: now, updated_ms: now,
    }));
    const { error } = await this.db.from("lingo_items").upsert(rows, { onConflict: "user_id,target,item" });
    if (error) throw new Error("lingo_items write failed");
  }

  async forget(userId: string, target?: string): Promise<void> {
    // lingo_left is deliberately NOT cleared here: it outlives the course, which is the whole point of it. It goes
    // with the account (cascade) and with "delete my data".
    for (const table of ["lingo_items", "lingo_learners"] as const) {
      let q = this.db.from(table).delete().eq("user_id", userId);
      if (target !== undefined) q = q.eq("target", target);
      const { error } = await q;
      if (error) throw new Error(`${table} delete failed`);
    }
  }

  async left(userId: string, row: Left): Promise<void> {
    const { error } = await this.db.from("lingo_left").insert({
      user_id: userId, target: row.target, reason: row.reason.slice(0, 1000),
      words: row.words, learned: row.learned, streak: row.streak, days: row.days, left_ms: row.leftMs,
    });
    if (error) throw new Error("lingo_left write failed");
  }
}

let shared: LingoStore | null = null;

/** The server's store: Supabase when it is set up, else the memory twin. */
export function lingoStore(): LingoStore {
  if (!shared) {
    const db = supabase();
    shared = db ? new SupabaseLingoStore(db) : new MemoryLingoStore();
  }
  return shared;
}
