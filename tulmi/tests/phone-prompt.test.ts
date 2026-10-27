/**
 * The phone's Ask is told it is on a phone (agent/prompt.ts PHONE_NOTE; connectors/index.ts CONNECTOR_ADDENDUM).
 *
 * What must hold: the planner's system prompt is one stable block, the ask_planner role (principles/roles.ts), for
 * the phone and for a computer, with apps and without, so every ask sends the same bytes and the provider's cache
 * holds across all of them; what is different about the phone is a line at the head of the step's message, which
 * says nothing of a computer screen; and what teaches USE is at the head of the message too, the same bytes each time.
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

vi.mock("../src/auth/supabase.js", async (orig) => ({
  ...(await orig<typeof import("../src/auth/supabase.js")>()),
  resolveUser: async (h: string | undefined) => {
    const id = h?.replace(/^Bearer\s+/i, "").trim();
    return id ? { id } : null;
  },
}));

const { PHONE_NOTE, onAPhone } = await import("../src/agent/prompt.js");
const { CONNECTOR_ADDENDUM, createConnectors } = await import("../src/connectors/index.js");
const { ROLES, stableBlock } = await import("../src/principles/roles.js");
const { plannerRequest } = await import("../src/agent/llm.js");
const { runStep } = await import("../src/agent/run.js");
const { EventSink } = await import("../src/agent/protocol.js");
const { registerAssistantRoutes } = await import("../src/routes/assistant.js");
const { ALWAYS_ON } = await import("../src/connectors/catalog.js");
const { MemoryConnectorStore } = await import("../src/connectors/store.js");

const PLANNER = stableBlock("ask_planner");

describe("the planner's block and the phone's note", () => {
  it("the block is one role's, and says nothing of a phone or of a computer's screen it is not on", () => {
    expect(PLANNER).toContain(ROLES.ask_planner.identity);
    expect(PLANNER).toContain("on a computer the controls visible in the app in front of them");
    expect(PLANNER).not.toMatch(/\{\{|\$\{|undefined/);
    expect(PLANNER.toLowerCase()).not.toContain("on someone's phone");
  });

  it("the phone's note says it is on a phone, that there is no screen to point at or press, and what it can do, and nothing of a computer screen", () => {
    expect(PHONE_NOTE).toBe("On a phone: there is no screen here to point at or press. Answer, ask, or use their connected apps.");
    expect(PHONE_NOTE).not.toContain("computer screen");
    expect(PHONE_NOTE).not.toMatch(/\{\{|\$\{|undefined/);
  });

  it("chosen by the platform: the phone's note on a phone, none anywhere else", () => {
    expect(onAPhone("ios")).toBe(true);
    expect(onAPhone("android")).toBe(true);
    for (const p of ["mac", "win", "", "iOS", "linux"]) expect(onAPhone(p), p).toBe(false);
  });

  it("with apps: one addendum, the same bytes each time, that teaches USE and bounds what apps may say", () => {
    expect(CONNECTOR_ADDENDUM.startsWith("Connected apps. ")).toBe(true);
    expect(CONNECTOR_ADDENDUM).toContain("\"fix: connector.tool — …\": your last USE of that tool was not run because its arguments did not fit; USE it again with them right, or ASK for a value they did not give. Never make one up.");
    expect(CONNECTOR_ADDENDUM).toContain("apart from Tailzu's own pick:, not connected:, not in Tailzu: and fix: lines at the top of <tools>.");
    // The worked examples it used to carry are fixtures now (evals/ask_planner.jsonl).
    expect(CONNECTOR_ADDENDUM).not.toMatch(/^Example\./m);
  });

  it("is marked for the provider's cache as it is", () => {
    const a = plannerRequest("anthropic/claude-haiku-5.5", PLANNER, "u") as { messages: Array<{ content: unknown }> };
    expect(a.messages[0]!.content).toEqual([{ type: "text", text: PLANNER, cache_control: { type: "ephemeral" } }]);
    expect((plannerRequest("openai/gpt-6-luna", PLANNER, "u") as { messages: Array<{ content: unknown }> }).messages[0]!.content).toBe(PLANNER);
  });
});

// ---- what each surface sends ------------------------------------------------------------

/** The phone's Ask over its route, with the planner scripted and what it was sent kept. */
async function phone(answers: string[], now?: () => number) {
  const sent: Array<{ system: string; user: string }> = [];
  const server = Fastify();
  registerAssistantRoutes(server, {
    rateLimit: { rateLimit: { max: 100, timeWindow: 60_000 } },
    connectors: createConnectors({ store: new MemoryConnectorStore(), redirectUrl: "https://api.example.com/cb", catalog: [...ALWAYS_ON] }),
    plan: ((system: unknown, user: unknown) => {
      sent.push({ system: String(system), user: String(user) });
      const a = answers.shift() ?? "DONE";
      return (async function* () { yield { model: "m", delta: `${a}\n` }; })();
    }) as never,
    profileLanguage: async () => undefined,
    quota: async () => null,
    record: async () => {},
    ...(now ? { now } : {}),
  });
  await server.ready();
  const ask = (text: string, headers: Record<string, string> = {}) =>
    server.inject({ method: "POST", url: "/v1/assistant/ask", headers: { authorization: "Bearer u1", ...headers }, payload: { text } });
  return { sent, ask, server };
}

