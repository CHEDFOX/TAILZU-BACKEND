/**
 * THE MAIL BOT OVER HTTP (routes/bots/mail.ts, mail/worker.ts, mail/owners.ts, mail/access.ts): off unless it is set up; each page's call passed
 * to the worker inside the person's own account (a hash, never their id), with only the fields it takes (never a business's AI allowance), the
 * mailbox's folder and page only when they are one of its own, and an address's auto-reply put together from the form's flat fields; a bad id
 * refused before the worker hears of it; the worker's refusals in its own words; every call signed; the worker's notice that mail needs a person
 * pushed to the right person once, never with the mail's words; and an account deleted with its businesses.
 *
 * In a space: a member given an address sees the business with only that address, only its folders, conversations that involve it, its
 * drafts and activity, sends only from it, and is refused everything else as if it weren't there; their space's admin reaches a member's
 * business whole, inside the member's account; the lists merge the three with whose each is and who answers each address; who answers an
 * address given and taken back by the owner or their admin, only to a member of the owner's spaces; and the three pushes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

// The bearer is the person's id (a request without one is the dev user, as before).
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => ({ id: h?.replace(/^Bearer\s+/i, "").trim() || "dev-user", email: "someone@example.in" }) };
});

const Fastify = (await import("fastify")).default;
const { registerMailRoutes } = await import("../src/routes/bots/mail.js");
const { MemoryMailOwners } = await import("../src/mail/owners.js");
const { MemoryMailBusinesses, MemoryMailHandlers } = await import("../src/mail/access.js");
const { EVENT_PUSH_KINDS, PUSH_DEFAULTS } = await import("../src/push/defaults.js");
const { verdict } = await import("../src/you/push.js");
const { DEFAULT_SETTINGS } = await import("../src/you/settings.js");
const { isSpacePush } = await import("../src/botsBots/spacesSwitch.js");
const { mailWorker, MailError, ownerOf, mailForAccountDelete } = await import("../src/mail/worker.js");
const { workerSignature } = await import("../src/media/worker.js");
const { resetConfigForTests } = await import("../src/config.js");
const { builtinBots, isBuiltinSlug } = await import("../src/bots/builtin.js");
const { RESERVED_SLUGS } = await import("../src/bots/types.js");

const SECRET = "mail-secret-0123456789abcdef0123456789";
const ON = { MAIL_WORKER_URL: "http://mail-worker:5300", MAIL_WORKER_SECRET: SECRET };
afterEach(() => { for (const k of Object.keys(ON)) delete process.env[k]; resetConfigForTests(); });

const OWNER = ownerOf("dev-user");
const NOW = Date.UTC(2026, 10, 12, 9, 0, 0);
type Call = { owner: string; method: string; path: string; body: unknown };
type Worker = import("../src/mail/worker.js").MailWorker;

function fakeWorker(answer: (method: string, path: string) => unknown = () => ({ ok: true })) {
  const calls: Call[] = [];
  const w: Worker = { async call<T>(owner: string, method: string, path: string, body?: unknown) { calls.push({ owner, method, path, body }); return answer(method, path) as T; } };
  return { calls, w };
}

async function app(o: { on?: boolean; worker?: Worker | null } = {}) {
  if (o.on !== false) { Object.assign(process.env, ON); resetConfigForTests(); }
  const a = Fastify();
  const owners = new MemoryMailOwners();
  const pushes: Array<Record<string, unknown>> = [];
  const fake = fakeWorker((m, p) => (m === "POST" && p === "/businesses" ? { business: { id: "leaf-co" } } : { ok: true }));
  registerMailRoutes(a, {
    rateLimit: {}, bots: {}, worker: o.worker === undefined ? fake.w : o.worker, owners, secret: SECRET, now: () => NOW,
    businesses: new MemoryMailBusinesses(), handlers: new MemoryMailHandlers(),
    notify: async (userId, msg) => { pushes.push({ userId, ...msg }); },
  });
  await a.ready();
  return { a, owners, pushes, calls: fake.calls };
}

/** The worker's notice, signed as the worker signs it (mail-worker/server/notice.ts). */
function notice(body: Record<string, unknown>, o: { at?: number; nonce?: string; secret?: string } = {}) {
  const raw = JSON.stringify(body);
  const timestamp = Math.floor((o.at ?? NOW) / 1000);
  const nonce = o.nonce ?? Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32);
  const signature = workerSignature(o.secret ?? SECRET, { timestamp, nonce, method: "POST", pathWithQuery: "/v1/mail/notice", body: Buffer.from(raw) });
  return { method: "POST" as const, url: "/v1/mail/notice", payload: raw, headers: { "content-type": "application/json", "x-tailzu-timestamp": String(timestamp), "x-tailzu-nonce": nonce, "x-tailzu-signature": signature } };
}

