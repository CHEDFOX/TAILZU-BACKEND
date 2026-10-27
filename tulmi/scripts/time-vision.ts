/**
 * How fast does each model answer a question about a picture, sent the way
 * Ask's picture path sends it? Run it and see.
 *
 * In the production container, with the server's own key and models (tsx is
 * not installed there; the script is compiled with the server):
 *
 *   docker compose exec backend node dist/tulmi/scripts/time-vision.js
 *   docker compose exec backend node dist/tulmi/scripts/time-vision.js --runs 8 --models google/gemini-3.8-flash,anthropic/claude-haiku-5.5
 *
 * Locally, with tulmi/.env:
 *
 *   npx tsx scripts/time-vision.ts
 *
 * Options: --runs 3 (per model), --models a,b,c (OpenRouter ids; by default
 * the server's own vision models, then two others for comparison), --route
 * latency|none (ask OpenRouter for each model's lowest-latency provider, or
 * not; by default what the server does, AGENT_VISION_PROVIDER_SORT).
 *
 * Every run is the real request, built by the server's own code: the vision
 * role's stable block (ask_vision), the user content with the picture and the
 * note for the model's family (agentPictureContent), plannerRequest with reasoningFor
 * and the temperature rule, and planStream, a ladder of one so a failure is
 * seen rather than passed over. The picture is the worksheet photo in
 * time-vision-picture.ts, the question "explain this triangle", over a short
 * chat screen. Models run one after another and runs one at a time, never at
 * once, so they do not slow each other. For each run it prints how long
 * until the first byte, until the first whole SAY line (the first sentence,
 * what the person perceives as "it answered"), and until the end; the model's
 * provider; its tokens; the cost, from those tokens and the model's price on
 * OpenRouter's public model list; and its DRAW lines kept and dropped, read
 * in that model's own order. Then the median and the worst, and last the
 * fastest to its first sentence and each model's cost per 1,000 questions:
 *
 *   google/gemini-2.5-flash, providers sorted by latency
 *     run     first byte  first sentence     done  tokens in/out  thinking      cost  marks  served by
 *       1         1.48 s          2.04 s   3.11 s       3412/181         0  $0.00148  3/0    Google
 *
 * It writes nothing anywhere, and prints no key, no picture and no answer:
 * only each model's first sentence, cut to 80 characters, to show it read
 * the triangle. It exits non-zero only on a usage error; a model that fails
 * prints why and the others go on. Each question costs well under a cent,
 * so the default dozen comes to a cent or two.
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentElement, AgentStepRequest } from "../../shared/types/api.js";
import { LineReader, LineSplitter, parseLine } from "../src/agent/lines.js";
import {
  PlannerUnavailable, planStream, providerSortOf, type CallRecord, type PlanChunk, type PlanOptions, type SystemPrompt, type UserPrompt,
} from "../src/agent/llm.js";
import { agentPictureContent, drawOrderFor } from "../src/agent/prompt.js";
import { stableBlock } from "../src/principles/roles.js";
import { getConfig } from "../src/config.js";
import { PICTURE_BASE64, PICTURE_MIME } from "./time-vision-picture.js";

/** Measured beside the server's own models, as the owner compared them. */
export const COMPARE_MODELS = ["google/gemini-3.8-flash", "openai/gpt-6-luna"];
export const MODELS_URL = "https://openrouter.ai/api/v1/models";
/** This measures, it does not fall back: a model slower than the server's
 *  AGENT_VISION_TIMEOUT_MS is timed to the end, and said to be slower. */
export const MEASURE_TIMEOUT_MS = 30_000;
const RUNS_MAX = 50;
const SAY_SHOWN = 80;
const ROUTES = ["latency", "throughput", "price", "none"] as const;
type Route = (typeof ROUTES)[number];

export const USAGE = [
  "Usage: node dist/tulmi/scripts/time-vision.js [--runs N] [--models a,b,c] [--route latency|none]",
  "",
  "  --runs N        runs per model, one at a time (default 3, at most 50)",
  "  --models a,b,c  OpenRouter model ids (default: the server's vision models,",
  `                  AGENT_VISION_MODEL then AGENT_VISION_FALLBACK_MODELS, then ${COMPARE_MODELS.join(" and ")})`,
  "  --route R       latency: ask OpenRouter for each model's lowest-latency provider",
  "                  (or throughput, or price); none: its default routing",
  "                  (default: what the server sends, AGENT_VISION_PROVIDER_SORT)",
  "  --help          this",
].join("\n");

export interface Options {
  runs: number;
  /** Empty: the server's models and the comparison ones. */
  models: string[];
  /** Undefined: what the server sends. */
  route?: Route;
  help: boolean;
}

