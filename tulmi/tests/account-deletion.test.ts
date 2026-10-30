/**
 * DELETE ACCOUNT WITH SEVEN DAYS TO UNDO (src/you/deletion.ts, routes/accountDeletion.ts, screens/accountGrace.ts, screens/you.ts):
 *
 *   - asking sets a date seven days out (asking again keeps it), signs out and stops pings; Keep my account takes it away
 *   - nothing is promised by a server that cannot delete (503)
 *   - the sweep deletes only what is due, never someone who pressed Keep as it started, and tries a failed one again only later
 *   - Delete account shows the seven days and asks by holding; once a date is set it says so, with Keep my account
 *   - Home, signed in during the seven days: the date and Keep my account at the top, and no other ask
 *   - while the date stands the bots stop: the jobs going are stopped as Stop job does, and Keep my account starts them again
 *     (the refusals themselves: bots-keys.test.ts, code-jobs.test.ts, bots-routes.test.ts)
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { Node } from "../../shared/types/sdui.js";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

// Whoever the test says is calling: the token is the user id; none is nobody.
vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id, token: `jwt-${id}` } : null; } };
});

const { MemoryDeletionStore, sweepDeletions, GRACE_MS, CLAIM_STALE_MS, DELETION_PATH, isLeaving, forgetLeaving, LEAVING_TTL_MS, STOPPED_MESSAGE } = await import("../src/you/deletion.js");
const { registerAccountDeletionRoutes } = await import("../src/routes/accountDeletion.js");
const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps, FIXED_NOW, IST, SAMPLE_BOTS } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");

const DAY = 86_400_000;
const texts = (n: Node): string[] => walk(n).filter((x) => x.type === "Text").map((x) => String(x.props?.content));
const json = (n: unknown): string => JSON.stringify(n);
const who = (id: string) => ({ authorization: `Bearer ${id}` });

type Deps = Parameters<typeof registerAccountDeletionRoutes>[1];

function served(o: { erase?: ((id: string) => Promise<boolean>) | null; now?: number; jobs?: Deps["jobs"]; agent?: Deps["agent"] } = {}) {
  const app = Fastify();
  const store = new MemoryDeletionStore();
  const left: string[] = [];
  const t = { now: o.now ?? FIXED_NOW };
  registerAccountDeletionRoutes(app, {
    rateLimit: { rateLimit: { max: 1000, timeWindow: 60_000 } },
    erase: o.erase === undefined ? async () => true : o.erase,
    store, now: () => t.now, sweepEveryMs: null,
    leave: async (u) => { left.push(u.id); },
    ...(o.jobs !== undefined ? { jobs: o.jobs } : {}), ...(o.agent !== undefined ? { agent: o.agent } : {}),
  });
  return { app, store, left, t };
}

/** A person's jobs as the router lists them: two going, one over. Stopping writes down who stopped what, and why. */
function jobsOf(userId: string) {
  const stopped: Array<[string, string, string | undefined]> = [];
  const cancelled: Array<[string, string | undefined]> = [];
  const list = [{ id: "j-running", state: "running" }, { id: "j-done", state: "done" }, { id: "j-waits", state: "waiting_for_you" }];
  const jobs = {
    listJobs: async (u: string) => (u === userId ? list : []),
    cancelJob: async (id: string, reason?: string) => { cancelled.push([id, reason]); return {}; },
  } as unknown as NonNullable<Deps["jobs"]>;
  const agent = { stopJob: async (u: string, id: string, reason?: string) => { stopped.push([u, id, reason]); return {}; } } as unknown as NonNullable<Deps["agent"]>;
  return { jobs, agent, stopped, cancelled };
}

