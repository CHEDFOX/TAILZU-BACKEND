/**
 * Phase 2c: the native Google connectors (Calendar, Docs) and the email
 * hand-off, with no network: Google is a scripted fake `fetch`.
 *
 * Covers the sign-in (scopes per app, PKCE, offline, refresh and its retry on
 * a 401), each tool's request and its plain-words result, the risk tiers, the
 * confirm card, the hand-off's links and the `open` event, and that the
 * screens' list shows Calendar and Docs and never the hand-off.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
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

const { runStep } = await import("../src/agent/run.js");
const { EventSink } = await import("../src/agent/protocol.js");
const { ALWAYS_ON, CATALOG } = await import("../src/connectors/catalog.js");
const { decrypt, encrypt } = await import("../src/connectors/crypto.js");
const { createConnectors } = await import("../src/connectors/index.js");
const { connectorList } = await import("../src/connectors/list.js");
const { signState, verifyState } = await import("../src/connectors/oauth.js");
const { beginGoogleOAuth, completeGoogleOAuth } = await import("../src/connectors/google/index.js");
const { handoffLinks } = await import("../src/connectors/handoffs/email.js");
const { HANDOFF_IDS } = await import("../src/connectors/handoffs/index.js");
const { noteText } = await import("../src/connectors/google/docs.js");
const { blocksTime, mergeSpans } = await import("../src/connectors/google/calendar.js");
const { CALENDAR_ZONE_URL } = await import("../src/connectors/google/zone.js");
const { parseWhen, wallOf } = await import("../src/connectors/google/time.js");
const { MemoryConnectorStore } = await import("../src/connectors/store.js");
const { registerConnectorRoutes } = await import("../src/routes/connectors.js");
const { wordsFor, EN, HG } = await import("../src/connectors/words.js");
type Note = import("../../shared/types/api.js").Note;

// Thursday 22 Oct 2026, 13:30 in India (UTC+5:30).
const NOW = Date.parse("2026-10-22T08:00:00Z");
const REDIRECT = "https://api.example.com/v1/connectors/callback";
const CAL_SCOPES = ["https://www.googleapis.com/auth/calendar.events"];
/** What someone who connected Calendar before 2026-10-22 granted: calendar.readonly as well. */
const OLD_CAL_SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"];
const DOCS_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE = { clientId: "cid.apps.googleusercontent.com", clientSecret: "csecret" };
const EVENTS_PATH = "/calendar/v3/calendars/primary/events";

// ------------------------------------------------------------- a scripted Google

interface Call { url: URL; method: string; auth: string | null; body: any; form: Record<string, string> | null }
type Reply = { status?: number; json?: unknown; empty?: boolean };

/** The read of the calendar's zone: events.list on the primary calendar, for its timeZone alone. */
const isZone = (c: Call) => c.url.pathname === EVENTS_PATH && c.url.searchParams.get("fields") === "timeZone";

function fakeGoogle() {
  const calls: Call[] = [];
  const routes: Array<{ match: (c: Call) => boolean; reply: Reply | ((c: Call) => Reply) }> = [];
  /** Answered before any route: the zone read shares events.list's path with list_events. */
  const pinned: typeof routes = [];
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
    const hit = pinned.find((r) => r.match(c)) ?? routes.find((r) => r.match(c));
    if (!hit) return new Response(JSON.stringify({ error: { message: "no route", status: "NOT_FOUND" } }), { status: 404 });
    const r = typeof hit.reply === "function" ? hit.reply(c) : hit.reply;
    return r.empty ? new Response(null, { status: r.status ?? 204 }) : new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  }) as typeof fetch;
  return {
    calls, fetchFn,
    on(match: (c: Call) => boolean, reply: Reply | ((c: Call) => Reply)) { routes.unshift({ match, reply }); },
    pin(match: (c: Call) => boolean, reply: Reply | ((c: Call) => Reply)) { pinned.unshift({ match, reply }); },
    to(method: string, path: RegExp | string, reply: Reply | ((c: Call) => Reply)) {
      this.on((c) => c.method === method && (typeof path === "string" ? c.url.pathname === path : path.test(c.url.pathname)), reply);
    },
    token(reply: Reply | ((c: Call) => Reply)) { this.on((c) => c.url.href === "https://oauth2.googleapis.com/token", reply); },
    only(pred: (c: Call) => boolean) { return calls.filter(pred); },
    last(pred: (c: Call) => boolean) { return calls.filter(pred).at(-1)!; },
  };
}

const notes: Note[] = [];
const note = (over: Partial<Note> = {}): Note => ({
  id: "11111111-1111-4111-8111-111111111111", status: "done", startedAt: "2026-10-21T09:00:00.000Z", durationSeconds: 1500, words: 900,
  title: "Launch sync", summary: "We agreed to ship on Friday.", highlights: [{ speaker: "Speaker 1", text: "Ship Friday." }],
  people: [{ label: "Speaker 1", name: "Priya" }, { label: "You" }], transcript: [], organised: true, ...over,
});

async function setup(o: { connect?: Array<"google-calendar" | "google-docs">; level?: "look" | "draft" | "send"; google?: typeof GOOGLE | null; calScopes?: string[] } = {}) {
  const g = fakeGoogle();
  g.pin(isZone, { json: { timeZone: "Asia/Kolkata" } });
  const store = new MemoryConnectorStore();
  const connectors = createConnectors({
    store, redirectUrl: REDIRECT, now: () => NOW, fetchFn: g.fetchFn, google: o.google === undefined ? GOOGLE : o.google,
    catalog: [...CATALOG.filter((c) => c.provider === "google"), ...ALWAYS_ON],
    notes: { find: async (_u, id) => (id ? notes.find((n) => n.id === id) ?? null : notes[0] ?? null) },
  });
  const user = "u1";
  for (const id of o.connect ?? ["google-calendar", "google-docs"]) {
    await store.upsertConnection(user, id, {
      level: o.level ?? "send",
      tokensEnc: encrypt(JSON.stringify({ access_token: "at-1", refresh_token: "rt-1", expires_at: NOW + 3_600_000, scope: id === "google-docs" ? DOCS_SCOPE : (o.calScopes ?? CAL_SCOPES).join(" ") })),
    });
  }
  const call = (connector: string, tool: string, args: Record<string, unknown> = {}) => connectors.hub.call(user, connector, tool, args);
  const use = (connector: string, tool: string, args: Record<string, unknown>, allowWrite = true) =>
    connectors.tasks.use(user, "run_1", "said", { connector, tool, args }, { allowWrite });
  const risk = async (connector: string, tool: string, args: Record<string, unknown>) =>
    connectors.hub.riskFor(user, connectors.hub.def(connector)!, { name: tool, inputSchema: {} }, args);
  return { g, store, connectors, user, call, use, risk };
}

