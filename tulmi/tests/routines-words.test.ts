import { describe, expect, it } from "vitest";
import { cleanSchedule, nextRun, nextWords, readRoutine, scheduleWords } from "../src/routines/words.js";

const IST = 330;
// Sat 1 Nov 2026, 10:00 in India.
const NOW = Date.parse("2026-11-01T10:00:00+05:30");

describe("readRoutine", () => {
  const cases: Array<[string, string, string]> = [
    ["Every morning at 8, check my email and tell me what matters", "Every day at 8 am", "Check my email and tell me what matters"],
    ["every day at 7:30 pm sum up what my bots did", "Every day at 7:30 pm", "Sum up what my bots did"],
    ["Every Friday at 5, sum up my week", "Every Friday at 5 pm", "Sum up my week"],
    ["Weekdays at 9am send me the top tech news", "Weekdays at 9 am", "Send me the top tech news"],
    ["On Mondays and Thursdays at 7 pm plan my gym sessions", "Every Mon and Thu at 7 pm", "Plan my gym sessions"],
    ["Find cheap flights to Goa every weekend", "Weekends at 9 am", "Find cheap flights to Goa"],
    ["On the 1st of every month at 10 am list my subscriptions", "On the 1st of every month at 10 am", "List my subscriptions"],
    ["daily, give me one new word to learn", "Every day at 9 am", "Give me one new word to learn"],
    ["Every evening at 7 plan tomorrow for me", "Every day at 7 pm", "Plan tomorrow for me"],
    ["Please check the weather in Lisbon every morning", "Every day at 9 am", "Check the weather in Lisbon"],
  ];
  for (const [said, when, task] of cases) {
    it(said, () => {
      const r = readRoutine(said, NOW, IST);
      expect(r).not.toBeNull();
      expect(scheduleWords(r!.schedule)).toBe(when);
      expect(r!.task).toBe(task);
    });
  }

  it("knows when no time was said", () => {
    expect(readRoutine("every week summarise my notes", NOW, IST)!.timeSaid).toBe(false);
    expect(readRoutine("every week at 6 pm summarise my notes", NOW, IST)!.timeSaid).toBe(true);
    // "every week" with no day is the day it was set up on (a Sunday).
    expect(scheduleWords(readRoutine("every week summarise my notes", NOW, IST)!.schedule)).toBe("Every Sunday at 9 am");
  });

  it("leaves what is not a routine alone", () => {
    for (const s of [
      "remind me every day at 8 to drink water",
      "how do I back up my laptop every day?",
      "what should I eat every morning",
      "every time I open Slack, mute it",
      "tell everyone the launch moved",
      "book a table for Friday at 8",
      "every day at 8",
      "fix the failing tests",
    ]) expect(readRoutine(s, NOW, IST), s).toBeNull();
  });
});

describe("nextRun", () => {
  it("runs later today, or on the next day it is due", () => {
    const daily = { every: "day" as const, minute: 20 * 60 };
    expect(nextWords(nextRun(daily, IST, NOW), IST, NOW)).toBe("Today at 8 pm");
    const morning = { every: "day" as const, minute: 8 * 60 };
    expect(nextWords(nextRun(morning, IST, NOW), IST, NOW)).toBe("Tomorrow at 8 am");
    // 1 Nov 2026 is a Sunday: weekdays start Monday.
    expect(nextWords(nextRun({ every: "weekdays", minute: 9 * 60 }, IST, NOW), IST, NOW)).toBe("Tomorrow at 9 am");
    expect(nextWords(nextRun({ every: "week", minute: 17 * 60, days: [5] }, IST, NOW), IST, NOW)).toBe("Fri 6 Nov at 5 pm");
    expect(nextWords(nextRun({ every: "month", minute: 9 * 60, monthDay: 1 }, IST, NOW), IST, NOW)).toBe("Tue 1 Dec at 9 am");
  });

  it("is in the person's own time", () => {
    const at = nextRun({ every: "day", minute: 8 * 60 }, -300, Date.parse("2026-11-01T12:00:00Z"));
    expect(new Date(at).toISOString()).toBe("2026-11-01T13:00:00.000Z");
  });
});

describe("cleanSchedule", () => {
  it("keeps good schedules and refuses the rest", () => {
    expect(cleanSchedule({ every: "week", minute: 60, days: [5, 1, 5] })).toEqual({ every: "week", minute: 60, days: [1, 5] });
    expect(cleanSchedule({ every: "month", minute: 60, monthDay: 31 })).toBeNull();
    expect(cleanSchedule({ every: "hour", minute: 60 })).toBeNull();
    expect(cleanSchedule({ every: "day", minute: 1440 })).toBeNull();
    expect(cleanSchedule({ every: "week", minute: 60, days: [] })).toBeNull();
  });
});
