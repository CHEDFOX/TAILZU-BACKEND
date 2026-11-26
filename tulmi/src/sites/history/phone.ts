/**
 * WHAT THE PHONE RUNS ON A SITE FOR A PORTRAIT AND AN ORDER (docs/site-portrait.md; the phone's SiteView, docs/sites.md).
 *
 *   historyRead(site)    the orders page, read: the server's own walk (src/sites/phone.ts READ_PAGE), with the links to the
 *                        restaurants on it written above the words, so an order can start at the restaurant's own page
 *   ORDER_SHAPE          for an order: "this is never a sign-in", so the phone never waits for one and never says "signed in"
 *   orderStep(o)         for an order: on the site's search, open the restaurant; on its page, press "Add" by each dish once,
 *                        then "View cart". Nothing past that. The cart is the site's, and so is paying
 *
 * WHY ORDERING USES THE SIGN-IN'S SLOTS. The phones out there draw a SiteView in two modes, and only "signin" is seen. It
 * runs `shape` every two seconds and `findLogin` once on each new page it lands on, both from this server. So an order is a
 * SiteView in "signin" mode whose `shape` always says "not a sign-in" and whose `findLogin` is the step below. That needs no
 * new build: it ships when this server does. The person watches it happen on the site's own page, can stop it with Back at
 * any moment, and the last thing it does is show them the cart.
 *
 * WHAT IT WILL NEVER DO. Press pay, place an order, type anything, or touch a page off the site (the SiteView holds it to
 * the site's hosts). Each dish is added once: what it pressed is kept in the tab's sessionStorage under the order's own
 * id, so a reload or a second page never adds it twice. A dish it cannot find is left for the person, named on the card
 * above the page.
 */
import { catalogFor } from "../catalog.js";
import { READ_PAGE } from "../phone.js";

/** The orders page as the server's reader reads it, with the restaurant links put first (orders.ts splitLinks takes them off). */
export function historyRead(site: string): string {
  const path = catalogFor(site)?.placePath ?? "";
  return `(function () {
  var r = ${READ_PAGE};
  var PATH = ${JSON.stringify(path)};
  var seen = {}, lines = [];
  if (PATH) {
    var as = document.querySelectorAll("a[href]");
    for (var i = 0; i < as.length && lines.length < 40; i++) {
      var a = as[i], href = String(a.href || "");
      if (href.indexOf("https://") !== 0 || href.indexOf(PATH) < 0) continue;
      var t = String(a.innerText || a.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().slice(0, 100);
      var clean = href.split("#")[0].split("?")[0];
      if (!t || seen[clean]) continue;
      seen[clean] = 1;
      lines.push(t.replace(/\\t/g, " ") + "\\t" + clean);
    }
  }
  if (lines.length) r.text = "[x0-links]\\n" + lines.join("\\n") + "\\n[/x0-links]\\n" + (r.text || "");
  r.text = String(r.text || "").slice(0, 20000);
  return r;
})()`;
}

/** For an order: never a sign-in, so the phone neither waits for one nor reports one finished. */
export const ORDER_SHAPE = `({ url: location.href, title: document.title, signIn: false, loginLink: false })`;

export interface OrderStep {
  /** The order's own id: what it pressed is kept under it, so nothing is pressed twice. */
  id: string;
  place: string;
  /** The dishes to add, as the site names them. Empty for a search: the person picks. */
  items: string[];
}

/**
 * The step, run once on each page the order lands on. It answers at once ({ clicked: null }, which the phone takes as
 * "nothing to press, wait") and does its work on timers, because a page that has just loaded has not drawn its menu yet.
 */
