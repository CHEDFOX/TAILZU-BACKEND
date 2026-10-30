/**
 * WHAT A USE REALLY COST US, IN US DOLLARS, FOR THE USAGE METER (src/you/usage.ts, limits.ts).
 *
 * The meter counts what each use costs us, from where the cost is known:
 *
 *   the brain's gateway   every call of Xode, the bots, the front door, research and artifacts (code/brain/gateway.ts): the charge
 *                         OpenRouter reports for the generation (usage.cost, asked for with `usage: { include: true }`), else an estimate from
 *                         the tokens it reports. Those land on the meter as a job's spent_paise, a bot answer's you_spend row, the front door's
 *                         row. Nothing here touches them.
 *   everything else       Keylessbord's rewrites (pipeline/cleanup.ts), a note's organising (notes/organise.ts), the old Ask's planner
 *                         (agent/llm.ts) call OpenRouter without the gateway. Each adds what OpenRouter reported to the REQUEST'S TALLY here
 *                         (addCostUsd), and the request's usage row (metering.recordUsage) writes the tally to the meter with what its
 *                         speech cost.
 *   speech                no engine reports a price per request, so a minute of audio heard costs its engine's list price
 *                         (STT_USD_PER_MINUTE, USAGE_STT_USD_PER_MINUTE over it), for EVERY engine that heard it (STT_PROVIDER=auto runs
 *                         two or three at once; live dictation's dual mode two).
 *   the voice             a million characters read aloud at USAGE_TTS_USD_PER_1M_CHARS.
 *
 * THE TALLY is one per request (async local storage, opened by the server's preHandler hook, costTallyHook): no caller passes a thing,
 * however deep the call. enforceQuota names whose request it is (noteCostUser), so what was spent on a request that never wrote a usage row
 * (it failed after the model answered) is still charged when the response goes (settleCostTally).
 *
 * THE SINK is the you module's (setCostSink, limits.ts Spending.recordUsd): dollars become paise at CODE_USD_INR, the rate the plans'
 * dollars become paise at, so the meter counts dollars. Unset (tests, the Worker), nothing is written.
 *
 * Never shown to anyone: a person sees how much of the stretch or the month is used, never an amount.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { getConfig, type AppConfig } from "../config.js";

// ---------------------------------------------------------------- the tally

interface Tally { usd: number; userId?: string }

const tallies = new AsyncLocalStorage<Tally>();
const byRequest = new WeakMap<object, Tally>();

/** Runs `work` with a tally of its own (tests; a piece of work outside a request). A tally already open is used as it is. */
export function inCostTally<T>(work: () => T): T {
  return tallies.getStore() ? work() : tallies.run({ usd: 0 }, work);
}

/**
 * Work that goes on after its request has answered (a note organised in the background): a tally of its own, charged to the person when the
 * work is done, whatever it ends in.
 */
export async function chargedTo<T>(userId: string, bot: string, work: () => Promise<T>): Promise<T> {
  const t: Tally = { usd: 0, userId };
  try {
    return await tallies.run(t, work);
  } finally {
    if (t.usd > 0) chargeUsd(userId, t.usd, bot);
  }
}

/**
 * Fastify's preHandler hook, callback style: the handler runs inside the request's own tally, and so does everything it awaits. (preHandler,
 * not onRequest: a request with a body is handled in the body's async context, which an onRequest scope does not reach.)
 */
export function costTallyHook(req: object, _reply: unknown, done: () => void): void {
  const t: Tally = { usd: 0 };
  byRequest.set(req, t);
  tallies.run(t, done);
}

/** What a call cost, in US dollars, added to the request's tally. Outside a request (a job, a timer), nowhere: the gateway counts those. */
export function addCostUsd(usd: number | undefined): void {
  const t = tallies.getStore();
  if (t && typeof usd === "number" && Number.isFinite(usd) && usd > 0) t.usd += usd;
}

/** Whose request this is (enforceQuota knows), so what is left on its tally is charged to them when the response goes. */
export function noteCostUser(userId: string): void {
  const t = tallies.getStore();
  if (t && userId) t.userId = userId;
}

/** The tally so far, taken: it starts again at nothing. */
export function takeCostUsd(): number {
  const t = tallies.getStore();
  if (!t) return 0;
  const usd = t.usd;
  t.usd = 0;
  return usd;
}

/**
 * Fastify's onResponse hook: what is left on the request's tally (a model answered, then the request failed before its usage row was
 * written), charged to whose request it was. Nothing when nobody was named.
 */
export async function settleCostTally(req: object): Promise<void> {
  const t = byRequest.get(req);
  if (!t?.userId || !(t.usd > 0)) return;
  const usd = t.usd;
  t.usd = 0;
  chargeUsd(t.userId, usd, "keybot");
}

// ---------------------------------------------------------------- the sink

export type CostSink = (userId: string, usd: number, bot: string) => void;
let sink: CostSink | null = null;

/** Where what a use cost goes: the usage meter (you/limits.ts). Null: nowhere. */
export function setCostSink(s: CostSink | null): void { sink = s; }

/** What a use cost, in US dollars, onto the person's meter. Never throws: a lost row is a gap in a chart, not a failed answer. */
export function chargeUsd(userId: string, usd: number, bot: string): void {
  if (!sink || !userId || !(usd > 0) || !Number.isFinite(usd)) return;
  try { sink(userId, usd, bot); } catch { /* the meter is a guard rail */ }
}

// ---------------------------------------------------------------- OpenRouter's charge

/** The worst-case prices an unreported charge is estimated at, per million tokens (the gateway's UNLISTED_MODEL): never low. */
export const FALLBACK_PRICES = { usdPerMIn: 3, usdPerMOut: 15 } as const;

