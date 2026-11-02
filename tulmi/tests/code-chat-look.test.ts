/**
 * LOOKING BEFORE ANSWERING (src/code/chat/look.ts): the chat asks for what it still needs with read-only tools, is told what it has read after each
 * step, cites only lines it read, answers at the last step whatever happens, and the thread keeps what it read for the next question.
 */
import { describe, expect, it } from "vitest";
import { Anchors, checkCitations, fixPaths, unknownPaths } from "../src/code/chat/cite.js";
import { gapsOf, investigate, leakedCall, LOOK_STEPS_MAX, promisesMore, questionOf, settle, stripLeak, type LookTools } from "../src/code/chat/look.js";
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

  it("does not take a promise to look further as the answer: it is told to do it or answer, and goes on", async () => {
    const m = scripted([
      { text: "I have the setup steps. Let me read the rest of DEPLOY.md for the deploy part." },
      { calls: [{ name: "read_file", args: { path: "DEPLOY.md" } }] },
      { text: "1. Pull the branch. 2. Run ./deploy/ship.sh." },
    ]);
    const out = await investigate({ model: m.model, tier: "cheap", user: "q", tools: tools(), anchors: new Anchors(), maxPaise: 50, maxTokens: 800 });
    expect(out.text).toBe("1. Pull the branch. 2. Run ./deploy/ship.sh.");
    expect(String(m.sent[1]!.messages.at(-1)!.content)).toMatch(/^Do that now with your tools, or answer now/);
    expect(promisesMore("The server listens on 8080; let me know if you want the logs.")).toBe(false);
  });

  it("does not take a tool call written as words as the answer, and never shows its markup", async () => {
    const leak = "I have the steps. Let me read the rest of DEPLOY.md.\n\n<invoke>\n<parameter>path</parameter string=\"true\">DEPLOY.md</parameter>\n</invoke>";
    const m = scripted([{ text: leak }, { calls: [{ name: "read_file", args: { path: "DEPLOY.md" } }] }, { text: "Run ./deploy/ship.sh on the server." }]);
    const out = await investigate({ model: m.model, tier: "cheap", user: "q", tools: tools(), anchors: new Anchors(), maxPaise: 50, maxTokens: 800 });
    expect(out.text).toBe("Run ./deploy/ship.sh on the server.");
    expect(String(m.sent[1]!.messages.at(-1)!.content)).toMatch(/^That was a tool call written as words/);
    expect(stripLeak(leak)).toBe("I have the steps. Let me read the rest of DEPLOY.md.");
    expect(leakedCall('```json\n{"name": "grep", "arguments": {}}\n```')).toBe(true);
    expect(leakedCall("Use the `<Parameter>` component.")).toBe(false);
    // A model's own call tokens (DeepSeek's DSML, its tool-call markers) are calls too.
    const dsml = "I have the deploy command. Let me read the rest.\n\n<｜DSML｜ calls>\n<｜DSML｜ invoke name=\"read_file\">\n</｜DSML｜ invoke>";
    expect(stripLeak(dsml)).toBe("I have the deploy command. Let me read the rest.");
    expect(leakedCall("<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function")).toBe(true);
    expect(leakedCall("Run `a | b` and see x < y.")).toBe(false);
  });

  it("at its last step, a promise or a written call is no answer: one more call, with no tools, for the answer from what was read", async () => {
    const m = scripted([
      { calls: [{ name: "grep", args: { pattern: "x" } }] }, { calls: [{ name: "grep", args: { pattern: "y" } }] },
      { text: "Let me read the rest of DEPLOY.md.\n<｜DSML｜ invoke name=\"read_file\">" }, { text: "Run ./deploy/ship.sh on the server." },
    ]);
    // Each turn costs 1; with 3 to spend the third is past 60% and is the last step.
    const out = await investigate({ model: m.model, tier: "cheap", user: "q", tools: tools(), anchors: new Anchors(), maxPaise: 3, maxTokens: 800 });
    expect(out.text).toBe("Run ./deploy/ship.sh on the server.");
    expect(m.sent.at(-1)!.toolChoice).toBe("none");
    expect(String(m.sent.at(-1)!.messages.at(-1)!.content)).toBe("Answer now from what you have read, with no tool call.");
    expect(out.steps).toBe(3);
  });

  it("is told once what the turn owes when it ends with words alone, and keeps its first words if words come back", async () => {
    const m = scripted([{ text: "The toggle goes in src/settings.tsx, saved with the user's settings." }, { text: "Nothing to add." }]);
    const out = await investigate({ model: m.model, tier: "cheap", user: "q", tools: tools(), anchors: new Anchors(), maxPaise: 50, maxTokens: 800, owed: "Start the job." });
    expect(m.sent).toHaveLength(2);
    expect(String(m.sent[1]!.messages.at(-1)!.content)).toBe("Start the job.");
    expect(out.text).toBe("The toggle goes in src/settings.tsx, saved with the user's settings.");
  });

  it("on the last step of a turn that owes an act, it may only act: no more reading, the act offered and taken", async () => {
    const started: string[] = [];
    const acts = {
      defs: [{ name: "start_job", description: "start", parameters: {} }],
      exec: async (_name: string, a: Record<string, unknown>) => { started.push(String(a.task)); return { content: "", end: "Started." }; },
    };
    const m = scripted([{ calls: [{ name: "grep", args: { pattern: "toggle" } }] }, { calls: [{ name: "start_job", args: { task: "Add the toggle." } }] }]);
    const out = await investigate({ model: m.model, tier: "cheap", user: "q", tools: tools(), anchors: new Anchors(), maxPaise: 50, maxTokens: 800, acts, owed: "Start the job.", steps: 2 });
    expect(m.sent.map((s) => s.toolChoice)).toEqual(["auto", "auto"]);
    expect(m.sent[1]!.tools).toEqual(["start_job"]);
    expect(String(m.sent[1]!.messages.at(-1)!.content)).toContain("This is your last step: no more reading. Start the job.");
    expect(started).toEqual(["Add the toggle."]);
    expect(out).toMatchObject({ text: "Started.", ended: "start_job", steps: 2 });
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

describe("the review of an answer before it goes (code_check)", () => {
  const user = "<message>\nwhy is the cookie never set?\n</message>";
  /** A model whose answers are scripted, and whose review (purpose front.code_check) says `review`. */
  function withReview(turns: Parameters<typeof scripted>[0], review: string) {
    const m = scripted(turns);
    const reviews: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
    const call = (async (input: { purpose?: string; messages: Array<{ role: string; content: unknown }>; onText?: (p: string) => void }) => {
      if (input.purpose === "front.code_check") { reviews.push({ messages: structuredClone(input.messages) }); return { text: review, paise: 1, model: "m", toolCalls: [] }; }
      const r = await (m.model.call as unknown as (x: unknown) => Promise<{ text: string }>)(input);
      if (r.text) input.onText?.(r.text);
      return r;
    }) as never;
    return { ...m, reviews, model: { userId: "alice", call } };
  }
  const stream = () => {
    const shown: string[] = [];
    let resets = 0;
    return { shown, resets: () => resets, onText: (p: string) => { shown.push(p); }, onReset: () => { resets += 1; shown.length = 0; } };
  };

  it("sends an answer drawn from the code to a reviewer with the question, the answer and what was read; OK, and it goes as it was", async () => {
    const m = withReview([{ calls: [{ name: "read_file", args: { path: "src/auth/session.ts" } }] }, { text: "startSession sets it at src/auth/session.ts:2." }], "OK");
    const s = stream();
    const out = await investigate({ model: m.model, tier: "cheap", user, tools: tools(), anchors: new Anchors(), maxPaise: 50, maxTokens: 800, check: true, onText: s.onText, onReset: s.onReset });
    expect(out.text).toBe("startSession sets it at src/auth/session.ts:2.");
    expect(m.reviews).toHaveLength(1);
    const asked = String(m.reviews[0]!.messages.at(-1)!.content);
    expect(asked).toContain("<question>\nwhy is the cookie never set?\n</question>");
    expect(asked).toContain("<answer>\nstartSession sets it at src/auth/session.ts:2.\n</answer>");
    expect(asked).toMatch(/<read>\nsrc\/auth\/session\.ts:1-3/);
    expect(s.shown.join("")).toBe(out.text);
    expect(s.resets()).toBe(0);
  });

  it("settles the gaps the review found with the tools, takes back the answer shown, and writes it again", async () => {
    const m = withReview([
      { calls: [{ name: "grep", args: { pattern: "startSession" } }] },
      { text: "Turn the cookie switch on; no build is needed." },
      { calls: [{ name: "read_file", args: { path: "src/auth/session.ts" } }] },
      { text: "Turning the switch on would not help: it is read before it arrives." },
    ], "CHECK: where the switch gets its value, and whether that is before it is read at startup\nCHECK: who calls startSession");
    const t = tools();
    const s = stream();
    const out = await investigate({ model: m.model, tier: "cheap", user, tools: t, anchors: new Anchors(), maxPaise: 50, maxTokens: 800, check: true, onText: s.onText, onReset: s.onReset });
    expect(out.text).toMatch(/^Turning the switch on would not help/);
    expect(t.ran).toEqual(["grep", "read_file"]);
    expect(s.resets()).toBeGreaterThan(0);
    expect(s.shown.join("")).toBe(out.text);
    const told = m.sent[2]!.messages.at(-1)!.content as string;
    expect(told).toBe(settle(["where the switch gets its value, and whether that is before it is read at startup", "who calls startSession"]));
    expect(m.reviews).toHaveLength(1);
    expect(out.ranOut).toBe(false);
  });

  it("is not run for an answer made without looking, when not asked for, or when the money is mostly spent", async () => {
    const noLook = withReview([{ text: "Hi! Ask me about the code." }], "CHECK: x");
    await investigate({ model: noLook.model, tier: "cheap", user, tools: tools(), anchors: new Anchors(), maxPaise: 50, maxTokens: 800, check: true });
    expect(noLook.reviews).toHaveLength(0);
    const off = withReview([{ calls: [{ name: "grep", args: { pattern: "x" } }] }, { text: "Answer." }], "CHECK: x");
    await investigate({ model: off.model, tier: "cheap", user, tools: tools(), anchors: new Anchors(), maxPaise: 50, maxTokens: 800 });
    expect(off.reviews).toHaveLength(0);
    const poor = withReview([{ calls: [{ name: "grep", args: { pattern: "x" } }] }, { text: "Answer." }], "CHECK: x");
    await investigate({ model: poor.model, tier: "cheap", user, tools: tools(), anchors: new Anchors(), maxPaise: 2, maxTokens: 800, check: true });
    expect(poor.reviews).toHaveLength(0);
  });

  it("keeps the answer when the review fails, and reads the gaps in any of the ways a model writes them", async () => {
    const down = scripted([{ calls: [{ name: "grep", args: { pattern: "x" } }] }, { text: "The answer." }]);
    const call = (async (input: { purpose?: string }) => {
      if (input.purpose === "front.code_check") throw new Error("down");
      return (down.model.call as unknown as (x: unknown) => Promise<unknown>)(input);
    }) as never;
    const out = await investigate({ model: { userId: "alice", call }, tier: "cheap", user, tools: tools(), anchors: new Anchors(), maxPaise: 50, maxTokens: 800, check: true });
    expect(out.text).toBe("The answer.");
    expect(gapsOf("OK")).toEqual([]);
    expect(gapsOf("CHECK: a\n- CHECK: b\n2. **CHECK:** c\nCHECK: d")).toEqual(["a", "b", "c"]);
    expect(questionOf("<project>x</project>\n\n<message>\nwhy?\n</message>")).toBe("why?");
  });
});
