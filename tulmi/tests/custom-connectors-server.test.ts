/**
 * Apps added by link through the real server, switched on: the routes want a
 * session, More apps answers, and the phone's and the desk's screens carry
 * the new parts. (assistant-phone-server.test.ts has them switched off.)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

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
process.env.CONNECTORS_ENABLED_IDS = "notion, linear";
process.env.CUSTOM_CONNECTORS = "true";
process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");

const { buildApp } = await import("../src/server.js");

describe("apps added by link, switched on, through the server", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });
  const auth = { authorization: "Bearer test-static-token-0123456789" };
  const screen = (screenId: string, formFactor: "phone" | "desktop", components: string[], params?: Record<string, string>) =>
    app.inject({
      method: "POST", url: "/v1/app/screen", headers: auth,
      payload: { screenId, params, capabilities: { platform: "ios", appVersion: "1.0.0", components, device: { formFactor, os: "ios", width: 390, height: 844 } } },
    });

  it("wants a session for every route of theirs", async () => {
    for (const [method, url] of [
      ["GET", "/v1/connectors/directory?q=notion"], ["POST", "/v1/connectors/custom"], ["DELETE", "/v1/connectors/custom/c_x"],
      ["GET", "/v1/connectors/c_x/tools"], ["POST", "/v1/connectors/c_x/tools/policy"], ["POST", "/v1/connectors/c_x/tools/accept"],
    ] as const) {
      expect((await app.inject({ method, url, ...(method === "POST" ? { payload: {} } : {}) })).statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("More apps answers with our own app first, before any sync has run", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/connectors/directory?q=notion", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ q: "notion", count: 1, apps: [{ id: "notion", source: "catalog", name: "Notion" }] });
  });

  it("the phone's Connected apps has Add by link and the search", async () => {
    const r = await screen("assistant_apps", "phone", ["ActionUrl"]);
    expect(r.statusCode).toBe(200);
    for (const w of ["Add by link", "Tailzu hasn’t checked this app. Only add apps you trust.", '"path":"/v1/connectors/directory?q=$state.q"']) {
      expect(r.body, w).toContain(w);
    }
    // An unknown app's page says it cannot reach it, rather than failing.
    const tools = await screen("assistant_app_tools", "phone", ["ActionUrl"], { id: "c_00000000-0000-4000-8000-000000000001" });
    expect(tools.statusCode).toBe(200);
    expect(tools.body).toContain("I can’t reach your apps just yet.");
  });

  it("the desk's Settings has Add an app by link and More apps", async () => {
    const r = await screen("desk_settings", "desktop", ["DeskShell", "DeskConnectors"]);
    expect(r.statusCode).toBe(200);
    for (const w of ["Add an app by link", "Apps from the public MCP Registry. Tailzu hasn’t checked them."]) expect(r.body, w).toContain(w);
    expect((await screen("desk_connector", "desktop", ["DeskShell", "DeskConnectors"], { id: "nope" })).statusCode).toBe(200);
  });
});
