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
 *   bot      clearly for one of the person's own bots, named or not
 *
 * HOW IT DECIDES, Xode's way (code/brain/classify.ts, code/brain/route.ts):
 *   1. SAFETY FIRST, FOR NOTHING. A password field, or Tailzu's own window: typed, no model asked, the words never leave.
 *   2. ONE TINY CALL (role ask_decide, the tiny tier, a few hundred tokens) reads the words with the app, the field, the last turns
 *      and the person's bots, and answers in strict JSON. It also makes a short follow-up whole ("send it to Dev too" after a
 *      message to Riya), so nothing downstream sees half a request.
 *   3. CLIMB ONCE. Under 0.7 sure, or the tiny model down: the cheap tier, once. The surer of the two wins.
 *   4. NEVER THROWS, NEVER STUCK. Both down: the safest thing that can be undone: typed when a text box is in front, else Ask,
 *      which can still ask one question itself. Still under 0.45 sure with a text box in front: typed (the pill takes it back).
 *   5. RULES ONLY RAISE THE RISK, never choose the meaning: money and deleting are seen in the words here, whatever the model
 *      said, so a payment or a delete is always confirmed before it happens. A model can never lower a risk the rules saw.
 *   6. THE SAME WORDS IN THE SAME PLACE within ten minutes: the answer from before, nothing asked.
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

export const ASK_DOS = ["write", "send", "answer", "task", "routine", "notes", "bot"] as const;
export type AskDo = (typeof ASK_DOS)[number];
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
  /** Up to 3 of the person's last asks, newest last. */
  last?: AskTurn[];
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
  sure: number;
  risk: AskRisk;
  needs: Grant[];
  missing: Grant[];
  by: "rules" | "model" | "climbed" | "cache" | "fallback";
  reasons: string[];
  paise: number;
}

/** What the model answers. */
export const AskDecideReply = z.object({
  do: z.enum(ASK_DOS),
  goal: z.string().max(600).nullish(),
  to: z.string().max(80).nullish(),
  via: z.string().max(40).nullish(),
  bot: z.string().max(60).nullish(),
  notes: z.enum(["start", "stop"]).nullish(),
  screen: z.boolean().nullish(),
  web: z.boolean().nullish(),
  sure: z.number().min(0).max(1),
});
export type AskDecideReply = z.infer<typeof AskDecideReply>;

export const SURE = 0.7;
export const UNSURE = 0.45;
const CAP_PAISE = 30;
const WORDS_MAX = 1200;
const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 500;

// ---- the rules: safety only ------------------------------------------------------------------------------------

/** Money moving: pay, buy, order, transfer, in the languages people say it in. */
const MONEY = /\b(pay|paying|payment|pays|paid|transfer|send money|buy|buying|purchase|order|checkout|check out|book(?:ing)? (?:a |the )?(?:flight|ticket|hotel|room|cab|table)|subscribe|upi|gpay|paytm|phonepe|bhim|neft|imps|rtgs|paisa|paise|rupees?|rs\.?\s?\d|inr|usd|dollars?|bhej(?:o|do)? paise|paise bhej|kharid(?:o|na|lo)?|bharo|payment kar|pay kar)\b|[₹$€£]|भुगतान|पैसे भेज|ख़रीद|खरीद|ऑर्डर|पेमेंट/iu;
/** Something gone for good: delete, wipe, uninstall, cancel an account. */
const DELETE = /\b(delete|deleting|remove|erase|wipe|clear (?:all|everything|history)|empty (?:the )?(?:trash|bin)|uninstall|format|cancel (?:my |the )?(?:account|subscription|order|plan)|close (?:my |the )?account|unsubscribe|mita(?:o|do|na)?|hata(?:o|do|na)?|delete kar)\b|मिटा|हटा|डिलीट/iu;

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
  const last = (i.last ?? []).slice(-3);
  if (last.length) parts.push(fenced("Last asks, oldest first", last.map((t) => `- ${t.did}${t.to ? ` to ${neutral(oneLine(t.to, 60))}` : ""}: ${neutral(oneLine(t.said, 200))}`).join("\n")));
  const bots = (i.bots ?? []).slice(0, 12);
  if (bots.length) parts.push(fenced("Their bots", bots.map((b) => `- ${b.slug}: ${neutral(oneLine(b.name, 40))}${b.purpose ? `. ${neutral(oneLine(b.purpose, 120))}` : ""}`).join("\n")));
  parts.push(fenced("Said", neutral(forModel(oneLine(i.words, WORDS_MAX)))));
  return parts.join("\n");
}

