import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { ActionSpec, Node } from "../../shared/types/sdui.js";

// Signing in on a computer with the phone (auth/deviceLink.ts, routes/deviceLink.ts, screens/link.ts): the window's QR,
// approved on the phone, exchanged once for the window's own session.
process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.STT_PROVIDER = "groq";
process.env.NODE_ENV = "test";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.BOTS_APP = "true";

const {
  createDeviceLinks, memoryLinkStore, normalizeCode, showCode, cleanDeviceName, hashOf, LINK_TTL_MS, EXCHANGE_GRACE_MS, TOKEN_RE,
} = await import("../src/auth/deviceLink.js");
const { registerDeviceLinkRoutes, linkUrl } = await import("../src/routes/deviceLink.js");
const { logUrl } = await import("../src/observability.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { botsAuthTree } = await import("../src/experience/bots/screens/firstRun.js");

const AANYA = { id: "11111111-1111-4111-8111-111111111111", email: "aanya@example.in" };
const RAVI = { id: "22222222-2222-4222-8222-222222222222", email: "ravi@example.in" };

function service(o: { mint?: (id: string) => Promise<{ tokenHash: string; type: string } | { error: "no_email" | "failed" }> } = {}) {
  const clock = { now: 1_800_000_000_000 };
  const store = memoryLinkStore();
  const minted: string[] = [];
  const links = createDeviceLinks({
    store, now: () => clock.now,
    mint: o.mint ?? (async (id) => { minted.push(id); return { tokenHash: `hash-for-${id}`, type: "magiclink" }; }),
  });
  return { links, store, clock, minted };
}

describe("the link request", () => {
  it("is three random values, of which only the hashes are kept", async () => {
    const { links, store } = service();
    const a = await links.create({ deviceName: "Aanya's MacBook Air", platform: "mac", ip: "203.0.113.9" });
    const b = await links.create({});
    expect(a.token).toMatch(TOKEN_RE);
    expect(a.secret).toMatch(TOKEN_RE);
    expect(a.code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    expect(new Set([a.token, a.secret, b.token, b.secret]).size).toBe(4);
    const stored = JSON.stringify([...store.rows.values()]);
    for (const v of [a.token, a.secret, a.code, b.token, b.secret, b.code]) expect(stored).not.toContain(v);
    expect(stored).toContain(hashOf(a.token));
    // The computer's name as it said it; none, the kind of computer.
    expect((await links.view({ token: a.token }))).toMatchObject({ deviceName: "Aanya's MacBook Air", platform: "mac", status: "pending" });
    expect((await links.view({ token: b.token }))?.deviceName).toBe("a computer");
  });

  it("approved on the phone, gives the window its sign-in once, and only to the window that asked", async () => {
    const { links, minted } = service();
    const r = await links.create({ deviceName: "Office PC", platform: "windows" });
    // Before an answer: pending.
    expect(await links.poll(r.token, r.secret, 0)).toMatchObject({ status: "pending" });
    expect(await links.decide({ token: r.token }, AANYA, true)).toEqual({ ok: true, deviceName: "Office PC" });
    // A copy of the token without the secret gets nothing at all, not even the status.
    expect(await links.poll(r.token, "x".repeat(43), 0)).toBeNull();
    expect(await links.poll(r.token, r.token, 0)).toBeNull();
    expect(minted).toEqual([]);
    // The window: the sign-in, for the account that approved.
    expect(await links.poll(r.token, r.secret, 0)).toEqual({ status: "approved", tokenHash: `hash-for-${AANYA.id}`, type: "magiclink" });
    expect(minted).toEqual([AANYA.id]);
    // Once: the request is spent.
    expect(await links.poll(r.token, r.secret, 0)).toEqual({ status: "used" });
    expect(minted).toHaveLength(1);
    // And it cannot be approved again, by anyone.
    expect(await links.decide({ token: r.token }, RAVI, true)).toEqual({ ok: false, error: "decided" });
  });

  it("two polls racing for an approved request: one sign-in", async () => {
    const { links, minted } = service();
    const r = await links.create({});
    await links.decide({ token: r.token }, AANYA, true);
    const [a, b] = await Promise.all([links.poll(r.token, r.secret, 0), links.poll(r.token, r.secret, 0)]);
    expect([a?.status, b?.status].sort()).toEqual(["approved", "used"]);
    expect(minted).toHaveLength(1);
  });

  it("a held poll wakes the moment the phone answers", async () => {
    const { links } = service();
    const r = await links.create({});
    const started = Date.now();
    const waiting = links.poll(r.token, r.secret, 20_000);
    setTimeout(() => { void links.decide({ token: r.token }, AANYA, false); }, 30);
    expect(await waiting).toEqual({ status: "denied" });
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("Not me: the window is told, and nothing is minted", async () => {
    const { links, minted } = service();
    const r = await links.create({});
    expect(await links.decide({ token: r.token }, AANYA, false)).toMatchObject({ ok: true });
    expect(await links.poll(r.token, r.secret, 0)).toEqual({ status: "denied" });
    expect(await links.decide({ token: r.token }, AANYA, true)).toEqual({ ok: false, error: "decided" });
    expect(minted).toEqual([]);
  });

  it("runs out after five minutes: nobody can approve it, and an approved one must be taken soon", async () => {
    const { links, clock } = service();
    const r = await links.create({});
    clock.now += LINK_TTL_MS;
    expect((await links.view({ token: r.token }))?.status).toBe("expired");
    expect(await links.decide({ token: r.token }, AANYA, true)).toEqual({ ok: false, error: "expired" });
    expect(await links.poll(r.token, r.secret, 0)).toEqual({ status: "expired" });
    // Approved in time but never taken: gone after the grace.
    const late = await links.create({});
    await links.decide({ token: late.token }, AANYA, true);
    clock.now += LINK_TTL_MS + EXCHANGE_GRACE_MS;
    expect(await links.poll(late.token, late.secret, 0)).toEqual({ status: "expired" });
  });

  it("the typed code finds the same request, however it is typed, only while it is pending", async () => {
    const { links, clock } = service();
    const r = await links.create({ deviceName: "Studio iMac", platform: "mac" });
    const shown = showCode(r.code);
    expect(shown).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(normalizeCode(` ${shown.toLowerCase()} `)).toBe(r.code);
    expect((await links.view({ code: shown.toLowerCase() }))?.deviceName).toBe("Studio iMac");
    expect(await links.view({ code: "AAAA-AAAA" })).toBeNull();
    expect(await links.view({ code: "123" })).toBeNull();
    expect(await links.decide({ code: shown }, AANYA, true)).toMatchObject({ ok: true });
    // Decided, the code finds nothing more (the token still names it, for the window).
    expect(await links.view({ code: shown })).toBeNull();
    const old = await links.create({});
    clock.now += LINK_TTL_MS;
    expect(await links.view({ code: old.code })).toBeNull();
  });

  it("only a real account with an address can approve; a sign-in that cannot be made says so", async () => {
    const { links } = service();
    const r = await links.create({});
    expect(await links.decide({ token: r.token }, { id: "static-abc123" }, true)).toEqual({ ok: false, error: "not_allowed" });
    expect(await links.decide({ token: r.token }, { id: AANYA.id }, true)).toEqual({ ok: false, error: "no_email" });
    expect(await links.decide({ token: "nope" }, AANYA, true)).toEqual({ ok: false, error: "not_found" });
    expect(await links.decide({}, AANYA, true)).toEqual({ ok: false, error: "not_found" });
    const failing = service({ mint: async () => ({ error: "failed" }) });
    const f = await failing.links.create({});
    await failing.links.decide({ token: f.token }, AANYA, true);
    expect(await failing.links.poll(f.token, f.secret, 0)).toEqual({ status: "failed" });
  });

  it("a computer's name is one line of plain words", () => {
    expect(cleanDeviceName("Evil‮cod.exe\nMac", "mac")).toBe("Evilcod.exe Mac");
    expect(cleanDeviceName("x".repeat(90), "")).toHaveLength(48);
    expect(cleanDeviceName("   ", "windows")).toBe("a Windows PC");
    expect(cleanDeviceName(undefined, "linux")).toBe("a Linux computer");
  });
});

describe("the routes", () => {
  async function server(o: { links?: ReturnType<typeof service>["links"] | null; who?: Record<string, { id: string; email?: string }> } = {}) {
    const app = Fastify();
    const s = service();
    const who = o.who ?? { "Bearer aanya": AANYA, "Bearer ravi": RAVI, "Bearer phone-only": { id: "33333333-3333-4333-8333-333333333333" } };
    registerDeviceLinkRoutes(app, { links: o.links === undefined ? s.links : o.links, limits: false, resolve: async (h) => (h && who[h]) || null });
    await app.ready();
    return { app, s };
  }
  const post = (app: Awaited<ReturnType<typeof server>>["app"], url: string, payload: unknown, auth?: string) =>
    app.inject({ method: "POST", url, payload: payload as Record<string, unknown>, headers: auth ? { authorization: `Bearer ${auth}` } : {} });

  it("the window starts one signed out, with a QR drawn here and a code to type", async () => {
    const { app } = await server();
    const res = await post(app, "/v1/auth/link", { deviceName: "Aanya's MacBook Air", platform: "mac" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const b = res.json();
    expect(b.url).toBe(linkUrl(b.token));
    expect(b.url).toMatch(/^https:\/\/app\.tailzu\.space\/s\/bots\.link\?l=[A-Za-z0-9_-]{43}$/);
    expect(b.code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(b.qr.size).toBeGreaterThan(20);
    expect(b.qr.path).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/);
    expect(b).toMatchObject({ ttlMs: 300_000, pollMs: expect.any(Number), expiresAt: expect.any(Number), secret: expect.stringMatching(TOKEN_RE) });
    await app.close();
  });

  it("end to end: the phone sees it and approves; the window takes its sign-in once", async () => {
    const { app } = await server();
    const made = (await post(app, "/v1/auth/link", { deviceName: "Office PC", platform: "windows" })).json();
    // The phone must be signed in.
    expect((await post(app, "/v1/auth/link/view", { token: made.token })).statusCode).toBe(401);
    const view = await post(app, "/v1/auth/link/view", { token: made.token }, "aanya");
    expect(view.json()).toMatchObject({ deviceName: "Office PC", platform: "windows", status: "pending", canApprove: true, account: AANYA.email });
    // Typed, the same request.
    expect((await post(app, "/v1/auth/link/view", { code: made.code }, "aanya")).json().deviceName).toBe("Office PC");
    expect((await post(app, "/v1/auth/link/view", { code: "ZZZZ-ZZZZ" }, "aanya")).statusCode).toBe(404);
    // A number-only account is told before it can press anything, and refused if it does.
    expect((await post(app, "/v1/auth/link/view", { token: made.token }, "phone-only")).json().canApprove).toBe(false);
    expect((await post(app, "/v1/auth/link/approve", { token: made.token }, "phone-only")).statusCode).toBe(409);
    // The window, before: pending. Then approved; then the sign-in, once.
    expect((await post(app, "/v1/auth/link/poll", { token: made.token, secret: made.secret })).json().status).toBe("pending");
    expect((await post(app, "/v1/auth/link/approve", { token: made.token }, "aanya")).json()).toEqual({ ok: true, deviceName: "Office PC" });
    expect((await post(app, "/v1/auth/link/approve", { token: made.token }, "ravi")).statusCode).toBe(409);
    expect((await post(app, "/v1/auth/link/poll", { token: made.token, secret: "x".repeat(43) })).statusCode).toBe(404);
    expect((await post(app, "/v1/auth/link/poll", { token: made.token, secret: made.secret })).json()).toEqual({ status: "approved", tokenHash: `hash-for-${AANYA.id}`, type: "magiclink" });
    expect((await post(app, "/v1/auth/link/poll", { token: made.token, secret: made.secret })).json()).toEqual({ status: "used" });
    await app.close();
  });

  it("Not me, by the typed code", async () => {
    const { app } = await server();
    const made = (await post(app, "/v1/auth/link", {})).json();
    expect((await post(app, "/v1/auth/link/deny", { code: made.code.toLowerCase() }, "aanya")).json()).toMatchObject({ ok: true });
    expect((await post(app, "/v1/auth/link/poll", { token: made.token, secret: made.secret })).json()).toEqual({ status: "denied" });
    expect((await post(app, "/v1/auth/link/deny", { token: made.token }, "aanya")).statusCode).toBe(409);
    await app.close();
  });

  it("off, on a server that cannot mint a session", async () => {
    const { app } = await server({ links: null });
    expect((await post(app, "/v1/auth/link", {})).json()).toMatchObject({ code: "link_off" });
    expect((await post(app, "/v1/auth/link/poll", {})).statusCode).toBe(404);
    expect((await post(app, "/v1/auth/link/approve", { token: "a".repeat(43) }, "aanya")).statusCode).toBe(404);
    await app.close();
  });

  it("the QR's link in a browser: one fixed page that opens the app, writing nothing else from the address", async () => {
    const { app } = await server();
    const token = "A".repeat(20) + "_-" + "b".repeat(21);
    const ok = await app.inject({ method: "GET", url: `/s/bots.link?l=${token}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(ok.headers["referrer-policy"]).toBe("no-referrer");
    expect(ok.body).toContain(`href="tulmi://screen/bots.link?l=${token}"`);
    expect(ok.body).not.toContain("<script");
    const evil = await app.inject({ method: "GET", url: `/s/bots.link?l=${encodeURIComponent('"><script>alert(1)</script>')}` });
    expect(evil.body).not.toContain("alert");
    expect(evil.body).not.toContain("tulmi://");
    // And the token never reaches a request log.
    expect(logUrl(`/s/bots.link?l=${token}`)).toBe("/s/bots.link");
    await app.close();
  });
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
const TOKEN = "T".repeat(43);
const VIEW = { deviceName: "Aanya's MacBook Air", platform: "mac", status: "pending", createdAt: 0, expiresAt: Number.MAX_SAFE_INTEGER, canApprove: true, account: "aanya@example.in" };
const build = (client: "phone" | "desktop", params?: Record<string, string>, view?: unknown, calls?: Array<{ method: string; path: string; body?: unknown }>) =>
  buildBotsScreen({
    screenId: "bots.link", client, params, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya", email: "aanya@example.in" },
    can: new Set(["BotsKit"]), desk: { pages: false, notes: false },
  }, fakeDeps({ api: view === undefined ? {} : { "POST /v1/auth/link/view": view }, calls }));

describe("bots.link on the phone", () => {
  it("You › Link a computer: how it goes, and the typed code", async () => {
    const s = await build("phone");
    expect(lintTree(s.root!)).toEqual([]);
    expect(texts(s.root!)).toEqual(expect.arrayContaining(["Link a computer", "No camera? Type the code"]));
    expect(walk(s.root!).some((n) => n.type === "TextField" && n.bind?.value === "code")).toBe(true);
    const go = actions(s.root).find((a) => a.kind === "condition") as { else?: { screenId?: string; params?: unknown } };
    expect(go.else).toMatchObject({ screenId: "bots.link", params: { c: "$state.code" } });
  });

  it("Sign in on <computer>?: Approve and Not me, with the token in the body only", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const s = await build("phone", { l: TOKEN }, VIEW, calls);
    expect(calls).toEqual([{ method: "POST", path: "/v1/auth/link/view", body: { token: TOKEN } }]);
    expect(lintTree(s.root!)).toEqual([]);
    const t = texts(s.root!);
    expect(t).toEqual(expect.arrayContaining(["Sign in on Aanya's MacBook Air?", "aanya@example.in", "Approve", "Not me"]));
    const writes = actions(s.root).filter((a) => a.kind === "callEndpoint") as Array<{ path: string; body?: unknown }>;
    expect(writes.map((w) => w.path).sort()).toEqual(["/v1/auth/link/approve", "/v1/auth/link/deny"]);
    for (const w of writes) expect(w.body).toEqual({ token: TOKEN });
    expect(JSON.stringify(s.root)).not.toContain(`/${TOKEN}`);
    // By the typed code: the same, with the code.
    const byCode: typeof calls = [];
    await build("phone", { c: "k7q4-2mxp" }, VIEW, byCode);
    expect(byCode[0]!.body).toEqual({ code: "k7q4-2mxp" });
  });

  it("says plainly when it can't: ran out, not found, already answered, or a number-only account", async () => {
    expect(texts((await build("phone", { l: TOKEN }, { ...VIEW, status: "expired" })).root!)).toContain("This code ran out");
    expect(texts((await build("phone", { l: TOKEN })).root!)).toContain("We couldn't find that sign-in");
    expect(texts((await build("phone", { c: "AAAA-AAAA" })).root!)).toContain("That code didn't work");
    expect(texts((await build("phone", { l: TOKEN }, { ...VIEW, status: "used" })).root!)).toContain("Already approved");
    const phoneOnly = await build("phone", { l: TOKEN }, { ...VIEW, canApprove: false, account: undefined });
    expect(texts(phoneOnly.root!)).toContain("Sign in with your number there");
    expect(texts(phoneOnly.root!)).not.toContain("Approve");
  });

  it("in a window: approving is the phone's, so no buttons", async () => {
    const s = await build("desktop", { l: TOKEN }, VIEW);
    expect(lintTree(s.root!)).toEqual([]);
    expect(texts(s.root!)).not.toContain("Approve");
    expect(actions(s.root).some((a) => a.kind === "callEndpoint")).toBe(false);
  });
});

describe("the window's sign-in", () => {
  it("carries the QR panel beside the form, with its words; the phone's does not", () => {
    const desk = botsAuthTree({ desktop: true, terms: "https://t", privacy: "https://p" }) as unknown as Node;
    const panel = walk(desk).find((n) => n.type === "DeskLinkSignIn");
    expect(panel?.props).toMatchObject({ title: "Scan with your phone", renew: expect.any(String), changesIn: expect.stringContaining("{t}") });
    expect(Array.isArray(panel?.props?.steps)).toBe(true);
    const phone = botsAuthTree({ terms: "https://t", privacy: "https://p" }) as unknown as Node;
    expect(walk(phone).some((n) => n.type === "DeskLinkSignIn")).toBe(false);
  });
});

describe("held polls", () => {
  it("one at a time per request: a second, while one is held, answers at once", async () => {
    const { links } = service();
    const r = await links.create({});
    const held = links.poll(r.token, r.secret, 20_000);
    const started = Date.now();
    expect(await links.poll(r.token, r.secret, 20_000)).toMatchObject({ status: "pending" });
    expect(Date.now() - started).toBeLessThan(500);
    await links.decide({ token: r.token }, AANYA, true);
    expect(await held).toMatchObject({ status: "approved" });
  });
});
