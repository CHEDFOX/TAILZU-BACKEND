import { describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";

// eslint-disable-next-line import/first
import { appendHistoryEntry, statsForUser } from "../src/history/store.js";
// eslint-disable-next-line import/first
import { buildScreen } from "../src/experience/catalog.js";
// eslint-disable-next-line import/first
import { curvePaths } from "../src/experience/statsCharts.js";

const keep = { retainHistory: true } as never;

describe("the detail behind each Stats card", () => {
  it("counts today by session, app, hour and kind, with local times", async () => {
    const user = { id: "u-detail-1", email: "a@b.c" } as never;
    await appendHistoryEntry(user, keep, { kind: "voice", input: "a one", output: "Hello there, friend.", wordsOut: 3, targetApp: "WhatsApp" } as never);
    await appendHistoryEntry(user, keep, { kind: "typing", input: "b two", output: "Send the deck today.", wordsOut: 4, targetApp: "Gmail" } as never);
    await appendHistoryEntry(user, keep, { kind: "draft", input: "c three", output: "Thanks, see you soon.", wordsOut: 4, targetApp: "WhatsApp" } as never);
    const s = await statsForUser(user, "month", 330);
    const today = s.days![s.days!.length - 1]!;
    expect(s.days).toHaveLength(30);
    expect(today).toMatchObject({ words: 11, sessions: 3, kinds: { voice: 3, typing: 4, draft: 4 } });
    expect(today.apps[0]).toEqual({ app: "WhatsApp", words: 7 });
    expect(today.hours).toHaveLength(24);
    expect(today.hours.reduce((a, b) => a + b, 0)).toBe(11);
    expect(today.first).toMatch(/^\d\d:\d\d$/);
    expect(s.todaySessions).toHaveLength(3);
    expect(s.todaySessions![0]).toMatchObject({ app: "WhatsApp", words: 4, kind: "draft" });
    expect(s.hourWords!.reduce((a, b) => a + b, 0)).toBe(11);
    expect(s.sessionLengths).toEqual([3, 0, 0, 0, 0]);
  });

  it("describes each app: how it was used, in which voice, and when last", async () => {
    const user = { id: "u-detail-2", email: "b@b.c" } as never;
    await appendHistoryEntry(user, keep, { kind: "voice", input: "x1", output: "one two three four", wordsOut: 4, targetApp: "Slack", presetId: "witty" } as never);
    await appendHistoryEntry(user, keep, { kind: "voice", input: "x2", output: "five six", wordsOut: 2, targetApp: "Slack" } as never);
    const s = await statsForUser(user, "month");
    const slack = s.appDetail!.find((a) => a.app === "Slack")!;
    expect(slack).toMatchObject({ words: 6, sessions: 2, avgWords: 3, kinds: { voice: 6, typing: 0, draft: 0 } });
    expect(slack.voices.map((v) => v.id)).toEqual(["witty", "signature"]);
    expect(Date.parse(slack.lastAt)).toBeGreaterThan(Date.now() - 60_000);
    const parts = slack.dayparts;
    expect(parts.morning + parts.afternoon + parts.evening + parts.night).toBe(2);
  });
});

describe("the Stats screen", () => {
  const perDay = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? 0 : 40 + i));
  const day = (w: number) => ({
    words: w, sessions: w ? 2 : 0, saidSeconds: w ? 30 : 0,
    apps: w ? [{ app: "WhatsApp", words: w }] : [], hours: new Array(24).fill(0).map((_, h) => (w && h === 10 ? w : 0)),
    kinds: { voice: w, typing: 0, draft: 0 }, languages: w ? [{ key: "en", words: w }] : [], ...(w ? { first: "10:02", last: "10:40" } : {}),
  });
  const ctx = {
    personality: {}, language: "en", tzOffsetMinutes: 330,
    usage: { month: { words: 250, audioSeconds: 120, requests: 9 }, total: { words: 900, audioSeconds: 500, requests: 60 }, today: { words: 69, audioSeconds: 30, requests: 2 } },
    stats: {
      window: "month", requests: 40, wordsOut: perDay.reduce((a, b) => a + b, 0), audioSeconds: 600, minutesSaved: 20, speakingMinutes: 10,
      sparklinePerDay: perDay.map((w) => (w ? 2 : 0)), wordsPerDay: perDay, daysActive: 20, currentStreak: 2, bestStreak: 2,
      kindWords: { voice: 900, typing: 200, draft: 0 }, topApps: [{ app: "WhatsApp", words: 1100 }],
      writtenIn: [{ key: "en", words: 1100 }], days: perDay.map(day),
      todaySessions: [{ at: "10:40", app: "WhatsApp", words: 30, kind: "voice" }],
      appDetail: [{ app: "WhatsApp", words: 1100, sessions: 40, kinds: { voice: 900, typing: 200, draft: 0 }, dayparts: { morning: 30, afternoon: 5, evening: 5, night: 0 }, avgWords: 27, lastAt: new Date().toISOString(), voices: [{ id: "signature", words: 1100 }] }],
      sessionLengths: [2, 10, 20, 6, 2], hourWords: new Array(24).fill(5), saidSecondsPerDay: perDay.map((w) => (w ? 30 : 0)),
    },
  };
  const screen = () => buildScreen("stats", ctx as never)! as any;
  const walk = (n: any, hit: (x: any) => void): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach((c) => walk(c, hit)); return; }
    if (typeof n.type === "string") hit(n);
    for (const v of Object.values(n)) if (v && typeof v === "object") walk(v, hit);
  };

  it("names the calendar month and its own words, not the thirty days'", () => {
    const s = JSON.stringify(screen());
    // With no meter to read, the line says the month's words itself: a
    // sentence is a row of words, each with the space after it.
    expect(s).toContain('"250 "');
    for (const w of ['"Words "', '"This "', '"Month."']) expect(s).toContain(w);
    // 1,100 is the thirty days' figure; it belongs to the cards, not the month.
    expect(s).not.toContain('"1,100 "');
  });

  it("says the same month's words under the month as Words this month does", () => {
    // The two were read differently and disagreed: the line under the month
    // from a read capped at a thousand rows, the meter from the month alone.
    const withAllow = {
      ...ctx,
      allowance: { base: 800, earned: 0, total: 800, used: 312, remaining: 488, streakDays: 1, grants: [], maxed: false, perVisit: [] },
    };
    const screen = buildScreen("stats", withAllow as never) as any;
    // The meter IS the line under the month now: one count, said once.
    const under = JSON.stringify(screen.root.children[0].children[1]);
    expect(under).toMatch(/312\. No Limit On Your Plan\.|488 Of 800, Back On The 1st\./);
    expect(JSON.stringify(screen)).not.toContain('"250 "');
  });

  it("ends on a way to the You tab, in the voice's own colour", () => {
    const s = screen();
    const page = s.root.children[0];
    const last = page.children[page.children.length - 1];
    expect(JSON.stringify(last)).toContain("Personalise Your Experience");
    expect(JSON.stringify(last)).toContain('"label":"Les Go"');
    expect(JSON.stringify(last)).not.toContain("Make it yours");
    expect(JSON.stringify(last.on.onPress)).toContain('"kind":"switchTab","tabId":"personality"');
    expect(last.style.backgroundColor).toBe("#F3EDE2");
    const pirate = buildScreen("stats", { ...ctx, personality: { activePresetId: "pirate" } } as never) as any;
    const pp = pirate.root.children[0];
    expect(pp.children[pp.children.length - 1].style.backgroundColor).toBe("#106A60");
  });

  it("starts the page under the settings gear", () => {
    const page = screen().root.children[0];
    expect(page.style.paddingTop).toBeGreaterThanOrEqual(58 + 34 + 24);
  });

  it("opens one day card from every block but today's, filled from that day", () => {
    const s = screen();
    const sets: string[] = [];
    walk(s.root, (n) => {
      for (const a of n.on?.onPress?.actions ?? []) {
        if (a.kind === "setState" && a.path === "dayView") sets.push(a.value);
      }
    });
    expect(sets).toHaveLength(29);
    expect(sets[0]).toBe("$state.dayData.0");
    // Each day's data is in the screen's state; a quiet day says so.
    expect(s.state.dayData).toHaveLength(30);
    expect(s.state.dayData[0]).toMatchObject({ quiet: true, headline: "A quiet day" });
    expect(s.state.dayData[1]).toMatchObject({ active: true, headline: "41 words", sessions: "2", first: "10:02" });
    expect(s.state.dayData[1].curve.line).toMatch(/^M/);
    expect(s.state.dayData[1].apps[0]).toMatchObject({ label: "WhatsApp" });
    // One day card, however many days.
    const dayPanels: string[] = [];
    walk(s.root, (n) => { if (n.visibleIf?.eq?.[0] === "openCard" && String(n.visibleIf.eq[1]).startsWith("day")) dayPanels.push(n.visibleIf.eq[1]); });
    expect(dayPanels).toEqual(["day"]);
  });

  it("lists today's sessions with their times on the Today card", () => {
    const s = JSON.stringify(screen());
    expect(s).toContain("10:40   WhatsApp");
    expect(s).toContain("30 Words, Said");
  });

  it("draws real charts: pies, curves and columns", () => {
    const types = new Set<string>();
    walk(screen().root, (n) => types.add(n.type));
    expect(types).toContain("PieChart");
    expect(types).toContain("SVG");
    const svgs: string[] = [];
    walk(screen().root, (n) => { if (n.type === "SVG" && typeof n.props?.d === "string" && n.props.d.includes("C")) svgs.push(n.props.d); });
    expect(svgs.length).toBeGreaterThan(3);
  });

  it("puts the language names in the card, small, and a ring on the page", () => {
    const s = screen();
    const page = s.root.children[0];
    const rings: any[] = [];
    walk(page, (n) => { if (n.type === "PieChart") rings.push(n); });
    expect(rings.length).toBeGreaterThan(0);
    expect(rings[0].props.legend).toBe(false);
    const json = JSON.stringify(s);
    expect(json).toContain("1,100 Words, 100%");
  });
});

describe("a curve", () => {
  it("never dips below its baseline, and closes its area", () => {
    const p = curvePaths([0, 100, 0, 0, 50, 0], 3);
    const ys = [...p.line.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]));
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
    expect(p.area.endsWith("Z")).toBe(true);
  });
});

describe("the You tab", () => {
  it("ends on a Stats card that opens the Stats tab", () => {
    const you = buildScreen("personality", {
      personality: {}, language: "en",
      stats: { wordsPerDay: Array.from({ length: 30 }, (_, i) => i % 2) },
    } as never) as any;
    const column = you.root.children[0].children[0].children;
    const last = column[column.length - 1];
    const json = JSON.stringify(last);
    expect(json).toContain("See What You Have Experienced So Far");
    expect(json).toContain('"label":"Stats"');
    // No title: the chart, the line in the hand, and the button.
    expect(json).not.toContain('"content":"Stats"');
    expect(JSON.stringify(last.on.onPress)).toContain('"kind":"switchTab","tabId":"stats"');
    // The month as a waveform: a bar a day, mirrored about the line.
    const wave = last.children[0];
    expect(wave.style.alignItems).toBe("center");
    expect(wave.children).toHaveLength(30);
  });
});