describe("the mail bot", () => {
  it("is among the bots only where its service is set up, and its slug is nobody else's", () => {
    expect(builtinBots().some((b) => b.slug === "mail")).toBe(false);
    Object.assign(process.env, ON); resetConfigForTests();
    const mail = builtinBots().find((b) => b.slug === "mail")!;
    expect(mail).toMatchObject({ ownerId: null, colour: "sand", skills: { web: false, files: false, connectors: [] } });
    expect(isBuiltinSlug("mail")).toBe(true);
    expect(RESERVED_SLUGS).toContain("mail");
  });

  it("is off unless it is set up", async () => {
    const { a } = await app({ on: false });
    expect((await a.inject({ method: "GET", url: "/v1/mail/overview" })).json()).toMatchObject({ code: "mail_off" });
    expect((await a.inject(notice({ owner: OWNER, business: "leaf-co", name: "Leaf", status: "paused" }))).statusCode).toBe(404);
  });

  it("passes each page's call to the worker inside the person's own account, with only the fields it takes", async () => {
    const { a, calls, owners } = await app();
    expect(OWNER).toMatch(/^mail:[0-9a-f]{32}$/);
    expect(OWNER).not.toContain("dev-user");

    await a.inject({ method: "GET", url: "/v1/mail/overview" });
    const made = await a.inject({ method: "POST", url: "/v1/mail/businesses", payload: { name: "Leaf & Co", domain: "leafandco.in", dailyUsd: 50, owner: "someone" } });
    expect(made.statusCode).toBe(201);
    expect(await owners.userOf(OWNER)).toBe("dev-user");
    await a.inject({ method: "PUT", url: "/v1/mail/businesses/leaf-co", payload: { name: "Leaf", dailyUsd: 9 } });
    await a.inject({ method: "PUT", url: "/v1/mail/businesses/leaf-co/addresses/3", payload: { aiMode: "send", junk: 1 } });
    await a.inject({ method: "PUT", url: "/v1/mail/businesses/leaf-co/brief", payload: { about: "Bags.", knowledge: "Ships in 2 days.", voice: "", policies: "  ", sendDelayMinutes: 5, x: 1 } });
    await a.inject({ method: "PUT", url: "/v1/mail/businesses/leaf-co/brief", payload: { profile: { about: "Bags by hand." } } });
    await a.inject({ method: "GET", url: "/v1/mail/businesses/leaf-co/activity?limit=40&evil=1" });
    await a.inject({ method: "POST", url: "/v1/mail/businesses/leaf-co/replies/7/rewrite", payload: { instruction: "Shorter", text: "x" } });
    await a.inject({ method: "POST", url: "/v1/mail/businesses/leaf-co/replies/7/send" });
    await a.inject({ method: "DELETE", url: "/v1/mail/businesses/leaf-co/replies/7" });

    expect(calls.every((c) => c.owner === OWNER)).toBe(true);
    expect(calls.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: "GET", path: "/overview", body: undefined },
      { method: "POST", path: "/businesses", body: { name: "Leaf & Co", domain: "leafandco.in" } },
      { method: "PATCH", path: "/businesses/leaf-co", body: { name: "Leaf" } },
      { method: "PATCH", path: "/businesses/leaf-co/addresses/3", body: { aiMode: "send" } },
      // An empty voice or rules is left out: the worker keeps what it had (an empty rules field would drop "never promise a refund").
      { method: "PUT", path: "/businesses/leaf-co/brief", body: { profile: { about: "Bags.", knowledge: "Ships in 2 days.", sendDelayMinutes: 5 } } },
      { method: "PUT", path: "/businesses/leaf-co/brief", body: { profile: { about: "Bags by hand." } } },
      { method: "GET", path: "/businesses/leaf-co/activity?limit=40", body: undefined },
      { method: "POST", path: "/businesses/leaf-co/replies/7/rewrite", body: { instruction: "Shorter" } },
      { method: "POST", path: "/businesses/leaf-co/replies/7/send", body: {} },
      { method: "DELETE", path: "/businesses/leaf-co/replies/7", body: undefined },
    ]);
  });

  it("refuses a bad id before the worker hears of it", async () => {
    const { a, calls } = await app();
    expect((await a.inject({ method: "GET", url: "/v1/mail/businesses/Leaf_Co%2F..%2Fx" })).statusCode).toBe(404);
    expect((await a.inject({ method: "GET", url: "/v1/mail/businesses/leaf-co/replies/abc" })).statusCode).toBe(404);
    expect((await a.inject({ method: "PUT", url: "/v1/mail/businesses/leaf-co/addresses/0", payload: { aiMode: "off" } })).statusCode).toBe(404);
    expect(calls).toEqual([]);
  });

  it("passes the mailbox, the addresses and the rules on the same way: only a known folder, a page, the fields each takes", async () => {
    const { a, calls } = await app();
    await a.inject({ method: "GET", url: "/v1/mail/businesses/leaf-co/folders" });
    await a.inject({ method: "GET", url: "/v1/mail/businesses/leaf-co/messages?folder=f-Ab_9&page=2&limit=999" });
    // A folder that is not one of the mailbox's keys is not passed on.
    await a.inject({ method: "GET", url: "/v1/mail/businesses/leaf-co/messages?folder=..%2Foverview&page=x" });
    await a.inject({ method: "GET", url: "/v1/mail/businesses/leaf-co/threads/T-1_a" });
    await a.inject({ method: "POST", url: "/v1/mail/businesses/leaf-co/threads/T-1_a/archive", payload: { all: true } });
    await a.inject({ method: "POST", url: "/v1/mail/businesses/leaf-co/send", payload: { from: "hello@leafandco.in", to: "asha@customer.test", cc: "", subject: "Hi", text: "Hello.", replyTo: "m1", bcc: "x@y.z", headers: { a: 1 } } });
    await a.inject({ method: "POST", url: "/v1/mail/businesses/leaf-co/write", payload: { instruction: "Say thanks", from: "hello@leafandco.in", model: "big" } });
    await a.inject({ method: "GET", url: "/v1/mail/businesses/leaf-co/rules" });
    await a.inject({ method: "POST", url: "/v1/mail/businesses/leaf-co/rules", payload: { field: "from", op: "contains", value: "invoice", action: "move", target: "Billing", script: "x" } });
    await a.inject({ method: "POST", url: "/v1/mail/businesses/leaf-co/rules/4/toggle" });
    await a.inject({ method: "DELETE", url: "/v1/mail/businesses/leaf-co/rules/4" });
    // The address form sends the auto-reply flat; the worker takes it whole.
    await a.inject({ method: "PUT", url: "/v1/mail/businesses/leaf-co/addresses/2", payload: {
      label: "Support", displayName: "Leaf Support", autoReplyEnabled: true, autoReplySubject: "Got it", autoReplyBody: "Back soon.", autoReplyDays: "3", aiMode: "off",
    } });
    await a.inject({ method: "PUT", url: "/v1/mail/businesses/leaf-co/addresses/2", payload: { autoReplyEnabled: false } });

    expect(calls.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: "GET", path: "/businesses/leaf-co/folders", body: undefined },
      { method: "GET", path: "/businesses/leaf-co/messages?folder=f-Ab_9&page=2", body: undefined },
      { method: "GET", path: "/businesses/leaf-co/messages", body: undefined },
      { method: "GET", path: "/businesses/leaf-co/threads/T-1_a", body: undefined },
      { method: "POST", path: "/businesses/leaf-co/threads/T-1_a/archive", body: {} },
      { method: "POST", path: "/businesses/leaf-co/send", body: { from: "hello@leafandco.in", to: "asha@customer.test", cc: "", subject: "Hi", text: "Hello.", replyTo: "m1" } },
      { method: "POST", path: "/businesses/leaf-co/write", body: { instruction: "Say thanks", from: "hello@leafandco.in" } },
      { method: "GET", path: "/businesses/leaf-co/rules", body: undefined },
      { method: "POST", path: "/businesses/leaf-co/rules", body: { field: "from", op: "contains", value: "invoice", action: "move", target: "Billing" } },
      { method: "POST", path: "/businesses/leaf-co/rules/4/toggle", body: {} },
      { method: "DELETE", path: "/businesses/leaf-co/rules/4", body: undefined },
      { method: "PATCH", path: "/businesses/leaf-co/addresses/2", body: { label: "Support", aiMode: "off", displayName: "Leaf Support", autoReply: { enabled: true, subject: "Got it", body: "Back soon.", days: 3 } } },
      { method: "PATCH", path: "/businesses/leaf-co/addresses/2", body: { autoReply: { enabled: false, subject: "", body: "", days: 1 } } },
    ]);
  });

  it("refuses an unknown action, a bad conversation or a bad rule before the worker hears of it", async () => {
    const { a, calls } = await app();
    expect((await a.inject({ method: "POST", url: "/v1/mail/businesses/leaf-co/threads/T1/destroy" })).statusCode).toBe(404);
    expect((await a.inject({ method: "GET", url: "/v1/mail/businesses/leaf-co/threads/a.b" })).statusCode).toBe(404);
    expect((await a.inject({ method: "DELETE", url: "/v1/mail/businesses/leaf-co/rules/0" })).statusCode).toBe(404);
    expect((await a.inject({ method: "POST", url: "/v1/mail/businesses/leaf-co/rules/x1/toggle" })).statusCode).toBe(404);
    expect(calls).toEqual([]);
  });

  it("says the worker's refusal in its own words, with its status", async () => {
    const refusing: Worker = { async call() { throw new MailError(409, "bad_request", "That reply was already sent or thrown away."); } };
    const { a } = await app({ worker: refusing });
    const r = await a.inject({ method: "POST", url: "/v1/mail/businesses/leaf-co/replies/7/send" });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ code: "bad_request", message: "That reply was already sent or thrown away." });
  });
});