/** The command line, or what is wrong with it. */
export function parseArgs(argv: string[]): { options: Options } | { error: string } {
  const options: Options = { runs: 3, models: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    const value = () => (eq > 0 ? arg.slice(eq + 1) : argv[++i]);
    if (name === "--help" || name === "-h") {
      options.help = true;
    } else if (name === "--runs") {
      const v = value();
      const n = Number(v);
      if (!v || !Number.isInteger(n) || n < 1 || n > RUNS_MAX) return { error: `--runs is a whole number from 1 to ${RUNS_MAX}` };
      options.runs = n;
    } else if (name === "--models") {
      const models = (value() ?? "").split(",").map((m) => m.trim()).filter(Boolean);
      if (!models.length) return { error: "--models is a comma-separated list of OpenRouter model ids" };
      options.models = models.filter((m, k) => models.indexOf(m) === k);
    } else if (name === "--route") {
      const v = value();
      if (!v || !(ROUTES as readonly string[]).includes(v)) return { error: `--route is one of ${ROUTES.join(", ")}` };
      options.route = v as Route;
    } else {
      return { error: `unknown option: ${arg}` };
    }
  }
  return { options };
}

// ---- prices and cost ------------------------------------------------------------

/** A model's price on OpenRouter, in dollars per token (per request for
 *  `request`), with the tiers that start at a longer prompt. */
export interface Price {
  prompt: number;
  completion: number;
  cacheRead?: number;
  request?: number;
  tiers?: Array<{ min: number; prompt?: number; completion?: number; cacheRead?: number }>;
}

const dollars = (v: unknown): number | undefined => {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

function readPrice(p: unknown): Price | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  const prompt = dollars(o.prompt);
  const completion = dollars(o.completion);
  if (prompt === undefined || completion === undefined) return null;
  const price: Price = { prompt, completion };
  const cacheRead = dollars(o.input_cache_read);
  if (cacheRead !== undefined) price.cacheRead = cacheRead;
  const request = dollars(o.request);
  if (request) price.request = request;
  if (Array.isArray(o.overrides)) {
    const tiers = o.overrides.flatMap((t) => {
      const r = t && typeof t === "object" ? (t as Record<string, unknown>) : {};
      const min = dollars(r.min_prompt_tokens);
      if (min === undefined) return [];
      return [{ min, prompt: dollars(r.prompt), completion: dollars(r.completion), cacheRead: dollars(r.input_cache_read) }];
    });
    if (tiers.length) price.tiers = tiers;
  }
  return price;
}

/**
 * Every model's price, from OpenRouter's public model list, fetched once
 * (no key: the list is public). Null when it cannot be had, and then every
 * cost shows "?" rather than a guess.
 */
export async function fetchPrices(fetchImpl: typeof fetch = fetch): Promise<Map<string, Price> | null> {
  try {
    const res = await fetchImpl(MODELS_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Array<{ id?: unknown; pricing?: unknown }> };
    const prices = new Map<string, Price>();
    for (const m of body.data ?? []) {
      const price = readPrice(m.pricing);
      if (typeof m.id === "string" && price) prices.set(m.id, price);
    }
    return prices.size ? prices : null;
  } catch {
    return null;
  }
}

/**
 * One call's cost in dollars: the prompt at its price, the part of it read
 * from the provider's cache at the cache's, and the answer at the
 * completion price, at the tier the prompt's length reaches. The picture is
 * in the prompt tokens, and the thinking in the completion tokens, as
 * OpenRouter counts them, so neither is added again. Null without a price or
 * the usage.
 */
export function costOf(
  price: Price | undefined,
  usage: Pick<CallRecord, "promptTokens" | "completionTokens" | "cachedTokens">,
): number | null {
  const { promptTokens, completionTokens } = usage;
  if (!price || promptTokens === undefined || completionTokens === undefined) return null;
  const tier = (price.tiers ?? []).filter((t) => promptTokens >= t.min).sort((a, b) => b.min - a.min)[0];
  const prompt = tier?.prompt ?? price.prompt;
  const completion = tier?.completion ?? price.completion;
  const cacheRead = tier?.cacheRead ?? price.cacheRead ?? prompt;
  const cached = Math.min(Math.max(0, usage.cachedTokens ?? 0), promptTokens);
  return (promptTokens - cached) * prompt + cached * cacheRead + completionTokens * completion + (price.request ?? 0);
}

// ---- one run ---------------------------------------------------------------------

