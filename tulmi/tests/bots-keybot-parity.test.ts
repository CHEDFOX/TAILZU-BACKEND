/**
 * KEYBOT CARRIES THE OLD STATS AND YOU TABS (docs/bots-keybot-parity.md): src/keybot/stats.ts, the You lines in
 * src/keybot/views.ts, and the pages in experience/bots/screens/keybot.ts, keybotStats.ts and keybotYou.ts.
 *
 *   - the numbers view: the month as the meter counts it, the last 30 days, each day in the person's own day, apps,
 *     languages, voices and registers by name; what was not read is absent, never a zero standing in for it
 *   - Keybot's home: every item of the inventory is on it, on the phone and in the window, and each line opens its page
 *   - the pages: each draws for both clients, with its data and without, lint-clean, and its controls write through
 *     the routes the old screens used
 *   - over HTTP: GET /v1/keybot/stats is the signed-in person's own
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { SCREENS } = await import("../src/experience/bots/ids.js");
const { statsView } = await import("../src/keybot/stats.js");
const views = await import("../src/keybot/views.js");
const { registerBotsKeybotRoutes } = await import("../src/routes/botsKeybot.js");
const data = await import("./bots-keybot-data.js");
import type { Node } from "../../shared/types/sdui.js";

const { MONTH_STATS, USAGE, PERSONALITY, keybotApi, statsFor } = data;
const tz = `tz=${IST}`;
const texts = (root: Node) => walk(root).map((n) => String(n.props?.content ?? "")).filter(Boolean);
const json = (x: unknown) => JSON.stringify(x);
const req = (screenId: string, client: "phone" | "desktop", params: Record<string, string | number> = {}) => ({
  screenId, client, params, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya" }, can: new Set(["BotsKit"]), desk: { pages: client === "desktop", notes: false },
});
const build = (id: string, client: "phone" | "desktop", api: Record<string, unknown> = keybotApi(), params: Record<string, string | number> = {}) =>
  buildBotsScreen(req(id, client, params), fakeDeps({ api }));
/** Every screen a tree can open, with its params. */
const opens = (root: Node) => {
  const out: Array<{ screenId: string; params?: Record<string, unknown> }> = [];
  const visit = (x: unknown) => {
    if (Array.isArray(x)) { x.forEach(visit); return; }
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, unknown>;
    if (o.kind === "navigate" && typeof o.screenId === "string") out.push({ screenId: o.screenId, ...(o.params ? { params: o.params as Record<string, unknown> } : {}) });
    Object.values(o).forEach(visit);
  };
  visit(root);
  return out;
};

describe("the numbers view", () => {
  const v = statsFor();

  it("counts the month as the meter does, typed against said", () => {
    expect(v.month).toMatchObject({ name: "October", words: USAGE.month.words, dayOfMonth: 28, daysInMonth: 31 });
    expect(v.month.typedMinutes).toBeCloseTo(USAGE.month.words / 40, 0);
    expect(v.month.saidMinutes).toBeCloseTo(USAGE.month.audioSeconds / 60, 0);
    expect(v.month.projected).toBe(Math.round((USAGE.month.words / 28) * 31));
    expect(v.allowance).toMatchObject({ unlimited: true, used: USAGE.month.words });
    expect(statsFor({ unlimited: false }).allowance).toMatchObject({ unlimited: false, total: 1180, remaining: 240, earned: 380, base: 800 });
  });

  it("has the last 30 days, each day in the person's own day, Monday first, today last", () => {
    expect(v.days).toHaveLength(30);
    expect(v.days.slice(-3).map((d) => [d.label, d.weekday, d.words])).toEqual([["Mon 26 Oct", 0, 1012], ["Yesterday", 1, 944], ["Today", 2, 1284]]);
    expect(v.window).toMatchObject({ days: 30, words: MONTH_STATS.wordsOut, sessions: MONTH_STATS.requests, daysActive: 24, streak: 10, streakLive: true, bestStreak: 10 });
    expect(v.window.bestDay).toEqual({ label: "Sat 17 Oct", words: 1330 });
    expect(v.weeks.map((w) => w.label)).toEqual(["3 weeks ago", "2 weeks ago", "Last week", "This week"]);
    expect(v.weeks.reduce((a, w) => a + w.words, 0)).toBe(MONTH_STATS.wordsOut);
    expect(v.lifetime).toEqual({ words: 61_480, sessions: 2_310, spokenMinutes: Math.round(26_120 / 60) });
  });

  it("names apps, languages, voices and registers as people say them", () => {
    expect(v.apps.map((a) => [a.app, a.rank])).toEqual([["WhatsApp", 1], ["Gmail", 2], ["Slack", 3], ["Notes", 4], ["Other apps", 5]]);
    expect(v.apps.find((a) => a.key === "Gmail")?.voices).toEqual(["Professional", "Zu"]);
    expect(v.topApps.at(-1)?.label).toBe("Other apps");
    expect(v.languages.map((l) => l.label)).toEqual(["Hinglish", "English", "Hindi"]);
    expect(v.voices.map((x) => x.label)).toEqual(["Zu", "Professional", "Friendly"]);
    expect(v.registers.map((x) => x.label)).toEqual(["Zu", "Formal", "Casual"]);
    expect(v.dictionary).toMatchObject({ saved: 4, used: 3, inUse: 75, unusedWords: ["Dr. Kulkarni"] });
  });

  it("leaves out what was not read rather than showing a zero for it", () => {
    const none = statsView({ paid: false, free: false, now: 0, tzOffsetMinutes: IST });
    expect(none).toMatchObject({ empty: true, allowance: null, lifetime: null, hours: null, parts: null, lengths: null, kinds: null, dictionary: null, apps: [], days: [] });
    const usageOnly = statsView({ usage: USAGE, paid: true, free: false, now: 0, tzOffsetMinutes: IST });
    expect(usageOnly.window.words).toBe(USAGE.month.words);
    expect(usageOnly.empty).toBe(false);
  });
});

