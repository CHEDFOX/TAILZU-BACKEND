/**
 * THE FRONT DOOR: ONE SMART ENTRY POINT FOR A MESSAGE. The story is in docs/front-door.md.
 *
 *   rules.ts        what a message is, read for nothing (English, Hinglish, Hindi; the Code bot's free classifier for code)
 *   visual.ts       the cheapest picture that explains the answer, or none: a table, a diagram, a chart, a component, a page
 *   path.ts         the route, the tier and the budget an intent gets
 *   decide.ts       decide(): rules first, the small model only under 0.7, a question only under 0.45 and when the road is costly
 *   attachments.ts  what is attached: a registry of handlers by kind, a read that happens once (by SHA-256), only the relevant part sent on
 *   handlers.ts     the roads: reply, code answer (a hook), code job, research, plan, artifact
 *   dispatch.ts     dispatch(): carry a decision out, stream what streams, self-check the costly roads, write the decision down
 *   store.ts        the decision log (migration 0033): categories and numbers, never a word of the message
 *   learn.ts        a person's visual habit and the trust in each rule, from the log; the rephrase watch
 *   model.ts        askText(): the one way the front door asks a model for prose
 *   words.ts        the fixed sentences, in English, Hinglish and Hindi
 *
 * Off unless FRONT_DOOR=true (config.ts). Nothing here reaches a network or a store unless it is called to, and every piece takes its
 * dependencies as arguments, so the tests drive it with fakes.
 */
import type { Artifacts } from "../artifacts/index.js";
import type { AgentOrchestrator } from "../code/agent/orchestrator.js";
import type { GatewayDeps } from "../code/brain/gateway.js";
import { inRequestSpend } from "../code/brain/spend.js";
import type { Code } from "../code/index.js";
import type { JobRouter } from "../code/jobs/router.js";
import type { CallFn } from "../code/work/model.js";
import { getConfig } from "../config.js";
import { defaultGuard, type Guard } from "../guard/index.js";
import { AttachmentRegistry, type ReadResult } from "./attachments.js";
import { decide, type DecideDeps } from "./decide.js";
import { dispatch, type DispatchOptions } from "./dispatch.js";
import { defaultHandlers, type HandlerDeps, type Handlers } from "./handlers.js";
import { Learning, RephraseWatch } from "./learn.js";
import { frontStore, type FrontStore } from "./store.js";
import { FrontError, type Decision, type FrontCtx, type FrontResult, type Outcome } from "./types.js";

export * from "./types.js";
export { decide, DecideReply, lengthOf, RULES_SURE, CLARIFY_BELOW } from "./decide.js";
export { dispatch, needsSelfCheck, SELF_CHECK_MIN, DEADLINES } from "./dispatch.js";
export { readByRules } from "./rules.js";
export { chooseVisual, needsOf, askedKind, estimatePaise, habitFactor } from "./visual.js";
export { AttachmentRegistry, AttachmentCache, refFromBody, kindOf, relevantPart, textHandler, imageHandler } from "./attachments.js";
export { defaultHandlers, planDiagram, planText, replyUser } from "./handlers.js";
export type { Handlers, RouteCall } from "./handlers.js";
export { MemoryFrontStore, SupabaseFrontStore, frontStore, resetFrontStoreForTests } from "./store.js";
export type { FrontStore, DecisionRow } from "./store.js";
export { Learning, RephraseWatch, habitOf, trustOf } from "./learn.js";

/** The outcomes a person reports with a tap. */
export const PERSON_OUTCOMES = ["visual_closed", "visual_kept", "thumbs_up", "thumbs_down"] as const satisfies readonly Outcome[];

export interface FrontOptions extends HandlerDeps {
  /** Tests and servers that want their own: the decision log, the guard, the roads. */
  store?: FrontStore;
  guard?: Guard;
  handlers?: Partial<Handlers>;
  attachments?: AttachmentRegistry;
  call?: CallFn;
  gateway?: GatewayDeps;
  artifacts?: Artifacts | null;
  code?: Code | null;
  jobs?: JobRouter | null;
  agent?: AgentOrchestrator | null;
  now?: () => number;
  log?: { warn(o: object, msg: string): void };
  /** Make it even when FRONT_DOOR is off (tests). */
  force?: boolean;
}

