/**
 * WHAT SOMEBODY'S ORDERS SAY ABOUT THEM, AND AN ORDER MADE FROM IT (src/sites/history, docs/site-portrait.md).
 *
 * What these hold: an orders page becomes orders and nothing else (no address the model was shown, no order counted
 * twice); the portrait is counting, not guessing; an ask to order is told from a question about an order; the planner
 * gives the same answer every time and an honest one when it has nothing; the card's token cannot be turned into a
 * link off the site; the reads keep the watcher's manners; and the step the phone runs presses each "Add" once, on the
 * right dish, and never anything past "View cart". That last is run in a real Chromium against a page made to look like
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
const { portraitOf, slotOf, dishWords, portraitLines } = await import("../src/sites/history/portrait.js");
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
    expect(dishWords([{ name: "A", qty: 1 }])).toBe("A");
    expect(dishWords([{ name: "A", qty: 2 }, { name: "B", qty: 1 }])).toBe("2 × A and B");
    expect(dishWords([{ name: "A", qty: 1 }, { name: "B", qty: 1 }, { name: "C", qty: 1 }, { name: "D", qty: 1 }])).toBe("A, B and 2 more");
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

  it("a dish they name picks from the orders that have it", () => {
    const got = plan("get me a burger");
    expect(got.map((x) => x.place)).toEqual(["Truffles"]);
  });

  it("a dish they have never ordered is the site's search, said as that, and the usual after it", () => {
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
    await expect(r.h.phoneRead(U, "amazon.in", r.page())).rejects.toMatchObject({ code: "no_history" });
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

  it("adds each dish once, the right one, then opens the cart and presses nothing past it", async () => {
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