describe("the old You tab's lines", () => {
  it("the home view says the voice, languages, haptics, what it learned, its name, history, spellings and shortcuts", () => {
    const h = keybotApi()[`GET /v1/keybot?${tz}`] as ReturnType<typeof views.homeView>;
    expect(h).toMatchObject({
      style: { id: "signature", name: "Zu" }, languages: ["English", "Hindi", "Hinglish"], haptics: { all: false, keys: 5 },
      learned: { known: 6, sittings: 3 }, nickname: "Zara", keepHistory: true, fixes: [{ was: "Sarvari", word: "Sharvari" }], snippets: 2,
    });
    expect(views.homeView({ personality: {}, prefs: {}, now: 0, tzOffsetMinutes: 0 })).toMatchObject({ nickname: null, keepHistory: true, languages: [], fixes: [], snippets: 0 });
  });

  it("the words view carries every spelling pair, the shortcuts and how the words do", () => {
    const w = views.wordsView({ personality: PERSONALITY, dictionary: MONTH_STATS.dictionary, history: [], q: "upi" });
    expect(w.pairs).toEqual([{ word: "Sarvari", replacement: "Sharvari" }]);
    expect(w.snippets).toEqual([{ say: "my upi", get: "aanya@okhdfcbank" }]);
    expect(w.use).toMatchObject({ inUse: 75, top: [{ word: "Aanya", uses: 12 }, { word: "PRD", uses: 9 }, { word: "Koregaon Park", uses: 4 }] });
  });
});

