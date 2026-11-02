/**
 * WHAT IS LEARNED FROM WHAT THE PERSON DID: THEIR ASKS, WHO THEY MESSAGE, AND WHAT CAME OF IT.
 *
 *   keepAsk(userId, ask, d)       a decided ask (POST /v1/ask/decide): kept as a turn; a send with `to` counts that person
 *   keepResult(userId, run, d)    an Ask run that ended with DONE: its last words go on the ask it came from
 *   forgetPerson / forgetTurns    the person's own "forget this"
 *
 * Nothing is kept from a private field, X0 Bot's own window or a sensitive app; nothing that looks like a secret, a password or a code;
 * nothing at all while the person has Settings › Privacy "Use what you've told your bots" off (privacy.personalise, bots/shared.ts).
 *
 * The last TURNS_KEPT asks are kept whole. An older one is folded into the summary by rule, no model: "send to Riya: the mockups…", and the
 * summary drops its oldest pieces once it passes SUMMARY_MAX. At most PEOPLE_KEPT people: the ones messaged least, longest ago, go first.
 * Writes for one person run one after another on this server, so two asks close together do not lose one.
 */
import { randomUUID } from "node:crypto";
import type { AskDecision, DecideInput } from "../askDecide/index.js";
import { scanForSecrets } from "../code/policy.js";
import { oneLine } from "../code/work/model.js";
import { sensitiveApp } from "../pipeline/sensitive.js";
import { youStore } from "../you/store.js";
import { contextStore, emptyKept, type ContextStore, type Kept, type KeptTurn, type Person } from "./store.js";

export const TURNS_KEPT = 6;
export const PEOPLE_KEPT = 30;
export const SUMMARY_MAX = 400;
const SAID_MAX = 200;
const RESULT_MAX = 160;
/** A run's DONE is put on an ask made at most this long before it. */
const RESULT_WINDOW_MS = 30 * 60_000;
const DAY = 24 * 3_600_000;

export interface KeepDeps {
  store?: ContextStore;
  /** Is the switch on for this person? The You store's privacy.personalise when not given. */
  on?: (userId: string) => Promise<boolean>;
  now?: () => number;
}

/** Words that must not be kept: a secret by Xode's scanner, or a password, a code or a PIN by name. */
export function secretish(text: string): boolean {
  if (!text.trim()) return false;
  if (scanForSecrets([{ path: "ask.txt", content: text }]).length) return true;
  return /\b(?:password|passwd|passcode|otp|one[-\s]?time\s+(?:code|password)|cvv|pin\s*(?:is|code|number)?\s*[:=]?\s*\d{4,})\b/i.test(text);
}

async function switchOn(userId: string, d: KeepDeps): Promise<boolean> {
  if (d.on) return d.on(userId);
  return (await youStore().getSettings(userId)).privacy.personalise !== false;
}

// One write at a time for a person, on this server.
const queues = new Map<string, Promise<unknown>>();
function inTurn<T>(userId: string, f: () => Promise<T>): Promise<T> {
  const before = queues.get(userId) ?? Promise.resolve();
  const next = before.then(f, f);
  const tail = next.catch(() => undefined);
  queues.set(userId, tail);
  void tail.then(() => { if (queues.get(userId) === tail) queues.delete(userId); });
  return next;
}

