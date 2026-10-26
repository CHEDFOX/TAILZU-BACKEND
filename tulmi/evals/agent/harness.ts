/**
 * ONE TRIAL OF ONE TASK, THROUGH THE PHONE'S REAL ASK.
 *
 * The bench drives the path a person's phone drives, in process, end to end:
 * POST /v1/assistant/ask (routes/assistant.ts), runCommand and the planner's
 * rounds (agent/run.ts), the router and the tool cards, the native connectors
 * and the hand-offs (src/connectors), the confirm card, GET /v1/tasks and the
 * approve and deny routes (routes/connectors.ts). Only three things are the
 * bench's: the planner (a ModelAdapter: scripted, replayed or live), Google
 * (worlds/google.ts, behind the connectors' own fetch) and the person
 * (worlds/user.ts). The clock is frozen at the task's Monday morning in India
 * (clock.ts) for the length of the trial.
 *
 * A trial, in order:
 *   1. the clock, the world, a fresh in-memory store with the task's apps
 *      connected (as the person's own sign-in would leave them), and a
 *      Fastify app with the two route modules, given nothing but what they
 *      need: the rest (the run ledger, the stuck-task sweeper) is left to its
 *      default, so the bench measures what ships.
 *   2. their words go to Ask, as the phone sends them;
 *   3. a hand-off opened is recorded; a card is read from the task list,
 *      shown to the person, and answered (the world marks what happens then
 *      as done on their yes); a question is answered with the person's next
 *      words, five seconds later, up to the route's chain of three;
 *   4. the app is closed, the clock given back, and the trace returned.
 *
 * Who asked a question: the run's receipt says so when the server sends one
 * (outcome needs_you, reason question). Without one (a server from before
 * receipts), a reply is taken as a question when the planner wrote an ASK,
 * when it ends in a question mark, or when the person has an answer waiting
 * for words like it.
 *
 * Each trial is its own person (env.ts), so nothing one trial leaves behind
 * can be read by the next. One trial at a time per process: the clock is one.
 *
 * A turn's `ms` is the request, start to answer; when the turn ended on a
 * card, the time the approve or deny route took is added to it, since that is
 * still the person waiting. Replay adds each call's recorded time. Both, and
 * the time to the first planner chunk, are measured here on the machine's
 * monotonic clock (performance.now): a time the server takes with Date.now()
 * during a trial reads the frozen clock, so a receipt's own firstMs is used
 * only when the bench saw no planner call to time.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { resolveUser } from "../../src/auth/supabase.js";
import { ALWAYS_ON, CATALOG } from "../../src/connectors/catalog.js";
import { encrypt } from "../../src/connectors/crypto.js";
import { createConnectors } from "../../src/connectors/index.js";
import { MemoryConnectorStore } from "../../src/connectors/store.js";
import { registerAssistantRoutes } from "../../src/routes/assistant.js";
import { registerConnectorRoutes } from "../../src/routes/connectors.js";
import { installClock } from "./clock.js";
import type { ModelAdapter } from "./model/adapter.js";
import { BENCH_NOW, BENCH_TZ_OFFSET_MINUTES, type ApprovalTrace, type Mode, type ReceiptLike, type Task, type Trace, type TurnTrace } from "./types.js";
import { GoogleWorld } from "./worlds/google.js";
import { ScriptedUser } from "./worlds/user.js";

/** The route chains three questions back; the answer to the third is the fourth turn. */
export const MAX_TURNS = 4;
/** Between a question and its answer. */
const ANSWER_MS = 5_000;
/** The trial's apps sign in to Google with this client; the bench's Google never checks it. */
const GOOGLE_CLIENT = { clientId: "roz-bench.apps.googleusercontent.com", clientSecret: "roz-bench" };
const REDIRECT = "https://bench.tailzu.invalid/v1/connectors/callback";
const RATE = { rateLimit: { max: 10_000, timeWindow: 60_000 } };
/** How long a trial waits for its streams to be read to the end: a live call's whole timeout. */
const SETTLE_MS = { scripted: 2_000, replay: 2_000, live: 30_000 } as const;

export interface TrialOptions {
  task: Task;
  trial: number;
  mode: Mode;
  model: ModelAdapter;
  /** A static bearer token (env.ts) no other trial in this process has used. */
  token: string;
}

