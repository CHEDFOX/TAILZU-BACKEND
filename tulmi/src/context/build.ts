/**
 * THE PERSON'S CONTEXT, AS A MODEL IS SHOWN IT: ONE BUILDER, A HARD CAP, DATA ONLY.
 *
 *   contextFor(userId, { now, tz, about, max }, sources) -> { text, parts, trimmed, turns }
 *
 * Built Xode's way (code/agent/context.ts): compact state, recent asks whole and older ones folded, a hard cap, and nothing in it is ever an
 * instruction. The sections, in this order, each only when it has something:
 *
 *   You             stable facts: their name (the name card: confirmed), their language setting and the device's time zone (found), what
 *                   they told their bots (bots/shared.ts: confirmed), the script they ask in when nothing says (guessed)
 *   People          who they message and through what, learned from their sends (keep.ts), most messaged lately first
 *   This conversation  the last asks in full, oldest first, after a short line of the ones before them
 *   Open work       read live: routines that are on or need them, Xode's questions, connected apps' calls waiting for a yes
 *   Recent results  what X0 did lately: an Ask run's last words on the ask it came from, a routine's last run
 *
 * THE CAP IS HARD (CONTEXT_MAX_CHARS, about 2,000 characters). Over it, in this order: the summary goes, then the older asks (the newest
 * two stay), then the guessed facts, then the people past the first few; still over, lines go from the end. What was cut is in `trimmed`.
 *
 * NEVER THROWS. Each source is read on its own, within CONTEXT_WAIT_MS; one that fails or is slow leaves its section out.
 *
 * Every value is one line, a secret is withheld (forModel), and our fences are broken inside it (neutral), so the text can sit inside
 * the decide prompt's <<< >>> or Ask's <context> as it is.
 */
import { neutral } from "../bots/prompt.js";
import { sharedFacts } from "../bots/shared.js";
import { forModel, oneLine } from "../code/work/model.js";
import { getConfig } from "../config.js";
import { LANGS } from "../experience/languages.js";
import { detectScript } from "../pipeline/script.js";
import { nextWords, routineStore, type Routine } from "../routines/index.js";
import { youStore } from "../you/store.js";
import { rankPeople } from "./keep.js";
import { contextStore, type ContextStore, type KeptTurn, type Person } from "./store.js";

export type FactStatus = "confirmed" | "found" | "guessed";
export interface YouFact { text: string; status: FactStatus; source: "profile" | "settings" | "device" | "bots" | "asks" }

export interface ContextParts {
  you: YouFact[];
  people: Person[];
  /** The summary of the asks before `turns`. */
  summary: string;
  turns: KeptTurn[];
  open: string[];
  results: string[];
}

export interface BuiltContext {
  /** Empty when there is nothing to say. */
  text: string;
  parts: ContextParts;
  /** What the cap cut, in the order it was cut: summary, older_turns, guessed_facts, people, lines. */
  trimmed: string[];
  /** Asks the server kept (before any trim): the client's own last asks are only a fallback when this is 0. */
  turns: number;
}

export interface ContextOptions {
  now?: number;
  /** The person's offset, minutes east of UTC, when the request said. */
  tz?: number;
  /** What they said now: the bots' facts that share its words are picked first. */
  about?: string;
  /** The cap; CONTEXT_MAX_CHARS when not given. */
  max?: number;
}

/** What is open for the person right now, and what was done lately, read live. */
export interface OpenWork { open: string[]; results: Array<{ at: number; text: string }> }

export interface ContextSources {
  store?: ContextStore;
  profile?: () => Promise<{ fullName?: string; language?: string } | null>;
  /** The bots' shared facts for `about`; bots/shared.ts when not given. */
  facts?: (about: string) => Promise<string[]>;
  /** Open work; the person's routines when not given. */
  open?: () => Promise<OpenWork>;
  /** Is the switch on (privacy.personalise)? Off: nothing learned is shown. */
  on?: (userId: string) => Promise<boolean>;
  /** How long one source may take, in ms. */
  wait?: number;
}

