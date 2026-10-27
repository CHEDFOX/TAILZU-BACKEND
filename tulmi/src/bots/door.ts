/**
 * "ASK ANY BOT": THE FRONT DOOR PICKS THE BEST OF A PERSON'S BOTS FOR A MESSAGE, BY PURPOSE AND SKILLS. RULES FIRST, THE TINY TIER WHEN UNSURE.
 *
 *   pickBot(deps, userId, message, bots, ctx) -> { bot | null, by, confidence, reasons }
 *
 * `bot: null` is "none of them": the message goes down the front door's own roads as it always has (docs/front-door.md), which is also where the
 * Code bot's flows are. So picking the Code bot and picking nobody are the same road; the difference is only that the person is shown "Code bot".
 *
 *   1. @name           the message opens with a bot's slug: that bot, for nothing, and the @name is taken off the words
 *   2. the rules       each bot is scored from what is known for free, the same words always giving the same answer:
 *                        - its purpose and name against the message (words stemmed, Hinglish and Hindi read through a small table of what people say)
 *                        - what a built-in is for (Keybot writes and rewrites, Plan plans, Travel travels) in English, Hinglish and Hindi
 *                        - the front door's own reading of the message (a question about code in a project is the Code bot's)
 *                        - the apps the message names or the job it describes, against the connected apps a bot was given (connectors/intent.ts)
 *                        - what the bot can do: an attached file wants Files, a chart wants Artifacts, "the latest" wants Web or Research
 *                      Sure when the best bot has 6 points and leads the next by 3; nothing scored two points: no bot, no model asked
 *   3. the small model in between: role bot_pick on the tiny tier, at most 30 paise, shown each bot's slug, purpose and skills. A model that is
 *                      down or over budget costs nothing but the rules' own answer
 *
 * Nothing about the message is kept: `reasons` are short ids.
 */
import { JOB_APPS, readIntent } from "../connectors/intent.js";
import { askJson, forModel, oneLine, type CallFn, type ModelCtx } from "../code/work/model.js";
import type { GatewayDeps } from "../code/brain/gateway.js";
import { readByRules } from "../front/rules.js";
import type { FrontCtx } from "../front/types.js";
import { z } from "zod";
import { CODE_SLUG } from "./builtin.js";
import { neutral } from "./prompt.js";
import { SKILL_NAMES, type BotDef } from "./types.js";

/** What the picker role answers with (the contract of bot_pick names these fields). */
export const BotPickReply = z.object({
  bot: z.string().max(60).nullable(),
  confidence: z.number().min(0).max(1),
}).strict();
export type BotPickReply = z.infer<typeof BotPickReply>;

export const SURE_POINTS = 6;
export const SURE_LEAD = 3;
export const PICK_CAP_PAISE = 30;
const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "you", "are", "was", "can", "will", "all", "any", "not", "but", "its", "has", "have", "who", "what", "when", "where", "how", "why",
  "bot", "bots", "tailzu", "please", "help", "make", "get", "give", "tell", "show", "want", "need", "like", "just", "about", "some", "more", "my", "me", "mera", "meri", "mere", "ka", "ki", "ke", "ko", "se", "me",
  "hai", "hain", "kya", "karo", "kar", "do", "de", "aur", "ya", "mujhe", "ek", "yeh", "woh", "bhi", "toh", "to", "ho", "hi",
  // The verbs and nouns every bot's purpose is written with: they say nothing about which bot it is.
  "answer", "answers", "question", "questions", "ask", "read", "reads", "reading", "change", "changes", "turn", "turns", "goal", "short", "own", "them", "put", "puts", "list", "ideas", "idea",
  "suggest", "suggests", "thing", "things", "way", "what", "batao", "banao", "dekho", "nikalo", "karna", "chahiye", "kal", "aaj",
]);

