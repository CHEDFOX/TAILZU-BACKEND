/**
 * The shell's day (Home, Activity, Ask, Search, Tasks, Approve, Today, meeting notes) as routes/botsShell.ts answers it, built with the
 * real feed and search (src/shell) from the sample day's jobs: Code bot working on the cart, the dentist waiting for a yes, the salon.
 */
import { feedOf, weekOf } from "../../../src/shell/feed.js";
import { searchAll } from "../../../src/shell/search.js";
import { FIXED_NOW, IST, SAMPLE_JOBS } from "../../../src/experience/bots/fixtures.js";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const N = FIXED_NOW;

/** The grocer's UPI link the Approve board pays. */
export const UPI = "upi://pay?pa=freshbasket@okhdfcbank&pn=Fresh%20Basket&am=1240.00&cu=INR&tn=This%20week%27s%20groceries";
/** What Ask's board has typed. */
export const ASK = "14 Nov ko Pune ki shaam wali train dekh lo, 2 seats";

export function shellApi(): Record<string, unknown> {
  const jobs = SAMPLE_JOBS.map((j) => ({ ...j, projectId: "p1", ...(j.state === "running" ? { phase: "work" } : {}) }));
  const tasks = [
    { id: "t1", state: "done" as const, title: "Added 3 workouts to your calendar", steps: [{ at: N - 12 * HOUR, text: "Google Calendar: create event" }], approval: null, createdAt: N - 12 * HOUR, updatedAt: N - 12 * HOUR },
    { id: "t2", state: "failed" as const, title: "Book a badminton court for 7 pm", steps: [{ at: N - 22 * HOUR, text: "Courts were full" }], approval: null, createdAt: N - 22 * HOUR, updatedAt: N - 22 * HOUR },
  ];
  const events = [
    { id: "e1", kind: "ask" as const, bot: "travel", title: "Mumbai to Goa flights under ₹5,000 on 14 Nov", paise: 240, amountPaise: 0, payee: "", at: N - 2 * HOUR },
    { id: "e2", kind: "paid" as const, bot: "plan", title: "Electricity bill", paise: 0, amountPaise: 184000, payee: "BESCOM", at: N - 19 * HOUR },
  ];
  const words = [{ day: "2026-10-28", at: N - 4 * HOUR, words: 412, apps: ["WhatsApp", "Gmail"] }];
  const rows = feedOf({ now: N, tzOffsetMinutes: IST, jobs, tasks, events, words, projects: { p1: "Storefront" } });
  const week = weekOf(rows, N - 3 * DAY, 200);

  const search = searchAll("salon", {
    projects: [{ id: "project:p2", title: "Salon booking app", sub: "aanya/salon-booking-app", text: "", at: N - 3 * HOUR, bot: "code", open: { screenId: "bots.code", params: { project: "p2" } }, preview: { body: "A Code bot project on GitHub: aanya/salon-booking-app." } }],
    chats: [
      { id: "bot:plan", title: "Book the salon for Sat 11 am, before Riya's mehendi", sub: "Plan bot · Tue", at: N - DAY, bot: "plan", open: { screenId: "bots.chat", params: { slug: "plan" } }, preview: { lines: [{ who: "you", text: "Book the salon for Sat 11 am, before Riya's mehendi" }, { who: "bot", text: "Found 11 am free at the Indiranagar salon. Haircut ₹650. Hold it?" }, { who: "you", text: "Haan, hold karo" }, { who: "bot", text: "Booked for Sat 31 Oct, 11 am. It's on your calendar." }], at: "Tue" } },
      { id: "code:x", title: "Add salon time slots to the booking page", sub: "Code bot · Salon booking app · Mon", at: N - 2 * DAY, bot: "code", open: { screenId: "bots.chat", params: { slug: "code" } } },
    ],
    notes: [{ id: "note:n1", title: "Salon list, Indiranagar", sub: "Your note · haircut ₹650 · keratin ₹3,200", text: "", at: N - 5 * DAY, open: { screenId: "bots.note", params: { id: "n1" } } }],
    files: [
      { id: "file:f1", title: "salon-price-list.pdf", sub: "2 pages · 12 Oct", at: N - 16 * DAY, open: { screenId: "bots.ask", params: { file: "f1", fileName: "salon-price-list.pdf" } }, attachment: { id: "f1", kind: "pdf", name: "salon-price-list.pdf" } },
      { id: "file:f2", title: "salon-logo.svg", sub: "4 KB · 20 Oct", at: N - 8 * DAY, open: { screenId: "bots.ask", params: { file: "f2" } } },
    ],
    bots: [{ id: "botpage:gym-bot", title: "Gym bot", sub: "Books your salon every 6 weeks · next on 9 Nov", text: "salon", bot: "gym-bot", open: { screenId: "bots.bot", params: { slug: "gym-bot" } } }],
  });

  const people = { you: { label: "You", name: "Aanya Sharma" }, kavya: { label: "Speaker 1", name: "Kavya Rao" } };
  const notes = [
    { id: "n0", status: "recording", startedAt: new Date(N - 16 * MIN).toISOString(), durationSeconds: 960, words: 2100, title: "Diwali sale plan with Kavya", summary: "", people: [people.you, people.kavya, { label: "Speaker 2", name: "Meera Iyer" }], organised: false },
    { id: "n1", status: "ready", startedAt: new Date(N - 8 * HOUR).toISOString(), durationSeconds: 2520, words: 5200, title: "Salon booking app review", summary: "Kavya's salon loses most bookings to weekend no-shows. You agreed to send reminders on WhatsApp, ask for a small UPI deposit on weekends, and launch before Diwali.", people: [people.you, people.kavya, { label: "Speaker 2", name: "Rohan Mehta" }, { label: "Speaker 3", name: "Meera Iyer" }], organised: true, todos: 4, openTodos: 3, decisions: 3 },
    { id: "n2", status: "ready", startedAt: new Date(N - 10 * HOUR).toISOString(), durationSeconds: 960, words: 1500, title: "Call with our CA about GST filing", summary: "GST for October is due on the 20th. Two invoices are missing.", people: [people.you, { label: "Speaker 1", name: "Vikram Joshi" }], organised: true, todos: 2, openTodos: 2, decisions: 1 },
    { id: "n3", status: "ready", startedAt: new Date(N - DAY - 4 * HOUR).toISOString(), durationSeconds: 720, words: 1100, title: "Storefront standup", summary: "Checkout redesign is on track.", people: [people.you, { label: "Speaker 1", name: "Rohan Mehta" }, { label: "Speaker 2", name: "Dev K" }], organised: true },
  ];
  const note = { ...notes[1], highlights: [
    { speaker: "Speaker 1", text: "Weekends have the most no-shows. Last Saturday six people didn't come." },
    { speaker: "You", text: "Reminders go out on WhatsApp, 24 hours and 2 hours before." },
    { speaker: "Speaker 1", text: "Weekend slots need a ₹200 UPI deposit, refunded at the counter." },
  ], transcript: [
    { at: 42, speaker: "Speaker 1", text: "Weekends pe sabse zyada no-shows hote hain. Last Saturday six people just didn't come." },
    { at: 70, speaker: "You", text: "What if reminders go on WhatsApp instead of SMS? People actually read those." },
    { at: 91, speaker: "Speaker 3", text: "Haan, SMS koi nahi padhta. And a small deposit will help." },
    { at: 124, speaker: "Speaker 2", text: "That old calendar plugin was useless for this, honestly." },
    { at: 140, speaker: "Speaker 1", text: "₹200 deposit, refunded when they walk in. Done." },
    { at: 161, speaker: "You", text: "Okay. Code bot can start on the reminders today." },
  ], decisions: [
    "Reminders go out on WhatsApp, 24 hours and 2 hours before",
    "Weekend slots need a ₹200 UPI deposit, refunded at the counter",
    "Launch on Saturday, 8 November",
  ], todos: [
    { id: "t1", text: "Pick a date for the launch photo shoot", who: "Speaker 1", when: "this week", done: false },
    { id: "t2", text: "Move booking reminders to WhatsApp", who: "You", when: "today", done: false },
    { id: "t3", text: "Check how deposit refunds reach the bank", who: "Speaker 2", when: "by Friday", done: false },
    { id: "t4", text: "Send Meera the new price list", who: "You", done: true, doneAt: new Date(N - 7 * HOUR).toISOString() },
  ], found: { hash: "sample", at: new Date(N - 8 * HOUR).toISOString(), ok: true } };

  const today = {
    calendar: { connected: true, events: [
      { start: 9 * 60 + 15, end: 9 * 60 + 45, title: "Call with our CA", when: "09:15–09:45" },
      { start: 10 * 60, end: 10 * 60 + 30, title: "Storefront standup", when: "10:00–10:30" },
      { start: 11 * 60 + 30, end: 12 * 60 + 15, title: "Salon booking review", when: "11:30–12:15" },
      { start: 13 * 60, end: 14 * 60, title: "Lunch with Kavya", with: "with Kavya", when: "13:00–14:00" },
      { start: 19 * 60 + 30, end: 20 * 60 + 15, title: "Diwali sale plan", when: "19:30–20:15" },
    ] },
    rows: rows.filter((r) => r.type !== "words" && r.at >= N - 14 * HOUR),
    keybot: {
      words: 1284, minutesSaved: 32,
      byHour: [[9, 160], [10, 80], [11, 280], [12, 190], [13, 60], [14, 400], [15, 340], [19, 210]].map(([hour, w]) => ({ hour, words: w })),
      byApp: [{ app: "Gmail", words: 540 }, { app: "WhatsApp", words: 410 }, { app: "Notes", words: 334 }],
    },
  };
  const tasksData = {
    rows: rows.filter((r) => r.type !== "words" && (r.at >= N - 14 * HOUR || r.mark === "working")),
    upcoming: { connected: true, todos: [{ title: "Renew car insurance", due: "Friday" }, { title: "Pick up dry cleaning, HSR", due: "Today" }, { title: "Pay school fees", overdue: true, due: "Mon 26 Oct" }] },
    took: 3, total: 6, minutesSaved: 70,
  };
  return {
    [`GET /v1/shell/activity?tz=${IST}`]: { now: N, week, rows },
    [`GET /v1/shell/search?q=salon&tz=${IST}`]: search,
    "POST /v1/shell/route": { slug: "travel", name: "Travel bot", color: "#3E6E8E", say: "Travel bot will take this", hint: "Tap to send · Travel bot shows the plan before it books", by: "rules", confidence: 0.9 },
    [`GET /v1/shell/tasks?tz=${IST}`]: tasksData,
    [`GET /v1/shell/today?tz=${IST}`]: today,
    "GET /v1/notes?limit=100": { notes },
    "GET /v1/notes/n1": { note, finding: false },
    "GET /v1/notes/stats": { week: { meetings: 4, seconds: 5160, people: 6 }, openTodos: 5, recording: true, organising: 0 },
    "GET /v1/shell/started": { started: true },
  };
}
