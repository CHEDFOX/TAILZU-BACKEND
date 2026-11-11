/**
 * THE ORACLE'S CARD OVER HTTP (routes/bots/oracle.ts): off unless the Oracle is set up, birth details read and kept, a place not found said in words,
 * and forgotten on request.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const Fastify = (await import("fastify")).default;
const { registerOracleRoutes } = await import("../src/routes/bots/oracle.js");
const { MemoryOracleStore } = await import("../src/oracle/store.js");
const { resetConfigForTests } = await import("../src/config.js");

const ON = { ORACLE_WORKER_URL: "http://oracle-worker:8000", ORACLE_WORKER_SECRET: "oracle-secret-0123456789abcdef0123456789" };
afterEach(() => { for (const k of Object.keys(ON)) delete process.env[k]; resetConfigForTests(); });

async function app(o: { on?: boolean } = {}) {
  if (o.on !== false) { Object.assign(process.env, ON); resetConfigForTests(); }
  const a = Fastify();
  const store = new MemoryOracleStore();
  registerOracleRoutes(a, { rateLimit: {}, bots: {}, store, places: { place: async (q) => (/mumbai/i.test(q) ? { lat: 19.07, lon: 72.87, label: "Mumbai, Maharashtra, India" } : null) } });
  await a.ready();
  return { a, store };
}

describe("the Oracle's card", () => {
  it("is off unless the Oracle is set up", async () => {
    const { a } = await app({ on: false });
    expect((await a.inject({ method: "GET", url: "/v1/oracle/sky" })).json()).toMatchObject({ code: "oracle_off" });
  });

  it("reads the date, the time and the place, keeps them, and says them back", async () => {
    const { a } = await app();
    expect((await a.inject({ method: "GET", url: "/v1/oracle/sky" })).json()).toEqual({ sky: null, line: null });
    const put = await a.inject({ method: "PUT", url: "/v1/oracle/sky", payload: { date: "13 July 1994", time: "9:30 am", place: "Mumbai" } });
    expect(put.statusCode).toBe(200);
    expect(put.json().line).toBe("13 July 1994, 9:30 am, Mumbai");
    expect((await a.inject({ method: "GET", url: "/v1/oracle/sky" })).json().sky).toMatchObject({ lat: 19.07, lng: 72.87, timeKnown: true });
    expect((await a.inject({ method: "DELETE", url: "/v1/oracle/sky" })).json()).toEqual({ ok: true });
    expect((await a.inject({ method: "GET", url: "/v1/oracle/sky" })).json().sky).toBeNull();
  });

  it("says what is missing in words", async () => {
    const { a } = await app();
    expect((await a.inject({ method: "PUT", url: "/v1/oracle/sky", payload: { date: "someday", place: "Mumbai" } })).json().message).toMatch(/date of birth/);
    expect((await a.inject({ method: "PUT", url: "/v1/oracle/sky", payload: { date: "13 July 1994", place: "Atlantis" } })).json().message).toMatch(/couldn't find that place/);
  });
});
