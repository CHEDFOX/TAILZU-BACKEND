/**
 * WHAT FILLS A UNIT, FOR ONE PAIR OF LANGUAGES — MADE ONCE, KEPT FOR EVERYBODY.
 *
 *   unitFor(bank, ctx, lang, glossLang, unit) -> UnitItem[]
 *
 * The path is written once in no language (course.ts). This is the other half: what unit 5 actually contains when
 * it is Spanish taught in Tamil. Writing that by hand is months of work per pair and there are more pairs than
 * anybody will ever write, so it is written when the FIRST person on a pair reaches the unit, and kept — the next
 * person on Spanish-from-Tamil pays nothing and waits for nothing.
 *
 * That is the whole reason a course can exist for any pair at all. It also ends Lingo's dependence on somebody
 * having poured a corpus in: a pair with no corpus used to mean a course with nothing in it.
 *
 * WHAT IS KEPT IS SHARED AND IS NOBODY'S. A unit is the same for everyone learning that pair, so nothing here is
 * anybody's data, nothing is written against a person, and one row serves every learner there will ever be.
 *
 * WHEN IT CANNOT BE MADE, nothing is kept. A model that was down, or a reply that did not parse, must not write an
 * empty unit into the table and teach it to everybody after: better to have no unit and try again than a unit that
 * is wrong for good. The same goes for a unit that came back nearly empty — see ENOUGH.
 */
import { z } from "zod";
import { askJson, type ModelCtx } from "../code/work/model.js";
import { unitOf, type Unit } from "./course.js";
import { keyOf } from "./store.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../auth/supabase.js";

/** One thing a unit teaches. The shape the model is asked for, and the shape the table keeps. */
export const UnitDraft = z.object({
  items: z.array(z.object({
    text: z.string().min(1).max(120),
    meaning: z.string().min(1).max(200),
    kind: z.enum(["word", "phrase"]),
  })).min(1).max(40),
});
export type UnitDraft = z.infer<typeof UnitDraft>;
export interface UnitItem { text: string; meaning: string; kind: "word" | "phrase" }

/**
 * Fewer than this and the unit is not worth keeping: the model either did not know the pair or did not do the job,
 * and a thin unit kept now is a thin unit taught for ever. Not kept, so the next person's attempt is a fresh one.
 */
export const ENOUGH = 4;

export interface LessonBank {
  /** What is kept for this pair and unit, or null when it has never been made. */
  get(lang: string, glossLang: string, unit: string): Promise<UnitItem[] | null>;
  /** Keep it for everybody after. */
  put(lang: string, glossLang: string, unit: string, items: readonly UnitItem[], now: number): Promise<void>;
}

export class MemoryLessonBank implements LessonBank {
  private readonly rows = new Map<string, UnitItem[]>();
  private key = (l: string, g: string, u: string) => `${l}\u0000${g}\u0000${u}`;
  async get(lang: string, glossLang: string, unit: string): Promise<UnitItem[] | null> {
    return this.rows.get(this.key(lang, glossLang, unit)) ?? null;
  }
  async put(lang: string, glossLang: string, unit: string, items: readonly UnitItem[]): Promise<void> {
    this.rows.set(this.key(lang, glossLang, unit), [...items]);
  }
}

interface LessonRow { items: UnitItem[] }

export class SupabaseLessonBank implements LessonBank {
  constructor(private readonly db: SupabaseClient) {}

  async get(lang: string, glossLang: string, unit: string): Promise<UnitItem[] | null> {
    const { data, error } = await this.db.from("lingo_lessons").select("items")
      .eq("lang", lang).eq("gloss_lang", glossLang).eq("unit", unit).maybeSingle();
    if (error) throw new Error("lingo_lessons read failed");
    const rows = (data as LessonRow | null)?.items;
    return Array.isArray(rows) && rows.length ? rows : null;
  }

  async put(lang: string, glossLang: string, unit: string, items: readonly UnitItem[], now: number): Promise<void> {
    const { error } = await this.db.from("lingo_lessons")
      .upsert({ lang, gloss_lang: glossLang, unit, items, made_ms: now }, { onConflict: "lang,gloss_lang,unit" });
    if (error) throw new Error("lingo_lessons write failed");
  }
}

/** The bank the server uses: Supabase where it is configured, and kept only for this process where it is not. */
let shared: LessonBank | null = null;
export function lessonBank(): LessonBank {
  if (!shared) {
    const db = supabase();
    shared = db ? new SupabaseLessonBank(db) : new MemoryLessonBank();
  }
  return shared;
}

/** The brief handed to the model: the unit's own goal and what it has to cover, and the pair, and nothing else. */
export function briefFor(u: Unit, lang: string, glossLang: string): string {
  return [
    `Language being learned: ${lang}`,
    `Language they already speak: ${glossLang}`,
    `Unit: ${u.key} (level ${u.level})`,
    `By the end of it: ${u.goal}`,
    `It has to cover: ${u.about}`,
    `About ${u.size} items.`,
  ].join("\n");
}

