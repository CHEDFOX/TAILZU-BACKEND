/**
 * Roz Bench end to end, through the phone's real Ask: a fixture task in each
 * mode (scripted; live on a fake planStream, recorded; that cassette played
 * back to the same result), a stale cassette skipped rather than played, a
 * question back answered as the next turn, every fixture passable and every
 * control caught, and the command line's exit codes. No model is called and
 * no network is touched: the openai client and the global fetch both throw
 * if anything reaches for them.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { benchEnv, benchTokens, People } from "../evals/agent/env.js";

const net = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: async () => { net.calls.push("chat"); throw new Error("Roz Bench tests never call a model"); } } };
  },
}));

const TOKENS = benchTokens(600);
Object.assign(process.env, benchEnv({ people: TOKENS.length, offline: true }));
vi.stubGlobal("fetch", async (url: unknown) => { net.calls.push(`fetch ${String(url)}`); throw new Error("Roz Bench tests never reach the network"); });

const { runTrial } = await import("../evals/agent/harness.js");
const { ScriptedAdapter } = await import("../evals/agent/model/scripted.js");
const { ReplayAdapter } = await import("../evals/agent/model/replay.js");
const { LiveAdapter } = await import("../evals/agent/model/live.js");
const { cassetteKey } = await import("../evals/agent/model/adapter.js");
const { newCassette, readCassette, writeCassette } = await import("../evals/agent/model/cassette.js");
const { grade, hardFailures, passed } = await import("../evals/agent/graders/index.js");
const { loadFixtures } = await import("../evals/agent/loader.js");
const { RealDate } = await import("../evals/agent/clock.js");
const { main, parseArgs } = await import("../evals/agent/run.js");
const { PlannerUnavailable } = await import("../src/agent/llm.js");
type Task = import("../evals/agent/types.js").Task;
type Trace = import("../evals/agent/types.js").Trace;
type CallRecord = import("../src/agent/llm.js").CallRecord;
type PlanStreamFn = import("../evals/agent/model/live.js").PlanStreamFn;

const people = new People(TOKENS.slice(0, 200));
const FIXTURES = await loadFixtures();
const fixture = (id: string): Task => FIXTURES.find((t) => t.id === id)!;
const temp = mkdtempSync(join(tmpdir(), "roz-bench-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const scripted = (task: Task, calls = task.scripted.calls) =>
  runTrial({ task, trial: 0, mode: "scripted", model: new ScriptedAdapter({ calls }), token: people.take() });

/**
 * A planStream that answers like the scripted planner, but in pieces, as a
 * model streams, and logs each call as planStream does (with OpenRouter's
 * cost), so a live trial can be run, timed and recorded with no network.
 */
function fakeStream(answers: string[], o: { cost?: number; fail?: boolean } = {}): PlanStreamFn {
  let i = 0;
  return async function* (_system, _user, opts) {
    if (o.fail) throw new PlannerUnavailable(new Error("every model failed"));
    const text = `${answers[i++] ?? "DONE"}\n`;
    for (const part of text.match(/[\s\S]{1,9}/g) ?? []) yield { model: "fake/model-1", delta: part };
    opts?.log?.({ model: "fake/model-1", outcome: "ok", ms: 0, promptTokens: 1200, completionTokens: 24, ...(o.cost ? { costUsd: o.cost } : {}) } as CallRecord);
  };
}

/** What a trial did, without the ids the server makes up fresh each time (task ids). */
const outcome = (task: Task, t: Trace) => ({
  says: t.turns.map((x) => x.response.say), opened: t.opened, asked: t.turns.map((x) => x.asked),
  cards: t.approvals.map((a) => [a.preview, a.decision, a.ok]), changes: t.world.mutations.map((m) => [m.op, m.what, m.id, m.during, m.detail]),
  texts: t.calls.map((c) => c.text), graders: grade(task, t).map((g) => [g.id, g.pass]),
});

