/**
 * KEYBOT'S PAGES (experience/bots/screens/keybot.ts, routes/botsKeybot.ts, src/keybot):
 *
 *   - the views: the week is Monday on in the person's own day, the days to come are empty; by app with each kind's tone;
 *     words with how often said and where last; the ten lines and what comes next; history searched; keyboard defaults
 *   - a tone choice is written into personality.appStyles for every app of its kind, and only those
 *   - every page draws for the phone and the window, with its data and without (the honest "couldn't load"), lint-clean
 *   - the controls are wired: a preset saves, a word is added and forgotten, a line is learned from, a voice is chosen
 *   - over HTTP: the person's own, validated; a tone reaches the personality; a said line goes through /v1/train/pick
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
  return {
    ...real,
    resolveUser: async (h: string | undefined) => {
      const id = h?.replace(/^Bearer\s+/i, "").trim();
      return id ? { id } : null;
    },
  };
});

const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, FIXED_NOW, IST } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const views = await import("../src/keybot/views.js");
const { withGroupStyles, compileStyle } = await import("../src/keybot/tones.js");
const { registerBotsKeybotRoutes } = await import("../src/routes/botsKeybot.js");
const { getPersonality, savePersonality } = await import("../src/personality/store.js");
import type { HistoryEntry, Personality } from "../../shared/types/api.js";
import type { Node } from "../../shared/types/sdui.js";

const H = 3_600_000;
const PERSON: Personality = {
  vocabulary: "Aanya\nPRD", dictionary: [{ word: "Sarvari", replacement: "Sharvari" }], ttsVoice: "sage", hapticsAll: true, languages: ["en", "hinglish"],
  stylePortrait: { words: [{ term: "haan", means: "yes, in chats" }], styles: [{ name: "In chats you skip the full stop", when: "with friends" }] },
};
const PREFS = { tones: { chats: { preset: "casual_hinglish" }, mail: { preset: "clear_polite" } }, read: { speed: "1.25" as const }, train: { said: { "0": "Happy birthday yaar", "1": "Call miss ho gaya" } } };
const day = (words: number, apps: Array<[string, number]>) => ({ words, sessions: 1, saidSeconds: 0, apps: apps.map(([app, w]) => ({ app, words: w })), hours: [], kinds: { voice: words, typing: 0, draft: 0 }, languages: [] });
const STATS = { days: [day(5, [["Slack", 5]]), day(6, []), day(7, []), day(8, []), day(1012, [["Gmail", 600], ["WhatsApp", 412]]), day(944, [["WhatsApp", 944]]), day(1284, [["Gmail", 1000], ["Notes", 284]])] };
const HIST: HistoryEntry[] = [
  { id: "00000000-0000-4000-8000-000000000001", kind: "voice", targetApp: "WhatsApp", input: "x", output: "Kal 7 baje Pune station pe milte hain", createdAt: new Date(FIXED_NOW - H).toISOString() },
  { id: "00000000-0000-4000-8000-000000000002", kind: "typing", targetApp: "Gmail", input: "x", output: "Sharvari will share the PRD by Friday.", createdAt: new Date(FIXED_NOW - 26 * H).toISOString() },
];

const texts = (root: Node) => walk(root).map((n) => String(n.props?.content ?? "")).filter(Boolean);
const presses = (root: Node) => walk(root).map((n) => JSON.stringify(n.on ?? {})).join("\n");
const req = (screenId: string, client: "phone" | "desktop", params: Record<string, string> = {}) => ({
  screenId, client, params, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya" }, can: new Set(["BotsKit"]), desk: { pages: client === "desktop", notes: false },
});

function api(): Record<string, unknown> {
  const tz = `tz=${IST}`;
  return {
    [`GET /v1/keybot?${tz}`]: views.homeView({ stats: STATS, personality: PERSON, prefs: PREFS, now: FIXED_NOW, tzOffsetMinutes: IST }),
    [`GET /v1/keybot/tone?${tz}`]: views.toneView(PREFS, "mail"),
    [`GET /v1/keybot/words?${tz}`]: views.wordsView({ personality: PERSON, dictionary: { saved: 2, used: 1, unused: 1, scanned: 9, top: [{ word: "Aanya", uses: 12 }], unusedWords: ["PRD"] }, history: HIST }),
    [`GET /v1/keybot/voices?${tz}`]: views.voicesView(PERSON, PREFS),
    [`GET /v1/keybot/train?${tz}`]: views.trainView(PERSON, PREFS),
    [`GET /v1/keybot/history?${tz}`]: views.historyView(HIST, PERSON),
    [`GET /v1/keybot/settings?${tz}`]: views.settingsView(PERSON, PREFS),
  };
}

describe("the views", () => {
  it("counts the week from Monday in the person's own day; the days to come are empty", () => {
    const v = views.homeView({ stats: STATS, personality: PERSON, prefs: PREFS, now: FIXED_NOW, tzOffsetMinutes: IST });
    // FIXED_NOW is Wednesday 28 October in India: Monday, Tuesday, today; the last week's four days are not this week's.
    expect(v.week.days.map((d) => d.label)).toEqual(["Mon", "Tue", "Today", "Thu", "Fri", "Sat", "Sun"]);
    expect(v.week.days.map((d) => d.words)).toEqual([1012, 944, 1284, 0, 0, 0, 0]);
    expect(v.week.days.filter((d) => d.ahead)).toHaveLength(4);
    expect(v.week.words).toBe(3240);
    expect(v.week.minutesSaved).toBe(81);
    expect(v.today).toBe(1284);
    expect(v.apps.map((a) => [a.app, a.words, a.line])).toEqual([
      ["Gmail", 1600, "Mail · Clear and polite"], ["WhatsApp", 1356, "Chats · Casual Hinglish"], ["Notes", 284, "As you say it"],
    ]);
    expect(v.voice).toEqual({ label: "Sage", speed: "1.25×" });
    expect(v.train).toEqual({ done: 2, total: 10 });
  });

  it("has nothing to say of a week with no stats, rather than a number it made up", () => {
    const v = views.homeView({ personality: {}, prefs: {}, now: FIXED_NOW, tzOffsetMinutes: IST });
    expect(v.week.words).toBe(0);
    expect(v.apps).toEqual([]);
    expect(v.tones).toEqual({ chats: null, mail: null, work: null });
  });

  it("lists the words added and learned, how often each was said, and where it was said last", () => {
    const v = views.wordsView({ personality: PERSON, dictionary: { saved: 2, used: 1, unused: 1, scanned: 9, top: [{ word: "Aanya", uses: 12 }], unusedWords: ["PRD"] }, history: HIST });
    expect(v.added.map((w) => [w.word, w.uses, w.was])).toEqual([["Sharvari", undefined, "Sarvari"], ["Aanya", 12, undefined], ["PRD", 0, undefined]]);
    expect(v.added[0]!.recent?.app).toBe("Gmail");
    expect(v.learned).toEqual([{ word: "haan", means: "yes, in chats" }]);
    expect(views.wordsView({ personality: PERSON, history: [], q: "shar" }).added.map((w) => w.word)).toEqual(["Sharvari"]);
  });

  it("knows the line to say now and the one before it", () => {
    const v = views.trainView(PERSON, { train: { said: { "0": "a", "2": "c" }, skipped: [1] } });
    expect([v.current, v.previous, v.done]).toEqual([3, 2, 2]);
    expect(v.learned.map((l) => l.kind)).toEqual(["word", "style"]);
    expect(views.trainView({}, { train: { skipped: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] } }).current).toBe(-1);
  });

  it("searches what you said, and says when history is off", () => {
    expect(views.historyView(HIST, {}, "pune").entries).toHaveLength(1);
    expect(views.historyView([], { retainHistory: false }).off).toBe(true);
    expect(views.settingsView(PERSON, {}).keyboard).toEqual({ look: "light", haptics: "light", height: "normal", sounds: false, holdSpace: true, keyAt: "left" });
    expect(views.settingsView(PERSON, {}).languages).toEqual([{ value: "en", label: "English" }, { value: "hinglish", label: "Hinglish" }]);
  });
});

describe("tone per app", () => {
  it("writes the kind's apps in the chosen tone, keeps every other app, and clears with no preset", () => {
    const before: Personality = { appStyles: { Notes: { note: "mine" }, whatsapp: { formality: "formal" } } };
    const p = withGroupStyles(before, "chats", { preset: "short_direct", noStop: true });
    expect(Object.keys(p.appStyles!).sort()).toEqual(["Instagram", "Messages", "Notes", "Signal", "Telegram", "WhatsApp"]);
    expect(p.appStyles!.WhatsApp!.note).toContain("Skip the full stop");
    expect(p.appStyles!.Notes).toEqual({ note: "mine" });
    expect(Object.keys(withGroupStyles(p, "chats", {}).appStyles!)).toEqual(["Notes"]);
    expect(compileStyle({ preset: "nope" })).toBeUndefined();
  });
});

describe("the pages", () => {
  const IDS = ["bots.keybot", "bots.keybot.tone", "bots.keybot.words", "bots.keybot.voices", "bots.keybot.train", "bots.keybot.history", "bots.keybot.settings"];

  it("draw for both clients, with data and without, lint-clean", async () => {
    for (const id of IDS) {
      for (const client of ["phone", "desktop"] as const) {
        const s = await buildBotsScreen(req(id, client), fakeDeps({ api: api() }));
        expect(lintTree(s.root!), `${id} ${client}`).toEqual([]);
        const none = await buildBotsScreen(req(id, client), fakeDeps());
        expect(lintTree(none.root!), `${id} ${client} without data`).toEqual([]);
        expect(texts(none.root!).some((t) => t.startsWith("Couldn't load")), `${id} ${client} says it couldn't load`).toBe(true);
      }
    }
  });

  it("the home page shows the week, by app this week (when the numbers could not be read) and the pages to make it yours", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const s = await buildBotsScreen(req("bots.keybot", client), fakeDeps({ api: api() }));
      const t = texts(s.root!);
      for (const w of ["3,240 words", "Make it yours", "Tone per app", "Teach your style", "2 of 10 done", "Sage · 1.25×", "Today · 1,284 words"]) expect(t, `${client}: ${w}`).toContain(w);
      if (client === "desktop") for (const w of ["By app · this week", "Gmail", "Mail · Clear and polite", "1,284", "Today", "Shortcut keys"]) expect(t, w).toContain(w);
    }
  });

  it("wires the controls to the routes", async () => {
    const tone = await buildBotsScreen(req("bots.keybot.tone", "desktop"), fakeDeps({ api: api() }));
    expect(tone.state).toMatchObject({ group: "mail", tone: { chats: "casual_hinglish", mail: "clear_polite", work: "" } });
    expect(presses(tone.root!)).toContain('"path":"/v1/keybot/tone","body":{"group":"work","preset":"warm_formal"}');
    expect(presses(tone.root!)).toContain('"noStop":"$state.little.chats.noStop"');

    const words = presses((await buildBotsScreen(req("bots.keybot.words", "phone"), fakeDeps({ api: api() }))).root!);
    expect(words).toContain('"path":"/v1/words","body":{"remove":"Sharvari","kind":"pair"}');
    expect(words).toContain('"path":"/v1/keybot/learned/forget","body":{"kind":"word","key":"haan"}');
    const wordsPage = await buildBotsScreen(req("bots.keybot.words", "phone"), fakeDeps({ api: api() }));
    expect(JSON.stringify(wordsPage)).toContain('"body":{"add":"$state.newWord"}');

    const train = await buildBotsScreen(req("bots.keybot.train", "phone"), fakeDeps({ api: api() }));
    expect(JSON.stringify(train)).toContain('"path":"/v1/keybot/train","body":{"line":2,"said":"$state.said"}');
    expect(texts(train.root!)).toContain("“Can you send me the address?”");

    const voices = await buildBotsScreen(req("bots.keybot.voices", "phone"), fakeDeps({ api: api() }));
    expect(voices.state).toMatchObject({ voice: "sage", read: { speed: "1.25" } });
    expect(presses(voices.root!)).toContain('"path":"/v1/personality","body":{"ttsVoice":"onyx"}');

    const history = await buildBotsScreen(req("bots.keybot.history", "desktop"), fakeDeps({ api: api() }));
    const h = JSON.stringify(history);
    expect(h).toContain('"kind":"copyText","text":"Kal 7 baje Pune station pe milte hain"');
    // Forget asks why first (the old History card), then deletes with the reason.
    expect(h).toContain('"kind":"setState","path":"askDelete","value":"00000000-0000-4000-8000-000000000001"');
    expect(h).toContain("Why should it go?");
    expect(h).toContain('"method":"DELETE","path":"/v1/history/$state.askDelete?reason=not_me"');
    expect(h).toContain('"method":"DELETE","path":"/v1/history/$state.askDelete?reason=cleanup"');
    expect(texts(history.root!)).toEqual(expect.arrayContaining(["Today", "Yesterday", "Chats", "Mail"]));

    const settings = await buildBotsScreen(req("bots.keybot.settings", "desktop"), fakeDeps({ api: api() }));
    expect(JSON.stringify(settings)).toContain('"kind":"desktop.config","key":"tap","value":"$toggle"');
    const phoneSettings = await buildBotsScreen(req("bots.keybot.settings", "phone"), fakeDeps({ api: api() }));
    expect(JSON.stringify(phoneSettings)).toContain('"path":"/v1/keybot/prefs","body":{"keyboard":{"haptics":"$state.kb.haptics"}}');
  });

  it("asks for what the person searched", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    await buildBotsScreen(req("bots.keybot.words", "phone", { q: "Shar vari" }), fakeDeps({ api: {}, calls }));
    expect(calls.map((c) => c.path)).toContain(`/v1/keybot/words?q=Shar%20vari&tz=${IST}`);
  });
});

describe("over HTTP", () => {
  const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
  const who = (user: string) => ({ authorization: `Bearer ${user}` });
  function served() {
    const app = Fastify();
    const picks: unknown[] = [];
    app.post("/v1/train/pick", async (r) => { picks.push(r.body); return { ok: true }; });
    registerBotsKeybotRoutes(app, { rateLimit: RL, bots: null, code: null, jobs: null, connectors: null, media: null, artifacts: null });
    return { app, picks };
  }

  it("is the signed-in person's own, and refuses what isn't a setting", async () => {
    const { app } = served();
    expect((await app.inject({ method: "GET", url: "/v1/keybot/tone" })).statusCode).toBe(401);
    expect((await app.inject({ method: "PUT", url: "/v1/keybot/prefs", headers: who("kb-a"), payload: { keyboard: { look: "neon" } } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/keybot/tone", headers: who("kb-a"), payload: { group: "chats", preset: "shouty" } })).statusCode).toBe(400);
  });

  it("a tone choice reaches the personality the writer reads, and the page opens on it", async () => {
    const { app } = served();
    const r = await app.inject({ method: "POST", url: "/v1/keybot/tone", headers: who("kb-b"), payload: { group: "work", preset: "warm_formal", signOff: true } });
    expect(r.statusCode).toBe(200);
    expect(r.json().focus).toBe("work");
    const p = await getPersonality({ id: "kb-b" });
    expect(p.appStyles?.Slack?.formality).toBe("formal");
    expect(p.appStyles?.Slack?.note).toContain("sign-off");
    const again = await app.inject({ method: "GET", url: "/v1/keybot/tone", headers: who("kb-b") });
    expect(again.json().groups.find((g: { id: string }) => g.id === "work")).toMatchObject({ preset: "warm_formal", signOff: true });
  });

  it("learns from a said line through the Train sheet's own route, then moves on", async () => {
    const { app, picks } = served();
    const r = await app.inject({ method: "POST", url: "/v1/keybot/train", headers: who("kb-c"), payload: { line: 0, said: "Happy birthday yaar!" } });
    expect(r.statusCode).toBe(200);
    expect(picks).toEqual([{ input: "Happy birthday! Have a lovely year.", chosen: "Happy birthday yaar!" }]);
    expect(r.json()).toMatchObject({ current: 1, previous: 0, done: 1 });
    const skip = await app.inject({ method: "POST", url: "/v1/keybot/train/skip", headers: who("kb-c"), payload: { line: 1 } });
    expect(skip.json().current).toBe(2);
  });

  it("haptics from the keyboard page switch what the keyboard reads; languages go in and out", async () => {
    const { app } = served();
    await savePersonality({ id: "kb-d" }, { languages: ["en"] });
    await app.inject({ method: "PUT", url: "/v1/keybot/prefs", headers: who("kb-d"), payload: { keyboard: { haptics: "strong" } } });
    expect((await getPersonality({ id: "kb-d" })).hapticsAll).toBe(true);
    await app.inject({ method: "PUT", url: "/v1/keybot/prefs", headers: who("kb-d"), payload: { keyboard: { haptics: "off" } } });
    expect((await getPersonality({ id: "kb-d" })).hapticsAll).toBe(false);
    const lang = await app.inject({ method: "POST", url: "/v1/keybot/language", headers: who("kb-d"), payload: { value: "hinglish", on: true } });
    expect(lang.json().languages.map((l: { value: string }) => l.value)).toEqual(["en", "hinglish"]);
    const prefs = await app.inject({ method: "GET", url: "/v1/keybot/prefs", headers: who("kb-d") });
    expect(prefs.json().prefs.keyboard).toEqual({ haptics: "off" });
  });

  it("forgets what it learned when the person says Not me", async () => {
    const { app } = served();
    await savePersonality({ id: "kb-e" }, { stylePortrait: { words: [{ term: "haan", means: "yes" }, { term: "kal", means: "tomorrow" }] } });
    const r = await app.inject({ method: "POST", url: "/v1/keybot/learned/forget", headers: who("kb-e"), payload: { kind: "word", key: "HAAN" } });
    expect(r.statusCode).toBe(200);
    expect((await getPersonality({ id: "kb-e" })).stylePortrait?.words?.map((w) => w.term)).toEqual(["kal"]);
  });
});
