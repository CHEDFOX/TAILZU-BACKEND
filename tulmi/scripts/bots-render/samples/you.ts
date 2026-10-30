/**
 * The You tab's day (routes/botsYou.ts): 64% of this stretch used (40% of October), Pro paid by UPI autopay, the MacBook helping, three apps
 * connected. No screen draws an amount; the routes' own still carry some (ours), so the screens are seen not to.
 */
import { FIXED_NOW, IST } from "../../../src/experience/bots/fixtures.js";

const MIN = 60_000, H = 60 * MIN, D = 24 * H;
const NOW = FIXED_NOW;
/** A UTC time, as ms. */
const utc = (y: number, m: number, d: number, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi);
const MONTH_START = utc(2026, 10, 1) - IST * MIN;
const RESETS = utc(2026, 11, 1) - IST * MIN;

const settings = {
  monthLimitPaise: 50_000, stopAtLimit: true,
  notify: { done: "quiet", summary: true, summaryAt: 1260, quiet: true, quietFrom: 1380, quietTo: 420, botsOff: ["keybot"] },
  privacy: { screenPictures: "ask" },
};
const byBot = [{ bot: "code", paise: 14_200 }, { bot: "keybot", paise: 1800 }, { bot: "plan", paise: 1500 }, { bot: "gym-bot", paise: 900 }];

/** The usage meter: stretch 5 of 5 (23 to 31 Oct), resetting Sun 1 Nov. */
const usage = {
  plan: { id: "paid", name: "Pro", paid: true, windows: true, carryOver: false, upgrade: false },
  stretch: { used: 0.64, startsAt: utc(2026, 10, 23) - IST * MIN, resetsAt: RESETS, n: 5, of: 5, days: 9 },
  month: { used: 0.4, startsAt: MONTH_START, resetsAt: RESETS, days: 31 },
  state: "ok",
};

const you = {
  plan: { name: "Pro", active: true },
  usage,
  spend: { monthPaise: 18_400, limitPaise: 50_000, leftPaise: 31_600, perDayPaise: 660, resetsAt: RESETS, byBot, stopAtLimit: true },
  apps: {
    enabled: true, github: { repos: 2 }, alone: 3,
    connected: [
      { id: "google-calendar", name: "Google Calendar", usedBy: ["Plan Ease", "Travel bot", "Gym bot"], lastUsedAt: NOW - 2 * MIN },
      { id: "google-tasks", name: "Google Tasks", usedBy: ["Plan Ease"], lastUsedAt: NOW - D },
    ],
  },
  computers: { online: [{ name: "Aanya's MacBook", busy: true, allowRun: true }], offline: 1, helped: { jobs: 6, minutes: 200 } },
  settings, exportUrl: "https://api.x0bot.com/v1/you/export/file?t=x", language: "hinglish",
};

const spentByDay = [300, 450, 0, 620, 510, 380, 700, 560, 940, 410, 0, 330, 600, 2100, 800, 450, 520, 300, 710, 640, 380, 560, 1420, 900, 610, 480, 700, 430];
const report = {
  month: "2026-10", monthStart: MONTH_START, resetsAt: RESETS, daysInMonth: 31, today: 28, monthPaise: 18_400, limitPaise: 50_000, leftPaise: 31_600,
  stopAtLimit: true, perDayPaise: 657, projectionPaise: 20_367, byBot, byDay: Array.from({ length: 31 }, (_, i) => spentByDay[i] ?? 0), busiest: { day: 14, paise: 2100 },
  biggest: [
    { id: "7c1d2e3f-0000-4000-8000-000000000002", task: "Checkout redesign · team of 3", paise: 1960, at: utc(2026, 10, 14, 9), minutes: 42 },
    { id: "7c1d2e3f-0000-4000-8000-000000000003", task: "Move sign-in to phone OTP", paise: 1420, at: utc(2026, 10, 23, 9), minutes: 31 },
    { id: "7c1d2e3f-0000-4000-8000-000000000005", task: "Upgrade to Next 15", paise: 940, at: utc(2026, 10, 9, 9), minutes: 18 },
  ],
};

