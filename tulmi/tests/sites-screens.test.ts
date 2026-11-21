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
const { readLine, cleanSites, sitesOn, SIGN_IN_AGAIN } = await import("../src/experience/bots/sites.js");
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
    const bad = await app.inject({ method: "POST", url: "/v1/botsapp/bots/sites/watch", headers: as(U), payload: { url: "https://example.com/x", label: "Dinner" } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/v1/botsapp/bots/sites/watch", headers: as(U), payload: { url: "https://swiggy.com/o/1", label: "Behrouz" } });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });

  it("takes a sign-in on the phone as a host name, and a read as words — never a session", async () => {
    const { app, store } = await server();
    const c = await app.inject({ method: "POST", url: "/v1/botsapp/bots/sites/connected", headers: as(U),
      // Anything that looks like a session is simply not read: there is no field for it.
      payload: { site: "swiggy.com", who: "Rahul", cookies: [{ name: "sid", value: "stolen" }], state: { cookies: ["x"] } } });
    expect(c.statusCode).toBe(200);
    expect((await store.login(U, "swiggy.com"))?.profile).toEqual({ cookies: [], onPhone: true });
    expect(c.json().view.logins).toEqual([expect.objectContaining({ site: "swiggy.com", who: "Rahul" })]);

    const w = await app.inject({ method: "POST", url: "/v1/botsapp/bots/sites/watch", headers: as(U), payload: { url: "https://swiggy.com/my-account/orders", label: "Dinner" } });
    const id = (w.json().view.watches as Array<{ id: string }>)[0]!.id;
    const r = await app.inject({ method: "POST", url: `/v1/botsapp/bots/sites/watch/${id}/read`, headers: as(U),
      payload: { url: "https://swiggy.com/my-account/orders", title: "My orders", text: "Out for delivery", elements: [{ id: "e1", role: "link", label: "Track" }] } });
    expect(r.statusCode).toBe(200);
    // No model in this server, so no card — but it was taken as a read, and the watch is still open.
    expect(["read", "failed"]).toContain(r.json().outcome);

    const bad = await app.inject({ method: "POST", url: "/v1/botsapp/bots/sites/connected", headers: as(U), payload: { site: "example.com" } });
    expect(bad.statusCode).toBe(400);
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

// ===================================================================== the panel (screens/sites.ts, sites/panelHost.ts)

/** LiveView is what draws the panel, so a build that has it can sign in and a build that has not cannot. */
const PANEL_CAN = [...PHONE, "LiveView"];
const OPENED = { id: "p1", ticket: "tkt-abcdefgh", site: "swiggy.com", width: 412, height: 915, frame: "AAAA" };

/** The panel screen, with LiveView on or off, and a record of every call its load made. */
async function panel(can: string[], api: Record<string, unknown>, url = "https://swiggy.com/") {
  const calls: string[] = [];
  const spy = new Proxy(api, { get: (t, k: string) => { calls.push(k); return (t as Record<string, unknown>)[k]; }, has: (t, k) => k in t });
  const s = await buildBotsScreen({
    screenId: "bots.site.signin", client: "phone", params: { url }, tzOffsetMinutes: IST, user: { id: U, name: "Rahul" },
    can: new Set(can), desk: { pages: false, notes: false },
  }, fakeDeps({ api: spy }));
  const nodes = walk(s.root!);
  const views = nodes.filter((n) => n.type === "LiveView");
  return {
    s, calls, nodes, views,
    texts: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? "")),
    html: String(views[0]?.props?.html ?? ""),
  };
}

describe("bots.site.signin", () => {
  it("draws the panel as a page in LiveView, lint clean", async () => {
    const d = await panel(PANEL_CAN, { "POST /v1/botsapp/bots/sites/panel": OPENED });
    expect(lintTree(d.s.root!)).toEqual([]);
    expect(d.views).toHaveLength(1);
    // It runs as this API, because its calls are relative: any other origin and they leave for somewhere we do not serve.
    expect(String(d.views[0]!.props?.origin ?? "")).toMatch(/^https:\/\/[^/]+$/);
    expect(d.views[0]!.props?.waitForReady).toBe(true);
  });

  it("THE PAGE CARRIES THE BROWSER'S OWN SIZE, because that is what a tap is scaled back through", async () => {
    const d = await panel(PANEL_CAN, { "POST /v1/botsapp/bots/sites/panel": OPENED });
    expect(d.html).toContain("w: 412");
    expect(d.html).toContain("h: 915");
    // And the first frame, so the panel is not a blank box while its first ask is out.
    expect(d.html).toContain("data:image/jpeg;base64,AAAA");
  });

  it("the ticket is in the page and nowhere else", async () => {
    const d = await panel(PANEL_CAN, { "POST /v1/botsapp/bots/sites/panel": OPENED });
    expect(d.html).toContain("tkt-abcdefgh");
    // And ONLY inside that page. Every node's own props are checked with the page's html taken out: a secret that
    // lives nowhere but the html cannot be read out of a screen's state, a cached tree, or a log of either.
    for (const n of d.nodes) {
      const { html, ...rest } = (n.props ?? {}) as Record<string, unknown>;
      void html;
      expect(JSON.stringify(rest)).not.toContain("tkt-abcdefgh");
      expect(JSON.stringify(n.style ?? {})).not.toContain("tkt-abcdefgh");
      expect(JSON.stringify(n.on ?? {})).not.toContain("tkt-abcdefgh");
    }
  });

  it("THE PANEL SCREEN IS NEVER KEPT ON THE DEVICE", async () => {
    // A screen with a cache time is written to AsyncStorage, and this one carries a live credential. The ticket
    // dies in minutes, but a secret on disk is a secret on disk, and the backup is not ours to reason about.
    const d = await panel(PANEL_CAN, { "POST /v1/botsapp/bots/sites/panel": OPENED });
    expect(d.s.cacheTtlSeconds).toBe(0);
    // The list behind it is kept as it always was: this is about the one page with the secret in it.
    const list = await buildBotsScreen({
      screenId: "bots.sites", client: "phone", params: {}, tzOffsetMinutes: IST, user: { id: U, name: "Rahul" },
      can: new Set(PANEL_CAN), desk: { pages: false, notes: false },
    }, fakeDeps({ api: { "GET /v1/botsapp/bots/sites": VIEW } }));
    expect(list.cacheTtlSeconds).not.toBe(0);
  });

  it("says where they are typing, every time", async () => {
    const d = await panel(PANEL_CAN, { "POST /v1/botsapp/bots/sites/panel": OPENED });
    expect(d.html).toContain("the real site");
    expect(d.html).toContain("never your password");
  });

  it("A BUILD THAT CANNOT DRAW IT OPENS NO BROWSER AT ALL", async () => {
    // The browser is made by this screen's load. Opening one for a phone that could not then show it would hold a
    // real Chrome page in the cloud for nobody, while the person looks at an empty screen.
    const d = await panel(PHONE, { "POST /v1/botsapp/bots/sites/panel": OPENED });
    expect(d.calls).toEqual([]);
    expect(d.views).toHaveLength(0);
    expect(d.texts).toContain("Not on this phone");
    expect(lintTree(d.s.root!)).toEqual([]);
  });

  it("a server that would not open one says so, rather than drawing an empty panel", async () => {
    const d = await panel(PANEL_CAN, {});
    expect(d.views).toHaveLength(0);
    expect(d.texts).toContain("Couldn't start");
    expect(lintTree(d.s.root!)).toEqual([]);
  });

  it("an answer missing its ticket or its size is no panel", async () => {
    // No ticket is no panel: a page that cannot reach its own browser is a picture of a sign-in that does nothing.
    for (const bad of [{ ...OPENED, ticket: "" }, { ...OPENED, width: 0 }, { ...OPENED, height: undefined }, { ...OPENED, id: "" }, { site: "x.com" }]) {
      const d = await panel(PANEL_CAN, { "POST /v1/botsapp/bots/sites/panel": bad });
      expect(d.views).toHaveLength(0);
      expect(d.texts).toContain("Couldn't start");
    }
  });

  it("no url, no browser", async () => {
    const d = await panel(PANEL_CAN, { "POST /v1/botsapp/bots/sites/panel": OPENED }, "");
    expect(d.calls).toEqual([]);
    expect(d.views).toHaveLength(0);
  });
});

describe("bots.sites: the way in to a sign-in", () => {
  const NEEDS = { ...VIEW, logins: [{ site: "swiggy.com", who: "Rahul", usedAt: 1_000_000, needsSignIn: true }] };

  async function drawWith(can: string[], api: Record<string, unknown>) {
    const s = await buildBotsScreen({
      screenId: "bots.sites", client: "phone", params: {}, tzOffsetMinutes: IST, user: { id: U, name: "Rahul" },
      can: new Set(can), desk: { pages: false, notes: false },
    }, fakeDeps({ api }));
    const nodes = walk(s.root!);
    return { s, labels: nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? "")) };
  }

  it("a slip that stopped working offers the sign-in, not Forget", async () => {
    const d = await drawWith(PANEL_CAN, { "GET /v1/botsapp/bots/sites": NEEDS });
    expect(lintTree(d.s.root!)).toEqual([]);
    expect(d.labels).toContain("Sign in");
    expect(d.labels).toContain(SIGN_IN_AGAIN);
  });

  it("a build with no LiveView keeps Forget, because Sign in would open a screen it cannot draw", async () => {
    const d = await drawWith(PHONE, { "GET /v1/botsapp/bots/sites": NEEDS });
    expect(lintTree(d.s.root!)).toEqual([]);
    expect(d.labels).not.toContain("Sign in");
    expect(d.labels).toContain("Forget");
  });

  it("a site is added by searching for it, and only with the panel", async () => {
    const fresh = { ...VIEW, canAdd: ["swiggy.com", "zomato.com"], logins: [{ site: "swiggy.com", who: "Rahul" }] };
    const on = await drawWith(PANEL_CAN, { "GET /v1/botsapp/bots/sites": fresh });
    expect(lintTree(on.s.root!)).toEqual([]);
    expect(on.labels).toContain("Connect a site");
    expect(on.labels).toContain("Connect");
    // A field, not a list of hosts: the name picks the site, and the answer fills the rows.
    const nodes = walk(on.s.root!);
    expect(nodes.some((n) => n.type === "TextField" && (n.bind as { value?: string })?.value === "q")).toBe(true);
    const search = JSON.stringify(nodes.flatMap((n) => Object.values(n.on ?? {})));
    expect(search).toContain("/v1/botsapp/bots/sites/search?q=$state.q");
    expect(search).toContain('"assignTo":"found"');
    // Each row signs in at the page the catalog names for that site, never at a host typed in here.
    expect(search).toContain("$state.found.results.0.signIn");
    expect((on.s as { state?: Record<string, unknown> }).state).toMatchObject({ q: "" });

    const off = await drawWith(PHONE, { "GET /v1/botsapp/bots/sites": fresh });
    expect(off.labels).not.toContain("Connect a site");
  });
});

