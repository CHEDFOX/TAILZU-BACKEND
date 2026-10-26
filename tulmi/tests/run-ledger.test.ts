/**
 * THE RUN LEDGER (src/runs): how a step's ending becomes an outcome, what the
 * apps did becomes a count, and both become a receipt and a row.
 *
 * What these hold down:
 *   - the outcome table (outcome.ts), row by row, in its order;
 *   - error codes as reasons, and when asking again is safe;
 *   - the lines, in English and Hinglish, and a partial run said as one;
 *   - the runtime wrapper counts changes by a tool's declared risk and never
 *     looks at arguments; a stop, a card and a hand-off are noted; anything
 *     else passes through as it is;
 *   - nothing is written before end(); the row and its planner calls after;
 *     a call that comes in after the end (a stream read to its end once the
 *     answer has gone) is written too; one run's writes go one after another;
 *   - a store that fails is logged, never thrown.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../shared/types/api.js";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.NODE_ENV = "test";

const { EventSink } = await import("../src/agent/protocol.js");
const { MemoryRunStore, RunLedger, outcomeOf, reasonOfCode, receiptLine, retrySafe } = await import("../src/runs/index.js");
type Tally = import("../src/runs/index.js").Tally;
type RunStore = import("../src/runs/index.js").RunStore;
type StepStart = import("../src/runs/index.js").StepStart;
type ConnectorsRuntime = import("../src/agent/run.js").ConnectorsRuntime;
type StepResult = import("../src/agent/run.js").StepResult;
type ConnectorHub = import("../src/connectors/client.js").ConnectorHub;
type UseOutcome = import("../src/connectors/tasks.js").UseOutcome;

const tally = (over: Partial<Tally> = {}): Tally => ({ effects: 0, uses: 0, opened: false, ...over });
const DONE: AgentEvent = { t: "done" };
const ERROR = (code: string): AgentEvent => ({ t: "error", code, message: "x" });
const APPROVE: AgentEvent = { t: "approve", taskId: "t1", approval: { id: "a1", connector: "notion", tool: "add_comment", risk: "send", preview: "Add" } };
const result = (over: Partial<StepResult> = {}): StepResult => ({ path: "model", mode: "do", words: 0, audioSeconds: 0, ...over });

describe("outcomeOf: the table, row by row", () => {
  const phone = (terminal: AgentEvent | undefined, t: Tally = tally(), code?: string, hungUp?: boolean) =>
    outcomeOf({ surface: "phone", terminal, tally: t, ...(code ? { code } : {}), ...(hungUp ? { hungUp } : {}) });
  const desk = (terminal: AgentEvent | undefined, t: Tally = tally(), code?: string) =>
    outcomeOf({ surface: "desktop", terminal, tally: t, ...(code ? { code } : {}) });

  it("the device hung up before the terminal: cancelled, whatever came after", () => {
    expect(phone(DONE, tally(), undefined, true)).toEqual({ outcome: "cancelled", reason: "hung_up" });
    expect(outcomeOf({ surface: "desktop", terminal: ERROR("internal"), tally: tally(), hungUp: true })).toEqual({ outcome: "cancelled", reason: "hung_up" });
  });

  it("no terminal at all: failed / internal, whatever was changed", () => {
    expect(phone(undefined)).toEqual({ outcome: "failed", reason: "internal" });
    expect(desk(undefined, tally({ effects: 2 }))).toEqual({ outcome: "failed", reason: "internal" });
  });

  it("error: failed with its code as the reason, partial after a change", () => {
    expect(phone(ERROR("model_unavailable"))).toEqual({ outcome: "failed", reason: "model_unavailable" });
    expect(desk(ERROR("private"))).toEqual({ outcome: "failed", reason: "private" });
    expect(desk(ERROR("internal"), tally({ effects: 1 }))).toEqual({ outcome: "partial", reason: "internal" });
  });

  it("approve: needs_you / approval; ask: needs_you / question", () => {
    expect(phone(APPROVE)).toEqual({ outcome: "needs_you", reason: "approval" });
    expect(desk({ t: "ask", text: "Which?" })).toEqual({ outcome: "needs_you", reason: "question" });
  });

  it("action, look, device: the desktop run goes on; on the phone it cannot", () => {
    for (const t of [{ t: "action", kind: "press", id: "e1", risk: "free" }, { t: "look", why: "x" }, { t: "device", id: "d", tool: "find_files", args: {}, risk: "read" }] as AgentEvent[]) {
      expect(desk(t), t.t).toEqual({ outcome: "running" });
      expect(phone(t), t.t).toEqual({ outcome: "failed", reason: "desk_only" });
    }
  });

  it("done with nothing usable or arguments that did not fit: failed / that, partial after a change", () => {
    expect(phone(DONE, tally(), "nothing_usable")).toEqual({ outcome: "failed", reason: "nothing_usable" });
    expect(phone(DONE, tally(), "invalid_args")).toEqual({ outcome: "failed", reason: "invalid_args" });
    expect(phone(DONE, tally({ effects: 1 }), "invalid_args")).toEqual({ outcome: "partial", reason: "invalid_args" });
  });

  it("done after a USE that stopped: a question when it asked, else failed with its code", () => {
    expect(phone(DONE, tally({ stopped: { ask: true } }))).toEqual({ outcome: "needs_you", reason: "question" });
    // The desktop said the tool's question and ended the run: nothing waits for an answer there.
    expect(desk(DONE, tally({ stopped: { ask: true, code: "rejected" } }))).toEqual({ outcome: "failed", reason: "stopped" });
    expect(desk(DONE, tally({ stopped: { ask: true, code: "recipient_unsaid" }, effects: 1 }))).toEqual({ outcome: "partial", reason: "stopped" });
    expect(desk(DONE, tally({ stopped: { code: "not_connected" } }))).toEqual({ outcome: "failed", reason: "not_connected" });
    expect(desk(DONE, tally({ stopped: {} }))).toEqual({ outcome: "failed", reason: "stopped" });
    expect(desk(DONE, tally({ stopped: { code: "timeout" }, effects: 1 }))).toEqual({ outcome: "partial", reason: "app_timeout" });
  });

  it("done after a hand-off opened: done / handoff; plain done: done", () => {
    expect(phone(DONE, tally({ opened: true, effects: 1 }))).toEqual({ outcome: "done", reason: "handoff" });
    expect(phone(DONE)).toEqual({ outcome: "done" });
    expect(desk({ t: "done", text: "All set." })).toEqual({ outcome: "done" });
  });
});

describe("reasons and retries", () => {
  it("maps every code the planner and the apps use", () => {
    const table: Record<string, string> = {
      not_connected: "not_connected", needs_reconnect: "needs_reconnect", blocked: "blocked",
      timeout: "app_timeout", unreachable: "app_unreachable", blocked_address: "app_unreachable",
      tool_error: "app_error", failed: "app_error", unknown_tool: "app_error", phone_only: "desk_only",
      model_unavailable: "model_unavailable", internal: "internal", no_speech: "no_speech", private: "private",
      too_many_steps: "too_many_steps", bad_target: "bad_target", nothing_usable: "nothing_usable", invalid_args: "invalid_args",
      rejected: "stopped", show_only: "stopped", recipient_unsaid: "stopped", "": "stopped",
    };
    for (const [code, reason] of Object.entries(table)) expect(reasonOfCode(code), code).toBe(reason);
    expect(reasonOfCode(undefined)).toBe("stopped");
  });

  it("asking again is offered only on the phone, after a passing failure that changed nothing", () => {
    // app_timeout and app_unreachable reach here with no change only for a read: a write that
    // stopped that way may have gone through, and the wrapper counts it (below).
    for (const r of ["model_unavailable", "internal", "nothing_usable", "invalid_args", "app_timeout", "app_unreachable"] as const) {
      expect(retrySafe("phone", "failed", r, 0), r).toBe(true);
      expect(retrySafe("phone", "failed", r, 1), r).toBe(false);
      expect(retrySafe("desktop", "failed", r, 0), r).toBe(false);
      expect(retrySafe("phone", "partial", r, 0), r).toBe(false);
    }
    for (const r of ["not_connected", "blocked", "private", "desk_only", "app_error", "stopped"] as const) expect(retrySafe("phone", "failed", r, 0), r).toBe(false);
    expect(retrySafe("phone", "failed", undefined, 0)).toBe(false);
    expect(retrySafe("phone", "done", undefined, 0)).toBe(false);
  });

  it("says each ending in one line, in English or Hinglish, and a partial run as part done", () => {
    expect(receiptLine("done", undefined)).toBe("Done.");
    expect(receiptLine("done", undefined, "hinglish")).toBe("Ho gaya.");
    expect(receiptLine("done", "handoff")).toBe("It’s ready in the other app for you to finish.");
    expect(receiptLine("done", "handoff", "Hinglish")).toBe("Doosre app mein taiyaar hai, wahan poora karo.");
    expect(receiptLine("needs_you", "approval")).toBe("Waiting for your OK.");
    expect(receiptLine("needs_you", "approval", "hinglish")).toBe("Tumhare OK ka intezaar hai.");
    expect(receiptLine("needs_you", "question")).toBe("Waiting for your answer.");
    expect(receiptLine("failed", "nothing_usable")).toBe("I couldn’t work out how to do that.");
    expect(receiptLine("failed", "needs_reconnect")).toBe("An app needs you to sign in again.");
    expect(receiptLine("failed", "stuck")).toBe("This stopped before it finished.");
    expect(receiptLine("cancelled", "denied")).toBe("You said no.");
    expect(receiptLine("done", "denied")).toBe("You said no.");
    expect(receiptLine("cancelled", "device_stopped")).toBe("Stopped on your computer.");
    expect(receiptLine("running", undefined)).toBe("Working on it.");
    expect(receiptLine("partial", "app_timeout")).toBe("Part of it is done. The app took too long to answer.");
    expect(receiptLine("partial", undefined)).toBe("Part of it is done, not all of it.");
    // Hindi has no table of its own yet: English, as the rest of the server's lines.
    expect(receiptLine("done", undefined, "hi")).toBe("Done.");
  });
});

// ---------------------------------------------------------------- the watch

/** A hub that knows two tools of one app: a read and a write. "broken" cannot list its tools. */
const HUB = {
  resolve: async (_u: string, id: string) => (id === "gone" ? undefined : { id, name: id }),
  tools: async (_u: string, id: string) => {
    if (id === "broken") throw new Error("down");
    return [{ name: "list_events", inputSchema: {} }, { name: "add_event", inputSchema: {} }];
  },
  toolRisk: (_d: unknown, info: { name: string }) => (info.name.startsWith("list") ? "read" : "write"),
} as unknown as ConnectorHub;

