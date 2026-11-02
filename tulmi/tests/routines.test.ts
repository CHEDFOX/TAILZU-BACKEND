/**
 * ROUTINES (src/routines, routes/bots/routines.ts, docs/routines.md): a bot does something on a schedule, without being asked each time.
 *
 *   - a draft is read from the words, the bot "Ask any bot" picks, and nothing is kept until Save
 *   - saving checks everything again: the bot, the task, the schedule, the cap, Xode refused, a duplicate refused
 *   - the tick runs each due routine once, as its owner, through the bot's own road; its answer kept, written down, pushed
 *   - a run hours late is skipped; three failed runs pause it with why; a deleted bot pauses it
 *   - pause, resume, run now, delete; the routes are the person's own; Ask turns "every Friday ..." into the card
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

const { Routines, MemoryRoutineStore, openDraft, LATE_MS } = await import("../src/routines/index.js");
const { BotError } = await import("../src/bots/types.js");
const { MemoryEventStore } = await import("../src/shell/events.js");
const { registerRoutineRoutes } = await import("../src/routes/bots/routines.js");
const { registerBotsShellRoutes } = await import("../src/routes/bots/botsShell.js");

const IST = 330;
const MIN = 60_000, HOUR = 60 * MIN;
// Sun 1 Nov 2026, 10:00 in India.
const T0 = Date.parse("2026-11-01T10:00:00+05:30");

type Def = { slug: string; name: string };
const BUILTIN: Def[] = [{ slug: "code", name: "Xode" }, { slug: "keybot", name: "Keylessbord" }, { slug: "plan", name: "Plan Ease" }, { slug: "travel", name: "Travel bot" }];

function world(o: { answer?: (slug: string, message: string) => { text: string; approvals?: unknown[] } | Error; pick?: string | null } = {}) {
  let now = T0;
  const asked: Array<{ userId: string; slug: string; message: string }> = [];
  const pushes: Array<{ userId: string; kind: string; vars: Record<string, string> }> = [];
  const published: string[][] = [];
  const bots = new Map<string, Def[]>([["u1", [...BUILTIN]], ["u2", [...BUILTIN]]]);
  const defOf = (d: Def) => ({ id: d.slug, ownerId: null, slug: d.slug, name: d.name, colour: "sea", purpose: "", principles: [], skills: { web: false, files: false, artifacts: false, code: false, research: false, connectors: [] }, knowledge: [], tone: "", visibility: "private", budgets: { perRequestPaise: 150, dailyPaise: 800 } });
  const fake = {
    async ask(userId: string, slug: string, input: { message: string }) {
      asked.push({ userId, slug, message: input.message });
      const a = o.answer?.(slug, input.message) ?? { text: `Done: ${input.message}` };
      if (a instanceof Error) throw a;
      return { bot: { slug, name: slug, colour: "sea", builtin: true }, text: a.text, paise: 12, tools: [], approvals: a.approvals ?? [], artifacts: [], opens: [], notes: [], ms: 5 } as never;
    },
    async resolve(userId: string, slug: string) {
      const d = (bots.get(userId) ?? []).find((b) => b.slug === slug);
      return d ? { def: defOf(d) as never } : null;
    },
    async target(userId: string) {
      const slug = o.pick === undefined ? "plan" : o.pick;
      const d = slug ? (bots.get(userId) ?? []).find((b) => b.slug === slug) : undefined;
      return d ? { kind: "bot" as const, bot: defOf(d) as never } : { kind: "front" as const, bot: null };
    },
    async list(userId: string) { return (bots.get(userId) ?? []).map((b) => ({ ...b, builtin: true })); },
  };
  const store = new MemoryRoutineStore();
  const events = new MemoryEventStore();
  const r = new Routines({
    store, bots: fake, events, now: () => now, max: 3,
    notify: async (userId, msg) => { pushes.push({ userId, kind: msg.kind, vars: msg.vars }); },
    publish: (_u, topics) => { published.push(topics); },
  });
  return { r, store, events, asked, pushes, published, bots, at: (t: number) => { now = t; }, now: () => now };
}

describe("a draft", () => {
  it("reads the schedule and the task, picks the bot, keeps nothing", async () => {
    const w = world();
    const d = await w.r.draft("u1", "Every Friday at 5, sum up my week", IST);
    expect(d).toMatchObject({ task: "Sum up my week", when: "Every Friday at 5 pm", next: "Fri 6 Nov at 5 pm", bot: { slug: "plan", name: "Plan Ease" }, timeSaid: true });
    expect(d!.choices.map((c) => c.slug)).toEqual(["keybot", "plan", "travel"]);
    expect(openDraft(d!.token)).toMatchObject({ task: "Sum up my week", bot: "plan", tz: IST });
    expect(await w.r.list("u1")).toEqual([]);
  });
  it("is null for words that are not a routine, and has no bot when none fits", async () => {
    const w = world({ pick: null });
    expect(await w.r.draft("u1", "what's the weather tomorrow", IST)).toBeNull();
    expect((await w.r.draft("u1", "every morning check the news for me", IST))!.bot).toBeNull();
    // Xode is never picked for a routine.
    expect((await world({ pick: "code" }).r.draft("u1", "every morning check the news for me", IST))!.bot).toBeNull();
  });
  it("uses the bot the person chose", async () => {
    const d = await world().r.draft("u1", "every morning find me a cheap flight to Goa", IST, "travel");
    expect(d!.bot).toEqual({ slug: "travel", name: "Travel bot" });
  });
});

describe("saving", () => {
  it("from the card's token, with the bot chosen on the card", async () => {
    const w = world();
    const d = await w.r.draft("u1", "every day at 8 am send me the top tech news", IST);
    const v = await w.r.create("u1", { token: d!.token, bot: "travel" });
    expect(v).toMatchObject({ task: "Send me the top tech news", when: "Every day at 8 am", bot: { slug: "travel", name: "Travel bot" }, status: "on", next: { words: "Tomorrow at 8 am" }, last: null });
    expect(w.published.at(-1)).toContain("routines");
  });
  it("checks everything again", async () => {
    const w = world();
    const s = { every: "day", minute: 8 * 60 };
    await expect(w.r.create("u1", { task: "Fix the bugs", schedule: s, tz: IST, bot: "code" })).rejects.toMatchObject({ code: "code_bot" });
    await expect(w.r.create("u1", { task: "Plan it", schedule: s, tz: IST, bot: "nobody" })).rejects.toMatchObject({ code: "not_found" });
    await expect(w.r.create("u1", { task: "Plan it", schedule: { every: "hour" }, tz: IST, bot: "plan" })).rejects.toMatchObject({ code: "bad_schedule" });
    await expect(w.r.create("u1", { task: "x", schedule: s, tz: IST, bot: "plan" })).rejects.toMatchObject({ code: "task_required" });
    await expect(w.r.create("u1", { task: "Plan it", schedule: s, tz: IST })).rejects.toMatchObject({ code: "bot_required" });
    await expect(w.r.create("u1", { token: "not a token" })).rejects.toMatchObject({ code: "bad_token" });
    await w.r.create("u1", { task: "Plan my day", schedule: s, tz: IST, bot: "plan" });
    await expect(w.r.create("u1", { task: "plan my day", schedule: s, tz: IST, bot: "plan" })).rejects.toMatchObject({ code: "routine_exists" });
    await w.r.create("u1", { task: "Plan my week", schedule: s, tz: IST, bot: "plan" });
    await w.r.create("u1", { task: "Plan my month", schedule: s, tz: IST, bot: "plan" });
    await expect(w.r.create("u1", { task: "One too many", schedule: s, tz: IST, bot: "plan" })).rejects.toMatchObject({ code: "routines_full" });
  });
});

describe("the tick", () => {
  it("runs what is due once, as its owner, and keeps, writes down and pushes the answer", async () => {
    const w = world({ answer: () => ({ text: "3 emails matter: the bank, Riya's invite and the landlord." }) });
    const v = await w.r.create("u1", { task: "Check my email and tell me what matters", schedule: { every: "day", minute: 8 * 60 }, tz: IST, bot: "plan" });
    expect(await w.r.tick()).toBe(0);
    w.at(Date.parse("2026-11-02T08:00:30+05:30"));
    expect(await w.r.tick()).toBe(1);
    expect(await w.r.tick()).toBe(0);  // claimed: never twice for one time
    expect(w.asked).toEqual([{ userId: "u1", slug: "plan", message: "Check my email and tell me what matters" }]);
    const after = await w.r.get("u1", v.id);
    expect(after).toMatchObject({ runs: 1, next: { words: "Tomorrow at 8 am" }, last: { status: "done", text: "3 emails matter: the bank, Riya's invite and the landlord.", paise: 12, words: "Today at 8 am" } });
    expect((await w.events.list("u1", 0))[0]).toMatchObject({ kind: "ask", bot: "plan", title: "Check my email and tell me what matters", paise: 12 });
    expect(w.pushes).toEqual([{ userId: "u1", kind: "routine_done", vars: { bot: "Plan Ease", task: "Check my email and tell me what matters", line: "3 emails matter: the bank, Riya's invite and the landlord." } }]);
  });
  it("says when it needs the person's OK", async () => {
    const w = world({ answer: () => ({ text: "Drafted the reply to Riya.", approvals: [{ id: "a1" }] }) });
    const v = await w.r.create("u1", { task: "Answer Riya", schedule: { every: "day", minute: 8 * 60 }, tz: IST, bot: "plan" });
    w.at(Date.parse("2026-11-02T08:01:00+05:30"));
    await w.r.tick();
    expect((await w.r.get("u1", v.id)).last!.status).toBe("needs");
    expect(w.pushes[0]!.vars.line).toBe("It needs your OK. Drafted the reply to Riya.");
  });
  it("skips a run hours late and works out the next from now", async () => {
    const w = world();
    const v = await w.r.create("u1", { task: "Plan my day", schedule: { every: "day", minute: 8 * 60 }, tz: IST, bot: "plan" });
    w.at(Date.parse("2026-11-02T08:00:00+05:30") + LATE_MS + MIN);
    expect(await w.r.tick()).toBe(0);
    expect(w.asked).toEqual([]);
    expect((await w.r.get("u1", v.id)).next!.words).toBe("Tomorrow at 8 am");
  });
  it("pauses after three failed runs in a row, with why, and tells the person", async () => {
    const w = world({ answer: () => new BotError("bot_daily_limit", "Plan Ease has used its budget for today.", 429) });
    const v = await w.r.create("u1", { task: "Plan my day", schedule: { every: "day", minute: 8 * 60 }, tz: IST, bot: "plan" });
    for (const day of ["02", "03", "04"]) { w.at(Date.parse(`2026-11-${day}T08:00:10+05:30`)); await w.r.tick(); }
    const after = await w.r.get("u1", v.id);
    expect(after).toMatchObject({ status: "paused", next: null, last: { status: "failed", text: "Plan Ease has used its budget for today." } });
    expect(after.pausedWhy).toContain("Paused after 3 runs");
    expect(w.pushes.map((p) => p.kind)).toEqual(["routine_failed"]);
    // Resumed: on again, its failures forgotten, its next run from now.
    const back = await w.r.update("u1", v.id, { status: "on" });
    expect(back).toMatchObject({ status: "on", pausedWhy: "", next: { words: "Tomorrow at 8 am" } });
  });
  it("pauses when its bot was deleted", async () => {
    const w = world();
    w.bots.set("u1", [...BUILTIN, { slug: "gym-coach", name: "Gym coach" }]);
    const v = await w.r.create("u1", { task: "Plan my workouts", schedule: { every: "day", minute: 8 * 60 }, tz: IST, bot: "gym-coach" });
    w.bots.set("u1", [...BUILTIN]);
    w.at(Date.parse("2026-11-02T08:00:10+05:30"));
    await w.r.tick();
    expect(await w.r.get("u1", v.id)).toMatchObject({ status: "paused", pausedWhy: "Gym coach was deleted. Pick another bot to turn it back on." });
    expect(w.asked).toEqual([]);
  });
});

describe("pause, run now, delete", () => {
  it("does what the list's buttons say", async () => {
    const w = world();
    const v = await w.r.create("u1", { task: "Plan my day", schedule: { every: "day", minute: 8 * 60 }, tz: IST, bot: "plan" });
    expect(await w.r.update("u1", v.id, { status: "paused" })).toMatchObject({ status: "paused", next: null });
    w.at(Date.parse("2026-11-02T08:00:10+05:30"));
    expect(await w.r.tick()).toBe(0);
    const ran = await w.r.runNow("u1", v.id);
    expect(ran).toMatchObject({ status: "paused", runs: 1, last: { status: "done" } });
    await expect(w.r.runNow("u1", v.id)).rejects.toMatchObject({ code: "too_soon" });
    await expect(w.r.get("u2", v.id)).rejects.toMatchObject({ code: "not_found" });
    await w.r.remove("u1", v.id);
    expect(await w.r.list("u1")).toEqual([]);
  });
});

describe("the routes", () => {
  const build = async () => {
    const w = world();
    const app = Fastify();
    registerRoutineRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, routines: w.r });
    await app.ready();
    return { app, w };
  };
  const who = (id: string) => ({ authorization: `Bearer ${id}` });

  it("are the person's own, and draft, save, list, pause, run and delete", async () => {
    const { app } = await build();
    expect((await app.inject({ method: "GET", url: "/v1/routines" })).statusCode).toBe(401);
    const d = await app.inject({ method: "POST", url: "/v1/routines/draft", headers: who("u1"), payload: { message: "Every Friday at 5, sum up my week", tz: IST } });
    expect(d.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/v1/routines/draft", headers: who("u1"), payload: { message: "hello there", tz: IST } })).json()).toMatchObject({ code: "not_a_routine" });
    const saved = await app.inject({ method: "POST", url: "/v1/routines", headers: who("u1"), payload: { token: d.json().draft.token } });
    expect(saved.statusCode).toBe(201);
    const id = saved.json().routine.id;
    const list = (await app.inject({ method: "GET", url: "/v1/routines", headers: who("u1") })).json();
    expect(list).toMatchObject({ max: 3, routines: [{ id, task: "Sum up my week" }] });
    expect((await app.inject({ method: "GET", url: "/v1/routines", headers: who("u2") })).json().routines).toEqual([]);
    expect((await app.inject({ method: "POST", url: `/v1/routines/${id}/status`, headers: who("u2"), payload: { status: "paused" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/routines/${id}/status`, headers: who("u1"), payload: { status: "paused" } })).json().routine.status).toBe("paused");
    expect((await app.inject({ method: "POST", url: `/v1/routines/${id}/run`, headers: who("u1") })).json().routine.runs).toBe(1);
    expect((await app.inject({ method: "DELETE", url: `/v1/routines/${id}`, headers: who("u1") })).statusCode).toBe(204);
  });

  it("are off without the service", async () => {
    const app = Fastify();
    registerRoutineRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, routines: null });
    expect((await app.inject({ method: "GET", url: "/v1/routines", headers: who("u1") })).json()).toMatchObject({ code: "routines_off" });
  });

  it("Ask turns words about a schedule into the routine's card, and answers anything else", async () => {
    const w = world();
    const app = Fastify();
    let asked = 0;
    app.post("/v1/ask", async () => { asked++; return { result: { text: "Sunny", paise: 3 }, decision: { route: "chat" } }; });
    registerBotsShellRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, bots: null, code: null, jobs: null, connectors: null, media: null, artifacts: null, routines: w.r }, { events: new MemoryEventStore() });
    await app.ready();
    const r = await app.inject({ method: "POST", url: "/v1/shell/ask", headers: who("u1"), payload: { message: "Every Friday at 5, sum up my week", tz: IST } });
    expect(r.json().shell).toMatchObject({ bot: { slug: "plan", name: "Plan Ease" }, text: "Every Friday at 5 pm: Sum up my week. Save it as a routine?", routine: { when: "Every Friday at 5 pm", task: "Sum up my week" } });
    expect(asked).toBe(0);
    const plain = await app.inject({ method: "POST", url: "/v1/shell/ask", headers: who("u1"), payload: { message: "Weather in Lisbon tomorrow?" } });
    expect(plain.json().shell.text).toBe("Sunny");
    expect(asked).toBe(1);
  });
});

describe("time", () => {
  it("a weekday routine set up on a Sunday first runs on Monday", async () => {
    const w = world();
    const v = await w.r.create("u1", { task: "Send me the standup notes", schedule: { every: "weekdays", minute: 9 * 60 + 30 }, tz: IST, bot: "plan" });
    expect(v.next!.words).toBe("Tomorrow at 9:30 am");
    expect(new Date(v.next!.at).toISOString()).toBe("2026-11-02T04:00:00.000Z");
    expect(HOUR).toBe(60 * MIN);
  });
});

describe("the screens", async () => {
  const { buildBotsScreen } = await import("../src/experience/bots/index.js");
  const { fakeDeps, FIXED_NOW } = await import("../src/experience/bots/fixtures.js");
  const { lintTree, walk } = await import("../src/experience/bots/lint.js");
  const { sealDraft } = await import("../src/routines/index.js");
  type N = import("../../shared/types/sdui.js").Node;
  const texts = (n: N): string[] => walk(n).filter((x) => x.type === "Text").map((x) => String(x.props?.content));
  const req = (screenId: string, client: "phone" | "desktop", params: Record<string, string> = {}) => ({
    screenId, client, params, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya Sharma" },
    can: new Set(["BotsKit"]), desk: { pages: client === "desktop", notes: client === "desktop" },
  });
  const token = sealDraft({ task: "Sum up my week", schedule: { every: "week", minute: 17 * 60, days: [5] }, tz: IST, bot: "plan" });
  const view = (o: Partial<import("../src/routines/index.js").RoutineView> = {}) => ({
    id: "11111111-1111-1111-1111-111111111111", bot: { slug: "plan", name: "Plan Ease" }, task: "Sum up my week", when: "Every Friday at 5 pm",
    schedule: { every: "week", minute: 1020, days: [5] }, tz: IST, status: "on", pausedWhy: "", next: { at: FIXED_NOW + 3_600_000, words: "Today at 8:40 pm" },
    last: { at: FIXED_NOW - 86_400_000, words: "Yesterday at 5 pm", status: "done", text: "4 things done, 2 meetings, 1 left for Monday.", paise: 12 }, runs: 3, ...o,
  });
  const LIST = { routines: [view(), view({ id: "22222222-2222-2222-2222-222222222222", task: "Check the news", status: "paused", pausedWhy: "Paused after 3 runs in a row didn't work.", next: null, last: null })], max: 20, choices: [] };

  for (const client of ["phone", "desktop"] as const) {
    it(`Ask shows the routine to save, with its bot chosen (${client})`, async () => {
      const s = await buildBotsScreen(req("bots.ask", client, { message: "Every Friday at 5, sum up my week", answer: "x", bot: "plan", routine: token }), fakeDeps());
      expect(texts(s.root!)).toEqual(expect.arrayContaining(["Every Friday at 5 pm", "Sum up my week", "Who does it", "Plan Ease", "Save routine", "Change"]));
      // Xode takes no routines (the window's sidebar names it anyway).
      if (client === "phone") expect(texts(s.root!)).not.toContain("Xode");
      expect(s.state).toMatchObject({ rbot: "plan" });
      expect(JSON.stringify(s.root)).toContain('"path":"/v1/routines","body":{"token"');
      expect(lintTree(s.root!)).toEqual([]);
      // An ordinary answer is unchanged: no card.
      const plain = await buildBotsScreen(req("bots.ask", client, { message: "hi", answer: "Hello", bot: "plan", routine: "$state.asked.shell.routine.token" }), fakeDeps());
      expect(texts(plain.root!)).not.toContain("Save routine");
    });
    it(`the list and Home's row (${client})`, async () => {
      const deps = fakeDeps({ api: { "GET /v1/routines": LIST } });
      const s = await buildBotsScreen(req("bots.routines", client), deps);
      expect(texts(s.root!)).toEqual(expect.arrayContaining(["Routines", "Sum up my week", "Every Friday at 5 pm · Plan Ease", "Next: Today at 8:40 pm", "Last run Yesterday at 5 pm", "Run now", "Pause", "Turn on", "Paused after 3 runs in a row didn't work."]));
      expect(lintTree(s.root!)).toEqual([]);
      const empty = await buildBotsScreen(req("bots.routines", client), fakeDeps({ api: { "GET /v1/routines": { routines: [], max: 20, choices: [] } } }));
      expect(texts(empty.root!)).toContain("Nothing on a schedule yet");
      const home = await buildBotsScreen(req("bots.home", client), deps);
      expect(texts(home.root!)).toEqual(expect.arrayContaining(["Routines", "1 on · next today at 8:40 pm"]));
      const bare = await buildBotsScreen(req("bots.home", client), fakeDeps());
      expect(texts(bare.root!)).not.toContain("Routines");
    });
  }
});
