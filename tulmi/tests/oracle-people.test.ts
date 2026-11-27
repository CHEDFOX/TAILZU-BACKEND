/**
 * CHAMEN'S PEOPLE (oracle/people.ts, routes/bots/oracle.ts, oracle/run.ts; docs/oracle.md "People"): birth dates and times picked on wheels,
 * the people a person adds, the one picked (one chat: each question is read for the one picked), their own chart's gender for Chamen only,
 * and charts shared into a space, which its members can ask about and never see the birth details of.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const Fastify = (await import("fastify")).default;
const { registerOracleRoutes } = await import("../src/routes/bots/oracle.js");
const { MemoryOracleStore } = await import("../src/oracle/store.js");
const { whenFromParts, partsOf } = await import("../src/oracle/birth.js");
const { circleView, readFor, setOracleSpaces, parseRef } = await import("../src/oracle/people.js");
const { runOracle } = await import("../src/oracle/run.js");
const { builtinBot } = await import("../src/bots/builtin.js");
const { MemoryBotStore } = await import("../src/bots/store.js");
const { resetConfigForTests } = await import("../src/config.js");

const ON = { ORACLE_WORKER_URL: "http://oracle-worker:8000", ORACLE_WORKER_SECRET: "oracle-secret-0123456789abcdef0123456789" };
const on = () => { Object.assign(process.env, ON); resetConfigForTests(); };
afterEach(() => { for (const k of Object.keys(ON)) delete process.env[k]; resetConfigForTests(); setOracleSpaces(null); });

const A = "aaaaaaaa-0000-4000-8000-000000000001", B = "bbbbbbbb-0000-4000-8000-000000000002";
const WHOLE = { year: 1994, month: 7, day: 13, hour: 9, minute: 30, timeKnown: true, lat: 19.07, lng: 72.87, place: "Mumbai, Maharashtra, India" };
const MOM = { year: 1966, month: 3, day: 2, hour: 18, minute: 5, timeKnown: true, lat: 28.61, lng: 77.2, place: "Delhi, India" };
const WHEELS = { day: "2", month: "March", year: "1966", hour: "6", minute: "05", ampm: "pm" };
const MUMBAI = { place: async (q: string) => (/mumbai|delhi/i.test(q) ? (/delhi/i.test(q) ? { lat: 28.61, lon: 77.2, label: "Delhi, India" } : { lat: 19.07, lon: 72.87, label: "Mumbai, Maharashtra, India" }) : null) };

async function app(store = new MemoryOracleStore()) {
  on();
  const a = Fastify();
  registerOracleRoutes(a, { rateLimit: {}, bots: {}, store, places: MUMBAI });
  await a.ready();
  return { a, store };
}

describe("the wheels", () => {
  it("read the day, the month (by name or number), the year and the time; a date that does not exist, or a part missing, is nothing", () => {
    expect(whenFromParts(WHEELS)).toEqual({ year: 1966, month: 3, day: 2, hour: 18, minute: 5, timeKnown: true });
    expect(whenFromParts({ ...WHEELS, month: "3", hour: "12", ampm: "am" })).toMatchObject({ month: 3, hour: 0 });
    expect(whenFromParts({ ...WHEELS, day: "31", month: "February" })).toBeNull();
    expect(whenFromParts({ ...WHEELS, ampm: "" })).toBeNull();
    expect(whenFromParts({ ...WHEELS, year: "2999" })).toBeNull();
    expect(partsOf(MOM)).toEqual({ day: "2", month: "March", year: "1966", hour: "6", minute: "05", ampm: "pm" });
  });

  it("are what the card sends to keep their own when", async () => {
    const { a } = await app();
    const r = await a.inject({ method: "PUT", url: "/v1/oracle/sky", payload: WHEELS });
    expect(r.statusCode).toBe(200);
    expect(r.json().when.line).toBe("2 March 1966, 6:05 pm");
    expect(r.json().parts).toEqual(WHEELS);
    const bad = await a.inject({ method: "PUT", url: "/v1/oracle/sky", payload: { ...WHEELS, day: "31", month: "February" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/Pick the day, the month, the year and the time/);
  });
});

describe("the people a person adds", () => {
  it("are added whole and picked; picked again, switched back, taken out; their own gender is Chamen's alone", async () => {
    const { a, store } = await app();
    await store.setSky("dev-user", WHOLE, 1);
    const view0 = (await a.inject({ method: "GET", url: "/v1/oracle/people" })).json();
    expect(view0).toMatchObject({ active: "me", others: [], shared: [], me: { ref: "me", ready: true } });

    expect((await a.inject({ method: "POST", url: "/v1/oracle/people", payload: { ...WHEELS, place: "Delhi" } })).json().message).toMatch(/Add their name/);
    expect((await a.inject({ method: "POST", url: "/v1/oracle/people", payload: { name: "Mom", place: "Delhi" } })).json().message).toMatch(/Pick the day/);
    expect((await a.inject({ method: "POST", url: "/v1/oracle/people", payload: { name: "Mom", ...WHEELS, place: "Atlantis" } })).json().message).toMatch(/couldn't find that place/);

    const added = await a.inject({ method: "POST", url: "/v1/oracle/people", payload: { name: " Mom ", gender: "female", ...WHEELS, place: "Delhi" } });
    expect(added.statusCode).toBe(201);
    const v = added.json();
    expect(v.others).toEqual([expect.objectContaining({ name: "Mom", gender: "female", line: "2 March 1966, 6:05 pm, Delhi", ready: true, sharedIn: [] })]);
    expect(v.active).toBe(v.others[0].ref);
    // Someone added with no gender keeps none: it is not filled from anywhere.
    const dad = (await a.inject({ method: "POST", url: "/v1/oracle/people", payload: { name: "Dad", ...WHEELS, place: "Delhi" } })).json();
    expect(dad.others[1]).toMatchObject({ name: "Dad", gender: null });

    expect((await a.inject({ method: "PUT", url: "/v1/oracle/people/active", payload: { ref: "me" } })).json().active).toBe("me");
    expect((await a.inject({ method: "PUT", url: "/v1/oracle/people/active", payload: { ref: "p:nobody" } })).statusCode).toBe(404);

    const g = (await a.inject({ method: "PUT", url: "/v1/oracle/people/me", payload: { gender: "male" } })).json();
    expect(g.me).toMatchObject({ gender: "male", genderFrom: "chamen" });

    await a.inject({ method: "PUT", url: "/v1/oracle/people/active", payload: { ref: v.others[0].ref } });
    const gone = (await a.inject({ method: "DELETE", url: `/v1/oracle/people/${encodeURIComponent(v.others[0].ref)}` })).json();
    expect(gone.others.map((o: { name: string }) => o.name)).toEqual(["Dad"]);
    expect(gone.active).toBe("me");
  });
});

describe("a chart shared into a space", () => {
  it("can be picked and asked about by its members, never shows when or where, and ends when they leave or it is taken back", async () => {
    const store = new MemoryOracleStore();
    let bIn = true;
    setOracleSpaces({
      mine: async (u) => (u === A || (u === B && bIn) ? [{ id: "s1", name: "Home" }] : []),
      nameOf: async (_v, u) => (u === A ? "Aanya" : "Rohan"),
    });
    await store.setSky(A, WHOLE, 1);
    await store.setCircle(A, { others: [{ id: "mom1", name: "Mom", gender: "female", sky: MOM, at: 1 }] }, 1);
    await store.setShare(A, "p:mom1", "s1", true, 2);
    await store.setShare(A, "me", "s1", true, 2);

    const mine = await circleView(A, { name: "Aanya Sharma", gender: "female" }, store);
    expect(mine.others[0]!.sharedIn).toEqual(["s1"]);
    expect(mine.me.sharedIn).toEqual(["s1"]);
    expect(mine.shared).toEqual([]);                                   // never their own

    const theirs = await circleView(B, { name: "Rohan" }, store);
    expect(theirs.shared.map((x) => ({ name: x.name, by: x.by, space: x.space }))).toEqual([
      { name: "Mom", by: "Aanya", space: "Home" }, { name: "Aanya", by: "Aanya", space: "Home" },
    ]);
    // No birth details travel with a shared chart: no line, no date, no place.
    expect(JSON.stringify(theirs.shared)).not.toMatch(/1966|Delhi|1994|Mumbai/);

    const ref = theirs.shared[0]!.ref;
    expect(parseRef(ref)).toEqual({ kind: "shared", ownerId: A, ref: "p:mom1" });
    await store.setCircle(B, { active: ref }, 3);
    const r = await readFor(B, { name: "Rohan" }, store);
    expect(r).toMatchObject({ ref, name: "Mom", own: false, person: { name: "Mom", gender: "female" } });
    expect(r.sky).toMatchObject({ year: 1966, place: "Delhi, India" });

    bIn = false;                                                        // Rohan leaves the space
    expect(await readFor(B, { name: "Rohan" }, store)).toMatchObject({ ref: "me", own: true, why: "gone" });
    bIn = true;
    await store.setShare(A, "p:mom1", "s1", false, 4);                  // or Aanya takes it back
    expect(await readFor(B, { name: "Rohan" }, store)).toMatchObject({ ref: "me", why: "gone" });
  });
});

describe("a question, read for the one picked", () => {
  function fakeWorker() {
    const asked: Array<{ sky: unknown; person: unknown; session: string }> = [];
    return { asked, worker: { async answer(ask: { sky: unknown; person: unknown; session: string }, onEvent: (e: { t: "text"; text: string }) => void) {
      asked.push(ask); onEvent({ t: "text", text: "Read." });
      return { text: "Read.", route: null, cast: null, chart: true, model: "m", usd: 0.02 };
    } } };
  }
  const deps = (worker: unknown, store: InstanceType<typeof MemoryOracleStore>) => ({
    store: new MemoryBotStore(), call: (async () => { throw new Error("no model"); }) as never, now: () => Date.UTC(2026, 10, 11),
    oracle: { worker: worker as never, store, places: MUMBAI, person: async () => ({ name: "Aanya Sharma", gender: "female" as const }) },
  });
  const req = (message: string) => ({ bot: builtinBot("oracle")!, userId: A, message, surface: "chat" as const, capPaise: 600 });

  it("one chat: the picked person's chart and name go with the question, and birth details typed then are not kept as theirs", async () => {
    on();
    const store = new MemoryOracleStore();
    await store.setSky(A, WHOLE, 1);
    await store.setCircle(A, { others: [{ id: "mom1", name: "Mom", gender: "female", sky: MOM, at: 1 }, { id: "half", name: "Riya", gender: null, sky: null, at: 1 }], active: "p:mom1" }, 1);
    const f = fakeWorker();
    const out = await runOracle(deps(f.worker, store), req("13 July 1994, 9:30 am, Mumbai. Will her health hold?"));
    expect(f.asked[0]).toMatchObject({ sky: { year: 1966, place: "Delhi, India" }, person: { name: "Mom", gender: "female" } });
    expect(out.notes).toContain("Read for Mom.");
    expect((await store.get(A))!.sky).toMatchObject({ year: 1994 });     // their own chart untouched

    // Back to themselves: their own chart, and the gender they set in Chamen over the profile's.
    await store.setCircle(A, { active: "me", gender: "male" }, 2);
    await runOracle(deps(f.worker, store), req("And me?"));
    expect(f.asked[1]).toMatchObject({ sky: { year: 1994 }, person: { name: "Aanya Sharma", gender: "male" } });
    expect(f.asked[1]!.session).not.toBe(f.asked[0]!.session);

    // Someone whose details are not whole: no reading, nothing charged.
    await store.setCircle(A, { active: "p:half" }, 3);
    const none = await runOracle(deps(f.worker, store), req("What about Riya?"));
    expect(f.asked).toHaveLength(2);
    expect(none.paise).toBe(0);
    expect(none.text).toMatch(/don't have all of Riya's birth details/);
  });
});
