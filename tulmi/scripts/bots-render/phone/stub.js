// Any native module the phone's renderer imports that a browser cannot have: every export is a do-nothing that
// draws nothing. Named imports resolve through the prototype, so `import { anything } from "x"` works.
const fn = function stub() { return null; };
const deep = new Proxy(fn, {
  get(_t, k) {
    if (k === "__esModule") return true;
    if (k === Symbol.toPrimitive) return () => "";
    if (k === "then") return undefined;
    // A plain prototype, so React draws a stub as a function component (null), not as a class.
    if (k === "prototype") return {};
    return deep;
  },
  apply() { return null; },
  construct() { return deep; },
});
const proto = new Proxy({}, { get: (_t, k) => (k === "then" ? undefined : deep) });
module.exports = new Proxy({}, {
  get: (_t, k) => (k === "__esModule" ? true : k === "then" ? undefined : deep),
  getPrototypeOf: () => proto,
});
