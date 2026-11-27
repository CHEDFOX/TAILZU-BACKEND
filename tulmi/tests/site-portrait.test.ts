/**
 * WHAT SOMEBODY'S ORDERS SAY ABOUT THEM, AND AN ORDER MADE FROM IT (src/sites/history, docs/site-portrait.md).
 *
 * What these hold: an orders page becomes orders and nothing else (no address the model was shown, no order counted
 * twice); the portrait is counting, not guessing; an ask to order is told from a question about an order; the planner
 * gives the same answer every time and an honest one when it has nothing; the card's token cannot be turned into a
 * link off the site; the reads keep the watcher's manners; and the step the phone runs presses each "Add" once, on the
 * right item, and never anything past "View cart". That last is run in a real Chromium against a page made to look like
 * a restaurant's menu, because a script that presses buttons is only as good as what it presses.
 *
 * No model: the one call is a function here.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DEV_SKIP_AUTH = "true";
process.env.OPENROUTER_API_KEY = "k";
process.env.GROQ_API_KEY = "k";
process.env.CLOUD_BROWSER = "true";
process.env.CONNECTOR_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");

const { splitLinks, rupees, localTime, keyOf, linkFor, ordersOf, mergeOrders, LINKS_START, LINKS_END, readOrders } = await import("../src/sites/history/orders.js");
const { portraitOf, slotOf, itemWords, portraitLines } = await import("../src/sites/history/portrait.js");
const { readOrderAsk } = await import("../src/sites/history/ask.js");
const { planOrder, startUrl, agoWords, planLine } = await import("../src/sites/history/plan.js");
const { orderToken, readOrderToken } = await import("../src/sites/history/token.js");
const { SiteHistories, HISTORY_EVERY_MS } = await import("../src/sites/history/service.js");
const { HistoryStore } = await import("../src/sites/history/store.js");
const { SiteStore } = await import("../src/sites/store.js");
const { orderStep, historyRead, ORDER_SHAPE } = await import("../src/sites/history/phone.js");
import type { SiteOrder } from "../src/sites/history/types.js";

const U = "11111111-1111-4111-8111-111111111111";
const SITE = "swiggy.com";
const LINK = "https://www.swiggy.com/restaurants/behrouz-biryani-koramangala-52311";

const o = (n: number, local: string, place: string, items: Array<[string, number]>, total?: number, x: Partial<SiteOrder> = {}): SiteOrder => ({
  key: `no:${1000 + n}`, site: SITE, place, local, seenAt: 1, items: items.map(([name, qty]) => ({ name, qty })), ...(total ? { total } : {}), ...x,
});
const BIRYANI: Array<[string, number]> = [["Chicken Dum Biryani", 1], ["Gulab Jamun", 1]];
/** Saturday dinners at Behrouz, weekday lunches at Truffles, one late night, one cancelled. */
const HISTORY: SiteOrder[] = [
  o(1, "2026-11-21T20:40", "Behrouz Biryani", BIRYANI, 458, { link: LINK }),
  o(2, "2026-11-19T13:15", "Truffles", [["Cheese Burger", 1], ["Fries", 1]], 386),
  o(3, "2026-11-14T21:05", "Behrouz Biryani", BIRYANI, 458),
  o(4, "2026-11-12T13:20", "Truffles", [["Cheese Burger", 1], ["Fries", 1]], 352),
  o(5, "2026-11-07T20:55", "Behrouz Biryani", BIRYANI, 449),
  o(6, "2026-11-02T23:45", "Leon's", [["Chicken Wings", 1]], 310),
  o(7, "2026-10-31T21:10", "Behrouz Biryani", BIRYANI, 449),
  o(8, "2026-10-30T19:50", "Third Wave", [["Cold Coffee", 2]], 360, { cancelled: true }),
];
/** Thursday 26 Nov 2026, 8:10 pm in India. */
const NOW = Date.UTC(2026, 10, 26, 14, 40);

describe("an orders page, read into orders", () => {
  it("takes the links block off the words: the model never sees an address", () => {
    const text = `${LINKS_START}\nBehrouz Biryani\t${LINK}\nnot a link\tjavascript:alert(1)\n${LINKS_END}\nPast Orders\nBehrouz Biryani`;
    const r = splitLinks(text);
    expect(r.links).toEqual([{ label: "Behrouz Biryani", url: LINK }]);
    expect(r.text).toBe("Past Orders\nBehrouz Biryani");
    expect(r.text).not.toContain("https://");
  });

  it("reads money and times as the page wrote them, and nothing that is not one", () => {
    expect(rupees("₹ 1,234.50")).toBe(1234.5);
    expect(rupees(456)).toBe(456);
    expect(rupees("free")).toBeUndefined();
    expect(rupees(-3)).toBeUndefined();
    expect(localTime("2026-11-21T20:40")).toBe("2026-11-21T20:40");
    expect(localTime("2026-11-21 20:40:12")).toBe("2026-11-21T20:40");
    expect(localTime("2026-02-30T10:00")).toBeUndefined();
    expect(localTime("Sat, Nov 21")).toBeUndefined();
  });

  it("keys an order by the site's number, else by what and when, so a second read adds nothing", () => {
    expect(keyOf({ no: "#183746", place: "X", items: [] })).toBe("no:183746");
    const a = keyOf({ place: "Behrouz", local: "2026-11-21T20:40", items: [{ name: "Biryani", qty: 1 }, { name: "Raita", qty: 1 }] });
    const b = keyOf({ place: "behrouz", local: "2026-11-21T20:40", items: [{ name: "Raita", qty: 1 }, { name: "Biryani", qty: 1 }] });
    expect(a).toBe(b);
  });

  it("matches a restaurant's link by its name, only on the site, only at the site's restaurant path", () => {
    const links = [
      { label: "Behrouz Biryani", url: "https://evil.example/restaurants/behrouz" },
      { label: "Behrouz Biryani", url: "https://www.swiggy.com/help" },
      { label: "Behrouz Biryani", url: `${LINK}?utm=x` },
    ];
    expect(linkFor("Behrouz Biryani", SITE, links)).toBe(LINK);
    expect(linkFor("Truffles", SITE, links)).toBeUndefined();
  });

  it("keeps what an order is and drops what is not one", () => {
    const got = ordersOf({
      orders: [
        { no: "18374652", place: "Behrouz Biryani", items: [{ name: "Chicken Dum Biryani", qty: 1 }], total: "₹458", at: "2026-11-21T20:40" },
        { place: "", items: [{ name: "x" }] },
        { place: "Empty", items: [] },
        { no: "18374652", place: "Behrouz Biryani", items: [{ name: "Chicken Dum Biryani" }] },
        { place: "Truffles", items: [{ name: "Burger", qty: 99 }], cancelled: true, at: "yesterday" },
      ],
    }, SITE, [{ label: "Behrouz Biryani", url: LINK }], 5);
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ key: "no:18374652", total: 458, local: "2026-11-21T20:40", link: LINK, seenAt: 5 });
    expect(got[1]).toMatchObject({ place: "Truffles", cancelled: true, items: [{ name: "Burger", qty: 20 }] });
    expect(got[1]!.local).toBeUndefined();
  });

  it("merges a read into the history: an order seen before keeps when it was first seen", () => {
    const had = [o(1, "2026-11-01T20:00", "A", [["x", 1]], 100, { seenAt: 10 })];
    const merged = mergeOrders(had, [o(1, "2026-11-01T20:00", "A", [["x", 1]], 100, { seenAt: 99, link: LINK }), o(2, "2026-11-02T20:00", "B", [["y", 1]], 50, { seenAt: 99 })]);
    expect(merged.map((m) => m.key)).toEqual(["no:1002", "no:1001"]);
    expect(merged[1]).toMatchObject({ seenAt: 10, link: LINK });
  });

  it("asks the model once with the page fenced, and reads what it says into orders", async () => {
    let seen = "";
    const call = (async (req: { messages: Array<{ content: unknown }> }) => {
      seen = String(req.messages.at(-1)?.content ?? "");
      return { json: { orders: [{ place: "Behrouz Biryani", items: [{ name: "Chicken Dum Biryani", qty: 1 }], total: "458", at: "2026-11-21T20:40" }] }, paise: 1, model: "m" };
    }) as never;
    const got = await readOrders(U, SITE, { title: "Orders", finalUrl: "https://www.swiggy.com/my-account/orders", text: `${LINKS_START}\nBehrouz Biryani\t${LINK}\n${LINKS_END}\nPast Orders Behrouz Biryani Chicken Dum Biryani x 1 Total 458` }, { call, maxPaise: 60 }, NOW);
    expect(got?.[0]).toMatchObject({ place: "Behrouz Biryani", link: LINK, total: 458 });
    expect(seen).toContain("Past Orders");
    expect(seen).not.toContain(LINK);
  });
});