const EVENT = (over: Record<string, unknown> = {}) => ({
  id: "ev1", summary: "Design sync", status: "confirmed",
  start: { dateTime: "2026-10-24T10:00:00+05:30" }, end: { dateTime: "2026-10-24T10:30:00+05:30" },
  attendees: [{ email: "me@example.com", self: true }, { email: "rahul@example.com", displayName: "Rahul" }], ...over,
});

// ------------------------------------------------------------------- the catalog

describe("the catalog", () => {
  it("has Google Calendar and Google Docs, verified, native, and off until named", () => {
    const cal = CATALOG.find((c) => c.id === "google-calendar")!;
    const docs = CATALOG.find((c) => c.id === "google-docs")!;
    expect(cal).toMatchObject({ name: "Google Calendar", kind: "native", provider: "google", auth: "oauth", verified: true, scopes: CAL_SCOPES });
    expect(docs).toMatchObject({ name: "Google Docs", kind: "native", provider: "google", auth: "oauth", verified: true, scopes: [DOCS_SCOPE] });
    for (const a of ["calendar", "meeting", "schedule", "invite"]) expect(cal.aliases).toContain(a);
    for (const a of ["doc", "docs", "google doc"]) expect(docs.aliases).toContain(a);
  });

  it("keeps the email hand-off out of the catalog and out of the list of apps to connect", async () => {
    expect(CATALOG.some((c) => c.id === "email-handoff")).toBe(false);
    expect(ALWAYS_ON.map((c) => c.id)).toEqual(["email-handoff", ...HANDOFF_IDS, "youtube"]);
    const { connectors, user } = await setup();
    expect((await connectorList(connectors, user)).map((c) => c.id)).toEqual(CATALOG.filter((c) => c.provider === "google").map((c) => c.id));
    expect(connectors.hub.def("email-handoff")).toBeTruthy();
  });

  it("is always there by default (CONNECTORS on), whatever CONNECTORS_ENABLED_IDS says", () => {
    const c = createConnectors({ store: new MemoryConnectorStore(), redirectUrl: REDIRECT });
    expect(c.hub.catalog.map((d) => d.id)).toEqual(["email-handoff", ...HANDOFF_IDS, "youtube"]);
  });
});

// -------------------------------------------------------------------- the sign-in

describe("signing in to Google", () => {
  const begin = async (id: string) => {
    const store = new MemoryConnectorStore();
    const def = CATALOG.find((c) => c.id === id)!;
    const url = new URL(await beginGoogleOAuth({ store, redirectUrl: REDIRECT, google: GOOGLE }, "u1", def, NOW));
    return { store, def, url, p: url.searchParams };
  };

  it("asks Calendar for calendar.events and nothing else, offline, with PKCE", async () => {
    const { store, url, p } = await begin("google-calendar");
    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(p.get("scope")!.split(" ")).toEqual(CAL_SCOPES);
    expect(p.get("client_id")).toBe(GOOGLE.clientId);
    expect(p.get("redirect_uri")).toBe(REDIRECT);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("include_granted_scopes")).toBe("true");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("code_challenge_method")).toBe("S256");
    // The challenge is the SHA-256 of the verifier we kept, encrypted.
    const row = (await store.getConnection("u1", "google-calendar"))!;
    expect(row.verifierEnc).toMatch(/^v1\./);
    const verifier = decrypt(row.verifierEnc!);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(p.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
    // The state says who and which.
    expect(await verifyState(p.get("state")!, NOW)).toEqual({ userId: "u1", connectorId: "google-calendar" });
  });

  it("asks Docs for drive.file and nothing else", async () => {
    const { p } = await begin("google-docs");
    expect(p.get("scope")).toBe(DOCS_SCOPE);
  });

  it("says so when the server has no Google client", async () => {
    const def = CATALOG.find((c) => c.id === "google-calendar")!;
    await expect(beginGoogleOAuth({ store: new MemoryConnectorStore(), redirectUrl: REDIRECT, google: null }, "u1", def))
      .rejects.toMatchObject({ code: "not_configured" });
  });

  describe("coming back", () => {
    const comeBack = async (id: string, reply: Parameters<ReturnType<typeof fakeGoogle>["token"]>[0]) => {
      const g = fakeGoogle();
      g.token(reply);
      const { store, def, p } = await begin(id);
      const run = () => completeGoogleOAuth({ store, redirectUrl: REDIRECT, google: { ...GOOGLE, fetchFn: g.fetchFn } }, (i) => (i === id ? def : undefined), "the-code", p.get("state")!, NOW);
      return { g, store, def, p, run };
    };
    const good = (scope: string) => ({ json: { access_token: "at-new", refresh_token: "rt-new", expires_in: 3599, scope, token_type: "Bearer" } });

    it("exchanges the code with the verifier and the secret, and keeps the tokens encrypted", async () => {
      const { g, store, run, p } = await comeBack("google-calendar", good(CAL_SCOPES.join(" ")));
      const verifier = decrypt((await store.getConnection("u1", "google-calendar"))!.verifierEnc!);
      expect(await run()).toMatchObject({ userId: "u1", def: { id: "google-calendar" } });
      expect(g.calls).toHaveLength(1);
      expect(g.calls[0]!.form).toEqual({
        grant_type: "authorization_code", code: "the-code", redirect_uri: REDIRECT, code_verifier: verifier,
        client_id: GOOGLE.clientId, client_secret: GOOGLE.clientSecret,
      });
      expect(p.get("state")).toBeTruthy();
      const row = (await store.getConnection("u1", "google-calendar"))!;
      expect(row.tokensEnc).toMatch(/^v1\./);
      expect(row.tokensEnc).not.toContain("at-new");
      expect(JSON.parse(decrypt(row.tokensEnc!))).toEqual({ access_token: "at-new", refresh_token: "rt-new", expires_at: NOW + 3_599_000, scope: CAL_SCOPES.join(" ") });
      // The verifier is single use.
      expect(row.verifierEnc).toBeNull();
      await expect(run()).rejects.toMatchObject({ code: "bad_state" });
    });

    it("takes a Calendar grant that has calendar.events, with calendar.readonly beside it or not", async () => {
      // include_granted_scopes: someone who connected before still has calendar.readonly in the grant Google returns.
      for (const scope of [OLD_CAL_SCOPES.join(" "), CAL_SCOPES.join(" "), `${DOCS_SCOPE} ${OLD_CAL_SCOPES.join(" ")}`]) {
        const { store, run } = await comeBack("google-calendar", good(scope));
        expect(await run(), scope).toMatchObject({ def: { id: "google-calendar" } });
        expect(JSON.parse(decrypt((await store.getConnection("u1", "google-calendar"))!.tokensEnc!)).scope).toBe(scope);
      }
    });

    it("refuses a grant with a scope unticked, or with no refresh token, and a bad state", async () => {
      const part = await comeBack("google-calendar", good("https://www.googleapis.com/auth/calendar.readonly"));
      await expect(part.run()).rejects.toMatchObject({ code: "failed", message: expect.stringContaining("every box ticked") });
      expect((await part.store.getConnection("u1", "google-calendar"))!.tokensEnc).toBeNull();

      const noRefresh = await comeBack("google-docs", { json: { access_token: "a", expires_in: 3600, scope: DOCS_SCOPE } });
      await expect(noRefresh.run()).rejects.toMatchObject({ code: "failed" });

      const denied = await comeBack("google-docs", { status: 400, json: { error: "invalid_grant" } });
      await expect(denied.run()).rejects.toMatchObject({ code: "failed" });

      const bad = await comeBack("google-docs", good(DOCS_SCOPE));
      await expect(completeGoogleOAuth({ store: bad.store, redirectUrl: REDIRECT, google: GOOGLE }, () => bad.def, "c", "not-a-state", NOW))
        .rejects.toMatchObject({ code: "bad_state" });
      // A state made for another app does not finish this one.
      const other = await signState("u1", "notion", NOW);
      await expect(completeGoogleOAuth({ store: bad.store, redirectUrl: REDIRECT, google: GOOGLE }, () => undefined, "c", other, NOW))
        .rejects.toMatchObject({ code: "bad_state" });
    });
  });

  it("goes through the routes: Connect answers with Google's address, and the callback connects", async () => {
    const g = fakeGoogle();
    g.token({ json: { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: CAL_SCOPES.join(" ") } });
    const store = new MemoryConnectorStore();
    const connectors = createConnectors({
      store, redirectUrl: REDIRECT, google: GOOGLE, fetchFn: g.fetchFn,
      catalog: [...CATALOG.filter((c) => c.provider === "google"), ...ALWAYS_ON],
    });
    const app = Fastify();
    registerConnectorRoutes(app, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, connectors });
    await app.ready();
    const as = { authorization: "Bearer ann" };
    const res = await app.inject({ method: "POST", url: "/v1/connectors/google-calendar/connect", headers: as, payload: {} });
    expect(res.statusCode).toBe(200);
    const url = new URL(res.json().authorizeUrl);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    // Nothing to connect for the hand-off.
    expect((await app.inject({ method: "POST", url: "/v1/connectors/email-handoff/connect", headers: as, payload: {} })).statusCode).toBe(404);

    const back = await app.inject({ method: "GET", url: `/v1/connectors/callback?code=abc&state=${encodeURIComponent(url.searchParams.get("state")!)}` });
    expect(back.statusCode).toBe(200);
    expect(back.body).toContain("Google Calendar is ready");
    expect((await store.getConnection("ann", "google-calendar"))!.tokensEnc).toMatch(/^v1\./);
    const list = (await app.inject({ method: "GET", url: "/v1/connectors", headers: as })).json();
    expect(list.connectors.slice(0, 2).map((c: { id: string; connected: boolean }) => [c.id, c.connected])).toEqual([["google-calendar", true], ["google-docs", false]]);

    // Disconnecting forgets the token; the grant is revoked at Google only with the last Google app.
    g.to("POST", "/revoke", { json: {} });
    await store.upsertConnection("ann", "google-docs", { tokensEnc: encrypt(JSON.stringify({ access_token: "d", refresh_token: "rt-docs", expires_at: NOW, scope: DOCS_SCOPE })) });
    expect((await app.inject({ method: "DELETE", url: "/v1/connectors/google-calendar", headers: as })).statusCode).toBe(200);
    expect(g.only((c) => c.url.pathname === "/revoke")).toHaveLength(0);
    expect((await store.getConnection("ann", "google-calendar"))).toBeNull();
    expect((await app.inject({ method: "DELETE", url: "/v1/connectors/google-docs", headers: as })).statusCode).toBe(200);
    const revoke = g.only((c) => c.url.pathname === "/revoke");
    expect(revoke).toHaveLength(1);
    expect(revoke[0]!.form).toEqual({ token: "rt-docs" });
    expect((await store.getConnection("ann", "google-docs"))).toBeNull();

    const off = createConnectors({ store: new MemoryConnectorStore(), redirectUrl: REDIRECT, google: null, catalog: [...CATALOG.filter((c) => c.provider === "google")] });
    const app2 = Fastify();
    registerConnectorRoutes(app2, { rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } }, connectors: off });
    await app2.ready();
    expect((await app2.inject({ method: "POST", url: "/v1/connectors/google-docs/connect", headers: as, payload: {} })).statusCode).toBe(503);
  });
});

