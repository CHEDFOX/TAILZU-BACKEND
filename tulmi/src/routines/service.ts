/**
 * ROUTINES: A BOT DOES SOMETHING ON A SCHEDULE, WITHOUT BEING ASKED EACH TIME (docs/routines.md).
 *
 *   draft    what the person said, read (words.ts): the schedule, the task, and the bot "Ask any bot" would pick for it. Nothing is kept:
 *            the card shows it and the person saves it (or changes it). A token carries the draft back, so Save sends what was shown.
 *   create   kept, on, its first run worked out. At most `max` a person.
 *   update   pause, resume (its next run from now, its failures forgotten), or a new task, bot or time
 *   remove   gone
 *   runNow   once now, its schedule unchanged ("Run now" on the list)
 *   tick     every minute: each routine that is due runs once, as its owner, through the bot's own road (bots/service.ts ask): the bot's
 *            rules, skills, apps, memory and budget, and the same confirm card for anything that sends, deletes or pays. Its answer is
 *            kept on the routine, written down for Activity and pushed to the phone — as `routine_done`, or, with NOTIFY_REPLY on for
 *            the owner, as the bot's own `bot_ask` with a Reply box on it, the answer kept in that bot's chat (`told` below).
 *
 * A run that is late by more than LATE_MS (the server was down) is skipped, not run hours after it meant anything: the next one is
 * worked out from now. Three failed runs in a row pause it, with why; so does its bot being deleted.
 */
import { randomUUID } from "node:crypto";
import { AI_CONSENT_TEXT, aiAllowedFor, asPerson } from "../privacy/aiGate.js";
import { BotError } from "../bots/types.js";
import type { BotAnswer, BotDef } from "../bots/types.js";
import { CODE_SLUG } from "../bots/builtin.js";
import type { FrontCtx } from "../front/types.js";
import type { EventStore } from "../shell/events.js";
import type { Routine, RoutinePatch, RoutineStore, RunStatus } from "./store.js";
import { notifyReplyOn, type BotPush } from "../bots/notifyReply.js";
import { cleanSchedule, nextRun, nextWords, readRoutine, scheduleWords, TASK_MAX, type Schedule } from "./words.js";

/** What routines need of the bots platform (bots/service.ts Bots). */
export interface RoutineBots {
  ask(userId: string, ref: string, input: { message: string; fresh?: boolean }): Promise<BotAnswer>;
  resolve(userId: string, ref: string): Promise<{ def: BotDef } | null>;
  target(userId: string, bot: string, message: string, ctx: Pick<FrontCtx, "mode" | "recent" | "attachments">): Promise<{ kind: "front" | "bot"; bot: BotDef | null }>;
  list(userId: string): Promise<Array<{ slug: string; name: string; builtin: boolean }>>;
}

export type RoutineNotify = (userId: string, msg: { kind: "routine_done" | "routine_failed"; key: string; vars: Record<string, string>; data: Record<string, string> }) => Promise<unknown>;

/**
 * THE ANSWER AS A BOT TURN, so a reply typed into its notification has its subject (botsBots/chat.ts note, always `quiet`: the push
 * is sent here, as a `bot_ask`, and never again by the note).
 *
 * `extra` is the run's own: the changes waiting for a yes and the links it opened, exactly as a typed turn carries them. Without it
 * the chat the push opens would show an answer saying it needs a yes with nothing to press, and the obvious reply ("yes") would only
 * start a fresh turn and make a second card.
 */
export type RoutineNote = (
  userId: string, slug: string, text: string,
  extra?: { approvals?: Array<{ taskId: string; connector: string; preview: string }>; opens?: Array<{ label: string; url: string }>; paise?: number },
) => Promise<unknown>;

/**
 * THE BOT'S OWN PUSH, WITH A REPLY BOX ON IT (push/index.ts notifyBot, kind `bot_ask`; src/bots/notifyReply.ts). Used in place of
 * `routine_done` while NOTIFY_REPLY is on for the owner, so the answer can be replied to from the lock screen.
 */
