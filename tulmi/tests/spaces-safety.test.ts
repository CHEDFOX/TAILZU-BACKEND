/**
 * REPORTING AND BLOCKING IN SPACES (src/botsBots/{blocks,safety}.ts, routes/safety.ts, screens/safety.ts; App Review 1.2):
 *
 *   - blocking, either way round: the one-to-one chat is gone for both and can't be started again; in a space's chat neither sees the
 *     other's messages (nor gets them as unread or as a ping); neither is in the other's lists of people (members, Message someone,
 *     Share to); what one shares is unseen by the other; unblocking brings it all back; only people you've come across can be blocked
 *   - reporting a message, a shared thing or a person, with a reason: only what you can see, never your own; a copy of it is kept,
 *     due in 24 hours, and mailed to support@x0bot.com through the outbox once; "Also block" blocks; a day's reports are bounded
 *   - the admin: lists what is open and late, takes the content out for everyone, suspends the account, dismisses
 *   - the screens: someone's page, the report screen and Blocked people build lint-clean on both clients, and a chat offers Report
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { Node } from "../../shared/types/sdui.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.ADMIN_SECRET = "test-admin-secret-safety";
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

const pushes: Array<{ userId: string; kind: string }> = [];
vi.mock("../src/push/index.js", () => ({
  pushEngine: () => ({ notify: async (userId: string, msg: { kind: string }) => { pushes.push({ userId, kind: msg.kind }); return null; } }),
}));

const { Spaces } = await import("../src/botsBots/spaces.js");
const { MailOutbox, NOT_CONFIGURED } = await import("../src/botsBots/mail.js");
const { MemoryPaged, resetSpaceTablesForTests } = await import("../src/botsBots/spaceRows.js");
const { resetAreaTablesForTests } = await import("../src/botsBots/rows.js");
const { registerSpacesRoutes, spaceParts } = await import("../src/routes/botsSpaces.js");
const { resetCalendarForTests } = await import("../src/calendar/index.js");
const { REPORTS_A_DAY } = await import("../src/botsBots/safety.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");

const RL = { rateLimit: { max: 10_000, timeWindow: 60_000 } };
const AREA = "/v1/botsapp/bots";
const ADMIN = { "x-admin-secret": "test-admin-secret-safety", "x-admin-name": "owner" };
const HOUR = 3600_000;

async function served() {
  resetAreaTablesForTests();
  resetSpaceTablesForTests();
  resetCalendarForTests();
  pushes.length = 0;
  const clock = { t: Date.UTC(2026, 9, 28, 6, 0) };
  const now = () => clock.t;
  const outbox = new MailOutbox(new MemoryPaged(), now);
  const spaces = new Spaces(null, now, { outbox, mailer: NOT_CONFIGURED, origin: () => "https://app.example.in" });
  const suspended: string[] = [];
  const parts = spaceParts(spaces, { now, origin: "https://api.example.in", suspend: async (id) => { suspended.push(id); return true; } });
  const app = Fastify();
  registerSpacesRoutes(app, { rateLimit: RL, bots: null, code: null, jobs: null, connectors: null, media: null, artifacts: null } as never, { spaces, parts });
  await app.ready();
  const call = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, user: string | null = A_, payload?: unknown, headers: Record<string, string> = {}) => {
    const r = await app.inject({ method, url, headers: { ...(user ? { authorization: `Bearer ${user}` } : {}), ...headers }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: r.statusCode, body: r.body ? (() => { try { return r.json(); } catch { return r.body; } })() : null };
  };
  /** Home: Aanya (admin), Mom (Family), Rohan (Kid). Everyone may message. */
  const home = async () => {
    const id = (await call("POST", `${AREA}/spaces`, A_, { name: "Home" })).body.id as string;
    for (const [who, role] of [[M_, "family"], [R_, "kid"]] as const) {
      const inv = (await call("POST", `${AREA}/spaces/${id}/invite`, A_, { role })).body;
      expect((await call("POST", `${AREA}/spaces/join`, who, { code: inv.code })).status).toBe(200);
    }
    const chat = (await call("POST", `${AREA}/threads/group`, A_, { space: id, people: "all" })).body.id as string;
    return { id, chat };
  };
  const say = async (who: string, thread: string, text: string) => {
    const r = await call("POST", `${AREA}/threads/${thread}/messages`, who, { text });
    expect(r.status).toBe(201);
    return r.body.message.id as string;
  };
  const texts = async (who: string, thread: string) => ((await call("GET", `${AREA}/threads/${thread}`, who)).body.messages as Array<{ text: string }>).map((m) => m.text);
  return { app, call, home, say, texts, clock, outbox, parts, suspended };
}

