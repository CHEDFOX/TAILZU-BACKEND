/**
 * SPACES FOR FAMILY AND FRIENDS (src/botsBots/{spaces,spacePerms,mail,shared,payments,threads,spaceTasks}.ts, routes/botsSpaces.ts):
 *
 *   - permissions: the admin can do everything and can't be changed; presets and custom roles; nobody gives or takes away what they
 *     can't do; nobody changes someone who can do more than them
 *   - invites by link and by email: an email invite is mailed through the outbox (queued while no provider is plugged in), works only
 *     for that address and only once; the mail job sends once a mailer is there
 *   - sharing: to a space or a person, lists edited by who may, a file must be the sharer's, and a shared bot reads the space's things
 *   - payment requests: asked, approved by someone else who may, handed to UPI, paid; never money moved here
 *   - messaging: one to one and groups, unread counts, older pages, muting, leaving, photos by signed link, and live events
 *   - tasks and plans for others: who may, answering, the push, and the assignee's Plan ("From <name>")
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const A_ = "11111111-1111-4111-8111-111111111111"; // Aanya, who makes Home
const M_ = "22222222-2222-4222-8222-222222222222"; // Mom
const R_ = "33333333-3333-4333-8333-333333333333"; // Rohan
const X_ = "44444444-4444-4444-8444-444444444444"; // a stranger
const EMAIL: Record<string, string> = { [A_]: "aanya.sharma@example.in", [M_]: "meera.sharma@example.in", [R_]: "rohan@example.in", [X_]: "x@example.in" };

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id && EMAIL[id] ? { id, email: EMAIL[id] } : null; } };
});

const pushes: Array<{ userId: string; kind: string; vars: Record<string, string> }> = [];
vi.mock("../src/push/index.js", () => ({
  pushEngine: () => ({ notify: async (userId: string, msg: { kind: string; vars: Record<string, string> }) => { pushes.push({ userId, kind: msg.kind, vars: msg.vars }); return null; } }),
}));

const { Spaces, INVITE_ORIGIN, inviteLinkOf } = await import("../src/botsBots/spaces.js");
const { MailOutbox, NOT_CONFIGURED } = await import("../src/botsBots/mail.js");
const { MemoryPaged, resetSpaceTablesForTests } = await import("../src/botsBots/spaceRows.js");
const { resetAreaTablesForTests } = await import("../src/botsBots/rows.js");
const { registerSpacesRoutes } = await import("../src/routes/botsSpaces.js");
const { PlanDays } = await import("../src/botsBots/plan.js");
const { calendar, resetCalendarForTests } = await import("../src/calendar/index.js");
const { live } = await import("../src/live/bus.js");
const { permsOf, PRESETS } = await import("../src/botsBots/spacePerms.js");

const RL = { rateLimit: { max: 10_000, timeWindow: 60_000 } };
const AREA = "/v1/botsapp/bots";
const FILE_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const FILE_M = "aaaaaaaa-0000-4000-8000-00000000000b";

function fakeMedia() {
  const files = new Map([[FILE_A, { id: FILE_A, userId: A_, name: "receipt.jpg", mime: "image/jpeg", bytes: 1200, kind: "image", keep: false }], [FILE_M, { id: FILE_M, userId: M_, name: "page.html", mime: "text/html", bytes: 40, kind: "text", keep: false }]]);
  return {
    store: { get: async (u: string, id: string) => { const f = files.get(id); return f && f.userId === u ? { ...f } : null; } },
    keep: async (u: string, id: string, k: boolean) => { const f = files.get(id); if (f && f.userId === u) f.keep = k; return f ?? null; },
    bytesOf: async (i: { id: string }) => Buffer.from(`bytes of ${i.id}`),
    files,
  };
}

async function served(o: { now?: { t: number } } = {}) {
  resetAreaTablesForTests();
  resetSpaceTablesForTests();
  resetCalendarForTests();
  pushes.length = 0;
  const clock = o.now ?? { t: Date.UTC(2026, 9, 28, 6, 0) };
  const now = () => clock.t;
  const outbox = new MailOutbox(new MemoryPaged(), now);
  const bots = { resolve: async (_u: string, slug: string) => (["plan", "shop-bot"].includes(slug) ? { def: { slug, name: slug === "plan" ? "Plan bot" : "Shop bot", colour: "ochre" } } : null) };
  const spaces = new Spaces(bots as never, now, { outbox, mailer: NOT_CONFIGURED, origin: () => "https://app.example.in" });
  const media = fakeMedia();
  const app = Fastify();
  const trips = { current: async (u: string) => (u === A_ ? { id: "trip-1", place: "Pune", when: "14–16 Nov", who: "Mom", packing: [{ text: "Charger", done: true }, { text: "Aadhaar", done: false }] } : null) };
  const parts = registerSpacesRoutes(app, { rateLimit: RL, bots: null, code: null, jobs: null, connectors: null, media: media as never, artifacts: null }, { spaces, trips: trips as never });
  await app.ready();
  const call = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, user: string | null = A_, payload?: unknown) => {
    const r = await app.inject({ method, url: url.replace(/^https?:\/\/[^/]+/, ""), headers: user ? { authorization: `Bearer ${user}` } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: r.statusCode, body: r.body ? (() => { try { return r.json(); } catch { return r.body; } })() : null, headers: r.headers, raw: r.rawPayload };
  };
  /** Home: Aanya (admin), Mom (Family + approves), Rohan (Kid). */
  const home = async () => {
    const id = (await call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id as string;
    const fam = (await call("POST", `${AREA}/spaces/${id}/invite`, A_, { role: "family" })).body;
    await call("POST", `${AREA}/spaces/join`, M_, { code: fam.code });
    await call("PUT", `${AREA}/spaces/${id}/members/${M_}`, A_, { perms: [...PRESETS[0]!.perms, "approve", "manage", "remove"] });
    const kid = (await call("POST", `${AREA}/spaces/${id}/invite`, A_, { role: "kid" })).body;
    await call("POST", `${AREA}/spaces/join`, R_, { code: kid.code });
    return id;
  };
  return { app, call, home, clock, outbox, spaces, parts, media };
}