export const CONTEXT_WAIT_MS = 500;
const YOU_SHOWN = 8;
const PEOPLE_SHOWN = 8;
/** People kept when the cap cuts them. */
const PEOPLE_FEW = 3;
/** Asks kept when the cap cuts the older ones. */
const TURNS_FEW = 2;
const OPEN_SHOWN = 4;
const RESULTS_SHOWN = 3;
const RESULT_AGE_MS = 24 * 3_600_000;

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/** One value as it goes into the text: one line, a secret withheld, our fences broken. */
export const clean = (s: string, n: number): string => neutral(oneLine(forModel(s), n));

export function ago(at: number, now: number): string {
  const d = Math.max(0, now - at);
  if (d < MIN) return "just now";
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`;
  const days = Math.floor(d / DAY);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function tzWords(tz: number): string {
  const a = Math.abs(tz), pad = (n: number) => String(n).padStart(2, "0");
  return `UTC${tz < 0 ? "-" : "+"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

const languageName = (l: string): string => LANGS.find((x) => x.code === l || x.slug === l)?.name ?? (l === "en" ? "English" : l);

/** A source's answer, or `empty` when it failed or took longer than `ms`. */
async function within<T>(f: (() => Promise<T>) | undefined, empty: T, ms: number): Promise<T> {
  if (!f) return empty;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      f().catch(() => empty),
      new Promise<T>((res) => { timer = setTimeout(() => res(empty), ms); timer.unref?.(); }),
    ]);
  } catch {
    return empty;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The routines' part of open work: on and coming up, or needing the person; and what ran lately. */
export function routineWork(list: readonly Routine[], now: number, tz: number): OpenWork {
  const open: string[] = [];
  const results: OpenWork["results"] = [];
  for (const r of list) {
    const task = clean(r.task, 80), bot = clean(r.botName || r.bot, 30);
    if (r.status === "paused" && r.pausedWhy) open.push(`Routine paused (${clean(r.pausedWhy, 60)}): ${task}`);
    else if (r.lastStatus === "needs") open.push(`Routine waits for them: ${task}`);
    else if (r.status === "on" && r.nextAt) open.push(`Routine with ${bot}: ${task}, next ${nextWords(r.nextAt, tz, now)}`);
    if (r.lastAt && now - r.lastAt <= RESULT_AGE_MS && r.lastText) {
      results.push({ at: r.lastAt, text: `routine "${task}" ${r.lastStatus === "failed" ? "failed" : "ran"} ${ago(r.lastAt, now)}: ${clean(r.lastText, 100)}` });
    }
  }
  return { open, results };
}

const defaultOpen = (userId: string, now: number, tz: number) => async (): Promise<OpenWork> =>
  routineWork(await routineStore().list(userId), now, tz);

async function switchOn(userId: string, s: ContextSources): Promise<boolean> {
  if (s.on) return s.on(userId);
  return (await youStore().getSettings(userId)).privacy.personalise !== false;
}

/** The script most of their asks are in, when it is not English letters and three agree. */
function guessedScript(turns: readonly KeptTurn[]): string | null {
  const counts = new Map<string, number>();
  for (const t of turns) { const s = detectScript(t.said); if (s !== "unknown") counts.set(s, (counts.get(s) ?? 0) + 1); }
  const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  return best && best !== "latin" && n >= 3 ? best : null;
}

const STATUS_WORDS: Record<FactStatus, string> = { confirmed: "they said so", found: "from their settings", guessed: "a guess" };

function turnLine(t: KeptTurn, now: number): string {
  const head = `${ago(t.at, now)}, ${t.did}${t.to ? ` to ${clean(t.to, 60)}` : ""}${t.via ? ` on ${clean(t.via, 30)}` : ""}`;
  return `- ${head}: ${clean(t.said, 200)}${t.goal ? ` (meant: ${clean(t.goal, 160)})` : ""}`;
}

/** The text of the parts, sections in their fixed order. */
export function renderContext(p: ContextParts, now: number): string {
  const out: string[] = [];
  if (p.you.length) out.push("You:", ...p.you.map((f) => `- ${f.text} (${STATUS_WORDS[f.status]})`));
  if (p.people.length) {
    out.push("People they message:", ...p.people.map((x) => `- ${clean(x.name, 60)}${x.via ? `, on ${clean(x.via, 30)}` : ""}: ${x.count} time${x.count === 1 ? "" : "s"}, last ${ago(x.lastAt, now)}`));
  }
  if (p.summary || p.turns.length) {
    out.push("This conversation, oldest first:");
    if (p.summary) out.push(`Earlier: ${clean(p.summary, 600)}`);
    out.push(...p.turns.map((t) => turnLine(t, now)));
  }
  if (p.open.length) out.push("Open work:", ...p.open.map((l) => `- ${l}`));
  if (p.results.length) out.push("Recent results:", ...p.results.map((l) => `- ${l}`));
  return out.join("\n");
}

/** The person's context. Never throws. */
export async function contextFor(userId: string, o: ContextOptions = {}, s: ContextSources = {}): Promise<BuiltContext> {
  const now = o.now ?? Date.now();
  const max = o.max ?? getConfig().CONTEXT_MAX_CHARS;
  const wait = s.wait ?? CONTEXT_WAIT_MS;
  const tz = typeof o.tz === "number" && Number.isFinite(o.tz) ? o.tz : undefined;
  const about = o.about ?? "";

  // All at once, so the slowest source is the wait; what was learned is dropped after when the switch is off (or cannot be read).
  const [on, keptRead, profile, factsRead, work] = await Promise.all([
    within(() => switchOn(userId, s), false, wait),
    within(() => (s.store ?? contextStore()).get(userId), null, wait),
    within(s.profile, null, wait),
    within(() => (s.facts ?? ((a: string) => sharedFacts(userId, a)))(about), [] as string[], wait),
    within(s.open ?? defaultOpen(userId, now, tz ?? 330), { open: [], results: [] } as OpenWork, wait),
  ]);
  const kept = on ? keptRead : null;
  const facts = on ? factsRead : [];

  // 1. You.
  const you: YouFact[] = [];
  if (profile?.fullName?.trim()) you.push({ text: `Name: ${clean(profile.fullName, 60)}`, status: "confirmed", source: "profile" });
  if (profile?.language && profile.language !== "auto") you.push({ text: `Language: ${clean(languageName(profile.language), 30)}`, status: "found", source: "settings" });
  if (tz !== undefined) you.push({ text: `Time zone: ${tzWords(tz)}`, status: "found", source: "device" });
  for (const f of facts) you.push({ text: clean(f, 160), status: "confirmed", source: "bots" });
  const turnsAll = kept?.turns ?? [];
  const script = !profile?.language || profile.language === "auto" ? guessedScript(turnsAll) : null;
  if (script) you.push({ text: `Asks in ${script} script`, status: "guessed", source: "asks" });

  // 5. Recent results: runs on the asks, then the routines', newest first.
  const results = [
    ...turnsAll.filter((t) => t.result).map((t) => ({ at: t.at, text: `${ago(t.at, now)}, "${clean(t.said, 60)}": ${clean(t.result!, 140)}` })),
    ...work.results,
  ].sort((a, b) => b.at - a.at).slice(0, RESULTS_SHOWN).map((r) => r.text);

  const parts: ContextParts = {
    you: you.slice(0, YOU_SHOWN),
    people: rankPeople(kept?.people ?? [], now).slice(0, PEOPLE_SHOWN),
    summary: kept?.summary ?? "",
    turns: [...turnsAll],
    open: work.open.slice(0, OPEN_SHOWN),
    results,
  };

  // The cap, cut in its fixed order.
  const trimmed: string[] = [];
  let text = renderContext(parts, now);
  const over = () => text.length > max;
  const redo = () => { text = renderContext(parts, now); };
  if (over() && parts.summary) { parts.summary = ""; trimmed.push("summary"); redo(); }
  if (over() && parts.turns.length > TURNS_FEW) {
    trimmed.push("older_turns");
    while (over() && parts.turns.length > TURNS_FEW) { parts.turns.shift(); redo(); }
  }
  if (over() && parts.you.some((f) => f.status === "guessed")) { parts.you = parts.you.filter((f) => f.status !== "guessed"); trimmed.push("guessed_facts"); redo(); }
  if (over() && parts.people.length > PEOPLE_FEW) { parts.people = parts.people.slice(0, PEOPLE_FEW); trimmed.push("people"); redo(); }
  if (over()) {
    trimmed.push("lines");
    const lines = text.split("\n");
    while (lines.length && lines.join("\n").length > max) lines.pop();
    // A heading left with nothing under it says nothing.
    while (lines.length && /:$/.test(lines[lines.length - 1]!)) lines.pop();
    text = lines.join("\n");
  }
  return { text, parts, trimmed, turns: turnsAll.length };
}
