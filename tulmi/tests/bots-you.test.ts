/**
 * The You tab (screens/you.ts, routes/botsYou.ts, src/you): its screens on both clients, the month's spend from the real records, the stored
 * limit and the two places it is kept (a job's budget, a bot's answer), what pings the person, the download link, and the tab ring.
 */
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const UID = "00000000-0000-4000-8000-00000000aaaa";
vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});
vi.mock("../src/auth/supabase.js", async (orig) => ({
  ...(await orig<typeof import("../src/auth/supabase.js")>()),
  supabase: () => null,
  resolveUser: async (a: string | undefined) => (a === "Bearer good" ? { id: UID, email: "aanya@example.in" } : null),
}));

import { BotError } from "../src/bots/index.js";
import { buildBotsScreen } from "../src/experience/bots/index.js";
import { FIXED_NOW, IST, fakeDeps } from "../src/experience/bots/fixtures.js";
import { lintTree, walk } from "../src/experience/bots/lint.js";
import { liveFrom, loadLive, setSpendSource } from "../src/experience/bots/live.js";
import { resetConfigForTests } from "../src/config.js";
import { PushEngine, setPushGate } from "../src/push/engine.js";
import { PUSH_DEFAULTS } from "../src/push/defaults.js";
import { MemoryPushStore } from "../src/push/store.js";
import { registerBotsYouRoutes } from "../src/routes/botsYou.js";
import { exportLink, exportLinkUser } from "../src/you/data.js";
import { Spending, holdJobsToMonth, wrapBots } from "../src/you/limits.js";
import { summaryLine, verdict } from "../src/you/push.js";
import { DEFAULT_SETTINGS, applyPatch, cleanSettings, inQuietHours } from "../src/you/settings.js";
import { spendReport } from "../src/you/spend.js";
import { MemoryYouStore, setYouStoreForTests } from "../src/you/store.js";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const MONTH_START = Date.UTC(2026, 9, 1) - IST * MIN;
const RESETS = Date.UTC(2026, 10, 1) - IST * MIN;
const S = structuredClone(DEFAULT_SETTINGS);
const byBot = [{ bot: "code", paise: 14_200 }, { bot: "keybot", paise: 1800 }, { bot: "plan", paise: 1500 }, { bot: "gym-bot", paise: 900 }];

