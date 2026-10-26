/**
 * THE RECEIPT ON THE WIRE (agent/protocol.ts SinkHooks, runs/ledger.ts).
 *
 * What these hold down:
 *   - one receipt, right before the terminal event, never after it;
 *   - none before an action, a look or a device step on the desktop, where the
 *     run goes on; one before every terminal on the phone;
 *   - a sink with no hooks writes every byte it always did, so every route
 *     and test that builds its own EventSink is untouched;
 *   - a hook that throws is passed over: the step's own events still go out;
 *   - a desktop step that did nothing says why in the receipt it sends, not
 *     only in its row: the step names its code before its done.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../shared/types/api.js";

process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.NODE_ENV = "test";
process.env.DEV_SKIP_AUTH = "true";

const { EventSink } = await import("../src/agent/protocol.js");
const { runStep } = await import("../src/agent/run.js");
const { MemoryRunStore, RunLedger } = await import("../src/runs/index.js");
type Surface = import("../src/runs/index.js").Surface;
type ConnectorsRuntime = import("../src/agent/run.js").ConnectorsRuntime;

const HEARD: AgentEvent = { t: "heard", text: "export it", mode: "do" };
const TERMINALS: AgentEvent[] = [
  { t: "action", kind: "press", id: "e3", risk: "free" },
  { t: "ask", text: "Which one?" },
  { t: "look", why: "the chart" },
  { t: "approve", taskId: "t1", approval: { id: "a1", connector: "notion", tool: "add_comment", risk: "send", preview: "Add comment in Notion" } },
  { t: "device", id: "d1", tool: "find_files", args: { name: "cv" }, risk: "read" },
  { t: "done" },
  { t: "error", code: "model_unavailable", message: "Ask can't think right now." },
];

/** A step's stream through a sink with a ledger's hooks on it: the events as they went out. */
function stream(surface: Surface, events: AgentEvent[]) {
  const lines: string[] = [];
  const watch = new RunLedger({ store: new MemoryRunStore() }).begin({ userId: "u1", runId: "run_proto1", surface, platform: surface === "phone" ? "android" : "mac", step: 0, said: "export it" });
  const sink = new EventSink((l) => lines.push(l), watch.sink);
  for (const e of events) sink.emit(e);
  return { evs: lines.map((l) => JSON.parse(l) as AgentEvent), lines, watch, sink };
}

describe("EventSink's hooks", () => {
  it("with none, every line is the one it always wrote", () => {
    const events: AgentEvent[] = [HEARD, { t: "say", text: "On it." }, { t: "say", text: "Exporting." }, { t: "done", text: "Done." }, { t: "say", text: "late" }];
    const lines: string[] = [];
    const sink = new EventSink((l) => lines.push(l));
    for (const e of events) sink.emit(e);
    expect(lines).toEqual([
      '{"t":"heard","text":"export it","mode":"do"}\n',
      '{"t":"say","text":"On it."}\n',
      '{"t":"say","text":"Exporting.","append":true}\n',
      '{"t":"done","text":"Done."}\n',
    ]);
    expect(sink.count).toBe(4);
    expect(sink.ending).toBe("done");
  });

  it("writes what beforeEnd returns just before the terminal, once, and tells seen of every line written", () => {
    const lines: string[] = [];
    const seen: string[] = [];
    let asked = 0;
    const sink = new EventSink((l) => lines.push(l), {
      beforeEnd: (t) => { asked += 1; return { t: "say", text: `before ${t.t}` }; },
      seen: (e) => { seen.push(e.t); },
    });
    sink.emit(HEARD);
    sink.emit({ t: "say", text: "Hi." });
    sink.emit({ t: "done" });
    sink.emit({ t: "done" });
    sink.emit({ t: "say", text: "after" });
    expect(lines.map((l) => JSON.parse(l))).toEqual([HEARD, { t: "say", text: "Hi." }, { t: "say", text: "before done" }, { t: "done" }]);
    expect(asked).toBe(1);
    expect(seen).toEqual(["heard", "say", "say", "done"]);
    expect(sink.count).toBe(4);
  });

  it("a hook that returns nothing adds nothing, and one that throws is passed over", () => {
    const quiet: string[] = [];
    const a = new EventSink((l) => quiet.push(l), { beforeEnd: () => null });
    a.emit({ t: "done" });
    expect(quiet).toEqual(['{"t":"done"}\n']);

    const lines: string[] = [];
    const b = new EventSink((l) => lines.push(l), {
      beforeEnd: () => { throw new Error("a bug in the ledger"); },
      seen: () => { throw new Error("another"); },
    });
    b.emit(HEARD);
    b.emit({ t: "error", code: "internal", message: "Something went wrong." });
    expect(lines.map((l) => JSON.parse(l).t)).toEqual(["heard", "error"]);
    expect(b.ended).toBe(true);
  });

  it("sees the terminal as it goes out: show mode's action becomes done first", () => {
    const told: string[] = [];
    const sink = new EventSink(() => {}, { beforeEnd: (t) => { told.push(t.t); return null; } });
    sink.emit({ t: "heard", text: "where is export", mode: "show" });
    sink.emit({ t: "action", kind: "press", id: "e3", risk: "free" });
    expect(told).toEqual(["done"]);
  });
});

