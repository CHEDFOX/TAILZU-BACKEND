/**
 * THE ORACLE'S CARDS OVER HTTP (routes/bots/oracle.ts): off unless the Oracle is set up, birth details read and kept (whole, or in parts as the
 * cards ask: the when, then the place), a place not found said in words, places suggested as they type, and forgotten on request.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const Fastify = (await import("fastify")).default;
const { registerOracleRoutes } = await import("../src/routes/bots/oracle.js");
const { MemoryOracleStore } = await import("../src/oracle/store.js");
const { resetConfigForTests } = await import("../src/config.js");

const ON = { ORACLE_WORKER_URL: "http://oracle-worker:8000", ORACLE_WORKER_SECRET: "oracle-secret-0123456789abcdef0123456789" };
afterEach(() => { for (const k of Object.keys(ON)) delete process.env[k]; resetConfigForTests(); });

type BirthPlaces = import("../src/oracle/places.js").BirthPlaces;

async function app(o: { on?: boolean; birthPlaces?: BirthPlaces } = {}) {
  if (o.on !== false) { Object.assign(process.env, ON); resetConfigForTests(); }
  const a = Fastify();
  const store = new MemoryOracleStore();
  registerOracleRoutes(a, {
    rateLimit: {}, bots: {}, store, places: { place: async (q) => (/mumbai/i.test(q) ? { lat: 19.07, lon: 72.87, label: "Mumbai, Maharashtra, India" } : null) },
    ...(o.birthPlaces ? { birthPlaces: o.birthPlaces } : {}),
  });
  await a.ready();
  return { a, store };
}
const put = (a: Awaited<ReturnType<typeof app>>["a"], payload: Record<string, unknown>) => a.inject({ method: "PUT", url: "/v1/oracle/sky", payload });

describe("the Oracle's card", () => {
  it("is off unless the Oracle is set up", async () => {
    const { a } = await app({ on: false });
    expect((await a.inject({ method: "GET", url: "/v1/oracle/sky" })).json()).toMatchObject({ code: "oracle_off" });
  });

  it("reads the date, the time and the place, keeps them, and says them back", async () => {
    const { a } = await app();
    expect((await a.inject({ method: "GET", url: "/v1/oracle/sky" })).json()).toEqual({ sky: null, line: null, when: null });
    const put = await a.inject({ method: "PUT", url: "/v1/oracle/sky", payload: { date: "13 July 1994", time: "9:30 am", place: "Mumbai" } });
    expect(put.statusCode).toBe(200);
    expect(put.json().line).toBe("13 July 1994, 9:30 am, Mumbai");
    expect((await a.inject({ method: "GET", url: "/v1/oracle/sky" })).json().sky).toMatchObject({ lat: 19.07, lng: 72.87, timeKnown: true });
    expect((await a.inject({ method: "DELETE", url: "/v1/oracle/sky" })).json()).toEqual({ ok: true });
    expect((await a.inject({ method: "GET", url: "/v1/oracle/sky" })).json().sky).toBeNull();
  });

  it("keeps the cards' answers as they come: the when first, then the place, and a later change of one keeps the other", async () => {
    const { a } = await app();
    const when = await put(a, { date: "13 July 1994", time: "9:30 am" });
    expect(when.statusCode).toBe(200);
    expect(when.json()).toEqual({ sky: null, line: null, when: { date: "13 July 1994", time: "9:30 am", line: "13 July 1994, 9:30 am" } });
    expect((await a.inject({ method: "GET", url: "/v1/oracle/sky" })).json().when.line).toBe("13 July 1994, 9:30 am");

    const where = await put(a, { placeId: "c:19.0760,72.8777", place: "Mumbai", session: "0b6c1d0e-6a0f-4a43-9c1e-6f5b1a2c3d4e" });
    expect(where.statusCode).toBe(200);
    expect(where.json().line).toBe("13 July 1994, 9:30 am, Mumbai");
    expect(where.json().sky).toMatchObject({ lat: 19.076, lng: 72.8777, timeKnown: true });

    const changed = await put(a, { date: "14 July 1994", time: "" });
    expect(changed.json().line).toBe("14 July 1994, time not known, Mumbai");
  });

  it("asks for the when before the place, and says an unreadable time in words", async () => {
    const { a } = await app();
    expect((await put(a, { place: "Mumbai" })).json().message).toMatch(/when you were born first/);
    expect((await put(a, { date: "13 July 1994", time: "teatime" })).json().message).toMatch(/couldn't read that time/);
    expect((await put(a, { time: "9:30 am" })).json().message).toMatch(/date of birth/);
  });

  it("suggests towns and cities as they type, and keeps the one picked", async () => {
    const asked: Array<{ q: string; session?: string }> = [];
    const birthPlaces: BirthPlaces = {
      google: true,
      async suggest(q, session) { asked.push({ q, ...(session ? { session } : {}) }); return q.length < 2 ? [] : [{ id: "g:ChIJwe1EZjDG5zsRaYxkjY_tpF0", label: "Mumbai", sub: "Maharashtra, India" }]; },
      async resolve(pick) { return pick.id === "g:ChIJwe1EZjDG5zsRaYxkjY_tpF0" ? { lat: 19.076, lon: 72.8777, label: "Mumbai, Maharashtra, India" } : null; },
    };
    const { a } = await app({ birthPlaces });
    const found = await a.inject({ method: "GET", url: "/v1/oracle/places?q=mum&s=0b6c1d0e-6a0f-4a43-9c1e-6f5b1a2c3d4e" });
    expect(found.json()).toEqual({ q: "mum", places: [{ id: "g:ChIJwe1EZjDG5zsRaYxkjY_tpF0", label: "Mumbai", sub: "Maharashtra, India" }] });
    expect(asked).toEqual([{ q: "mum", session: "0b6c1d0e-6a0f-4a43-9c1e-6f5b1a2c3d4e" }]);
    await put(a, { date: "13 July 1994", time: "" });
    const kept = await put(a, { placeId: "g:ChIJwe1EZjDG5zsRaYxkjY_tpF0", place: "Mumbai", session: "0b6c1d0e-6a0f-4a43-9c1e-6f5b1a2c3d4e" });
    expect(kept.json().line).toBe("13 July 1994, time not known, Mumbai");
    expect((await put(a, { placeId: "g:nowhere", place: "" })).json().message).toMatch(/couldn't find that place/);
  });

  it("says what is missing in words", async () => {
    const { a } = await app();
    expect((await a.inject({ method: "PUT", url: "/v1/oracle/sky", payload: { date: "someday", place: "Mumbai" } })).json().message).toMatch(/date of birth/);
    expect((await a.inject({ method: "PUT", url: "/v1/oracle/sky", payload: { date: "13 July 1994", place: "Atlantis" } })).json().message).toMatch(/couldn't find that place/);
  });
});
