/**
 * Connected apps through the real server with CONNECTORS on and sign-in
 * required: every connector and task route wants a session, only the apps
 * named in CONNECTORS_ENABLED_IDS are offered, and Ask's planner is still sent
 * the same bytes for a person who has connected nothing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.STT_PROVIDER = "groq";
process.env.NODE_ENV = "test";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.AGENT_RATE_LIMIT_MAX = "1000";
process.env.DEV_SKIP_AUTH = "false";
process.env.SUPABASE_URL = "http://127.0.0.1:1";
process.env.SUPABASE_ANON_KEY = "anon";
process.env.STATIC_BEARER_TOKENS = "test-static-token-0123456789";
process.env.CONNECTORS = "true";
process.env.CONNECTORS_ENABLED_IDS = "notion, linear";
process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");

const llm = vi.hoisted(() => ({ calls: [] as Array<{ body: Record<string, any> }> }));
vi.mock("openai", () => ({
  default: class {
    audio = { transcriptions: { create: async () => ({ text: "" }) } };
    chat = {
      completions: {
        create: async (body: Record<string, any>) => {
          llm.calls.push({ body });
          return (async function* () {
            yield { choices: [{ delta: { content: "DONE\n" } }] };
            yield { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } };
          })();
        },
      },
    };
  },
  toFile: async (b: Buffer, name: string) => ({ b, name }),
}));

const { buildApp } = await import("../src/server.js");
const { agentUserMessage } = await import("../src/agent/prompt.js");
const { stableBlock } = await import("../src/principles/roles.js");

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });

const auth = { authorization: "Bearer test-static-token-0123456789" };

describe("connected apps, switched on", () => {
  it("wants a session on every route but the vendor's callback", async () => {
    for (const [method, url] of [
      ["GET", "/v1/connectors"], ["POST", "/v1/connectors/notion/connect"], ["POST", "/v1/connectors/notion/level"],
      ["POST", "/v1/connectors/notion/auto"], ["DELETE", "/v1/connectors/notion"], ["GET", "/v1/tasks"],
      ["POST", "/v1/tasks/x/approve"], ["POST", "/v1/tasks/x/deny"],
    ] as const) {
      const res = await app.inject({ method, url, ...(method === "POST" ? { payload: {} } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("offers only the apps that were switched on, none connected yet", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/connectors", headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(true);
    expect(body.connectors.map((c: { id: string }) => c.id)).toEqual(["notion", "linear"]);
    expect(body.connectors.every((c: { connected: boolean; level: string }) => !c.connected && c.level === "look")).toBe(true);
    expect((await app.inject({ method: "GET", url: "/v1/tasks", headers: auth })).json()).toEqual({ tasks: [] });
    expect((await app.inject({ method: "POST", url: "/v1/connectors/github/connect", headers: auth, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/v1/connectors/notion/level", headers: auth, payload: { level: "send" } })).statusCode).toBe(404);
  });

  it("publishes Tailzu's OAuth client document, with no session, built from the config", async () => {
    const res = await app.inject({ method: "GET", url: "/oauth/client-metadata.json" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["cache-control"]).toBe("public, max-age=86400");
    expect(res.json()).toMatchObject({
      client_id: "https://api.x0bot.com/oauth/client-metadata.json",
      redirect_uris: ["https://api.x0bot.com/v1/connectors/callback"],
      token_endpoint_auth_method: "none",
    });
  });

  it("sends Ask's planner exactly the prompt it always did when nothing is connected", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/agent", headers: auth,
      payload: {
        runId: "run_srv123", step: 0, platform: "mac", app: "Notion", utterance: "find my launch notes in notion",
        screen: { elements: [{ id: "e1", role: "button", label: "Search" }] },
      },
    });
    expect(res.statusCode).toBe(200);
    const streamed = llm.calls.filter((c) => c.body.stream);
    expect(streamed).toHaveLength(1);
    expect(streamed[0]!.body.messages[0].content).toBe(stableBlock("ask_planner"));
    const sent = String(streamed[0]!.body.messages[1].content);
    expect(sent).toBe(agentUserMessage({
      runId: "run_srv123", step: 0, platform: "mac", app: "Notion", utterance: "find my launch notes in notion",
      screen: { elements: [{ id: "e1", role: "button", label: "Search" }] },
    }, "find my launch notes in notion", "show", Number(process.env.AGENT_MAX_STEPS ?? 8)));
    expect(sent).not.toContain("<tools>");
  });
});
