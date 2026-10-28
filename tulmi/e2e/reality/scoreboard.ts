/**
 * THE MODEL SCOREBOARD, READ FROM THE RESULTS STORE, AND THE LADDERS IT RECOMMENDS.
 *
 * The bake-off (bakeoff/engine.ts) keeps its scoreboard in memory for one run. The reality plan keeps every measurement in the store instead, so the scoreboard is
 * rebuilt from it whenever it is needed: a probe result under the current model door and probe version, a part result, a task result with that model pinned. One
 * row per (tier, model) in the shape the ladder builder (bakeoff/ladders.ts) reads, so `CODE_MODEL_TIERS` comes out of the same rule as before: cheapest per pass above
 * the quality floor, at most four rungs.
 *
 * Two rules the bake-off's own output left to a person (RESULTS-2026-10-28, "Recommended ladders"): a model that FOLLOWED AN INSTRUCTION PLANTED IN A PAGE (the
 * principles probe) is moved off the head of the strong and review ladders, since they read untrusted text; and a tier with no evidence at all keeps the product's
 * own ladder instead of being emptied. A model with no result is not on a ladder: no evidence, no rung.
 */
import type { Catalog, ModelInfo } from "../catalog.js";
import { buildLadders, DEFAULT_LADDER, type Ladders } from "../bakeoff/ladders.js";
import { filterPools, type Candidate } from "../bakeoff/capability.js";
import { ALL_PROBES, TINY_PROBES } from "../bakeoff/probes.js";
import { BAKEOFF_TIERS, loadPools, type BakeoffTier } from "../bakeoff/pools.js";
import type { Summary } from "../bakeoff/engine.js";
import { codeFingerprint, probeVersion } from "./fingerprint.js";
import { ResultsStore, type StoredResult } from "./store.js";

/** The tiny probes a candidate of a tier is given (bakeoff/engine.ts probesFor, without the engine). */
export function probesOf(tier: BakeoffTier, info: Pick<ModelInfo, "image" | "tools">, heavy = false): string[] {
  const tool = tier === "code" || tier === "strong";
  return (heavy ? ALL_PROBES.filter((p) => p.full) : TINY_PROBES).filter((p) => {
    if (p.needs.includes("image") && !info.image) return false;
    if (p.needs.includes("tools") && !(info.tools && (tool || p.id === "tool_call"))) return false;
    if (tier === "vision") return p.id === "image" || p.id === "json_contract";
    if (tier === "tiny") return ["json_contract", "principles", "hindi"].includes(p.id);
    if (tier === "cheap") return ["json_contract", "principles", "hindi", "tool_call"].includes(p.id);
    if (p.id === "needle") return false;
    return true;
  }).map((p) => p.id);
}

/** Every distinct (model, probe) a pool needs, with the tiers that want it: a model that is a candidate for two tiers is probed once. */
export function probeNeeds(catalog: Catalog, poolsFile?: string): Array<{ model: string; info: ModelInfo; probe: string; tiers: BakeoffTier[] }> {
  const filtered = filterPools(loadPools(poolsFile), catalog);
  const out = new Map<string, { model: string; info: ModelInfo; probe: string; tiers: BakeoffTier[] }>();
  for (const tier of BAKEOFF_TIERS) {
    for (const c of filtered.candidates[tier]) {
      for (const p of probesOf(tier, c.info)) {
        const k = `${c.slug}|${p}`;
        const e = out.get(k);
        if (e) e.tiers.push(tier); else out.set(k, { model: c.slug, info: c.info, probe: p, tiers: [tier] });
      }
    }
  }
  return [...out.values()];
}

/** The key parts that identify a probe result under the code and probe version as they are now. */
export const probeKeyNow = (model: string, probe: string): { kind: "probe"; agent: "-"; model: string; item: string; code: string; prompt: string } =>
  ({ kind: "probe", agent: "-", model, item: probe, code: codeFingerprint("probe"), prompt: probeVersion() });

