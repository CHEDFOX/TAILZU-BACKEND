/**
 * A PROJECT'S CHAT AS ONE LOOP (src/code/chat/converse.ts): the project card in front of the model for every message, the code read with tools, a
 * job started or a question asked by the model's own tool call, the truth checked by code after; no router reads the message first (decide.ts).
 */
import { describe, expect, it } from "vitest";
import { admitsMiss, CHANGE_OWED, converse, CHAT_ACTS, MAKE_CHANGE, saidAgain, unnarrate } from "../src/code/chat/converse.js";
import { buildBook } from "../src/code/project/book.js";
import { newThread } from "../src/code/chat/threads.js";
import { decide, decideMessage } from "../src/front/decide.js";
import { buildTierTable } from "../src/code/brain/tiers.js";
import { ctx as frontCtx, decideJson, inProject, model, noModel } from "./front-rig.js";

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
    // Reading, a book chapter and a job are offered; nothing that writes. A question back with answers to tap is for a change: this is answered.
    expect(m.sent[0]!.tools).toEqual(["read_file", "grep", ...CHAT_ACTS.map((d) => d.name).filter((n) => n !== "show_file" && n !== "ask_person")]);
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
    const out = await converse({ ...base, message: "fix it", change: true }, { brain, look, startJob: async () => { throw new Error("no job for this"); } }, m.model);
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

describe("anything a person asks of the project", () => {
  // A made-up key in the shape of one, put together here so that no key-shaped text sits in the repository (GitHub's push protection reads it).
  const FAKE_KEY = ["sk", "or", "v1", "0123456789abcdef".repeat(4)].join("-");
  const files: Record<string, string> = {
    "supabase/migrations/0060_project_book.sql": "-- The project book\nalter table public.code_brain add column if not exists book jsonb;\n",
    "deploy/ship.sh": `#!/bin/sh\n# Ships the server: pull, build, restart.\nexport OPENROUTER_API_KEY=${FAKE_KEY}\ndocker compose up -d\n`,
    ".env": "OPENROUTER_API_KEY=sk-or-v1-real\n",
  };
  const read = async (p: string) => files[p] ?? null;

  it("shows a file exactly as it is below the answer, to copy; the model does not retype it", async () => {
    const m = scripted([{ calls: [{ name: "show_file", args: { path: "supabase/migrations/0060_project_book.sql" } }] }, { text: "Run this in the Supabase SQL editor." }]);
    const out = await converse({ ...base, message: "give me the database code for the book" }, { brain, look, read }, m.model);
    expect(out.text).toBe("Run this in the Supabase SQL editor.\n\n**`supabase/migrations/0060_project_book.sql`**\n\n```sql\n-- The project book\nalter table public.code_brain add column if not exists book jsonb;\n\n```");
    expect(m.sent[0]!.tools).toContain("show_file");
  });

  it("never shows a file of secrets, and takes a secret out of any file it shows", async () => {
    const m = scripted([
      { calls: [{ name: "show_file", args: { path: ".env" } }, { name: "show_file", args: { path: "deploy/ship.sh" } }] },
      { text: "The key goes in the server's .env." },
    ]);
    const out = await converse({ ...base, message: "show me the env and the deploy script" }, { brain, look, read }, m.model);
    expect(out.text).not.toContain("sk-or-v1-real");
    expect(out.text).not.toContain(FAKE_KEY.slice(0, 12));
    expect(out.text).toContain("docker compose up -d");
  });

  it("looks on the web for what the project cannot say, at most a few calls a message", async () => {
    const ran: string[] = [];
    const web = { defs: [{ name: "web_search", description: "search", parameters: {} }], run: async (name: string, a: Record<string, unknown>) => { ran.push(`${name}:${String(a.query)}`); return "Resend: 3,000 emails a month free. Postmark: 100 a month free."; } };
    const m = scripted([
      { calls: [1, 2, 3, 4].map((n) => ({ name: "web_search", args: { query: `email providers ${n}` } })) },
      { text: "Resend or Postmark; Resend's free tier is the larger." },
    ]);
    const out = await converse({ ...base, message: "which email provider could we use?" }, { brain, look, web }, m.model);
    expect(ran).toHaveLength(3);
    expect(out.text).toContain("Resend");
  });
});

