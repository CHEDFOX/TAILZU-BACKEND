// AsyncStorage for the preview's phone: the living cards' "once" (BotCard: a card closed on this device stays closed)
// is kept in the page's localStorage; every other key is forgotten, as the do-nothing stub always did.
const KEEP = /^tz\.botcard\./;
const store = () => { try { return window.localStorage; } catch { return null; } };
const known = {
  getItem: async (k) => (KEEP.test(k) && store() ? store().getItem(k) : null),
  setItem: async (k, v) => { if (KEEP.test(k) && store()) store().setItem(k, String(v)); },
  removeItem: async (k) => { if (KEEP.test(k) && store()) store().removeItem(k); },
  multiGet: async (keys) => Promise.all(keys.map(async (k) => [k, await known.getItem(k)])),
  getAllKeys: async () => [],
};
const api = new Proxy(known, { get: (t, k) => (k === "__esModule" ? false : k in t ? t[k] : async () => null) });
module.exports = api;
