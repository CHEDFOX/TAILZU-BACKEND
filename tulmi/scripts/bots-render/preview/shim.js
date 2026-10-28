// THE PREVIEW'S STAND-IN API (preview.ts), in phone.html and desk.html before the renderer. It answers what the app
// would ask the server, from the exported files, and lets nothing else leave the page:
//   POST /v1/app/bootstrap        the bootstrap preview.ts built (BOTS_APP on, BotsKit declared)
//   POST /v1/app/screen           the screen by id + params (canonical key); one it does not have: "Not in this preview"
//   GET  /v1/…                    the sample day's answer, or 404
//   POST / PUT / PATCH / DELETE   the sample's answer when it has one, else { ok: true }
// The phone's navigator (phone/preview.jsx) asks window.__preview directly; both renderers' own calls come through fetch.
(() => {
  "use strict";
  const CLIENT = document.documentElement.getAttribute("data-client") || "phone";
  const own = window.fetch.bind(window);
  const json = (u) => own(u).then((r) => { if (!r.ok) throw new Error(u + " → " + r.status); return r.json(); });
  let manifest;
  const chunks = new Map();
  const data = () => (manifest = manifest || json("data/" + CLIENT + ".json"));
  const chunk = (i) => { if (!chunks.has(i)) chunks.set(i, json("data/" + CLIENT + "-" + i + ".json")); return chunks.get(i); };

  /** The key a screen is stored under: preview.ts's canon(). */
  const canon = (id, params) => {
    const p = params || {};
    const keys = Object.keys(p).filter((k) => p[k] !== undefined && p[k] !== null).sort();
    return (id === "home" ? "bots.home" : id) + "?" + keys.map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(String(p[k]))).join("&");
  };
  const copy = (x) => JSON.parse(JSON.stringify(x));

  async function screen(id, params) {
    const m = await data();
    const k = canon(id, params);
    const at = m.index[k];
    if (at !== undefined) { const c = await chunk(at); if (c[k]) return copy(c[k]); }
    const miss = copy(m.missing);
    miss.screenId = id;
    try { console.info("[preview] not in this preview: " + k); } catch (e) { /* quiet */ }
    return miss;
  }

  function answer(m, method, url) {
    const path = url.pathname + url.search;
    const a = m.api;
    if ((method + " " + path) in a) return a[method + " " + path];
    if ((method + " " + url.pathname) in a) return a[method + " " + url.pathname];
    // The same read with other query values (a tz, a limit): the one the sample has.
    const pre = method + " " + url.pathname + "?";
    for (const k in a) if (k.indexOf(pre) === 0) return a[k];
    return undefined;
  }

  const reply = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "content-type": "application/json" } });

  async function api(method, url, body) {
    const m = await data();
    if (url.pathname === "/v1/app/bootstrap") return reply(m.boot);
    if (url.pathname === "/v1/app/screen") {
      const b = body ? JSON.parse(body) : {};
      return reply(await screen(b.screenId, b.params));
    }
    const got = answer(m, method, url);
    if (got !== undefined) return reply(got);
    if (method === "GET" || method === "HEAD") return reply({ error: "not in this preview" }, 404);
    return reply({ ok: true });
  }

  window.fetch = async (input, init) => {
    const req = typeof input === "string" || input instanceof URL ? null : input;
    const url = new URL(req ? req.url : String(input), location.href);
    // The preview's own files.
    if (url.origin === location.origin) return own(input, init);
    const method = String((init && init.method) || (req && req.method) || "GET").toUpperCase();
    if (url.pathname.indexOf("/v1/") === 0) {
      let body = init && init.body;
      if (body == null && req) body = await req.text();
      return api(method, url, typeof body === "string" ? body : undefined);
    }
    // Anywhere else: nothing leaves this page.
    return new Response("", { status: 404 });
  };

  // A link out (openUrl): the preview stays where it is.
  window.open = (u) => { try { console.info("[preview] would open " + u); } catch (e) { /* quiet */ } return null; };

  window.__preview = { client: CLIENT, boot: () => data().then((m) => copy(m.boot)), screen, canon };
})();
