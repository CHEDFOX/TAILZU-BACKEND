/**
 * A PROJECT'S CHAT AS ONE LOOP (src/code/chat/converse.ts): the project card in front of the model for every message, the code read with tools, a
 * job started or a question asked by the model's own tool call, the truth checked by code after; no router reads the message first (decide.ts).
 */
import { describe, expect, it } from "vitest";
import { converse, CHAT_ACTS, unnarrate } from "../src/code/chat/converse.js";
import { buildBook } from "../src/code/project/book.js";
import { newThread } from "../src/code/chat/threads.js";
import { decide } from "../src/front/decide.js";
import { buildTierTable } from "../src/code/brain/tiers.js";
import { ctx as frontCtx, inProject, noModel } from "./front-rig.js";

type Sent = { tools: string[]; toolChoice: unknown; system: string; user: string };

function scripted(turns: Array<{ text?: string; calls?: Array<{ name: string; args: Record<string, unknown> }> }>) {
  const sent: Sent[] = [];
  let n = 0;
  const call = (async (input: { tools?: Array<{ name: string }>; toolChoice?: unknown; messages: Array<{ role: string; content: unknown }> }) => {
    sent.push({ tools: (input.tools ?? []).map((t) => t.name), toolChoice: input.toolChoice, system: String(input.messages[0]!.content), user: String(input.messages[1]!.content) });
    const t = turns[Math.min(n, turns.length - 1)]!;
    n += 1;
    return { text: t.text ?? "", paise: 1, model: "m", toolCalls: (t.calls ?? []).map((c, i) => ({ id: `c${n}-${i}`, name: c.name, arguments: JSON.stringify(c.args) })) };
  }) as never;
  return { sent, model: { userId: "alice", call } };
}

const book = buildBook({
  project: "alice/shop", commit: "f".repeat(40), now: 0, view: { welcome: "A small shop.", structure: null, features: [], conventions: null, baseline: null } as never,
  files: [], map: null, commits: null, history: [], merged: null, open: null, milestones: null, docs: {},
  issues: [{ number: 7, title: "Checkout fails on Safari", body: "", labels: ["bug"], milestone: null, comments: 4, updatedAt: 0, url: "u7" }],
  owner: { next: "Gift cards, then UPI", at: 0 },
});
const brain = {
  status: async () => ({ status: "ready", welcome: "A small shop.", features: [] }),
  book: async () => book,
  paths: async () => ["src/cart.ts", "src/checkout/pay.ts"],
} as never;
const FILE = ["export function pay(order) {", "  return stripe.charge(order.total);", "}"];
const look = {
  defs: ["read_file", "grep", "edit_file"].map((name) => ({ name, description: name, parameters: {} })),
  exec: async (c: { name: string }) => (c.name === "read_file" ? { ok: true, content: "Read.", data: FILE.map((l, i) => `${i + 1}: ${l}`).join("\n") } : { ok: false, content: "no" }),
};
const base = { userId: "alice", project: { id: "p1", fullName: "alice/shop" }, thread: null, tier: "cheap" as const, maxPaise: 300, now: 1 };

