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

/** Is replying from a notification on at all? Read on every call, so a test can flip it with resetConfigForTests. */
export function notifyReplyOn(userId?: string | null): boolean {
  let on: boolean;
  let only: string;
  try {
    const c = getConfig();
    on = c.NOTIFY_REPLY;
    only = c.NOTIFY_REPLY_USERS;
  } catch {
    on = (process.env.NOTIFY_REPLY ?? "").toLowerCase() === "true";
    only = process.env.NOTIFY_REPLY_USERS ?? "";
  }
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
}

/** The words a push of a bot's may show. A private one says only that there is something to read. */
export const lineOf = (p: BotPush): string => (p.private ? "Sent you a message." : p.line.replace(/\s+/g, " ").trim().slice(0, 140));

/**
 * One bot conversation, as one notification: iOS replaces the one already shown (the collapse id) and Android the one with the same
 * tag, so a back-and-forth is one thing in the tray instead of a pile. Only a phone whose JS tells its handled presses apart by push
 * id gets one (push/engine.ts), so an older build simply sees each push on its own.
 */
export const threadIdOf = (slug: string): string => `botchat-${slug}`;

/** What engine.notify is given for a bot's push. Null while the switch is off for this person: then it carries no category. */
export function askMessage(userId: string, kind: BotReplyKind, p: BotPush, key: string): {
  kind: BotReplyKind; key: string; vars: Record<string, string>; data: Record<string, string>; category?: string; collapseId?: string;
} {
  const thread = p.thread || p.slug;
  const on = notifyReplyOn(userId);
  return {
    kind, key,
    vars: { bot: p.name, line: lineOf(p) },
    // The screen the tap opens is the chat with this bot; slug and thread are what the Reply button's call is filled from.
    data: { slug: p.slug, thread },
    ...(on ? { category: BOT_REPLY_CATEGORY, collapseId: threadIdOf(thread) } : {}),
  };
}

// ------------------------------------------------------------------ a bot that spoke first

/**
 * A BOT TURN NOBODY ASKED FOR (botsBots/chat.ts note): the bot said something into the person's chat on its own, which is exactly the
 * kind of message that invites an answer. The server installs what to do with it (server.ts); until then, and while the switch is
 * off, nothing happens and the turn is only kept, as before. A live call's notes pass `quiet`, since the person is already talking.
 *
 * It is a hook rather than a plain import so chat.ts keeps no road to the push engine, which reads this file itself.
 */
export type BotSaidHook = (userId: string, slug: string, text: string) => void;
let saidHook: BotSaidHook | null = null;
export function setBotSaidHook(fn: BotSaidHook | null): void { saidHook = fn; }

/** Tell whoever is listening that a bot spoke first. Never throws: a missed push is not a lost turn, the chat has it. */
export function botSaid(userId: string, slug: string, text: string): void {
  if (!saidHook || !notifyReplyOn(userId)) return;
  try { saidHook(userId, slug, text); } catch { /* the turn is in the chat either way */ }
}

// ------------------------------------------------------------------ one press, one reply

interface Answered { at: number; reply: ReplyResult }

/** The presses already answered, by person and key. In memory: a retry lands on the same server within the minute. */
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
   * One reply. The same key again gets the first answer back, so a press retried from the phone's owed list is one reply, one model
   * run and one push.
   */
  async reply(userId: string, slug: string, body: { text: unknown; key: unknown; thread?: unknown }): Promise<ReplyResult> {
    const text = NotifyReplies.textOf(body.text);
    const key = NotifyReplies.keyOf(body.key, `${userId}:${this.now()}`);
    const at = `${userId}:${key}`;
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
    // The person has not agreed to AI yet: nothing is asked of a model, and the push says where to finish it.
    if (!(await this.aiAllowed(userId))) {
      await this.d.push(userId, "bot_ask", { slug: bot.slug, name: bot.name, line: "Open X0 to continue.", thread: bot.slug }, `open:${this.now()}`)
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
