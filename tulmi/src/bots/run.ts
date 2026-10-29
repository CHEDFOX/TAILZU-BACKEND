/**
 * RUNNING A BOT: ITS PRINCIPLES, ITS OWNER'S RULES, ITS TOOLS, ITS KNOWLEDGE, ITS MEMORY, UNDER ITS BUDGET.
 *
 *   runBot(deps, req) -> BotAnswer
 *
 *   1. scope        what the words ask for, clamped to the bot's skills (scope.ts); free
 *   2. the context  the facts and the summary the bot kept of its owner (memory.ts), and the few chunks of its files that are about the question (knowledge.ts)
 *   3. the tools    one for each skill that is on, and the owner's connected apps (tools.ts)
 *   4. the prompt   compose("bot_run"): Tailzu's stable principles, in the system block; then ONE user message with everything the owner wrote, fenced and
 *                   capped, and the person's words last (prompt.ts). Nothing the owner wrote is ever in the system block
 *   5. the loop     the model answers or calls tools, at most five turns. Every call of the request, tools' and memory's included, is held to the request's
 *                   cap (meter.ts), which is the smaller of the bot's per-request budget and what is left of its day
 *   6. memory       after an owner's chat turn: facts and the rolling summary (memory.ts)
 *
 * THE MONEY: the cap is checked before every call by the gateway (a call whose worst case would pass it is refused, never made). A request that
 * runs dry after its tools worked returns what it has, with a note; one that cannot even start is a 402.
 *
 * THE WORDS: nothing a person said or the bot answered is logged here. The answer is checked once more on the way out: a string that looks like a
 * secret, or one of our API keys, is taken out, whatever the model was told.
 */
import { randomUUID } from "node:crypto";
import { BudgetExceeded, callModel, type GatewayDeps } from "../code/brain/gateway.js";
import { inRequestSpend } from "../code/brain/spend.js";
import type { ChatMessage } from "../code/brain/types.js";
import { scanForSecrets } from "../code/policy.js";
import type { CallFn } from "../code/work/model.js";
import { compose } from "../principles/index.js";
import type { FrontCtx } from "../front/types.js";
import { retrieve } from "./knowledge.js";
import { memoryFor, rememberTurn } from "./memory.js";
import { Meter } from "./meter.js";
import type { BotPorts } from "./ports.js";
import { botUserMessage, type Attached, type Turn } from "./prompt.js";
import { scopeMessage } from "./scope.js";
import type { BotStore } from "./store.js";
import { buildTools, CALLS_PER_STEP, newRecord } from "./tools.js";
import { BotError, type BotAnswer, type BotDef, type BotEvent } from "./types.js";

export interface RunDeps {
  store: BotStore;
  ports: BotPorts;
  call?: CallFn;
  gateway?: GatewayDeps;
  now?: () => number;
}

export interface RunRequest {
  bot: BotDef;
  /** The owner: whose apps, files, money and memory. An API caller is the owner's app, so it is the owner here too. */
  userId: string;
  message: string;
  surface: "chat" | "test" | "api" | "command";
  projectId?: string;
  /** Earlier turns the caller sent (an API caller sends its own; a chat leans on the summary). */
  history?: Turn[];
  /** Files attached to the message, already read by the caller (the front door), and what reading them cost: it comes off the request's cap. */
  attached?: Attached[];
  extraPaise?: number;
  /** The most this request may cost, in paise. */
  capPaise: number;
  signal?: AbortSignal;
  emit?: (e: BotEvent) => void;
  ctx?: Pick<FrontCtx, "attachments" | "recent" | "mode">;
  pickedBy?: BotAnswer["pickedBy"];
  /** The answer's words as the model writes them (streamed), and word that the ones so far are void (it went to a tool after all). */
  onText?: (piece: string) => void;
  onReset?: () => void;
}

/** How many turns the model gets: tool rounds, then one to say the answer. */
export const MAX_TURNS = 5;
const KEY_SHAPE = /\btzb_[A-Za-z0-9_-]{16,}/g;

const isAbort = (e: unknown): boolean => (e as { name?: unknown } | null)?.name === "AbortError";

/** The answer, with anything that looks like a secret taken out. */
export function scrub(text: string): { text: string; cleaned: boolean } {
  let out = text.replace(KEY_SHAPE, "(removed)");
  let cleaned = out !== text;
  if (scanForSecrets([{ path: "reply.txt", content: out }]).length) {
    out = "I left that out: it looked like it held a secret.";
    cleaned = true;
  }
  return { text: out, cleaned };
}

/** One request: every turn of the run, its tools' model calls and what it remembers are rounded up to the paise once over all of them (code/brain/spend.ts). */
export function runBot(d: RunDeps, r: RunRequest): Promise<BotAnswer> {
  return inRequestSpend(() => runBotRequest(d, r));
}

