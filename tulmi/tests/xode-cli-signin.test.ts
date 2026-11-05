import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { ActionSpec, Node } from "../../shared/types/sdui.js";

// Xode in the terminal: its own sign-in (auth/deviceTokens.ts, auth/deviceLink.ts kind "cli", routes/account/devices.ts,
// http/deviceScope.ts, screens/link.ts, screens/you/devicesPage.ts, routes/site/devicePage.ts). Fakes only: no real token anywhere.
process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.STT_PROVIDER = "groq";
process.env.NODE_ENV = "test";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.BOTS_APP = "true";
process.env.DEV_SKIP_AUTH = "false";
process.env.SUPABASE_URL = "http://127.0.0.1:1";
process.env.SUPABASE_ANON_KEY = "anon";
process.env.STATIC_BEARER_TOKENS = "test-static-token-0123456789";
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.DEVICE_PAGE_ORIGIN;

const { createDeviceLinks, memoryLinkStore, LINK_TTL_MS, EXCHANGE_GRACE_MS } = await import("../src/auth/deviceLink.js");
const { createDeviceTokens, memoryDeviceTokenStore, useDeviceTokens, DEVICE_TOKEN_RE, CACHE_MS, TOUCH_MS, isDeviceBearer } = await import("../src/auth/deviceTokens.js");
const { resolveUser } = await import("../src/auth/supabase.js");
const { registerDeviceLinkRoutes } = await import("../src/routes/account/deviceLink.js");
const { registerDeviceRoutes } = await import("../src/routes/account/devices.js");
const { registerDeviceScope, inDeviceScope } = await import("../src/http/deviceScope.js");
const { registerDevicePageRoutes } = await import("../src/routes/site/devicePage.js");
const { fastifyLoggerOptions, logUrl } = await import("../src/observability.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST, FIXED_NOW } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");

const AANYA = { id: "11111111-1111-4111-8111-111111111111", email: "aanya@example.in" };
const RAVI = { id: "22222222-2222-4222-8222-222222222222", email: "ravi@example.in" };
/** An account with a phone number only: it cannot approve a window, but it can approve a terminal. */
const PHONE_ONLY = { id: "33333333-3333-4333-8333-333333333333" };

function service() {
  const clock = { now: 1_800_000_000_000 };
  const tokenStore = memoryDeviceTokenStore();
  const tokens = createDeviceTokens({ store: tokenStore, now: () => clock.now, account: async (id) => (id === AANYA.id ? { email: AANYA.email, providerName: "Aanya Rao" } : {}) });
  const store = memoryLinkStore();
  const minted: string[] = [];
  const links = createDeviceLinks({
    store, now: () => clock.now,
    mint: async (id) => { minted.push(id); return { tokenHash: `hash-for-${id}`, type: "magiclink" }; },
    issue: (userId, d) => tokens.issue({ userId, ...d }),
  });
  return { links, store, tokens, tokenStore, clock, minted };
}

