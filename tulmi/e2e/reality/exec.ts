/**
 * THE EXECUTORS: HOW A STAGE ACTUALLY RUNS A PROBE, A SMOKE ITEM, A TASK OR A PART.
 *
 * The stages (stages.ts) and the sequential comparisons (compare.ts) decide WHAT to run and when to stop; an executor does the running, so the same logic is proved
 * without a key and used with one:
 *
 *   RealExecutor   mode "real": the harness's own functions with OpenRouter behind a recording cassette in MIXED mode (what was recorded is replayed for nothing,
 *                  only what is new is paid) under a hard spend guard; contestants go through the recording proxy. Mode "replay": the same with strict cassettes, so a
 *                  call that was not recorded is reported as "not recorded" and nothing is paid. Mode "scripted": Tailzu's real flow on the harness's scripted models
 *                  (the oracle that does the right thing, or a persona that fails in a known way): free, the real checkouts, hidden tests and scoring, but the outcome
 *                  is the script's, so it proves the machinery and measures no model.
 *   SimExecutor    (sim.ts) drawn outcomes with a known truth, for proving the stopping logic.
 *
 * Money: `spentInr()` is what this executor has paid so far, read from the guards (the cassette's, the proxy's), never from a task's own estimate.
 */
import "../env.js";
import { realKey } from "../env.js";
import path from "node:path";
import { CassetteStore, SpendGuard, type CassetteMode } from "../adapters/cassette.js";
import { makeModelKit, type CassetteSetup } from "../adapters/rig.js";
import { failingPersonaFor, lazy, oracle } from "../adapters/personas.js";
import { agentById } from "../agents/index.js";
import { isOurs } from "../agents/tailzu.js";
import type { AgentUnderTest, ModelSpec } from "../agents/types.js";
import { pinnedTiers } from "../bakeoff/engine.js";
import { ALL_PROBES, runProbe } from "../bakeoff/probes.js";
import { makeCtx, runContextStrategy, runEditFormats, runRouter, type CentPartResult } from "../bakeoff/centparts.js";
import { startProxy, type Proxy } from "../proxy.js";
import type { Catalog, ModelInfo } from "../catalog.js";
import { MemoryJobStore } from "../../src/code/jobs/store.js";
import { buildTierTable } from "../../src/code/brain/tiers.js";
import { runOne } from "../runOne.js";
import { runSmoke } from "../smoke/index.js";
import type { ItemResult } from "../smoke/types.js";
import type { Task } from "../tasks/schema.js";
import { mkdirp } from "../util.js";
import { perfOf } from "./perf.js";
import type { Arm, Mode, ProbeOutcome, TaskOutcome } from "./types.js";

export interface Executor {
  readonly mode: Mode;
  /** Rupees paid through this executor so far. */
  spentInr(): number;
  probe(model: string, probeId: string, info: ModelInfo | undefined): Promise<ProbeOutcome & { unrecorded?: boolean }>;
  smoke(items: readonly string[], o: { capInr: number }): Promise<{ items: ItemResult[]; spentInr: number }>;
  task(arm: Arm, task: Task, o: { repeat: number; budgetInr: number; index: number }): Promise<TaskOutcome>;
  part(id: "editFormats" | "router" | "contextStrategy", o: { models?: string[]; capInr: number }): Promise<CentPartResult>;
  close(): Promise<void>;
}

export interface RealOptions {
  mode: "real" | "replay" | "scripted";
  fx: number;
  catalog: Catalog;
  outDir: string;
  /** The hard cap on what this executor may pay in all, in rupees. */
  capInr: number;
  log: (s: string) => void;
  /** Scripted mode: the persona of the arm ("oracle" does the right thing, anything else fails in a known way). */
  persona?: "oracle" | "fake";
  /** The cassette the paid calls are recorded to (mixed), default "reality". */
  cassette?: string;
  /** Judge rubrics with a real model (costs a little more) instead of the keyword stub, which never decides. */
  judge?: boolean;
  /** Skip running the project's own suite on a result (faster, weaker). */
  skipSuite?: boolean;
  timeoutSec?: number;
  /** For tests: the model behind the cassette. */
  upstream?: CassetteSetup["upstream"];
}

const JUDGES = ["qwen/qwen3.7-flash", "deepseek/deepseek-v4.1-flash", "moonshotai/kimi-k3"];

export class RealExecutor implements Executor {
  readonly mode: Mode;
  private readonly guard: SpendGuard;
  private proxy: Proxy | null = null;
  private readonly stores = new Map<string, CassetteStore>();
  private judgeKit: ReturnType<typeof makeModelKit> | null = null;

  constructor(private readonly o: RealOptions) {
    this.mode = o.mode;
    this.guard = new SpendGuard(o.mode === "real" ? o.capInr / o.fx : 0);
  }

  /** What the contestants' proxy paid before it was closed: the run's total is read after close() (it said ₹50.87 for a stage that paid ₹74.92). */
  private closedProxyUsd = 0;

  spentInr(): number { return (this.guard.spentUsd + this.closedProxyUsd + (this.proxy?.guard.spentUsd ?? 0)) * this.o.fx; }