describe("Keybot's home", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`carries the old Stats tab up top and the You tab's lines in groups (${client})`, async () => {
      const s = await build(SCREENS.keybot, client);
      expect(lintTree(s.root!)).toEqual([]);
      const t = texts(s.root!);
      for (const w of [
        // the numbers
        "October so far", "19,820 words", "Said", "Typed", "Words this month", "No limit on your plan.", "This week", "3,240 words",
        "Today", "1,284 words, said in 9 min.", "Where the words went", "WhatsApp", "Chats · Casual Hinglish", "36%",
        "How you speak · 3 languages", "Hinglish", "How the words came", "Drafted", "Days you talked", "17",
        "24 of the last 30 days. The longest run was 10 days.", "The last 30 days",
        "Sessions", "Day streak", "Per session", "Spoken", "Voices", "71%", "Your words", "75%",
        // the You tab's lines
        "Make it yours", "Voice", "Zu", "Tone per app", "Teach your style", "Knows 6 things about how you write, from 3 sittings",
        "Your words", "Languages", "English, Hindi, Hinglish", "What you call it", "X0, or Zara",
        "Keyboard and voice", "Haptics", "5 keys", "Read aloud", "What you said", "Keep what I say",
        "What the key does", "Good evening. Anything to write up before the day ends?",
      ]) expect(t.some((x) => x === w || x.includes(w)), `${client}: ${w}`).toBe(true);
      const to = opens(s.root!).map((o) => o.screenId);
      for (const id of [
        SCREENS.keyMonth, SCREENS.keyDay, SCREENS.keyApps, SCREENS.keySpeak, SCREENS.keyDays, SCREENS.keyWords, SCREENS.keyStyle, SCREENS.keyTone,
        SCREENS.keyTrain, SCREENS.language, SCREENS.keyName, SCREENS.keySettings, SCREENS.keyHaptics, SCREENS.keyVoices, SCREENS.keyHistory,
      ]) expect(to, `${client} opens ${id}`).toContain(id);
      expect(opens(s.root!)).toContainEqual({ screenId: SCREENS.keyApps, params: { app: "Gmail" } });
      expect(opens(s.root!)).toContainEqual({ screenId: SCREENS.keyDay, params: { day: 18 } });
      const j = json(s);
      // Keybot is part of the app: no account or help groups of its own (they live in the You tab).
      for (const w of ["Your account", "Help and about", "Write to us", "Delete account"]) expect(t.includes(w), `${client}: no ${w}`).toBe(false);
      expect(to).not.toContain(SCREENS.deleteAccount);
      expect(j).toContain('"path":"/v1/personality","body":{"retainHistory":"$state.keep"}');
      expect(s.state).toMatchObject({ keep: true, keyboardEnabled: true, micGranted: true });
    });
  }

  it("shows the words left, and what turning up earned, on a plan with a limit", async () => {
    const api = { ...keybotApi(), [`GET /v1/keybot/stats?${tz}`]: statsFor({ unlimited: false }) };
    const t = texts((await build(SCREENS.keybot, "phone", api)).root!);
    expect(t).toEqual(expect.arrayContaining(["Words left", "240 of 1,180", "Back on the 1st. 380 of these you earned by turning up."]));
  });

  it("draws each half on its own when the other could not be read", async () => {
    const onlyHome = { [`GET /v1/keybot?${tz}`]: keybotApi()[`GET /v1/keybot?${tz}`] };
    const a = texts((await build(SCREENS.keybot, "desktop", onlyHome)).root!);
    expect(a).toEqual(expect.arrayContaining(["Couldn't load your numbers.", "By app · this week", "Make it yours"]));
    const onlyStats = { [`GET /v1/keybot/stats?${tz}`]: statsFor() };
    const b = texts((await build(SCREENS.keybot, "phone", onlyStats)).root!);
    expect(b).toEqual(expect.arrayContaining(["Couldn't load your week.", "October so far", "Make it yours"]));
  });

  it("an empty month says so, not zeros in a grid", async () => {
    const api = { ...keybotApi(), [`GET /v1/keybot/stats?${tz}`]: statsView({ paid: false, free: true, now: 0, tzOffsetMinutes: IST }) };
    expect(texts((await build(SCREENS.keybot, "phone", api)).root!)).toContain("Nothing here yet.");
  });
});

