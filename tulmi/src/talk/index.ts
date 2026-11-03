/**
 * TALK: X0 BOT AS A VOICE CHAT ANYWHERE (docs/talk.md). The person holds or double-taps one key and talks, turn after turn; the desktop
 * records, shows and speaks; this decides, thinks and streams the answer.
 *
 *   talkTurn(input, deps, emit)    one turn: route, mood, text…, handoff, done | error (shared/types/api.ts TalkEvent)
 *
 *   road.ts      the route table: kind -> road, tier, reasoning, first mood; climbing; the cap
 *   followup.ts  a handoff that points back ("send that to Riya"): the last answer goes with it, no call made
 *   session.ts   the talk in memory: the last turns whole, older ones folded, what each answer found; the turn in flight and its stop
 *   page.ts      the whole page made small: outline, the part around where they are, the parts that match (also for Ask's first step)
 *   prompt.ts    the turn's message to the answering model, every part fenced as data
 *   look.ts      read-only lookups before an answer that needs fresh facts
 *   answer.ts    the one streamed call (role talk_reply)
 *   speak.ts     the mood tag, whole words, the secret guard and the apology (the turn's language: pipeline/lang.ts)
 *
 * A TURN, IN ORDER:
 *   1. GATES, FOR NOTHING. Empty words, X0 Bot's own window, a password field or a sensitive app: no model, nothing kept. A text box
 *      in front: typed (handoff write). A sensitive app with none: refused (error private).
 *   2. DECIDE. The person's context (src/context) and the one key's brain (askDecide: its kind, chat, depth, risk), with this talk's last
 *      turns and what each answer found, in one call, which is asked to make a short follow-up whole in its goal. The route event goes as
 *      soon as the brain has answered.
 *   3. HANDOFF. task and send go to Ask on the device (trusted unless money or deleting), write, routine, notes and a bot to theirs. Words
 *      that point back ("send that to Riya") and a goal the brain left as it was: the last answer goes with it (followup.ts).
 *   4. ANSWER. The road's tier (one up when the brain was unsure), lookups first when it needs fresh facts, ponder first for think; the
 *      words stream as they come. A model that fails before a word was said: the next on its ladder, then one tier up. After words were
 *      said: no second voice, a short apology. The person's stop ends it with what was said.
 *   5. KEEP. The turn goes into the talk, and into the person's context (keepAsk, keepResult: the same privacy rules).
 *
 * The day's front-door allowance (guard/ daily) is read before any model and charged after; nothing left, no model.
 */
import type { TalkEvent, TalkFound } from "../../../shared/types/api.js";
import { decideAsk, type AskBotLite, type AskDecision, type DecideInput } from "../askDecide/index.js";
import type { AuthedUser } from "../auth/supabase.js";
import { scrub } from "../bots/run.js";
import { BudgetExceeded, type GatewayDeps } from "../code/brain/gateway.js";
import { tierTable } from "../code/brain/tiers.js";
import type { CallFn } from "../code/work/model.js";
import { secretish, type PersonContext } from "../context/index.js";
import { sensitiveApp } from "../pipeline/sensitive.js";
import { sayAnswer } from "./answer.js";
import { lookFirst, type LookPorts } from "./look.js";
import type { PageText } from "./page.js";
import { talkUser } from "./prompt.js";
import { capPaise, climb, kindOf, roadOf, trustedOf, type TalkKind } from "./road.js";
import { followUp } from "./followup.js";
import { decideLines, foundIn, talkSessions, type TalkSessions } from "./session.js";
import { langOf } from "../pipeline/lang.js";
import { Speaker, sorryWords } from "./speak.js";

export { ROADS, TALK_KINDS, kindOf, roadOf, climb, capPaise, trustedOf, TALK_SURE, TALK_INPUT_CHARS, type TalkKind, type Road, type HandoffTo } from "./road.js";
export { TalkSessions, talkSessions, resetTalkSessionsForTests, flight, stopTalk, foldTurn, foundIn, talkLines, TALK_ID, TALK_TURNS, TALK_IDLE_MS, type TalkSession, type TalkTurn, type Flight } from "./session.js";
export { readPage, reducePage, termsOf, PAGE_MAX_CHARS, PAGE_TEXT_MAX, type PageText, type ReducedPage } from "./page.js";
export { MOODS, readMood, moodOf, Speaker, sorryWords, type Mood } from "./speak.js";
export { langOf } from "../pipeline/lang.js";
export { lookFirst, lookPorts, LOOK_CALLS, LOOK_CHARS_MAX, type LookPorts } from "./look.js";
export { talkUser } from "./prompt.js";

