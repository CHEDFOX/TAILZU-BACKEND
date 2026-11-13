/**
 * DOES THE CALL JUDGE'S PROMPT PICK THE RIGHT THINGS? (J5; botsBots/planCallJudgeWords.ts.) The real prompt and Plan Ease's own text
 * model on 40 written items: 15 that clearly need a call (a flight, BP medicine at 9 pm, rent due tomorrow, a school pickup, a passport
 * slot, an exam, a court date...), 15 that clearly do not (a gym habit, buy milk at 6, a standup, a movie, a newsletter...) and 10
 * borderline (either answer passes).
 *
 *   npx tsx scripts/plan-call-judge-eval.ts
 *
 * The key comes from the .env (OPENROUTER_API_KEY) and is never printed. It prints counts only, and the number of an item that failed.
 * It passes when the 30 clear items get the right `call` at least 28 times, the 15 that need a call get an `at` inside their accepted
 * window at least 13 times, and every answer parses. Exit 0 when it passes, 1 when it did not, 2 when it could not run.
 */
import { getConfig } from "../src/config.js";
import type { EventRow, TaskRow } from "../src/calendar/store.js";
import { DAY, MIN, clockAt, startOfDay } from "../src/calendar/words.js";
import { serverReaders } from "../src/botsBots/planCapture.js";
import {
  JUDGE_READ, JUDGE_SYSTEM, factsOfEvent, factsOfTask, judgeMessage, parseVerdict, startsOf, type JudgeCtx, type JudgeFacts, type Verdict,
} from "../src/botsBots/planCallJudgeWords.js";

const IST = 330;
const U = "aaaaaaaa-0000-4000-8000-000000000001";
/** Thu 12 Nov 2026, 4:10 pm in India. */
const NOW = Date.UTC(2026, 10, 12, 16, 10) - IST * MIN;
const dayKey = (n: number) => new Date(NOW + IST * MIN + n * DAY).toISOString().slice(0, 10);
const at = (n: number, hhmm: string) => startOfDay(dayKey(n), IST) + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) * MIN;

/** Where a verdict's `at` is acceptable: the kinds it may name, and for "before" how many minutes (inclusive). */
interface Window { leave_by?: boolean; due?: boolean; before?: [number, number] }
const inWindow = (v: Verdict, w: Window): boolean => {
  if (v.at === "leave_by") return !!w.leave_by;
  if (v.at === "due") return !!w.due;
  const n = Number(v.at.slice(7));
  return !!w.before && n >= w.before[0] && n <= w.before[1];
};

interface Item { label: string; facts: JudgeFacts; leave?: number; expect: "call" | "none" | "either"; window?: Window }

const ev = (title: string, day: number, time: string, o: { place?: string; notes?: string; minutes?: number; repeat?: EventRow["repeat"]; importance?: "must" } = {}): JudgeFacts =>
  factsOfEvent({
    id: "e", user_id: U, title, notes: o.notes ?? "", place: o.place ?? "", start_ms: at(day, time), end_ms: at(day, time) + (o.minutes ?? 60) * MIN, all_day: false, tz_min: IST,
    repeat: o.repeat ?? "", repeat_until: null, skips: [], remind_min: 15, next_remind_ms: null, source: { kind: "me" }, source_key: null, created_ms: NOW, updated_ms: NOW,
    ...(o.importance ? { importance: o.importance } : {}),
  } as EventRow, NOW);
const todo = (title: string, day: number | null, time: string | null, o: { kind?: "todo" | "due" | "wait"; amount?: number; payee?: string; pay?: boolean; notes?: string } = {}): JudgeFacts =>
  factsOfTask({
    id: "t", user_id: U, title, notes: o.notes ?? "", list: "", due_day: day === null ? null : dayKey(day), due_ms: day !== null && time ? at(day, time) : null, tz_min: IST, done: false, done_ms: null,
    remind_min: 0, next_remind_ms: null, source: { kind: "me" }, source_key: null, created_ms: NOW, updated_ms: NOW, kind: o.kind ?? "todo", snoozes: 0,
    ...(o.amount ? { amount_paise: o.amount * 100 } : {}), ...(o.payee ? { payee: o.payee } : {}), ...(o.pay ? { pay_link: "upi://pay?pa=x@upi" } : {}),
  } as TaskRow, NOW);