const invoice = (n: number, month: number, id: string) => ({ id: `inv_${n}`, number: `TZ-26${String(month).padStart(2, "0")}-${id}`, date: utc(2026, month, 12, 6), amountPaise: 29_900, amount: "₹299", status: "paid", url: `https://rzp.io/i/${n}`, what: "Tailzu Pro" });
const billing = {
  plan: { name: "Pro", active: true, store: "razorpay", renews: true, until: utc(2026, 11, 12, 6), since: utc(2026, 7, 12, 6), price: "₹299", period: "a month", paidBy: "UPI autopay", cancel: "razorpay", manageUrl: null },
  invoices: [invoice(1, 10, "0412"), invoice(2, 9, "0388"), invoice(3, 8, "0351"), invoice(4, 7, "0297")],
  usage, email: "aanya.rao@gmail.com",
};

const computers = {
  online: [{ deviceId: "mbp", name: "Aanya's MacBook", os: "darwin", allowRun: true, busy: true, projects: "all", liveOnly: false, container: false }],
  offline: [{ deviceId: "office", name: "Office PC", os: "win32", lastSeen: NOW - 2 * D - 3 * H }], helped: { jobs: 6, minutes: 200 },
};

const builtin = (slug: string, name: string) => ({ slug, name, colour: "", builtin: true });
const account = {
  bots: [builtin("code", "Xode"), builtin("keybot", "Keylessbord"), builtin("plan", "Plan Ease"), builtin("travel", "Travel bot"), { slug: "gym-bot", name: "Gym bot", colour: "pine", builtin: false }],
  projects: ["checkout-web", "salon-booking", "storefront", "diwali-sale"], notes: 212, keys: 3,
  plan: { active: true, store: "razorpay", renews: true, until: utc(2026, 11, 12, 6) }, exportUrl: "https://api.x0bot.com/v1/you/export/file?t=x",
};

const apps = {
  enabled: true, github: { repos: 2 },
  connected: [
    { id: "google-calendar", name: "Google Calendar", category: "Calendar", level: "draft", lastUsedAt: NOW - 2 * MIN, usedBy: ["Plan Ease", "Travel bot", "Gym bot"] },
    { id: "google-tasks", name: "Google Tasks", category: "Tasks", level: "draft", lastUsedAt: NOW - D, usedBy: ["Plan Ease"] },
    { id: "google-classroom", name: "Google Classroom", category: "School", level: "look", lastUsedAt: NOW - 2 * D, usedBy: ["Plan Ease"] },
  ],
  more: [
    { id: "google-docs", name: "Google Docs", category: "Docs", oneLine: "Write a new Google Doc from your words, or turn a meeting note into a Doc.", usedBy: [] },
    { id: "google-sheets", name: "Google Sheets", category: "Docs", oneLine: "Start a Google Sheet, add rows to one, or read one back.", usedBy: [] },
    { id: "notion", name: "Notion", category: "Docs", oneLine: "Search and write pages in your Notion.", usedBy: [] },
  ],
};

const app = {
  app: { id: "google-calendar", name: "Google Calendar", category: "Calendar", oneLine: "See your schedule, find free time, and add, move or cancel events.", auth: "oauth", provider: "google", connected: false, level: "look", lastUsedAt: null },
  bots: [
    { slug: "plan", name: "Plan Ease", colour: "", purpose: "Finds free time, moves things", builtin: true, linked: true },
    { slug: "gym-bot", name: "Gym bot", colour: "pine", purpose: "Books 3 workouts a week", builtin: false, linked: false },
  ],
  can: ["Read your events and free time", "Add or move events, asking you first"], cant: ["Share your calendar", "Change anything you didn't allow"],
};

export const YOU_API: Record<string, unknown> = {
  [`GET /v1/you?tz=${IST}`]: you,
  [`GET /v1/you/spend?tz=${IST}`]: { report, settings },
  [`GET /v1/you/usage?tz=${IST}`]: { usage, near: null, out: null, how: "Each month is used in five stretches: 4, 5, 6 and 7 days, then the rest of the month. Each starts fresh." },
  [`GET /v1/you/billing?tz=${IST}`]: billing,
  "GET /v1/you/computers": computers,
  [`GET /v1/you/notify?tz=${IST}`]: { settings, today: { done: 5, needs: 1, spentPaise: 1100 }, line: "5 things done, 1 needs you." },
  "GET /v1/you/account": account,
  "GET /v1/you/apps": apps,
  "GET /v1/you/apps/google-calendar": app,
};
