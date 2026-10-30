/**
 * DISPATCH: CARRY OUT A DECISION ON THE ROAD IT NAMES, STREAM WHAT STREAMS, AND WRITE IT DOWN.
 *
 *   dispatch(decision, message, ctx, deps, { emit?, signal?, attachmentData? }) -> { id, result }
 *
 *   reply / file    the main assistant's reply, or the cheap fallback role; a file is read first (attachments.ts), once, and only the part
 *                   that matters reaches the model
 *   code_answer     a question about a project, answered from its brain (code/chat); a flow it drew from the import graph is the diagram
 *   code_job        a Xode job on a new branch
 *   artifact        a design: a component in the project's style, or a page
 *   research        the web layer's research, quick, standard or deep
 *   plan            steps, and a diagram drawn from them
 *
 * THE VISUAL goes beside the answer: a table is inside the reply already; a diagram, chart or page is made after it (from the answer, so
 * the two agree) by the artifact road; an OFFER (spoken replies, a preference to be asked) is a one-tap button in the result, not a thing
 * made. A visual that could not be made does not fail the answer: the answer goes out, and `notes` says in words what was left out.
 *
 * SELF-CHECK. Before a job or a deep research run, the decision must be 0.7 sure; under that, the question goes back instead
 * (decide.ts already asks under 0.45; between the two the answer is a question here, so that a costly road is never taken on a guess).
 *
 * MONEY. Each road is handed the most it may spend (the decision's budget, less the picture's share, less what is left of the person's
 * day); the gateway refuses a call that could pass it. What the front door's own calls cost is added to the person's day; artifacts and
 * jobs have caps of their own.
 *
 * TIME. Every road has a deadline (guard/timing.ts withTimeout) and is stopped when the caller goes away.
 *
 * STREAMING. `emit` gets the decision, a status for each stage, the text (in pieces when the road streams, whole when it does not), each
 * artifact as it is made, and the result. The same events are what a repeat of the request is shown (guard/idempotency.ts).
 *
 * RECORDING. One row in the decision log (store.ts): categories and numbers, never a word of the message. A message like the one before it,
 * from the same person, within a minute, marks that one "rephrased" (learn.ts).
 */
import { CAP_PAISE } from "../artifacts/types.js";
import type { SpendMeter } from "../artifacts/limits.js";
import type { GatewayDeps } from "../code/brain/gateway.js";
import { inRequestSpend } from "../code/brain/spend.js";
import type { CallFn } from "../code/work/model.js";
import { TimeoutError, withTimeout } from "../guard/timing.js";
import type { DataTable } from "../media/types.js";
import { LOOK_CAP_PAISE, type AttachmentInput, type AttachmentRegistry } from "./attachments.js";
import type { Handlers, RouteCall } from "./handlers.js";
import type { Learning, RephraseWatch } from "./learn.js";
import { visualCapOf } from "./path.js";
import type { FrontStore } from "./store.js";
import { clarifyFor, designReady, jobStarted, langOf, offerLabel, type ClarifyKind } from "./words.js";
import { FrontError, type Decision, type FileNote, type FrontCtx, type FrontEvent, type FrontResult, type RouteName, type VisualKind } from "./types.js";

/** A job or a deep research run needs the decision to be at least this sure. */
export const SELF_CHECK_MIN = 0.7;

/** How long each road may take, in milliseconds. */
export const DEADLINES: Readonly<Record<RouteName | "visual" | "attachments", number>> = {
  reply: 45_000, file: 60_000, code_answer: 60_000, code_job: 30_000, artifact: 150_000, research: 210_000, plan: 90_000, visual: 150_000,
  // Reading a file: a scanned PDF through the layout reader, a recording or a video can take minutes (docs/media.md). The work goes on and is kept if the person's request gives up.
  attachments: 180_000,
};