describe("the store and the sweep", () => {
  it("keeps the first date, and claims only what is due and not someone else's", async () => {
    const s = new MemoryDeletionStore();
    expect(await s.schedule("a", 1000, 1000 + GRACE_MS)).toEqual({ requestedAt: 1000, deleteAt: 1000 + GRACE_MS });
    expect(await s.schedule("a", 5000, 5000 + GRACE_MS)).toEqual({ requestedAt: 1000, deleteAt: 1000 + GRACE_MS });
    await s.schedule("b", 2000, 2000 + GRACE_MS);
    expect(await s.claimDue(1000 + GRACE_MS - 1, 10, CLAIM_STALE_MS)).toEqual([]);
    expect(await s.claimDue(1000 + GRACE_MS, 10, CLAIM_STALE_MS)).toEqual(["a"]);
    // Claimed: another pass leaves it alone until the claim goes stale.
    expect(await s.claimDue(2000 + GRACE_MS, 10, CLAIM_STALE_MS)).toEqual(["b"]);
    expect(await s.claimDue(1000 + GRACE_MS + CLAIM_STALE_MS, 10, CLAIM_STALE_MS)).toEqual(["a"]);
    expect(await s.cancel("a")).toBe(true);
    expect(await s.cancel("a")).toBe(false);
    expect(await s.get("a")).toBeNull();
  });

  it("deletes what is due, skips who kept their account, and retries a failed one only later", async () => {
    const s = new MemoryDeletionStore();
    await s.schedule("due", 0, 10);
    await s.schedule("kept", 0, 10);
    await s.schedule("later", 0, 10 * DAY);
    await s.schedule("broken", 0, 10);
    const erased: string[] = [];
    const erase = async (id: string) => {
      erased.push(id);
      if (id === "due") s.drop(id); // the account went, and its row with it
      return id !== "broken";
    };
    // "kept" pressed Keep my account while the pass was starting: claimed, then gone before its turn.
    const claim = s.claimDue.bind(s);
    s.claimDue = async (...a) => { const ids = await claim(...a); await s.cancel("kept"); return ids; };
    expect(await sweepDeletions({ store: s, erase, now: 100 })).toEqual({ deleted: 1, failed: 1 });
    expect(erased.sort()).toEqual(["broken", "due"]);
    expect(await s.get("later")).not.toBeNull();
    s.claimDue = claim;
    // The failed one waits for its claim to go stale.
    expect(await sweepDeletions({ store: s, erase, now: 200 })).toEqual({ deleted: 0, failed: 0 });
    expect(await sweepDeletions({ store: s, erase, now: 100 + CLAIM_STALE_MS })).toEqual({ deleted: 0, failed: 1 });
  });
});

describe("the routes", () => {
  it("need a session, and refuse to promise a deletion that cannot run", async () => {
    const { app } = served({ erase: null });
    expect((await app.inject({ method: "GET", url: DELETION_PATH })).statusCode).toBe(401);
    const r = await app.inject({ method: "POST", url: DELETION_PATH, headers: who("u1"), payload: {} });
    expect(r.statusCode).toBe(503);
    expect(r.json().code).toBe("delete_unavailable");
  });

  it("set the date seven days out (once), sign out everywhere, and Keep takes it away", async () => {
    const { app, left, t } = served();
    expect((await app.inject({ method: "GET", url: DELETION_PATH, headers: who("u1") })).json()).toEqual({ scheduled: null, graceDays: 7, deleteAtIfNow: FIXED_NOW + 7 * DAY });
    const r = await app.inject({ method: "POST", url: DELETION_PATH, headers: who("u1"), payload: {} });
    expect(r.statusCode).toBe(202);
    expect(r.json().scheduled).toEqual({ requestedAt: FIXED_NOW, deleteAt: FIXED_NOW + 7 * DAY });
    expect(left).toEqual(["u1"]);
    t.now += DAY;
    expect((await app.inject({ method: "POST", url: DELETION_PATH, headers: who("u1"), payload: {} })).json().scheduled.deleteAt).toBe(FIXED_NOW + 7 * DAY);
    expect((await app.inject({ method: "GET", url: DELETION_PATH, headers: who("u2") })).json().scheduled).toBeNull();
    expect((await app.inject({ method: "DELETE", url: DELETION_PATH, headers: who("u1") })).json()).toEqual({ ok: true, kept: true });
    expect((await app.inject({ method: "GET", url: DELETION_PATH, headers: who("u1") })).json().scheduled).toBeNull();
  });
});