describe("blocking", () => {
  beforeEach(() => { resetSpaceTablesForTests(); resetAreaTablesForTests(); });

  it("closes and hides the one-to-one chat for both, and it can't be started again", async () => {
    const s = await served();
    await s.home();
    const dm = (await s.call("POST", `${AREA}/threads/direct`, A_, { person: M_ })).body.id as string;
    await s.say(M_, dm, "Did you eat?");
    expect((await s.call("POST", `${AREA}/blocks`, A_, { person: M_ })).body).toMatchObject({ ok: true, name: "Meera S.", already: false });

    for (const who of [A_, M_]) {
      expect(((await s.call("GET", `${AREA}/threads`, who)).body.threads as Array<{ id: string }>).some((t) => t.id === dm)).toBe(false);
      expect((await s.call("GET", `${AREA}/threads/${dm}`, who)).status).toBe(404);
      expect((await s.call("POST", `${AREA}/threads/${dm}/messages`, who, { text: "hello?" })).status).toBe(404);
    }
    const mine = await s.call("POST", `${AREA}/threads/direct`, A_, { person: M_ });
    expect(mine.status).toBe(403);
    expect(mine.body.message).toMatch(/You blocked them/);
    const theirs = await s.call("POST", `${AREA}/threads/direct`, M_, { person: A_ });
    expect(theirs.status).toBe(403);
    expect(theirs.body.message).toBe("You can't message them.");
    // Sharing to them is messaging them too.
    expect((await s.call("POST", `${AREA}/shares`, M_, { kind: "text", text: "hi", title: "Hi", to: { person: A_ } })).status).toBe(403);
  });

  it("hides each from the other in a space's chat: no messages, no unread, no ping; everyone else sees both", async () => {
    const s = await served();
    const { chat } = await s.home();
    await s.say(M_, chat, "Dinner at 8");
    await s.call("POST", `${AREA}/blocks`, A_, { person: M_ });
    await s.call("GET", `${AREA}/threads/${chat}`, A_); // read: nothing unread
    pushes.length = 0;
    await s.say(M_, chat, "Who took my charger");
    await s.say(R_, chat, "Not me");
    await s.say(A_, chat, "Me, sorry");

    expect(await s.texts(A_, chat)).toEqual(["Not me", "Me, sorry"]);
    expect(await s.texts(M_, chat)).toEqual(["Dinner at 8", "Who took my charger", "Not me"]);
    expect(await s.texts(R_, chat)).toEqual(["Dinner at 8", "Who took my charger", "Not me", "Me, sorry"]);
    // Mom's message neither counts for Aanya nor pings her; Aanya's never pings Mom.
    expect(pushes.filter((p) => p.userId === A_)).toHaveLength(1);
    expect(pushes.filter((p) => p.userId === M_)).toHaveLength(1);
    const view = (who: string) => s.call("GET", `${AREA}/threads`, who).then((r) => (r.body.threads as Array<{ id: string; people: Array<{ userId: string }>; last: { text: string } | null }>).find((t) => t.id === chat)!);
    expect((await view(A_)).people.map((p) => p.userId).sort()).toEqual([A_, R_].sort());
    // The chat's last line, seen from Mom, is the one before Aanya's.
    await s.say(A_, chat, "Back home");
    expect((await view(M_)).last?.text).toMatch(/Not me/);
    expect((await view(R_)).last?.text).toMatch(/Back home/);
  });

  it("takes each out of the other's lists of people, and hides what they share", async () => {
    const s = await served();
    const { id } = await s.home();
    const list = (await s.call("POST", `${AREA}/shares`, M_, { kind: "list", title: "Groceries", items: ["Milk"], access: "edit", to: { space: id } })).body.item.id as string;
    await s.call("POST", `${AREA}/blocks`, M_, { person: A_ });

    const members = async (who: string) => ((await s.call("GET", `${AREA}/spaces/${id}`, who)).body.space.members as Array<{ userId: string }>).map((m) => m.userId).sort();
    expect(await members(A_)).toEqual([A_, R_].sort());
    expect(await members(M_)).toEqual([M_, R_].sort());
    expect(await members(R_)).toEqual([A_, M_, R_].sort());
    expect(((await s.call("GET", `${AREA}/spaces`, A_)).body.spaces[0].members as Array<{ userId: string }>).map((m) => m.userId)).not.toContain(M_);
    expect(((await s.call("GET", `${AREA}/threads/contacts`, A_)).body.people as Array<{ userId: string }>).map((p) => p.userId)).toEqual([R_]);
    expect(((await s.call("GET", `${AREA}/share/targets`, M_)).body.people as Array<{ userId: string }>).map((p) => p.userId)).toEqual([R_]);
    // What Mom shared is unseen by Aanya, and Aanya can't start a group with her.
    expect(((await s.call("GET", `${AREA}/spaces/${id}`, A_)).body.items as unknown[])).toHaveLength(0);
    expect((await s.call("GET", `${AREA}/items/${list}`, A_)).status).toBe(404);
    expect(((await s.call("GET", `${AREA}/spaces/${id}`, R_)).body.items as unknown[])).toHaveLength(1);
    const g = await s.call("POST", `${AREA}/threads/group`, A_, { space: id, people: [M_, R_] });
    expect(g.status).toBe(403);
    expect(g.body.message).toMatch(/can't add Meera/);
  });

  it("lists who you blocked, and unblocking brings it all back; only the one who blocked can unblock", async () => {
    const s = await served();
    const { chat } = await s.home();
    await s.say(M_, chat, "Hello");
    await s.call("POST", `${AREA}/blocks`, A_, { person: M_ });
    expect((await s.call("POST", `${AREA}/blocks`, A_, { person: M_ })).body.already).toBe(true);
    const listed = (await s.call("GET", `${AREA}/blocks`, A_)).body.blocked;
    expect(listed).toEqual([{ userId: M_, name: "Meera S.", at: s.clock.t }]);
    expect((await s.call("GET", `${AREA}/blocks`, M_)).body.blocked).toEqual([]);
    expect((await s.call("GET", `${AREA}/people/${M_}`, A_)).body.person).toMatchObject({ name: "Meera S.", spaces: ["Home"], blockedByYou: true, canMessage: false });
    // Mom unblocking does nothing: it isn't hers.
    await s.call("DELETE", `${AREA}/blocks/${A_}`, M_);
    expect(await s.texts(A_, chat)).toEqual([]);
    expect((await s.call("DELETE", `${AREA}/blocks/${M_}`, A_)).status).toBe(200);
    expect(await s.texts(A_, chat)).toEqual(["Hello"]);
    expect((await s.call("POST", `${AREA}/threads/direct`, A_, { person: M_ })).status).toBe(200);
    expect((await s.call("GET", `${AREA}/people/${M_}`, A_)).body.person).toMatchObject({ blockedByYou: false, canMessage: true });
  });

  it("blocks only someone you've come across here", async () => {
    const s = await served();
    await s.home();
    expect((await s.call("POST", `${AREA}/blocks`, A_, { person: X_ })).status).toBe(404);
    expect((await s.call("POST", `${AREA}/blocks`, A_, { person: A_ })).status).toBe(404);
    expect((await s.call("GET", `${AREA}/people/${X_}`, A_)).status).toBe(404);
    expect((await s.call("POST", `${AREA}/blocks`, null, { person: M_ })).status).toBe(401);
  });
});

describe("reporting", () => {
  beforeEach(() => { resetSpaceTablesForTests(); resetAreaTablesForTests(); });

  it("reports someone's message with a reason: kept with a copy, due in a day, mailed to support once", async () => {
    const s = await served();
    const { chat } = await s.home();
    const msg = await s.say(R_, chat, "you are all idiots");
    const preview = (await s.call("GET", `${AREA}/reports/preview?kind=message&id=${msg}&thread=${chat}`, A_)).body;
    expect(preview).toMatchObject({ kind: "message", what: "A message from Rohan in Home's chat", text: "you are all idiots", person: { userId: R_, name: "Rohan" } });
    expect(preview.reasons.map((r: { id: string }) => r.id)).toContain("harassment");

    const r = await s.call("POST", `${AREA}/reports`, A_, { kind: "message", id: msg, thread: chat, reason: "harassment", note: "He keeps doing this" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ blocked: false, again: false, report: { dueBy: s.clock.t + 24 * HOUR }, message: expect.stringMatching(/within 24 hours/) });
    const mail = await s.outbox.byRef("safety_report", r.body.report.id);
    expect(mail).toMatchObject({ to_email: "support@x0bot.com", status: "queued" });
    expect(mail!.subject).toMatch(/Bullying or harassment/);
    expect(mail!.body_text).toContain("you are all idiots");
    expect(mail!.body_text).toContain("He keeps doing this");
    // The same message again: the first report stands, and nobody is mailed twice.
    const again = await s.call("POST", `${AREA}/reports`, A_, { kind: "message", id: msg, thread: chat, reason: "spam" });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ again: true, report: { id: r.body.report.id } });
    const listed = (await s.call("GET", "/v1/admin/reports", null, undefined, ADMIN)).body;
    expect(listed.open).toBe(1);
    expect(listed.reports[0]).toMatchObject({ kind: "message", reason: "harassment", reporter: { id: A_ }, reported: { id: R_, name: "Rohan" }, snapshot: { text: "you are all idiots" } });
  });

  it("only what you can see, never your own, always with a reason", async () => {
    const s = await served();
    const { chat } = await s.home();
    const msg = await s.say(R_, chat, "hi");
    expect((await s.call("POST", `${AREA}/reports`, R_, { kind: "message", id: msg, thread: chat, reason: "spam" })).status).toBe(400);
    expect((await s.call("POST", `${AREA}/reports`, A_, { kind: "message", id: msg, thread: chat, reason: "rude" })).status).toBe(400);
    expect((await s.call("POST", `${AREA}/reports`, A_, { kind: "message", id: msg, thread: chat })).status).toBe(400);
    expect((await s.call("POST", `${AREA}/reports`, X_, { kind: "message", id: msg, thread: chat, reason: "spam" })).status).toBe(404);
    expect((await s.call("POST", `${AREA}/reports`, X_, { kind: "person", id: R_, reason: "spam" })).status).toBe(404);
    expect((await s.call("POST", `${AREA}/reports`, A_, { kind: "thing", id: msg, reason: "spam" })).status).toBe(400);
  });

  it("reports a shared thing, and a person with Also block", async () => {
    const s = await served();
    const { id } = await s.home();
    const item = (await s.call("POST", `${AREA}/shares`, M_, { kind: "link", title: "Win a phone", url: "https://scam.example/x", to: { space: id } })).body.item.id as string;
    expect((await s.call("POST", `${AREA}/reports`, M_, { kind: "item", id: item, reason: "spam" })).status).toBe(400);
    const r = await s.call("POST", `${AREA}/reports`, R_, { kind: "item", id: item, reason: "spam" });
    expect(r.status).toBe(201);
    const p = await s.call("POST", `${AREA}/reports`, R_, { kind: "person", id: M_, reason: "harassment", block: true });
    expect(p.body).toMatchObject({ blocked: true, message: expect.stringMatching(/blocked them/) });
    expect((await s.call("GET", `${AREA}/blocks`, R_)).body.blocked.map((b: { userId: string }) => b.userId)).toEqual([M_]);
    const all = (await s.call("GET", "/v1/admin/reports", null, undefined, ADMIN)).body.reports as Array<{ kind: string; snapshot: Record<string, unknown> }>;
    expect(all.find((x) => x.kind === "item")!.snapshot).toMatchObject({ title: "Win a phone", url: "https://scam.example/x" });
    expect(all.find((x) => x.kind === "person")!.snapshot).toMatchObject({ name: "Meera S.", spaces: ["Home"] });
  });

  it(`takes at most ${REPORTS_A_DAY} reports from one person a day`, async () => {
    const s = await served();
    const { chat } = await s.home();
    for (let i = 0; i < REPORTS_A_DAY; i++) {
      const m = await s.say(R_, chat, `spam ${i}`);
      expect((await s.call("POST", `${AREA}/reports`, A_, { kind: "message", id: m, thread: chat, reason: "spam" })).status).toBe(201);
    }
    const m = await s.say(R_, chat, "one more");
    expect((await s.call("POST", `${AREA}/reports`, A_, { kind: "message", id: m, thread: chat, reason: "spam" })).status).toBe(429);
    s.clock.t += 25 * HOUR;
    expect((await s.call("POST", `${AREA}/reports`, A_, { kind: "message", id: m, thread: chat, reason: "spam" })).status).toBe(201);
  });
});

