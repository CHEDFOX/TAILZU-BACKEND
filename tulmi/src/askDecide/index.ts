/**
 * THE BRAIN BEHIND THE ONE KEY: WHAT THE PERSON MEANT, IN ANY LANGUAGE, ANY WORDING.
 *
 *   decideAsk(input, deps) -> AskDecision { do, goal, to?, via?, bot?, notes?, screen, web, sure, risk, needs, missing, by }
 *
 * The person holds one key and talks. Whatever they said is an ask, and this says which kind, so the computer does it
 * without asking them which:
 *
 *   write    words for the text box in front: dictation, or "reply saying I'm late" (the writer already shapes those)
 *   send     a message to someone through an app: "tell Riya the mockups are ready", "WhatsApp mom I'm late"
 *   answer   a question to answer: about the screen (screen) or the world (web), or plain advice
 *   task     something to do on the computer or the web, one step or many: "go to Gmail and unsubscribe from the promos"
 *   routine  something to do again and again on a schedule: "every morning tell me the top tech news"
 *   notes    start or stop meeting notes
 *   bot      clearly for one of the person's own bots, named or not; with no bot named, the computer asks which bot
 *            (/v1/shell/route). A reminder, a to-do or an event for their own day is this: their bots keep X0 Bot's own
 *            calendar and to-dos ("remind me to call mom at 6", "add buy milk to my tasks", "yaad dila dena")
 *
 * Two reads go beside it, for the voice chat (src/talk) and anything else that answers: `chat` (casual talk, a joke, a small question
 * about nothing on the screen; `do` is answer, so this route's contract is unchanged) and `depth`, quick or think (depth.ts: maths, a deep
 * why or how, a comparison, a plan, code). The depth is read by rules for nothing; the model may raise it, never lower it.
 *
 * HOW IT DECIDES, Xode's way (code/brain/classify.ts, code/brain/route.ts):
 *   1. SAFETY FIRST, FOR NOTHING. A password field, or Tailzu's own window: typed, no model asked, the words never leave.
 *   2. ONE CALL (role ask_decide, the cheap tier, a few hundred tokens) reads the words with the app, the field, the person's
 *      context (src/context: who they are, who they message, their last asks; else the last turns the computer sent) and their bots,
 *      and answers in strict JSON. It also makes a short follow-up whole ("send it to Dev too" after a
 *      message to Riya), so nothing downstream sees half a request.
 *   3. NO SECOND CALL. The cheap tier decides as well as the tiny one did, three times sooner (0.6 s against 1.5–2 s), so an unsure
 *      decision is kept as it is, and its `sure` says so: typed when a text box is in front (4), one reply tier up in talk.
 *   4. NEVER THROWS, NEVER STUCK. Down (after the gateway's own ladder of models): the safest thing that can be undone: typed when a text box is in front, else Ask,
 *      which can still ask one question itself. Still under 0.45 sure with a text box in front: typed (the pill takes it back).
 *   5. A ROUTINE IS ONLY WHAT REPEATS: one the routines' own reader (routines/words.ts readRoutine) finds no "every …" in is not one,
 *      since saving it would be refused ("Say how often"); it goes to their bots, which make a one-off reminder or to-do of it.
 *   6. RULES ONLY RAISE THE RISK, never choose the meaning: money and deleting are seen in the words here, whatever the model
 *      said, so a payment or a delete is always confirmed before it happens. A model can never lower a risk the rules saw.
 *   7. THE SAME WORDS IN THE SAME PLACE within ten minutes: the answer from before, nothing asked.
 *
 * PERMISSIONS. The person answers the setup card once (read the screen's text, see the screen, send pictures). `grants` is that
 * card's state; `needs` is what this ask will use, and `missing` what the card has not allowed, so the computer asks for that one
 * permission at the turn that needs it, and never for one already given.
 *
 * Nothing said is kept or logged: `reasons` are short ids.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { inRequestSpend } from "../code/brain/spend.js";
import { askJson, forModel, oneLine, type CallFn, type ModelCtx } from "../code/work/model.js";
import type { GatewayDeps } from "../code/brain/gateway.js";
import type { ModelTier } from "../code/brain/tiers.js";
import { neutral } from "../bots/prompt.js";
import { langOf } from "../pipeline/lang.js";
import { readRoutine } from "../routines/words.js";
import { DEPTHS, deeper, depthOf, type Depth } from "./depth.js";

export { DEPTHS, depthOf, deeper, type Depth } from "./depth.js";

export const ASK_DOS = ["write", "send", "answer", "task", "routine", "notes", "bot"] as const;
export type AskDo = (typeof ASK_DOS)[number];
/** What the model may answer: the kinds above, and chat (answered as `do: answer`, `chat: true`). */
export const ASK_KINDS = [...ASK_DOS, "chat"] as const;
export const GRANTS = ["read", "see", "pictures"] as const;
export type Grant = (typeof GRANTS)[number];
/** The setup card's own words for a row: on, off, na (this computer has no such permission), never (the server's), restart. */
export type GrantState = "on" | "off" | "na" | "never" | "restart";
export type AskRisk = "none" | "send" | "money" | "delete";