/** A runtime whose USEs answer, in turn, what a test gives it; what settle and cards were asked is kept. */
function runtime(...answers: Array<UseOutcome | Record<string, unknown>>) {
  const asked: string[] = [];
  const rt: ConnectorsRuntime = {
    cards: async (_req, said) => { asked.push(`cards ${said}`); return null; },
    use: async () => answers.shift() as UseOutcome,
    settle: async (runId, ending) => { asked.push(`settle ${runId} ${ending}`); },
  };
  return { rt, asked };
}

const use = (rt: ConnectorsRuntime, connector: string, tool: string) =>
  rt.use("run_w", "x", { connector, tool, args: { secret: "Mom's number 98765" } } as never, { allowWrite: true });

function begin(o: Partial<StepStart> = {}, store: RunStore = new MemoryRunStore()) {
  const ledger = new RunLedger({ store });
  const s: StepStart = { userId: "u1", runId: "run_w", surface: "phone", platform: "android", step: 0, said: "add dentist tomorrow 5pm", ...o };
  const watch = ledger.begin(s);
  const lines: AgentEvent[] = [];
  const sink = new EventSink((l) => lines.push(JSON.parse(l) as AgentEvent), watch.sink);
  return { ledger, watch, sink, lines, store };
}

describe("the runtime wrapper: what the apps did, counted", () => {
  it("a tool that ran is a change unless it is a read; unsure is a change; a hand-off and a write on the computer are changes", async () => {
    const { watch, sink, lines } = begin();
    const { rt } = runtime(
      { kind: "result", text: "3 events" },
      { kind: "result", text: "added" },
      { kind: "result", text: "?" },
      { kind: "result", text: "?" },
      { kind: "device", tool: "find_files", args: {}, risk: "read", words: {} },
      { kind: "device", tool: "move_files", args: {}, risk: "write", words: {} },
      { kind: "open", url: "https://wa.me/?text=hi", label: "Open WhatsApp" },
    );
    const w = watch.watch(rt, HUB);
    await use(w, "google-calendar", "list_events");
    await use(w, "google-calendar", "add_event");
    await use(w, "gone", "add_event");
    await use(w, "broken", "list_events");
    await use(w, "this-computer", "find_files");
    await use(w, "this-computer", "move_files");
    await use(w, "whatsapp", "send_message");
    sink.emit({ t: "heard", text: "x", mode: "do" });
    sink.emit(DONE);
    // add_event, the unknown app, the app whose tools could not be read, move_files, the hand-off.
    expect(lines.find((e) => e.t === "receipt")).toMatchObject({ receipt: { outcome: "done", reason: "handoff", effects: 5 } });
  });

  it("notes a card's task, and a stop with its code, which a later USE that ran clears", async () => {
    const { watch, sink, lines } = begin();
    const { rt } = runtime(
      { kind: "stopped", message: "Calendar isn't connected.", code: "not_connected" },
      { kind: "result", text: "3 events" },
      { kind: "approval", taskId: "11111111-2222-4333-8444-555555555555", approval: { id: "a", connector: "c", tool: "t", risk: "write", preview: "p" } },
    );
    const w = watch.watch(rt, HUB);
    await use(w, "google-calendar", "add_event");
    await use(w, "google-calendar", "list_events");
    const approval = (await use(w, "google-calendar", "add_event")) as Extract<UseOutcome, { kind: "approval" }>;
    sink.emit({ t: "approve", taskId: approval.taskId, approval: approval.approval });
    expect(lines.at(-2)).toMatchObject({ t: "receipt", receipt: { outcome: "needs_you", reason: "approval", taskId: "11111111-2222-4333-8444-555555555555", effects: 0 } });

    const stopped = begin();
    const s = runtime({ kind: "stopped", message: "Calendar isn't connected.", code: "not_connected" });
    await use(stopped.watch.watch(s.rt, HUB), "google-calendar", "add_event");
    stopped.sink.emit(DONE);
    expect(stopped.lines[0]).toMatchObject({ receipt: { outcome: "failed", reason: "not_connected", line: "That app isn’t connected." } });
  });

  it("a write that failed after it reached the app may have gone through: a change, never offered again; a read that did is not", async () => {
    // Google took too long, and the call was not called off: the event may be in the calendar.
    const timedOut = begin();
    const t = runtime({ kind: "stopped", message: "Google Calendar took too long to answer.", code: "timeout" });
    await use(timedOut.watch.watch(t.rt, HUB), "google-calendar", "add_event");
    timedOut.sink.emit({ t: "say", text: "Google Calendar took too long to answer." });
    timedOut.sink.emit(DONE);
    await timedOut.watch.end(result());
    expect(timedOut.watch.receipt).toMatchObject({ outcome: "partial", reason: "app_timeout", effects: 1 });
    expect(timedOut.watch.receipt!.retry).toBeUndefined();
    expect(await timedOut.store.get("u1", "run_w")).toMatchObject({ outcome: "partial", said: null });

    for (const code of ["unreachable", "failed", "tool_error"]) {
      const w = begin();
      await use(w.watch.watch(runtime({ kind: "stopped", message: "x", code }).rt, HUB), "google-calendar", "add_event");
      w.sink.emit(DONE);
      expect(w.lines[0], code).toMatchObject({ receipt: { outcome: "partial", effects: 1 } });
      expect((w.lines[0] as Extract<AgentEvent, { t: "receipt" }>).receipt.retry, code).toBeUndefined();
    }

    // A read that timed out changed nothing, and asking again is safe.
    const read = begin();
    await use(read.watch.watch(runtime({ kind: "stopped", message: "x", code: "timeout" }).rt, HUB), "google-calendar", "list_events");
    read.sink.emit(DONE);
    await read.watch.end(result());
    expect(read.watch.receipt).toMatchObject({ outcome: "failed", reason: "app_timeout", effects: 0, retry: true });

    // Stopped before any call (not connected, blocked, a hand-off's question): nothing changed.
    for (const code of ["not_connected", "blocked", "rejected", "show_only"]) {
      const w = begin();
      await use(w.watch.watch(runtime({ kind: "stopped", message: "x", code }).rt, HUB), "google-calendar", "add_event");
      w.sink.emit(DONE);
      expect(w.lines[0], code).toMatchObject({ receipt: { outcome: "failed", effects: 0 } });
    }
  });

  it("a USE that threw may have run first: a write is counted as a change, and the throw goes on", async () => {
    const { watch, store } = begin();
    const rt: ConnectorsRuntime = {
      cards: async () => null,
      use: async () => { throw new Error("audit row not written"); },
      settle: async () => {},
    };
    const w = watch.watch(rt, HUB);
    await expect(use(w, "google-calendar", "add_event")).rejects.toThrow("audit row not written");
    await expect(use(w, "google-calendar", "list_events")).rejects.toThrow("audit row not written");
    await watch.end(undefined);
    // No terminal: failed / internal (the table), and with a change, no words kept to try again with.
    expect(await store.get("u1", "run_w")).toMatchObject({ outcome: "failed", reason: "internal", effects: 1, said: null });
    expect(watch.receipt!.retry).toBeUndefined();
  });

  it("passes everything else through as it is: a kind it does not know, cards, settle", async () => {
    const { watch } = begin();
    const odd = { kind: "invalid", problems: 'missing "title"' };
    const { rt, asked } = runtime(odd);
    const w = watch.watch(rt, HUB);
    expect(await use(w, "google-tasks", "add_task")).toBe(odd);
    expect(await w.cards({} as never, "add milk")).toBeNull();
    await w.settle("run_w", "done");
    expect(asked).toEqual(["cards add milk", "settle run_w done"]);
  });
});

