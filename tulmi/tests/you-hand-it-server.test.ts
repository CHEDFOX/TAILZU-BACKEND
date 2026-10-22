import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// The You tab through the real route: with connected apps on, the server reads
// the apps and the tasks for it (like the assistant screens), and a failed read
// never fails the tab.
const view = vi.hoisted(() => ({
  calls: [] as Array<{ screen?: string; want: Record<string, unknown> }>,
  mode: "ok" as "ok" | "fail",
}));
vi.mock("../src/connectors/list.js", async (orig) => {
  const m = await orig<typeof import("../src/connectors/list.js")>();
  return {
    ...m,
    assistantView: async (c: never, userId: string, want: Record<string, unknown>, email?: string) => {
      view.calls.push({ want });
      if (view.mode === "fail") throw new Error("the apps are down");
      return {
        apps: want.apps ? [{ id: "notion", name: "Notion", category: "Docs", oneLine: "", auth: "oauth", connected: true, level: "look", auto: [] }] : undefined,
        tasks: want.tasks ? [{
          id: "t1", state: "waiting", title: "Add the gym page", steps: [], createdAt: 1, updatedAt: 1,
          approval: { id: "ap1", connector: "notion", tool: "create_page", risk: "write", preview: "Add the page Gym" },
        }] : undefined,
        names: { notion: "Notion" },
      };
    },
  };
});

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

describe("the You tab's Hand it to me card, through the server", () => {
  let server: FastifyInstance;
  beforeAll(async () => { server = await buildApp(); await server.ready(); });
  afterAll(async () => { await server.close(); });
  const auth = { authorization: "Bearer test-static-token-0123456789" };
  const screen = (screenId: string, formFactor: "phone" | "desktop" = "phone") =>
    server.inject({
      method: "POST", url: "/v1/app/screen", headers: auth,
      payload: {
        screenId, tzOffsetMinutes: 330,
        capabilities: { platform: "ios", appVersion: "1.0.0", components: [], device: { formFactor, os: "ios", width: 390, height: 844 } },
      },
    });

  it("reads the apps and the tasks for it, and draws them", async () => {
    view.calls.length = 0; view.mode = "ok";
    const r = await screen("personality");
    expect(r.statusCode).toBe(200);
    expect(view.calls.map((c) => c.want)).toEqual([{ apps: true, tasks: true }]);
    for (const w of ["Hand it to me", "Needs your OK", "Add more apps", "See all", "Add the gym page"]) expect(r.body, w).toContain(w);
    expect(r.body).toContain('"path":"/v1/assistant/ask"');
    expect(r.body).toContain('"platform":"ios"');
    expect(r.body).toContain('"tzOffsetMinutes":330');
    expect(r.body).toContain('"taskId":"t1"');
    // The task's own words are in state, never in a node.
    expect(JSON.parse(r.body).state.up).toEqual([{ title: "Add the gym page", sub: "Notion" }]);
  });

  it("a read that fails never fails the tab: the card comes without Coming up", async () => {
    view.calls.length = 0; view.mode = "fail";
    const r = await screen("personality");
    expect(r.statusCode).toBe(200);
    expect(view.calls.length).toBe(1);
    expect(r.body).toContain("Hand it to me");
    expect(r.body).toContain('"path":"/v1/assistant/ask"');
    expect(r.body).not.toContain("Nothing on my list yet.");
    expect(r.body).not.toContain("Coming up");
    expect(r.body).toContain("Add more apps");
    view.mode = "ok";
  });

  it("only the You tab reads them for it: Stats and Ask still read nothing", async () => {
    view.calls.length = 0; view.mode = "ok";
    await screen("stats");
    await screen("assistant_ask");
    expect(view.calls).toEqual([]);
  });
});