// ------------------------------------------------------------ tokens and refresh

describe("calling Google as the person", () => {
  const events = { items: [] as unknown[] };

  it("sends the access token, and on a 401 refreshes once and retries once", async () => {
    const { g, store, call } = await setup();
    g.to("GET", "/calendar/v3/calendars/primary/events", (c) => c.auth === "Bearer at-2" ? { json: events } : { status: 401, json: { error: { code: 401 } } });
    g.token({ json: { access_token: "at-2", expires_in: 3600 } });
    const out = await call("google-calendar", "list_events");
    expect(out).toMatchObject({ ok: true, text: "Nothing on your calendar today." });
    const cal = g.only((c) => c.url.pathname.endsWith("/events") && !isZone(c));
    expect(cal.map((c) => c.auth)).toEqual(["Bearer at-1", "Bearer at-2"]);
    const tok = g.only((c) => c.url.hostname === "oauth2.googleapis.com");
    expect(tok).toHaveLength(1);
    expect(tok[0]!.form).toMatchObject({ grant_type: "refresh_token", refresh_token: "rt-1", client_id: GOOGLE.clientId, client_secret: GOOGLE.clientSecret });
    // The new token is kept (encrypted), with the old refresh token.
    const kept = JSON.parse(decrypt((await store.getConnection("u1", "google-calendar"))!.tokensEnc!));
    expect(kept).toMatchObject({ access_token: "at-2", refresh_token: "rt-1" });
    // And used from then on, with no second refresh.
    await call("google-calendar", "list_events");
    expect(g.only((c) => c.url.hostname === "oauth2.googleapis.com")).toHaveLength(1);
  });

  it("does not retry twice: a second 401 means sign in again", async () => {
    const { g, call, connectors, user } = await setup();
    g.to("GET", "/calendar/v3/calendars/primary/events", { status: 401, json: {} });
    g.token({ json: { access_token: "at-2", expires_in: 3600 } });
    const out = await call("google-calendar", "list_events");
    expect(out.ok).toBe(false);
    expect(out.error).toEqual({ code: "needs_reconnect", message: "Google Calendar needs you to sign in again." });
    expect(g.only((c) => c.url.pathname.endsWith("/events") && !isZone(c))).toHaveLength(2);
    expect(connectors.hub.needsSignIn(user, "google-calendar")).toBe(true);
  });

  it("refreshes a token that is about to expire before using it, and says sign in again when Google refuses the refresh", async () => {
    const { g, store, call } = await setup();
    await store.upsertConnection("u1", "google-calendar", { tokensEnc: encrypt(JSON.stringify({ access_token: "old", refresh_token: "rt-1", expires_at: NOW + 10_000, scope: "" })) });
    g.to("GET", "/calendar/v3/calendars/primary/events", (c) => ({ json: { items: [], via: c.auth } }));
    g.token({ status: 400, json: { error: "invalid_grant" } });
    const out = await call("google-calendar", "list_events");
    expect(out.error?.code).toBe("needs_reconnect");
    expect(g.only((c) => c.url.pathname.endsWith("/events"))).toHaveLength(0);
  });

  it("turns Google's failures into plain words, never its own text", async () => {
    const { g, call } = await setup();
    g.to("GET", /\/events\/ev9$/, { status: 404, json: { error: { message: "Not Found: secret detail" } } });
    const missing = await call("google-calendar", "delete_event", { event_id: "ev9" });
    expect(missing.error).toEqual({ code: "rejected", message: "I couldn't find that event." });
    g.to("GET", "/calendar/v3/calendars/primary/events", { status: 503, json: { error: { message: "backend stack trace" } } });
    const down = await call("google-calendar", "list_events");
    expect(down.error).toEqual({ code: "failed", message: "Google Calendar ran into a problem." });
    g.to("GET", "/calendar/v3/calendars/primary/events", { status: 403, json: { error: { errors: [{ reason: "rateLimitExceeded" }] } } });
    expect((await call("google-calendar", "list_events")).error?.message).toBe("Google Calendar is busy right now. Try again in a minute.");
  });
});

