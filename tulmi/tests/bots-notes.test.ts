/**
 * NOTES, ITS OWN THING (src/experience/bots/screens/notes.ts): Home's Notes tile with its own tiny bot, the window's sidebar
 * item, the meetings page with the week in numbers and the open to-dos, and a meeting's page whose to-dos tick off.
 */
import { describe, expect, it, vi } from "vitest";
import type { ActionSpec, Node } from "../../shared/types/sdui.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, FIXED_NOW, IST, SAMPLE_BOTS } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const texts = (n: Node): string[] => walk(n).filter((x) => x.type === "Text").map((x) => String(x.props?.content));
const json = (n: unknown): string => JSON.stringify(n);
const both = ["phone", "desktop"] as const;

const req = (screenId: string, client: "phone" | "desktop", params: Record<string, string | number | boolean> = {}, can: string[] = ["BotsKit"]) => ({
  screenId, client, params, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya Sharma" },
  can: new Set(can), desk: { pages: client === "desktop", notes: client === "desktop" },
});

const at = (ms: number) => new Date(FIXED_NOW - ms).toISOString();
const LIST = { notes: [
  { id: "n0", status: "recording", startedAt: at(16 * MIN), durationSeconds: 960, words: 40, title: "", summary: "", people: [], organised: false },
  { id: "n1", status: "ready", startedAt: at(3 * HOUR), durationSeconds: 2520, words: 900, title: "Salon booking app review", summary: "Reminders move to WhatsApp.", people: [{ label: "Speaker 1", name: "Kavya Rao" }, { label: "Speaker 2", name: "Rohan Mehta" }], organised: true, todos: 4, openTodos: 3, decisions: 3 },
  { id: "n2", status: "ready", startedAt: at(DAY), durationSeconds: 960, words: 300, title: "Call with our CA about GST filing", summary: "File by the 20th.", people: [{ label: "Speaker 1", name: "Vikram" }], organised: true, todos: 2, openTodos: 0 },
  { id: "n3", status: "ready", startedAt: at(10 * DAY), durationSeconds: 1440, words: 500, title: "Nani ka 80th birthday", summary: "Party at home.", people: [], organised: true },
] };
const NOTE = {
  id: "n1", status: "ready", startedAt: at(3 * HOUR), durationSeconds: 2520, words: 900, title: "Salon booking app review", summary: "Reminders move to WhatsApp.",
  people: [{ label: "Speaker 1", name: "Kavya Rao" }], organised: true, highlights: [{ speaker: "Speaker 1", text: "Weekends have the most no-shows." }],
  transcript: [{ at: 42, speaker: "Speaker 1", text: "Weekends pe sabse zyada no-shows hote hain." }, { at: 70, speaker: "You", text: "Code bot can start today." }],
  decisions: ["Reminders go out on WhatsApp", "Weekend slots need a ₹200 UPI deposit"],
  todos: [
    { id: "t1", text: "Move booking reminders to WhatsApp", who: "You", done: false },
    { id: "t2", text: "Check how deposit refunds reach the bank", who: "Rohan", when: "by Friday", done: false },
    { id: "t3", text: "Send Meera the new price list", who: "Speaker 1", done: true, doneAt: at(2 * HOUR) },
  ],
  found: { hash: "h", at: at(3 * HOUR), ok: true },
};
const STATS = { week: { meetings: 3, seconds: 4440, people: 3 }, openTodos: 3, recording: true, organising: 0 };

