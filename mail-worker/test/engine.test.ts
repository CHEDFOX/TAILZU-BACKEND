// The engine tuned for any business, end to end against a stand-in mail server and a stand-in model: a message sorted (kind, priority,
// one line), drafted, waiting in the overview; the facts narrowed to what the email needs; the AI never claiming to be a person; a
// person's change kept and taught back; a draft rewritten as asked; sent; a newsletter filed without asking the model; the brief drafted
// from the website, only from public addresses.
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
  DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "x0-mail-engine-")), STALWART_URL: `http://127.0.0.1:${port}`, STALWART_ADMIN_USER: "admin",
  STALWART_ADMIN_SECRET: "admin-secret", MAIL_WORKER_SECRET: SECRET, MAIL_WEBHOOK_SECRET: "hook-secret", MAIL_DOMAIN: "mail.example.online",
  VPS_IP: "203.0.113.7", OPENROUTER_API_KEY: "test-key",
});

const { buildApp } = await import("../server/app.ts");
const { sign } = await import("../server/security.ts");
const { useFetch } = await import("../server/ai/model.ts");
const { relevantKnowledge, systemPrompt, DEFAULT_PROFILE } = await import("../server/ai/prompt.ts");
const { isPublicAddress, readSite, draftBrief } = await import("../server/ai/brief.ts");
const { getCompany } = await import("../server/companies.ts");
const { db } = await import("../server/db.ts");
const app = await buildApp();
after(() => app.close());

// ---- the stand-in model: answers in turn, and keeps what it was asked ----
const asked: { system: string; user: string; model: string }[] = [];
const answers: Record<string, unknown>[] = [];
useFetch(async (_url, init) => {
  const b = JSON.parse(init.body) as { model: string; messages: { content: string }[] };
  asked.push({ model: b.model, system: b.messages[0]!.content, user: b.messages[1]!.content });
  const a = answers.shift() ?? { decision: "ignore", reply: "", reason: "nothing", kind: "other", priority: "low", summary: "" };
  return { status: 200, json: async () => ({ model: b.model, choices: [{ message: { content: JSON.stringify(a) } }], usage: { cost: 0.0021 } }) };
});

const A = "owner:aaaaaaaaaaaaaaaaaaaaaaaa";
async function call(method: string, url: string, payload?: unknown) {
  const body = Buffer.from(payload === undefined ? "" : JSON.stringify(payload));
  const timestamp = Math.floor(Date.now() / 1000), nonce = crypto.randomBytes(16).toString("hex");
  const headers: Record<string, string> = { "x-tailzu-timestamp": String(timestamp), "x-tailzu-nonce": nonce, "x-tailzu-signature": sign(SECRET, { timestamp, nonce, method, pathWithQuery: url, body }) };
  if (payload !== undefined) headers["content-type"] = "application/json";
  const r = await app.inject({ method: method as "GET", url, headers, ...(payload === undefined ? {} : { payload: body }) });
  return { status: r.statusCode, json: r.json() as Record<string, any> };
}
async function arrive(to: string, messageId: string) {
  const hook = Buffer.from(JSON.stringify({ events: [{ type: "message-ingest.ham", data: { to: [to], messageId } }] }));
  const r = await app.inject({ method: "POST", url: "/hooks/stalwart", headers: { "content-type": "application/json", "x-signature": crypto.createHmac("sha256", "hook-secret").update(hook).digest("base64") }, payload: hook });
  return r.json() as { queued: number };
}
async function settled(messageId: string): Promise<Record<string, any>> {
  for (let i = 0; i < 100; i++) {
    const r = db.prepare("SELECT * FROM ai_runs WHERE message_id = ?").get(messageId) as Record<string, any> | undefined;
    if (r && r.status !== "working") return r;
    await new Promise((res) => setTimeout(res, 30));
  }
  throw new Error("the run never settled");
}

const SHIPPING = "## Shipping\nOrders ship from Pune within 2 working days. Tracking links are emailed when an order ships.";
const LONG = ["# Shop\nHandmade leather bags, sold online across India.", SHIPPING, ...Array.from({ length: 80 }, (_, i) => `## Care ${i}\nWipe the leather with a dry cloth and keep it away from direct sunlight for long hours, number ${i}.`)].join("\n\n");
let id = "";