// ------------------------------------------------------------------ the calendar

describe("Google Calendar tools", () => {
  it("lists today in the calendar's own zone, in plain words, with ids", async () => {
    const { g, call } = await setup();
    g.to("GET", "/calendar/v3/calendars/primary/events", {
      json: { items: [
        EVENT({ id: "a1", summary: "Standup", attendees: undefined, start: { dateTime: "2026-10-22T15:00:00+05:30" }, end: { dateTime: "2026-10-22T15:30:00+05:30" } }),
        EVENT({ id: "a2", summary: "Planning", start: { dateTime: "2026-10-24T10:00:00+05:30" }, end: { dateTime: "2026-10-24T10:30:00+05:30" } }),
        { id: "a3", summary: "Diwali", start: { date: "2026-11-08" }, end: { date: "2026-11-09" } },
        EVENT({ id: "gone", status: "cancelled" }),
      ] },
    });
    const out = await call("google-calendar", "list_events", {});
    const req = g.only((c) => c.url.pathname === EVENTS_PATH && !isZone(c))[0]!;
    expect(req.method).toBe("GET");
    expect(req.url.searchParams.get("timeMin")).toBe("2026-10-21T18:30:00.000Z");
    expect(req.url.searchParams.get("timeMax")).toBe("2026-10-22T18:30:00.000Z");
    expect(req.url.searchParams.get("singleEvents")).toBe("true");
    expect(req.url.searchParams.get("orderBy")).toBe("startTime");
    expect(req.url.searchParams.get("timeZone")).toBe("Asia/Kolkata");
    expect(out.text).toBe([
      "3 events today:",
      "- Today 15:00–15:30, Standup (id: a1)",
      "- Saturday 10:00–10:30, Planning with Rahul (id: a2)",
      "- Sun 8 Nov, all day, Diwali (id: a3)",
    ].join("\n"));
  });

  it("reads a range from the person's words, in the zone they name", async () => {
    const { g, call } = await setup();
    g.to("GET", "/calendar/v3/calendars/primary/events", { json: { items: [] } });
    const out = await call("google-calendar", "list_events", { from: "tomorrow", timezone: "America/New_York", max: 99 });
    const req = g.only((c) => c.url.pathname.endsWith("/events"))[0]!;
    // Friday 23 Oct, New York (UTC-4).
    expect(req.url.searchParams.get("timeMin")).toBe("2026-10-23T04:00:00.000Z");
    expect(req.url.searchParams.get("timeMax")).toBe("2026-10-24T04:00:00.000Z");
    expect(req.url.searchParams.get("maxResults")).toBe("25");
    // A zone they named is used as it is: the calendar's is not read.
    expect(g.only(isZone)).toHaveLength(0);
    expect(out.text).toBe("Nothing on your calendar tomorrow.");
    expect((await call("google-calendar", "list_events", { from: "whenever" })).error?.message).toContain("couldn't read the start");
  });

  it("reads the calendar's zone from events.list, once, and never calls settings or freeBusy", async () => {
    const { g, call } = await setup();
    g.to("GET", EVENTS_PATH, { json: { items: [] } });
    g.to("POST", EVENTS_PATH, { json: { id: "new1" } });
    await call("google-calendar", "list_events");
    await call("google-calendar", "find_free_time", { from: "friday" });
    await call("google-calendar", "create_event", { title: "Lunch", start: "friday 13:00" });
    const zone = g.only(isZone);
    expect(zone).toHaveLength(1);
    expect(zone[0]!.url.href).toBe(CALENDAR_ZONE_URL);
    expect(Object.fromEntries(zone[0]!.url.searchParams)).toEqual({ maxResults: "1", fields: "timeZone" });
    expect(zone[0]!.auth).toBe("Bearer at-1");
    // Every Calendar request is events.list, get, insert, patch or delete, all under calendar.events.
    expect(g.calls.filter((c) => /settings|freeBusy/i.test(c.url.pathname))).toEqual([]);
    expect(g.calls.every((c) => c.url.pathname.startsWith(EVENTS_PATH))).toBe(true);
    // The times were read in the zone the calendar said.
    expect(g.last((c) => c.method === "POST").body.start).toEqual({ dateTime: "2026-10-23T13:00:00+05:30", timeZone: "Asia/Kolkata" });
  });

  it("falls back to UTC when Google gives the calendar no zone it knows", async () => {
    const { g, call } = await setup();
    g.pin(isZone, { json: { timeZone: "Mars/Olympus_Mons" } });
    g.to("GET", EVENTS_PATH, { json: { items: [] } });
    await call("google-calendar", "list_events");
    expect(g.last((c) => c.url.pathname === EVENTS_PATH && !isZone(c)).url.searchParams.get("timeZone")).toBe("UTC");
  });

  it("finds free time inside the working day from the events: free-marked, declined and cancelled ones don't count, overlaps merge", async () => {
    const { g, call } = await setup();
    const self = (responseStatus: string) => [{ self: true, responseStatus }];
    g.to("GET", EVENTS_PATH, { json: { items: [
      { status: "confirmed", start: { dateTime: "2026-10-23T10:00:00+05:30" }, end: { dateTime: "2026-10-23T11:00:00+05:30" } },
      // Overlaps the one before: 10:00-11:30 is one busy stretch.
      { status: "confirmed", start: { dateTime: "2026-10-23T10:30:00+05:30" }, end: { dateTime: "2026-10-23T11:30:00+05:30" }, attendees: self("accepted") },
      // Show me as Available.
      { status: "confirmed", transparency: "transparent", start: { dateTime: "2026-10-23T13:00:00+05:30" }, end: { dateTime: "2026-10-23T14:30:00+05:30" } },
      // They said no.
      { status: "confirmed", start: { dateTime: "2026-10-23T15:00:00+05:30" }, end: { dateTime: "2026-10-23T16:00:00+05:30" }, attendees: self("declined") },
      // Not answered yet, or maybe: still busy, as free/busy has it.
      { status: "tentative", start: { dateTime: "2026-10-23T16:30:00+05:30" }, end: { dateTime: "2026-10-23T17:00:00+05:30" }, attendees: self("needsAction") },
      { status: "cancelled", start: { dateTime: "2026-10-23T09:00:00+05:30" }, end: { dateTime: "2026-10-23T18:00:00+05:30" } },
      // An all-day event marked free (a holiday on the calendar, a working location) leaves the day open.
      { status: "confirmed", transparency: "transparent", start: { date: "2026-10-23" }, end: { date: "2026-10-24" } },
    ] } });
    const out = await call("google-calendar", "find_free_time", { from: "friday", duration_minutes: 60 });
    const req = g.only((c) => c.url.pathname === EVENTS_PATH && !isZone(c))[0]!;
    expect(req.method).toBe("GET");
    expect(Object.fromEntries(req.url.searchParams)).toEqual({
      singleEvents: "true", orderBy: "startTime", maxResults: "2500", maxAttendees: "1",
      timeMin: "2026-10-22T18:30:00.000Z", timeMax: "2026-10-23T18:30:00.000Z",
      fields: "timeZone,items(status,transparency,start,end,attendees(self,responseStatus)),nextPageToken",
    });
    expect(out.text).toBe([
      "Free for 60 minutes or more tomorrow:",
      "- Tomorrow 09:00–10:00",
      "- Tomorrow 11:30–16:30",
      "- Tomorrow 17:00–18:00",
    ].join("\n"));
  });

  it("counts an all-day event as busy all day unless it is marked free, and reads every page", async () => {
    const { g, call } = await setup();
    g.to("GET", EVENTS_PATH, { json: { items: [{ status: "confirmed", start: { date: "2026-10-23" }, end: { date: "2026-10-24" } }] } });
    expect((await call("google-calendar", "find_free_time", { from: "friday" })).text).toBe("You have no free 30-minute slot tomorrow, between 09:00 and 18:00.");

    // Busy 09:00-12:00 on the first page, 12:00-18:00 on the second: nothing free.
    g.to("GET", EVENTS_PATH, (c) => c.url.searchParams.get("pageToken") === "p2"
      ? { json: { items: [{ start: { dateTime: "2026-10-23T12:00:00+05:30" }, end: { dateTime: "2026-10-23T18:00:00+05:30" } }] } }
      : { json: { items: [{ start: { dateTime: "2026-10-23T09:00:00+05:30" }, end: { dateTime: "2026-10-23T12:00:00+05:30" } }], nextPageToken: "p2" } });
    expect((await call("google-calendar", "find_free_time", { from: "friday" })).text).toBe("You have no free 30-minute slot tomorrow, between 09:00 and 18:00.");
    const pages = g.only((c) => c.url.pathname === EVENTS_PATH && !isZone(c)).slice(-2);
    expect(pages.map((c) => c.url.searchParams.get("pageToken"))).toEqual([null, "p2"]);
  });

  it("places an all-day event on the calendar's own days when the person names another zone", async () => {
    const { g, call } = await setup();
    // A Kolkata calendar's holiday on Fri 23 Oct runs 14:30 Thursday to 14:30 Friday in New York.
    g.to("GET", EVENTS_PATH, { json: { timeZone: "Asia/Kolkata", items: [{ status: "confirmed", start: { date: "2026-10-23" }, end: { date: "2026-10-24" } }] } });
    expect((await call("google-calendar", "find_free_time", { from: "friday", timezone: "America/New_York" })).text)
      .toBe("Free for 30 minutes or more tomorrow:\n- Tomorrow 14:30–18:00");
    expect((await call("google-calendar", "find_free_time", { from: "thursday", timezone: "America/New_York" })).text)
      .toBe("Free for 30 minutes or more today:\n- Today 09:00–14:30");
    // In the calendar's own zone it is the whole of Friday, as before.
    expect((await call("google-calendar", "find_free_time", { from: "friday" })).text).toBe("You have no free 30-minute slot tomorrow, between 09:00 and 18:00.");
  });

  it("offers no free time past what it could read when Google has more pages than it reads", async () => {
    const { g, call } = await setup();
    const busyReads = () => g.only((c) => c.url.pathname === EVENTS_PATH && !isZone(c));
    // Google may send pages short, or empty, with more to come. Here the
    // busy day is on page 5, past the four read: never "free all day".
    g.to("GET", EVENTS_PATH, (c) => {
      const page = Number(c.url.searchParams.get("pageToken")?.slice(1) ?? 1);
      return page < 5
        ? { json: { timeZone: "Asia/Kolkata", items: [], nextPageToken: `p${page + 1}` } }
        : { json: { timeZone: "Asia/Kolkata", items: [{ start: { dateTime: "2026-10-23T09:00:00+05:30" }, end: { dateTime: "2026-10-23T18:00:00+05:30" } }] } };
    });
    expect((await call("google-calendar", "find_free_time", { from: "friday" })).error)
      .toEqual({ code: "rejected", message: "Your calendar has more events in that stretch than I can read at once. Try a shorter one." });
    expect(busyReads()).toHaveLength(4);

    // Events up to Saturday 12:00 read, then pages with nothing: free time
    // up to there, and the answer says where it stopped.
    g.to("GET", EVENTS_PATH, (c) => c.url.searchParams.get("pageToken")
      ? { json: { items: [], nextPageToken: "more" } }
      : { json: { timeZone: "Asia/Kolkata", nextPageToken: "more", items: [
        { start: { dateTime: "2026-10-23T10:00:00+05:30" }, end: { dateTime: "2026-10-23T11:00:00+05:30" } },
        { start: { dateTime: "2026-10-24T12:00:00+05:30" }, end: { dateTime: "2026-10-24T13:00:00+05:30" } },
      ] } });
    expect((await call("google-calendar", "find_free_time", { from: "friday", to: "sunday" })).text).toBe([
      "Free for 30 minutes or more from Tomorrow to Sunday:",
      "- Tomorrow 09:00–10:00",
      "- Tomorrow 11:00–18:00",
      "- Saturday 09:00–12:00",
      "I could read your calendar only as far as Saturday 12:00, as it has more events than I can read at once. Ask again for after that.",
    ].join("\n"));
  });

  it("decides what is busy the way free/busy does", () => {
    expect(blocksTime({})).toBe(true);
    expect(blocksTime({ status: "tentative", attendees: [{ self: true, responseStatus: "tentative" }] })).toBe(true);
    expect(blocksTime({ transparency: "opaque" })).toBe(true);
    expect(blocksTime({ transparency: "transparent" })).toBe(false);
    expect(blocksTime({ status: "cancelled" })).toBe(false);
    expect(blocksTime({ attendees: [{ self: true, responseStatus: "declined" }] })).toBe(false);
    // Someone else declining is not the person declining.
    expect(blocksTime({ attendees: [{ email: "rahul@example.com", responseStatus: "declined" }] })).toBe(true);
    expect(mergeSpans([[5, 10], [1, 3], [3, 4], [8, 12], [20, 20], [30, 25]])).toEqual([[1, 4], [5, 12]]);
  });

  it("keeps working for someone who connected before, with calendar.readonly still in their grant", async () => {
    const { g, call, use } = await setup({ calScopes: OLD_CAL_SCOPES });
    g.to("GET", EVENTS_PATH, { json: { items: [EVENT()] } });
    expect((await call("google-calendar", "list_events", { from: "saturday" })).text).toBe("1 event on Saturday:\n- Saturday 10:00–10:30, Design sync with Rahul (id: ev1)");
    expect((await call("google-calendar", "find_free_time", { from: "saturday", duration_minutes: 60 })).text)
      .toBe("Free for 60 minutes or more on Saturday:\n- Saturday 09:00–10:00\n- Saturday 10:30–18:00");
    expect(await use("google-calendar", "create_event", { title: "Solo", start: "friday 16:00" })).toMatchObject({ kind: "approval", approval: { risk: "write" } });
    expect(g.calls.filter((c) => /settings|freeBusy/i.test(c.url.pathname))).toEqual([]);
  });

  it("adds an event with no guests as a write, and none are emailed", async () => {
    const { g, call, risk } = await setup();
    g.to("POST", "/calendar/v3/calendars/primary/events", { json: { id: "new1" } });
    const args = { title: "Lunch", start: "friday 13:00", description: "Near the office" };
    expect(await risk("google-calendar", "create_event", args)).toBe("write");
    const out = await call("google-calendar", "create_event", args);
    const req = g.only((c) => c.method === "POST" && c.url.pathname.endsWith("/events"))[0]!;
    expect(req.url.searchParams.get("sendUpdates")).toBe("none");
    expect(req.body).toEqual({
      summary: "Lunch", description: "Near the office",
      start: { dateTime: "2026-10-23T13:00:00+05:30", timeZone: "Asia/Kolkata" },
      end: { dateTime: "2026-10-23T13:30:00+05:30", timeZone: "Asia/Kolkata" },
    });
    expect(out.text).toBe('Added "Lunch" for Tomorrow 13:00–13:30. (id: new1)');
  });

  it("adds an event with guests as a SEND: Google emails them", async () => {
    const { g, call, risk } = await setup();
    g.to("POST", "/calendar/v3/calendars/primary/events", { json: { id: "new2" } });
    const args = { title: "Demo", start: "2026-10-23T16:00", end: "2026-10-23T17:00", timezone: "Asia/Kolkata", attendees: ["rahul.sharma@example.com", "RAHUL.SHARMA@example.com"] };
    expect(await risk("google-calendar", "create_event", args)).toBe("send");
    const out = await call("google-calendar", "create_event", args);
    const req = g.only((c) => c.method === "POST" && c.url.pathname.endsWith("/events"))[0]!;
    expect(req.url.searchParams.get("sendUpdates")).toBe("all");
    expect(req.body.attendees).toEqual([{ email: "rahul.sharma@example.com" }]);
    expect(req.body.end.dateTime).toBe("2026-10-23T17:00:00+05:30");
    expect(out.text).toBe('Added "Demo" for Tomorrow 16:00–17:00 with Rahul Sharma. Google emailed them the invite. (id: new2)');
    expect((await call("google-calendar", "create_event", { title: "x", start: "friday 9", attendees: ["not an email"] })).error?.code).toBe("rejected");
    expect((await call("google-calendar", "create_event", { start: "friday 9" })).error?.message).toBe("What should I call the event?");
  });

  it("moves an event keeping its length, and tells the guests only when it has some", async () => {
    const { g, call, risk } = await setup();
    g.to("GET", "/calendar/v3/calendars/primary/events/ev1", { json: EVENT() });
    g.to("PATCH", "/calendar/v3/calendars/primary/events/ev1", { json: EVENT() });
    expect(await risk("google-calendar", "move_event", { event_id: "ev1", start: "monday 11:00" })).toBe("send");
    const out = await call("google-calendar", "move_event", { event_id: "ev1", start: "monday 11:00" });
    const patch = g.only((c) => c.method === "PATCH")[0]!;
    expect(patch.url.searchParams.get("sendUpdates")).toBe("all");
    expect(patch.body).toEqual({
      start: { dateTime: "2026-10-26T11:00:00+05:30", timeZone: "Asia/Kolkata" },
      end: { dateTime: "2026-10-26T11:30:00+05:30", timeZone: "Asia/Kolkata" },
    });
    expect(out.text).toBe('Moved "Design sync" to Monday 11:00–11:30. Google told Rahul.');

    g.to("GET", "/calendar/v3/calendars/primary/events/ev2", { json: EVENT({ id: "ev2", attendees: [{ email: "me@example.com", self: true }] }) });
    g.to("PATCH", "/calendar/v3/calendars/primary/events/ev2", { json: EVENT() });
    expect(await risk("google-calendar", "move_event", { event_id: "ev2", start: "monday 11:00" })).toBe("write");
    await call("google-calendar", "move_event", { event_id: "ev2", start: "monday 11:00" });
    expect(g.only((c) => c.method === "PATCH").at(-1)!.url.searchParams.get("sendUpdates")).toBe("none");
    expect((await call("google-calendar", "move_event", { event_id: "../x", start: "monday 11:00" })).error?.code).toBe("rejected");
  });

  it("deletes an event as a destructive change, telling its guests", async () => {
    const { g, call, risk } = await setup();
    g.to("GET", "/calendar/v3/calendars/primary/events/ev1", { json: EVENT() });
    g.to("DELETE", "/calendar/v3/calendars/primary/events/ev1", { empty: true });
    expect(await risk("google-calendar", "delete_event", { event_id: "ev1" })).toBe("destructive");
    const out = await call("google-calendar", "delete_event", { event_id: "ev1" });
    const del = g.only((c) => c.method === "DELETE")[0]!;
    expect(del.url.searchParams.get("sendUpdates")).toBe("all");
    expect(out.text).toBe('Deleted "Design sync" (Saturday 10:00–10:30). Google told Rahul it\'s cancelled.');
  });

  it("has the tiers: reads run, writes ask, sends ask, deletes always ask, and a lower level blocks", async () => {
    const { g, connectors, use, risk, store, user } = await setup();
    g.to("GET", "/calendar/v3/calendars/primary/events", { json: { items: [] } });
    g.to("GET", "/calendar/v3/calendars/primary/events/ev1", { json: EVENT() });
    expect(await risk("google-calendar", "list_events", {})).toBe("read");
    expect(await risk("google-calendar", "find_free_time", {})).toBe("read");
    expect(await risk("google-docs", "create_doc", {})).toBe("write");
    expect(await risk("google-docs", "save_note", {})).toBe("write");
    expect(await risk("email-handoff", "compose_email", {})).toBe("write");

    expect((await use("google-calendar", "list_events", {})).kind).toBe("result");

    const send = await use("google-calendar", "create_event", { title: "Demo", start: "friday 16:00", attendees: ["rahul@example.com"] });
    expect(send).toMatchObject({ kind: "approval", approval: { risk: "send", tool: "create_event" } });
    if (send.kind === "approval") {
      expect(send.approval.preview).toBe('Add "Demo" to Google Calendar: Tomorrow 16:00–16:30. Google will email an invite to rahul@example.com');
    }
    // Nothing was created yet.
    expect(g.only((c) => c.method === "POST")).toHaveLength(0);

    // A delete asks even when the person turned that tool on automatically.
    await store.upsertConnection(user, "google-calendar", { autoOk: ["delete_event", "create_event"] });
    const del = await use("google-calendar", "delete_event", { event_id: "ev1" });
    expect(del).toMatchObject({ kind: "approval", approval: { risk: "destructive" } });
    if (del.kind === "approval") expect(del.approval.preview).toBe('Delete "Design sync" (Saturday 10:00–10:30) from Google Calendar. Google will tell Rahul it\'s cancelled');

    // At "draft" a send is not available at all; at "look" nothing but reads.
    await store.upsertConnection(user, "google-calendar", { level: "draft", autoOk: [] });
    expect(await use("google-calendar", "create_event", { title: "Demo", start: "friday 16:00", attendees: ["rahul@example.com"] }))
      .toMatchObject({ kind: "stopped", message: expect.stringContaining("drafts only") });
    expect(await use("google-calendar", "create_event", { title: "Solo", start: "friday 16:00" })).toMatchObject({ kind: "approval", approval: { risk: "write" } });
    await store.upsertConnection(user, "google-calendar", { level: "look" });
    expect(await use("google-calendar", "create_event", { title: "Solo", start: "friday 16:00" })).toMatchObject({ kind: "stopped", message: expect.stringContaining("look only") });
    expect(connectors).toBeTruthy();
  });

  it("runs the call only after the yes, and the audit holds no words", async () => {
    const { g, connectors, use, user, store } = await setup();
    g.to("POST", "/calendar/v3/calendars/primary/events", { json: { id: "new3" } });
    const o = await use("google-calendar", "create_event", { title: "Secret launch plan", start: "friday 16:00", attendees: ["rahul@example.com"] });
    if (o.kind !== "approval") throw new Error("expected an approval");
    const done = await connectors.tasks.approve(user, o.taskId, o.approval.id);
    expect(done.status).toBe("ok");
    expect(done.result).toContain('Added "Secret launch plan"');
    expect(g.only((c) => c.method === "POST")).toHaveLength(1);
    const audit = await store.listAudit(user, o.taskId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ connectorId: "google-calendar", tool: "create_event", risk: "send", outcome: "ok" });
    expect(JSON.stringify(audit)).not.toMatch(/secret|launch|rahul/i);
  });

  it("reads what people say as times, in their zone", () => {
    const at = (s: string, tz = "Asia/Kolkata") => { const w = parseWhen(s, tz, NOW); return w ? { ...wallOf(w.ms, tz), dateOnly: w.dateOnly } : null; };
    expect(at("friday 3pm")).toMatchObject({ d: 23, h: 15, mi: 0, dateOnly: false });
    expect(at("tomorrow")).toMatchObject({ d: 23, h: 0, dateOnly: true });
    expect(at("next thursday 10:30")).toMatchObject({ d: 29, h: 10, mi: 30 });
    expect(at("thursday")).toMatchObject({ d: 22, dateOnly: true });
    expect(at("30 oct")).toMatchObject({ mo: 10, d: 30 });
    expect(at("fri 30 oct 9am")).toMatchObject({ mo: 10, d: 30, h: 9 });
    expect(at("3 jan")).toMatchObject({ y: 2027, mo: 1, d: 3 });
    expect(at("2026-12-01T09:15")).toMatchObject({ mo: 12, d: 1, h: 9, mi: 15 });
    expect(parseWhen("2026-10-23T10:00:00Z", "Asia/Kolkata", NOW)!.ms).toBe(Date.parse("2026-10-23T10:00:00Z"));
    expect(at("noon")).toMatchObject({ d: 22, h: 12 });
    for (const bad of ["", "soon", "friday 25pm", "13pm", "2026-13-40"]) expect(parseWhen(bad, "UTC", NOW), bad).toBeNull();
  });
});

