/**
 * REPLY TO A BOT FROM ITS NOTIFICATION, WITHOUT OPENING THE APP (docs/widgets.md §5).
 *
 * A bot says something that invites an answer. The push carries the category `x0_bot_reply`, whose one button has a typing box, so
 * the person answers from the lock screen. The phone sends what they typed straight to POST /v1/bots/:slug/notify-reply (the
 * category's `call`, filled from the push's own data: F:src/notifications/categoriesCore.ts fillTemplate / fillBody). The route feeds
 * it into that bot's chat exactly as a message typed in the app, and the bot's answer goes back as another push of the same kind,
 * category and conversation — so the two can go back and forth with the app shut. NOTHING ON THE PHONE CHANGES: the category is a
 * bootstrap knob, and the button is a `call`, which the app has been able to make since the categories landed.
 *
 *   NOTIFY_REPLY         the switch. Off (the default): no push carries the category, and the route answers 404
 *   NOTIFY_REPLY_USERS   a comma list of account ids. Set, only they get it, even with the switch on. Empty: everyone, with it on
 *   NOTIFY_REPLY_PER_HOUR  replies one person may send from notifications in an hour (20)
 *
 * The rules it keeps:
 *   - the bot must be the person's own, or a built-in they use; anyone else's is a 404, never a 403
 *   - the typed words are trimmed and capped (REPLY_MAX); nothing is a 400
 *   - one press is one reply: the same `key` again gets the first answer back, never a second run of the model (the phone retries a
 *     press that didn't land, with the same body)
 *   - no AI permission yet (privacy/aiGate.ts): the model is NOT asked. A push says to open X0, and the chat opens
 *   - quiet hours and "What pings you" are the engine's and you/push.ts's, as for every push: a muted bot stays muted
 *   - a private bot's push never shows the words on the lock screen, only that there is something to read
 */
import { createHash } from "node:crypto";
import { getConfig } from "../config.js";
import { aiAllowedFor, asPerson } from "../privacy/aiGate.js";

/** The category's id, and its one button's. A button id is unique across every category (categoriesCore.ts cleanCategories). */
export const BOT_REPLY_CATEGORY = "x0_bot_reply";
export const BOT_REPLY_BUTTON = "b_reply";
/** The route the button calls. `{data.slug}` is filled from the push's own data by the phone. */
export const BOT_REPLY_PATH = "/v1/bots/{data.slug}/notify-reply";

/** The push kinds that may carry it: a bot asking something, and the bot's answer to a reply typed into a notification. */
export const BOT_REPLY_KINDS = ["bot_ask", "bot_reply"] as const;
export type BotReplyKind = (typeof BOT_REPLY_KINDS)[number];

/** The most a person may type into a notification (the chat takes far more; this is a lock-screen box). */
export const REPLY_MAX = 2000;

/** How long an answered press is remembered, so a retry of it gets the same answer rather than a second one. */
const KEY_KEEP_MS = 6 * 60 * 60_000;
const KEYS_MAX = 5000;
const HOUR = 60 * 60_000;

/**
 * The category, shaped exactly as the phone's cleanCategories wants it (F:src/notifications/categoriesCore.ts): a category id of
 * letters, digits and _; one action, id [a-z0-9_]; a text field; and a `call` to a /v1/ path with the typed words in its body.
 * experience/appKnobs.ts adds it to the bootstrap's push.categories while the switch is on.
 */
export const BOT_REPLY_CATEGORIES = [{
  id: BOT_REPLY_CATEGORY,
  actions: [{
    id: BOT_REPLY_BUTTON,
    title: "Reply",
    icon: "arrowshape.turn.up.left",
    input: { placeholder: "Reply…", send: "Send" },
    foreground: false,
    destructive: false,
    auth: false,
    call: {
      method: "POST" as const,
      path: BOT_REPLY_PATH,
      // `{text}` is what was typed; the rest comes from the push's data. The key is the push's own id, so the phone retrying a
      // press that didn't land sends the same key and the server answers it once.
      body: { text: "{text}", thread: "{data.thread}", key: "{data.pushId}" },
    },
  }],
}] as const;

// ------------------------------------------------------------------ the switch

function switches(): { on: boolean; only: string } {
  try {
    const c = getConfig();
    return { on: c.NOTIFY_REPLY, only: c.NOTIFY_REPLY_USERS };
  } catch {
    return { on: (process.env.NOTIFY_REPLY ?? "").toLowerCase() === "true", only: process.env.NOTIFY_REPLY_USERS ?? "" };
  }
}

