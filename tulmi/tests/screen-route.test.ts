import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { gunzipSync } from "node:zlib";

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
process.env.NODE_ENV = "test";

// eslint-disable-next-line import/first
import { buildApp } from "../src/server.js";
// eslint-disable-next-line import/first
import { appendHistoryEntry, listHistory } from "../src/history/store.js";

const dev = { id: "dev-user", email: "dev@flow.local" } as never;

describe("the screen route and History", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it("gzips a large screen for a client that asks, and leaves the rest as they are", async () => {
    for (let i = 0; i < 12; i++) {
      await appendHistoryEntry(dev, { retainHistory: true }, {
        kind: "voice", targetApp: i % 2 ? "WhatsApp" : "Gmail", input: `said ${i}`, output: `Written number ${i} here.`, wordsOut: 4,
      });
    }
    const ask = (encoding?: string) => app.inject({
      method: "POST", url: "/v1/app/screen",
      headers: encoding ? { "accept-encoding": encoding } : {},
      payload: { screenId: "stats", tzOffsetMinutes: 330 },
    });
    const zipped = await ask("gzip, deflate");
    expect(zipped.statusCode).toBe(200);
    expect(zipped.headers["content-encoding"]).toBe("gzip");
    const screen = JSON.parse(gunzipSync(zipped.rawPayload).toString("utf8"));
    expect(screen.screenId).toBe("stats");
    expect(screen.state.dayData).toHaveLength(30);

    const plain = await ask();
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.json().screenId).toBe("stats");
    expect(zipped.rawPayload.length).toBeLessThan(plain.rawPayload.length / 4);
  });

  it("removes a card with its reason, and still removes one sent without", async () => {
    await appendHistoryEntry(dev, { retainHistory: true }, { kind: "typing", input: "one", output: "Not me at all." });
    let id = (await listHistory(dev)).entries[0]!.id;
    const notMe = await app.inject({ method: "DELETE", url: `/v1/history/${id}?reason=not_me` });
    expect(notMe.statusCode).toBe(200);
    expect(notMe.json()).toEqual({ ok: true, reason: "not_me" });

    await appendHistoryEntry(dev, { retainHistory: true }, { kind: "typing", input: "two", output: "Old stuff." });
    id = (await listHistory(dev)).entries[0]!.id;
    const odd = await app.inject({ method: "DELETE", url: `/v1/history/${id}?reason=whatever` });
    expect(odd.statusCode).toBe(200);
    expect(odd.json()).toEqual({ ok: true });
    expect((await listHistory(dev)).entries.find((e) => e.id === id)).toBeUndefined();
  });

  it("puts a × and a three-way question on every History card", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/app/screen", payload: { screenId: "history" } });
    const s = res.json();
    const tpl = JSON.stringify(s.root);
    expect(tpl).toContain('"onPress":"askDelete"');
    expect(tpl).toContain('"onLongPress":"askDelete"');
    for (const b of ["IT DOESN'T SOUND LIKE ME", "JUST A CLEAN-UP", "LEAVE IT"]) expect(tpl).toContain(b);
    expect(JSON.stringify(s.actions.deleteNotMe)).toContain("/v1/history/$state.item.id?reason=not_me");
    expect(JSON.stringify(s.actions.deleteCleanup)).toContain("?reason=cleanup");
    expect(s.actions.keepEntry).toEqual({ kind: "setState", path: "askDelete", value: false });
  });
});
