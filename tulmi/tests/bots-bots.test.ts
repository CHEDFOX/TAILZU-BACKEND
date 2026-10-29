/**
 * THE BOTS APP'S "BOTS" AREA (experience/bots/screens/bots.ts, routes/botsBots.ts, src/botsBots):
 *
 *   - every screen builds for the phone and the window from the boards' day, lint-clean, with real actions wired to real routes
 *   - a chat with a bot keeps both turns; the Code bot is sent to its own page
 *   - Make a bot: the draft is kept while it is shaped, edited, tried and approved (only then is there a bot)
 *   - Find a bot: a listed bot shows to others, a copy is theirs, unlisting takes it away; ready-made ones are added the same way
 *   - a bot's rules added and removed; what its API keys used this month, counted after the answer went out
 *   - spaces: made, invited to by code, joined, who approves payments (the admin always), bots shared, left
 *   - the Plan bot's suggestion: a clash tomorrow, moved only on a yes, kept as it is when asked; trips and packing
 *   - share-in: the front door's pick, and the message composed
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { Node } from "../../shared/types/sdui.js";

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
      return id && !id.startsWith("tzb_") ? { id, email: `${id === "11111111-1111-4111-8111-111111111111" ? "aanya.sharma" : "rohan"}@example.in` } : null;
    },
  };
});

const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { registerBotRoutes } = await import("../src/routes/bots.js");
const { registerBotsBotsRoutes, AREA, shownName } = await import("../src/routes/botsBots.js");
const { botsAreaParts, resetAreaTablesForTests, suggestionFor, PlanDays, MemoryTable, shareMessage } = await import("../src/botsBots/index.js");
const { ALICE, BOB, rig, def } = await import("./bots-rig.js");
const { sampleApi, fakeReader, WEEK } = await import("./bots-bots-data.js");

type Client = "phone" | "desktop";
const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };

async function build(screenId: string, client: Client, params: Record<string, string> = {}, api?: Record<string, unknown>) {
  const calls: Array<{ method: string; path: string }> = [];
  const s = await buildBotsScreen({ screenId, client, params, tzOffsetMinutes: IST, user: { id: "u" }, can: new Set(["BotsKit"]), desk: { pages: client === "desktop", notes: false } },
    fakeDeps({ jobs: [], tasks: [], api: api ?? await sampleApi(), calls }));
  return { s, calls, nodes: walk(s.root!) };
}
const texts = (nodes: Node[]) => nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? ""));
/** Every action in a tree, flattened (sequences, conditions, onSuccess). */
function actions(nodes: Node[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const visit = (a: unknown) => {
    if (!a || typeof a !== "object") return;
    const o = a as Record<string, unknown>;
    out.push(o);
    for (const k of ["actions", "then", "else", "onSuccess", "onError"]) {
      const v = o[k];
      if (Array.isArray(v)) v.forEach(visit); else visit(v);
    }
  };
  for (const n of nodes) for (const v of Object.values(n.on ?? {})) visit(v);
  return out;
}
const posts = (nodes: Node[]) => actions(nodes).filter((a) => a.kind === "callEndpoint").map((a) => `${a.method} ${a.path}`);

describe("the screens, from the boards' day", () => {
  const CASES: Array<[string, Record<string, string>, string[]]> = [
    ["bots.bot", { slug: "gym-bot" }, ["Gym bot", "Rules · 3", "Remembers · 4 things", "Plan my next week"]],
    ["bots.chat", { slug: "gym-bot" }, ["Gym bot", "Legs done, 40 minutes"]],
    ["bots.make", {}, ["Make a bot", "Make Gym bot", "Plan my next week"]],
    ["bots.edit", { slug: "gym-bot" }, ["Never plan on days I'm travelling", "In Find a bot", "Delete this bot"]],
    ["bots.keys", { slug: "gym-bot" }, ["Use it from your app", "1,284", "What it uses", "Website"]],
    ["bots.store", {}, ["Find a bot", "Study bot", "Shop bot", "In Home", "Yours"]],
    ["bots.plan", {}, ["Plan bot", "Move Dentist to Friday 10 am?", "Keep Thursday"]],
    ["bots.travel", { }, ["Travel bot", "Pune · 14–16 Nov", "5 of 8 packed", "Ready to book · you press pay"]],
    ["bots.spaces", {}, ["Spaces", "Home", "Studio", "Who can approve payments"]],
    ["bots.share-in", { file: "f-9" }, ["Ticket_BLR-GOI_14Nov.pdf", "Travel bot"]],
    ["bots.avatars", {}, ["Blip, as every bot", "Plan bot · Needs you"]],
  ];
  for (const [id, params, want] of CASES) {
    for (const client of ["phone", "desktop"] as const) {
      it(`${id} on the ${client}: lint-clean, the person's data, nothing made up`, async () => {
        const { s, nodes } = await build(id, client, params);
        expect(lintTree(s.root!)).toEqual([]);
        const t = texts(nodes).join("\n");
        for (const w of want) expect(t, w).toContain(w);
      });
    }
  }

  it("draws honest empty states when the reads fail", async () => {
    for (const id of ["bots.bot", "bots.keys", "bots.store", "bots.plan", "bots.travel", "bots.spaces", "bots.make", "bots.share-in"]) {
      for (const client of ["phone", "desktop"] as const) {
        const { s, nodes } = await build(id, client, { slug: "gym-bot" }, {});
        expect(lintTree(s.root!), id).toEqual([]);
        expect(texts(nodes).join(" "), id).not.toMatch(/1,284|Gym bot ·|Pune/);
      }
    }
  });

  it("wires the bot page to the bot's chat, its edit page and its keys", async () => {
    const { nodes } = await build("bots.bot", "phone", { slug: "gym-bot" });
    expect(posts(nodes)).toContain(`POST ${AREA}/chat/gym-bot`);
    const navs = actions(nodes).filter((a) => a.kind === "navigate").map((a) => a.screenId);
    expect(navs).toEqual(expect.arrayContaining(["bots.edit", "bots.keys"]));
  });

  it("wires Make a bot to the draft, its edits, the trial and approve", async () => {
    const { nodes } = await build("bots.make", "desktop");
    const p = posts(nodes);
    for (const want of [`POST ${AREA}/draft`, `PUT ${AREA}/draft`, `POST ${AREA}/draft/try`, `POST ${AREA}/draft/approve`, `DELETE ${AREA}/draft`]) expect(p).toContain(want);
    expect(actions(nodes).some((a) => a.kind === "navigate" && a.screenId === "bots.bot" && (a.params as Record<string, unknown>).slug === "$state.made.bot.slug")).toBe(true);
  });

  it("wires edit, keys, store, plan, travel, spaces and share-in to their routes", async () => {
    const edit = posts((await build("bots.edit", "phone", { slug: "gym-bot" })).nodes);
    expect(edit).toEqual(expect.arrayContaining(["PUT /v1/bots/gym-bot", `POST ${AREA}/rules/gym-bot`, `DELETE ${AREA}/rules/gym-bot/0`, "DELETE /v1/bots/gym-bot/memory/f0", `DELETE ${AREA}/listing/gym-bot`, "DELETE /v1/bots/gym-bot"]));
    const keys = posts((await build("bots.keys", "desktop", { slug: "gym-bot" })).nodes);
    expect(keys).toEqual(expect.arrayContaining(["POST /v1/bots/gym-bot/keys", "DELETE /v1/bots/gym-bot/keys/k1"]));
    expect(posts((await build("bots.store", "phone")).nodes)).toContain(`POST ${AREA}/store/tailzu-study/add`);
    const plan = actions((await build("bots.plan", "phone")).nodes).filter((a) => a.kind === "callEndpoint");
    expect(plan.find((a) => a.path === `${AREA}/plan/move`)?.body).toMatchObject({ eventId: "e11", start: "2026-10-30T10:00:00+05:30" });
    expect(plan.map((a) => a.path)).toContain(`${AREA}/plan/skip`);
    const travel = posts((await build("bots.travel", "phone")).nodes);
    expect(travel).toEqual(expect.arrayContaining([`PUT ${AREA}/trip/7a1b2c3d-0000-4000-8000-0000000000aa/packing/0`, `POST ${AREA}/trip/7a1b2c3d-0000-4000-8000-0000000000aa/packing`]));
    expect(actions((await build("bots.travel", "phone")).nodes).some((a) => a.kind === "openUrl" && String(a.url).includes("irctc"))).toBe(true);
    const spaces = posts((await build("bots.spaces", "desktop")).nodes);
    // The rest of Spaces' wiring: tests/spaces-screens.test.ts.
    expect(spaces).toEqual(expect.arrayContaining([`POST ${AREA}/spaces`, `POST ${AREA}/spaces/join`, `POST ${AREA}/spaces/s1/lists`, `PUT ${AREA}/spaces/s1/payments/p-groceries`, `POST ${AREA}/threads/group`]));
    const share = actions((await build("bots.share-in", "phone", { file: "f-9" })).nodes);
    const ask = share.find((a) => a.kind === "callEndpoint" && a.path === "/v1/ask");
    expect(ask?.body).toMatchObject({ message: "$state.composed.message", bot: "$state.bot", attachments: [{ id: "f-9", sha256: "a".repeat(64) }] });
  });

  it("starts share-in on the front door's pick, with what it would do", async () => {
    const { s } = await build("bots.share-in", "phone", { file: "f-9" });
    expect(s.state).toMatchObject({ bot: "travel", what: "Add this trip to my plan" });
  });
});

// ------------------------------------------------------------------ the routes

async function served(o: { on?: boolean; answer?: Parameters<typeof rig>[0]; connectors?: unknown } = {}) {
  resetAreaTablesForTests();
  const r = await rig(o.answer ?? (() => "Three sessions this week."));
  const app = Fastify();
  const bots = o.on === false ? null : r.bots;
  registerBotRoutes(app, { rateLimit: RL, bots });
  const parts = botsAreaParts({ bots, connectors: null, reader: fakeReader(), now: () => r.now.t });
  if (o.connectors) (parts as { plan: unknown }).plan = new PlanDays(fakeReader(), o.connectors as never, () => r.now.t, new MemoryTable());
  registerBotsBotsRoutes(app, { rateLimit: RL, bots, code: null, jobs: null, connectors: null, media: null, artifacts: null }, { parts });
  await app.ready();
  const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, user: string | null = ALICE, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method, url, headers: { ...(user ? { authorization: `Bearer ${user}` } : {}), ...headers }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { app, r, call };
}

describe("the routes", () => {
  beforeEach(() => resetAreaTablesForTests());

  it("are 404 bots_off while BOTS is off, and need a session", async () => {
    const s = await served({ on: false });
    for (const [m, u] of [["GET", `${AREA}/chat/plan`], ["POST", `${AREA}/draft`], ["GET", `${AREA}/store`], ["GET", `${AREA}/keys/x/usage`], ["POST", `${AREA}/share/suggest`]] as const) {
      expect((await s.call(m, u, ALICE, m === "GET" ? undefined : {})).json().code, u).toBe("bots_off");
    }
    expect((await s.call("GET", `${AREA}/spaces`, null)).statusCode).toBe(401);
  });

  it("keeps a chat with a bot, and sends the Code bot to its own page", async () => {
    const s = await served({ answer: () => "Plan: Mon legs, Wed upper body." });
    const res = await s.call("POST", `${AREA}/chat/plan`, ALICE, { message: "Plan my week" });
    expect(res.statusCode).toBe(200);
    expect(res.json().text).toBe("Plan: Mon legs, Wed upper body.");
    const turns = (await s.call("GET", `${AREA}/chat/plan`)).json().turns;
    expect(turns.map((t: { role: string; text: string }) => [t.role, t.text])).toEqual([["me", "Plan my week"], ["bot", "Plan: Mon legs, Wed upper body."]]);
    expect((await s.call("GET", `${AREA}/chat/plan`, BOB)).json().turns).toEqual([]);
    expect((await s.call("POST", `${AREA}/chat/code`, ALICE, { message: "hi" })).json().code).toBe("code_bot");
    expect((await s.call("POST", `${AREA}/chat/nope-bot`, ALICE, { message: "hi" })).statusCode).toBe(404);
    expect((await s.call("DELETE", `${AREA}/chat/plan`)).json()).toMatchObject({ ok: true, cleared: 2 });
  });

  it("keeps a draft while it is shaped, tries it, and makes the bot only on approve", async () => {
    const s = await served({ answer: () => "Here's your week." });
    vi.spyOn(s.r.bots, "draft").mockResolvedValue({
      definition: { name: "Gym bot", slug: "gym-bot", colour: "pine", purpose: "Plans workouts that fit your week", principles: ["Keep sessions under 45 minutes."], skills: { web: false, files: false, artifacts: false, code: false, research: false, connectors: [] }, knowledge: [], tone: "upbeat", visibility: "private", budgets: { perRequestPaise: 150, dailyPaise: 800 } },
      tests: ["Plan my next week"], connectors: [], warnings: [], paise: 3, tier: "cheap",
    });
    expect((await s.call("GET", `${AREA}/draft`)).json()).toEqual({ draft: null });
    expect((await s.call("POST", `${AREA}/draft`, ALICE, { sentence: "A bot that plans my workouts" })).statusCode).toBe(200);
    await s.call("PUT", `${AREA}/draft`, ALICE, { colour: "plum" });
    await s.call("PUT", `${AREA}/draft`, ALICE, { addRule: "Never plan on days I'm travelling." });
    await s.call("PUT", `${AREA}/draft`, ALICE, { dropRule: 0 });
    expect((await s.call("PUT", `${AREA}/draft`, ALICE, { colour: "red" })).statusCode).toBe(400);
    const tried = (await s.call("POST", `${AREA}/draft/try`, ALICE, { message: "Plan my next week" })).json();
    expect(tried).toMatchObject({ said: "Plan my next week", answered: "Here's your week." });
    const d = (await s.call("GET", `${AREA}/draft`)).json().draft;
    expect(d.draft.definition).toMatchObject({ colour: "plum", principles: ["Never plan on days I'm travelling."] });
    expect(d.trial).toHaveLength(1);
    expect((await s.call("GET", "/v1/bots")).json().bots.some((b: { slug: string }) => b.slug === "gym-bot")).toBe(false);
    const made = await s.call("POST", `${AREA}/draft/approve`);
    expect(made.statusCode).toBe(201);
    expect(made.json().bot.slug).toBe("gym-bot");
    expect((await s.call("GET", "/v1/bots/gym-bot")).json().bot).toMatchObject({ name: "Gym bot", colour: "plum" });
    expect((await s.call("GET", `${AREA}/draft`)).json()).toEqual({ draft: null });
  });

  it("adds and removes a bot's rules, and refuses a built-in", async () => {
    const s = await served();
    await s.call("POST", "/v1/bots", ALICE, def({ slug: "gym-bot" }));
    const added = await s.call("POST", `${AREA}/rules/gym-bot`, ALICE, { rule: "Remind me at 9 pm the night before." });
    expect(added.json().bot.principles).toEqual(["Keep answers short.", "Use metric units.", "Remind me at 9 pm the night before."]);
    expect((await s.call("DELETE", `${AREA}/rules/gym-bot/0`)).json().bot.principles).toEqual(["Use metric units.", "Remind me at 9 pm the night before."]);
    expect((await s.call("DELETE", `${AREA}/rules/gym-bot/9`)).statusCode).toBe(404);
    expect((await s.call("POST", `${AREA}/rules/plan`, ALICE, { rule: "x" })).statusCode).toBe(403);
    expect((await s.call("POST", `${AREA}/rules/gym-bot`, BOB, { rule: "x" })).statusCode).toBe(404);
  });

  it("lists a bot in the store, lets someone else add a copy, and takes it away when unlisted", async () => {
    const s = await served();
    await s.call("POST", "/v1/bots", ALICE, def({ slug: "gym-bot", name: "Gym bot", principles: ["Plan around my calendar.", "Never plan on days I'm travelling."] }));
    expect((await s.call("GET", `${AREA}/listing/gym-bot`)).json()).toEqual({ listed: false });
    expect((await s.call("PUT", `${AREA}/listing/gym-bot`)).json()).toEqual({ listed: true });
    expect((await s.call("GET", "/v1/bots/gym-bot", null)).json().card).toMatchObject({ name: "Gym bot" });
    const seen = (await s.call("GET", `${AREA}/store`, BOB)).json();
    expect(seen.readyMade.map((e: { name: string }) => e.name)).toEqual(["Study bot", "Money bot", "Recipe bot"]);
    const gym = seen.people.find((e: { name: string }) => e.name === "Gym bot");
    expect(gym).toMatchObject({ by: "Aanya S.", adds: 0, status: null, wont: "Never plan on days I'm travelling" });
    expect((await s.call("GET", `${AREA}/store`, ALICE)).json().people[0].status).toBe("yours");
    const copy = await s.call("POST", `${AREA}/store/${gym.id}/add`, BOB);
    expect(copy.statusCode).toBe(201);
    const mine = (await s.call("GET", `/v1/bots/${copy.json().bot.slug}`, BOB)).json().bot;
    expect(mine).toMatchObject({ name: "Gym bot", ownerId: BOB, principles: ["Plan around my calendar.", "Never plan on days I'm travelling."], knowledge: [] });
    const after = (await s.call("GET", `${AREA}/store/${gym.id}`, BOB)).json().entry;
    expect(after).toMatchObject({ adds: 1, status: "added" });
    expect((await s.call("POST", `${AREA}/store/${gym.id}/add`, ALICE)).statusCode).toBe(409);
    expect((await s.call("POST", `${AREA}/store/tailzu-recipe/add`, BOB)).json().bot.name).toBe("Recipe bot");
    expect((await s.call("GET", `${AREA}/store?q=fridge`, BOB)).json().readyMade.map((e: { name: string }) => e.name)).toEqual(["Recipe bot"]);
    expect((await s.call("DELETE", `${AREA}/listing/gym-bot`)).json()).toEqual({ listed: false });
    expect((await s.call("GET", `${AREA}/store`, BOB)).json().people).toEqual([]);
    expect((await s.call("GET", "/v1/bots/gym-bot", null)).statusCode).toBe(404);
    expect((await s.call("PUT", `${AREA}/listing/plan`)).statusCode).toBe(403);
  });

  it("counts what a bot's API keys used this month, after each answer", async () => {
    const s = await served({ answer: () => "Mon, Wed, Fri." });
    await s.call("POST", "/v1/bots", ALICE, def({ slug: "gym-bot" }));
    const key = (await s.call("POST", "/v1/bots/gym-bot/keys", ALICE, { label: "Website" })).json();
    for (let i = 0; i < 2; i += 1) {
      const res = await s.call("POST", "/v1/bots/gym-bot/ask", null, { message: "Plan my week" }, { authorization: `Bearer ${key.key}` });
      expect(res.statusCode).toBe(200);
    }
    await new Promise((r) => setTimeout(r, 20));
    const u = (await s.call("GET", `${AREA}/keys/gym-bot/usage`)).json();
    expect(u.usage).toMatchObject({ month: "October", requests: 2 });
    expect(u.usage.byKey[key.masked]).toMatchObject({ requests: 2 });
    expect(u.usage.days.at(-1)).toMatchObject({ day: "2026-10-27", requests: 2 });
    expect(u).toMatchObject({ ratePerMin: 30, dayCapPaise: 500 });
    expect(u.endpoint).toMatch(/\/v1\/bots\/gym-bot\/ask$/);
    expect((await s.call("GET", `${AREA}/keys/gym-bot/usage`, BOB)).statusCode).toBe(404);
  });

  it("makes a space, invites by code, sets who approves payments, shares bots, and leaves", async () => {
    const s = await served();
    const id = (await s.call("POST", `${AREA}/spaces`, ALICE, { name: "Home" })).json().id;
    const inv = (await s.call("POST", `${AREA}/spaces/${id}/invite`)).json();
    expect(inv.code).toMatch(/^[A-Z0-9]{8}$/);
    expect(inv.link).toBe(`https://app.x0bot.com/s/bots.spaces?join=${inv.code}`);
    const page = await s.call("GET", `${AREA}/invite/${inv.code}`, null);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toContain("Home");
    expect((await s.call("POST", `${AREA}/spaces/join`, BOB, { code: "NOPE1234" })).statusCode).toBe(404);
    expect((await s.call("POST", `${AREA}/spaces/join`, BOB, { code: inv.code.toLowerCase() })).json()).toEqual({ id, name: "Home" });
    let home = (await s.call("GET", `${AREA}/spaces`)).json().spaces[0];
    expect(home.members.map((m: { name: string; canApprove: boolean }) => [m.name, m.canApprove])).toEqual([["Aanya S.", true], ["Rohan", false]]);
    expect((await s.call("PUT", `${AREA}/spaces/${id}/members/${BOB}`, BOB, { canApprove: true })).statusCode).toBe(403);
    expect((await s.call("PUT", `${AREA}/spaces/${id}/members/${ALICE}`, ALICE, { canApprove: false })).json().code).toBe("is_admin");
    await s.call("PUT", `${AREA}/spaces/${id}/members/${BOB}`, ALICE, { canApprove: true });
    await s.call("POST", `${AREA}/spaces/${id}/bots`, BOB, { slug: "plan" });
    home = (await s.call("GET", `${AREA}/spaces`, BOB)).json().spaces[0];
    expect(home.bots).toEqual([{ slug: "plan", name: "Plan bot", colour: "sea", addedBy: "Rohan", byYou: true }]);
    expect(home.members.find((m: { you: boolean }) => m.you).canApprove).toBe(true);
    expect((await s.call("GET", `${AREA}/spaces`, "33333333-3333-4333-8333-333333333333")).json().spaces).toEqual([]);
    expect((await s.call("DELETE", `${AREA}/spaces/${id}`, BOB)).json()).toEqual({ deleted: false });
    expect((await s.call("DELETE", `${AREA}/spaces/${id}`, ALICE)).json()).toEqual({ deleted: true });
    expect((await s.call("GET", `${AREA}/spaces`)).json().spaces).toEqual([]);
  });

  it("reads tomorrow and the week, suggests one move, makes it only on a yes, and keeps it as it is when asked", async () => {
    // The move is on the person's own calendar (src/calendar): no connected app, no card; "Move it" is the yes.
    const used: unknown[] = [];
    const connectors = async (_u: string, eventId: string, startMs: number) => { used.push({ eventId, start: startMs }); };
    const s = await served({ connectors });
    s.r.now.t = Date.UTC(2026, 9, 28, 14, 10);
    const read = (await s.call("GET", `${AREA}/plan?tz=330&week=0`)).json();
    expect(read.tomorrow).toBe("2026-10-29");
    expect(read.week).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(read.days.find((d: { key: string }) => d.key === "2026-10-29").events.map((e: { title: string }) => e.title)).toEqual(["Studio standup", "Dentist · Dr. Mehta", "Dinner with Mom"]);
    expect(read.suggestion).toMatchObject({ eventId: "e11", question: "Move Dentist to Friday 10 am?", fromDay: "Thursday" });
    const moved = await s.call("POST", `${AREA}/plan/move`, ALICE, { eventId: "e11", start: read.suggestion.startIso, said: read.suggestion.question });
    expect(moved.json()).toEqual({ done: true, message: "Moved." });
    expect(used).toEqual([{ eventId: "e11", start: Date.parse("2026-10-30T10:00:00+05:30") }]);
    await s.call("POST", `${AREA}/plan/skip`, ALICE, { key: read.suggestion.key });
    expect((await s.call("GET", `${AREA}/plan?tz=330`)).json().suggestion).toBeNull();
  });

  it("finds no suggestion on a day with room, and moves the one with fewer people", () => {
    const tomorrow = "2026-10-29";
    expect(suggestionFor(WEEK.filter((e) => e.id !== "e12"), tomorrow, 330, new Set())).toBeNull();
    const busy = WEEK.map((e) => (e.id === "e11" ? { ...e, people: 2 } : e.id === "e12" ? { ...e, people: 0 } : e));
    expect(suggestionFor(busy, tomorrow, 330, new Set())?.eventId).toBe("e12");
  });

  it("reads nothing it can't, instead of guessing", async () => {
    const plan = new PlanDays(fakeReader({ calendar: false, tasks: false }), null, () => Date.UTC(2026, 9, 28, 14, 10), new MemoryTable());
    const r = await plan.read(ALICE, { tz: 330 });
    expect(r.connected).toEqual({ calendar: false, tasks: false });
    expect(r.days.every((d) => !d.events.length)).toBe(true);
    expect(r.suggestion).toBeNull();
  });

  it("keeps a trip and its packing list, with what the Travel bot opened to book", async () => {
    const s = await served({ answer: () => "Deccan Queen at 5:10 pm." });
    expect((await s.call("GET", `${AREA}/trip`)).json()).toMatchObject({ trip: null, bookings: [] });
    expect((await s.call("POST", `${AREA}/trip`, ALICE, { place: "" })).statusCode).toBe(400);
    const trip = (await s.call("POST", `${AREA}/trip`, ALICE, { place: "Pune", when: "14–16 Nov", who: "You + Rohan" })).json().trip;
    await s.call("POST", `${AREA}/trip/${trip.id}/packing`, ALICE, { text: "Light jacket" });
    await s.call("POST", `${AREA}/trip/${trip.id}/packing/starter`);
    const toggled = (await s.call("PUT", `${AREA}/trip/${trip.id}/packing/0`)).json().trip;
    expect(toggled.packing[0]).toEqual({ text: "Light jacket", done: true });
    expect(toggled.packing.length).toBeGreaterThan(5);
    expect((await s.call("PUT", `${AREA}/trip/${trip.id}/packing/0`, BOB)).statusCode).toBe(404);
    expect((await s.call("GET", `${AREA}/trip`, BOB)).json().trip).toBeNull();
    await s.call("DELETE", `${AREA}/trip/${trip.id}`);
    expect((await s.call("GET", `${AREA}/trip`)).json().trip).toBeNull();
  });

  it("asks the front door which bot a shared thing is for, and composes the message", async () => {
    const s = await served();
    const sug = await s.call("POST", `${AREA}/share/suggest`, ALICE, { name: "Ticket_BLR-GOI_14Nov.pdf", text: "Plan a trip to Goa: flights and hotels for 14 Nov" });
    expect(sug.statusCode).toBe(200);
    expect(typeof sug.json().ask).toBe("string");
    expect(typeof sug.json().line).toBe("string");
    const msg = (await s.call("POST", `${AREA}/share/compose`, ALICE, { what: "Add this trip to my plan", url: "https://example.in/t/1" })).json().message;
    expect(msg).toBe(shareMessage("Add this trip to my plan", { url: "https://example.in/t/1" }));
    expect(msg).toContain("The link: https://example.in/t/1");
  });

  it("shows a person by their first name and an initial", () => {
    expect(shownName({ email: "aanya.sharma@example.in" })).toBe("Aanya S.");
    expect(shownName({ email: "meera@example.in" })).toBe("Meera");
    expect(shownName({ phone: "+919876543210" })).toBe("…3210");
  });
});
