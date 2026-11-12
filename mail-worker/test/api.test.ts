// The worker as X0 Bot's server calls it, against a stand-in mail server (a small JMAP server here, recording what it is asked): only
// signed calls, each inside one account; a business made with its domain and mailbox, starting in Draft; a domain the mail server already
// has refused (it may be Xooteq Mail's); the daily allowance; a business deleted with its mailbox; the new-mail webhook signed and kept to
// the worker's own domains. No real mail server, no model.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

// ---- the stand-in mail server ----
type Obj = Record<string, unknown> & { id: string };
const store = { Domain: [{ id: "d0", name: "xooteq.online" }] as Obj[], Account: [] as Obj[], WebHook: [] as Obj[], Action: [] as Obj[] };
const calls: string[] = [];
let seq = 1;
const mail = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const user = Buffer.from(String(req.headers.authorization ?? "").replace(/^Basic /, ""), "base64").toString().split(":")[0] ?? "";
    if (req.method === "GET" && req.url === "/.well-known/jmap") {
      return send(200, { username: user, capabilities: {}, accounts: { a1: {} }, primaryAccounts: { "urn:stalwart:jmap": "admin1", "urn:ietf:params:jmap:mail": "mail1" } });
    }
    if (req.method === "POST" && req.url?.startsWith("/jmap/upload/")) return send(200, { blobId: `b${seq++}`, size: raw.length, type: "application/sieve" });
    if (req.method === "POST" && req.url === "/jmap/") {
      const { methodCalls } = JSON.parse(raw) as { methodCalls: [string, Record<string, unknown>, string][] };
      const out = methodCalls.map(([m, a, id]) => {
        calls.push(m);
        const x = /^x:(\w+)\/(get|set)$/.exec(m);
        if (x) {
          const list = store[x[1] as keyof typeof store];
          if (!list) return ["error", { type: "unknownMethod" }, id];
          if (x[2] === "get") return [m, { list }, id];
          const created: Record<string, { id: string }> = {};
          for (const [k, v] of Object.entries((a.create ?? {}) as Record<string, Record<string, unknown>>)) { const o = { ...v, id: `${x[1][0]}${seq++}` }; list.push(o); created[k] = { id: o.id }; }
          for (const idd of (a.destroy ?? []) as string[]) { const i = list.findIndex((o) => o.id === idd); if (i >= 0) list.splice(i, 1); }
          for (const [idd, patch] of Object.entries((a.update ?? {}) as Record<string, Record<string, unknown>>)) Object.assign(list.find((o) => o.id === idd) ?? {}, patch);
          return [m, { created }, id];
        }
        if (m === "Mailbox/get") return [m, { list: [{ id: "in", name: "Inbox", role: "inbox", parentId: null }, { id: "dr", name: "Drafts", role: "drafts", parentId: null }] }, id];
        if (m === "Mailbox/set") return [m, { created: {} }, id];
        if (m === "SieveScript/validate") return [m, { error: null }, id];
        if (m === "SieveScript/get") return [m, { list: [] }, id];
        if (m === "SieveScript/set") return [m, { created: { s: { id: "s1" } } }, id];
        return ["error", { type: "unknownMethod" }, id];
      });
      return send(200, { methodResponses: out });
    }
    send(404, {});
  });
});
await new Promise<void>((r) => mail.listen(0, "127.0.0.1", () => r()));
const port = (mail.address() as { port: number }).port;
after(() => mail.close());

const SECRET = "test-secret-0123456789abcdef0123456789";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "x0-mail-test-"));
process.env.STALWART_URL = `http://127.0.0.1:${port}`;
process.env.STALWART_ADMIN_USER = "admin";
process.env.STALWART_ADMIN_SECRET = "admin-secret";
process.env.MAIL_WORKER_SECRET = SECRET;
process.env.MAIL_WEBHOOK_SECRET = "hook-secret";
process.env.MAIL_DOMAIN = "mail.example.online";
process.env.VPS_IP = "203.0.113.7";
process.env.OPENROUTER_API_KEY = "test-key";