export interface Front {
  readonly store: FrontStore;
  readonly learning: Learning;
  readonly guard: Guard;
  decide(message: string, ctx: FrontCtx, o?: { signal?: AbortSignal }): Promise<Decision>;
  dispatch(decision: Decision, message: string, ctx: FrontCtx, o?: DispatchOptions): Promise<{ id: string | null; result: FrontResult }>;
  /** decide, then dispatch. */
  ask(message: string, ctx: FrontCtx, o?: DispatchOptions): Promise<{ id: string | null; decision: Decision; result: FrontResult }>;
  /** What the person did with an answer: closed or kept its visual, a thumb. False when it is not theirs. */
  feedback(userId: string, id: string, outcome: Outcome): Promise<boolean>;
  /** What is attached, read the way the front door reads it (once, by SHA-256, only the part that matters): for a bot with the Files skill (docs/bots.md). */
  readFiles(userId: string, refs: FrontCtx["attachments"], data: ReadonlyMap<string, Buffer>, question: string, o: { maxPaise: number; signal?: AbortSignal }): Promise<ReadResult>;
}

/** The front door, or null while FRONT_DOOR is off. */
export function createFront(o: FrontOptions = {}): Front | null {
  if (!getConfig().FRONT_DOOR && !o.force) return null;
  const guard = o.guard ?? defaultGuard();
  const store = o.store ?? frontStore();
  const now = o.now ?? Date.now;
  const learning = new Learning(store, { now });
  const watch = new RephraseWatch(now);
  const attachments = o.attachments ?? new AttachmentRegistry();
  const handlers: Handlers = { ...defaultHandlers(o), ...(o.handlers ?? {}) };
  const decideDeps = (signal?: AbortSignal): DecideDeps => ({
    ...(o.call ? { call: o.call } : {}), ...(o.gateway ? { gateway: o.gateway } : {}), learning, daily: guard.daily, ...(signal ? { signal } : {}),
  });

  const front: Front = {
    store, learning, guard,
    decide: (message, ctx, opts = {}) => decide(message, ctx, decideDeps(opts.signal)),
    dispatch: (decision, message, ctx, opts = {}) => dispatch(decision, message, ctx, {
      handlers, attachments, store, learning, watch, daily: guard.daily, ...(o.call ? { call: o.call } : {}), ...(o.gateway ? { gateway: o.gateway } : {}), now,
      ...(o.log ? { log: o.log } : {}),
    }, opts),
    // The decision and the road it takes are one message: their model calls are rounded up to the paise once, together (brain/spend.ts).
    ask: (message, ctx, opts = {}) => inRequestSpend(async () => {
      if (guard.daily.leftPaise(ctx.userId) <= 0) throw new FrontError("daily_limit", "You've used what X0 Bot may spend on your messages today. It starts again tomorrow.", 429);
      const decision = await front.decide(message, ctx, opts.signal ? { signal: opts.signal } : {});
      return { decision, ...(await front.dispatch(decision, message, ctx, opts)) };
    }),
    readFiles: (userId, refs, data, question, opts) => inRequestSpend(() => attachments.read(
      userId, refs.map((ref) => ({ ref, ...(data.get(ref.id) ? { data: data.get(ref.id)! } : {}) })),
      { question, lang: "en", budget: { maxPaise: opts.maxPaise }, model: { ...(o.call ? { call: o.call } : {}), ...(o.gateway ? { gateway: o.gateway } : {}), userId, ...(opts.signal ? { signal: opts.signal } : {}) } },
    )),
    async feedback(userId, id, outcome) {
      if (!(PERSON_OUTCOMES as readonly string[]).includes(outcome)) return false;
      const ok = await store.setOutcome(userId, id, outcome);
      if (ok) learning.forget(userId);
      return ok;
    },
  };
  return front;
}