const ANSWERS: Record<string, unknown> = {
  "GET /v1/you?tz=330": {
    plan: { name: "Pro", active: true },
    spend: { monthPaise: 18_400, limitPaise: 50_000, leftPaise: 31_600, perDayPaise: 657, resetsAt: RESETS, byBot, stopAtLimit: true },
    apps: { enabled: true, connected: [{ id: "google-calendar", name: "Google Calendar", usedBy: ["Plan bot", "Gym bot"], lastUsedAt: FIXED_NOW - 2 * MIN }], github: { repos: 2 }, alone: 3 },
    computers: { online: [{ name: "Aanya's MacBook", busy: false, allowRun: true }], offline: 1, helped: { jobs: 6, minutes: 200 } },
    settings: S, exportUrl: "https://api.tailzu.space/v1/you/export/file?t=x", language: "hinglish",
  },
  "GET /v1/you/spend?tz=330": {
    report: {
      month: "2026-10", monthStart: MONTH_START, resetsAt: RESETS, daysInMonth: 31, today: 28, monthPaise: 18_400, limitPaise: 50_000, leftPaise: 31_600,
      stopAtLimit: false, perDayPaise: 657, projectionPaise: 20_367, byBot, byDay: Array.from({ length: 31 }, (_, i) => (i < 28 ? 600 + (i % 5) * 50 : 0)),
      busiest: { day: 14, paise: 2100 }, biggest: [{ id: "7c1d2e3f-0000-4000-8000-000000000002", task: "Checkout redesign", paise: 1960, at: FIXED_NOW - 14 * DAY, minutes: 42 }],
    },
    settings: S,
  },
  "GET /v1/you/billing?tz=330": {
    plan: { name: "Pro", active: true, store: "razorpay", renews: true, until: FIXED_NOW + 15 * DAY, since: FIXED_NOW - 100 * DAY, price: "₹299", period: "a month", paidBy: "UPI autopay", cancel: "razorpay", manageUrl: null },
    invoices: [{ id: "inv_1", number: "TZ-2610-0412", date: FIXED_NOW - 16 * DAY, amountPaise: 29_900, amount: "₹299", status: "paid", url: "https://rzp.io/i/a", what: "Tailzu Pro" }],
    month: { monthPaise: 18_400, limitPaise: 50_000 }, email: "aanya@example.in",
  },
  "GET /v1/you/computers": {
    online: [{ deviceId: "mbp", name: "Aanya's MacBook", os: "darwin", allowRun: true, busy: true, projects: "all", liveOnly: false, container: false }],
    offline: [{ deviceId: "office", name: "Office PC", os: "win32", lastSeen: FIXED_NOW - 2 * DAY }], helped: { jobs: 6, minutes: 200 },
  },
  "GET /v1/you/notify?tz=330": { settings: S, today: { done: 5, needs: 1, spentPaise: 1100 }, line: "5 things done, 1 needs you, ₹11 spent." },
  "GET /v1/you/account": {
    bots: [{ slug: "code", name: "Code bot", colour: "", builtin: true }, { slug: "gym-bot", name: "Gym bot", colour: "pine", builtin: false }],
    projects: ["checkout-web", "storefront"], notes: 212, keys: 3, plan: { active: true, store: "razorpay", renews: true, until: FIXED_NOW + 15 * DAY }, exportUrl: null,
  },
  "GET /v1/you/apps": {
    enabled: true, github: { repos: 2 },
    connected: [{ id: "google-calendar", name: "Google Calendar", category: "Calendar", level: "draft", lastUsedAt: FIXED_NOW - DAY, usedBy: ["Plan bot"] }],
    more: [{ id: "google-docs", name: "Google Docs", category: "Docs", oneLine: "Write a new Google Doc.", usedBy: [] }],
  },
  "GET /v1/you/apps/google-calendar": {
    app: { id: "google-calendar", name: "Google Calendar", category: "Calendar", oneLine: "See your schedule.", auth: "oauth", provider: "google", connected: false, level: "look", lastUsedAt: null },
    bots: [{ slug: "plan", name: "Plan bot", colour: "", purpose: "Plans your day", builtin: true, linked: true }, { slug: "gym-bot", name: "Gym bot", colour: "pine", purpose: "Workouts", builtin: false, linked: false }],
    can: ["Read your events"], cant: ["Share your calendar"],
  },
};

const IDS: Array<[string, Record<string, string>?]> = [
  ["bots.you"], ["bots.budget"], ["bots.billing"], ["bots.computer"], ["bots.notify"], ["bots.privacy"], ["bots.delete-account"], ["bots.apps"],
  ["bots.app-connect", { id: "google-calendar" }], ["bots.settings"],
];

const build = (screenId: string, client: "phone" | "desktop", api: Record<string, unknown> | undefined, params?: Record<string, string>) =>
  buildBotsScreen({
    screenId, client, tzOffsetMinutes: IST, user: { id: UID, name: "Aanya Rao", email: "aanya@example.in" }, can: new Set(["BotsKit"]),
    desk: { pages: client === "desktop", notes: false }, ...(params ? { params } : {}),
  }, fakeDeps(api ? { api } : {}));
const texts = (root: unknown) => walk(root as never).map((n) => String((n as { props?: { content?: unknown } }).props?.content ?? ""));

describe("the You screens", () => {
  for (const [id, params] of IDS) {
    for (const client of ["phone", "desktop"] as const) {
      it(`${id} draws the person's own numbers on the ${client}, lint-clean, and an honest state when its read fails`, async () => {
        const s = await build(id, client, ANSWERS, params);
        expect(s.screenId).toBe(id);
        expect(lintTree(s.root!)).toEqual([]);
        expect(texts(s.root).join(" ")).not.toContain("on its way");
        const failed = await build(id, client, undefined, params);
        expect(lintTree(failed.root!)).toEqual([]);
      });
    }
  }

  it("You shows the month by bot from the records, and Budget the limit and the switch", async () => {
    const you = texts((await build("bots.you", "phone", ANSWERS)).root);
    expect(you).toContain("₹184 of ₹500");
    expect(you.some((t) => t.startsWith("Code ₹142"))).toBe(true);
    const budget = await build("bots.budget", "desktop", ANSWERS);
    expect(texts(budget.root)).toContain("Stop bots at the limit");
    expect(texts(budget.root)).toContain("Busiest: ₹21 on 14 Oct");
    expect(budget.state).toMatchObject({ stop: false, limit: "500" });
  });

  it("every write goes to a real route", async () => {
    const all = JSON.stringify(await Promise.all(IDS.map(([id, p]) => build(id, "phone", ANSWERS, p))));
    for (const path of ["/v1/you/settings", "/v1/billing/razorpay/cancel", "/v1/you/computers/office", "/v1/you/data/delete", "/v1/account", "/v1/connectors/google-calendar/connect", "/v1/bots/gym-bot/connectors/google-calendar"]) {
      expect(all).toContain(path);
    }
  });
});

