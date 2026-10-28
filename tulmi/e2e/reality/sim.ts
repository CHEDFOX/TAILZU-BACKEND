/**
 * THE SIMULATED EXECUTOR: OUTCOMES DRAWN FROM A KNOWN TRUTH, TO PROVE THE STOPPING LOGIC WITHOUT A KEY.
 *
 * Each arm has a true success rate and a true cost per run; a run is a seeded draw from them (a task has its own difficulty that every arm shares, so the arms
 * are correlated the way real arms are; a few tasks are flaky and flip between repeats). Three scenarios:
 *
 *   clear   one arm (ours) is far better than the rest: the plan must find it and stop paying for the others
 *   tie     every arm is the same: the plan must NOT name a winner, and must say the tasks ran out
 *   mixed   a cheap weak arm and a dear strong one: no arm dominates, the efficiency frontier is the answer
 *
 * Nothing here measures anything. Every result made through it is written to the simulated store only, and the report says SIMULATED in its first line.
 */
import { simPass } from "../bakeoff/sim.js";
import { unit } from "../bakeoff/sim.js";
import type { CentPartResult } from "../bakeoff/centparts.js";
import { makeCtx, runEditFormats, runRouter } from "../bakeoff/centparts.js";
import type { Catalog, ModelInfo } from "../catalog.js";
import { ALL_PROBES } from "../bakeoff/probes.js";
import type { ItemResult } from "../smoke/types.js";
import type { Task } from "../tasks/schema.js";
import type { Executor } from "./exec.js";
import type { Perf } from "./perf.js";
import type { Arm, Mode, ProbeOutcome, TaskOutcome } from "./types.js";

export type SimScenario = "clear" | "tie" | "mixed";

export interface SimTruth { p: number; costInr: number; turns: number }