describe("the worker's client", () => {
  it("signs every call over the method, the path inside the account and the body", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const w = mailWorker({
      url: "http://mail-worker:5300/", secret: SECRET, now: () => NOW,
      fetchFn: (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(JSON.stringify({ business: { id: "leaf-co" } }), { status: 201 }); }) as typeof fetch,
    })!;
    expect(await w.call(OWNER, "POST", "/businesses", { name: "Leaf", domain: "leafandco.in" })).toEqual({ business: { id: "leaf-co" } });
    const { url, init } = seen[0]!;
    expect(url).toBe(`http://mail-worker:5300/v1/o/${OWNER}/businesses`);
    const h = init.headers as Record<string, string>;
    expect(h["x-tailzu-timestamp"]).toBe(String(NOW / 1000));
    expect(h["x-tailzu-signature"]).toBe(workerSignature(SECRET, {
      timestamp: NOW / 1000, nonce: h["x-tailzu-nonce"]!, method: "POST", pathWithQuery: `/v1/o/${OWNER}/businesses`, body: Buffer.from(JSON.stringify({ name: "Leaf", domain: "leafandco.in" })),
    }));
    await expect(w.call("dev-user", "GET", "/overview")).rejects.toMatchObject({ status: 400 });
  });

  it("passes on what the worker refused, and says plainly when it cannot be reached", async () => {
    const answering = (status: number, body: unknown) => mailWorker({ url: "http://w", secret: SECRET, fetchFn: (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch })!;
    await expect(answering(404, { code: "bad_request", message: "No such business." }).call(OWNER, "GET", "/businesses/x")).rejects.toMatchObject({ status: 404, message: "No such business." });
    await expect(answering(429, { code: "ai", message: "The allowance is used up." }).call(OWNER, "POST", "/businesses/x/brief/draft", {})).rejects.toMatchObject({ status: 429 });
    await expect(answering(500, { code: "failed", message: "Something went wrong on the mail server." }).call(OWNER, "GET", "/overview")).rejects.toMatchObject({ status: 502, message: "Something went wrong on the mail server." });
    // Our own signature refused is a setting, not something the person can fix.
    await expect(answering(401, { code: "auth", message: "Not signed." }).call(OWNER, "GET", "/overview")).rejects.toMatchObject({ status: 503, code: "mail_down" });
    const down = mailWorker({ url: "http://w", secret: SECRET, fetchFn: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch })!;
    await expect(down.call(OWNER, "GET", "/overview")).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/couldn't be reached/) });
    expect(mailWorker({ url: "", secret: SECRET })).toBeNull();
  });
});

describe("mail that needs a person", () => {
  const BODY = { owner: OWNER, business: "leaf-co", name: "Leaf & Co", status: "needs_person", run: 7, kind: "complaint", priority: "urgent" };

  it("pushes to the person behind the account, with what kind of message it is and never its words, once", async () => {
    const { a, owners, pushes } = await app();
    await owners.keep("dev-user", OWNER);
    const req = notice(BODY, { nonce: "a".repeat(32) });
    const r = await a.inject(req);
    expect(r.json()).toEqual({ ok: true, pushed: true });
    expect(pushes).toEqual([{ userId: "dev-user", kind: "mail_needs_you", key: "leaf-co:7", vars: { business: "Leaf & Co", what: "A complaint" }, data: { b: "leaf-co", run: "7" } }]);
    // The same call again is a replay.
    expect((await a.inject(req)).statusCode).toBe(401);
    expect(pushes).toHaveLength(1);
  });

  it("tells an urgent draft and a paused day apart", async () => {
    const { a, owners, pushes } = await app();
    await owners.keep("dev-user", OWNER);
    await a.inject(notice({ ...BODY, status: "drafted", run: 8, kind: "order" }));
    await a.inject(notice({ owner: OWNER, business: "leaf-co", name: "Leaf & Co", status: "paused" }));
    expect(pushes.map((p) => [p.kind, p.key, p.data])).toEqual([
      ["mail_urgent", "leaf-co:8", { b: "leaf-co", run: "8" }],
      ["mail_paused", "leaf-co:paused:2026-11-12", { slug: "mail" }],
    ]);
  });

  it("refuses a notice not signed with the secret, an old one, or one for nobody", async () => {
    const { a, owners, pushes } = await app();
    await owners.keep("dev-user", OWNER);
    expect((await a.inject(notice(BODY, { secret: "x".repeat(40) }))).statusCode).toBe(401);
    expect((await a.inject(notice(BODY, { at: NOW - 120_000 }))).statusCode).toBe(401);
    expect((await a.inject({ method: "POST", url: "/v1/mail/notice", payload: BODY })).statusCode).toBe(401);
    expect((await a.inject(notice({ ...BODY, run: "7; drop" }))).statusCode).toBe(400);
    expect((await a.inject(notice({ ...BODY, owner: ownerOf("someone-else") }))).json()).toEqual({ ok: true, pushed: false });
    expect(pushes).toEqual([]);
  });
});

