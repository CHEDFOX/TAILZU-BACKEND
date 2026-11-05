/**
 * THE AI PERMISSION (src/privacy/aiGate.ts, aiConsent.ts; App Review 5.1.1(i), 5.1.2(i)): nothing of a person's is sent to an AI service
 * until they tap Agree, and they can take it back.
 *
 *   - the gate: no check installed, or no person, lets everything through; a person who has not agreed gets a 403 the SDK does not
 *     retry, from a guarded client and from the guarded fetch alike, and only for the AI services' hosts; work as a person
 *     (asPerson) is theirs; the error handler answers it 403 ai_consent_needed with words a person can act on
 *   - the route: GET says whether they agreed; PUT agrees and withdraws, and the gate sees it at once; a general personality write
 *     cannot set it
 *   - Home asks first (before the arrival and About cards), with what is sent, to whom, Agree and Not now; You › Privacy has the switch
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

  it.skipIf(!registerPersonalityRoutes)("cannot be set through the general personality write", async () => {
    const a = Fastify();
    registerPersonalityRoutes!(a as never, { rateLimit: RL, personalityProblem: () => null, tooLong: () => null } as never);
    await a.inject({ method: "PUT", url: "/v1/personality", headers: as("zoya"), payload: { aiConsentAt: "2026-01-01T00:00:00Z", aiConsentVersion: 9, tone: "warm" } });
    const p = (await a.inject({ method: "GET", url: "/v1/personality", headers: as("zoya") })).json().personality;
    expect(p.tone).toBe("warm");
    expect(consent.agreedIn(p)).toBe(false);
  });
});

describe("the app", () => {
  const home = async (ai: { agreed: boolean } | undefined, extra: Record<string, unknown> = {}) => {
    const api: Record<string, unknown> = { ...(ai ? { "GET /v1/you/ai-consent": ai } : {}), ...extra };
    return buildBotsScreen({ screenId: "bots.home", client: "phone", params: {}, tzOffsetMinutes: IST, user: { id: "u", name: "Aanya Sharma" }, can: new Set(["BotsKit", "BotsMotion"]), desk: { pages: false, notes: false } }, fakeDeps({ api }));
  };

  it("asks on Home first, saying what is sent, that it goes to AI companies (the policy names them), and why, with Agree and Not now", async () => {
    const r = await home({ agreed: false }, { "GET /v1/bots/first-run/arrival": { due: true } });
    expect(lintTree(r.root!)).toEqual([]);
    const s = JSON.stringify(r.root);
    expect(s).toContain("Your data, your choice");
    for (const w of ["trusted AI companies", "Only what you say, type or share", "Never sold, never used for ads", "Nothing is sent until you agree", "Turn it off anytime", "Privacy policy", "Agree", "Not now", "/v1/you/ai-consent"]) expect(s).toContain(w);
    // One ask at a time: the arrival card waits.
    expect(s).not.toContain("uses the microphone");
  });

  it("does not ask once they agreed, or when it could not tell", async () => {
    for (const ai of [{ agreed: true }, undefined]) expect(JSON.stringify((await home(ai)).root)).not.toContain("Your data, your choice");
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
  it("holds the whole of the Terms and the Privacy Policy under the AI summary, and Agree accepts them", async () => {
    const r = await buildBotsScreen({ screenId: "bots.home", client: "phone", params: {}, tzOffsetMinutes: IST, user: { id: "u", name: "Aanya Sharma" }, can: new Set(["BotsKit", "BotsMotion", "Scroll"]), desk: { pages: false, notes: false } }, fakeDeps({ api: { "GET /v1/you/ai-consent": { agreed: false } } }));
    expect(lintTree(r.root!)).toEqual([]);
    const s = JSON.stringify(r.root);
    for (const w of ["Terms and privacy", "trusted AI companies", "By tapping Agree, you accept the Terms of Service and the Privacy Policy below.", '"type":"Scroll"',
      "Terms of Service", "1. Eligibility", "Privacy Policy", "AI services, and your permission", "Agree", "Not now", "/privacy/providers"]) expect(s).toContain(w);
    // The policy's own words, not a summary of them.
    expect(s).toContain("we ask your permission before anything is sent");
  });
});
