/**
 * THE CODE BOT'S BRAIN, LAYER 1: MODELS, MONEY, CLASSIFYING AND ROUTING.
 * The story of how the pieces fit is in docs/code-brain.md.
 *
 *   tiers.ts     which OpenRouter models do which kind of step (CODE_MODEL_TIERS)
 *   money.ts     what a call costs in paise, before it (worst case) and after
 *   spend.ts     a job's spend and budget, read and added to safely
 *   gateway.ts   callModel(): the one door to a model (ladder, retry, JSON, budget, ledger)
 *   classify.ts  classifyRequest(): what is being asked (rules first, a tiny model if unsure)
 *   route.ts     routeStep(): which tier and model for a step, climbing, budget
 *   stats.ts     recordOutcome(): what the router learns (migration 0025)
 *
 * Nothing here reaches the network or a store unless it is called to, and every
 * piece takes its dependencies as arguments, so layer 2 (the agent loop that
 * plans and writes) and the tests drive it the same way.
 */
export * from "./classify.js";
export * from "./gateway.js";
export * from "./money.js";
export * from "./route.js";
export * from "./spend.js";
export * from "./stats.js";
export * from "./tiers.js";
export * from "./types.js";
