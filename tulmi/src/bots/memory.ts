/**
 * WHAT A BOT REMEMBERS OF ITS OWNER: A SMALL STORE OF STABLE FACTS, AND A ROLLING SUMMARY OF THE TALK.
 *
 *   rememberTurn(deps, turn)   after an answer: say-so facts are kept for nothing; a small model reads the turns now and then; the summary rolls
 *   memoryFor(store, userId, botId)   what the next turn is shown: the facts and the summary
 *
 * Per bot AND per owner: two bots do not share a memory, and a bot's API callers (who are the owner's customers, not the owner) neither read it nor
 * write to it. A fact is one short line the owner said about themselves that will still be true next month (a preference, a name, a routine, a goal, a
 * limit). Never a feeling, health, politics, a one-off request, another person's details or anything secret: the role says so (bot_memory), and the code
 * checks again before a line is kept (no secret, no instruction to the bot, one line, 160 characters). At most 40 facts a bot: the oldest go first.
 * The owner reads them and forgets one, or all of it, on the memory routes.
 *
 * RULES FIRST. "Remember that I train at six" / "yaad rakhna ki ..." keeps the sentence as a fact with no model at all. Otherwise the small model
 * (the tiny tier, at most 40 paise) is asked only when the owner's words sound like they were about themselves (I am, my X is, I prefer, mera ... hai)
 * or when four turns have piled up to be folded into the summary. A turn that is neither is only written down, shortened, in the thread.
 * A model that is down or over budget costs nothing but the update: the turns wait for the next time.
 */
import { z } from "zod";
import { scanForSecrets } from "../code/policy.js";
import { askJson, forModel, oneLine, type CallFn, type ModelCtx } from "../code/work/model.js";
import type { GatewayDeps } from "../code/brain/gateway.js";
import { neutral } from "./prompt.js";
import type { BotStore, Fact, Thread } from "./store.js";
import { LIMITS } from "./types.js";
import { inertRules } from "./validate.js";

/** What the memory role answers with (the contract of bot_memory names these fields). */
export const BotMemoryReply = z.object({
  add: z.array(z.string().min(2).max(400)).max(6),
  drop: z.array(z.number().int().min(1).max(200)).max(10),
  summary: z.string().max(1500),
}).strict();
export type BotMemoryReply = z.infer<typeof BotMemoryReply>;

export const MEMORY_CAP_PAISE = 40;
const FOLD_EVERY = 4;
const BUFFER_MAX = 6;
const TURN_CHARS = 220;