describe("an account deleted", () => {
  it("takes its businesses with it, and says when the worker could not be reached", async () => {
    const { w, calls } = fakeWorker();
    expect(await mailForAccountDelete("dev-user", w)).toBe(true);
    expect(calls).toEqual([{ owner: OWNER, method: "DELETE", path: "", body: undefined }]);
    expect(await mailForAccountDelete("dev-user", null)).toBe(true);
    expect(await mailForAccountDelete("dev-user", { async call() { throw new MailError(503, "mail_down", "down"); } })).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------ in a space

type View = import("../src/mail/digest.js").MailBusinessView;
type People = import("../src/meet/people.js").MeetPeople;

const RAVI = "u-ravi";
const AANYA = "u-aanya";
const SAM = "u-sam";
const NEW = "u-new";
const STRANGER = "u-stranger";
const as = (user: string) => ({ authorization: `Bearer ${user}` });

/**
 * Aanya is the admin of Home, where Ravi agreed to the line about her; Ravi is the admin of Shop, where Sam and New did (people.ts decides
 * that; here it is given). Someone in `gone` has left; `off` is Spaces off: nobody.
 */
function family(gone: Set<string> = new Set(), o: { off?: boolean } = {}): People {
  const spaces = [
    { id: "s-home", admin: AANYA, adminName: "Aanya Sharma", members: [{ id: RAVI, name: "Ravi Kumar" }] },
    { id: "s-shop", admin: RAVI, adminName: "Ravi K.", members: [{ id: SAM, name: "Sam Lee" }, { id: NEW, name: "New One" }] },
  ];
  return {
    async membersOf(adminId) {
      return o.off ? [] : spaces.filter((s) => s.admin === adminId).flatMap((s) => s.members.filter((m) => !gone.has(m.id)).map((m) => ({ userId: m.id, name: m.name, spaceId: s.id })));
    },
    async adminsOf(memberId) {
      return o.off || gone.has(memberId) ? [] : spaces.filter((s) => s.members.some((m) => m.id === memberId))
        .map((s) => ({ userId: s.admin, name: s.adminName, spaceId: s.id, memberName: s.members.find((m) => m.id === memberId)!.name }));
    },
  };
}

const at = (domain: string, id: number, local: string, label = "", isPrimary = false) =>
  ({ id, email: `${local}@${domain}`, label, isPrimary, aiMode: "draft" as const, displayName: "", autoReply: null });
const LEAF: View = {
  id: "leaf-co", name: "Leaf & Co", domain: "leafandco.in", email: "hello@leafandco.in", signature: "", ready: true,
  mailApp: { incoming: "mail.x0bot.com", outgoing: "mail.x0bot.com", user: "hello@leafandco.in" }, allowance: { spentUsd: 0.12, capUsd: 1 },
  addresses: [at("leafandco.in", 1, "hello", "", true), at("leafandco.in", 2, "support", "Support"), at("leafandco.in", 3, "billing", "Billing")],
};
/** Ravi's other business: its main address alone, so its mailbox has no folder of that address's own. */
const SOLO: View = { ...LEAF, id: "solo-co", name: "Solo", domain: "solo.in", email: "hello@solo.in", addresses: [at("solo.in", 21, "hello", "", true)] };
const CHAI: View = { ...LEAF, id: "chai-co", name: "Chai", domain: "chai.in", email: "hi@chai.in", addresses: [at("chai.in", 31, "hi", "", true)] };

const sys = (key: string, name: string) => ({ key, id: key, name, role: key, kind: "system", unread: 0, total: 0 });
const FOLDERS = [
  { ...sys("inbox", "Inbox"), unread: 3, total: 9 },
  { key: "main", id: "inbox", name: "Hello", role: null, kind: "address", unread: 0, total: 0, email: "hello@leafandco.in" },
  { key: "f-sup", id: "sup", name: "Support", role: null, kind: "address", unread: 1, total: 4, email: "support@leafandco.in" },
  { key: "f-bil", id: "bil", name: "Billing", role: null, kind: "address", unread: 2, total: 3, email: "billing@leafandco.in" },
  sys("drafts", "Drafts"), sys("sent", "Sent"), sys("trash", "Trash"),
  { key: "f-rec", id: "rec", name: "Receipts", role: null, kind: "folder", unread: 0, total: 1 },
];
const SOLO_FOLDERS = [{ ...sys("inbox", "Inbox"), unread: 2, total: 5 }, sys("drafts", "Drafts"), sys("sent", "Sent")];

const message = (id: string, from: string, to: string[], cc: string[] = []) => ({
  id, from: { name: "", email: from }, to: to.map((email) => ({ name: "", email })), cc: cc.map((email) => ({ name: "", email })), at: 1, text: "…", unread: true, mine: false, attachments: [],
});
const THREADS: Record<string, Record<string, unknown>> = {
  "t-sup": { threadId: "t-sup", subject: "Login trouble", messages: [message("m-sup", "asha@customer.test", ["Support@LeafandCo.in"]), message("m-sup2", "support@leafandco.in", ["asha@customer.test"])] },
  "t-bil": { threadId: "t-bil", subject: "Invoice", messages: [message("m-bil", "ravi@customer.test", ["billing@leafandco.in"])] },
  "t-cc": { threadId: "t-cc", subject: "Hello", messages: [message("m-cc", "x@customer.test", ["hello@leafandco.in"], ["support@leafandco.in"])] },
};

const run = (id: number, company: string, address: string, status: string, priority = "normal") => ({
  id, companyId: company, address, sender: "asha@customer.test", subject: "Hi", kind: "support", priority, summary: "Asks", status, reason: null, sendAt: null, createdAt: NOW - id * 1000,
});
const RUNS = [
  run(7, "leaf-co", "support@leafandco.in", "needs_person", "urgent"), run(8, "leaf-co", "billing@leafandco.in", "drafted"),
  run(9, "leaf-co", "hello@leafandco.in", "scheduled"), run(10, "leaf-co", "support@leafandco.in", "sent"),
];
const WAITING = RUNS.filter((r) => r.status !== "sent");
const CHAI_RUN = run(41, "chai-co", "hi@chai.in", "drafted", "urgent");
const today = (n: number) => ({ received: n, answered: 0, drafted: 0, needsPerson: 0, filed: 0 });

/** The worker, with each account's businesses: Ravi's Leaf & Co and Solo, Aanya's Chai. Another account's business is "no such business". */
function spaceWorker() {
  const calls: Call[] = [];
  const list = (owner: string): View[] => (owner === ownerOf(RAVI) ? [LEAF, SOLO] : owner === ownerOf(AANYA) ? [CHAI] : []);
  const w: Worker = {
    async call<T>(owner: string, method: string, path: string, body?: unknown): Promise<T> {
      calls.push({ owner, method, path, body });
      const [route, query = ""] = path.split("?");
      const mine = list(owner);
      if (route === "/overview") {
        return { businesses: mine, waiting: owner === ownerOf(RAVI) ? WAITING : owner === ownerOf(AANYA) ? [CHAI_RUN] : [], today: today(owner === ownerOf(RAVI) ? 9 : owner === ownerOf(AANYA) ? 2 : 0) } as T;
      }
      if (route === "/businesses" && method === "GET") return { businesses: mine } as T;
      if (route === "/businesses" && method === "POST") {
        const b = body as { name: string; domain: string };
        return { business: { ...CHAI, id: b.name.toLowerCase(), name: b.name, domain: b.domain, email: `hello@${b.domain}`, addresses: [at(b.domain, 51, "hello", "", true)] } } as T;
      }
      const m = /^\/businesses\/([a-z0-9-]+)(\/.*)?$/.exec(route!);
      const biz = m ? mine.find((b) => b.id === m[1]) : undefined;
      if (!m || !biz) throw new MailError(404, "bad_request", "No such business.");
      const sub = m[2] ?? "";
      if (sub === "" && method === "GET") return { business: biz } as T;
      if (sub === "/folders") return { folders: biz.id === "solo-co" ? SOLO_FOLDERS : FOLDERS } as T;
      if (sub === "/messages") {
        const all = biz.id === "solo-co" ? SOLO_FOLDERS : FOLDERS;
        const folder = all.find((f) => f.key === new URLSearchParams(query).get("folder")) ?? all[0];
        return { folder, folders: all, page: 0, more: false, total: 1, messages: [{ id: "m-1", threadId: "t-1", subject: "Hi" }] } as T;
      }
      const t = /^\/threads\/([^/]+)(\/[a-z]+)?$/.exec(sub);
      if (t) {
        if (!THREADS[t[1]!]) throw new MailError(404, "bad_request", "No such conversation: it was deleted.");
        return (t[2] ? { ok: true } : THREADS[t[1]!]) as T;
      }
      if (sub === "/activity") return { runs: RUNS } as T;
      const r = /^\/replies\/(\d+)(\/[a-z]+)?$/.exec(sub);
      if (r) {
        const x = RUNS.find((y) => y.id === Number(r[1]));
        if (!x) throw new MailError(404, "ai", "No such reply.");
        return (method === "GET" ? { status: x.status, reason: "", sendAt: null, address: x.address, to: "asha@customer.test", subject: "Re: Hi", text: "Hello.", message: null } : { ok: true }) as T;
      }
      if (sub === "/send") return { ok: true, id: "sent-1" } as T;
      if (sub === "/write") return { text: "Written." } as T;
      const a = /^\/addresses\/(\d+)$/.exec(sub);
      if (a && method === "DELETE") return { business: { ...biz, addresses: biz.addresses.filter((x) => x.id !== Number(a[1])) } } as T;
      return { ok: true } as T;
    },
  };
  return { calls, w };
}

/** The server with Spaces as `family` has them: Leaf & Co and Solo are Ravi's, Chai is Aanya's, and Ravi gave Sam support@ (unless `give` is false). */
async function spaceApp(o: { people?: People; give?: boolean } = {}) {
  Object.assign(process.env, ON); resetConfigForTests();
  const a = Fastify();
  const owners = new MemoryMailOwners();
  const businesses = new MemoryMailBusinesses();
  const handlers = new MemoryMailHandlers();
  const pushes: Array<Record<string, unknown>> = [];
  const gone = new Set<string>();
  const fake = spaceWorker();
  registerMailRoutes(a, {
    rateLimit: {}, bots: {}, worker: fake.w, owners, businesses, handlers, people: o.people ?? family(gone), secret: SECRET, now: () => NOW,
    nameOf: async (u) => ({ [AANYA]: "Aanya", [RAVI]: "Ravi" } as Record<string, string>)[u] ?? "",
    notify: async (userId, msg) => { pushes.push({ userId, ...msg }); },
  });
  await a.ready();
  for (const [id, owner] of [["leaf-co", RAVI], ["solo-co", RAVI], ["chai-co", AANYA]] as const) await businesses.keep(id, owner);
  if (o.give !== false) await handlers.give({ businessId: "leaf-co", ownerId: RAVI, addressId: 2, addressEmail: "support@leafandco.in", memberId: SAM });
  const call = (user: string, method: string, path: string, payload?: unknown) =>
    a.inject({ method: method as "GET", url: `/v1/mail${path}`, headers: as(user), ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { a, call, calls: fake.calls, pushes, owners, businesses, handlers, gone };
}

const L = "/businesses/leaf-co";

describe("in a space: a member who answers an address", () => {
  it("sees the business with only that address, no mail-app login, whose it is, every call inside the owner's account", async () => {
    const { call, calls } = await spaceApp();
    const r = await call(SAM, "GET", L);
    expect(r.statusCode).toBe(200);
    const b = r.json().business as View;
    expect(b).toMatchObject({ id: "leaf-co", access: "handler", owner: { id: RAVI, name: "Ravi K." }, email: "support@leafandco.in", allowance: LEAF.allowance });
    expect(b.mailApp).toBeUndefined();
    expect(b.addresses).toEqual([at("leafandco.in", 2, "support", "Support")]);
    expect(calls.map((c) => [c.owner, c.method, c.path])).toEqual([[ownerOf(RAVI), "GET", L]]);
  });

  it("sees only their folders, and reads only those: All mail, Sent, another address's or any other folder is refused", async () => {
    const { call, calls } = await spaceApp();
    expect((await call(SAM, "GET", `${L}/folders`)).json().folders.map((f: { key: string }) => f.key)).toEqual(["f-sup"]);
    const ok = await call(SAM, "GET", `${L}/messages?folder=f-sup&page=1`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().folder.key).toBe("f-sup");
    expect(ok.json().folders.map((f: { key: string }) => f.key)).toEqual(["f-sup"]);
    for (const folder of ["f-bil", "inbox", "main", "sent", "drafts", "f-rec"]) {
      expect((await call(SAM, "GET", `${L}/messages?folder=${folder}`)).json(), folder).toEqual({ code: "not_found", message: "Not found." });
    }
    expect((await call(SAM, "GET", `${L}/messages`)).statusCode).toBe(404);
    expect(calls.filter((c) => c.path.includes("/messages")).map((c) => c.path)).toEqual([`${L}/messages?folder=f-sup&page=1`]);
  });

  it("gets the main address's own folder when it is theirs, and for a business with that address alone, its Inbox as it", async () => {
    const { call, calls, handlers } = await spaceApp();
    await handlers.give({ businessId: "leaf-co", ownerId: RAVI, addressId: 1, addressEmail: "hello@leafandco.in", memberId: SAM });
    expect((await call(SAM, "GET", `${L}/folders`)).json().folders.map((f: { key: string }) => f.key)).toEqual(["main", "f-sup"]);
    await handlers.give({ businessId: "solo-co", ownerId: RAVI, addressId: 21, addressEmail: "hello@solo.in", memberId: SAM });
    const folders = (await call(SAM, "GET", "/businesses/solo-co/folders")).json().folders;
    expect(folders).toEqual([{ key: "main", id: "inbox", name: "Hello", role: null, kind: "address", unread: 2, total: 5, email: "hello@solo.in" }]);
    calls.length = 0;
    const r = await call(SAM, "GET", "/businesses/solo-co/messages?folder=main");
    expect(r.json().folder).toEqual(folders[0]);
    expect(r.json().folders).toEqual(folders);
    expect(calls.map((c) => c.path)).toContain("/businesses/solo-co/messages?folder=inbox");
    expect((await call(SAM, "GET", "/businesses/solo-co/messages?folder=inbox")).statusCode).toBe(404);
  });

  it("opens only a conversation that involves their address, looked at first without marking it read", async () => {
    const { call, calls } = await spaceApp();
    const t = await call(SAM, "GET", `${L}/threads/t-sup`);
    expect(t.statusCode).toBe(200);
    expect(t.json().threadId).toBe("t-sup");
    // Looked at, then marked read: the owner's opening does the same.
    expect(calls.map((c) => [c.method, c.path])).toEqual([["GET", `${L}/threads/t-sup?peek=1`], ["POST", `${L}/threads/t-sup/read`]]);
    // Copied to it counts too.
    expect((await call(SAM, "GET", `${L}/threads/t-cc`)).statusCode).toBe(200);
    calls.length = 0;
    expect((await call(SAM, "GET", `${L}/threads/t-bil`)).json()).toEqual({ code: "not_found", message: "Not found." });
    expect((await call(SAM, "POST", `${L}/threads/t-bil/archive`)).statusCode).toBe(404);
    // Someone else's conversation was only looked at: nothing marked read, nothing archived.
    expect(calls.map((c) => [c.method, c.path])).toEqual([["GET", `${L}/threads/t-bil?peek=1`], ["GET", `${L}/threads/t-bil?peek=1`]]);
    expect((await call(SAM, "POST", `${L}/threads/t-sup/archive`)).statusCode).toBe(200);
    expect(calls.at(-1)).toMatchObject({ owner: ownerOf(RAVI), method: "POST", path: `${L}/threads/t-sup/archive` });
  });

  it("sends only from their address, and replies or forwards only within a conversation of theirs", async () => {
    const { call, calls } = await spaceApp();
    const mail = { to: "asha@customer.test", subject: "Hi", text: "Hello." };
    for (const body of [
      { ...mail, from: "billing@leafandco.in" }, { ...mail, from: "hello@leafandco.in" }, mail,
      { ...mail, from: "support@leafandco.in", replyTo: "m-sup" },
      { ...mail, from: "support@leafandco.in", replyTo: "m-bil", tid: "t-sup" },
      { ...mail, from: "support@leafandco.in", replyTo: "m-bil", tid: "t-bil" },
      { ...mail, from: "support@leafandco.in", forward: "m-bil", tid: "t-sup" },
      { ...mail, from: "support@leafandco.in", replyTo: "m-sup", tid: "../t-sup" },
    ]) expect((await call(SAM, "POST", `${L}/send`, body)).statusCode, JSON.stringify(body)).toBe(404);
    for (const body of [{ instruction: "Say thanks", from: "billing@leafandco.in" }, { instruction: "Answer it", from: "support@leafandco.in", replyTo: "m-bil", tid: "t-bil" }]) {
      expect((await call(SAM, "POST", `${L}/write`, body)).statusCode, JSON.stringify(body)).toBe(404);
    }
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);

    expect((await call(SAM, "POST", `${L}/send`, { ...mail, from: "Support@leafandco.in" })).statusCode).toBe(200);
    expect((await call(SAM, "POST", `${L}/send`, { ...mail, from: "support@leafandco.in", replyTo: "m-sup", tid: "t-sup" })).statusCode).toBe(200);
    expect((await call(SAM, "POST", `${L}/send`, { ...mail, from: "support@leafandco.in", forward: "m-sup2", tid: "t-sup" })).statusCode).toBe(200);
    expect((await call(SAM, "POST", `${L}/write`, { instruction: "Answer it", from: "support@leafandco.in", replyTo: "m-sup", tid: "t-sup" })).json()).toEqual({ text: "Written." });
    expect((await call(SAM, "POST", `${L}/write`, { instruction: "Tell them we open at 9", from: "support@leafandco.in" })).statusCode).toBe(200);
    // Passed on inside the owner's account, with the fields each takes: never the tid.
    expect(calls.filter((c) => c.method === "POST").map(({ owner, path, body }) => ({ owner, path, body }))).toEqual([
      { owner: ownerOf(RAVI), path: `${L}/send`, body: { ...mail, from: "Support@leafandco.in" } },
      { owner: ownerOf(RAVI), path: `${L}/send`, body: { ...mail, from: "support@leafandco.in", replyTo: "m-sup" } },
      { owner: ownerOf(RAVI), path: `${L}/send`, body: { ...mail, from: "support@leafandco.in", forward: "m-sup2" } },
      { owner: ownerOf(RAVI), path: `${L}/write`, body: { instruction: "Answer it", from: "support@leafandco.in", replyTo: "m-sup" } },
      { owner: ownerOf(RAVI), path: `${L}/write`, body: { instruction: "Tell them we open at 9", from: "support@leafandco.in" } },
    ]);
  });

  it("reads the AI's activity and drafts for their address only: another address's draft is read, never sent or changed", async () => {
    const { call, calls } = await spaceApp();
    expect((await call(SAM, "GET", `${L}/activity`)).json().runs.map((r: { id: number }) => r.id)).toEqual([7, 10]);
    expect((await call(SAM, "GET", `${L}/activity?limit=1`)).json().runs.map((r: { id: number }) => r.id)).toEqual([7]);
    expect(calls.map((c) => c.path)).toEqual([`${L}/activity?limit=200`, `${L}/activity?limit=200`]);
    expect((await call(SAM, "GET", `${L}/replies/7`)).json()).toMatchObject({ address: "support@leafandco.in", text: "Hello." });
    calls.length = 0;
    for (const [method, path, body] of [["GET", "/replies/8"], ["POST", "/replies/8/send"], ["PUT", "/replies/8", { text: "x" }], ["DELETE", "/replies/8"],
      ["POST", "/replies/8/rewrite", { instruction: "Shorter" }], ["POST", "/replies/8/stop"]] as Array<[string, string, unknown?]>) {
      expect((await call(SAM, method, `${L}${path}`, body)).statusCode, `${method} ${path}`).toBe(404);
    }
    expect(calls.every((c) => c.method === "GET" && c.path === `${L}/replies/8`)).toBe(true);
    expect((await call(SAM, "POST", `${L}/replies/7/send`)).statusCode).toBe(200);
    expect((await call(SAM, "POST", `${L}/replies/7/rewrite`, { instruction: "Shorter" })).statusCode).toBe(200);
    expect(calls.slice(-4).map((c) => [c.method, c.path, c.body])).toEqual([
      ["GET", `${L}/replies/7`, undefined], ["POST", `${L}/replies/7/send`, {}], ["GET", `${L}/replies/7`, undefined], ["POST", `${L}/replies/7/rewrite`, { instruction: "Shorter" }],
    ]);
  });

  it("is refused the rest of the business, as if it weren't there: records, personality, rules, addresses, settings, who answers", async () => {
    const { call, calls } = await spaceApp();
    for (const [method, path, body] of [
      ["GET", "/dns"], ["GET", "/brief"], ["PUT", "/brief", { about: "Mine" }], ["POST", "/brief/draft", {}],
      ["POST", "/addresses", { local: "sam" }], ["PUT", "/addresses/2", { aiMode: "send" }], ["DELETE", "/addresses/2"],
      ["POST", "/addresses/2/handlers", { memberId: NEW }], ["DELETE", `/addresses/2/handlers/${SAM}`],
      ["GET", "/rules"], ["POST", "/rules", { field: "from", op: "contains", value: "x", action: "move", target: "Y" }], ["DELETE", "/rules/4"], ["POST", "/rules/4/toggle"],
      ["PUT", "", { name: "Sam & Co" }], ["DELETE", ""], ["POST", "/mail-app-password", { password: "a-long-password-1" }],
    ] as Array<[string, string, unknown?]>) {
      expect((await call(SAM, method, `${L}${path}`, body)).json(), `${method} ${path}`).toEqual({ code: "not_found", message: "Not found." });
    }
    expect(calls).toEqual([]);
  });

  it("nobody else finds it: a stranger, a member never given an address, one who left, and anyone but the owner while Spaces is off", async () => {
    const { call, calls, gone } = await spaceApp();
    for (const who of [STRANGER, NEW]) expect((await call(who, "GET", L)).json()).toEqual({ code: "bad_request", message: "No such business." });
    gone.add(SAM);
    expect((await call(SAM, "GET", L)).statusCode).toBe(404);
    expect((await call(SAM, "GET", `${L}/threads/t-sup`)).statusCode).toBe(404);
    expect(calls).toEqual([]);

    const off = await spaceApp({ people: family(new Set(), { off: true }) });
    for (const who of [SAM, AANYA]) expect((await off.call(who, "GET", L)).statusCode, who).toBe(404);
    expect((await off.call(RAVI, "GET", L)).statusCode).toBe(200);
    expect((await off.call(AANYA, "GET", "/overview")).json().businesses.map((b: View) => b.id)).toEqual(["chai-co"]);
    expect((await off.call(SAM, "GET", "/overview")).json()).toMatchObject({ businesses: [], waiting: [], people: [] });
  });
});

describe("in a space: the admin", () => {
  it("reaches a member's business whole, as the owner, every call inside the member's account", async () => {
    const { call, calls } = await spaceApp();
    const b = (await call(AANYA, "GET", L)).json().business as View;
    expect(b).toMatchObject({ access: "admin", owner: { id: RAVI, name: "Ravi Kumar" }, mailApp: LEAF.mailApp });
    expect(b.addresses.map((a) => [a.email, a.handledBy])).toEqual([
      ["hello@leafandco.in", []], ["support@leafandco.in", [{ id: SAM, name: "Sam Lee" }]], ["billing@leafandco.in", []],
    ]);
    for (const [method, path, body] of [
      ["GET", "/dns"], ["PUT", "/brief", { about: "Bags." }], ["GET", "/folders"], ["GET", "/messages?folder=inbox"], ["GET", "/threads/t-bil"],
      ["POST", "/send", { from: "hello@leafandco.in", to: "a@b.in", text: "Hi", tid: "t-bil" }], ["POST", "/rules", { field: "from", value: "x", action: "star" }],
      ["POST", "/mail-app-password", { password: "a-long-password-1" }], ["GET", "/replies/8"], ["POST", "/replies/8/send"],
    ] as Array<[string, string, unknown?]>) {
      expect((await call(AANYA, method, `${L}${path}`, body)).statusCode, `${method} ${path}`).toBe(200);
    }
    expect(calls.every((c) => c.owner === ownerOf(RAVI))).toBe(true);
    // The owner's paths, no look first: the conversation is opened (and marked read) as the owner opens it.
    expect(calls.map((c) => c.path)).toContain(`${L}/threads/t-bil`);
    expect(calls.find((c) => c.path === `${L}/send`)?.body).toEqual({ from: "hello@leafandco.in", to: "a@b.in", text: "Hi" });
  });

  it("removing an address or the business takes who answers it with it", async () => {
    const { call, handlers, businesses } = await spaceApp();
    await handlers.give({ businessId: "leaf-co", ownerId: RAVI, addressId: 3, addressEmail: "billing@leafandco.in", memberId: SAM });
    const r = await call(AANYA, "DELETE", `${L}/addresses/3`);
    expect(r.json().business.addresses.map((a: { id: number }) => a.id)).toEqual([1, 2]);
    expect((await handlers.ofMember(SAM)).map((h) => h.addressId)).toEqual([2]);
    expect((await call(AANYA, "DELETE", L)).json()).toEqual({ ok: true });
    expect(await handlers.ofMember(SAM)).toEqual([]);
    expect(await businesses.whose("leaf-co")).toBeNull();
  });
});

describe("in a space: the lists", () => {
  it("an admin's: their own, then each member's whole (whose it is, who answers each address), what waits across them, the people they look after", async () => {
    const { call, calls } = await spaceApp();
    const o = (await call(AANYA, "GET", "/overview")).json();
    expect(o.businesses.map((b: View) => [b.id, b.access, b.owner ?? null])).toEqual([
      ["chai-co", "own", null], ["leaf-co", "admin", { id: RAVI, name: "Ravi Kumar" }], ["solo-co", "admin", { id: RAVI, name: "Ravi Kumar" }],
    ]);
    expect(o.businesses[1].addresses.find((a: { id: number }) => a.id === 2).handledBy).toEqual([{ id: SAM, name: "Sam Lee" }]);
    expect(o.businesses[0].addresses[0].handledBy).toEqual([]);
    // A person's answer first, then drafts (urgent first), then what is about to go.
    expect(o.waiting.map((r: { id: number }) => r.id)).toEqual([7, 41, 8, 9]);
    expect(o.today).toEqual(today(2));
    expect(o.people).toEqual([{ id: RAVI, name: "Ravi Kumar" }]);
    expect(calls.map((c) => [c.owner, c.path])).toEqual([[ownerOf(AANYA), "/overview"], [ownerOf(RAVI), "/overview"]]);
    expect((await call(AANYA, "GET", "/businesses")).json().businesses.map((b: View) => [b.id, b.access])).toEqual([["chai-co", "own"], ["leaf-co", "admin"], ["solo-co", "admin"]]);
  });

  it("a member's who answers an address: that business with only it, and only what came to it", async () => {
    const { call, calls } = await spaceApp();
    const o = (await call(SAM, "GET", "/overview")).json();
    expect(o.businesses).toHaveLength(1);
    expect(o.businesses[0]).toMatchObject({ id: "leaf-co", access: "handler", owner: { id: RAVI, name: "Ravi K." }, email: "support@leafandco.in" });
    expect(o.businesses[0].mailApp).toBeUndefined();
    expect(o.businesses[0].addresses.map((a: { email: string }) => a.email)).toEqual(["support@leafandco.in"]);
    expect(o.waiting.map((r: { id: number }) => r.id)).toEqual([7]);
    expect(o.today).toEqual(today(0));
    expect(o.people).toEqual([]);
    expect(calls.map((c) => [c.owner, c.path])).toEqual([[ownerOf(SAM), "/overview"], [ownerOf(RAVI), "/overview"]]);
    expect((await call(SAM, "GET", "/businesses")).json().businesses.map((b: View) => [b.id, b.access, b.addresses.length])).toEqual([["leaf-co", "handler", 1]]);
  });

  it("the owner's: their own with who answers each address, the people they can give one to, and the registry learns their older businesses", async () => {
    const { call, businesses } = await spaceApp();
    await businesses.forget("solo-co");
    const o = (await call(RAVI, "GET", "/overview")).json();
    expect(o.businesses.map((b: View) => [b.id, b.access])).toEqual([["leaf-co", "own"], ["solo-co", "own"]]);
    expect(o.businesses[0].addresses.map((a: { handledBy: unknown }) => a.handledBy)).toEqual([[], [{ id: SAM, name: "Sam Lee" }], []]);
    expect(o.people).toEqual([{ id: SAM, name: "Sam Lee" }, { id: NEW, name: "New One" }]);
    expect(o.waiting.map((r: { id: number }) => r.id)).toEqual([7, 8, 9]);
    expect(await businesses.whose("solo-co")).toBe(RAVI);
  });

  it("an older business reaches the admin once its owner's list is read", async () => {
    const { call, businesses } = await spaceApp();
    await businesses.forget("leaf-co");
    // Unknown: the admin's own, which it isn't, so the worker says no.
    expect((await call(AANYA, "GET", L)).json()).toEqual({ code: "bad_request", message: "No such business." });
    await call(RAVI, "GET", "/businesses");
    expect((await call(AANYA, "GET", L)).json().business.access).toBe("admin");
  });
});

describe("in a space: who answers an address", () => {
  it("its owner gives it to a member of their space, who is told once; taken back, they no longer reach it", async () => {
    const { call, pushes, handlers } = await spaceApp({ give: false });
    const r = await call(RAVI, "POST", `${L}/addresses/2/handlers`, { memberId: SAM });
    expect(r.statusCode).toBe(200);
    expect(r.json().business.access).toBe("own");
    expect(r.json().business.addresses.find((a: { id: number }) => a.id === 2).handledBy).toEqual([{ id: SAM, name: "Sam Lee" }]);
    expect(pushes).toEqual([{ userId: SAM, kind: "space_mail_handle", key: "leaf-co:2:2026-11-12", vars: { name: "Ravi K.", address: "support@leafandco.in" }, data: { slug: "mail", b: "leaf-co" } }]);
    expect((await call(RAVI, "POST", `${L}/addresses/2/handlers`, { memberId: SAM })).statusCode).toBe(200);
    expect(pushes).toHaveLength(1);
    expect((await call(SAM, "GET", L)).statusCode).toBe(200);

    const back = await call(RAVI, "DELETE", `${L}/addresses/2/handlers/${SAM}`);
    expect(back.json().business.addresses.find((a: { id: number }) => a.id === 2).handledBy).toEqual([]);
    expect(await handlers.ofMember(SAM)).toEqual([]);
    expect((await call(SAM, "GET", L)).statusCode).toBe(404);
  });

  it("only to someone in a space its owner is the admin of, and only an address the business has", async () => {
    const { call, pushes, handlers } = await spaceApp({ give: false });
    for (const memberId of [STRANGER, RAVI, AANYA, "x/../y", ""]) {
      const r = await call(RAVI, "POST", `${L}/addresses/2/handlers`, { memberId });
      expect(r.statusCode, memberId).toBe(404);
      expect(r.json(), memberId).toEqual({ code: "not_your_person", message: "You can give an address only to someone in a space you look after." });
    }
    expect((await call(RAVI, "POST", `${L}/addresses/99/handlers`, { memberId: SAM })).json()).toEqual({ code: "not_found", message: "No such address." });
    expect((await call(STRANGER, "POST", `${L}/addresses/2/handlers`, { memberId: SAM })).json()).toEqual({ code: "bad_request", message: "No such business." });
    expect((await call(STRANGER, "DELETE", `${L}/addresses/2/handlers/${SAM}`)).statusCode).toBe(404);
    expect(await handlers.ofMember(SAM)).toEqual([]);
    expect(pushes).toEqual([]);
  });

  it("the owner's admin may give and take it too, inside the owner's account; the member is told who gave it", async () => {
    const { call, calls, pushes, handlers } = await spaceApp({ give: false });
    const r = await call(AANYA, "POST", `${L}/addresses/3/handlers`, { memberId: NEW });
    expect(r.json().business).toMatchObject({ access: "admin", owner: { id: RAVI, name: "Ravi Kumar" } });
    expect(r.json().business.addresses.find((a: { id: number }) => a.id === 3).handledBy).toEqual([{ id: NEW, name: "New One" }]);
    // Aanya is not New's admin, so the push says her own first name.
    expect(pushes).toEqual([{ userId: NEW, kind: "space_mail_handle", key: "leaf-co:3:2026-11-12", vars: { name: "Aanya", address: "billing@leafandco.in" }, data: { slug: "mail", b: "leaf-co" } }]);
    expect(await handlers.ofMember(NEW)).toEqual([{ businessId: "leaf-co", ownerId: RAVI, addressId: 3, addressEmail: "billing@leafandco.in", memberId: NEW }]);
    // A member of Aanya's own spaces is not Ravi's to give it to.
    expect((await call(AANYA, "POST", `${L}/addresses/3/handlers`, { memberId: RAVI })).json().code).toBe("not_your_person");
    expect((await call(AANYA, "DELETE", `${L}/addresses/3/handlers/${NEW}`)).statusCode).toBe(200);
    expect(await handlers.ofMember(NEW)).toEqual([]);
    expect(calls.every((c) => c.owner === ownerOf(RAVI))).toBe(true);
  });
});

describe("in a space: the pushes", () => {
  it("a member's new business is told to their space's admin, with their name and its domain, never the mail", async () => {
    const { call, pushes, businesses } = await spaceApp();
    const r = await call(RAVI, "POST", "/businesses", { name: "Tea", domain: "tea.in" });
    expect(r.statusCode).toBe(201);
    expect(r.json().business).toMatchObject({ id: "tea", access: "own" });
    expect(pushes).toEqual([{ userId: AANYA, kind: "space_mail", key: "tea", vars: { name: "Ravi Kumar", domain: "tea.in" }, data: { slug: "mail", b: "tea" } }]);
    expect(await businesses.whose("tea")).toBe(RAVI);
    // Nobody's member: nobody to tell.
    await call(AANYA, "POST", "/businesses", { name: "Lassi", domain: "lassi.in" });
    expect(pushes).toHaveLength(1);
  });

  it("the worker's notice reaches each member who answers its address, while they are still in the owner's space; a paused day, the owner alone", async () => {
    const { a, owners, pushes, gone } = await spaceApp();
    await owners.keep(RAVI, ownerOf(RAVI));
    const base = { owner: ownerOf(RAVI), business: "leaf-co", name: "Leaf & Co", kind: "complaint", priority: "urgent" };
    await a.inject(notice({ ...base, status: "needs_person", run: 7, address: "Support@leafandco.in" }));
    expect(pushes).toEqual([
      { userId: RAVI, kind: "mail_needs_you", key: "leaf-co:7", vars: { business: "Leaf & Co", what: "A complaint" }, data: { b: "leaf-co", run: "7" } },
      { userId: SAM, kind: "mail_needs_you", key: "leaf-co:7", vars: { business: "Leaf & Co", what: "A complaint" }, data: { b: "leaf-co", run: "7" } },
    ]);
    pushes.length = 0;
    await a.inject(notice({ ...base, status: "drafted", run: 8, address: "billing@leafandco.in" }));
    await a.inject(notice({ ...base, status: "paused", address: "support@leafandco.in" }));
    expect(pushes.map((p) => [p.userId, p.kind])).toEqual([[RAVI, "mail_urgent"], [RAVI, "mail_paused"]]);
    pushes.length = 0;
    gone.add(SAM);
    await a.inject(notice({ ...base, status: "needs_person", run: 11, address: "support@leafandco.in" }));
    expect(pushes.map((p) => p.userId)).toEqual([RAVI]);
  });

  it("are Spaces' and a person's word: in the engine's kinds with their screen and words, never while Spaces is off, quiet in quiet hours", () => {
    for (const kind of ["space_mail", "space_mail_handle"]) {
      expect(EVENT_PUSH_KINDS as readonly string[]).toContain(kind);
      expect(isSpacePush(kind)).toBe(true);
      expect(PUSH_DEFAULTS.flags[`push.${kind}.enabled`]).toBe(true);
      expect(PUSH_DEFAULTS.flags[`push.${kind}.screenId`]).toBe("bots.bot");
      expect(PUSH_DEFAULTS.labels[`push.${kind}.title`]).toBe("{name}");
      const s = { ...DEFAULT_SETTINGS, notify: { ...DEFAULT_SETTINGS.notify, quiet: true, botsOff: ["mail"] } };
      expect(verdict(s, kind, 12 * 60)).toBe("send");
      expect(verdict(s, kind, 23 * 60 + 30)).toBe("silent");
    }
    expect(PUSH_DEFAULTS.labels["push.space_mail.body"]).toBe("set up mail for {domain}.");
    expect(PUSH_DEFAULTS.labels["push.space_mail_handle.body"]).toBe("gave you {address} to answer.");
  });
});
