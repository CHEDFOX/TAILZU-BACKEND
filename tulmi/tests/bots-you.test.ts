/**
 * The You tab (screens/you.ts, routes/botsYou.ts, src/you): its screens on both clients (no money on any of them), the usage meter from the
 * real records and the places it is kept (a job's budget and "Keep going", a bot's answer), what pings the person, the download link, and the
 * tab ring.
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
import { Spending, holdJobsToUsage, wrapBots } from "../src/you/limits.js";
import { summaryLine, verdict } from "../src/you/push.js";
import { DEFAULT_SETTINGS, applyPatch, cleanSettings, inQuietHours } from "../src/you/settings.js";
import { spendReport } from "../src/you/spend.js";
import { MemoryYouStore, setYouStoreForTests } from "../src/you/store.js";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const MONTH_START = Date.UTC(2026, 9, 1) - IST * MIN;
const RESETS = Date.UTC(2026, 10, 1) - IST * MIN;
const S = structuredClone(DEFAULT_SETTINGS);
const byBot = [{ bot: "code", paise: 14_200 }, { bot: "keybot", paise: 1800 }, { bot: "plan", paise: 1500 }, { bot: "gym-bot", paise: 900 }];

const USAGE = {
  plan: { id: "paid", name: "Pro", paid: true, windows: true, carryOver: false, upgrade: false },
  stretch: { used: 0.64, startsAt: Date.UTC(2026, 9, 23) - IST * MIN, resetsAt: RESETS, n: 5, of: 5, days: 9 },
  month: { used: 0.4, startsAt: MONTH_START, resetsAt: RESETS, days: 31 },
  state: "ok",
};
const OUT = { ...USAGE, plan: { ...USAGE.plan, id: "free", name: "Free", paid: false, upgrade: true }, stretch: { ...USAGE.stretch, used: 1 }, state: "out" };

const ANSWERS: Record<string, unknown> = {
  "GET /v1/you/usage?tz=330": { usage: USAGE, near: null, out: null, how: "Each month is used in five stretches: 4, 5, 6 and 7 days, then the rest of the month. Each starts fresh." },
  "GET /v1/you?tz=330": {
    plan: { name: "Pro", active: true },
    usage: USAGE,
    apps: { enabled: true, connected: [{ id: "google-calendar", name: "Google Calendar", usedBy: ["Plan bot", "Gym bot"], lastUsedAt: FIXED_NOW - 2 * MIN }], github: { repos: 2 }, alone: 3 },
    computers: { online: [{ name: "Aanya's MacBook", busy: false, allowRun: true }], offline: 1, helped: { jobs: 6, minutes: 200 } },
    settings: S, exportUrl: "https://api.x0bot.com/v1/you/export/file?t=x", language: "hinglish",
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
    // The route still carries the price and the invoices' amounts (billing.ts): the screens must not draw them.
    plan: { name: "Pro", active: true, store: "razorpay", renews: true, until: FIXED_NOW + 15 * DAY, since: FIXED_NOW - 100 * DAY, price: "₹299", period: "a month", paidBy: "UPI autopay", cancel: "razorpay", manageUrl: null },
    invoices: [{ id: "inv_1", number: "TZ-2610-0412", date: FIXED_NOW - 16 * DAY, amountPaise: 29_900, amount: "₹299", status: "paid", url: "https://rzp.io/i/a", what: "X0 Pro" }],
    usage: USAGE, email: "aanya@example.in",
  },
  "GET /v1/you/computers": {
    online: [{ deviceId: "mbp", name: "Aanya's MacBook", os: "darwin", allowRun: true, busy: true, projects: "all", liveOnly: false, container: false }],
    offline: [{ deviceId: "office", name: "Office PC", os: "win32", lastSeen: FIXED_NOW - 2 * DAY }], helped: { jobs: 6, minutes: 200 },
  },
  "GET /v1/you/notify?tz=330": { settings: S, today: { done: 5, needs: 1, spentPaise: 1100 }, line: "5 things done, 1 needs you." },
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
  ["bots.you"], ["bots.usage"], ["bots.budget"], ["bots.billing"], ["bots.computer"], ["bots.notify"], ["bots.privacy"], ["bots.delete-account"], ["bots.apps"],
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

  it("Delete account is reachable from the phone's Privacy page (App Store 5.1.1(v)), and from the computer's", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const s = await build("bots.privacy", client, ANSWERS);
      expect(JSON.stringify(s.root)).toContain('"bots.delete-account"');
    }
  });

  it("You and Usage show the meter the way Claude does, and no screen here shows money", async () => {
    const you = texts((await build("bots.you", "phone", ANSWERS)).root);
    expect(you).toContain("This stretch");
    expect(you).toContain("64% used");
    expect(you).toContain("Resets Sun");
    for (const client of ["phone", "desktop"] as const) {
      const usage = texts((await build("bots.usage", client, ANSWERS)).root);
      expect(usage).toEqual(expect.arrayContaining(["Usage", "This stretch", "64% used", "Resets Sun", "This month", "40% used"]));
      // The meters say it: no line explaining how the stretches work.
      expect(usage.join(" ")).not.toContain("five stretches");
    }
    // Budget's old link opens Usage.
    expect(texts((await build("bots.budget", "phone", ANSWERS)).root)).toContain("64% used");
    for (const [id, params] of IDS) {
      for (const client of ["phone", "desktop"] as const) {
        const all = JSON.stringify((await build(id, client, ANSWERS, params)).root);
        expect(all, `${id} on the ${client}`).not.toMatch(/₹|paise|rupee/i);
      }
    }
    // Plan and billing, the least there is: the plan, when it renews, usage. Receipts and renewal reminders are the store's,
    // Razorpay's and the UPI app's, so no invoices, no "Paid by", no plan blurb.
    for (const client of ["phone", "desktop"] as const) {
      const billing = texts((await build("bots.billing", client, ANSWERS)).root);
      expect(billing).toEqual(expect.arrayContaining(["Plan", "Pro", "Renews", "Usage", "64% of this stretch", "Change plan", "Cancel plan"]));
      for (const gone of ["Invoices", "Paid by", "UPI autopay", "Your UPI app tells you before each renewal.", "TZ-2610-0412", "More every month, for all your bots"]) expect(billing, client).not.toContain(gone);
    }
  });

  it("near the limit a calm line; at it the sentence, and a plan offered as an action without a price", async () => {
    const near = { ...ANSWERS, "GET /v1/you/usage?tz=330": { usage: { ...USAGE, stretch: { ...USAGE.stretch, used: 0.85 }, state: "near" }, near: "You've used most of this stretch. It resets Sun.", out: null, how: "" } };
    expect(texts((await build("bots.usage", "phone", near)).root)).toContain("You've used most of this stretch. It resets Sun.");
    const out = { ...ANSWERS, "GET /v1/you/usage?tz=330": { usage: OUT, near: null, out: "You've reached this month's limit. It resets Sun.", how: "" } };
    for (const client of ["phone", "desktop"] as const) {
      const s = await build("bots.usage", client, out);
      expect(texts(s.root)).toContain("You've reached this month's limit. It resets Sun.");
      expect(JSON.stringify(s)).toContain('"screenId":"bots.plans"');
      expect(JSON.stringify(s)).not.toMatch(/₹/);
    }
    const you = { ...ANSWERS, "GET /v1/you?tz=330": { ...(ANSWERS["GET /v1/you?tz=330"] as object), usage: { ...USAGE, state: "near", stretch: { ...USAGE.stretch, used: 0.9 } } } };
    expect(texts((await build("bots.you", "phone", you)).root)).toContain("You've used most of this stretch. It resets Sun.");
  });

  it("the free plan has no stretches: every You screen shows the month alone, and says this month", async () => {
    // As the server serves a free account (src/you/usage.ts): one allowance, the month, n 1 of 1.
    const FREE = {
      plan: { id: "free", name: "Free", paid: false, windows: false, carryOver: false, upgrade: true },
      stretch: { used: 0.64, startsAt: MONTH_START, resetsAt: RESETS, n: 1, of: 1, days: 31 },
      month: { used: 0.64, startsAt: MONTH_START, resetsAt: RESETS, days: 31 },
      state: "ok",
    };
    const how = "Your plan's use is counted by the month, and starts again when the month does.";
    const free = {
      ...ANSWERS,
      "GET /v1/you/usage?tz=330": { usage: FREE, near: null, out: null, how },
      "GET /v1/you?tz=330": { ...(ANSWERS["GET /v1/you?tz=330"] as object), plan: { name: "Free", active: false }, usage: FREE },
      "GET /v1/you/billing?tz=330": { plan: { name: "Free", active: false }, invoices: [], usage: FREE, email: "aanya@example.in" },
    };
    for (const client of ["phone", "desktop"] as const) {
      const usage = texts((await build("bots.usage", client, free)).root);
      expect(usage).toEqual(expect.arrayContaining(["This month", "64% used", "Resets Sun"]));
      expect(usage).not.toContain(how);
      for (const id of ["bots.usage", "bots.you", "bots.billing", "bots.settings"]) {
        const words = texts((await build(id, client, free)).root);
        expect(words.join(" "), `${id} on the ${client}`).not.toMatch(/stretch/i);
      }
    }
    const near = { ...free, "GET /v1/you/usage?tz=330": { usage: { ...FREE, state: "near" }, near: "You've used most of this month. It resets Sun.", out: null, how } };
    expect(texts((await build("bots.usage", "phone", near)).root)).toContain("You've used most of this month. It resets Sun.");
    const youNear = { ...free, "GET /v1/you?tz=330": { ...(free["GET /v1/you?tz=330"] as object), usage: { ...FREE, state: "near" } } };
    expect(texts((await build("bots.you", "phone", youNear)).root)).toContain("You've used most of this month. It resets Sun.");
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
    expect(summaryLine({ done: 5, needs: 1, spentPaise: 1100 })).toBe("5 things done, 1 needs you.");
    expect(summaryLine({ done: 0, needs: 0, spentPaise: 0 })).toBeNull();
  });

  it("a task, a plan or a message from someone in a space comes with Keybot off, and without a sound in quiet hours", () => {
    for (const kind of ["space_task", "space_plan", "space_message"]) {
      expect(verdict(s, kind, 12 * 60)).toBe("send");
      expect(verdict(s, kind, 2 * 60)).toBe("silent");
      expect(verdict({ ...s, notify: { ...s.notify, botsOff: ["keybot", "plan", "code"] } }, kind, 12 * 60)).toBe("send");
      expect(verdict(DEFAULT_SETTINGS, kind, 2 * 60)).toBe("send");
    }
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

describe("the usage limits, kept", () => {
  let store: MemoryYouStore;
  let spent = 0;
  beforeEach(() => { store = new MemoryYouStore(); spent = 0; });
  // Lite's month is five stretches of $4, $8, $6, $10 and $7: this one (23 to 31 Oct, the fifth, on the calendar: the entitlement names no
  // billing day) may use $7, 61,600 paise of ours at 88 rupees to the dollar.
  const STRETCH = 7 * 8800;
  const jobs = {
    listJobs: async () => [{ id: "j", task: "t", state: "done", spentPaise: spent, createdAt: FIXED_NOW - HOUR, updatedAt: FIXED_NOW - MIN, branch: "b", projectId: "p", budgetPaise: 3000 }],
    defaultBudget: () => 3000,
  };
  const make = () =>
    new Spending({ store, jobs: jobs as never, now: () => FIXED_NOW, entitlement: async () => ({ entitlement: "pro", active: true }) });

  it("counts the Code bot's jobs, every bot's answers and what Keybot really cost, and shows only shares and when they reset", async () => {
    spent = 3000;
    await store.addSpend(UID, "plan", 1000, FIXED_NOW - 2 * HOUR);
    const spending = make();
    // A dictation that cost us a quarter of a dollar: 2,200 paise at 88.
    spending.recordUsd(UID, "keybot", 0.25);
    const u = await spending.usage(UID, { tz: IST, fresh: true });
    expect(u.stretch.used).toBeCloseTo((3000 + 1000 + 2200) / STRETCH, 3);
    expect(u.stretch).toMatchObject({ n: 5, of: 5, resetsAt: RESETS });
    expect(u.plan).toMatchObject({ id: "paid", windows: true, upgrade: false });
  });

  it("a bot's answer is refused once the stretch is used up, with when it resets, and every answer is written down", async () => {
    spent = 30_000;
    const spending = make();
    const answer = { bot: { slug: "plan" }, paise: 120 };
    const bots = { ask: async () => answer, test: async () => answer, askWithKey: async () => ({ answer, leftTodayPaise: 0 }), ownerOfKey: async () => UID };
    wrapBots(bots as never, spending);
    await bots.ask(UID, "plan", {} as never);
    expect((await store.spendSince(UID, 0)).map((r) => [r.bot, r.paise])).toEqual([["plan", 120]]);
    spent = STRETCH;
    spending.forget(UID);
    await expect(bots.ask(UID, "plan", {} as never)).rejects.toBeInstanceOf(BotError);
    await expect(bots.askWithKey("Bearer k" as never, "plan", {} as never)).rejects.toMatchObject({
      code: "quota_exceeded", status: 429, message: "You've reached this stretch's limit. It resets Sun.",
    });
  });

  it("a new Code bot job, and a Keep going, are held to what is left of the stretch; with nothing left, the refusal", async () => {
    spent = 59_000;
    const spending = make();
    const app = Fastify();
    app.post("/v1/code/jobs", async (req) => ({ got: req.body }));
    app.post("/v1/code/jobs/:id/budget", async (req) => ({ got: req.body }));
    holdJobsToUsage(app, spending, jobs as never);
    const left = Math.floor(STRETCH - 59_000);
    const r = await app.inject({ method: "POST", url: "/v1/code/jobs", headers: { authorization: "Bearer good" }, payload: { task: "x" } });
    expect(r.json().got.budgetPaise).toBe(left);
    const more = await app.inject({ method: "POST", url: "/v1/code/jobs/j/budget", headers: { authorization: "Bearer good" }, payload: { addPaise: 5000 } });
    expect(more.json().got.addPaise).toBe(left);
    spent = STRETCH;
    spending.forget(UID);
    const stopped = await app.inject({ method: "POST", url: "/v1/code/jobs", headers: { authorization: "Bearer good" }, payload: { task: "x", budgetPaise: 500 } });
    expect(stopped.statusCode).toBe(429);
    expect(stopped.json()).toEqual({ code: "quota_exceeded", reason: "usage_limit", message: "You've reached this stretch's limit. It resets Sun.", resetsAt: RESETS, upgrade: false });
    expect(stopped.body).not.toMatch(/₹|paise/i);
    await app.close();
  });

  it("USAGE_LIMITS=false shows the meter and refuses nothing", async () => {
    vi.stubEnv("USAGE_LIMITS", "false");
    resetConfigForTests();
    try {
      spent = 70_000;
      const spending = make();
      expect((await spending.usage(UID)).state).toBe("out");
      expect(await spending.refusal(UID)).toBeNull();
      expect(await spending.leftToSpend(UID)).toBeNull();
    } finally { vi.unstubAllEnvs(); resetConfigForTests(); }
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

  it("Usage, the tab ring and the You page carry the meter: shares and times, none of our amounts", async () => {
    const res = await get("/v1/you/usage?tz=330");
    expect(res.statusCode, res.body).toBe(200);
    const u = res.json();
    // No plan bought (and Tailzu not free for all here): the free plan, $3 for the month with no stretches, a plan on offer.
    expect(u.usage.plan).toMatchObject({ id: "free", windows: false, upgrade: true });
    expect(u.usage.stretch.used).toBeCloseTo(2500 / 26_400, 4);
    expect(u.usage.stretch.used).toBe(u.usage.month.used);
    expect(u.usage.stretch.of).toBe(1);
    expect(u.how).toContain("counted by the month");
    expect(res.body).not.toMatch(/Paise|₹/);
    const live = (await get("/v1/you/live?tz=330")).json();
    expect(live.usage).toMatchObject({ windows: false, state: "ok", used: u.usage.stretch.used, resetsAt: u.usage.month.resetsAt });
    // Ours, for the logs: the month's costs still add up behind the meter.
    expect((await get("/v1/you/spend?tz=330")).json().report).toMatchObject({ monthPaise: 2500, byBot: [{ bot: "code", paise: 2500 }] });
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
    expect(r.usage.stretch.used).toBeGreaterThan(0);
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
  it("is how much of this stretch is used, from the usage meter when the You tab's source answers", async () => {
    const base = { bots: [], jobs: [], tasks: [], minutesSaved: 0, budgetPaise: 50_000, now: FIXED_NOW, tzOffsetMinutes: IST };
    const usage = { used: 0.64, month: 0.4, state: "ok" as const, resetsAt: RESETS, windows: true };
    const l = liveFrom({ ...base, stored: { limitPaise: 100_000, monthPaise: 25_000, usage } });
    expect(l.usage).toEqual(usage);
    expect(l.tab.used).toBe(0.64);
    // Without the meter: the jobs' month as a share of our yardstick, never drawn as an amount.
    expect(liveFrom({ ...base, stored: { limitPaise: 100_000, monthPaise: 25_000 } }).tab.used).toBe(0.25);
    setSpendSource(async (deps) => deps.api("GET", "/v1/you/live?tz=330"));
    try {
      const live = await loadLive(fakeDeps({ api: { "GET /v1/you/live?tz=330": { limitPaise: 30_000, monthPaise: 3000, usage } } }), IST);
      expect(live.spend).toEqual({ monthPaise: 3000, budgetPaise: 30_000 });
      expect(live.usage.used).toBe(0.64);
      // No answer: as before, the jobs' spend against deps.budgetPaise().
      expect((await loadLive(fakeDeps(), IST)).spend.budgetPaise).toBe(50_000);
    } finally { setSpendSource(null); }
  });
});
