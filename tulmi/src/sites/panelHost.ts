/**
 * THE PAGE THE PANEL IS DRAWN IN (src/sites/panel.ts, docs/sites.md "The panel"; the LiveView node, sdui 3e).
 *
 * The browser that signs a site in belongs to the person and runs in the cloud. Something has to show it to them.
 * The apps already have exactly one thing that can: LiveView, a WebView whose storage is its own and empty, which
 * runs a page THE SERVER WROTE. So the panel is a page, not a component — which means the whole of it, the frame
 * clock, the tap arithmetic, the keyboard, ships when the server deploys, and no phone has to be updated to change
 * how signing in works, or to get it at all.
 *
 * WHAT THE PAGE MAY DO, AND NOTHING ELSE:
 *   - talk to this API, and only this API (`connect-src`), with a ticket that is this one panel and nothing else;
 *   - draw frames it is given, as data: images (`img-src data:`);
 *   - run its own one script, named by its hash. No other script, no font, no stylesheet, no frame, no form.
 * It cannot be navigated anywhere (liveViewRules: a page the server wrote never moves), it holds no cookie, and it
 * cannot see the app's own token — that is in SecureStore behind the Keystore, in a process this page is not in.
 *
 * NOTHING TYPED IS KEPT. The box is a keyboard, not a field: each character is sent as it is typed and the box is
 * emptied, so a password is in this page for one keystroke and never in anything that outlives the keypress. The
 * characters appear where the real page draws them — as dots, because the site masks its own password box. Which
 * is also why nothing here has to know which box on the page is a secret: it never holds the secret.
 *
 * A TAP IS SENT IN THE PAGE'S OWN PIXELS. The frame is drawn at whatever size fits the phone; the browser in the
 * cloud is 412 x 915. Send the drawn numbers and every tap lands short and up-left, which on a sign-in page is the
 * wrong field, or the wrong button.
 */
import { createHash } from "node:crypto";

/** The frame clock, mirroring FrameGate: asking faster than the server can answer only spends the person's data. */
const QUIET_MS = 700;
const BUSY_MS = 180;
const BUSY_FOR_MS = 1200;
/** A finger that moved less than this is a tap, not a drag. */
const TAP_SLOP = 10;

export interface PanelPageOptions {
  /** The panel, and the secret that reaches it. The ticket is written into the page and nowhere else. */
  id: string;
  ticket: string;
  /** The host, shown above the frame so they can always see where they are about to type. */
  site: string;
  /** The browser's own size in CSS pixels: what a tap is scaled back through. */
  width: number;
  height: number;
  /** The first frame (base64 JPEG), so the panel is not a blank box while its first ask is out. */
  frame?: string;
  /** This API's origin, which the page runs as and is allowed to talk to. */
  origin: string;
}

/** Everything the page says about itself, so no sentence is buried in the script. */
const WORDS = {
  safe: "You're typing on the real site. We keep the slip that keeps you signed in, never your password.",
  hint: "Type here",
  done: "I'm signed in",
  cancel: "Not now",
  opening: "Opening…",
  checking: "Checking…",
  lost: "That sign-in has closed.",
};

/** HTML-escape. Everything interpolated into the markup goes through it, host names included. */
const esc = (s: string): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** JSON for a <script>: safe to sit inside the element, whatever the string holds. */
const js = (v: unknown): string => JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

/**
 * The page's one script. It is a function of its inputs, so the hash in the policy is the hash of what runs.
 *
 * It does four things: asks for frames on a clock, turns a finger into a tap or a scroll in the page's pixels,
 * sends each character as it is typed, and tells the app when the panel is over.
 */