export interface AskTurn { said: string; did: AskDo; to?: string }
export interface AskBotLite { slug: string; name: string; purpose?: string }

export interface DecideInput {
  /** What was said, as heard (any language, any script). */
  words: string;
  /** The app in front, and its window's title (a chat's name, a page's). */
  app?: string;
  title?: string;
  /** The text box in front: null none; undefined not known (Linux); private: a password field. */
  field?: { selection?: string; private?: boolean } | null;
  /** Tailzu's own window is in front. */
  ours?: boolean;
  /** Up to 3 of the person's last asks, newest last, as the computer remembers them: used when the server has kept none (`context`). */
  last?: AskTurn[];
  /** What the server keeps about the person (src/context): their facts, people, asks, open work. Its text is data. */
  context?: { text: string; turns: number };
  /** The voice chat's turns so far (src/talk), a few lines, oldest first. Data. */
  talk?: string;
  /** The computer's offset, minutes east of UTC. */
  tz?: number;
  bots?: AskBotLite[];
  grants?: Partial<Record<Grant, GrantState>>;
  notesOn?: boolean;
}

export interface AskDecision {
  do: AskDo;
  /** The request made whole, in the person's language: what Ask, the bot or the routine is given. */
  goal: string;
  /** send: who to, and through which app. */
  to?: string;
  via?: string;
  bot?: { slug: string; name: string };
  notes?: "start" | "stop";
  /** answer: it is about what is on the screen; it needs the web. */
  screen: boolean;
  web: boolean;
  /** Casual talk, a joke, a small question about nothing on the screen: `do` is answer. */
  chat: boolean;
  /** quick, or think (depth.ts), the model's raise included. */
  depth: Depth;
  sure: number;
  risk: AskRisk;
  needs: Grant[];
  missing: Grant[];
  by: "rules" | "model" | "cache" | "fallback";
  reasons: string[];
  paise: number;
}

/** What the model answers. */
export const AskDecideReply = z.object({
  do: z.enum(ASK_KINDS),
  goal: z.string().max(600).nullish(),
  to: z.string().max(80).nullish(),
  via: z.string().max(40).nullish(),
  bot: z.string().max(60).nullish(),
  notes: z.enum(["start", "stop"]).nullish(),
  screen: z.boolean().nullish(),
  web: z.boolean().nullish(),
  depth: z.enum(DEPTHS).nullish(),
  sure: z.number().min(0).max(1),
});
export type AskDecideReply = z.infer<typeof AskDecideReply>;

/** The tier that decides: fast enough for a spoken turn and for the computer's brainMs. */
export const TIER: ModelTier = "cheap";
/** A decision takes 0.3–2 s; one that stalls past this moves on to the next model of the tier (the gateway's ladder) instead of
 *  holding the turn for the tier's 45 s. */