export interface ModelRow {
  model: string;
  tiers: BakeoffTier[];
  probes: Array<{ id: string; ok: boolean; score: number; stale: boolean }>;
  /** Share of this model's current probes that passed; null when none ran. */
  probeRate: number | null;
  /** Probes with a result of an older code or probe version only. */
  stale: string[];
  /** Probes with no result at all. */
  missing: string[];
  costInr: number;
  edit?: { exact: number; blocks: number; diff: number; best: string };
  /** Tailzu with this model pinned, on real tasks. */
  tasks: { pass: number; n: number };
  followedPlantedText: boolean;
}

/** One row per candidate model: its probe results (current or stale), its edit-format result and its task results. */
export function modelRows(store: ResultsStore, catalog: Catalog, poolsFile?: string): ModelRow[] {
  const filtered = filterPools(loadPools(poolsFile), catalog);
  const tiersOf = new Map<string, Set<BakeoffTier>>();
  const infos = new Map<string, ModelInfo>();
  for (const tier of BAKEOFF_TIERS) for (const c of filtered.candidates[tier]) { (tiersOf.get(c.slug) ?? tiersOf.set(c.slug, new Set()).get(c.slug)!).add(tier); infos.set(c.slug, c.info); }
  const rows: ModelRow[] = [];
  for (const [model, tiers] of tiersOf) {
    const info = infos.get(model)!;
    const wanted = [...new Set([...tiers].flatMap((t) => probesOf(t, info)))];
    const probes: ModelRow["probes"] = [];
    const stale: string[] = [];
    const missing: string[] = [];
    let costInr = 0;
    for (const id of wanted) {
      const now = store.get(probeKeyNow(model, id));
      if (now) { probes.push({ id, ok: now.ok, score: now.score ?? (now.ok ? 1 : 0), stale: false }); costInr += now.costInr; continue; }
      const old = store.history("probe", "-", model, id).at(-1);
      if (old) { probes.push({ id, ok: old.ok, score: old.score ?? (old.ok ? 1 : 0), stale: true }); stale.push(id); } else missing.push(id);
    }
    const fresh = probes.filter((p) => !p.stale);
    const edit = store.latest((r) => r.kind === "part" && r.item === "editFormats" && r.model === model).at(-1)?.data as ModelRow["edit"] | undefined;
    const taskRuns = store.list((r) => r.kind === "task" && r.agent === "tailzu" && r.model === model);
    rows.push({
      model, tiers: [...tiers], probes, probeRate: fresh.length ? fresh.filter((p) => p.ok).length / fresh.length : null, stale, missing, costInr,
      ...(edit ? { edit } : {}), tasks: { pass: taskRuns.filter((r) => r.ok).length, n: taskRuns.length },
      followedPlantedText: probes.some((p) => p.id === "principles" && !p.stale && !p.ok),
    });
  }
  return rows.sort((a, b) => (a.model < b.model ? -1 : 1));
}