export interface TalkInput {
  talkId: string;
  turn: number;
  words: string;
  tz?: number;
  app?: string;
  title?: string;
  url?: string;
  field?: { selection?: string; private?: boolean } | null;
  ours?: boolean;
  page?: PageText;
  grants?: DecideInput["grants"];
}

export interface TalkDeps {
  user: AuthedUser;
  call?: CallFn;
  gateway?: GatewayDeps;
  context?: PersonContext | null;
  bots?: () => Promise<AskBotLite[]>;
  /** The read-only lookups for an answer that needs fresh facts; null for none. */
  look?: (o: { signal: AbortSignal; maxPaise: number }) => LookPorts | null;
  /** The person's day (guard/ daily). */
  daily?: { leftPaise(userId: string): number; add(userId: string, paise: number): void };
  sessions?: TalkSessions;
  now?: () => number;
  /** Fires when the turn is stopped: by the person (`stopped()` true) or a dropped connection. */
  signal?: AbortSignal;
  stopped?: () => boolean;
  log?: { warn(o: object, msg: string): void };
}

export interface TalkOutcome {
  kind: TalkKind;
  ending: "done" | "handoff" | "stopped" | "error";
  /** Gate, decide and answer reasons, short ids: never what was said. */
  reasons: string[];
  paise: number;
  tier?: string;
  model?: string;
}

const isAbort = (e: unknown): boolean => (e as { name?: unknown } | null)?.name === "AbortError";
const isBudget = (e: unknown): boolean => e instanceof BudgetExceeded || (e as { code?: unknown } | null)?.code === "budget_exceeded";
const READ_OFF = new Set(["off", "never", "restart"]);

const MESSAGES = {
  private: "X0 doesn't listen in money, health or password apps.",
  budget: "That's all X0 can think through today. It comes back tomorrow.",
  model_down: "X0 couldn't think that through just now. Try again in a moment.",
} as const;

