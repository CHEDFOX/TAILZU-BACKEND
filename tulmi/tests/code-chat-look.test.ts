/**
 * LOOKING BEFORE ANSWERING (src/code/chat/look.ts): the chat asks for what it still needs with read-only tools, is told what it has read after each
 * step, cites only lines it read, answers at the last step whatever happens, and the thread keeps what it read for the next question.
 */
import { describe, expect, it } from "vitest";
import { Anchors, checkCitations, fixPaths, unknownPaths } from "../src/code/chat/cite.js";
import { investigate, LOOK_STEPS_MAX, type LookTools } from "../src/code/chat/look.js";
import { BudgetExceeded } from "../src/code/brain/gateway.js";
import { afterTurn, newThread, SEEN_KEPT } from "../src/code/chat/threads.js";

type Sent = { tools: string[]; toolChoice: unknown; messages: Array<{ role: string; content: unknown }> };

function scripted(turns: Array<{ text?: string; calls?: Array<{ name: string; args: Record<string, unknown> }> }>) {
  const sent: Sent[] = [];
  let n = 0;
  const call = (async (input: { tools?: Array<{ name: string }>; toolChoice?: unknown; messages: Array<{ role: string; content: unknown }> }) => {
    sent.push({ tools: (input.tools ?? []).map((t) => t.name), toolChoice: input.toolChoice, messages: structuredClone(input.messages) });
    const t = turns[Math.min(n, turns.length - 1)]!;
    n += 1;
    return { text: t.text ?? "", paise: 1, model: "m", toolCalls: (t.calls ?? []).map((c, i) => ({ id: `c${n}-${i}`, name: c.name, arguments: JSON.stringify(c.args) })) };
  }) as never;
  return { sent, model: { userId: "alice", call } };
}

const FILE = ["export function startSession(res, id) {", "  res.cookie(\"sid\", sign(id), { httpOnly: true });", "}"];
const tools = (): LookTools & { ran: string[] } => {
  const ran: string[] = [];
  return {
    ran,
    defs: ["read_file", "grep", "project_map", "edit_file", "run"].map((name) => ({ name, description: name, parameters: {} })),
    exec: async (c) => {
      ran.push(c.name);
      if (c.name === "read_file") return { ok: true, content: "Read src/auth/session.ts.", data: FILE.map((l, i) => `${i + 1}: ${l}`).join("\n") };
      if (c.name === "grep") return { ok: true, content: "1 line matches.", data: "src/routes/login.ts:8:  await startSession(res, user.id);" };
      return { ok: false, content: "no" };
    },
  };
};