describe("a terminal's sign-in request", () => {
  it("create → view (kind cli) → approve → the poll gets its own token, once", async () => {
    const { links, tokens, tokenStore, minted } = service();
    const r = await links.create({ kind: "cli", deviceName: "Aanya's MacBook Air", platform: "mac" });
    expect(await links.view({ code: r.code })).toMatchObject({ kind: "cli", deviceName: "Aanya's MacBook Air", platform: "mac", status: "pending" });
    expect(await links.poll(r.token, r.secret, 0)).toMatchObject({ status: "pending" });
    // An account with no address can approve a terminal (the address only matters for a window's session).
    expect(await links.decide({ code: r.code }, PHONE_ONLY, true)).toEqual({ ok: true, deviceName: "Aanya's MacBook Air" });
    const got = await links.poll(r.token, r.secret, 0);
    expect(got).toMatchObject({ status: "approved", deviceToken: expect.stringMatching(DEVICE_TOKEN_RE), deviceId: expect.any(String) });
    expect(minted).toEqual([]);
    expect(await links.poll(r.token, r.secret, 0)).toEqual({ status: "used" });
    // Only the hash is kept.
    const token = (got as { deviceToken: string }).deviceToken;
    expect(JSON.stringify([...tokenStore.rows.values()])).not.toContain(token);
    expect(await tokens.user(token)).toMatchObject({ id: PHONE_ONLY.id, deviceId: (got as { deviceId: string }).deviceId });
    expect(await tokens.list(PHONE_ONLY.id)).toEqual([expect.objectContaining({ name: "Aanya's MacBook Air", platform: "mac", kind: "cli" })]);
  });

  it("a window's request is as before: kind app, the address rule, a session", async () => {
    const { links, minted } = service();
    const r = await links.create({ deviceName: "Office PC", platform: "windows" });
    expect((await links.view({ token: r.token }))?.kind).toBe("app");
    expect(await links.decide({ token: r.token }, PHONE_ONLY, true)).toEqual({ ok: false, error: "no_email" });
    await links.decide({ token: r.token }, AANYA, true);
    expect(await links.poll(r.token, r.secret, 0)).toEqual({ status: "approved", tokenHash: `hash-for-${AANYA.id}`, type: "magiclink" });
    expect(minted).toEqual([AANYA.id]);
  });

  it("a wrong code finds nothing", async () => {
    const { links } = service();
    await links.create({ kind: "cli" });
    expect(await links.view({ code: "ZZZZ-ZZZZ" })).toBeNull();
    expect(await links.decide({ code: "ZZZZ-ZZZZ" }, AANYA, true)).toEqual({ ok: false, error: "not_found" });
  });

  it("runs out: pending past its time, or approved and not taken within the grace", async () => {
    const { links, clock } = service();
    const r = await links.create({ kind: "cli" });
    clock.now += LINK_TTL_MS;
    expect(await links.poll(r.token, r.secret, 0)).toEqual({ status: "expired" });
    const late = await links.create({ kind: "cli" });
    await links.decide({ token: late.token }, AANYA, true);
    clock.now += LINK_TTL_MS + EXCHANGE_GRACE_MS;
    expect(await links.poll(late.token, late.secret, 0)).toEqual({ status: "expired" });
  });

  it("Not me: the terminal is told denied, and no token is made", async () => {
    const { links, tokenStore } = service();
    const r = await links.create({ kind: "cli" });
    await links.decide({ code: r.code }, AANYA, false);
    expect(await links.poll(r.token, r.secret, 0)).toEqual({ status: "denied" });
    expect(tokenStore.rows.size).toBe(0);
  });

  it("with no way to make a token, approved reads failed", async () => {
    const store = memoryLinkStore();
    const links = createDeviceLinks({ store, mint: async () => ({ error: "failed" }) });
    const r = await links.create({ kind: "cli" });
    await links.decide({ token: r.token }, AANYA, true);
    expect(await links.poll(r.token, r.secret, 0)).toEqual({ status: "failed" });
  });
});

describe("the token", () => {
  it("is cached a minute, last used written at most every ten, and a removed one fails at once here", async () => {
    const { tokens, tokenStore, clock } = service();
    const { token, id } = await tokens.issue({ userId: AANYA.id, name: "build-box", platform: "linux" });
    const reads = vi.spyOn(tokenStore, "byHash");
    const touches = vi.spyOn(tokenStore, "touch");
    expect(await tokens.user(token)).toMatchObject({ id: AANYA.id, deviceId: id, email: AANYA.email });
    expect(await tokens.user(token)).toMatchObject({ id: AANYA.id });
    expect(reads).toHaveBeenCalledTimes(1);
    expect(touches).toHaveBeenCalledTimes(1);
    clock.now += CACHE_MS;
    await tokens.user(token);
    expect(reads).toHaveBeenCalledTimes(2);
    expect(touches).toHaveBeenCalledTimes(1);
    clock.now += TOUCH_MS;
    await tokens.user(token);
    expect(touches).toHaveBeenCalledTimes(2);
    expect(await tokens.revoke(RAVI.id, id)).toBe(false);
    expect(await tokens.revoke(AANYA.id, id)).toBe(true);
    expect(await tokens.user(token)).toBeNull();
    expect(await tokens.list(AANYA.id)).toEqual([]);
  });

  it("anything not of its shape is nobody", async () => {
    const { tokens } = service();
    expect(await tokens.user("xdt_short")).toBeNull();
    expect(await tokens.user(`xdt_${"A".repeat(43)}`)).toBeNull();
    expect(isDeviceBearer(`Bearer xdt_${"A".repeat(43)}`)).toBe(true);
    expect(isDeviceBearer("Bearer eyJhbGci")).toBe(false);
  });

  it("the scope: Xode's routes only", () => {
    for (const p of ["/v1/code/jobs", "/v1/code/runner/ticket", "/v1/bots/code/merge", "/v1/auth/device", "/v1/auth/device/revoke", "/v1/rooms/x/watch", "/v1/code/jobs/:id/live"]) {
      expect(inDeviceScope(p)).toBe(true);
    }
    for (const p of ["/v1/you", "/v1/auth/devices", "/v1/auth/devices/:id", "/v1/auth/link/approve", "/v1/code", "/v1/codex/x", "/v1/live", "/v1/bots/plan"]) {
      expect(inDeviceScope(p)).toBe(false);
    }
  });
});

