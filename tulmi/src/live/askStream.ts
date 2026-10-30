/**
 * AN ANSWER AS IT IS WRITTEN (shared/types/sdui.ts section 3f): the words and the steps of one ask, to the one person who asked,
 * over the live channel (bus.ts, routes/live.ts), and the way to stop it.
 *
 *   const s = openAskStream(userId, body.streamId)   // null without a good id: the ask goes on as it always did
 *   s.text(piece) · s.whole(text) · s.step("code:read:src/cart.ts") · s.reset() · s.end()
 *   s.signal                                          // fires on POST /v1/ask/stop { id } from the same person
 *
 * Events on the topic `ask:<id>`, whose `data` is one AskStreamPiece, numbered from 0. THE ONE EXCEPTION to bus.ts's "data is a
 * hint, never the content": these carry the answer's own words, and only to the person who asked (the bus delivers to their own
 * sockets), under an id only the asking screen knows. The answer itself still comes whole with the call, as it always did, and
 * is kept exactly as before; this is only how it looks while it comes.
 *
 * Words go out whole, gathered for FLUSH_MS at a time: a piece ends at a space, never inside a word, so a Devanagari conjunct, a
 * matra or an emoji is never cut in two (a run with no space for LONG_RUN characters goes out a grapheme short of its end). Nothing
 * more is sent once the words look like they hold a secret (`guard`): the answer, checked, comes with the call. What it is doing
 * (`step`) is said in a few words, from the server's own stages (stepWords), never made up.
 */
import { live as theBus, type LiveBus } from "./bus.js";

/** A stream id: the client makes it. */
export const STREAM_ID = /^[A-Za-z0-9_-]{16,64}$/;
export const streamTopic = (id: string): string => `ask:${id}`;
/** How long words gather before they go (ms). */
export const FLUSH_MS = 90;
/** A run of characters with no space in it this long goes out anyway (a long link, a line of code). */
export const LONG_RUN = 160;

export interface AskStream {
  readonly id: string;
  /** Fires when the person stops this ask (POST /v1/ask/stop). */
  readonly signal: AbortSignal;
  readonly stopped: boolean;
  /** The words sent so far (since the last reset), and those still gathering. */
  readonly said: string;
  /** More of the answer's words, as the model writes them. */
  text(piece: string): void;
  /** The answer, whole, from a road that does not stream: sent only when nothing of it was. */
  whole(text: string): void;
  /** A stage of the work ("reading", "tool:web_search", "code:read:src/cart.ts"): said in a few words when there are some for it. */
  step(stage: string): void;
  /** The words so far are void. */
  reset(): void;
  /** The ask is over: what is gathering goes, and the stream ends. */
  end(): void;
}

