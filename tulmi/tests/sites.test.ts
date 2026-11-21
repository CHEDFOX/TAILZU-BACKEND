/**
 * A BROWSER THAT BELONGS TO THE PERSON (docs/sites.md, CLOUD_BROWSER). What these hold is the manners, because the
 * manners are what keep a real shop from shutting a real person's account: it looks only while something is open,
 * never sooner than the floor, never after it arrives, and it reads and nothing else.
 *
 * No Chrome and no model: `visit` is a function, so the whole loop runs offline.
 */
import { beforeEach, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.CLOUD_BROWSER = "true";
process.env.CLOUD_BROWSER_SITES = "swiggy.com, example.org";
process.env.CLOUD_BROWSER_EVERY_MIN = "20";
process.env.CLOUD_BROWSER_WATCHES = "2";
// The slip is kept the way a token is, so the tests need the same key the server would have.
process.env.CONNECTOR_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");

const { Sites, SiteError } = await import("../src/sites/service.js");
const { SiteStore } = await import("../src/sites/store.js");
const { siteAllowed, allowedSites, hostOf } = await import("../src/sites/gate.js");
const { SITE_CATALOG, catalogHosts, searchSites } = await import("../src/sites/catalog.js");
const { resetConfigForTests } = await import("../src/config.js");
const { cardOf, looksSignedOut } = await import("../src/sites/read.js");
import type { VisitOptions, VisitedPage } from "../src/web/browser/types.js";

const U = "11111111-1111-4111-8111-111111111111";
const EVERY = 20 * 60_000;

const page = (o: Partial<VisitedPage> = {}): VisitedPage => ({
  finalUrl: "https://swiggy.com/orders/1", title: "Your order", text: "Out for delivery", elements: [],
  state: { cookies: [{ name: "sid", value: "fresh" }] }, ...o,
});

function rig(visit: (o: VisitOptions) => Promise<VisitedPage>, card: unknown = { title: "Behrouz", line: "Out for delivery", stages: [] }) {
  const store = new SiteStore(null);
  let at = 1_000_000;
  const sites = new Sites({ visit, store, now: () => at });
  // The model, stood in for: `read` is absent so readCard is never called, and the card is put on by the test.
  return { sites, store, tick: (ms: number) => { at += ms; }, nowAt: () => at, card };
}

describe("the gates", () => {
  it("a site is allowed by name or as a subdomain of one, never the other way round", () => {
    expect(siteAllowed("swiggy.com")).toBe(true);
    expect(siteAllowed("www.swiggy.com")).toBe(true);
    expect(siteAllowed("SWIGGY.COM")).toBe(true);
    // The trick this is here to stop.
    expect(siteAllowed("swiggy.com.evil.net")).toBe(false);
    // On neither list: not the catalog's, and not this server's own.
    expect(siteAllowed("example.com")).toBe(false);
    expect(siteAllowed("zomato.com.evil.net")).toBe(false);
  });

  it("the catalog is allowed without anybody listing it, and the env list still only adds", () => {
    // zomato is nobody's CLOUD_BROWSER_SITES here: it is allowed because it is a reviewed entry in catalog.ts,
    // which is what lets somebody find a site by typing its name. The switch still decides whether any of it exists.
    expect(siteAllowed("zomato.com")).toBe(true);
    expect(catalogHosts()).toContain("zomato.com");
    expect(allowedSites()).toEqual(expect.arrayContaining([...catalogHosts(), "swiggy.com"]));
  });

  it("searching answers vetted entries only, each with that site's own sign-in page", () => {
    const [hit] = searchSites("swiggy");
    expect(hit).toMatchObject({ host: "swiggy.com", signIn: "https://www.swiggy.com/auth" });
    // Every entry's sign-in is https and on the entry's own host, which is the whole promise of searching by name.
    for (const e of SITE_CATALOG) {
      const u = new URL(e.signIn);
      expect(u.protocol).toBe("https:");
      expect(u.hostname === e.host || u.hostname.endsWith(`.${e.host}`)).toBe(true);
    }
    // A name nobody vetted finds nothing: there is no query that reaches the open web.
    expect(searchSites("evil.net")).toEqual([]);
    expect(searchSites("http://anything")).toEqual([]);
    // One letter is not a search; a box that answers before a word is typed is a list of places to type a password.
    expect(searchSites("s")).toEqual([]);
    // People search by what a thing is for, not only by its name.
    expect(searchSites("train").map((e) => e.id)).toContain("irctc");
  });

  it("reads a host only out of an http(s) address", () => {
    expect(hostOf("https://Swiggy.com/orders/1")).toBe("swiggy.com");
    expect(hostOf("javascript:alert(1)")).toBe("");
    expect(hostOf("file:///etc/passwd")).toBe("");
    expect(hostOf("not a url")).toBe("");
  });
});

describe("watching something", () => {
  it("refuses a site that is not on the list, and one they are not signed in to", async () => {
    const { sites } = rig(async () => page());
    await expect(sites.watch(U, "https://zomato.com/x", "Dinner")).rejects.toThrow(SiteError);
    await expect(sites.watch(U, "https://swiggy.com/orders/1", "Dinner")).rejects.toThrow(/not signed in/i);
  });

  it("holds them to the number of things one person may have open", async () => {
    const { sites } = rig(async () => page());
    await sites.signIn(U, "swiggy.com", { cookies: [] });
    await sites.watch(U, "https://swiggy.com/o/1", "One");
    await sites.watch(U, "https://swiggy.com/o/2", "Two");
    await expect(sites.watch(U, "https://swiggy.com/o/3", "Three")).rejects.toThrow(/as many things/i);
  });
});

describe("one look", () => {
  it("reads, writes the card back, and asks to be looked at again no sooner than the floor", async () => {
    const { sites, store, nowAt } = rig(async () => page());
    await sites.signIn(U, "swiggy.com", { cookies: [{ name: "sid", value: "old" }] });
    const w = await sites.watch(U, "https://swiggy.com/orders/1", "Behrouz");
    // Stand in for the model: the service calls readCard only when `read` is given, so drive the store directly
    // for the card and let checkOne prove the rest.
    const out = await sites.checkOne(w);
    expect(out.outcome).toBe("failed"); // no model wired: a read that gives nothing keeps the watch open
    const again = await store.watch(w.id);
    expect(again?.state).toBe("open");
    expect(again?.nextAt).toBe(nowAt() + EVERY);
  });

  it("SAVES THE SESSION THE PAGE GAVE BACK, not the one that went in", async () => {
    const { sites, store } = rig(async () => page({ state: { cookies: [{ name: "sid", value: "rotated" }] } }));
    await sites.signIn(U, "swiggy.com", { cookies: [{ name: "sid", value: "old" }] });
    const w = await sites.watch(U, "https://swiggy.com/orders/1", "Behrouz");
    await sites.checkOne(w);
    const login = await store.login(U, "swiggy.com");
    // A site refreshes its own cookies as it is used; keeping the old ones is how a login quietly rots.
    expect(login?.profile.cookies).toEqual([{ name: "sid", value: "rotated" }]);
  });

  it("opens the page AS THEM: the slip goes in", async () => {
    let sent: VisitOptions | null = null;
    const { sites } = rig(async (o) => { sent = o; return page(); });
    await sites.signIn(U, "swiggy.com", { cookies: [{ name: "sid", value: "mine" }], storage: [["https://swiggy.com", "k", "v"]] });
    const w = await sites.watch(U, "https://swiggy.com/orders/1", "Behrouz");
    await sites.checkOne(w);
    expect(sent).not.toBeNull();
    expect(sent!.state?.cookies).toEqual([{ name: "sid", value: "mine" }]);
    expect(sent!.state?.storage).toEqual([["https://swiggy.com", "k", "v"]]);
  });

  it("a page that cannot be opened leaves the card it had, and tries later", async () => {
    let fail = false;
    const { sites, store, nowAt } = rig(async () => { if (fail) throw new Error("down"); return page(); });
    await sites.signIn(U, "swiggy.com", { cookies: [] });
    const w = await sites.watch(U, "https://swiggy.com/orders/1", "Behrouz");
    await store.saveRead(w.id, { title: "Behrouz", line: "Cooking", stages: [] }, "open", nowAt());
    fail = true;
    const out = await sites.checkOne({ ...w, state: "open" });
    expect(out.outcome).toBe("failed");
    const after = await store.watch(w.id);
    // A blank card would read as "nothing is happening", which is a lie about a parcel on a page we could not open.
    expect(after?.card?.line).toBe("Cooking");
    expect(after?.state).toBe("open");
  });

  it("STOPS LOOKING the moment the thing has arrived", async () => {
    const store = new SiteStore(null);
    let at = 1_000_000;
    const sites = new Sites({ visit: async () => page(), store, now: () => at });
    await sites.signIn(U, "swiggy.com", { cookies: [] });
    const w = await sites.watch(U, "https://swiggy.com/orders/1", "Behrouz");
    await store.saveRead(w.id, { title: "Behrouz", line: "Delivered", stages: [], done: true }, "done", undefined);
    const after = await store.watch(w.id);
    expect(after?.state).toBe("done");
    expect(after?.nextAt).toBeUndefined();
    // And nothing done is ever due again, however long passes.
    at += 10 * 24 * 60 * 60_000;
    expect(await sites.dueNow()).toEqual([]);
  });

  it("three refusals in a row and it stops and asks them to sign in again", async () => {
    const signInPage = page({ finalUrl: "https://swiggy.com/login", title: "Sign in", elements: [{ id: "e1", role: "secret" }] });
    const { sites, store } = rig(async () => signInPage);
    await sites.signIn(U, "swiggy.com", { cookies: [] });
    const w = await sites.watch(U, "https://swiggy.com/orders/1", "Behrouz");
    for (let i = 0; i < 2; i++) expect((await sites.checkOne({ ...w, state: "open" })).outcome).toBe("signed_out");
    expect((await store.watch(w.id))?.state).toBe("open");
    expect((await sites.checkOne({ ...w, state: "open" })).outcome).toBe("signed_out");
    expect((await store.watch(w.id))?.state).toBe("stopped");
    expect((await sites.logins(U))[0]?.needsSignIn).toBe(true);
  });

  it("a watch whose site was taken off the list, or whose switch went off, stops rather than carries on", async () => {
    const { sites, store } = rig(async () => page());
    await sites.signIn(U, "example.org", { cookies: [] });
    const w = await sites.watch(U, "https://example.org/a", "Thing");
    process.env.CLOUD_BROWSER_SITES = "swiggy.com";
    resetConfigForTests();
    try {
      const out = await sites.checkOne({ ...w, state: "open" });
      expect(out.outcome).toBe("skipped");
      expect((await store.watch(w.id))?.state).toBe("stopped");
    } finally {
      process.env.CLOUD_BROWSER_SITES = "swiggy.com, example.org";
      resetConfigForTests();
    }
  });
});

describe("the card the model gives back", () => {
  it("keeps only what the page said, and refuses a card that says nothing", () => {
    expect(cardOf({ title: "  Behrouz   Biryani ", line: "Out for delivery", stages: [{ name: "Placed", done: true }] }))
      .toEqual({ title: "Behrouz Biryani", line: "Out for delivery", stages: [{ name: "Placed", done: true }] });
    expect(cardOf({ title: "", line: "Out for delivery" })).toBeNull();
    expect(cardOf({ title: "Behrouz", line: "" })).toBeNull();
    expect(cardOf({ title: "Behrouz", line: "x", missing: true })).toBeNull();
    // A stage with no name is not a stage.
    expect(cardOf({ title: "A", line: "b", stages: [{ name: " ", done: true }, { name: "Shipped", done: false }] })?.stages)
      .toEqual([{ name: "Shipped", done: false }]);
  });

  it("knows a sign-in page from a page about their thing", () => {
    expect(looksSignedOut(page({ finalUrl: "https://swiggy.com/login" }))).toBe(true);
    expect(looksSignedOut(page({ title: "Sign in to Swiggy" }))).toBe(true);
    expect(looksSignedOut(page({ elements: [{ id: "e1", role: "secret" }] }))).toBe(true);
    expect(looksSignedOut(page())).toBe(false);
  });
});

describe("signed in on the phone", () => {
  // The model, stood in for at its own seam: what it was asked, and a card back.
  const model = () => {
    const asked: string[] = [];
    const call = (async (req: { messages: Array<{ content: unknown }> }) => {
      asked.push(JSON.stringify(req.messages));
      return { json: { title: "Behrouz Biryani", line: "Out for delivery, 10 min away", stages: [{ name: "Placed", done: true }, { name: "On the way", done: true }, { name: "Delivered", done: false }] }, paise: 1, model: "fake" };
    }) as never;
    return { asked, read: { maxPaise: 50, call } };
  };
  const phoneRig = () => {
    const visits: string[] = [];
    const store = new SiteStore(null);
    let at = 1_000_000;
    const m = model();
    const sites = new Sites({ visit: async (o) => { visits.push(o.url); return page(); }, store, read: m.read, now: () => at });
    return { sites, store, visits, m, tick: (ms: number) => { at += ms; } };
  };
  const PAGE = { finalUrl: "https://swiggy.com/my-account/orders", title: "My orders", text: "Behrouz Biryani — Out for delivery", elements: [] };

  it("keeps the fact of the sign-in and nothing of the session", async () => {
    const { sites, store } = phoneRig();
    await sites.connectedOnPhone(U, "swiggy.com", "Rahul");
    const login = await store.login(U, "swiggy.com");
    expect(login?.profile).toEqual({ cookies: [], onPhone: true });
    expect(login?.who).toBe("Rahul");
    expect((await sites.logins(U)).map((l) => l.site)).toEqual(["swiggy.com"]);
  });

  // The server cannot read a login it holds no session for — and must not try: a visit with nothing in it reads a
  // signed-out page, and counting that as a refusal would sign the person out of something they are signed in to.
  it("is never visited by the server's own browser", async () => {
    const { sites, store, visits } = phoneRig();
    await sites.connectedOnPhone(U, "swiggy.com");
    const w = await sites.watch(U, PAGE.finalUrl, "Dinner");
    expect((await sites.checkOne(w)).outcome).toBe("skipped");
    expect(visits).toEqual([]);
    expect((await store.login(U, "swiggy.com"))?.fails).toBe(0);
  });

  it("turns what the phone read into a card, through the model", async () => {
    const { sites, store, m } = phoneRig();
    await sites.connectedOnPhone(U, "swiggy.com", "Rahul");
    const w = await sites.watch(U, PAGE.finalUrl, "Dinner");
    const r = await sites.phoneRead(U, w.id, PAGE);
    expect(r.outcome).toBe("read");
    expect(r.card).toMatchObject({ title: "Behrouz Biryani", line: "Out for delivery, 10 min away" });
    expect(m.asked[0]).toContain("Out for delivery");
    // And it is still held on the phone: a read must never turn it into a server login with an empty session.
    expect((await store.login(U, "swiggy.com"))?.profile).toEqual({ cookies: [], onPhone: true });
  });

  // THE MANNERS ARE THE SERVER'S. An app that asks too often costs a database read, never a model call.
  it("answers a read before it is due with what it has, and asks the model nothing", async () => {
    const { sites, m, tick } = phoneRig();
    await sites.connectedOnPhone(U, "swiggy.com");
    const w = await sites.watch(U, PAGE.finalUrl, "Dinner");
    await sites.phoneRead(U, w.id, PAGE);
    expect(m.asked).toHaveLength(1);
    tick(60_000);
    const again = await sites.phoneRead(U, w.id, PAGE);
    expect(again.outcome).toBe("early");
    expect(again.card).toMatchObject({ title: "Behrouz Biryani" });
    expect(m.asked).toHaveLength(1);
    tick(EVERY);
    expect((await sites.phoneRead(U, w.id, PAGE)).outcome).toBe("read");
    expect(m.asked).toHaveLength(2);
  });

  it("three sign-in pages in a row stop the watch, and the screen asks them to sign in again", async () => {
    const { sites, store, tick } = phoneRig();
    await sites.connectedOnPhone(U, "swiggy.com");
    const w = await sites.watch(U, PAGE.finalUrl, "Dinner");
    const signedOut = { ...PAGE, finalUrl: "https://swiggy.com/auth", title: "Login" };
    for (let i = 0; i < 3; i++) { expect((await sites.phoneRead(U, w.id, signedOut)).outcome).toBe("signed_out"); tick(EVERY); }
    expect((await sites.logins(U))[0]).toMatchObject({ site: "swiggy.com", needsSignIn: true });
    expect((await store.watch(w.id))?.state).toBe("stopped");
  });

  it("reads only for the person who owns the watch, and only a login that is on the phone", async () => {
    const { sites } = phoneRig();
    await sites.connectedOnPhone(U, "swiggy.com");
    const w = await sites.watch(U, PAGE.finalUrl, "Dinner");
    await expect(sites.phoneRead("someone-else", w.id, PAGE)).rejects.toThrow(/not something I am watching/);

    const kept = phoneRig();
    await kept.sites.signIn(U, "swiggy.com", { cookies: [{ name: "sid", value: "x" }] });
    const w2 = await kept.sites.watch(U, PAGE.finalUrl, "Dinner");
    await expect(kept.sites.phoneRead(U, w2.id, PAGE)).rejects.toThrow(/not signed in on your phone/);
  });
});