export type RoutineAsk = (userId: string, p: BotPush, key: string) => Promise<unknown>;

export interface RoutinesOptions {
  store: RoutineStore;
  bots: RoutineBots;
  events?: EventStore;
  notify?: RoutineNotify;
  /** Keep the answer as a bot turn in that bot's chat. Only with `askPush`, and only for the push that replaces `routine_done`. */
  note?: RoutineNote;
  /** The reply-able push. Absent, or the switch off for this person: `routine_done` goes, exactly as it did before. */
  askPush?: RoutineAsk;
  /** Tell the person's open screens (live/writes.ts livePublish). */
  publish?: (userId: string, topics: string[]) => void;
  now?: () => number;
  /** Routines a person may have. */
  max?: number;
}

export const ROUTINES_MAX = 20;
export const LATE_MS = 3 * 60 * 60_000;
export const FAILS_TO_PAUSE = 3;
/** "Run now" at most this often for one routine. */
export const RUN_NOW_GAP_MS = 60_000;
const TEXT_MAX = 4000;
const TICK_BATCH = 50;
const TICK_AT_ONCE = 3;
export const ROUTINE_TOPICS = ["routines", "home", "activity"];

export class RoutineError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = "RoutineError";
  }
}

export interface BotChoice { slug: string; name: string }

export interface Draft {
  task: string;
  schedule: Schedule;
  tz: number;
  when: string;
  timeSaid: boolean;
  next: string;
  /** The bot "Ask any bot" picked, or null when none fits (the card asks them to choose). */
  bot: BotChoice | null;
  /** Every bot that can take a routine: theirs and the built-ins, never Xode. */
  choices: BotChoice[];
  /** The draft, sealed for Save (base64url JSON). */
  token: string;
}

export interface RoutineView {
  id: string;
  bot: BotChoice;
  task: string;
  when: string;
  schedule: Schedule;
  tz: number;
  status: Routine["status"];
  pausedWhy: string;
  next: { at: number; words: string } | null;
  last: { at: number; words: string; status: RunStatus; text: string; paise: number } | null;
  runs: number;
}

const oneLine = (s: string, n: number): string => s.replace(/\s+/g, " ").trim().slice(0, n);

/** The draft's token: what Save sends back. Not a secret: everything in it is checked again on save. */
export const sealDraft = (d: { task: string; schedule: Schedule; tz: number; bot: string | null }): string =>
  Buffer.from(JSON.stringify({ t: d.task, s: d.schedule, z: d.tz, b: d.bot }), "utf8").toString("base64url");

export function openDraft(token: unknown): { task: string; schedule: Schedule; tz: number; bot: string | null } | null {
  if (typeof token !== "string" || token.length > 4000) return null;
  try {
    const o = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as { t?: unknown; s?: unknown; z?: unknown; b?: unknown };
    const schedule = cleanSchedule(o.s);
    if (!schedule || typeof o.t !== "string") return null;
    return { task: o.t, schedule, tz: Number.isFinite(Number(o.z)) ? Number(o.z) : 330, bot: typeof o.b === "string" ? o.b : null };
  } catch {
    return null;
  }
}

export class Routines {
  private readonly store: RoutineStore;
  private readonly bots: RoutineBots;
  private readonly now: () => number;
  private readonly max: number;
  private ticking = false;
  /** Routines a person may have. */
  get limit(): number { return this.max; }

  constructor(private readonly o: RoutinesOptions) {
    this.store = o.store;
    this.bots = o.bots;
    this.now = o.now ?? Date.now;
    this.max = o.max ?? ROUTINES_MAX;
  }

  /** Every bot that can take a routine. */
  async choices(userId: string): Promise<BotChoice[]> {
    const list = await this.bots.list(userId);
    return list.filter((b) => b.slug !== CODE_SLUG).map((b) => ({ slug: b.slug, name: b.name }));
  }