describe("looking before answering", () => {
  it("reads what it asks for, is told what it has read, refuses what writes, and cites only what it read", async () => {
    const m = scripted([
      { calls: [{ name: "read_file", args: { path: "src/auth/session.ts", from: 1, to: 3 } }, { name: "grep", args: { pattern: "startSession\\(" } }, { name: "edit_file", args: { path: "x" } }] },
      { text: "startSession sets it at src/auth/session.ts:2, called from src/routes/login.ts:8; see also src/auth/session.ts:90." },
    ]);
    const t = tools();
    const anchors = new Anchors();
    const out = await investigate({ model: m.model, tier: "cheap", user: "<question>\nwhere is the cookie set?\n</question>", tools: t, anchors, maxPaise: 50, maxTokens: 800 });
    // Only the read-only tools are offered, and one that writes is never run.
    expect(m.sent[0]!.tools).toEqual(["read_file", "grep", "project_map"]);
    expect(t.ran).toEqual(["read_file", "grep"]);
    const second = m.sent[1]!.messages;
    expect(JSON.stringify(second)).toContain("this chat only reads");
    expect(String(second.at(-1)!.content)).toMatch(/^Ledger: read src\/auth\/session\.ts:1-3; searched "startSession\\\\\(".*steps left/);
    expect(out).toMatchObject({ reads: ["src/auth/session.ts"], greps: ["startSession\\("], seen: ["src/auth/session.ts:1-3"], steps: 2, paise: 2 });
    // The lines it read and the hit it saw stand; a line it never saw goes.
    const checked = checkCitations(out.text, anchors);
    expect(checked.kept).toEqual(["src/auth/session.ts:2", "src/routes/login.ts:8"]);
    expect(checked.dropped).toEqual(["src/auth/session.ts:90"]);
  });

  it("answers in one turn when the brief is enough", async () => {
    const m = scripted([{ text: "It is set in startSession." }]);
    const out = await investigate({ model: m.model, tier: "cheap", user: "<question>\nq\n</question>", tools: tools(), anchors: new Anchors(), maxPaise: 50, maxTokens: 800 });
    expect(out).toMatchObject({ text: "It is set in startSession.", steps: 1 });
    expect(m.sent).toHaveLength(1);
  });

  it("must answer at its last step, with no tool, however much it wants to look", async () => {
    const m = scripted([{ text: "looking", calls: [{ name: "grep", args: { pattern: "x" } }] }]);
    const out = await investigate({ model: m.model, tier: "cheap", user: "<question>\nq\n</question>", tools: tools(), anchors: new Anchors(), maxPaise: 50, maxTokens: 800 });
    expect(m.sent).toHaveLength(LOOK_STEPS_MAX);
    expect(m.sent.slice(0, -1).every((s) => s.toolChoice === "auto")).toBe(true);
    expect(m.sent.at(-1)!.toolChoice).toBe("none");
    expect(String(m.sent.at(-1)!.messages.at(-1)!.content)).toContain("This is your last step: answer now");
    expect(out.steps).toBe(LOOK_STEPS_MAX);
  });

  it("answers once most of the money is spent, so the answer can still be paid for", async () => {
    const m = scripted([{ text: "looking", calls: [{ name: "grep", args: { pattern: "x" } }] }]);
    // Each turn costs 1; with 3 to spend, the third turn is past 60% and is the answer.
    const out = await investigate({ model: m.model, tier: "cheap", user: "q", tools: tools(), anchors: new Anchors(), maxPaise: 3, maxTokens: 800 });
    expect(m.sent.map((s) => s.toolChoice)).toEqual(["auto", "auto", "none"]);
    expect(out.steps).toBe(3);
  });

  it("when the money's guard refuses the next look, answers from what it read with the results cut down until the answer fits", async () => {
    const sent: Array<{ toolChoice: unknown; longest: number }> = [];
    let n = 0;
    const call = (async (input: { toolChoice?: unknown; messages: Array<{ role: string; content: unknown }> }) => {
      const longest = Math.max(0, ...input.messages.filter((m) => m.role === "tool").map((m) => String(m.content).length));
      sent.push({ toolChoice: input.toolChoice, longest });
      n += 1;
      if (n === 1) return { text: "", paise: 1, model: "m", toolCalls: [{ id: "c1", name: "read_file", arguments: JSON.stringify({ path: "big.ts" }) }] };
      // The guard prices a call at its worst case: one carrying the whole read is refused, before anything is spent.
      if (longest > 2_500) throw new BudgetExceeded({ needPaise: 120, spentPaise: 1, budgetPaise: 100, purpose: "front.code_answer", model: "m", scope: "call" });
      return { text: "It is in big.ts.", paise: 1, model: "m" };
    }) as never;
    const big = { defs: [{ name: "read_file", description: "", parameters: {} }], exec: async () => ({ ok: true, content: "Read big.ts.", data: Array.from({ length: 400 }, (_, k) => `${k + 1}: line ${k}`).join("\n") }) };
    const out = await investigate({ model: { userId: "alice", call }, tier: "cheap", user: "q", tools: big, anchors: new Anchors(), maxPaise: 100, maxTokens: 800 });
    expect(out.text).toBe("It is in big.ts.");
    // The look that was refused, the answer with all of it (refused), then with 2,000 characters of it (answered).
    expect(sent.map((x) => x.toolChoice)).toEqual(["auto", "auto", "none", "none"]);
    expect(sent.at(-1)!.longest).toBeLessThan(2_100);
    expect(out.paise).toBe(2);
  });

  it("takes back words it streamed when the turn goes to a tool after all", async () => {
    const m = scripted([{ text: "Let me check", calls: [{ name: "grep", args: { pattern: "x" } }] }, { text: "Done." }]);
    const events: string[] = [];
    const call = m.model.call as unknown as (i: { onText?: (p: string) => void }) => Promise<unknown>;
    const streaming = { ...m.model, call: (async (i: { onText?: (p: string) => void }) => { const r = await call(i) as { text: string }; i.onText?.(r.text); return r; }) as never };
    await investigate({ model: streaming, tier: "cheap", user: "q", tools: tools(), anchors: new Anchors(), maxPaise: 50, maxTokens: 800, onText: (p) => events.push(`text:${p}`), onReset: () => events.push("reset") });
    expect(events).toEqual(["text:Let me check", "reset", "text:Done."]);
  });
});

describe("what a chat has read", () => {
  it("is kept on the thread, newest last, once each, at most SEEN_KEPT", () => {
    let t = newThread("alice", "p", "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1", 0);
    t = afterTurn(t, { question: "q1", cites: [], located: null, now: 1, seen: ["a.ts:1-40", "b.ts:10-20"] });
    t = afterTurn(t, { question: "q2", cites: [], located: null, now: 2, seen: ["a.ts:1-40", "c.ts:5-9"] });
    expect(t.seen).toEqual(["b.ts:10-20", "a.ts:1-40", "c.ts:5-9"]);
    for (let i = 0; i < 30; i++) t = afterTurn(t, { question: `q${i}`, cites: [], located: null, now: 3 + i, seen: [`f${i}.ts:1-2`] });
    expect(t.seen).toHaveLength(SEEN_KEPT);
    expect(t.seen!.at(-1)).toBe("f29.ts:1-2");
  });
});

describe("a path written with folders the file is not in", () => {
  const all = ["liveViewMain.js", "agent.js", "src/a/index.ts", "src/b/index.ts", "runner/ws.js"];
  it("is put right when exactly one file has its name, and left when none or several do", () => {
    const text = "See `live/liveViewMain.js`, guide/agent.js:12, `runner/ws.js`, `pkg/index.ts` and `nope/missing.js`.";
    expect(unknownPaths(text, (p) => all.includes(p))).toEqual(["live/liveViewMain.js", "guide/agent.js", "pkg/index.ts", "nope/missing.js"]);
    const out = fixPaths(text, all);
    expect(out.text).toBe("See `liveViewMain.js`, agent.js:12, `runner/ws.js`, `pkg/index.ts` and `nope/missing.js`.");
    expect(out.fixed).toEqual([["live/liveViewMain.js", "liveViewMain.js"], ["guide/agent.js", "agent.js"]]);
    // A line cited in it is then checked in the right file.
    const anchors = new Anchors();
    anchors.read("agent.js", "a\n".repeat(20));
    expect(checkCitations(out.text, anchors).kept).toEqual(["agent.js:12"]);
  });
});
