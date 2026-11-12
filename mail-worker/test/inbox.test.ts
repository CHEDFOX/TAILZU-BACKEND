// The mailbox itself (inbox.ts) over the signed API, against a stand-in mail server: the folders as Xooteq Mail shows them (all mail,
// the main address's own, one per alias, the system ones), conversations per folder a page at a time, one read and marked read, what can
// be done to one (archive, trash, back to the inbox, star), mail sent from an alias (new, a reply in its thread, a forward), the AI
// writing a new one, and rules one at a time.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fakeStalwart } from "./fakeStalwart.ts";

const mail = fakeStalwart();
const port = await mail.listen();
after(() => mail.close());

const SECRET = "test-secret-0123456789abcdef0123456789";
Object.assign(process.env, {
  DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "x0-mail-inbox-")), STALWART_URL: `http://127.0.0.1:${port}`, STALWART_ADMIN_USER: "admin",
  STALWART_ADMIN_SECRET: "admin-secret", MAIL_WORKER_SECRET: SECRET, MAIL_WEBHOOK_SECRET: "hook-secret", MAIL_DOMAIN: "mail.example.online",
  VPS_IP: "203.0.113.7", OPENROUTER_API_KEY: "test-key",
});

const { buildApp } = await import("../server/app.ts");
const { sign } = await import("../server/security.ts");
const { useFetch } = await import("../server/ai/model.ts");
const { db } = await import("../server/db.ts");
const app = await buildApp();
after(() => app.close());

const asked: { system: string; user: string }[] = [];
useFetch(async (_url, init) => {
  const b = JSON.parse(init.body) as { model: string; messages: { content: string }[] };
  asked.push({ system: b.messages[0]!.content, user: b.messages[1]!.content });
  const a = { subject: "Our new tote is here", text: "Hi,\n\nThe market tote now comes in green." };
  return { status: 200, json: async () => ({ model: b.model, choices: [{ message: { content: JSON.stringify(a) } }], usage: { cost: 0.001 } }) };
});

const A = "owner:cccccccccccccccccccccccc";
async function call(method: string, url: string, payload?: unknown) {
  const body = Buffer.from(payload === undefined ? "" : JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000), nonce = crypto.randomBytes(16).toString("hex");
  const headers: Record<string, string> = { "x-tailzu-timestamp": String(timestamp), "x-tailzu-nonce": nonce, "x-tailzu-signature": sign(SECRET, { timestamp, nonce, method, pathWithQuery: url, body }) };
  if (payload !== undefined) headers["content-type"] = "application/json";
  const r = await app.inject({ method: method as "GET", url, headers, ...(payload === undefined ? {} : { payload: body }) });
  return { status: r.statusCode, json: r.json() as Record<string, any> };
}

let B = "", SP = "";
test("a business with an alias (its folder made with it), and mail for each", async () => {
  const made = await call("POST", `/v1/o/${A}/businesses`, { name: "Leaf & Co", domain: "shop.test" });
  assert.equal(made.status, 201);
  B = `/v1/o/${A}/businesses/${made.json.business.id}`;
  assert.equal((await call("POST", `${B}/addresses`, { local: "support", label: "Support" })).status, 200);
  SP = ((await call("GET", `${B}/folders`)).json.folders as Array<Record<string, any>>).find((f) => f.name === "Support")!.id;
  mail.deliver({ id: "m1", messageId: "<m1@x>", from: "asha@customer.test", name: "Asha", to: "hello@shop.test", subject: "Where is my order?", text: "My order 1234 has not come." });
  mail.deliver({ id: "m2", messageId: "<m2@x>", from: "ravi@customer.test", to: "support@shop.test", subject: "Login trouble", text: "I can't sign in.", also: [SP] });
  mail.deliver({ id: "m3", messageId: "<m3@x>", from: "asha@customer.test", name: "Asha", to: "hello@shop.test", subject: "Re: Where is my order?", text: "Any news?", thread: "t-m1" });
});

