/**
 * THE BAKE-OFF ENGINE: ROUNDS OF CHECKS, EASIEST FIRST, WITH CANDIDATES DROPPED AS SOON AS THEY ARE CLEARLY BEHIND.
 *
 *   round 1  probes          six tiny calls per candidate (probes.ts), plus the edit-format probe where asked
 *   round 2  role evals      the fixtures of the roles the tier serves (evals/*.jsonl), in waves
 *   round 3  real tasks      code and strong only: needle, the 15-turn tool task, and a few real tasks through the whole flow
 *
 * After every wave of a round the rule in stats.ts drops the candidates that are clearly worse than the leader at the same or a higher cost per pass; only
 * the survivors go on. Each candidate is called through the product's own gateway with a ladder of exactly itself, so a failure is its own.
 *
 * Money: one SpendGuard for the whole run (a hard cap that stops it cleanly), the cassette in front of every model call (so a bake-off can be recorded once and
 * replayed), and `sim` mode, which runs the same rounds on simulated models for nothing.
 */
import { buildTierTable, MODEL_TIERS, type ModelTier, type TierSettings } from "../../src/code/brain/tiers.js";
import { MemoryJobStore } from "../../src/code/jobs/store.js";
import { loadFixtures, ROLE_TIER, runRole } from "../../scripts/eval-prompts.js";
import { ROLE_IDS, type RoleId } from "../../src/principles/index.js";
import { CassetteStore, SpendGuard, type CassetteMode } from "../adapters/cassette.js";
import { makeModelKit, type CassetteSetup } from "../adapters/rig.js";
import type { ModelKit } from "../adapters/models.js";
import type { Catalog, ModelInfo } from "../catalog.js";
import type { Candidate } from "./capability.js";
import { scoreEditFormats, type EditFormatScore } from "./editformat.js";
import type { BakeoffTier } from "./pools.js";
import { ALL_PROBES, PASS_AT, TINY_PROBES, runProbe, type Probe, type ProbeResult } from "./probes.js";
import { simClient, simPass } from "./sim.js";
import { MIN_N, costPerPass, quantile, toDrop, type Tally } from "./stats.js";

export type RoundName = "probes" | "evals" | "tasks";

export interface Row {
  tier: BakeoffTier;
  slug: string;
  info: ModelInfo;
  probes: Tally;
  evals: Tally;
  tasks: Tally;
  latenciesMs: number[];
  calls: number;
  failedCalls: number;
  repaired: number;
  badToolCalls: number;
  probeResults: ProbeResult[];
  edit?: EditFormatScore;
  /** The round after which the candidate was dropped, and why. */
  dropped?: { round: RoundName; why: string };
  /** Role eval and real task results of a simulated run are drawn, not measured. */
  simulated: boolean;
}

export const emptyTally = (): Tally => ({ pass: 0, n: 0, costUsd: 0 });

export interface EngineOptions {
  mode: "real" | "sim";
  catalog: Catalog;
  fx: number;
  guard?: SpendGuard;
  cassette?: { store: CassetteStore; mode: CassetteMode; loose?: boolean };
  /** Early stop on (the default) or off. */
  early: boolean;
  /** Candidates a tier always keeps. */
  keep: number;
  /** Fixtures per wave. */
  wave: number;
  evalRuns: number;
  editFormat: boolean;
  /** Characters of the codebase for the needle probe. */
  needleChars: number;
  needleText?: string;
  log: (s: string) => void;
}

/** A tier table in which every tier's ladder is just this model (so a failure never falls to another), with the model's own prices. */
export function pinnedTiers(slug: string, info: ModelInfo | undefined, base?: Record<ModelTier, TierSettings>): Record<ModelTier, TierSettings> {
  const overrides: Partial<Record<ModelTier, Partial<TierSettings>>> = {};
  for (const t of MODEL_TIERS) {
    if (t === "indic") continue;
    overrides[t] = { models: [slug], ...(info ? { usdPerMIn: info.inUsdPerM, usdPerMOut: info.outUsdPerM } : {}), ...(base ? { maxTokens: base[t].maxTokens } : {}) };
  }
  return buildTierTable({ tiers: JSON.stringify(overrides) });
}

