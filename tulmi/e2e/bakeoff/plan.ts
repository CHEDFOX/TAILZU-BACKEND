/**
 * THE DRY PLAN: WHAT THE BAKE-OFF WOULD RUN AND WHAT IT WOULD COST, BEFORE A RUPEE IS SPENT.
 *
 * Per tier, the candidates after the capability filter (and the ones dropped, with the reason), then the estimated cost in rupees of each round: the
 * probes, the role evals, the real tasks, at the catalog's prices and CODE_USD_INR. Two totals: with every candidate going the whole way, and with the
 * early stop at work (assumed: 60% of candidates go past the probes, 40% past the evals), which is what a run is expected to cost.
 */
import { loadFixtures, ROLE_TIER } from "../../scripts/eval-prompts.js";
import { ROLE_IDS } from "../../src/principles/index.js";
import { REAL_SHAPE } from "../smoke/estimate.js";
import type { Filtered } from "./capability.js";
import { EDIT_CASES, EDIT_FORMATS } from "./editformat.js";
import { BAKEOFF_TIERS, type BakeoffTier } from "./pools.js";
import { ALL_PROBES, TINY_PROBES } from "./probes.js";

export interface PlanOptions { fx: number; tiers: BakeoffTier[]; evalRuns: number; taskCount: number; editFormat: boolean; probesOnly: boolean; needleTokens: number }

export interface TierPlan {
  tier: BakeoffTier;
  candidates: Array<{ slug: string; inUsdPerM: number; outUsdPerM: number }>;
  fixtures: number;
  inr: { probes: number; edit: number; evals: number; tasks: number; total: number; early: number };
}

export interface Plan { tiers: TierPlan[]; excluded: Filtered["excluded"]; totalInr: number; earlyInr: number; fx: number; note: string }

const usd = (tin: number, tout: number, p: { inUsdPerM: number; outUsdPerM: number }): number => (tin * p.inUsdPerM + tout * p.outUsdPerM) / 1e6;

export function fixturesPerTier(): Record<BakeoffTier, number> {
  const out = Object.fromEntries(BAKEOFF_TIERS.map((t) => [t, 0])) as Record<BakeoffTier, number>;
  for (const role of ROLE_IDS) { const t = ROLE_TIER[role] as string; if (t in out) out[t as BakeoffTier] += loadFixtures(role).fixtures.length; }
  return out;
}

export function planBakeoff(f: Filtered, o: PlanOptions): Plan {
  const fix = fixturesPerTier();
  const tiers: TierPlan[] = [];
  for (const tier of o.tiers) {
    const cands = f.candidates[tier].map((c) => ({ slug: c.slug, inUsdPerM: c.info.inUsdPerM, outUsdPerM: c.info.outUsdPerM }));
    const tool = tier === "code" || tier === "strong";
    const probes = (o.probesOnly ? TINY_PROBES : ALL_PROBES).filter((p) => (tier === "vision" ? ["image", "json_contract"].includes(p.id) : tier === "tiny" ? ["json_contract", "principles", "hindi"].includes(p.id) : tier === "cheap" ? ["json_contract", "principles", "hindi", "tool_call"].includes(p.id) : p.id !== "image"));
    const sum = (price: { inUsdPerM: number; outUsdPerM: number }, ps = probes): number => ps.reduce((n, p) => n + usd(p.tokens.in + (p.id === "needle" ? o.needleTokens : 0), p.tokens.out, price), 0);
    let probesInr = 0, editInr = 0, evalsInr = 0, tasksInr = 0, earlyInr = 0;
    for (const c of cands) {
      const p = sum(c) * o.fx;
      const e = o.editFormat && tool ? EDIT_CASES.length * EDIT_FORMATS.length * usd(700, 200, c) * o.fx : 0;
      const ev = o.probesOnly ? 0 : fix[tier] * o.evalRuns * usd(1400, 350, c) * o.fx;
      const t = !o.probesOnly && tool ? o.taskCount * usd(REAL_SHAPE.bug!.inTokens, REAL_SHAPE.bug!.outTokens, c) * o.fx : 0;
      probesInr += p; editInr += e; evalsInr += ev; tasksInr += t;
      earlyInr += p + e + 0.6 * ev + 0.4 * t;
    }
    tiers.push({ tier, candidates: cands, fixtures: fix[tier], inr: { probes: probesInr, edit: editInr, evals: evalsInr, tasks: tasksInr, total: probesInr + editInr + evalsInr + tasksInr, early: earlyInr } });
  }
  // A model that is a candidate for several tiers is probed once per tier here (an upper bound: a real run shares a model's probes).
  const totalInr = tiers.reduce((n, t) => n + t.inr.total, 0);
  const earlyInr = tiers.reduce((n, t) => n + t.inr.early, 0);
  return { tiers, excluded: f.excluded, totalInr, earlyInr, fx: o.fx, note: "estimates at OpenRouter's catalog prices; a model in several tiers is counted once per tier (an upper bound); each real task is counted at the size of a bug fix on a real project (about 170k tokens in, 11k out)" };
}

export function renderPlan(p: Plan): string {
  const L: string[] = [];
  L.push(`BAKE-OFF PLAN (₹ at ${p.fx} per dollar)`);
  for (const t of p.tiers) {
    L.push("", `${t.tier}: ${t.candidates.length} candidate(s) after the capability filter, ${t.fixtures} role-eval fixtures`);
    for (const c of t.candidates) L.push(`    ${c.slug.padEnd(36)} $${c.inUsdPerM.toFixed(2)} in / $${c.outUsdPerM.toFixed(2)} out per M tokens`);
    L.push(`    ₹${t.inr.probes.toFixed(2)} probes${t.inr.edit ? `, ₹${t.inr.edit.toFixed(2)} edit formats` : ""}, ₹${t.inr.evals.toFixed(2)} role evals, ₹${t.inr.tasks.toFixed(2)} real tasks = ₹${t.inr.total.toFixed(2)} (about ₹${t.inr.early.toFixed(2)} with the early stop)`);
  }
  if (p.excluded.length) {
    L.push("", "left out by the capability filter:");
    for (const e of p.excluded) L.push(`    ${e.tier}: ${e.slug} (${e.reason})`);
  }
  L.push("", `TOTAL: ₹${p.totalInr.toFixed(2)} if every candidate goes all the way, about ₹${p.earlyInr.toFixed(2)} with the early stop`, p.note);
  return L.join("\n");
}
