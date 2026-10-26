/**
 * The phone's own prompt (agent/prompt.ts AGENT_SYSTEM_PHONE, agentSystemFor;
 * connectors/index.ts AGENT_SYSTEM_PHONE_CONNECTORS).
 *
 * What must hold: the desktop's AGENT_SYSTEM is the same bytes it always was
 * (the desktops in people's hands are sent exactly that); the phone's differs
 * from it in its first line only, says nothing of a computer screen, and is
 * one constant whose bytes are pinned here, so every phone ask sends the same
 * system prompt and the provider's cache holds; and a desktop step still
 * sends AGENT_SYSTEM, or AGENT_SYSTEM_CONNECTORS with its apps.
 */
import { createHash } from "node:crypto";
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

const { AGENT_SYSTEM, AGENT_SYSTEM_PHONE, agentSystemFor } = await import("../src/agent/prompt.js");
const { AGENT_SYSTEM_CONNECTORS, AGENT_SYSTEM_PHONE_CONNECTORS, CONNECTOR_ADDENDUM, createConnectors } = await import("../src/connectors/index.js");
const { plannerRequest } = await import("../src/agent/llm.js");
const { runStep } = await import("../src/agent/run.js");
const { EventSink } = await import("../src/agent/protocol.js");
const { registerAssistantRoutes } = await import("../src/routes/assistant.js");
const { ALWAYS_ON } = await import("../src/connectors/catalog.js");
const { MemoryConnectorStore } = await import("../src/connectors/store.js");

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const PHONE_FIRST = "You are Blip, a small helper in the Tailzu app on someone's phone. There is no screen here to point at or press: each turn you are shown what they said and what has happened so far in this run, and you answer, ask, or use their connected apps.";