describe("the admin", () => {
  beforeEach(() => { resetSpaceTablesForTests(); resetAreaTablesForTests(); });

  it("needs the admin secret", async () => {
    const s = await served();
    expect((await s.call("GET", "/v1/admin/reports", A_)).status).toBe(401);
    expect((await s.call("PUT", "/v1/admin/reports/x", A_, { status: "dismissed" })).status).toBe(401);
  });

  it("sees what is late, takes the message out for everyone, and closes every report of it", async () => {
    const s = await served();
    const { chat } = await s.home();
    await s.say(A_, chat, "Morning");
    const bad = await s.say(R_, chat, "something awful");
    const one = (await s.call("POST", `${AREA}/reports`, A_, { kind: "message", id: bad, thread: chat, reason: "hate" })).body.report.id as string;
    await s.call("POST", `${AREA}/reports`, M_, { kind: "message", id: bad, thread: chat, reason: "hate" });
    s.clock.t += 25 * HOUR;
    const late = (await s.call("GET", "/v1/admin/reports", null, undefined, ADMIN)).body;
    expect(late).toMatchObject({ open: 2, overdue: 2 });
    expect(late.reports.every((r: { overdue: boolean }) => r.overdue)).toBe(true);

    const done = await s.call("PUT", `/v1/admin/reports/${one}`, null, { status: "actioned", remove: true }, ADMIN);
    expect(done.body.report).toMatchObject({ status: "actioned", action: "Took the message out", resolvedBy: "owner" });
    for (const who of [A_, M_, R_]) expect(await s.texts(who, chat)).toEqual(["Morning"]);
    const chats = (await s.call("GET", `${AREA}/threads`, M_)).body.threads as Array<{ id: string; last: { text: string } }>;
    expect(chats.find((t) => t.id === chat)!.last.text).toMatch(/Morning/);
    expect((await s.call("GET", "/v1/admin/reports", null, undefined, ADMIN)).body.open).toBe(0);
    expect(((await s.call("GET", "/v1/admin/reports?status=actioned", null, undefined, ADMIN)).body.reports as unknown[])).toHaveLength(2);
  });

  it("suspends the account, takes a shared thing out, and dismisses", async () => {
    const s = await served();
    const { id } = await s.home();
    const item = (await s.call("POST", `${AREA}/shares`, R_, { kind: "text", title: "Rude note", text: "rude", to: { space: id } })).body.item.id as string;
    const rep = (await s.call("POST", `${AREA}/reports`, A_, { kind: "item", id: item, reason: "harassment" })).body.report.id as string;
    const r = await s.call("PUT", `/v1/admin/reports/${rep}`, null, { remove: true, suspend: true }, ADMIN);
    expect(r.body.report.action).toBe("Took the shared thing out; Suspended the account");
    expect(s.suspended).toEqual([R_]);
    expect((await s.call("GET", `${AREA}/items/${item}`, M_)).status).toBe(404);
    const p = (await s.call("POST", `${AREA}/reports`, M_, { kind: "person", id: A_, reason: "other" })).body.report.id as string;
    expect((await s.call("PUT", `/v1/admin/reports/${p}`, null, { status: "dismissed" }, ADMIN)).body.report).toMatchObject({ status: "dismissed" });
    expect((await s.call("PUT", "/v1/admin/reports/00000000-0000-4000-8000-000000000000", null, { status: "dismissed" }, ADMIN)).status).toBe(404);
  });
});

