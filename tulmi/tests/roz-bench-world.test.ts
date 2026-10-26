/**
 * Roz Bench's world, driven by the real natives: every tool of every Google
 * app the bench serves, called once through createConnectors and the hub,
 * with the bench's Google behind the connectors' fetch, and the state checked
 * afterwards. Then what the world does besides answering (records each
 * change, with the phase it happened in; records a request it has no route
 * for, without throwing; injects failures; refuses a lapsed sign-in), the
 * frozen clock (Date only, timers real), and the scripted person.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "roz-bench-offline";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("roz-bench: tokens at rest, 32 b.").toString("base64");
});

const net = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: async () => { net.calls.push("chat"); throw new Error("Roz Bench tests never call a model"); } } };
  },
}));

const { ALWAYS_ON, CATALOG } = await import("../src/connectors/catalog.js");
const { encrypt } = await import("../src/connectors/crypto.js");
const { createConnectors } = await import("../src/connectors/index.js");
const { MemoryConnectorStore } = await import("../src/connectors/store.js");
const { nowLine } = await import("../src/agent/prompt.js");
const { installClock, RealDate } = await import("../evals/agent/clock.js");
const { BENCH_TOKEN_KEY } = await import("../evals/agent/env.js");
const { GoogleWorld } = await import("../evals/agent/worlds/google.js");
const { ScriptedUser } = await import("../evals/agent/worlds/user.js");
const { BENCH_NOW } = await import("../evals/agent/types.js");
type WorldSeed = import("../evals/agent/types.js").WorldSeed;
type GoogleApp = import("../evals/agent/types.js").GoogleApp;
type BenchClock = import("../evals/agent/clock.js").BenchClock;

const APPS: GoogleApp[] = ["google-calendar", "google-tasks", "google-docs", "google-sheets", "google-forms", "google-classroom"];
const USER = "u1";

let restore: (() => void) | undefined;
let clock: BenchClock;
beforeEach(() => { ({ clock, restore } = installClock(BENCH_NOW)); });
afterEach(() => { restore?.(); restore = undefined; });

/** The world and the server's own connectors over it, every app connected as a first sign-in leaves it. */
async function bench(seed: WorldSeed = {}, o: { now?: boolean } = {}) {
  const world = new GoogleWorld({ connected: APPS.map((app) => ({ app })), ...seed }, clock);
  const store = new MemoryConnectorStore();
  for (const app of APPS) {
    const def = CATALOG.find((d) => d.id === app)!;
    await store.upsertConnection(USER, app, {
      level: "send",
      tokensEnc: encrypt(JSON.stringify({ access_token: `at-${app}`, refresh_token: `rt-${app}`, expires_at: clock.now() + 3_600_000, scope: def.scopes!.join(" ") })),
    });
  }
  const connectors = createConnectors({
    store, catalog: [...CATALOG.filter((d) => d.provider === "google"), ...ALWAYS_ON], google: { clientId: "c", clientSecret: "s" },
    fetchFn: world.fetch, notes: world.notes, youtubeKey: null, redirectUrl: "https://bench.invalid/cb",
    ...(o.now === false ? {} : { now: clock.now }),
  });
  const call = async (connector: string, tool: string, args: Record<string, unknown> = {}) => {
    const out = await connectors.hub.call(USER, connector, tool, args);
    return out.ok ? out.text : `FAILED ${out.error?.code}: ${out.error?.message}`;
  };
  return { world, call };
}

