/**
 * THE BOTS APP'S SHELL (screens/shell.ts, routes/botsShell.ts, src/shell):
 *
 *   - one feed across Code bot jobs, answers bots gave, payments, Keybot's words and connected-app tasks, money per row, by bot and type
 *   - search across projects, chats, notes, files and bots; a UPI link read, never trusted when it cannot be read whole; Google's lines read
 *   - a QR code for the window's "pay on your phone", matching a reference encoder
 *   - the routes: the person's own, the routing preview answers without answering, an ask is written down, a receipt only when they paid
 *   - the glance the phone's widgets read
 *   - the screens draw real data, keep the kit's rules on both clients, and every button is wired
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { ActionSpec, Node } from "../../shared/types/sdui.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

// Whoever the test says is calling: the token is the user id; none is nobody.
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const { feedOf, filterFeed, stageOf, weekOf, wordsDay, dayLabel, clockOf } = await import("../src/shell/feed.js");
const { searchAll, snippetOf, turnOf } = await import("../src/shell/search.js");
const { upiOf, calendarOf, googleTasksOf } = await import("../src/shell/parse.js");
const { qrOf, qrPath } = await import("../src/shell/qr.js");
const { MemoryEventStore } = await import("../src/shell/events.js");
const { registerBotsShellRoutes, glanceOf } = await import("../src/routes/botsShell.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, FIXED_NOW, IST, SAMPLE_BOTS, SAMPLE_JOBS } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const texts = (n: Node): string[] => walk(n).filter((x) => x.type === "Text").map((x) => String(x.props?.content));
const json = (n: unknown): string => JSON.stringify(n);
const UPI = "upi://pay?pa=freshbasket@okhdfcbank&pn=Fresh%20Basket&am=1240.00&cu=INR&tn=This%20week%27s%20groceries";

// ------------------------------------------------------------------ the feed

const JOBS = [
  { id: "j1", task: "Fix cart total rounding", state: "running" as const, spentPaise: 420, createdAt: FIXED_NOW - HOUR, updatedAt: FIXED_NOW - 5 * MIN, projectId: "p1", phase: "work" },
  { id: "j2", task: "Fixed a failing check on PR #128", state: "done" as const, spentPaise: 110, createdAt: FIXED_NOW - 9 * HOUR, updatedAt: FIXED_NOW - 8 * HOUR, projectId: "p1" },
  { id: "j3", task: "Old job", state: "done" as const, spentPaise: 9000, createdAt: FIXED_NOW - 20 * DAY, updatedAt: FIXED_NOW - 20 * DAY },
];
const TASKS = [
  { id: "t1", state: "waiting" as const, title: "Move the dentist to Friday 10 am?", steps: [], approval: { id: "a1", connector: "google-calendar", preview: "Update event: Dentist" }, createdAt: FIXED_NOW - HOUR, updatedAt: FIXED_NOW - HOUR },
  { id: "t2", state: "done" as const, title: "Added 3 workouts to your calendar", steps: [{ at: FIXED_NOW - 12 * HOUR, text: "Google Calendar: create event" }], approval: null, createdAt: FIXED_NOW - 12 * HOUR, updatedAt: FIXED_NOW - 12 * HOUR },
];
const EVENTS = [
  { id: "e1", kind: "ask" as const, bot: "travel", title: "Mumbai to Goa under ₹5,000", paise: 240, amountPaise: 0, payee: "", at: FIXED_NOW - 2 * HOUR },
  { id: "e2", kind: "paid" as const, bot: "plan", title: "Electricity bill", paise: 0, amountPaise: 184000, payee: "BESCOM", at: FIXED_NOW - 30 * HOUR },
];
const WORDS = [{ day: "2026-10-28", at: FIXED_NOW - 4 * HOUR, words: 412, apps: ["WhatsApp", "Gmail"] }];
const feed = () => feedOf({ now: FIXED_NOW, tzOffsetMinutes: IST, jobs: JOBS, tasks: TASKS, events: EVENTS, words: WORDS, projects: { p1: "Storefront" } });

describe("one feed across everything the bots did", () => {
  it("every kind of record, newest first, money per row, the last week only", () => {
    const rows = feed();
    expect(rows.map((r) => r.id)).toEqual(["job:j1", "task:t1", "ask:e1", "words:2026-10-28", "job:j2", "task:t2", "pay:e2"]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by["job:j1"]).toMatchObject({ mark: "working", money: "₹4.20 so far", stage: { at: 2, of: 5, name: "Build" }, sub: "Doing it for you · step 3 of 5 · Storefront", open: { screenId: "bots.code.job", params: { id: "j1" } } });
    expect(by["task:t1"]).toMatchObject({ mark: "needs", bot: "plan", open: { screenId: "bots.approve", params: { task: "t1" } } });
    expect(by["task:t2"]!.bot).toBe("plan");
    expect(by["task:t2"]!.money).toBeUndefined();
    expect(by["ask:e1"]).toMatchObject({ bot: "travel", money: "₹2.40", type: "ask" });
    expect(by["pay:e2"]).toMatchObject({ type: "payment", money: "₹1,840 paid", title: "Electricity bill. You pressed pay by UPI.", open: { screenId: "bots.approve", params: { receipt: "e2" } } });
    expect(by["words:2026-10-28"]).toMatchObject({ bot: "keybot", money: "Free", title: "Wrote 412 words by voice", sub: "Keybot · WhatsApp, Gmail" });
  });
  it("filters by bot and by type; the week counts what was done and spent", () => {
    const rows = feed();
    expect(filterFeed(rows, { bot: "plan" }).map((r) => r.id)).toEqual(["task:t1", "task:t2", "pay:e2"]);
    expect(filterFeed(rows, { kind: "payments" }).map((r) => r.id)).toEqual(["pay:e2"]);
    expect(filterFeed(rows, { kind: "words" }).map((r) => r.id)).toEqual(["words:2026-10-28"]);
    expect(filterFeed(rows, { bot: "all", kind: "all" })).toHaveLength(rows.length);
    expect(weekOf(rows, FIXED_NOW - 2 * DAY, 125)).toEqual({ done: 4, paise: 420 + 240 + 110, minutesSaved: 125 });
  });
  it("stages, days, clocks and Keybot's day in the person's own time", () => {
    expect(stageOf("verify")).toEqual({ at: 3, of: 5, name: "Check" });
    expect(stageOf(undefined).name).toBe("Understand");
    expect(clockOf(FIXED_NOW, IST)).toBe("7:40 pm");
    expect(dayLabel(FIXED_NOW - DAY, FIXED_NOW, IST)).toBe("Yesterday");
    expect(dayLabel(FIXED_NOW - 2 * DAY, FIXED_NOW, IST)).toBe("Monday");
    const day = wordsDay([{ at: FIXED_NOW - 5 * HOUR, words: 100, app: "gmail" }, { at: FIXED_NOW - 5 * HOUR + MIN, words: 40, app: "whatsapp" }, { at: FIXED_NOW, words: 10 }], IST);
    expect(day).toEqual({ words: 150, byHour: [{ hour: 14, words: 140 }, { hour: 19, words: 10 }], byApp: [{ app: "Gmail", words: 100 }, { app: "WhatsApp", words: 40 }] });
  });
});

// ------------------------------------------------------------------ search, reading, the QR

describe("search, and reading what other parts hand over", () => {
  const open = { screenId: "bots.note" };
  it("every word must match; a name ranks over the words under it; empty finds nothing", () => {
    const r = searchAll("salon", {
      notes: [{ id: "n1", title: "Salon list, Indiranagar", open, at: 1 }, { id: "n2", title: "Weekend", text: "the salon on 12th main", open, at: 5 }, { id: "n3", title: "GST", open }],
      bots: [{ id: "b1", title: "Glow bot", sub: "Books your salon every 6 weeks", open }],
    });
    expect(r.groups.notes.map((h) => h.id)).toEqual(["n1", "n2"]);
    expect(r.groups.notes[1]!.snippet).toBe("the salon on 12th main");
    expect(r.groups.bots.map((h) => h.id)).toEqual(["b1"]);
    expect(r.total).toBe(3);
    expect(searchAll("salon indiranagar", { notes: [{ id: "n1", title: "Salon list, Indiranagar", open }, { id: "n2", title: "Salon", open }] }).total).toBe(1);
    expect(searchAll(" ", { notes: [{ id: "n1", title: "x", open }] }).total).toBe(0);
    expect(snippetOf(`${"word ".repeat(40)}salon ${"tail ".repeat(40)}`, ["salon"], 60)).toMatch(/^….*salon.*…$/);
    expect(turnOf("said: Book the salon | bot: Booked for Sat")).toEqual([{ who: "you", text: "Book the salon" }, { who: "bot", text: "Booked for Sat" }]);
  });
  it("a UPI link is read whole or not at all", () => {
    expect(upiOf(UPI)).toMatchObject({ vpa: "freshbasket@okhdfcbank", name: "Fresh Basket", amountPaise: 124000, note: "This week's groceries" });
    expect(upiOf(upiOf(UPI)!.link)).toEqual(upiOf(UPI));
    expect(upiOf("upi://pay?pa=nobody&am=10")).toBeNull();
    expect(upiOf("upi://pay?pa=a@okaxis&am=0")).toBeNull();
    expect(upiOf("upi://pay?pa=a@okaxis&am=10000001")).toBeNull();
    expect(upiOf("upi://pay?pa=a@okaxis&am=10&cu=USD")).toBeNull();
    expect(upiOf("https://evil.example/pay?pa=a@okaxis&am=10")).toBeNull();
    expect(upiOf(42)).toBeNull();
  });
  it("Google Calendar's and Google Tasks' lines as events and to-dos", () => {
    expect(calendarOf("3 events today:\n- Today 10:00–10:30, Storefront standup with Rohan and Meera (id: a1)\n- Today, all day, Diwali (id: b2)\nnoise")).toEqual([
      { start: 600, end: 630, title: "Storefront standup", with: "with Rohan and Meera", when: "10:00–10:30" },
      { start: null, end: null, title: "Diwali", when: "All day" },
    ]);
    expect(googleTasksOf("2 tasks:\n- Renew car insurance, due Friday (id: x)\n- Pay school fees, overdue since Mon 26 Oct — term 2 (id: y)")).toEqual([
      { title: "Renew car insurance", due: "Friday" }, { title: "Pay school fees", due: "Mon 26 Oct", overdue: true, notes: "term 2" },
    ]);
  });
  it("the QR code matches a reference encoder (python qrcode 7.4.2, level M, byte mode)", () => {
    const q = qrOf("HELLO", { mask: 0 })!;
    expect(q.version).toBe(1);
    expect(q.modules.map((r) => r.map((b) => (b ? 1 : 0)).join(""))).toEqual([
      "111111100111001111111", "100000101011001000001", "101110100010001011101", "101110100011001011101", "101110101010101011101",
      "100000100110101000001", "111111101010101111111", "000000000101100000000", "101010100101000010010", "101010000110001000010",
      "000001100110100011111", "101011010110001000010", "011001110110101010100", "000000001011010100110", "111111100001011100111",
      "100000100011110110000", "101110101011011100111", "101110100100001100110", "101110101010100010101", "100000100110001010010",
      "111111101010101100111",
    ]);
    const pay = qrOf(UPI)!;
    expect(pay.version).toBe(6);
    expect(qrPath(pay)).toMatch(/^M4 4h7v1h-7z/);
    expect(qrOf("x".repeat(300))).toBeNull();
  });
});

// ------------------------------------------------------------------ the routes

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const who = (u: string) => ({ authorization: `Bearer ${u}` });

function served(o: { bots?: unknown; askReply?: unknown; askStatus?: number } = {}) {
  const app = Fastify();
  const events = new MemoryEventStore();
  const asked: unknown[] = [];
  const codeJobs = SAMPLE_JOBS.map((j) => ({ ...j, userId: "u1", projectId: "p1", branch: "b", placement: "none", checkpoint: { stepIndex: 0, headSha: "", notes: "", ...(j.state === "running" ? { agent: { v: 1, phase: "verify" } } : {}) } }));
  const deps = {
    rateLimit: RL, media: null, artifacts: null,
    jobs: { listJobs: async (u: string, n: number) => (u === "u1" ? codeJobs.slice(0, n) : []) },
    code: { store: { listProjects: async () => [{ id: "p1", userId: "u1", fullName: "aanya/storefront", createdAt: 1 }] } },
    connectors: {
      tasks: { list: async (u: string) => (u === "u1" ? [{ ...TASKS[0]!, approval: { ...TASKS[0]!.approval!, tool: "update_event", risk: "write" } }] : []) },
      store: { listConnections: async () => [] }, hub: { call: async () => ({ ok: true, text: "" }) },
    },
    bots: o.bots ?? null,
  };
  app.post("/v1/ask", async (req, reply) => { asked.push(req.body); return reply.code(o.askStatus ?? 200).send(o.askReply ?? {}); });
  registerBotsShellRoutes(app, deps as never, {
    events, now: () => FIXED_NOW, minutesSaved: async () => 90,
    voiceRows: async (u, since) => (u.id === "u1" ? [{ at: FIXED_NOW - 3 * HOUR, words: 300, app: "gmail" }].filter((r) => r.at >= since) : []),
  });
  return { app, events, asked };
}

describe("the shell's routes", () => {
  it("are the signed-in person's own", async () => {
    const { app } = served();
    for (const [method, url] of [["GET", "/v1/shell/activity"], ["GET", "/v1/shell/glance"], ["POST", "/v1/shell/route"], ["GET", "/v1/shell/search?q=x"]] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
    }
  });
  it("activity: jobs, tasks and Keybot's words in one list, filtered on request, with the week", async () => {
    const { app } = served();
    const r = await app.inject({ method: "GET", url: `/v1/shell/activity?tz=${IST}`, headers: who("u1") });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.rows.map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining(["job:" + SAMPLE_JOBS[1]!.id, "task:t1", "words:2026-10-28"]));
    expect(b.rows.find((x: { id: string }) => x.id === "job:" + SAMPLE_JOBS[1]!.id).stage).toEqual({ at: 3, of: 5, name: "Check" });
    expect(b.week.minutesSaved).toBe(90);
    const words = await app.inject({ method: "GET", url: `/v1/shell/activity?tz=${IST}&type=words`, headers: who("u1") });
    expect(words.json().rows.map((x: { type: string }) => x.type)).toEqual(["words"]);
    expect((await app.inject({ method: "GET", url: "/v1/shell/activity", headers: who("u2") })).json().rows).toEqual([]);
  });
  it("route: who will answer, decided without answering; a bot the person chose is echoed", async () => {
    const calls: string[] = [];
    const bots = {
      target: async (_u: string, bot: string) => { calls.push(`target:${bot}`); return { kind: "bot", bot: { slug: "travel", name: "Travel bot" }, by: "rules", confidence: 0.9, paise: 0, message: "", reasons: [] }; },
      get: async (_u: string, slug: string) => { calls.push(`get:${slug}`); return { slug, name: "Plan bot" }; },
      ask: async () => { calls.push("ask"); throw new Error("must not answer"); },
    };
    const { app, asked } = served({ bots });
    const r = await app.inject({ method: "POST", url: "/v1/shell/route", headers: who("u1"), payload: { message: "14 Nov ko Pune ki train dekh lo" } });
    expect(r.json()).toMatchObject({ slug: "travel", say: "Travel bot will take this", hint: "Tap to send · Travel bot shows the plan before it books", color: "#3E6E8E" });
    const chosen = await app.inject({ method: "POST", url: "/v1/shell/route", headers: who("u1"), payload: { message: "x", bot: "plan" } });
    expect(chosen.json()).toMatchObject({ slug: "plan", by: "chosen" });
    expect(calls).toEqual(["target:any", "get:plan"]);
    expect(asked).toEqual([]);
    expect((await app.inject({ method: "POST", url: "/v1/shell/route", headers: who("u1"), payload: {} })).statusCode).toBe(400);
  });
  it("route with the bots platform off: the rules alone, for nothing", async () => {
    const { app } = served();
    const r = await app.inject({ method: "POST", url: "/v1/shell/route", headers: who("u1"), payload: { message: "what's a good name for a cat?" } });
    expect(r.json()).toMatchObject({ slug: "tailzu", name: "Tailzu" });
  });
  it("ask: POST /v1/ask as the person, the answer written down for Activity, a payment link handed back", async () => {
    const { app, asked, events } = served({
      bots: { target: async () => null },
      askReply: { result: { text: "Here is the plan.", paise: 240 }, bot: { slug: "travel", name: "Travel bot" }, answer: { opens: [{ label: "Pay", url: UPI }], approvals: [{}] } },
    });
    const r = await app.inject({ method: "POST", url: "/v1/shell/ask", headers: who("u1"), payload: { message: "Book the Pune train", bot: "travel", device: "phone" } });
    expect(r.statusCode).toBe(200);
    expect(asked).toEqual([{ message: "Book the Pune train", device: "phone", mode: "text", bot: "travel" }]);
    expect(r.json().shell).toMatchObject({ bot: { slug: "travel", name: "Travel bot" }, text: "Here is the plan.", paise: 240, needs: 1, upi: upiOf(UPI)!.link });
    expect(await events.list("u1", 0)).toMatchObject([{ kind: "ask", bot: "travel", title: "Book the Pune train", paise: 240 }]);
  });
  it("ask: a refusal is passed through and nothing is written down", async () => {
    const { app, events } = served({ askStatus: 429, askReply: { code: "quota_exceeded", message: "That's all for today." } });
    const r = await app.inject({ method: "POST", url: "/v1/shell/ask", headers: who("u1"), payload: { message: "hi" } });
    expect(r.statusCode).toBe(429);
    expect(r.json().code).toBe("quota_exceeded");
    expect(await events.list("u1", 0)).toEqual([]);
  });
  it("receipts: only for a payment link read whole, and only the person's own", async () => {
    const { app } = served();
    expect((await app.inject({ method: "GET", url: "/v1/shell/started", headers: who("u2") })).json()).toEqual({ started: false });
    expect((await app.inject({ method: "POST", url: "/v1/shell/receipts", headers: who("u2"), payload: { upi: "upi://pay?pa=x&am=1" } })).statusCode).toBe(400);
    const made = await app.inject({ method: "POST", url: "/v1/shell/receipts", headers: who("u2"), payload: { upi: UPI, bot: "plan" } });
    expect(made.statusCode).toBe(201);
    const { receipt } = made.json();
    expect(receipt).toMatchObject({ kind: "paid", bot: "plan", payee: "Fresh Basket", amountPaise: 124000, title: "This week's groceries" });
    expect((await app.inject({ method: "GET", url: `/v1/shell/receipts/${receipt.id}`, headers: who("u2") })).json().receipt.id).toBe(receipt.id);
    expect((await app.inject({ method: "GET", url: `/v1/shell/receipts/${receipt.id}`, headers: who("u1") })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/v1/shell/started", headers: who("u2") })).json()).toEqual({ started: true });
  });
  it("glance: bots and their state, what needs the person, Keybot's words today, the job working now", async () => {
    const { app } = served();
    const g = (await app.inject({ method: "GET", url: `/v1/shell/glance?tz=${IST}`, headers: who("u1") })).json();
    expect(g).toMatchObject({ v: 1, needs: 1, ask: { bot: "Plan bot", question: "Move the dentist to Friday 10 am?" }, keybot: { wordsToday: 300 }, job: { id: SAMPLE_JOBS[1]!.id, stage: 4, of: 5, stageName: "Check" } });
    expect(g.bots.find((b: { slug: string }) => b.slug === "code")).toMatchObject({ state: "working", color: "#4F7A3A" });
    expect(g.bots[0]).toMatchObject({ slug: "plan", state: "needs" });
    expect(glanceOf({ now: FIXED_NOW, tz: IST, jobs: [], tasks: [], bots: [], words: 0 })).toMatchObject({ needs: 0, job: null, keybot: { wordsToday: 0 } });
  });
});

// ------------------------------------------------------------------ the screens

const req = (screenId: string, client: "phone" | "desktop", params: Record<string, string | number | boolean> = {}) => ({
  screenId, client, params, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya Sharma" },
  can: new Set(["BotsKit"]), desk: { pages: client === "desktop", notes: client === "desktop" },
});
const ACTIVITY = { now: FIXED_NOW, week: { done: 4, paise: 770, minutesSaved: 125 }, rows: feed() };
const presses = (n: Node): ActionSpec[] => walk(n).flatMap((x) => [x.on?.onPress, x.on?.onSubmit]).filter(Boolean) as ActionSpec[];
const both = ["phone", "desktop"] as const;

describe("the shell's screens", () => {
  it("home: a person with nothing of their own and nothing done lands on the empty home", async () => {
    const quiet = { bots: SAMPLE_BOTS.filter((b) => b.builtin), jobs: [], tasks: [] };
    for (const client of both) {
      const fresh = await buildBotsScreen(req("bots.home", client), fakeDeps({ ...quiet, api: { "GET /v1/shell/started": { started: false } } }));
      expect(texts(fresh.root!)).toContain("Hi Aanya, I'm Blip");
      expect(json(fresh.root)).toContain('"screenId":"bots.make"');
      const going = await buildBotsScreen(req("bots.home", client), fakeDeps({ ...quiet, api: { "GET /v1/shell/started": { started: true } } }));
      expect(texts(going.root!)).not.toContain("Hi Aanya, I'm Blip");
      // A read that fails is never taken as "new".
      expect(texts((await buildBotsScreen(req("bots.home", client), fakeDeps(quiet))).root!)).not.toContain("Hi Aanya, I'm Blip");
    }
  });
  it("activity: the feed with money per row, needs-you choices, filters by bot and type", async () => {
    const deps = fakeDeps({ api: { [`GET /v1/shell/activity?tz=${IST}`]: ACTIVITY } });
    const phone = await buildBotsScreen(req("bots.activity", "phone"), deps);
    expect(texts(phone.root!)).toEqual(expect.arrayContaining(["Activity", "Now", "Today", "Code bot needs you", "Wrote 412 words by voice"]));
    expect(texts(phone.root!).some((t) => t.includes("₹1,840 paid"))).toBe(true);
    const desk = await buildBotsScreen(req("bots.activity", "desktop"), deps);
    const words = texts(desk.root!);
    expect(words).toEqual(expect.arrayContaining(["This week · 4 jobs done · ₹7.70 spent · 2 h saved", "₹4.20 so far", "Free", "₹1,840 paid", "Payments", "All bots"]));
    expect(json(desk.root)).toContain('"in":["ftype",["all","payments"]]');
    expect(json(desk.root)).toContain('"/v1/code/jobs/' + SAMPLE_JOBS[0]!.id + '/answer"');
    // Unreadable: says so, and offers to try again.
    expect(texts((await buildBotsScreen(req("bots.activity", "phone"), fakeDeps())).root!)).toContain("Couldn't load your activity.");
  });
  it("ask: who will answer is shown before anything is sent, and sending goes through the shell", async () => {
    const route = { slug: "travel", name: "Travel bot", color: "#3E6E8E", say: "Travel bot will take this", hint: "Tap to send · Travel bot shows the plan before it books", by: "rules" };
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const s = await buildBotsScreen(req("bots.ask", "phone", { message: "14 Nov ko Pune ki shaam wali train" }), fakeDeps({ api: { "POST /v1/shell/route": route }, calls }));
    expect(calls).toEqual([{ method: "POST", path: "/v1/shell/route", body: { message: "14 Nov ko Pune ki shaam wali train" } }]);
    expect(s.state).toMatchObject({ ask: "14 Nov ko Pune ki shaam wali train", route });
    const j = json(s.root);
    expect(j).toContain('"path":"/v1/shell/ask"');
    expect(j).toContain('"path":"/v1/shell/route"');
    expect(j).toContain('"screenId":"bots.attach"');
    expect(texts(s.root!)).toEqual(expect.arrayContaining(["Ask any bot", "Travel bot", "will take this", "Or try"]));
    const desk = await buildBotsScreen(req("bots.ask", "desktop"), fakeDeps());
    expect(json(desk.root)).toContain('"kind":"dictate"');
    expect(desk.state).toMatchObject({ ask: "", route: null });
  });
  it("ask: the answer, and a payment it filled in goes to Approve", async () => {
    const s = await buildBotsScreen(req("bots.ask", "phone", { message: "Pay the grocer", answer: "Filled in ₹1,240.", bot: "plan", upi: UPI, needs: 1 }), fakeDeps());
    expect(texts(s.root!)).toEqual(expect.arrayContaining(["Pay the grocer", "Filled in ₹1,240.", "Plan bot answered", "Pay ₹1,240 to Fresh Basket?", "1 change waits for your yes"]));
    expect(json(s.root)).toContain('"screenId":"bots.approve","params":{"upi":"upi://pay?pa=freshbasket@okhdfcbank');
  });
  it("search: projects, chats, notes, files and bots, each opening its own place", async () => {
    const hit = (id: string, kind: string, title: string, open: { screenId: string; params?: Record<string, string> }) => ({ id, kind, title, open });
    const result = {
      q: "salon", total: 3,
      groups: { projects: [hit("project:p", "projects", "Salon booking app", { screenId: "bots.code", params: { project: "p" } })], chats: [], notes: [hit("note:n", "notes", "Salon list", { screenId: "bots.note", params: { id: "n" } })], files: [{ ...hit("file:f", "files", "salon.pdf", { screenId: "bots.ask", params: { file: "f", fileName: "salon.pdf" } }), attachment: { id: "f", kind: "pdf" } }], bots: [] },
    };
    for (const client of both) {
      const s = await buildBotsScreen(req("bots.search", client, { q: "salon" }), fakeDeps({ api: { [`GET /v1/shell/search?q=salon&tz=${IST}`]: result } }));
      expect(texts(s.root!)).toEqual(expect.arrayContaining(["Salon booking app", "Salon list", "Ask your bots about “salon”"]));
      const j = json(s.root);
      expect(j).toContain('"screenId":"bots.note","params":{"id":"n"}');
      expect(j).toContain('"attachment":{"id":"f","kind":"pdf"}');
    }
    expect(texts((await buildBotsScreen(req("bots.search", "phone"), fakeDeps())).root!)).toContain("Search everything");
  });
  it("approve: you press pay; Tailzu opens UPI and writes a receipt only when told", async () => {
    for (const client of both) {
      const s = await buildBotsScreen(req("bots.approve", client, { upi: UPI, bot: "plan" }), fakeDeps());
      expect(texts(s.root!)).toEqual(expect.arrayContaining(["Pay ₹1,240 to Fresh Basket for this week's groceries?", "You press pay in your UPI app. Plan bot never pays on its own."]));
      const j = json(s.root);
      expect(j).toContain('"path":"/v1/shell/receipts"');
      if (client === "phone") expect(presses(s.root!).some((a) => json(a).includes('"kind":"openUrl","url":"upi://pay?pa=freshbasket@okhdfcbank'))).toBe(true);
      else expect(walk(s.root!).some((n) => n.props?.accessibilityLabel === "UPI payment code")).toBe(true);
    }
    const task = await buildBotsScreen(req("bots.approve", "phone", { task: "t1" }), fakeDeps({ api: { "GET /v1/tasks": { tasks: [{ ...TASKS[0]!, approval: { ...TASKS[0]!.approval!, tool: "update_event" } }] } } }));
    expect(texts(task.root!)).toEqual(expect.arrayContaining(["Move the dentist to Friday 10 am?", "Update event: Dentist", "Yes, do it"]));
    expect(json(task.root)).toContain('"path":"/v1/tasks/t1/approve","body":{"approvalId":"a1"}');
  });
  it("tasks, today, meeting notes and a meeting draw their data; offline keeps asks for later", async () => {
    const api = {
      [`GET /v1/shell/tasks?tz=${IST}`]: { rows: feed().filter((r) => r.type !== "words"), upcoming: { connected: false, todos: null }, took: 3, total: 6, minutesSaved: 70 },
      [`GET /v1/shell/today?tz=${IST}`]: { calendar: { connected: true, events: [{ start: 600, end: 630, title: "Storefront standup", when: "10:00–10:30" }] }, rows: [], keybot: { words: 1284, minutesSaved: 32, byHour: [{ hour: 14, words: 400 }], byApp: [{ app: "Gmail", words: 540 }] } },
      "GET /v1/notes?limit=100": { notes: [{ id: "n1", status: "ready", startedAt: new Date(FIXED_NOW - HOUR).toISOString(), durationSeconds: 2520, words: 1, title: "Salon booking app review", summary: "No-shows.", people: [{ label: "Speaker 1", name: "Kavya Rao" }], organised: true }] },
      "GET /v1/notes/n1": { note: { id: "n1", status: "ready", startedAt: new Date(FIXED_NOW - HOUR).toISOString(), durationSeconds: 2520, words: 1, title: "Salon booking app review", summary: "No-shows.", people: [{ label: "Speaker 1", name: "Kavya Rao" }], organised: true, highlights: [{ speaker: "Speaker 1", text: "Weekends have the most no-shows." }], transcript: [{ at: 42, speaker: "Speaker 1", text: "Weekends pe no-shows." }] } },
    };
    const deps = fakeDeps({ api, tasks: [{ id: "t1", state: "waiting", title: "Move the dentist to Friday 10 am?", approval: { id: "a1", connector: "google-calendar", preview: "Update event: Dentist" }, createdAt: FIXED_NOW - HOUR, updatedAt: FIXED_NOW - HOUR }] });
    const tasks = await buildBotsScreen(req("bots.tasks", "desktop"), deps);
    expect(texts(tasks.root!)).toEqual(expect.arrayContaining(["Bots took 3 of 6 today · 1 h 10 min saved", "Connect Google Tasks", "Do it for me", "I'll do it"]));
    const today = await buildBotsScreen(req("bots.today", "desktop"), deps);
    expect(texts(today.root!)).toEqual(expect.arrayContaining(["Today", "Wednesday, 28 October", "Storefront standup", "1,284", "Gmail"]));
    const notes = await buildBotsScreen(req("bots.notes", "desktop"), deps);
    expect(texts(notes.root!)).toEqual(expect.arrayContaining(["Salon booking app review", "42 min", "Summary ready"]));
    expect(json(notes.root)).toContain('"kind":"notes.toggle"');
    const note = await buildBotsScreen(req("bots.note", "desktop", { id: "n1" }), deps);
    expect(texts(note.root!)).toEqual(expect.arrayContaining(["Weekends have the most no-shows.", "Kavya Rao", "00:42"]));
    const off = await buildBotsScreen(req("bots.offline", "phone"), deps);
    expect(texts(off.root!)).toEqual(expect.arrayContaining(["No internet right now", "Keybot · basic mode"]));
    expect(json(off.root)).toContain('"kind":"appendState","path":"queued"');
    // The window's sidebar takes Today and Meeting notes to these pages.
    expect(json(today.root)).toContain('"screenId":"bots.notes"');
  });
  it("every screen keeps the kit's rules on both clients, with data and without", async () => {
    const api = { [`GET /v1/shell/activity?tz=${IST}`]: ACTIVITY, "GET /v1/shell/started": { started: false } };
    for (const id of ["bots.home", "bots.empty-home", "bots.activity", "bots.ask", "bots.search", "bots.tasks", "bots.approve", "bots.offline", "bots.today", "bots.notes", "bots.note"]) {
      for (const client of both) {
        for (const deps of [fakeDeps(), fakeDeps({ api })]) {
          const s = await buildBotsScreen(req(id, client, id === "bots.approve" ? { upi: UPI } : {}), deps);
          expect(lintTree(s.root!), `${id} ${client}`).toEqual([]);
        }
      }
    }
  });
});
