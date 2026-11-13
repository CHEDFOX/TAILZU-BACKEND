/**
 * WHAT A FILM NEEDS NEXT. One pure function (`steps`) looks at a film as it is and says what to do now: make a reference sheet, a still, a
 * take; ask the provider how a take is going; check a take; cut the film; or move the film to its next status. The service (service.ts)
 * runs the steps, saves what they made, and asks again on the next tick. Nothing here calls a model, a store or a clock.
 *
 * Because every decision is made again from the film's own data each time, a server that restarts in the middle of a film picks it up
 * where it was, a shot the person changes is made again by itself (its fingerprint no longer matches, compile.ts), and only what the change
 * touches is made again: a new line of dialogue is a new take from the same still; a new wardrobe is a new still, then a new take; the cut
 * is made again whenever a take in it changed.
 *
 * Order of work, and what waits for what:
 *   - nothing is made before the person approves the script (status boarding); no video before they approve the price (status rendering)
 *   - the look frame and the reference sheets come first: a still waits for them
 *   - the voice-over is recorded while the stills are made, so the price is for shots as long as their words need
 *   - a shot that continues the one before waits for that shot's chosen take, whose last frame it starts on
 *   - a take is only started when what is left of the film's money covers it; otherwise the film holds for the person (hold "budget")
 *   - a shot the eye gave up on holds the film for the person (hold "shot"); the other shots carry on
 *   - so many at once of each kind (LIMITS), so one film does not take every slot a provider gives us
 */
import { createHash } from "node:crypto";
import { stillPrint, takePrint, voicePrint } from "./compile.js";
import { sheetsNeeded } from "./quote.js";
import type { Film, FilmStatus, Hold, ShotCard, ShotState, ShotStatus } from "./types.js";

export interface Limits { sheets: number; stills: number; renders: number; pollMs: number }
export const LIMITS: Limits = { sheets: 3, stills: 4, renders: 3, pollMs: 20_000 };

export type Step =
  | { kind: "sheet"; of: "character" | "place" | "look"; key: string }
  | { kind: "still"; n: number }
  | { kind: "voice"; n: number }
  | { kind: "render"; n: number }
  | { kind: "poll"; take: string }
  | { kind: "check"; take: string }
  | { kind: "cut" }
  | { kind: "move"; status: FilmStatus; hold: Hold };

/** The step's lock name: the service runs one of each at a time. */
export function stepKey(s: Step): string {
  switch (s.kind) {
    case "sheet": return `sheet:${s.of}:${s.key}`;
    case "still": return `still:${s.n}`;
    case "voice": return `voice:${s.n}`;
    case "render": return `render:${s.n}`;
    case "poll": return `poll:${s.take}`;
    case "check": return `check:${s.take}`;
    case "cut": return "cut";
    case "move": return "move";
  }
}

export interface FlowCtx {
  now: number;
  /** Steps running now (stepKey). */
  busy: ReadonlySet<string>;
  /** Paise a paid step would cost (a take: the router's first choice), or null when it cannot be made (no model can make the shot). */
  cost: (s: Step) => number | null;
  /** Paise the film may still spend: what was agreed, less what was spent and what the running steps will spend. */
  left?: number;
  limits?: Limits;
}

export interface Prints { still: Map<number, string>; take: Map<number, string>; cut: string }

/** Every shot's fingerprints, and the cut's. A shot that continues the one before carries that shot's chosen take in its own. */
export function prints(film: Film): Prints {
  const still = new Map<number, string>();
  const take = new Map<number, string>();
  if (!film.script) return { still, take, cut: "" };
  const { bible, shots } = film.script;
  let before: string | null = null;
  for (const card of shots) {
    still.set(card.n, stillPrint(card, bible, film.aspect));
    const tp = takePrint(card, bible, film.aspect, before);
    take.set(card.n, tp);
    const st = shotOf(film, card.n);
    before = st?.take && st.takeOf === tp ? st.take : tp;
  }
  const cut = createHash("sha256")
    .update(JSON.stringify([film.aspect, bible.language, bible.music, shots.map((c) => [c.n, shotOf(film, c.n)?.take ?? null, shotOf(film, c.n)?.voice ?? null, c.vo, c.lines, c.link])]))
    .digest("hex")
    .slice(0, 16);
  return { still, take, cut };
}