  /** What the words ask for, as a card to save, or null when they do not ask for something done on a schedule. */
  async draft(userId: string, message: string, tz: number, bot?: string): Promise<Draft | null> {
    const read = readRoutine(message, this.now(), tz);
    if (!read) return null;
    const choices = await this.choices(userId);
    let picked: BotChoice | null = null;
    if (bot && bot !== "any" && bot !== "tailzu") {
      picked = choices.find((c) => c.slug === bot) ?? null;
    } else {
      const t = await this.bots.target(userId, "any", read.task, { mode: "text", recent: [], attachments: [] }).catch(() => null);
      if (t?.kind === "bot" && t.bot && t.bot.slug !== CODE_SLUG) picked = { slug: t.bot.slug, name: t.bot.name };
    }
    const next = nextRun(read.schedule, tz, this.now());
    return {
      task: read.task, schedule: read.schedule, tz, when: scheduleWords(read.schedule), timeSaid: read.timeSaid,
      next: nextWords(next, tz, this.now()), bot: picked, choices,
      token: sealDraft({ task: read.task, schedule: read.schedule, tz, bot: picked?.slug ?? null }),
    };
  }

  private async botFor(userId: string, slug: unknown): Promise<BotChoice> {
    if (typeof slug !== "string" || !slug) throw new RoutineError("bot_required", "Pick the bot that does it.");
    if (slug === CODE_SLUG) throw new RoutineError("code_bot", "Xode can't take routines yet. Pick another bot.", 409);
    const found = await this.bots.resolve(userId, slug);
    if (!found) throw new RoutineError("not_found", "There is no such bot.", 404);
    return { slug: found.def.slug, name: found.def.name };
  }

  private taskOf(v: unknown): string {
    const task = typeof v === "string" ? oneLine(v, TASK_MAX + 1) : "";
    if (task.length < 3) throw new RoutineError("task_required", "Say what the bot should do each time.");
    if (task.length > TASK_MAX) throw new RoutineError("task_too_long", `What to do may be ${TASK_MAX} characters at most.`, 413);
    return task;
  }

  /** Saves a routine: from a draft's token (and the bot the person chose on the card), or from its parts. */
  async create(userId: string, body: { token?: unknown; task?: unknown; schedule?: unknown; tz?: unknown; bot?: unknown }): Promise<RoutineView> {
    const sealed = body.token !== undefined ? openDraft(body.token) : null;
    if (body.token !== undefined && !sealed) throw new RoutineError("bad_token", "That routine could not be read. Ask again.");
    const task = this.taskOf(sealed?.task ?? body.task);
    const schedule = sealed?.schedule ?? cleanSchedule(body.schedule);
    if (!schedule) throw new RoutineError("bad_schedule", "Say when it should run: every day, weekdays, a day of the week or a day of the month, at a time.");
    const tzRaw = Number(body.tz ?? sealed?.tz ?? 330);
    const tz = Number.isFinite(tzRaw) ? Math.max(-720, Math.min(840, Math.round(tzRaw))) : 330;
    const bot = await this.botFor(userId, typeof body.bot === "string" && body.bot ? body.bot : sealed?.bot);
    const mine = await this.store.list(userId);
    if (mine.length >= this.max) throw new RoutineError("routines_full", `You have ${this.max} routines, the most there can be. Delete one first.`, 409);
    if (mine.some((r) => r.task.toLowerCase() === task.toLowerCase() && r.bot === bot.slug && JSON.stringify(r.schedule) === JSON.stringify(schedule))) {
      throw new RoutineError("routine_exists", "You already have this routine.", 409);
    }
    const now = this.now();
    const r: Routine = {
      id: randomUUID(), userId, bot: bot.slug, botName: bot.name, task, schedule, tz, status: "on", pausedWhy: "",
      nextAt: nextRun(schedule, tz, now), lastAt: null, lastStatus: null, lastText: "", lastPaise: 0, runs: 0, fails: 0, createdAt: now, updatedAt: now,
    };
    await this.store.add(r);
    this.tell(userId);
    return this.view(r);
  }