  private cassetteMode(): CassetteMode | null { return this.o.mode === "real" ? "mixed" : this.o.mode === "replay" ? "replay" : null; }

  private store(name: string): CassetteStore {
    let s = this.stores.get(name);
    if (!s) { s = new CassetteStore(name).load(); this.stores.set(name, s); }
    return s;
  }

  private setup(name: string): CassetteSetup | undefined {
    const mode = this.cassetteMode();
    if (!mode) return undefined;
    return { store: this.store(name), mode, ...(this.o.mode === "real" ? { guard: this.guard } : {}), ...(this.o.upstream ? { upstream: this.o.upstream } : {}) };
  }

  async probe(model: string, probeId: string, info: ModelInfo | undefined): Promise<ProbeOutcome & { unrecorded?: boolean }> {
    const p = ALL_PROBES.find((x) => x.id === probeId);
    if (!p) throw new Error(`no probe called ${probeId}`);
    if (this.o.mode === "scripted") return { ok: false, score: 0, detail: "a probe needs a real model", costInr: 0, wallMs: 0, errors: { failed: 0, repaired: 0, badToolCalls: 0 }, unrecorded: true };
    const setup = this.setup("reality-probes")!;
    const { kit, cassette } = makeModelKit({ mode: "real", tiers: pinnedTiers(model, info), cassette: { ...setup, run: `${model}|probes` } }, new MemoryJobStore());
    const m0 = cassette!.stats.misses.length, u0 = cassette!.stats.spentUsd, r0 = cassette!.stats.replayedUsd;
    const r = await runProbe(p, { slug: model, call: (input) => kit.call(input) as never });
    const missed = cassette!.stats.misses.length - m0;
    if (this.o.mode === "replay" && missed > 0) return { ok: false, score: 0, detail: "not recorded", costInr: 0, wallMs: r.ms, errors: r.errors, unrecorded: true };
    // What a probe cost: the upstream's charge when it was paid now, what it had cost when it was recorded when it came from the cassette.
    const usd = (cassette!.stats.spentUsd - u0) + (cassette!.stats.replayedUsd - r0);
    return { ok: r.pass, score: r.score, detail: r.detail, costInr: usd * this.o.fx, wallMs: r.ms, errors: r.errors };
  }

  async smoke(items: readonly string[], o: { capInr: number }): Promise<{ items: ItemResult[]; spentInr: number }> {
    const out = path.join(this.o.outDir, "smoke");
    mkdirp(out);
    if (this.o.mode === "replay") return { items: [], spentInr: 0 };
    const scripted = this.o.mode === "scripted";
    const run = await runSmoke({
      mode: scripted ? "oracle" : "real", cassetteMode: scripted ? null : "mixed", cassetteName: "reality-smoke", loose: false, capInr: Math.max(0.5, o.capInr), tiers: "smoke",
      primary: "qwen/qwen3.7-flash", fallback: "deepseek/deepseek-v4.1-flash", maxTurns: 20, parallel: 3, outDir: out, changed: false, only: [...items], estimateOnly: false, log: (s) => this.o.log(`  ${s}`), catalog: this.o.catalog,
    });
    return { items: run.items, spentInr: run.spentInr };
  }

  private ensureProxy(): Promise<Proxy> {
    if (this.proxy) return Promise.resolve(this.proxy);
    return startProxy({ port: 0, mode: this.o.mode === "replay" ? "replay" : "mixed", cassette: "reality-agents", capUsd: this.o.capInr / this.o.fx, log: (s) => this.o.log(`  proxy: ${s}`) }).then((p) => (this.proxy = p));
  }

  /** The model door for one arm: the product's ladders as they are, the ladders this plan recommends, or one model pinned everywhere. */
  private modelFor(arm: Arm, task: Task, index: number): ModelSpec {
    if (this.o.mode === "scripted") {
      const wrong = arm.model !== "oracle" && (arm.model === "fake" || this.o.persona === "fake");
      return wrong ? { mode: "fake", persona: failingPersonaFor(task, index) ?? lazy, maxTurns: 20, maxTokens: 800 } : { mode: "oracle", persona: oracle, maxTurns: 20, maxTokens: 800 };
    }
    const cassette = this.setup(`reality-${isOurs(arm.agent) ? "tailzu" : "agents"}`);
    if (isOurs(arm.agent)) {
      if (arm.model === "ladders") return { mode: "real", ...(cassette ? { cassette: { ...cassette, run: `${arm.id}|${task.id}` }, wire: true } : {}) };
      if (arm.model.startsWith("{")) return { mode: "real", tiers: buildTierTable({ tiers: arm.model }), ...(cassette ? { cassette: { ...cassette, run: `${arm.id}|${task.id}` }, wire: true } : {}) };
      return { mode: "real", slug: arm.model, ladder: [arm.model], tiers: pinnedTiers(arm.model, this.o.catalog.models.get(arm.model)), ...(cassette ? { cassette: { ...cassette, run: `${arm.id}|${task.id}` }, wire: true } : {}) };
    }
    return { mode: "real", slug: arm.model, ladder: [arm.model], tiers: pinnedTiers(arm.model, this.o.catalog.models.get(arm.model)) };
  }

