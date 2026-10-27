/**
 * TAILZU'S OWN FLOW AS AN AGENT UNDER TEST.
 *
 * The product's real flow (the front door, the brain, locate, plan, the agent loop, the policy's commit, the pull request) over LocalGitHub, LocalRunner and
 * the chosen model door: runTask.ts drives it and plays the person. This file only turns the end of that run into an AgentRunResult: the files its commits
 * changed on the work branch, what it said (the report), the metrics, a transcript on disk, and the flow's own trace for the flow-specific checks.
 *
 * It keeps its own copy of the project in a local git host, so it has no use for the harness's prepared checkout.
 */
import fs from "node:fs";
import path from "node:path";
import { runTask } from "../runTask.js";
import { mkdirp } from "../util.js";
import type { AgentMetrics, AgentRunInput, AgentRunResult, AgentStatus, AgentUnderTest, FileChange } from "./types.js";

export const tailzuAgent: AgentUnderTest = {
  id: "tailzu",
  describe: "Tailzu's Code bot: front door, project brain, locate, plan, agent loop, policy commit, pull request",
  modes: ["real", "fake", "oracle"],
  usesCheckout: false,
  async run(i: AgentRunInput): Promise<AgentRunResult> {
    const out = await runTask(i.task, {
      mode: i.model.mode, ...(i.model.persona ? { persona: i.model.persona } : {}), repeat: i.repeat, ...(i.model.tiers ? { tiers: i.model.tiers } : {}),
      capPaise: i.budgetPaise, timeoutSec: Math.max(i.timeoutSec, i.task.scenario?.timeoutSec ?? 0), ...(i.model.cassette ? { cassette: i.model.cassette } : {}), ...(i.model.wire ? { wire: true } : {}), ...(i.model.maxTurns ? { maxTurns: i.model.maxTurns } : {}), ...(i.model.maxTokens ? { maxTokens: i.model.maxTokens } : {}), ...(i.brainBudgetPaise !== undefined ? { brainBudgetPaise: i.brainBudgetPaise } : {}), log: i.log,
    });
    try {
      const t = out.trace;
      const repo = out.handle.repo;
      const head = t.gh.branchHead;
      const changes: FileChange[] = [];
      let diff = "";
      if (head && head !== t.gh.baseSha) {
        for (const c of t.gh.changed) changes.push({ path: c.path, content: c.status === "D" ? null : await repo.fileAt(head, c.path) });
        diff = (await repo.g(["diff", "--no-renames", t.gh.baseSha, head], { allowFail: true })).slice(0, 400_000);
      }
      const ok = t.calls.filter((c) => c.ok);
      const models: Record<string, number> = {};
      for (const c of ok) models[c.model] = (models[c.model] ?? 0) + 1;
      const metrics: AgentMetrics = {
        costPaise: (t.job?.spentPaise ?? 0) + (t.front?.paise ?? 0), promptTokens: t.calls.reduce((n, c) => n + c.promptTokens, 0), completionTokens: t.calls.reduce((n, c) => n + c.completionTokens, 0),
        steps: t.agent?.turns ?? 0, toolCalls: t.tools.length, toolErrors: t.tools.filter((x) => x.ok === false).length, modelCalls: t.calls.length, wallMs: t.wallMs, models,
        ...(out.rig.cassette ? { cassette: { hits: out.rig.cassette.stats.hits, misses: out.rig.cassette.stats.misses.length, recorded: out.rig.cassette.stats.recorded, spentUsd: out.rig.cassette.stats.spentUsd, replayedUsd: out.rig.cassette.stats.replayedUsd, missed: out.rig.cassette.stats.misses.slice(0, 5) } } : {}),
      };
      const status: AgentStatus = t.timedOut ? "timeout" : t.job?.state === "done" ? "finished" : t.questions.some((q) => q.kind === "budget") ? "budget" : "failed";
      mkdirp(path.join(i.outDir, "transcripts"));
      const transcriptPath = path.join(i.outDir, "transcripts", `${i.task.id}-${i.repeat}.json`);
      fs.writeFileSync(transcriptPath, JSON.stringify({ task: i.task.id, request: i.request, questions: t.questions, calls: t.calls, tools: t.tools, workLog: t.workLog, report: t.agent?.report ?? null, diff }, null, 1));
      return { agent: "tailzu", status, reason: t.job?.reason ?? "", changes, diff, answer: t.agent?.report?.text ?? "", metrics, transcriptPath, flow: t };
    } finally {
      await out.rig.dispose().catch(() => undefined);
    }
  },
};