export const TIMEOUT_MS = 3_000;
export const UNSURE = 0.45;
const CAP_PAISE = 30;
const WORDS_MAX = 1200;
const TALK_MAX = 800;
const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 500;

// ---- the rules: safety only ------------------------------------------------------------------------------------

/** Money moving: pay, buy, order, transfer, in the languages people say it in. */
const MONEY = /\b(pay|paying|payment|pays|paid|transfer|send money|buy|buying|purchase|order|checkout|check out|book(?:ing)? (?:a |the )?(?:flight|ticket|hotel|room|cab|table)|subscribe|upi|gpay|paytm|phonepe|bhim|neft|imps|rtgs|paisa|paise|rupees?|rs\.?\s?\d|inr|usd|dollars?|bhej(?:o|do)? paise|paise bhej|kharid(?:o|na|lo)?|bharo|payment kar|pay kar)\b|[₹$€£]|भुगतान|पैसे भेज|ख़रीद|खरीद|ऑर्डर|पेमेंट/iu;
/** Something gone for good: delete, wipe, uninstall, cancel an account. */
const DELETE = /\b(delete|deleting|remove|erase|wipe|clear (?:all|everything|history)|empty (?:the )?(?:trash|bin)|uninstall|format|cancel (?:my |the )?(?:account|subscription|order|plan)|close (?:my |the )?account|mita(?:o|do|na)?|hata(?:o|do|na)?|delete kar)\b|मिटा|हटा|डिलीट/iu;

export function riskOf(words: string, d: AskDo): AskRisk {
  if (MONEY.test(words)) return "money";
  if (DELETE.test(words)) return "delete";
  return d === "send" ? "send" : "none";
}

/** What the ask will use of the setup card's permissions. */
export function needsOf(d: Pick<AskDecision, "do" | "screen">): Grant[] {
  if (d.do === "task" || d.do === "send") return ["read", "see"];
  if (d.do === "answer" && d.screen) return ["see"];
  return [];
}

export function missingOf(needs: readonly Grant[], grants: DecideInput["grants"]): Grant[] {
  if (!grants) return [];
  return needs.filter((g) => { const v = grants[g]; return v !== undefined && v !== "on" && v !== "na"; });
}

// ---- the prompt ------------------------------------------------------------------------------------------------

const fenced = (label: string, s: string): string => `${label}:\n<<<\n${s}\n>>>`;

export function decideUser(i: DecideInput): string {
  const f = i.field;
  const field = f === undefined ? "not known" : f === null ? "none" : f.selection?.trim() ? `a text box, with text selected: "${neutral(oneLine(f.selection, 200))}"` : "a text box";
  const parts = [
    fenced("Screen", [
      `App: ${neutral(oneLine(i.app ?? "", 60)) || "unknown"}`,
      ...(i.title ? [`Window: ${neutral(oneLine(i.title, 120))}`] : []),
      `Text box in front: ${field}`,
      `Meeting notes: ${i.notesOn ? "running" : "off"}`,
    ].join("\n")),
  ];
  const kept = i.context?.text.trim();
  if (kept) parts.push(fenced("What X0 keeps about them", neutral(kept)));
  const last = i.context?.turns ? [] : (i.last ?? []).slice(-3);
  if (last.length) parts.push(fenced("Last asks, oldest first", last.map((t) => `- ${t.did}${t.to ? ` to ${neutral(oneLine(t.to, 60))}` : ""}: ${neutral(oneLine(t.said, 200))}`).join("\n")));
  const bots = (i.bots ?? []).slice(0, 12);
  if (bots.length) parts.push(fenced("Their bots", bots.map((b) => `- ${b.slug}: ${neutral(oneLine(b.name, 40))}${b.purpose ? `. ${neutral(oneLine(b.purpose, 120))}` : ""}`).join("\n")));
  const talk = i.talk?.trim();
  if (talk) parts.push(fenced("This talk so far, oldest first", neutral(talk.slice(0, TALK_MAX))));
  parts.push(fenced("Said", neutral(forModel(oneLine(i.words, WORDS_MAX)))));
  return parts.join("\n");
}

