/**
 * PART-LEVEL COMPARISON: THE PIECES OF AN AGENT, EACH WITH ITS OWN GROUND TRUTH, WITHOUT RUNNING A WHOLE AGENT.
 *
 *   locate       given a task, the ranked files        truth: the files the real fix changed (task.truth.files)      score: recall@1/3/5 and reciprocal rank
 *   edit apply   given a proposed search-and-replace   truth: the text it must produce, or that it must be refused    score: the share of cases handled right
 *   condense     given a long working context         truth: facts that must survive                                score: the share of facts kept, and the size
 *
 * The interfaces (LocatePart, EditApplyPart, CondensePart) are in agents/types.ts; an external agent's part is another implementation of them. The
 * implementations here are Tailzu's own, calling the product's code: `locate` (code/work/locate.ts) over the project brain, `replaceOnce`
 * (code/agent/changeset.ts, what edit_file does) and `fold` (code/agent/context.ts, what keeps a long job's context short).
 */
import { fold } from "../../src/code/agent/context.js";
import { replaceOnce } from "../../src/code/agent/changeset.js";
import { initialState } from "../../src/code/agent/types.js";
import { locate } from "../../src/code/work/locate.js";
import type { ModelCtx } from "../../src/code/work/model.js";
import { createRig, USER, type Rig } from "../adapters/rig.js";
import { oracle } from "../adapters/personas.js";
import type { Task } from "../tasks/schema.js";
import { materialize } from "../validate.js";
import { pool } from "../util.js";
import type { CondensePart, EditApplyPart, EditProposal, LocatePart, ModelSpec, Parts } from "./types.js";

const modelCtx = (rig: Rig, budget = 60): ModelCtx => ({ call: rig.kit.call, ...(rig.kit.gateway ? { gateway: rig.kit.gateway } : {}), userId: USER, budget: { maxPaise: budget } });

async function rigFor(model: ModelSpec): Promise<Rig> {
  return createRig({ mode: model.mode, ...(model.persona ? { persona: model.persona } : model.mode === "oracle" ? { persona: oracle } : {}), ...(model.tiers ? { tiers: model.tiers } : {}), brainBudgetPaise: 0 });
}

// ------------------------------------------------------------------ Tailzu's parts

export const tailzuLocate: LocatePart = {
  id: "tailzu",
  async locate({ task, request, k, model, log }) {
    const rig = await rigFor(model);
    const t0 = Date.now();
    try {
      rig.kit.bind(task, {});
      const h = await rig.addProjectFor(task);
      const brain = await rig.code.brain!.open(USER, h.project.id);
      const found = await locate(request, brain, { model: modelCtx(rig) });
      const ranked = [...found.targets.map((x) => x.path), ...found.related.map((x) => x.path)];
      log(`located ${ranked.slice(0, 3).join(", ") || "nothing"}`);
      return { files: [...new Set(ranked)].slice(0, k), ms: Date.now() - t0, costPaise: rig.kit.logs.reduce((n, l) => n + l.paise, 0) };
    } finally { await rig.dispose(); }
  },
};

export const tailzuEditApply: EditApplyPart = {
  id: "tailzu",
  async apply({ path, text, proposal }) {
    try {
      const out = replaceOnce(path, text, proposal.old, proposal.new);
      return { applied: true, text: out, reason: "applied" };
    } catch (err) {
      return { applied: false, reason: (err as Error).message.slice(0, 200) };
    }
  },
};

export const tailzuCondense: CondensePart = {
  id: "tailzu",
  async condense({ lines, maxChars, model }) {
    const rig = await rigFor(model);
    const t0 = Date.now();
    try {
      const state = initialState("condense", Date.now());
      state.work.digests = [...lines];
      await fold(state, modelCtx(rig, 30));
      const summary = state.work.summary.slice(0, Math.max(maxChars * 2, 400));
      return { summary, costPaise: rig.kit.logs.reduce((n, l) => n + l.paise, 0), ms: Date.now() - t0 };
    } finally { await rig.dispose(); }
  },
};