const { buildApp } = await import("../server/app.ts");
const { sign } = await import("../server/security.ts");
const { allowance } = await import("../server/ai/engine.ts");
const { getCompany } = await import("../server/companies.ts");
const { db, now } = await import("../server/db.ts");
const app = await buildApp();
after(() => app.close());

const A = "owner:aaaaaaaaaaaaaaaaaaaaaaaa", B = "owner:bbbbbbbbbbbbbbbbbbbbbbbb";
async function call(method: string, url: string, payload?: unknown, o: { sign?: boolean; nonce?: string } = {}) {
  const body = Buffer.from(payload === undefined ? "" : JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000), nonce = o.nonce ?? crypto.randomBytes(16).toString("hex");
  const headers: Record<string, string> = payload === undefined ? {} : { "content-type": "application/json" };
  if (o.sign !== false) Object.assign(headers, { "x-tailzu-timestamp": String(timestamp), "x-tailzu-nonce": nonce, "x-tailzu-signature": sign(SECRET, { timestamp, nonce, method, pathWithQuery: url, body }) });
  const r = await app.inject({ method: method as "GET", url, headers, ...(payload === undefined ? {} : { payload: body }) });
  return { status: r.statusCode, json: r.json() as Record<string, any> };
}

test("the signature is the one X0 Bot's server makes (the media and Oracle workers' vector)", () => {
  assert.equal(sign(SECRET, { timestamp: 1700000000, nonce: "00112233445566778899aabbccddeeff", method: "POST", pathWithQuery: "/v1/convert?format=docx", body: Buffer.from("hello") }),
    "2a33a770351bfe2000365ad6e1b9bf4a56f4fc6c83a9765044275a57ed4b38bf");
});

test("only signed calls are answered, and a signed one cannot be sent twice", async () => {
  assert.equal((await call("GET", `/v1/o/${A}/businesses`, undefined, { sign: false })).status, 401);
  const nonce = crypto.randomBytes(16).toString("hex");
  assert.deepEqual((await call("GET", `/v1/o/${A}/businesses`, undefined, { nonce })).json, { businesses: [] });
  assert.equal((await call("GET", `/v1/o/${A}/businesses`, undefined, { nonce })).status, 401);
  const health = await app.inject({ method: "GET", url: "/healthz" });
  assert.deepEqual(health.json(), { ok: true, ready: true });
});

let acmeId = "";
test("a business is made with its domain and mailbox, its filing set, and every address in Draft", async () => {
  const made = await call("POST", `/v1/o/${A}/businesses`, { name: "Acme Studio", domain: "Acme.test", aliases: [{ local: "support", label: "Support" }] });
  assert.equal(made.status, 201);
  const b = made.json.business;
  acmeId = b.id;
  assert.equal(b.email, "hello@acme.test");
  assert.deepEqual(b.addresses.map((x: { email: string; aiMode: string }) => [x.email, x.aiMode]), [["hello@acme.test", "draft"], ["support@acme.test", "draft"]]);
  assert.ok(store.Domain.some((d) => d.name === "acme.test"));
  assert.ok(store.Account.some((a) => a.name === "hello" && a.description === "Acme Studio"));
  assert.ok(calls.includes("SieveScript/set"));
  assert.equal(JSON.stringify(b).includes("accountId"), false);         // the mail server's ids stay here
});

test("each account sees only its own businesses", async () => {
  assert.equal((await call("GET", `/v1/o/${B}/businesses`)).json.businesses.length, 0);
  assert.equal((await call("GET", `/v1/o/${B}/businesses/${acmeId}`)).status, 404);
  assert.equal((await call("PATCH", `/v1/o/${B}/businesses/${acmeId}`, { name: "Mine now" })).status, 404);
  assert.equal((await call("DELETE", `/v1/o/${B}/businesses/${acmeId}`)).status, 404);
  assert.equal((await call("GET", `/v1/o/${A}/businesses`)).json.businesses.length, 1);
});