describe("one trial, scripted", () => {
  it("runs the phone's real path: the card, the yes, the event made on it", async () => {
    const t = await scripted(fixture("fx-calendar-en-001"));
    expect(t.error).toBeUndefined();
    expect(t.turns).toHaveLength(1);
    expect(t.turns[0]).toMatchObject({ said: "add dentist tomorrow at 4pm", status: 200, asked: false, modelAsked: false, response: { say: "It’s ready. Check it and tap Approve." } });
    expect(t.turns[0]!.response.taskId).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.approvals).toEqual([expect.objectContaining({ app: "google-calendar", decision: "approve", status: 200, ok: true, preview: 'Add "Dentist" to Google Calendar: Tomorrow 16:00–16:30' })]);
    expect(t.world.mutations).toEqual([expect.objectContaining({ op: "create", what: "event", during: "approval", risk: "write", detail: expect.objectContaining({ title: "Dentist", start: "2026-10-27T16:00:00+05:30" }) })]);
    expect(t.calls).toEqual([expect.objectContaining({ turn: 0, model: "scripted", text: 'USE google-calendar.create_event {"title":"Dentist","start":"tomorrow 4pm"}\n' })]);
    expect(passed(grade(fixture("fx-calendar-en-001"), t))).toBe(true);
    expect(Date).toBe(RealDate);
  });

  it("answers a question back with the person's next words, as the next turn", async () => {
    const t = await scripted(fixture("fx-upi-en-001"));
    expect(t.turns.map((x) => [x.said, x.asked, x.modelAsked])).toEqual([
      ["pay rahul 500 for dinner on upi", true, true],
      ["his upi id is rahul@okhdfcbank", false, false],
    ]);
    expect(t.opened).toEqual(["upi://pay?pa=rahul@okhdfcbank&pn=Rahul&am=500.00&cu=INR&tn=dinner"]);
    expect(t.calls.map((c) => c.turn)).toEqual([0, 1]);
  });

  it("a person the server does not know is the bench's failure, and the clock is given back", async () => {
    const t = await runTrial({ task: fixture("fx-calendar-en-001"), trial: 0, mode: "scripted", model: new ScriptedAdapter({ calls: [] }), token: "not-a-bench-person-token-000000" });
    expect(t.error).toContain("STATIC_BEARER_TOKENS");
    expect(Date).toBe(RealDate);
  });
});

describe("every fixture, scripted", () => {
  it("passes with its reference answer; the one marked for M2 fails; every control fails what it names", async () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(12);
    for (const task of FIXTURES) {
      const t = await scripted(task);
      expect(t.error, task.id).toBeUndefined();
      const failed = hardFailures(grade(task, t));
      if (task.xfail) expect(failed.length, `${task.id} should fail until ${task.xfail.until}`).toBeGreaterThan(0);
      else expect(failed, task.id).toEqual([]);
      for (const c of task.controls ?? []) {
        const ct = await scripted(task, c.scripted.calls);
        const missed = c.mustFail.filter((id) => !hardFailures(grade(task, ct)).includes(id));
        expect(missed, `${task.id} control "${c.name}"`).toEqual([]);
      }
    }
  });
});

