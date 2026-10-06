import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

// eslint-disable-next-line import/first
import { registerDemoRoutes } from "../src/routes/demo.js";
// eslint-disable-next-line import/first
import { resetConfigForTests } from "../src/config.js";

// The callback page refuses a return without a state by default. The switch
// exists only to ship the server before the app update that sends one.

async function server(requireState?: string) {
  if (requireState === undefined) delete process.env.AUTH_CALLBACK_REQUIRE_STATE;
  else process.env.AUTH_CALLBACK_REQUIRE_STATE = requireState;
  resetConfigForTests?.();
  const app = Fastify();
  registerDemoRoutes(app, { downloadsDir: "/tmp/tailzu-none", siteDir: "/tmp/tailzu-none" });
  await app.ready();
  return app;
}

afterEach(() => { delete process.env.AUTH_CALLBACK_REQUIRE_STATE; resetConfigForTests?.(); });

describe("the callback's state check", () => {
  it("is on unless switched off", async () => {
    const app = await server();
    expect((await app.inject({ method: "GET", url: "/auth/callback" })).statusCode).toBe(400);
    await app.close();
  });

  it("can be switched off for the rollout, and then bounces as before", async () => {
    const app = await server("false");
    const res = await app.inject({ method: "GET", url: "/auth/callback" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("tulmi://auth/callback");
    await app.close();
  });
});