describe("the two prompts", () => {
  it("AGENT_SYSTEM is the bytes it always was", () => {
    expect(sha(AGENT_SYSTEM)).toBe("e0f10e6a7f626a7471e4e539de5e7c18e3a5f266e727234acb3ffc70249af7b8");
    expect(AGENT_SYSTEM.split("\n")[0]).toMatch(/^You are Blip, a small guide on someone's computer screen\./);
  });

  it("the phone's differs from it in its first line only, says nothing of a computer screen, and its bytes are pinned", () => {
    const desk = AGENT_SYSTEM.split("\n");
    const phone = AGENT_SYSTEM_PHONE.split("\n");
    expect(phone.length).toBe(desk.length);
    expect(phone[0]).toBe(PHONE_FIRST);
    expect(phone.slice(1)).toEqual(desk.slice(1));
    expect(AGENT_SYSTEM_PHONE).not.toContain("computer screen");
    expect(AGENT_SYSTEM_PHONE).not.toMatch(/\{\{|\$\{|undefined/);
    expect(sha(AGENT_SYSTEM_PHONE)).toBe("2bf4fc26efee035f7f06af03d056bc7246b4f28fdbb60876b7e86df786fb2b21");
  });

  it("chosen by the platform: the phone's on a phone, AGENT_SYSTEM everywhere else", () => {
    expect(agentSystemFor("ios")).toBe(AGENT_SYSTEM_PHONE);
    expect(agentSystemFor("android")).toBe(AGENT_SYSTEM_PHONE);
    for (const p of ["mac", "win", "", "iOS", "linux"]) expect(agentSystemFor(p), p).toBe(AGENT_SYSTEM);
  });

  it("with apps: the same addendum after each, and each one constant", () => {
    expect(AGENT_SYSTEM_CONNECTORS).toBe(AGENT_SYSTEM + CONNECTOR_ADDENDUM);
    expect(AGENT_SYSTEM_PHONE_CONNECTORS).toBe(AGENT_SYSTEM_PHONE + CONNECTOR_ADDENDUM);
    expect(CONNECTOR_ADDENDUM).toContain("\"fix: connector.tool — …\": your last USE of that tool was not run because its arguments did not fit; USE it again with them right, or ASK for a value they did not give. Never make one up.");
    expect(CONNECTOR_ADDENDUM).toContain("apart from Tailzu's own pick:, not connected:, not in Tailzu: and fix: lines at the top of <tools>.");
  });

  it("each is marked for the provider's cache as it is", () => {
    for (const system of [AGENT_SYSTEM_PHONE, AGENT_SYSTEM_PHONE_CONNECTORS]) {
      const a = plannerRequest("anthropic/claude-haiku-5.5", system, "u") as { messages: Array<{ content: unknown }> };
      expect(a.messages[0]!.content).toEqual([{ type: "text", text: system, cache_control: { type: "ephemeral" } }]);
      expect((plannerRequest("openai/gpt-6-luna", system, "u") as { messages: Array<{ content: unknown }> }).messages[0]!.content).toBe(system);
    }
  });
});

// ---- what each surface sends ------------------------------------------------------------

/** The phone's Ask over its route, with the planner scripted and what it was sent kept. */
async function phone(answers: string[], now?: () => number) {
  const sent: string[] = [];
  const server = Fastify();
  registerAssistantRoutes(server, {
    rateLimit: { rateLimit: { max: 100, timeWindow: 60_000 } },
    connectors: createConnectors({ store: new MemoryConnectorStore(), redirectUrl: "https://api.example.com/cb", catalog: [...ALWAYS_ON] }),
    plan: ((system: unknown) => {
      sent.push(String(system));
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
  it("two phone asks send the same system bytes, whatever they said and whenever", async () => {
    let t = Date.parse("2026-10-26T05:00:00Z");
    const p = await phone(["SAY It's 4pm in London.\nDONE", "SAY 42.\nDONE"], () => t);
    await p.ask("what time is it in london");
    t += 3 * 60 * 60_000;
    await p.ask("what is six times seven", { "user-agent": "okhttp/4.12.0" });
    expect(p.sent).toEqual([AGENT_SYSTEM_PHONE, AGENT_SYSTEM_PHONE]);
    await p.server.close();

    // With an app to use: the phone's prompt with the addendum, the same bytes each time.
    const apps = await phone(['USE whatsapp.send_message {"text":"On my way","name":"Mom"}', 'USE maps.directions {"destination":"the airport"}']);
    expect((await apps.ask("tell mom I'm on my way on whatsapp")).statusCode).toBe(200);
    expect((await apps.ask("directions to the airport", { "user-agent": "okhttp/4.12.0" })).statusCode).toBe(200);
    expect(apps.sent).toEqual([AGENT_SYSTEM_PHONE_CONNECTORS, AGENT_SYSTEM_PHONE_CONNECTORS]);
    expect(apps.sent.every((s) => !s.includes("computer screen"))).toBe(true);
    await apps.server.close();
  });

  it("a desktop step still sends AGENT_SYSTEM, and AGENT_SYSTEM_CONNECTORS with its apps", async () => {
    const step = async (said: string, answer: string) => {
      const sent: string[] = [];
      const sink = new EventSink(() => {});
      const connectors = createConnectors({ store: new MemoryConnectorStore(), redirectUrl: "https://api.example.com/cb", catalog: [...ALWAYS_ON] });
      const deps = {
        write: async () => "", rewrite: async () => "", connectors: connectors.runtimeFor("u1"),
        plan: (system: unknown) => { sent.push(String(system)); return (async function* () { yield { model: "m", delta: `${answer}\n` }; })(); },
      };
      await runStep({ req: { runId: "run_desk1", step: 0, platform: "mac", app: "Notes", screen: { elements: [] }, utterance: said }, maxSteps: 8 }, deps as never, sink);
      return sent;
    };
    expect(await step("what does this error mean", "SAY Your disk is full.\nDONE")).toEqual([AGENT_SYSTEM]);
    expect(await step("tell mom I'm on my way on whatsapp", 'USE whatsapp.send_message {"text":"On my way"}')).toEqual([AGENT_SYSTEM_CONNECTORS]);
    // And Windows the same.
    expect(agentSystemFor("win")).toBe(AGENT_SYSTEM);
  });
});