/** What one run measured. Times are milliseconds from the call. */
export interface Run {
  model: string;
  ok: boolean;
  /** The first byte of the answer's text. */
  firstMs?: number;
  /** The first whole SAY line: the first sentence the person sees. */
  sayMs?: number;
  totalMs?: number;
  /** That sentence, whole; it is cut when printed. */
  say?: string;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  cachedTokens?: number;
  /** OpenRouter's provider for the call, and its model when it named another. */
  servedBy?: string;
  /** Dollars; null when the price is not known. */
  cost?: number | null;
  draws: number;
  drawsDropped: number;
  /** Why it failed, for a run that did. */
  error?: string;
}

/** A short chat screen around the picture, as the desktop sends one. */
export const SCREEN: AgentElement[] = [
  { id: "e1", role: "button", label: "Huddle", region: "tr" },
  { id: "e2", role: "button", label: "Search", region: "t" },
  { id: "e3", role: "link", label: "# homework-help", region: "l" },
  { id: "e4", role: "text", label: "Meera 9:24 AM", region: "c" },
  { id: "e5", role: "text", label: "My kid's homework, anyone?", region: "c" },
  { id: "e6", role: "image", label: "worksheet.jpg", region: "c" },
  { id: "e7", role: "area", label: "Message #homework-help", region: "b" },
  { id: "e8", role: "button", label: "Send", region: "br" },
  { id: "o1", role: "text", label: "a² + b² = c²", region: "c" },
  { id: "o2", role: "text", label: "c = ?", region: "c" },
];
export const QUESTION = "explain this triangle";

export function pictureRequest(): AgentStepRequest {
  return {
    runId: "time_vision", step: 0, platform: "mac", app: "Slack", utterance: QUESTION,
    picture: { region: "element" }, screen: { elements: SCREEN },
  };
}

export interface MeasureDeps {
  /** planStream, unless a test gives its own. */
  plan?: (system: SystemPrompt, user: UserPrompt, opts: PlanOptions) => AsyncIterable<PlanChunk>;
  now?: () => number;
  /** "" for no provider preference. */
  providerSort: string;
  drawMax: number;
  prices: Map<string, Price> | null;
  /** Taken out of anything printed, in case an error ever carries it. */
  secret?: string;
}

/** An error as one short line: its status and message, and never the key. */
function describe(err: unknown, secret?: string): string {
  const e = err instanceof PlannerUnavailable ? err.causeError : err;
  const status = (e as { status?: unknown })?.status;
  const message = String((e as { message?: unknown })?.message ?? e).replace(/\s+/g, " ").trim();
  let line = typeof status === "number" && !message.startsWith(String(status)) ? `${status} ${message}` : message;
  if (secret) line = line.split(secret).join("…");
  return line.slice(0, 200);
}

/** One picture question to one model, timed. Never throws. */
export async function measure(model: string, deps: MeasureDeps): Promise<Run> {
  const now = deps.now ?? (() => performance.now());
  const plan = deps.plan ?? planStream;
  const req = pictureRequest();
  const image = { mime: PICTURE_MIME, data: Buffer.from(PICTURE_BASE64, "base64") };
  // Built for each model the ladder reaches, as the product builds it: places in the picture in that model's order.
  const user = (m: string) => agentPictureContent(req, QUESTION, image, drawOrderFor(m));
  // The answer is read as the server reads it: each line in this model's
  // order, through the picture path's reader, so the marks counted are the
  // marks the device would have drawn.
  const reader = new LineReader(new Set(SCREEN.map((e) => e.id)), "show", { picture: true, draws: deps.drawMax });
  const splitter = new LineSplitter();
  const order = drawOrderFor(model);
  const run: Run = { model, ok: false, draws: 0, drawsDropped: 0 };
  let call: CallRecord | undefined;

  const t0 = now();
  const read = (raw: string) => {
    const line = parseLine(raw, req.platform, { order });
    if (!line) return;
    for (const out of reader.read(line)) {
      if ("emit" in out && out.emit.t === "say" && run.sayMs === undefined) {
        run.sayMs = now() - t0;
        run.say = out.emit.text;
      }
    }
  };
  try {
    const stream = plan(stableBlock("ask_vision"), user, {
      models: [model],
      picture: { deep: false },
      timeoutMs: MEASURE_TIMEOUT_MS,
      providerSort: deps.providerSort,
      log: (c) => { call = c; },
    });
    for await (const chunk of stream) {
      run.firstMs ??= now() - t0;
      for (const raw of splitter.push(chunk.delta)) read(raw);
    }
    for (const raw of splitter.flush()) read(raw);
  } catch (err) {
    run.error = describe(err, deps.secret);
  }
  run.totalMs = now() - t0;
  run.draws = reader.draws;
  run.drawsDropped = reader.drawsDropped;

  if (call) {
    run.promptTokens = call.promptTokens;
    run.completionTokens = call.completionTokens;
    run.reasoningTokens = call.reasoningTokens;
    run.cachedTokens = call.cachedTokens;
    const servedBy = [call.provider, call.served].filter(Boolean).join(", ");
    if (servedBy) run.servedBy = servedBy;
    run.cost = costOf(deps.prices?.get(model), call);
    if (!run.error && call.outcome !== "ok") {
      run.error = call.outcome === "empty" ? "answered with nothing"
        : call.outcome === "timeout" ? `stopped: nothing for ${MEASURE_TIMEOUT_MS / 1000} s`
        : `stopped part way (${call.outcome}${call.status ? ` ${call.status}` : ""})`;
    }
  }
  run.ok = !run.error && call?.outcome === "ok";
  if (!run.ok && !run.error) run.error = "no answer";
  return run;
}