describe("the portrait", () => {
  const p = portraitOf(SITE, HISTORY, NOW);

  it("counts what went through, never a cancelled order", () => {
    expect(p.orders).toBe(7);
    expect(p.dishes.find((d) => d.name === "Cold Coffee")).toBeUndefined();
  });

  it("finds the usual: the same place and dishes, again and again, and when", () => {
    expect(p.usual).toMatchObject({ place: "Behrouz Biryani", count: 4, slot: "dinner", day: 6, link: LINK });
    expect(p.usual?.total).toBe(453.5);
  });

  it("knows the parts of the day as people eat", () => {
    expect([slotOf(8), slotOf(13), slotOf(17), slotOf(21), slotOf(23), slotOf(2)]).toEqual(["breakfast", "lunch", "evening", "dinner", "late", "late"]);
    expect(p.slots.find((s) => s.slot === "dinner")?.count).toBe(4);
    expect(p.slots.find((s) => s.slot === "lunch")?.count).toBe(2);
  });

  it("says only what the orders show", () => {
    expect(p.noticed[0]).toBe("Chicken Dum Biryani and Gulab Jamun from Behrouz Biryani is your go-to.");
    expect(p.noticed).toContain("You mostly order dinner, around 9 pm.");
    expect(p.noticed).toContain("Behrouz Biryani is your favourite place.");
    // Conclusions, never the counting behind them.
    for (const n of p.noticed.slice(0, -1)) expect(n).not.toMatch(/\d+ times|%|\d+ orders/);
    // One order is a portrait of one order: no habit, no "usually".
    const one = portraitOf(SITE, [HISTORY[1]!], NOW);
    expect(one.usual).toBeUndefined();
    expect(one.noticed).toEqual([]);
  });

  it("puts what a bot is told in a few lines, the usual among them", () => {
    const lines = portraitLines(p);
    expect(lines[0]).toBe("Swiggy: 7 orders read from their orders page.");
    expect(lines.join(" ")).toContain("Their usual there: Chicken Dum Biryani and Gulab Jamun from Behrouz Biryani, for dinner.");
    expect(portraitLines(portraitOf(SITE, [], NOW))).toEqual([]);
  });

  it("writes dishes the way a person would", () => {
    expect(itemWords([{ name: "A", qty: 1 }])).toBe("A");
    expect(itemWords([{ name: "A", qty: 2 }, { name: "B", qty: 1 }])).toBe("2 × A and B");
    expect(itemWords([{ name: "A", qty: 1 }, { name: "B", qty: 1 }, { name: "C", qty: 1 }, { name: "D", qty: 1 }])).toBe("A, B and 2 more");
  });
});

describe("an ask to order food", () => {
  const yes = ["order dinner", "order my usual", "get me a biryani", "same as last time from swiggy", "my usual please", "khana mangwa do",
    "biryani order karo", "kuch khane ko mangao", "I'm hungry", "what should I order for dinner?", "order lunch from truffles", "swiggy se pizza manga do"];
  const no = ["where is my order", "cancel my swiggy order", "track my order", "how do I order on zomato?", "order these names alphabetically",
    "what did I order yesterday?", "my order is late", "make a poster of biryani", "hi", "sort them in order of price"];

  it.each(yes)("reads %j as an ask", (w) => expect(readOrderAsk(w)).not.toBeNull());
  it.each(no)("does not read %j as one", (w) => expect(readOrderAsk(w)).toBeNull());

  it("hears the usual, the last one, a part of the day, a site and what they named", () => {
    expect(readOrderAsk("order my usual")).toMatchObject({ usual: true, last: false, want: [] });
    expect(readOrderAsk("same as last time")).toMatchObject({ last: true, usual: false });
    expect(readOrderAsk("order lunch from truffles on swiggy")).toMatchObject({ slot: "lunch", site: "swiggy.com", want: ["truffles"] });
    expect(readOrderAsk("get me a biryani")?.want).toEqual(["biryani"]);
  });
});

