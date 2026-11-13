/**
 * THE LIVE ACTIVITY'S 3.5 KB (native/SPEC.md sections 2.9 and 3.3). Apple's cap is 4 KB, and `Activity.request` and `update` above it
 * FAIL SILENTLY — no error, no push, nothing on the Lock Screen — so the size is measured rather than trusted.
 *
 * Three readers must land on the same answer for the same input: this file, BotsLiveActivity.parse() on the phone, and the JS
 * activity plan. So the order things are given up in is written down once, here, and the fixtures
 * (shared/native/fixtures/activity.json, body.overBudget.dropsVars) are the referee:
 *
 *   1. `vars` goes first. It is the extra, and a design that reads one degrades to an empty string rather than to nothing.
 *   2. then the stage NAMES are trimmed, then given up: the bar still draws from `stage` and `of`.
 *   3. then the long words are cut. A body always, always ends under the cap.
 */
import { NLOOK_LIMITS } from "../../../../shared/types/nlook.js";

/** The cap this server, the phone's parse() and the JS plan all stop at. Apple's own is 4 KB. */
export const ACTIVITY_BODY_BYTES = NLOOK_LIMITS.activityBodyBytes;

/** What a content state encodes to, in bytes: what the phone's JSONEncoder would produce for the same fields. */
export function bodyBytes(state: unknown): number {
  return Buffer.byteLength(JSON.stringify(state), "utf8");
}

/** Cut words at a word where it can, so a trimmed task still reads as words rather than as a half one. */
function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const hard = s.slice(0, max);
  const at = hard.lastIndexOf(" ");
  return (at > max * 0.6 ? hard.slice(0, at) : hard).trimEnd();
}

export interface FitResult<T> {
  state: T;
  bytes: number;
  /** What was given up, in the order it went, for the log and the tests. Empty means it fitted as it was. */
  gave: string[];
}

/**
 * The state as it may be pushed. Never throws and never refuses: something is always given up until it fits, because the one thing
 * worse than a shorter line on the Lock Screen is a push Apple drops without telling anyone.
 */
export function fitActivityBody<T extends Record<string, unknown>>(state: T, cap = ACTIVITY_BODY_BYTES): FitResult<T> {
  const gave: string[] = [];
  let s: Record<string, unknown> = { ...state };
  const bytes = () => bodyBytes(s);
  if (bytes() <= cap) return { state: s as T, bytes: bytes(), gave };

  if (s.vars !== undefined) { delete s.vars; gave.push("vars"); if (bytes() <= cap) return { state: s as T, bytes: bytes(), gave }; }

  if (Array.isArray(s.stages) && s.stages.length) {
    for (const max of [24, 12, 6]) {
      s = { ...s, stages: (s.stages as unknown[]).map((n) => cut(String(n), max)) };
      if (bytes() <= cap) { gave.push(`stage names cut to ${max}`); return { state: s as T, bytes: bytes(), gave }; }
    }
    s = { ...s, stages: [] };
    gave.push("stage names");
    if (bytes() <= cap) return { state: s as T, bytes: bytes(), gave };
  }

  // The long words, longest first. The view keeps drawing: an empty one simply hides.
  for (const key of ["question", "result", "task"] as const) {
    const v = typeof s[key] === "string" ? (s[key] as string) : "";
    if (!v) continue;
    for (const max of [120, 60, 30]) {
      if (v.length <= max) continue;
      s = { ...s, [key]: cut(v, max) };
      if (bytes() <= cap) { gave.push(`${key} cut to ${max}`); return { state: s as T, bytes: bytes(), gave }; }
    }
  }

  // Nothing of ours is left to give. Drop the answers, then the stage list entirely, rather than send a body Apple ignores.
  if (Array.isArray(s.choices) && s.choices.length) {
    s = { ...s, choices: [] };
    gave.push("choices");
    if (bytes() <= cap) return { state: s as T, bytes: bytes(), gave };
  }
  delete s.stages;
  gave.push("stages");
  return { state: s as T, bytes: bytes(), gave };
}

/** The `vars` map clamped on its own, before anything is measured: 12 keys, a key 24 characters, a value 120. */
export function clampVars(vars: unknown): Record<string, string> | undefined {
  if (!vars || typeof vars !== "object" || Array.isArray(vars)) return undefined;
  const keys = Object.keys(vars as Record<string, unknown>).sort().slice(0, NLOOK_LIMITS.vars.keys);
  const out: Record<string, string> = {};
  for (const k of keys) {
    const key = k.slice(0, NLOOK_LIMITS.vars.keyChars);
    const v = (vars as Record<string, unknown>)[k];
    const value = v === null || v === undefined ? "" : String(v).slice(0, NLOOK_LIMITS.vars.valueChars);
    if (key && value) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}
