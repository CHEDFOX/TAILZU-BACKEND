import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";

// eslint-disable-next-line import/first
import { loadMediaRegistry, registerMediaRoutes } from "../src/routes/media.js";

// /media/k/<key> is what the sign-in email's <img> points at. Pasted into
// Supabase by hand, that HTML cannot wait for someone to upload a mark: with
// nothing under the key, the mark that ships with the code answers instead,
// and an upload, once there is one, takes over.

let app: FastifyInstance;
let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "tz-media-keyed-"));
  await loadMediaRegistry(dir);
  app = Fastify();
  registerMediaRoutes(app, { mediaDir: dir, publicUrlPrefix: "https://api.tailzu.space/media" });
  await app.ready();
});
afterAll(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }); });

describe("the email's mark", () => {
  it("is served from the code when nothing is uploaded under email.mark", async () => {
    const r = await app.inject({ method: "GET", url: "/media/k/email.mark" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("image/png");
    expect(String(r.headers["cache-control"])).toContain("max-age=3600");
    expect(r.rawPayload.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it("follows an upload under the key once there is one", async () => {
    await fs.writeFile(path.join(dir, "_registry_v1.json"), JSON.stringify({
      "email.mark": { url: "https://api.tailzu.space/media/abc.png", contentType: "image/png", size: 10, uploadedAt: 1 },
    }));
    await loadMediaRegistry(dir);
    const r = await app.inject({ method: "GET", url: "/media/k/email.mark" });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe("https://api.tailzu.space/media/abc.png");
  });

  it("answers 404 for a key with neither an upload nor a bundled file", async () => {
    for (const key of ["nothing.here", "toString", "constructor"]) {
      const r = await app.inject({ method: "GET", url: `/media/k/${key}` });
      expect(r.statusCode, key).toBe(404);
    }
  });
});