async function runBotRequest(d: RunDeps, r: RunRequest): Promise<BotAnswer> {
  const t0 = (d.now ?? Date.now)();
  const bot = r.bot;
  const emit = r.emit ?? (() => undefined);
  const base: CallFn = d.call ?? (callModel as CallFn);
  const meter = new Meter(r.capPaise);
  meter.add(r.extraPaise ?? 0);
  const call = meter.wrap(base);
  const record = newRecord();
  const runId = `bot:${bot.id}:${randomUUID()}`;
  const notes: string[] = [];
  const remember = r.surface === "chat" || r.surface === "command";
  const ctx = r.ctx ?? { attachments: [], recent: [], mode: "text" as const };

  emit({ t: "status", stage: "reading" });
  const scope = scopeMessage(bot, r.message, { ...ctx, ...(r.projectId ? { projectId: r.projectId } : {}) });
  notes.push(...scope.notes);

  // The context: what it kept of its owner, and the few chunks of its files that are about this.
  const mem = remember ? await memoryFor(d.store, r.userId, bot.id).catch(() => ({ facts: [], thread: null })) : { facts: [], thread: null };
  const know = bot.skills.files && bot.knowledge.length ? await retrieve(d.ports.media, r.userId, bot.knowledge, r.message) : null;
  if (know) notes.push(...know.notes);

  const kit = await buildTools({
    bot, userId: r.userId, runId, ...(r.projectId ? { projectId: r.projectId } : {}), ports: d.ports, meter, call, ...(d.gateway ? { gateway: d.gateway } : {}),
    ...(r.signal ? { signal: r.signal } : {}), record,
  });
  notes.push(...record.notes.splice(0));
  if (kit.notConnected.length) notes.push(`Not connected yet: ${kit.notConnected.join(", ")}. Connect ${kit.notConnected.length === 1 ? "it" : "them"} in X0 Bot to let this bot use ${kit.notConnected.length === 1 ? "it" : "them"}.`);

  const user = botUserMessage({
    bot: { ...bot, skills: bot.skills },
    ...(mem.facts.length ? { facts: mem.facts.map((f) => f.text) } : {}), ...(mem.thread?.summary ? { summary: mem.thread.summary } : {}),
    ...(know?.text ? { knowledge: know.text } : {}), ...(r.attached?.length ? { attached: r.attached } : {}), ...(r.history?.length ? { history: r.history } : {}), ...(kit.notConnected.length ? { notConnected: kit.notConnected } : {}),
    message: r.message,
  });
  const messages: ChatMessage[] = compose("bot_run", [{ role: "user" as const, content: user }]);

  let text = "";
  let waiting = false;
  // Streamed words: whether any of this turn's were sent (a turn that goes to a tool after writing a little takes them back).
  let said = false;
  const words = r.onText
    ? { onText: (piece: string) => { said = true; r.onText!(piece); }, onReset: () => { if (said) { said = false; r.onReset?.(); } } }
    : null;
  try {
    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      emit({ t: "status", stage: turn === 0 ? "thinking" : "working" });
      const last = turn === MAX_TURNS - 1;
      let res;
      try {
        res = await call({
          tier: scope.tier, messages, maxTokens: scope.maxTokens, purpose: "bot.run", userId: r.userId, budget: { maxPaise: Math.max(1, meter.left()) },
          ...(kit.defs.length ? { tools: kit.defs, toolChoice: last ? ("none" as const) : ("auto" as const) } : {}), ...(r.signal ? { signal: r.signal } : {}),
          ...(words ?? {}),
        }, d.gateway);
      } catch (err) {
        if (isAbort(err)) throw err;
        const over = err instanceof BudgetExceeded || (err as { code?: unknown } | null)?.code === "budget_exceeded";
        if (turn === 0) {
          throw over
            ? new BotError("budget", "That would cost more than this bot may spend on one request. Ask for less, or raise the bot's budget.", 402)
            : new BotError("model_down", "No model could be reached just now. Nothing was changed; try again in a moment.", 503);
        }
        notes.push(over ? "This bot ran out of what one request may cost, so this is as far as it got." : "The model could not be reached again, so this is as far as it got.");
        break;
      }
      if (!res.toolCalls.length || last) { text = res.text.trim(); break; }
      words?.onReset();
      messages.push({ role: "assistant", content: res.text || null, tool_calls: res.toolCalls });
      const calls = res.toolCalls.slice(0, CALLS_PER_STEP);
      for (const c of calls) {
        emit({ t: "status", stage: `tool:${c.name}` });
        const out = await kit.run(c);
        messages.push({ role: "tool", tool_call_id: c.id, content: out.content });
      }
      for (const c of res.toolCalls.slice(CALLS_PER_STEP)) messages.push({ role: "tool", tool_call_id: c.id, content: "Skipped: too many tool calls in one step. Ask again if it still matters." });
      if (record.approvals.length) waiting = true;
    }
  } finally {
    await kit.settled().catch(() => undefined);
    await d.ports.connectors?.settle(r.userId, runId, text || waiting ? "done" : "error").catch(() => undefined);
  }

  if (!text) {
    text = waiting ? "I've put that in front of you to approve. Nothing has happened yet." : "I couldn't put an answer together. Try asking it a little differently.";
  }
  const clean = scrub(text);
  if (clean.cleaned) { notes.push("Part of the reply was left out: it looked like it held a secret."); words?.onReset(); }
  text = clean.text;
  if (record.approvals.length) notes.push(`${record.approvals.length === 1 ? "A change is" : "Changes are"} waiting for your yes in X0 Bot.`);
  emit({ t: "text", text });

  // What the owner told it, and how the talk is going.
  if (remember && !r.signal?.aborted) {
    const learned = await rememberTurn(
      { store: d.store, call: base, ...(d.gateway ? { gateway: d.gateway } : {}), ...(d.now ? { now: d.now } : {}) },
      { userId: r.userId, botId: bot.id, said: r.message, answered: text, leftPaise: meter.left(), ...(r.signal ? { signal: r.signal } : {}) },
    ).catch(() => null);
    if (learned) meter.add(learned.paise);
  }

  const answer: BotAnswer = {
    bot: { slug: bot.slug, name: bot.name, colour: bot.colour, builtin: bot.ownerId === null },
    text, paise: meter.spent, tools: record.tools, approvals: record.approvals, artifacts: record.artifacts, opens: record.opens,
    notes: [...new Set(notes)], ...(r.pickedBy ? { pickedBy: r.pickedBy } : {}), ms: (d.now ?? Date.now)() - t0,
  };
  emit({ t: "result", result: answer });
  return answer;
}