describe("while the date stands, the bots stop", () => {
  it("reads the date, remembers the answer a moment, and takes a read that fails as no", async () => {
    const s = new MemoryDeletionStore();
    expect(await isLeaving("a", { store: s, now: 1000 })).toBe(false);
    await s.schedule("a", 1000, 1000 + GRACE_MS);
    // Remembered for a moment (every bot run asks); forgotten at once on this server when the date is set or taken away.
    expect(await isLeaving("a", { store: s, now: 2000 })).toBe(false);
    expect(await isLeaving("a", { store: s, now: 1000 + LEAVING_TTL_MS })).toBe(true);
    await s.cancel("a");
    forgetLeaving("a", s);
    expect(await isLeaving("a", { store: s, now: 1000 + LEAVING_TTL_MS + 1 })).toBe(false);
    const down = new MemoryDeletionStore();
    down.get = async () => { throw new Error("store down"); };
    expect(await isLeaving("b", { store: down })).toBe(false);
    expect(await isLeaving("", { store: s })).toBe(false);
  });

  it("asking stops the jobs that are going, as Stop job does, without a word about the account; Keep my account lets them start again", async () => {
    const j = jobsOf("u1");
    const { app, store } = served({ jobs: j.jobs, agent: j.agent });
    expect(await isLeaving("u1", { store })).toBe(false);
    expect((await app.inject({ method: "POST", url: DELETION_PATH, headers: who("u1"), payload: {} })).statusCode).toBe(202);
    expect(j.stopped).toEqual([["u1", "j-running", STOPPED_MESSAGE], ["u1", "j-waits", STOPPED_MESSAGE]]);
    expect(STOPPED_MESSAGE).not.toMatch(/delet|account/i);
    // The "no" remembered just before is forgotten: from now on their bots are stopped.
    expect(await isLeaving("u1", { store })).toBe(true);
    expect(await isLeaving("u2", { store })).toBe(false);
    expect((await app.inject({ method: "DELETE", url: DELETION_PATH, headers: who("u1") })).json()).toEqual({ ok: true, kept: true });
    expect(await isLeaving("u1", { store })).toBe(false);
  });

  it("without the agent, the router cancels them; a job that won't stop does not fail the ask", async () => {
    const j = jobsOf("u1");
    const jobs = { ...j.jobs, cancelJob: async (id: string, reason?: string) => { if (id === "j-running") throw new Error("busy"); j.cancelled.push([id, reason]); return {}; } } as unknown as NonNullable<Deps["jobs"]>;
    const { app } = served({ jobs, agent: null });
    expect((await app.inject({ method: "POST", url: DELETION_PATH, headers: who("u1"), payload: {} })).statusCode).toBe(202);
    expect(j.cancelled).toEqual([["j-waits", STOPPED_MESSAGE]]);
  });
});

// ------------------------------------------------------------------ the screens

const req = (screenId: string, client: "phone" | "desktop", can: string[] = []) => ({
  screenId, client, params: {}, tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya Sharma" },
  can: new Set(["BotsKit", ...can]), desk: { pages: client === "desktop", notes: false },
});
const ACCOUNT = {
  bots: [{ slug: "code", name: "Code bot", colour: "moss", builtin: true }, { slug: "gym-bot", name: "Gym bot", colour: "pine", builtin: false }],
  projects: ["checkout-web", "salon-booking"], notes: 212, keys: 3,
  plan: { active: false, store: null, renews: false, until: null }, exportUrl: null,
};
const NONE = { scheduled: null, graceDays: 7, deleteAtIfNow: FIXED_NOW + 7 * DAY };
const SET = { scheduled: { requestedAt: FIXED_NOW - 2 * DAY, deleteAt: FIXED_NOW + 5 * DAY }, graceDays: 7 };

