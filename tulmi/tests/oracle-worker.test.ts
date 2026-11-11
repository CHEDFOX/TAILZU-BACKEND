/**
 * THE ORACLE'S SERVICE, FROM THE VPS'S SIDE (src/oracle/worker.ts): signed like the media worker, streamed, and a failure said in words.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { oracleWorker, OracleUnavailable } = await import("../src/oracle/worker.js");
const { workerSignature } = await import("../src/media/worker.js");

const SECRET = "oracle-secret-0123456789abcdef0123456789";
const SKY = { year: 1994, month: 7, day: 13, hour: 9, minute: 30, lat: 19.07, lng: 72.87, place: "Mumbai", timeKnown: true };

function ndjson(lines: unknown[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      // Split across chunks the way a network does.
      const all = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
      for (let i = 0; i < all.length; i += 17) c.enqueue(enc.encode(all.slice(i, i + 17)));
      c.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "application/x-ndjson" } });
}

const ASK = { message: "When will I marry?", history: [{ role: "user" as const, content: "hi" }], sky: SKY, route: { picks: ["bphs.navamsa"] }, session: "oracle:abc" };

describe("the oracle's service", () => {
  it("is nothing without its address and secret", () => {
    expect(oracleWorker({ url: "", secret: "" })).toBeNull();
  });

  it("signs every call the media worker's way and sends the sky, the turns and the last route", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      seen = { url, init };
      return ndjson([{ t: "status", stage: "reading" }, { t: "text", text: "Yes, " }, { t: "text", text: "and soon." },
        { t: "result", result: { text: "Yes, and soon.", route_state: { picks: ["bphs.navamsa"] }, cast: null, chart: true, model: "anthropic/claude-sonnet-5.5@low", usd: 0.025 } }]);
    }) as unknown as typeof fetch;
    const w = oracleWorker({ url: "http://oracle-worker:8000/", secret: SECRET, fetchFn, now: () => 1_700_000_000_000 })!;
    const events: unknown[] = [];
    const got = await w.answer(ASK, (e) => events.push(e));
    expect(got).toEqual({ text: "Yes, and soon.", route: { picks: ["bphs.navamsa"] }, cast: null, chart: true, model: "anthropic/claude-sonnet-5.5@low", usd: 0.025 });
    expect(events).toEqual([{ t: "status", stage: "reading" }, { t: "text", text: "Yes, " }, { t: "text", text: "and soon." }]);
    const s = seen!;
    expect(s.url).toBe("http://oracle-worker:8000/v1/answer");
    const h = s.init.headers as Record<string, string>;
    const body = s.init.body as Buffer;
    expect(h["x-tailzu-signature"]).toBe(workerSignature(SECRET, { timestamp: 1_700_000_000, nonce: h["x-tailzu-nonce"]!, method: "POST", pathWithQuery: "/v1/answer", body }));
    const sent = JSON.parse(body.toString("utf8"));
    expect(sent).toMatchObject({ message: "When will I marry?", session: "oracle:abc", stream: true, last_route: { picks: ["bphs.navamsa"] } });
    expect(sent.birth).toEqual({ year: 1994, month: 7, day: 13, hour: 9, minute: 30, lat: 19.07, lng: 72.87, place: "Mumbai" });
  });

  it("says in words when the service cannot answer", async () => {
    const down = oracleWorker({ url: "http://w", secret: SECRET, fetchFn: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch })!;
    await expect(down.answer(ASK, () => undefined)).rejects.toBeInstanceOf(OracleUnavailable);
    const busy = oracleWorker({ url: "http://w", secret: SECRET, fetchFn: (async () => new Response(JSON.stringify({ code: "busy", message: "The oracle is busy. Try again in a moment." }), { status: 503 })) as unknown as typeof fetch })!;
    await expect(busy.answer(ASK, () => undefined)).rejects.toMatchObject({ code: "busy", message: "The oracle is busy. Try again in a moment." });
    const midway = oracleWorker({ url: "http://w", secret: SECRET, fetchFn: (async () => ndjson([{ t: "text", text: "Hm" }, { t: "error", code: "models_down", message: "No model now." }])) as unknown as typeof fetch })!;
    await expect(midway.answer(ASK, () => undefined)).rejects.toMatchObject({ code: "models_down", message: "No model now." });
  });
});
