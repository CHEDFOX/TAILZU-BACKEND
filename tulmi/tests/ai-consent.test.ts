/**
 * THE AI PERMISSION (src/privacy/aiGate.ts, aiConsent.ts; App Review 5.1.1(i), 5.1.2(i)): nothing of a person's is sent to an AI service
 * until they tap Agree, and they can take it back. Asked once per wording ("the user need to agree to the terms just once until we update
 * something").
 *
 *   - the gate: no check installed, or no person, lets everything through; a person who has not agreed gets a 403 the SDK does not
 *     retry, from a guarded client and from the guarded fetch alike, and only for the AI services' hosts; work as a person
 *     (asPerson) is theirs; the error handler answers it 403 ai_consent_needed with words that point at You › Privacy
 *   - the route: GET says whether they agreed and whether they answered this wording; PUT agrees, says Not now and withdraws (each an
 *     answer, kept; only a yes grants), and the gate sees it at once; a general personality write cannot set any of it
 *   - Home asks first (before the arrival and About cards), with what is sent, to whom, Agree and Not now, and only until it is answered
 *     for this wording; You › Privacy has the switch
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import OpenAI from "openai";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const PEOPLE: Record<string, string> = {
  aanya: "11111111-1111-4111-8111-111111111111", rohan: "22222222-2222-4222-8222-222222222222", meera: "33333333-3333-4333-8333-333333333333",
  kabir: "44444444-4444-4444-8444-444444444444", zoya: "55555555-5555-4555-8555-555555555555",
  neel: "66666666-6666-4666-8666-666666666666", isha: "77777777-7777-4777-8777-777777777777", dev: "88888888-8888-4888-8888-888888888888",
  tara: "99999999-9999-4999-8999-999999999999", omar: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const k = h?.replace(/^Bearer\s+/i, "").trim() ?? ""; return PEOPLE[k] ? { id: PEOPLE[k], email: `${k}@example.in` } : null; } };
});

const gate = await import("../src/privacy/aiGate.js");
const consent = await import("../src/privacy/aiConsent.js");
const { registerErrorHandling } = await import("../src/http/errors.js");
const { registerPersonalityRoutes } = await import("../src/routes/account/personality.js").catch(() => ({ registerPersonalityRoutes: undefined }));
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, IST } = await import("../src/experience/bots/fixtures.js");
const { lintTree } = await import("../src/experience/bots/lint.js");
const { getPersonality, savePersonality } = await import("../src/personality/store.js");

const RL = { rateLimit: { max: 10_000, timeWindow: 60_000 } };

function app() {
  const a = Fastify();
  a.addHook("preHandler", gate.aiScopeHook);
  registerErrorHandling(a);
  consent.registerAiConsentRoutes(a, RL);
  return a;
}
const as = (who: string) => ({ authorization: `Bearer ${who}` });

afterEach(() => { gate.installAiCheck(null); consent.forgetAiConsent(); });

describe("the gate", () => {
  it("lets everything through with no check installed, and for work that is no one's", async () => {
    expect(await gate.aiAllowed()).toBe(true);
    consent.installAiConsent();
    expect(await gate.aiAllowed()).toBe(true);
    expect(await gate.aiAllowedFor(null)).toBe(true);
  });

  it("stops a guarded client's call for a person who has not agreed, at once and without retries, and lets it go once they agree", async () => {
    consent.installAiConsent();
    let reached = 0;
    const client = gate.guardClient(new OpenAI({
      apiKey: "k", baseURL: "https://openrouter.ai/api/v1", maxRetries: 2,
      fetch: (async () => { reached += 1; return new Response(JSON.stringify({ id: "x", choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }] }), { status: 200, headers: { "content-type": "application/json" } }); }) as never,
    }));
    const ask = () => client.chat.completions.create({ model: "m", messages: [{ role: "user", content: "hello" }] });
    const err = await gate.asPerson(PEOPLE.aanya!, () => ask().catch((e) => e));
    expect(gate.isAiConsentError(err)).toBe(true);
    expect((err as { status?: number }).status).toBe(403);
    expect(reached).toBe(0);
    await consent.setAiConsent({ id: PEOPLE.aanya! }, true);
    const ok = await gate.asPerson(PEOPLE.aanya!, ask);
    expect(ok.choices[0]?.message.content).toBe("hi");
    expect(reached).toBe(1);
    // Rohan has not agreed: Aanya's yes is hers alone.
    expect(gate.isAiConsentError(await gate.asPerson(PEOPLE.rohan!, () => ask().catch((e) => e)))).toBe(true);
  });

  it("stops a raw call to an AI service's host, and nothing else", async () => {
    consent.installAiConsent();
    const before = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (u: string) => { seen.push(String(u)); return new Response("{}", { status: 200 }); }) as typeof fetch;
    try {
      gate.installAiFetchGuard();
      const r = await gate.asPerson(PEOPLE.meera!, () => fetch("https://api.deepgram.com/v1/listen"));
      expect(r.status).toBe(403);
      expect(await r.json()).toMatchObject({ error: { code: gate.AI_CONSENT_CODE } });
      expect((await gate.asPerson(PEOPLE.meera!, () => fetch("https://www.googleapis.com/calendar/v3"))).status).toBe(200);
      expect(seen).toEqual(["https://www.googleapis.com/calendar/v3"]);
      expect(gate.isAiHost("https://eu.api.openai.com/v1")).toBe(true);
      expect(gate.isAiHost("https://notopenrouter.ai.evil.com")).toBe(false);
    } finally {
      globalThis.fetch = before;
    }
  });

  it("knows a request's person from its sign-in, and answers a refused call 403 with words to act on", async () => {
    consent.installAiConsent();
    const a = app();
    a.get("/v1/try", async () => {
      if (!(await gate.aiAllowed())) throw new gate.AiConsentNeeded();
      return { ok: true };
    });
    const r = await a.inject({ method: "GET", url: "/v1/try", headers: as("kabir") });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ code: "ai_consent_needed", message: gate.AI_CONSENT_TEXT });
    expect((await a.inject({ method: "GET", url: "/v1/try" })).statusCode).toBe(200);
    // Home's card is asked once, so the words point only at You › Privacy. Their first 40 characters are as before: older clients, and
    // isAiConsentError, know a refusal by them (the old words still read as one).
    expect(gate.AI_CONSENT_TEXT).toBe("X0 Bot needs your OK before it sends anything to AI services. Turn it on in You › Privacy.");
    expect(gate.AI_CONSENT_TEXT).not.toMatch(/tap Agree|Open X0 Bot/);
    expect(gate.AI_CONSENT_TEXT.slice(0, 40)).toBe("X0 Bot needs your OK before it sends any");
    expect(gate.isAiConsentError({ status: 403, message: "X0 Bot needs your OK before it sends anything to AI services. Open X0 Bot and tap Agree, or turn it on in You › Privacy." })).toBe(true);
  });
});

describe("the route", () => {
  it("says, agrees and withdraws; the gate sees each at once", async () => {
    consent.installAiConsent();
    const a = app();
    expect((await a.inject({ method: "GET", url: consent.AI_CONSENT_PATH })).statusCode).toBe(401);
    const first = (await a.inject({ method: "GET", url: consent.AI_CONSENT_PATH, headers: as("rohan") })).json();
    expect(first).toMatchObject({ agreed: false, at: null, version: consent.AI_CONSENT_VERSION });
    expect(first.services.join(" ")).toContain("OpenAI");
    expect((await a.inject({ method: "PUT", url: consent.AI_CONSENT_PATH, headers: as("rohan"), payload: { agree: "yes" } })).statusCode).toBe(400);
    expect(await gate.aiAllowedFor(PEOPLE.rohan)).toBe(false);
    const yes = (await a.inject({ method: "PUT", url: consent.AI_CONSENT_PATH, headers: as("rohan"), payload: { agree: true } })).json();
    expect(yes.agreed).toBe(true);
    expect(await gate.aiAllowedFor(PEOPLE.rohan)).toBe(true);
    await a.inject({ method: "PUT", url: consent.AI_CONSENT_PATH, headers: as("rohan"), payload: { agree: false } });
    expect(await gate.aiAllowedFor(PEOPLE.rohan)).toBe(false);
    expect((await a.inject({ method: "GET", url: consent.AI_CONSENT_PATH, headers: as("rohan") })).json().agreed).toBe(false);
  });

  it("keeps Not now as their answer and grants nothing; a yes, and a yes taken back, are answers too; a new wording asks again", async () => {
    consent.installAiConsent();
    const a = app();
    const get = async (who: string) => (await a.inject({ method: "GET", url: consent.AI_CONSENT_PATH, headers: as(who) })).json();
    const put = (who: string, agree: boolean, later?: true) => a.inject({ method: "PUT", url: consent.AI_CONSENT_PATH, headers: as(who), payload: { agree, later } });
    const V = consent.AI_CONSENT_VERSION;
    // Never answered: asked.
    expect(await get("neel")).toMatchObject({ agreed: false, asked: false });
    // Not now: answered for this wording; nothing granted, and nothing withdrawn (there was no yes to take back).
    expect((await put("neel", false, true)).json()).toEqual({ agreed: false, at: null });
    expect(await get("neel")).toMatchObject({ agreed: false, asked: true });
    expect(await gate.aiAllowedFor(PEOPLE.neel)).toBe(false);
    const p = await getPersonality({ id: PEOPLE.neel! }) as Record<string, unknown>;
    expect(p).toMatchObject({ aiConsentAskedVersion: V });
    expect(p.aiConsentAt ?? null).toBeNull();
    expect(p.aiConsentWithdrawnAt).toBeUndefined();
    // A yes under this wording is an answer; taken back in You › Privacy it is still one (no card), and the withdrawal is kept.
    await put("isha", true);
    expect(await get("isha")).toMatchObject({ agreed: true, asked: true });
    await put("isha", false);
    expect(await get("isha")).toMatchObject({ agreed: false, asked: true });
    expect(await gate.aiAllowedFor(PEOPLE.isha)).toBe(false);
    expect((await getPersonality({ id: PEOPLE.isha! })).aiConsentWithdrawnAt).toBeTruthy();
    // A new wording (AI_CONSENT_VERSION went up since): an answer to the old one is no answer, Not now and a yes alike.
    await savePersonality({ id: PEOPLE.dev! }, { aiConsentAskedVersion: V - 1 } as never);
    expect(await get("dev")).toMatchObject({ agreed: false, asked: false });
    expect(consent.answeredIn({ aiConsentAt: "2026-01-01T00:00:00Z", aiConsentVersion: V - 1, aiConsentAskedVersion: V - 1 } as never)).toBe(false);
    // Someone who agreed before the answer was kept counts as answered; someone who tapped Not now then has no record: asked once more.
    expect(consent.answeredIn({ aiConsentAt: "2026-01-01T00:00:00Z", aiConsentVersion: V })).toBe(true);
    expect(consent.answeredIn({})).toBe(false);
    // Someone who switched it off in You › Privacy before the answer was kept (the old withdrawal kept the version it took back): answered.
    await savePersonality({ id: PEOPLE.omar! }, { aiConsentAt: null, aiConsentVersion: V, aiConsentWithdrawnAt: "2026-11-01T00:00:00Z" });
    expect(await get("omar")).toMatchObject({ agreed: false, asked: true });
    // A yes to an older wording switched off is no answer to this one.
    expect(consent.answeredIn({ aiConsentAt: null, aiConsentVersion: V - 1, aiConsentWithdrawnAt: "2026-11-01T00:00:00Z" })).toBe(false);
  });

  it("Not now never takes back a yes (a card left open on another device); only the switch's off does", async () => {
    consent.installAiConsent();
    const a = app();
    const get = async () => (await a.inject({ method: "GET", url: consent.AI_CONSENT_PATH, headers: as("tara") })).json();
    await savePersonality({ id: PEOPLE.tara! }, {});
    // Agree on the phone; then Not now on the computer's card, still showing.
    await a.inject({ method: "PUT", url: consent.AI_CONSENT_PATH, headers: as("tara"), payload: { agree: true } });
    const later = (await a.inject({ method: "PUT", url: consent.AI_CONSENT_PATH, headers: as("tara"), payload: { agree: false, later: true } })).json();
    expect(later.agreed).toBe(true);
    expect(await get()).toMatchObject({ agreed: true, asked: true });
    expect(await gate.aiAllowedFor(PEOPLE.tara)).toBe(true);
    expect((await getPersonality({ id: PEOPLE.tara! })).aiConsentWithdrawnAt).toBeNull();
    // The switch in You › Privacy takes it back.
    await a.inject({ method: "PUT", url: consent.AI_CONSENT_PATH, headers: as("tara"), payload: { agree: false } });
    expect(await get()).toMatchObject({ agreed: false, asked: true });
    expect(await gate.aiAllowedFor(PEOPLE.tara)).toBe(false);
    // "later" with a yes is not Not now: it agrees.
    expect((await a.inject({ method: "PUT", url: consent.AI_CONSENT_PATH, headers: as("tara"), payload: { agree: true, later: true } })).json().agreed).toBe(true);
  });

  it.skipIf(!registerPersonalityRoutes)("cannot be set through the general personality write", async () => {
    const a = Fastify();
    registerPersonalityRoutes!(a as never, { rateLimit: RL, personalityProblem: () => null, tooLong: () => null } as never);
    await a.inject({ method: "PUT", url: "/v1/personality", headers: as("zoya"), payload: { aiConsentAt: "2026-01-01T00:00:00Z", aiConsentVersion: 9, aiConsentAskedVersion: 9, tone: "warm" } });
    const p = (await a.inject({ method: "GET", url: "/v1/personality", headers: as("zoya") })).json().personality;
    expect(p.tone).toBe("warm");
    expect(consent.agreedIn(p)).toBe(false);
    // Nor can a client mark the card answered.
    expect(consent.answeredIn(p)).toBe(false);
  });
});

describe("the app", () => {
  const home = async (ai: { agreed: boolean; asked?: boolean } | undefined, extra: Record<string, unknown> = {}) => {
    const api: Record<string, unknown> = { ...(ai ? { "GET /v1/you/ai-consent": ai } : {}), ...extra };
    return buildBotsScreen({ screenId: "bots.home", client: "phone", params: {}, tzOffsetMinutes: IST, user: { id: "u", name: "Aanya Sharma" }, can: new Set(["BotsKit", "BotsMotion"]), desk: { pages: false, notes: false } }, fakeDeps({ api }));
  };

  it("asks on Home first, saying what is sent, that it goes to AI companies (the policy names them), and why, with Agree and Not now", async () => {
    const r = await home({ agreed: false }, { "GET /v1/bots/first-run/arrival": { due: true } });
    expect(lintTree(r.root!)).toEqual([]);
    const s = JSON.stringify(r.root);
    expect(s).toContain("Your data, your choice");
    for (const w of ["leading AI partners", "They see only what you choose to share.", "Never sold, never used for ads", "Nothing is sent until you agree", "Turn it on or off anytime in You › Privacy", "Privacy policy", "Agree", "Not now", "/v1/you/ai-consent"]) expect(s).toContain(w);
    // One ask at a time: the arrival card waits.
    expect(s).not.toContain("uses the microphone");
  });

  it("does not ask once they agreed, or when it could not tell", async () => {
    for (const ai of [{ agreed: true }, undefined]) expect(JSON.stringify((await home(ai)).root)).not.toContain("Your data, your choice");
  });

  it("asks once: Not now closes the card and keeps the answer on the server, and the card is not back until the wording changes", async () => {
    // Not now: the card goes, and PUT { agree: false, later: true } keeps the answer (it grants nothing, and takes no yes back).
    const due = JSON.stringify((await home({ agreed: false, asked: false })).root);
    expect(due).toContain('"path":"/v1/you/ai-consent","body":{"agree":false,"later":true}');
    // Answered this wording (Not now, or switched off in You › Privacy): no card.
    expect(JSON.stringify((await home({ agreed: false, asked: true })).root)).not.toContain("Your data, your choice");
    // End to end, with the route's own answers: due, Not now, not due; then a new wording, due again.
    consent.installAiConsent();
    const a = app();
    const read = async () => (await a.inject({ method: "GET", url: consent.AI_CONSENT_PATH, headers: as("aanya") })).json();
    const card = async () => JSON.stringify((await home(await read())).root).includes("Your data, your choice");
    await savePersonality({ id: PEOPLE.aanya! }, {});
    expect(await card()).toBe(true);
    await a.inject({ method: "PUT", url: consent.AI_CONSENT_PATH, headers: as("aanya"), payload: { agree: false, later: true } });
    expect(await card()).toBe(false);
    expect(await gate.aiAllowedFor(PEOPLE.aanya)).toBe(false);
    await savePersonality({ id: PEOPLE.aanya! }, { aiConsentAskedVersion: consent.AI_CONSENT_VERSION - 1 } as never);
    expect(await card()).toBe(true);
    await a.inject({ method: "PUT", url: consent.AI_CONSENT_PATH, headers: as("aanya"), payload: { agree: true } });
    expect(await card()).toBe(false);
  });

  it("You › Privacy has the switch to take it back, and one for usage statistics, off by default", async () => {
    const { YOU_API } = await import("../scripts/bots-render/samples/you.js");
    const r = await buildBotsScreen({ screenId: "bots.privacy", client: "phone", params: {}, tzOffsetMinutes: IST, user: { id: "u" }, can: new Set(["BotsKit"]), desk: { pages: false, notes: false } }, fakeDeps({ api: { ...YOU_API, "GET /v1/you/ai-consent": { agreed: true } } }));
    // The page's state travels beside its tree.
    const s = JSON.stringify(r);
    expect(s).toContain("Send to AI services");
    expect(s).toContain('"aiOn":true');
    expect(s).toContain("Share usage statistics");
    expect(s).toContain('"statsOn":false');
    // On, its switch takes it back.
    expect(s).toContain('"path":"/v1/you/ai-consent","body":{"agree":false}');
  });
});

describe("the terms and privacy card, for a build that draws a box that scrolls", () => {
  it("one line, then Privacy, Terms and Support as tabs over the box that scrolls the one picked; Agree accepts them", async () => {
    const r = await buildBotsScreen({ screenId: "bots.home", client: "phone", params: {}, tzOffsetMinutes: IST, user: { id: "u", name: "Aanya Sharma" }, can: new Set(["BotsKit", "BotsMotion", "Scroll"]), desk: { pages: false, notes: false } }, fakeDeps({ api: { "GET /v1/you/ai-consent": { agreed: false } } }));
    expect(lintTree(r.root!)).toEqual([]);
    const s = JSON.stringify(r.root);
    for (const w of ["Terms and privacy", '"Tap Agree to let X0 Bot work at its full potential. Turn AI on or off anytime in You\u00a0›\u00a0Privacy."', '"type":"Scroll"', '"Privacy"', '"Terms"', '"Support"',
      "Terms of Service", "1. Eligibility", "Privacy Policy", "AI services, and your permission", "support@x0bot.com", "Agree", "Not now"]) expect(s).toContain(w);
    // One box a page, each shown by its tab; Privacy first (also when the card's state was not started).
    expect(s.match(/"type":"Scroll"/g)?.length).toBe(3);
    for (const p of ["terms", "support", "privacy"]) expect(s).toContain(`"kind":"setState","path":"aiPage","value":"${p}"`);
    expect(JSON.stringify(r.state)).toContain('"aiPage":"privacy"');
    // No links out under the box any more (Providers, and the pages themselves, are in the tabs' text).
    expect(s).not.toContain('"url":"https://x0bot.com/privacy/providers"');
    // The policy's own words, not a summary of them.
    expect(s).toContain("we ask your permission before anything is sent");
    // No separate part above the scroll: the summary line and its three ticks are the short card's only.
    for (const w of ["leading AI partners", "Never sold, never used for ads", "Nothing is sent until you agree"]) expect(s).not.toContain(w);
  });
});