export class Engine {
  readonly rows = new Map<string, Row>();
  private readonly kits = new Map<string, { kit: ModelKit; stats: () => { hits: number; misses: number } }>();
  readonly misses: string[] = [];
  /** A probe's result is kept per model: a model that is a candidate for two tiers is probed once. */
  private readonly probeCache = new Map<string, ProbeResult>();

  constructor(readonly o: EngineOptions) {}

  private key = (tier: BakeoffTier, slug: string): string => `${tier}|${slug}`;
  row(tier: BakeoffTier, slug: string): Row | undefined { return this.rows.get(this.key(tier, slug)); }
  add(c: Candidate): Row {
    const r: Row = { tier: c.tier, slug: c.slug, info: c.info, probes: emptyTally(), evals: emptyTally(), tasks: emptyTally(), latenciesMs: [], calls: 0, failedCalls: 0, repaired: 0, badToolCalls: 0, probeResults: [], simulated: this.o.mode === "sim" };
    this.rows.set(this.key(c.tier, c.slug), r);
    return r;
  }
  alive(tier: BakeoffTier): Row[] { return [...this.rows.values()].filter((r) => r.tier === tier && !r.dropped); }

  /** The model door for one candidate: the gateway pinned to it, over OpenRouter, a cassette or the simulation. */
  kitFor(slug: string, label: string): ModelKit {
    const id = `${slug}|${label}`;
    const hit = this.kits.get(id);
    if (hit) return hit.kit;
    const info = this.o.catalog.models.get(slug);
    const cassette: (CassetteSetup & { run?: string }) | undefined = this.o.cassette ? { ...this.o.cassette, ...(this.o.guard ? { guard: this.o.guard } : {}), run: `${slug}|${label}` } : undefined;
    const { kit, cassette: client } = makeModelKit({
      mode: "real", tiers: pinnedTiers(slug, info),
      ...(this.o.mode === "sim" ? { client: simClient({ priceOf: (s) => { const i = this.o.catalog.models.get(s); return i ? { inUsdPerM: i.inUsdPerM, outUsdPerM: i.outUsdPerM } : { inUsdPerM: 0.3, outUsdPerM: 1.2 }; } }) } : {}),
      ...(cassette ? { cassette } : {}),
    }, new MemoryJobStore());
    this.kits.set(id, { kit, stats: () => ({ hits: client?.stats.hits ?? 0, misses: client?.stats.misses.length ?? 0 }) });
    return kit;
  }

  /** Pulls a kit's call log into a row: latencies, failures, JSON repairs, bad tool calls, and what it cost. */
  private settle(row: Row, kit: ModelKit, from: number): number {
    let usd = 0;
    for (const l of kit.logs.slice(from)) {
      row.calls += 1;
      row.latenciesMs.push(l.ms);
      if (!l.ok) row.failedCalls += 1;
      row.repaired += l.repaired;
      row.badToolCalls += l.badToolCalls;
      usd += l.paise / this.o.fx / 100;
    }
    return usd;
  }

  private capHit(): boolean { return this.o.guard?.exhausted === true; }

  // ------------------------------------------------------------- round 1: probes

  probesFor(tier: BakeoffTier, info: ModelInfo, heavy: boolean): Probe[] {
    const tool = tier === "code" || tier === "strong";
    return (heavy ? ALL_PROBES.filter((p) => p.full) : TINY_PROBES).filter((p) => {
      if (p.needs.includes("image") && !info.image) return false;
      if (p.needs.includes("tools") && !(info.tools && (tool || p.id === "tool_call"))) return false;
      if (tier === "vision") return p.id === "image" || p.id === "json_contract";
      if (tier === "tiny") return ["json_contract", "principles", "hindi"].includes(p.id);
      if (tier === "cheap") return ["json_contract", "principles", "hindi", "tool_call"].includes(p.id);
      if (p.id === "needle" && !this.o.needleText && this.o.mode !== "sim") return false;
      return true;
    });
  }