// ---- the table -------------------------------------------------------------------

/** The middle value; for an even count, halfway between the middle two. */
export function median(xs: Array<number | undefined | null>): number | null {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

export function worst(xs: Array<number | undefined | null>): number | null {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? Math.max(...v) : null;
}

export interface Summary {
  model: string;
  ok: number;
  runs: number;
  first: { median: number | null; worst: number | null };
  say: { median: number | null; worst: number | null };
  total: { median: number | null; worst: number | null };
  cost: { median: number | null; worst: number | null };
  /** The mean cost of an answered run, times 1,000; null when unknown. */
  per1000: number | null;
  /** The first sentence of the first answered run. */
  firstSay?: string;
}

/** A model's runs, summed up over the ones that answered. A failed run has
 *  no time to its first sentence, and counting it as fast would flatter. */
export function summarize(model: string, runs: Run[]): Summary {
  const ok = runs.filter((r) => r.ok);
  const both = (pick: (r: Run) => number | undefined | null) => ({ median: median(ok.map(pick)), worst: worst(ok.map(pick)) });
  const costs = ok.map((r) => r.cost);
  const known = costs.every((c): c is number => typeof c === "number");
  return {
    model, ok: ok.length, runs: runs.length,
    first: both((r) => r.firstMs),
    say: both((r) => r.sayMs),
    total: both((r) => r.totalMs),
    cost: both((r) => r.cost),
    per1000: ok.length && known ? (costs as number[]).reduce((a, b) => a + b, 0) / ok.length * 1000 : null,
    firstSay: ok.find((r) => r.say)?.say,
  };
}

const sec = (ms: number | null | undefined) => (typeof ms === "number" ? `${(ms / 1000).toFixed(2)} s` : "-");
const usd = (d: number | null | undefined, places: number) => (typeof d === "number" ? `$${d.toFixed(places)}` : "?");
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Column widths, so every row of a model's table lines up: the run's
 *  label and the marks to the left, the numbers to the right. */
const COLS = [6, 10, 14, 7, 13, 8, 8, 5] as const;
const row = (cells: string[], tail = "") => {
  const line = "  " + cells.map((c, i) => (i === 0 || i === 7 ? c.padEnd(COLS[i]!) : c.padStart(COLS[i]!))).join("  ");
  return `${line}  ${tail}`.trimEnd();
};

export function tableHead(model: string, providerSort: string): string[] {
  return [
    `${model}, ${providerSort ? `providers sorted by ${providerSort}` : "OpenRouter's default routing"}`,
    row(["run", "first byte", "first sentence", "done", "tokens in/out", "thinking", "cost", "marks"], "served by"),
  ];
}

export function runRow(n: number, r: Run): string {
  if (!r.ok) return `  ${String(n).padStart(3).padEnd(COLS[0])}  failed: ${r.error ?? "no answer"}`;
  const tokens = r.promptTokens !== undefined ? `${r.promptTokens}/${r.completionTokens ?? "?"}` : "?";
  return row([
    String(n).padStart(3), sec(r.firstMs), sec(r.sayMs), sec(r.totalMs), tokens,
    r.reasoningTokens !== undefined ? String(r.reasoningTokens) : "-", usd(r.cost, 5), `${r.draws}/${r.drawsDropped}`,
  ], r.servedBy ?? "");
}

/** The median and worst rows under a model's runs, and its first sentence.
 *  `serverTimeoutMs`: runs slower than this to start would have gone to the
 *  next model on the server, which is worth saying. */
export function tableFoot(runs: Run[], serverTimeoutMs?: number): string[] {
  const s = summarize(runs[0]?.model ?? "", runs);
  if (!s.ok) return [`  none of ${s.runs} answered`];
  const lines = [
    row(["median", sec(s.first.median), sec(s.say.median), sec(s.total.median), "", "", usd(s.cost.median, 5), ""]),
    row(["worst", sec(s.first.worst), sec(s.say.worst), sec(s.total.worst), "", "", usd(s.cost.worst, 5), ""]),
  ];
  if (s.ok < s.runs) lines.push(`  ${s.ok} of ${s.runs} answered`);
  const late = serverTimeoutMs ? runs.filter((r) => r.ok && (r.firstMs ?? 0) > serverTimeoutMs).length : 0;
  if (late) lines.push(`  ${late} of ${s.runs} started later than AGENT_VISION_TIMEOUT_MS (${sec(serverTimeoutMs)}): the server would have gone to the next model`);
  if (s.firstSay) lines.push(`  first sentence: "${cut(s.firstSay, SAY_SHOWN)}"`);
  return lines;
}

/** The two lines at the end: the fastest model, and what each costs. */
export function closing(results: Map<string, Run[]>): string[] {
  const all = [...results].map(([model, runs]) => summarize(model, runs));
  const fastest = all.filter((s) => s.say.median !== null).sort((a, b) => a.say.median! - b.say.median!)[0];
  return [
    fastest
      ? `Fastest to its first sentence: ${fastest.model}, ${sec(fastest.say.median)} median, ${sec(fastest.say.worst)} at worst. Under about 1.5 s feels instant.`
      : "Fastest to its first sentence: none of them answered.",
    `Cost per 1,000 picture questions: ${all.map((s) => `${s.model} ${usd(s.per1000, 2)}`).join(", ")}.`,
  ];
}

// ---- main ------------------------------------------------------------------------

export interface MainDeps {
  fetch?: typeof fetch;
  plan?: MeasureDeps["plan"];
  now?: () => number;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

/** The whole run. Returns the exit code: 2 for a usage error, else 0, even
 *  when every model failed (each says why). */
export async function main(argv: string[], deps: MainDeps = {}): Promise<number> {
  const out = deps.out ?? ((l: string) => console.log(l));
  const err = deps.err ?? ((l: string) => console.error(l));
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    err(parsed.error);
    err(USAGE);
    return 2;
  }
  const { options } = parsed;
  if (options.help) {
    out(USAGE);
    return 0;
  }

  let cfg: ReturnType<typeof getConfig>;
  try {
    cfg = getConfig();
  } catch (e) {
    // Which variables are missing, never their values.
    err(String((e as Error).message ?? e).split("\n\n")[0]!);
    err("Run it where the server's settings are: inside the backend container, or with tulmi/.env.");
    return 2;
  }
  const serverModels = [cfg.AGENT_VISION_MODEL, ...cfg.AGENT_VISION_FALLBACK_MODELS.split(",")].map((m) => m.trim()).filter(Boolean);
  const defaults = [...serverModels, ...COMPARE_MODELS];
  const models = options.models.length ? options.models : defaults.filter((m, i) => defaults.indexOf(m) === i);
  // What plannerRequest will really send, so the table's heading says so:
  // a setting OpenRouter would not understand is sent as no preference.
  const providerSort = providerSortOf(options.route === undefined ? cfg.AGENT_VISION_PROVIDER_SORT : options.route);

  const prices = await fetchPrices(deps.fetch);
  out(`Picture question timing: "${QUESTION}", ${options.runs} run${options.runs === 1 ? "" : "s"} per model, one at a time${prices ? "" : " (OpenRouter's prices could not be fetched, so costs show ?)"}.`);

  const results = new Map<string, Run[]>();
  for (const model of models) {
    out("");
    for (const l of tableHead(model, providerSort)) out(l);
    const runs: Run[] = [];
    for (let i = 0; i < options.runs; i++) {
      const r = await measure(model, {
        plan: deps.plan, now: deps.now, providerSort, drawMax: cfg.AGENT_DRAW_MAX, prices, secret: cfg.OPENROUTER_API_KEY,
      });
      runs.push(r);
      out(runRow(i + 1, r));
    }
    for (const l of tableFoot(runs, cfg.AGENT_VISION_TIMEOUT_MS)) out(l);
    results.set(model, runs);
  }
  out("");
  for (const l of closing(results)) out(l);
  return 0;
}

/** Run when it is the script node was given, not when a test imports it. */
function invokedDirectly(): boolean {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return realpathSync(resolve(arg)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => { console.error(e); process.exit(1); },
  );
}
