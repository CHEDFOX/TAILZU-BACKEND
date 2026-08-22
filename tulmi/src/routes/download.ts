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
 */

export const DOWNLOAD_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Download Tailzu for Desktop</title>
<style>
  :root { --bg:#0e0e13; --card:#17171f; --text:#f5f0e8; --dim:#9a94a6; --accent:#E8A23C; }
  * { box-sizing: border-box; margin: 0; }
  body {
    background: var(--bg); color: var(--text); min-height: 100vh;
    font: 16px/1.6 -apple-system, "Segoe UI", system-ui, sans-serif;
    display: flex; align-items: center; justify-content: center; padding: 24px;
  }
  .wrap { max-width: 560px; width: 100%; text-align: center; }
  .mark {
    width: 64px; height: 64px; border-radius: 50%; background: var(--accent);
    margin: 0 auto 20px;
  }
  h1 { font-size: 30px; margin-bottom: 8px; }
  .sub { color: var(--dim); margin-bottom: 32px; }
  .primary {
    display: inline-block; background: var(--accent); color: #14100c;
    font-weight: 700; font-size: 17px; padding: 15px 34px; border-radius: 14px;
    text-decoration: none; transition: transform .12s ease;
  }
  .primary:hover { transform: translateY(-1px); }
  .primary.disabled { opacity: .45; pointer-events: none; }
  .hint { color: var(--dim); font-size: 13px; margin-top: 10px; min-height: 20px; }
  .others { margin-top: 40px; display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .other {
    background: var(--card); color: var(--text); text-decoration: none;
    padding: 10px 18px; border-radius: 10px; font-size: 14px;
  }
  .other.disabled { opacity: .4; pointer-events: none; }
  .foot { margin-top: 44px; color: var(--dim); font-size: 12.5px; }
  .foot a { color: var(--dim); }
</style>
</head>
<body>
  <div class="wrap">
    <div class="mark"></div>
    <h1>Tailzu for Desktop</h1>
    <p class="sub">Press a hotkey, talk, and clean polished text lands wherever your cursor is. Works in every app.</p>

    <a id="main" class="primary disabled" href="#">Detecting your system…</a>
    <div id="hint" class="hint"></div>

    <div class="others" id="others"></div>

    <p class="foot">
      Windows may show a SmartScreen prompt on first run — choose “More info → Run anyway”.<br/>
      <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
    </p>
  </div>

<script>
  var FILES = {
    win:   { label: "Download for Windows", file: "/downloads/Tailzu-Setup.exe" },
    mac:   { label: "Download for macOS",   file: "/downloads/Tailzu.dmg" },
    linux: { label: "Download for Linux",   file: "/downloads/Tailzu.AppImage" },
  };

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

  Object.keys(FILES).forEach(function (key) {
    var f = FILES[key];
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
</script>
</body>
</html>`;
