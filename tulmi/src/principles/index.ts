/**
 * THE PRINCIPLES, LAYER ZERO OF EVERY MODEL PROMPT WE WRITE IN code/, artifacts/ AND web/. The story is in docs/principles.md.
 *
 *   library.ts    the principles: { id, text }, one imperative line each (at most 120 characters), in eight groups
 *   roles.ts      the roles (identity, principle ids, output contract) and compose(): the stable block, then the dynamic context
 *   evalcheck.ts  the checkable assertions of evals/<role>.jsonl, for scripts/eval-prompts.ts
 *
 * The main assistant's prompts (prompts.ts, personality/, pipeline/) are not built from this yet; docs/principles.md says how they would be.
 */
export * from "./evalcheck.js";
export * from "./library.js";
export * from "./roles.js";