test("a business, with a long list of facts", async () => {
  const b = (await call("POST", `/v1/o/${A}/businesses`, { name: "Leaf & Co", domain: "shop.test" })).json.business;
  id = b.id;
  await call("PUT", `/v1/o/${A}/businesses/${id}/brief`, { profile: { about: "Handmade leather bags.", knowledge: LONG } });
  assert.ok(LONG.length > 6000);
});

let orderRun = 0;
test("a message is sorted, drafted for a person, and waits in the overview; the facts are narrowed to what it needs", async () => {
  mail.deliver({ id: "m1", messageId: "<m1@customer>", from: "asha@customer.test", name: "Asha", to: "hello@shop.test", subject: "Where is my order 1234?", text: "Hi, my order 1234 has not shipped yet. When will it ship?" });
  answers.push({ decision: "reply", reply: "Hi Asha, orders ship within 2 working days; your tracking link comes by email.", reason: "a shipping question", kind: "order", priority: "urgent", summary: "Asks when order 1234 will ship" });
  assert.equal((await arrive("hello@shop.test", "<m1@customer>")).queued, 1);
  const run = await settled("<m1@customer>");
  orderRun = run.id;
  assert.deepEqual([run.status, run.kind, run.priority, run.summary], ["drafted", "order", "urgent", "Asks when order 1234 will ship"]);
  assert.equal(run.cost_usd, 0.0021);
  const sys = asked.at(-1)!.system;
  assert.match(sys, /Orders ship from Pune/);                         // the section the email needs
  assert.doesNotMatch(sys, /Care 79/);                                // not the ones it does not
  assert.match(sys, /Never claim to be a person/);
  assert.match(asked.at(-1)!.user, /^<email>[\s\S]*<\/email>$/);
  const o = (await call("GET", `/v1/o/${A}/overview`)).json;
  assert.equal(o.waiting[0].summary, "Asks when order 1234 will ship");
  assert.equal(o.waiting[0].priority, "urgent");
  assert.deepEqual(o.today, { received: 1, answered: 0, drafted: 1, needsPerson: 0, filed: 0 });
});

test("a person's change is kept, and teaches the next reply their way of writing", async () => {
  const v = (await call("GET", `/v1/o/${A}/businesses/${id}/replies/${orderRun}`)).json;
  assert.match(v.text, /ship within 2 working days/);
  assert.equal(v.message.from, "Asha <asha@customer.test>");
  assert.deepEqual((await call("PUT", `/v1/o/${A}/businesses/${id}/replies/${orderRun}`, { text: "Hi Asha! Your bag leaves our Pune studio by Thursday. Warmly, Leaf" })).json, { ok: true });
  const ex = db.prepare("SELECT subject, ai_text, final_text FROM ai_examples WHERE company_id = ?").all(id) as Record<string, string>[];
  assert.equal(ex.length, 1);
  assert.match(ex[0]!.final_text, /leaves our Pune studio/);
  mail.deliver({ id: "m2", messageId: "<m2@customer>", from: "ravi@customer.test", to: "hello@shop.test", subject: "Gift wrap?", text: "Do you gift wrap?" });
  answers.push({ decision: "escalate", reply: "Thanks Ravi, someone will reply soon.", reason: "not in the facts", kind: "question", priority: "normal", summary: "Asks about gift wrapping" });
  await arrive("hello@shop.test", "<m2@customer>");
  const run = await settled("<m2@customer>");
  assert.equal(run.status, "needs_person");
  assert.match(asked.at(-1)!.system, /How the team changed earlier drafts[\s\S]*leaves our Pune studio/);
});

