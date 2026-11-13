/**
 * FOLLOW-THROUGH'S REAL PHONE CALL (screens/bots/followPhone.ts, botsBots/followPhone.ts): the person's own number, as GET
 * /v1/botsapp/bots/plan/phone answers it, in each of its states: none (type it), pending (call X0 once from it and type the code), verified (with Change and
 * Remove), stopped (pressed 9 on a call), and calls not switched on here at all.
 */
import { FIXED_NOW } from "../../../src/experience/bots/fixtures.js";
import type { PhoneView } from "../../../src/botsBots/followPhone.js";

const PHONE = "/v1/botsapp/bots/plan/phone";
const base: PhoneView = {
  ready: true, on: true, state: "none", display: "", callTo: null, code: null, until: null,
  quiet: "Never in your quiet hours (11 pm to 7 am).",
};

const views: Record<"none" | "pending" | "verified" | "stopped" | "off", PhoneView> = {
  none: { ...base, on: false, quiet: "Never between 10 pm and 7 am. Set quiet hours in What pings you to change that." },
  pending: { ...base, state: "pending", display: "+91 98••• ••210", callTo: { display: "+91 80412 34567", number: "+918041234567" }, code: "4821", until: FIXED_NOW + 30 * 60_000 },
  verified: { ...base, state: "verified", display: "+91 98••• ••210" },
  stopped: { ...base, on: false, state: "stopped", display: "+91 98••• ••210" },
  off: { ...base, ready: false, on: false },
};

/** One state's answer. */
export const phoneApi = (v: keyof typeof views): Record<string, unknown> => ({ [`GET ${PHONE}`]: views[v] });