// ---- the cache -------------------------------------------------------------------------------------------------

const kept = new Map<string, { at: number; d: AskDecision }>();
export function resetAskDecideCacheForTests(): void { kept.clear(); }

function keyOf(userId: string, i: DecideInput): string {
  const f = i.field === undefined ? "?" : i.field === null ? "-" : i.field.selection?.trim() ? `s:${i.field.selection.length}:${i.field.selection.slice(0, 80)}` : "f";
  return createHash("sha256").update(JSON.stringify([
    userId, i.words.trim().toLowerCase(), i.app ?? "", i.title ?? "", f, !!i.notesOn, (i.last ?? []).slice(-3), (i.bots ?? []).map((b) => b.slug), i.context?.text ?? "", i.talk ?? "",
  ])).digest("base64url");
}

// ---- deciding --------------------------------------------------------------------------------------------------

export interface DecideDeps {
  call?: CallFn;
  gateway?: GatewayDeps;
  signal?: AbortSignal;
  now?: () => number;
  /** The person's daily allowance for the front door, in paise: no model when nothing is left. */
  leftPaise?: number;
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** The risk, the permissions and the depth, from the words: the rules' part of every answer. `raised`: the model's own depth. */
function finish(i: DecideInput, base: Omit<AskDecision, "risk" | "needs" | "missing" | "chat" | "depth"> & { chat?: boolean }, raised?: Depth | null): AskDecision {
  const risk = riskOf(i.words, base.do);
  const needs = needsOf(base);
  return { ...base, chat: base.chat === true, depth: deeper(depthOf(i.words).depth, raised), risk, needs, missing: missingOf(needs, i.grants) };
}

/** Typed, as dictation always was: the one thing that can always be taken back with the app's own undo. */
const typed = (i: DecideInput, by: AskDecision["by"], reasons: string[], sure = 1, paise = 0): AskDecision =>
  finish(i, { do: "write", goal: i.words.trim(), screen: false, web: false, sure, by, reasons, paise });

export function decideAsk(i: DecideInput, userId: string, d: DecideDeps = {}): Promise<AskDecision> {
  return inRequestSpend(() => decideOnce(i, userId, d));
}

async function decideOnce(i: DecideInput, userId: string, d: DecideDeps): Promise<AskDecision> {
  const words = String(i.words ?? "").trim();
  if (!words) return typed(i, "rules", ["empty"]);
  // 1. Safety: these words never leave this server for a model.
  if (i.ours) return typed(i, "rules", ["ours"]);
  if (i.field && i.field.private) return typed(i, "rules", ["private_field"]);

  // 7. The same words in the same place, just now.
  const now = (d.now ?? Date.now)();
  const key = keyOf(userId, i);
  const hit = kept.get(key);
  if (hit && now - hit.at < CACHE_MS) return { ...hit.d, by: "cache", paise: 0, reasons: [...hit.d.reasons, "cache"] };

  const fallback = (why: string, paise = 0): AskDecision =>
    i.field !== null
      ? typed(i, "fallback", [why, "text_box"], 0.4, paise)
      : finish(i, { do: "answer", goal: words, screen: false, web: false, sure: 0.4, by: "fallback", reasons: [why, "no_text_box"], paise });

  if (d.leftPaise !== undefined && d.leftPaise <= 0) return fallback("no_allowance");

  // 2. One call, on the cheap tier: it decides as well as the tiny tier did, three times sooner (docs/ask-decide.md).
  const user = decideUser({ ...i, words });
  const ctx: ModelCtx = { ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}), userId, budget: { maxPaise: CAP_PAISE }, ...(d.signal ? { signal: d.signal } : {}) };
  const asked = await askJson(ctx, { tier: TIER, purpose: "ask.decide", role: "ask_decide", user, schema: AskDecideReply, maxTokens: 160, timeoutMs: TIMEOUT_MS });
  const paise = asked.ok ? asked.paise : 0;
  const best: AskDecideReply | null = asked.ok ? asked.value : null;
  const by: AskDecision["by"] = "model";
  const reasons: string[] = [asked.ok ? `model:${TIER}` : `${TIER}:${asked.reason}`];
  // 4. Never stuck.
  if (!best) return fallback(reasons.join(","), paise);
  const sure = round(best.sure);
  if (sure < UNSURE && i.field) return typed(i, by, [...reasons, "unsure", "text_box"], sure, paise);

  const out = shape(i, words, best, by, reasons, sure, paise, now);
  kept.set(key, { at: now, d: out });
  if (kept.size > CACHE_MAX) kept.delete(kept.keys().next().value as string);
  return out;
}

