// WHERE A HEALTH NUMBER NEVER GOES (docs: perms §4.6), and the only way the switch is ever turned on (§4.5).
//
// The first half is an IMPORT-GRAPH test. In this build no model, no notification, no widget and no advertising event can
// reach a step count, and the way that is held up is not care but the graph: `src/bots/healthDays.ts` is imported by a fixed
// short list of files, and this test fails the moment anything else imports it, directly or through another file. So a change
// that makes `bots/run.ts` or a prompt able to read health data cannot land quietly: it lands as a failing test naming the
// file that did it.
//
// The second half drives the route and the service: only the phone's POST sets `skills.health`, every other write path forces
// it false or refuses, and switching off deletes the days.
import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";

/** Set by the Delete-my-data test only, so every other test keeps the real (absent) service key and its memory stores. */
const DB = vi.hoisted(() => ({ admin: null as unknown }));

// Whoever the test says is calling: the token is the account's id, and none is nobody. Everything else of the real module,
// so the stores still read the (unset) service key and stay in memory.
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return {
    ...real,
    supabase: () => (DB.admin ?? real.supabase()),
    resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; },
  };
});

process.env.OPENROUTER_API_KEY = "k";
process.env.OPENAI_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://127.0.0.1:1";
process.env.SUPABASE_ANON_KEY = "anon";

const SRC = path.resolve(import.meta.dirname, "../src");
const STORE = "bots/healthDays.ts";

/** Everything under src/, by its path from src/. */
function sources(dir = SRC, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (e.name.endsWith(".ts")) out.push(path.relative(SRC, p));
  }
  return out;
}

