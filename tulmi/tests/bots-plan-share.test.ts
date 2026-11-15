/**
 * SHARING A PLAN, ON THE SCREENS (experience/bots/planShare.ts, screens/you/planShareCard.ts, screens/safety.ts,
 * experience/bots/live.ts): every state the person can be in, on the phone and in the window, and the switch off.
 *
 * What is held here:
 *   - PLAN_SHARE off draws NOTHING new anywhere — no row, no card, no screen, no ask, no notification category — and
 *     reads nothing: not one call goes to the share route.
 *   - a plan with nobody on it, a plan with two people on it, and being on someone else's.
 *   - someone's page reads one row either way round, and no row when both have a plan or neither does.
 *   - the refused screen's two ways out, in the order ASK_ABOVE_BUY sets.
 *   - an ask waiting reaches Activity (and so Home's first card and the window) as a NeedsItem with two buttons, one
 *     wording for someone with a plan and another for someone on Free.
 *   - no screen says anything of money, or anything of another person's money.
 *   - lintTree is [] for every one of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const UID = "00000000-0000-4000-8000-00000000aaaa";
vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

import { resetConfigForTests } from "../src/config.js";
import { withAppKnobs } from "../src/experience/appKnobs.js";
import { buildBotsScreen } from "../src/experience/bots/index.js";
import { FIXED_NOW, IST, fakeDeps } from "../src/experience/bots/fixtures.js";
import { lintTree, walk } from "../src/experience/bots/lint.js";
import { loadLive } from "../src/experience/bots/live.js";
import { ASK_ABOVE_BUY, ASK_SOMEONE_LABEL, cleanShare, planShareOn, type PlanShareView } from "../src/experience/bots/planShare.js";
import { SCREENS } from "../src/experience/bots/ids.js";

const MIN = 60_000, HOUR = 60 * MIN;
const A = "/v1/botsapp/bots";
const SHARE = `GET ${A}/plan/share`;
const MONTH_START = Date.UTC(2026, 9, 1) - IST * MIN;
const RESETS = Date.UTC(2026, 10, 1) - IST * MIN;

const meter = (o: { name: string; paid: boolean; upgrade: boolean; used: number; state: string }) => ({
  plan: { id: o.paid ? "paid" : "free", name: o.name, paid: o.paid, windows: false, carryOver: false, upgrade: o.upgrade },
  stretch: { used: o.used, startsAt: MONTH_START, resetsAt: RESETS, n: 1, of: 1, days: 31 },
  month: { used: o.used, startsAt: MONTH_START, resetsAt: RESETS, days: 31 },
  state: o.state,
});
const PRO = meter({ name: "Pro", paid: true, upgrade: false, used: 0.64, state: "ok" });
const OUT = meter({ name: "Free", paid: false, upgrade: true, used: 1, state: "out" });

const BILLING_PRO = {
  plan: { name: "Pro", active: true, store: "razorpay", renews: true, until: FIXED_NOW + 15 * 24 * HOUR, since: FIXED_NOW - 100 * 24 * HOUR, price: "₹299", period: "a month", paidBy: "UPI autopay", cancel: "razorpay", manageUrl: null },
  invoices: [], usage: PRO, email: "aanya@example.in",
};
const BILLING_FREE = {
  plan: { name: "Free", active: false, store: null, renews: false, until: null, since: null, paidBy: null, cancel: null, manageUrl: null },
  invoices: [], usage: null, email: "aanya@example.in",
};

const ANSWERS = (o: { billing?: unknown; usage?: unknown } = {}): Record<string, unknown> => ({
  [`GET /v1/you/billing?tz=${IST}`]: o.billing ?? BILLING_PRO,
  [`GET /v1/you/usage?tz=${IST}`]: { usage: o.usage ?? PRO, near: null, out: null, how: "Counted by the month." },
  [`GET ${A}/people/i`]: { person: { userId: "i", name: "Ishita", spaces: ["Studio"], blockedByYou: false, canMessage: true } },
  [`GET ${A}/people/d`]: { person: { userId: "d", name: "Dev", spaces: ["Studio"], blockedByYou: false, canMessage: true } },
});

// ------------------------------------------------------------------ the states

const MOM = { userId: "m", name: "Mom" }, ROHAN = { userId: "r", name: "Rohan" };
const ISHITA = { userId: "i", name: "Ishita" }, DEV = { userId: "d", name: "Dev" };

/** Aanya has Pro; Mom and Rohan are on it; Ishita could be; Dev has his own. */
const OWNER: PlanShareView = {
  canShare: true,
  members: [{ ...MOM, usedPct: 12 }, { ...ROHAN, usedPct: 0 }],
  people: [
    { ...MOM, hasPlan: false, onMyPlan: true }, { ...ROHAN, hasPlan: false, onMyPlan: true },
    { ...ISHITA, hasPlan: false, onMyPlan: false }, { ...DEV, hasPlan: true, onMyPlan: false },
  ],
  asks: [],
};
/** The same plan, nobody on it yet. */
const EMPTY: PlanShareView = { ...OWNER, members: [], people: OWNER.people.map((p) => ({ ...p, onMyPlan: false })) };
/** On Rahul's Lite. */
const ON: PlanShareView = {
  canShare: false, members: [],
  on: { ownerId: "d", name: "Rahul", planName: "Lite", since: Date.UTC(2026, 10, 3) - IST * MIN, monthUsedPct: 31, myUsedPct: 12 },
  people: [{ ...MOM, hasPlan: false, onMyPlan: false }], asks: [],
};
/** On Free, with people who have a plan. */
const FREE: PlanShareView = {
  canShare: false, members: [],
  people: [{ ...DEV, hasPlan: true, onMyPlan: false }, { ...MOM, hasPlan: false, onMyPlan: false }],
  asks: [],
};
const ASK = { id: "ask-1", askerId: "i", name: "Ishita", about: "Diwali party", at: FIXED_NOW - 25 * MIN };
const ASKED_OWNER: PlanShareView = { ...OWNER, asks: [ASK] };
const ASKED_FREE: PlanShareView = { ...FREE, asks: [ASK] };

