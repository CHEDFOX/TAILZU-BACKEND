/**
 * Flow (dictation from the keyboard) timings the bootstrap, the flow screens and the keyboard all send.
 */

/**
 * Flow Session idle window (ms) — how long the app keeps the background mic
 * warm after the last dictation. ONE constant serves every surface (bootstrap
 * flags, keyboard config, flow_arm screen's armFlowSession action): the same
 * key used to ship 10 min in bootstrap but 5 min in the keyboard config, so
 * app and keyboard disagreed on session lifetime.
 */
export const FLOW_IDLE_TIMEOUT_MS = 600_000;

/**
 * Transport for a Flow dictation: "stream" (socket, live) or "oneshot"
 * (buffer + one POST at stop). Env-overridable so the switch can be thrown
 * without a deploy; see kb.flow.transport for the trade-off.
 */
export const FLOW_TRANSPORT = process.env.FLOW_TRANSPORT === "oneshot" ? "oneshot" : "stream";
