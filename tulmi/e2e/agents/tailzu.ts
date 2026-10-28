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
import { proxyClient } from "../adapters/upstream.js";
import { runTask } from "../runTask.js";
import { mkdirp } from "../util.js";
import type { JobMode } from "../../src/code/agent/types.js";
import type { AgentMetrics, AgentRunInput, AgentRunResult, AgentStatus, AgentUnderTest, FileChange } from "./types.js";

/** Our agent ids: the product as it ships (free-form by default) and the phased flow kept behind CODE_JOB_MODE, for comparison. */
export const OUR_AGENTS = ["tailzu", "tailzu-phased"] as const;
export const isOurs = (id: string): boolean => (OUR_AGENTS as readonly string[]).includes(id);

/** Tailzu's flow as an agent under test, with every job worked in `jobMode` (absent: the product's default). */
function tailzuAs(id: string, describe: string, jobMode?: JobMode): AgentUnderTest {
  return {
    id, describe, modes: ["real", "fake", "oracle"], usesCheckout: false,
    run: (i) => runOurs(id, i, jobMode),
  };
}

export const tailzuAgent: AgentUnderTest = tailzuAs("tailzu", "Tailzu's Code bot as it ships: front door, project brain, free-form agent loop (the locate funnel as a tool and hints), policy commit, pull request");
/** The phased flow (locate, plan, work on the planned files, verify) the product used before free-form became the default: CODE_JOB_MODE=guided. */
export const tailzuPhasedAgent: AgentUnderTest = tailzuAs("tailzu-phased", "Tailzu's Code bot, phased (CODE_JOB_MODE=guided): locate, plan, work on the planned files, verify, policy commit, pull request", "guided");

async function runOurs(id: string, i: AgentRunInput, jobMode: JobMode | undefined): Promise<AgentRunResult> {
  {
    const out = await runTask(i.task, {
      ...(jobMode ? { jobMode } : {}),
      mode: i.model.mode, ...(i.model.persona ? { persona: i.model.persona } : {}), repeat: i.repeat, ...(i.model.tiers ? { tiers: i.model.tiers } : {}),
      capPaise: i.budgetPaise, timeoutSec: Math.max(i.timeoutSec, i.task.scenario?.timeoutSec ?? 0), ...(i.model.cassette ? { cassette: i.model.cassette } : {}), ...(i.model.wire ? { wire: true } : {}), ...(i.model.maxTurns ? { maxTurns: i.model.maxTurns } : {}), ...(i.model.maxTokens ? { maxTokens: i.model.maxTokens } : {}), ...(i.brainBudgetPaise !== undefined ? { brainBudgetPaise: i.brainBudgetPaise } : {}), log: i.log,
      // Through the recording proxy like an external agent, when it is given one and no in-process cassette (the security suite does this).
      ...(i.model.proxyUrl && i.model.mode === "real" && !i.model.cassette ? { rig: { client: proxyClient(i.model.proxyUrl) } } : {}),
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
      // One transcript per agent and model (the arms of a comparison used to overwrite each other's).
      const transcriptPath = path.join(i.outDir, "transcripts", `${i.task.id}-${id}-${(i.model.slug ?? i.model.mode).replace(/[^A-Za-z0-9._-]+/g, "_")}-${i.repeat}.json`);
      fs.writeFileSync(transcriptPath, JSON.stringify({ task: i.task.id, request: i.request, questions: t.questions, calls: t.calls, tools: t.tools, workLog: t.workLog, report: t.agent?.report ?? null, diff }, null, 1));
      return { agent: id, status, reason: t.job?.reason ?? "", changes, diff, answer: t.agent?.report?.text ?? "", metrics, transcriptPath, flow: t };
    } finally {
      await out.rig.dispose().catch(() => undefined);
    }
  }
}