// ---------------------------------------------------------------------- the docs

describe("Google Docs tools", () => {
  it("creates a Doc with drive.file's two calls, and gives its link", async () => {
    const { g, call } = await setup();
    g.to("POST", "/v1/documents", { json: { documentId: "doc123" } });
    g.to("POST", "/v1/documents/doc123:batchUpdate", { json: {} });
    const out = await call("google-docs", "create_doc", { title: "Trip plan", body: "Day 1: Jaipur\nDay 2: Agra" });
    const [create, fill] = g.only((c) => c.url.hostname === "docs.googleapis.com");
    expect(create!.body).toEqual({ title: "Trip plan" });
    expect(create!.auth).toBe("Bearer at-1");
    expect(fill!.url.pathname).toBe("/v1/documents/doc123:batchUpdate");
    expect(fill!.body).toEqual({ requests: [{ insertText: { location: { index: 1 }, text: "Day 1: Jaipur\nDay 2: Agra" } }] });
    expect(out.text).toBe('Made the Google Doc "Trip plan". https://docs.google.com/document/d/doc123/edit');
    expect((await call("google-docs", "create_doc", { title: "", body: "x" })).error?.code).toBe("rejected");
  });

  it("says so when the Doc exists but the text did not go in", async () => {
    const { g, call } = await setup();
    g.to("POST", "/v1/documents", { json: { documentId: "doc9" } });
    g.to("POST", "/v1/documents/doc9:batchUpdate", { status: 500, json: {} });
    const out = await call("google-docs", "create_doc", { title: "T", body: "x" });
    expect(out).toMatchObject({ ok: true });
    expect(out.text).toContain("couldn't put the text in");
    expect(out.text).toContain("/document/d/doc9/edit");
  });

  it("turns the latest meeting note into a Doc", async () => {
    const { g, call, use } = await setup();
    notes.length = 0;
    notes.push(note());
    g.to("POST", "/v1/documents", { json: { documentId: "doc7" } });
    g.to("POST", "/v1/documents/doc7:batchUpdate", { json: {} });
    const out = await call("google-docs", "save_note", {});
    const [create, fill] = g.only((c) => c.url.hostname === "docs.googleapis.com");
    expect(create!.body).toEqual({ title: "Launch sync" });
    expect(fill!.body.requests[0].insertText.text).toBe([
      "2026-10-21 · 25 min", "People: Priya, You", "", "Summary", "We agreed to ship on Friday.", "", "Key points", "• Priya: Ship Friday.",
    ].join("\n"));
    expect(out.text).toContain("/document/d/doc7/edit");
    const asked = await use("google-docs", "save_note", {});
    expect(asked).toMatchObject({ kind: "approval", approval: { risk: "write", preview: 'Save the note "Launch sync" as a new Google Doc' } });
    notes.length = 0;
    expect((await call("google-docs", "save_note", {})).error?.message).toBe("You don't have a note to save yet.");
  });

  it("falls back to the transcript for a note nobody organised", () => {
    const t = noteText(note({ summary: "", highlights: [], title: "", people: [], transcript: [{ at: 0, text: "Hello there", speaker: "You" }, { at: 3, text: "Hi" }] }));
    expect(t.title).toBe("Meeting note");
    expect(t.body).toContain("What was said\nYou: Hello there\nHi");
  });
});