// ===================================================================== signed in on the phone (SiteView)

describe("signed in on the phone (SiteView)", () => {
  const PHONE_CAN = [...PHONE, "LiveView", "SiteView"];

  it("the sign-in is the site's own page, held on the phone, and opens no browser here", async () => {
    const d = await panel(PHONE_CAN, {}, "https://www.swiggy.com/auth");
    expect(lintTree(d.s.root!)).toEqual([]);
    expect(d.calls.filter((k) => k.startsWith("POST"))).toEqual([]);
    expect(d.views).toHaveLength(0);
    const sv = d.nodes.filter((n) => n.type === "SiteView");
    expect(sv).toHaveLength(1);
    const p = sv[0]!.props as Record<string, unknown>;
    expect(p).toMatchObject({ mode: "signin", url: "https://www.swiggy.com/auth", home: "https://www.swiggy.com/", site: "www.swiggy.com" });
    // The site and the sign-ins it hands off to, and nothing else.
    expect(p.hosts).toEqual(["swiggy.com", "accounts.google.com", "appleid.apple.com"]);
    const scripts = p.scripts as Record<string, string>;
    expect(scripts.shape).toContain("signIn");
    expect(scripts.findLogin).toContain("clicked");
    expect(scripts.read.length).toBeGreaterThan(200);
    // Done is a host name to the server: no cookie, no $event, nothing the page could put in.
    const done = JSON.stringify(sv[0]!.on?.onComplete);
    expect(done).toContain("/v1/botsapp/bots/sites/connected");
    expect(done).toContain('"site":"swiggy.com"');
    expect(done).not.toContain("$event");
  });

  it("an address off the list draws a line, not a browser", async () => {
    const d = await panel(PHONE_CAN, {}, "https://evil.example/login");
    expect(d.nodes.some((n) => n.type === "SiteView")).toBe(false);
    const none = await panel(PHONE_CAN, {}, "javascript:alert(1)");
    expect(none.nodes.some((n) => n.type === "SiteView")).toBe(false);
  });

  const HELD = {
    most: 6, canAdd: ["swiggy.com"],
    logins: [{ site: "swiggy.com", usedAt: 1_000_000, onPhone: true }],
    watches: [
      { id: "w1", site: "swiggy.com", label: "Your orders", state: "open", url: "https://www.swiggy.com/my-account/orders", due: true },
      { id: "w2", site: "swiggy.com", label: "Later", state: "open", url: "https://www.swiggy.com/my-account/orders", due: false },
    ],
  };

  it("a watch whose turn it is gets an unseen reader on the phone, and its read goes to the server whole", async () => {
    const s = await buildBotsScreen({
      screenId: "bots.sites", client: "phone", params: {}, tzOffsetMinutes: IST, user: { id: U, name: "Rahul" },
      can: new Set(PHONE_CAN), desk: { pages: false, notes: false },
    }, fakeDeps({ api: { "GET /v1/botsapp/bots/sites": HELD } }));
    expect(lintTree(s.root!)).toEqual([]);
    const readers = walk(s.root!).filter((n) => n.type === "SiteView");
    expect(readers).toHaveLength(1);
    expect(readers[0]!.props).toMatchObject({ mode: "read", url: "https://www.swiggy.com/my-account/orders", hosts: ["swiggy.com"] });
    expect(readers[0]!.on?.onResult).toMatchObject({ kind: "callEndpoint", method: "POST", path: "/v1/botsapp/bots/sites/watch/w1/read", body: "$event" });
  });

  it("no reader for a site held by the server, or for a build without SiteView", async () => {
    const serverHeld = { ...HELD, logins: [{ site: "swiggy.com", usedAt: 1 }] };
    const a = await buildBotsScreen({
      screenId: "bots.sites", client: "phone", params: {}, tzOffsetMinutes: IST, user: { id: U, name: "Rahul" },
      can: new Set(PHONE_CAN), desk: { pages: false, notes: false },
    }, fakeDeps({ api: { "GET /v1/botsapp/bots/sites": serverHeld } }));
    expect(walk(a.root!).some((n) => n.type === "SiteView")).toBe(false);
    const b = await buildBotsScreen({
      screenId: "bots.sites", client: "phone", params: {}, tzOffsetMinutes: IST, user: { id: U, name: "Rahul" },
      can: new Set([...PHONE, "LiveView"]), desk: { pages: false, notes: false },
    }, fakeDeps({ api: { "GET /v1/botsapp/bots/sites": HELD } }));
    expect(walk(b.root!).some((n) => n.type === "SiteView")).toBe(false);
  });

  it("once signed in on the phone, they are offered to keep an eye on their orders, at the site's own orders page", async () => {
    const s = await buildBotsScreen({
      screenId: "bots.sites", client: "phone", params: {}, tzOffsetMinutes: IST, user: { id: U, name: "Rahul" },
      can: new Set(PHONE_CAN), desk: { pages: false, notes: false },
    }, fakeDeps({ api: { "GET /v1/botsapp/bots/sites": { ...HELD, watches: [] } } }));
    const nodes = walk(s.root!);
    const texts = nodes.filter((n) => n.type === "Text").map((n) => String(n.props?.content ?? ""));
    expect(texts).toContain("Watch orders");
    expect(texts).toContain("Swiggy");
    expect(JSON.stringify(nodes.flatMap((n) => Object.values(n.on ?? {})))).toContain("https://www.swiggy.com/my-account/orders");
  });
});

describe("the routes, on the phone", () => {
  it("a watch on www. finds a sign-in kept under the site's own name", async () => {
    const app = Fastify();
    const sites = new Sites({ store: new SiteStore(null) });
    registerSitesRoutes(app, RL as never, { sites });
    await app.ready();
    const c = await app.inject({ method: "POST", url: "/v1/botsapp/bots/sites/connected", headers: as(U), payload: { site: "www.swiggy.com" } });
    expect(c.statusCode).toBe(200);
    expect(c.json().view.logins).toEqual([expect.objectContaining({ site: "swiggy.com", onPhone: true })]);
    const w = await app.inject({ method: "POST", url: "/v1/botsapp/bots/sites/watch", headers: as(U), payload: { url: "https://www.swiggy.com/my-account/orders", label: "Your orders" } });
    expect(w.statusCode).toBe(200);
    expect(w.json().view.watches[0]).toMatchObject({ site: "swiggy.com", url: "https://www.swiggy.com/my-account/orders", due: true });
    await app.close();
  });
});