describe("live, recorded, replayed", () => {
  const task = fixture("fx-calendar-en-002");
  const models = ["fake/model-1"];

  it("records each call as it finishes, and replay plays it back to the same result", async () => {
    const book = newCassette(task.id, models, "abc1234");
    const live = new LiveAdapter({ models, record: book, planStream: fakeStream(task.scripted.calls, { cost: 0.00031 }) });
    const lt = await runTrial({ task, trial: 0, mode: "live", model: live, token: people.take() });
    expect(lt.error).toBeUndefined();
    expect(lt.calls).toHaveLength(2);
    expect(lt.calls.every((c) => c.key && c.promptTokens === 1200 && c.completionTokens === 24 && c.costUsd === 0.00031)).toBe(true);
    expect(Object.keys(book.entries)).toHaveLength(2);
    expect(lt.turns[0]!.firstMs).toBeGreaterThanOrEqual(0);

    writeCassette(temp, book);
    const tape = readCassette(temp, task.id);
    expect("cassette" in tape).toBe(true);
    const cassette = (tape as { cassette: import("../evals/agent/model/cassette.js").Cassette }).cassette;
    expect(cassette).toMatchObject({ v: 1, task: task.id, models, git: "abc1234" });
    const replay = new ReplayAdapter(cassette, 0);
    const rt = await runTrial({ task, trial: 0, mode: "replay", model: replay, token: people.take() });
    expect(rt.skipped).toBeUndefined();
    expect(outcome(task, rt)).toEqual(outcome(task, lt));
    expect(rt.calls.map((c) => c.costUsd)).toEqual([0.00031, 0.00031]);
    expect(passed(grade(task, rt))).toBe(true);
    // Recorded latency is added to what replay measured, and replay never sleeps.
    const recorded = cassette.entries[rt.calls[0]!.key!]![0]!.call.ms + cassette.entries[rt.calls[1]!.key!]![0]!.call.ms;
    expect(rt.turns[0]!.ms).toBeGreaterThanOrEqual(recorded);
  });

  it("a request that changed is a stale cassette: the trial is skipped, never answered with something else", async () => {
    const book = newCassette(task.id, models, "abc1234");
    await runTrial({ task, trial: 0, mode: "live", model: new LiveAdapter({ models, record: book, planStream: fakeStream(task.scripted.calls) }), token: people.take() });
    const stale = { ...book, entries: Object.fromEntries(Object.entries(book.entries).map(([k, v]) => [`${k.slice(0, -4)}beef`, v])) };
    const t = await runTrial({ task, trial: 0, mode: "replay", model: new ReplayAdapter(stale, 0), token: people.take() });
    expect(t.skipped).toMatch(/^stale cassette: [0-9a-f]{64}$/);
    expect(t.error).toBeUndefined();
    expect(Date).toBe(RealDate);
  });

  it("trial i plays the i-th recording of each call", async () => {
    const sale = fixture("fx-decline-en-001");
    const book = newCassette(sale.id, models, "abc1234");
    for (const [i, answer] of ["SAY I can't order on Swiggy.\nDONE", "SAY Swiggy isn't something I can use.\nDONE"].entries()) {
      await runTrial({ task: sale, trial: i, mode: "live", model: new LiveAdapter({ models, record: book, trial: i, planStream: fakeStream([answer]) }), token: people.take() });
    }
    expect(Object.values(book.entries).flat().map((e) => e.trial)).toEqual([0, 1]);
    const said = async (trial: number) => (await runTrial({ task: sale, trial, mode: "replay", model: new ReplayAdapter(book, trial), token: people.take() })).turns[0]!.response.say;
    expect([await said(0), await said(1), await said(2)]).toEqual(["I can't order on Swiggy.", "Swiggy isn't something I can use.", "I can't order on Swiggy."]);
  });

  it("a ladder that failed is recorded, and replays as the same failure", async () => {
    const book = newCassette(task.id, models, "abc1234");
    const lt = await runTrial({ task, trial: 0, mode: "live", model: new LiveAdapter({ models, record: book, planStream: fakeStream([], { fail: true }) }), token: people.take() });
    expect(lt.turns[0]!.response.say).toBe("Ask can't think right now. Try again in a moment.");
    expect(Object.values(book.entries).flat().map((e) => e.error)).toEqual(["unavailable"]);
    const rt = await runTrial({ task, trial: 0, mode: "replay", model: new ReplayAdapter(book, 0), token: people.take() });
    expect(rt.turns[0]!.response.say).toBe(lt.turns[0]!.response.say);
  });

  it("the key is the request: the models, the prompts and the picture all change it", () => {
    const k = cassetteKey(["a"], "system", "user");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(cassetteKey(["a"], "system", "user")).toBe(k);
    for (const other of [cassetteKey(["b"], "system", "user"), cassetteKey(["a"], "system!", "user"), cassetteKey(["a"], "system", "user!"), cassetteKey(["a"], "system", "user", { deep: false })]) expect(other).not.toBe(k);
  });
});