// ------------------------------------------------------------------ the hand-off

describe("the email hand-off", () => {
  const body = "Hi Rahul,\nLet's meet at 4 & talk #1 = ready?\n— Priya";
  const subject = "Demo: 4pm & more";

  it("encodes every part, so nothing in the email can add a field", () => {
    const l = handoffLinks(["rahul@example.com"], "Hello", "Hi Rahul");
    expect(l.gmail).toBe("https://mail.google.com/mail/?view=cm&fs=1&to=rahul%40example.com&su=Hello&body=Hi%20Rahul");
    expect(l.mailto).toBe("mailto:rahul%40example.com?subject=Hello&body=Hi%20Rahul");
    const tricky = handoffLinks(["a@example.com", "b@example.com"], subject, body);
    const u = new URL(tricky.gmail);
    expect(u.origin + u.pathname).toBe("https://mail.google.com/mail/");
    expect([...u.searchParams.keys()]).toEqual(["view", "fs", "to", "su", "body"]);
    expect(u.searchParams.get("to")).toBe("a@example.com,b@example.com");
    expect(u.searchParams.get("su")).toBe(subject);
    expect(u.searchParams.get("body")).toBe(body);
    expect(tricky.gmail).not.toMatch(/[\s\n#]/);
    expect(tricky.gmail.split("&")).toHaveLength(5);
    const m = new URL(tricky.mailto);
    expect(m.protocol).toBe("mailto:");
    expect(m.searchParams.get("subject")).toBe(subject);
    expect(m.searchParams.get("body")).toBe(body);
  });

  it("returns the links without sending anything, and checks the recipients", async () => {
    const { g, call } = await setup({ connect: [] });
    const out = await call("email-handoff", "compose_email", { to: "rahul@example.com", subject, body });
    expect(out.ok).toBe(true);
    expect(out.open!.url).toBe(handoffLinks(["rahul@example.com"], subject, body).gmail);
    expect(out.open!.fallback).toBe(handoffLinks(["rahul@example.com"], subject, body).mailto);
    expect(out.text).toContain("Nothing is sent until they press Send");
    expect(g.calls.filter((c) => c.url.hostname !== "www.googleapis.com")).toHaveLength(0);
    // No address: Gmail opens with To empty for them to fill in, and no mailto: fallback.
    const noTo = await call("email-handoff", "compose_email", { to: "", subject, body });
    expect(noTo.open?.url).toMatch(/^https:\/\/mail\.google\.com\/mail\/\?view=cm&fs=1&to=&su=/);
    expect(noTo.open?.fallback).toBeUndefined();
    expect((await call("email-handoff", "compose_email", { to: "rahul", subject, body })).error?.code).toBe("rejected");
    expect((await call("email-handoff", "compose_email", { to: "a@example.com", subject, body: "x".repeat(3001) })).error?.code).toBe("rejected");
    // A subject is one line.
    const one = await call("email-handoff", "compose_email", { to: "a@example.com", subject: "Hi\r\nBcc: x@evil.com", body: "x" });
    expect(new URL(one.open!.url).searchParams.get("su")).toBe("Hi Bcc: x@evil.com");
  });

  it("needs no connection, and ends a run with the line, the link and done", async () => {
    const { connectors, store, user } = await setup({ connect: [] });
    expect(await store.listConnections(user)).toEqual([]);
    const run = async (language?: string, mode = "send an email to rahul@example.com that the demo moved to 4pm") => {
      const lines: string[] = [];
      const sink = new EventSink((l) => lines.push(l));
      const planner: string[] = [];
      await runStep(
        { req: { runId: "run_mail1", step: 0, platform: "mac", app: "Safari", screen: { elements: [] }, utterance: mode, ...(language ? { language } : {}) } as any, maxSteps: 8 },
        {
          write: async () => "", rewrite: async () => "",
          plan: (_s, user) => { planner.push(typeof user === "string" ? user : ""); return (async function* () {
            yield { model: "m", delta: 'USE email-handoff.compose_email {"to":"rahul@example.com","subject":"Demo moved","body":"The demo moved to 4pm."}\n' };
          })(); },
          connectors: connectors.runtimeFor(user),
        },
        sink,
      );
      return { events: lines.map((l) => JSON.parse(l)), planner };
    };
    const r = await run();
    expect(r.planner[0]).toContain("email-handoff.compose_email");
    expect(r.events.map((e) => e.t)).toEqual(["heard", "say", "open", "done"]);
    expect(r.events[1].text).toBe("I've written it in Gmail. Check it and hit Send.");
    expect(r.events[2]).toEqual({
      t: "open", label: "Open in Gmail",
      url: "https://mail.google.com/mail/?view=cm&fs=1&to=rahul%40example.com&su=Demo%20moved&body=The%20demo%20moved%20to%204pm.",
      fallback: "mailto:rahul%40example.com?subject=Demo%20moved&body=The%20demo%20moved%20to%204pm.",
    });
    // Same line in Hinglish for a Hinglish device.
    const hg = await run("hinglish");
    expect(hg.events[1].text).toBe(HG["mail.done"]);
    expect(hg.events[2].label).toBe(HG["mail.open"]);
    // It is audited, with no words from the email.
    const tasks = await store.listTasks(user, 10);
    const audit = await store.listAudit(user, tasks[0]!.id);
    expect(audit[0]).toMatchObject({ connectorId: "email-handoff", tool: "compose_email", risk: "write", outcome: "ok" });
    expect(JSON.stringify(audit)).not.toMatch(/rahul|demo|4pm/i);
  });

  it("has its line in both voices", () => {
    expect(EN["mail.done"]).toBe("I've written it in Gmail. Check it and hit Send.");
    expect(wordsFor("hinglish")("mail.done")).toBe("Maine Gmail mein likh diya hai. Check karo aur Send dabao.");
    expect(wordsFor("de")("mail.done")).toBe(EN["mail.done"]);
  });
});

beforeEach(() => { notes.length = 0; });