describe("when a first look does not settle it", () => {
  it("climbs to the code tier once, told what was read, and its answer takes the first one's place", async () => {
    const tiers: string[] = [];
    const turns = [
      { text: "I could not find where the limit message is written." },
      { text: "It says: You've used what X0 Bot may spend on your messages today." },
    ];
    let n = 0;
    const call = (async (input: { tier: string; messages: Array<{ content: unknown }> }) => {
      tiers.push(input.tier);
      const t = turns[Math.min(n++, turns.length - 1)]!;
      return { text: t.text, paise: 1, model: "m", toolCalls: [] };
    }) as never;
    const out = await converse({ ...base, message: "what does it say at the daily limit?" }, { brain, look }, { userId: "alice", call });
    expect(tiers).toEqual(["cheap", "code"]);
    expect(out.text).toBe("It says: You've used what X0 Bot may spend on your messages today.");
    expect(admitsMiss("The cookie is set in startSession.")).toBe(false);
  });
});

describe("a change laid out, and a turn that fell short", () => {
  it("offers to make the change it laid out, and marks the turn the person reacted to or asked again", async () => {
    const m = scripted([{ text: "Add the toggle in src/settings.tsx and save it in the user's settings.\nNext: which settings? | dark by default?" }]);
    const out = await converse({ ...base, message: "add a dark mode toggle", change: true }, { brain, look }, m.model);
    expect(out.next[0]).toBe(MAKE_CHANGE);
    // The words the button sends are a hand-off to the rules.
    const thread = { ...newThread("alice", "p1", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 0), history: [{ q: "where is the session cookie set?", a: "In startSession.", at: 1 }] };
    const again = scripted([{ text: "In src/auth/session.ts, startSession sets it." }]);
    const out2 = await converse({ ...base, thread, message: "where is the session cookie set? the file please" }, { brain, look }, again.model);
    expect(out2.thread!.history.at(-2)).toMatchObject({ q: "where is the session cookie set?", f: "rephrase" });
    const out3 = await converse({ ...base, thread, message: "??", meant: "Explain your last answer again, simpler." }, { brain, look }, scripted([{ text: "Simply: startSession." }]).model);
    expect(out3.thread!.history.at(-2)).toMatchObject({ f: "reaction" });
    expect(saidAgain("how do I deploy it", "what is the cookie")).toBe(false);
  });

  it("owes the job when a change was asked: told once when it ends with words, it starts the job then", async () => {
    const lasts: string[] = [];
    const turns = [
      { text: "The toggle goes in src/settings.tsx, saved with the user's settings." },
      { calls: [{ name: "start_job", args: { task: "Add a dark mode toggle to src/settings.tsx, saved with the user's settings, with a test." } }] },
    ];
    let n = 0;
    const call = (async (input: { messages: Array<{ content: unknown }> }) => {
      lasts.push(String(input.messages.at(-1)!.content));
      const t = turns[Math.min(n++, turns.length - 1)]! as { text?: string; calls?: Array<{ name: string; args: unknown }> };
      return { text: t.text ?? "", paise: 1, model: "m", toolCalls: (t.calls ?? []).map((c, i) => ({ id: `c${n}-${i}`, name: c.name, arguments: JSON.stringify(c.args) })) };
    }) as never;
    const tasks: string[] = [];
    const out = await converse({ ...base, message: "add a dark mode toggle", change: true }, {
      brain, look, startJob: async (task) => { tasks.push(task); return { id: "j1", branch: "xode/dark-mode", state: "queued", budgetPaise: 3000 }; },
    }, { userId: "alice", call });
    expect(lasts[1]).toBe(CHANGE_OWED);
    expect(tasks).toEqual(["Add a dark mode toggle to src/settings.tsx, saved with the user's settings, with a test."]);
    expect(out.job).toMatchObject({ id: "j1" });
    expect(out.next).not.toContain(MAKE_CHANGE);
    // A question owes nothing but the answer: one call.
    const plain = scripted([{ text: "In src/settings.tsx." }]);
    await converse({ ...base, message: "where are the settings?" }, { brain, look }, plain.model);
    expect(plain.sent).toHaveLength(1);
  });

  it("researches a question for the web with the project in mind", async () => {
    const m = scripted([{ text: "Resend fits: it is a plain HTTP API like the one the server uses for Supabase." }]);
    await converse({ ...base, message: "which email provider should we use?", research: "standard" }, { brain, look }, m.model);
    expect(m.sent[0]!.user).toContain("(Read as a question for the web: research it, standard, with this project in mind, and name the sources.)");
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
  it("decides only what is done: a change is the loop's to start, marked; a bare 'fix it' is a question back; anything else is the loop", async () => {
    expect(await read("where is the session cookie set?")).toMatchObject({ route: "code_answer", reasons: expect.arrayContaining(["agent_chat"]), budgetPaise: 500 });
    expect(await read("what is this project for?")).toMatchObject({ reasons: expect.arrayContaining(["agent_chat"]) });
    const fix = await read("fix it");
    expect(fix.clarify).toBeTruthy();
    expect(fix.reasons).not.toContain("agent_chat");
    const change = await read("add a dark mode toggle to the settings page");
    expect(change).toMatchObject({ route: "code_answer", reasons: expect.arrayContaining(["agent_chat", "agent_change"]) });
    // A UI to make is the design road; a question for the web is the loop's, marked, so it is researched with the project in mind.
    expect((await read("show me how a pricing page would look")).route).toBe("artifact");
    expect(await read("is there a good library for date pickers in react")).toMatchObject({ route: "code_answer", reasons: expect.arrayContaining(["agent_research"]), depth: "standard" });
    // "Make that change" after a plan is a job at once, with the chat's plan as its task.
    const handOff = await read("make that change", inProject({ projectId: "p1", recent: [{ said: "add a dark mode toggle", did: "code_question" }] }));
    expect(handOff).toMatchObject({ route: "code_job", handoff: true });
    // Off, or outside a project, the router and its roads as before.
    expect((await read("where is the session cookie set?", inProject({ projectId: "p1" }), false)).reasons).not.toContain("agent_chat");
    expect((await read("where is the session cookie set?", frontCtx())).reasons).not.toContain("agent_chat");
  });

  it("sends every change to the loop marked as one, sure or not: the loop starts the job with what it found, or does what was really asked", async () => {
    for (const confidence of [0.5, 0.92]) {
      const d = await decide("give me the database code to copy paste", inProject({ projectId: "p1" }), {
        call: model(() => decideJson({ intent: "code_task", confidence })).call, tiers, fx: 88, jobBudgetPaise: 3000, agentChat: true,
      });
      expect(d).toMatchObject({ route: "code_answer", reasons: expect.arrayContaining(["agent_change"]) });
    }
    const m = scripted([{ calls: [{ name: "start_job", args: { task: "Add a dark mode toggle to src/settings.tsx, saved in the user's settings, with a test." } }] }]);
    const out = await converse({ ...base, message: "add a dark mode toggle", change: true }, { brain, look, startJob: async () => ({ id: "j", branch: "xode/dark", state: "queued", budgetPaise: 3000 }) }, m.model);
    expect(m.sent[0]!.user).toContain("(Read as a change to make: start_job");
    expect(out.job).toMatchObject({ branch: "xode/dark" });
  });

  it("reads a message in the light of what the project is and what the chat said last", () => {
    const msg = decideMessage("do the same for logout", inProject({
      projectId: "p1", projectName: "alice/shop", projectAbout: "A small shop with a cart and a checkout.", lastAnswer: "startSession sets the sid cookie in src/auth/session.ts:3.",
    }), null);
    expect(msg).toContain("What the project is: A small shop with a cart and a checkout.");
    expect(msg).toContain("The chat's last answer began:\n<<<\nstartSession sets the sid cookie in src/auth/session.ts:3.\n>>>");
  });

  it("tells the loop what a reaction asks of the last answer", async () => {
    const c = inProject({ projectId: "p1", recent: [{ said: "where is the session cookie set?", did: "code_question" }] });
    const d = await read("??", c);
    expect(d.reasons).toContain("agent_chat");
    expect(d.reask).toMatch(/explain/i);
  });
});