// ---- the cache -------------------------------------------------------------------------------------------------

const kept = new Map<string, { at: number; d: AskDecision }>();
export function resetAskDecideCacheForTests(): void { kept.clear(); }

function keyOf(userId: string, i: DecideInput): string {
  const f = i.field === undefined ? "?" : i.field === null ? "-" : i.field.selection?.trim() ? `s:${i.field.selection.length}:${i.field.selection.slice(0, 80)}` : "f";
  return createHash("sha256").update(JSON.stringify([
    userId, i.words.trim().toLowerCase(), i.app ?? "", i.title ?? "", f, !!i.notesOn, (i.last ?? []).slice(-3), (i.bots ?? []).map((b) => b.slug),
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

function finish(i: DecideInput, base: Omit<AskDecision, "risk" | "needs" | "missing">): AskDecision {
  const risk = riskOf(i.words, base.do);
  const needs = needsOf(base);
  return { ...base, risk, needs, missing: missingOf(needs, i.grants) };
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

  // 6. The same words in the same place, just now.
  const now = (d.now ?? Date.now)();
  const key = keyOf(userId, i);
  const hit = kept.get(key);
  if (hit && now - hit.at < CACHE_MS) return { ...hit.d, by: "cache", paise: 0, reasons: [...hit.d.reasons, "cache"] };

  const fallback = (why: string, paise = 0): AskDecision =>
    i.field !== null
      ? typed(i, "fallback", [why, "text_box"], 0.4, paise)
      : finish(i, { do: "answer", goal: words, screen: false, web: false, sure: 0.4, by: "fallback", reasons: [why, "no_text_box"], paise });

  if (d.leftPaise !== undefined && d.leftPaise <= 0) return fallback("no_allowance");

  // 2. One tiny call; 3. climb once when unsure.
  const user = decideUser({ ...i, words });
  const ask = (tier: ModelTier) => {
    const ctx: ModelCtx = { ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}), userId, budget: { maxPaise: CAP_PAISE }, ...(d.signal ? { signal: d.signal } : {}) };
    return askJson(ctx, { tier, purpose: "ask.decide", role: "ask_decide", user, schema: AskDecideReply, maxTokens: 160 });
  };
  let paise = 0;
  const first = await ask("tiny");
  if (first.ok) paise += first.paise;
  let best: AskDecideReply | null = first.ok ? first.value : null;
  let by: AskDecision["by"] = "model";
  const reasons: string[] = [first.ok ? "model:tiny" : `tiny:${first.reason}`];
  if ((!best || best.sure < SURE) && !(!first.ok && first.reason === "aborted")) {
    const second = await ask("cheap");
    if (second.ok) {
      paise += second.paise;
      reasons.push("model:cheap");
      if (!best || second.value.sure >= best.sure) { best = second.value; by = "climbed"; }
    } else reasons.push(`cheap:${second.reason}`);
  }
  // 4. Never stuck.
  if (!best) return fallback(reasons.join(","), paise);
  const sure = round(best.sure);
  if (sure < UNSURE && i.field) return typed(i, by, [...reasons, "unsure", "text_box"], sure, paise);

  const out = shape(i, words, best, by, reasons, sure, paise);
  kept.set(key, { at: now, d: out });
  if (kept.size > CACHE_MAX) kept.delete(kept.keys().next().value as string);
  return out;
}

/** The model's answer, held to what can be done here. */
function shape(i: DecideInput, words: string, r: AskDecideReply, by: AskDecision["by"], reasons: string[], sure: number, paise: number): AskDecision {
  const goal = oneLine(r.goal ?? "", 600) || words;
  let kind: AskDo = r.do;
  let bot: AskDecision["bot"];
  if (kind === "bot") {
    const b = r.bot ? (i.bots ?? []).find((x) => x.slug === r.bot) : undefined;
    if (b) bot = { slug: b.slug, name: b.name };
    else { kind = "answer"; reasons.push("bot_unknown"); }
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
    screen: kind === "answer" || kind === "task" ? !!r.screen : false,
    web: kind === "answer" || kind === "task" || kind === "routine" ? !!r.web : false,
    sure, by, reasons, paise,
  });
}