describe("Notes on Home", () => {
  it("a strip under the grid with its own tiny bot, in the grid's world; busier while a meeting is noted; the grid as it was", async () => {
    for (const client of both) {
      const s = await buildBotsScreen(req("bots.home", client, {}, ["BotsKit", "BotsMotion", "BotTilesStrip"]), fakeDeps({ api: { "GET /v1/shell/started": { started: true }, "GET /v1/notes/stats": STATS } }));
      const tiles = walk(s.root!).find((n) => n.type === "BotTiles")!;
      const specs = tiles.props!.tiles as Array<{ slug: string }>;
      expect(specs).toHaveLength(4);
      expect(specs.map((t) => t.slug)).not.toContain("notes");
      expect(SAMPLE_BOTS.map((b) => b.slug)).toEqual(expect.arrayContaining(specs.slice(0, 3).map((t) => t.slug)));
      expect(tiles.props!.strip).toMatchObject({ slug: "notes", kind: "notes", state: "working", sub: "Taking notes now", action: { kind: "navigate", screenId: "bots.notes" } });
      expect(s.liveTopics).toContain("notes");
    }
  });
  it("a build without the living strip: a still one under the grid; its line is the open to-dos when nothing is being noted", async () => {
    const s = await buildBotsScreen(req("bots.home", "phone"), fakeDeps({ api: { "GET /v1/shell/started": { started: true }, "GET /v1/notes/stats": { ...STATS, recording: false } } }));
    expect(texts(s.root!)).toEqual(expect.arrayContaining(["Notes", "3 to-dos open", "Make a bot"]));
    expect(json(s.root)).toContain('"screenId":"bots.notes"');
    // A failed read is a strip that says what it is for.
    const off = await buildBotsScreen(req("bots.home", "phone"), fakeDeps({ api: { "GET /v1/shell/started": { started: true } } }));
    expect(texts(off.root!)).toContain("Meetings, written up");
  });
  it("a window without the note-taker has no Notes strip and no sidebar item", async () => {
    const s = await buildBotsScreen({ ...req("bots.home", "desktop"), desk: { pages: true, notes: false } }, fakeDeps({ api: { "GET /v1/shell/started": { started: true } } }));
    expect(json(s.root)).not.toContain('"screenId":"bots.notes"');
    const w = await buildBotsScreen(req("bots.home", "desktop"), fakeDeps({ api: { "GET /v1/shell/started": { started: true } } }));
    expect(json(w.root)).toContain('"screenId":"bots.notes"');
  });
});

describe("the meetings", () => {
  const deps = () => fakeDeps({ api: { "GET /v1/notes?limit=100": LIST } });
  it("newest first, the week in numbers, the open to-dos, and in the window Start notes (or Stop, while one records)", async () => {
    const desk = await buildBotsScreen(req("bots.notes", "desktop"), deps());
    const words = texts(desk.root!);
    expect(words).toEqual(expect.arrayContaining([
      "Notes", "Meetings this week", "In meetings", "People met", "To-dos open", "1 h 14 min", "3",
      "Salon booking app review", "Recording now", "Taking notes…", "Earlier",
    ]));
    expect(words.some((w) => w.includes("3 to-dos open, 3 decisions"))).toBe(true);
    expect(words.some((w) => w.includes("2 to-dos done"))).toBe(true);
    expect(words.indexOf("Taking notes…")).toBeLessThan(words.indexOf("Salon booking app review"));
    expect(words).toContain("Stop notes");
    expect(json(desk.root)).toContain('"kind":"notes.toggle"');
    expect(desk.liveTopics).toContain("notes");
    const phone = await buildBotsScreen(req("bots.notes", "phone"), deps());
    expect(texts(phone.root!)).not.toContain("Stop notes");
    expect(texts(phone.root!)).not.toContain("Start notes");
    expect(texts(phone.root!)).toEqual(expect.arrayContaining(["Salon booking app review", "Meetings this week"]));
  });
  it("filters to the meetings with to-dos open, and searches", async () => {
    const open = await buildBotsScreen(req("bots.notes", "desktop", { f: "todos" }), deps());
    expect(texts(open.root!)).toContain("Salon booking app review");
    expect(texts(open.root!)).not.toContain("Call with our CA about GST filing");
    const q = await buildBotsScreen(req("bots.notes", "phone", { q: "gst" }), deps());
    expect(texts(q.root!)).toContain("Call with our CA about GST filing");
    expect(texts(q.root!)).not.toContain("Salon booking app review");
    const none = await buildBotsScreen(req("bots.notes", "desktop"), fakeDeps({ api: { "GET /v1/notes?limit=100": { notes: [] } } }));
    expect(texts(none.root!)).toEqual(expect.arrayContaining(["No meetings yet", "Start notes"]));
  });
});

