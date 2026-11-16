/**
 * THE SITES SCREEN, ITS ROUTES AND ITS CLOCK (experience/bots/screens/sites.ts, routes/bots/botsSites.ts,
 * sites/clock.ts; docs/sites.md, CLOUD_BROWSER — off by default). Phone and window alike, lint clean.
 *
 * The things worth holding here are the promises a card makes to somebody waiting on a parcel: it says which site it
 * came from and how long ago, the stages are the SITE's words, and no route anywhere can hand this server a login.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

vi.mock("../src/auth/supabase.js", async (orig) => {
  const real = await orig<typeof import("../src/auth/supabase.js")>();
  return { ...real, resolveUser: async (h: string | undefined) => { const id = h?.replace(/^Bearer\s+/i, "").trim(); return id ? { id } : null; } };
});

const { buildBotsScreen } = await import("../src/experience/bots/index.js");
const { fakeDeps } = await import("../src/experience/bots/fixtures.js");
const { lintTree, walk } = await import("../src/experience/bots/lint.js");
const { resetConfigForTests } = await import("../src/config.js");
const { readLine, cleanSites, sitesOn } = await import("../src/experience/bots/sites.js");
const { registerSitesRoutes } = await import("../src/routes/bots/botsSites.js");
const { Sites } = await import("../src/sites/service.js");
const { SiteStore } = await import("../src/sites/store.js");
const { sitesPass } = await import("../src/sites/clock.js");
import type { VisitedPage } from "../src/web/browser/types.js";

const IST = 330;
const U = "aaaaaaaa-0000-4000-8000-000000000001";
const KEY = Buffer.alloc(32, 9).toString("base64");
const PHONE = ["BotsKit", "BotsMotion", "BotMoments", "BotStage", "LiveWords", "VoiceLive", "DoubleTap", "KitExtras", "ActionParams", "AskStream", "BotCall", "PersonBot", "PushButton"];
const DESK = ["BotsKit", "BotsMotion", "BotMoments", "BotStage", "LiveWords", "VoiceLive", "DoubleTap", "KitExtras", "DeskShell", "PersonBot"];
const RL = { rateLimit: { max: 1000, timeWindow: 60_000 } };
const as = (u: string) => ({ authorization: `Bearer ${u}` });

const page = (o: Partial<VisitedPage> = {}): VisitedPage => ({
  finalUrl: "https://swiggy.com/orders/1", title: "Your order", text: "Out for delivery", elements: [],
  state: { cookies: [] }, ...o,
});

const VIEW = {
  most: 6, canAdd: ["swiggy.com"],
  logins: [{ site: "swiggy.com", who: "Rahul", usedAt: 1_000_000 }],
  watches: [{
    id: "w1", site: "swiggy.com", label: "Behrouz", state: "open", readAt: 1_000_000,
    card: {
      title: "Behrouz Biryani", line: "Out for delivery, arriving by 9:42 pm",
      stages: [{ name: "Order placed", when: "8:51 pm", done: true }, { name: "Food ready", done: true }, { name: "On the way", done: false }],
      detail: "Rahul is 1.2 km away",
    },
  }],
};

beforeEach(() => {
  vi.stubEnv("CLOUD_BROWSER", "true");
  vi.stubEnv("CLOUD_BROWSER_SITES", "swiggy.com");
  vi.stubEnv("CONNECTOR_TOKEN_KEY", KEY);
  resetConfigForTests();
});
afterEach(() => { vi.unstubAllEnvs(); resetConfigForTests(); });

async function draw(client: "phone" | "desktop", api: Record<string, unknown>) {
  const s = await buildBotsScreen({
    screenId: "bots.sites", client, params: {}, tzOffsetMinutes: IST, user: { id: U, name: "Rahul" },
    can: new Set(client === "phone" ? PHONE : DESK), desk: { pages: client === "desktop", notes: false },
  }, fakeDeps({ api }));
  const nodes = walk(s.root!);
  return { s, texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? "")) };
}

describe("bots.sites", () => {
  it("draws the card with the site's own words, lint clean, on the phone and in the window", async () => {
    for (const client of ["phone", "desktop"] as const) {
      const d = await draw(client, { "GET /v1/botsapp/bots/sites": VIEW });
      expect(lintTree(d.s.root!)).toEqual([]);
      expect(d.texts).toEqual(expect.arrayContaining(["Behrouz Biryani", "Out for delivery, arriving by 9:42 pm", "Rahul is 1.2 km away"]));
      // The stages are the site's, drawn as it named them.
      expect(d.texts).toEqual(expect.arrayContaining(["Order placed", "Food ready", "On the way"]));
      // And every card says where it came from.
      expect(d.texts.some((t) => t.startsWith("from swiggy.com"))).toBe(true);
    }
  });

  it("with the switch off it draws the not-switched-on page rather than failing", async () => {
    vi.stubEnv("CLOUD_BROWSER", "false");
    resetConfigForTests();
    const d = await draw("phone", {});
    expect(lintTree(d.s.root!)).toEqual([]);
    expect(d.texts).toContain("Not switched on");
  });

  it("nothing being watched is a plain empty state, not a broken one", async () => {
    const d = await draw("phone", { "GET /v1/botsapp/bots/sites": { ...VIEW, watches: [] } });
    expect(lintTree(d.s.root!)).toEqual([]);
    expect(d.texts).toContain("Nothing to keep an eye on right now.");
  });
});

describe("how fresh a card is", () => {
  it("says it in words a person reads, so a stale card never looks live", () => {
    const now = 1_000_000_000;
    expect(readLine("swiggy.com", now - 10_000, now)).toBe("from swiggy.com · checked just now");
    expect(readLine("swiggy.com", now - 4 * 60_000, now)).toBe("from swiggy.com · checked 4 min ago");
    expect(readLine("swiggy.com", now - 3 * 3_600_000, now)).toBe("from swiggy.com · checked 3 hours ago");
    expect(readLine("swiggy.com", now - 26 * 3_600_000, now)).toBe("from swiggy.com · checked yesterday");
    expect(readLine("swiggy.com", undefined, now)).toBe("from swiggy.com");
  });

  it("the switch decides whether the screen reads anything at all", () => {
    expect(sitesOn(U)).toBe(true);
    vi.stubEnv("CLOUD_BROWSER_USERS", "someone-else");
    resetConfigForTests();
    expect(sitesOn(U)).toBe(false);
  });

  it("keeps only the shape the screens draw, whatever a site put in it", () => {
    const v = cleanSites({ watches: [{ id: "w", site: "s", label: "l", state: "nonsense", card: { title: "t", line: "x", stages: [{ name: "", done: true }, { name: "Shipped", done: false }] } }] });
    expect(v.watches[0]?.state).toBe("open");
    expect(v.watches[0]?.card?.stages).toEqual([{ name: "Shipped", done: false }]);
    expect(cleanSites({}).watches).toEqual([]);
  });
});

describe("the routes", () => {
  async function server() {
    const app = Fastify();
    const store = new SiteStore(null);
    const sites = new Sites({ visit: async () => page(), store, now: () => 1_000_000 });
    registerSitesRoutes(app, RL as never, { sites });
    await app.ready();
    return { app, sites, store };
  }

  it("answer 404 for everyone while the switch is off", async () => {
    vi.stubEnv("CLOUD_BROWSER", "false");
    resetConfigForTests();
    const { app } = await server();
    const r = await app.inject({ method: "GET", url: "/v1/botsapp/bots/sites", headers: as(U) });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("refuse a site that is not on the server's list", async () => {
    const { app, sites } = await server();
    await sites.signIn(U, "swiggy.com", { cookies: [] });
    const bad = await app.inject({ method: "POST", url: "/v1/botsapp/bots/sites/watch", headers: as(U), payload: { url: "https://zomato.com/x", label: "Dinner" } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/v1/botsapp/bots/sites/watch", headers: as(U), payload: { url: "https://swiggy.com/o/1", label: "Behrouz" } });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });

  it("THERE IS NO ROUTE THAT HANDS THIS SERVER A LOGIN", async () => {
    const { app } = await server();
    // A session is only ever made by the person signing in themselves. Any route that took one as JSON would be the
    // whole security of this feature, written away in one parameter — so none exists, and these all miss.
    for (const url of ["/v1/botsapp/bots/sites", "/v1/botsapp/bots/sites/signin", "/v1/botsapp/bots/sites/session", "/v1/botsapp/bots/sites/login"]) {
      const r = await app.inject({ method: "POST", url, headers: as(U), payload: { site: "swiggy.com", cookies: [{ name: "sid", value: "stolen" }] } });
      expect(r.statusCode, url).toBe(404);
    }
    await app.close();
  });

  it("one person's watch is not another's to stop", async () => {
    const { app, sites } = await server();
    await sites.signIn(U, "swiggy.com", { cookies: [] });
    const made = await sites.watch(U, "https://swiggy.com/o/1", "Behrouz");
    const other = "bbbbbbbb-0000-4000-8000-000000000002";
    const r = await app.inject({ method: "DELETE", url: `/v1/botsapp/bots/sites/watch/${made.id}`, headers: as(other) });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("the clock", () => {
  it("looks at what is due, and at nothing while the switch is off", async () => {
    const store = new SiteStore(null);
    let at = 1_000_000;
    const sites = new Sites({ visit: async () => page(), store, now: () => at });
    await sites.signIn(U, "swiggy.com", { cookies: [] });
    await sites.watch(U, "https://swiggy.com/o/1", "Behrouz");
    expect(await sitesPass({ sites })).toBe(1);
    // Looked at, so not due again until the floor has passed.
    expect(await sitesPass({ sites })).toBe(0);
    vi.stubEnv("CLOUD_BROWSER", "false");
    resetConfigForTests();
    at += 60 * 60_000;
    expect(await sitesPass({ sites })).toBe(0);
  });

  it("takes small bites, so a restart with many open things is a trickle and not a stampede", async () => {
    const store = new SiteStore(null);
    const sites = new Sites({ visit: async () => page(), store, now: () => 1_000_000 });
    await sites.signIn(U, "swiggy.com", { cookies: [] });
    vi.stubEnv("CLOUD_BROWSER_WATCHES", "20");
    resetConfigForTests();
    for (let i = 0; i < 8; i++) await sites.watch(U, `https://swiggy.com/o/${i}`, `Thing ${i}`);
    expect(await sitesPass({ sites, most: 3 })).toBe(3);
  });
});