describe("the pages", () => {
  const PAGES = [SCREENS.keyMonth, SCREENS.keyDay, SCREENS.keyApps, SCREENS.keySpeak, SCREENS.keyDays, SCREENS.keyStyle, SCREENS.keyHaptics, SCREENS.keyName];

  it("draw for both clients, with data and without, lint-clean", async () => {
    for (const id of PAGES) {
      for (const client of ["phone", "desktop"] as const) {
        const s = await build(id, client);
        expect(lintTree(s.root!), `${id} ${client}`).toEqual([]);
        expect(texts(s.root!).some((t) => t.startsWith("Couldn't load")), `${id} ${client} with data`).toBe(false);
        const none = await build(id, client, {});
        expect(lintTree(none.root!), `${id} ${client} without data`).toEqual([]);
        expect(texts(none.root!).some((t) => t.startsWith("Couldn't load")), `${id} ${client} says it couldn't load`).toBe(true);
      }
    }
  });

  it("This month: typed against said, the words left, every day, spoken, all time", async () => {
    const api = { ...keybotApi(), [`GET /v1/keybot/stats?${tz}`]: statsFor({ unlimited: false }) };
    const s = await build(SCREENS.keyMonth, "phone", api);
    const t = texts(s.root!);
    for (const w of ["Typed, it takes", "Said, it took", "Saved", "Said against typing", "Words left", "Earned by turning up", "Earned each visit",
      "Words a day · last 30 days", "By week", "This week", "Running total", "Spoken", "Words a minute", "Against typing, last 30 days", "Minutes saved",
      "All time", "Where it went", "Every day", "Yesterday"]) expect(t, w).toContain(w);
    expect(t.some((x) => x.startsWith("940 words so far in October. At this pace, about"))).toBe(true);
    expect(opens(s.root!)).toContainEqual({ screenId: SCREENS.keyDay, params: { day: 0 } });
  });

  it("a day: today by default, any day by its place, earlier and later, a quiet one, one that isn't there", async () => {
    const today = await build(SCREENS.keyDay, "phone");
    const t = texts(today.root!);
    for (const w of ["Today", "1,284 words", "Through the day", "Busiest at 7 pm.", "Said against typing", "How it was written", "Where it went", "Written in", "Time", "First words", "Every session", "7:22 pm · WhatsApp"]) expect(t, w).toContain(w);
    expect(json(today)).toContain('"screenId":"bots.keybot.day","params":{"day":28},"replace":true');
    expect(texts((await build(SCREENS.keyDay, "desktop", keybotApi(), { day: 27 })).root!)).toContain("Mon 26 Oct");
    expect(texts((await build(SCREENS.keyDay, "phone", keybotApi(), { day: 19 })).root!)).toContain("A quiet day");
    expect(texts((await build(SCREENS.keyDay, "phone", keybotApi(), { day: 99 })).root!)).toContain("That day isn't here.");
    const quietToday = { ...keybotApi(), [`GET /v1/keybot/stats?${tz}`]: statsFor({ stats: { ...MONTH_STATS, wordsPerDay: [...MONTH_STATS.wordsPerDay!.slice(0, 29), 0], days: undefined } }) };
    expect(texts((await build(SCREENS.keyDay, "phone", quietToday)).root!)).toContain("Nothing yet today. Say something in any app and it shows here, hour by hour.");
  });

  it("where the words went: every app, and one app's own page", async () => {
    const all = await build(SCREENS.keyApps, "phone");
    expect(texts(all.root!)).toEqual(expect.arrayContaining(["5 apps", "Share of words", "WhatsApp", "Words a session, by app"]));
    const gmail = texts((await build(SCREENS.keyApps, "desktop", keybotApi(), { app: "Gmail" })).root!);
    for (const w of ["Gmail", "28% of all your words · last 30 days", "number 2 of 5", "Day by day", "When in the day", "Mostly in the morning. Sessions by part of the day.", "Written as", "Professional, Zu", "Last used", "Its tone"]) expect(gmail, w).toContain(w);
    expect(texts((await build(SCREENS.keyApps, "phone", keybotApi(), { app: "Nope" })).root!)).toContain("Nothing for that app.");
  });

  it("how you speak and days and sessions carry the rest of the old cards", async () => {
    const speak = texts((await build(SCREENS.keySpeak, "phone")).root!);
    for (const w of ["3 languages", "What you write in", "Add languages", "How the words came", "Pace", "Words a minute, said", "Who writes for you · Zu 71%", "In which register", "Formal"]) expect(speak, w).toContain(w);
    const days = texts((await build(SCREENS.keyDays, "desktop")).root!);
    for (const w of ["A writing day", "Words each", "Day streak", "running now", "Best run", "Days written", "24/30", "Now, against your best", "Days you talked",
      "Written and quiet", "Sessions a day", "Time of day", "Mostly in the evening. Sessions by part of the day.", "Hour by hour", "Day of the week",
      "How long, in words", "Most sessions run 16–40 words.", "Words a session, by week", "By app", "Shape", "Biggest day", "Replies drafted"]) expect(days, w).toContain(w);
  });

  it("Voice: write as one, put it on the keyboard or take it off, edit, reset, make one", async () => {
    const s = await build(SCREENS.keyStyle, "phone");
    const t = texts(s.root!);
    expect(t).toEqual(expect.arrayContaining(["Zu", "Writing now", "On your keyboard · 2 of 6", "Professional", "Friendly", "Make a voice", "You said: “haan bhai kal milte hain paanch baje”"]));
    const j = json(s);
    expect(j).toContain('"path":"/v1/personality","body":{"activePresetId":"professional","activeTone":"none"}');
    expect(j).toContain('"path":"/v1/personality/pin","body":{"presetId":"professional","pinned":false}');
    expect(j).toContain('"path":"/v1/personality/pin","body":{"presetId":"witty","pinned":true}');
    expect(j).toContain('"path":"/v1/personality/tone","body":{"id":"$state.vcId","name":"$state.vcName","promptStyle":"$state.vcPrompt"}');
    expect(j).toContain('"path":"/v1/personality/tone","body":{"id":"professional","remove":true}');
  });

  it("Haptics: every key, asking first when keys were picked by hand, and keys one by one", async () => {
    const s = await build(SCREENS.keyHaptics, "phone");
    expect(s.state).toMatchObject({ all: false, askOff: false, layer: "letters" });
    const j = json(s);
    expect(j).toContain('"path":"/v1/personality/haptics","body":{"all":"$state.all"}');
    expect(j).toContain('"path":"/v1/personality/haptics","body":{"all":false,"clear":true}');
    expect(j).toContain('"path":"/v1/personality/haptics","body":{"key":"q"}');
    expect(j).toContain('"path":"/v1/personality/haptics","body":{"key":"mic"}');
    expect(texts(s.root!)).toEqual(expect.arrayContaining(["Every key", "5 keys picked by hand", "Turn every key off?", "Pick keys one by one"]));
    // Each key once across the layers: "@" is on the letters' bottom row only.
    expect(j.match(/"body":\{"key":"@"\}/g)).toHaveLength(1);
  });

  it("What you call it: a name of its own, or X0 only", async () => {
    const s = await build(SCREENS.keyName, "desktop");
    expect(s.state).toMatchObject({ name: "Zara" });
    expect(texts(s.root!)).toContain("X0, or Zara");
    const j = json(s);
    expect(j).toContain('"path":"/v1/personality","body":{"assistantName":"$state.name"}');
    expect(j).toContain('"path":"/v1/personality","body":{"assistantName":""}');
  });

  it("Your words: how they do, a spelling written back with every pair, shortcuts added and removed", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const s = await build(SCREENS.keyWords, client);
      const t = texts(s.root!);
      for (const w of ["Your words at work · this month", "75%", "Most used", "Never turned up", "Dr. Kulkarni", "Spellings", "Shortcuts · 2", "my upi", "Add the shortcut"]) expect(t, `${client}: ${w}`).toContain(w);
      const j = json(s);
      expect(j).toContain('"path":"/v1/profile","body":{"dictionary":[{"word":"Sarvari","replacement":"Sharvari"},{"word":"$state.heard","replacement":"$state.writeAs"}]}');
      expect(j).toContain('"path":"/v1/snippets","body":{"say":"$state.say","get":"$state.get"}');
      expect(j).toContain('"path":"/v1/snippets","body":{"remove":"my upi"}');
    }
  });
});