export interface DispatchDeps {
  handlers: Handlers;
  attachments?: AttachmentRegistry;
  store?: FrontStore;
  learning?: Pick<Learning, "forget">;
  watch?: Pick<RephraseWatch, "check" | "remember">;
  /** The person's day: nothing starts once it is spent, and what the front door's own calls cost is added. */
  daily?: Pick<SpendMeter, "leftPaise" | "add">;
  /** The model door the attachments' pictures are read through. */
  call?: CallFn;
  gateway?: GatewayDeps;
  now?: () => number;
  log?: { warn(o: object, msg: string): void };
  deadlines?: Partial<Record<RouteName | "visual" | "attachments", number>>;
}

export interface DispatchOptions {
  emit?: (ev: FrontEvent) => void;
  signal?: AbortSignal;
  /** The attachments' bytes, by ref id, as they came with the request. */
  attachmentData?: ReadonlyMap<string, Buffer>;
}

/** A road that costs real money or changes something: it is not taken on a guess. */
export const needsSelfCheck = (d: Pick<Decision, "route" | "depth">): boolean => d.route === "code_job" || (d.route === "research" && d.depth === "deep");

const clarifyKindOf = (d: Pick<Decision, "route">): ClarifyKind => (d.route === "code_job" ? "code" : d.route === "research" ? "research" : d.route === "artifact" ? "design" : "general");

const isAbort = (err: unknown): boolean => (err as { name?: unknown } | null)?.name === "AbortError";
const TABLE = /\|\s*:?-{3,}\s*:?\s*\|/;

/** A signal that fires when either does. */
function either(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  return a ? AbortSignal.any([a, b]) : b;
}

/** One request: every model call the road makes (the reply, the picture beside it, a research under it) is rounded up to the paise once, over the whole (brain/spend.ts). */
export function dispatch(decision: Decision, message: string, ctx: FrontCtx, deps: DispatchDeps, o: DispatchOptions = {}): Promise<{ id: string | null; result: FrontResult }> {
  return inRequestSpend(() => dispatchRequest(decision, message, ctx, deps, o));
}