test("the folders, as Xooteq Mail shows them: all mail, the main address's own, one per alias, the system ones", async () => {
  const f = (await call("GET", `${B}/folders`)).json.folders as Array<Record<string, any>>;
  assert.deepEqual(f.map((x) => x.key), ["inbox", "main", `f-${SP}`, "drafts", "sent", "junk", "trash"]);
  assert.deepEqual(f.find((x) => x.key === "main"), { key: "main", id: "in", name: "Hello", role: null, kind: "address", unread: 0, total: 0, email: "hello@shop.test" });
  assert.deepEqual([f[2]!.name, f[2]!.kind, f[2]!.email, f[2]!.unread], ["Support", "address", "support@shop.test", 1]);
  assert.equal(f[0]!.unread, 2);
});

test("conversations per folder, newest first: all of them, the main address's, an alias's", async () => {
  const all = (await call("GET", `${B}/messages?folder=inbox`)).json;
  assert.deepEqual(all.messages.map((m: any) => [m.threadId, m.count, m.unread]), [["t-m1", 2, true], ["t-m2", 1, true]]);
  assert.equal(all.messages[0].from.name, "Asha");
  assert.equal(all.messages[0].preview, "Any news?");
  assert.equal(all.more, false);
  assert.deepEqual((await call("GET", `${B}/messages?folder=main`)).json.messages.map((m: any) => m.threadId), ["t-m1"]);
  assert.deepEqual((await call("GET", `${B}/messages?folder=f-${SP}`)).json.messages.map((m: any) => m.threadId), ["t-m2"]);
  // An unknown folder is all mail.
  assert.equal((await call("GET", `${B}/messages?folder=nope`)).json.folder.key, "inbox");
});

test("a conversation, oldest first, is marked read as it is opened", async () => {
  const t = (await call("GET", `${B}/threads/t-m1`)).json;
  assert.equal(t.subject, "Where is my order?");
  assert.deepEqual(t.messages.map((m: any) => [m.text, m.unread]), [["My order 1234 has not come.", true], ["Any news?", true]]);
  assert.deepEqual(t.where, ["inbox"]);
  assert.equal((await call("GET", `${B}/messages?folder=inbox`)).json.messages[0].unread, false);
  assert.equal((await call("GET", `${B}/threads/bad!id`)).status, 404);
  assert.equal((await call("GET", `${B}/threads/t-none`)).status, 404);
});

test("archived, trashed, back in the inbox, starred", async () => {
  assert.deepEqual((await call("POST", `${B}/threads/t-m1/archive`)).json, { ok: true });
  assert.deepEqual((await call("GET", `${B}/messages?folder=inbox`)).json.messages.map((m: any) => m.threadId), ["t-m2"]);
  assert.deepEqual((await call("GET", `${B}/messages?folder=archive`)).json.messages.map((m: any) => m.threadId), ["t-m1"]);
  await call("POST", `${B}/threads/t-m2/trash`);
  assert.deepEqual((await call("GET", `${B}/messages?folder=trash`)).json.messages.map((m: any) => m.threadId), ["t-m2"]);
  await call("POST", `${B}/threads/t-m2/inbox`);
  assert.deepEqual((await call("GET", `${B}/messages?folder=inbox`)).json.messages.map((m: any) => m.threadId), ["t-m2"]);
  await call("POST", `${B}/threads/t-m2/star`);
  assert.equal((await call("GET", `${B}/messages?folder=inbox`)).json.messages[0].starred, true);
  await call("POST", `${B}/threads/t-m2/unread`);
  assert.equal((await call("GET", `${B}/messages?folder=inbox`)).json.messages[0].unread, true);
  assert.equal((await call("POST", `${B}/threads/t-m2/explode`)).status, 404);
});