// ------------------------------------------------------------------ the rig

const build = (screenId: string, client: "phone" | "desktop", api: Record<string, unknown>, params?: Record<string, string>) =>
  buildBotsScreen({
    screenId, client, tzOffsetMinutes: IST, user: { id: UID, name: "Aanya Rao", email: "aanya@example.in" }, can: new Set(["BotsKit"]),
    desk: { pages: client === "desktop", notes: false }, ...(params ? { params } : {}),
  }, fakeDeps({ api }));
const texts = (root: unknown) => walk(root as never).map((n) => String((n as { props?: { content?: unknown } }).props?.content ?? ""));
const words = (root: unknown) => texts(root).join(" · ");
const on = (view: PlanShareView, o: { billing?: unknown; usage?: unknown } = {}) => ({ ...ANSWERS(o), [SHARE]: view });

/** The switch, as a test flips it: the variable, then the parsed config thrown away so it is read again. */
const switchTo = (on: boolean, users?: string) => {
  if (on) process.env.PLAN_SHARE = "true"; else delete process.env.PLAN_SHARE;
  if (users === undefined) delete process.env.PLAN_SHARE_USERS; else process.env.PLAN_SHARE_USERS = users;
  resetConfigForTests();
};

beforeEach(() => switchTo(true));
afterEach(() => switchTo(false));

// ------------------------------------------------------------------ the switch

describe("the switch", () => {
  it("is off unless it says true, and the account list narrows it", () => {
    switchTo(false);
    expect(planShareOn(UID)).toBe(false);
    switchTo(true);
    expect(planShareOn(UID)).toBe(true);
    switchTo(true, "someone-else");
    expect(planShareOn(UID)).toBe(false);
    switchTo(true, `x, ${UID} ,y`);
    expect(planShareOn(UID)).toBe(true);
  });

  it("off: nothing new is drawn anywhere, and the share route is never even read", async () => {
    switchTo(false);
    for (const client of ["phone", "desktop"] as const) {
      for (const [id, params] of [["bots.billing"], ["bots.usage"], ["bots.activity"], ["bots.home"], ["bots.person", { id: "i" }]] as const) {
        const calls: Array<{ method: string; path: string }> = [];
        const s = await buildBotsScreen({
          screenId: id, client, tzOffsetMinutes: IST, user: { id: UID, name: "Aanya Rao", email: "aanya@example.in" },
          can: new Set(["BotsKit"]), desk: { pages: client === "desktop", notes: false }, ...(params ? { params } : {}),
        }, fakeDeps({ api: on(ASKED_OWNER, { usage: OUT }), calls }));
        expect(lintTree(s.root!), `${id} ${client}`).toEqual([]);
        const t = words(s.root);
        for (const gone of ["Sharing your plan", "Share with someone", "Stop sharing", ASK_SOMEONE_LABEL, "is asking for your plan", "You are on"]) {
          expect(t, `${id} ${client}: ${gone}`).not.toContain(gone);
        }
        expect(calls.map((c) => c.path), `${id} ${client}`).not.toContain(`${A}/plan/share`);
      }
    }
  });

  it("off: the notification has no category of ours; on: exactly one, with exactly two buttons", () => {
    switchTo(false);
    const off = withAppKnobs({ labels: {}, flags: {} }, { userId: UID });
    const cats = (b: { flags?: Record<string, unknown> }) => (b.flags?.["push.categories"] ?? []) as Array<{ id: string; actions: Array<{ title: string; act: string }> }>;
    expect(cats(off).find((c) => c.id === "x0_plan_share")).toBeUndefined();
    switchTo(true);
    const ours = cats(withAppKnobs({ labels: {}, flags: {} }, { userId: UID })).find((c) => c.id === "x0_plan_share");
    expect(ours).toBeDefined();
    expect(ours!.actions.map((a) => a.title)).toEqual(["Share", "Not now"]);
    expect(ours!.actions.map((a) => a.act)).toEqual(["share", "decline"]);
    expect(ours!.actions.length).toBeLessThanOrEqual(3);
  });

  it("the switch is never set from here: a half-built answer cannot blank a screen", () => {
    expect(cleanShare(undefined)).toBeUndefined();
    expect(cleanShare({})).toEqual({ canShare: false, members: [], people: [], asks: [] });
    expect(cleanShare({ members: [{ userId: "m" }], asks: [{ id: "a" }] })!.members[0]).toEqual({ userId: "m", name: "Someone", usedPct: 0 });
  });
});