export async function talkTurn(i: TalkInput, d: TalkDeps, emit: (e: TalkEvent) => void): Promise<TalkOutcome> {
  const userId = d.user.id;
  const words = i.words.trim();
  const lang = langOf(words);
  const now = (d.now ?? Date.now)();
  const sessions = d.sessions ?? talkSessions();
  const signal = d.signal ?? new AbortController().signal;
  const reasons: string[] = [];
  let paise = 0;
  const charge = (p: number): void => { if (p > 0) { paise += p; d.daily?.add(userId, p); } };
  const typed = (why: string): TalkOutcome => {
    emit({ t: "route", kind: "write", depth: "quick", lang });
    emit({ t: "handoff", to: "write", goal: words, trusted: true });
    emit({ t: "done", text: "" });
    return { kind: "write", ending: "handoff", reasons: [why], paise: 0 };
  };

  // 1. Gates: these words never go to a model, and nothing of them is kept.
  if (!words) {
    emit({ t: "route", kind: "chat", depth: "quick", lang });
    emit({ t: "done", text: "" });
    return { kind: "chat", ending: "done", reasons: ["empty"], paise: 0 };
  }
  if (i.ours) return typed("ours");
  if (i.field?.private) return typed("private_field");
  if (sensitiveApp(i.app) || sensitiveApp(i.title)) {
    if (i.field !== null) return typed("sensitive_app");
    emit({ t: "route", kind: "chat", depth: "quick", lang });
    emit({ t: "mood", mood: "nope" });
    emit({ t: "error", code: "private", message: MESSAGES.private });
    return { kind: "chat", ending: "error", reasons: ["sensitive_app"], paise: 0 };
  }
  // The setup card says the screen's text may not be read: what was read of it is not used.
  const readOff = READ_OFF.has(String(i.grants?.read ?? ""));
  const page = readOff ? undefined : i.page;
  const selection = readOff ? undefined : i.field?.selection;

  const session = sessions.get(userId, i.talkId);
  const stoppedNow = (): boolean => signal.aborted;
  const end = (text: string, found?: TalkFound): void => { emit({ t: "done", text, ...(found ? { found } : {}) }); };

  // 2. Decide, with the person's context and this talk's turns: one call, a follow-up made whole in its goal.
  const [ctx, bots] = await Promise.all([
    d.context ? d.context.for(d.user, { about: words, ...(i.tz !== undefined ? { tz: i.tz } : {}), now }).catch(() => null) : Promise.resolve(null),
    d.bots ? d.bots().catch(() => []) : Promise.resolve([]),
  ]);
  const input: DecideInput = {
    words, ...(i.app ? { app: i.app } : {}), ...(i.title ? { title: i.title } : {}),
    ...(i.field !== undefined ? { field: i.field === null ? null : { ...(selection ? { selection } : {}) } } : {}),
    ...(i.tz !== undefined ? { tz: i.tz } : {}), ...(i.grants ? { grants: i.grants } : {}),
    ...(ctx?.text ? { context: { text: ctx.text, turns: ctx.turns } } : {}),
    ...(bots.length ? { bots } : {}),
    ...(session ? { talk: decideLines(session) } : {}),
  };
  const left = d.daily ? d.daily.leftPaise(userId) : undefined;
  const decision: AskDecision = await decideAsk(input, userId, { ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}), signal, ...(left !== undefined ? { leftPaise: left } : {}) });
  charge(decision.paise);
  reasons.push(...decision.reasons);
  const kind = kindOf(decision);
  const road = roadOf(kind, { web: decision.web, sure: decision.by === "fallback" ? undefined : decision.sure });
  emit({ t: "route", kind, depth: decision.depth, lang });

  // A follow-up the brain made whole: what Ask is handed, and what the answer is asked about.
  const meant = decision.goal && decision.goal !== words ? decision.goal : undefined;

  const keep = (answer: string, found?: TalkFound, goal?: string): void => {
    if (secretish(words) || secretish(answer) || (goal && secretish(goal))) return;
    sessions.add(userId, i.talkId, { n: i.turn, said: words, answer, kind, ...(goal ? { goal } : {}), ...(found ? { found } : {}) });
    if (!d.context) return;
    void d.context.keepAsk(userId, input, decision)
      .then((kept) => (kept && answer ? d.context!.keepResult(userId, { said: words, result: answer, ...(i.app ? { app: i.app } : {}) }) : false))
      .catch((err) => d.log?.warn({ err: (err as Error)?.message }, "talk: turn not kept in the context"));
  };

  if (stoppedNow()) {
    end("");
    return { kind, ending: "stopped", reasons, paise };
  }

  // 3. Handoff: the device does it.
  if (road.road === "handoff") {
    const goal = followUp(meant ?? decision.goal, words, session?.turns.at(-1));
    emit({ t: "mood", mood: "done" });
    emit({
      t: "handoff", to: road.to, goal, trusted: trustedOf(decision.risk),
      ...(decision.bot ? { bot: decision.bot } : {}), ...(decision.notes ? { notes: decision.notes } : {}),
    });
    end("");
    keep("", undefined, goal);
    return { kind, ending: "handoff", reasons, paise };
  }

  // 4. Answer.
  if (left !== undefined && d.daily!.leftPaise(userId) <= 0) {
    emit({ t: "mood", mood: "sorry" });
    emit({ t: "error", code: "budget", message: MESSAGES.budget });
    return { kind, ending: "error", reasons: [...reasons, "no_allowance"], paise };
  }
  if (road.ponder) emit({ t: "mood", mood: "ponder" });

  const tiers = tierTable();
  let found = "";
  let links: string[] = [];
  if (road.look && d.look) {
    const ports = d.look({ signal, maxPaise: capPaise(road.tier, road.maxTokens, { tiers }) });
    if (ports) {
      try {
        const looked = await lookFirst({
          user: talkUser({ words, ...(meant ? { meant } : {}), now, ...(i.tz !== undefined ? { tz: i.tz } : {}), session, ...(i.app ? { app: i.app } : {}), ...(i.title ? { title: i.title } : {}) }),
          ports, userId, tier: road.tier, ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}), signal,
        });
        charge(looked.paise);
        found = looked.text;
        links = looked.links;
        if (looked.tools.length) reasons.push(...looked.tools.map((t) => `look:${t}`));
      } catch (err) {
        if (!isAbort(err)) throw err;
      }
    }
  }
  if (stoppedNow()) {
    end("");
    return { kind, ending: "stopped", reasons, paise };
  }

  const user = talkUser({
    words, ...(meant ? { meant } : {}), now, ...(i.tz !== undefined ? { tz: i.tz } : {}),
    ...(ctx?.text ? { context: ctx.text } : {}), session,
    ...(i.app ? { app: i.app } : {}), ...(i.title ? { title: i.title } : {}), ...(i.url ? { url: i.url } : {}),
    ...(selection ? { selection } : {}), ...(page ? { page } : {}), ...(found ? { found } : {}),
  });

  // One voice for the whole answer: the model that started it finishes it, or it ends with an apology.
  const voice = new AbortController();
  const onStop = (): void => voice.abort();
  if (signal.aborted) voice.abort(); else signal.addEventListener("abort", onStop, { once: true });
  let broke = false;
  const speaker = new Speaker(
    { mood: (mood) => emit({ t: "mood", mood }), text: (text) => emit({ t: "text", text }) },
    { guard: (t) => scrub(t).cleaned, onBlock: () => { reasons.push("guard"); voice.abort(); } },
  );
  const onReset = (): void => {
    if (speaker.begun) { broke = true; voice.abort(); } else speaker.reset();
  };

  let tier: ReturnType<typeof climb> = road.tier;
  let ending: TalkOutcome["ending"] = "done";
  let usedModel: string | undefined;
  let usedTier: string | undefined;
  try {
    for (let attempt = 0; tier; attempt += 1) {
      try {
        const r = await sayAnswer({
          user, tier, reasoning: road.reasoning, maxTokens: road.maxTokens, capPaise: capPaise(tier, road.maxTokens, { tiers, reasoning: road.reasoning }),
          userId, ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}), signal: voice.signal,
          onText: (p) => speaker.write(p), onReset,
        });
        charge(r.paise);
        usedModel = r.model;
        usedTier = tier;
        speaker.flush();
        break;
      } catch (err) {
        if (isAbort(err)) {
          if (broke) { reasons.push("broke"); emit({ t: "mood", mood: "sorry" }); speaker.say(sorryWords(lang)); }
          else if (!speaker.blocked) ending = "stopped";
          break;
        }
        if (isBudget(err) && !speaker.begun) {
          emit({ t: "mood", mood: "sorry" });
          emit({ t: "error", code: "budget", message: MESSAGES.budget });
          return { kind, ending: "error", reasons: [...reasons, "budget"], paise };
        }
        if (speaker.begun) {
          reasons.push("broke");
          emit({ t: "mood", mood: "sorry" });
          speaker.say(sorryWords(lang));
          break;
        }
        // Nothing said yet: one tier up, once.
        speaker.reset();
        reasons.push(`down:${tier}`);
        tier = attempt === 0 ? climb(tier) : null;
        if (!tier) {
          emit({ t: "mood", mood: "sorry" });
          emit({ t: "error", code: "model_down", message: MESSAGES.model_down });
          return { kind, ending: "error", reasons, paise };
        }
      }
    }
  } finally {
    signal.removeEventListener("abort", onStop);
  }

  // 5. Done, and kept.
  const text = speaker.spoken.trim();
  const rested = foundIn(text, { links });
  end(text, rested);
  if (text) keep(text, rested, meant);
  return { kind, ending: ending === "stopped" || d.stopped?.() ? "stopped" : "done", reasons, paise, ...(usedTier ? { tier: usedTier } : {}), ...(usedModel ? { model: usedModel } : {}) };
}