describe("what each surface sends", () => {
  it("two phone asks send the same system bytes, whatever they said and whenever, and the phone's note in the message", async () => {
    let t = Date.parse("2026-10-26T05:00:00Z");
    const p = await phone(["SAY It's 4pm in London.\nDONE", "SAY 42.\nDONE"], () => t);
    await p.ask("what time is it in london");
    t += 3 * 60 * 60_000;
    await p.ask("what is six times seven", { "user-agent": "okhttp/4.12.0" });
    expect(p.sent.map((c) => c.system)).toEqual([PLANNER, PLANNER]);
    for (const c of p.sent) {
      expect(c.user.split("\n")[1]).toBe(PHONE_NOTE);
      expect(c.user).not.toContain(CONNECTOR_ADDENDUM);
    }
    await p.server.close();

    // With an app to use: the same block, and what teaches USE at the head of the message, the same bytes each time.
    const apps = await phone(['USE whatsapp.send_message {"text":"On my way","name":"Mom"}', 'USE maps.directions {"destination":"the airport"}']);
    expect((await apps.ask("tell mom I'm on my way on whatsapp")).statusCode).toBe(200);
    expect((await apps.ask("directions to the airport", { "user-agent": "okhttp/4.12.0" })).statusCode).toBe(200);
    expect(apps.sent.map((c) => c.system)).toEqual([PLANNER, PLANNER]);
    for (const c of apps.sent) {
      expect(c.user.startsWith(`${CONNECTOR_ADDENDUM}\n`)).toBe(true);
      expect(c.user).toContain(PHONE_NOTE);
      expect(c.user).not.toContain("computer screen");
    }
    await apps.server.close();
  });

  it("a desktop step sends the same block, no phone note, and the addendum only with its apps", async () => {
    const step = async (said: string, answer: string) => {
      const sent: Array<{ system: string; user: string }> = [];
      const sink = new EventSink(() => {});
      const connectors = createConnectors({ store: new MemoryConnectorStore(), redirectUrl: "https://api.example.com/cb", catalog: [...ALWAYS_ON] });
      const deps = {
        write: async () => "", rewrite: async () => "", connectors: connectors.runtimeFor("u1"),
        plan: (system: unknown, user: unknown) => { sent.push({ system: String(system), user: String(user) }); return (async function* () { yield { model: "m", delta: `${answer}\n` }; })(); },
      };
      await runStep({ req: { runId: "run_desk1", step: 0, platform: "mac", app: "Notes", screen: { elements: [] }, utterance: said }, maxSteps: 8 }, deps as never, sink);
      return sent;
    };
    const plain = await step("what does this error mean", "SAY Your disk is full.\nDONE");
    expect(plain.map((c) => c.system)).toEqual([PLANNER]);
    expect(plain[0]!.user).not.toContain(CONNECTOR_ADDENDUM);
    expect(plain[0]!.user).not.toContain(PHONE_NOTE);
    const withApps = await step("tell mom I'm on my way on whatsapp", 'USE whatsapp.send_message {"text":"On my way"}');
    expect(withApps.map((c) => c.system)).toEqual([PLANNER]);
    expect(withApps[0]!.user.startsWith(`${CONNECTOR_ADDENDUM}\n`)).toBe(true);
    expect(withApps[0]!.user).not.toContain(PHONE_NOTE);
  });
});