export const PARTS: Record<string, Parts> = { tailzu: { locate: tailzuLocate, editApply: tailzuEditApply, condense: tailzuCondense } };

// ------------------------------------------------------------ ground truth and scoring

export interface LocateScore { task: string; k: number; truth: string[]; ranked: string[]; hitAt1: boolean; hitAt3: boolean; hitAt5: boolean; recallAtK: number; rr: number }

export function scoreLocate(task: Pick<Task, "id" | "truth">, ranked: readonly string[]): LocateScore {
  const truth = [...task.truth.files, ...(task.truth.near ?? [])];
  const idx = ranked.findIndex((f) => truth.includes(f));
  const within = (n: number) => ranked.slice(0, n).some((f) => truth.includes(f));
  return {
    task: task.id, k: ranked.length, truth, ranked: [...ranked], hitAt1: within(1), hitAt3: within(3), hitAt5: within(5),
    recallAtK: truth.length ? truth.filter((f) => ranked.includes(f)).length / truth.length : 1, rr: idx >= 0 ? 1 / (idx + 1) : 0,
  };
}

export interface EditCase { id: string; path: string; text: string; proposal: EditProposal; expectApplied: boolean; expectText?: string }

/** Cases from a real file of the task: a clean edit, an ambiguous one, one whose old text is not there, and an empty one. */
export function editCasesFor(path: string, text: string): EditCase[] {
  const lines = text.split("\n");
  const count = (l: string) => lines.filter((x) => x === l).length;
  const unique = lines.find((l) => l.trim().length >= 12 && count(l) === 1 && !l.includes("\t"));
  const repeated = lines.find((l) => l.trim().length >= 6 && count(l) >= 2);
  const out: EditCase[] = [];
  if (unique) out.push({ id: "clean", path, text, proposal: { path, old: unique, new: `${unique} // changed` }, expectApplied: true, expectText: text.replace(unique, `${unique} // changed`) });
  if (repeated) out.push({ id: "ambiguous", path, text, proposal: { path, old: repeated, new: `${repeated} // changed` }, expectApplied: false });
  out.push({ id: "missing", path, text, proposal: { path, old: "this text is not in the file at all ~~~", new: "x" }, expectApplied: false });
  out.push({ id: "empty", path, text, proposal: { path, old: "", new: "x" }, expectApplied: false });
  return out;
}

export interface EditApplyScore { task: string; cases: Array<{ id: string; ok: boolean; applied: boolean; reason: string }>; score: number }

export async function scoreEditApply(task: Pick<Task, "id">, part: EditApplyPart, cases: readonly EditCase[]): Promise<EditApplyScore> {
  const rows: EditApplyScore["cases"] = [];
  for (const c of cases) {
    const r = await part.apply({ path: c.path, text: c.text, proposal: c.proposal });
    const ok = c.expectApplied ? r.applied && (c.expectText === undefined || r.text === c.expectText) : !r.applied;
    rows.push({ id: c.id, ok, applied: r.applied, reason: r.reason });
  }
  return { task: task.id, cases: rows, score: rows.length ? rows.filter((r) => r.ok).length / rows.length : 0 };
}

export interface CondenseCase { lines: string[]; facts: string[]; maxChars: number }