describe("what to order", () => {
  const h = [{ site: SITE, orders: HISTORY }];
  const plan = (w: string, now = NOW) => planOrder(h, readOrderAsk(w)!, now, 330);

  it("the usual is the usual, with why, starting at the restaurant's own page", () => {
    const [first] = plan("order my usual");
    expect(first).toMatchObject({ place: "Behrouz Biryani", url: LINK, total: 458 });
    expect(first!.why).toBe("Your usual dinner");
  });

  it("is the same answer every time", () => {
    expect(plan("order my usual")).toEqual(plan("order my usual"));
  });

  it("the time of day decides when nothing else does: lunch is lunch", () => {
    const [first] = plan("order lunch");
    expect(first!.place).toBe("Truffles");
    expect(first!.url).toBe("https://www.swiggy.com/search?query=Truffles");
  });

  it("same as last time is the newest order", () => {
    expect(plan("same as last time")[0]!.why).toBe("Same as your last order");
  });

  it("an item they name picks from the orders that have it", () => {
    const got = plan("get me a burger");
    expect(got.map((x) => x.place)).toEqual(["Truffles"]);
  });

  it("an item they have never ordered is the site's search, said as that, and the usual after it", () => {
    const got = plan("order pizza");
    expect(got[0]).toMatchObject({ search: true, place: "pizza", url: "https://www.swiggy.com/search?query=pizza", items: [] });
    expect(got[1]!.place).toBe("Behrouz Biryani");
    expect(planLine(got)).toBe("You haven't ordered pizza on Swiggy before. I'll open its search.");
  });

  it("offers different places, three at most", () => {
    const got = plan("order dinner");
    expect(got.length).toBeLessThanOrEqual(3);
    expect(new Set(got.map((x) => x.place)).size).toBe(got.length);
  });

  it("has no plan with no history", () => {
    expect(planOrder([], readOrderAsk("order my usual")!, NOW, 330)).toEqual([]);
    expect(planOrder([{ site: SITE, orders: [HISTORY[7]!] }], readOrderAsk("order my usual")!, NOW, 330)).toEqual([]);
  });

  it("starts on the site and nowhere else", () => {
    expect(startUrl(SITE, "Truffles", "https://evil.example/restaurants/x")).toBe("https://www.swiggy.com/search?query=Truffles");
    expect(startUrl(SITE, "A & B")).toBe("https://www.swiggy.com/search?query=A%20%26%20B");
    expect(agoWords("2026-11-25T20:00", "2026-11-26T09:00")).toBe("yesterday");
  });
});

describe("the card's token", () => {
  it("reads back what it kept", () => {
    const opts = planOrder([{ site: SITE, orders: HISTORY }], readOrderAsk("order my usual")!, NOW, 330);
    expect(readOrderToken(orderToken(opts))).toEqual(opts);
  });

  it("drops an option whose address is off the site, or on a site this server does not allow", () => {
    const bad = JSON.stringify({ v: 1, options: [
      { site: SITE, place: "A", items: [{ name: "x", qty: 1 }], why: "w", url: "https://evil.example/" },
      { site: "evil.example", place: "B", items: [{ name: "x", qty: 1 }], why: "w", url: "https://evil.example/" },
      { site: SITE, place: "E", items: [{ name: "x", qty: 1 }], why: "w", url: "https://www.swiggy.com/x" },
    ] });
    expect(readOrderToken(bad).map((x) => x.place)).toEqual(["E"]);
    const worse = JSON.stringify({ v: 1, options: [
      { site: SITE, place: "C", items: [{ name: "x", qty: 1 }], why: "w", url: "javascript:alert(1)" },
      { site: SITE, place: "D", items: [], why: "w", url: "https://www.swiggy.com/x" },
    ] });
    expect(readOrderToken(worse)).toEqual([]);
    expect(readOrderToken("{not json")).toEqual([]);
  });
});

describe("learning from the orders page, with the watcher's manners", () => {
  async function rig() {
    let at = NOW;
    let calls = 0;
    const logins = new SiteStore(null);
    const store = new HistoryStore(null);
    const call = (async () => {
      calls++;
      return { json: { orders: [{ no: `9${calls}000`, place: "Behrouz Biryani", items: [{ name: "Chicken Dum Biryani", qty: 1 }], total: "458", at: "2026-11-21T20:40" }] }, paise: 1, model: "m" };
    }) as never;
    const h = new SiteHistories({ store, logins, read: { call, maxPaise: 60 }, now: () => at });
    await logins.saveLogin(U, SITE, { cookies: [], onPhone: true });
    const page = (text = "Past Orders Behrouz Biryani Chicken Dum Biryani x 1 Total Paid 458") => ({ finalUrl: "https://www.swiggy.com/my-account/orders", title: "My Account", text, elements: [] });
    return { h, store, logins, page, tick: (ms: number) => { at += ms; }, calls: () => calls };
  }

  it("learns once, then not again before the floor, then not again for the same page", async () => {
    const r = await rig();
    expect(await r.h.readers(U)).toEqual([{ site: SITE, url: "https://www.swiggy.com/my-account/orders" }]);
    expect(await r.h.phoneRead(U, SITE, r.page())).toEqual({ outcome: "learned", added: 1 });
    expect(await r.h.readers(U)).toEqual([]);
    expect((await r.h.phoneRead(U, SITE, r.page())).outcome).toBe("early");
    r.tick(HISTORY_EVERY_MS);
    expect((await r.h.phoneRead(U, SITE, r.page())).outcome).toBe("same");
    expect(r.calls()).toBe(1);
    const p = await r.h.portrait(U, SITE);
    expect(p.orders).toBe(1);
  });

  it("a signed-out page teaches nothing and spends nothing", async () => {
    const r = await rig();
    const out = await r.h.phoneRead(U, SITE, { ...r.page("Login Enter your phone number"), finalUrl: "https://www.swiggy.com/auth", title: "Login" });
    expect(out.outcome).toBe("signed_out");
    expect(r.calls()).toBe(0);
  });

  it("refuses a page from another site, a site with no history, and a login not held on the phone", async () => {
    const r = await rig();
    await expect(r.h.phoneRead(U, SITE, { ...r.page(), finalUrl: "https://evil.example/orders" })).rejects.toMatchObject({ code: "wrong_site" });
    await expect(r.h.phoneRead(U, "irctc.co.in", r.page())).rejects.toMatchObject({ code: "no_history" });
    await r.logins.saveLogin(U, SITE, { cookies: [{ name: "a" }] });
    await expect(r.h.phoneRead(U, SITE, r.page())).rejects.toMatchObject({ code: "not_on_phone" });
  });

  it("forgets everything learned there", async () => {
    const r = await rig();
    await r.h.phoneRead(U, SITE, r.page());
    await r.h.forget(U, SITE);
    expect((await r.h.portrait(U, SITE)).orders).toBe(0);
    expect(await r.h.portraits(U)).toEqual([]);
  });
});

// ------------------------------------------------------------------ the step, in a real browser

/** Playwright, if this machine has it: the step is pressed on a real page, or the test says it could not be. */
function playwright(): { chromium: { launch(o?: unknown): Promise<any> } } | null {
  try { return createRequire(import.meta.url)("playwright"); } catch { return null; }
}