describe("the screens", () => {
  type Client = "phone" | "desktop";
  const T = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", MSG = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
  const api: Record<string, unknown> = {
    [`GET ${AREA}/people/${M_}`]: { person: { userId: M_, name: "Meera", spaces: ["Home"], blockedByYou: false, canMessage: true } },
    [`GET ${AREA}/reports/preview?kind=message&id=${MSG}&thread=${T}`]: {
      kind: "message", what: "A message from Rohan in Home's chat", text: "you are all idiots", person: { userId: R_, name: "Rohan", blockedByYou: false },
      reasons: [{ id: "spam", label: "Spam or a scam" }, { id: "harassment", label: "Bullying or harassment" }],
    },
    [`GET ${AREA}/blocks`]: { blocked: [{ userId: M_, name: "Meera", at: Date.UTC(2026, 9, 20) }] },
    [`GET ${AREA}/threads/${T}`]: {
      thread: { id: T, kind: "space", name: "Home", spaceId: "s1", spaceName: "Home", people: [{ userId: A_, name: "Aanya", you: true }, { userId: R_, name: "Rohan", you: false }], last: null, unread: 0, muted: false, canPost: true, why: "" },
      messages: [
        { id: MSG, from: { userId: R_, name: "Rohan", you: false }, text: "you are all idiots", at: Date.UTC(2026, 9, 28, 5), files: [], item: null },
        { id: "cccccccc-3333-4333-8333-cccccccccccc", from: { userId: A_, name: "Aanya", you: true }, text: "Stop it", at: Date.UTC(2026, 9, 28, 5, 1), files: [], item: null },
      ],
      more: false, before: null,
    },
  };
  async function build(screenId: string, client: Client, params: Record<string, string> = {}) {
    const s = await buildBotsScreen({ screenId, client, params, tzOffsetMinutes: IST, user: { id: A_ }, can: new Set(["BotsKit"]), desk: { pages: client === "desktop", notes: false } },
      fakeDeps({ jobs: [], tasks: [], api }));
    const nodes = walk(s.root!);
    return { s, nodes, text: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? "")).join("\n"), json: JSON.stringify(s.root) };
  }

  for (const client of ["phone", "desktop"] as const) {
    it(`someone's page, the report screen and Blocked people, on the ${client}`, async () => {
      const person = await build("bots.person", client, { id: M_ });
      expect(lintTree(person.s.root!)).toEqual([]);
      expect(person.text).toContain("Report Meera");
      expect(person.text).toContain("Block Meera");
      expect(person.json).toContain(`"screenId":"bots.report"`);

      const report = await build("bots.report", client, { kind: "message", id: MSG, thread: T });
      expect(lintTree(report.s.root!)).toEqual([]);
      expect(report.text).toContain("you are all idiots");
      expect(report.text).toContain("Bullying or harassment");
      expect(report.text).toContain("Also block Rohan");
      expect(report.json).toContain(`"path":"${AREA}/reports"`);

      const blocked = await build("bots.blocked", client);
      expect(lintTree(blocked.s.root!)).toEqual([]);
      expect(blocked.text).toContain("Meera");
      expect(blocked.json).toContain(`"path":"${AREA}/blocks/${M_}"`);
    });

    it(`a chat offers Report under someone else's message, on the ${client}`, async () => {
      const t = await build("bots.thread", client, { id: T });
      expect(lintTree(t.s.root!)).toEqual([]);
      const reports = t.nodes.filter((n: Node) => JSON.stringify(n.on ?? {}).includes(`"screenId":"bots.report"`));
      expect(reports).toHaveLength(1);
      expect(JSON.stringify(reports[0]!.on)).toContain(MSG);
    });
  }

  it("is honest when it can't load", async () => {
    const r = await buildBotsScreen({ screenId: "bots.report", client: "phone", params: { kind: "message", id: "nope" }, tzOffsetMinutes: IST, user: { id: A_ }, can: new Set(["BotsKit"]), desk: { pages: false, notes: false } }, fakeDeps({ api: {} }));
    expect(lintTree(r.root!)).toEqual([]);
    expect(JSON.stringify(r.root)).toContain("Couldn't open this report");
  });
});