/** What survives: trimmed, deduplicated, both halves present, and no more than the unit asked for. */
export function tidyDraft(draft: UnitDraft, want: number): UnitItem[] {
  const out: UnitItem[] = [];
  const seen = new Set<string>();
  for (const r of draft.items) {
    const text = keyOf(r.text);
    const meaning = r.meaning.trim();
    if (!text || !meaning || seen.has(text)) continue;
    seen.add(text);
    out.push({ text, meaning, kind: r.kind });
  }
  return out.slice(0, Math.max(1, want));
}

/**
 * ONE BUILD PER PAIR AND UNIT, however many people arrive at it at once. A unit takes a model call and a few
 * seconds, and the people who want it most are the ones who have just started the course: the person whose first
 * lesson it is, and the session screen they land on a moment later. Without this they each start their own.
 *
 * It is per process, so two servers can still each make it once — wasteful, not wrong: the row is upserted and the
 * content of a unit does not depend on who asked for it.
 */
const inFlight = new Map<string, Promise<UnitItem[] | null>>();
const flightKey = (lang: string, glossLang: string, unit: string): string => `${lang}\u0000${glossLang}\u0000${unit}`;

/**
 * IS THIS UNIT BEING GOT RIGHT NOW? What lets a caller say "it is being made" instead of waiting for it, which is
 * the difference between a screen that explains itself and a screen that hangs (routes/bots/lingo.ts walk()).
 *
 * True from the moment somebody asks until they have it, the read of what is already kept included. That read is
 * one query, so for a pair somebody has already made this is true for a few milliseconds and the window is not
 * worth code: the worst it can do is ask somebody to tap again once.
 */
export const makingUnit = (lang: string, glossLang: string, unit: string): boolean =>
  inFlight.has(flightKey(lang, glossLang, unit));

/** The model call itself, and what it is allowed to keep. Separate so the in-flight map has one thing to hold. */
async function makeUnit(
  bank: LessonBank,
  ctx: ModelCtx,
  u: Unit,
  lang: string,
  glossLang: string,
  unitKey: string,
): Promise<UnitItem[] | null> {
  const asked = await askJson<UnitDraft>(ctx, {
    tier: "strong",
    role: "lingo_unit",
    purpose: "lingo_unit",
    user: briefFor(u, lang, glossLang),
    schema: UnitDraft,
    maxTokens: 2000,
  });
  if (!asked.ok) return null;
  const items = tidyDraft(asked.value, u.size);
  // Too thin to keep: the model did not know the pair well enough, and a thin unit kept now is taught for ever.
  if (items.length < ENOUGH) return null;
  await bank.put(lang, glossLang, unitKey, items, Date.now()).catch(() => undefined);
  return items;
}

/** What is kept for this pair and unit, or made and kept. The body of unitFor, with the claim held over it. */
async function keptOrMade(
  bank: LessonBank,
  ctx: ModelCtx,
  u: Unit,
  lang: string,
  glossLang: string,
  unitKey: string,
): Promise<UnitItem[] | null> {
  const kept = await bank.get(lang, glossLang, unitKey).catch(() => null);
  if (kept?.length) return kept;
  return makeUnit(bank, ctx, u, lang, glossLang, unitKey);
}

/**
 * The unit's content for this pair: what is kept, or made and kept. Null when it could not be made, which is not
 * an error — the caller carries on with whatever the person already has, and the next person tries again.
 *
 * ONE IN THE AIR AT A TIME, joined rather than started again, so arriving while somebody else's call is out costs
 * nothing and gives the same answer. NOT `async`, on purpose: the claim has to be made in the same tick as the
 * call, because an await before it is a gap in which the next caller sees nothing running and starts a second one.
 * That next caller is not hypothetical — it is the lesson screen, a moment behind the course that started it.
 */
export function unitFor(
  bank: LessonBank,
  ctx: ModelCtx,
  lang: string,
  glossLang: string,
  unitKey: string,
): Promise<UnitItem[] | null> {
  const u = unitOf(unitKey);
  if (!u) return Promise.resolve(null);

  const key = flightKey(lang, glossLang, unitKey);
  const running = inFlight.get(key);
  if (running) return running;

  // What the map holds never rejects and is always cleared, so a pair whose first attempt failed is tried again by
  // the next person rather than looking busy for ever, and a joiner is never handed a throw. The SAME promise is
  // handed back, so that by the time anybody has their answer the claim is already let go of — handing back the
  // one underneath would settle a tick early and leave the unit looking busy to whoever asked next.
  const work = keptOrMade(bank, ctx, u, lang, glossLang, unitKey)
    .then((v) => v, () => null)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, work);
  return work;
}