// ===================================================================== the routes, with every log line kept

describe("the routes", () => {
  const lines: string[] = [];
  let app: FastifyInstance;
  let s: ReturnType<typeof service>;
  const who: Record<string, { id: string; email?: string }> = { "Bearer aanya": AANYA, "Bearer ravi": RAVI, "Bearer phone-only": PHONE_ONLY };
  const resolve = async (h: string | undefined) => {
    if (h && who[h]) return who[h]!;
    const t = h?.replace(/^Bearer\s+/i, "") ?? "";
    return t.startsWith("xdt_") ? s.tokens.user(t) : null;
  };
  const logged: unknown[] = [];

  beforeAll(async () => {
    s = service();
    app = Fastify({ logger: { ...fastifyLoggerOptions(), level: "trace", stream: { write: (l: string) => { lines.push(l); } } } });
    for (const m of ["trace", "debug", "info", "warn", "error", "fatal"] as const) {
      const orig = app.log[m].bind(app.log);
      vi.spyOn(app.log, m).mockImplementation(((...a: unknown[]) => { logged.push(a); return (orig as (...x: unknown[]) => void)(...a); }) as never);
    }
    registerDeviceScope(app);
    registerDeviceLinkRoutes(app, { links: s.links, limits: false, resolve });
    registerDeviceRoutes(app, { tokens: s.tokens, limits: false, resolve, nameOf: async () => undefined });
    app.get("/v1/you", async () => ({ you: true }));
    app.get("/v1/code/projects", async (req) => ({ who: (await resolve(req.headers.authorization))?.id ?? null }));
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  const post = (url: string, payload: unknown, auth?: string) =>
    app.inject({ method: "POST", url, payload: payload as Record<string, unknown>, headers: auth ? { authorization: auth } : {} });
  const get = (url: string, auth?: string) => app.inject({ method: "GET", url, headers: auth ? { authorization: auth } : {} });

  async function signIn(approver = "Bearer aanya", name = "Aanya's MacBook Air") {
    const made = (await post("/v1/auth/link", { kind: "cli", deviceName: name, platform: "mac" })).json();
    expect((await post("/v1/auth/link/approve", { code: made.code }, approver)).statusCode).toBe(200);
    const got = (await post("/v1/auth/link/poll", { token: made.token, secret: made.secret })).json();
    return got as { status: string; deviceToken: string; deviceId: string };
  }

  it("create gives the page's links; a window's create does not", async () => {
    const b = (await post("/v1/auth/link", { kind: "cli", deviceName: "Aanya's MacBook Air", platform: "mac" })).json();
    expect(b).toMatchObject({ token: expect.any(String), secret: expect.any(String), code: expect.stringMatching(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/), url: expect.any(String), expiresAt: expect.any(Number), ttlMs: 300_000, pollMs: expect.any(Number) });
    expect(b.deviceUrl).toBe("https://x0bot.com/device");
    expect(b.deviceUrlWithCode).toBe(`https://x0bot.com/device?c=${b.code.replace("-", "")}`);
    const view = (await post("/v1/auth/link/view", { code: b.code }, "Bearer phone-only")).json();
    expect(view).toMatchObject({ kind: "cli", canApprove: true });
    const app0 = (await post("/v1/auth/link", { deviceName: "Office PC" })).json();
    expect(app0.deviceUrl).toBeUndefined();
    expect(app0.deviceUrlWithCode).toBeUndefined();
    expect((await post("/v1/auth/link/view", { token: app0.token }, "Bearer phone-only")).json()).toMatchObject({ kind: "app", canApprove: false });
  });

  it("wrong code: view and approve answer not_found", async () => {
    expect((await post("/v1/auth/link/view", { code: "ZZZZ-ZZZZ" }, "Bearer aanya")).json()).toEqual({ code: "not_found" });
    const r = await post("/v1/auth/link/approve", { code: "ZZZZ-ZZZZ" }, "Bearer aanya");
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ code: "not_found" });
  });

  it("the token once, then: whoami, Xode's routes yes, everything else 403 device_scope, sign out", async () => {
    const made = (await post("/v1/auth/link", { kind: "cli", deviceName: "Aanya's MacBook Air", platform: "mac" })).json();
    await post("/v1/auth/link/approve", { code: made.code }, "Bearer aanya");
    const got = (await post("/v1/auth/link/poll", { token: made.token, secret: made.secret, wait: 0 })).json();
    expect(got).toEqual({ status: "approved", deviceToken: expect.stringMatching(DEVICE_TOKEN_RE), deviceId: expect.any(String) });
    expect((await post("/v1/auth/link/poll", { token: made.token, secret: made.secret })).json()).toEqual({ status: "used" });
    const bearer = `Bearer ${got.deviceToken}`;

    const me = await get("/v1/auth/device", bearer);
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ id: got.deviceId, name: "Aanya's MacBook Air", platform: "mac", createdAt: expect.any(Number), lastUsedAt: expect.any(Number), user: { id: AANYA.id, email: AANYA.email, name: "Aanya Rao" } });
    expect((await get("/v1/code/projects", bearer)).json()).toEqual({ who: AANYA.id });
    for (const url of ["/v1/you", "/v1/auth/devices"]) {
      const r = await get(url, bearer);
      expect(r.statusCode).toBe(403);
      expect(r.json()).toEqual({ code: "device_scope", message: "This sign-in is only for Xode in the terminal." });
    }
    expect((await post("/v1/auth/link/approve", { code: "ABCD-EFGH" }, bearer)).json().code).toBe("device_scope");
    // An ordinary session is not a terminal.
    expect((await get("/v1/auth/device", "Bearer aanya")).json().code).toBe("not_device");

    expect((await post("/v1/auth/device/revoke", {}, bearer)).json()).toEqual({ ok: true });
    expect((await get("/v1/auth/device", bearer)).statusCode).toBe(401);
    expect((await get("/v1/code/projects", bearer)).json()).toEqual({ who: null });
  });

  it("the person's list, and removing one: theirs only", async () => {
    const a = await signIn("Bearer ravi", "Ravi's ThinkPad");
    const b = await signIn("Bearer ravi", "build-box");
    const list = (await get("/v1/auth/devices", "Bearer ravi")).json();
    expect(list.devices.map((d: { name: string }) => d.name)).toEqual(expect.arrayContaining(["Ravi's ThinkPad", "build-box"]));
    expect(list.devices[0]).toEqual({ id: expect.any(String), name: expect.any(String), platform: "mac", kind: "cli", createdAt: expect.any(Number), lastUsedAt: null });
    // Someone else's: 404, and it keeps working.
    expect((await app.inject({ method: "DELETE", url: `/v1/auth/devices/${a.deviceId}`, headers: { authorization: "Bearer aanya" } })).statusCode).toBe(404);
    expect((await get("/v1/auth/device", `Bearer ${a.deviceToken}`)).statusCode).toBe(200);
    const del = await app.inject({ method: "DELETE", url: `/v1/auth/devices/${a.deviceId}`, headers: { authorization: "Bearer ravi" } });
    expect(del.json()).toEqual({ ok: true });
    expect((await get("/v1/auth/device", `Bearer ${a.deviceToken}`)).statusCode).toBe(401);
    expect((await app.inject({ method: "DELETE", url: `/v1/auth/devices/${a.deviceId}`, headers: { authorization: "Bearer ravi" } })).statusCode).toBe(404);
    expect((await get("/v1/auth/devices", "Bearer ravi")).json().devices.map((d: { id: string }) => d.id)).toEqual([b.deviceId]);
    expect((await get("/v1/auth/devices")).statusCode).toBe(401);
  });

  it("no token, and no hash of one, is ever in a log line", async () => {
    const got = await signIn();
    await get("/v1/auth/device", `Bearer ${got.deviceToken}`);
    await get("/v1/you", `Bearer ${got.deviceToken}`);
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(got.deviceToken).digest("hex");
    const all = lines.join("\n") + JSON.stringify(logged);
    expect(lines.length).toBeGreaterThan(10);
    expect(all).not.toContain(got.deviceToken);
    expect(all).not.toContain(got.deviceToken.slice(4));
    expect(all).not.toContain(hash);
  });
});