test("mail sent from an alias: new, a reply in its thread, a forward with the original below", async () => {
  const fresh = await call("POST", `${B}/send`, { from: "support@shop.test", to: "Asha <asha@customer.test>, ravi@customer.test", subject: "Your order", text: "It ships today." });
  assert.equal(fresh.json.ok, true);
  const sent = mail.emails.find((e) => e.id === fresh.json.id)! as any;
  assert.deepEqual(sent.from, [{ name: "Leaf & Co", email: "support@shop.test" }]);
  assert.deepEqual(sent.to, [{ name: "Asha", email: "asha@customer.test" }, { email: "ravi@customer.test" }]);
  assert.equal(mail.submitted.includes(fresh.json.id), true);
  // Its Message-ID is on the business's own domain, not the mail server's name.
  assert.match(sent.messageId[0], /^[0-9a-f-]{36}@shop\.test$/);
  const reply = await call("POST", `${B}/send`, { to: "asha@customer.test", text: "On its way.", replyTo: "m1" });
  const r = mail.emails.find((e) => e.id === reply.json.id)! as any;
  assert.equal(r.subject, "Re: Where is my order?");
  assert.deepEqual(r.inReplyTo, ["m1@x"]);
  assert.equal((mail.emails.find((e) => e.id === "m1") as any).keywords.$answered, true);
  const fwd = await call("POST", `${B}/send`, { to: "team@shop.test", text: "Can you look?", forward: "m2" });
  const f = mail.emails.find((e) => e.id === fwd.json.id)! as any;
  assert.equal(f.subject, "Fwd: Login trouble");
  assert.match(f.bodyValues.t.value, /Can you look\?[\s\S]*Forwarded message[\s\S]*I can't sign in\./);
  const bad = await call("POST", `${B}/send`, { to: "not an address", text: "x" });
  assert.equal(bad.status, 400);
  assert.match(bad.json.message, /is not an email address/);
  assert.equal((await call("POST", `${B}/send`, { to: "a@b.in", text: "" })).status, 400);
});

test("the AI writes a new email from what is asked, in the business's voice, and the cost is logged", async () => {
  const w = await call("POST", `${B}/write`, { instruction: "Tell our customers the market tote now comes in green" });
  assert.deepEqual(w.json, { subject: "Our new tote is here", text: "Hi,\n\nThe market tote now comes in green." });
  assert.match(asked.at(-1)!.system, /You write emails for Leaf & Co/);
  assert.equal(asked.at(-1)!.user, "Tell our customers the market tote now comes in green");
  const run = db.prepare("SELECT status, cost_usd FROM ai_runs WHERE mode = 'suggest' ORDER BY id DESC").get() as { status: string; cost_usd: number };
  assert.deepEqual([run.status, run.cost_usd], ["suggested", 0.001]);
  assert.equal((await call("POST", `${B}/write`, { instruction: "" })).status, 400);
});

test("rules one at a time: added as a sentence, turned off, removed", async () => {
  const added = await call("POST", `${B}/rules`, { field: "from", op: "contains", value: "invoice", action: "move", target: "Billing" });
  assert.equal(added.json.rules.length, 1);
  assert.equal(added.json.rules[0].line, 'When From contains "invoice": move to Billing');
  const id = added.json.rules[0].id;
  assert.equal((await call("POST", `${B}/rules/${id}/toggle`)).json.rules[0].enabled, false);
  const second = await call("POST", `${B}/rules`, { field: "subject", op: "contains", value: "urgent", action: "star" });
  assert.equal(second.json.rules[1].line, 'When Subject contains "urgent": star it');
  const left = await call("DELETE", `${B}/rules/${second.json.rules[0].id}`);
  assert.deepEqual(left.json.rules.map((r: any) => r.line), ['When Subject contains "urgent": star it']);
  assert.equal((await call("POST", `${B}/rules`, { field: "from", value: "", action: "delete" })).status, 400);
  assert.equal((await call("POST", `${B}/rules`, { field: "from", value: "x", action: "forward", target: "nobody" })).status, 400);
});