test("a domain the mail server already has is refused, never adopted", async () => {
  const r = await call("POST", `/v1/o/${B}/businesses`, { name: "Takeover", domain: "xooteq.online" });
  assert.equal(r.status, 400);
  assert.match(r.json.message, /already on the mail server/);
  assert.equal((await call("POST", `/v1/o/${B}/businesses`, { name: "Again", domain: "acme.test" })).json.message, "acme.test is already set up here.");
});

test("an address's mode, and the business's daily allowance", async () => {
  const b = (await call("GET", `/v1/o/${A}/businesses/${acmeId}`)).json.business;
  const support = b.addresses.find((x: { email: string }) => x.email === "support@acme.test");
  const sent = await call("PATCH", `/v1/o/${A}/businesses/${acmeId}/addresses/${support.id}`, { aiMode: "send" });
  assert.equal(sent.json.business.addresses.find((x: { id: number }) => x.id === support.id).aiMode, "send");
  const capped = await call("PATCH", `/v1/o/${A}/businesses/${acmeId}`, { dailyUsd: 0.05 });
  assert.equal(capped.json.business.allowance.capUsd, 0.05);
  db.prepare("INSERT INTO ai_runs (company_id, status, cost_usd, created_at) VALUES (?, 'drafted', 0.06, ?)").run(acmeId, now());
  assert.equal(allowance(getCompany(acmeId)).left, false);
  const spend = await call("GET", `/v1/o/${A}/spend?since=0`);
  assert.equal(spend.json.days.length, 1);
  assert.equal(spend.json.days[0].companyId, acmeId);
});

test("the brief is kept, and the new-mail webhook is signed and kept to the worker's own domains", async () => {
  const put = await call("PUT", `/v1/o/${A}/businesses/${acmeId}/brief`, { profile: { about: "A design studio in Pune.", sendDelayMinutes: 5 } });
  assert.equal(put.json.profile.about, "A design studio in Pune.");
  assert.equal((await call("GET", `/v1/o/${A}/businesses/${acmeId}/brief`)).json.profile.sendDelayMinutes, 5);
  const hook = Buffer.from(JSON.stringify({ events: [{ type: "message-ingest.ham", data: { to: ["someone@xooteq.online"], messageId: "<m1@x>" } }] }));
  assert.equal((await app.inject({ method: "POST", url: "/hooks/stalwart", headers: { "content-type": "application/json" }, payload: hook })).statusCode, 401);
  const signed = crypto.createHmac("sha256", "hook-secret").update(hook).digest("base64");
  const r = await app.inject({ method: "POST", url: "/hooks/stalwart", headers: { "content-type": "application/json", "x-signature": signed }, payload: hook });
  assert.deepEqual(r.json(), { ok: true, queued: 0 });                    // Xooteq Mail's domain: not this worker's
});

test("a business deleted takes its mailbox and domain with it; an account deleted takes all of its businesses", async () => {
  const del = await call("DELETE", `/v1/o/${A}/businesses/${acmeId}`);
  assert.deepEqual(del.json, { ok: true });
  assert.equal(store.Account.some((a) => a.name === "hello" && a.description === "Acme Studio"), false);
  assert.equal(store.Domain.some((d) => d.name === "acme.test"), false);
  assert.ok(store.Domain.some((d) => d.name === "xooteq.online"));        // never another's
  assert.equal((await call("GET", `/v1/o/${A}/businesses/${acmeId}`)).status, 404);
  await call("POST", `/v1/o/${B}/businesses`, { name: "One", domain: "one.test" });
  await call("POST", `/v1/o/${B}/businesses`, { name: "Two", domain: "two.test" });
  assert.deepEqual((await call("DELETE", `/v1/o/${B}`)).json, { ok: true });
  assert.equal((await call("GET", `/v1/o/${B}/businesses`)).json.businesses.length, 0);
});