// ===================================================================== through the whole server

describe("through resolveUser and the server", () => {
  it("signs in at /v1/code/…, and is 403 device_scope at /v1/you", async () => {
    const tokens = createDeviceTokens({ store: memoryDeviceTokenStore() });
    useDeviceTokens(tokens);
    const { buildApp } = await import("../src/server.js");
    const app = await buildApp();
    try {
      const { token, id } = await tokens.issue({ userId: AANYA.id, name: "Aanya's MacBook Air", platform: "mac" });
      expect(await resolveUser(`Bearer ${token}`)).toMatchObject({ id: AANYA.id, deviceId: id });
      expect(await resolveUser(`Bearer xdt_${"Q".repeat(43)}`)).toBeNull();
      const you = await app.inject({ method: "GET", url: "/v1/you", headers: { authorization: `Bearer ${token}` } });
      expect(you.statusCode).toBe(403);
      expect(you.json().code).toBe("device_scope");
      // Odd spellings of a path in scope do not reach another route.
      expect((await app.inject({ method: "GET", url: "/v1/code/../you", headers: { authorization: `Bearer ${token}` } })).statusCode).not.toBe(200);
      const ticket = await app.inject({ method: "POST", url: "/v1/code/runner/ticket", payload: { deviceId: "terminal-1234" }, headers: { authorization: `Bearer ${token}` } });
      expect(ticket.json().code).not.toBe("device_scope");
      expect(ticket.statusCode).not.toBe(401);
      const me = await app.inject({ method: "GET", url: "/v1/auth/device", headers: { authorization: `Bearer ${token}` } });
      expect(me.json()).toMatchObject({ id, name: "Aanya's MacBook Air", platform: "mac" });
      // The person's routes are not the terminal's.
      expect((await app.inject({ method: "GET", url: "/v1/auth/devices", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403);
      // With an ordinary sign-in (a static token here), the list answers.
      const list = await app.inject({ method: "GET", url: "/v1/auth/devices", headers: { authorization: "Bearer test-static-token-0123456789" } });
      expect(list.json()).toEqual({ devices: [] });
      // Signed out from the terminal: gone at once.
      expect((await app.inject({ method: "POST", url: "/v1/auth/device/revoke", headers: { authorization: `Bearer ${token}` } })).json()).toEqual({ ok: true });
      expect(await resolveUser(`Bearer ${token}`)).toBeNull();
    } finally {
      useDeviceTokens(null);
      await app.close();
    }
  }, 60_000);
});

// ===================================================================== the screens

const texts = (n: Node): string[] => walk(n).filter((x) => x.type === "Text").map((x) => String(x.props?.content));
function actions(n: unknown, out: ActionSpec[] = []): ActionSpec[] {
  if (Array.isArray(n)) { n.forEach((x) => actions(x, out)); return out; }
  if (!n || typeof n !== "object") return out;
  const o = n as Record<string, unknown>;
  if (typeof o.kind === "string") out.push(o as unknown as ActionSpec);
  for (const v of Object.values(o)) if (v && typeof v === "object") actions(v, out);
  return out;
}
const build = (screenId: string, client: "phone" | "desktop", params?: Record<string, string>, api: Record<string, unknown> = {}) =>
  buildBotsScreen({
    screenId, client, params, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya", email: "aanya@example.in" },
    can: new Set(["BotsKit"]), desk: { pages: false, notes: false },
  }, fakeDeps({ api }));

const CLI_VIEW = { kind: "cli", deviceName: "Aanya's MacBook Air", platform: "mac", status: "pending", createdAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, canApprove: true, account: "aanya@example.in" };

describe("bots.link for a terminal", () => {
  for (const client of ["phone", "desktop"] as const) {
    it(`says plainly what is approved (${client})`, async () => {
      const s = await build("bots.link", client, { c: "K7Q4-2MXP" }, { "POST /v1/auth/link/view": CLI_VIEW });
      expect(lintTree(s.root!)).toEqual([]);
      const t = texts(s.root!);
      expect(t).toEqual(expect.arrayContaining([
        "Xode in the terminal on Aanya's MacBook Air",
        "It can work on your projects from that terminal. You can remove it any time in Settings.",
        "Approve", "Not me",
      ]));
      const writes = actions(s.root).filter((a) => a.kind === "callEndpoint") as Array<{ path: string; body?: unknown }>;
      expect(writes.map((w) => w.path).sort()).toEqual(["/v1/auth/link/approve", "/v1/auth/link/deny"]);
      for (const w of writes) expect(w.body).toEqual({ code: "K7Q4-2MXP" });
    });
  }

  it("a terminal's code that ran out says to run xode login again", async () => {
    const s = await build("bots.link", "phone", { c: "K7Q4-2MXP" }, { "POST /v1/auth/link/view": { ...CLI_VIEW, status: "expired" } });
    expect(texts(s.root!)).toContain("Codes last 5 minutes. Run xode login again for a new one.");
  });

  it("the window takes a terminal's code when there is none", async () => {
    const s = await build("bots.link", "desktop");
    expect(texts(s.root!)).toContain("Signing in Xode in a terminal? Type its code");
    expect(walk(s.root!).some((n) => n.type === "TextField" && n.bind?.value === "code")).toBe(true);
  });
});

describe("bots.devices", () => {
  const DEVICES = {
    devices: [
      { id: "5f0c1a2b-0000-4000-8000-000000000001", name: "Aanya's MacBook Air", platform: "mac", kind: "cli", createdAt: FIXED_NOW - 3 * 86_400_000, lastUsedAt: FIXED_NOW - 20 * 60_000 },
      { id: "5f0c1a2b-0000-4000-8000-000000000002", name: "build-box", platform: "linux", kind: "cli", createdAt: FIXED_NOW - 12 * 86_400_000, lastUsedAt: null },
    ],
  };
  for (const client of ["phone", "desktop"] as const) {
    it(`lists each with Remove, which asks first (${client})`, async () => {
      const s = await build("bots.devices", client, undefined, { "GET /v1/auth/devices": DEVICES });
      expect(lintTree(s.root!)).toEqual([]);
      const t = texts(s.root!);
      expect(t).toEqual(expect.arrayContaining(["Terminal sign-ins", "Aanya's MacBook Air", "build-box", "Remove Aanya's MacBook Air?"]));
      expect(t.some((x) => x.startsWith("Mac · added ") && x.endsWith("Last used 20 min ago"))).toBe(true);
      expect(t.some((x) => x.startsWith("Linux · added ") && x.endsWith("Not used yet"))).toBe(true);
      const deletes = actions(s.root).filter((a) => a.kind === "callEndpoint") as Array<{ method: string; path: string; onSuccess?: unknown }>;
      expect(deletes.map((d) => `${d.method} ${d.path}`)).toEqual(DEVICES.devices.map((d) => `DELETE /v1/auth/devices/${d.id}`));
      expect(JSON.stringify(deletes[0]!.onSuccess)).toContain("refresh");
      // The confirm shows only for the one asked about.
      const ask = walk(s.root!).find((n) => n.visibleIf && JSON.stringify(n.visibleIf) === JSON.stringify({ eq: ["remove", DEVICES.devices[0]!.id] }));
      expect(ask).toBeTruthy();
    });
  }

  it("with none, says how to add one", async () => {
    const s = await build("bots.devices", "phone", undefined, { "GET /v1/auth/devices": { devices: [] } });
    expect(texts(s.root!)).toEqual(expect.arrayContaining(["No terminal sign-ins", "Run npx @x0bot/xode login in a project folder."]));
  });

  it("Settings opens it, on the phone and in the window", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const s = await build("bots.settings", client);
      expect(texts(s.root!)).toContain("Terminal sign-ins");
      expect(actions(s.root).some((a) => a.kind === "navigate" && (a as { screenId?: string }).screenId === "bots.devices")).toBe(true);
    }
  });
});

// ===================================================================== the page

describe("GET /device", () => {
  async function page(url: string) {
    const app = Fastify();
    registerDevicePageRoutes(app);
    const r = await app.inject({ method: "GET", url });
    await app.close();
    return r;
  }

  it("with a code: shows it, and a button to the approval screen", async () => {
    const r = await page("/device?c=k7q42mxp");
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(r.headers["referrer-policy"]).toBe("no-referrer");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.body).toContain("Sign in to Xode in the terminal");
    expect(r.body).toContain("Open X0 Bot on your phone or computer to approve it.");
    expect(r.body).toContain("K7Q4-2MXP");
    expect(r.body).toContain(`href="https://app.x0bot.com/s/bots.link?c=K7Q42MXP"`);
    expect(r.body).not.toMatch(/<script(?![^>]*application\/ld\+json)/);
  });

  it("without one: a field to type it; a wrong one is said so, and never echoed", async () => {
    const none = await page("/device");
    expect(none.body).toContain(`name="c"`);
    expect(none.body).not.toContain("bots.link?c=");
    const bad = await page(`/device?c=${encodeURIComponent('"><script>alert(1)</script>')}`);
    expect(bad.body).toContain("That doesn't look like a code.");
    expect(bad.body).not.toContain("alert");
    expect(logUrl("/device?c=K7Q42MXP")).toBe("/device");
  });

  it("the QR's browser page takes a typed code too", async () => {
    const app = Fastify();
    registerDeviceLinkRoutes(app, { links: service().links, limits: false });
    const r = await app.inject({ method: "GET", url: "/s/bots.link?c=K7Q4-2MXP" });
    expect(r.body).toContain(`href="tulmi://screen/bots.link?c=K7Q42MXP"`);
    await app.close();
  });
});

