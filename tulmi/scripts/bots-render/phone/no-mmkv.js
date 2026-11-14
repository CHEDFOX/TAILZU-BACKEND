// react-native-mmkv, as a phone WITHOUT it: `createMMKV` throws, which is what the library itself does when the native side is
// not in the binary. The app's own fallback then runs (TAILZU-FRONTEND app/src/sdui/local.ts `mmkvKV()` catches it and keeps
// `local.*` in memory, mirrored to AsyncStorage), so the preview takes the same path as a build without MMKV.
//
// Without this the general stub (stub.js) answers every call with null, so `createMMKV(...)` returns null, the KV is built
// around it, and the first `local.*` read throws "Cannot read properties of null (reading 'getAllKeys')" — the whole screen
// then draws nothing, with no clue why.
const nope = () => { throw new Error("react-native-mmkv is not in this binary (bots-render)"); };

module.exports = new Proxy({ createMMKV: nope, MMKV: nope, useMMKV: nope }, {
  get: (t, k) => (k === "__esModule" ? false : k in t ? t[k] : nope),
});