/** A restaurant's menu as Swiggy draws one: a name, a price, an "ADD" in a wrapper, and look-alike dishes beside the real one. */
const MENU = `<!doctype html><html><head><title>Behrouz Biryani | Swiggy</title></head><body>
<h1>Behrouz Biryani</h1>
<div class="menu">
  <div class="item"><h3>Chicken Dum Biryani Family Pack</h3><span>₹899</span><div class="add"><button onclick="add('family')">ADD</button></div></div>
  <div class="item"><h3>Chicken Dum Biryani</h3><span>₹389</span><div class="add"><button onclick="add('biryani')">ADD</button></div></div>
  <div class="item"><h3>Gulab Jamun</h3><span>₹99</span><div class="add"><div role="button" onclick="add('jamun')">ADD +</div></div></div>
  <div class="item"><h3>Pay Now</h3><button onclick="add('PAID')">Pay</button></div>
</div>
<div id="bar" style="display:none"><button onclick="window.cart.push('VIEW')">View Cart</button><button onclick="window.cart.push('PAID')">Pay ₹488</button></div>
<script>window.cart=[];function add(x){window.cart.push(x);document.getElementById('bar').style.display='block';}</script>
</body></html>`;

/** The site's search, with the restaurant as a link among others. */
const SEARCH = `<!doctype html><html><head><title>Search | Swiggy</title></head><body>
<a href="#behrouz-biryani-express">Behrouz Biryani Express Bowls · 4.1</a>
<a href="#behrouz-biryani">Behrouz Biryani · 4.4 · Koramangala</a>
<script>window.addEventListener("hashchange",function(){document.title="Opened "+location.hash;});</script>
</body></html>`;

describe.skipIf(!playwright())("the step the phone runs, on a page made to look like a menu", () => {
  const run = async (html: string, items: string[], wait = 9000) => {
    const browser = await playwright()!.chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      // Served from the site's own origin, as on the phone: sessionStorage is the site's, as it would be.
      await page.route("https://www.swiggy.com/**", (route: any) => route.fulfill({ contentType: "text/html", body: html }));
      await page.goto("https://www.swiggy.com/restaurants/behrouz");
      const answer = await page.evaluate(orderStep({ id: "t1", place: "Behrouz Biryani", items }));
      await page.waitForTimeout(wait);
      return { answer, cart: await page.evaluate("window.cart || []"), title: await page.title(), page, browser };
    } catch (e) { await browser.close(); throw e; }
  };

  it("adds each item once, the right one, then opens the cart and presses nothing past it", async () => {
    const r = await run(MENU, ["Chicken Dum Biryani", "Gulab Jamun"]);
    try {
      expect(r.answer).toEqual({ clicked: null });
      expect(r.cart).toEqual(["biryani", "jamun", "VIEW"]);
      // Run again on the same page (a reload of the step): nothing is added twice.
      await r.page.evaluate("window.__x0order = undefined");
      await r.page.evaluate(orderStep({ id: "t1", place: "Behrouz Biryani", items: ["Chicken Dum Biryani", "Gulab Jamun"] }));
      await r.page.waitForTimeout(3000);
      expect(await r.page.evaluate("window.cart")).toEqual(["biryani", "jamun", "VIEW"]);
    } finally { await r.browser.close(); }
  }, 30_000);

  it("on the search, opens the restaurant by its own name, not the one that only starts like it", async () => {
    const r = await run(SEARCH, ["Chicken Dum Biryani"], 3000);
    try {
      expect(r.title).toBe("Opened #behrouz-biryani");
    } finally { await r.browser.close(); }
  }, 30_000);

  it("the history read puts the restaurant links above the words, and the order's shape is never a sign-in", async () => {
    const browser = await playwright()!.chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(`<html><head><title>My Account</title></head><body><h2>Past Orders</h2><a href="https://www.swiggy.com/restaurants/behrouz-52311?x=1">Behrouz Biryani</a><a href="https://www.swiggy.com/help">Help</a><p>Chicken Dum Biryani x 1</p></body></html>`);
      const r = await page.evaluate(historyRead(SITE)) as { text: string };
      const { links, text } = splitLinks(r.text);
      expect(links).toEqual([{ label: "Behrouz Biryani", url: "https://www.swiggy.com/restaurants/behrouz-52311" }]);
      expect(text).toContain("Past Orders");
      expect(await page.evaluate(ORDER_SHAPE)).toMatchObject({ signIn: false, loginLink: false });
    } finally { await browser.close(); }
  }, 30_000);
});

// ------------------------------------------------------------------ taste: the signals, the profile, the web

const { featuresOf, chooserOf, traitsOf, categoryOf, momentOf, rebuysOf } = await import("../src/sites/history/taste/features.js");
const { KINDS, kindOf } = await import("../src/sites/history/kinds.js");
const { tasteFrom, tasteOf, tasteHash } = await import("../src/sites/history/taste/profile.js");
const { picksFrom, discover, queryFor } = await import("../src/sites/history/taste/discover.js");
const { wantsNew } = await import("../src/sites/history/plan.js");

const REPLY = {
  insights: ["Rich, slow-cooked rice is your comfort food.", "You save the treat for Saturday night."],
  palate: [
    { trait: "Rich and slow-cooked", why: "Dum biryani most weekends", orders: [1, 3] },
    { trait: "Invented", why: "No evidence", orders: [] },
    { trait: "Out of range", why: "Order 99 does not exist", orders: [99] },
  ],
  motives: [{ trait: "Reliability over novelty", why: "The same Saturday order", orders: [1, 3, 5] }],
  moods: [{ moment: "weekend dinner", wants: "a favourite and dessert", orders: [1] }],
  mightLike: [
    { item: "Mutton Haleem", category: "Hyderabadi", why: "Slow-cooked like the biryani", reach: "near" as const, orders: [1, 3] },
    { item: "Chicken Dum Biryani", category: "Hyderabadi", why: "Already their usual", reach: "near" as const, orders: [1] },
    { item: "Laksa", category: "Malaysian", why: "A stretch", reach: "stretch" as const, orders: [2] },
    { item: "Ramen", category: "Japanese", why: "A second stretch", reach: "stretch" as const, orders: [2] },
    { item: "Kolkata Biryani", category: "Bengali", why: "No orders named", reach: "near" as const, orders: [] },
  ],
  city: "Bengaluru",
};

describe("the signals in what they order", () => {
  const f = featuresOf(HISTORY);

  it("reads flavour, category and moment off the words and the clock", () => {
    expect(traitsOf("Andhra Chilli Chicken")).toContain("spicy");
    expect(traitsOf("Paneer Butter Masala")).toContain("rich");
    expect(traitsOf("Gulab Jamun")).toContain("sweet");
    expect(categoryOf({ place: "Somewhere", items: [{ name: "Masala Dosa", qty: 1 }] })).toBe("South Indian");
    expect(categoryOf({ place: "Behrouz Biryani", items: [{ name: "Something", qty: 1 }] })).toBe("Hyderabadi / biryani");
    expect(momentOf("2026-11-21T20:40")).toBe("weekend dinner");
    expect(momentOf("2026-11-19T13:15")).toBe("weekday lunch");
    expect(momentOf("2026-11-02T23:45")).toBe("late night");
  });

  it("measures the chooser: how often they come back, how often they try somewhere new", () => {
    expect(f.orders).toBe(7);
    expect(f.repeat).toBeCloseTo(0.57, 1);
    expect(f.explore).toBeCloseTo(0.43, 1);
    expect(chooserOf(f)).toBe("creature of habit");
    const roamer = featuresOf(["A", "B", "C", "D", "E"].map((p, i) => o(i, `2026-11-0${i + 1}T20:00`, p, [[`Dish ${p}`, 1]])));
    expect(chooserOf(roamer)).toBe("explorer");
  });

  it("knows what each moment of the week wants, and where they order to", () => {
    expect(f.moments[0]).toMatchObject({ moment: "weekend dinner" });
    expect(f.moments[0]!.traits).toContain("rich");
    expect(featuresOf([o(1, "2026-11-01T20:00", "A", [["x", 1]], 100, { area: "Koramangala" })]).areas).toEqual(["Koramangala"]);
  });
});

