/**
 * The public /download page — OS-aware desktop-app download landing.
 *
 * Served straight from the backend (same pattern as /privacy and /terms) so it
 * works on every host Caddy proxies here, including tailzu.space/download.
 * The installer binaries themselves are static files under /downloads/ (see
 * server.ts) with STABLE names — publishing a new version is just replacing
 * the file on the server; no HTML or link changes:
 *
 *   downloads/Tailzu-Setup.exe   ← Windows (NSIS one-click)
 *   downloads/Tailzu.dmg         ← macOS
 *   downloads/Tailzu.AppImage    ← Linux
 *
 * The page HEAD-checks each file and marks missing ones "coming soon", so it
 * can ship before every platform's installer exists.
 *
 * WINDOWS GOES TO THE MICROSOFT STORE FIRST, once its listing is set
 * (catalog.WINDOWS_STORE_ID). The installer is unsigned and Windows warns
 * about it; the Store copy is signed by Microsoft, installs without a warning
 * and updates itself. The installer stays one small link below, for a PC
 * without the Store, and the SmartScreen note goes with it.
 */
import { siteShell } from "./policies/shell.js";
import { crumbsLd, pageLd } from "../seo/head.js";
import { SITE_UI } from "../experience/catalog.js";

const DESCRIPTION = "Tailzu for Windows and Mac: tap Ctrl twice, talk, and clean text lands wherever your cursor is. Also on iPhone and Android.";


const CSS = `
  .get { margin: 40px 0 0; }
  .hint { color: var(--dim); font-size: 14px; margin: 12px 0 0; min-height: 22px; text-transform: none; }
  .others { margin: 36px 0 0; display: flex; gap: 10px; flex-wrap: wrap; }
  .others:not(:empty)::before { content: "Also for"; display: block; width: 100%; font-family: var(--mono); font-size: 12px; letter-spacing: .2em; text-transform: uppercase; color: var(--dim); }
  .other { display: inline-flex; align-items: center; min-height: 42px; padding: 0 18px; border: 1px solid var(--rule); border-radius: 999px; color: var(--white); text-decoration: none; font-size: 14px; transition: border-color .2s; }
  .other:hover { border-color: var(--white); }
  .other.disabled { opacity: .4; pointer-events: none; }
  .foot { margin: 56px 0 0; color: var(--dim); font-size: 14px; max-width: 60ch; text-transform: none; }
  .alt { margin: 14px 0 0; font-size: 14px; color: var(--dim); text-transform: none; }
  .alt a { color: var(--white); }
  .alt[hidden] { display: none; }
`;

/** What the page says about Windows trust, by whether a Store listing exists. */
const windowsNote = (winStore: string) => winStore
  ? "On Windows, get Tailzu from the Microsoft Store: Microsoft checks and signs it, it installs without a warning, and it updates itself. The installer link is for a PC without the Store; Windows may show a SmartScreen prompt for it on first run (“More info”, then “Run anyway”)."
  : "Windows may show a SmartScreen prompt on first run: choose “More info”, then “Run anyway”.";

/** The page, for a Windows Store listing ("" while there is none). */
export function downloadPageHtml(winStore: string): string {
  return siteShell({
    title: "Download for desktop",
    headTitle: "Download Tailzu for Windows and Mac — Voice Typing at Your Cursor",
    path: "/download",
    description: DESCRIPTION,
    ld: [
      pageLd("/download", "Download Tailzu", DESCRIPTION),
      crumbsLd([["Tailzu", "/"], ["Download", "/download"]]),
    ],
    css: CSS,
    main: `
<p class="eye">Desktop</p>
<h1>Tailzu for your computer.</h1>
<p class="lede">Press a hotkey, talk, and clean, polished text lands wherever your cursor is. Works in every app.</p>

<div class="get">
  <a id="main" class="btn disabled" href="#">Detecting your system…</a>
  <div id="hint" class="hint"></div>
  <p id="alt" class="alt" hidden>Or <a id="altLink" href="/downloads/Tailzu-Setup.exe">download the installer</a> instead.</p>
</div>

<div class="others" id="others"></div>

<p class="foot">${windowsNote(winStore)}</p>
<p class="foot">On your phone: <a href="${SITE_UI.stores.ios}">App Store</a> · <a href="${SITE_UI.stores.android}">Google Play</a></p>`,
    script: `
  var FILES = {
    win:   { label: "Download for Windows", file: "/downloads/Tailzu-Setup.exe" },
    mac:   { label: "Download for macOS",   file: "/downloads/Tailzu.dmg" },
    linux: { label: "Download for Linux",   file: "/downloads/Tailzu.AppImage" },
  };
  // The Microsoft Store listing, when there is one: Windows goes there first.
  var WIN_STORE = ${JSON.stringify(winStore)};

  function detectOS() {
    var ua = navigator.userAgent;
    if (/Windows/i.test(ua)) return "win";
    if (/Mac OS X|Macintosh/i.test(ua)) return "mac";
    if (/Linux/i.test(ua)) return "linux";
    return "win";
  }

  function head(url) {
    return fetch(url, { method: "HEAD" }).then(function (r) { return r.ok; }).catch(function () { return false; });
  }

  var os = detectOS();
  var main = document.getElementById("main");
  var hint = document.getElementById("hint");
  var others = document.getElementById("others");

  // Windows with a Store listing: the Store is the button, signed and
  // updated by Microsoft; the installer is the small link under it, shown
  // only once it is known to exist. Every other system lists Windows by its
  // Store link too.
  if (WIN_STORE) {
    if (os === "win") {
      main.textContent = "Get it from Microsoft Store";
      main.href = WIN_STORE;
      main.classList.remove("disabled");
      hint.textContent = "Signed by Microsoft. Installs without warnings and keeps itself up to date.";
      head(FILES.win.file).then(function (ok) { if (ok) document.getElementById("alt").hidden = false; });
    } else {
      var w = document.createElement("a");
      w.className = "other";
      w.textContent = "Windows (Microsoft Store)";
      w.href = WIN_STORE;
      others.appendChild(w);
    }
  }

  Object.keys(FILES).forEach(function (key) {
    var f = FILES[key];
    if (key === "win" && WIN_STORE) return;
    head(f.file).then(function (ok) {
      if (key === os) {
        main.textContent = f.label;
        if (ok) {
          main.href = f.file;
          main.classList.remove("disabled");
          hint.textContent = "";
        } else {
          main.classList.add("disabled");
          hint.textContent = "The " + (key === "win" ? "Windows" : key === "mac" ? "macOS" : "Linux") + " build isn’t published yet — check back soon.";
        }
      } else {
        var a = document.createElement("a");
        a.className = "other" + (ok ? "" : " disabled");
        a.textContent = f.label.replace("Download for ", "") + (ok ? "" : " · soon");
        if (ok) a.href = f.file;
        others.appendChild(a);
      }
    });
  });
`,
  });
}

export const DOWNLOAD_PAGE_HTML = downloadPageHtml(SITE_UI.stores.windows);
