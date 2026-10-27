/**
 * ONE TASK, ONE AGENT, ONE SCORE: THE HARNESS'S OWN LOOP, WHICH KNOWS NO AGENT BY NAME.
 *
 *   1. prepare the task's checkout (for an agent that works on files)
 *   2. hand the agent the request, the checkout, a model, a budget and a time limit
 *   3. read its changes (from the result, or from the checkout with git)
 *   4. score them with the hidden checks, the same for every agent
 */
import path from "node:path";
import type { CallFn } from "../src/code/work/model.js";
import { collectChanges, prepareCheckout } from "./agents/checkout.js";
import type { AgentRunResult, AgentUnderTest, ModelSpec } from "./agents/types.js";
import { scoreResult, type Score } from "./score/index.js";
import type { Task } from "./tasks/schema.js";
import { IMAGES_DIR } from "./util.js";

export interface RunOneOptions {
  model: ModelSpec;
  budgetPaise: number;
  timeoutSec: number;
  outDir: string;
  repeat: number;
  log: (s: string) => void;
  brainBudgetPaise?: number;
  skipSuite?: boolean;
  judgeCall?: CallFn;
  judgePool?: readonly string[];
}

export async function runOne(task: Task, agent: AgentUnderTest, o: RunOneOptions): Promise<{ result: AgentRunResult; score: Score }> {
  let prepared: Awaited<ReturnType<typeof prepareCheckout>> | null = null;
  let result: AgentRunResult;
  try {
    if (agent.usesCheckout) prepared = await prepareCheckout(task);
    try {
      result = await agent.run({
        task, request: task.request, images: (task.images ?? []).map((n) => path.join(IMAGES_DIR, n)), checkout: prepared?.dir ?? "", model: o.model,
        budgetPaise: o.budgetPaise, timeoutSec: o.timeoutSec, outDir: o.outDir, repeat: o.repeat, log: o.log, ...(o.brainBudgetPaise !== undefined ? { brainBudgetPaise: o.brainBudgetPaise } : {}),
      });
    } catch (err) {
      result = {
        agent: agent.id, status: "error", reason: (err as Error).message.slice(0, 300), answer: "", changes: [],
        metrics: { costPaise: 0, promptTokens: 0, completionTokens: 0, steps: 0, toolCalls: 0, toolErrors: 0, modelCalls: 0, wallMs: 0, models: {} }, transcriptPath: null,
      };
    }
    if (!result.changes && prepared) {
      const got = await collectChanges(prepared.dir, prepared.baseSha);
      result = { ...result, changes: got.changes, diff: result.diff ?? got.diff };
    }
    result.changes ??= [];
  } finally {
    prepared?.dispose();
  }
  const score = await scoreResult(task, result, { skipSuite: o.skipSuite ?? false, ...(o.judgeCall ? { judgeCall: o.judgeCall } : {}), ...(o.judgePool ? { judgePool: o.judgePool } : {}), log: o.log });
  return { result, score };
}