test("a draft is written again as asked, and sent", async () => {
  answers.push({ decision: "reply", reply: "Hi Asha, it ships by Thursday.", reason: "shorter", kind: "order", priority: "urgent", summary: "Asks when order 1234 will ship" });
  const r = await call("POST", `/v1/o/${A}/businesses/${id}/replies/${orderRun}/rewrite`, { instruction: "make it shorter" });
  assert.match(r.json.text, /ships by Thursday/);
  assert.match(asked.at(-1)!.system, /make it shorter[\s\S]*The current draft:[\s\S]*leaves our Pune studio/);
  const cost = (db.prepare("SELECT cost_usd FROM ai_runs WHERE id = ?").get(orderRun) as { cost_usd: number }).cost_usd;
  assert.equal(Math.round(cost * 10000), 42);                         // the draft and its rewrite
  assert.deepEqual((await call("POST", `/v1/o/${A}/businesses/${id}/replies/${orderRun}/send`)).json, { ok: true });
  assert.equal(mail.submitted.length, 1);
  assert.equal((db.prepare("SELECT status FROM ai_runs WHERE id = ?").get(orderRun) as { status: string }).status, "sent");
  assert.equal((await call("POST", `/v1/o/${A}/businesses/${id}/replies/${orderRun}/send`)).status, 409);
});

test("a newsletter is filed without asking the model", async () => {
  const before = asked.length;
  mail.deliver({ id: "m3", messageId: "<m3@news>", from: "news@brand.test", to: "hello@shop.test", subject: "Our autumn sale", text: "Sale!", headers: { "header:List-Unsubscribe:asText": "<mailto:u@brand.test>" } });
  await arrive("hello@shop.test", "<m3@news>");
  const run = await settled("<m3@news>");
  assert.deepEqual([run.status, run.kind, run.priority], ["skipped", "notification", "low"]);
  assert.equal(asked.length, before);
});

test("long facts are narrowed; short ones are kept whole", () => {
  assert.equal(relevantKnowledge("Open 10 to 7.", "anything"), "Open 10 to 7.");
  const n = relevantKnowledge(LONG, "When does my order ship?", 1000);
  assert.ok(n.length <= 1000);
  assert.match(n, /^# Shop/);
  assert.match(n, /Orders ship from Pune/);
  const sys = systemPrompt({ company: "Leaf", domain: "shop.test", address: "hello@shop.test", label: "", profile: DEFAULT_PROFILE });
  assert.doesNotMatch(sys, /never say you are an AI/);
});

test("the brief is drafted from the business's own pages, and only public addresses are read", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "0.0.0.0"]) assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ["8.8.8.8", "91.108.104.168", "2606:4700::1111"]) assert.equal(isPublicAddress(ip), true, ip);
  const site: Record<string, string> = {
    "https://shop.test": `<html><body><h1>Leaf & Co</h1><p>Handmade leather bags from Pune, sold across India since 2019.</p><a href="/about">About</a><a href="/shipping">Shipping</a><a href="https://elsewhere.test/pricing">x</a><a href="/blog/post-1">Blog</a></body></html>`,
    "https://shop.test/about": "<p>We are a family studio of six makers in Pune, cutting every bag by hand.</p>",
    "https://shop.test/shipping": "<p>Free shipping across India on orders over 2,000 rupees. Orders leave within 2 working days.</p>",
  };
  const fetched: string[] = [];
  const fetcher = async (url: string) => { fetched.push(url); return site[url] ? { url, html: site[url]! } : null; };
  const pages = await readSite("https://shop.test", fetcher);
  assert.deepEqual(pages.map((p) => p.url), ["https://shop.test", "https://shop.test/about", "https://shop.test/shipping"]);
  assert.equal(fetched.includes("https://elsewhere.test/pricing"), false);
  answers.push({ about: "A family studio in Pune making leather bags by hand.", voice: "Warm and plain.", knowledge: "Free shipping over 2,000 rupees.\nOrders leave within 2 working days.", policies: "Never promise refunds." });
  const d = await draftBrief(getCompany(id), undefined, fetcher);
  assert.match(d.draft.about, /family studio/);
  assert.equal(d.pages.length, 3);
  assert.match(asked.at(-1)!.user, /<page url="https:\/\/shop.test\/shipping">[\s\S]*Free shipping/);
  const logged = db.prepare("SELECT status, cost_usd FROM ai_runs WHERE company_id = ? AND status = 'brief'").get(id) as { status: string; cost_usd: number };
  assert.equal(logged.cost_usd, 0.0021);
});
