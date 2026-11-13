/**
 * FOLLOW-THROUGH'S REAL PHONE CALL, OVER PLIVO (botsBots/followPhone.ts, followPhoneWords.ts, routes/bots/followChannels.ts,
 * screens/bots/followPhone.ts; docs/follow-channels.md). Only for X0 users who turned it on themselves, to their own proved number.
 *
 *   - the switch: off unless CHANNEL_PHONE_CALLS, every Plivo key, CONNECTOR_TOKEN_KEY and PLAN_V2_FOLLOW; its routes 404 then
 *   - the number: typed in the app, sealed, proved by the person calling X0's number and typing the code the screen shows (found by its
 *     keyed hash, then only the account whose code it is), changed, removed; one account per proved number; never a number outside
 *     PLIVO_ALLOWED_PREFIXES
 *   - the call: the exact Plivo request; never in quiet hours (or 10 pm to 7 am without them), never without a proved number, never when
 *     stopped or switched off, at most 3 a day (the ladder's caps); the words lock-safe
 *   - the keypad: 1 done, 2 later, 3 can't through the one reply door ("call"); another key once more; 9 stops calls to that number, kept
 *     by the number (adding it again never lifts it; a fresh proving call does); hang-up marks no answer unless a key was pressed
 *   - signatures: Plivo's V3 over PUBLIC_ORIGIN + the path, and our MAC on a call's own callbacks; nothing logged has a number or a MAC
 *   - the setup screen (bots.plan.phone) and What pings you's row
 *
 * Keys here are made fresh for each run (random bytes), never written down.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.NODE_ENV = "test";
  process.env.DEV_SKIP_AUTH = "true";
});

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const { Calendar, memoryCalendarRows } = await import("../src/calendar/index.js");
const { PlanEase } = await import("../src/botsBots/planEase.js");
const { memoryPlanPrefs } = await import("../src/botsBots/planPrefs.js");
const { MemoryTable } = await import("../src/botsBots/rows.js");
const { PlanFollows, setPlanFollows } = await import("../src/botsBots/planFollow.js");
const { memoryFollowStores } = await import("../src/botsBots/planFollowStore.js");
const { setFollowChannels, followChannels, phoneReady } = await import("../src/botsBots/planFollowChannels.js");
const { PUSH_DEFAULTS } = await import("../src/push/defaults.js");
const { DEFAULT_SETTINGS } = await import("../src/you/settings.js");
const { resetConfigForTests } = await import("../src/config.js");
const { numberHash, openNumber } = await import("../src/botsBots/planReach.js");
const { PlivoPhone, setFollowPhone, phoneCallsReady, callQueryOf, PHONE, PLIVO } = await import("../src/botsBots/followPhone.js");
const W = await import("../src/botsBots/followPhoneWords.js");
const { registerFollowChannelRoutes } = await import("../src/routes/bots/followChannels.js");
const { fastifyLoggerOptions, logUrl } = await import("../src/observability.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");

type YouSettings = import("../src/you/settings.js").YouSettings;
type PhoneView = import("../src/botsBots/followPhone.js").PhoneView;

const MIN = 60_000;
const IST = 330;
const ist = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h, m) - IST * MIN;
const U = "aaaaaaaa-0000-4000-8000-000000000001"; // Rahul, the asker
const M = "bbbbbbbb-0000-4000-8000-000000000002"; // Mom
const D = "cccccccc-0000-4000-8000-000000000003"; // Dad
const ORIGIN = "https://api.x0bot.com";
const FROM = "+918041234567";
const RAHUL_NO = "+919812345678";
const MOM_NO = "+919876543210";
const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const quiet = { info: () => undefined, warn: () => undefined };
const as = (u: string) => ({ authorization: `Bearer ${u}` });

let TOKEN = "";
/** The phone channel's switch and keys, made fresh (never written down). */
function switchOn(o: { calls?: boolean; id?: boolean; token?: boolean; from?: boolean; key?: boolean; follow?: boolean } = {}) {
  TOKEN = randomBytes(24).toString("hex");
  if (o.calls !== false) vi.stubEnv("CHANNEL_PHONE_CALLS", "true");
  if (o.id !== false) vi.stubEnv("PLIVO_AUTH_ID", `MA${randomBytes(9).toString("hex").toUpperCase()}`);
  if (o.token !== false) vi.stubEnv("PLIVO_AUTH_TOKEN", TOKEN);
  if (o.from !== false) vi.stubEnv("PLIVO_FROM_NUMBER", FROM);
  if (o.key !== false) vi.stubEnv("CONNECTOR_TOKEN_KEY", randomBytes(32).toString("base64"));
  if (o.follow === false) vi.stubEnv("PLAN_V2_FOLLOW", "false");
  vi.stubEnv("PUBLIC_ORIGIN", ORIGIN);
  resetConfigForTests();
}

beforeEach(() => { vi.stubEnv("SPACES_ENABLED", "true"); resetConfigForTests(); });
afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); setPlanFollows(null); setFollowChannels(null); setFollowPhone(null); });

interface Placed { url: string; auth: string; body: Record<string, unknown> }

