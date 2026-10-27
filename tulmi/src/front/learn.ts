/**
 * WHAT THE FRONT DOOR LEARNS FROM HOW ITS ANSWERS WENT: SMALL, BOUNDED, AND SAID IN WORDS.
 *
 * Two things, both read from the decision log's counts (store.ts) and nothing else:
 *
 *   A PERSON'S VISUAL HABIT. Someone who closes the visuals they were given more than they keep them is shown fewer; someone who keeps
 *   them, more. The habit is (kept + 2) / (kept + closed + 4): 0.5 with no history, never 0 or 1, and it moves the evidence for a visual by
 *   0.6 to 1.4 times at most (visual.ts habitFactor). It cannot turn off a visual the person asked for, or a design.
 *
 *   A RULE'S TRUST, PER INTENT. When a message the rules were sure of is often followed within a minute by a similar one (the person
 *   rephrased: the answer missed) or a thumbs-down, the rules' confidence for THAT intent is cut, by up to 30%, so the small model is
 *   asked more often there. A thumbs-up gives some of it back. With fewer than 5 messages of an intent there is no cut.
 *
 * Every adjustment comes with a reason a person could read ("3 of your last 8 answers were rephrased"); it goes into the decision's
 * reasons. The numbers are bounded here so that a bad week cannot make the front door unusable, and a good one cannot make it sure.
 *
 * It also WATCHES FOR A REPHRASE: the words of a person's last message are kept in memory for 60 seconds as a set of word hashes (never
 * the text, never on disk), and a new message that shares half or more of them with it, from the same person, marks the earlier one
 * "rephrased" in the log.
 */
import { createHash } from "node:crypto";
import type { FrontStore, Summary } from "./store.js";
import type { Intent } from "./types.js";

/** The habit with no history: neither. */
export const HABIT_PRIOR = 0.5;
/** The most a rule's confidence is cut for an intent, and how many messages of it there must be first. */
export const MAX_CUT = 0.3;
export const MIN_SAMPLE = 5;
export const REPHRASE_WINDOW_MS = 60_000;
/** Words shared, as a share of the smaller message, at which a message is "similar". */
export const SIMILAR = 0.5;
const SUMMARY_TTL_MS = 60_000;

export interface Habit { value: number; why: string }
export interface Trust { factor: number; why: string }

export function habitOf(s: Pick<Summary, "visual">): Habit {
  const { kept, closed } = s.visual;
  const value = (kept + 2) / (kept + closed + 4);
  const total = kept + closed;
  const why = total === 0 ? "no history" : kept >= closed ? `kept ${kept} of ${total} visuals` : `closed ${closed} of ${total} visuals`;
  return { value: Math.round(value * 1000) / 1000, why };
}

export function trustOf(s: Pick<Summary, "byIntent">, intent: Intent): Trust {
  const b = s.byIntent[intent];
  if (!b || b.n < MIN_SAMPLE) return { factor: 1, why: "not enough history" };
  // A thumbs-up gives back half a miss; the rate is smoothed so one rephrase in five does not move much.
  const bad = Math.max(0, b.rephrased + b.down - b.up * 0.5);
  const rate = bad / (b.n + 3);
  const cut = Math.min(MAX_CUT, rate * 0.6);
  if (cut < 0.02) return { factor: 1, why: "answers have held" };
  return { factor: Math.round((1 - cut) * 1000) / 1000, why: `${b.rephrased + b.down} of ${b.n} ${intent} messages were rephrased or marked down` };
}

export interface LearningOptions {
  now?: () => number;
  ttlMs?: number;
}

/** What is known of each person, read from the log at most once a minute. */
export class Learning {
  private readonly cache = new Map<string, { at: number; summary: Summary }>();
  private readonly now: () => number;
  private readonly ttl: number;

  constructor(private readonly store: FrontStore, o: LearningOptions = {}) {
    this.now = o.now ?? Date.now;
    this.ttl = o.ttlMs ?? SUMMARY_TTL_MS;
  }

  /** The person's counts. A log that cannot be read means nothing is known, never a failed message. */
  async summary(userId: string): Promise<Summary> {
    const t = this.now();
    const hit = this.cache.get(userId);
    if (hit && t - hit.at < this.ttl) return hit.summary;
    let summary: Summary;
    try {
      summary = await this.store.summary(userId, t);
    } catch {
      summary = { rows: 0, visual: { kept: 0, closed: 0 }, byIntent: {} };
    }
    this.cache.set(userId, { at: t, summary });
    if (this.cache.size > 5_000) this.cache.delete(this.cache.keys().next().value!);
    return summary;
  }

  async habit(userId: string): Promise<Habit> { return habitOf(await this.summary(userId)); }
  async trust(userId: string, intent: Intent): Promise<Trust> { return trustOf(await this.summary(userId), intent); }

  /** What a tap on a visual or a thumb changes is felt at the next message, not a minute later. */
  forget(userId: string): void { this.cache.delete(userId); }
}

// ------------------------------------------------------------------ rephrasing

const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const STOP = new Set(["the", "a", "an", "of", "to", "and", "in", "on", "for", "is", "it", "me", "my", "i", "you", "please", "can", "do", "ka", "ki", "ke", "hai", "ko", "se", "mein", "me", "ek", "aur"]);

/** A message as a set of short word hashes: enough to tell a rephrase, nothing to read back. */
export function signature(message: string): Set<string> {
  const out = new Set<string>();
  for (const w of message.toLowerCase().match(WORD) ?? []) {
    if (w.length < 2 || STOP.has(w)) continue;
    out.add(createHash("sha1").update(w).digest("hex").slice(0, 8));
  }
  return out;
}

/** How much of the smaller message the other shares: 0 to 1. */
export function similarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/** Watches for the same person sending a similar message within a minute. In memory, per process, bounded. */
export class RephraseWatch {
  private readonly last = new Map<string, { at: number; id: string; sig: Set<string> }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** The id of the person's previous message if this one is a rephrase of it. Call before `remember`. */
  check(userId: string, message: string): string | null {
    const prev = this.last.get(userId);
    if (!prev || this.now() - prev.at > REPHRASE_WINDOW_MS) return null;
    return similarity(prev.sig, signature(message)) >= SIMILAR ? prev.id : null;
  }

  remember(userId: string, id: string, message: string): void {
    this.last.delete(userId);
    this.last.set(userId, { at: this.now(), id, sig: signature(message) });
    if (this.last.size > 10_000) this.last.delete(this.last.keys().next().value!);
  }
}
