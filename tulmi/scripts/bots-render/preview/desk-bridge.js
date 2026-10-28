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
    // The microphone, as this computer would answer: not asked yet, until the page asks (and the stand-in below says yes).
    micStatus: async () => window.__previewMic || "not-determined",
  };
  // The system's microphone prompt, answered yes (as the phone preview's expo-audio stand-in does): a silent stream.
  try {
    const md = navigator.mediaDevices || (navigator.mediaDevices = {});
    md.getUserMedia = async () => { window.__previewMic = "granted"; return { getTracks: () => [] }; };
  } catch { /* a page that cannot: the card's own refusal path */ }
  window.tailzuApp = new Proxy(known, { get: (t, k) => (k in t ? t[k] : noop) });
  // sdui.js's own names (a classic script's top-level bindings), read when called.
  /* global go, back, STACK */
  window.__previewGo = (id, params) => go(id, params || {});
  window.__previewBack = () => back();
  window.__previewTop = () => { const t = STACK[STACK.length - 1]; return t ? { screenId: t.screenId, params: t.params || {}, depth: STACK.length } : null; };
})();