  async list(userId: string): Promise<RoutineView[]> {
    const rs = await this.store.list(userId);
    // On first, soonest first; then the paused ones, newest first.
    rs.sort((a, b) => (a.status === b.status ? (a.status === "on" ? (a.nextAt ?? 0) - (b.nextAt ?? 0) : b.createdAt - a.createdAt) : a.status === "on" ? -1 : 1));
    return rs.map((r) => this.view(r));
  }

  async get(userId: string, id: string): Promise<RoutineView> {
    const r = await this.store.get(userId, id);
    if (!r) throw new RoutineError("not_found", "There is no such routine.", 404);
    return this.view(r);
  }

  async update(userId: string, id: string, body: { status?: unknown; task?: unknown; schedule?: unknown; tz?: unknown; bot?: unknown }): Promise<RoutineView> {
    const r = await this.store.get(userId, id);
    if (!r) throw new RoutineError("not_found", "There is no such routine.", 404);
    const now = this.now();
    const patch: RoutinePatch = {};
    if (body.task !== undefined) patch.task = this.taskOf(body.task);
    if (body.bot !== undefined) { const b = await this.botFor(userId, body.bot); patch.bot = b.slug; patch.botName = b.name; }
    if (body.tz !== undefined && Number.isFinite(Number(body.tz))) patch.tz = Math.max(-720, Math.min(840, Math.round(Number(body.tz))));
    if (body.schedule !== undefined) {
      const s = cleanSchedule(body.schedule);
      if (!s) throw new RoutineError("bad_schedule", "That schedule could not be read.");
      patch.schedule = s;
    }
    if (body.status !== undefined) {
      if (body.status !== "on" && body.status !== "paused") throw new RoutineError("bad_request", "status is on or paused.");
      patch.status = body.status;
      if (body.status === "on") { patch.fails = 0; patch.pausedWhy = ""; }
    }
    const status = patch.status ?? r.status;
    // Its next run, whenever it is on and its time could have changed.
    if (status === "on" && (patch.schedule || patch.tz !== undefined || (patch.status === "on" && r.status !== "on"))) {
      patch.nextAt = nextRun(patch.schedule ?? r.schedule, patch.tz ?? r.tz, now);
    }
    if (status === "paused") patch.nextAt = null;
    const out = await this.store.update(userId, id, patch, now);
    if (!out) throw new RoutineError("not_found", "There is no such routine.", 404);
    this.tell(userId);
    return this.view(out);
  }

  async remove(userId: string, id: string): Promise<void> {
    if (!(await this.store.remove(userId, id))) throw new RoutineError("not_found", "There is no such routine.", 404);
    this.tell(userId);
  }

  async removeAll(userId: string): Promise<void> { await this.store.removeAll(userId); }

  /** Runs it once now; its schedule is unchanged. */
  async runNow(userId: string, id: string): Promise<RoutineView> {
    const r = await this.store.get(userId, id);
    if (!r) throw new RoutineError("not_found", "There is no such routine.", 404);
    if (r.lastAt && this.now() - r.lastAt < RUN_NOW_GAP_MS) throw new RoutineError("too_soon", "It just ran. Try again in a minute.", 429);
    return this.view(await this.run(r, "now"));
  }

