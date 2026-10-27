/**
 * THE PRINCIPLES, LAYER ZERO OF EVERY MODEL PROMPT WE WRITE IN code/, artifacts/, web/, front/ AND THE MAIN ASSISTANT (agent/, pipeline/). The story is in docs/principles.md.
 *
 *   library.ts    the principles: { id, text }, one imperative line each (at most 120 characters), in eight groups
 *   roles.ts      the roles (identity, principle ids, output contract) and compose(): the stable block, then the dynamic context
 *   evalcheck.ts  the checkable assertions of evals/<role>.jsonl, for scripts/eval-prompts.ts
 *
 * The main assistant's prompts are roles too: Ask's planner and picture reader (agent/), the writer and its helpers (pipeline/). Each is a stable block here and
 * its dynamic data beside the call (agent/prompt.ts, pipeline/assistPrompt.ts, pipeline/cleanup.ts); docs/principles.md, section 9, says how.
 */
export * from "./evalcheck.js";
export * from "./library.js";
export * from "./roles.js";
