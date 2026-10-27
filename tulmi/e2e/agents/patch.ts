/**
 * THE PATCH AGENT: APPLIES A TASK'S KNOWN-CORRECT PATCH TO THE CHECKOUT AND SAYS WHAT THE TASK'S ANSWER IS.
 *
 * No model, no flow. It is the smallest second implementation of AgentUnderTest, and what proves that the scoring does not depend on Tailzu: the same
 * hidden checks run on its result as on any agent's. Tasks without a patch (a question, a refusal) are answered with the oracle's answer.
 */
import fs from "node:fs";
import path from "node:path";
import { mkdirp, rmrf } from "../util.js";
import type { AgentRunInput, AgentRunResult, AgentUnderTest } from "./types.js";

export const patchAgent: AgentUnderTest = {
  id: "patch",
  describe: "applies the task's known-correct patch to the checkout; no model, no flow",
  modes: ["oracle"],
  usesCheckout: true,
  async run(i: AgentRunInput): Promise<AgentRunResult> {
    const t0 = Date.now();
    for (const [p, text] of Object.entries(i.task.oracle.files ?? {})) {
      const f = path.join(i.checkout, p);
      if (text === null) { rmrf(f); continue; }
      mkdirp(path.dirname(f));
      fs.writeFileSync(f, text);
    }
    return {
      agent: "patch", status: "finished", reason: "", answer: i.task.oracle.answer ?? `Applied the patch to ${Object.keys(i.task.oracle.files ?? {}).join(", ") || "nothing"}.`,
      metrics: { costPaise: 0, promptTokens: 0, completionTokens: 0, steps: 0, toolCalls: 0, toolErrors: 0, modelCalls: 0, wallMs: Date.now() - t0, models: {} }, transcriptPath: null,
    };
  },
};