describe("the taste profile, held to evidence", () => {
  const f = featuresOf(HISTORY);
  const t = tasteFrom(REPLY, HISTORY, f, NOW)!;

  it("keeps a claim only when it names orders that exist", () => {
    expect(t.palate.map((p) => p.trait)).toEqual(["Rich and slow-cooked"]);
  });

  it("a discovery is something they have not had, with evidence, and one stretch at most", () => {
    expect(t.mightLike.map((h) => h.item)).toEqual(["Mutton Haleem", "Laksa"]);
  });

  it("carries how they choose and the hash of the orders it was made from", () => {
    expect(t.chooser).toBe("creature of habit");
    expect(t.hash).toBe(tasteHash(HISTORY));
    expect(t.city).toBe("Bengaluru");
  });

  it("asks the reasoning tier once with the orders fenced, and not at all for too few orders", async () => {
    let calls = 0, tier = "", user = "";
    const call = (async (req: { tier: string; messages: Array<{ content: unknown }> }) => {
      calls++; tier = req.tier; user = String(req.messages.at(-1)?.content ?? "");
      return { json: REPLY, paise: 3, model: "m" };
    }) as never;
    expect(await tasteOf(U, HISTORY.slice(0, 2), { call, maxPaise: 90 })).toBeNull();
    expect(calls).toBe(0);
    const got = await tasteOf(U, HISTORY, { call, maxPaise: 90 }, NOW);
    expect(calls).toBe(1);
    expect(tier).toBe("cheap");
    expect(user).toContain("Reads as: creature of habit");
    expect(user).toContain("#1 Sat 2026-11-21 8 pm (weekend dinner) · Behrouz Biryani");
    expect(got?.insights[0]).toBe("Rich, slow-cooked rice is your comfort food.");
  });
});

describe("somewhere new, from the web, vouched for in a reviewer's own words", () => {
  const t = tasteFrom(REPLY, HISTORY, featuresOf(HISTORY), NOW)!;
  const PAGE = { url: "https://www.reddit.com/r/bangalore/haleem", text: "We went to Shah Ghouse last Friday. The haleem here is cooked overnight and it shows. Paid 280. ".repeat(5) };

  it("keeps a pick only when its quote and its place are on the page it names", () => {
    const picks = picksFrom({ picks: [
      { place: "Shah Ghouse", item: "Mutton Haleem", why: "Slow-cooked, like your biryani", said: "The haleem here is cooked overnight and it shows.", from: 1, hunch: 1 },
      { place: "Shah Ghouse", item: "Haleem again", why: "a second pick at the same place", said: "The haleem here is cooked overnight and it shows.", from: 1, hunch: 1 },
      { place: "Pista House", item: "Haleem", why: "made up", said: "Pista House has the best haleem in town, hands down", from: 1, hunch: 1 },
      { place: "Pista House", item: "Haleem", why: "a real quote about somewhere else", said: "The haleem here is cooked overnight and it shows.", from: 1, hunch: 1 },
      { place: "Shah Ghouse", item: "x", why: "no such page", said: "The haleem here is cooked overnight and it shows.", from: 9, hunch: 1 },
    ] }, t.mightLike, [PAGE]);
    expect(picks).toEqual([expect.objectContaining({ place: "Shah Ghouse", item: "Mutton Haleem", host: "reddit.com", reach: "near" })]);
  });

  it("searches near where they order, reads the pages, and gives nothing when the web gives nothing", async () => {
    const asked: string[] = [];
    const call = (async () => ({ json: { picks: [{ place: "Shah Ghouse", item: "Mutton Haleem", why: "Slow-cooked, like your biryani", said: "The haleem here is cooked overnight and it shows.", from: 1, hunch: 1 }] }, paise: 2, model: "m" })) as never;
    const deps = {
      call,
      find: async (q: string) => { asked.push(q); return [{ title: "t", url: PAGE.url }]; },
      read: async () => PAGE,
    };
    const got = await discover(U, { ...t, areas: ["Koramangala"] }, deps);
    expect(asked[0]).toBe(queryFor("Mutton Haleem", "Koramangala Bengaluru"));
    expect(got[0]).toMatchObject({ place: "Shah Ghouse" });
    expect(await discover(U, t, { ...deps, find: async () => [] })).toEqual([]);
  });
});

describe("the plan, read through their taste", () => {
  const PICK = { place: "Shah Ghouse", item: "Mutton Haleem", category: "Hyderabadi", why: "Slow-cooked like your biryani", said: "The haleem here is cooked overnight", host: "reddit.com", url: "https://reddit.com/x", reach: "near" as const };
  const h = (chooser: "creature of habit" | "explorer") => [{ site: SITE, orders: HISTORY, chooser, picks: [PICK] }];

  it("a creature of habit gets the usual first and one new thing beside it", () => {
    const got = planOrder(h("creature of habit"), readOrderAsk("order dinner")!, NOW, 330);
    expect(got[0]!.place).toBe("Behrouz Biryani");
    expect(got[1]).toMatchObject({ place: "Shah Ghouse", fresh: true, said: PICK.said, url: "https://www.swiggy.com/search?query=Shah%20Ghouse" });
    expect(got.filter((x) => x.fresh)).toHaveLength(1);
  });

  it("an explorer gets the new place first; asked for the usual, anyone gets the usual first", () => {
    expect(planOrder(h("explorer"), readOrderAsk("order dinner")!, NOW, 330)[0]!.fresh).toBe(true);
    expect(planOrder(h("explorer"), readOrderAsk("order my usual")!, NOW, 330)[0]!.place).toBe("Behrouz Biryani");
  });

  it("an item never ordered is a live find when there is one, and the site's search when there is not", () => {
    const ask = readOrderAsk("order haleem")!;
    expect(wantsNew(h("creature of habit"), ask)).toBe(true);
    expect(wantsNew(h("creature of habit"), readOrderAsk("get me a burger")!)).toBe(false);
    const live = { ...PICK, asked: "haleem" };
    const got = planOrder([{ site: SITE, orders: HISTORY }], ask, NOW, 330, [live]);
    expect(got[0]).toMatchObject({ place: "Shah Ghouse", fresh: true });
    expect(planLine(got)).toBe("Something new I think you'll love: Mutton Haleem at Shah Ghouse. Slow-cooked like your biryani");
    expect(planOrder([{ site: SITE, orders: HISTORY }], ask, NOW, 330)[0]!.search).toBe(true);
  });

  it("the new place rides on the card's token, its reviewer's words with it", () => {
    const opts = planOrder(h("creature of habit"), readOrderAsk("order dinner")!, NOW, 330);
    const back = readOrderToken(orderToken(opts));
    expect(back[1]).toMatchObject({ fresh: true, said: PICK.said, host: "reddit.com" });
  });
});

