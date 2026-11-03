/**
 * A TALK: THE TURNS OF ONE VOICE CONVERSATION, IN MEMORY, AND THE TURN IN FLIGHT (code/chat/threads.ts's way).
 *
 *   sessions.get(userId, talkId)          the talk, or null (never had, or idle past TALK_IDLE_MS)
 *   sessions.add(userId, talkId, turn)    a turn kept: the last TALK_TURNS whole, older ones folded into the summary by code
 *   talkLines(session)                    the summary and the turns, as the answering model reads them
 *   foundIn(answer, links)                what an answer rested on: numbers, names, links (for "send that to Riya")
 *   flight(userId, talkId) / stopTalk     the turn being answered now, and the person's interruption of it
 *
 * One talk per (person, the client's talkId). Kept in memory only: a talk is a conversation of minutes, and the person's context
 * (src/context) is what lasts. Nothing from a private field, X0 Bot's own window, a sensitive app or a secret is added (talk/index.ts).
 * A turn sent again with the same number replaces the first. At most SESSIONS_MAX talks; the one idle longest goes first.
 */
import { oneLine } from "../code/work/model.js";
import type { TalkKind } from "./road.js";

export interface TalkFound { numbers?: string[]; names?: string[]; links?: string[] }

export interface TalkTurn {
  /** The client's turn number. */
  n: number;
  said: string;
  /** The ask made whole, when it differs from what was said (a follow-up, a handoff's goal). */
  goal?: string;
  /** What X0 said; empty for a handoff. */
  answer: string;
  kind: TalkKind;
  found?: TalkFound;
  at: number;
}

export interface TalkSession {
  userId: string;
  talkId: string;
  /** The turns before `turns`, folded: "chat: tell me a joke → Why did…; answer: …". */
  summary: string;
  turns: TalkTurn[];
  at: number;
}

export const TALK_ID = /^[A-Za-z0-9_-]{6,64}$/;
/** Turns kept whole. */
export const TALK_TURNS = 8;
export const TALK_SUMMARY_MAX = 600;
/** A talk not used for this long is gone. */
export const TALK_IDLE_MS = 30 * 60_000;
const SESSIONS_MAX = 5_000;
const SAID_MAX = 400;
const ANSWER_MAX = 1_200;

/** One folded turn. */
export function foldPiece(t: TalkTurn): string {
  return `${t.kind}: ${oneLine(t.goal ?? t.said, 60)}${t.answer ? ` → ${oneLine(t.answer, 60)}` : ""}`;
}

/** The summary with one more turn in it, its oldest pieces dropped until it fits. */
export function foldTurn(summary: string, t: TalkTurn, max = TALK_SUMMARY_MAX): string {
  const pieces = [...(summary ? summary.split("; ") : []), foldPiece(t)];
  while (pieces.length > 1 && pieces.join("; ").length > max) pieces.shift();
  return oneLine(pieces.join("; "), max);
}

const LINK = /\bhttps?:\/\/[^\s<>"'()]+[^\s<>"'().,;:!?]/gi;
const NUMBER = /(?:[₹$€£]\s?)?\+?\d(?:[\d,.:/-]|\s(?=\d))*\d(?:\s?(?:%|am|pm|km|kg|rs|inr|usd)\b)?|(?:[₹$€£]\s?)\d/gi;
const NAME = /(?<=[\p{Ll}\p{N},:]\s+)\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){0,3}/gu;

/** What an answer rested on, for a follow-up to point at: its links, its numbers, the names in it. Undefined when it has none. */
export function foundIn(answer: string, extra: { links?: readonly string[] } = {}): TalkFound | undefined {
  const uniq = (xs: readonly string[], n: number): string[] => [...new Set(xs.map((x) => x.trim()).filter(Boolean))].slice(0, n);
  const links = uniq([...(answer.match(LINK) ?? []), ...(extra.links ?? [])], 3);
  const bare = answer.replace(LINK, " ");
  const numbers = uniq((bare.match(NUMBER) ?? []).filter((x) => x.replace(/\D/g, "").length >= 2 || /[₹$€£%]/.test(x)), 5);
  const names = uniq(bare.match(NAME) ?? [], 4);
  const f: TalkFound = { ...(numbers.length ? { numbers } : {}), ...(names.length ? { names } : {}), ...(links.length ? { links } : {}) };
  return Object.keys(f).length ? f : undefined;
}

export const foundLine = (f: TalkFound | undefined): string =>
  f ? [f.numbers?.length ? `numbers ${f.numbers.join(", ")}` : "", f.names?.length ? `names ${f.names.join(", ")}` : "", f.links?.length ? `links ${f.links.join(" ")}` : ""].filter(Boolean).join("; ") : "";

/** The talk as the answering model reads it: the summary, then each turn whole (cut), oldest first. */
export function talkLines(s: TalkSession | null | undefined): string {
  if (!s || (!s.summary && !s.turns.length)) return "";
  const out: string[] = [];
  if (s.summary) out.push(`Before: ${s.summary}`);
  for (const t of s.turns) {
    const found = foundLine(t.found);
    out.push(`- They said: ${oneLine(t.said, 200)}${t.goal ? ` (meant: ${oneLine(t.goal, 200)})` : ""}`
      + `\n  ${t.answer ? `X0 said: ${oneLine(t.answer, 300)}` : `Handed on as ${t.kind}`}${found ? `\n  Found: ${oneLine(found, 300)}` : ""}`);
  }
  return out.join("\n");
}