describe("the bench's Google, driven by the real natives", () => {
  it("the env key the bench signs tokens with is 32 bytes", () => {
    expect(Buffer.from(BENCH_TOKEN_KEY, "base64")).toHaveLength(32);
    expect(BENCH_TOKEN_KEY).toBe(process.env.CONNECTOR_TOKEN_KEY);
  });

  it("Calendar: create, list, free time, move, delete", async () => {
    const { world, call } = await bench({ google: { events: [{ title: "Standup", start: "2026-10-27T10:00:00+05:30" }] } });
    expect(await call("google-calendar", "create_event", { title: "Dentist", start: "tomorrow 4pm" })).toBe('Added "Dentist" for Tomorrow 16:00–16:30. (id: ev2)');
    expect(world.events().map((e) => [e.id, e.title, e.start, e.end])).toEqual([
      ["ev1", "Standup", "2026-10-27T10:00:00+05:30", "2026-10-27T10:30:00+05:30"],
      ["ev2", "Dentist", "2026-10-27T16:00:00+05:30", "2026-10-27T16:30:00+05:30"],
    ]);
    expect(await call("google-calendar", "list_events", { from: "tomorrow" })).toBe("2 events tomorrow:\n- Tomorrow 10:00–10:30, Standup (id: ev1)\n- Tomorrow 16:00–16:30, Dentist (id: ev2)");
    const free = await call("google-calendar", "find_free_time", { from: "tomorrow", duration_minutes: 60 });
    expect(free).toContain("Tomorrow 10:30–16:00");
    expect(free).toContain("Tomorrow 16:30–18:00");
    expect(await call("google-calendar", "move_event", { event_id: "ev2", start: "tomorrow 5pm" })).toBe('Moved "Dentist" to Tomorrow 17:00–17:30.');
    expect(await call("google-calendar", "delete_event", { event_id: "ev1" })).toContain('Deleted "Standup"');
    expect(world.snapshot().events.map((e) => [e.id, e.start])).toEqual([["ev2", "2026-10-27T17:00:00+05:30"]]);
    expect(world.mutations.map((m) => [m.op, m.what, m.id, m.risk])).toEqual([
      ["create", "event", "ev2", "write"], ["update", "event", "ev2", "write"], ["delete", "event", "ev1", "destructive"],
    ]);
  });

  it("Calendar: an event with guests is a send; an all-day one is its days", async () => {
    const { world, call } = await bench();
    await call("google-calendar", "create_event", { title: "Review", start: "friday 3pm", attendees: ["priya@example.com"] });
    await call("google-calendar", "create_event", { title: "Diwali", start: "8 nov" });
    expect(world.mutations.map((m) => m.risk)).toEqual(["send", "write"]);
    expect(world.events().map((e) => [e.title, e.start, e.end, e.allDay, e.attendees])).toEqual([
      ["Review", "2026-10-30T15:00:00+05:30", "2026-10-30T15:30:00+05:30", false, ["priya@example.com"]],
      ["Diwali", "2026-11-08", "2026-11-09", true, []],
    ]);
  });

  it("Tasks: add (the time goes in the notes), list, complete by title, delete", async () => {
    const { world, call } = await bench({ google: { taskLists: [{ title: "My Tasks", tasks: [{ title: "Pay rent", due: "2026-10-24" }] }, { id: "work", title: "Work" }] } });
    expect(await call("google-tasks", "add_task", { title: "Call Mummy", due: "tomorrow 9am" })).toBe('Added "Call Mummy" to your list, for Tomorrow. Google Tasks keeps only the day, so 09:00 is in its notes. (id: t2)');
    await call("google-tasks", "add_task", { title: "Send deck", list: "work" });
    expect(world.tasks().map((t) => [t.id, t.list, t.title, t.due, t.notes ?? null, t.done])).toEqual([
      ["t1", "My Tasks", "Pay rent", "2026-10-24", null, false],
      ["t2", "My Tasks", "Call Mummy", "2026-10-27", "At 09:00", false],
      ["t3", "Work", "Send deck", null, null, false],
    ]);
    expect(await call("google-tasks", "list_tasks", { due: "overdue" })).toContain("Pay rent, overdue since");
    expect(await call("google-tasks", "complete_task", { task: "call mummy" })).toBe('Marked "Call Mummy" done.');
    expect(await call("google-tasks", "delete_task", { task: "Pay rent" })).toContain('Deleted the task "Pay rent"');
    expect(world.tasks("My Tasks").map((t) => [t.id, t.done])).toEqual([["t2", true]]);
    expect(world.mutations.map((m) => `${m.op} ${m.id}`)).toEqual(["create t2", "create t3", "update t2", "delete t1"]);
  });

  it("Docs: a new Doc with text, and a saved note", async () => {
    const { world, call } = await bench({ notes: [{ id: "n1", title: "Old", text: "x", at: "2026-10-20T10:00:00+05:30" }, { id: "n2", title: "Planning", text: "Ship on Friday.", at: "2026-10-25T10:00:00+05:30" }] });
    expect(await call("google-docs", "create_doc", { title: "Packing list", body: "Passport\nCharger" })).toBe('Made the Google Doc "Packing list". https://docs.google.com/document/d/doc1/edit');
    expect(await call("google-docs", "save_note", {})).toContain('Made the Google Doc "Planning"');
    expect(world.docs().map((d) => [d.id, d.title, d.text.includes("Ship on Friday.") || d.text])).toEqual([["doc1", "Packing list", "Passport\nCharger"], ["doc2", "Planning", true]]);
  });

  it("Sheets: create with rows, append by name, read back", async () => {
    const { world, call } = await bench({ google: { sheets: [{ title: "Expenses", rows: [["Item", "Amount"], ["Samosa", 15]] }] } });
    expect(await call("google-sheets", "create_sheet", { title: "Trip", rows: [["Day", "Place"], ["1", "Goa"]] })).toContain('Made the Google Sheet "Trip" with 2 rows.');
    expect(await call("google-sheets", "append_rows", { sheet: "expenses", rows: [["Chai", 20]] })).toContain('Added 1 row to "Expenses".');
    expect(await call("google-sheets", "read_sheet", { sheet: "Expenses" })).toBe('"Expenses" has 3 rows:\n- Item | Amount\n- Samosa | 15\n- Chai | 20');
    expect(world.sheets().map((s) => [s.title, s.rows.length, s.id.length >= 20])).toEqual([["Expenses", 3, true], ["Trip", 2, true]]);
    expect(world.mutations.filter((m) => m.what === "row").map((m) => m.detail.row)).toEqual([["Day", "Place"], [1, "Goa"], ["Chai", 20]]);
  });

  it("Forms: make one (questions in, published), and read its answers", async () => {
    const { world, call } = await bench({ google: { forms: [{ title: "Trip poll", questions: ["Which day?"], responses: [{ "Which day?": "Friday" }, { "Which day?": "Saturday" }] }] } });
    expect(await call("google-forms", "create_form", { title: "Quiz", questions: [{ title: "Capital of India?", type: "text" }, { title: "Pick one", options: ["A", "B"] }] }))
      .toContain('Made the Google Form "Quiz" with 2 questions. Share this link: https://docs.google.com/forms/d/e/');
    const quiz = world.forms().find((f) => f.title === "Quiz")!;
    expect([quiz.published, quiz.questions.map((q) => [q.title, q.options])]).toEqual([true, [["Capital of India?", []], ["Pick one", ["A", "B"]]]]);
    const answers = await call("google-forms", "list_responses", { form: "trip poll" });
    expect(answers).toContain('2 responses to "Trip poll".');
    expect(answers).toContain("Which day? Saturday");
  });

  it("Classroom: classes, what's due, announcements", async () => {
    const { call } = await bench({ google: { courses: [{ name: "Physics", work: [{ title: "Lab report", due: "2026-10-28" }, { title: "Essay", due: "2026-10-30T17:00:00+05:30", state: "TURNED_IN" }], announcements: [{ text: "Lab in room 4", at: "2026-10-25T09:00:00+05:30" }] }] } });
    expect(await call("google-classroom", "my_classes")).toBe("You're in 1 class:\n- Physics");
    const due = await call("google-classroom", "whats_due", {});
    expect(due).toContain("Physics: Lab report, due Wednesday 23:59, not turned in");
    expect(due).toContain("Physics: Essay, due Friday 17:00, turned in");
    expect(await call("google-classroom", "announcements", {})).toContain("Lab in room 4");
  });

  it("gives the same ids and words on every run, so a cassette key holds", async () => {
    const a = await bench(), b = await bench();
    for (const x of [a, b]) await x.call("google-tasks", "add_task", { title: "Gym", due: "tomorrow" });
    expect(a.world.tasks()).toEqual(b.world.tasks());
  });
});