// ------------------------------------------------------------------ Plan and billing

describe("Plan and billing", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`${client}: a plan with two people on it — a row each, Stop sharing behind two taps, and the quiet line`, async () => {
      const s = await build("bots.billing", client, on(OWNER));
      expect(lintTree(s.root!)).toEqual([]);
      const t = texts(s.root);
      expect(t).toContain("Sharing your plan");
      expect(t).toContain("Mom");
      expect(t).toContain("Used 12% this month");
      expect(t).toContain("Rohan");
      expect(t).toContain("Nothing yet");
      expect(t).toContain("Share with someone");
      expect(t).toContain("They use the same month as you. Nothing else of yours is shared.");
      // Two taps: the first only says so, the second calls.
      const json = JSON.stringify(s.root);
      expect(json).toContain("Tap Stop sharing again to stop");
      expect(json).toContain(`"method":"DELETE","path":"${A}/plan/share/m"`);
      expect(s.state).toMatchObject({ stop_0: false, stop_1: false });
      expect(json).toContain(`"screenId":"${SCREENS.planShare}"`);
    });

    it(`${client}: a plan with nobody on it — the section is still there, with one way in`, async () => {
      const s = await build("bots.billing", client, on(EMPTY));
      expect(lintTree(s.root!)).toEqual([]);
      const t = texts(s.root);
      expect(t).toContain("Sharing your plan");
      expect(t).toContain("Share with someone");
      expect(words(s.root)).not.toContain("Stop sharing");
    });

    it(`${client}: on someone else's — it leads with whose, the month as one bar, and the honest line`, async () => {
      const s = await build("bots.billing", client, on(ON, { billing: BILLING_FREE }));
      expect(lintTree(s.root!)).toEqual([]);
      const t = texts(s.root);
      expect(t).toContain("You are on Rahul's Lite");
      expect(t).toContain("Since 3 November");
      expect(t).toContain("31% used by everyone on it. You used 12%.");
      expect(t).toContain("If the month runs out, everyone on it waits for the 1st together.");
      expect(t).toContain("See plans");
      expect(t).toContain("Leave Rahul's plan");
      // Their plan is named because it is the plan you are on; nothing else of theirs is.
      expect(words(s.root)).not.toContain("Renews");
      // Not both at once: on someone else's plan there is nothing of your own to share.
      expect(words(s.root)).not.toContain("Sharing your plan");
      const json = JSON.stringify(s.root);
      expect(json).toContain("Tap Leave Rahul's plan again to leave");
      expect(json).toContain(`"method":"DELETE","path":"${A}/plan/share/mine"`);
    });

    it(`${client}: no money anywhere, and nothing of anyone else's money`, async () => {
      for (const view of [OWNER, EMPTY, ON, FREE]) {
        const s = await build("bots.billing", client, on(view, { billing: view === OWNER || view === EMPTY ? BILLING_PRO : BILLING_FREE }));
        const t = words(s.root);
        for (const bad of ["₹", "299", "/month", "a month"]) expect(t, `${bad}`).not.toContain(bad);
      }
    });
  }
});