  async probeRound(tier: BakeoffTier, opts: { heavy?: boolean } = {}): Promise<void> {
    const rows = this.alive(tier);
    const plan = new Map(rows.map((r) => [r, this.probesFor(tier, r.info, opts.heavy ?? false)]));
    const longest = Math.max(0, ...[...plan.values()].map((p) => p.length));
    for (let i = 0; i < longest; i += 1) {
      for (const r of this.alive(tier)) {
        const p = plan.get(r)?.[i];
        if (!p || this.capHit()) continue;
        const kit = this.kitFor(r.slug, "probes");
        const from = kit.logs.length;
        const cached = this.probeCache.get(`${r.slug}|${p.id}`);
        const res = cached ?? await runProbe(p, { slug: r.slug, call: (input) => kit.call(input) as never, ...(this.o.needleText ? { needle: { text: this.o.needleText, chars: this.o.needleChars } } : {}) });
        if (!cached) this.probeCache.set(`${r.slug}|${p.id}`, res);
        const usd = cached ? 0 : this.settle(r, kit, from);
        r.probeResults.push(res);
        r.probes.n += 1; r.probes.costUsd += usd; if (res.pass) r.probes.pass += 1;
        this.o.log(`  ${tier} ${r.slug} ${p.id}: ${res.pass ? "pass" : "FAIL"} (${res.score.toFixed(2)}) ${res.detail}`);
      }
      this.dropAfter(tier, "probes", (r) => r.probes, 4);
    }
    if (this.o.editFormat && (tier === "code" || tier === "strong")) {
      for (const r of this.alive(tier)) {
        if (this.capHit()) continue;
        const kit = this.kitFor(r.slug, "edit");
        const from = kit.logs.length;
        r.edit = await scoreEditFormats((input) => kit.call(input) as never);
        this.settle(r, kit, from);
        this.o.log(`  ${tier} ${r.slug} edit formats: exact ${Math.round(r.edit.rates.exact * 100)}%, blocks ${Math.round(r.edit.rates.blocks * 100)}%, diff ${Math.round(r.edit.rates.diff * 100)}% -> ${r.edit.best}`);
      }
    }
  }

  // ----------------------------------------------------------- round 2: role evals

  rolesOf(tier: BakeoffTier): RoleId[] { return ROLE_IDS.filter((r) => (ROLE_TIER[r] as string) === tier); }

  async evalRound(tier: BakeoffTier): Promise<void> {
    const items: Array<{ role: RoleId; fixture: import("../../src/principles/index.js").Fixture }> = [];
    for (const role of this.rolesOf(tier)) for (const fixture of loadFixtures(role).fixtures) for (let k = 0; k < this.o.evalRuns; k += 1) items.push({ role, fixture });
    for (let at = 0; at < items.length; at += this.o.wave) {
      const wave = items.slice(at, at + this.o.wave);
      for (const r of this.alive(tier)) {
        const kit = this.kitFor(r.slug, "evals");
        for (const it of wave) {
          if (this.capHit()) break;
          const from = kit.logs.length;
          let pass = false;
          if (this.o.mode === "sim") {
            pass = simPass(r.slug, "eval", it.role, it.fixture.input.slice(0, 60));
            const usd = ((1200 * r.info.inUsdPerM + 300 * r.info.outUsdPerM) / 1e6);
            r.evals.costUsd += usd; r.calls += 1; r.latenciesMs.push(400 + Math.floor(1400 * (1 - simQ(r.slug))));
          } else {
            const rep = await runRole(it.role, [it.fixture], { call: (input) => kit.call(input) as never, runs: 1 });
            pass = rep.passed === 1;
            r.evals.costUsd += this.settle(r, kit, from);
          }
          r.evals.n += 1; if (pass) r.evals.pass += 1;
        }
      }
      this.dropAfter(tier, "evals", (r) => r.evals, MIN_N);
      if (this.capHit()) break;
    }
  }

  // ------------------------------------------------------------ round 3: real tasks