describe("the month's spend", () => {
  it("adds the Code bot's jobs and every other bot's answers, in the person's own days", () => {
    const r = spendReport({
      jobs: [
        { id: "a", task: "Fix cart", state: "done", spentPaise: 1000, createdAt: FIXED_NOW - 2 * HOUR, updatedAt: FIXED_NOW - HOUR },
        { id: "b", task: "Old", state: "done", spentPaise: 9999, createdAt: MONTH_START - DAY, updatedAt: MONTH_START - MIN },
      ],
      rows: [{ bot: "plan", at: MONTH_START + 30 * MIN, paise: 250 }, { bot: "plan", at: FIXED_NOW, paise: 50 }],
      limitPaise: 50_000, stopAtLimit: true, now: FIXED_NOW, tzOffsetMinutes: IST,
    });
    expect(r.monthPaise).toBe(1300);
    expect(r.byBot).toEqual([{ bot: "code", paise: 1000 }, { bot: "plan", paise: 300 }]);
    expect(r.byDay[0]).toBe(250);
    expect(r.byDay[27]).toBe(1050);
    expect(r.today).toBe(28);
    expect(r.daysInMonth).toBe(31);
    expect(r.leftPaise).toBe(48_700);
    expect(r.biggest.map((j) => j.id)).toEqual(["a"]);
  });
});

describe("settings", () => {
  it("cleans what was stored and checks a change", () => {
    expect(cleanSettings({ monthLimitPaise: -1, notify: { done: "loud", botsOff: ["plan", "BAD SLUG"] } })).toMatchObject({ monthLimitPaise: 50_000, notify: { done: "ping", botsOff: ["plan"] } });
    const p = applyPatch(DEFAULT_SETTINGS, { monthLimitRupees: "₹1,000", stopAtLimit: true, notify: { bot: "keybot", on: false, summaryAt: 1260 } });
    expect(p.ok && p.settings).toMatchObject({ monthLimitPaise: 100_000, stopAtLimit: true, notify: { botsOff: ["keybot"], summaryAt: 1260 } });
    expect(applyPatch(DEFAULT_SETTINGS, { stopAtLimit: "yes" }).ok).toBe(false);
    expect(applyPatch(DEFAULT_SETTINGS, { monthLimitPaise: 5 }).ok).toBe(false);
  });

  it("knows quiet hours that run past midnight", () => {
    const n = { ...DEFAULT_SETTINGS.notify, quiet: true };
    expect(inQuietHours(n, 23 * 60 + 30)).toBe(true);
    expect(inQuietHours(n, 6 * 60)).toBe(true);
    expect(inQuietHours(n, 12 * 60)).toBe(false);
  });
});

describe("what pings the person", () => {
  const s = cleanSettings({ notify: { done: "quiet", quiet: true, summary: true, botsOff: ["keybot"] } });
  it("needs you always comes (silent in quiet hours); done is quiet, and waits at night; Keybot off drops its reminders", () => {
    expect(verdict(s, "code_needs_you", 12 * 60)).toBe("send");
    expect(verdict(s, "approval", 2 * 60)).toBe("silent");
    expect(verdict(s, "code_job_done", 12 * 60)).toBe("silent");
    expect(verdict(s, "code_job_done", 2 * 60)).toBe("drop");
    expect(verdict(s, "streak", 12 * 60)).toBe("drop");
    expect(verdict(DEFAULT_SETTINGS, "code_job_done", 2 * 60)).toBe("send");
    expect(verdict(DEFAULT_SETTINGS, "bots_summary", 21 * 60)).toBe("drop");
    expect(summaryLine({ done: 5, needs: 1, spentPaise: 1100 })).toBe("5 things done, 1 needs you, ₹11 spent.");
    expect(summaryLine({ done: 0, needs: 0, spentPaise: 0 })).toBeNull();
  });

  it("the push engine asks the gate before it claims: dropped is never sent, silent has no sound", async () => {
    const store = new MemoryPushStore();
    store.candidatesList = [{ userId: "u", tokens: [{ platform: "ios", token: "ExponentPushToken[a]", updatedAt: 0 }], lastSeenAt: null, createdAt: null, locale: null, entitled: false, tzOffsetMin: 0 }];
    const sent: Array<Array<{ sound?: unknown }>> = [];
    const engine = new PushEngine(store, { send: async (m) => { sent.push(m); return m.map(() => ({ status: "ok" as const, id: "t" })); }, receipts: async () => ({}) }, () => structuredClone(PUSH_DEFAULTS), { info: () => {}, warn: () => {} });
    setPushGate(({ kind }) => (kind === "code_job_done" ? "drop" : "silent"));
    try {
      expect(await engine.notify("u", { kind: "code_job_done", key: "1" })).toBeNull();
      expect(store.rows).toHaveLength(0);
      await engine.notify("u", { kind: "code_needs_you", key: "2" });
      expect(sent[0]![0]!.sound).toBeNull();
    } finally { setPushGate(null); }
  });
});