export const shotOf = (film: Film, n: number): ShotState | undefined => film.shots.find((s) => s.n === n);

/** A fresh shot's progress. */
export const blankShot = (n: number): ShotState => ({
  n, status: "planned", still: null, stillVerdict: null, stillOf: null, take: null, takeOf: null, failedOf: null, blamed: [], fix: null, error: null,
  voice: null, voiceOf: null, voiceSeconds: 0,
});

/** Whether a film gets a look frame: any film of more than one shot (one still has nothing to match). */
export const needsLook = (film: Film): boolean => (film.script?.shots.length ?? 0) > 1;

const BOARDED: readonly FilmStatus[] = ["boarding", "board"];
const MAKING: readonly FilmStatus[] = ["boarding", "board", "rendering", "cutting", "done"];
const FILMING: readonly FilmStatus[] = ["rendering", "cutting", "done"];

/** Where a shot is, read from the film's data. */
export function shotStatus(film: Film, card: ShotCard, p: Prints, busy: ReadonlySet<string>): ShotStatus {
  const st = shotOf(film, card.n);
  if (!st?.still || st.stillOf !== p.still.get(card.n)) return busy.has(`still:${card.n}`) ? "boarding" : "planned";
  if (BOARDED.includes(film.status)) return "boarded";
  const tp = p.take.get(card.n)!;
  if (st.failedOf === tp) return "failed";
  if (st.take && st.takeOf === tp) return "ok";
  const mine = film.takes.filter((t) => t.n === card.n && t.of === tp);
  if (mine.some((t) => t.status === "running") || busy.has(`render:${card.n}`)) return "rendering";
  if (mine.some((t) => t.status === "done" && !t.verdict)) return "checking";
  return "queued";
}

/** Each shot's status, written onto the film for the screens (and returned). */
export function refresh(film: Film, busy: ReadonlySet<string> = new Set()): Film {
  if (!film.script) return film;
  const p = prints(film);
  const shots = film.script.shots.map((card) => ({ ...(shotOf(film, card.n) ?? blankShot(card.n)), status: shotStatus(film, card, p, busy) }));
  return { ...film, shots };
}