/** A long context made of a task's own facts: files read, a search, a staged edit, a failing run. The facts are what the notes must keep. */
export function condenseCaseFor(task: Task): CondenseCase {
  const file = task.truth.files[0] ?? "src/index.js";
  const added = Object.values(task.oracle.files ?? {}).find((t) => typeof t === "string") ?? "";
  const ident = /\b[A-Za-z_][A-Za-z0-9_]{6,}\b/.exec(String(added).split("\n").filter((l) => l.length > 12).slice(0, 40).join("\n"))?.[0] ?? "main";
  const facts = [file, ident, "3 failing", "keep the public api unchanged"];
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `list_dir lib/part${i} -> ${i + 3} entries`);
  const lines = [
    `read_file ${file} -> 180 lines, exports ${ident}`, ...filler(2),
    `grep ${ident} -> 7 matches in 3 files`, ...filler(2),
    `note decision: keep the public api unchanged`, ...filler(2),
    `run npm test -> exit 1: 3 failing`,
    `edit_file ${file} staged`,
  ];
  return { lines, facts, maxChars: 1500 };
}

export interface CondenseScore { kept: string[]; lost: string[]; score: number; chars: number; withinSize: boolean }

export function scoreCondense(summary: string, c: CondenseCase): CondenseScore {
  const low = summary.toLowerCase();
  const kept = c.facts.filter((f) => low.includes(f.toLowerCase()));
  return { kept, lost: c.facts.filter((f) => !kept.includes(f)), score: c.facts.length ? kept.length / c.facts.length : 1, chars: summary.length, withinSize: summary.length <= c.maxChars };
}

// ---------------------------------------------------------------- running a part

export interface PartReport {
  part: "locate" | "editApply" | "condense";
  impl: string;
  rows: Array<LocateScore | EditApplyScore | (CondenseScore & { task: string })>;
  /** One number: locate's recall@3, the share of edit cases right, the share of facts kept. */
  score: number;
  costPaise: number;
}

export async function runPart(kind: PartReport["part"], impl: string, tasks: readonly Task[], model: ModelSpec, log: (s: string) => void = () => undefined): Promise<PartReport> {
  const parts = PARTS[impl];
  if (!parts) throw new Error(`no part implementations called ${impl}; there are ${Object.keys(PARTS).join(", ")}`);
  let cost = 0;
  if (kind === "locate") {
    const part = parts.locate;
    if (!part) throw new Error(`${impl} has no locate part`);
    const want = tasks.filter((t) => t.truth.files.length && t.oracle.kind !== "answer");
    const rows = await pool(want, 2, async (t) => {
      const r = await part.locate({ task: t, request: t.request, k: 5, model, log });
      cost += r.costPaise;
      return scoreLocate(t, r.files);
    });
    return { part: kind, impl, rows, score: rows.length ? rows.filter((r) => r.hitAt3).length / rows.length : 0, costPaise: cost };
  }
  if (kind === "editApply") {
    const part = parts.editApply;
    if (!part) throw new Error(`${impl} has no edit-apply part`);
    const rows: EditApplyScore[] = [];
    for (const t of tasks.filter((x) => x.truth.files.length && x.repo !== "synthetic")) {
      const m = await materialize(t);
      try {
        const p = t.truth.files.find((f) => f in (t.oracle.files ?? {}));
        const fs = await import("node:fs");
        const path = await import("node:path");
        const full = p ? path.join(m.dir, p) : "";
        if (!p || !fs.existsSync(full)) continue;
        rows.push(await scoreEditApply(t, part, editCasesFor(p, fs.readFileSync(full, "utf8"))));
      } finally { m.dispose(); }
    }
    return { part: kind, impl, rows, score: rows.length ? rows.reduce((n, r) => n + r.score, 0) / rows.length : 0, costPaise: 0 };
  }
  const part = parts.condense;
  if (!part) throw new Error(`${impl} has no condense part`);
  const rows: Array<CondenseScore & { task: string }> = [];
  for (const t of tasks.filter((x) => x.truth.files.length)) {
    const c = condenseCaseFor(t);
    const r = await part.condense({ lines: c.lines, maxChars: c.maxChars, model, log });
    cost += r.costPaise;
    rows.push({ task: t.id, ...scoreCondense(r.summary, c) });
  }
  return { part: kind, impl, rows, score: rows.length ? rows.reduce((n, r) => n + r.score, 0) / rows.length : 0, costPaise: cost };
}