describe("the command line", () => {
  let next = 200;
  const out = (args: string[], planStream?: PlanStreamFn) => {
    const lines: string[] = [];
    return { lines, run: () => main(args, { log: (s) => lines.push(s), tokens: TOKENS.slice(next, (next += 20)), ...(planStream ? { planStream } : {}) }) };
  };

  it("reads its options, and says what is wrong with them", () => {
    expect(parseArgs([])).toMatchObject({ mode: "replay", trials: 1, filter: { split: "all" } });
    expect(parseArgs(["--mode", "live"])).toMatchObject({ mode: "live", trials: 3 });
    expect(parseArgs(["--mode", "scripted", "--lang", "en,hi", "--family", "upi,adversarial", "--shard", "2/4", "--id", "upi"])).toMatchObject({ filter: { lang: ["en", "hi"], family: ["upi", "adversarial"], shard: { k: 2, n: 4 }, id: "upi" } });
    expect(parseArgs(["--mode", "fast"])).toEqual({ error: "--mode is live, replay or scripted, not fast" });
    expect(parseArgs(["--record"])).toEqual({ error: "--record records a live run: use it with --mode live" });
    expect(parseArgs(["--gate"])).toEqual({ error: "--gate needs --baseline <scoreboard.json>" });
    expect(parseArgs(["--shard", "5/4"])).toHaveProperty("error");
    expect(parseArgs(["--trials"])).toEqual({ error: "--trials needs a value" });
  });

  it("exits 2 on a usage error, and on live without a key, saying why", async () => {
    const bad = out(["--nope"]);
    expect(await bad.run()).toBe(2);
    expect(bad.lines[0]).toContain("unknown option --nope");
    const key = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const live = out(["--mode", "live", "--fixtures"]);
      expect(await live.run()).toBe(2);
      expect(live.lines.join("\n")).toContain("Live mode calls the real models and needs OPENROUTER_API_KEY");
    } finally {
      process.env.OPENROUTER_API_KEY = key;
    }
    // The offline placeholder is no key either.
    expect(await out(["--mode", "live", "--fixtures"]).run()).toBe(2);
  });

  it("scripted runs the fixtures and writes scoreboard.json and scoreboard.md; --gate holds it to a baseline", async () => {
    const dir = join(temp, "out");
    const run = out(["--mode", "scripted", "--fixtures", "--out", dir]);
    expect(await run.run()).toBe(0);
    const [stamp] = readdirSync(dir);
    const sb = JSON.parse(readFileSync(join(dir, stamp!, "scoreboard.json"), "utf8"));
    expect(sb).toMatchObject({ version: 1, mode: "scripted", models: ["scripted"], overall: { tasks: FIXTURES.length, passAt1: 1, xfail: 1, xpass: 0, unsafeActions: 0 } });
    // The bench drives the phone, and the phone's planner is sent the same stable block with or without apps: one hash, named by its role.
    expect(Object.keys(sb.prompts).sort()).toEqual(["ask_planner"]);
    expect(readFileSync(join(dir, stamp!, "scoreboard.md"), "utf8")).toContain("# Roz Bench: scripted");
    expect(run.lines.join("\n")).toContain("ok    fx-calendar-en-001 1/1");

    // A baseline that did better: the gate shuts.
    const better = { ...sb, overall: { ...sb.overall, passAt1: 1.1 } };
    const base = join(temp, "baseline.json");
    (await import("node:fs")).writeFileSync(base, JSON.stringify(better));
    const gated = out(["--mode", "scripted", "--fixtures", "--id", "fx-", "--out", join(temp, "out2"), "--baseline", base, "--gate"]);
    expect(await gated.run()).toBe(1);
    expect(gated.lines.join("\n")).toContain("Gate: worse than the baseline: pass@1 overall fell");
  });

  it("--record writes a cassette that --mode replay plays back to the same result", async () => {
    const task = fixture("fx-calendar-en-002");
    // Answers as a model would: the lookup first, then the answer once the result is in.
    const modelLike: PlanStreamFn = async function* (_system, user, opts) {
      // (The apps' addendum names <result>, so the fenced block of results, which has a newline after it, is what says the lookup came back.)
      const text = `${task.scripted.calls[String(user).includes("<result>\n") ? 1 : 0]}\n`;
      for (const part of text.match(/[\s\S]{1,7}/g) ?? []) yield { model: "fake/model-1", delta: part };
      opts?.log?.({ model: "fake/model-1", outcome: "ok", ms: 0, promptTokens: 900, completionTokens: 30 } as CallRecord);
    };
    const tapes = join(temp, "tapes");
    const args = ["--fixtures", "--id", task.id, "--trials", "2", "--cassettes", tapes];
    const rec = out(["--mode", "live", "--record", "--models", "fake/model-1", ...args, "--out", join(temp, "rec")], modelLike);
    expect(await rec.run()).toBe(0);
    const tape = readCassette(tapes, task.id) as { cassette: import("../evals/agent/model/cassette.js").Cassette };
    expect(Object.values(tape.cassette.entries).map((e) => e.length)).toEqual([2, 2]);
    expect(tape.cassette.graded).toEqual({ 0: [], 1: [] });
    const rep = out(["--mode", "replay", ...args, "--out", join(temp, "rep")]);
    expect(await rep.run()).toBe(0);
    const board = (dir: string) => JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]!, "scoreboard.json"), "utf8")) as import("../evals/agent/types.js").Scoreboard;
    const graded = (sb: import("../evals/agent/types.js").Scoreboard) => sb.results.map((r) => r.trials.map((t) => [t.pass, t.calls, t.graders.map((g) => [g.id, g.pass, g.detail])]));
    const live = board(join(temp, "rec")), replayed = board(join(temp, "rep"));
    expect(graded(replayed)).toEqual(graded(live));
    expect(replayed.overall).toMatchObject({ tasks: 1, trials: 2, passAt1: 1, skipped: 0 });
    // Costed from tokens where the call named no cost, and said to be.
    expect(replayed.overall.costUsd).toBeCloseTo(2 * 2 * (900 * 0.1 + 30 * 0.5) / 1e6);
    expect(readFileSync(join(join(temp, "rep"), readdirSync(join(temp, "rep"))[0]!, "scoreboard.md"), "utf8")).toContain("cost: estimated from tokens");
  });

  it("replay with no cassettes skips every task, and says so", async () => {
    const run = out(["--mode", "replay", "--fixtures", "--id", "fx-calendar-en-00", "--out", join(temp, "out3"), "--cassettes", join(temp, "none")]);
    expect(await run.run()).toBe(0);
    expect(run.lines.filter((l) => l.startsWith("skip  fx-calendar-en-00"))).toHaveLength(5);
  });
});

describe("the harness never calls out", () => {
  it("made no model call and touched no network", () => expect(net.calls).toEqual([]));
});
