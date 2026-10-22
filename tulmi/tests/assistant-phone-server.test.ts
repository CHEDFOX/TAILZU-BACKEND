import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

// The phone's assistant screens through the real route: the server reads the
// apps and tasks for them, and only for them.
process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.STT_PROVIDER = "groq";
process.env.NODE_ENV = "test";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.DEV_SKIP_AUTH = "false";
process.env.SUPABASE_URL = "http://127.0.0.1:1";
process.env.SUPABASE_ANON_KEY = "anon";
process.env.STATIC_BEARER_TOKENS = "test-static-token-0123456789";
process.env.CONNECTORS = "true";
process.env.CONNECTORS_ENABLED_IDS = "notion, zapier";
process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");

const { buildApp } = await import("../src/server.js");

describe("the phone's assistant screens, through the server", () => {
  let server: FastifyInstance;
  beforeAll(async () => { server = await buildApp(); await server.ready(); });
  afterAll(async () => { await server.close(); });
  const auth = { authorization: "Bearer test-static-token-0123456789" };
  const caps = (components: string[]) => ({
    platform: "ios", appVersion: "1.0.0", components, device: { formFactor: "phone", os: "ios", width: 390, height: 844 },
  });
  const screen = (screenId: string, components: string[] = ["ActionUrl"], params?: Record<string, string>) =>
    server.inject({ method: "POST", url: "/v1/app/screen", headers: auth, payload: { screenId, params, capabilities: caps(components) } });

  it("Connected apps: the tiles, from the apps that are switched on", async () => {
    const r = await screen("assistant_apps");
    expect(r.statusCode).toBe(200);
    const body = r.body;
    for (const w of ["Suggested for you", "Notion", "Zapier", "Connect"]) expect(body, w).toContain(w);
    expect(body).toContain('"path":"/v1/connectors/notion/connect"');
    expect(body).toContain('"url":"$state.link.authorizeUrl"');
    expect(body).not.toContain("I can’t reach your apps just yet.");
  });

  it("Tasks and the confirm sheet answer, with nothing waiting yet", async () => {
    expect((await screen("assistant_tasks")).body).toContain("Nothing yet.");
    const sheet = await screen("assistant_approve", ["ActionUrl"], { pushId: "p1", taskId: "nope" });
    expect(sheet.statusCode).toBe(200);
    expect(sheet.body).toContain("Nothing is waiting for you right now.");
  });

  it("Settings offers them while connected apps are on", async () => {
    const r = await screen("settings");
    expect(r.body).toContain('"screenId":"assistant_apps"');
    expect(r.body).toContain('"screenId":"assistant_tasks"');
  });
});