/**
 * The switch alone, whoever asks: what the route checks before the session, when it does not know who is asking yet. A person the
 * NOTIFY_REPLY_USERS list names must get past this, so it never reads the list (notifyReplyOn does, once the session is known).
 */
export function notifyReplySwitchOn(): boolean { return switches().on; }

/** Is replying from a notification on for this person? Read on every call, so a test can flip it with resetConfigForTests. */
export function notifyReplyOn(userId?: string | null): boolean {
  const { on, only } = switches();
  if (!on) return false;
  const list = only.split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) return true;
  return !!userId && list.includes(userId);
}

/** How many replies one person may send from notifications in an hour. */
export function repliesPerHour(): number {
  try { return getConfig().NOTIFY_REPLY_PER_HOUR; } catch { return Number(process.env.NOTIFY_REPLY_PER_HOUR) || 20; }
}

// ------------------------------------------------------------------ what the push carries

export interface BotPush {
  /** The bot the person would be answering. */
  slug: string;
  /** Its name, for the push's title. */
  name: string;
  /** What it said. Never shown on the lock screen when `private`. */
  line: string;
  /** The conversation, so follow-ups are one conversation and the reply knows where it goes. A bot chat is one per person and bot. */
  thread?: string;
  /** A bot or a message the person keeps to themselves: the body says there is something, not what. */
  private?: boolean;
  /** A push that only says to open X0 (no AI agreement yet): no Reply box on it, since a reply typed there could not be answered. */
  noReply?: boolean;
  /**
   * THE ROUTINE WHOSE ANSWER THIS IS (routines/service.ts `told`), when it is one. It rides in the push's `data`, so "What pings
   * you" can tell a routine's answer from a bot speaking out of the blue: a routine was asked for at that time, so it goes even for
   * a bot the person muted, exactly as `routine_done` always has (you/push.ts verdict). Nothing else sets it.
   */
  routineId?: string;
}

/** The words a push of a bot's may show. A private one says only that there is something to read. */
export const lineOf = (p: BotPush): string => (p.private ? "Sent you a message." : p.line.replace(/\s+/g, " ").trim().slice(0, 140));

/**
 * A bot's pushes that spoke first, as one notification: iOS replaces the one already shown (the collapse id) and Android the one with
 * the same tag, so they are one thing in the tray instead of a pile. Only a phone whose JS tells its handled presses apart by push id
 * gets one (push/engine.ts), so an older build simply sees each push on its own.
 *
 * ONLY `bot_ask`. The phone dismisses the notification it answered, by its identifier, once the reply call succeeds (the app's
 * notifications/actions.ts), and a collapse id IS that identifier on iOS (and the tag on Android). The route pushes the bot's answer
 * before it answers the call, so an answer under the same collapse id could replace the notification first and then be dismissed in
 * its place. An answer (`bot_reply`) therefore has an identifier of its own; the one it answers is dismissed by the phone, so the
 * tray still shows one at a time.
 */
export const threadIdOf = (slug: string): string => `botchat-${slug}`;

/** What engine.notify is given for a bot's push. While the switch is off for this person it carries no category. */
export function askMessage(userId: string, kind: BotReplyKind, p: BotPush, key: string): {
  kind: BotReplyKind; key: string; vars: Record<string, string>; data: Record<string, string>; category?: string; collapseId?: string;
} {
  const thread = p.thread || p.slug;
  const on = !p.noReply && notifyReplyOn(userId);
  return {
    kind, key,
    vars: { bot: p.name, line: lineOf(p) },
    // The screen the tap opens is the chat with this bot; slug and thread are what the Reply button's call is filled from. A
    // routine's answer says so, which is how "What pings you" keeps giving it the routine's rule (you/push.ts verdict).
    data: { slug: p.slug, thread, ...(p.routineId ? { routineId: p.routineId } : {}) },
    ...(on ? { category: BOT_REPLY_CATEGORY } : {}),
    ...(on && kind === "bot_ask" ? { collapseId: threadIdOf(thread) } : {}),
  };
}

// ------------------------------------------------------------------ a bot that spoke first