export interface AskStreamOptions {
  bus?: Pick<LiveBus, "publish">;
  /** True when the words so far look like they hold a secret: nothing more is sent, and what was is taken back. */
  guard?: (text: string) => boolean;
  flushMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

/** The asks out now that a stream id names, so a stop can find them. */
const open = new Map<string, { userId: string; ctrl: AbortController }>();

/** Stop the ask `id` of this person's. False when there is none (finished, or another person's). */
export function stopAsk(userId: string, id: unknown): boolean {
  if (typeof id !== "string" || !STREAM_ID.test(id)) return false;
  const o = open.get(id);
  if (!o || o.userId !== userId) return false;
  o.ctrl.abort();
  return true;
}

/** How many asks are out with a stream (tests). */
export const openAsks = (): number => open.size;

/** A stage of the work in a few words, or null when there are none worth saying for it. */
export function stepWords(stage: string): string | null {
  if (stage.startsWith("code:read:")) {
    const name = stage.slice("code:read:".length).split("/").filter(Boolean).pop() ?? "";
    return name ? `Looking at ${name.slice(0, 40)}…` : "Reading the code…";
  }
  if (stage.startsWith("tool:")) {
    const t = stage.slice(5);
    if (t === "web_search") return "Searching the web…";
    if (t === "read_page") return "Reading a page…";
    if (t === "research") return "Looking into it…";
    if (t === "code_ask") return "Asking Xode…";
    if (t === "search_knowledge") return "Looking through its files…";
    if (/^artifact/.test(t)) return "Making it…";
    if (/^(calendar|tasks)_/.test(t)) return t.startsWith("tasks") ? "Checking your to-dos…" : "Checking your calendar…";
    return "Using your apps…";
  }
  switch (stage) {
    case "reading": return "Reading…";
    case "thinking": return "Thinking…";
    case "working": return "Working on it…";
    case "reading_code": case "code:locate": return "Reading the project…";
    case "code:grep": return "Searching the code…";
    case "code:write": case "writing": return "Writing it up…";
    case "starting_job": return "Starting the work…";
    case "designing": return "Designing it…";
    case "researching": return "Looking into it…";
    case "planning": return "Making a plan…";
    case "visual": return "Drawing it…";
    default: return null;
  }
}

let segmenter: Intl.Segmenter | null | undefined;
/** The end of `s` less its last grapheme (so a character, or a cluster of them, is never cut). */
function lessLastGrapheme(s: string): number {
  if (segmenter === undefined) { try { segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" }); } catch { segmenter = null; } }
  if (segmenter) {
    let last = 0;
    for (const g of segmenter.segment(s)) last = g.index;
    return last;
  }
  // No segmenter: back off over marks, joiners and a low surrogate.
  let i = s.length - 1;
  while (i > 0 && /[\p{M}‌‍\udc00-\udfff]/u.test(s[i]!)) i--;
  return Math.max(0, i);
}

/** How much of `pending` can go now: up to its last space, or (a long run with none) all but its last grapheme. */
export function sendable(pending: string, final = false): number {
  if (final) return pending.length;
  const m = /\s(?=\S*$)/.exec(pending);
  if (m) return m.index + 1;
  return pending.length >= LONG_RUN ? lessLastGrapheme(pending) : 0;
}

export function openAskStream(userId: string, id: unknown, o: AskStreamOptions = {}): AskStream | null {
  if (!userId || typeof id !== "string" || !STREAM_ID.test(id) || open.has(id)) return null;
  const bus = o.bus ?? theBus;
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const flushMs = o.flushMs ?? FLUSH_MS;
  const ctrl = new AbortController();
  open.set(id, { userId, ctrl });
  const topic = streamTopic(id);
  let n = 0;
  let sent = "";
  let pending = "";
  let lastStep = "";
  let timer: unknown = null;
  let blocked = false;
  let done = false;

  const say = (piece: Record<string, unknown>): void => { bus.publish([userId], topic, { n: n++, ...piece }); };
  const stepTo = (words: string): void => { if (words && words !== lastStep) { lastStep = words; say({ step: words }); } };
  const flush = (final: boolean): void => {
    if (timer != null) { clearTimer(timer); timer = null; }
    if (blocked || !pending) return;
    const k = sendable(pending, final);
    if (k <= 0) return;
    const out = pending.slice(0, k);
    if (o.guard?.(sent + pending)) {
      // It looks like a secret: nothing more goes, and what went is taken back.
      blocked = true;
      pending = "";
      if (sent) { sent = ""; say({ reset: true }); }
      return;
    }
    if (!sent) stepTo("Writing it up…");
    pending = pending.slice(k);
    sent += out;
    say({ text: out });
  };
  const later = (): void => { if (timer == null && !done) timer = setTimer(() => { timer = null; flush(false); }, flushMs); };

  return {
    id,
    signal: ctrl.signal,
    get stopped() { return ctrl.signal.aborted; },
    get said() { return sent + pending; },
    text(piece: string) {
      if (done || blocked || typeof piece !== "string" || !piece) return;
      pending += piece;
      later();
    },
    whole(text: string) {
      if (done || blocked || sent || pending || typeof text !== "string" || !text) return;
      pending = text;
      flush(true);
    },
    step(stage: string) {
      if (done) return;
      const words = stepWords(stage);
      if (words) stepTo(words);
    },
    reset() {
      if (done) return;
      if (timer != null) { clearTimer(timer); timer = null; }
      const had = !!(sent || pending);
      sent = "";
      pending = "";
      blocked = false;
      if (had) say({ reset: true });
    },
    end() {
      if (done) return;
      flush(true);
      done = true;
      say({ end: true });
      if (open.get(id)?.ctrl === ctrl) open.delete(id);
    },
  };
}
