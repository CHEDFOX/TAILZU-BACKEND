/**
 * "PLAN SOMETHING": THE WORDS FIXES (PLAN_V2_MAKE; src/calendar/words.ts; docs/plan-ease.md "Plan something"). Each fix ships with its
 * test, and the box and the old form read every line they read before:
 *
 *   - "every month" is monthly, never weekly on Monday (whole weekday words only, and "every month" read first)
 *   - "every night", "every morning", "every evening" (and "har raat", "roz subah") are daily at that part of the day, and leave the title
 *   - "every Tue and Thu" is weekly on both days, `day` the first coming one
 *   - a bare hour says it was guessed (ReadLine.guessed); "9 am", "17:30" and "in the evening" are not
 *   - timeSaid reads the card's typed time: "6:30" is a guess, "06:30" and "18:30" are not (timeOf is not changed)
 */
import { describe, expect, it } from "vitest";

const { readLine, timeOf, timeSaid } = await import("../src/calendar/words.js");
const { Calendar, memoryCalendarRows } = await import("../src/calendar/index.js");
const { PlanEase } = await import("../src/botsBots/planEase.js");
const { memoryPlanPrefs } = await import("../src/botsBots/planPrefs.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");

const MIN = 60_000;
const IST = 330;
/** Thu 12 Nov 2026, 10:00 am in India (the spec's worked examples). */
const NOW = Date.UTC(2026, 10, 12, 10, 0) - IST * MIN;
const U = "aaaaaaaa-0000-4000-8000-000000000001";
const at = (w: string) => readLine(w, NOW, IST);

