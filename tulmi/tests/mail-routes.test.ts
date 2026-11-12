/**
 * THE MAIL BOT OVER HTTP (routes/bots/mail.ts, mail/worker.ts, mail/owners.ts): off unless it is set up; each page's call passed to the worker
 * inside the person's own account (a hash, never their id), with only the fields it takes (never a business's AI allowance), the mailbox's
 * folder and page only when they are one of its own, and an address's auto-reply put together from the form's flat fields; a bad id refused
 * before the worker hears of it; the worker's refusals in its own words; every call signed; the worker's notice that mail needs a person
 * pushed to the right person once, never with the mail's words; and an account deleted with its businesses.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const Fastify = (await import("fastify")).default;
const { registerMailRoutes } = await import("../src/routes/bots/mail.js");
const { MemoryMailOwners } = await import("../src/mail/owners.js");
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