export async function runTrial(o: TrialOptions): Promise<Trace> {
  const { task, model } = o;
  const trace: Trace = {
    taskId: task.id, trial: o.trial, mode: o.mode, turns: [], calls: model.calls, approvals: [], opened: [],
    world: { mutations: [], unknownRoutes: [] },
  };
  const { clock, restore } = installClock(task.now ?? BENCH_NOW);
  let app: FastifyInstance | undefined;
  try {
    const world = new GoogleWorld(task.world, clock);
    trace.world = { mutations: world.mutations, unknownRoutes: world.unknownRoutes };
    // A token not on the list goes on to Supabase, which the bench's config has no key for: either way it is the bench's mistake.
    const user = await resolveUser(`Bearer ${o.token}`).catch(() => null);
    if (!user) throw new Error("The bench's token was not accepted: STATIC_BEARER_TOKENS must hold it before the config is first read (env.ts benchEnv).");

    const store = new MemoryConnectorStore();
    for (const c of task.world.connected ?? []) {
      const def = CATALOG.find((d) => d.id === c.app);
      if (!def) throw new Error(`No ${c.app} in the catalog.`);
      await store.upsertConnection(user.id, c.app, {
        level: c.level ?? "send", autoOk: [...(c.auto ?? [])],
        tokensEnc: encrypt(JSON.stringify({ access_token: `at-${c.app}`, refresh_token: `rt-${c.app}`, expires_at: clock.now() + 3_600_000, scope: (def.scopes ?? []).join(" ") })),
      });
    }
    const connectors = createConnectors({
      store, catalog: [...CATALOG.filter((d) => d.provider === "google"), ...ALWAYS_ON], google: GOOGLE_CLIENT,
      fetchFn: world.fetch, now: clock.now, notes: world.notes, youtubeKey: null, redirectUrl: REDIRECT,
    });

    app = Fastify();
    const lang = task.lang;
    registerAssistantRoutes(app, { rateLimit: RATE, connectors, plan: model.plan, profileLanguage: async () => lang, now: clock.now });
    registerConnectorRoutes(app, { rateLimit: RATE, connectors });
    await app.ready();

    await converse({ app, task, model, world, clock, trace, token: o.token, settleMs: SETTLE_MS[o.mode] });
    if (!model.skip && world.unknownRoutes.length) {
      trace.error = `The bench's Google has no route for: ${[...new Set(world.unknownRoutes)].join("; ")}`;
    }
  } catch (err) {
    trace.error = err instanceof Error ? err.message : String(err);
  } finally {
    await model.settled(SETTLE_MS[o.mode]).catch(() => {});
    await app?.close().catch(() => {});
    restore();
  }
  if (model.skip) {
    trace.skipped = model.skip;
    delete trace.error;
  }
  return trace;
}

async function converse(c: {
  app: FastifyInstance; task: Task; model: ModelAdapter; world: GoogleWorld; clock: { advance(ms: number): void };
  trace: Trace; token: string; settleMs: number;
}): Promise<void> {
  const { app, task, model, world, trace } = c;
  const person = new ScriptedUser(task.user, task.expect);
  const headers = { authorization: `Bearer ${c.token}` };
  let said = task.said;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    world.phase = { kind: "turn", turn };
    model.turn = turn;
    const before = model.calls.length;
    const t0 = performance.now();
    const res = await app.inject({
      method: "POST", url: "/v1/assistant/ask", headers: { ...headers, "x-app-language": task.lang },
      payload: { text: said, platform: task.platform ?? "android", tzOffsetMinutes: BENCH_TZ_OFFSET_MINUTES },
    });
    let ms = performance.now() - t0;
    // The run reads the rest of each stream after it answers: wait, so the turn's calls are whole.
    await model.settled(c.settleMs);
    if (model.skip) return;
    const response = responseOf(res.body);
    const calls = model.calls.slice(before);
    const modelAsked = calls.some((x) => /^\s*ASK\s/m.test(x.text));
    if (model.recordedLatency) ms += calls.reduce((n, x) => n + (x.ms ?? 0), 0);
    // The bench's own measure first: during a trial Date.now() is the frozen clock, so a time the server took with it reads zero.
    const firstMs = firstChunkMs(model, before, t0) ?? response.receipt?.firstMs;
    if (response.open) trace.opened.push(response.open.url);

    if (response.taskId) {
      const t1 = performance.now();
      const answered = await answerCard(app, headers, response.taskId, person, world, turn);
      ms += performance.now() - t1;
      world.phase = { kind: "turn", turn };
      if (answered) trace.approvals.push(answered);
    }

    const say = response.say ?? "";
    const asked = res.statusCode === 200 && (response.receipt
      ? response.receipt.outcome === "needs_you" && response.receipt.reason === "question"
      : !response.open && !response.taskId && (modelAsked || /[?？]\s*$/.test(say) || person.expects(say)));
    const turnTrace: TurnTrace = {
      said, status: res.statusCode, response, ms: Math.round(ms), asked, modelAsked,
      ...(firstMs !== undefined ? { firstMs: Math.round(firstMs) } : {}),
    };
    trace.turns.push(turnTrace);
    if (!asked) return;
    const answer = person.answer(say);
    if (answer === null) return;
    c.clock.advance(ANSWER_MS);
    said = answer;
  }
}