/** A reminder, a to-do, or their calendar, named in the words (English, Hinglish, Hindi). */
const OWN_DAY = /\b(?:remind(?:er)?s?|to-?dos?|to do(?: list)?|(?:my|the) (?:tasks?|task list|calendar|schedule|diary))\b|yaad (?:dila|dilana|rakh)|याद (?:दिला|दिलाना)|रिमाइंडर/i;
const GOOGLE = /\bgoogle\b|गूगल/i;

/** The model's answer, held to what can be done here. */
function shape(i: DecideInput, words: string, r: AskDecideReply, by: AskDecision["by"], reasons: string[], sure: number, paise: number, now: number): AskDecision {
  // THEIR OWN WORDS are the goal, except for a follow-up the model had to make whole ("send it to Dev too"): a
  // small model asked for "the request made whole" also translated it (English in, Hindi out), and the goal is
  // what Ask is handed as the request. Even made whole, a goal in another language than what was said is not used (pipeline/lang.ts:
  // Hinglish and English share a script, and a goal turned into Hinglish is not theirs).
  const made = oneLine(r.goal ?? "", 600);
  const before = (i.last ?? []).length > 0 || (i.context?.turns ?? 0) > 0 || !!i.talk;
  const goal = before && made && langOf(made) === langOf(words) ? made : words;
  // chat is answered: this route's `do` keeps its seven kinds, and `chat` says it was small talk.
  const chat = r.do === "chat";
  let kind: AskDo = r.do === "chat" ? "answer" : r.do;
  let bot: AskDecision["bot"];
  // Their own day, in so many words, and Google not named: their bots keep X0 Bot's calendar and to-dos (Ask reaches only Google's).
  if (kind === "task" && OWN_DAY.test(words) && !GOOGLE.test(words)) { kind = "bot"; reasons.push("own_day"); }
  // A routine the routines' own reader finds no "every …" in would be refused when saved: a one-off reminder, for their bots.
  if (kind === "routine" && !readRoutine(words, now, i.tz ?? 0)) { kind = "bot"; reasons.push("routine_once"); }
  if (kind === "bot") {
    const b = r.bot ? (i.bots ?? []).find((x) => x.slug === r.bot) : undefined;
    if (b) bot = { slug: b.slug, name: b.name };
    // A slug that is not theirs is a guess: answered. None named: the computer asks which of their bots takes it.
    else if (r.bot && r.do === "bot") { kind = "answer"; reasons.push("bot_unknown"); }
  }
  // Nothing in front to write into, known for sure: a "write" is something to say back.
  if (kind === "write" && i.field === null) { kind = "answer"; reasons.push("write_no_box"); }
  const notes = kind === "notes" ? (r.notes ?? (i.notesOn ? "stop" : "start")) : undefined;
  return finish(i, {
    do: kind, goal,
    ...(kind === "send" && r.to ? { to: oneLine(r.to, 80) } : {}),
    ...(kind === "send" && r.via ? { via: oneLine(r.via, 40) } : {}),
    ...(bot ? { bot } : {}),
    ...(notes ? { notes } : {}),
    screen: kind === "answer" || kind === "task" ? !!r.screen && !chat : false,
    web: kind === "answer" || kind === "task" || kind === "routine" ? !!r.web : false,
    chat: chat && kind === "answer",
    sure, by, reasons, paise,
  }, kind === "answer" ? r.depth : null);
}