  async task(arm: Arm, task: Task, o: { repeat: number; budgetInr: number; index: number }): Promise<TaskOutcome> {
    const empty = (skipped: string): TaskOutcome => ({ ok: false, costInr: 0, wallMs: 0, quality: 0, detail: skipped, skipped, perf: perfOf0() });
    if (this.o.mode === "scripted" && !isOurs(arm.agent)) return empty("an external agent has no scripted mode");
    if (this.o.mode !== "scripted" && !realKey && this.o.mode === "real") return empty("OPENROUTER_API_KEY is not set");
    // A replay of something that was never recorded is not started: an agent would run its whole loop against a cassette that answers every call with a miss.
    if (this.o.mode === "replay") {
      const ours = isOurs(arm.agent);
      const label = ours ? `${arm.id}|${task.id}` : `${arm.id}__${task.id}`.replace(/[^A-Za-z0-9._-]/g, "_");
      if (!this.store(ours ? "reality-tailzu" : "reality-agents").entries().some((e) => e.run === label)) return empty("not recorded: the cassette has no recording of this run");
    }
    const agent: AgentUnderTest = agentById(arm.agent);
    const budgetPaise = Math.min(Math.round(o.budgetInr * 100), task.budgetPaise ?? 3000);
    if (this.o.mode === "real" && budgetPaise < 300) return empty("not enough budget left for a task");
    const model = this.modelFor(arm, task, o.index);
    if (!isOurs(arm.agent) && this.o.mode !== "scripted") {
      const proxy = await this.ensureProxy();
      model.proxyUrl = `${proxy.url.replace(/\/v1$/, "")}/run/${encodeURIComponent(`${arm.id}__${task.id}`.replace(/[^A-Za-z0-9._-]/g, "_"))}/v1`;
    }
    const t0 = Date.now();
    const judge = this.o.judge && this.o.mode === "real" ? this.judge() : undefined;
    const { result, score } = await runOne(task, agent, {
      model, budgetPaise, timeoutSec: this.o.timeoutSec ?? (this.o.mode === "real" ? 900 : 420), outDir: this.o.outDir, repeat: o.repeat, log: (s) => this.o.log(`    ${arm.id} ${task.id}: ${s}`), brainBudgetPaise: 0,
      ...(this.o.skipSuite ? { skipSuite: true } : {}), ...(judge ? { judgeCall: judge.call, judgePool: JUDGES } : {}),
    });
    const miss = result.metrics.cassette?.misses ?? 0;
    if (this.o.mode === "replay" && miss > 0) return empty("not recorded: the cassette has no answer for this run");
    const perf = perfOf(score, result);
    // A replayed run costs what it cost when it was recorded; a scripted one costs nothing.
    const costInr = this.o.mode === "scripted" ? 0 : perf.costInr;
    const c = result.metrics.cassette;
    const replayed = !!c && c.recorded === 0 && c.hits > 0;
    return { ok: score.success, costInr, wallMs: Date.now() - t0, perf: { ...perf, costInr }, quality: score.quality, detail: score.success ? "pass" : `${score.stage.failedAt}: ${score.stage.reason}`.slice(0, 220), ...(replayed ? { replayed: true } : {}) };
  }

  private judge(): { call: Parameters<typeof runOne>[2]["judgeCall"] & object } {
    this.judgeKit ??= makeModelKit({ mode: "real", cassette: { ...this.setup("reality-judge")!, run: "judge" } }, new MemoryJobStore());
    return { call: this.judgeKit.kit.call as never };
  }

  async part(id: "editFormats" | "router" | "contextStrategy", o: { models?: string[]; capInr: number }): Promise<CentPartResult> {
    const replay = this.o.mode === "replay";
    const scripted = this.o.mode === "scripted";
    const ctx = await makeCtx({
      mode: scripted ? "sim" : "real", capInr: o.capInr, cassetteMode: scripted ? null : replay ? "replay" : "mixed", cassetteName: `reality-parts-${id}`, outDir: path.join(this.o.outDir, "parts"), log: (s) => this.o.log(s),
    });
    if (id === "editFormats") return runEditFormats(ctx, o.models ? { models: o.models } : {});
    if (id === "router") return runRouter(ctx);
    return runContextStrategy(ctx);
  }

  async close(): Promise<void> {
    this.closedProxyUsd += this.proxy?.guard.spentUsd ?? 0;
    await this.proxy?.close();
    this.proxy = null;
  }
}

/** An empty Perf, for a task that was not run. */
function perfOf0(): TaskOutcome["perf"] {
  return {
    success: false, stage: null, cause: "", reason: "", costInr: 0, wallMs: 0, timeToGreenMs: null, steps: 0, turns: 0, runnerSteps: 0, toolCalls: 0, toolErrors: 0, failedReads: 0, failedEdits: 0, reAsks: 0, wastedSteps: 0,
    questions: 0, regressions: 0, attackSuccess: null, secretLeak: null, modelCalls: 0, failedModelCalls: 0, flakySignals: [], harness: [], detail: "coarse",
  };
}