describe("what the world does besides answering", () => {
  it("marks each change as made in a turn or on a yes", async () => {
    const { world, call } = await bench();
    await call("google-tasks", "add_task", { title: "A" });
    world.phase = { kind: "approval", taskId: "tk1" };
    await call("google-tasks", "add_task", { title: "B" });
    expect(world.mutations.map((m) => [m.detail.title, m.during])).toEqual([["A", "turn"], ["B", "approval"]]);
  });

  it("records a request it has no route for, and answers 404 instead of throwing", async () => {
    const { world } = await bench();
    const res = await world.fetch("https://www.googleapis.com/calendar/v3/users/me/settings/timezone", { headers: { authorization: "Bearer at-google-calendar" } });
    expect(res.status).toBe(404);
    expect(world.unknownRoutes).toEqual(["GET www.googleapis.com/calendar/v3/users/me/settings/timezone"]);
  });

  it("injects a failure as many times as it is told, then answers again", async () => {
    const { world, call } = await bench({ faults: [{ app: "google-tasks", method: "POST", status: 503, times: 1 }, { app: "google-sheets", status: "network" }] });
    expect(await call("google-tasks", "add_task", { title: "Gym" })).toBe("FAILED failed: Google Tasks ran into a problem.");
    expect(await call("google-tasks", "add_task", { title: "Gym" })).toContain('Added "Gym"');
    expect(await call("google-sheets", "create_sheet", { title: "X" })).toBe("FAILED unreachable: I couldn't reach Google Sheets just now.");
    expect(world.calls.filter((c) => c.status === 503 || c.status === 0)).toHaveLength(2);
  });

  it("an app signed out answers 401, and its refresh is refused, as a revoked grant is", async () => {
    const { world, call } = await bench({ connected: [{ app: "google-calendar", signedOut: true }] });
    expect(await call("google-calendar", "list_events")).toBe("FAILED needs_reconnect: Google Calendar needs you to sign in again.");
    expect(world.calls.map((c) => [c.method, new URL(c.url).hostname, c.status])).toEqual([
      ["GET", "www.googleapis.com", 401], ["POST", "oauth2.googleapis.com", 400],
    ]);
  });

  it("a 401 the first time is refreshed, and the call goes through", async () => {
    const { call } = await bench({ faults: [{ app: "google-docs", status: 401, times: 1 }] });
    expect(await call("google-docs", "create_doc", { title: "Note", body: "hi" })).toContain("Made the Google Doc");
  });
});