describe("one loop", () => {
  it("has the project card in front of it, and answers from it with no tool when it says enough", async () => {
    const m = scripted([{ text: "Next is gift cards, then UPI, as you said; #7 (Safari checkout) is open.\nNext: start gift cards? | look at #7?" }]);
    const out = await converse({ ...base, message: "What should we do" }, { brain, look }, m.model);
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]!.user).toContain("(the owner) Next, in the owner's words: Gift cards, then UPI");
    expect(m.sent[0]!.user).toContain("#7 Checkout fails on Safari");
    expect(m.sent[0]!.user).toMatch(/<message>\nWhat should we do\n<\/message>/);
    // Reading, a book chapter, a job and a question back are all offered; nothing that writes.
    expect(m.sent[0]!.tools).toEqual(["read_file", "grep", ...CHAT_ACTS.map((d) => d.name)]);
    expect(out).toMatchObject({ text: "Next is gift cards, then UPI, as you said; #7 (Safari checkout) is open.", next: ["start gift cards?", "look at #7?"], steps: 1 });
  });

  it("starts a job by its own tool call, with the task it wrote, and the thread keeps the job", async () => {
    const m = scripted([{ calls: [{ name: "start_job", args: { task: "Add a gift card field to checkout in src/checkout/pay.ts, with a test." } }] }]);
    const tasks: string[] = [];
    const thread = newThread("alice", "p1", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 0);
    const out = await converse({ ...base, thread, message: "add gift cards to checkout" }, {
      brain, look, startJob: async (task) => { tasks.push(task); return { id: "j1", branch: "xode/gift-cards", state: "queued", budgetPaise: 3000 }; },
    }, m.model);
    expect(tasks).toEqual(["Add a gift card field to checkout in src/checkout/pay.ts, with a test."]);
    expect(out.job).toMatchObject({ id: "j1", branch: "xode/gift-cards" });
    expect(out.thread!.jobs!.at(-1)).toMatchObject({ id: "j1" });
  });

  it("asks the person back by its own tool call, and a task that names nothing is refused", async () => {
    const m = scripted([{ calls: [{ name: "start_job", args: { task: "fix it" } }] }, { calls: [{ name: "ask_person", args: { question: "Fix what: the Safari checkout (#7) or the cart?", options: ["#7", "the cart", 3] } }] }]);
    const out = await converse({ ...base, message: "fix it" }, { brain, look, startJob: async () => { throw new Error("no job for this"); } }, m.model);
    expect(out.clarify).toEqual({ question: "Fix what: the Safari checkout (#7) or the cart?", options: ["#7", "the cart"] });
    expect(out.job).toBeUndefined();
  });

  it("reads a book chapter in full, then answers; a path it got wrong is put right and a line it never read is taken out", async () => {
    const m = scripted([
      { calls: [{ name: "project_book", args: { chapter: "direction" } }, { name: "read_file", args: { path: "src/checkout/pay.ts" } }] },
      { text: "pay() charges the total at `checkout/pay.ts` (src/checkout/pay.ts:2); see also src/checkout/pay.ts:40." },
    ]);
    const out = await converse({ ...base, message: "how is the order paid?" }, { brain, look }, m.model);
    expect(out.text).toBe("pay() charges the total at `src/checkout/pay.ts` (src/checkout/pay.ts:2); see also src/checkout/pay.ts.");
    expect(out.cites).toEqual(["src/checkout/pay.ts:2"]);
    expect(out.notes).toEqual(["I took out 1 reference to code I could not find."]);
  });
});

describe("the words", () => {
  it("start with the answer: a lead-in or a first line that tells of the looking is taken off", () => {
    expect(unnarrate("I have enough to answer: the timer is in pill.js.\n\nMore.")).toBe("The timer is in pill.js.\n\nMore.");
    expect(unnarrate("Let me check the pill.\nThe timer is in pill.js.")).toBe("The timer is in pill.js.");
    expect(unnarrate("Let me know if you want more.")).toBe("Let me know if you want more.");
    expect(unnarrate("The timer is in pill.js.")).toBe("The timer is in pill.js.");
  });
});

describe("the router, in a project's chat as one loop", () => {
  const tiers = buildTierTable();
  const read = (m: string, c = inProject({ projectId: "p1" }), agentChat = true) => decide(m, c, { call: noModel().call, tiers, fx: 88, jobBudgetPaise: 3000, agentChat });
  it("decides only what is done: a change is a job, a bare 'fix it' is a question back, anything else is the loop", async () => {
    expect(await read("where is the session cookie set?")).toMatchObject({ route: "code_answer", reasons: expect.arrayContaining(["agent_chat"]), budgetPaise: 300 });
    expect(await read("what is this project for?")).toMatchObject({ reasons: expect.arrayContaining(["agent_chat"]) });
    const fix = await read("fix it");
    expect(fix.clarify).toBeTruthy();
    expect(fix.reasons).not.toContain("agent_chat");
    const change = await read("add a dark mode toggle to the settings page");
    expect(change.route).toBe("code_job");
    // A UI to make and fresh facts from the web are actions of their own: the design and research roads, as before.
    expect((await read("show me how a pricing page would look")).route).toBe("artifact");
    expect((await read("is there a good library for date pickers in react")).route).toBe("research");
    // Off, or outside a project, the router and its roads as before.
    expect((await read("where is the session cookie set?", inProject({ projectId: "p1" }), false)).reasons).not.toContain("agent_chat");
    expect((await read("where is the session cookie set?", frontCtx())).reasons).not.toContain("agent_chat");
  });

  it("tells the loop what a reaction asks of the last answer", async () => {
    const c = inProject({ projectId: "p1", recent: [{ said: "where is the session cookie set?", did: "code_question" }] });
    const d = await read("??", c);
    expect(d.reasons).toContain("agent_chat");
    expect(d.reask).toMatch(/explain/i);
  });
});