const REMEMBER = /^\s*(?:please\s+)?(?:remember|note|keep in mind)\s+(?:that\s+)?(.{3,300}?)[.!\s]*$/is;
const REMEMBER_HG = /^\s*(?:yaad\s+rakh(?:na|o)?|dhyan\s+rakh(?:na|o)?)\s+(?:ki\s+)?(.{3,300}?)[.!\s]*$/is;
/** Words that sound like the owner is telling the bot about themselves. */
const ABOUT_ME = /\b(?:i\s+am|i'?m|i\s+(?:prefer|like|love|hate|always|never|usually|work|live|train|eat|use|have|need|moved|switched|changed|started|stopped|quit|joined)|my\s+\w+(?:\s+\w+)?\s+(?:is|are)|mera|meri|mere|main\s+\w+\s+(?:hoon|hun|karta|karti|rehta|rehti)|mujhe)\b/i;

export interface MemoryDeps {
  store: BotStore;
  call?: CallFn;
  gateway?: GatewayDeps;
  now?: () => number;
}

export interface Turn {
  userId: string;
  botId: string;
  said: string;
  answered: string;
  /** What this request has left to spend, in paise. */
  leftPaise: number;
  signal?: AbortSignal;
}

export interface Remembered {
  learned: string[];
  dropped: number;
  folded: boolean;
  paise: number;
}

/** A line fit to keep as a fact: one line, short, no secret, no instruction aimed at the bot. Else null. */
export function usableFact(raw: string): string | null {
  const t = oneLine(raw, LIMITS.facts.fact + 1);
  if (t.length < 3 || t.length > LIMITS.facts.fact) return null;
  if (scanForSecrets([{ path: "fact.txt", content: t }]).length) return null;
  if (inertRules([t]).length) return null;
  // eslint-disable-next-line no-useless-escape
  if (/<\/?[a-z_]+>|\bpassword\b|\bpasscode\b|\botp\b|\bpin\s*(?:is|code)\b/i.test(t)) return null;
  return t;
}

/** What the owner asked to have remembered, in so many words, or null. */
export function saidToRemember(said: string): string | null {
  const m = REMEMBER.exec(said) ?? REMEMBER_HG.exec(said);
  return m?.[1] ? usableFact(m[1]) : null;
}

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** What the model is sent: the facts (numbered), the summary and the latest turns, each fenced as data. */
export function memoryUser(facts: readonly Fact[], thread: Thread): string {
  return [
    `Facts:\n<<<\n${facts.length ? facts.map((f, i) => `${i + 1}. ${neutral(f.text)}`).join("\n") : "(none)"}\n>>>`,
    `Summary:\n<<<\n${neutral(thread.summary) || "(none)"}\n>>>`,
    `Latest turns:\n<<<\n${thread.buffer.map((t) => neutral(t)).join("\n")}\n>>>`,
  ].join("\n");
}

export async function memoryFor(store: BotStore, userId: string, botId: string): Promise<{ facts: Fact[]; thread: Thread | null }> {
  const [facts, thread] = await Promise.all([store.listFacts(userId, botId), store.getThread(userId, botId)]);
  return { facts, thread };
}

export async function rememberTurn(d: MemoryDeps, t: Turn): Promise<Remembered> {
  const now = (d.now ?? Date.now)();
  const out: Remembered = { learned: [], dropped: 0, folded: false, paise: 0 };
  const thread: Thread = (await d.store.getThread(t.userId, t.botId)) ?? { summary: "", buffer: [], turns: 0, updatedAt: now };
  thread.buffer = [...thread.buffer, `said: ${cut(forModel(t.said).replace(/\s+/g, " "), TURN_CHARS)} | bot: ${cut(t.answered.replace(/\s+/g, " "), TURN_CHARS)}`].slice(-BUFFER_MAX);
  thread.turns += 1;
  thread.updatedAt = now;

  // 1. Said in so many words: kept for nothing.
  const asked = saidToRemember(t.said);
  if (asked) {
    out.learned.push(...(await d.store.addFacts(t.userId, t.botId, [asked], LIMITS.facts.perBot, now)).map((f) => f.text));
  }

  // 2. The small model, now and then.
  const aboutMe = !asked && ABOUT_ME.test(t.said);
  const fold = thread.buffer.length >= FOLD_EVERY;
  if ((aboutMe || fold) && t.leftPaise >= 5 && !t.signal?.aborted) {
    const facts = await d.store.listFacts(t.userId, t.botId);
    const ctx: ModelCtx = { ...(d.call ? { call: d.call } : {}), ...(d.gateway ? { gateway: d.gateway } : {}), userId: t.userId, budget: { maxPaise: Math.min(MEMORY_CAP_PAISE, t.leftPaise) }, ...(t.signal ? { signal: t.signal } : {}) };
    const r = await askJson(ctx, { tier: "tiny", purpose: "bot.memory", role: "bot_memory", user: memoryUser(facts, thread), schema: BotMemoryReply, maxTokens: 400 });
    if (r.ok) {
      out.paise += r.paise;
      const drop = [...new Set(r.value.drop)].map((n) => facts[n - 1]).filter((f): f is Fact => !!f);
      for (const f of drop) if (await d.store.dropFact(t.userId, t.botId, f.id)) out.dropped += 1;
      const add = r.value.add.map(usableFact).filter((x): x is string => !!x).slice(0, 3);
      if (add.length) out.learned.push(...(await d.store.addFacts(t.userId, t.botId, add, LIMITS.facts.perBot, now)).map((f) => f.text));
      const summary = oneLine(r.value.summary, 600);
      if (summary && !scanForSecrets([{ path: "summary.txt", content: summary }]).length && !inertRules([summary]).length) thread.summary = summary;
      thread.buffer = [];
      out.folded = true;
    }
  }
  await d.store.putThread(t.userId, t.botId, thread);
  return out;
}