const ITEMS: Item[] = [
  // ---- 15 that clearly need a call
  { label: "flight", facts: ev("Flight to Delhi", 1, "06:10", { place: "Kempegowda Airport", minutes: 150 }), leave: at(1, "03:35"), expect: "call", window: { leave_by: true, before: [60, 600] } },
  { label: "bp medicine", facts: todo("Take BP medicine", 0, "21:00"), expect: "call", window: { due: true, before: [5, 30] } },
  { label: "rent", facts: todo("Pay rent", 1, null, { kind: "due", amount: 25000, payee: "Mr Rao", pay: true }), expect: "call", window: { due: true, before: [60, 1440] } },
  { label: "school pickup", facts: ev("Pick up Kabir from school", 1, "15:30", { place: "Green Valley School", minutes: 30 }), leave: at(1, "15:05"), expect: "call", window: { leave_by: true, due: true, before: [5, 90] } },
  { label: "passport slot", facts: ev("Passport appointment", 2, "10:30", { place: "Passport Seva Kendra, Koramangala" }), leave: at(2, "09:30"), expect: "call", window: { leave_by: true, before: [30, 1440] } },
  { label: "exam", facts: ev("Board exam: Maths", 3, "09:00", { place: "Sunrise Public School", minutes: 180 }), leave: at(3, "08:00"), expect: "call", window: { leave_by: true, before: [30, 1440] } },
  { label: "court date", facts: ev("Court hearing", 2, "11:00", { place: "City Civil Court", minutes: 120 }), leave: at(2, "09:45"), expect: "call", window: { leave_by: true, before: [30, 1440] } },
  { label: "electricity bill", facts: todo("Electricity bill", 0, null, { kind: "due", amount: 2140, payee: "BESCOM", pay: true }), expect: "call", window: { due: true, before: [5, 1440] } },
  { label: "doctor", facts: ev("Dr. Mehta, cardiology follow-up", 1, "11:30", { place: "Manipal Hospital" }), leave: at(1, "10:45"), expect: "call", window: { leave_by: true, before: [30, 1440] } },
  { label: "train", facts: ev("Train to Chennai, Shatabdi 12008", 1, "06:00", { place: "Bengaluru City Junction" }), leave: at(1, "05:00"), expect: "call", window: { leave_by: true, before: [30, 720] } },
  { label: "insulin", facts: todo("Insulin before dinner", 0, "19:30"), expect: "call", window: { due: true, before: [5, 30] } },
  { label: "visa interview", facts: ev("US visa interview", 4, "08:15", { place: "US Consulate, Chennai", minutes: 120 }), expect: "call", window: { leave_by: true, before: [60, 1440] } },
  { label: "fee deadline", facts: todo("School fee last date, late fine after today", 0, null, { kind: "due", amount: 18000, payee: "Green Valley School" }), expect: "call", window: { due: true, before: [5, 1440] } },
  { label: "mother's dialysis", facts: ev("Take Amma for dialysis", 1, "07:00", { place: "Apollo Dialysis Centre", importance: "must" }), leave: at(1, "06:15"), expect: "call", window: { leave_by: true, before: [15, 720] } },
  { label: "airport pickup of a parent", facts: ev("Pick up Papa from airport, he is 70 and has no phone data", 1, "22:40", { place: "Kempegowda Airport" }), leave: at(1, "21:30"), expect: "call", window: { leave_by: true, before: [15, 720] } },
  // ---- 15 that clearly do not
  { label: "gym", facts: ev("Gym", 0, "18:30", { repeat: "daily" }), expect: "none" },
  { label: "buy milk", facts: todo("Buy milk at 6", 0, "18:00"), expect: "none" },
  { label: "standup", facts: ev("Standup", 1, "09:30", { repeat: "weekdays", minutes: 15 }), expect: "none" },
  { label: "movie", facts: ev("Movie with friends", 3, "19:00", { place: "PVR Forum Mall" }), expect: "none" },
  { label: "newsletter", facts: todo("Read the newsletter", 1, null), expect: "none" },
  { label: "water plants", facts: todo("Water the plants", 0, null), expect: "none" },
  { label: "podcast", facts: todo("Listen to the new podcast episode", 2, null), expect: "none" },
  { label: "coffee", facts: ev("Coffee with Ana", 2, "16:00", { place: "Third Wave Coffee" }), expect: "none" },
  { label: "team lunch", facts: ev("Team lunch", 1, "13:00", { place: "Office cafeteria" }), expect: "none" },
  { label: "tidy desk", facts: todo("Tidy my desk", 1, null), expect: "none" },
  { label: "plan trip", facts: todo("Think about weekend plans", 1, null), expect: "none" },
  { label: "book club", facts: ev("Book club", 3, "18:00", { place: "Matteo's place" }), expect: "none" },
  { label: "wash car", facts: todo("Wash the car", 2, null), expect: "none" },
  { label: "design review", facts: ev("Design review", 1, "15:00", { minutes: 45 }), expect: "none" },
  { label: "wait for plumber", facts: todo("Plumber said he will come this week", 3, null, { kind: "wait" }), expect: "none" },
  // ---- 10 borderline: either answer passes
  { label: "dentist", facts: ev("Dentist", 2, "17:00", { place: "Smile Clinic" }), expect: "either" },
  { label: "parent teacher meeting", facts: ev("Parent-teacher meeting", 2, "16:00", { place: "Green Valley School" }), expect: "either" },
  { label: "mobile recharge", facts: todo("Recharge phone", 1, null, { kind: "due", amount: 299, payee: "Jio" }), expect: "either" },
  { label: "client call", facts: ev("Call with client, contract sign-off", 1, "11:00", { minutes: 30 }), expect: "either" },
  { label: "insurance renewal", facts: todo("Renew car insurance", 2, null, { kind: "due", amount: 9800, payee: "ICICI Lombard" }), expect: "either" },
  { label: "birthday dinner", facts: ev("Meera's birthday dinner", 2, "20:00", { place: "Toit" }), expect: "either" },
  { label: "haircut", facts: ev("Haircut", 1, "12:00", { place: "Salon" }), expect: "either" },
  { label: "return parcel", facts: todo("Return the parcel before the window closes", 1, null), expect: "either" },
  { label: "vet", facts: ev("Take Bruno to the vet", 2, "10:00", { place: "Pet Care Clinic" }), expect: "either" },
  { label: "interview prep call", facts: ev("Mock interview with Rahul", 1, "19:00", { minutes: 45 }), expect: "either" },
];