/** What people say, mapped onto the words a bot's purpose uses: so "kal ka gym plan" finds the bot that plans workouts. */
const SAYS: Readonly<Record<string, readonly string[]>> = {
  gym: ["workout", "exercise", "fitness"], kasrat: ["workout", "exercise"], vyayam: ["workout", "exercise"], exercise: ["workout", "fitness"], fitness: ["workout", "exercise"], run: ["workout"], yoga: ["workout", "fitness"],
  diet: ["food", "meal", "nutrition"], khana: ["food", "meal", "recipe"], recipe: ["food", "meal", "cook"], ruchi: ["food"], cook: ["food", "recipe"], meal: ["food", "recipe"],
  paisa: ["money", "budget", "expense"], paise: ["money", "budget", "expense"], kharcha: ["expense", "money", "budget"], hisaab: ["expense", "money", "account"], budget: ["money", "expense"], expense: ["money", "budget"], invoice: ["bill", "payment", "money"], bill: ["invoice", "payment"],
  padhai: ["study", "learn", "exam"], pariksha: ["exam", "study"], exam: ["study", "learn"], homework: ["study", "school"], study: ["learn", "exam"], learn: ["study"],
  naukri: ["job", "career", "work"], job: ["career", "work", "interview"], interview: ["job", "career"], resume: ["job", "career"],
  meeting: ["calendar", "schedule", "event"], appointment: ["calendar", "schedule"], calendar: ["schedule", "event", "meeting"], schedule: ["calendar", "plan"], reminder: ["task", "todo"], todo: ["task", "reminder"], task: ["todo", "reminder"],
  mail: ["email"], email: ["mail", "message"], message: ["email", "reply"], sandesh: ["message"],
  yatra: ["travel", "trip"], safar: ["travel", "trip"], ghoomna: ["travel", "trip"], ghumna: ["travel", "trip"], trip: ["travel"], travel: ["trip"], flight: ["travel", "trip"], hotel: ["travel", "stay"], tour: ["travel", "trip"],
  ghar: ["home", "house"], home: ["house"], bachcha: ["kid", "child", "parent"], kids: ["child", "parent"], baby: ["child", "parent"],
  dukaan: ["shop", "store", "business"], shop: ["store", "business"], business: ["shop", "store", "sales"], sales: ["business", "customer"], customer: ["sales", "support"],
  dinner: ["meal", "food"], lunch: ["meal", "food"], breakfast: ["meal", "food"], snack: ["meal", "food"], news: ["latest", "current"], khabar: ["news", "latest"], stock: ["market", "money"], share: ["market", "stock"],
};

const stem = (w: string): string => (w.length > 4 && w.endsWith("ing") ? w.slice(0, -3) : w.length > 3 && w.endsWith("es") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/** The words of a text, lower-case, no stop words, stemmed, and what people say for them added. */
export function wordsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    const w = stem(raw);
    out.add(w);
    for (const x of SAYS[raw] ?? SAYS[w] ?? []) out.add(stem(x));
  }
  return out;
}

// ------------------------------------------------------------------ what a built-in is for

const hindi = (words: string[]): RegExp => new RegExp(`(?<![\\p{L}\\p{M}])(?:${words.join("|")})`, "u");

const KEYBOT = /\b(?:rewrite|re-?word|rephrase|paraphrase|proof-?read|polish|translate|reply\s+(?:to|with)|draft\s+(?:a|an|the|my)\s+(?:reply|message|email|text|post|caption|dm|note)|write\s+(?:a|an|the|my)\s+(?:reply|message|email|text|caption|post|bio|dm|note|apology|thank\s*you)|make\s+(?:it|this)\s+(?:shorter|longer|polite|formal|casual|friendly)|more\s+(?:polite|formal|casual|friendly)|in\s+my\s+(?:own\s+)?(?:voice|words|style))\b|\b(?:likh\s+do|likho|reply\s+karo|jawab\s+likh|message\s+likh|email\s+likh|sundar\s+bana|theek\s+kar\s+do|shuddh\s+kar)\b/i;
const KEYBOT_HI = hindi(["(?:लिख\\s*दो|जवाब\\s*लिख|संदेश\\s*लिख|ईमेल\\s*लिख|ठीक\\s*कर\\s*दो)"]);
const PLAN = /\b(?:plan|schedule|timeline|roadmap|checklist|agenda|deadline|milestones?|to-?do\s+list|step[-\s]by[-\s]step|organi[sz]e\s+my|time[-\s]?table)\b|\b(?:plan\s+(?:banao|bana\s+do|karo)|steps\s+batao|routine\s+banao|schedule\s+banao|timetable\s+banao)\b/i;
const PLAN_HI = hindi(["(?:योजना|प्लान|कार्यक्रम|शेड्यूल)\\s*(?:बनाओ|बना\\s*दो)"]);
const TRAVEL = /\b(?:trip|travel(?:l?ing)?|flights?|trains?|buses|hotels?|stays?|visa|itinerary|tour|vacation|holiday|airport|passport|sightseeing|backpacking|road\s*trip|how\s+to\s+reach|route\s+to|things\s+to\s+do\s+in)\b|\b(?:yatra|safar|ghoomne|ghumne|ghoomna|ticket\s+book|hotel\s+book|kaise\s+pahunch|kahan\s+ghoom)\b/i;
const TRAVEL_HI = hindi(["(?:यात्रा|सफर|सफ़र|घूमने|छुट्टी|होटल|टिकट)"]);