// ------------------------------------------------------------------ Share with someone

describe("bots.plan.share", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`${client}: the people you share a space with, ticked, one button — no email, no link, no code`, async () => {
      const s = await build(SCREENS.planShare, client, on(OWNER));
      expect(lintTree(s.root!)).toEqual([]);
      const t = texts(s.root);
      expect(t).toContain("Share with someone");
      // Only the people who could actually go on it: not the two already on it, not the one with his own plan.
      expect(t).toContain("Ishita");
      expect(t).not.toContain("Mom");
      expect(t).not.toContain("Dev");
      expect(t).toContain("Only people you share a space with.");
      expect(t).toContain("Share my plan");
      expect(s.state).toMatchObject({ picked: [] });
      const json = JSON.stringify(s.root);
      expect(json).toContain('{"kind":"toggleInArray","path":"picked","value":"i"}');
      expect(json).toContain(`"method":"POST","path":"${A}/plan/share","body":{"memberIds":"$state.picked"}`);
      expect(json).not.toContain("TextField");
    });

    it(`${client}: the asking reading — one person, who has a plan`, async () => {
      const s = await build(SCREENS.planShare, client, on(FREE), { ask: "1" });
      expect(lintTree(s.root!)).toEqual([]);
      const t = texts(s.root);
      expect(t).toContain("Ask for a plan");
      expect(t).toContain("Dev");
      expect(t).not.toContain("Mom");
      expect(t).toContain("Ask them");
      expect(s.state).toMatchObject({ picked: "" });
      expect(JSON.stringify(s.root)).toContain(`"method":"POST","path":"${A}/plan/share/ask","body":{"ownerId":"$state.picked"}`);
    });

    it(`${client}: nobody to share with is an honest empty state, with no button`, async () => {
      const s = await build(SCREENS.planShare, client, on({ ...OWNER, people: [] }));
      expect(lintTree(s.root!)).toEqual([]);
      expect(texts(s.root)).toContain("Nobody to share with yet");
      expect(words(s.root)).not.toContain("Share my plan");
    });
  }
});

// ------------------------------------------------------------------ someone's page

describe("a person's page", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`${client}: one row, read either way round, and no row when it would mean nothing`, async () => {
      const mine = await build("bots.person", client, on(OWNER), { id: "i" });
      expect(lintTree(mine.root!)).toEqual([]);
      expect(texts(mine.root)).toContain("Share my plan with Ishita");
      expect(texts(mine.root)).toContain("They use the same month as you");
      expect(JSON.stringify(mine.root)).toContain(`"method":"POST","path":"${A}/plan/share","body":{"memberIds":["i"]}`);

      const theirs = await build("bots.person", client, on(FREE), { id: "d" });
      expect(lintTree(theirs.root!)).toEqual([]);
      expect(texts(theirs.root)).toContain("Ask for their plan");
      expect(texts(theirs.root)).toContain("Dev has one");
      expect(JSON.stringify(theirs.root)).toContain(`"body":{"ownerId":"d"}`);

      // Both have one: no row. Neither does: no row. Someone already on your plan: no row either.
      const both = await build("bots.person", client, on({ ...OWNER, people: [{ ...DEV, hasPlan: true, onMyPlan: false }] }), { id: "d" });
      expect(words(both.root)).not.toContain("Share my plan with");
      expect(words(both.root)).not.toContain("Ask for their plan");
      const neither = await build("bots.person", client, on({ ...FREE, people: [{ ...MOM, hasPlan: false, onMyPlan: false }] }), { id: "m" });
      expect(words(neither.root)).not.toContain("Ask for their plan");
      const already = await build("bots.person", client, on(OWNER), { id: "m" });
      expect(words(already.root)).not.toContain("Share my plan with Mom");

      // Nothing of their money, ever.
      for (const s of [mine, theirs, both]) for (const bad of ["₹", "Pro", "Lite", "Renews", "% used"]) expect(words(s.root)).not.toContain(bad);
    });

    it(`${client}: once asked, the row says so instead of asking twice`, async () => {
      const s = await build("bots.person", client, on({ ...FREE, asked: { id: "a2", ownerId: "d", name: "Dev", at: FIXED_NOW } }), { id: "d" });
      expect(lintTree(s.root!)).toEqual([]);
      expect(texts(s.root)).toContain("Asked for their plan");
      expect(words(s.root)).not.toContain("Ask for their plan");
    });
  }
});

// ------------------------------------------------------------------ the refused screen

