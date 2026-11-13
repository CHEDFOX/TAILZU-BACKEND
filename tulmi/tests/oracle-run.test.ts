/**
 * A TURN WITH THE ORACLE (src/oracle/run.ts, through the bots service): listed only where its service is set up, birth details read from the chat
 * and kept, the route sent back next turn, the person never named to the service, the money, and a failure said in words.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.NODE_ENV = "test"; process.env.OPENROUTER_API_KEY = "k"; process.env.GROQ_API_KEY = "k"; process.env.DEV_SKIP_AUTH = "true"; });

const { ALICE, rig } = await import("./bots-rig.js");
const { builtinBots, builtinBot } = await import("../src/bots/builtin.js");
const { resetConfigForTests } = await import("../src/config.js");
const { runOracle, sessionOf, ORACLE_MIN_PAISE, profilePerson, NEEDS_SKY, NEEDS_PLACE, FOUND_NOT } = await import("../src/oracle/run.js");
const { MemoryOracleStore } = await import("../src/oracle/store.js");
const { MemoryBotStore } = await import("../src/bots/store.js");
const { OracleUnavailable } = await import("../src/oracle/worker.js");
const { scoreBots, SURE_POINTS } = await import("../src/bots/door.js");

const ON = { ORACLE_WORKER_URL: "http://oracle-worker:8000", ORACLE_WORKER_SECRET: "oracle-secret-0123456789abcdef0123456789" };
const on = () => { Object.assign(process.env, ON); resetConfigForTests(); };
afterEach(() => { for (const k of Object.keys(ON)) delete process.env[k]; resetConfigForTests(); });

function fakeWorker(reply: (ask: { message: string; sky: unknown; route: unknown; session: string; history: unknown[] }) => { text: string; usd?: number; route?: unknown }) {
  const asked: Array<{ message: string; sky: unknown; route: unknown; session: string; history: unknown[] }> = [];
  return {
    asked,
    worker: {
      async answer(ask: { message: string; sky: unknown; route: unknown; session: string; history: unknown[] }, onEvent: (e: { t: "text"; text: string }) => void) {
        asked.push(ask);
        const r = reply(ask);
        onEvent({ t: "text", text: r.text });
        return { text: r.text, route: r.route ?? { picks: ["bphs.navamsa"] }, cast: null, chart: !!ask.sky, model: "anthropic/claude-sonnet-5.5@low", usd: r.usd ?? 0.025 };
      },
    },
  };
}

const MUMBAI = { place: async (q: string) => (/mumbai/i.test(q) ? { lat: 19.07, lon: 72.87, label: "Mumbai, Maharashtra, India" } : null) };

function deps(worker: unknown, store = new MemoryOracleStore()) {
  return { store: new MemoryBotStore(), call: (async () => { throw new Error("no model in this test"); }) as never, now: () => Date.UTC(2026, 10, 11), oracle: { worker: worker as never, store, places: MUMBAI } };
}

const WHOLE = { year: 1994, month: 7, day: 13, hour: 9, minute: 30, timeKnown: true, lat: 19.07, lng: 72.87, place: "Mumbai, Maharashtra, India" };
async function withSky(): Promise<InstanceType<typeof MemoryOracleStore>> { const s = new MemoryOracleStore(); await s.setSky(ALICE, WHOLE, 1); return s; }

const req = (message: string, o: Record<string, unknown> = {}) => ({
  bot: builtinBot("oracle")!, userId: ALICE, message, surface: "chat" as const, capPaise: 600, ...o,
});

describe("the Oracle among the bots", () => {
  it("is listed only where its service is set up", async () => {
    expect(builtinBots().map((b) => b.slug)).toEqual(["code", "keybot", "plan", "travel"]);
    on();
    expect(builtinBots().map((b) => b.slug)).toEqual(["code", "keybot", "plan", "travel", "oracle"]);
    expect(builtinBot("oracle")).toMatchObject({ name: "Oracle", colour: "plum", ownerId: null, skills: { web: false, files: false, artifacts: false, code: false, research: false, connectors: [] } });
    const r = await rig();
    expect((await r.bots.list(ALICE)).map((b) => b.slug)).toContain("oracle");
  });
});

describe("a turn with the Oracle", () => {
  it("keeps birth details given in the chat, reads with them, and never names the person to the service", async () => {
    on();
    const f = fakeWorker(() => ({ text: "You will meet them at work." }));
    const store = new MemoryOracleStore();
    const a = await runOracle(deps(f.worker, store), req("13 July 1994, 9:30 am, Mumbai. When will I marry?"));
    expect(a.text).toBe("You will meet them at work.");
    expect(a.notes).toContain("Kept your birth details: 13 July 1994, 9:30 am, Mumbai.");
    expect(f.asked[0]!.sky).toMatchObject({ year: 1994, month: 7, day: 13, hour: 9, minute: 30, lat: 19.07, lng: 72.87 });
    expect(f.asked[0]!.session).toBe(sessionOf(ALICE));
    expect(f.asked[0]!.session).not.toContain(ALICE);
    expect((await store.get(ALICE))!.sky).toMatchObject({ place: "Mumbai, Maharashtra, India" });
    expect(a.paise).toBe(220);                                         // 0.025 dollars at 88 rupees
    expect(a.bot).toEqual({ slug: "oracle", name: "Oracle", colour: "plum", builtin: true });
  });

  it("reads a sky only once it is whole, and sends their name and gender with it", async () => {
    on();
    const f = fakeWorker(() => ({ text: "This year asks you to choose." }));
    const store = new MemoryOracleStore();
    const when = { year: 1994, month: 7, day: 13, hour: 9, minute: 30, timeKnown: true };
    await store.setSky(ALICE, when, 1);                                  // the first card kept, the second not yet
    const d = deps(f.worker, store);
    const withPerson = { ...d, oracle: { ...d.oracle, person: async () => ({ name: "Aanya Sharma", gender: "female" as const }) } };
    const half = await runOracle(withPerson, req("What is this year asking of me?"));
    expect(f.asked).toHaveLength(0);                                    // half a sky is not read
    expect(half.text).toBe(NEEDS_PLACE);
    await store.setSky(ALICE, { ...when, lat: 19.07, lng: 72.87, place: "Mumbai, Maharashtra, India" }, 2);
    await runOracle(withPerson, req("What is this year asking of me?"));
    expect(f.asked[0]).toMatchObject({ sky: { place: "Mumbai, Maharashtra, India" }, person: { name: "Aanya Sharma", gender: "female" } });
  });

  it("takes name and gender from the profile, leaving out what the engine does not read", async () => {
    const { updateProfile } = await import("../src/profile/store.js");
    const who = { id: "77777777-7777-4777-8777-777777777777" } as never;
    expect(await profilePerson("77777777-7777-4777-8777-777777777777")).toBeNull();
    await updateProfile(who, { fullName: "  Aanya Sharma ", gender: "other" });
    expect(await profilePerson("77777777-7777-4777-8777-777777777777")).toEqual({ name: "Aanya Sharma" });
    await updateProfile(who, { gender: "female" });
    expect(await profilePerson("77777777-7777-4777-8777-777777777777")).toEqual({ name: "Aanya Sharma", gender: "female" });
  });

  it("reads nothing without a chart: the engine is not asked, nothing is charged, and the answer sends them to the cards", async () => {
    on();
    const f = fakeWorker(() => ({ text: "A reading." }));
    const said: string[] = [];
    const a = await runOracle(deps(f.worker), req("Will I be happy?", { onText: (t: string) => said.push(t) }));
    expect(f.asked).toHaveLength(0);
    expect(a).toMatchObject({ text: NEEDS_SKY, paise: 0, notes: [] });
    expect(said).toEqual([NEEDS_SKY]);
    const lost = await runOracle(deps(f.worker), req("13 July 1994, 9:30 am, Atlantis. Will I be happy?"));
    expect(lost.text).toBe(FOUND_NOT);
    expect(f.asked).toHaveLength(0);
  });

  it("sends the route of the last question back", async () => {
    on();
    const f = fakeWorker(() => ({ text: "With your chart.", route: { picks: ["kp.dba_timing"] } }));
    const d = deps(f.worker, await withSky());
    await runOracle(d, req("Will I be happy?"));
    expect(f.asked[0]!.route).toBeNull();
    await runOracle(d, req("and when?"));
    expect(f.asked[1]!.route).toEqual({ picks: ["kp.dba_timing"] });
  });

  it("refuses before asking when the money cannot cover one answer, and says when the service is down", async () => {
    on();
    const f = fakeWorker(() => ({ text: "x" }));
    await expect(runOracle(deps(f.worker), req("hi", { capPaise: ORACLE_MIN_PAISE - 1 }))).rejects.toMatchObject({ code: "budget", status: 402 });
    expect(f.asked).toHaveLength(0);
    const down = { answer: async () => { throw new OracleUnavailable("models_down", "No model now. Try again in a moment."); } };
    await expect(runOracle(deps(down, await withSky()), req("hi"))).rejects.toMatchObject({ code: "model_down", status: 503, message: "No model now. Try again in a moment." });
    await expect(runOracle(deps(null), req("hi"))).rejects.toMatchObject({ code: "not_configured", status: 503 });
  });
});

describe("Ask any bot", () => {
  const none = { projectId: undefined as string | undefined, attachments: [] as never[], recent: [] as never[], mode: "text" as const };
  const top = (message: string) => { const [a, b] = scoreBots(message, builtinBots(), none); return { slug: a!.bot.slug, sure: a!.points >= SURE_POINTS && a!.points - (b?.points ?? 0) >= 3 }; };

  it("sends a reading asked for in so many words to the Oracle, in English, Hinglish and Hindi, with no model asked", () => {
    on();
    for (const m of ["what does my kundli say about my marriage?", "is this year good for my career astrologically", "pull a tarot card for me",
      "what's my horoscope for this week", "when will I get married?", "meri shaadi kab hogi", "mera rashifal batao", "kya main manglik hoon",
      "मेरी कुंडली में शादी का योग कब है", "मेरी जन्म कुण्डली देखो", "क्या मैं मांगलिक हूँ"]) expect(top(m), m).toEqual({ slug: "oracle", sure: true });
  });

  it("leaves names, amounts and plain plans to the bots they were for", () => {
    on();
    expect(top("reply to Rashi that I'm running late, keep it casual").slug).not.toBe("oracle");
    expect(top("tell Dasha I'll call her after the meeting, make it polite").slug).not.toBe("oracle");
    expect(top("invoice ki kul rashi kitni hai").slug).not.toBe("oracle");
    expect(top("plan my week and block time for deep work").slug).toBe("plan");
    expect(top("plan a 3 day trip to Jaipur with hotels and trains").slug).toBe("travel");
    expect(top("शनिवार का प्लान बनाओ").slug).toBe("plan");
    expect(top("make a chart of my monthly expenses").slug).not.toBe("oracle");
  });

  it("is not a candidate where its service is not set up", () => {
    expect(builtinBots().some((b) => b.slug === "oracle")).toBe(false);
    expect(top("what does my kundli say about my marriage?").slug).not.toBe("oracle");
  });
});
