/**
 * THE CONTESTANTS: WHO IS IN THE AGENT x MODEL GRID, WHAT IS PROVED ABOUT EACH, AND WHAT THE GRID WILL COST WITH THE KEY.
 *
 * The grid itself is bakeoff/grid.ts (`npm run bakeoff -- --grid --models a,b --agents tailzu,aider,...`). This file gathers what the report shows about the agents
 * before it has run: the pinned version and licence of each (agents/versions.json), whether the tool is installed here, what the no-key wiring proof found
 * (`npm run e2e:agents -- --prove`, out/agents/proof.json), and an ESTIMATE of the grid's cost in rupees from the live catalog prices.
 *
 * THE ESTIMATE. Each agent's first request was measured in the wiring proof (its system prompt, tool definitions and the task, on the tiny smoke project): that
 * is P0 tokens in. A loop of S steps re-sends the whole conversation each step, which grows by about G tokens a step (the model's turn and the tool's result),
 * so a run reads S*P0 + G*S*(S-1)/2 tokens and writes about 400 a step. S is each agent's usual step count, taken as a range (0.6x to 1.6x) because it is a guess
 * until the key exists. Tailzu's own flow uses the harness's measured task shape (smoke/estimate.ts). A replay costs nothing, and the grid stops pairs that are
 * clearly losing after two tasks, so the figure is a ceiling for a first run.
 */
import fs from "node:fs";
import path from "node:path";
import type { Catalog } from "../catalog.js";
import { CONTESTANTS } from "../agents/index.js";
import type { ProofRow } from "../agents/prove.js";
import { toolBin, toolSpec } from "../agents/tools.js";
import { SHAPE } from "../smoke/estimate.js";
import { OUT_DIR, readJson } from "../util.js";
import { OPENHANDS_REQUIRES_DOCKER } from "../agents/openhands.js";

export interface ContestantRow {
  id: string;
  tool: string | null;
  version: string;
  licence: string;
  licenceNote: string;
  installed: boolean;
  requiresDocker: boolean;
  proof: ProofRow | null;
  /** Why it is not in the grid, if it is not. */
  skipped?: string;
}

const TOOL_OF: Record<string, string> = { aider: "aider", opencode: "opencode", codex: "codex", "mini-swe-agent": "mini-swe-agent", openhands: "openhands" };

export function proofRows(): { at: string; task: string; rows: ProofRow[] } | null {
  const f = path.join(OUT_DIR, "agents", "proof.json");
  return fs.existsSync(f) ? readJson(f) : null;
}

export function contestantRows(): ContestantRow[] {
  const proof = proofRows();
  return CONTESTANTS.map((id): ContestantRow => {
    if (id === "tailzu") return { id, tool: null, version: "this repository", licence: "ours", licenceNote: "the product under test", installed: true, requiresDocker: false, proof: null };
    const tool = TOOL_OF[id]!;
    const spec = toolSpec(tool);
    const installed = !!toolBin(tool);
    const p = proof?.rows.find((r) => r.agent === id) ?? null;
    const requiresDocker = id === "openhands" ? OPENHANDS_REQUIRES_DOCKER : false;
    const skipped = requiresDocker ? "needs Docker for its runtime; none here" : !installed ? `not installed (npm run e2e:tools -- install ${tool})` : undefined;
    return { id, tool, version: spec.version, licence: spec.licence, licenceNote: spec.licenceNote, installed, requiresDocker, proof: p, ...(skipped ? { skipped } : {}) };
  });
}

/** What each agent's first request was, in tokens, on the smoke project (measured in the wiring proof; these are the numbers of 2026-10-27 as a fallback). */
const MEASURED_P0: Record<string, number> = { aider: 2800, opencode: 7900, codex: 7700, "mini-swe-agent": 1400, openhands: 16300 };
/** A usual step count for a small job. */
const STEPS: Record<string, number> = { aider: 3, opencode: 10, codex: 10, "mini-swe-agent": 14, openhands: 14 };
const GROWTH = 1500;
const OUT_PER_STEP = 400;

export function firstRequestTokens(id: string): number {
  const p = proofRows()?.rows.find((r) => r.agent === id)?.record;
  return p && p.calls ? Math.round(p.promptTokens / p.calls) : (MEASURED_P0[id] ?? 4000);
}

export interface GridEstimate {
  models: Array<{ slug: string; inUsdPerM: number; outUsdPerM: number; known: boolean }>;
  perAgent: Array<{ agent: string; tokensIn: number; tokensOut: number; inrPerRun: Record<string, number>; inrLow: number; inrHigh: number }>;
  runs: number;
  totalInr: number;
  lowInr: number;
  highInr: number;
  basis: string;
}

export function estimateGrid(o: { agents: readonly string[]; models: readonly string[]; tasks: number; catalog: Catalog; fx: number }): GridEstimate {
  const models = o.models.map((slug) => { const m = o.catalog.models.get(slug); return { slug, inUsdPerM: m?.inUsdPerM ?? 0.3, outUsdPerM: m?.outUsdPerM ?? 1.2, known: !!m }; });
  const perAgent = o.agents.map((agent) => {
    const tokens = (scale: number): { i: number; o: number } => {
      if (agent === "tailzu") return { i: SHAPE.task.inTokens * scale, o: SHAPE.task.outTokens * scale };
      const S = Math.max(1, Math.round((STEPS[agent] ?? 10) * scale));
      const P0 = firstRequestTokens(agent);
      return { i: S * P0 + (GROWTH * S * (S - 1)) / 2, o: S * OUT_PER_STEP };
    };
    const mid = tokens(1);
    const price = (t: { i: number; o: number }, m: GridEstimate["models"][number]): number => ((t.i * m.inUsdPerM + t.o * m.outUsdPerM) / 1e6) * o.fx;
    const inrPerRun = Object.fromEntries(models.map((m) => [m.slug, price(mid, m)]));
    const sum = (t: { i: number; o: number }): number => models.reduce((n, m) => n + price(t, m), 0) * o.tasks;
    return { agent, tokensIn: Math.round(mid.i), tokensOut: Math.round(mid.o), inrPerRun, inrLow: sum(tokens(0.6)), inrHigh: sum(tokens(1.6)) };
  });
  const total = perAgent.reduce((n, a) => n + Object.values(a.inrPerRun).reduce((x, y) => x + y, 0) * o.tasks, 0);
  return {
    models, perAgent, runs: o.agents.length * o.models.length * o.tasks, totalInr: total, lowInr: perAgent.reduce((n, a) => n + a.inrLow, 0), highInr: perAgent.reduce((n, a) => n + a.inrHigh, 0),
    basis: `${o.agents.length} agents x ${o.models.length} models x ${o.tasks} tasks = ${o.agents.length * o.models.length * o.tasks} runs; first-request sizes measured in the wiring proof, S steps of +${GROWTH} tokens, ${OUT_PER_STEP} out per step; Tailzu at the harness's task shape; low/high are 0.6x/1.6x the steps; prices from the OpenRouter catalog (cached); no prompt-cache discount assumed`,
  };
}