export function steps(film: Film, ctx: FlowCtx): Step[] {
  const lim = ctx.limits ?? LIMITS;
  if (!film.script || !MAKING.includes(film.status)) return [];
  const { bible, shots: cards } = film.script;
  const p = prints(film);
  const busy = ctx.busy;
  const out: Step[] = [];
  const running = (prefix: string) => [...busy].filter((k) => k.startsWith(prefix)).length;
  let left = ctx.left ?? film.budgetPaise - film.spentPaise;
  let short = false;
  /** Whether the money left covers a paid step; it is then counted as spent for the rest of this look. */
  const afford = (s: Step): boolean => {
    const c = ctx.cost(s);
    if (c === null) return false;
    if (c > left) { short = true; return false; }
    left -= c;
    return true;
  };

  // 1. The look frame, and reference sheets for the people and places seen more than once.
  const need = sheetsNeeded(film.script);
  const missing = new Set<string>();
  let sheetSlots = lim.sheets - running("sheet:");
  if (needsLook(film) && !bible.lookRef) {
    missing.add("look");
    const s: Step = { kind: "sheet", of: "look", key: "look" };
    if (sheetSlots > 0 && !busy.has(stepKey(s)) && afford(s)) { out.push(s); sheetSlots--; }
  }
  for (const key of need.characters) {
    if (bible.characters.find((c) => c.key === key)?.ref) continue;
    missing.add(`c:${key}`);
    const s: Step = { kind: "sheet", of: "character", key };
    if (sheetSlots > 0 && !busy.has(stepKey(s)) && afford(s)) { out.push(s); sheetSlots--; }
  }
  for (const key of need.places) {
    if (bible.places.find((x) => x.key === key)?.ref) continue;
    missing.add(`p:${key}`);
    const s: Step = { kind: "sheet", of: "place", key };
    if (sheetSlots > 0 && !busy.has(stepKey(s)) && afford(s)) { out.push(s); sheetSlots--; }
  }

  // 2. A still for each shot whose still is missing or out of date, once its sheets are there.
  let stillSlots = lim.stills - running("still:");
  let stillsReady = true;
  for (const card of cards) {
    const st = shotOf(film, card.n);
    if (st?.still && st.stillOf === p.still.get(card.n)) continue;
    stillsReady = false;
    const waits = missing.has("look") || card.cast.some((k) => missing.has(`c:${k}`)) || missing.has(`p:${card.place}`);
    const s: Step = { kind: "still", n: card.n };
    if (!waits && stillSlots > 0 && !busy.has(stepKey(s)) && afford(s)) { out.push(s); stillSlots--; }
  }

  // 3. The voice-over, recorded before the price, so each shot's seconds fit what is said in it.
  let voicesReady = true;
  for (const card of cards) {
    const want = voicePrint(card, bible, film.voice);
    const st = shotOf(film, card.n);
    if (!want || (st?.voice && st.voiceOf === want)) continue;
    voicesReady = false;
    const s: Step = { kind: "voice", n: card.n };
    if (!busy.has(stepKey(s)) && afford(s)) out.push(s);
  }

  if (film.status === "boarding" && stillsReady && voicesReady && !missing.size && running("sheet:") + running("still:") + running("voice:") === 0) {
    out.push({ kind: "move", status: "board", hold: null });
    return out;
  }
  if (!FILMING.includes(film.status)) {
    const hold: Hold = short ? "budget" : null;
    if ((film.status === "boarding" || film.status === "board") && hold !== film.hold) out.push({ kind: "move", status: film.status, hold });
    return out;
  }

  // 4. Takes: poll the running ones, check the finished ones, start the next ones the money covers.
  let renderSlots = lim.renders - film.takes.filter((t) => t.status === "running").length - running("render:");
  let hold: Hold = short ? "budget" : null;
  let allOk = true;
  for (const card of cards) {
    const status = shotStatus(film, card, p, busy);
    if (status === "ok") continue;
    allOk = false;
    if (status === "failed") { hold = "shot"; continue; }
    if (status === "planned" || status === "boarding") continue;
    const tp = p.take.get(card.n)!;
    const mine = film.takes.filter((t) => t.n === card.n && t.of === tp);
    for (const t of mine) {
      if (t.status === "running" && t.job && (t.polledAt === null || ctx.now - t.polledAt >= lim.pollMs) && !busy.has(`poll:${t.id}`)) out.push({ kind: "poll", take: t.id });
      if (t.status === "done" && !t.verdict && !busy.has(`check:${t.id}`)) out.push({ kind: "check", take: t.id });
    }
    if (status !== "queued") continue;
    if (card.link === "continue" && card.n > 1) {
      const prevCard = cards[cards.indexOf(card) - 1];
      const prev = prevCard ? shotOf(film, prevCard.n) : undefined;
      if (!prevCard || !prev?.take || prev.takeOf !== p.take.get(prevCard.n)) continue;
      if (!film.takes.find((t) => t.id === prev.take)?.lastFrame) continue;
    }
    const s: Step = { kind: "render", n: card.n };
    if (renderSlots <= 0 || busy.has(stepKey(s))) continue;
    if (ctx.cost(s) === null) { hold = hold ?? "shot"; continue; }
    if (!afford(s)) { hold = hold ?? "budget"; continue; }
    out.push(s);
    renderSlots--;
  }

  // 5. The cut, once every shot has its take and every voice-over is recorded; and the film's status and hold.
  if (allOk && voicesReady && cards.length) {
    if (film.cut.of !== p.cut || !film.cut.video) {
      if (!busy.has("cut")) out.push({ kind: "cut" });
      if (film.status !== "cutting") out.push({ kind: "move", status: "cutting", hold: null });
    } else if (film.status !== "done" || film.hold) {
      out.push({ kind: "move", status: "done", hold: null });
    }
    return out;
  }
  const status: FilmStatus = film.status === "done" || film.status === "cutting" ? "rendering" : film.status;
  if (status !== film.status || hold !== film.hold) out.push({ kind: "move", status, hold });
  return out;
}