function script(o: PanelPageOptions): string {
  return `
(function () {
  "use strict";
  var ID = ${js(o.id)}, TICKET = ${js(o.ticket)};
  var page = { w: ${o.width}, h: ${o.height} };
  var QUIET = ${QUIET_MS}, BUSY = ${BUSY_MS}, BUSY_FOR = ${BUSY_FOR_MS}, SLOP = ${TAP_SLOP};
  var base = "/v1/botsapp/bots/sites/panel/t/" + encodeURIComponent(TICKET);
  var img = document.getElementById("f"), box = document.getElementById("t"), back = document.getElementById("bg");
  var note = document.getElementById("n"), doneBtn = document.getElementById("d"), cancelBtn = document.getElementById("c");
  var lastTouch = null, over = false, told = false, timer = null, checking = false;

  /** UP to the app: the WebView's bridge on the phone, the window's own preload in the desktop app. */
  function up(m) {
    try {
      var s = JSON.stringify(m);
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
      else if (window.tailzuLive && window.tailzuLive.post) window.tailzuLive.post(m);
    } catch (e) { /* the app is not listening; the panel still works */ }
  }

  function say(text) { note.textContent = text || ""; note.style.display = text ? "block" : "none"; }

  /** Every answer from every call lands here, so one place decides it is over and one place says so, once. */
  function take(v) {
    if (!v || typeof v !== "object") return;
    if (typeof v.frame === "string" && v.frame) {
      var pic = "data:image/jpeg;base64," + v.frame;
      img.src = pic;
      // The same picture behind the card, blurred by the stylesheet: the page it is standing on is the page itself.
      if (back) back.src = pic;
    }
    if (typeof v.width === "number" && v.width > 0) page.w = v.width;
    if (typeof v.height === "number" && v.height > 0) page.h = v.height;
    if (typeof v.message === "string" && v.message) say(v.message);
    if (v.ended && !told) {
      told = true; over = true;
      if (timer) clearTimeout(timer);
      box.disabled = true; doneBtn.disabled = true;
      // "Checking…" must not be the last thing they see under a panel that worked, if the app is slow to move on.
      if (!v.message) say("");
      up({ t: "panel", ended: String(v.ended), signedIn: v.signedIn === true, message: v.message || "" });
    }
  }

  function call(method, path, body) {
    return fetch(path, {
      method: method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      // No cookie to send and none to take: the ticket is the whole of this page's authority.
      credentials: "omit",
      cache: "no-store",
    }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function touch(what) {
    if (over) return;
    lastTouch = Date.now();
    call("POST", base + "/touch", what).then(take);
  }

  /** Fast for a moment after a touch, because that is when the page is moving; slow when nothing is happening. */
  function wait() {
    if (lastTouch === null) return QUIET;
    return Date.now() - lastTouch < BUSY_FOR ? BUSY : QUIET;
  }
  function tick() {
    if (over) return;
    call("GET", base).then(function (v) {
      take(v);
      if (!over) timer = setTimeout(tick, wait());
    });
  }

  // ---------------------------------------------------------------- the finger
  // One handler does both: a finger that barely moved is a tap on the page, a dragged one is a scroll.
  var from = null;
  function at(e) {
    var r = img.getBoundingClientRect();
    var p = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : e;
    return { x: p.clientX - r.left, y: p.clientY - r.top, w: r.width, h: r.height };
  }
  function down(e) { from = at(e); }
  function upAt(e) {
    var a = from; from = null;
    if (!a || over || !(a.w > 0) || !(a.h > 0)) return;
    var b = at(e);
    if (Math.abs(b.x - a.x) <= SLOP && Math.abs(b.y - a.y) <= SLOP) {
      // Outside the frame is not a tap on the page: the letterboxing is ours, not the site's.
      if (a.x < 0 || a.y < 0 || a.x > a.w || a.y > a.h) return;
      var x = Math.min(Math.round((a.x / a.w) * page.w), page.w - 1);
      var y = Math.min(Math.round((a.y / a.h) * page.h), page.h - 1);
      touch({ tap: { x: x, y: y } });
      return;
    }
    var dy = Math.round((a.y - b.y) * (page.h / a.h));
    if (dy !== 0) touch({ scroll: Math.max(-2000, Math.min(2000, dy)) });
  }
  img.addEventListener("touchstart", down, { passive: true });
  img.addEventListener("touchend", upAt, { passive: true });
  img.addEventListener("mousedown", down);
  img.addEventListener("mouseup", upAt);

  // ---------------------------------------------------------------- the keyboard
  // Emptied before the call goes out, never after: the box must not hold a password while a request is in flight.
  box.addEventListener("input", function () {
    var t = box.value.slice(0, 200);
    box.value = "";
    if (t) touch({ type: t });
  });
  box.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); touch({ key: "Enter" }); }
    else if (e.key === "Tab") { e.preventDefault(); touch({ key: "Tab" }); }
    // Backspace in an empty box is the one key the box cannot tell us about through its text.
    else if (e.key === "Backspace" && !box.value) touch({ key: "Backspace" });
  });

  // ---------------------------------------------------------------- the two buttons
  doneBtn.addEventListener("click", function () {
    if (over || checking) return;
    checking = true; say(${js(WORDS.checking)});
    // Checked, not believed: the server keeps the panel open if the page still looks signed out, and says so.
    call("POST", base + "/done").then(function (v) {
      checking = false;
      if (!v) { say(${js(WORDS.lost)}); return; }
      if (v.signedIn !== true && !v.message) say("");
      take(v);
    });
  });
  cancelBtn.addEventListener("click", function () {
    if (told) return;
    told = true; over = true;
    if (timer) clearTimeout(timer);
    call("DELETE", base).then(function () { up({ t: "panel", ended: "cancelled", signedIn: false, message: "" }); });
  });

  // The app shows a spinner until this; a panel whose first frame never comes gets LiveView's own error state.
  up({ t: "ready" });
  timer = setTimeout(tick, BUSY);
})();
`;
}

