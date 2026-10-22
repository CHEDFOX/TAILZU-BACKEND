/**
 * THE ONBOARDING SPEAKS THE LANGUAGE THE PERSON CHOSE (server.ts, /v1/app/screen).
 *
 * The profile's language stays "auto" (English) until someone changes it in
 * Settings, and the Languages step only saves personality.languages. So the
 * screen `onboard` is written in the first language of that list until the
 * profile says one, or its Hinglish never reached a new person.
 *
 * Kept apart from onboard.test.ts because it has to stand in for the
 * translator: a language the design wrote its own lines for (Hinglish) is not
 * the model's to look up, but the strings it did not write still are asked for,
 * and this file answers those with nothing (so they stay English) rather than
 * reaching for the network.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const asked = vi.hoisted(() => ({ items: [] as string[] }));
vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async (body: { messages: Array<{ content: string }> }) => {
          const input = body.messages[1]?.content ?? "";
          const at = input.indexOf("Input JSON:");
          if (at >= 0) asked.items.push(...(JSON.parse(input.slice(at + "Input JSON:".length)) as string[]));
          return { choices: [{ message: { content: JSON.stringify({ items: [] }) } }] };
        },
      },
    };
  },
}));

const T = {
  fresh: "test-onbl-fresh-0123456789012345",
  explicit: "test-onbl-explicit-01234567890123",
};
process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.STT_PROVIDER = "groq";
process.env.NODE_ENV = "test";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.DEV_SKIP_AUTH = "false";
process.env.SUPABASE_URL = "http://127.0.0.1:1";
process.env.SUPABASE_ANON_KEY = "anon";
process.env.STATIC_BEARER_TOKENS = Object.values(T).join(",");

const { resetConfigForTests } = await import("../src/config.js");
resetConfigForTests();
const { buildApp } = await import("../src/server.js");
const { OB_EN, OB_HG } = await import("../src/experience/onboard.js");

describe("the screen onboard, through the server", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const put = async (token: string, url: string, payload: unknown) =>
    expect((await app.inject({ method: "PUT", url, headers: auth(token), payload: payload as object })).statusCode).toBe(200);
  const onboard = async (token: string): Promise<string> => {
    const r = await app.inject({
      method: "POST", url: "/v1/app/screen", headers: auth(token),
      payload: {
        screenId: "onboard",
        capabilities: { platform: "ios", appVersion: "1.0.0", components: ["OnboardStage", "BlipSpot"], device: { width: 390, height: 844, locale: "en-IN" } },
      },
    });
    expect(r.statusCode).toBe(200);
    return r.body;
  };
  const has = (body: string, line: string) => body.includes(JSON.stringify(line).slice(1, -1));

  it("English until the Languages step has saved anything, Hinglish once it has", async () => {
    const before = await onboard(T.fresh);
    expect(has(before, OB_EN["s2.h"])).toBe(true);
    expect(has(before, OB_HG["s2.h"])).toBe(false);

    // What Continue on Languages does, then asks for the screen again.
    await put(T.fresh, "/v1/personality", { languages: ["hinglish", "hi", "en"] });
    const after = await onboard(T.fresh);
    expect(has(after, OB_HG["s2.h"])).toBe(true);
    expect(has(after, OB_EN["s2.h"])).toBe(false);
    expect(has(after, OB_HG["s2.p"])).toBe(true);
    // The design's own lines were used: the model was never asked for one of them.
    expect(asked.items.filter((s) => Object.values(OB_EN).includes(s as never))).toEqual([]);
  });

  it("a language set in the profile is the app's language and wins over the list", async () => {
    await put(T.explicit, "/v1/personality", { languages: ["hinglish"] });
    await put(T.explicit, "/v1/profile", { language: "en" });
    const body = await onboard(T.explicit);
    expect(has(body, OB_EN["s2.h"])).toBe(true);
    expect(has(body, OB_HG["s2.h"])).toBe(false);
  });
});