describe("the monthly limit, kept", () => {
  let store: MemoryYouStore;
  beforeEach(() => { store = new MemoryYouStore(); });

  const jobsOf = (spent: number) => ({
    listJobs: async () => [{ id: "j", task: "t", state: "done", spentPaise: spent, createdAt: FIXED_NOW - HOUR, updatedAt: FIXED_NOW - MIN, branch: "b", projectId: "p", budgetPaise: 3000 }],
    defaultBudget: () => 3000,
  });

  it("a bot's answer is refused once the month is used up, and every answer is written down", async () => {
    const spending = new Spending({ store, jobs: jobsOf(40_000) as never, now: () => FIXED_NOW });
    const answer = { bot: { slug: "plan" }, paise: 120 };
    const bots = { ask: async () => answer, test: async () => answer, askWithKey: async () => ({ answer, leftTodayPaise: 0 }), ownerOfKey: async () => UID };
    wrapBots(bots as never, spending);
    await bots.ask(UID, "plan", {} as never);
    expect((await store.spendSince(UID, 0)).map((r) => [r.bot, r.paise])).toEqual([["plan", 120]]);
    await store.putSettings(UID, { ...DEFAULT_SETTINGS, monthLimitPaise: 40_000, stopAtLimit: true }, FIXED_NOW);
    spending.forget(UID);
    await expect(bots.ask(UID, "plan", {} as never)).rejects.toBeInstanceOf(BotError);
    await expect(bots.askWithKey("Bearer k" as never, "plan", {} as never)).rejects.toMatchObject({ code: "month_limit", status: 429 });
  });

  it("a new Code bot job is held to what is left of the month, and not started with nothing left", async () => {
    const spending = new Spending({ store, jobs: jobsOf(49_000) as never, now: () => FIXED_NOW });
    await store.putSettings(UID, { ...DEFAULT_SETTINGS, stopAtLimit: true }, FIXED_NOW);
    const app = Fastify();
    app.post("/v1/code/jobs", async (req) => ({ got: req.body }));
    holdJobsToMonth(app, spending, jobsOf(49_000) as never);
    const r = await app.inject({ method: "POST", url: "/v1/code/jobs", headers: { authorization: "Bearer good" }, payload: { task: "x" } });
    expect(r.json().got.budgetPaise).toBe(1000);
    await store.putSettings(UID, { ...DEFAULT_SETTINGS, monthLimitPaise: 30_000, stopAtLimit: true }, FIXED_NOW);
    spending.forget(UID);
    const stopped = await app.inject({ method: "POST", url: "/v1/code/jobs", headers: { authorization: "Bearer good" }, payload: { task: "x", budgetPaise: 500 } });
    expect(stopped.statusCode).toBe(429);
    expect(stopped.json().code).toBe("month_limit");
    await app.close();
  });
});