/**
 * The whole page. `origin` is what the app runs it as, so its calls to this API are same-origin; the policy names
 * that origin too, and nothing else is reachable from here.
 */
export function panelPage(o: PanelPageOptions): { html: string; origin: string } {
  const body = script(o);
  const hash = createHash("sha256").update(body, "utf8").digest("base64");
  const first = o.frame ? `data:image/jpeg;base64,${o.frame}` : "";
  const policy = [
    "default-src 'none'",
    "img-src data:",
    "style-src 'unsafe-inline'",
    `script-src 'sha256-${hash}'`,
    `connect-src ${o.origin}`,
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
  ].join("; ");

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${esc(policy)}">
<title>${esc(o.site)}</title>
<style>
  :root { --ink:#0A0A0A; --paper:#FFFFFF; --meta:#5C5C5C; --line:#E6E4E1; --shade:#F4F2EF; }
  * { box-sizing:border-box; margin:0; padding:0; -webkit-tap-highlight-color:transparent; }
  html, body { height:100%; background:var(--shade); color:var(--ink);
    font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  /* The sign-in stands on a card, and behind the card is the same page blurred — the app's own overlay, to its
     own numbers (app/src/sdui/components/blur.tsx: blur(10px) saturate(1.05) under a white veil). The backdrop
     bleeds past every edge so the blur has something to take from and never shows a soft border of its own. */
  #bg { position:fixed; left:-28px; top:-28px; width:calc(100% + 56px); height:calc(100% + 56px);
    object-fit:cover; filter:blur(10px) saturate(1.05); }
  #veil { position:fixed; inset:0; background:rgba(255,255,255,0.42); }
  body { display:flex; flex-direction:column; overscroll-behavior:none;
    padding:calc(26px + env(safe-area-inset-top)) calc(12px + env(safe-area-inset-right)) calc(26px + env(safe-area-inset-bottom)) calc(12px + env(safe-area-inset-left)); }
  /* Elongated: it takes the height it is given, as the window's sheet does (experience/bots/kit.ts sheetPage). */
  #card { position:relative; flex:1 1 auto; min-height:0; display:flex; flex-direction:column; overflow:hidden;
    background:var(--paper); border:1px solid var(--line); border-radius:24px;
    box-shadow:0 24px 60px rgba(10,10,10,.10), 0 2px 8px rgba(10,10,10,.04); }
  #h { padding:10px 14px; font-size:12px; color:var(--meta); border-bottom:1px solid var(--line); }
  #h b { color:var(--ink); font-weight:600; }
  #s { flex:1 1 auto; min-height:0; background:var(--paper); display:flex; align-items:center; justify-content:center; overflow:hidden; }
  #f { max-width:100%; max-height:100%; display:block; background:var(--paper); touch-action:none; user-select:none; -webkit-user-drag:none; }
  #n { display:none; padding:10px 14px 0; font-size:13px; }
  #k { border-top:1px solid var(--line); padding:12px; display:flex; flex-direction:column; gap:10px; flex:0 0 auto; }
  #t { border:1px solid var(--line); border-radius:12px; padding:10px 12px; font-size:15px; color:var(--ink); background:var(--paper); width:100%; }
  #b { display:flex; gap:10px; }
  button { font:inherit; border-radius:12px; padding:12px 16px; border:1px solid var(--line); background:var(--paper); color:var(--ink); }
  #d { flex:1 1 auto; background:var(--ink); color:var(--paper); border-color:var(--ink); font-weight:600; }
  button[disabled] { opacity:.5; }
</style>
</head><body>
<img id="bg" alt=""${first ? ` src="${esc(first)}"` : ""}>
<div id="veil"></div>
<div id="card">
<div id="h">${esc(WORDS.safe)} &middot; <b>${esc(o.site)}</b></div>
<div id="s"><img id="f" alt="${esc(o.site)}"${first ? ` src="${esc(first)}"` : ""}></div>
<p id="n"></p>
<div id="k">
  <!-- type="text", not "password", on purpose. The box is empty between keystrokes either way, so a password one
       would hide nothing that is ever there; what it WOULD do is invite the WebView's own "save this password?"
       machinery and, on some keyboards, a different layout — risking the whole flow to remove a character that is
       on screen for one frame, the same frame a normal password field shows it for. -->
  <input id="t" type="text" inputmode="text" placeholder="${esc(WORDS.hint)}"
    autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="go">
  <div id="b">
    <button id="d" type="button">${esc(WORDS.done)}</button>
    <button id="c" type="button">${esc(WORDS.cancel)}</button>
  </div>
</div>
</div>
<script>${body}</script>
</body></html>`;
  return { html, origin: o.origin };
}

export const PANEL_PAGE_WORDS = WORDS;
export const PANEL_PAGE_CLOCK = { QUIET_MS, BUSY_MS, BUSY_FOR_MS, TAP_SLOP };