describe("the window's keyboard page", () => {
  it("has every switch the desk's Settings had for this computer, Start with the computer too", async () => {
    const api = { [`GET /v1/keybot/settings?${tz}`]: views.settingsView(PERSONALITY, {}) };
    const j = json(await build(SCREENS.keySettings, "desktop", api));
    for (const key of ["tap", "pill", "live", "pauseFlush", "autoStart"]) expect(j, key).toContain(`"kind":"desktop.config","key":"${key}","value":"$toggle"`);
  });
});

describe("over HTTP", () => {
  it("GET /v1/keybot/stats is the signed-in person's own, and says what it read", async () => {
    const app = Fastify();
    registerBotsKeybotRoutes(app, { rateLimit: { max: 1000, timeWindow: 60_000 }, bots: null, code: null, jobs: null, connectors: null, media: null, artifacts: null });
    expect((await app.inject({ method: "GET", url: "/v1/keybot/stats" })).statusCode).toBe(401);
    const r = await app.inject({ method: "GET", url: `/v1/keybot/stats?${tz}`, headers: { authorization: "Bearer kb-stats" } });
    expect(r.statusCode).toBe(200);
    const v = r.json();
    expect(v.days).toHaveLength(30);
    expect(v.month.name).toMatch(/^[A-Z][a-z]+$/);
    expect(v.window.words).toBe(0);
  });
});