const memberOf = (space: { members: Array<{ userId: string }> }, id: string) => space.members.find((m) => m.userId === id) as unknown as { perms: string[]; roleName: string; canApprove: boolean };

describe("permissions", () => {
  beforeEach(() => { resetSpaceTablesForTests(); resetAreaTablesForTests(); });

  it("makes the maker the admin, who can do everything and can't be changed or removed", async () => {
    const s = await served();
    const id = await s.home();
    const d = (await s.call("GET", `${AREA}/spaces/${id}`)).body.space;
    expect(d.me).toMatchObject({ admin: true });
    expect(memberOf(d, A_).roleName).toBe("Admin");
    expect(memberOf(d, A_).perms).toContain("tasks");
    expect(memberOf(d, R_)).toMatchObject({ roleName: "Kid", canApprove: false });
    expect((await s.call("PUT", `${AREA}/spaces/${id}/members/${A_}`, M_, { role: "guest" })).status).toBe(403);
    expect((await s.call("DELETE", `${AREA}/spaces/${id}/members/${A_}`, M_)).status).toBe(403);
    expect((await s.call("PUT", `${AREA}/spaces/${id}/members/${M_}`, M_, { role: "guest" })).body.message).toMatch(/yourself/);
  });

  it("never lets anyone give or take away what they can't do themselves", async () => {
    const s = await served();
    const id = await s.home();
    // Mom may manage, but not rename: she can't give it, nor make Rohan an admin-like member.
    const r1 = await s.call("PUT", `${AREA}/spaces/${id}/members/${R_}`, M_, { perms: ["bots", "rename"] });
    expect(r1.status).toBe(403);
    expect(r1.body.message).toMatch(/Rename the space/);
    // What she can do, she can give.
    expect((await s.call("PUT", `${AREA}/spaces/${id}/members/${R_}`, M_, { perms: ["bots", "message", "approve"] })).status).toBe(200);
    // Rohan, a Kid without "manage", can change no one.
    expect((await s.call("PUT", `${AREA}/spaces/${id}/members/${M_}`, R_, { role: "guest" })).status).toBe(403);
    // Someone who can do more than you can't be changed or removed by you.
    await s.call("PUT", `${AREA}/spaces/${id}/members/${R_}`, A_, { perms: ["bots", "rename"] });
    expect((await s.call("PUT", `${AREA}/spaces/${id}/members/${R_}`, M_, { role: "guest" })).body.message).toMatch(/can do things you can't/);
    expect((await s.call("DELETE", `${AREA}/spaces/${id}/members/${R_}`, M_)).status).toBe(403);
    // An invite can't give more than its maker has.
    expect((await s.call("POST", `${AREA}/spaces/${id}/invite`, M_, { perms: ["rename"] })).status).toBe(403);
    expect((await s.call("POST", `${AREA}/spaces/${id}/invite`, R_, {})).status).toBe(403);
  });

  it("keeps roles the admin makes, and their members follow them", async () => {
    const s = await served();
    const id = await s.home();
    expect((await s.call("POST", `${AREA}/spaces/${id}/roles`, M_, { name: "Nani", perms: ["bots"] })).status).toBe(403);
    const role = (await s.call("POST", `${AREA}/spaces/${id}/roles`, A_, { name: "Nani", perms: ["bots", "message"] })).body.role;
    await s.call("PUT", `${AREA}/spaces/${id}/members/${R_}`, A_, { role: role.id });
    let d = (await s.call("GET", `${AREA}/spaces/${id}`)).body.space;
    expect(memberOf(d, R_)).toMatchObject({ roleName: "Nani", perms: ["bots", "message"] });
    await s.call("PUT", `${AREA}/spaces/${id}/roles/${role.id}`, A_, { name: "Nani", perms: ["bots", "message", "share"] });
    d = (await s.call("GET", `${AREA}/spaces/${id}`)).body.space;
    expect(memberOf(d, R_).perms).toEqual(["share", "bots", "message"]);
    await s.call("DELETE", `${AREA}/spaces/${id}/roles/${role.id}`, A_);
    d = (await s.call("GET", `${AREA}/spaces/${id}`)).body.space;
    expect(memberOf(d, R_)).toMatchObject({ roleName: "Just for them", perms: ["share", "bots", "message"] });
  });

  it("reads lists and objects of permissions the same way, dropping unknown names", () => {
    expect(permsOf(["message", "nope", "bots", "message"])).toEqual(["bots", "message"]);
    expect(permsOf({ invite: true, rename: false, approve: true })).toEqual(["invite", "approve"]);
  });
});

describe("invites by link and by email", () => {
  it("queues the email, says it waits for a provider, and works only for that address, once", async () => {
    const s = await served();
    const id = await s.home();
    const inv = (await s.call("POST", `${AREA}/spaces/${id}/invite`, A_, { email: "X@Example.in", role: "guest" })).body;
    expect(inv).toMatchObject({ email: "x@example.in", mail: "queued", mailReady: false });
    // The link opens the app at joining (a link the apps claim, as bots.link's does).
    expect(inv.link).toBe(`https://app.example.in/s/bots.spaces?join=${inv.code}`);
    const mail = await s.outbox.byRef("space_invite", inv.code);
    expect(mail).toMatchObject({ status: "queued", to_email: "x@example.in" });
    expect(mail!.body_text).toContain(inv.link);
    expect(await s.outbox.sendDue(NOT_CONFIGURED)).toBe(0);
    expect((await s.outbox.byRef("space_invite", inv.code))!.status).toBe("queued");
    // The invite page says whose it is, masked: at the link (a browser with no app to hand it to), and at the old address.
    expect((await s.call("GET", inv.link, null)).body).toContain("x•••@example.in");
    expect((await s.call("GET", `${AREA}/invite/${inv.code}`, null)).body).toContain("x•••@example.in");
    // Rohan has it, but it isn't his.
    const wrong = await s.call("POST", `${AREA}/spaces/join`, R_, { code: inv.code });
    expect(wrong.status).toBe(403);
    expect(wrong.body.message).toContain("x•••@example.in");
    expect((await s.call("POST", `${AREA}/spaces/join`, X_, { code: inv.code })).status).toBe(200);
    const d = (await s.call("GET", `${AREA}/spaces/${id}`, X_)).body.space;
    expect(memberOf(d, X_)).toMatchObject({ roleName: "Guest" });
    // Used up.
    await s.call("DELETE", `${AREA}/spaces/${id}`, X_);
    expect((await s.call("POST", `${AREA}/spaces/join`, X_, { code: inv.code })).status).toBe(404);
  });

  it("opens the app straight to joining: the link's page opens X0 Bot at Spaces with the code, and keeps the code to type", async () => {
    const s = await served();
    const id = await s.home();
    const inv = (await s.call("POST", `${AREA}/spaces/${id}/invite`, A_, { role: "family" })).body;
    const page = await s.call("GET", inv.link, null);
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(String(page.headers["content-security-policy"])).toContain("default-src 'none'");
    expect(page.body).toContain("<b>Home</b>");
    expect(page.body).toContain(`href="tulmi://screen/bots.spaces?join=${inv.code}"`);
    expect(page.body).toContain("Join with a code");
    expect(page.body).toContain(`>${inv.code}<`);
    expect(page.body).not.toContain("<script");
    // A code that isn't one, or one that doesn't work: the plain words, and nothing to open.
    for (const bad of ["NOPE1234", "%3Cscript%3E", ""]) {
      const p = await s.call("GET", `/s/bots.spaces?join=${bad}`, null);
      expect(p.body).toContain("This invite doesn't work any more.");
      expect(p.body).not.toContain("tulmi://");
    }
    // What the app's join card reads, signed in: what it is for, before joining.
    expect((await s.call("GET", `${AREA}/spaces/join/${inv.code}`, R_)).body).toEqual({ invite: { name: "Home", members: 3, email: null } });
    expect((await s.call("GET", `${AREA}/spaces/join/NOPE1234`, R_)).body).toEqual({ invite: null });
    expect((await s.call("GET", `${AREA}/spaces/join/${inv.code}`, null)).status).toBe(401);
    // Without an origin given, the link is the apps' own host.
    expect(INVITE_ORIGIN).toBe("https://app.x0bot.com");
    expect(inviteLinkOf(INVITE_ORIGIN, "QW3RT7YP")).toBe("https://app.x0bot.com/s/bots.spaces?join=QW3RT7YP");
  });

  it("sends queued mail once a mailer is plugged in, retrying a failure", async () => {
    const s = await served();
    const id = await s.home();
    await s.call("POST", `${AREA}/spaces/${id}/invite`, A_, { email: "x@example.in", role: "guest" });
    const sent: string[] = [];
    let fail = true;
    const mailer = { configured: true, send: async (m: { to: string; subject: string }) => { if (fail) { fail = false; throw new Error("down"); } sent.push(`${m.to}: ${m.subject}`); } };
    expect(await s.outbox.sendDue(mailer)).toBe(0);
    s.clock.t += 2 * 60_000;
    expect(await s.outbox.sendDue(mailer)).toBe(1);
    expect(sent).toEqual(["x@example.in: Aanya S. invited you to Home on X0 Bot"]);
    expect(await s.outbox.sendDue(mailer)).toBe(0);
  });

  it("takes an invite back, and its mail never goes", async () => {
    const s = await served();
    const id = await s.home();
    const inv = (await s.call("POST", `${AREA}/spaces/${id}/invite`, A_, { email: "x@example.in", role: "guest" })).body;
    expect((await s.call("DELETE", `${AREA}/spaces/${id}/invites/${inv.code}`, R_)).status).toBe(403);
    expect((await s.call("DELETE", `${AREA}/spaces/${id}/invites/${inv.code}`, A_)).status).toBe(200);
    expect((await s.outbox.byRef("space_invite", inv.code))!.status).toBe("cancelled");
    expect((await s.call("POST", `${AREA}/spaces/join`, X_, { code: inv.code })).status).toBe(404);
  });

  it("gives a link invite's joiner no more than its maker can still do", async () => {
    const s = await served();
    const id = await s.home();
    const inv = (await s.call("POST", `${AREA}/spaces/${id}/invite`, M_, { role: "family" })).body;
    await s.call("PUT", `${AREA}/spaces/${id}/members/${M_}`, A_, { perms: ["invite", "bots"] });
    await s.call("POST", `${AREA}/spaces/join`, X_, { code: inv.code });
    const d = (await s.call("GET", `${AREA}/spaces/${id}`, X_)).body.space;
    expect(memberOf(d, X_).perms).toEqual(["invite", "bots"]);
  });
});

describe("sharing", () => {
  it("shares a list to a space, edited by who may, and read by a bot shared there", async () => {
    const s = await served();
    const id = await s.home();
    const r = await s.call("POST", `${AREA}/shares`, M_, { kind: "list", title: "Groceries", items: ["Atta 5 kg", "Toor dal"], access: "edit", to: { space: id } });
    expect(r.status).toBe(201);
    const item = r.body.item;
    // Rohan (Kid: share) adds and ticks; a guest can't edit.
    const add = await s.call("PUT", `${AREA}/items/${item.id}`, R_, { op: "add", text: "Paneer" });
    expect(add.body.item.list.map((l: { text: string }) => l.text)).toEqual(["Atta 5 kg", "Toor dal", "Paneer"]);
    await s.call("PUT", `${AREA}/items/${item.id}`, R_, { op: "toggle", line: add.body.item.list[0].id });
    await s.call("PUT", `${AREA}/spaces/${id}/members/${R_}`, A_, { role: "guest" });
    expect((await s.call("PUT", `${AREA}/items/${item.id}`, R_, { op: "add", text: "Milk" })).status).toBe(403);
    expect((await s.call("GET", `${AREA}/items/${item.id}`, R_)).body.item.summary).toBe("1 of 3 done");
    expect((await s.call("GET", `${AREA}/items/${item.id}`, X_)).status).toBe(404);
    // A bot shared into Home reads it when Mom (who may use the shared bots) asks it; not for someone who may not.
    await s.call("POST", `${AREA}/spaces/${id}/bots`, A_, { slug: "plan" });
    const ctx = await s.parts.items.forBot(M_, "plan");
    expect(ctx).toHaveLength(1);
    expect(ctx[0]!.text).toContain("Groceries (list, shared by Meera S.): [x] Atta 5 kg; [ ] Toor dal; [ ] Paneer");
    await s.call("PUT", `${AREA}/spaces/${id}/members/${M_}`, A_, { perms: ["message"] });
    expect(await s.parts.items.forBot(M_, "plan")).toEqual([]);
    expect(await s.parts.items.forBot(A_, "shop-bot")).toEqual([]);
  });

  it("checks what it can: a file must be yours, a trip comes from your own trips, a link must be http(s)", async () => {
    const s = await served();
    const id = await s.home();
    expect((await s.call("POST", `${AREA}/shares`, A_, { kind: "file", ref: FILE_M, to: { space: id } })).status).toBe(404);
    const f = (await s.call("POST", `${AREA}/shares`, A_, { kind: "file", ref: FILE_A, to: { space: id } })).body.item;
    expect(f).toMatchObject({ title: "receipt.jpg", access: "view" });
    expect(s.media.files.get(FILE_A)!.keep).toBe(true);
    // Its bytes, by the signed link, to someone in the space; the same link is no use to anyone else.
    const got = await s.call("GET", f.file.url, null);
    expect(got.status).toBe(200);
    expect(got.headers["content-type"]).toBe("image/jpeg");
    expect((await s.call("GET", f.file.url.replace(`v=${A_}`, `v=${X_}`), null)).status).toBe(404);
    s.clock.t += 1000;
    const t = (await s.call("POST", `${AREA}/shares`, A_, { kind: "trip", ref: "trip-1", title: "fake", to: { space: id } })).body.item;
    expect(t).toMatchObject({ title: "fake", place: "Pune", summary: "1 of 2 done" });
    expect((await s.call("POST", `${AREA}/shares`, M_, { kind: "trip", ref: "trip-1", to: { space: id } })).status).toBe(404);
    expect((await s.call("POST", `${AREA}/shares`, A_, { kind: "link", url: "javascript:alert(1)", to: { space: id } })).status).toBe(400);
    expect((await s.call("POST", `${AREA}/shares`, X_, { kind: "text", text: "hi", to: { space: id } })).status).toBe(404);
    const items = (await s.call("GET", `${AREA}/spaces/${id}/items`, R_)).body.items;
    expect(items.map((i: { title: string }) => i.title)).toEqual(["fake", "receipt.jpg"]);
  });

  it("shares to a person as a card in your chat with them", async () => {
    const s = await served();
    await s.home();
    const r = (await s.call("POST", `${AREA}/shares`, A_, { kind: "answer", title: "Plan for Sunday", text: "Lunch at Nani's at 1", bot: "plan", note: "Look", to: { person: M_ } })).body;
    const t = (await s.call("GET", `${AREA}/threads/${r.threadId}`, M_)).body;
    expect(t.messages.at(-1)).toMatchObject({ text: "Look", item: { id: r.item.id, kind: "answer", title: "Plan for Sunday" } });
    expect((await s.call("GET", `${AREA}/items/${r.item.id}`, M_)).body.item.text).toBe("Lunch at Nani's at 1");
    expect((await s.call("GET", `${AREA}/items/${r.item.id}`, R_)).status).toBe(404);
    expect((await s.call("POST", `${AREA}/shares`, A_, { kind: "text", text: "hi", to: { person: X_ } })).status).toBe(403);
  });
});

describe("payment requests", () => {
  it("asks (what for, to whom, no amount), is approved by someone else who may, hands the UPI payment over without an amount, and is marked paid", async () => {
    const s = await served();
    const id = await s.home();
    await s.call("PUT", `${AREA}/spaces/${id}/members/${R_}`, A_, { role: "guest" });
    expect((await s.call("POST", `${AREA}/spaces/${id}/payments`, R_, { amount: "500", to: "shop@okaxis" })).status).toBe(403);
    await s.call("PUT", `${AREA}/spaces/${id}/members/${R_}`, A_, { role: "kid" });
    expect((await s.call("POST", `${AREA}/spaces/${id}/payments`, R_, { amount: "500", to: "not an id" })).body.code).toBe("bad_vpa");
    const p = (await s.call("POST", `${AREA}/spaces/${id}/payments`, R_, { amount: "1,240", to: "freshbasket@okaxis", name: "Fresh Basket", note: "This week's groceries" })).body.payment;
    expect(p).toMatchObject({ amountPaise: 124_000, status: "waiting", canCancel: true, upi: null });
    expect((await s.call("GET", `${AREA}/spaces`, A_)).body.spaces[0].waiting).toBe(1);
    expect((await s.call("PUT", `${AREA}/spaces/${id}/payments/${p.id}`, R_, { decision: "approve" })).status).toBe(403);
    const yes = (await s.call("PUT", `${AREA}/spaces/${id}/payments/${p.id}`, M_, { decision: "approve" })).body.payment;
    expect(yes).toMatchObject({ status: "approved", canMarkPaid: true });
    expect(yes.upi).toBe("upi://pay?pa=freshbasket@okaxis&pn=Fresh%20Basket&cu=INR&tn=This%20week's%20groceries");
    expect((await s.call("PUT", `${AREA}/spaces/${id}/payments/${p.id}`, A_, { decision: "decline" })).body.code).toBe("answered");
    expect((await s.call("PUT", `${AREA}/spaces/${id}/payments/${p.id}`, A_, { paid: true })).status).toBe(403);
    expect((await s.call("PUT", `${AREA}/spaces/${id}/payments/${p.id}`, M_, { paid: true })).body.payment.status).toBe("paid");
    const history = (await s.call("GET", `${AREA}/spaces/${id}/payments`, R_)).body.payments;
    expect(history[0]).toMatchObject({ status: "paid", decidedBy: "Meera S.", upi: null });
    const log = (await s.call("GET", `${AREA}/spaces/${id}/activity`, A_)).body.activity.map((a: { text: string }) => a.text);
    expect(log.slice(0, 3)).toEqual(["Meera S. paid Fresh Basket", "Meera S. approved the payment to Fresh Basket", "Rohan asked for a payment to Fresh Basket for This week's groceries"]);
    // The screens send no amount now: a request is what it's for and to whom.
    const bare = (await s.call("POST", `${AREA}/spaces/${id}/payments`, R_, { to: "milkman@okaxis", name: "Ramu", note: "Milk for October" })).body.payment;
    expect(bare).toMatchObject({ amountPaise: 0, payee: "Ramu", note: "Milk for October", status: "waiting" });
  });
});

describe("messaging", () => {
  it("messages one to one, counts unread, pages older messages, and tells open screens", async () => {
    const s = await served();
    const id = await s.home();
    const heard: string[] = [];
    const stop = live.subscribe(M_, (e) => heard.push(e.topic));
    expect((await s.call("POST", `${AREA}/threads/direct`, A_, { person: X_ })).status).toBe(403);
    const dm = (await s.call("POST", `${AREA}/threads/direct`, A_, { person: M_ })).body.id;
    expect((await s.call("POST", `${AREA}/threads/direct`, M_, { person: A_ })).body.id).toBe(dm);
    for (let i = 1; i <= 35; i += 1) { s.clock.t += 1000; await s.call("POST", `${AREA}/threads/${dm}/messages`, A_, { text: `Message ${i}` }); }
    stop();
    expect(heard).toContain(`thread:${dm}`);
    expect(heard).toContain("threads");
    let list = (await s.call("GET", `${AREA}/threads`, M_)).body;
    expect(list.unread).toBe(35);
    expect(list.threads.find((t: { id: string }) => t.id === dm)).toMatchObject({ name: "Aanya S.", unread: 35, last: { text: "Aanya S.: Message 35" } });
    const first = (await s.call("GET", `${AREA}/threads/${dm}`, M_)).body;
    expect(first.messages).toHaveLength(30);
    expect(first.messages.at(-1).text).toBe("Message 35");
    expect(first.more).toBe(true);
    const older = (await s.call("GET", `${AREA}/threads/${dm}?before=${first.before}`, M_)).body;
    expect(older.messages.map((m: { text: string }) => m.text)).toEqual(["Message 1", "Message 2", "Message 3", "Message 4", "Message 5"]);
    expect(older.more).toBe(false);
    list = (await s.call("GET", `${AREA}/threads`, M_)).body;
    expect(list.unread).toBe(0);
    expect((await s.call("GET", `${AREA}/threads/${dm}`, R_)).status).toBe(404);
    // Pushes said who, never the words.
    expect(pushes.filter((p) => p.kind === "space_message" && p.userId === M_)).toHaveLength(35);
    expect(JSON.stringify(pushes)).not.toContain("Message 1");
    // Muted: no more pushes, and the chat isn't counted.
    await s.call("PUT", `${AREA}/threads/${dm}`, M_, { muted: true });
    await s.call("POST", `${AREA}/threads/${dm}/messages`, A_, { text: "One more" });
    expect(pushes.filter((p) => p.kind === "space_message" && p.userId === M_)).toHaveLength(35);
    expect((await s.call("GET", `${AREA}/threads`, M_)).body.unread).toBe(0);
    void id;
  });

  it("sends photos by signed link, only your own files, and only to people in the chat", async () => {
    const s = await served();
    await s.home();
    const dm = (await s.call("POST", `${AREA}/threads/direct`, A_, { person: M_ })).body.id;
    expect((await s.call("POST", `${AREA}/threads/${dm}/messages`, A_, { files: [FILE_M] })).status).toBe(404);
    const m = (await s.call("POST", `${AREA}/threads/${dm}/messages`, A_, { text: "", files: [FILE_A] })).body.message;
    const seen = (await s.call("GET", `${AREA}/threads/${dm}`, M_)).body.messages.at(-1);
    expect(seen.files[0]).toMatchObject({ name: "receipt.jpg", mime: "image/jpeg" });
    expect((await s.call("GET", seen.files[0].url, null)).raw.toString()).toBe(`bytes of ${FILE_A}`);
    expect((await s.call("GET", seen.files[0].url.replace(/sig=[^&]+/, "sig=AAAA"), null)).status).toBe(404);
    expect(m.files[0].url).toContain(`v=${A_}`);
    // An hour on, the link is no good; the screen asks for new ones when it loads.
    s.clock.t += 2 * 3600_000;
    expect((await s.call("GET", seen.files[0].url, null)).status).toBe(200);
  });

  it("makes groups from a space's people with the permission, lets people leave, and follows the space", async () => {
    const s = await served();
    const id = await s.home();
    expect((await s.call("POST", `${AREA}/threads/group`, R_, { space: id, people: [M_] })).status).toBe(403);
    expect((await s.call("POST", `${AREA}/threads/group`, M_, { space: id, people: [X_] })).status).toBe(404);
    const g = (await s.call("POST", `${AREA}/threads/group`, M_, { space: id, name: "Diwali", people: [A_, R_] })).body.id;
    await s.call("POST", `${AREA}/threads/${g}/messages`, R_, { text: "Crackers?" });
    const all = (await s.call("POST", `${AREA}/threads/group`, A_, { space: id, people: "all" })).body.id;
    const chats = (await s.call("GET", `${AREA}/threads`, R_)).body.threads;
    expect(chats.map((t: { name: string; kind: string }) => `${t.kind}:${t.name}`).sort()).toEqual(["group:Diwali", "space:Home"]);
    expect((await s.call("DELETE", `${AREA}/threads/${all}`, R_)).status).toBe(409);
    // A guest reads the space's chat but can't write in it.
    await s.call("PUT", `${AREA}/spaces/${id}/members/${R_}`, A_, { perms: ["bots"] });
    const read = (await s.call("GET", `${AREA}/threads/${all}`, R_)).body.thread;
    expect(read).toMatchObject({ canPost: false });
    expect((await s.call("POST", `${AREA}/threads/${all}/messages`, R_, { text: "hi" })).status).toBe(403);
    // Leaving a group; leaving the space leaves its chats.
    await s.call("DELETE", `${AREA}/threads/${g}`, A_);
    expect((await s.call("GET", `${AREA}/threads/${g}`, A_)).status).toBe(404);
    await s.call("DELETE", `${AREA}/spaces/${id}/members/${R_}`, A_);
    expect((await s.call("GET", `${AREA}/threads/${all}`, R_)).status).toBe(404);
    expect((await s.call("GET", `${AREA}/threads`, R_)).body.threads).toEqual([]);
  });
});

describe("tasks and plans for others", () => {
  it("gives tasks with the permission, tells the person, and takes their answer", async () => {
    const s = await served();
    const id = await s.home();
    expect((await s.call("POST", `${AREA}/spaces/${id}/tasks`, R_, { title: "Water the plants", people: [M_] })).status).toBe(403);
    const t = (await s.call("POST", `${AREA}/spaces/${id}/tasks`, A_, { title: "Pick up the cake", people: [R_, M_], day: "2026-10-29", time: "18:30", place: "Koramangala", tz: 330 })).body.task;
    expect(t).toMatchObject({ kind: "task", place: "Koramangala", allDay: false, at: Date.UTC(2026, 9, 29, 13, 0) });
    expect(pushes.filter((p) => p.kind === "space_task").map((p) => [p.userId, p.vars.name, p.vars.title, p.vars.due])).toEqual([
      [R_, "Aanya S.", "Pick up the cake", " · Thu 29 Oct, 6:30 pm"], [M_, "Aanya S.", "Pick up the cake", " · Thu 29 Oct, 6:30 pm"],
    ]);
    expect((await s.call("GET", `${AREA}/tasks/given`, R_)).body.tasks.map((x: { title: string }) => x.title)).toEqual(["Pick up the cake"]);
    expect((await s.call("PUT", `${AREA}/spaces/${id}/tasks/${t.id}`, A_, { status: "done" })).status).toBe(403);
    const cant = (await s.call("PUT", `${AREA}/spaces/${id}/tasks/${t.id}`, R_, { status: "cant", note: "Exam that day" })).body.task;
    expect(cant.people.find((p: { userId: string }) => p.userId === R_)).toMatchObject({ status: "cant", note: "Exam that day" });
    await s.call("PUT", `${AREA}/spaces/${id}/tasks/${t.id}`, M_, { status: "done" });
    expect((await s.call("GET", `${AREA}/tasks/given`, M_)).body.tasks).toEqual([]);
    const log = (await s.call("GET", `${AREA}/spaces/${id}/activity`, A_)).body.activity.map((a: { text: string }) => a.text);
    expect(log.slice(0, 3)).toEqual(["Meera S. did Pick up the cake", "Rohan can't do Pick up the cake: Exam that day", "Aanya S. gave Pick up the cake to Rohan, Meera S."]);
    expect((await s.call("DELETE", `${AREA}/spaces/${id}/tasks/${t.id}`, M_)).status).toBe(403);
    expect((await s.call("DELETE", `${AREA}/spaces/${id}/tasks/${t.id}`, A_)).status).toBe(200);
  });

  it("puts a plan on someone's day, and it shows on their Plan as From <name>", async () => {
    const s = await served();
    const id = await s.home();
    expect((await s.call("POST", `${AREA}/spaces/${id}/tasks`, M_, { kind: "plan", title: "Pick up Rohan", people: [R_], day: "2026-10-29", tz: 330 })).status).toBe(400);
    await s.call("POST", `${AREA}/spaces/${id}/tasks`, M_, { kind: "plan", title: "Pick up Rohan", people: [R_], day: "2026-10-29", time: "16:00", endTime: "16:30", place: "School gate", tz: 330 });
    await s.call("POST", `${AREA}/spaces/${id}/tasks`, M_, { title: "Homework", people: [R_], day: "2026-10-30", tz: 330 });
    expect(pushes.map((p) => p.kind)).toEqual(["space_plan", "space_task"]);
    const plan = await new PlanDays(null, null, () => s.clock.t).read(R_, { tz: 330 });
    const thu = plan.days.find((d) => d.key === "2026-10-29")!;
    // On Rohan's own calendar and to-dos (src/calendar), whoever he is: nothing to connect.
    expect(thu.events).toEqual([expect.objectContaining({ title: "Pick up Rohan", where: "School gate", from: "Meera S.", fixed: true, start: Date.UTC(2026, 9, 29, 10, 30), end: Date.UTC(2026, 9, 29, 11, 0) })]);
    expect(plan.days.find((d) => d.key === "2026-10-30")!.tasks).toEqual([expect.objectContaining({ title: "Homework", from: "Meera S.", fixed: true, done: false })]);
    expect(plan.suggestion).toBeNull();
    const mine = await new PlanDays(null, null, () => s.clock.t).read(A_, { tz: 330 });
    expect(mine.days.every((d) => !d.events.length && !d.tasks.length)).toBe(true);
  });

  it("works both ways: a tick on his own list is Done in the space, can't do it takes it off, taken out it goes", async () => {
    const s = await served();
    const id = await s.home();
    const plan = (await s.call("POST", `${AREA}/spaces/${id}/tasks`, M_, { kind: "plan", title: "Pick up Rohan", people: [R_], day: "2026-10-29", time: "16:00", tz: 330 })).body.task;
    const hw = (await s.call("POST", `${AREA}/spaces/${id}/tasks`, M_, { title: "Homework", people: [R_], day: "2026-10-30", tz: 330 })).body.task;
    const cal = calendar();
    const days = await cal.list(R_, { from: "2026-10-28", to: "2026-11-01", tz: 330 });
    const myHw = days.tasks.find((t) => t.title === "Homework")!;
    const myPlan = days.events.find((e) => e.title === "Pick up Rohan")!;
    // Not his to change, only to answer.
    await expect(cal.changeTask(R_, myHw.id, { title: "No homework" })).rejects.toMatchObject({ status: 403 });
    await expect(cal.removeEvent(R_, myPlan.id)).rejects.toMatchObject({ status: 403 });
    // His tick is his Done in the space.
    await cal.tickTask(R_, myHw.id, true);
    const listed = (await s.call("GET", `${AREA}/spaces/${id}/tasks`, M_)).body.tasks as Array<{ id: string; people: Array<{ userId: string; status: string }> }>;
    expect(listed.find((t) => t.id === hw.id)!.people.find((p) => p.userId === R_)!.status).toBe("done");
    // Done in the space is ticked on his list.
    await s.call("PUT", `${AREA}/spaces/${id}/tasks/${hw.id}`, R_, { status: "todo" });
    expect((await cal.task(R_, myHw.id)).done).toBe(false);
    // "Can't do it" from his Plan: the space hears it, and it comes off his days.
    await cal.cantDo(R_, myPlan.id);
    const after = (await s.call("GET", `${AREA}/spaces/${id}/tasks`, M_)).body.tasks as Array<{ id: string; people: Array<{ userId: string; status: string }> }>;
    expect(after.find((t) => t.id === plan.id)!.people[0]!.status).toBe("cant");
    expect((await cal.list(R_, { from: "2026-10-28", to: "2026-11-01", tz: 330 })).events).toEqual([]);
    // Taken out of the space by who set it: off his list too.
    await s.call("DELETE", `${AREA}/spaces/${id}/tasks/${hw.id}`, M_);
    expect((await cal.list(R_, { from: "2026-10-28", to: "2026-11-01", tz: 330 })).tasks).toEqual([]);
  });
});