/** The true success rate and cost of an arm in a scenario. */
export function truthOf(scenario: SimScenario, arm: Arm): SimTruth {
  const ours = arm.agent === "tailzu";
  const named: Record<string, SimTruth> = {
    aider: { p: 0.42, costInr: 2.6, turns: 9 }, opencode: { p: 0.36, costInr: 3.1, turns: 14 }, codex: { p: 0.3, costInr: 3.6, turns: 12 },
    openhands: { p: 0.24, costInr: 4.4, turns: 18 }, "mini-swe-agent": { p: 0.18, costInr: 1.1, turns: 16 },
  };
  if (scenario === "tie") return { p: 0.55, costInr: 2 + 0.05 * unit("tie-cost", arm.id), turns: 10 };
  if (scenario === "clear") {
    if (ours && (arm.group === "agents" || arm.model === "ladders" || arm.model === "recommended")) return { p: 0.95, costInr: 2.0, turns: 8 };
    if (ours) return { p: 0.3 + 0.35 * unit("clear", arm.id), costInr: 1.2 + 2.5 * unit("clear-cost", arm.id), turns: 12 };
    return named[arm.agent] ?? { p: 0.3, costInr: 3, turns: 12 };
  }
  // mixed: the dearer, the better, but with no free lunch
  const k = unit("mixed", arm.id);
  return { p: 0.3 + 0.55 * k, costInr: 0.8 + 5.5 * k * k + 0.5 * unit("mixed-cost", arm.id), turns: 6 + Math.round(10 * k) };
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

export class SimExecutor implements Executor {
  readonly mode: Mode = "sim";
  private spent = 0;
  constructor(private readonly o: { scenario: SimScenario; seed: number; fx: number; catalog: Catalog; outDir: string; log: (s: string) => void }) {}

  spentInr(): number { return this.spent; }

  async probe(model: string, probeId: string, info: ModelInfo | undefined): Promise<ProbeOutcome> {
    const p = ALL_PROBES.find((x) => x.id === probeId);
    const ok = simPass(model, "probe", probeId, this.o.seed);
    const usd = p && info ? (p.tokens.in * info.inUsdPerM + p.tokens.out * info.outUsdPerM) / 1e6 : 0.0002;
    const costInr = usd * this.o.fx;
    this.spent += costInr;
    return { ok, score: ok ? 1 : 0.3, detail: ok ? "simulated: right" : "simulated: wrong", costInr, wallMs: 400, errors: { failed: 0, repaired: 0, badToolCalls: 0 } };
  }

  async smoke(items: readonly string[]): Promise<{ items: ItemResult[]; spentInr: number }> {
    const out: ItemResult[] = items.map((id, i) => {
      const ok = unit("smoke", id, this.o.seed) < 0.6;
      return { id, n: i + 1, title: id, kind: "task", ok, stages: { work: { ok, detail: ok ? "simulated" : "simulated failure" } }, costPaise: 5, calls: 8, ms: 3000, detail: "simulated", notes: [], harness: [] };
    });
    const spentInr = out.reduce((n, i) => n + i.costPaise / 100, 0);
    this.spent += spentInr;
    return { items: out, spentInr };
  }

  async task(arm: Arm, task: Task, o: { repeat: number; budgetInr: number; index: number }): Promise<TaskOutcome> {
    const t = truthOf(this.o.scenario, arm);
    // The task's own difficulty is shared by every arm; a few tasks are flaky: their answer is redrawn on every repeat.
    const hard = (unit("hard", task.id, this.o.seed) - 0.5) * 0.4;
    const flaky = unit("flaky", arm.id, task.id, this.o.seed) < 0.12;
    const draw = flaky ? unit("draw", arm.id, task.id, this.o.seed, o.repeat) : unit("draw", arm.id, task.id, this.o.seed);
    const ok = draw < clamp(t.p + hard, 0.02, 0.98);
    const costInr = t.costInr * (0.7 + 0.6 * unit("cost", arm.id, task.id, this.o.seed, o.repeat)) * (ok ? 1 : 1.15);
    if (o.budgetInr < costInr * 0.5) return { ok: false, costInr: 0, wallMs: 0, quality: 0, detail: "not enough budget left", skipped: "not enough budget left for a task", perf: this.perf(false, 0, t, task, arm, false) };
    this.spent += costInr;
    const perf = this.perf(ok, costInr, t, task, arm, flaky);
    return { ok, costInr, wallMs: perf.wallMs, perf, quality: ok ? 1 : 0.5, detail: ok ? "pass (simulated)" : `${perf.stage}: ${perf.reason}` };
  }

  private perf(ok: boolean, costInr: number, t: SimTruth, task: Task, arm: Arm, flaky: boolean): Perf {
    const u = (s: string): number => unit("perf", arm.id, task.id, this.o.seed, s);
    const turns = Math.max(2, Math.round(t.turns * (0.6 + 0.8 * u("turns")) * (ok ? 1 : 1.3)));
    const toolCalls = turns * 2;
    const toolErrors = Math.round(toolCalls * (ok ? 0.06 : 0.18) * u("err") * 2);
    const stages = ["front", "locate", "plan", "work", "verify", "commit"];
    const stage = ok ? null : stages[Math.min(stages.length - 1, Math.floor(u("stage") * stages.length * 1.4))]!;
    const causes: Record<string, string> = {
      front: "the request was read as \"N\"", locate: "located <file>, not where the change belongs", plan: "the plan names <file>, not where the change belongs",
      work: "the change passed the project's own checks but not the hidden tests", verify: "the project's checks would not pass the change after N fix round(s)", commit: "no pull request was opened",
    };
    return {
      success: ok, stage, cause: stage ? causes[stage]! : "", reason: stage ? `simulated: ${causes[stage]}` : "", costInr, wallMs: Math.round(20_000 + 90_000 * u("ms")), timeToGreenMs: ok ? Math.round(20_000 + 90_000 * u("ms")) : null,
      steps: turns, turns, runnerSteps: Math.round(turns / 3), toolCalls, toolErrors, failedReads: Math.round(toolErrors / 2), failedEdits: Math.round(toolErrors / 2), reAsks: Math.round(u("reask") * 2), wastedSteps: toolErrors + Math.round(u("reask") * 2),
      questions: Math.round(u("q") * 1.4), regressions: ok ? 0 : Math.round(u("reg") * 1.2), attackSuccess: task.category === "hostile" ? !ok && u("atk") < 0.5 : null, secretLeak: task.checks.secrets?.length ? !ok && u("leak") < 0.3 : null,
      modelCalls: turns + 3, failedModelCalls: Math.round(u("fm") * 2), flakySignals: flaky && !ok ? ["a simulated flaky run"] : [], harness: [], detail: "full",
    };
  }

  async part(id: "editFormats" | "router" | "contextStrategy", o: { models?: string[] }): Promise<CentPartResult> {
    const ctx = await makeCtx({ mode: "sim", outDir: `${this.o.outDir}/parts`, log: (s) => this.o.log(s) });
    if (id === "editFormats") return runEditFormats(ctx, o.models ? { models: o.models } : {});
    if (id === "router") return runRouter(ctx);
    const { runContextStrategy } = await import("../bakeoff/centparts.js");
    return runContextStrategy(ctx);
  }

  async close(): Promise<void> { /* nothing to stop */ }
}
