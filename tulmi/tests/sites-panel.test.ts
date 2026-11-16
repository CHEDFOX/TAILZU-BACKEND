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
    await expect(panels.open(U, "https://zomato.com/login")).rejects.toThrow(/can't sign in/i);
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