describe("taste, kept and refreshed with manners", () => {
  async function rig(o: { slowWeb?: boolean } = {}) {
    let at = NOW, tasteCalls = 0, finds = 0;
    const logins = new SiteStore(null);
    const store = new HistoryStore(null);
    await logins.saveLogin(U, SITE, { cookies: [], onPhone: true });
    await store.saveOrders(U, SITE, HISTORY);
    await store.setMark(U, SITE, { readAt: NOW });
    const call = (async (req: { purpose: string }) => {
      if (req.purpose === "site.taste") { tasteCalls++; return { json: REPLY, paise: 3, model: "m" }; }
      return { json: { picks: [{ place: "Shah Ghouse", item: "Mutton Haleem", why: "Slow-cooked", said: "The haleem here is cooked overnight and it shows.", from: 1, hunch: 1 }] }, paise: 2, model: "m" };
    }) as never;
    const page = { url: "https://reddit.com/x", text: "Shah Ghouse. The haleem here is cooked overnight and it shows. ".repeat(10) };
    const h = new SiteHistories({
      store, logins, now: () => at,
      taste: { call, maxPaise: 90 },
      discover: {
        call,
        find: async () => { finds++; if (o.slowWeb) await new Promise((r) => setTimeout(r, 60_000)); return [{ title: "t", url: page.url }]; },
        read: async () => page,
      },
    });
    return { h, store, tick: (ms: number) => { at += ms; }, counts: () => ({ tasteCalls, finds }) };
  }

  it("works the taste out once per change of orders, and looks for places once a day", async () => {
    const r = await rig();
    await Promise.all([r.h.refresh(U, SITE), r.h.refresh(U, SITE)]);
    expect(r.counts()).toEqual({ tasteCalls: 1, finds: 2 });
    const p = await r.h.portrait(U, SITE);
    expect(p.taste?.insights[0]).toBe("Rich, slow-cooked rice is your comfort food.");
    expect(p.picks?.[0]).toMatchObject({ place: "Shah Ghouse" });
    // What a screen is given is the conclusions: no order numbers ride along.
    expect(JSON.stringify(p.taste)).not.toContain("orders");
    await r.h.refresh(U, SITE);
    expect(r.counts().tasteCalls).toBe(1);
    r.tick(25 * 60 * 60_000);
    await r.h.refresh(U, SITE);
    expect(r.counts()).toEqual({ tasteCalls: 1, finds: 4 });
  });

  it("a live look for an ask is held to seconds, whatever the web does", async () => {
    const r = await rig({ slowWeb: true });
    await r.store.saveInsight(U, SITE, { taste: tasteFrom(REPLY, HISTORY, featuresOf(HISTORY), NOW)! });
    const { LIVE_DISCOVER_MS } = await import("../src/sites/history/service.js");
    const started = Date.now();
    const got = await r.h.discoverFor(U, "pizza");
    expect(got).toEqual([]);
    expect(Date.now() - started).toBeLessThan(LIVE_DISCOVER_MS + 2000);
  }, 20_000);

  it("forgetting the site forgets its taste too", async () => {
    const r = await rig();
    await r.h.refresh(U, SITE);
    await r.h.forget(U, SITE);
    expect(await r.store.insight(U, SITE)).toEqual({});
  });
});

// ------------------------------------------------------------------ one pipeline for every site

const { sitesFor, readyFor } = await import("../src/sites/history/plan.js");
const { historySite } = await import("../src/sites/history/service.js");

const AMZ = "amazon.in";
const buy = (n: number, local: string, place: string, name: string, total = 400): SiteOrder =>
  ({ key: `no:70${n}`, site: AMZ, place, local, total, seenAt: 1, items: [{ name, qty: 1 }] });
/** A detergent every four weeks, last bought 26 days before NOW; hair oil twice; a one-off protein tub. */
const SHOPPING: SiteOrder[] = [
  buy(1, "2026-10-31T21:00", "Surf Excel", "Surf Excel Matic Liquid Detergent 2L Refill"),
  buy(2, "2026-10-22T10:10", "Mamaearth", "Mamaearth Onion Hair Oil 250ml", 349),
  buy(3, "2026-10-03T20:40", "Surf Excel", "Surf Excel Matic Liquid Detergent 2L Refill"),
  buy(4, "2026-09-20T11:00", "MuscleBlaze", "MuscleBlaze Whey Protein 1kg", 2199),
  buy(5, "2026-09-05T21:15", "Surf Excel", "Surf Excel Matic Liquid Detergent 2L Refill"),
  buy(6, "2026-08-24T10:30", "Mamaearth", "Mamaearth Onion Hair Oil 250ml", 349),
];