describe("the refused screen (bots.usage)", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`${client}: asking sits above buying, and the order is one constant`, async () => {
      const s = await build("bots.usage", client, on(FREE, { usage: OUT }));
      expect(lintTree(s.root!)).toEqual([]);
      const t = texts(s.root);
      expect(t).toContain(ASK_SOMEONE_LABEL);
      expect(t).toContain("Get more with a plan");
      const ask = t.indexOf(ASK_SOMEONE_LABEL), buy = t.indexOf("Get more with a plan");
      expect(ASK_ABOVE_BUY ? ask < buy : buy < ask).toBe(true);
      expect(JSON.stringify(s.root)).toContain(`"screenId":"${SCREENS.planShare}","params":{"ask":"1"}`);
      // Asking never shows money; the plans screen does that.
      expect(words(s.root)).not.toContain("₹");
    });

    it(`${client}: nobody could share, so only the plan is offered — as before`, async () => {
      const s = await build("bots.usage", client, on({ ...FREE, people: [{ ...MOM, hasPlan: false, onMyPlan: false }] }, { usage: OUT }));
      expect(lintTree(s.root!)).toEqual([]);
      expect(words(s.root)).not.toContain(ASK_SOMEONE_LABEL);
      expect(texts(s.root)).toContain("Get more with a plan");
    });

    it(`${client}: nothing is offered while nothing is wrong`, async () => {
      const s = await build("bots.usage", client, on(FREE));
      expect(lintTree(s.root!)).toEqual([]);
      expect(words(s.root)).not.toContain(ASK_SOMEONE_LABEL);
    });
  }
});

// ------------------------------------------------------------------ the ask, in Activity

describe("an ask waiting", () => {
  it("is a thing that needs you, so Activity, Home's first card and the window all draw it", async () => {
    const live = await loadLive(fakeDeps({ api: on(ASKED_OWNER) }), IST, UID);
    const item = live.needs.find((n) => n.id === "planshare:ask-1");
    expect(item).toBeDefined();
    expect(item!.bot).toBe("tailzu");
    expect(item!.botName).toBe("X0");
    expect(item!.question).toBe("Ishita is asking for your plan");
    expect(item!.detail).toContain("So Ishita can work on Diwali party");
    expect(item!.detail).toContain("the same month as you");
    expect(item!.choices.map((c) => c.label)).toEqual(["Share my plan", "Not now"]);
    expect(JSON.stringify(item!.choices)).toContain(`"path":"${A}/plan/share/ask/ask-1"`);
    expect(JSON.stringify(item!.choices)).toContain('"decision":"share"');
    expect(JSON.stringify(item!.choices)).toContain('"decision":"decline"');
    // It counts, so the tab's dot and Home's header say there is something waiting.
    expect(live.tab.needs).toBe(live.needs.length);
  });

  it("reads differently to someone on Free, and its first button promises then opens the plans screen", async () => {
    const live = await loadLive(fakeDeps({ api: on(ASKED_FREE) }), IST, UID);
    const item = live.needs.find((n) => n.id === "planshare:ask-1")!;
    expect(item.detail).toBe("You are on Free. Getting a plan puts Ishita on it the moment it is paid, and you keep it.");
    expect(item.choices.map((c) => c.label)).toEqual(["See plans and share", "Not now"]);
    const json = JSON.stringify(item.choices[0]);
    expect(json).toContain('"decision":"promise"');
    expect(json).toContain(`"screenId":"${SCREENS.plans}"`);
    // No price on the card itself: only the screen it opens may show one.
    expect(JSON.stringify(item)).not.toContain("₹");
  });

  it("draws on Activity and on Home, on both clients, lint-clean", async () => {
    // Home shows the newest thing waiting, so the ask is the newest one there; Activity lists them all.
    const NEWEST: PlanShareView = { ...ASKED_OWNER, asks: [{ ...ASK, at: FIXED_NOW - 1 * MIN }] };
    for (const client of ["phone", "desktop"] as const) {
      for (const [id, view] of [["bots.activity", ASKED_OWNER], ["bots.home", NEWEST], ["bots.activity", ASKED_FREE]] as const) {
        const s = await build(id, client, on(view));
        expect(lintTree(s.root!), `${id} ${client}`).toEqual([]);
        expect(words(s.root), `${id} ${client}`).toContain("Ishita is asking for your plan");
      }
    }
  });

  it("nothing waits when nobody asked", async () => {
    const live = await loadLive(fakeDeps({ api: on(OWNER) }), IST, UID);
    expect(live.needs.some((n) => n.id.startsWith("planshare:"))).toBe(false);
  });
});