describe("the receipt, on each surface", () => {
  it("desktop: one before done, error, ask and approve, and none before action, look or device", () => {
    for (const terminal of TERMINALS) {
      const { evs } = stream("desktop", [HEARD, { t: "say", text: "Hm." }, terminal, { t: "done" }]);
      const types = evs.map((e) => e.t);
      const ends = ["done", "error", "ask", "approve"].includes(terminal.t);
      expect(types, terminal.t).toEqual(ends ? ["heard", "say", "receipt", terminal.t] : ["heard", "say", terminal.t]);
      expect(types.filter((t) => t === "receipt").length, terminal.t).toBe(ends ? 1 : 0);
    }
  });

  it("phone: one before every terminal, and never after it", () => {
    for (const terminal of TERMINALS) {
      const { evs } = stream("phone", [HEARD, terminal, { t: "say", text: "late" }, { t: "done" }]);
      expect(evs.map((e) => e.t), terminal.t).toEqual(["heard", "receipt", terminal.t]);
    }
  });

  it("carries how the run ended and the line for it, and nothing that was said", () => {
    const outcomes = Object.fromEntries(TERMINALS.map((terminal) => {
      const { evs, watch } = stream("phone", [HEARD, { t: "say", text: "Secret plans for Mom." }, terminal]);
      const r = evs.find((e): e is Extract<AgentEvent, { t: "receipt" }> => e.t === "receipt")!.receipt;
      expect(watch.receipt).toEqual(r);
      expect(JSON.stringify(r)).not.toMatch(/Secret|Mom|export it/);
      return [terminal.t, [r.outcome, r.reason ?? null, r.line, r.taskId ?? null]];
    }));
    expect(outcomes).toEqual({
      action: ["failed", "desk_only", "That can’t be done from here.", null],
      ask: ["needs_you", "question", "Waiting for your answer.", null],
      look: ["failed", "desk_only", "That can’t be done from here.", null],
      approve: ["needs_you", "approval", "Waiting for your OK.", "t1"],
      device: ["failed", "desk_only", "That can’t be done from here.", null],
      done: ["done", null, "Done.", null],
      error: ["failed", "model_unavailable", "I couldn’t think just then. Try again in a moment.", null],
    });
  });

  it("is the receipt's own shape: the run, its steps, its times", () => {
    const { evs } = stream("desktop", [HEARD, { t: "done" }]);
    expect(evs[1]).toEqual({
      t: "receipt",
      receipt: { runId: "run_proto1", outcome: "done", line: "Done.", effects: 0, steps: 1, ms: expect.any(Number), firstMs: expect.any(Number) },
    });
  });
});

describe("a desktop step that did nothing", () => {
  /** One desktop step with a scripted planner (one answer per call), through a sink with a ledger's hooks on it. */
  async function desk(answers: string[], connectors?: ConnectorsRuntime) {
    const store = new MemoryRunStore();
    const watch = new RunLedger({ store }).begin({ userId: "u1", runId: "run_desk9", surface: "desktop", platform: "mac", step: 0, said: "add gym to my tasks" });
    const lines: string[] = [];
    const sink = new EventSink((l) => lines.push(l), watch.sink);
    const queue = [...answers];
    const deps = {
      write: async () => "", rewrite: async () => "",
      plan: () => { const a = queue.shift() ?? "DONE"; return (async function* () { yield { model: "m", delta: `${a}\n` }; })(); },
      ...(connectors ? { connectors } : {}),
    };
    const result = await runStep({ req: { runId: "run_desk9", step: 0, platform: "mac", app: "Safari", screen: { elements: [] }, utterance: "add gym to my tasks" }, maxSteps: 8 }, deps as never, sink);
    await watch.end(result);
    const evs = lines.map((l) => JSON.parse(l) as AgentEvent);
    return { evs, receipt: evs.find((e): e is Extract<AgentEvent, { t: "receipt" }> => e.t === "receipt")?.receipt, result, row: await store.get("u1", "run_desk9") };
  }

  it("nothing usable: the receipt before done says so, as the row does", async () => {
    const r = await desk([""]);
    expect(r.evs.map((e) => e.t)).toEqual(["heard", "say", "receipt", "done"]);
    expect(r.result.code).toBe("nothing_usable");
    expect(r.receipt).toMatchObject({ outcome: "failed", reason: "nothing_usable", line: "I couldn’t work out how to do that." });
    expect(r.row).toMatchObject({ outcome: "failed", reason: "nothing_usable" });
  });

  it("a USE that did not fit twice: the receipt before done says invalid_args, as the row does", async () => {
    const apps: ConnectorsRuntime = {
      cards: async () => ({ system: "S", message: (base) => base }),
      use: async () => ({ kind: "invalid", problems: 'missing "title"', message: "I couldn't fill that in for Google Tasks. Try saying it another way." }),
      settle: async () => {},
    };
    const r = await desk(["USE google-tasks.add_task {}", "USE google-tasks.add_task {}"], apps);
    expect(r.evs.map((e) => e.t)).toEqual(["heard", "say", "receipt", "done"]);
    expect(r.result.code).toBe("invalid_args");
    expect(r.receipt).toMatchObject({ outcome: "failed", reason: "invalid_args" });
    expect(r.row).toMatchObject({ outcome: "failed", reason: "invalid_args" });
  });
});