/** The files each file imports, by their path from src/ (relative imports only; a package cannot reach our store). */
function importsOf(file: string): string[] {
  const text = fs.readFileSync(path.join(SRC, file), "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/from\s+"(\.[^"]+)"/g)) {
    const raw = m[1]!.replace(/\.js$/, ".ts");
    const abs = path.resolve(path.dirname(path.join(SRC, file)), raw);
    const rel = path.relative(SRC, abs);
    if (!rel.startsWith("..")) out.push(rel);
  }
  return out;
}

describe("nothing but these files can reach a health number", () => {
  /**
   * The whole list, and the reason each one is on it. Adding a file here is a decision about where health data may go, so it
   * is written down next to the name.
   */
  const MAY_IMPORT: Record<string, string> = {
    "bots/healthDays.ts": "the store itself",
    "bots/healthService.ts": "the one place a bot and its days meet: the sync, the Moves counts, the export, the delete",
    "routes/bots/botHealth.ts": "the POST that stores the days, the GET of the Moves counts, and the 31-day sweeper",
    "experience/bots/screens/bots/health.ts": "the row, its card and the Moves line (types only)",
    "experience/bots/screens/bots/parts.ts": "the Moves type on the bot page's data",
    "experience/bots/screens/bots.ts": "the bot page, which draws the Moves line",
  };

  it("is imported only by the files that are allowed to, and by nothing they pull in", () => {
    const bad: string[] = [];
    for (const f of sources()) {
      if (MAY_IMPORT[f] !== undefined) continue;
      if (importsOf(f).includes(STORE)) bad.push(f);
    }
    expect(bad, `these import ${STORE} and are not on the list in tests/health-never.test.ts`).toEqual([]);
  });

  it("keeps it away from every model, memory, prompt, tool and push builder", () => {
    // Named one by one, so the list above cannot quietly grow to include one of them.
    // bots/service.ts runs the models (runBot) and routes/bots/bots.ts hosts POST .../ask, the road to an AI service. Both
    // used to be allowed to read the days, which meant the rule held only as long as nobody edited them carelessly. They
    // are now on this list, and the health work lives in bots/healthService.ts and routes/bots/botHealth.ts instead.
    const NEVER = [
      "bots/run.ts", "bots/memory.ts", "bots/shared.ts", "bots/prompt.ts", "bots/tools.ts", "bots/builder.ts", "bots/door.ts",
      "bots/service.ts", "routes/bots/bots.ts", "push/engine.ts", "ads/meta.ts",
    ];
    for (const f of NEVER) {
      if (!fs.existsSync(path.join(SRC, f))) continue;
      expect(MAY_IMPORT[f], `${f} must never be allowed to import ${STORE}`).toBeUndefined();
      expect(importsOf(f), f).not.toContain(STORE);
    }
  });

  it("no widget, glance, Live Activity or Android notice builder names health at all", () => {
    const WORDS = /\b(?:healthDays|bot_health_days|skills\.health|HealthKit|Health Connect)\b/;
    for (const f of sources()) {
      if (!/^(?:widgets|push)\//.test(f) && !/native|glance|activity|notice/i.test(f)) continue;
      if (MAY_IMPORT[f] !== undefined) continue;
      expect(fs.readFileSync(path.join(SRC, f), "utf8"), f).not.toMatch(WORDS);
    }
  });

  it("the builder's model schema has no health, so a draft can never ask for it", () => {
    const builder = fs.readFileSync(path.join(SRC, "bots/builder.ts"), "utf8");
    const schema = /skills:\s*z\.object\(\{[^}]*\}\)/.exec(builder)?.[0] ?? "";
    expect(schema).toContain("research");
    expect(schema).not.toContain("health");
  });

  it("no advertising event is derived from health, location or contacts", async () => {
    // The milestone list is exactly today's three. A new one for any of the three features would show up here, and
    // Meta's SDK ships with automatic app events on, so this is a real rule and not a formality.
    const { dueMilestones } = await import("../src/bots/../ads/meta.js");
    const all = dueMilestones({ createdAt: new Date().toISOString(), keyboardOn: true, wordsEver: 10, desktop: false });
    expect(all.sort()).toEqual(["firstDictation", "keyboard", "registration"]);
    const meta = fs.readFileSync(path.join(SRC, "ads/meta.ts"), "utf8");
    expect(meta).not.toMatch(/\b(?:health|workout|steps|healthDays|locationArea|contact\.pick)\b/i);
    // And nothing in the three new files sends one.
    for (const f of ["bots/healthDays.ts", "bots/healthGate.ts", "botsBots/inviteMail.ts", "botsBots/inviteSweeper.ts"]) {
      expect(fs.readFileSync(path.join(SRC, f), "utf8"), f).not.toMatch(/sendMetaEvent|appEventsFor/);
    }
  });

  it("the route logs counts, never a value", () => {
    // The whole file: every route in it touches the days, so every log line in it is one this rule is about.
    const routes = fs.readFileSync(path.join(SRC, "routes/bots/botHealth.ts"), "utf8");
    const logs = [...routes.matchAll(/req\.log\.\w+\(([^)]*)\)/g)].map((m) => m[1]!);
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) expect(l).not.toMatch(/steps|workouts|days:\s*r\.days|body/);
  });

  it("no route takes a coordinate: the area's words are all the server is ever sent", () => {
    for (const f of sources()) {
      if (!f.startsWith("routes/")) continue;
      const text = fs.readFileSync(path.join(SRC, f), "utf8");
      // A body or query field actually called lat / lon / latitude / longitude.
      expect(text, f).not.toMatch(/\bb\.(?:lat|lon|latitude|longitude)\b|["'](?:lat|lon|latitude|longitude)["']\s*:/);
    }
  });
});

// ===================================================================== only the phone's own POST turns it on

const { Bots } = await import("../src/bots/index.js");
const { attachHealth } = await import("../src/bots/healthService.js");
const { MemoryBotStore } = await import("../src/bots/store.js");
const { healthDays, resetHealthDaysForTests } = await import("../src/bots/healthDays.js");

const OWNER = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-11-13T12:00:00Z");
const DAYS = { platform: "ios", tz: "+05:30", days: [{ day: "2026-11-12", steps: 7412, workouts: [{ kind: "strength", minutes: 48 }] }] };

async function freshBots() {
  resetHealthDaysForTests();
  const bots = new Bots({ store: new MemoryBotStore(), now: () => NOW } as never);
  // The same wiring createBots() does: Bots itself can never read a day, so the days are handed to it as two closures.
  const health = attachHealth(bots, () => NOW);
  const { bot } = await bots.create(OWNER, { name: "Gym Buddy", purpose: "counts my gym days" });
  return { bots, health, slug: bot.slug };
}

describe("skills.health is the phone flow's alone", () => {
  it("a new bot is made with it off, whatever the body said", async () => {
    const { bots, health, slug } = await freshBots();
    expect((await bots.get(OWNER, slug)).skills.health).toBe(false);
    const { bot } = await bots.create(OWNER, { name: "Yoga days", purpose: "yoga", skills: { health: true } });
    expect(bot.skills.health).toBe(false);
  });

  it("approve goes through create, so it is off there too", async () => {
    const { bots, health } = await freshBots();
    const { bot } = await bots.approve(OWNER, { approved: true, definition: { name: "Run log", purpose: "runs", skills: { health: true } } });
    expect(bot.skills.health).toBe(false);
  });

  it("an update that tries to turn it on is refused, and says where the switch is", async () => {
    const { bots, health, slug } = await freshBots();
    await expect(bots.update(OWNER, slug, { skills: { health: true } })).rejects.toMatchObject({
      status: 409, message: "Turn this on from the switch in the app.",
    });
  });

  it("the first POST sets it and stores the days in one go", async () => {
    const { bots, health, slug } = await freshBots();
    expect(await health.sync(OWNER, slug, DAYS, { enable: true })).toEqual({ on: true, kept: 1 });
    expect((await bots.get(OWNER, slug)).skills.health).toBe(true);
    const id = (await bots.resolve(OWNER, slug))!.stored!.id;
    expect((await healthDays().list(OWNER, id)).length).toBe(1);
  });

  it("a POST without enable is refused while the switch is off, and taken once it is on", async () => {
    const { bots, health, slug } = await freshBots();
    await expect(health.sync(OWNER, slug, DAYS)).rejects.toMatchObject({ status: 409 });
    await health.sync(OWNER, slug, DAYS, { enable: true });
    expect(await health.sync(OWNER, slug, DAYS)).toEqual({ on: true, kept: 1 });
  });

  it("a bot that is not about fitness cannot be enabled", async () => {
    const { bots, health } = await freshBots();
    const { bot } = await bots.create(OWNER, { name: "Profit tracker", purpose: "my money" });
    await expect(health.sync(OWNER, bot.slug, DAYS, { enable: true })).rejects.toMatchObject({ status: 403 });
  });

  it("a built-in bot cannot be enabled, and someone else's is not said to exist", async () => {
    const { bots, health, slug } = await freshBots();
    await expect(health.sync(OWNER, "plan", DAYS, { enable: true })).rejects.toMatchObject({ status: 403 });
    await expect(health.sync("22222222-2222-4222-8222-222222222222", slug, DAYS, { enable: true })).rejects.toMatchObject({ status: 404 });
  });

  it("switching it off deletes the days in the same request", async () => {
    const { bots, health, slug } = await freshBots();
    await health.sync(OWNER, slug, DAYS, { enable: true });
    const id = (await bots.resolve(OWNER, slug))!.stored!.id;
    await bots.update(OWNER, slug, { skills: { health: false } });
    expect((await bots.get(OWNER, slug)).skills.health).toBe(false);
    expect(await healthDays().list(OWNER, id)).toEqual([]);
  });

  it("linking an app keeps health as it was, and never turns it on", async () => {
    const { bots, health, slug } = await freshBots();
    await health.sync(OWNER, slug, DAYS, { enable: true });
    await bots.update(OWNER, slug, { skills: { web: true } });
    const b = await bots.get(OWNER, slug);
    expect(b.skills.health).toBe(true);
    expect(b.skills.web).toBe(true);
  });

  it("the public card never says anything about health", async () => {
    const { bots, health, slug } = await freshBots();
    await health.sync(OWNER, slug, DAYS, { enable: true });
    await bots.update(OWNER, slug, { publicCard: true });
    const card = await bots.card(slug);
    expect(card && Object.keys(card.skills)).toEqual(["web", "files", "artifacts", "code", "research"]);
  });

  it("the data download holds the days, under the bot they are for", async () => {
    const { bots, health, slug } = await freshBots();
    await health.sync(OWNER, slug, DAYS, { enable: true });
    const out = await bots.exportAll(OWNER);
    expect(out.health).toEqual([{ bot: slug, days: [{ day: "2026-11-12", steps: 7412, workouts: [{ kind: "strength", minutes: 48 }], updatedAt: expect.any(Number) }] }]);
  });

  it("the 31-day sweeper drops what is older and keeps what is not", async () => {
    const { sweepHealthDays, dayKeyBefore } = await import("../src/bots/healthDays.js");
    resetHealthDaysForTests();
    await healthDays().put(OWNER, "b1", [
      { day: dayKeyBefore(NOW, 40), steps: 1, workouts: [] },
      { day: dayKeyBefore(NOW, 2), steps: 2, workouts: [] },
    ]);
    expect(await sweepHealthDays(NOW)).toBe(1);
    expect((await healthDays().list(OWNER, "b1")).map((d) => d.steps)).toEqual([2]);
  });
});

// ===================================================================== the route, with its own gates

const { registerBotHealthRoutes } = await import("../src/routes/bots/botHealth.js");
const { getConfig, resetConfigForTests } = await import("../src/config.js");

const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
/** A key of ours, in the shape bearerKey() knows ("tzb_" and 43 base64url characters). */
const A_KEY = `tzb_${"a".repeat(43)}`;
const PERM = ["PERM_HEALTH_IOS", "PERM_HEALTH_ANDROID", "PERM_HEALTH_IOS_USERS", "PERM_HEALTH_ANDROID_USERS"];
const envSet = (o: Record<string, string>) => { for (const [k, v] of Object.entries(o)) process.env[k] = v; resetConfigForTests?.(); };

async function servedBots() {
  const { bots, health, slug } = await freshBots();
  const app = Fastify({ logger: false });
  registerBotHealthRoutes(app, { rateLimit: RL, bots: bots as never });
  await app.ready();
  const post = (body: unknown, auth = OWNER) =>
    app.inject({ method: "POST", url: `/v1/bots/${slug}/health/days`, headers: { authorization: `Bearer ${auth}` }, payload: body as never });
  return { app, bots, slug, post };
}

describe("the route that stores a fitness bot's days", () => {
  afterEach(() => { for (const k of PERM) delete process.env[k]; resetConfigForTests?.(); });

  it("is off until its own switch is on: nothing is drawn, so nothing is stored", async () => {
    const { app, post } = await servedBots();
    expect(getConfig().PERM_HEALTH_IOS).toBe(false);
    const r = await post({ ...DAYS, enable: true });
    expect([r.statusCode, r.json().code]).toEqual([403, "health_off"]);
    await app.close();
  });

  it("takes the days once the switch is on, and says how many it kept", async () => {
    envSet({ PERM_HEALTH_IOS: "true" });
    const { app, bots, slug, post } = await servedBots();
    const r = await post({ ...DAYS, enable: true });
    expect([r.statusCode, r.json()]).toEqual([200, { on: true, kept: 1 }]);
    expect((await bots.get(OWNER, slug)).skills.health).toBe(true);
    await app.close();
  });

  it("a bot API key is turned away with a 403, not a 401: the key works, this is not for it", async () => {
    envSet({ PERM_HEALTH_IOS: "true" });
    const { app, slug } = await servedBots();
    const r = await app.inject({
      method: "POST", url: `/v1/bots/${slug}/health/days`,
      headers: { authorization: `Bearer ${A_KEY}` }, payload: { ...DAYS, enable: true } as never,
    });
    expect([r.statusCode, r.json().code]).toEqual([403, "not_for_keys"]);
    await app.close();
  });

  it("nobody signed in at all is a 401", async () => {
    envSet({ PERM_HEALTH_IOS: "true" });
    const { app, slug } = await servedBots();
    const r = await app.inject({ method: "POST", url: `/v1/bots/${slug}/health/days`, payload: { ...DAYS, enable: true } as never });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("the Android list is the reviewer's stage: on it the row's days are taken, off it they are not", async () => {
    envSet({ PERM_HEALTH_ANDROID: "true", PERM_HEALTH_ANDROID_USERS: "someone-else" });
    const { app, post } = await servedBots();
    const body = { ...DAYS, platform: "android", enable: true };
    expect((await post(body)).statusCode).toBe(403);
    envSet({ PERM_HEALTH_ANDROID_USERS: OWNER });
    expect((await post(body)).statusCode).toBe(200);
    await app.close();
  });

  it("an iPhone switch does not open the Android door, and the other way round", async () => {
    envSet({ PERM_HEALTH_IOS: "true" });
    const { app, post } = await servedBots();
    expect((await post({ ...DAYS, platform: "android", enable: true })).statusCode).toBe(403);
    await app.close();
  });

  it("an Android phone that says nothing is still Android: the agent decides, not the iPhone switch", async () => {
    // Today's phone sends no `platform`, so if the server read it as iPhone an Android build could come in through
    // PERM_HEALTH_IOS while Health Connect is still off for everyone (docs: perms §4.2).
    envSet({ PERM_HEALTH_IOS: "true" });
    const { app, slug } = await servedBots();
    const android = { authorization: `Bearer ${OWNER}`, "user-agent": "okhttp/4.12.0" };
    const said = { tz: DAYS.tz, days: DAYS.days, enable: true };   // no `platform`, as the phone sends it today
    const r = await app.inject({ method: "POST", url: `/v1/bots/${slug}/health/days`, headers: android, payload: said as never });
    expect([r.statusCode, r.json().code]).toEqual([403, "health_off"]);
    envSet({ PERM_HEALTH_ANDROID: "true" });
    expect((await app.inject({ method: "POST", url: `/v1/bots/${slug}/health/days`, headers: android, payload: said as never })).statusCode).toBe(200);
    await app.close();
  });

  it("a day outside the window, or too many, is a 400 and nothing is stored", async () => {
    envSet({ PERM_HEALTH_IOS: "true" });
    const { app, bots, slug, post } = await servedBots();
    const r = await post({ platform: "ios", tz: "+05:30", enable: true, days: [{ day: "2020-01-01", steps: 10, workouts: [] }] });
    expect(r.statusCode).toBe(400);
    expect((await bots.get(OWNER, slug)).skills.health).toBe(false);
    await app.close();
  });
});

// ===================================================================== Delete my data

describe("Delete my data takes the days and leaves no switch on", () => {
  // It keeps the person's bots, so the days would stay with them: the table is in its list by name, and every bot of
  // theirs has its health switch turned back off, so nothing starts counting again by itself (docs: perms §4.5).
  afterEach(() => { DB.admin = null; });

  it("deletes bot_health_days by name and switches health off on every bot of theirs", async () => {
    const { deleteMyData } = await import("../src/you/data.js");
    const deleted: string[] = [];
    const updated: Array<{ id: string; skills: Record<string, unknown> }> = [];
    const rows = [
      { id: "b1", skills: { web: true, health: true } },
      { id: "b2", skills: { web: false, health: false } },
    ];
    DB.admin = {
      from: (t: string) => ({
        delete: () => ({ eq: async () => { deleted.push(t); return { error: null }; } }),
        select: () => ({ eq: async () => ({ data: rows, error: null }) }),
        update: (patch: { skills: Record<string, unknown> }) => ({
          eq: async (_c: string, id: string) => { updated.push({ id, skills: patch.skills }); return { error: null }; },
        }),
      }),
    };
    const out = await deleteMyData(OWNER, {} as never);
    expect(out.cleared).toContain("bot_health_days");
    expect(deleted).toContain("bot_health_days");
    // Only the bot that had it on is written, and its other skills are kept.
    expect(updated).toEqual([{ id: "b1", skills: { web: true, health: false } }]);
  });
});