  /** Every routine that is due, once each. Returns how many ran. */
  async tick(): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    try {
      const now = this.now();
      const due = await this.store.due(now, TICK_BATCH);
      const mine: Routine[] = [];
      for (const r of due) {
        const was = r.nextAt!;
        const next = nextRun(r.schedule, r.tz, Math.max(now, was));
        if (!(await this.store.claim(r, was, next, now).catch(() => false))) continue;
        if (now - was > LATE_MS) continue;  // missed while the server was down: not run hours late
        mine.push({ ...r, nextAt: next });
      }
      for (let i = 0; i < mine.length; i += TICK_AT_ONCE) {
        await Promise.all(mine.slice(i, i + TICK_AT_ONCE).map((r) => this.run(r, "schedule").catch(() => undefined)));
      }
      return mine.length;
    } finally {
      this.ticking = false;
    }
  }

  /** One run, as the owner, through the bot's own road; its answer kept, written down and pushed. */
  private async run(r: Routine, why: "schedule" | "now"): Promise<Routine> {
    const at = this.now();
    let patch: RoutinePatch;
    let status: RunStatus;
    try {
      const found = await this.bots.resolve(r.userId, r.bot);
      if (!found) {
        const out = await this.store.update(r.userId, r.id, {
          status: "paused", nextAt: null, pausedWhy: `${r.botName || "Its bot"} was deleted. Pick another bot to turn it back on.`, lastAt: at, lastStatus: "failed", lastText: "", fails: r.fails + 1,
        }, at);
        this.tell(r.userId);
        return out ?? r;
      }
      // The owner has not agreed to AI processing (privacy/aiGate.ts): nothing is sent, and the routine says why. Not a failure of
      // the routine's own: it is not counted towards pausing it.
      if (!(await aiAllowedFor(r.userId))) {
        const out = await this.store.update(r.userId, r.id, { lastAt: at, lastStatus: "failed", lastText: AI_CONSENT_TEXT }, at);
        this.tell(r.userId);
        return out ?? r;
      }
      // Its own words, not the chat's last turns: a routine is not a reply to whatever was said last (AskInput.fresh). As its owner.
      const answer = await asPerson(r.userId, () => this.bots.ask(r.userId, r.bot, { message: r.task, fresh: true }));
      status = answer.approvals.length ? "needs" : "done";
      patch = { lastAt: at, lastStatus: status, lastText: (answer.text || "").slice(0, TEXT_MAX), lastPaise: Math.max(0, Math.round(answer.paise)), runs: r.runs + 1, fails: 0, botName: found.def.name };
      await this.o.events?.add(r.userId, { kind: "ask", bot: r.bot, title: r.task, paise: patch.lastPaise ?? 0, amountPaise: 0, payee: "" }, at).catch(() => undefined);
      // What the person is told, in the bot's own words: an answer that needs their yes says so first. The two pushes `told` picks
      // between say the same thing in the notification's body, but NOT the same thing on the lock screen: a `bot_ask` of a person's
      // own bot shows only "Sent you a message.", and its title is the bot's name without the task (notifyReply.ts lineOf,
      // docs/routines.md §3 step 4). The words kept on the routine, in Activity and in the chat are the same either way.
      const text = answer.text || "";
      const said = (status === "needs" ? `It needs your OK. ${text}` : text).trim() || "Done.";
      await this.told(r, found.def, said, at, {
        ...(answer.approvals.length ? { approvals: answer.approvals.slice(0, 6).map(({ taskId, connector, preview }) => ({ taskId, connector, preview })) } : {}),
        ...(answer.opens.length ? { opens: answer.opens.slice(0, 6) } : {}),
        paise: patch.lastPaise ?? 0,
      });
    } catch (err) {
      status = "failed";
      const fails = r.fails + 1;
      const why_ = err instanceof BotError || err instanceof RoutineError ? err.message : "Something went wrong running it.";
      const stop = fails >= FAILS_TO_PAUSE && why === "schedule";
      patch = {
        lastAt: at, lastStatus: "failed", lastText: why_.slice(0, TEXT_MAX), fails,
        ...(stop ? { status: "paused" as const, nextAt: null, pausedWhy: `Paused after ${FAILS_TO_PAUSE} runs in a row didn't work. ${why_}` } : {}),
      };
      if (stop) {
        await this.o.notify?.(r.userId, {
          kind: "routine_failed", key: `${r.id}:${at}`, vars: { bot: r.botName, task: oneLine(r.task, 80), line: oneLine(why_, 140) }, data: { routineId: r.id },
        }).catch(() => undefined);
      }
    }
    const out = await this.store.update(r.userId, r.id, patch, at);
    this.tell(r.userId);
    return out ?? { ...r, ...patch };
  }

  /**
   * WHAT A FINISHED RUN PUSHES. One of two, by the owner's own switch (src/bots/notifyReply.ts, docs/widgets.md §5):
   *
   *   NOTIFY_REPLY on for them   the answer is kept as a bot turn in that bot's chat, quietly, with the run's own confirm card and
   *                              links on it, and the push is the bot's own `bot_ask`: the Reply box on it goes into that chat, so
   *                              they answer the routine without opening the app, and the chat gives their words their subject
   *   off (the default)          `routine_done`, with the same words, exactly as before
   *
   * The de-dup key is the run's either way, so neither is sent twice, and the push carries the routine's id so "What pings you"
   * still gives it the routines rule rather than the bot-chat one: a bot the person muted does not swallow a routine they asked for
   * (you/push.ts verdict). What the LOCK SCREEN shows does differ: a `bot_ask` of their own bot says only "Sent you a message.",
   * and its title is the bot's name without the task. A missed push is not a lost run: the answer is on the routine, in Activity
   * and, with the switch on, in the chat.
   */
  private async told(r: Routine, def: BotDef, said: string, at: number, extra: Parameters<RoutineNote>[3]): Promise<void> {
    const key = `${r.id}:${at}`;
    if (this.o.askPush && notifyReplyOn(r.userId)) {
      // First the turn, so a reply that comes straight back finds it; a `quiet` note never pushes, this does.
      await this.o.note?.(r.userId, r.bot, said, extra).catch(() => undefined);
      const p: BotPush = {
        slug: r.bot, name: def.name, line: said, thread: r.bot, routineId: r.id,
        // A person's own bot is private: its words stay off the lock screen, as everywhere else (notifyReply.ts lineOf).
        ...(def.ownerId !== null ? { private: true as const } : {}),
      };
      await this.o.askPush(r.userId, p, key).catch(() => undefined);
      return;
    }
    await this.o.notify?.(r.userId, {
      kind: "routine_done", key,
      vars: { bot: def.name, task: oneLine(r.task, 80), line: oneLine(said, 140) },
      data: { routineId: r.id },
    }).catch(() => undefined);
  }

  private tell(userId: string): void { try { this.o.publish?.(userId, ROUTINE_TOPICS); } catch { /* a screen refreshed later */ } }

  view(r: Routine): RoutineView {
    const now = this.now();
    return {
      id: r.id, bot: { slug: r.bot, name: r.botName || r.bot }, task: r.task, when: scheduleWords(r.schedule), schedule: r.schedule, tz: r.tz,
      status: r.status, pausedWhy: r.pausedWhy,
      next: r.status === "on" && r.nextAt ? { at: r.nextAt, words: nextWords(r.nextAt, r.tz, now) } : null,
      last: r.lastAt && r.lastStatus ? { at: r.lastAt, words: lastWords(r.lastAt, r.tz, now), status: r.lastStatus, text: r.lastText, paise: r.lastPaise } : null,
      runs: r.runs,
    };
  }
}

/** When it last ran, as a person says it: "Today at 8 am", "Yesterday at 8 am", "Fri 30 Oct at 5 pm". */
function lastWords(at: number, tz: number, now: number): string {
  const day = (ms: number) => new Date(ms + tz * 60_000).toISOString().slice(0, 10);
  const yesterday = day(now - 86_400_000);
  const w = nextWords(at, tz, now);
  return day(at) === yesterday ? w.replace(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}/, "Yesterday") : w;
}
