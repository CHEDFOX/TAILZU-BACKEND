/**
 * THE WORK CORE, LAYER 5: FIND WHERE A CHANGE BELONGS, PLAN IT, KEEP THE ACCOUNT OF IT, AND TELL WHAT IT BROKE FROM WHAT WAS BROKEN.
 * The story is in docs/code-work.md. (`code/brain/` is the MODEL layer, `code/project/` is what the bot
 * knows about one repo; this is what it does with that knowledge before it writes a line.)
 *
 *   model.ts      askJson(): the one way a model is asked a JSON question here (callModel, charged to the job)
 *   cues.ts       the cues in a request, read for nothing: quotes, UI words, names, paths, routes, errors, frames
 *   locate.ts     locate(): six signals (the repo map is the sixth), fused, one hop out, a cheap model only when unsure, a question when it must
 *   impact.ts     what a change reaches, from the graph; the risk it adds
 *   plan.ts       planChange(): steps, validated against the brain, impact, verify, risk, milestones
 *   worklog.ts    the per-job log (store: worklogStore.ts, migration 0029) and its PR-body markdown
 *   findings.ts   compareToBaseline(): we broke it / already broken / fixed; flagFinding()
 *
 * Nothing here runs a command or writes to the repo. The agent loop (layer 8) calls these in order and
 * does the work.
 */
export * from "./cues.js";
export * from "./findings.js";
export * from "./impact.js";
export * from "./locate.js";
export * from "./model.js";
export * from "./plan.js";
export * from "./worklog.js";
