/**
 * `vars`: THE ONE WAY A FUTURE DESIGN BINDS NEW DATA (shared/types/nlook.ts BIND_PATHS "vars.*"; native/SPEC.md sections 2.6 and 7).
 *
 * Everything else a design may bind is a field the glance or the Live Activity's ContentState already carries, and both of those are
 * frozen shapes. `vars` is the free map beside them: the server fills it, a design reads "{{vars.eta}}", and neither the struct on
 * the phone nor this file's callers have to change for a new design to show something new.
 *
 * THE PRIVACY RULE LIVES HERE, not in any design. A free string cannot be classified by a renderer, so `vars.*` is SENSITIVE BY
 * DEFAULT: on a lock or accessory root it resolves to the lock-safe fill. That is the renderer's half. This is the server's half —
 * a var whose words could say what a person wrote or a bot read is NOT SENT AT ALL while the thing it describes is private. A design
 * cannot opt out of either half.
 */
import { NLOOK_LIMITS } from "../../../../shared/types/nlook.js";

/** One candidate var. `safe` means its words can never be private — a count, a number of minutes, a stage name we wrote ourselves. */
export interface VarIn { key: string; value: string | number | null | undefined; safe?: boolean }

export interface VarOptions {
  /** The thing these vars describe is private (a question the bot marked private, a kind in x0.needs.private). */
  private?: boolean;
}

/**
 * The vars as they may travel: at most 12 keys, a key at most 24 characters, a value at most 120, every empty one left out, and
 * every unsafe one left out while the thing is private. Keys are sorted, so the same facts always encode to the same bytes and the
 * Activity's "has anything a person would see changed?" signature does not flap.
 */
export function buildVars(vars: readonly VarIn[], o: VarOptions = {}): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  const keys: string[] = [];
  for (const v of vars) {
    if (o.private && v.safe !== true) continue;
    const key = String(v.key ?? "").slice(0, NLOOK_LIMITS.vars.keyChars);
    if (!key || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) continue;
    const value = v.value === null || v.value === undefined ? "" : String(v.value).replace(/\s+/g, " ").trim();
    if (!value) continue;
    if (!Object.prototype.hasOwnProperty.call(out, key)) keys.push(key);
    out[key] = value.slice(0, NLOOK_LIMITS.vars.valueChars);
  }
  keys.sort();
  const kept = keys.slice(0, NLOOK_LIMITS.vars.keys);
  if (!kept.length) return undefined;
  return Object.fromEntries(kept.map((k) => [k, out[k]!]));
}

const MIN = 60_000;

/**
 * The widget's vars: what the server already works out and the glance has no field for.
 *   moved   how many things changed since the person last looked (the same count the summary and the AI digest are told)
 *   since   whole minutes since their last look ended
 * Both are numbers we counted ourselves, so both are safe on a Lock Screen.
 */
export function widgetVars(i: { now: number; sinceAt: number | null; moved: number }, o: VarOptions = {}): Record<string, string> | undefined {
  return buildVars([
    { key: "moved", value: i.moved > 0 ? i.moved : null, safe: true },
    { key: "since", value: i.sinceAt ? Math.max(1, Math.round((i.now - i.sinceAt) / MIN)) : null, safe: true },
  ], o);
}

/**
 * The Live Activity's vars:
 *   left    stages still to go
 *   eta     a rough guess at the minutes left, from how long the stages so far took. Only once a stage has finished and a minute
 *           has passed, so it is never a number made from nothing, and never above two hours
 * Both are numbers, so both are safe; the private rule still drops them if a caller ever marks one unsafe.
 */
export function activityVars(i: { now: number; startedAt: number; stage: number; of: number; phase: string }, o: VarOptions = {}): Record<string, string> | undefined {
  const left = Math.max(0, Math.round(i.of) - Math.round(i.stage));
  const elapsed = Math.floor((i.now - i.startedAt) / MIN);
  const done = Math.max(0, Math.round(i.stage) - 1);
  const eta = i.phase === "working" && done >= 1 && elapsed >= 1 ? Math.round((elapsed / done) * left) : 0;
  return buildVars([
    { key: "left", value: left > 0 ? left : null, safe: true },
    { key: "eta", value: eta >= 1 && eta <= 120 ? eta : null, safe: true },
  ], o);
}
