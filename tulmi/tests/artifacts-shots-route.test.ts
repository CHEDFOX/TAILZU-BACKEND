/**
 * GET /v1/artifacts/:id/shots/:shotId (src/routes/artifacts.ts): a screenshot of a design check, for its owner only. The link is signed for that person,
 * artifact and shot and lasts 7 days; the route also wants the person's own session. Everything that is not exactly right is the same plain 404.
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { noNetwork } from "./no-network.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});
noNetwork();

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const { registerArtifactRoutes } = await import("../src/routes/artifacts.js");
const { ArtifactService } = await import("../src/artifacts/service.js");
const { MemoryArtifactStore } = await import("../src/artifacts/store.js");
const { ArtifactDataShotStore, signShotPath, SHOT_TTL_MS } = await import("../src/artifacts/shots.js");
const { encodePng, solid } = await import("../src/artifacts/pixels.js");

const SECRET = ["shot", "route", "secret", "0123456789abcdef0123456789abcdef"].join("-");
const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };

async function setup(o: { secret?: string | null } = {}) {
  const store = new MemoryArtifactStore();
  const service = new ArtifactService({ store });
  const shots = new ArtifactDataShotStore(store as never);
  const app = Fastify();
  registerArtifactRoutes(app, { rateLimit: RL, artifacts: { service, shots, shotSecret: o.secret === undefined ? SECRET : o.secret } });
  await app.ready();
  const made = await service.create("alice", { type: "markdown", title: "T", content: "# hi" });
  const png = encodePng(solid(12, 12, [200, 10, 10]));
  const { id: shotId } = await shots.put("alice", { artifactId: made.artifact.id, version: 1, kind: "built", viewport: "mobile", at: Date.now() }, png);
  const get = (user: string | null, path: string) => app.inject({ method: "GET", url: path, headers: user ? { authorization: `Bearer ${user}` } : {} });
  const link = (over: Partial<Parameters<typeof signShotPath>[0]> = {}) => signShotPath({ secret: SECRET, userId: "alice", artifactId: made.artifact.id, shotId, ...over });
  return { app, get, link, artifactId: made.artifact.id, shotId, png, service, shots };
}

describe("a design check's screenshot", () => {
  it("is served as a PNG to its owner, with a link signed for them", async () => {
    const t = await setup();
    const res = await t.get("alice", t.link());
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toBe("private, max-age=600");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(Array.from(res.rawPayload)).toEqual(Array.from(t.png));
  });

  it("is a plain 404 for anyone else: no session, another person's session with the owner's link, another's own link, a link for another shot or artifact", async () => {
    const t = await setup();
    expect((await t.get(null, t.link())).statusCode).toBe(401);
    for (const [who, path] of [
      ["bob", t.link()],
      ["bob", t.link({ userId: "bob" })],
      ["alice", t.link({ shotId: "e".repeat(32) })],
      ["alice", t.link({ artifactId: "00000000-0000-4000-8000-000000000000" })],
      ["alice", t.link({ secret: "another-secret-0123456789abcdef01234567" })],
      ["alice", t.link({ ttlMs: -1000 })],
      ["alice", `/v1/artifacts/${t.artifactId}/shots/${t.shotId}`],
      ["alice", `/v1/artifacts/${t.artifactId}/shots/${t.shotId}?exp=99999999999999&sig=${"a".repeat(43)}`],
      ["alice", `/v1/artifacts/not-an-id/shots/${t.shotId}?exp=1&sig=x`],
      ["alice", `/v1/artifacts/${t.artifactId}/shots/short?exp=1&sig=x`],
    ] as const) {
      const res = await t.get(who, path);
      expect(res.statusCode, `${who} ${path}`).toBe(404);
      expect(res.json()).toEqual({ code: "not_found", message: "There is no such picture." });
    }
  });

  it("stops at 7 days: the link, and the shot", async () => {
    const t = await setup();
    const path = t.link({ now: Date.now() - SHOT_TTL_MS + 60_000 });
    expect((await t.get("alice", path)).statusCode).toBe(200);
    const old = t.link({ now: Date.now() - SHOT_TTL_MS - 1000 });
    expect((await t.get("alice", old)).statusCode).toBe(404);
  });

  it("is not served at all where no secret is set, and a deleted artifact's shots are gone", async () => {
    const off = await setup({ secret: null });
    expect((await off.get("alice", off.link())).statusCode).toBe(404);
    const t = await setup();
    await t.service.remove("alice", t.artifactId);
    expect((await t.get("alice", t.link())).statusCode).toBe(404);
  });
});