/** A follow ladder (A's engine, memory tables) with the real Plivo channel plugged in, a fake Plivo, and the routes. */
async function rig(t0: number, o: { fetchStatus?: number } = {}) {
  const clock = { t: t0 };
  const now = () => clock.t;
  const calendar = new Calendar({ rows: memoryCalendarRows(), now, publish: () => undefined });
  const prefs = memoryPlanPrefs(now);
  const ease = new PlanEase({ calendar, prefs, skips: new MemoryTable(), now, send: async () => undefined });
  ease.attach();
  const stores = memoryFollowStores();
  let pushed = 0;
  const engine = { notify: async () => ({ sent: true, dropped: 0, id: `push-${++pushed}` }), configFor: () => structuredClone(PUSH_DEFAULTS) };
  // "X0 is calling" in the app does not ring here (no phone that takes calls): the real call is what is tested.
  const calls = { ring: async () => ({ none: "no_phone" }), closeFor: async () => undefined };
  const settings = new Map<string, YouSettings>();
  const settingsOf = async (u: string) => structuredClone(settings.get(u) ?? DEFAULT_SETTINGS);
  const saveSettings = async (u: string, s: YouSettings) => { settings.set(u, structuredClone(s)); };
  const set = (u: string, n: Partial<YouSettings["notify"]>) => { const s = structuredClone(settings.get(u) ?? DEFAULT_SETTINGS); s.notify = { ...s.notify, ...n }; settings.set(u, s); };
  const people: Record<string, Array<{ userId: string; name: string }>> = {
    [U]: [{ userId: M, name: "Mom" }, { userId: D, name: "Dad" }],
    [M]: [{ userId: U, name: "Rahul" }, { userId: D, name: "Dad" }],
    [D]: [{ userId: U, name: "Rahul" }, { userId: M, name: "Mom" }],
  };
  const follows = new PlanFollows({
    stores, calendar, now, engine: () => engine as never, calls: () => calls as never, settingsOf, saveSettings,
    contacts: async (u) => people[u] ?? [], muted: async () => false, spend: (u, d) => ease.policy.spend(u, d), tzOfUser: async () => IST, log: quiet,
  });
  setPlanFollows(follows);
  ease.wire({ follow: (u, c) => follows.arm(u, c) });
  calendar.setTickHook((u, t, w) => { void follows.taskTicked(u, t, w); });
  const placed: Placed[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    placed.push({ url: String(url), auth: String((init?.headers as Record<string, string>)?.authorization ?? ""), body });
    const status = o.fetchStatus ?? 201;
    return new Response(JSON.stringify(status < 300 ? { api_id: "a1", message: "call fired", request_uuid: `req-${placed.length}` } : { error: "no" }), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const phone = new PlivoPhone({ phones: stores.phones, stops: stores.phoneStops, follows: () => follows, fetch: fetchFn, now, settingsOf, saveSettings });
  setFollowPhone(phone);
  const logs: string[] = [];
  const stream = new Writable({ write(chunk, _enc, cb) { logs.push(String(chunk)); cb(); } });
  const app: FastifyInstance = Fastify({ logger: { ...fastifyLoggerOptions(), level: "info", stream } });
  registerFollowChannelRoutes(app, { rateLimit: RL });
  await app.ready();
  const at = async (d: number, h: number, m = 0) => { clock.t = ist(d, h, m); await calendar.remind(async () => undefined); await follows.sweep(clock.t); };
  const steps = async () => (await stores.steps.select({})).sort((a, b) => a.at_ms - b.at_ms || a.rung.localeCompare(b.rung));
  /** A form post from Plivo, signed as Plivo signs it (over PUBLIC_ORIGIN + the path). */
  const plivo = (path: string, form: Record<string, string>, x: { sign?: "good" | "bad" | "proxy" | "ma"; tamper?: Record<string, string> } = {}) => {
    const body = new URLSearchParams(form).toString();
    const nonce = randomBytes(8).toString("hex");
    const base = W.v3Base(`${x.sign === "proxy" ? "http://127.0.0.1:8080" : ORIGIN}${path}`, W.formOf(body));
    const sig = x.sign === "bad" ? W.v3Sign(randomBytes(8).toString("hex"), base, nonce) : W.v3Sign(TOKEN, base, nonce);
    const sent = x.tamper ? new URLSearchParams({ ...form, ...x.tamper }).toString() : body;
    return app.inject({
      method: "POST", url: path, payload: sent,
      headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8", "x-plivo-signature-v3-nonce": nonce, [x.sign === "ma" ? "x-plivo-signature-ma-v3" : "x-plivo-signature-v3"]: `${randomBytes(32).toString("base64")},${sig}` },
    });
  };
  /** Their number typed in the app (the screen shows the code), then the call from it, typing that code. */
  const prove = async (u: string, num: string) => {
    const put = await app.inject({ method: "PUT", url: PHONE, headers: as(u), payload: { phone: num } });
    expect(put.statusCode).toBe(200);
    const code = (put.json() as PhoneView).code!;
    expect(code).toMatch(/^\d{4}$/);
    const from = num.slice(1);
    expect((await plivo(`${PLIVO}/inbound`, { From: from, To: FROM.slice(1), CallUUID: "in-1" })).body).toContain("type the 4 digit code shown in your X0 app");
    expect((await plivo(`${PLIVO}/inbound/input`, { From: from, To: FROM.slice(1), CallUUID: "in-1", Digits: code })).body).toContain("You're set.");
  };
  const pathOf = (url: unknown) => String(url).replace(ORIGIN, "");
  const callForm = (n: number, more: Record<string, string> = {}) => ({ CallUUID: `call-${n}`, RequestUUID: `req-${n}`, From: FROM.slice(1), To: "919876543210", Direction: "outbound", CallStatus: "in-progress", ...more });
  const only = async () => { const all = await stores.follows.select({}); expect(all).toHaveLength(1); return all[0]!; };
  return { clock, calendar, follows, stores, settings, set, phone, placed, app, logs, at, steps, plivo, prove, pathOf, callForm, only };
}

/** A must to-do at 9 pm on Rahul's list, with an amount in its title. */
async function payMaid(r: Awaited<ReturnType<typeof rig>>, who: string[] = []) {
  const t = await r.calendar.addTask(U, { title: "Pay maid 8,000", day: "2026-11-12", time: "21:00", tz: IST });
  await r.follows.people.setItem(U, { kind: "task", id: t.id }, { importance: "must", ...(who.length ? { people: who.map((id) => ({ id })) } : {}) });
  return t;
}

// ===================================================================== the words and the pure parts

describe("the words and the signature", () => {
  it("keys: 1 done, 2 later, 3 can't, 9 stop; anything else asks again", () => {
    expect(["1", "2", "3", "9", "4", "", "#", "12", undefined].map(W.keyAnswer)).toEqual(["done", "later", "cant", "stop", null, null, null, null, null]);
  });

  it("the prompt names the asker for someone else's item, says the reminder lock-safe (no amount, no medicine), and always offers 9 to stop, in English and Hindi", () => {
    const en = W.promptWords({ asker: "Rahul", what: "Rent 25k", when: "9 pm", lang: "en" });
    expect(en).toBe("Hello, this is X0. Rahul asked me to remind you: Rent, 9 pm. If it's done, press 1. For later, press 2. If you can't, press 3. To stop these calls, press 9.");
    expect(W.promptWords({ asker: "", what: "", when: "today", lang: "en" })).toBe("Hello, this is X0. It's time for today's reminder. If it's done, press 1. For later, press 2. If you can't, press 3. To stop these calls, press 9.");
    expect(W.promptWords({ asker: "", what: "", when: "9 pm", lang: "en" })).toContain("It's time for your 9 pm reminder.");
    const hi = W.promptWords({ asker: "Rahul", what: "", when: "9 pm", lang: "hi" });
    expect(hi).toContain("Rahul ने आपको याद दिलाने को कहा है: आपका रिमाइंडर, 9 pm।");
    expect(hi).toContain("9 दबाएँ");
    // A name with markup in it never reaches the XML as markup.
    const xml = W.promptXml({ words: W.promptWords({ asker: "Tom <b>&", what: "", when: "9 pm", lang: "en" }), action: `${ORIGIN}/x?a=1&b=2`, lang: "en", voices: { en: "Polly.Raveena", hi: "Polly.Aditi" }, redirect: `${ORIGIN}/y?a=1&try=2` });
    expect(xml).not.toContain("<b>");
    expect(xml).toContain('action="https://api.x0bot.com/x?a=1&amp;b=2"');
    expect(xml).toContain('<GetInput action="https://api.x0bot.com/x?a=1&amp;b=2" method="POST" inputType="dtmf" numDigits="1" executionTimeout="8" digitEndTimeout="auto" redirect="true"><Speak voice="Polly.Raveena" language="en-IN">');
    expect(xml).toContain('<Redirect method="POST">https://api.x0bot.com/y?a=1&amp;try=2</Redirect>');
  });

  it("after a key: what X0 says for each outcome, in English and Hindi", () => {
    expect(W.afterKeyWords({ k: "done", asker: "Rahul" }, "en")).toBe("Thank you. I'll tell Rahul.");
    expect(W.afterKeyWords({ k: "done", asker: "" }, "en")).toBe("Thank you. That's done.");
    expect(W.afterKeyWords({ k: "later", clock: "9:30 pm" }, "en")).toBe("Okay. I'll remind you at 9:30 pm.");
    expect(W.afterKeyWords({ k: "passed", to: "Dad" }, "en")).toBe("Okay. I'll ask Dad.");
    expect(W.afterKeyWords({ k: "nobody", asker: "Rahul" }, "en")).toBe("Okay. I'll let Rahul know.");
    expect(W.afterKeyWords({ k: "dropped" }, "en")).toBe("Okay, not this time.");
    expect(W.afterKeyWords({ k: "already", who: "Dad" }, "en")).toBe("Dad already said done. Thank you.");
    expect(W.afterKeyWords({ k: "stop" }, "en")).toBe("Okay. X0 won't call this phone again. You can turn calls back on in X0.");
    expect(W.afterKeyWords({ k: "done", asker: "Rahul" }, "hi")).toBe("धन्यवाद। मैं Rahul को बता दूँगा।");
    expect(W.afterKeyWords({ k: "later", clock: "9:30 pm" }, "hi")).toBe("ठीक है। मैं 9:30 pm पर फिर याद दिलाऊँगा।");
  });

  it("signatures: the string Plivo signs is built as its SDKs build it (sorted query, '.', sorted body as key+value), and compared in constant time", () => {
    expect(W.v3Base("https://api.x0bot.com/v1/channels/plivo/answer?u=b&f=a&n=1", { To: ["91"], CallUUID: ["c1"] }))
      .toBe("https://api.x0bot.com/v1/channels/plivo/answer?f=a&n=1&u=b.CallUUIDc1To91");
    expect(W.v3Base("https://api.x0bot.com/v1/channels/plivo/inbound", { From: ["919876543210"], Digits: ["1"] }))
      .toBe("https://api.x0bot.com/v1/channels/plivo/inbound?Digits1From919876543210");
    expect(W.v3Base("https://api.x0bot.com/p?b=2&a=1", {})).toBe("https://api.x0bot.com/p?a=1&b=2");
    expect(W.v3Base("https://api.x0bot.com/p", {})).toBe("https://api.x0bot.com/p");
    const token = randomBytes(16).toString("hex");
    const url = "https://api.x0bot.com/p?f=a";
    const body = { Digits: ["1"] };
    const sig = W.v3Sign(token, W.v3Base(url, body), "n1");
    expect(W.v3Ok({ url, body, nonce: "n1", signatures: `other,${sig}`, token })).toBe(true);
    expect(W.v3Ok({ url, body, nonce: "n2", signatures: sig, token })).toBe(false);
    expect(W.v3Ok({ url, body: { Digits: ["2"] }, nonce: "n1", signatures: sig, token })).toBe(false);
    expect(W.v3Ok({ url: "http://localhost/p?f=a", body, nonce: "n1", signatures: sig, token })).toBe(false);
    expect(W.v3Ok({ url, body, nonce: "n1", signatures: sig, token: undefined })).toBe(false);
    expect(W.v3Ok({ url, body, nonce: "n1", signatures: undefined, token })).toBe(false);
  });

  it("numbers: as Plivo sends them, as a person sees them, the allowed prefixes, and quiet hours (theirs, else 10 pm to 7 am)", () => {
    expect(W.plivoNumber("918041234567")).toBe("+918041234567");
    expect(W.plivoNumber("+91 80412 34567")).toBe("+918041234567");
    expect(W.plivoNumber("anonymous")).toBeNull();
    expect(W.plivoNumber("0123")).toBeNull();
    expect(W.maskNumber(MOM_NO)).toBe("+91 98••• ••210");
    expect(W.spacedNumber(FROM)).toBe("+91 80412 34567");
    expect(W.spacedNumber(MOM_NO)).toBe("+91 98765 43210");
    expect(W.prefixAllowed(MOM_NO, "+91")).toBe(true);
    expect(W.prefixAllowed("+447700900123", "+91")).toBe(false);
    expect(W.prefixAllowed("+447700900123", "+91, +44")).toBe(true);
    expect(W.prefixAllowed(MOM_NO, "")).toBe(false);
    const none = DEFAULT_SETTINGS.notify;
    expect([21 * 60 + 59, 22 * 60, 3 * 60, 6 * 60 + 59, 7 * 60].map((m) => W.quietFor(none, m))).toEqual([false, true, true, true, false]);
    const own = { ...none, quiet: true, quietFrom: 23 * 60, quietTo: 6 * 60 };
    expect([22 * 60 + 30, 23 * 60, 6 * 60 + 30].map((m) => W.quietFor(own, m))).toEqual([false, true, false]);
  });

  it("a callback's query is ours only when every part is there and well formed", () => {
    const ok = { f: "eeeeeeee-0000-4000-8000-0000000000a1", n: "2", u: U, l: "hi", t: "AbCdEfGhIjKlMn_-", try: "2", again: "1" };
    expect(callQueryOf(ok)).toEqual({ f: ok.f, n: 2, u: U, l: "hi", t: ok.t, try: 2, again: true });
    expect(callQueryOf({ ...ok, l: "fr", try: "3", again: "0" })).toMatchObject({ l: "en", try: 1, again: false });
    for (const bad of [{ ...ok, f: "x" }, { ...ok, u: "1" }, { ...ok, n: "0" }, { ...ok, n: "1.5" }, { ...ok, t: "short" }, {}]) expect(callQueryOf(bad)).toBeNull();
  });
});

// ===================================================================== off

describe("the switch", () => {
  it("off unless CHANNEL_PHONE_CALLS, every Plivo key, CONNECTOR_TOKEN_KEY and PLAN_V2_FOLLOW are set; its routes answer 404 then", async () => {
    expect(phoneCallsReady()).toBe(false);
    for (const missing of ["calls", "id", "token", "from", "key", "follow"] as const) {
      vi.unstubAllEnvs(); vi.stubEnv("SPACES_ENABLED", "true");
      switchOn({ [missing]: false });
      expect({ missing, ready: phoneCallsReady() }).toEqual({ missing, ready: false });
    }
    vi.unstubAllEnvs(); vi.stubEnv("SPACES_ENABLED", "true");
    switchOn();
    expect(phoneCallsReady()).toBe(true);
    vi.unstubAllEnvs(); vi.stubEnv("SPACES_ENABLED", "true"); resetConfigForTests();
    const r = await rig(ist(12, 20));
    expect(phoneReady()).toBe(false);
    expect((await r.app.inject({ method: "GET", url: PHONE, headers: as(U) })).json()).toMatchObject({ ready: false, state: "none" });
    expect((await r.app.inject({ method: "PUT", url: PHONE, headers: as(U), payload: { phone: MOM_NO } })).statusCode).toBe(404);
    for (const p of ["answer", "input", "hangup", "inbound", "inbound/input"]) {
      expect((await r.plivo(`${PLIVO}/${p}`, { From: "919876543210" })).statusCode).toBe(404);
    }
    expect((await r.app.inject({ method: "GET", url: PHONE })).statusCode).toBe(401);
    await r.app.close();
  });
});

// ===================================================================== the number

describe("the person's own number", () => {
  it("number: typed in the app it is sealed and waits for its proving call; typing the screen's code on a call from it proves it (with a consent record) and turns their switch on", async () => {
    switchOn();
    const r = await rig(ist(12, 20));
    const put = await r.app.inject({ method: "PUT", url: PHONE, headers: as(U), payload: { phone: "98123 45678" } });
    expect(put.json()).toMatchObject({ ready: true, on: false, state: "pending", display: "+91 98••• ••678", callTo: { display: "+91 80412 34567", number: FROM }, code: expect.stringMatching(/^\d{4}$/) });
    const code = (put.json() as PhoneView).code!;
    const row = (await r.stores.phones.select({ user_id: U }))[0]!;
    expect(row.seal).not.toContain("9812345678");
    expect(openNumber(row.seal!)).toBe(RAHUL_NO);
    expect(row.pending_code).not.toContain(code);
    expect(row).toMatchObject({ hash: null, verified_ms: null, pending_hash: numberHash(RAHUL_NO) });
    expect(await r.phone.canCall(U, r.clock.t, IST)).toBe("off");
    const ask = await r.plivo(`${PLIVO}/inbound`, { From: "919812345678", To: "918041234567", CallUUID: "in-1" });
    expect(ask.headers["content-type"]).toContain("application/xml");
    expect(ask.body).toContain("To let X0 call this phone when you miss something important, type the 4 digit code shown in your X0 app now.");
    expect(ask.body).toContain('numDigits="4"');
    // Pressing 1 (or any wrong code) proves nothing.
    expect((await r.plivo(`${PLIVO}/inbound/input`, { From: "919812345678", Digits: "1" })).body).toContain("Nothing has changed.");
    expect((await r.plivo(`${PLIVO}/inbound/input`, { From: "919812345678", Digits: code === "1234" ? "4321" : "1234" })).body).toContain("That code doesn't match.");
    expect((await r.stores.phones.select({ user_id: U }))[0]!.verified_ms).toBeNull();
    const yes = await r.plivo(`${PLIVO}/inbound/input`, { From: "919812345678", To: "918041234567", CallUUID: "in-1", Digits: code });
    expect(yes.body).toContain("You're set.");
    expect(yes.body).toContain("<Hangup/>");
    const proved = (await r.stores.phones.select({ user_id: U }))[0]!;
    expect(proved).toMatchObject({ hash: numberHash(RAHUL_NO), pending_hash: null, stopped_ms: null, verified_ms: r.clock.t });
    expect(proved.consent.map((c) => c.how)).toEqual(["number_added", "inbound_call"]);
    expect(proved.consent.every((c) => c.v === W.PHONE_CONSENT_V)).toBe(true);
    expect(r.settings.get(U)!.notify.phoneCall).toBe(true);
    expect(await r.phone.canCall(U, r.clock.t, IST)).toBe("ok");
    expect(await r.phone.numberOf(U)).toEqual({ state: "verified", display: "+91 98••• ••678", setup: { screen: "bots.plan.phone" } });
    // The same number again changes nothing; another number waits for its own proof, and no call goes until then.
    await r.app.inject({ method: "PUT", url: PHONE, headers: as(U), payload: { phone: RAHUL_NO } });
    expect(await r.phone.canCall(U, r.clock.t, IST)).toBe("ok");
    expect((await r.app.inject({ method: "PUT", url: PHONE, headers: as(U), payload: { phone: MOM_NO } })).json()).toMatchObject({ state: "pending" });
    expect(await r.phone.canCall(U, r.clock.t, IST)).toBe("no_number");
    await r.app.close();
  });

  it("number: a number that won't do is refused in plain words; outside PLIVO_ALLOWED_PREFIXES it is refused as abroad", async () => {
    switchOn();
    const r = await rig(ist(12, 20));
    const bad = await r.app.inject({ method: "PUT", url: PHONE, headers: as(U), payload: { phone: "12345" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ code: "bad_number", message: "That number doesn't look right." });
    const abroad = await r.app.inject({ method: "PUT", url: PHONE, headers: as(U), payload: { phone: "+447700900123" } });
    expect(abroad.json()).toEqual({ code: "abroad", message: "X0 can only call numbers starting +91 for now." });
    expect(await r.stores.phones.select({})).toHaveLength(0);
    await r.app.close();
  });

  it("inbound: a waiting number is found by its keyed hash (nothing is opened or scanned to find it); an unknown number hears one line and is hung up on; a wait that ran out proves nothing", async () => {
    switchOn();
    const r = await rig(ist(12, 20));
    const code = ((await r.app.inject({ method: "PUT", url: PHONE, headers: as(U), payload: { phone: RAHUL_NO } })).json() as PhoneView).code!;
    const pending = vi.spyOn(r.stores.phones, "byPendingHash");
    const select = vi.spyOn(r.stores.phones, "select");
    await r.plivo(`${PLIVO}/inbound`, { From: "919812345678" });
    expect(pending).toHaveBeenCalledWith(numberHash(RAHUL_NO), r.clock.t, 5);
    expect(select).not.toHaveBeenCalled();
    const stranger = await r.plivo(`${PLIVO}/inbound`, { From: "919000000001" });
    expect(stranger.body).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Speak voice="Polly.Raveena" language="en-IN">This number only makes reminder calls for X0. Goodbye.</Speak><Hangup/></Response>');
    expect((await r.plivo(`${PLIVO}/inbound`, { From: "anonymous" })).body).toContain("This number only makes reminder calls for X0.");
    r.clock.t += 31 * MIN;
    expect((await r.plivo(`${PLIVO}/inbound`, { From: "919812345678" })).body).toContain("This number only makes reminder calls for X0.");
    expect((await r.plivo(`${PLIVO}/inbound/input`, { From: "919812345678", Digits: code })).body).toContain("That took too long.");
    expect((await r.stores.phones.select({ user_id: U }))[0]!.verified_ms).toBeNull();
    await r.app.close();
  });

  it("number: Remove takes it away, keeps what they agreed and when, and turns their switch off", async () => {
    switchOn();
    const r = await rig(ist(12, 20));
    await r.prove(U, RAHUL_NO);
    const gone = await r.app.inject({ method: "DELETE", url: PHONE, headers: as(U) });
    expect(gone.json()).toMatchObject({ state: "none", display: "", on: false });
    const row = (await r.stores.phones.select({ user_id: U }))[0]!;
    expect(row).toMatchObject({ seal: null, hash: null, verified_ms: null });
    expect(row.consent.map((c) => c.how)).toEqual(["number_added", "inbound_call", "number_removed"]);
    expect(await r.phone.canCall(U, r.clock.t, IST)).toBe("off");
    await r.app.close();
  });
});

// ===================================================================== the call

describe("the call", () => {
  it("call: the exact Plivo request (from, to, answer and hangup URLs with f, n, u, l and t, 30 s ring, 120 s limit, machine detection), once at +15 for their own must item", async () => {
    switchOn();
    const r = await rig(ist(12, 20));
    await r.prove(U, RAHUL_NO);
    await payMaid(r);
    for (const m of [0, 5, 10, 15, 15, 16]) await r.at(12, 21, m);
    expect(r.placed).toHaveLength(1);
    const p = r.placed[0]!;
    const id = process.env.PLIVO_AUTH_ID!;
    expect(p.url).toBe(`https://api.plivo.com/v1/Account/${id}/Call/`);
    expect(p.auth).toBe(`Basic ${Buffer.from(`${id}:${TOKEN}`).toString("base64")}`);
    const f = await r.only();
    const t = (p.body.answer_url as string).match(/&t=([A-Za-z0-9_-]{16})$/)![1]!;
    expect(p.body).toEqual({
      from: "918041234567", to: "919812345678",
      answer_url: `${ORIGIN}/v1/channels/plivo/answer?f=${f.id}&n=1&u=${U}&l=en&t=${t}`, answer_method: "POST",
      hangup_url: `${ORIGIN}/v1/channels/plivo/hangup?f=${f.id}&n=1&u=${U}&l=en&t=${t}`, hangup_method: "POST",
      ring_timeout: 30, time_limit: 120, machine_detection: "hangup",
    });
    expect((await r.steps()).find((s) => s.rung === "phone")).toMatchObject({ state: "sent", ext: "req-1", channel: "phone", person: `u:${U}` });
    await r.app.close();
  });

  it("call: never in their quiet hours (or 10 pm to 7 am without them), never without a proved number, never when stopped or switched off, never with Plan Ease's pings off", async () => {
    switchOn();
    const r = await rig(ist(12, 21, 15));
    expect(await r.phone.canCall(U, r.clock.t, IST)).toBe("off");
    r.set(U, { phoneCall: true });
    expect(await r.phone.canCall(U, r.clock.t, IST)).toBe("no_number");
    await r.app.inject({ method: "PUT", url: PHONE, headers: as(U), payload: { phone: RAHUL_NO } });
    expect(await r.phone.canCall(U, r.clock.t, IST)).toBe("no_number");
    await r.prove(U, RAHUL_NO);
    expect(await r.phone.canCall(U, r.clock.t, IST)).toBe("ok");
    expect(await r.phone.canCall(U, ist(12, 22, 30), IST)).toBe("quiet");
    expect(await r.phone.canCall(U, ist(13, 6, 30), IST)).toBe("quiet");
    r.set(U, { quiet: true, quietFrom: 21 * 60, quietTo: 6 * 60 });
    expect(await r.phone.canCall(U, r.clock.t, IST)).toBe("quiet");
    expect(await r.phone.canCall(U, ist(13, 6, 30), IST)).toBe("ok");
    r.set(U, { quiet: false, botsOff: ["plan"] });
    expect(await r.phone.canCall(U, r.clock.t, IST)).toBe("off");
    r.set(U, { botsOff: [] });
    await r.stores.phones.update({ user_id: U }, { stopped_ms: r.clock.t });
    expect(await r.phone.canCall(U, r.clock.t, IST)).toBe("stopped");
    expect(await r.phone.call({ followId: "eeeeeeee-0000-4000-8000-0000000000a1", n: 1, userId: U, person: `u:${U}`, asker: "", what: "", when: "9 pm", tz: IST, now: r.clock.t })).toEqual({ ok: false, why: "refused_no_number" });
    expect(r.placed).toHaveLength(0);
    await r.app.close();
  });

  it("call: never to a number outside PLIVO_ALLOWED_PREFIXES (abroad), even one proved before the prefixes changed", async () => {
    switchOn();
    const r = await rig(ist(12, 21, 15));
    await r.prove(U, RAHUL_NO);
    vi.stubEnv("PLIVO_ALLOWED_PREFIXES", "+44"); resetConfigForTests();
    expect(await r.phone.canCall(U, r.clock.t, IST)).toBe("abroad");
    expect(await r.phone.call({ followId: "eeeeeeee-0000-4000-8000-0000000000a1", n: 1, userId: U, person: `u:${U}`, asker: "", what: "", when: "9 pm", tz: IST, now: r.clock.t })).toEqual({ ok: false, why: "refused_abroad" });
    expect(r.placed).toHaveLength(0);
    await r.app.close();
  });

  it("call: at most 3 a day for one person (the ladder's caps); a call Plivo refused gives its caps back", async () => {
    switchOn();
    const r = await rig(ist(12, 20));
    await r.prove(U, RAHUL_NO);
    r.set(U, { ringMax: 10 });
    for (let i = 0; i < 4; i += 1) await payMaid(r);
    for (const m of [0, 5, 10, 15]) await r.at(12, 21, m);
    expect(r.placed).toHaveLength(3);
    const phones = (await r.steps()).filter((s) => s.rung === "phone");
    expect(phones.map((s) => s.state).sort()).toEqual(["sent", "sent", "sent", "skipped"]);
    expect(phones.find((s) => s.state === "skipped")!.why).toBe("cap");
    expect((await r.stores.caps.select({ person: `p:${U}` }))[0]!.n).toBe(3);
    await r.app.close();
    // Refused by Plivo (a 4xx): it never left, so it never counts.
    vi.unstubAllEnvs(); vi.stubEnv("SPACES_ENABLED", "true"); switchOn();
    const r2 = await rig(ist(12, 20), { fetchStatus: 401 });
    await r2.prove(U, RAHUL_NO);
    await payMaid(r2);
    for (const m of [0, 5, 10, 15]) await r2.at(12, 21, m);
    expect((await r2.steps()).find((s) => s.rung === "phone")).toMatchObject({ state: "failed", why: "http_401" });
    expect((await r2.stores.caps.select({ person: `p:${U}` }))[0]?.n ?? 0).toBe(0);
    await r2.app.close();
  });
});

// ===================================================================== the keypad

describe("the keypad", () => {
  async function ringing(o: { mom?: boolean } = {}) {
    switchOn();
    const r = await rig(ist(12, 20));
    if (o.mom) {
      r.set(M, { followFrom: [U] });
      await r.prove(M, MOM_NO);
      await payMaid(r, [M, D]);
    } else {
      await r.prove(U, RAHUL_NO);
      await payMaid(r);
    }
    for (const m of [0, 5, 10, 15]) await r.at(12, 21, m);
    expect(r.placed).toHaveLength(1);
    const answer = r.pathOf(r.placed[0]!.body.answer_url);
    const input = answer.replace("/answer?", "/input?");
    const hangup = r.pathOf(r.placed[0]!.body.hangup_url);
    return { r, answer, input, hangup };
  }

  it("answer: GetInput for one key with their voice and language; the words are lock-safe (no amount) and name the asker for someone else's item; the second try hangs up as no answer", async () => {
    const { r, answer } = await ringing({ mom: true });
    const picked = await r.plivo(answer, r.callForm(1));
    expect(picked.statusCode).toBe(200);
    expect(picked.headers["content-type"]).toContain("application/xml");
    expect(picked.body).toContain(`<Speak voice="Polly.Raveena" language="en-IN">Hello, this is X0. Rahul asked me to remind you: Pay maid, 9 pm. If it's done, press 1. For later, press 2. If you can't, press 3. To stop these calls, press 9.</Speak>`);
    expect(picked.body).not.toContain("8,000");
    expect(picked.body).toContain(`action="${ORIGIN}${answer.replace("/answer?", "/input?").replace(/&/g, "&amp;")}"`);
    expect(picked.body).toContain(`<Redirect method="POST">${ORIGIN}${answer.replace(/&/g, "&amp;")}&amp;try=2</Redirect>`);
    // The provider's call id replaces the request id on the step.
    expect((await r.steps()).find((s) => s.rung === "phone")).toMatchObject({ ext: "call-1", person: `u:${M}` });
    const second = await r.plivo(`${answer}&try=2`, r.callForm(1));
    expect(second.body).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    expect((await r.steps()).find((s) => s.rung === "phone")!.state).toBe("no_answer");
    await r.app.close();
  });

  it("input: 1 answers done as \"call\": the to-do is ticked, the asker's name is said, the step is answered, and hang-up never takes that back", async () => {
    const { r, answer, input, hangup } = await ringing({ mom: true });
    await r.plivo(answer, r.callForm(1));
    const one = await r.plivo(input, r.callForm(1, { Digits: "1" }));
    expect(one.body).toContain(">Thank you. I'll tell Rahul.</Speak><Hangup/>");
    const f = await r.only();
    expect(f).toMatchObject({ state: "done", done_via: "call", done_by: { id: M } });
    expect(f.answers.at(-1)).toMatchObject({ by: `u:${M}`, verb: "done", via: "call" });
    expect((await r.calendar.task(U, f.item.slice(3))).done).toBe(true);
    expect((await r.steps()).find((s) => s.rung === "phone")!.state).toBe("answered");
    expect((await r.plivo(hangup, r.callForm(1, { CallStatus: "completed", AnswerTime: "2026-11-12 21:15:20" }))).statusCode).toBe(200);
    expect((await r.steps()).find((s) => s.rung === "phone")!.state).toBe("answered");
    // A second 1 (a retry) is the same answer.
    expect((await r.plivo(input, r.callForm(1, { Digits: "1" }))).body).toContain("already said done");
    await r.app.close();
  });

  it("input: 2 puts it off (\"I'll remind you at 9:30 pm\"); 3 hands it to the next person (\"I'll ask Dad\")", async () => {
    const own = await ringing();
    await own.r.plivo(own.answer, own.r.callForm(1));
    const two = await own.r.plivo(own.input, own.r.callForm(1, { Digits: "2" }));
    expect(two.body).toContain(">Okay. I'll remind you at 9:30 pm.</Speak>");
    expect(await own.r.only()).toMatchObject({ state: "snoozed", n: 2, laters: 1 });
    await own.r.app.close();
    vi.unstubAllEnvs(); vi.stubEnv("SPACES_ENABLED", "true");
    const mom = await ringing({ mom: true });
    await mom.r.plivo(mom.answer, mom.r.callForm(1));
    const three = await mom.r.plivo(mom.input, mom.r.callForm(1, { Digits: "3" }));
    expect(three.body).toContain(">Okay. I'll ask Dad.</Speak>");
    expect(await mom.r.only()).toMatchObject({ holder_key: `u:${D}`, cant: [`u:${M}`] });
    await mom.r.app.close();
  });

  it("input: another key asks once more, then hangs up; an old call for a climb that moved on says so", async () => {
    const { r, answer, input } = await ringing();
    await r.plivo(answer, r.callForm(1));
    const seven = await r.plivo(input, r.callForm(1, { Digits: "7" }));
    expect(seven.body).toContain("Sorry, I didn't get that. Hello, this is X0.");
    expect(seven.body).toContain("&amp;again=1");
    const again = await r.plivo(`${input}&again=1`, r.callForm(1, { Digits: "7" }));
    expect(again.body).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    expect((await r.only()).state).toBe("open");
    // Done in the app while the phone rang: the call only says it isn't open any more.
    await r.follows.reply({ followId: (await r.only()).id, by: `u:${U}`, answer: "done", via: "app" });
    expect((await r.plivo(answer, r.callForm(1))).body).toContain("That reminder isn't open any more.");
    await r.app.close();
  });

  it("input: 9 stops calls to that number and turns the switch off, without answering the reminder; the stop is kept by the number, so adding it again (on any account) never lifts it, only a fresh proving call does", async () => {
    const { r, answer, input } = await ringing();
    await r.plivo(answer, r.callForm(1));
    const nine = await r.plivo(input, r.callForm(1, { Digits: "9" }));
    expect(nine.body).toContain(">Okay. X0 won't call this phone again. You can turn calls back on in X0.</Speak><Hangup/>");
    expect((await r.stores.phones.select({ user_id: U }))[0]!.stopped_ms).toBe(r.clock.t);
    expect(r.settings.get(U)!.notify.phoneCall).toBe(false);
    expect(await r.phone.canCall(U, r.clock.t, IST)).toBe("off");
    expect(await r.stores.phoneStops.select({ hash: numberHash(RAHUL_NO) })).toHaveLength(1);
    expect((await r.only()).state).toBe("open");
    expect(await r.phone.numberOf(U)).toMatchObject({ state: "stopped" });
    // Dad types the same number into his own account: the stop stays; pressing 1 (the old way) proves nothing, and he gets no call.
    r.set(D, { phoneCall: true });
    await r.app.inject({ method: "PUT", url: PHONE, headers: as(D), payload: { phone: RAHUL_NO } });
    expect((await r.plivo(`${PLIVO}/inbound/input`, { From: "919812345678", Digits: "1" })).body).toContain("Nothing has changed.");
    expect(await r.phone.canCall(D, r.clock.t, IST)).toBe("no_number");
    expect(await r.stores.phoneStops.select({ hash: numberHash(RAHUL_NO) })).toHaveLength(1);
    // Rahul adds it again: still stopped until his proving call.
    const again = await r.app.inject({ method: "PUT", url: PHONE, headers: as(U), payload: { again: true } });
    expect(again.json()).toMatchObject({ state: "pending" });
    r.set(U, { phoneCall: true });
    expect(await r.phone.canCall(U, r.clock.t, IST)).toBe("no_number");
    expect(await r.stores.phoneStops.select({ hash: numberHash(RAHUL_NO) })).toHaveLength(1);
    // The fresh proving call from that phone, with Rahul's code: proved, the stop lifted, Dad's wait untouched.
    await r.plivo(`${PLIVO}/inbound/input`, { From: "919812345678", Digits: (again.json() as PhoneView).code! });
    expect(await r.phone.canCall(U, r.clock.t, IST)).toBe("ok");
    expect(await r.stores.phoneStops.select({})).toHaveLength(0);
    expect((await r.stores.phones.select({ user_id: D }))[0]!.verified_ms).toBeNull();
    // A proved number calling X0 hears how to stop, and 9 does it.
    expect((await r.plivo(`${PLIVO}/inbound`, { From: "919812345678" })).body).toContain("type the 4 digit code");
    await r.app.inject({ method: "DELETE", url: PHONE, headers: as(D) });
    expect((await r.plivo(`${PLIVO}/inbound`, { From: "919812345678" })).body).toContain("This phone is already set up for X0's calls. To stop them, press 9.");
    expect((await r.plivo(`${PLIVO}/inbound/input`, { From: "919812345678", Digits: "9" })).body).toContain("X0 won't call this phone again.");
    expect(await r.phone.canCall(U, r.clock.t, IST)).toBe("off");
    await r.app.close();
  });

  it("proof: two accounts waiting on the same number: one call proves only the account whose code it typed; the other stays unproved and is never called", async () => {
    switchOn();
    const r = await rig(ist(12, 20));
    // Mom (M) types Rahul's number into her own account; Rahul sets up his.
    const theirs = ((await r.app.inject({ method: "PUT", url: PHONE, headers: as(M), payload: { phone: RAHUL_NO } })).json() as PhoneView).code!;
    const mine = ((await r.app.inject({ method: "PUT", url: PHONE, headers: as(U), payload: { phone: RAHUL_NO } })).json() as PhoneView).code!;
    expect(mine).not.toBe(theirs);
    expect((await r.plivo(`${PLIVO}/inbound/input`, { From: "919812345678", Digits: mine })).body).toContain("You're set.");
    expect((await r.stores.phones.select({ user_id: U }))[0]).toMatchObject({ verified_ms: r.clock.t, hash: numberHash(RAHUL_NO) });
    expect((await r.stores.phones.select({ user_id: M }))[0]).toMatchObject({ verified_ms: null, hash: null });
    expect(r.settings.get(U)!.notify.phoneCall).toBe(true);
    expect(r.settings.get(M)?.notify.phoneCall ?? false).toBe(false);
    r.set(M, { phoneCall: true });
    expect(await r.phone.canCall(M, ist(12, 21), IST)).toBe("no_number");
    expect(await r.phone.numberKey(M)).toBeNull();
    expect(await r.phone.numberKey(U)).toBe(numberHash(RAHUL_NO));
    await r.app.close();
  });

  it("proof: a proved number is on one account only: a fresh proof on another account moves it there and the first one's switch goes off", async () => {
    switchOn();
    const r = await rig(ist(12, 20));
    await r.prove(U, RAHUL_NO);
    await r.prove(D, RAHUL_NO);
    expect((await r.stores.phones.select({})).filter((x) => x.hash === numberHash(RAHUL_NO)).map((x) => x.user_id)).toEqual([D]);
    expect((await r.stores.phones.select({ user_id: U }))[0]!.consent.at(-1)!.how).toBe("proved_on_another_account");
    expect(r.settings.get(U)!.notify.phoneCall).toBe(false);
    expect(await r.phone.canCall(U, ist(12, 21), IST)).toBe("off");
    expect(await r.phone.canCall(D, ist(12, 21), IST)).toBe("ok");
    await r.app.close();
  });

  it("hangup: no key is no_answer", async () => {
    const { r, hangup } = await ringing();
    await r.plivo(hangup, { RequestUUID: "req-1", CallUUID: "call-1", CallStatus: "completed" });
    expect((await r.steps()).find((s) => s.rung === "phone")!.state).toBe("no_answer");
    await r.app.close();
  });

  it("signatures: V3 over the PUBLIC_ORIGIN URL passes (either header); a wrong signature, one over the proxy's own host, a changed body or a wrong t is refused", async () => {
    const { r, answer, input } = await ringing();
    expect((await r.plivo(answer, r.callForm(1))).statusCode).toBe(200);
    expect((await r.plivo(answer, r.callForm(1), { sign: "ma" })).statusCode).toBe(200);
    expect((await r.plivo(answer, r.callForm(1), { sign: "bad" })).statusCode).toBe(403);
    expect((await r.plivo(answer, r.callForm(1), { sign: "proxy" })).statusCode).toBe(403);
    expect((await r.plivo(input, r.callForm(1, { Digits: "3" }), { tamper: { Digits: "1" } })).statusCode).toBe(403);
    const forged = answer.replace(/&t=[A-Za-z0-9_-]{16}/, "&t=AAAAAAAAAAAAAAAA");
    expect((await r.plivo(forged, r.callForm(1))).statusCode).toBe(403);
    const otherPerson = answer.replace(`u=${U}`, `u=${M}`);
    expect((await r.plivo(otherPerson, r.callForm(1))).statusCode).toBe(403);
    const unsigned = await r.app.inject({ method: "POST", url: answer, payload: "CallUUID=call-1", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(unsigned.statusCode).toBe(403);
    expect((await r.only()).state).toBe("open");
    await r.app.close();
  });

  it("nothing logged has a number, our MAC or the words", async () => {
    const { r, answer, input, hangup } = await ringing({ mom: true });
    await r.plivo(answer, r.callForm(1));
    await r.plivo(input, r.callForm(1, { Digits: "1" }));
    await r.plivo(hangup, r.callForm(1));
    const t = answer.match(/&t=([A-Za-z0-9_-]{16})/)![1]!;
    const all = r.logs.join("\n");
    expect(all).toContain("/v1/channels/plivo/answer");
    for (const secret of ["9876543210", "98765", t, "Pay maid", "Rahul asked", TOKEN]) expect({ secret, found: all.includes(secret) }).toEqual({ secret, found: false });
    expect(logUrl(answer)).toBe("/v1/channels/plivo/answer");
    await r.app.close();
  });
});

// ===================================================================== the screens

describe("the setup screen and What pings you", () => {
  const PHONE_CAPS = ["BotsKit", "BotsMotion", "BotMoments", "BotStage", "LiveWords", "VoiceLive", "DoubleTap", "KitExtras", "ActionParams", "AskStream", "BotCall", "PersonBot", "PushButton"];
  const DESK_CAPS = ["BotsKit", "BotsMotion", "BotMoments", "BotStage", "LiveWords", "VoiceLive", "DoubleTap", "KitExtras", "DeskShell", "PersonBot"];
  async function draw(screenId: string, client: "phone" | "desktop", api: Record<string, unknown>) {
    const s = await buildBotsScreen({
      screenId, client, params: {}, tzOffsetMinutes: IST, user: { id: U, name: "Rahul" }, can: new Set(client === "phone" ? PHONE_CAPS : DESK_CAPS),
      desk: { pages: client === "desktop", notes: false },
    }, fakeDeps({ api }));
    const nodes = walk(s.root!);
    return { s, json: JSON.stringify(s), texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? "")) };
  }
  const view = (v: Partial<PhoneView>): PhoneView => ({ ready: true, on: true, state: "none", display: "", callTo: null, code: null, until: null, quiet: "Never between 10 pm and 7 am. Set quiet hours in What pings you to change that.", ...v });

  it("bots.plan.phone: each state draws on phone and desktop, lint clean; the window never offers to dial; with calls off it says so", async () => {
    const states: Record<string, PhoneView> = {
      none: view({ on: false }),
      pending: view({ state: "pending", display: "+91 98••• ••210", callTo: { display: "+91 80412 34567", number: FROM }, until: ist(12, 21) }),
      verified: view({ state: "verified", display: "+91 98••• ••210" }),
      stopped: view({ on: false, state: "stopped", display: "+91 98••• ••210" }),
      off: view({ ready: false, on: false }),
    };
    for (const client of ["phone", "desktop"] as const) {
      for (const [name, v] of Object.entries(states)) {
        const d = await draw("bots.plan.phone", client, { [`GET ${PHONE}`]: v });
        expect({ client, name, lint: lintTree(d.s.root!) }).toEqual({ client, name, lint: [] });
        if (name === "off") { expect(d.texts).toContain("Not here yet"); continue; }
        expect(d.texts).toContain("X0 may call my phone if I miss something important");
        expect(d.json.includes('"kind":"phone"')).toBe(client === "phone" && name === "pending");
      }
    }
    const pending = await draw("bots.plan.phone", "phone", { [`GET ${PHONE}`]: states.pending });
    expect(pending.texts).toContain("Now call +91 80412 34567 once from +91 98••• ••210.");
    expect(pending.json).toContain(`{"kind":"phone","number":"${FROM}"}`);
    const verified = await draw("bots.plan.phone", "phone", { [`GET ${PHONE}`]: states.verified });
    expect(verified.texts).toEqual(expect.arrayContaining(["+91 98••• ••210", "Confirmed. X0 calls only this number."]));
    expect(verified.json).toContain('"method":"DELETE"');
    const stopped = await draw("bots.plan.phone", "phone", { [`GET ${PHONE}`]: states.stopped });
    expect(stopped.texts).toContain("You pressed 9 on a call, so X0 stopped calling +91 98••• ••210.");
    expect(stopped.json).toContain('"again":true');
    const none = await draw("bots.plan.phone", "desktop", { [`GET ${PHONE}`]: states.none });
    expect(none.json).toContain('"phone":"$state.num"');
  });

  it("What pings you: the real call's row opens the number's screen in every state, as \"Set up your number\", \"Your number for calls\" or \"Turn calls back on\"", async () => {
    const notify = (client: "phone" | "desktop", state: string) => draw("bots.notify", client, {
      [`GET /v1/you/notify?tz=${IST}`]: {
        settings: { ...DEFAULT_SETTINGS, notify: { ...DEFAULT_SETTINGS.notify, phoneCall: true } }, today: null, line: null, calls: true, follow: true, followFrom: [],
        phone: { number: { state, display: state === "none" ? "" : "+91 98••• ••210", setup: { screen: "bots.plan.phone" } } },
      },
    });
    for (const client of ["phone", "desktop"] as const) {
      const cases: Array<[string, string, string]> = [
        ["none", "Add your number first", "Set up your number"],
        ["pending", "Confirm your number first", "Set up your number"],
        ["verified", "Only to +91 98••• ••210, never in quiet hours", "Your number for calls"],
        ["stopped", "You stopped calls from a call", "Turn calls back on"],
      ];
      for (const [state, sub, open] of cases) {
        const d = await notify(client, state);
        expect({ client, state, has: [sub, open].every((x) => d.texts.includes(x)) }).toEqual({ client, state, has: true });
        expect(d.json).toContain('"screenId":"bots.plan.phone"');
        expect(lintTree(d.s.root!)).toEqual([]);
      }
    }
  });

  it("the channel is plugged in at boot and What pings you sees it only once calls can go", async () => {
    const r = await rig(ist(12, 20));
    expect(followChannels().phone).toBe(r.phone);
    expect(phoneReady()).toBe(false);
    switchOn();
    expect(phoneReady()).toBe(true);
    await r.app.close();
    expect(followChannels().phone).toBeNull();
  });
});