/**
 * A BOT TURN NOBODY ASKED FOR (botsBots/chat.ts note): the bot said something into the person's chat on its own, which is exactly the
 * kind of message that invites an answer. The server installs what to do with it (server.ts); until then, and while the switch is
 * off, nothing happens and the turn is only kept, as before. A live call's notes pass `quiet`, since the person is already talking.
 *
 * It is a hook rather than a plain import so chat.ts keeps no road to the push engine, which reads this file itself.
 *
 * THIS IS THE DOOR FOR A NON-QUIET `note()`, AND NOBODY USES IT TODAY. Both of `note()`'s callers pass `quiet`:
 * botsBots/planCall.ts (the person is on the call and already hearing the line) and the routines wiring in server.ts, which sends a
 * `bot_ask` of its own instead (routines/service.ts `told`) and keeps the turn quietly so a reply has its subject. So the hook is
 * live and wired (server.ts `setBotSaidHook(botSaidPush(...))`), and the first `note()` written without `quiet` starts a reply-able
 * conversation with no further work. Which of a bot's messages should is a product call: see docs/widgets.md §5.
 */
export type BotSaidHook = (userId: string, slug: string, text: string) => void;
let saidHook: BotSaidHook | null = null;
export function setBotSaidHook(fn: BotSaidHook | null): void { saidHook = fn; }

/** Tell whoever is listening that a bot spoke first. Never throws: a missed push is not a lost turn, the chat has it. */
export function botSaid(userId: string, slug: string, text: string): void {
  if (!saidHook || !notifyReplyOn(userId)) return;
  try { saidHook(userId, slug, text); } catch { /* the turn is in the chat either way */ }
}

/**
 * THE HOOK THE SERVER INSTALLS, made here so it is the same thing in the server and under test: what a bot saying something of its
 * own turns into. The bot is looked up as the person's (another person's is never pushed about, and one that isn't there sends
 * nothing), and its own words go out as a `bot_ask` with a Reply box on it. Its own bot is private, so the lock screen says only
 * that there is something to read.
 *
 * `bots` and `push` are passed in rather than imported: this file is read by the push engine's own, so it keeps no road back.
 * Never throws and never waits: a missed push is not a lost turn, the chat has it.
 */
export function botSaidPush(
  bots: { resolve(userId: string, ref: string): Promise<{ def: { slug: string; name: string; ownerId: string | null } } | null> } | null,
  push: (userId: string, kind: BotReplyKind, p: BotPush, key: string) => Promise<void>,
  now: () => number = Date.now,
): BotSaidHook {
  return (userId, slug, text) => {
    void (async () => {
      const found = await bots?.resolve(userId, slug);
      if (!found) return;
      await push(userId, "bot_ask", {
        slug: found.def.slug, name: found.def.name, line: text, thread: found.def.slug,
        ...(found.def.ownerId !== null ? { private: true as const } : {}),
      }, `said:${found.def.slug}:${now()}`);
    })().catch(() => undefined);
  };
}

// ------------------------------------------------------------------ one press, one reply

interface Answered { at: number; reply: ReplyResult }

/** The presses already answered, by person, key and words. In memory, for KEY_KEEP_MS: a restart forgets, which only costs a repeat. */
const answered = new Map<string, Answered>();
/** A press still being answered, so two copies of it (Android hands one to the background task and to a running app) wait on one run. */
const running = new Map<string, Promise<ReplyResult>>();
/** When each person's replies went out, for the per-hour limit. */
const sent = new Map<string, number[]>();

export function resetNotifyReplyForTests(): void { answered.clear(); running.clear(); sent.clear(); }

function remember(k: string, reply: ReplyResult, now: number): void {
  answered.set(k, { at: now, reply });
  if (answered.size <= KEYS_MAX) return;
  for (const [key, v] of answered) { if (now - v.at > KEY_KEEP_MS || answered.size > KEYS_MAX) answered.delete(key); if (answered.size <= KEYS_MAX) break; }
}

/** Whether this person may send another reply now, and the window's count. */
function withinRate(userId: string, now: number): boolean {
  const max = repliesPerHour();
  const mine = (sent.get(userId) ?? []).filter((t) => now - t < HOUR);
  if (mine.length >= max) { sent.set(userId, mine); return false; }
  mine.push(now);
  sent.set(userId, mine);
  return true;
}

export interface ReplyResult {
  /** "sent": the bot answered and the answer was pushed back. "open": the person has not agreed to AI, so nothing was asked. */
  state: "sent" | "open";
  /** What the bot said, for the caller's own answer (the phone shows nothing; it dismisses the notification on a 2xx). */
  text: string;
}

export class NotifyReplyError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "NotifyReplyError"; }
}