describe("one pipeline, any site", () => {
  it("every site whose orders page the catalog knows is learned, whatever its kind", () => {
    expect(historySite("swiggy.com")?.id).toBe("swiggy");
    expect(historySite("amazon.in")?.id).toBe("amazon-in");
    expect(historySite("flipkart.com")?.id).toBe("flipkart");
    expect(historySite("irctc.co.in")).toBeUndefined();
    expect([kindOf("swiggy.com").kind, kindOf("amazon.in").kind, kindOf("irctc.co.in").kind]).toEqual(["food", "shopping", "travel"]);
  });

  it("reads a product with the shop's lexicon: its category and how they like things", () => {
    const f = featuresOf(SHOPPING, KINDS.shopping);
    expect(f.kind).toBe("shopping");
    expect(f.categories[0]!.name).toBe("Groceries & household");
    expect(f.traits.map((t) => t.trait)).toContain("value packs");
    expect(categoryOf({ place: "x", items: [{ name: "boAt Airdopes earbuds", qty: 1 }] }, KINDS.shopping)).toBe("Electronics");
  });

  it("knows the rhythm of what they buy again, and what is due", () => {
    const r = rebuysOf(SHOPPING, "2026-11-26T20:00");
    expect(r[0]).toMatchObject({ name: "Surf Excel Matic Liquid Detergent 2L Refill", everyDays: 28, due: true });
    // Twice is a coincidence, not a rhythm; and a rhythm not yet due is not due.
    expect(r.find((x) => x.name.startsWith("Mamaearth"))).toBeUndefined();
    expect(rebuysOf(SHOPPING, "2026-11-05T20:00")[0]!.due).toBe(false);
  });

  it("hears a shopping ask, and takes it to a shop, not a kitchen", () => {
    const both = [{ site: SITE, orders: HISTORY }, { site: AMZ, orders: SHOPPING }];
    expect(readOrderAsk("reorder my detergent")).toMatchObject({ kind: "shopping", want: ["detergent"] });
    expect(readOrderAsk("I'm out of coffee pods")?.kind).toBe("shopping");
    expect(readOrderAsk("surf excel khatam ho gaya")?.kind).toBe("shopping");
    expect(readOrderAsk("order a phone charger from amazon")).toMatchObject({ kind: "shopping", site: AMZ });
    expect(readOrderAsk("book a cab")).toBeNull();
    expect(sitesFor(both, readOrderAsk("reorder my detergent")!).map((h) => h.site)).toEqual([AMZ]);
    expect(sitesFor(both, readOrderAsk("order dinner")!).map((h) => h.site)).toEqual([SITE]);
    // "my usual" alone: the kind of site they order from most.
    expect(sitesFor(both, readOrderAsk("my usual please")!).map((h) => h.site)).toEqual([SITE]);
  });

  it("what is due comes first, and a product starts at the shop's search for the product", () => {
    const got = planOrder([{ site: AMZ, orders: SHOPPING }], readOrderAsk("reorder my detergent")!, NOW, 330);
    expect(got[0]).toMatchObject({ why: "About time for more", url: "https://www.amazon.in/s?k=Surf%20Excel%20Matic%20Liquid%20Detergent%202L%20Refill" });
    expect(planLine(got)).toBe("About time for more Surf Excel Matic Liquid Detergent 2L Refill. It's ready to reorder.");
  });

  it("what is ready, with nothing asked, is the same planner: the usual, what is due, something new", () => {
    const pick = { place: "Minimalist", item: "Rosemary Hair Oil", category: "Personal care", why: "Like the hair oil you rebuy", said: "not greasy at all", host: "reddit.com", url: "https://reddit.com/x", reach: "near" as const };
    const r = readyFor({ site: AMZ, orders: SHOPPING, chooser: "creature of habit", picks: [pick] }, NOW);
    expect(r[0]!.why).toBe("About time for more");
    expect(r.some((o) => o.fresh && o.place === "Minimalist")).toBe(true);
    expect(r.length).toBeLessThanOrEqual(4);
    const food = readyFor({ site: SITE, orders: HISTORY, chooser: "creature of habit" }, NOW);
    expect(food[0]!.place).toBe("Behrouz Biryani");
  });
});

describe("done for you", () => {
  async function rig() {
    const logins = new SiteStore(null);
    const store = new HistoryStore(null);
    await logins.saveLogin(U, SITE, { cookies: [], onPhone: true });
    await store.saveOrders(U, SITE, HISTORY);
    return { h: new SiteHistories({ store, logins, now: () => NOW }), store };
  }

  it("a filled cart is noted once, however often the order is opened", async () => {
    const r = await rig();
    await r.h.noteCart(U, SITE, { ref: "abc123", title: "Filled your cart at Behrouz Biryani", line: "Chicken Dum Biryani" });
    await r.h.noteCart(U, SITE, { ref: "abc123", title: "Filled your cart at Behrouz Biryani" });
    const p = await r.h.portrait(U, SITE);
    expect(p.did).toEqual([{ kind: "cart", title: "Filled your cart at Behrouz Biryani", line: "Chicken Dum Biryani", at: NOW }]);
    expect(p.ready?.[0]?.place).toBe("Behrouz Biryani");
  });

  it("forgetting the site forgets what was done there too", async () => {
    const r = await rig();
    await r.h.noteCart(U, SITE, { ref: "abc123", title: "Filled your cart" });
    await r.h.forget(U, SITE);
    expect(await r.store.didOf(U, SITE)).toEqual([]);
  });
});

/** A shop's search and a product page, as Amazon draws them: a long product name, one "Add to Cart", a cart link. */
const SHOP_SEARCH = `<!doctype html><html><head><title>Amazon.in : detergent</title></head><body>
<a href="#other">Ariel Matic Liquid Detergent 2L</a>
<a href="#surf">Surf Excel Matic Liquid Detergent 2L Refill Pack, Top Load, Removes Tough Stains</a>
<script>window.cart=[];window.addEventListener("hashchange",function(){document.body.innerHTML='<h1 id="productTitle">Surf Excel Matic Liquid Detergent 2L Refill Pack</h1><span>₹420</span><input type="submit" value="Add to Cart" onclick="window.cart.push(\\'ADD\\')"><input type="submit" value="Buy Now" onclick="window.cart.push(\\'PAID\\')"><a href="#cart" onclick="window.cart.push(\\'CART\\')">Go to Cart</a>';});</script>
</body></html>`;

describe.skipIf(!playwright())("the step on a shop, on a page made to look like one", () => {
  it("opens the product by its name, presses Add to Cart once, goes to the cart, and never Buy Now", async () => {
    const browser = await playwright()!.chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.route("https://www.amazon.in/**", (route: any) => route.fulfill({ contentType: "text/html", body: SHOP_SEARCH }));
      await page.goto("https://www.amazon.in/s?k=Surf");
      await page.evaluate(orderStep({ id: "s1", place: "Surf Excel", items: ["Surf Excel Matic Liquid Detergent 2L Refill"], mode: "product" }));
      await page.waitForTimeout(9000);
      expect(await page.evaluate("window.cart")).toEqual(["ADD", "CART"]);
    } finally { await browser.close(); }
  }, 30_000);
});

// ------------------------------------------------------------------ real pictures, from the site or Commons only

const { safeImage, splitImages, imageFor, IMAGES_START, IMAGES_END } = await import("../src/sites/history/pictures.js");