function ctxOf(f: JudgeFacts, leave: number | undefined): JudgeCtx {
  const s = startsOf(f, NOW - DAY, NOW + 60 * DAY)[0]!;
  return {
    now: NOW, tz: IST, quiet: { from: 23 * 60, to: 7 * 60 }, next: { t: s.t, day: s.day }, dayLines: [`${f.allDay ? "all day" : clockAt(s.t, IST)} ${f.title} (this)`],
    names: null, others: 0, leave: leave ? { leaveBy: leave, minutes: 35, mode: "drive" } : null,
  };
}

async function main(): Promise<number> {
  const cfg = getConfig();
  if (!cfg.OPENROUTER_API_KEY) { console.log("Not set: OPENROUTER_API_KEY in tulmi/.env."); return 2; }
  const readers = serverReaders();
  let clearRight = 0, clearTotal = 0, windowRight = 0, windowTotal = 0, unparsed = 0, errors = 0, called = 0;
  for (const [i, it] of ITEMS.entries()) {
    let v: Verdict | null = null;
    try {
      const out = await readers.text(JUDGE_SYSTEM, judgeMessage(it.facts, ctxOf(it.facts, it.leave)), { ...JUDGE_READ });
      v = parseVerdict(out.text);
    } catch { errors += 1; console.log(`item ${i + 1} (${it.label}): could not be read`); continue; }
    if (!v) { unparsed += 1; console.log(`item ${i + 1} (${it.label}): the answer did not parse`); continue; }
    if (v.call) called += 1;
    if (it.expect === "either") continue;
    clearTotal += 1;
    if (v.call === (it.expect === "call")) clearRight += 1;
    else console.log(`item ${i + 1} (${it.label}): wanted ${it.expect === "call" ? "a call" : "no call"}`);
    if (it.expect === "call" && it.window) {
      windowTotal += 1;
      if (v.call && inWindow(v, it.window)) windowRight += 1;
      else if (v.call) console.log(`item ${i + 1} (${it.label}): called at ${v.at}, outside its window`);
    }
  }
  console.log(`call right: ${clearRight}/${clearTotal}; at in its window: ${windowRight}/${windowTotal}; unparsed: ${unparsed}; unread: ${errors}; called overall: ${called}/${ITEMS.length}.`);
  return clearRight >= 28 && windowRight >= 13 && unparsed === 0 && errors === 0 ? 0 : 1;
}

process.exit(await main());
