/**
 * THE PANEL'S TIMINGS (sites/frames.ts, docs/sites.md §panel).
 *
 * The point of these: a panel costs a person's data and their patience, and both are spent by sending pictures they
 * did not need. Nothing here runs on a clock — frames are pushed by the page and gated, and the panel ends on a
 * signal. These hold that, exactly, with no browser anywhere near them.
 */
import { describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
// The config is re-parsed whenever a test resets it, and a parse needs these: without them getConfig() throws,
// encrypt() throws under it, and a swallowed save looks exactly like a panel that did not keep the session.
process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.DEV_SKIP_AUTH = "true";

const { BUSY_FPS, FrameGate, IDLE_END_MS, PanelLife, QUIET_FPS, END_WORDS } = await import("../src/sites/frames.js");

describe("how often a frame goes", () => {
  it("sends the first at once: a panel that opens to nothing looks broken", () => {
    const g = new FrameGate();
    expect(g.frame(1000)).toBe(true);
  });

  it("holds a page that will not settle to the quiet rate, however fast it changes", () => {
    const g = new FrameGate();
    expect(g.frame(0)).toBe(true);
    // A spinner firing every 16 ms is 62 chances in a second. The cap is what the person's data actually pays for.
    let offered = 0, sent = 0;
    for (let t = 16; t <= 1000; t += 16) { offered += 1; if (g.frame(t)) sent += 1; }
    expect(offered).toBeGreaterThan(60);
    expect(sent).toBeLessThanOrEqual(QUIET_FPS);
    expect(sent).toBeGreaterThan(0);
  });

  it("lifts the cap right after they touch something, because that is when they are watching", () => {
    const g = new FrameGate();
    g.frame(0);
    // Quiet: the next is not due yet.
    expect(g.frame(100)).toBe(false);
    g.touched(100);
    // Busy: 12 a second, so 84 ms is enough.
    expect(g.frame(100 + Math.ceil(1000 / BUSY_FPS))).toBe(true);
  });

  it("falls back to quiet once the moment has passed", () => {
    const g = new FrameGate({ busyMs: 500 });
    g.frame(0);
    g.touched(0);
    // Busy: 83 ms is enough.
    expect(g.frame(100)).toBe(true);
    // Past the busy window, the quiet gap applies again: 100 ms after the last one is too soon.
    expect(g.frame(700)).toBe(true); // 600 ms since the last: due either way
    expect(g.frame(800)).toBe(false); // 100 ms since the last, and no longer busy
    expect(g.frame(700 + 1000 / QUIET_FPS)).toBe(true);
  });

  it("keeps the newest and drops the rest: an old frame is not worth sending late", () => {
    const g = new FrameGate();
    g.frame(0);
    // Three arrive inside one gap; none of the first two goes, and the one that does is the latest moment.
    expect(g.frame(50)).toBe(false);
    expect(g.frame(100)).toBe(false);
    const at = 1000 / QUIET_FPS;
    expect(g.frame(at)).toBe(true);
  });
});

describe("when the panel is over", () => {
  it("ends the moment they are signed in, whatever the clocks say", () => {
    const l = new PanelLife(0);
    expect(l.over(1000, false)).toBeNull();
    expect(l.over(1000, true)).toBe("signed_in");
  });

  it("closes on somebody who walked away, and says so kindly", () => {
    const l = new PanelLife(0);
    expect(l.over(IDLE_END_MS - 1, false)).toBeNull();
    expect(l.over(IDLE_END_MS, false)).toBe("left");
    expect(END_WORDS.left).toContain("nothing happened");
  });

  it("anything at all keeps it alive: a frame from the page counts as much as a tap", () => {
    const l = new PanelLife(0);
    l.alive(IDLE_END_MS - 1);
    expect(l.over(IDLE_END_MS, false)).toBeNull();
    expect(l.over(IDLE_END_MS * 2 - 1, false)).toBe("left");
  });

  it("has a ceiling, as a backstop and not as the mechanism", () => {
    const l = new PanelLife(0, { hardMs: 10_000 });
    // Busy the whole time, so idle never fires: the ceiling is what ends it.
    for (let t = 0; t < 10_000; t += 1000) l.alive(t);
    expect(l.over(9_999, false)).toBeNull();
    expect(l.over(10_000, false)).toBe("too_long");
  });

  it("every ending has words for the person", () => {
    for (const k of ["signed_in", "said_done", "cancelled", "left", "too_long"] as const) {
      expect(END_WORDS[k].length).toBeGreaterThan(3);
    }
  });
});

// ===================================================================== the panel itself

const { Panels } = await import("../src/sites/panel.js");
const { SiteStore } = await import("../src/sites/store.js");
const { resetConfigForTests } = await import("../src/config.js");
import type { HeldPage } from "../src/web/browser/types.js";

const U = "aaaaaaaa-0000-4000-8000-000000000001";

/** A held page, faked: it records what was done to it and can be told what the page looks like. */
function fakePage(o: { signedIn?: boolean } = {}) {
  const did: string[] = [];
  let send: ((j: string, m: { width: number; height: number }) => void) | null = null;
  const forgot: string[] = [];
  let closed = false;
  const page: HeldPage = {
    onFrame(cb) { send = cb; },
    async tap(x, y) { did.push(`tap ${x},${y}`); },
    async type(t) { did.push(`type ${t}`); },
    async key(k) { did.push(`key ${k}`); },
    async scroll(d) { did.push(`scroll ${d}`); },
    async look() {
      return o.signedIn
        ? { finalUrl: "https://swiggy.com/account", title: "Your account", elements: [] }
        : { finalUrl: "https://swiggy.com/login", title: "Sign in", elements: [{ id: "e1", role: "secret" }] };
    },
    async state() { return { cookies: [{ name: "sid", value: "kept" }] }; },
    async forgetHost(h) { forgot.push(h); },
    async close() { closed = true; },
  };
  return { page, did, forgot, sent: () => send, isClosed: () => closed, setIn: (v: boolean) => { o.signedIn = v; } };
}

describe("the panel", () => {
  const envOn = () => {
    vi.stubEnv("CLOUD_BROWSER", "true");
    vi.stubEnv("CLOUD_BROWSER_SITES", "swiggy.com");
    vi.stubEnv("CONNECTOR_TOKEN_KEY", Buffer.alloc(32, 3).toString("base64"));
    resetConfigForTests();
  };

  it("opens only on a site the server allows", async () => {
    envOn();
    const f = fakePage();
    const panels = new Panels({ hold: async () => f.page, store: new SiteStore(null) });
    // On neither list: not a catalog entry (src/sites/catalog.ts) and not this server's CLOUD_BROWSER_SITES.
    await expect(panels.open(U, "https://example.com/login")).rejects.toThrow(/can't sign in/i);
    const v = await panels.open(U, "https://swiggy.com/login");
    expect(v.site).toBe("swiggy.com");
    vi.unstubAllEnvs(); resetConfigForTests();
  });

  it("pins the page to the shop and the social hosts, and nothing else", async () => {
    envOn();
    let allow: RegExp[] = [];
    const f = fakePage();
    const panels = new Panels({ hold: async (o) => { allow = o.allow ?? []; return f.page; }, store: new SiteStore(null) });
    await panels.open(U, "https://swiggy.com/login");
    const ok = (u: string) => allow.some((re) => re.test(u));
    expect(ok("https://swiggy.com/login")).toBe(true);
    expect(ok("https://www.swiggy.com/x")).toBe(true);
    expect(ok("https://accounts.google.com/o/oauth2/auth")).toBe(true);
    // The two that matter: nowhere else, and not a lookalike.
    expect(ok("https://evil.example/login")).toBe(false);
    expect(ok("https://swiggy.com.evil.net/login")).toBe(false);
    vi.unstubAllEnvs(); resetConfigForTests();
  });

  it("passes a touch through as a real event, and nothing else is passed through at all", async () => {
    envOn();
    const f = fakePage();
    const panels = new Panels({ hold: async () => f.page, store: new SiteStore(null) });
    const v = await panels.open(U, "https://swiggy.com/login");
    await panels.touch(v.id, U, { tap: { x: 10, y: 20 } });
    await panels.touch(v.id, U, { type: "98765" });
    await panels.touch(v.id, U, { key: "Enter" });
    expect(f.did).toEqual(["tap 10,20", "type 98765", "key Enter"]);
    vi.unstubAllEnvs(); resetConfigForTests();
  });

  it("will not believe \"I'm signed in\" while the page is still the sign-in page", async () => {
    envOn();
    const f = fakePage({ signedIn: false });
    const store = new SiteStore(null);
    const panels = new Panels({ hold: async () => f.page, store });
    const v = await panels.open(U, "https://swiggy.com/login");
    const no = await panels.done(v.id, U);
    // Closing here would save a signed-OUT session over a good one, which is the mistake the watcher made once.
    expect(no.signedIn).toBe(false);
    expect(await store.login(U, "swiggy.com")).toBeNull();
    expect(f.isClosed()).toBe(false);
    vi.unstubAllEnvs(); resetConfigForTests();
  });

  it("THROWS GOOGLE AWAY AND KEEPS THE SHOP once they really are in", async () => {
    envOn();
    const f = fakePage({ signedIn: true });
    const store = new SiteStore(null);
    const panels = new Panels({ hold: async () => f.page, store });
    const v = await panels.open(U, "https://swiggy.com/login");
    const yes = await panels.done(v.id, U);
    expect(yes.signedIn).toBe(true);
    // The handshake needed Google; the session does not. Gone before the state is even read.
    expect(f.forgot).toContain("accounts.google.com");
    expect(f.forgot).toContain("appleid.apple.com");
    const login = await store.login(U, "swiggy.com");
    expect(login?.profile.cookies).toEqual([{ name: "sid", value: "kept" }]);
    expect(f.isClosed()).toBe(true);
    vi.unstubAllEnvs(); resetConfigForTests();
  });

  it("is one a person: opening a second shuts the first, so two never hold two of the browser's places", async () => {
    envOn();
    const a = fakePage(); const b = fakePage();
    let next = a;
    const panels = new Panels({ hold: async () => next.page, store: new SiteStore(null) });
    await panels.open(U, "https://swiggy.com/login");
    next = b;
    await panels.open(U, "https://swiggy.com/login");
    expect(a.isClosed()).toBe(true);
    expect(panels.openCount).toBe(1);
    vi.unstubAllEnvs(); resetConfigForTests();
  });

  it("closes a panel nobody came back to, and says so kindly", async () => {
    envOn();
    const f = fakePage();
    let at = 1_000_000;
    const panels = new Panels({ hold: async () => f.page, store: new SiteStore(null), now: () => at });
    const v = await panels.open(U, "https://swiggy.com/login");
    at += 90_000;
    const gone = await panels.poll(v.id, U);
    expect(gone.ended).toBe("left");
    expect(gone.message).toContain("nothing happened");
    expect(f.isClosed()).toBe(true);
    vi.unstubAllEnvs(); resetConfigForTests();
  });

  it("is nobody else's to touch", async () => {
    envOn();
    const f = fakePage();
    const panels = new Panels({ hold: async () => f.page, store: new SiteStore(null) });
    const v = await panels.open(U, "https://swiggy.com/login");
    await expect(panels.touch(v.id, "bbbbbbbb-0000-4000-8000-000000000002", { tap: { x: 1, y: 1 } })).rejects.toThrow(/isn't open/i);
    vi.unstubAllEnvs(); resetConfigForTests();
  });
});

// ===================================================================== the ticket, and the page it is written into

const { registerSitesRoutes: regRoutes } = await import("../src/routes/bots/botsSites.js");
const { Sites: SitesSvc } = await import("../src/sites/service.js");
const { panelPage, PANEL_PAGE_CLOCK } = await import("../src/sites/panelHost.js");
const { createHash } = await import("node:crypto");
const Fast = (await import("fastify")).default;

const OTHER = "bbbbbbbb-0000-4000-8000-000000000002";
const RL2 = { rateLimit: { max: 1000, timeWindow: 60_000 } };

/**
 * THE TICKET IS THE WHOLE OF THE PAGE'S AUTHORITY, so these are the tests that matter: what it reaches, what a
 * wrong one gets, and that it stops working the moment the panel does.
 */
describe("the panel's ticket", () => {
  const envOn = () => {
    vi.stubEnv("CLOUD_BROWSER", "true");
    vi.stubEnv("CLOUD_BROWSER_SITES", "swiggy.com");
    vi.stubEnv("CONNECTOR_TOKEN_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("DEV_SKIP_AUTH", "true");
    resetConfigForTests();
  };

  async function server(signedIn = false) {
    envOn();
    const f = fakePage({ signedIn });
    const store = new SiteStore(null);
    const panels = new Panels({ hold: async () => f.page, store });
    const app = Fast();
    regRoutes(app, RL2 as never, {
      sites: new SitesSvc({ visit: async () => ({ finalUrl: "https://swiggy.com/", title: "", text: "", elements: [], state: { cookies: [] } }), store }),
      panels,
    });
    await app.ready();
    const open = await app.inject({
      method: "POST", url: "/v1/botsapp/bots/sites/panel",
      headers: { authorization: `Bearer ${U}` }, payload: { url: "https://swiggy.com/login" },
    });
    return { app, f, panels, store, opened: open.json() as { id: string; ticket: string } };
  }

  it("is handed out once, on the one call that makes the panel", async () => {
    const { app, opened } = await server();
    expect(typeof opened.ticket).toBe("string");
    expect(opened.ticket.length).toBeGreaterThan(30);
    // Every other answer leaves it out, including the one that reports on the same panel.
    const look = await app.inject({ method: "GET", url: `/v1/botsapp/bots/sites/panel/${opened.id}`, headers: { authorization: `Bearer ${U}` } });
    expect(look.json()).not.toHaveProperty("ticket");
    await app.close();
  });

  it("the page can drive its own panel with it, and no bearer at all", async () => {
    const { app, f, opened } = await server();
    const t = `/v1/botsapp/bots/sites/panel/t/${opened.ticket}`;
    const tap = await app.inject({ method: "POST", url: `${t}/touch`, payload: { tap: { x: 10, y: 20 } } });
    expect(tap.statusCode).toBe(200);
    expect(f.did).toContain("tap 10,20");
    const look = await app.inject({ method: "GET", url: t });
    expect(look.statusCode).toBe(200);
    await app.close();
  });

  it("A WRONG TICKET GETS THE SAME ANSWER AS A CLOSED ONE, and reaches nothing", async () => {
    const { app, f, opened } = await server();
    for (const bad of ["", "nope", opened.ticket.slice(0, -1), `${opened.ticket}x`, opened.id]) {
      const r = await app.inject({ method: "POST", url: `/v1/botsapp/bots/sites/panel/t/${bad}/touch`, payload: { tap: { x: 1, y: 1 } } });
      expect(r.statusCode).toBe(404);
    }
    expect(f.did).toEqual([]);
    await app.close();
  });

  it("it dies with the panel", async () => {
    const { app, opened } = await server();
    const t = `/v1/botsapp/bots/sites/panel/t/${opened.ticket}`;
    expect((await app.inject({ method: "DELETE", url: t })).statusCode).toBe(200);
    // The panel is shut, so the secret that reached it is worth nothing at all.
    expect((await app.inject({ method: "GET", url: t })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `${t}/touch`, payload: { key: "Enter" } })).statusCode).toBe(404);
    await app.close();
  });

  it("it is one panel, not one person: it cannot reach another panel of theirs", async () => {
    const { app, panels, opened } = await server();
    // A second panel for the same person (ONE_EACH shuts the first, which is the point: the old ticket is dead).
    const again = await app.inject({
      method: "POST", url: "/v1/botsapp/bots/sites/panel",
      headers: { authorization: `Bearer ${U}` }, payload: { url: "https://swiggy.com/login" },
    });
    const two = again.json() as { id: string; ticket: string };
    expect(two.ticket).not.toBe(opened.ticket);
    expect(panels.idForTicket(opened.ticket)).toBe(null);
    expect(panels.idForTicket(two.ticket)).toBe(two.id);
    await app.close();
  });

  it("it carries no touch the bearer route would not take either", async () => {
    const { app, f, opened } = await server();
    const t = `/v1/botsapp/bots/sites/panel/t/${opened.ticket}`;
    for (const bad of [{}, { key: "Escape" }, { tap: { x: -1, y: 5 } }, { type: "" }, { scroll: "down" }]) {
      expect((await app.inject({ method: "POST", url: `${t}/touch`, payload: bad })).statusCode).toBe(400);
    }
    expect(f.did).toEqual([]);
    // And the two it does take are held to the same limits.
    await app.inject({ method: "POST", url: `${t}/touch`, payload: { type: "x".repeat(500) } });
    await app.inject({ method: "POST", url: `${t}/touch`, payload: { scroll: 99_999 } });
    expect(f.did).toEqual([`type ${"x".repeat(200)}`, "scroll 2000"]);
    await app.close();
  });

  it("it is still the owner's call: a held account is refused, ticket or not", async () => {
    const { app, opened } = await server();
    const t = `/v1/botsapp/bots/sites/panel/t/${opened.ticket}`;
    vi.stubEnv("CLOUD_BROWSER_USERS", OTHER);   // the owner is no longer allowed
    resetConfigForTests();
    expect((await app.inject({ method: "GET", url: t })).statusCode).toBe(404);
    await app.close();
  });
});

describe("the page the panel is drawn in", () => {
  const made = () => panelPage({
    id: "p1", ticket: "TICKET-VALUE", site: "swiggy.com", width: 412, height: 915, frame: "AAAA",
    origin: "https://api.x0bot.com",
  });

  it("may talk to this API and nothing else, and run only its own script", async () => {
    const { html } = made();
    expect(html).toContain("connect-src https://api.x0bot.com");
    expect(html).toContain("default-src &#39;none&#39;");
    // Named by hash, so the policy is the hash of what actually runs: a changed script is a refused script.
    const hash = /script-src &#39;sha256-([A-Za-z0-9+/=]+)&#39;/.exec(html)?.[1];
    expect(hash).toBeTruthy();
    const body = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? "";
    expect(createHash("sha256").update(body, "utf8").digest("base64")).toBe(hash);
    // No frame, no form, no base to be moved to, and pictures only as data.
    expect(html).toContain("frame-src &#39;none&#39;");
    expect(html).toContain("form-action &#39;none&#39;");
    expect(html).toContain("base-uri &#39;none&#39;");
    expect(html).toContain("img-src data:");
  });

  it("carries the browser's own size, because that is what a tap is scaled back through", () => {
    const { html } = made();
    expect(html).toContain("w: 412");
    expect(html).toContain("h: 915");
    expect(html).toContain("page.w - 1");
    expect(html).toContain("page.h - 1");
  });

  it("THE BOX IS EMPTIED BEFORE THE CALL GOES OUT, never after", () => {
    // A box that still holds a password while a request is in flight is a box that can be read off the screen, or
    // out of a crash. The order of these two lines is the whole promise.
    const body = /<script>([\s\S]*)<\/script>/.exec(made().html)?.[1] ?? "";
    const cleared = body.indexOf("box.value = \"\";");
    const sent = body.indexOf("touch({ type: t })");
    expect(cleared).toBeGreaterThan(-1);
    expect(sent).toBeGreaterThan(cleared);
  });

  it("the box helps with nothing: no autofill, no correction, no capitals", () => {
    const { html } = made();
    for (const off of ['autocomplete="off"', 'autocorrect="off"', 'autocapitalize="off"', 'spellcheck="false"']) {
      expect(html).toContain(off);
    }
  });

  it("says which site, escaped, so a host can never be markup", () => {
    const { html } = panelPage({ id: "p", ticket: "t", site: '"><script>bad()</script>', width: 1, height: 1, origin: "https://api.x0bot.com" });
    expect(html).not.toContain("<script>bad()");
    expect(html).toContain("&lt;script&gt;bad()");
  });

  it("holds its clock to the server's own, because asking faster buys nothing", () => {
    const { html } = made();
    expect(html).toContain(`QUIET = ${PANEL_PAGE_CLOCK.QUIET_MS}`);
    expect(html).toContain(`BUSY = ${PANEL_PAGE_CLOCK.BUSY_MS}`);
  });

  it("draws the first frame it was given, and nothing when there is none", () => {
    expect(made().html).toContain('src="data:image/jpeg;base64,AAAA"');
    const none = panelPage({ id: "p", ticket: "t", site: "a.com", width: 1, height: 1, origin: "https://api.x0bot.com" });
    expect(none.html).toContain('<img id="f" alt="a.com">');
  });
});