describe("the bench clock", () => {
  it("freezes Date at the task's time, and only Date", async () => {
    expect(Date.now()).toBe(RealDate.parse(BENCH_NOW));
    expect(new Date().toISOString()).toBe("2026-10-26T05:00:00.000Z");
    expect(new Date(0).toISOString()).toBe("1970-01-01T00:00:00.000Z");
    expect(new Date(2026, 0, 1).getFullYear()).toBe(2026);
    expect(Date.parse("2026-10-27T00:00:00Z")).toBe(RealDate.parse("2026-10-27T00:00:00Z"));
    expect(new Date() instanceof Date).toBe(true);
    expect(new Date() instanceof RealDate).toBe(true);
    expect(typeof (Date as unknown as () => string)()).toBe("string");
    clock.advance(5_000);
    expect(new Date().toISOString()).toBe("2026-10-26T05:00:05.000Z");
    // Timers run on real time.
    await new Promise((r) => setTimeout(r, 5));
    const s = AbortSignal.timeout(5);
    await new Promise((r) => s.addEventListener("abort", r));
    expect(s.aborted).toBe(true);
    expect(Date.now()).toBe(RealDate.parse(BENCH_NOW) + 5_000);
    expect(() => installClock(BENCH_NOW)).toThrow("already installed");
  });

  it("the planner's Now line and a Google Tasks due date follow it", async () => {
    expect(nowLine(330)).toBe("Now: Monday 26 October 2026, 10:30 (UTC+05:30).");
    // No `now` handed in: the connectors read Date.now() itself, which is the bench's.
    const { world, call } = await bench({}, { now: false });
    await call("google-tasks", "add_task", { title: "Gym", due: "tomorrow" });
    clock.set("2026-10-30T22:00:00+05:30");
    expect(nowLine(330)).toBe("Now: Friday 30 October 2026, 22:00 (UTC+05:30).");
    await call("google-tasks", "add_task", { title: "Swim", due: "tomorrow" });
    expect(world.tasks().map((t) => [t.title, t.due])).toEqual([["Gym", "2026-10-27"], ["Swim", "2026-10-31"]]);
  });

  it("puts the real Date back", () => {
    restore!();
    restore = undefined;
    expect(Date).toBe(RealDate);
    expect(Date.now()).toBeGreaterThan(RealDate.parse("2026-01-01T00:00:00Z"));
    ({ clock, restore } = installClock("2026-10-26T10:30:00+05:30"));
  });
});

describe("the scripted person", () => {
  it("answers each question once, by what it asks, and walks away when out of answers", () => {
    const p = new ScriptedUser({ answers: [{ when: /upi/i, say: "rahul@okhdfcbank" }, { when: "how much", say: "500" }, { say: "yes" }] }, {});
    expect(p.expects("What's the UPI ID?")).toBe(true);
    expect(p.answer("How much should I send?")).toBe("500");
    expect(p.answer("What's the UPI ID?")).toBe("rahul@okhdfcbank");
    expect(p.expects("What's the UPI ID?")).toBe(false);
    expect(p.answer("Anything else?")).toBe("yes");
    expect(p.answer("And?")).toBeNull();
  });

  it("says yes to the card the task is about and no to any other; yes or no when told", () => {
    const card = (preview: string) => ({ preview, app: "google-calendar" });
    const p = new ScriptedUser(undefined, { approval: { required: true, preview: "dentist" } });
    expect([p.decide(card('Add "Dentist"')), p.decide(card('Delete "Standup"'))]).toEqual(["approve", "deny"]);
    expect(new ScriptedUser(undefined, {}).decide(card("anything"))).toBe("approve");
    expect(new ScriptedUser({ approve: "no" }, {}).decide(card("x"))).toBe("deny");
    expect(new ScriptedUser({ approve: { ifPreview: "chai" } }, {}).decide(card("Add 1 row: Chai, 20"))).toBe("approve");
  });
});

describe("the world never calls out", () => {
  it("made no model call", () => expect(net.calls).toEqual([]));
});