describe("on a local server with no database", () => {
  it("the terminal's sign-in works from memory under DEV_SKIP_AUTH, and stays off without it", async () => {
    const { defaultDeviceLinks } = await import("../src/auth/deviceLink.js");
    const { resetConfigForTests } = await import("../src/config.js");
    const before = process.env.DEV_SKIP_AUTH;
    try {
      process.env.DEV_SKIP_AUTH = "false"; resetConfigForTests();
      expect(defaultDeviceLinks()).toBeNull();
      process.env.DEV_SKIP_AUTH = "true"; resetConfigForTests();
      const links = defaultDeviceLinks()!;
      expect(links).toBeTruthy();
      const made = await links.create({ kind: "cli", deviceName: "laptop", platform: "linux" } as never);
      expect(await links.decide({ token: made.token }, { id: AANYA.id }, true)).toMatchObject({ ok: true });
      const got = await links.poll(made.token, made.secret, 0);
      expect(got).toMatchObject({ status: "approved" });
      expect(DEVICE_TOKEN_RE.test((got as { deviceToken: string }).deviceToken)).toBe(true);
    } finally {
      if (before === undefined) delete process.env.DEV_SKIP_AUTH; else process.env.DEV_SKIP_AUTH = before;
      resetConfigForTests();
    }
  });
});

describe("Xode's own inner calls", () => {
  it("pass the scope only with this process's mark; a forged mark is refused", async () => {
    const { INNER_MARK, innerMark, registerDeviceScope: reg } = await import("../src/http/deviceScope.js");
    const app = Fastify();
    reg(app);
    app.post("/v1/artifacts/:id/build", async () => ({ ok: true }));
    await app.ready();
    const bearer = { authorization: `Bearer xdt_${"a".repeat(43)}` };
    const at = (headers: Record<string, string>) => app.inject({ method: "POST", url: "/v1/artifacts/x/build", headers, payload: {} });
    expect((await at(bearer)).statusCode).toBe(403);
    expect((await at({ ...bearer, [INNER_MARK]: "f".repeat(64) })).statusCode).toBe(403);
    expect((await at({ ...bearer, [INNER_MARK]: innerMark() })).statusCode).toBe(200);
    await app.close();
  });
});