  /** The tasks one at a time, easiest first, each by every live candidate, with the drop rule after each task. `run` does one task for one model. */
  async taskRound<T extends { id: string }>(tier: BakeoffTier, tasks: readonly T[], run: (task: T, row: Row) => Promise<{ success: boolean; costUsd: number; ms: number; failed?: boolean }>): Promise<void> {
    for (const t of tasks) {
      for (const r of this.alive(tier)) {
        if (this.capHit()) return;
        const res = await run(t, r);
        r.tasks.n += 1; r.tasks.costUsd += res.costUsd; if (res.success) r.tasks.pass += 1;
        r.latenciesMs.push(res.ms); r.calls += 1; if (res.failed) r.failedCalls += 1;
        this.o.log(`  ${tier} ${r.slug} task ${t.id}: ${res.success ? "pass" : "FAIL"}`);
      }
      this.dropAfter(tier, "tasks", (r) => r.tasks, 3);
    }
  }

  // ------------------------------------------------------------ the drop rule

  dropAfter(tier: BakeoffTier, round: RoundName, tally: (r: Row) => Tally, minN: number): void {
    if (!this.o.early) return;
    const rows = this.alive(tier);
    const ids = toDrop(rows.map((r) => ({ id: r.slug, ...tally(r) })), this.o.keep, minN);
    for (const id of ids) {
      const r = this.row(tier, id)!;
      const t = tally(r);
      r.dropped = { round, why: `${t.pass}/${t.n} in the ${round} round, clearly behind the leader at no lower cost per pass` };
      this.o.log(`  ${tier} ${id}: dropped after the ${round} round (${t.pass}/${t.n})`);
    }
  }
}

const simQ = (slug: string): number => 0.35 + 0.62 * (parseInt(Buffer.from(slug).toString("hex").slice(0, 6), 16) % 1000) / 1000;

// ------------------------------------------------------------------- summaries

export interface Summary {
  tier: BakeoffTier;
  slug: string;
  /** 0 to 1, over the rounds that ran. */
  quality: number;
  passRate: { probes: number | null; evals: number | null; tasks: number | null };
  costPerPassUsd: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  errorRate: number;
  jsonRepairs: number;
  badToolCalls: number;
  calls: number;
  dropped?: Row["dropped"];
  edit?: EditFormatScore;
  hindi?: number;
  simulated: boolean;
  priceInUsdPerM: number;
  priceOutUsdPerM: number;
}

const rate = (t: Tally): number | null => (t.n ? t.pass / t.n : null);

export function summarize(r: Row): Summary {
  const weights = r.tier === "code" || r.tier === "strong" ? { probes: 0.25, evals: 0.35, tasks: 0.4 } : { probes: 0.4, evals: 0.6, tasks: 0 };
  const parts: Array<[number | null, number]> = [[rate(r.probes), weights.probes], [rate(r.evals), weights.evals], [rate(r.tasks), weights.tasks]];
  const have = parts.filter(([v, w]) => v !== null && w > 0);
  const wsum = have.reduce((n, [, w]) => n + w, 0);
  const quality = wsum ? have.reduce((n, [v, w]) => n + (v as number) * w, 0) / wsum : 0;
  // Cost per pass: of the evals and tasks where there are any (they are the work), else of the probes.
  const work: Tally = { pass: r.evals.pass + r.tasks.pass, n: r.evals.n + r.tasks.n, costUsd: r.evals.costUsd + r.tasks.costUsd };
  const cpp = costPerPass(work.n ? work : r.probes);
  const hindi = r.probeResults.find((p) => p.id === "hindi")?.score;
  return {
    tier: r.tier, slug: r.slug, quality, passRate: { probes: rate(r.probes), evals: rate(r.evals), tasks: rate(r.tasks) }, costPerPassUsd: cpp,
    latencyP50Ms: quantile(r.latenciesMs, 0.5), latencyP95Ms: quantile(r.latenciesMs, 0.95), errorRate: r.calls ? r.failedCalls / r.calls : 0,
    jsonRepairs: r.repaired, badToolCalls: r.badToolCalls, calls: r.calls, ...(r.dropped ? { dropped: r.dropped } : {}), ...(r.edit ? { edit: r.edit } : {}), ...(hindi !== undefined ? { hindi } : {}),
    simulated: r.simulated, priceInUsdPerM: r.info.inUsdPerM, priceOutUsdPerM: r.info.outUsdPerM,
  };
}

export { PASS_AT };