export function orderStep(o: OrderStep): string {
  return `(function () {
  var KEY = ${JSON.stringify(`x0-order-${o.id}`)};
  var PLACE = ${JSON.stringify(o.place)};
  var ITEMS = ${JSON.stringify(o.items)};
  if (window.__x0order === KEY) return { clicked: null };
  window.__x0order = KEY;
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9\\u0900-\\u097f]+/g, " ").replace(/\\s+/g, " ").trim(); }
  function visible(el) {
    try { if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false; } catch (e) {}
    var s = getComputedStyle(el); if (!s || s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    var r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1;
  }
  function label(el) { return String(el.innerText || el.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim(); }
  var st = {};
  try { st = JSON.parse(sessionStorage.getItem(KEY) || "{}") || {}; } catch (e) { st = {}; }
  st.added = st.added || []; st.missed = st.missed || [];
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function press(el) { try { el.scrollIntoView({ block: "center" }); } catch (e) {} try { el.click(); } catch (e) {} }
  // The innermost of the elements that say a thing: a wrapper that only holds the button says it too.
  function innermost(list) { return list.filter(function (a) { return !list.some(function (b) { return b !== a && a.contains(b); }); }); }
  function buttons(root, re, max) {
    return innermost(Array.prototype.slice.call(root.querySelectorAll("button, a, [role=button], div, span")).filter(function (b) {
      var l = label(b); return l.length > 0 && l.length <= max && re.test(l) && visible(b);
    }));
  }
  var want = norm(PLACE);
  function onPlace() {
    var h = document.querySelector("h1");
    return norm((h && h.innerText) || "").indexOf(want) >= 0 || norm(document.title).indexOf(want) >= 0;
  }
  function placeLink() {
    var best = null, bestLen = 1e9;
    Array.prototype.slice.call(document.querySelectorAll("a[href]")).forEach(function (a) {
      if (!visible(a)) return;
      var t = norm(a.innerText);
      if (!t || !(t === want || t.indexOf(want + " ") === 0 || (want.length > 5 && t.indexOf(want) >= 0))) return;
      if (t.length < bestLen) { best = a; bestLen = t.length; }
    });
    return best;
  }
  function dish(name) {
    var w = norm(name);
    var found = Array.prototype.slice.call(document.querySelectorAll("h3, h4, h5, p, span, div")).filter(function (e) {
      if (!visible(e)) return false;
      var t = norm(e.innerText); return t === w || (t.indexOf(w) === 0 && t.length <= w.length + 14);
    });
    found.sort(function (a, b) { return norm(a.innerText).length - norm(b.innerText).length; });
    return found[0] || null;
  }
  // The "Add" that belongs to this dish: the nearest block round the dish's name that holds exactly one.
  function addFor(el) {
    var n = el;
    for (var d = 0; d < 8 && n; d++) {
      var adds = buttons(n, /^add\\b/i, 10);
      if (adds.length === 1) return adds[0];
      if (adds.length > 1) return null;
      n = n.parentElement;
    }
    return null;
  }
  var tries = 0, looks = 0;
  function tick() {
    tries++;
    if (!ITEMS.length || tries > 60) return;
    var pending = ITEMS.filter(function (n) { return st.added.indexOf(n) < 0 && st.missed.indexOf(n) < 0; });
    if (!pending.length) {
      if (st.cart || !st.added.length) return;
      var cart = buttons(document, /^view\\s+cart\\b/i, 40)[0];
      if (cart) { st.cart = 1; save(); setTimeout(function () { press(cart); }, 900); return; }
      return setTimeout(tick, 1200);
    }
    if (!onPlace()) {
      var a = placeLink();
      if (a && !st.went) { st.went = 1; save(); press(a); }
      return setTimeout(tick, 1500);
    }
    var name = pending[0], el = dish(name), add = el && addFor(el);
    if (add) { st.added.push(name); save(); looks = 0; press(add); return setTimeout(tick, 1600); }
    // Not drawn yet: menus load as they are scrolled. A dish not found after a good look is left for the person.
    looks++;
    if (looks > 10) { st.missed.push(name); save(); looks = 0; window.scrollTo(0, 0); return setTimeout(tick, 600); }
    window.scrollBy(0, 650);
    setTimeout(tick, 900);
  }
  setTimeout(tick, 1400);
  return { clicked: null };
})()`;
}
