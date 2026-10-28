// The Electron bridge (preload.js's window.tailzuApp) for desk.html, the way render.ts stands it in: signed in, a Mac,
// notes on; every other call does nothing. And the preview page's controls: jump, back, what is showing.
(() => {
  "use strict";
  const s = { access_token: "preview", refresh_token: "preview", expires_at: 4102444800 };
  const noop = () => undefined;
  const known = {
    env: async () => ({ baseUrl: "https://api.local", session: s, appVersion: "1.0.0", os: "mac", launchCount: 3, notes: true }),
    session: async () => s, setSession: async (x) => x, config: async () => ({}), askSetup: async () => null,
    folders: async () => ({ custom: false, folders: [], error: "" }),
  };
  window.tailzuApp = new Proxy(known, { get: (t, k) => (k in t ? t[k] : noop) });
  // sdui.js's own names (a classic script's top-level bindings), read when called.
  /* global go, back, STACK */
  window.__previewGo = (id, params) => go(id, params || {});
  window.__previewBack = () => back();
  window.__previewTop = () => { const t = STACK[STACK.length - 1]; return t ? { screenId: t.screenId, params: t.params || {}, depth: STACK.length } : null; };
})();
