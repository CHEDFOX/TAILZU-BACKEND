/**
 * The rest of the Google family: Tasks, Sheets, Forms, Classroom and YouTube,
 * with no network: Google is a scripted fake `fetch`, as in
 * connectors-google.test.ts.
 *
 * Covers each entry in the catalog (scopes, aliases, off until named), the
 * scopes each sign-in asks, the revoke-when-last rule across every Google
 * app, each tool's request and its plain-words result in the person's zone,
 * the risk tiers and the confirm card's words, and the Hinglish one-liners.
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

vi.mock("../src/auth/supabase.js", async (orig) => ({
  ...(await orig<typeof import("../src/auth/supabase.js")>()),
  resolveUser: async (h: string | undefined) => {
    const id = h?.replace(/^Bearer\s+/i, "").trim();
    return id ? { id } : null;
  },
}));

const { ALWAYS_ON, CATALOG, enabledCatalog, enabledIds } = await import("../src/connectors/catalog.js");
const { encrypt } = await import("../src/connectors/crypto.js");
const { createConnectors } = await import("../src/connectors/index.js");
const { beginGoogleOAuth, buildNatives, otherGoogleApps } = await import("../src/connectors/google/index.js");
const { videoIdOf } = await import("../src/connectors/google/youtube.js");
const { pickConnectors } = await import("../src/connectors/router.js");
const { MemoryConnectorStore } = await import("../src/connectors/store.js");
const { registerConnectorRoutes } = await import("../src/routes/connectors.js");
const { HG_APP_LINES, hinglishSeeds } = await import("../src/connectors/words.js");

// Thursday 22 Oct 2026, 13:30 in India (UTC+5:30), 04:00 in New York (UTC-4).
const NOW = Date.parse("2026-10-22T08:00:00Z");
const REDIRECT = "https://api.example.com/v1/connectors/callback";
const GOOGLE = { clientId: "cid.apps.googleusercontent.com", clientSecret: "csecret" };
const S = (s: string) => `https://www.googleapis.com/auth/${s}`;
const NEW_APPS = ["google-tasks", "google-sheets", "google-forms", "google-classroom", "google-youtube"] as const;
type AppId = (typeof NEW_APPS)[number] | "google-calendar" | "google-docs";
const SHEET_ID = "1SheetIdBBBBBBBBBBBBBBBBBBBBBBBB";
const FORM_ID = "1FormIdAAAAAAAAAAAAAAAAAAAAAAAAAA";

// ------------------------------------------------------------- a scripted Google

interface Call { url: URL; method: string; auth: string | null; body: any; form: Record<string, string> | null }
type Reply = { status?: number; json?: unknown; empty?: boolean };

function fakeGoogle() {
  const calls: Call[] = [];
  const routes: Array<{ match: (c: Call) => boolean; reply: Reply | ((c: Call) => Reply) }> = [];
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const raw = typeof init?.body === "string" ? init.body : null;
    const isForm = (init?.headers as Record<string, string> | undefined)?.["content-type"]?.includes("x-www-form-urlencoded");
    const c: Call = {
      url: new URL(String(input)), method: init?.method ?? "GET",
      auth: (init?.headers as Record<string, string> | undefined)?.authorization ?? null,
      body: raw && !isForm ? JSON.parse(raw) : null,
      form: raw && isForm ? Object.fromEntries(new URLSearchParams(raw)) : null,
    };
    calls.push(c);
    const hit = routes.find((r) => r.match(c));
    if (!hit) return new Response(JSON.stringify({ error: { message: "no route", status: "NOT_FOUND" } }), { status: 404 });
    const r = typeof hit.reply === "function" ? hit.reply(c) : hit.reply;
    return r.empty ? new Response(null, { status: r.status ?? 204 }) : new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  }) as typeof fetch;
  return {
    calls, fetchFn,
    on(match: (c: Call) => boolean, reply: Reply | ((c: Call) => Reply)) { routes.unshift({ match, reply }); },
    to(method: string, path: RegExp | string, reply: Reply | ((c: Call) => Reply)) {
      this.on((c) => c.method === method && (typeof path === "string" ? c.url.pathname === path : path.test(c.url.pathname)), reply);
    },
    only(pred: (c: Call) => boolean) { return calls.filter(pred); },
    last(pred: (c: Call) => boolean) { return calls.filter(pred).at(-1)!; },
  };
}

const ZONE_PATH = "/calendar/v3/users/me/settings/timezone";

async function setup(o: { connect?: AppId[]; level?: "look" | "draft" | "send"; calendarZone?: string; now?: number } = {}) {
  const g = fakeGoogle();
  g.to("GET", ZONE_PATH, { json: { value: o.calendarZone ?? "America/New_York" } });
  const store = new MemoryConnectorStore();
  const connectors = createConnectors({
    store, redirectUrl: REDIRECT, now: () => o.now ?? NOW, fetchFn: g.fetchFn, google: GOOGLE,
    catalog: [...CATALOG.filter((c) => c.provider === "google"), ...ALWAYS_ON],
    notes: { find: async () => null },
  });
  const user = "u1";
  for (const id of o.connect ?? [...NEW_APPS]) {
    const def = CATALOG.find((c) => c.id === id)!;
    await store.upsertConnection(user, id, {
      level: o.level ?? "send",
      tokensEnc: encrypt(JSON.stringify({ access_token: `at-${id}`, refresh_token: `rt-${id}`, expires_at: (o.now ?? NOW) + 3_600_000, scope: def.scopes!.join(" ") })),
    });
  }
  const call = (connector: string, tool: string, args: Record<string, unknown> = {}) => connectors.hub.call(user, connector, tool, args);
  const use = (connector: string, tool: string, args: Record<string, unknown>, allowWrite = true) =>
    connectors.tasks.use(user, "run_1", "said", { connector, tool, args }, { allowWrite });
  const risk = async (connector: string, tool: string, args: Record<string, unknown> = {}) =>
    connectors.hub.riskFor(user, connectors.hub.def(connector)!, { name: tool, inputSchema: {} }, args);
  return { g, store, connectors, user, call, use, risk };
}

// ------------------------------------------------------------------- the catalog

describe("the Google family in the catalog", () => {
  const def = (id: string) => CATALOG.find((c) => c.id === id)!;

  it("has each app native, Google's, verified, signed in with OAuth, with its own scopes", () => {
    expect(def("google-tasks")).toMatchObject({ name: "Google Tasks", scopes: [S("tasks")] });
    expect(def("google-sheets")).toMatchObject({ name: "Google Sheets", scopes: [S("drive.file")] });
    expect(def("google-forms")).toMatchObject({ name: "Google Forms", scopes: [S("drive.file")] });
    expect(def("google-classroom")).toMatchObject({
      name: "Google Classroom",
      scopes: [S("classroom.courses.readonly"), S("classroom.coursework.me.readonly"), S("classroom.announcements.readonly")],
    });
    expect(def("google-youtube")).toMatchObject({ name: "YouTube", scopes: [S("youtube")] });
    for (const id of NEW_APPS) {
      expect(def(id), id).toMatchObject({ kind: "native", provider: "google", auth: "oauth", verified: true });
      expect(def(id).docs).toMatch(/^https:\/\/developers\.google\.com\//);
      expect(def(id).notes).toBeTruthy();
      expect(def(id).hidden).toBeUndefined();
    }
  });

  it("is off until named in CONNECTORS_ENABLED_IDS", () => {
    expect(enabledCatalog(enabledIds("notion")).some((c) => c.provider === "google")).toBe(false);
    expect(enabledCatalog(enabledIds("google-tasks, google-youtube")).map((c) => c.id)).toEqual(["google-tasks", "google-youtube"]);
    const c = createConnectors({ store: new MemoryConnectorStore(), redirectUrl: REDIRECT });
    expect(c.hub.catalog.some((d) => d.provider === "google")).toBe(false);
  });

  it("answers to the words people say, in English and Hinglish", () => {
    const want: Record<string, string[]> = {
      "google-tasks": ["remind me", "to-do", "kaam", "list"],
      "google-sheets": ["spreadsheet", "expenses", "hisaab"],
      "google-forms": ["form", "quiz", "survey"],
      "google-classroom": ["class", "assignment", "homework", "due"],
      "google-youtube": ["video", "playlist"],
    };
    for (const [id, words] of Object.entries(want)) for (const w of words) expect(def(id).aliases, `${id}: ${w}`).toContain(w);
    const have = NEW_APPS.map((id) => ({ def: def(id), lastUsedAt: null }));
    const top = (said: string) => pickConnectors(said, "Safari", have, NOW)[0]?.id;
    expect(top("remind me to call mom tomorrow")).toBe("google-tasks");
    expect(top("kal ka kaam add karo")).toBe("google-tasks");
    expect(top("add 500 for chai to my expenses")).toBe("google-sheets");
    expect(top("hisaab mein 200 likho")).toBe("google-sheets");
    expect(top("make a quiz on fractions")).toBe("google-forms");
    expect(top("what homework is due this week")).toBe("google-classroom");
    expect(top("add this video to my workout playlist")).toBe("google-youtube");
  });

  it("has a Hinglish one-liner for every Google app, seeded for the translator", () => {
    const google = CATALOG.filter((c) => c.provider === "google");
    const seeds = hinglishSeeds(google.map((c) => c.name), google);
    for (const c of google) {
      expect(HG_APP_LINES[c.id], c.id).toBeTruthy();
      expect(seeds.get(c.oneLine)).toBe(HG_APP_LINES[c.id]);
    }
    // Calling it as before seeds no app lines.
    expect(hinglishSeeds(["Notion"]).has(google[0]!.oneLine)).toBe(false);
  });
});

// -------------------------------------------------------------------- the sign-in

describe("signing in to each Google app", () => {
  it("asks for that app's scopes and nothing else, offline, with PKCE", async () => {
    for (const id of NEW_APPS) {
      const def = CATALOG.find((c) => c.id === id)!;
      const url = new URL(await beginGoogleOAuth({ store: new MemoryConnectorStore(), redirectUrl: REDIRECT, google: GOOGLE }, "u1", def, NOW));
      expect(url.searchParams.get("scope")!.split(" "), id).toEqual(def.scopes);
      expect(url.searchParams.get("access_type")).toBe("offline");
      expect(url.searchParams.get("include_granted_scopes")).toBe("true");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    }
  });

  it("revokes the one Google grant only with the last Google app, counting apps switched off since", async () => {
    const cal = CATALOG.find((c) => c.id === "google-calendar")!;
    expect(otherGoogleApps(cal, [cal])).toEqual(["google-docs", ...NEW_APPS]);

    const g = fakeGoogle();
    g.to("POST", "/revoke", { json: {} });
    const store = new MemoryConnectorStore();
    // Only Calendar is switched on now; Tasks was connected while it still was.
    const connectors = createConnectors({ store, redirectUrl: REDIRECT, google: GOOGLE, fetchFn: g.fetchFn, catalog: [cal, ...ALWAYS_ON] });
    const app = Fastify();
    registerConnectorRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, connectors });
    await app.ready();
    const as = { authorization: "Bearer ann" };
    const token = (rt: string) => encrypt(JSON.stringify({ access_token: "a", refresh_token: rt, expires_at: NOW, scope: "" }));
    await store.upsertConnection("ann", "google-calendar", { tokensEnc: token("rt-cal") });
    await store.upsertConnection("ann", "google-tasks", { tokensEnc: token("rt-tasks") });
    expect((await app.inject({ method: "DELETE", url: "/v1/connectors/google-calendar", headers: as })).statusCode).toBe(200);
    expect(g.only((c) => c.url.pathname === "/revoke")).toHaveLength(0);
    expect(await store.getConnection("ann", "google-calendar")).toBeNull();

    await store.deleteConnection("ann", "google-tasks");
    await store.upsertConnection("ann", "google-calendar", { tokensEnc: token("rt-cal-2") });
    expect((await app.inject({ method: "DELETE", url: "/v1/connectors/google-calendar", headers: as })).statusCode).toBe(200);
    expect(g.only((c) => c.url.pathname === "/revoke").map((c) => c.form)).toEqual([{ token: "rt-cal-2" }]);
  });
});

// ------------------------------------------------------------------ the tiers

describe("the risk of each tool", () => {
  it("reads run, writes ask, a delete always asks, and a lower level blocks", async () => {
    const { g, risk, use, store, user } = await setup({ connect: ["google-tasks", "google-youtube", "google-classroom"] });
    const tiers: Record<string, Record<string, string>> = {
      "google-tasks": { list_tasks: "read", add_task: "write", complete_task: "write", delete_task: "destructive" },
      "google-sheets": { create_sheet: "write", append_rows: "write", read_sheet: "read" },
      "google-forms": { create_form: "write", list_responses: "read" },
      "google-classroom": { my_classes: "read", whats_due: "read", announcements: "read" },
      "google-youtube": { search_videos: "read", my_playlists: "read", add_to_playlist: "write" },
    };
    const natives = buildNatives(CATALOG, { store, google: null, notes: { find: async () => null } });
    for (const [app, tools] of Object.entries(tiers)) {
      expect(Object.fromEntries(natives[app]!.tools().map((t) => [t.name, t.risk])), app).toEqual(tools);
    }
    expect(await risk("google-classroom", "whats_due")).toBe("read");

    g.to("GET", "/v1/courses", { json: { courses: [] } });
    expect(await use("google-classroom", "my_classes", {})).toMatchObject({ kind: "result" });
    g.to("GET", "/tasks/v1/lists/@default/tasks", { json: { items: [{ id: "t1", title: "Gym", status: "needsAction" }] } });
    const add = await use("google-tasks", "add_task", { title: "Gym", due: "tomorrow" });
    expect(add).toMatchObject({ kind: "approval", approval: { risk: "write", preview: 'Add the task "Gym" to Google Tasks, for Tomorrow' } });
    g.to("POST", "/tasks/v1/lists/@default/tasks", { json: { id: "t9" } });
    await store.upsertConnection(user, "google-tasks", { autoOk: ["delete_task", "add_task"] });
    expect(await use("google-tasks", "add_task", { title: "Gym" })).toMatchObject({ kind: "result" });
    expect(await use("google-tasks", "delete_task", { task: "gym" })).toMatchObject({ kind: "approval", approval: { risk: "destructive", preview: 'Delete the task "Gym" from Google Tasks' } });
    await store.upsertConnection(user, "google-tasks", { level: "draft", autoOk: [] });
    expect(await use("google-tasks", "delete_task", { task: "gym" })).toMatchObject({ kind: "stopped", message: expect.stringContaining("drafts only") });
    await store.upsertConnection(user, "google-youtube", { level: "look" });
    expect(await use("google-youtube", "add_to_playlist", { video: "dQw4w9WgXcQ", playlist: "x" })).toMatchObject({ kind: "stopped", message: expect.stringContaining("look only") });
    // A write that can't be done is said at once, with no card to approve.
    await store.upsertConnection(user, "google-tasks", { level: "send" });
    expect(await use("google-tasks", "complete_task", { task: "laundry" })).toEqual({ kind: "stopped", message: 'I couldn\'t find a task called "laundry" on your list.' });
    expect(await use("google-tasks", "add_task", { title: " " })).toEqual({ kind: "stopped", message: "What's the task?" });
    // Nothing was written while asking.
    expect(g.only((c) => c.method !== "GET" && c.url.pathname !== "/tasks/v1/lists/@default/tasks")).toHaveLength(0);
  });

  it("are shown to the planner when the person names what they want", async () => {
    const { connectors, user } = await setup();
    const runtime = connectors.runtimeFor(user);
    const plan = await runtime.cards({ app: "Safari" } as any, "remind me to call mom tomorrow");
    expect(plan!.message("<said>x</said>", [])).toContain("google-tasks.add_task");
  });
});

// ------------------------------------------------------------------ the zone

describe("the person's time zone", () => {
  // 20:00 UTC: already Friday in India, still Thursday in New York.
  const LATE = Date.parse("2026-10-22T20:00:00Z");
  const due = (g: ReturnType<typeof fakeGoogle>) =>
    g.to("GET", "/tasks/v1/lists/@default/tasks", { json: { items: [{ id: "t1", title: "Gym", due: "2026-10-23T00:00:00.000Z", status: "needsAction" }] } });

  it("is the zone on their Google calendar when Calendar is connected, read with Calendar's token, once", async () => {
    const { g, call } = await setup({ connect: ["google-tasks", "google-calendar"], now: LATE });
    due(g);
    expect((await call("google-tasks", "list_tasks")).text).toBe("1 task on your list:\n- Gym, due Tomorrow (id: t1)");
    await call("google-tasks", "list_tasks");
    const zone = g.only((c) => c.url.pathname === ZONE_PATH);
    expect(zone).toHaveLength(1);
    expect(zone[0]!.auth).toBe("Bearer at-google-calendar");
    expect(g.last((c) => c.url.pathname.startsWith("/tasks/")).auth).toBe("Bearer at-google-tasks");
  });

  it("is India's without Calendar, and the zone the person named over both", async () => {
    const { g, call } = await setup({ connect: ["google-tasks"], now: LATE });
    due(g);
    expect((await call("google-tasks", "list_tasks")).text).toBe("1 task on your list:\n- Gym, due Today (id: t1)");
    expect((await call("google-tasks", "list_tasks", { timezone: "America/New_York" })).text).toBe("1 task on your list:\n- Gym, due Tomorrow (id: t1)");
  });
});

// ------------------------------------------------------------------ Google Tasks

describe("Google Tasks", () => {
  const ITEMS = [
    { id: "t1", title: "Gym", due: "2026-10-23T00:00:00.000Z", status: "needsAction" },
    { id: "t2", title: "Pay rent", due: "2026-10-19T00:00:00.000Z", status: "needsAction" },
    { id: "t3", title: "Call plumber", notes: "Leak under the sink", status: "needsAction" },
    { id: "t4", title: "Old", status: "completed", due: "2026-10-22T00:00:00.000Z" },
    { id: "t5", title: "Buy milk", due: "2026-10-22T00:00:00.000Z", status: "needsAction" },
  ];

  it("lists the open tasks, soonest first, in plain words", async () => {
    const { g, call } = await setup({ connect: ["google-tasks"] });
    g.to("GET", "/tasks/v1/lists/@default/tasks", { json: { items: ITEMS } });
    const out = await call("google-tasks", "list_tasks");
    const req = g.last((c) => c.url.pathname === "/tasks/v1/lists/@default/tasks");
    expect(Object.fromEntries(req.url.searchParams)).toEqual({ maxResults: "100", showCompleted: "false", showHidden: "false" });
    expect(req.auth).toBe("Bearer at-google-tasks");
    expect(out.text).toBe([
      "4 tasks on your list:",
      "- Pay rent, overdue since Mon 19 Oct (id: t2)",
      "- Buy milk, due Today (id: t5)",
      "- Gym, due Tomorrow (id: t1)",
      "- Call plumber — Leak under the sink (id: t3)",
    ].join("\n"));
    expect((await call("google-tasks", "list_tasks", { due: "tomorrow" })).text).toBe("1 task due tomorrow on your list:\n- Gym, due Tomorrow (id: t1)");
    expect((await call("google-tasks", "list_tasks", { due: "overdue" })).text).toBe("1 task overdue on your list:\n- Pay rent, overdue since Mon 19 Oct (id: t2)");
    expect((await call("google-tasks", "list_tasks", { due: "week" })).text).toContain("2 tasks due this week");
    expect((await call("google-tasks", "list_tasks", { due: "30 oct" })).text).toBe("Nothing due on Fri 30 Oct on your list.");
    expect((await call("google-tasks", "list_tasks", { due: "someday" })).error?.code).toBe("rejected");
  });

  it("finds a list by its name, and says which lists there are when it can't", async () => {
    const { g, call } = await setup({ connect: ["google-tasks"] });
    g.to("GET", "/tasks/v1/users/@me/lists", { json: { items: [{ id: "L1", title: "My Tasks" }, { id: "L2", title: "Work" }] } });
    g.to("GET", "/tasks/v1/lists/L2/tasks", { json: { items: [] } });
    expect((await call("google-tasks", "list_tasks", { list: "work" })).text).toBe('Nothing to do in "Work".');
    expect((await call("google-tasks", "list_tasks", { list: "shopping" })).error?.message)
      .toBe('I couldn\'t find a task list called "shopping". Your lists: "My Tasks", "Work".');
  });

  it("adds a task for the day they said, and keeps a time in its notes since Tasks keeps none", async () => {
    const { g, call, use } = await setup({ connect: ["google-tasks"] });
    g.to("POST", "/tasks/v1/lists/@default/tasks", { json: { id: "new1" } });
    const out = await call("google-tasks", "add_task", { title: "Gym", due: "tomorrow 9am", notes: "Leg day" });
    const req = g.last((c) => c.method === "POST");
    expect(req.body).toEqual({ title: "Gym", notes: "At 09:00\nLeg day", due: "2026-10-23T00:00:00.000Z" });
    expect(out.text).toBe('Added "Gym" to your list, for Tomorrow. Google Tasks keeps only the day, so 09:00 is in its notes. (id: new1)');
    expect((await call("google-tasks", "add_task", { title: "Call bank" })).text).toBe('Added "Call bank" to your list. (id: new1)');
    expect(g.last((c) => c.method === "POST").body).toEqual({ title: "Call bank" });
    expect((await call("google-tasks", "add_task", { due: "tomorrow" })).error?.message).toBe("What's the task?");
    const asked = await use("google-tasks", "add_task", { title: "Gym", due: "friday 7am" });
    expect(asked).toMatchObject({ kind: "approval", approval: { preview: 'Add the task "Gym" to Google Tasks, for Tomorrow (07:00 in its notes)' } });
  });

  it("ticks a task off by its title or id, and deletes one", async () => {
    const { g, call } = await setup({ connect: ["google-tasks"] });
    g.to("GET", "/tasks/v1/lists/@default/tasks", { json: { items: [...ITEMS, { id: "t6", title: "Gym bag", status: "needsAction" }] } });
    g.to("PATCH", /^\/tasks\/v1\/lists\/@default\/tasks\/t\d$/, { json: {} });
    g.to("DELETE", /^\/tasks\/v1\/lists\/@default\/tasks\/t\d$/, { empty: true });
    expect((await call("google-tasks", "complete_task", { task: "pay rent" })).text).toBe('Marked "Pay rent" done.');
    const patch = g.last((c) => c.method === "PATCH");
    expect(patch.url.pathname).toBe("/tasks/v1/lists/@default/tasks/t2");
    expect(patch.body).toEqual({ status: "completed" });
    // Looking a task up includes the done ones, so one can be deleted.
    expect(Object.fromEntries(g.last((c) => c.method === "GET").url.searchParams)).toMatchObject({ showCompleted: "true", showHidden: "true" });
    expect((await call("google-tasks", "complete_task", { task: "t4" })).text).toBe('"Old" was already done.');
    // "gym" is exactly one title; "gy" could be two.
    expect((await call("google-tasks", "complete_task", { task: "gym" })).text).toBe('Marked "Gym" done.');
    expect((await call("google-tasks", "complete_task", { task: "gy" })).error?.message).toBe('I found more than one task like that: "Gym" and "Gym bag". Which one?');
    expect((await call("google-tasks", "delete_task", { task: "t3" })).text).toBe('Deleted the task "Call plumber" from your list.');
    expect(g.last((c) => c.method === "DELETE").url.pathname).toBe("/tasks/v1/lists/@default/tasks/t3");
    expect((await call("google-tasks", "delete_task", { task: "laundry" })).error?.message).toBe('I couldn\'t find a task called "laundry" on your list.');
  });
});

// ------------------------------------------------------------------ Google Sheets

describe("Google Sheets", () => {
  const files = (list: Array<{ id: string; name: string }>) => ({ json: { files: list } });

  it("makes a sheet and puts the rows in RAW: numbers as numbers, never a formula", async () => {
    const { g, call } = await setup({ connect: ["google-sheets"] });
    g.to("POST", "/v4/spreadsheets", { json: { spreadsheetId: SHEET_ID } });
    g.to("POST", `/v4/spreadsheets/${SHEET_ID}/values/A1:append`, { json: { updates: { updatedRows: 3 } } });
    const rows = [["Date", "Item", "Amount"], ["22 Oct", "Chai", 20], ["23 Oct", "=IMPORTXML(\"https://evil\")", "1,00,000"], ["PIN", "0123", " 45.5 "]];
    const out = await call("google-sheets", "create_sheet", { title: "Expenses Oct", rows });
    const [create, append] = g.only((c) => c.url.hostname === "sheets.googleapis.com");
    expect(create!.body).toEqual({ properties: { title: "Expenses Oct" } });
    expect(create!.auth).toBe("Bearer at-google-sheets");
    expect(Object.fromEntries(append!.url.searchParams)).toEqual({ valueInputOption: "RAW", insertDataOption: "INSERT_ROWS" });
    expect(append!.body).toEqual({
      majorDimension: "ROWS",
      values: [["Date", "Item", "Amount"], ["22 Oct", "Chai", 20], ["23 Oct", "=IMPORTXML(\"https://evil\")", 100000], ["PIN", "0123", 45.5]],
    });
    expect(out.text).toBe(`Made the Google Sheet "Expenses Oct" with 4 rows. https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
    expect((await call("google-sheets", "create_sheet", { title: "" })).error?.message).toBe("What should I call the sheet?");
  });

  it("says so when the sheet exists but the rows did not go in", async () => {
    const { g, call } = await setup({ connect: ["google-sheets"] });
    g.to("POST", "/v4/spreadsheets", { json: { spreadsheetId: SHEET_ID } });
    g.to("POST", `/v4/spreadsheets/${SHEET_ID}/values/A1:append`, { status: 500, json: {} });
    const out = await call("google-sheets", "create_sheet", { title: "T", rows: [["a"]] });
    expect(out).toMatchObject({ ok: true });
    expect(out.text).toBe(`Made the Google Sheet "T" but couldn't put the rows in. https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
  });

  it("finds a sheet by name among the ones Tailzu made, and adds rows under the last", async () => {
    const { g, call, use } = await setup({ connect: ["google-sheets"] });
    g.to("GET", "/drive/v3/files", files([{ id: SHEET_ID, name: "Expenses Oct" }, { id: "1OtherSheetCCCCCCCCCCCCCCCCCCC", name: "Trip plan" }]));
    g.to("POST", `/v4/spreadsheets/${SHEET_ID}/values/A1:append`, { json: { updates: { updatedRows: 1 } } });
    const out = await call("google-sheets", "append_rows", { sheet: "expenses", rows: [["24 Oct", "Auto", "80"]] });
    const drive = g.last((c) => c.url.pathname === "/drive/v3/files");
    expect(Object.fromEntries(drive.url.searchParams)).toEqual({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false", orderBy: "modifiedTime desc", pageSize: "50", fields: "files(id,name)",
    });
    expect(drive.auth).toBe("Bearer at-google-sheets");
    expect(g.last((c) => c.method === "POST").body.values).toEqual([["24 Oct", "Auto", 80]]);
    expect(out.text).toBe(`Added 1 row to "Expenses Oct". https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
    expect((await call("google-sheets", "append_rows", { sheet: "groceries", rows: [["x"]] })).error?.message)
      .toBe('I couldn\'t find a sheet called "groceries" that I made. The sheets I made for you: "Expenses Oct" and "Trip plan".');
    expect((await call("google-sheets", "append_rows", { sheet: "expenses", rows: [] })).error?.message).toBe("What should the rows say?");
    const asked = await use("google-sheets", "append_rows", { sheet: "expenses", rows: [["24 Oct", "Auto", 80], ["25 Oct", "Lunch", 150]] });
    expect(asked).toMatchObject({ kind: "approval", approval: { risk: "write", preview: 'Add 2 rows to the Google Sheet "Expenses Oct": "24 Oct", "Auto", 80; "25 Oct", "Lunch", 150' } });
  });

  it("opens a link only to a sheet Tailzu made: drive.file sees no other", async () => {
    const { g, call } = await setup({ connect: ["google-sheets"] });
    g.to("GET", `/drive/v3/files/${SHEET_ID}`, { json: { id: SHEET_ID, name: "Expenses Oct", mimeType: "application/vnd.google-apps.spreadsheet", trashed: false } });
    g.to("GET", `/v4/spreadsheets/${SHEET_ID}/values/A1%3AZ200`, { json: { values: [["Item", "Amount"], ["Chai", "20"], [], ["Auto", "80"]] } });
    const out = await call("google-sheets", "read_sheet", { sheet: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0` });
    expect(Object.fromEntries(g.last((c) => c.url.hostname === "sheets.googleapis.com").url.searchParams)).toEqual({ majorDimension: "ROWS", valueRenderOption: "FORMATTED_VALUE" });
    expect(out.text).toBe('"Expenses Oct" has 3 rows:\n- Item | Amount\n- Chai | 20\n- Auto | 80');
    const someoneElses = "https://docs.google.com/spreadsheets/d/1NotOursDDDDDDDDDDDDDDDDDDDDDDD/edit";
    expect((await call("google-sheets", "read_sheet", { sheet: someoneElses })).error?.message).toBe("I can only open sheets I made for you, and that link isn't one of them.");
  });
});

// ------------------------------------------------------------------ Google Forms

describe("Google Forms", () => {
  const QUESTIONS = [
    { title: "Which day?", type: "choice", options: ["Friday", "Saturday", "friday"], required: true },
    { title: "Your name", type: "text" },
  ];

  it("makes a form unpublished, adds the questions, then opens it for answers", async () => {
    const { g, call } = await setup({ connect: ["google-forms"] });
    g.to("POST", "/v1/forms", { json: { formId: FORM_ID, responderUri: `https://docs.google.com/forms/d/e/1FAIpQLSexample/viewform` } });
    g.to("POST", `/v1/forms/${FORM_ID}:batchUpdate`, { json: {} });
    g.to("POST", `/v1/forms/${FORM_ID}:setPublishSettings`, { json: {} });
    const out = await call("google-forms", "create_form", { title: "Team lunch", description: "Pick a day", questions: QUESTIONS });
    const [create, batch, publish] = g.only((c) => c.url.hostname === "forms.googleapis.com");
    expect(create!.url.searchParams.get("unpublished")).toBe("true");
    expect(create!.body).toEqual({ info: { title: "Team lunch" } });
    expect(create!.auth).toBe("Bearer at-google-forms");
    expect(batch!.body).toEqual({
      requests: [
        { updateFormInfo: { info: { description: "Pick a day" }, updateMask: "description" } },
        { createItem: { item: { title: "Which day?", questionItem: { question: { required: true, choiceQuestion: { type: "RADIO", options: [{ value: "Friday" }, { value: "Saturday" }] } } } }, location: { index: 0 } } },
        { createItem: { item: { title: "Your name", questionItem: { question: { required: false, textQuestion: { paragraph: false } } } }, location: { index: 1 } } },
      ],
    });
    expect(publish!.body).toEqual({ publishSettings: { publishState: { isPublished: true, isAcceptingResponses: true } }, updateMask: "publishState" });
    expect(out.text).toBe(`Made the Google Form "Team lunch" with 2 questions. Share this link: https://docs.google.com/forms/d/e/1FAIpQLSexample/viewform (edit it at https://docs.google.com/forms/d/${FORM_ID}/edit)`);
  });

  it("checks the questions, and says what was made when a step fails", async () => {
    const { g, call, use } = await setup({ connect: ["google-forms"] });
    expect((await call("google-forms", "create_form", { title: "Q", questions: [] })).error?.message).toBe("What should the form ask?");
    expect((await call("google-forms", "create_form", { title: "Q", questions: [{ title: "Yes?", type: "choice", options: ["Yes"] }] })).error?.message)
      .toBe('"Yes?" needs at least two choices.');
    expect(g.calls).toHaveLength(0);
    g.to("POST", "/v1/forms", { json: { formId: FORM_ID } });
    g.to("POST", `/v1/forms/${FORM_ID}:batchUpdate`, { status: 400, json: {} });
    const out = await call("google-forms", "create_form", { title: "Quiz", questions: ["What is 2+2?"] });
    expect(out).toMatchObject({ ok: true, text: `Made the Google Form "Quiz" but couldn't add the questions. https://docs.google.com/forms/d/${FORM_ID}/edit` });
    const asked = await use("google-forms", "create_form", { title: "Team lunch", questions: QUESTIONS });
    expect(asked).toMatchObject({ kind: "approval", approval: {
      risk: "write", preview: 'Make a new Google Form "Team lunch" with 2 questions: "Which day?" (Friday / Saturday); "Your name". It opens for answers; I share it with no one',
    } });
  });

  it("adds up the choices and gives the latest answers, in the person's zone", async () => {
    const { g, call } = await setup({ connect: ["google-forms"] });
    g.to("GET", "/drive/v3/files", { json: { files: [{ id: FORM_ID, name: "Team lunch" }] } });
    g.to("GET", `/v1/forms/${FORM_ID}`, { json: { info: { title: "Team lunch" }, items: [
      { title: "Which day?", questionItem: { question: { questionId: "a1", choiceQuestion: { type: "RADIO" } } } },
      { title: "Your name", questionItem: { question: { questionId: "a2", textQuestion: {} } } },
    ] } });
    const r = (t: string, day: string, name?: string) => ({ lastSubmittedTime: t, answers: {
      a1: { questionId: "a1", textAnswers: { answers: [{ value: day }] } },
      ...(name ? { a2: { questionId: "a2", textAnswers: { answers: [{ value: name }] } } } : {}),
    } });
    g.to("GET", `/v1/forms/${FORM_ID}/responses`, { json: { responses: [
      r("2026-10-21T09:00:00Z", "Friday", "Asha"), r("2026-10-22T04:35:00Z", "Friday", "Priya"),
      r("2026-10-21T10:00:00Z", "Saturday", "Rahul"), r("2026-10-20T09:00:00Z", "Friday"),
    ] } });
    const out = await call("google-forms", "list_responses", { form: "team lunch" });
    expect(g.last((c) => c.url.pathname === "/drive/v3/files").url.searchParams.get("q")).toBe("mimeType='application/vnd.google-apps.form' and trashed=false");
    expect(g.last((c) => c.url.pathname.endsWith("/responses")).url.searchParams.get("pageSize")).toBe("500");
    expect(out.text).toBe([
      '4 responses to "Team lunch".',
      "Which day? Friday 3, Saturday 1",
      "The latest 3:",
      "- Today 10:05: Which day? Friday; Your name: Priya",
      "- Yesterday 15:30: Which day? Saturday; Your name: Rahul",
      "- Yesterday 14:30: Which day? Friday; Your name: Asha",
    ].join("\n"));
    g.to("GET", `/v1/forms/${FORM_ID}/responses`, { json: {} });
    expect((await call("google-forms", "list_responses", { form: "team lunch" })).text).toBe('No one has answered "Team lunch" yet.');
  });
});

// ------------------------------------------------------------------ Google Classroom

describe("Google Classroom", () => {
  const COURSES = { json: { courses: [{ id: "c1", name: "Physics", section: "B", room: "12" }, { id: "c2", name: "History" }] } };
  const due = (y: number, m: number, d: number, time: Record<string, number> = {}) => ({ dueDate: { year: y, month: m, day: d }, dueTime: time });

  it("lists the active classes", async () => {
    const { g, call } = await setup({ connect: ["google-classroom"] });
    g.to("GET", "/v1/courses", COURSES);
    const out = await call("google-classroom", "my_classes");
    expect(Object.fromEntries(g.last(() => true).url.searchParams)).toEqual({ courseStates: "ACTIVE", pageSize: "30" });
    expect(g.last(() => true).auth).toBe("Bearer at-google-classroom");
    expect(out.text).toBe("You're in 2 classes:\n- Physics, B (room 12)\n- History");
  });

  it("says what is due and what is missing, with their own state on each, in their zone", async () => {
    const { g, call } = await setup({ connect: ["google-classroom"] });
    g.to("GET", "/v1/courses", COURSES);
    g.to("GET", "/v1/courses/c1/courseWork", { json: { courseWork: [
      { id: "w6", title: "Final project", ...due(2026, 11, 20, { hours: 18, minutes: 29 }) },
      { id: "w3", title: "Quiz 1", ...due(2026, 10, 25, { hours: 4, minutes: 30 }) },
      { id: "w1", title: "Lab report", ...due(2026, 10, 23, { hours: 18, minutes: 29 }) },
      { id: "w2", title: "Worksheet 3", ...due(2026, 10, 20, { hours: 12 }) },
      { id: "w4", title: "Old essay", ...due(2026, 10, 15, { hours: 12 }) },
      { id: "w5", title: "Reading" },
    ] } });
    g.to("GET", "/v1/courses/c1/courseWork/-/studentSubmissions", { json: { studentSubmissions: [
      { courseWorkId: "w1", state: "CREATED" }, { courseWorkId: "w2", state: "CREATED" },
      { courseWorkId: "w3", state: "TURNED_IN" }, { courseWorkId: "w4", state: "RETURNED", assignedGrade: 9 },
    ] } });
    g.to("GET", "/v1/courses/c2/courseWork", { json: { courseWork: [{ id: "h1", title: "Essay", maxPoints: 20, ...due(2026, 10, 26) }] } });
    g.to("GET", "/v1/courses/c2/courseWork/-/studentSubmissions", { json: { studentSubmissions: [{ courseWorkId: "h1", state: "RETURNED", assignedGrade: 18 }] } });
    const out = await call("google-classroom", "whats_due");
    const list = g.only((c) => c.url.pathname === "/v1/courses")[0]!;
    expect(list.url.searchParams.get("studentId")).toBe("me");
    expect(Object.fromEntries(g.last((c) => c.url.pathname === "/v1/courses/c1/courseWork").url.searchParams)).toEqual({ orderBy: "dueDate desc", pageSize: "60" });
    expect(Object.fromEntries(g.last((c) => c.url.pathname.endsWith("/studentSubmissions")).url.searchParams)).toEqual({ userId: "me", pageSize: "100" });
    expect(out.text).toBe([
      "4 pieces of work due in the next 7 days or still missing:",
      "- Physics, B: Worksheet 3, due Tue 20 Oct 17:30, missing",
      "- Physics, B: Lab report, due Tomorrow 23:59, not turned in",
      "- Physics, B: Quiz 1, due Sunday 10:00, turned in",
      "- History: Essay, due Monday 05:30, returned, 18/20",
    ].join("\n"));
    const one = await call("google-classroom", "whats_due", { days: 1, class: "history" });
    expect(one.text).toBe("Nothing due in the next day, and nothing missing.");
    expect((await call("google-classroom", "whats_due", { class: "maths" })).error?.message)
      .toBe('I couldn\'t find a class called "maths" that you\'re a student in. Your classes: "Physics, B", "History".');
  });

  it("reads the latest announcements of one class or of all", async () => {
    const { g, call } = await setup({ connect: ["google-classroom"] });
    g.to("GET", "/v1/courses", COURSES);
    g.to("GET", "/v1/courses/c1/announcements", { json: { announcements: [
      { text: "Lab moved to Friday.", updateTime: "2026-10-22T03:40:00Z" },
      { text: "Bring\nyour notebooks", updateTime: "2026-10-19T05:00:00Z" },
    ] } });
    g.to("GET", "/v1/courses/c2/announcements", { json: { announcements: [{ text: "Test on Monday", updateTime: "2026-10-21T06:00:00Z" }] } });
    const one = await call("google-classroom", "announcements", { class: "physics" });
    expect(g.only((c) => c.url.pathname === "/v1/courses")[0]!.url.searchParams.has("studentId")).toBe(false);
    expect(Object.fromEntries(g.last((c) => c.url.pathname.endsWith("/announcements")).url.searchParams)).toEqual({ orderBy: "updateTime desc", pageSize: "6" });
    expect(one.text).toBe("The latest 2 announcements in Physics, B:\n- Today 09:10: Lab moved to Friday.\n- Mon 19 Oct 10:30: Bring your notebooks");
    const all = await call("google-classroom", "announcements");
    expect(all.text).toBe([
      "The latest 3 announcements:",
      "- Physics, B, Today 09:10: Lab moved to Friday.",
      "- History, Yesterday 11:30: Test on Monday",
      "- Physics, B, Mon 19 Oct 10:30: Bring your notebooks",
    ].join("\n"));
  });
});

// ------------------------------------------------------------------ YouTube

describe("YouTube", () => {
  const VIDEO = "dQw4w9WgXcQ";
  const PLAYLISTS = { json: { items: [
    { id: "PLaaaaaaaaaaaa", snippet: { title: "Workout" }, contentDetails: { itemCount: 12 } },
    { id: "PLbbbbbbbbbbbb", snippet: { title: "Work focus" }, contentDetails: { itemCount: 1 } },
  ] } };

  it("searches for videos and gives titles, channels and links", async () => {
    const { g, call } = await setup({ connect: ["google-youtube"] });
    g.to("GET", "/youtube/v3/search", { json: { items: [
      { id: { kind: "youtube#video", videoId: VIDEO }, snippet: { title: "Rock &amp; Roll Don&#39;t Stop", channelTitle: "The Band" } },
      { id: { kind: "youtube#channel", channelId: "UCx" }, snippet: { title: "A channel" } },
    ] } });
    const out = await call("google-youtube", "search_videos", { query: "rock songs", max: 50 });
    const req = g.last(() => true);
    expect(Object.fromEntries(req.url.searchParams)).toEqual({ part: "snippet", type: "video", q: "rock songs", maxResults: "10", safeSearch: "moderate" });
    expect(req.auth).toBe("Bearer at-google-youtube");
    expect(out.text).toBe(`1 video for "rock songs":\n- Rock & Roll Don't Stop (The Band) https://www.youtube.com/watch?v=${VIDEO}`);
  });

  it("lists the person's playlists", async () => {
    const { g, call } = await setup({ connect: ["google-youtube"] });
    g.to("GET", "/youtube/v3/playlists", PLAYLISTS);
    const out = await call("google-youtube", "my_playlists");
    expect(Object.fromEntries(g.last(() => true).url.searchParams)).toEqual({ part: "snippet,contentDetails", mine: "true", maxResults: "50" });
    expect(out.text).toBe("2 playlists:\n- Workout, 12 videos (id: PLaaaaaaaaaaaa)\n- Work focus, 1 video (id: PLbbbbbbbbbbbb)");
  });

  it("adds a video to a playlist named by the person, after a yes", async () => {
    const { g, call, use } = await setup({ connect: ["google-youtube"] });
    g.to("GET", "/youtube/v3/playlists", PLAYLISTS);
    g.to("GET", "/youtube/v3/videos", (c) => ({ json: { items: c.url.searchParams.get("id") === VIDEO ? [{ id: VIDEO, snippet: { title: "Never Gonna" } }] : [] } }));
    g.to("POST", "/youtube/v3/playlistItems", { json: { id: "item1" } });
    const asked = await use("google-youtube", "add_to_playlist", { video: `https://youtu.be/${VIDEO}`, playlist: "workout" });
    expect(asked).toMatchObject({ kind: "approval", approval: { risk: "write", preview: 'Add "Never Gonna" to your YouTube playlist "Workout"' } });
    expect(g.only((c) => c.method === "POST")).toHaveLength(0);
    const out = await call("google-youtube", "add_to_playlist", { video: `https://www.youtube.com/watch?v=${VIDEO}&t=10`, playlist: "PLaaaaaaaaaaaa" });
    const post = g.last((c) => c.method === "POST");
    expect(post.url.searchParams.get("part")).toBe("snippet");
    expect(post.body).toEqual({ snippet: { playlistId: "PLaaaaaaaaaaaa", resourceId: { kind: "youtube#video", videoId: VIDEO } } });
    expect(out.text).toBe(`Added "Never Gonna" to your playlist "Workout". https://www.youtube.com/watch?v=${VIDEO}`);
    expect((await call("google-youtube", "add_to_playlist", { video: VIDEO, playlist: "work" })).error?.message)
      .toBe('I found more than one playlist like that: "Workout" and "Work focus". Which one?');
    expect((await call("google-youtube", "add_to_playlist", { video: "AAAAAAAAAAA", playlist: "workout" })).error?.message).toBe("I couldn't find that video on YouTube.");
    expect((await call("google-youtube", "add_to_playlist", { video: "never gonna", playlist: "workout" })).error?.message).toBe("I need the video's YouTube link or id. Search for it first.");
  });

  it("reads a video id from any YouTube link, and nothing else", () => {
    for (const s of [VIDEO, `https://youtu.be/${VIDEO}?t=3`, `https://m.youtube.com/watch?v=${VIDEO}`, `https://www.youtube.com/shorts/${VIDEO}`, `https://music.youtube.com/watch?v=${VIDEO}`]) {
      expect(videoIdOf(s), s).toBe(VIDEO);
    }
    for (const s of ["", "hello", `https://evil.example/watch?v=${VIDEO}`, "https://youtu.be/short"]) expect(videoIdOf(s), s).toBeNull();
  });

  it("says the day's searches are used up, not to try in a minute", async () => {
    const { g, call } = await setup({ connect: ["google-youtube"] });
    g.to("GET", "/youtube/v3/search", { status: 403, json: { error: { errors: [{ reason: "quotaExceeded" }], message: "The request cannot be completed because you have exceeded your quota." } } });
    expect((await call("google-youtube", "search_videos", { query: "lofi" })).error).toEqual({ code: "failed", message: "YouTube has done all it can for today. Try again tomorrow." });
  });
});