describe("the routes", () => {
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    setYouStoreForTests(new MemoryYouStore());
    app = Fastify();
    const jobs = {
      listJobs: async () => [{ id: "j", task: "Fix cart", state: "done", spentPaise: 2500, createdAt: Date.now() - HOUR, updatedAt: Date.now() - MIN, branch: "b", projectId: "p", budgetPaise: 3000 }],
      defaultBudget: () => 3000,
      jobWithSteps: async () => ({ steps: [{ placement: "desktop", status: "done", minutes: 4 }] }),
      devices: { onlineFor: () => [{ deviceId: "mbp", name: "MacBook", allowRun: true, busy: false, projects: "all", capabilities: { liveOnly: false, container: false, os: "darwin", arch: "arm64" } }], online: () => null },
    };
    registerBotsYouRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, bots: null, code: null, jobs: jobs as never, connectors: null, media: null, artifacts: null });
    await app.ready();
  });
  afterEach(async () => { await app.close(); setYouStoreForTests(null); setSpendSource(null); setPushGate(null); });
  const get = (url: string) => app.inject({ method: "GET", url, headers: { authorization: "Bearer good" } });

  it("answers only the signed-in person", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/you/spend" })).statusCode).toBe(401);
  });

  it("stores a limit, and the month and the tab ring read it", async () => {
    const put = await app.inject({ method: "PUT", url: "/v1/you/settings", headers: { authorization: "Bearer good" }, payload: { monthLimitRupees: "1000", stopAtLimit: true } });
    expect(put.json().settings).toMatchObject({ monthLimitPaise: 100_000, stopAtLimit: true });
    expect((await get("/v1/you/spend?tz=330")).json().report).toMatchObject({ monthPaise: 2500, limitPaise: 100_000, byBot: [{ bot: "code", paise: 2500 }] });
    expect((await get("/v1/you/live?tz=330")).json()).toEqual({ limitPaise: 100_000, monthPaise: 2500 });
    expect((await app.inject({ method: "PUT", url: "/v1/you/settings", headers: { authorization: "Bearer good" }, payload: { notify: { done: "loud" } } })).statusCode).toBe(400);
  });

  it("lists the computers, remembers them, and says what they did", async () => {
    const r = (await get("/v1/you/computers")).json();
    expect(r.online[0]).toMatchObject({ name: "MacBook", allowRun: true, projects: "all" });
    expect(r.helped).toEqual({ jobs: 1, minutes: 4 });
  });

  it("the You page carries the month, the plan and the settings", async () => {
    const res = await get("/v1/you?tz=330");
    const r = res.json();
    expect(res.statusCode, res.body).toBe(200);
    expect(r.spend.monthPaise).toBe(2500);
    expect(r.plan).toEqual({ name: "Free", active: false });
    expect(r.settings.monthLimitPaise).toBe(50_000);
  });

  it("a download link that has run out, or was made up, opens nothing", async () => {
    expect((await app.inject({ method: "GET", url: `/v1/you/export/file?t=${UID}.1.abc` })).statusCode).toBe(410);
  });
});

describe("the download link", () => {
  it("is signed for one person and runs out", () => {
    vi.stubEnv("SUPABASE_SERVICE_KEY", "x".repeat(40));
    resetConfigForTests();
    const link = exportLink(UID, FIXED_NOW, "https://api.example")!;
    const t = new URL(link.url).searchParams.get("t")!;
    expect(exportLinkUser(t, FIXED_NOW)).toBe(UID);
    expect(exportLinkUser(t.replace(/.$/, (c) => (c === "a" ? "b" : "a")), FIXED_NOW)).toBeNull();
    expect(exportLinkUser(t, FIXED_NOW + 31 * MIN)).toBeNull();
    vi.unstubAllEnvs();
    resetConfigForTests();
  });
});

describe("the tab ring", () => {
  it("uses the stored limit and the month over every bot when the You tab's source answers", async () => {
    const base = { bots: [], jobs: [], tasks: [], minutesSaved: 0, budgetPaise: 50_000, now: FIXED_NOW, tzOffsetMinutes: IST };
    expect(liveFrom({ ...base, stored: { limitPaise: 100_000, monthPaise: 25_000 } }).spend).toEqual({ monthPaise: 25_000, budgetPaise: 100_000 });
    expect(liveFrom({ ...base, stored: { limitPaise: 100_000, monthPaise: 25_000 } }).tab.spent).toBe(0.25);
    setSpendSource(async (deps) => deps.api("GET", "/v1/you/live?tz=330"));
    try {
      const live = await loadLive(fakeDeps({ api: { "GET /v1/you/live?tz=330": { limitPaise: 30_000, monthPaise: 3000 } } }), IST);
      expect(live.spend).toEqual({ monthPaise: 3000, budgetPaise: 30_000 });
      // No answer: as before, the jobs' spend against deps.budgetPaise().
      expect((await loadLive(fakeDeps(), IST)).spend.budgetPaise).toBe(50_000);
    } finally { setSpendSource(null); }
  });
});