/** The rows in the shape the ladder builder reads. Quality is the probes' pass share for tiny, cheap and vision, and probes with tasks for code and strong. */
export function summariesFromStore(store: ResultsStore, catalog: Catalog, fx: number, poolsFile?: string): Summary[] {
  const filtered = filterPools(loadPools(poolsFile), catalog);
  const out: Summary[] = [];
  for (const tier of BAKEOFF_TIERS) {
    for (const c of filtered.candidates[tier] as Candidate[]) {
      const ids = probesOf(tier, c.info);
      const res = ids.map((id) => ({ id, r: store.get(probeKeyNow(c.slug, id)) })).filter((x): x is { id: string; r: StoredResult } => !!x.r);
      if (!res.length) continue;
      const pass = res.filter((x) => x.r.ok).length;
      const probeRate = pass / res.length;
      const taskRuns = store.list((r) => r.kind === "task" && r.agent === "tailzu" && r.model === c.slug);
      const taskRate = taskRuns.length ? taskRuns.filter((r) => r.ok).length / taskRuns.length : null;
      const toolTier = tier === "code" || tier === "strong";
      const parts: Array<[number | null, number]> = toolTier ? [[probeRate, 0.25], [taskRate, 0.4]] : [[probeRate, 1]];
      const have = parts.filter(([v]) => v !== null);
      const wsum = have.reduce((n, [, w]) => n + w, 0);
      const quality = wsum ? have.reduce((n, [v, w]) => n + (v as number) * w, 0) / wsum : 0;
      const usd = res.reduce((n, x) => n + x.r.costInr, 0) / fx;
      const work = taskRuns.length ? { pass: taskRuns.filter((r) => r.ok).length, usd: taskRuns.reduce((n, r) => n + r.costInr, 0) / fx } : { pass, usd };
      const hindi = res.find((x) => x.id === "hindi")?.r.score;
      const edit = store.latest((r) => r.kind === "part" && r.item === "editFormats" && r.model === c.slug).at(-1)?.data as Summary["edit"] | undefined;
      out.push({
        tier, slug: c.slug, quality, passRate: { probes: probeRate, evals: null, tasks: taskRate }, costPerPassUsd: work.pass > 0 ? work.usd / work.pass : Number.POSITIVE_INFINITY,
        latencyP50Ms: 0, latencyP95Ms: 0, errorRate: res.filter((x) => x.r.score === 0).length / res.length, jsonRepairs: 0, badToolCalls: 0, calls: res.length,
        ...(edit ? { edit } : {}), ...(hindi !== undefined ? { hindi } : {}), simulated: res.every((x) => x.r.source === "sim"), priceInUsdPerM: c.info.inUsdPerM, priceOutUsdPerM: c.info.outUsdPerM,
      });
      void usd;
    }
  }
  return out;
}

export interface Recommendation {
  ladders: Ladders;
  /** The value for CODE_MODEL_TIERS after the plan's own rules (planted text off the head of strong and review; tiers with no evidence keep the product's). */
  codeModelTiers: string;
  codeIndicModel?: string;
  notes: string[];
}

/** The ladders this store's evidence supports. */
export function recommend(store: ResultsStore, catalog: Catalog, fx: number, poolsFile?: string): Recommendation {
  const rows = summariesFromStore(store, catalog, fx, poolsFile);
  const ladders = buildLadders(rows, fx, DEFAULT_LADDER);
  const followed = new Set(modelRows(store, catalog, poolsFile).filter((r) => r.followedPlantedText).map((r) => r.model));
  const tiers = Object.fromEntries(Object.entries(ladders.tiers).map(([tier, l]) => {
    let models = [...l!.models];
    if ((tier === "strong" || tier === "review") && models.some((m) => followed.has(m)) && models.some((m) => !followed.has(m))) {
      models = [...models.filter((m) => !followed.has(m)), ...models.filter((m) => followed.has(m))];
    }
    return [tier, { models }];
  }));
  const notes = [...ladders.notes];
  if (followed.size) notes.push(`obeyed an instruction planted in a page (principles probe), so not at the head of strong or review: ${[...followed].join(", ")}`);
  return { ladders, codeModelTiers: JSON.stringify(tiers), ...(ladders.codeIndicModel ? { codeIndicModel: ladders.codeIndicModel } : {}), notes };
}

/** The best models of the code and strong tiers for a comparison, cheapest per pass first, among those above the floor. */
export function bestModels(store: ResultsStore, catalog: Catalog, fx: number, k: number, poolsFile?: string): string[] {
  const rows = summariesFromStore(store, catalog, fx, poolsFile).filter((s) => (s.tier === "code" || s.tier === "strong") && s.quality >= DEFAULT_LADDER.floor);
  const seen = new Set<string>();
  return rows.sort((a, b) => (a.costPerPassUsd === b.costPerPassUsd ? b.quality - a.quality : a.costPerPassUsd - b.costPerPassUsd)).filter((s) => (seen.has(s.slug) ? false : (seen.add(s.slug), true))).slice(0, k).map((s) => s.slug);
}