describe("the step's row and its calls", () => {
  const CALL = { model: "openai/gpt-6-luna", outcome: "ok" as const, ms: 900, firstMs: 300, promptTokens: 3120, cachedTokens: 2900, completionTokens: 31, costUsd: 0.000327 };

  it("writes nothing before end(), then the row and the calls held for it; a call after the end follows on its own", async () => {
    const store = new MemoryRunStore();
    const { watch, sink } = begin({}, store);
    sink.emit({ t: "heard", text: "add dentist tomorrow 5pm", mode: "do" });
    watch.call(CALL);
    sink.emit({ t: "say", text: "Added." });
    sink.emit(DONE);
    await new Promise((r) => setTimeout(r, 5));
    expect(await store.get("u1", "run_w")).toBeNull();
    expect(store.callsOf("u1", "run_w")).toEqual([]);

    await watch.end(result());
    expect(await store.get("u1", "run_w")).toMatchObject({
      surface: "phone", platform: "android", outcome: "done", reason: null, steps: 1, effects: 0, path: "model", mode: "do",
      title: "add dentist tomorrow 5pm", said: null, turns: null,
    });
    expect(store.callsOf("u1", "run_w")).toEqual([{ runId: "run_w", step: 0, surface: "phone", at: expect.any(Number), ...CALL }]);

    // The rest of a stream, read after the answer went: its call is logged when it ends.
    watch.call({ model: "anthropic/claude-haiku-5.5", outcome: "stopped", ms: 40 });
    await expect.poll(() => store.callsOf("u1", "run_w").length).toBe(2);
    expect(store.callsOf("u1", "run_w")[1]).toMatchObject({ model: "anthropic/claude-haiku-5.5", outcome: "stopped" });
    // end() is once.
    await watch.end(result({ code: "internal" }));
    expect((await store.get("u1", "run_w"))!.outcome).toBe("done");
  });

  it("makes the receipt final with the step's own code: nothing usable is a failure, with their words kept to try again", async () => {
    const store = new MemoryRunStore();
    const { watch, sink, lines } = begin({}, store);
    sink.emit({ t: "heard", text: "x", mode: "do" });
    sink.emit({ t: "say", text: "I couldn't do that from here." });
    sink.emit(DONE);
    // Sent before the step returned: plainly done, as far as the terminal says.
    expect(lines.find((e) => e.t === "receipt")).toMatchObject({ receipt: { outcome: "done" } });
    await watch.end(result({ code: "nothing_usable" }));
    expect(watch.receipt).toMatchObject({ outcome: "failed", reason: "nothing_usable", retry: true, line: "I couldn’t work out how to do that." });
    expect(await store.get("u1", "run_w")).toMatchObject({ outcome: "failed", reason: "nothing_usable", said: "add dentist tomorrow 5pm" });

    // An answer to a question back is not a request on its own: no words kept, no retry offered.
    const answer = begin({ runId: "run_a", said: "rahul@okhdfcbank", follows: "run_q", title: "pay rahul 500" }, store);
    answer.sink.emit(ERROR("model_unavailable"));
    await answer.watch.end(result({ code: "model_unavailable" }));
    expect(answer.watch.receipt).toMatchObject({ outcome: "failed", reason: "model_unavailable" });
    expect(answer.watch.receipt!.retry).toBeUndefined();
    expect(await store.get("u1", "run_a")).toMatchObject({ said: null, follows: "run_q", title: "pay rahul 500" });
  });

  it("asked again in the same words, the run that kept them stops offering Try again; a failure again keeps them anew", async () => {
    let clock = 1_000;
    const store = new MemoryRunStore({ now: () => (clock += 1) });
    const ledger = new RunLedger({ store });
    const failing = async (runId: string, said: string) => {
      const w = ledger.begin({ userId: "u1", runId, surface: "phone", platform: "ios", step: 0, said });
      new EventSink(() => {}, w.sink).emit(ERROR("model_unavailable"));
      await w.end(result({ code: "model_unavailable" }));
    };
    await failing("run_r1", "add gym tomorrow");
    await failing("run_r2", "call papa");
    expect((await store.recent("u1", 5)).map((r) => [r.runId, r.retry])).toEqual([["run_r2", "call papa"], ["run_r1", "add gym tomorrow"]]);
    // Try again: the same words fail again; only the newest run offers them now.
    await failing("run_r3", "add gym tomorrow");
    expect((await store.recent("u1", 5)).map((r) => [r.runId, r.retry ?? null])).toEqual([["run_r3", "add gym tomorrow"], ["run_r2", "call papa"], ["run_r1", null]]);
    // Asked again and done: nothing offers it.
    const done = ledger.begin({ userId: "u1", runId: "run_r4", surface: "phone", platform: "ios", step: 0, said: "add gym tomorrow" });
    new EventSink(() => {}, done.sink).emit(DONE);
    await done.end(result());
    expect((await store.recent("u1", 5)).filter((r) => r.retry === "add gym tomorrow")).toEqual([]);
    expect((await store.get("u1", "run_r2"))!.said).toBe("call papa");
  });

  it("holds the phone's question back for its answer, and the desktop's counts across its steps", async () => {
    const store = new MemoryRunStore();
    const q = begin({}, store);
    q.sink.emit({ t: "ask", text: "What time?" });
    q.watch.waitForAnswer([{ said: "add dentist tomorrow", did: "ASK", note: "What time?" }]);
    await q.watch.end(result());
    expect(await store.get("u1", "run_w")).toMatchObject({ outcome: "needs_you", reason: "question", turns: [{ said: "add dentist tomorrow", did: "ASK", note: "What time?" }] });

    const ledger = new RunLedger({ store });
    const desk = (step: number, events: AgentEvent[]) => {
      const watch = ledger.begin({ userId: "u1", runId: "run_d", surface: "desktop", platform: "win", step, ...(step === 0 ? { said: "type hello and send it" } : {}) });
      const out: AgentEvent[] = [];
      const sink = new EventSink((l) => out.push(JSON.parse(l) as AgentEvent), watch.sink);
      for (const e of events) sink.emit(e);
      return { watch, out };
    };
    const s0 = desk(0, [{ t: "heard", text: "type hello and send it", mode: "do" }, { t: "action", kind: "type", text: "hello", risk: "free" }]);
    await s0.watch.end(result({ path: "model" }));
    expect(s0.watch.receipt).toBeUndefined();
    expect(await store.get("u1", "run_d")).toMatchObject({ outcome: "running", steps: 1, effects: 1, endedAt: null, title: "" });
    const s1 = desk(1, [{ t: "heard", text: "type hello and send it", mode: "do" }, { t: "action", kind: "scroll", dir: "down", risk: "free" }]);
    await s1.watch.end(result());
    const s2 = desk(2, [{ t: "heard", text: "type hello and send it", mode: "do" }, { t: "action", kind: "key", keys: "enter", risk: "confirm" }]);
    await s2.watch.end(result());
    const s3 = desk(3, [{ t: "heard", text: "type hello and send it", mode: "do" }, DONE]);
    // A scroll changes nothing; a typing and a key press do.
    expect(s3.out[1]).toMatchObject({ t: "receipt", receipt: { outcome: "done", effects: 2, steps: 4 } });
    await s3.watch.end(result({ path: "followup" }));
    expect(await store.get("u1", "run_d")).toMatchObject({ outcome: "done", steps: 4, effects: 2, path: "followup", title: "", endedAt: expect.any(Number) });
  });

  it("keeps a phone run's title a line long, cut to 80, without a link's query; a desktop run keeps none of their words", async () => {
    const store = new MemoryRunStore();
    const ledger = new RunLedger({ store });
    const typed = ledger.begin({ userId: "u1", runId: "run_t1", surface: "phone", platform: "ios", step: 0, said: `open https://bank.example/reset?token=s3cr3t and\n\nthen ${"x".repeat(200)}` });
    new EventSink(() => {}, typed.sink).emit(DONE);
    await typed.end(result());
    const title = (await store.get("u1", "run_t1"))!.title;
    expect(title).toMatch(/^open https:\/\/bank\.example\/reset and then x+…$/);
    expect(title).toHaveLength(80);
    expect(title).not.toContain("s3cr3t");

    // The desktop: neither what was typed nor what was heard.
    for (const [runId, said] of [["run_t2", undefined], ["run_t3", "rename the report"]] as const) {
      const desk = ledger.begin({ userId: "u1", runId, surface: "desktop", platform: "win", step: 0, ...(said ? { said } : {}) });
      const sink = new EventSink(() => {}, desk.sink);
      sink.emit({ t: "heard", text: "where is the export button", mode: "show" });
      sink.emit(DONE);
      await desk.end(result());
      expect((await store.get("u1", runId))!).toMatchObject({ title: "", said: null });
    }
    // Nor a request refused as private.
    const refused = ledger.begin({ userId: "u1", runId: "run_t4", surface: "phone", platform: "ios", step: 0, said: "read my bank statement" });
    new EventSink(() => {}, refused.sink).emit(ERROR("private"));
    await refused.end(result({ code: "private" }));
    expect((await store.get("u1", "run_t4"))!.title).toBe("");
  });

  it("keeps a question asked after an app's answer without its words: they are held here, for the answer, and kept out again down the chain", async () => {
    const store = new MemoryRunStore();
    const ledger = new RunLedger({ store });
    // The step reads a sheet, then asks about what it read.
    const q = ledger.begin({ userId: "u1", runId: "run_q1", surface: "phone", platform: "android", step: 0, said: "check my society dues sheet and pay what I owe" });
    const { rt } = runtime({ kind: "result", text: "Oct: 3200, greenpark.society@okhdfcbank" });
    await use(q.watch(rt, HUB), "google-sheets", "list_events");
    const asked = { said: "check my society dues sheet and pay what I owe", did: "ASK", note: "Your sheet says 3200 for October, to greenpark.society@okhdfcbank. Is that who to pay?" };
    q.waitForAnswer([asked]);
    await q.end(result());
    const row = await store.get("u1", "run_q1");
    expect(row!.turns).toEqual([{ said: asked.said, did: "ASK" }]);
    expect(JSON.stringify(row)).not.toMatch(/3200|greenpark/);

    // The answer, on this server: read with the question's words.
    const took = await ledger.takeFollowUp("u1", "run_q2", 0);
    expect(took).toEqual({ runId: "run_q1", turns: [asked] });
    // It asks again (no app read this time): the first question's words stay out of the store.
    const a = ledger.begin({ userId: "u1", runId: "run_q2", surface: "phone", platform: "android", step: 0, said: "yes", follows: "run_q1" });
    const again = { said: "yes", did: "ASK", note: "How much: 3200?" };
    a.waitForAnswer([asked, again]);
    await a.end(result());
    expect((await store.get("u1", "run_q2"))!.turns).toEqual([{ said: asked.said, did: "ASK" }, again]);
    expect(await ledger.takeFollowUp("u1", "run_q3", 0)).toEqual({ runId: "run_q2", turns: [asked, again] });

    // On another server, or after a restart: the answer is read with the request and that it was asked.
    const other = new RunLedger({ store });
    const q4 = ledger.begin({ userId: "u2", runId: "run_q4", surface: "phone", platform: "ios", step: 0, said: "what's on today and move the first" });
    await use(q4.watch(runtime({ kind: "result", text: "9am Dentist" }).rt, HUB), "google-calendar", "list_events");
    q4.waitForAnswer([{ said: "what's on today and move the first", did: "ASK", note: "Dentist at 9am. Move it to when?" }]);
    await q4.end(result());
    expect(await other.takeFollowUp("u2", "run_q5", 0)).toEqual({ runId: "run_q4", turns: [{ said: "what's on today and move the first", did: "ASK" }] });

    // A question asked with no app read is kept whole, as it always was.
    const plain = ledger.begin({ userId: "u3", runId: "run_q6", surface: "phone", platform: "ios", step: 0, said: "add dentist tomorrow" });
    plain.waitForAnswer([{ said: "add dentist tomorrow", did: "ASK", note: "What time?" }]);
    await plain.end(result());
    expect((await store.get("u3", "run_q6"))!.turns).toEqual([{ said: "add dentist tomorrow", did: "ASK", note: "What time?" }]);
  });

  it("a desktop step the device hung up on is cancelled; a step that threw is failed / internal", async () => {
    const store = new MemoryRunStore();
    const ledger = new RunLedger({ store });
    const hung = ledger.begin({ userId: "u1", runId: "run_h", surface: "desktop", platform: "mac", step: 0, said: "x" });
    new EventSink(() => {}, hung.sink).emit(ERROR("internal"));
    await hung.end(undefined, { hungUp: true });
    expect(await store.get("u1", "run_h")).toMatchObject({ outcome: "cancelled", reason: "hung_up" });
    const threw = ledger.begin({ userId: "u1", runId: "run_t", surface: "phone", platform: "ios", step: 0, said: "x" });
    await threw.end(undefined);
    expect(await store.get("u1", "run_t")).toMatchObject({ outcome: "failed", reason: "internal" });
  });

  it("writes one run's steps one after another, and a store that fails is logged, never thrown", async () => {
    const order: string[] = [];
    const slow = new MemoryRunStore();
    const store: RunStore = {
      ...Object.fromEntries((["get", "recent", "takeFollowUp", "sweep", "addCalls"] as const).map((k) => [k, slow[k].bind(slow)])),
      saveStep: async (u, r) => {
        order.push(`start ${r.step}`);
        await new Promise((res) => setTimeout(res, r.step === 0 ? 30 : 0));
        await slow.saveStep(u, r);
        order.push(`end ${r.step}`);
      },
    } as RunStore;
    const ledger = new RunLedger({ store });
    const a = ledger.begin({ userId: "u1", runId: "run_o", surface: "desktop", platform: "mac", step: 0, said: "x" });
    new EventSink(() => {}, a.sink).emit({ t: "action", kind: "press", id: "e1", risk: "free" });
    const b = ledger.begin({ userId: "u1", runId: "run_o", surface: "desktop", platform: "mac", step: 1 });
    new EventSink(() => {}, b.sink).emit(DONE);
    await Promise.all([a.end(result()), b.end(result())]);
    expect(order).toEqual(["start 0", "end 0", "start 1", "end 1"]);
    expect(await slow.get("u1", "run_o")).toMatchObject({ outcome: "done", steps: 2, effects: 1 });

    const warned: string[] = [];
    const broken = { saveStep: async () => { throw new Error("relation agent_runs does not exist"); }, addCalls: async () => {}, forgetRetry: async () => {}, takeFollowUp: async () => { throw new Error("down"); } } as unknown as RunStore;
    const failing = new RunLedger({ store: broken, log: { warn: (_o, m) => { warned.push(m); } } });
    const w = failing.begin({ userId: "u1", runId: "run_f", surface: "phone", platform: "ios", step: 0, said: "x" });
    new EventSink(() => {}, w.sink).emit(DONE);
    await expect(w.end(result())).resolves.toBeUndefined();
    expect(w.receipt).toMatchObject({ outcome: "done" });
    await expect(failing.takeFollowUp("u1", "run_g", 0)).resolves.toBeNull();
    expect(warned).toEqual(["run ledger: not written", "run ledger: follow-up not read"]);
  });
});