async function dispatchRequest(decision: Decision, message: string, ctx: FrontCtx, deps: DispatchDeps, o: DispatchOptions): Promise<{ id: string | null; result: FrontResult }> {
  const now = deps.now ?? Date.now;
  const t0 = now();
  const emit = o.emit ?? (() => undefined);
  const lang = langOf(decision.language);
  const userId = ctx.userId;
  const deadline = (k: RouteName | "visual" | "attachments"): number => deps.deadlines?.[k] ?? DEADLINES[k];
  const result: FrontResult = { artifacts: [], offers: [], notes: [], paise: 0, ms: 0 };
  let ownPaise = 0;
  let streamed = false;

  emit({ t: "decision", decision });

  // The question goes back, with no road taken: asked by the decision (under 0.45 and costly), or by the self-check (under 0.7 before a job or a deep run).
  const ask = decision.clarify ?? (needsSelfCheck(decision) && decision.confidence < SELF_CHECK_MIN ? clarifyFor(clarifyKindOf(decision), lang) : undefined);
  if (ask) {
    result.clarify = ask;
    return finish();
  }

  const left0 = deps.daily ? deps.daily.leftPaise(userId) : Infinity;
  if (left0 <= 0) throw new FrontError("daily_limit", "You've used what X0 Bot may spend on your messages today. It starts again tomorrow.", 429);
  /** The most one more part may spend: its share of the budget, and what is left of the day. */
  const room = (share: number): number => Math.max(1, Math.min(share, Math.floor(left0 - ownPaise)));
  const visualCap = visualCapOf(decision.intent, decision.shape.visual);
  const routeCap = Math.max(1, decision.budgetPaise - visualCap);

  /** Runs one stage under its deadline and the caller's stop. A deadline is FrontError("timeout"). */
  async function stage<T>(name: RouteName | "visual" | "attachments", work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    try {
      return await withTimeout((sig) => work(either(o.signal, sig)), deadline(name), { what: name });
    } catch (err) {
      if (err instanceof TimeoutError) throw new FrontError("timeout", "That took too long. Nothing was changed; try again, or ask for less.", 504);
      throw err;
    }
  }

  const call = (maxPaise: number, signal: AbortSignal, message2 = message): RouteCall => ({
    userId, message: decision.followUp ? `${decision.followUp}. ${message2}` : message2, said: message2, ctx, decision, signal, maxPaise,
    onText: (piece) => { streamed = true; emit({ t: "text", text: piece }); },
    onReset: () => { streamed = false; emit({ t: "reset" }); },
    onStep: (stage) => emit({ t: "status", stage }),
  });
  const text = (t: string): void => { result.text = t; if (!streamed) emit({ t: "text", text: t }); };

  /** The first table read from a spreadsheet or a CSV among the attachments: a chart is made from its rows, by code. */
  let dataTable: DataTable | undefined;

  /** A table or a chart of a spreadsheet's rows is offered with the answer (one tap, nothing made or paid for until taken). */
  function offerData(): void {
    if (!dataTable || ctx.visuals === "off" || ctx.takeOffer) return;
    const has = (k: VisualKind): boolean => result.offers.some((x) => x.kind === k) || decision.shape.visual?.kind === k;
    if (!has("table")) result.offers.push({ kind: "table", label: offerLabel("table", lang), request: { visual: "table" } });
    if (!has("chart") && dataTable.numeric.length > 0 && dataTable.rows.length >= 2 && dataTable.columns.length >= 2) {
      result.offers.push({ kind: "chart", label: offerLabel("chart", lang), request: { visual: "chart" } });
    }
  }

  /** The picture beside an answer: offered, or made from the answer, or left out in words. */
  async function visualBeside(basis: string | undefined, mermaid?: string): Promise<void> {
    const v = decision.shape.visual;
    if (!v) return;
    if (v.offer) { result.offers.push({ kind: v.kind, label: offerLabel(v.kind, lang), request: { visual: v.kind } }); return; }
    if (v.via === "inline" || v.isAnswer) return;
    emit({ t: "status", stage: "visual" });
    try {
      const made = await stage("visual", (sig) => deps.handlers.artifact({
        ...call(room(visualCap || CAP_PAISE.cheap), sig), visual: v, ...(basis ? { basis } : {}), ...(mermaid ? { mermaid } : {}), ...(dataTable ? { data: dataTable } : {}),
      }));
      result.artifacts.push(made.artifact);
      result.paise += made.paise;
      if (made.notes) result.notes.push(...made.notes);
      emit({ t: "artifact", artifact: made.artifact });
    } catch (err) {
      if (isAbort(err)) throw err;
      const why = err instanceof FrontError ? err.message : "something went wrong";
      result.notes.push(`I left out the ${v.kind}: ${why}`);
    }
  }

  switch (decision.route) {
    case "reply": case "file": {
      let files: Awaited<ReturnType<AttachmentRegistry["read"]>>["files"] = [];
      let fileNotes: FileNote[] = [];
      if (decision.route === "file") {
        emit({ t: "status", stage: "reading" });
        const inputs: AttachmentInput[] = ctx.attachments.map((ref) => ({ ref, ...(o.attachmentData?.get(ref.id) ? { data: o.attachmentData.get(ref.id)! } : {}) }));
        if (!deps.attachments) throw new FrontError("not_configured", "Reading attachments isn't set up on this server.", 503);
        const read = await stage("attachments", (sig) => deps.attachments!.read(userId, inputs, {
          question: message, lang, budget: { maxPaise: room(LOOK_CAP_PAISE) },
          model: { ...(deps.call ? { call: deps.call } : {}), ...(deps.gateway ? { gateway: deps.gateway } : {}), userId, signal: sig },
        }));
        files = read.files;
        fileNotes = read.notes;
        dataTable = read.tables[0];
        result.files = fileNotes;
        result.paise += read.paise;
        ownPaise += read.paise;
        // Nothing could be read: the reason is the answer, in words, and no model is asked.
        if (!files.length) {
          text(fileNotes.map((n) => n.note ?? "").filter(Boolean).join(" ") || "I could not read what you attached.");
          break;
        }
      }
      emit({ t: "status", stage: "thinking" });
      const r = await stage(decision.route, (sig) => deps.handlers.reply({ ...call(room(routeCap), sig), files }));
      text(r.text);
      result.paise += r.paise;
      ownPaise += r.paise;
      await visualBeside(r.text);
      offerData();
      break;
    }
    case "code_answer": {
      emit({ t: "status", stage: "reading_code" });
      const r = await stage("code_answer", (sig) => deps.handlers.codeAnswer(call(room(routeCap), sig)));
      text(r.text);
      result.paise += r.paise;
      ownPaise += r.paise;
      if (r.notes) result.notes.push(...r.notes);
      // A flow drawn from the project's own import graph is kept as it is (no model, no cost); a diagram of any other kind is made from the answer.
      await visualBeside(r.text, decision.shape.visual?.kind === "diagram" ? r.diagram : undefined);
      break;
    }
    case "code_job": {
      emit({ t: "status", stage: "starting_job" });
      const r = await stage("code_job", (sig) => deps.handlers.codeJob(call(routeCap, sig)));
      result.job = r.job;
      text(jobStarted(lang, r.job.branch));
      break;
    }
    case "artifact": {
      emit({ t: "status", stage: "designing" });
      const v = decision.shape.visual;
      if (!v) throw new FrontError("bad_visual", "A design needs something to show.", 500);
      const r = await stage("artifact", (sig) => deps.handlers.artifact({ ...call(room(routeCap), sig), visual: v }));
      result.artifacts.push(r.artifact);
      result.paise += r.paise;
      if (r.notes) result.notes.push(...r.notes);
      emit({ t: "artifact", artifact: r.artifact });
      text(designReady(lang));
      break;
    }
    case "research": {
      emit({ t: "status", stage: "researching" });
      const r = await stage("research", (sig) => deps.handlers.research({ ...call(room(routeCap), sig), depth: decision.depth ?? "standard" }));
      text(r.text);
      result.sources = r.sources;
      result.paise += r.paise;
      ownPaise += r.paise;
      if (r.partial) result.notes.push("This answer is incomplete: the research stopped early, on time or on budget.");
      if (r.gaps.length) result.notes.push(`Still missing or unsure: ${r.gaps.slice(0, 3).join("; ")}.`);
      await visualBeside(r.text);
      break;
    }
    case "plan": {
      emit({ t: "status", stage: "planning" });
      const r = await stage("plan", (sig) => deps.handlers.plan(call(room(routeCap), sig)));
      text(r.text);
      result.paise += r.paise;
      ownPaise += r.paise;
      await visualBeside(r.text, r.diagram);
      break;
    }
  }
  return finish();

  async function finish(): Promise<{ id: string | null; result: FrontResult }> {
    result.ms = now() - t0;
    if (ownPaise > 0) deps.daily?.add(userId, ownPaise);
    const id = await record();
    emit({ t: "result", decisionId: id, decision, result });
    return { id, result };
  }

  /** The row in the decision log. A log that cannot be written is a warning in the server's log, never a failed message. */
  async function record(): Promise<string | null> {
    if (!deps.store) return null;
    try {
      const earlier = deps.watch?.check(userId, message) ?? null;
      if (earlier && (await deps.store.setOutcome(userId, earlier, "rephrased"))) deps.learning?.forget(userId);
      const v = decision.shape.visual;
      const madeTable = v?.kind === "table" && v.via === "inline" && !v.offer && !!result.text && TABLE.test(result.text);
      const visual = madeTable ? "table" : result.artifacts[0]?.kind ?? null;
      const id = await deps.store.add({
        userId, at: t0, intent: decision.intent, route: decision.route, tier: decision.tier, visual, confidence: decision.confidence,
        costPaise: result.paise, latencyMs: result.ms, via: decision.via,
      });
      deps.watch?.remember(userId, id, message);
      return id;
    } catch (err) {
      deps.log?.warn({ error: (err as Error)?.name }, "front door: decision not logged");
      return null;
    }
  }
}
