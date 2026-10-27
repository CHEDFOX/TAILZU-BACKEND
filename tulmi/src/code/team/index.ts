/**
 * LEAD AND HELPERS MODE (docs/code-team.md): FOR A BIG GOAL THE BOT BECOMES A LEAD.
 *
 *   types.ts      the parts, their statuses, the lead's TeamState, a helper's PartContext, the numbers
 *   when.ts       when a job becomes a lead: a plan over 12 files or 3 features, several projects, or the person's word
 *   globs.ts      ownership: does a path belong to a part, do two parts' globs reach the same file
 *   split.ts      the plan divided into parts with disjoint ownership (role team_split), validated, asked again on overlap
 *   guard.ts      the owned-path guard: a helper changes its own files and nobody else's
 *   budget.ts     the 20% reserve, the slices, the parallel cap
 *   spawn.ts      a helper's branch and job, with its slice of the budget
 *   children.ts   reading a helper's job
 *   diff.ts       changes.ts    what a part changed, for the reviewer
 *   review.ts     a model of another family reviews each part (role team_review); at most 2 fix rounds
 *   integrate.ts  the server-side two-parent merge of a part into the lead branch; a conflict goes to the runner merge flow
 *   lead.ts       the split and team phases of the agent loop
 *   report.ts     the parts table, the review summary, the combined work log, the links between projects' pull requests
 */
export * from "./budget.js";
export * from "./changes.js";
export * from "./children.js";
export * from "./diff.js";
export * from "./globs.js";
export * from "./guard.js";
export * from "./integrate.js";
export * from "./lead.js";
export * from "./report.js";
export * from "./review.js";
export * from "./spawn.js";
export * from "./split.js";
export * from "./types.js";
export * from "./when.js";
