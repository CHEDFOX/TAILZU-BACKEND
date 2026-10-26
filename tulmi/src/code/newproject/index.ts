/**
 * THE NEW-PROJECT PLANNER, LAYER 7: AN EMPTY REPO AND AN IDEA IN, A PLAN AND A FIRST MILESTONE OUT.
 * The story is in docs/code-work.md. It rides on layer 1 (the strong tier for the spec), on the project brain
 * (layer 4: is the repo empty?) and on the policy (every branch and commit goes through it).
 *
 *   detect.ts       isEmptyRepo(): no files, or only README, LICENSE, .gitignore and the like
 *   intake.ts       at most five questions, none the person's words already answer; the state kept (intakeStore.ts, migration 0029)
 *   spec.ts         buildSpec(): the strong tier's spec; chooseStack(): the stack, by rules, with reasons
 *   planDoc.ts      planMarkdown(): PLAN.md (goals, stack, milestones M0 to Mn, definition of done, hand-off)
 *   scaffold.ts     scaffoldStep(): the official starter command per stack, non-interactive, as a step for the router
 *   milestones.ts   a branch tailzu/m<k>-<slug> and a draft PR per milestone, the checklist and work log in it, the preview link
 *
 * Nothing here runs a command. The agent loop (layer 8) hands scaffoldStep()'s step to the environment router.
 */
export * from "./detect.js";
export * from "./intake.js";
export { MemoryIntakeStore, SupabaseIntakeStore, intakeStore, resetIntakeStoreForTests, type IntakeStore } from "./intakeStore.js";
export * from "./milestones.js";
export * from "./planDoc.js";
export * from "./scaffold.js";
export * from "./spec.js";
export * from "./types.js";