/** From the request's start to the first chunk of the turn's first planner call (plus its recorded wait, in replay). */
function firstChunkMs(model: ModelAdapter, index: number, t0: number): number | undefined {
  const t = model.timing[index];
  if (!t?.firstAt) return undefined;
  return t.firstAt - t0 + (model.recordedLatency ? (model.calls[index]?.firstMs ?? 0) : 0);
}

/** The card the turn ended on, read as the phone reads it, and the person's answer to it. */
async function answerCard(
  app: FastifyInstance, headers: Record<string, string>, taskId: string, person: ScriptedUser, world: GoogleWorld, turn: number,
): Promise<ApprovalTrace | null> {
  const list = await app.inject({ method: "GET", url: "/v1/tasks", headers });
  const tasks = (parse(list.body) as { tasks?: Array<{ id?: string; approval?: { id?: string; connector?: string; preview?: string } | null }> })?.tasks ?? [];
  const card = tasks.find((t) => t.id === taskId)?.approval;
  if (!card) return null;
  const preview = card.preview ?? "";
  const appId = card.connector ?? "";
  const decision = person.decide({ preview, app: appId });
  world.phase = { kind: "approval", taskId };
  const r = await app.inject({
    method: "POST", url: `/v1/tasks/${encodeURIComponent(taskId)}/${decision}`, headers,
    payload: decision === "approve" && card.id ? { approvalId: card.id } : {},
  });
  const ok = (parse(r.body) as { ok?: unknown } | null)?.ok;
  return { turn, taskId, app: appId, preview, decision, status: r.statusCode, ...(typeof ok === "boolean" ? { ok } : {}) };
}

function parse(body: string): unknown {
  try { return JSON.parse(body); } catch { return null; }
}

/** The phone's answer, read for the fields it has: { say, open?, taskId?, receipt? }. */
export function responseOf(body: string): TurnTrace["response"] {
  const b = parse(body);
  if (!b || typeof b !== "object") return {};
  const r = b as Record<string, unknown>;
  const out: TurnTrace["response"] = {};
  if (typeof r.say === "string") out.say = r.say;
  const open = r.open as Record<string, unknown> | undefined;
  if (open && typeof open.url === "string") {
    out.open = { url: open.url, label: typeof open.label === "string" ? open.label : "", ...(typeof open.fallback === "string" ? { fallback: open.fallback } : {}) };
  }
  if (typeof r.taskId === "string") out.taskId = r.taskId;
  if (r.receipt && typeof r.receipt === "object") out.receipt = receiptOf(r.receipt as Record<string, unknown>);
  return out;
}

/** A receipt read structurally, so the bench works before and after receipts exist. */
function receiptOf(r: Record<string, unknown>): ReceiptLike {
  return {
    ...(typeof r.outcome === "string" ? { outcome: r.outcome } : {}),
    ...(typeof r.reason === "string" ? { reason: r.reason } : {}),
    ...(typeof r.effects === "number" ? { effects: r.effects } : {}),
    ...(typeof r.firstMs === "number" ? { firstMs: r.firstMs } : {}),
    ...(typeof r.ms === "number" ? { ms: r.ms } : {}),
    ...(typeof r.taskId === "string" ? { taskId: r.taskId } : {}),
  };
}
