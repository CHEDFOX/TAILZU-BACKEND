/**
 * SHARING A PLAN (experience/bots/planShare.ts, screens/you/planShareCard.ts), on the boards' day: Aanya with Pro and
 * two people on it, Aanya on Rahul's Lite instead, the two readings of "Share with someone", the refused screen with
 * both ways out, and an ask waiting in Activity — once from someone who has a plan, once from someone who has not.
 *
 * The switch is read from the environment here, because the render check runs no server: PLAN_SHARE on, the way
 * render.ts turns Spaces on, so the screens draw what they draw once the owner turns it on. Every other sample answers
 * nothing for the share route, so every other screen renders exactly as it did before.
 */
process.env.PLAN_SHARE ??= "true";

import { FIXED_NOW, IST } from "../../../src/experience/bots/fixtures.js";

const A = "/v1/botsapp/bots";
const MIN = 60_000, HOUR = 60 * MIN;
export const SHARE_ROUTE = `GET ${A}/plan/share`;

/** The people Aanya shares a space with (tests/spaces-data.ts's Home and Studio). */
const PEOPLE = {
  mom: { userId: "m", name: "Mom" },
  rohan: { userId: "r", name: "Rohan" },
  ishita: { userId: "i", name: "Ishita" },
  kabir: { userId: "k", name: "Kabir" },
  dev: { userId: "d", name: "Dev" },
};

/** Aanya has Pro, and Mom and Rohan are on it. Ishita and Kabir could be. Dev has his own. */
export const SHARE_OWNER = {
  canShare: true,
  members: [{ ...PEOPLE.mom, usedPct: 12 }, { ...PEOPLE.rohan, usedPct: 0 }],
  people: [
    { ...PEOPLE.mom, hasPlan: false, onMyPlan: true },
    { ...PEOPLE.rohan, hasPlan: false, onMyPlan: true },
    { ...PEOPLE.ishita, hasPlan: false, onMyPlan: false },
    { ...PEOPLE.kabir, hasPlan: false, onMyPlan: false },
    { ...PEOPLE.dev, hasPlan: true, onMyPlan: false },
  ],
  asks: [],
};

/** The same plan with nobody on it yet. */
export const SHARE_EMPTY = { ...SHARE_OWNER, members: [], people: SHARE_OWNER.people.map((p) => ({ ...p, onMyPlan: false })) };

/** Aanya is on Rahul's Lite: a third of the month gone between everyone, 12% of it hers. */
export const SHARE_ON = {
  canShare: false,
  members: [],
  on: { ownerId: "d", name: "Rahul", planName: "Lite", since: Date.UTC(2026, 10, 3) - IST * MIN, monthUsedPct: 31, myUsedPct: 12 },
  people: [
    { ...PEOPLE.mom, hasPlan: false, onMyPlan: false },
    { ...PEOPLE.rohan, hasPlan: false, onMyPlan: false },
  ],
  asks: [],
};

/** Aanya is on Free, and two of her people have a plan: she can ask. */
export const SHARE_FREE = {
  canShare: false,
  members: [],
  people: [
    { ...PEOPLE.dev, hasPlan: true, onMyPlan: false },
    { ...PEOPLE.ishita, hasPlan: true, onMyPlan: false },
    { ...PEOPLE.mom, hasPlan: false, onMyPlan: false },
  ],
  asks: [],
};

const ASK = { id: "ask-1", askerId: "i", name: "Ishita", about: "Diwali party", at: FIXED_NOW - 25 * MIN };

/** An ask waiting on someone who has a plan: "Share my plan" · "Not now". */
export const SHARE_ASKED_OWNER = { ...SHARE_OWNER, asks: [ASK] };
/** The same ask, waiting on someone on Free: "See plans and share" · "Not now". */
export const SHARE_ASKED_FREE = { ...SHARE_FREE, asks: [ASK] };

/** The same ask, but the newest thing waiting, so Home's one card is this one. */
const NEWEST = { ...ASK, at: FIXED_NOW - MIN };
export const SHARE_ASKED_NEWEST = { ...SHARE_OWNER, asks: [NEWEST] };
export const SHARE_ASKED_NEWEST_FREE = { ...SHARE_FREE, asks: [NEWEST] };

/** Aanya asked Dev and is waiting: the person page says so rather than letting the ask go twice. */
export const SHARE_WAITING = { ...SHARE_FREE, asked: { id: "ask-2", ownerId: "d", name: "Dev", at: FIXED_NOW - 2 * HOUR } };

// ------------------------------------------------------------------ the answers each sample needs

const MONTH_START = Date.UTC(2026, 9, 1) - IST * MIN;
const RESETS = Date.UTC(2026, 10, 1) - IST * MIN;

/** Out of this month's allowance, on Free, with a bigger plan for sale: the refused screen. */
const OUT = {
  plan: { id: "free", name: "Free", paid: false, windows: false, carryOver: false, upgrade: true },
  stretch: { used: 1, startsAt: MONTH_START, resetsAt: RESETS, n: 1, of: 1, days: 31 },
  month: { used: 1, startsAt: MONTH_START, resetsAt: RESETS, days: 31 },
  state: "out",
};

/** Plan and billing for someone with no plan of their own (they are on someone else's, or on Free). */
const FREE_BILLING = {
  plan: { name: "Free", active: false, store: null, renews: false, until: null, since: null, paidBy: null, cancel: null, manageUrl: null },
  invoices: [], usage: null, email: "aanya.rao@gmail.com",
};

export const share = (view: unknown): Record<string, unknown> => ({ [SHARE_ROUTE]: view });

/** Plan and billing while Aanya is on Rahul's Lite: no plan of her own, so See plans and Leave Rahul's plan. */
export const ON_API: Record<string, unknown> = {
  ...share(SHARE_ON),
  [`GET /v1/you/billing?tz=${IST}`]: FREE_BILLING,
};

/** The refused screen: Free, nothing left, and two people who could share. */
export const REFUSED_API: Record<string, unknown> = {
  ...share(SHARE_FREE),
  [`GET /v1/you/usage?tz=${IST}`]: { usage: OUT, near: null, out: "You've used this month's allowance. It starts again on the 1st.", how: "Your plan's use is counted by the month, and starts again when the month does." },
};

/** Someone's page, as safety.ts reads it (GET /v1/botsapp/bots/people/<id>). */
export const person = (userId: string, name: string, spaces: string[]): Record<string, unknown> => ({
  [`GET ${A}/people/${userId}`]: { person: { userId, name, spaces, blockedByYou: false, canMessage: true, bot: { seed: userId, avatar: "sage", color: "#6B8E4E" } } },
});

/** Ishita's page while Aanya has Pro and Ishita has nothing: "Share my plan with Ishita". */
export const PERSON_SHARE_API: Record<string, unknown> = { ...person("i", "Ishita", ["Studio"]), ...share(SHARE_OWNER) };
/** Dev's page while Aanya is on Free and Dev has a plan: "Ask for their plan". */
export const PERSON_ASK_API: Record<string, unknown> = { ...person("d", "Dev", ["Studio"]), ...share(SHARE_FREE) };