export interface NotifyReplyDeps {
  /** The bot, if it is this person's own or a built-in they use; null for anyone else's and for one that isn't there. */
  find: (userId: string, slug: string) => Promise<{ slug: string; name: string; private?: boolean } | null>;
  /** Feed the words into that bot's chat, exactly as the app does: same history, same tools, same rules. */
  say: (userId: string, slug: string, text: string) => Promise<string>;
  /** Push one message to the person's phones (push/index.ts notifyBot). */
  push: (userId: string, kind: BotReplyKind, p: BotPush, key: string) => Promise<void>;
  /** Whether the person has agreed to AI (privacy/aiGate.ts aiAllowedFor by default). */
  aiAllowed?: (userId: string) => Promise<boolean>;
  now?: () => number;
}

/** What a reply typed into a notification does. One per server. */
export class NotifyReplies {
  private readonly aiAllowed: (userId: string) => Promise<boolean>;
  private readonly now: () => number;

  constructor(private readonly d: NotifyReplyDeps) {
    this.aiAllowed = d.aiAllowed ?? aiAllowedFor;
    this.now = d.now ?? Date.now;
  }

  /** The typed words, checked. Throws NotifyReplyError for anything a lock-screen box should not have sent. */
  static textOf(v: unknown): string {
    const t = typeof v === "string" ? v.trim() : "";
    if (!t) throw new NotifyReplyError(400, "bad_request", "Type something first.");
    if (t.length > REPLY_MAX) throw new NotifyReplyError(413, "too_large", `A reply may be ${REPLY_MAX} characters at most.`);
    return t;
  }

  /** The press's key: the phone sends the push's own id. Without one the reply still goes, once, under a key of its own. */
  static keyOf(v: unknown, fallback: string): string {
    const k = typeof v === "string" ? v.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 120) : "";
    return k.length >= 8 ? k : fallback;
  }

  /**
   * One reply. The same key and the same words again get the first answer back, so a press retried from the phone's owed list (it
   * keeps the body it first sent) is one reply, one model run and one push. The key is the push's id, so the words are part of what
   * is remembered: a second, different reply typed into the same notification (the first had not landed, so it was not dismissed) is
   * a second message, never answered with the first one's reply and dropped.
   */
  async reply(userId: string, slug: string, body: { text: unknown; key: unknown; thread?: unknown }): Promise<ReplyResult> {
    const text = NotifyReplies.textOf(body.text);
    const key = NotifyReplies.keyOf(body.key, `${userId}:${this.now()}`);
    const at = `${userId}:${key}:${createHash("sha256").update(text).digest("base64url").slice(0, 16)}`;
    const now = this.now();
    const had = answered.get(at);
    if (had && now - had.at < KEY_KEEP_MS) return had.reply;
    const inflight = running.get(at);
    if (inflight) return inflight;
    const run = this.run(userId, slug, text).then(
      (r) => { remember(at, r, this.now()); running.delete(at); return r; },
      (e) => { running.delete(at); throw e; },
    );
    running.set(at, run);
    return run;
  }

  private async run(userId: string, slug: string, text: string): Promise<ReplyResult> {
    const bot = await this.d.find(userId, slug);
    // Another person's bot is not said to exist.
    if (!bot) throw new NotifyReplyError(404, "not_found", "There is no such bot.");
    if (!withinRate(userId, this.now())) {
      throw new NotifyReplyError(429, "too_many", "That's a lot of replies from notifications. Open X0 to carry on.");
    }
    // The person has not agreed to AI yet: nothing is asked of a model, and the push says where to finish it. It has no Reply box
    // (another reply from it could only be turned away the same way), and it is an answer, so it never takes the collapse id of the
    // notification the phone is about to dismiss.
    if (!(await this.aiAllowed(userId))) {
      await this.d.push(userId, "bot_reply", { slug: bot.slug, name: bot.name, line: "Open X0 to continue.", thread: bot.slug, noReply: true }, `open:${bot.slug}:${this.now()}`)
        .catch(() => undefined);
      return { state: "open", text: "" };
    }
    // The turn runs as the person, so everything it sends to an AI service is theirs (privacy/aiGate.ts).
    const said = await asPerson(userId, () => this.d.say(userId, bot.slug, text));
    const answer = (said ?? "").trim();
    if (answer) {
      await this.d.push(userId, "bot_reply", {
        slug: bot.slug, name: bot.name, line: answer, thread: bot.slug, ...(bot.private ? { private: true } : {}),
      }, `${bot.slug}:${this.now()}`).catch(() => undefined);
    }
    return { state: "sent", text: answer };
  }
}
