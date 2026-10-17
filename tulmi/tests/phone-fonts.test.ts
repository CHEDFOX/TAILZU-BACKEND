import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";

// eslint-disable-next-line import/first
import { buildApp } from "../src/server.js";
// eslint-disable-next-line import/first
import { FONTS, PHONE_FONT, buildBootstrap } from "../src/experience/catalog.js";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });

describe("the phone's typefaces", () => {
  it("every face the bootstrap names is a file this server serves", async () => {
    const names = Object.values(PHONE_FONT);
    expect(Object.keys(FONTS).sort()).toEqual([...names].sort());
    for (const [name, url] of Object.entries(FONTS)) {
      // The app refuses anything but https and a font extension (remoteFonts.ts).
      expect(url, name).toMatch(/^https:\/\/.+\/fonts\/[a-z-]+\.ttf\?v=\d+$/);
      const path = new URL(url).pathname;
      const res = await app.inject({ method: "GET", url: path });
      expect(res.statusCode, path).toBe(200);
      expect(res.rawPayload.subarray(0, 4).toString("hex"), path).toBe("00010000");
    }
  });

  it("the bootstrap carries them", () => {
    const b = buildBootstrap({} as never) as any;
    expect(b.fonts).toEqual(FONTS);
  });
});
