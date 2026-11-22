/**
 * WHAT THE PHONE RUNS ON A SITE (docs/sites.md "Signed in on the phone").
 *
 * A person signs in to a site on their own phone, in a real WebView inside the app, and stays signed in there the
 * way any browser does. Nothing of that session ever comes here. What comes here is what a page SAID — its words —
 * read on the phone and sent as text, which this server turns into a card exactly as it always has.
 *
 * These are the scripts the phone runs in that WebView. They live on the server, not in the app, for the reason
 * the old panel page did: they change the afternoon this server deploys, with no store build and no OTA.
 *
 *   PAGE_SHAPE   what kind of page this is: a sign-in, a page with a way to sign in on it, or neither
 *   FIND_LOGIN   from any page of the site, get to its sign-in: press the site's own "Sign in" or "Log in"
 *   READ_PAGE    the words and elements of the page, by the same walk the server's own reader does
 *
 * Each is an EXPRESSION that evaluates to a plain object. How it reaches the app (the WebView's postMessage) is the
 * component's business, so the same text can be evaluated here in a test, in a real Chromium, word for word.
 *
 * WHY A RICHER RULE THAN THE SERVER'S. The server says "signed out" when the address or title says sign-in, or a
 * password box is on the page. That misses how the sites people here use most actually sign in: Swiggy and Zomato
 * open a phone-number drawer on the same page, with no new address and no password — a number, then a code. So a
 * sign-in here is also a box for a phone, an email or a code next to a button that sends it.
 */
import { READ_PAGE as SERVER_READ_PAGE } from "../web/browser/engine.js";

/** The same visibility test the server's reader uses, so "on the page" means the same thing on both sides. */
const VISIBLE = `function visible(el) {
    try { if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false; } catch (e) {}
    var s = getComputedStyle(el); if (!s) return false;
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }`;

/**
 * What a button or link says, however the site wrote it — and without the arrows and chevrons sites hang on it.
 * Amazon's header reads "Sign in ›", which an exact match on "sign in" walked straight past.
 */
const LABEL = `function label(el) {
    return ((el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || "") + "")
      .replace(/[^A-Za-z0-9/ ]+/g, " ").replace(/\\s+/g, " ").trim();
  }`;

/**
 * THE KIND OF PAGE THIS IS.
 *
 *   signIn     a sign-in is being asked for right now: the address or title says so, a password box is showing,
 *              or a box for a phone, an email or a one-time code is showing beside a button that sends it
 *   loginLink  the page offers a way to sign in ("Sign in", "Log in") — which a signed-in page does not
 */
export const PAGE_SHAPE = `(function () {
  ${VISIBLE}
  ${LABEL}
  var where = (location.href + " " + document.title).toLowerCase();
  var byWords = /\\b(sign[\\s-]?in|signin|log[\\s-]?in|login|auth|account\\/access)\\b/.test(where);
  var boxes = Array.prototype.slice.call(document.querySelectorAll("input")).filter(visible);
  var password = boxes.some(function (b) { return (b.getAttribute("type") || "").toLowerCase() === "password"; });
  var askBox = boxes.some(function (b) {
    var ty = (b.getAttribute("type") || "text").toLowerCase();
    var said = ((b.getAttribute("placeholder") || "") + " " + (b.getAttribute("aria-label") || "") + " " + (b.getAttribute("name") || "") + " " + (b.getAttribute("autocomplete") || "")).toLowerCase();
    return ty === "tel" || ty === "email" || /phone|mobile|e-?mail|otp|one.?time|verification|code/.test(said);
  });
  var clickables = Array.prototype.slice.call(document.querySelectorAll("button, a, [role=button], input[type=submit]")).filter(visible);
  var sends = clickables.some(function (c) { return /^(continue|next|log ?in|sign ?in|login|send otp|get otp|verify|proceed|submit)$/i.test(label(c)); });
  var loginLink = clickables.some(function (c) { return /^(sign ?in|log ?in|login|signin|sign in \\/ sign up|login \\/ sign ?up)$/i.test(label(c)); });
  // THE WORDS ARE NEVER ENOUGH ON THEIR OWN. An error page at /login says "login" in its address too: Amazon's
  // /ap/signin without its query string is a 404, and a proxy's "upstream request failed" at zomato.com/login
  // passed as a sign-in the first time this ran. A sign-in always has somewhere to type, so it has to have that.
  var typeable = boxes.some(function (b) { return !/^(hidden|submit|button|checkbox|radio|image|file|reset)$/i.test(b.getAttribute("type") || "text"); });
  return { url: location.href, title: document.title, signIn: password || (askBox && sends) || (byWords && typeable), loginLink: loginLink };
})()`;

/**
 * FROM ANY PAGE OF THE SITE TO ITS SIGN-IN. The site's own "Sign in" is pressed — never an address we made up, which
 * would be a guess at where the site keeps its sign-in, and a wrong guess is a 404 on a page we said was the login.
 * A site whose sign-in is a drawer (Swiggy, Zomato) opens it the same way. It answers what it pressed, or null.
 */
export const FIND_LOGIN = `(function () {
  ${VISIBLE}
  ${LABEL}
  var all = Array.prototype.slice.call(document.querySelectorAll("button, a, [role=button]")).filter(visible);
  var exact = /^(sign ?in|log ?in|login|signin)$/i;
  var loose = /^(sign in \\/ sign up|login \\/ sign ?up|sign in or sign up|my account|account)$/i;
  var pick = all.filter(function (c) { return exact.test(label(c)); })[0] || all.filter(function (c) { return loose.test(label(c)); })[0];
  if (!pick) return { clicked: null };
  var said = label(pick);
  try { pick.click(); } catch (e) { return { clicked: null }; }
  return { clicked: said };
})()`;

/** The page as the server's reader would read it: the same walk, run on the phone instead. */
export const READ_PAGE = `(${SERVER_READ_PAGE})()`;