describe("Delete account", () => {
  it("shows the seven days and asks by holding; signs out only once the date is set", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const s = await buildBotsScreen(req("bots.delete-account", client), fakeDeps({ api: { "GET /v1/you/account": ACCOUNT, [`GET ${DELETION_PATH}`]: NONE } }));
      expect(lintTree(s.root!)).toEqual([]);
      const t = texts(s.root!);
      expect(t).toEqual(expect.arrayContaining(["Gone for good, 4 Nov", "You have 7 days to change your mind. Sign in before 4 Nov and everything comes back as it was.", "stop working right away"]));
      const j = json(s.root);
      expect(j).toContain(`"method":"POST","path":"${DELETION_PATH}"`);
      expect(j).toContain('{"kind":"signOut"}');
      expect(j).not.toContain('"path":"/v1/account"');
      if (client === "phone") expect(walk(s.root!).some((n) => (n.on?.onLongPress as { path?: string } | undefined)?.path === DELETION_PATH)).toBe(true);
      else expect(t).toEqual(expect.arrayContaining(["28 Oct", "1 Nov", "Delete your account on 4 Nov?"]));
    }
  });

  it("once a date is set, says so plainly, with Keep my account", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const s = await buildBotsScreen(req("bots.delete-account", client), fakeDeps({ api: { "GET /v1/you/account": ACCOUNT, [`GET ${DELETION_PATH}`]: SET } }));
      expect(lintTree(s.root!)).toEqual([]);
      expect(texts(s.root!)).toEqual(expect.arrayContaining(["Your account will be deleted on 2 Nov.", "Keep my account", "Gone for good, 2 Nov", "stop working right away"]));
      // The bots stopped the day they asked (isLeaving), and the page says so.
      expect(texts(s.root!).some((x) => x.includes("your bots are stopped") && x.includes("they start again"))).toBe(true);
      const j = json(s.root);
      expect(j).toContain(`"method":"DELETE","path":"${DELETION_PATH}"`);
      expect(j).not.toContain('"kind":"signOut"');
    }
  });
});

describe("Home, signed in during the seven days", () => {
  it("puts the date and Keep my account at the top, and asks for nothing else", async () => {
    for (const client of ["phone", "desktop"] as const) {
      for (const started of [true, false]) {
        const api = { "GET /v1/shell/started": { started }, "GET /v1/bots/first-run/arrival": { due: true }, [`GET ${DELETION_PATH}`]: SET, "GET /v1/bots/push-ask": { due: true } };
        const s = await buildBotsScreen(req("bots.home", client), fakeDeps(started ? { api } : { api, bots: SAMPLE_BOTS.filter((b) => b.builtin), jobs: [], tasks: [] }));
        expect(lintTree(s.root!)).toEqual([]);
        expect(texts(s.root!)).toEqual(expect.arrayContaining(["Your account will be deleted on 2 Nov", "Your bots are stopped. Keep it, and they start again.", "Keep my account", ...(started ? [] : ["Hi Aanya, I'm X0"])]));
        expect(json(s.root)).toContain(`"method":"DELETE","path":"${DELETION_PATH}"`);
        expect(s.state).not.toHaveProperty("permitClosed");
        expect(s.state).not.toHaveProperty("pushGranted");
      }
    }
    const none = await buildBotsScreen(req("bots.home", "phone"), fakeDeps({ api: { "GET /v1/shell/started": { started: true }, [`GET ${DELETION_PATH}`]: NONE } }));
    expect(texts(none.root!).some((x) => x.startsWith("Your account will be deleted"))).toBe(false);
  });
});