describe("the words fixes", () => {
  it("every month is monthly, not Monday", () => {
    expect(at("Book club every month 7 pm")).toMatchObject({ title: "Book club", repeat: "monthly", time: 19 * 60 });
    expect(at("Book club every month 7 pm").days).toBeUndefined();
    expect(at("Pay rent monthly")).toMatchObject({ repeat: "monthly" });
    // Whole weekday words still read as before.
    expect(at("Call Nani every Sunday 11 am")).toMatchObject({ title: "Call Nani", repeat: "weekly", day: "2026-11-15", time: 11 * 60 });
    expect(at("Team sync every mon 10 am")).toMatchObject({ title: "Team sync", repeat: "weekly", day: "2026-11-16" });
  });

  it("every night, every morning and every evening are daily at that part of the day, and leave the title", () => {
    expect(at("Take medicine every night at 9")).toMatchObject({ title: "Take medicine", repeat: "daily", time: 21 * 60 });
    expect(at("Take medicine every night at 9").guessed).toBeUndefined();
    expect(at("Mom's insulin every evening 8")).toMatchObject({ title: "Mom's insulin", repeat: "daily", time: 20 * 60 });
    expect(at("Remind Dad to take his tablet at 8 every morning")).toMatchObject({ title: "Remind Dad to take his tablet", repeat: "daily", time: 8 * 60 });
    expect(at("Water the plants every morning")).toMatchObject({ title: "Water the plants", repeat: "daily", time: 9 * 60 });
    expect(at("Walk every evening")).toMatchObject({ title: "Walk", repeat: "daily", time: 18 * 60 });
    expect(at("dawai har raat 9 baje")).toMatchObject({ title: "Dawai", repeat: "daily", time: 21 * 60 });
    expect(at("dawai roz raat 9 baje")).toMatchObject({ title: "Dawai", repeat: "daily", time: 21 * 60 });
    expect(at("Yoga roz subah 6")).toMatchObject({ title: "Yoga", repeat: "daily", time: 6 * 60 });
    // An hour said with am or pm is read as said, not by the part.
    expect(at("Gym every morning 6 am")).toMatchObject({ title: "Gym", repeat: "daily", time: 6 * 60 });
  });

  it("every Tue and Thu is weekly on both days", () => {
    // Today is a Thursday: the first coming one is today.
    expect(at("Kabir swimming every Tue and Thu 5 pm")).toMatchObject({ title: "Kabir swimming", repeat: "weekly", days: [2, 4], day: "2026-11-12", time: 17 * 60 });
    expect(at("Dance class every Mon, Wed and Fri 6 pm")).toMatchObject({ title: "Dance class", repeat: "weekly", days: [1, 3, 5], day: "2026-11-13" });
    expect(at("Tuition every Sat & Sun 9 am")).toMatchObject({ title: "Tuition", repeat: "weekly", days: [6, 0], day: "2026-11-14" });
    // One weekday has no list: the day is enough.
    expect(at("Call Nani every Sunday 11 am").days).toBeUndefined();
  });

  it("a bare hour is guessed and says so; 9 am, 17:30 and 'in the evening' are not", () => {
    expect(at("Gym at 9")).toMatchObject({ title: "Gym", time: 9 * 60, guessed: true });
    expect(at("Pick up Kabir at 3")).toMatchObject({ time: 15 * 60, guessed: true });
    expect(at("Yoga daily 6:30")).toMatchObject({ time: 18 * 60 + 30, guessed: true });
    expect(at("Call Mom 5 baje")).toMatchObject({ time: 17 * 60, guessed: true });
    for (const w of ["Gym at 9 am", "Gym 17:30", "Gym at 7 in the evening", "Gym 06:30", "Gym kal subah 7 baje", "Gym tonight at 9", "Diwali party Sat all day", "Buy milk"]) {
      expect(at(w).guessed, w).toBeUndefined();
    }
    expect(at("Gym at 7 in the evening").time).toBe(19 * 60);
  });

  it("timeSaid reads the card's typed time: 6:30 is a guess, 06:30 and 18:30 are not", () => {
    expect(timeSaid("6:30")).toEqual({ minute: 18 * 60 + 30, guessed: true });
    expect(timeSaid("9")).toEqual({ minute: 9 * 60, guessed: true });
    expect(timeSaid("7")).toEqual({ minute: 19 * 60, guessed: true });
    expect(timeSaid("06:30")).toEqual({ minute: 6 * 60 + 30, guessed: false });
    expect(timeSaid("18:30")).toEqual({ minute: 18 * 60 + 30, guessed: false });
    expect(timeSaid("5:30 pm")).toEqual({ minute: 17 * 60 + 30, guessed: false });
    expect(timeSaid("5.30pm")).toEqual({ minute: 17 * 60 + 30, guessed: false });
    expect(timeSaid("7 am")).toEqual({ minute: 7 * 60, guessed: false });
    expect(timeSaid("shaam 5 baje")).toEqual({ minute: 17 * 60, guessed: false });
    expect(timeSaid("7 in the evening")).toEqual({ minute: 19 * 60, guessed: false });
    expect(timeSaid("5 baje")).toEqual({ minute: 17 * 60, guessed: true });
    expect(timeSaid("noon")).toEqual({ minute: 12 * 60, guessed: false });
    for (const bad of ["", "25:00", "9:75", "half past", "13 pm", null, 9]) expect(timeSaid(bad), String(bad)).toBeNull();
    // timeOf is not changed: the forms and the bots read "7:00" as 24-hour, as before.
    expect([timeOf("7:00"), timeOf("6:30"), timeOf("7")]).toEqual([7 * 60, 6 * 60 + 30, 19 * 60]);
  });

  it("the box and the old form still read every line they read before", async () => {
    // How each line read before these fixes (backend HEAD 79b9d94, the same moment): only `guessed` and `days` may be added.
    const before: Array<[string, Record<string, unknown>]> = [
      ["Dentist Fri 5 pm", { title: "Dentist", task: false, time: 1020, day: "2026-11-13", daySaid: true }],
      ["Do laundry tomorrow", { title: "Do laundry", task: true, day: "2026-11-13", daySaid: true }],
      ["Find passport Fri", { title: "Find passport", task: true, day: "2026-11-13", daySaid: true }],
      ["Plan Riya's party Sat", { title: "Plan Riya's party", task: true, day: "2026-11-14", daySaid: true }],
      ["Help Arjun with homework 6 pm", { title: "Help Arjun with homework", task: false, time: 1080, day: "2026-11-12" }],
      ["Buy milk", { title: "Buy milk", task: true }],
      ["add dentist Friday 5 pm at Indiranagar", { title: "Dentist", task: false, time: 1020, day: "2026-11-13", daySaid: true, place: "Indiranagar" }],
      ["remind me to call Nani at 6", { title: "Call Nani", task: true, remind: true, time: 1080, day: "2026-11-12" }],
      ["Pay rent by Friday", { title: "Pay rent", task: true, day: "2026-11-13", daySaid: true }],
      ["Gym kal subah 7 baje", { title: "Gym", task: false, day: "2026-11-13", daySaid: true, time: 420 }],
      ["Team lunch 30 Nov 1-2 pm", { title: "Team lunch", task: false, time: 780, end: 840, day: "2026-11-30", daySaid: true }],
      ["Call Nani every Sunday 11 am", { title: "Call Nani", task: false, repeat: "weekly", day: "2026-11-15", daySaid: true, time: 660 }],
      ["put Rohan's match on my calendar Sat 12 pm", { title: "Rohan's match", task: false, time: 720, day: "2026-11-14", daySaid: true }],
      ["Diwali party Sat all day", { title: "Diwali party", task: false, allDay: true, day: "2026-11-14", daySaid: true }],
      ["Dinner with Mom Thu 7 pm in Koramangala", { title: "Dinner with Mom", task: false, time: 1140, day: "2026-11-12", daySaid: true, place: "Koramangala" }],
      ["Team offsite on Saturday at 10 am", { title: "Team offsite", task: false, time: 600, day: "2026-11-14", daySaid: true }],
      ["Electricity 2140 due today", { title: "Electricity 2140", task: true, day: "2026-11-12", daySaid: true }],
      ["Water bill 640 due tomorrow", { title: "Water bill 640", task: true, day: "2026-11-13", daySaid: true }],
      ["Standup every weekday 9:30 am", { title: "Standup", task: false, repeat: "weekdays", time: 570, day: "2026-11-13" }],
      ["Yoga daily 7 am", { title: "Yoga", task: false, repeat: "daily", time: 420, day: "2026-11-13" }],
      ["Flight to Delhi Sat 6 am", { title: "Flight to Delhi", task: false, time: 360, day: "2026-11-14", daySaid: true }],
      ["Mom ko doctor ke paas le jaana kal shaam 6 baje", { title: "Mom ko doctor ke paas le jaana", task: false, day: "2026-11-13", daySaid: true, time: 1080 }],
      ["dawai raat 9 baje", { title: "Dawai", task: false, time: 1260, day: "2026-11-12" }],
      ["Pick up Kabir from school Wed 3:30", { title: "Pick up Kabir from school", task: false, time: 930, day: "2026-11-18", daySaid: true }],
      ["Gym at 9", { title: "Gym", task: false, time: 540, day: "2026-11-13" }],
      ["Meeting at 4 pm for an hour", { title: "Meeting", task: false, time: 960, minutes: 60, day: "2026-11-12" }],
      ["School trip 20/11", { title: "School trip", task: true, day: "2026-11-20", daySaid: true }],
      ["Parent-teacher meeting 6:15 pm Fri", { title: "Parent-teacher meeting", task: false, time: 1095, day: "2026-11-13", daySaid: true }],
      ["Weekly review Fri 4 pm", { title: "Review", task: false, repeat: "weekly", time: 960, day: "2026-11-13", daySaid: true }],
      ["Water plants every weekday 7 am", { title: "Water plants", task: false, repeat: "weekdays", time: 420, day: "2026-11-13" }],
      ["Yoga daily 6:30", { title: "Yoga", task: false, repeat: "daily", time: 1110, day: "2026-11-12" }],
      ["Meds at 21:00", { title: "Meds", task: false, time: 1260, day: "2026-11-12" }],
    ];
    for (const [words, was] of before) {
      const { guessed: _g, days: _d, ...now } = at(words);
      expect(now, words).toEqual(was);
    }
    // The box adds as before, and the old form's "Dentist Fri 5 pm" in What still reads its day and time.
    const clock = { t: NOW };
    const c = new Calendar({ rows: memoryCalendarRows(), now: () => clock.t, publish: () => undefined });
    const ease = new PlanEase({ calendar: c, prefs: memoryPlanPrefs(() => clock.t), skips: new MemoryTable(), now: () => clock.t });
    expect(await ease.box(U, "Dentist Fri 5 pm", IST)).toMatchObject({ slot: "item", kind: "added", line: "Added: Dentist, Fri 13 Nov, 5 pm" });
    expect(await ease.box(U, "Buy milk", IST)).toMatchObject({ kind: "added", line: "Added: Buy milk" });
    const form = await c.addEvent(U, { title: "Dinner with Mom Thu 7 pm in Koramangala", day: "2026-11-12", time: "", tz: IST });
    expect(form).toMatchObject({ title: "Dinner with Mom", day: "2026-11-12", place: "Koramangala", allDay: false });
  });
});
