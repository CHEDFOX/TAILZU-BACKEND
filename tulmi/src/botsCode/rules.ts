/**
 * PROJECT RULES, AS A PERSON SAYS THEM (bots.code.rules): "Open pull requests: Yes", "Merge: Asks you", "Push to main:
 * Never", over the project's standing permissions (code/policy.ts grants). Pure: the route reads the grants, asks
 * `ruleChange` what to take back and what to add, and does it through the store.
 *
 *   prs    pr.open_draft          a free action: Yes (no grant) or Never (a deny). It cannot "ask": the policy never asks about it.
 *   merge  pr.merge               asks by default; Yes is an allow, Never a deny.
 *   main   commit.other_branch    on the default branch only: asks by default; Never keeps main changing through pull requests only.
 *
 * A deny beats an allow, as in the policy itself.
 */

export type RuleId = "prs" | "merge" | "main";
export type RuleValue = "yes" | "ask" | "never";

export interface RuleDef {
  id: RuleId;
  action: string;
  /** The default branch's name goes here for "main". */
  onDefaultBranch: boolean;
  /** What it is with no grant at all. */
  fallback: RuleValue;
  /** The values it can take. */
  values: RuleValue[];
}

export const RULES: readonly RuleDef[] = [
  { id: "prs", action: "pr.open_draft", onDefaultBranch: false, fallback: "yes", values: ["yes", "never"] },
  { id: "merge", action: "pr.merge", onDefaultBranch: false, fallback: "ask", values: ["yes", "ask", "never"] },
  { id: "main", action: "commit.other_branch", onDefaultBranch: true, fallback: "ask", values: ["yes", "ask", "never"] },
];

export const isRuleId = (v: unknown): v is RuleId => RULES.some((r) => r.id === v);
export const isRuleValue = (v: unknown): v is RuleValue => v === "yes" || v === "ask" || v === "never";

export interface GrantLite { id: string; action: string; branchPattern?: string; effect: "allow" | "deny"; expiresAt?: number }

const patternOf = (r: RuleDef, defaultBranch: string): string => (r.onDefaultBranch ? defaultBranch : "");
const matches = (g: GrantLite, r: RuleDef, defaultBranch: string, now: number): boolean =>
  g.action === r.action && (g.branchPattern ?? "") === patternOf(r, defaultBranch) && (g.expiresAt === undefined || g.expiresAt > now);

/** Each rule's value, from the grants. */
export function rulesFrom(grants: GrantLite[], defaultBranch: string, now = Date.now()): Record<RuleId, RuleValue> {
  const out = {} as Record<RuleId, RuleValue>;
  for (const r of RULES) {
    const mine = grants.filter((g) => matches(g, r, defaultBranch, now));
    out[r.id] = mine.some((g) => g.effect === "deny") ? "never" : mine.some((g) => g.effect === "allow") ? "yes" : r.fallback;
  }
  return out;
}

/** The value after `v` when a row is tapped (the phone's rows cycle). */
export function nextValue(id: RuleId, v: RuleValue): RuleValue {
  const vals = RULES.find((r) => r.id === id)!.values;
  return vals[(vals.indexOf(v) + 1) % vals.length]!;
}

/** What to take back and what to add so the rule reads `to`. Throws for a value the rule cannot take. */
export function ruleChange(id: RuleId, to: RuleValue, grants: GrantLite[], defaultBranch: string, now = Date.now()): {
  remove: string[]; add: { action: string; branchPattern?: string; effect: "allow" | "deny" } | null;
} {
  const r = RULES.find((x) => x.id === id)!;
  if (!r.values.includes(to)) throw new Error(`${id} can't be "${to}"`);
  const remove = grants.filter((g) => matches(g, r, defaultBranch, now)).map((g) => g.id);
  const pattern = patternOf(r, defaultBranch);
  const grant = (effect: "allow" | "deny") => ({ action: r.action, ...(pattern ? { branchPattern: pattern } : {}), effect });
  if (to === r.fallback) return { remove, add: null };
  return { remove, add: grant(to === "never" ? "deny" : "allow") };
}

/** A rule's value as the screen says it. */
export const ruleWord = (v: RuleValue): string => (v === "yes" ? "Yes" : v === "ask" ? "Asks you" : "Never");