describe("the pictures on the cards", () => {
  const SWIGGY_PIC = "https://media-assets.swiggy.com/swiggy/image/upload/fl_lossy/abc123";
  const AMAZON_PIC = "https://m.media-amazon.com/images/I/71abc.jpg";

  it("shows a picture only from the site's own image servers or Commons, over https", () => {
    expect(safeImage(SWIGGY_PIC, SITE)).toBe(SWIGGY_PIC);
    expect(safeImage(AMAZON_PIC, AMZ)).toBe(AMAZON_PIC);
    expect(safeImage("https://upload.wikimedia.org/wikipedia/commons/x.jpg", SITE)).toBeTruthy();
    // Another site's servers, a stranger's, plain http, a login in the address, or not an address at all: no picture.
    expect(safeImage(AMAZON_PIC, SITE)).toBeUndefined();
    expect(safeImage("https://evil.example/biryani.jpg", SITE)).toBeUndefined();
    expect(safeImage("https://media-assets.swiggy.com.evil.example/x.jpg", SITE)).toBeUndefined();
    expect(safeImage("http://media-assets.swiggy.com/x.jpg", SITE)).toBeUndefined();
    expect(safeImage("https://u:p@media-assets.swiggy.com/x.jpg", SITE)).toBeUndefined();
    expect(safeImage("data:image/png;base64,AAAA", SITE)).toBeUndefined();
  });

  it("takes the pictures block off the words and keeps only allowed ones", () => {
    const text = `${IMAGES_START}\nChicken Dum Biryani\t${SWIGGY_PIC}\nTracker\thttps://evil.example/pixel.gif\n${IMAGES_END}\nPast Orders`;
    const r = splitImages(text, SITE);
    expect(r.images).toEqual([{ label: "Chicken Dum Biryani", url: SWIGGY_PIC }]);
    expect(r.text).toBe("Past Orders");
  });

  it("matches a picture to its dish or product by name, a long name cut short included", () => {
    const pics = [
      { label: "Chicken Dum Biryani Family Pack", url: "https://media-assets.swiggy.com/a" },
      { label: "Chicken Dum Biryani", url: "https://media-assets.swiggy.com/b" },
      { label: "Surf Excel Matic Liquid Detergent 2L Refill Pack, Top Load", url: AMAZON_PIC },
    ];
    expect(imageFor("Chicken Dum Biryani", pics)).toBe("https://media-assets.swiggy.com/b");
    expect(imageFor("Surf Excel Matic Liquid Detergent 2L Refill", pics)).toBe(AMAZON_PIC);
    expect(imageFor("Gulab Jamun", pics)).toBeUndefined();
  });

  it("an order read off the page carries its dish's picture, and keeps it when a later read does not show it", () => {
    const got = ordersOf({ orders: [{ no: "99887766", place: "Behrouz Biryani", items: [{ name: "Chicken Dum Biryani", qty: 1 }], at: "2026-11-21T20:40" }] },
      SITE, [], 5, [{ label: "Chicken Dum Biryani", url: SWIGGY_PIC }]);
    expect(got[0]!.items[0]!.image).toBe(SWIGGY_PIC);
    const later = ordersOf({ orders: [{ no: "99887766", place: "Behrouz Biryani", items: [{ name: "Chicken Dum Biryani", qty: 1 }], at: "2026-11-21T20:40" }] }, SITE, [], 9);
    expect(mergeOrders(got, later)[0]!.items[0]!.image).toBe(SWIGGY_PIC);
  });

  it("the card is drawn with the picture, and a picture off the site never survives the token", () => {
    const withPic = HISTORY.map((x) => (x.place === "Behrouz Biryani" ? { ...x, items: x.items.map((i) => ({ ...i, image: SWIGGY_PIC })) } : x));
    const opts = planOrder([{ site: SITE, orders: withPic }], readOrderAsk("order my usual")!, NOW, 330);
    expect(opts[0]!.image).toBe(SWIGGY_PIC);
    expect(readOrderToken(orderToken(opts))[0]!.image).toBe(SWIGGY_PIC);
    const bad = JSON.stringify({ v: 1, options: [{ site: SITE, place: "A", items: [{ name: "x", qty: 1 }], why: "w", url: "https://www.swiggy.com/x", image: "https://evil.example/t.gif" }] });
    expect(readOrderToken(bad)[0]!.image).toBeUndefined();
  });

  it("something new gets a free photo of the dish with its credit; a product never gets a guessed one", async () => {
    const t = tasteFrom(REPLY, HISTORY, featuresOf(HISTORY), NOW)!;
    const PAGE2 = { url: "https://www.reddit.com/r/bangalore/haleem", text: "We went to Shah Ghouse last Friday. The haleem here is cooked overnight and it shows. Paid 280. ".repeat(5) };
    const call = (async () => ({ json: { picks: [{ place: "Shah Ghouse", item: "Mutton Haleem", why: "Slow-cooked", said: "The haleem here is cooked overnight and it shows.", from: 1, hunch: 1 }] }, paise: 2, model: "m" })) as never;
    const asked: string[] = [];
    const deps = {
      call, find: async () => [{ title: "t", url: PAGE2.url }], read: async () => PAGE2,
      photo: async (q: string) => { asked.push(q); return { url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Haleem.jpg/640px-Haleem.jpg", credit: "Someone, CC BY-SA 4.0" }; },
    };
    const got = await discover(U, t, deps);
    expect(got[0]).toMatchObject({ image: expect.stringContaining("upload.wikimedia.org"), credit: "Someone, CC BY-SA 4.0" });
    expect(asked).toEqual(["Mutton Haleem"]);
    const shop = await discover(U, { ...t, kind: "shopping" }, deps);
    expect(shop[0]?.image).toBeUndefined();
    const elsewhere = await discover(U, t, { ...deps, photo: async () => ({ url: "https://evil.example/x.jpg" }) });
    expect(elsewhere[0]?.image).toBeUndefined();
  });
});

describe.skipIf(!playwright())("the phone's read picks up the site's own pictures, and nobody else's", () => {
  it("names each picture by its alt text or the words beside it, from allowed hosts only", async () => {
    const browser = await playwright()!.chromium.launch();
    try {
      const page = await browser.newPage();
      await page.route("https://www.swiggy.com/**", (route: any) => route.fulfill({ contentType: "text/html", body: `<html><head><title>My Account</title></head><body>
        <h2>Past Orders</h2>
        <div><img src="https://media-assets.swiggy.com/swiggy/image/upload/biryani" width="80" height="80" alt="Chicken Dum Biryani"></div>
        <div><img src="https://media-assets.swiggy.com/swiggy/image/upload/truffles" width="80" height="80" alt=""><span>Truffles</span></div>
        <img src="https://tracker.example/pixel.gif" width="80" height="80" alt="Chicken Dum Biryani">
        <img src="https://media-assets.swiggy.com/swiggy/image/upload/dot" width="1" height="1" alt="dot">
      </body></html>` }));
      await page.route("https://media-assets.swiggy.com/**", (route: any) => route.fulfill({ contentType: "image/gif", body: Buffer.from("R0lGODlhAQABAAAAACw=", "base64") }));
      await page.route("https://tracker.example/**", (route: any) => route.fulfill({ contentType: "image/gif", body: Buffer.from("R0lGODlhAQABAAAAACw=", "base64") }));
      await page.goto("https://www.swiggy.com/my-account/orders");
      const r = await page.evaluate(historyRead(SITE)) as { text: string };
      const { images } = splitImages(r.text, SITE);
      expect(images).toEqual([
        { label: "Chicken Dum Biryani", url: "https://media-assets.swiggy.com/swiggy/image/upload/biryani" },
        { label: "Truffles", url: "https://media-assets.swiggy.com/swiggy/image/upload/truffles" },
      ]);
    } finally { await browser.close(); }
  }, 30_000);
});