/** When each kind of estimate was last logged: an estimate is rare, and one line an hour per kind says so without flooding the log. */
const estimatedAt = new Map<string, number>();
const ESTIMATE_LOG_MS = 3_600_000;

/** One line, at most hourly per place and model: OpenRouter's answer did not carry its charge, so it was estimated. */
export function logEstimated(where: string, model: string, now = Date.now(), log: (line: string) => void = (l) => console.warn(l)): void {
  const key = `${where}:${model}`;
  const last = estimatedAt.get(key);
  if (last !== undefined && now - last < ESTIMATE_LOG_MS) return;
  estimatedAt.set(key, now);
  if (estimatedAt.size > 500) estimatedAt.delete(estimatedAt.keys().next().value as string);
  log(`[cost] ${where}: OpenRouter's answer from ${model} did not say what it charged, so the meter counted an estimate (logged once an hour)`);
}

/**
 * What one OpenRouter answer cost, in US dollars: the charge it reports (usage.cost, there when the request asked for usage accounting),
 * else its tokens at the worst-case prices (logged, rarely), else nothing.
 */
export function openRouterUsd(raw: unknown, o: { where: string; model: string }): number {
  const u = ((raw ?? {}) as { usage?: Record<string, unknown> }).usage ?? {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
  const cost = num(u.cost);
  if (cost !== undefined) return cost;
  const inT = num(u.prompt_tokens), outT = num(u.completion_tokens);
  if (inT === undefined && outT === undefined) return 0;
  logEstimated(o.where, o.model);
  return ((inT ?? 0) * FALLBACK_PRICES.usdPerMIn + (outT ?? 0) * FALLBACK_PRICES.usdPerMOut) / 1_000_000;
}

// ---------------------------------------------------------------- speech and the voice

export type SttEngine = "groq" | "openai" | "deepgram" | "sarvam";

/**
 * A minute of audio heard, per engine, in US dollars: the list prices of the models the config names by default (Groq $0.04 an hour;
 * OpenAI $0.003 a minute; Deepgram, streaming, $0.0058 a minute; Sarvam ₹30 an hour). USAGE_STT_USD_PER_MINUTE changes any of them without a
 * deploy, as a JSON object of these names: set it when the config names another model.
 */
export const STT_USD_PER_MINUTE: Readonly<Record<SttEngine, number>> = { groq: 0.04 / 60, openai: 0.003, deepgram: 0.0058, sarvam: 0.0058 };

const ENGINES = Object.keys(STT_USD_PER_MINUTE) as SttEngine[];

/** The prices in force: USAGE_STT_USD_PER_MINUTE over the defaults. A name or a price that is not one is ignored. */
export function sttPrices(spec: string | undefined = getConfig().USAGE_STT_USD_PER_MINUTE): Record<SttEngine, number> {
  const out = { ...STT_USD_PER_MINUTE };
  if (!spec?.trim()) return out;
  try {
    const raw = JSON.parse(spec) as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const name = k.trim().toLowerCase() as SttEngine;
        const n = Number(v);
        if (ENGINES.includes(name) && Number.isFinite(n) && n >= 0) out[name] = n;
      }
    }
  } catch { /* not JSON: the defaults */ }
  return out;
}

/** An engine's name from a label ("deepgram:<model>", "sarvam", "openai-realtime"), or null. */
export function engineOf(label: string | null | undefined): SttEngine | null {
  const l = String(label ?? "").trim().toLowerCase();
  return ENGINES.find((e) => l.startsWith(e)) ?? null;
}

type SttConfig = Pick<AppConfig, "STT_PROVIDER" | "SARVAM_API_KEY" | "GROQ_API_KEY" | "DEEPGRAM_API_KEY" | "STT_AUTO_INCLUDE_DEEPGRAM">;

/** The engines that hear one recorded clip, as pipeline/stt.ts picks them: "auto" with Sarvam runs every leg at once. */
export function fileEngines(c: SttConfig = getConfig()): SttEngine[] {
  const generalist: SttEngine = c.STT_PROVIDER === "openai" || !c.GROQ_API_KEY ? "openai" : "groq";
  if (c.STT_PROVIDER === "auto" && c.SARVAM_API_KEY) {
    return ["sarvam", generalist, ...(c.STT_AUTO_INCLUDE_DEEPGRAM && c.DEEPGRAM_API_KEY ? ["deepgram" as const] : [])];
  }
  if (c.STT_PROVIDER === "sarvam") return ["sarvam"];
  if (c.STT_PROVIDER === "groq" && c.GROQ_API_KEY) return ["groq"];
  return [generalist];
}

/** The least an engine bills one request for, in seconds (Groq: ten). */
const MIN_BILLED_SECONDS: Partial<Record<SttEngine, number>> = { groq: 10 };

/** What `seconds` of audio heard by `engines` cost, in US dollars (one request each: an engine's least billed time counts). */
export function sttUsd(seconds: number, engines: readonly (SttEngine | null)[], prices: Record<SttEngine, number> = sttPrices()): number {
  if (!(seconds > 0)) return 0;
  return engines.reduce((sum, e) => sum + (e ? (Math.max(seconds, MIN_BILLED_SECONDS[e] ?? 0) / 60) * prices[e] : 0), 0);
}

/** What reading `chars` characters aloud cost, in US dollars. */
export function ttsUsd(chars: number, perMillion = getConfig().USAGE_TTS_USD_PER_1M_CHARS): number {
  return chars > 0 ? (chars * perMillion) / 1_000_000 : 0;
}
