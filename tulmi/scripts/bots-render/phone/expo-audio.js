// expo-audio for the preview: the microphone's permission, answered yes (and remembered on the preview's stand-in for
// the phone's readings, window.__previewDevice); every other export is the do-nothing stub (./stub.js).
const stub = require("./stub.js");

const device = () => (window.__previewDevice = window.__previewDevice || { keyboardEnabled: false, keyboardReady: false, micGranted: false });
const own = {
  requestRecordingPermissionsAsync: async () => { device().micGranted = true; return { granted: true, canAskAgain: true, status: "granted" }; },
  getRecordingPermissionsAsync: async () => ({ granted: !!device().micGranted, canAskAgain: true, status: device().micGranted ? "granted" : "undetermined" }),
};
const AudioModule = new Proxy(own, { get: (t, k) => (k in t ? t[k] : stub.AudioModule[k]) });
const pick = (k) => (k === "AudioModule" ? AudioModule : stub[k]);
const proto = new Proxy({}, { get: (_t, k) => (k === "then" ? undefined : pick(k)) });
module.exports = new Proxy({}, {
  get: (_t, k) => (k === "__esModule" ? true : k === "then" ? undefined : pick(k)),
  getPrototypeOf: () => proto,
});