describe("a meeting", () => {
  it("its decisions, numbered, and its to-dos, each ticked off where it is (and the tick saved)", async () => {
    for (const client of both) {
      const calls: Array<{ method: string; path: string; body?: unknown }> = [];
      const s = await buildBotsScreen(req("bots.note", client, { id: "n1" }), fakeDeps({ api: { "GET /v1/notes/n1": { note: NOTE, finding: false }, "GET /v1/botsapp/calendar/notes/n1": { todos: { t1: { id: "task-1", done: false } } } }, calls }));
      const words = texts(s.root!);
      expect(words).toEqual(expect.arrayContaining(["Decisions · 2", "01", "Reminders go out on WhatsApp", "To-dos · 3", "2 open", "Move booking reminders to WhatsApp", "Weekends have the most no-shows."]));
      expect(s.state).toMatchObject({ td_t1: false, td_t2: false, td_t3: true });
      const j = json(s.root);
      expect(j).toContain('{"kind":"toggleState","path":"td_t2"}');
      expect(j).toContain('"path":"/v1/notes/n1/todos/t2","body":{"done":"$state.td_t2"}');
      expect(s.liveTopics).toContain("note:n1");
      // Who: a speaker's name from the notes, a name said in the meeting, or You.
      if (client === "desktop") expect(words).toEqual(expect.arrayContaining(["Kavya Rao", "Rohan", "By Friday", "You"]));
      else expect(words).toEqual(expect.arrayContaining(["Rohan · By Friday", "You", "Kavya Rao · Done at 5:40 pm"]));
      // Its to-dos were read: nothing more is asked (only which are on the person's own list).
      expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /v1/notes/n1", "GET /v1/botsapp/calendar/notes/n1"]);
      // "Add to my tasks": a to-do onto the person's own list (src/calendar), once; one that is there says so, and its tick ticks it there too.
      expect(words).toContain("In your tasks");
      expect(j).toContain('"path":"/v1/botsapp/calendar/notes/n1/t2"');
      expect(j).toContain('"method":"PUT","path":"/v1/botsapp/calendar/notes/n1/t1","body":{"done":"$state.td_t1"}');
      expect(j).not.toContain('"path":"/v1/botsapp/calendar/notes/n1/t1","body":{"tz"');
    }
  });
  it("an older meeting never read asks for it once and says it is looking", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const old = { ...NOTE, todos: undefined, decisions: undefined, found: undefined };
    const s = await buildBotsScreen(req("bots.note", "desktop", { id: "n1" }), fakeDeps({ api: { "GET /v1/notes/n1": { note: old }, "POST /v1/notes/n1/find": { finding: true } }, calls }));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /v1/notes/n1", "POST /v1/notes/n1/find"]);
    expect(texts(s.root!)).toContain("Finding the to-dos and decisions…");
  });
  it("every Notes screen keeps the kit's rules on both clients, with data and without", async () => {
    const api = { "GET /v1/notes?limit=100": LIST, "GET /v1/notes/n1": { note: NOTE, finding: false }, "GET /v1/shell/started": { started: true }, "GET /v1/notes/stats": STATS };
    for (const id of ["bots.notes", "bots.note", "bots.home"]) {
      for (const client of both) {
        for (const can of [["BotsKit"], ["BotsKit", "BotsMotion", "BotBuddy"], ["BotsKit", "BotsMotion", "BotTilesStrip"]]) {
          for (const deps of [fakeDeps(), fakeDeps({ api })]) {
            const s = await buildBotsScreen(req(id, client, id === "bots.note" ? { id: "n1" } : {}, can), deps);
            expect(lintTree(s.root!), `${id} ${client}`).toEqual([]);
          }
        }
      }
    }
  });
});