/** The last few turns in a line each, for the one key's brain (askDecide `talk`). */
export function decideLines(s: TalkSession | null | undefined, n = 4): string {
  if (!s) return "";
  return s.turns.slice(-n).map((t) => `- ${t.kind}: ${oneLine(t.goal ?? t.said, 120)}${t.answer ? ` → ${oneLine(t.answer, 80)}` : ""}${t.found ? ` (found: ${oneLine(foundLine(t.found), 120)})` : ""}`).join("\n");
}

export class TalkSessions {
  private readonly rows = new Map<string, TalkSession>();
  private readonly now: () => number;
  private readonly idleMs: number;
  private readonly max: number;

  constructor(o: { now?: () => number; idleMs?: number; max?: number } = {}) {
    this.now = o.now ?? Date.now;
    this.idleMs = o.idleMs ?? TALK_IDLE_MS;
    this.max = o.max ?? SESSIONS_MAX;
  }

  private key = (userId: string, talkId: string): string => `${userId}\u0000${talkId}`;

  get(userId: string, talkId: string): TalkSession | null {
    const k = this.key(userId, talkId);
    const s = this.rows.get(k);
    if (!s) return null;
    if (this.now() - s.at > this.idleMs) { this.rows.delete(k); return null; }
    return structuredClone(s);
  }

  /** A turn kept. A turn with a number already kept replaces it; past TALK_TURNS the oldest are folded. */
  add(userId: string, talkId: string, turn: Omit<TalkTurn, "at"> & { at?: number }): TalkSession {
    const now = this.now();
    const k = this.key(userId, talkId);
    let s = this.rows.get(k);
    if (s && now - s.at > this.idleMs) { this.rows.delete(k); s = undefined; }
    s ??= { userId, talkId, summary: "", turns: [], at: now };
    const t: TalkTurn = {
      n: turn.n, said: oneLine(turn.said, SAID_MAX), answer: oneLine(turn.answer, ANSWER_MAX), kind: turn.kind, at: turn.at ?? now,
      ...(turn.goal && turn.goal.trim() !== turn.said.trim() ? { goal: oneLine(turn.goal, SAID_MAX) } : {}),
      ...(turn.found ? { found: turn.found } : {}),
    };
    s.turns = [...s.turns.filter((x) => x.n !== t.n), t].sort((a, b) => a.n - b.n || a.at - b.at);
    while (s.turns.length > TALK_TURNS) s.summary = foldTurn(s.summary, s.turns.shift()!);
    s.at = now;
    // Most recently used last, so the first is the one idle longest.
    this.rows.delete(k);
    this.rows.set(k, s);
    while (this.rows.size > this.max) this.rows.delete(this.rows.keys().next().value as string);
    return structuredClone(s);
  }

  /** Every talk of this person, forgotten (their context cleared). */
  forget(userId: string): void {
    for (const [k, s] of this.rows) if (s.userId === userId) this.rows.delete(k);
  }

  get size(): number { return this.rows.size; }
}

let shared: TalkSessions | null = null;
/** The process's talks. */
export function talkSessions(): TalkSessions {
  return (shared ??= new TalkSessions());
}
export function resetTalkSessionsForTests(): void { shared = null; flying.clear(); }

// ---- the turn in flight ------------------------------------------------------------------------------------------

const flying = new Map<string, { ctrl: AbortController; stopped: boolean }>();
const flightKey = (userId: string, talkId: string): string => `${userId}\u0000${talkId}`;

export interface Flight {
  readonly signal: AbortSignal;
  /** The person stopped it (POST /v1/talk/stop, or a new turn of the same talk), not a dropped connection. */
  readonly stopped: boolean;
  /** Stops it from here: the connection dropped. */
  abort(): void;
  end(): void;
}

/** The turn now being answered in this talk. A turn already in flight in it is stopped: the person spoke again. */
export function flight(userId: string, talkId: string): Flight {
  const k = flightKey(userId, talkId);
  const before = flying.get(k);
  if (before) { before.stopped = true; before.ctrl.abort(); }
  const me = { ctrl: new AbortController(), stopped: false };
  flying.set(k, me);
  return {
    signal: me.ctrl.signal,
    get stopped() { return me.stopped; },
    abort() { me.ctrl.abort(); },
    end() { if (flying.get(k) === me) flying.delete(k); },
  };
}

/** The person interrupted: the turn in flight in this talk of theirs stops. False when there is none. */
export function stopTalk(userId: string, talkId: unknown): boolean {
  if (typeof talkId !== "string" || !TALK_ID.test(talkId)) return false;
  const f = flying.get(flightKey(userId, talkId));
  if (!f) return false;
  f.stopped = true;
  f.ctrl.abort();
  return true;
}