async function change(userId: string, d: KeepDeps, f: (k: Kept, now: number) => boolean): Promise<boolean> {
  const store = d.store ?? contextStore();
  return inTurn(userId, async () => {
    const now = (d.now ?? Date.now)();
    const k = (await store.get(userId)) ?? emptyKept(now);
    if (!f(k, now)) return false;
    k.updatedAt = now;
    await store.put(userId, k);
    return true;
  });
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** One folded ask: "send to Riya: the mockups are ready (sent)". */
export function foldPiece(t: KeptTurn): string {
  return `${t.did}${t.to ? ` to ${t.to}` : ""}: ${oneLine(t.said, 60)}${t.result ? ` (${oneLine(t.result, 40)})` : ""}`;
}

/** The summary with one more ask in it, its oldest pieces dropped until it fits. */
export function foldInto(summary: string, t: KeptTurn, max = SUMMARY_MAX): string {
  const pieces = [...(summary ? summary.split("; ") : []), foldPiece(t)];
  while (pieces.length > 1 && pieces.join("; ").length > max) pieces.shift();
  return oneLine(pieces.join("; "), max);
}

/** How much a person counts: often, and lately. */
export const personScore = (p: Person, now: number): number => p.count / (1 + Math.max(0, now - p.lastAt) / (7 * DAY));

/** The people, most messaged lately first. */
export function rankPeople(people: readonly Person[], now: number): Person[] {
  return [...people].sort((a, b) => personScore(b, now) - personScore(a, now) || b.lastAt - a.lastAt);
}

/** Why an ask is not kept, or null when it may be. */
export function notKept(i: DecideInput, d: AskDecision): string | null {
  if (!i.words.trim()) return "empty";
  if (i.ours) return "ours";
  if (i.field && i.field.private) return "private_field";
  if (sensitiveApp(i.app) || sensitiveApp(i.title)) return "sensitive_app";
  if (d.by === "rules") return "rules";
  if (secretish(i.words) || secretish(d.goal) || secretish(i.field?.selection ?? "")) return "secret";
  return null;
}

/** A decided ask, kept. True when it was. */
export async function keepAsk(userId: string, a: { input: DecideInput; decision: AskDecision }, d: KeepDeps = {}): Promise<boolean> {
  if (notKept(a.input, a.decision) || !(await switchOn(userId, d))) return false;
  const said = oneLine(a.input.words, SAID_MAX);
  const goal = oneLine(a.decision.goal, SAID_MAX);
  const to = a.decision.do === "send" && a.decision.to ? oneLine(a.decision.to, 80) : "";
  const via = a.decision.do === "send" && a.decision.via ? oneLine(a.decision.via, 40) : "";
  return change(userId, d, (k, now) => {
    const turn: KeptTurn = {
      id: randomUUID(), said, did: a.decision.do, at: now,
      ...(goal && norm(goal) !== norm(said) ? { goal } : {}),
      ...(to ? { to } : {}), ...(via ? { via } : {}),
    };
    k.turns.push(turn);
    while (k.turns.length > TURNS_KEPT) k.summary = foldInto(k.summary, k.turns.shift()!);
    if (to) {
      const p = k.people.find((x) => norm(x.name) === norm(to));
      if (p) { p.count += 1; p.lastAt = now; p.name = to; if (via) p.via = via; }
      else k.people.push({ name: to, ...(via ? { via } : {}), count: 1, lastAt: now });
      k.people = rankPeople(k.people, now).slice(0, PEOPLE_KEPT);
    }
    return true;
  });
}

/**
 * What an Ask run did, on the ask it came from: the newest ask in the last half hour, said or made whole in the same words as the run's
 * request, that has no result yet. Nothing when none matches; nothing from a private window or a sensitive app.
 */
export async function keepResult(
  userId: string,
  run: { said: string; result: string; app?: string; private?: boolean },
  d: KeepDeps = {},
): Promise<boolean> {
  const said = norm(run.said);
  const result = oneLine(run.result, RESULT_MAX);
  if (!said || !result || run.private || sensitiveApp(run.app) || secretish(run.result) || !(await switchOn(userId, d))) return false;
  return change(userId, d, (k, now) => {
    const t = [...k.turns].reverse().find((x) => !x.result && now - x.at <= RESULT_WINDOW_MS && (norm(x.said) === said || (x.goal && norm(x.goal) === said)));
    if (!t) return false;
    t.result = result;
    return true;
  });
}

/** One person, forgotten. True when they were kept. */
export function forgetPerson(userId: string, name: string, d: KeepDeps = {}): Promise<boolean> {
  return change(userId, d, (k) => {
    const n = k.people.length;
    k.people = k.people.filter((p) => norm(p.name) !== norm(name));
    return k.people.length !== n;
  });
}

/** The asks and their summary, forgotten; the people stay. */
export async function forgetTurns(userId: string, d: KeepDeps = {}): Promise<void> {
  await change(userId, d, (k) => {
    k.turns = [];
    k.summary = "";
    return true;
  });
}

/** Everything kept, gone. */
export async function forgetAll(userId: string, d: KeepDeps = {}): Promise<void> {
  const store = d.store ?? contextStore();
  await inTurn(userId, () => store.remove(userId));
}