const HINTS: Readonly<Record<string, ReadonlyArray<{ re: RegExp; points: number; id: string }>>> = {
  keybot: [{ re: KEYBOT, points: 8, id: "keybot:write" }, { re: KEYBOT_HI, points: 8, id: "keybot:write_hi" }],
  plan: [{ re: PLAN, points: 7, id: "plan:plan" }, { re: PLAN_HI, points: 7, id: "plan:plan_hi" }],
  travel: [{ re: TRAVEL, points: 9, id: "travel:trip" }, { re: TRAVEL_HI, points: 9, id: "travel:trip_hi" }],
};

// ------------------------------------------------------------------ the rules

export interface Scored { bot: BotDef; points: number; reasons: string[] }

const NEEDS_FILE = /\b(?:pdf|doc(?:ument)?|spreadsheet|sheet|csv|invoice|resume|report|attached|attachment|screenshot)\b/i;
const NEEDS_VISUAL = /\b(?:chart|graph|diagram|dashboard|infographic|table\s+of|visuali[sz]e|mock-?up|landing\s+page)\b/i;
const NEEDS_FRESH = /\b(?:latest|news|today'?s|current|price\s+of|prices?|compare|versus|vs\.?|review|trending|score|weather|khabar|aaj\s+ka|abhi\s+ka)\b/i;

/** Every bot scored for a message, best first. Free, and the same words always give the same scores. */
export function scoreBots(
  message: string, bots: readonly BotDef[], ctx: Pick<FrontCtx, "projectId" | "attachments" | "recent" | "mode">,
  /** The apps this person has connected. An app that is not connected makes no bot a better fit; absent: all are taken as connected. */
  connected?: ReadonlySet<string>,
): Scored[] {
  const text = message.trim();
  const said = wordsOf(text);
  const front = readByRules(text, ctx);
  let intent: ReturnType<typeof readIntent> | null = null;
  try { intent = readIntent(text); } catch { intent = null; }
  const jobApps = new Set<string>();
  const namedApps = new Set<string>();
  const collect = (i: NonNullable<typeof intent>): void => {
    if (i.job && !i.guarded) for (const id of JOB_APPS[i.job]) jobApps.add(id);
    for (const n of i.named) for (const id of n.ids) namedApps.add(id);
    for (const m of i.more ?? []) collect(m);
  };
  if (intent) collect(intent);

  // How many of the bots each word is in the purpose or name of: a word only one bot has says more than one every bot has.
  const vocabs = bots.map((b) => wordsOf(`${b.name} ${b.purpose}`));
  const df = new Map<string, number>();
  for (const v of vocabs) for (const w of v) df.set(w, (df.get(w) ?? 0) + 1);

  return bots.map((bot, at): Scored => {
    const reasons: string[] = [];
    let points = 0;
    const add = (n: number, id: string): void => { points += n; reasons.push(id); };

    // The Code bot is the front door's: code words in a project, and the questions and designs the front door sends down the Code bot's roads.
    if (bot.slug === CODE_SLUG) {
      if (ctx.projectId && ["code_question", "code_task", "design"].includes(front.intent)) add(Math.round(6 + front.confidence * 6), `code:${front.intent}`);
      else if (!ctx.projectId && ["code_question", "code_task"].includes(front.intent) && front.confidence >= 0.7) add(4, "code:no_project");
      if (ctx.projectId && points === 0) add(1, "code:project");
    }

    let hinted = false;
    for (const h of HINTS[bot.slug] ?? []) if (h.re.test(text)) { add(h.points, h.id); hinted = true; }

    // Its purpose and its name against the message. A built-in that its own words already named is not counted twice.
    const vocab = vocabs[at]!;
    const named = wordsOf(bot.name);
    let overlap = 0;
    if (!hinted) {
      for (const w of said) {
        if (!vocab.has(w)) continue;
        const base = named.has(w) ? 4 : 3;
        const n = df.get(w) ?? 1;
        overlap += n === 1 ? base * 1.5 : n === 2 ? base : base * 0.5;
      }
    }
    if (overlap) add(Math.min(12, Math.round(overlap)), "purpose");

    // The apps it was given.
    const mine = new Set(bot.skills.connectors.filter((id) => !connected || connected.has(id)));
    const byName = [...namedApps].filter((id) => mine.has(id));
    const byJob = [...jobApps].filter((id) => mine.has(id));
    if (byName.length) add(8, "app:named");
    else if (byJob.length) add(6, "app:job");

    // What it can do, for what the message needs.
    if (ctx.attachments.length && bot.skills.files) add(3, "skill:files");
    else if (NEEDS_FILE.test(text) && bot.skills.files) add(2, "skill:files_words");
    if (NEEDS_VISUAL.test(text) && bot.skills.artifacts) add(3, "skill:artifacts");
    if (NEEDS_FRESH.test(text) && (bot.skills.research || bot.skills.web) && points > 0) add(2, "skill:fresh");

    // A rule of the owner's own that names it: their own words for what the bot is for.
    if (bot.ownerId !== null) {
      let ruled = 0;
      for (const r of bot.principles) for (const w of wordsOf(r)) if (said.has(w) && !vocab.has(w)) ruled += 1;
      if (ruled) add(Math.min(3, ruled), "rules");
    }
    return { bot, points, reasons };
  }).sort((a, b) => b.points - a.points);
}

export interface Picked {
  bot: BotDef | null;
  by: "name" | "rules" | "model" | "none";
  confidence: number;
  reasons: string[];
  /** The message with an @name taken off its front. */
  message: string;
  paise: number;
}

export interface DoorDeps {
  /** The apps the person has connected, by id (see scoreBots). */
  connected?: ReadonlySet<string>;
  call?: CallFn;
  gateway?: GatewayDeps;
  signal?: AbortSignal;
  /** Instead of SURE_POINTS and SURE_LEAD. */
  sure?: { points: number; lead: number };
}

const MENTION = /^\s*@([a-z0-9]+(?:-[a-z0-9]+)*)\b[\s,:.-]*/i;

export function pickerUser(message: string, bots: readonly BotDef[]): string {
  const list = bots.map((b) => {
    const on = SKILL_NAMES.filter((s) => b.skills[s]);
    return `- ${b.slug}: ${neutral(oneLine(b.purpose, 140))} Skills: ${[...on, ...(b.skills.connectors.length ? ["connected apps"] : [])].join(", ") || "none"}.`;
  }).join("\n");
  return [`Bots:\n<<<\n${list}\n>>>`, `Message:\n<<<\n${neutral(forModel(oneLine(message, 800)))}\n>>>`].join("\n");
}

export async function pickBot(
  d: DoorDeps, userId: string, message: string, bots: readonly BotDef[], ctx: Pick<FrontCtx, "projectId" | "attachments" | "recent" | "mode">,
): Promise<Picked> {
  const none = (reasons: string[], text = message): Picked => ({ bot: null, by: "none", confidence: 0, reasons, message: text, paise: 0 });
  if (!bots.length) return none(["no_bots"]);

  const mention = MENTION.exec(message);
  if (mention) {
    const bot = bots.find((b) => b.slug === mention[1]!.toLowerCase());
    if (bot) return { bot, by: "name", confidence: 1, reasons: ["mention"], message: message.slice(mention[0].length).trim() || message, paise: 0 };
  }

  const scored = scoreBots(message, bots, ctx, d.connected);
  const [best, second] = scored;
  const sure = d.sure ?? { points: SURE_POINTS, lead: SURE_LEAD };
  if (!best || best.points < 2) return none(["rules:nothing"]);
  const lead = best.points - (second?.points ?? 0);
  if (best.points >= sure.points && lead >= sure.lead) {
    return { bot: best.bot, by: "rules", confidence: Math.round((0.8 + Math.min(0.15, lead / 40)) * 100) / 100, reasons: best.reasons, message, paise: 0 };
  }

  // Not sure: the small model, once, between the bots that scored.
  const contenders = scored.filter((s) => s.points >= 1).slice(0, 6).map((s) => s.bot);
  const model: ModelCtx = { ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}), userId, budget: { maxPaise: PICK_CAP_PAISE }, ...(d.signal ? { signal: d.signal } : {}) };
  const r = await askJson(model, { tier: "tiny", purpose: "bot.pick", role: "bot_pick", user: pickerUser(message, contenders), schema: BotPickReply, maxTokens: 80 });
  if (r.ok) {
    const chosen = r.value.bot ? contenders.find((b) => b.slug === r.value.bot) ?? bots.find((b) => b.slug === r.value.bot) : undefined;
    if (chosen && r.value.confidence >= 0.5) return { bot: chosen, by: "model", confidence: Math.round(r.value.confidence * 100) / 100, reasons: [...best.reasons, "model:tiny"], message, paise: r.paise };
    return { ...none(["model:none"]), paise: r.paise };
  }
  // The model could not be asked: the rules' own best, when it clearly led; else nobody.
  if (best.points >= sure.points - 2 && lead >= 2) return { bot: best.bot, by: "rules", confidence: 0.6, reasons: [...best.reasons, `model:skipped:${r.reason}`], message, paise: 0 };
  return none([`model:skipped:${r.reason}`]);
}
