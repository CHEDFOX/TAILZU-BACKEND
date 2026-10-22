/**
 * ONE STEP OF AN ASK RUN, END TO END.
 *
 * In order, cheapest first, and each stage only when the one before it did
 * not answer:
 *
 *   0. refusals   a private window or a sensitive app, a run past its steps
 *   1. heard      what they said: their words, or the recording transcribed
 *   P. picture    a step that came with a picture goes straight to a model
 *                 that can see, and is answered about it, in show mode
 *   2. grammar    "scroll down", "go back", "undo", "open Slack": free
 *   3. selection  text selected and they said something about it: the writer
 *                 rewrites it, and it is pasted over the selection
 *   4. resolver   "where's Export?", "click Export" against the labels: free
 *   5. model      one streamed call, read a line at a time
 *
 * The free paths answer a FRESH request only. Once this run has acted, the
 * device comes back with the same goal and what happened; a one-shot command
 * that has now been carried out is finished ("done", still free), and
 * anything else is the model's to judge from the history. Without that, "scroll
 * down" would scroll on every step until the run ran out of them.
 *
 * The picture path skips the free paths because they read labels, and the
 * question is about something no label says: "explain this equation" is
 * about the equation, and "scroll down" said over a chart is a question
 * about the chart that happens to sound like a command. It only ever shows,
 * whatever the run is: the picture is how it sees, not something to act on.
 *
 * Either model may draw on the screen as it explains (DRAW lines): marks go
 * out among the sentences, in the order they were written, at most
 * AGENT_DRAW_MAX a step. Places in the picture are honoured only on the
 * picture path, the one step that has a picture for them to be places in.
 * There each model is sent the prompt for its family, and its answer's places
 * are read in the order that prompt taught: Gemini writes y first. The
 * order is the model's that wrote the answer, read off its chunks, and one
 * answer is always one model's, since the ladder moves on only before any
 * of it is written.
 *
 * Everything goes out through the EventSink, which keeps "exactly one terminal
 * event" true however a path ends.
 */
import type { AgentStepRequest } from "../../../shared/types/api.js";
import { aboutTheText, commandText, grammar, grammarLine, modeOf, wantsDetail, type GrammarAction } from "./grammar.js";
import { LineReader, LineSplitter, parseLine, type ActionLine, type SpotOrder, type UseLine } from "./lines.js";
import { PlannerUnavailable, type PictureCall, type PlanChunk, type SystemPrompt, type UserContent } from "./llm.js";
import { AGENT_SYSTEM, agentPictureContent, agentUserMessage, drawOrderFor, visionSystemFor } from "./prompt.js";
import type { AgentImage, EventSink } from "./protocol.js";
import { resolve, resolverAsk } from "./resolver.js";
import { isBrowser, isTextEntry, withRisk, type PlannedAction, type Scene } from "./risk.js";
import { getConfig } from "../config.js";
import type { UseOutcome } from "../connectors/tasks.js";
import { sensitiveApp } from "../pipeline/sensitive.js";

export interface StepContext {
  req: AgentStepRequest;
  /** AGENT_MAX_STEPS: steps are counted from 0, and one past this is refused. */
  maxSteps: number;
  /** The names it answers to, taken off the front of a command. */
  names?: string[];
  /** The one picture that came with the step: the picture path. */
  image?: AgentImage;
  /** Marks a step may draw; AGENT_DRAW_MAX when not given. */
  drawMax?: number;
}

export interface StepDeps {
  /** The recording, transcribed. Present only when audio came with the step. */
  hear?: () => Promise<{ text: string; seconds: number }>;
  /** Their writer, composing at the cursor (assist). `context` is what the
   *  focused field already holds. */
  write: (instruction: string, context?: string) => Promise<string>;
  /** Their selected text rewritten to follow an instruction (editSelection). */
  rewrite: (selection: string, instruction: string) => Promise<string>;
  /** The planner's streamed answer (llm.planStream). `picture` on the
   *  picture path, whose user message then carries the picture as a part,
   *  and whose system prompt is chosen per model (visionSystemFor). */
  plan: (system: SystemPrompt, user: UserContent, signal?: AbortSignal, picture?: PictureCall) => AsyncIterable<PlanChunk>;
  /** Aborted when the device goes away. */
  signal?: AbortSignal;
  /** The person's connected apps (src/connectors). Absent when the feature is
   *  off, and then nothing about the planner's request differs from before. */
  connectors?: ConnectorsRuntime;
}

/** What the planner is sent on a step where it may use a connected app. */
export interface ConnectorPlan {
  /** AGENT_SYSTEM plus the one line that teaches USE. */
  system: string;
  /** The step's user message with the apps' tool cards, and any results so far, in it. */
  message(base: string, results: string[]): string;
}

/** The run's door to connected apps, already bound to the person. */
export interface ConnectorsRuntime {
  /** The cards for this step, or null when no connected app is relevant. */
  cards(req: AgentStepRequest, said: string): Promise<ConnectorPlan | null>;
  use(runId: string, said: string, line: UseLine, opts: { allowWrite: boolean; language?: string }): Promise<UseOutcome>;
  /** The run's step ended; close its task if that ends it. */
  settle(runId: string, ending: string | undefined): Promise<void>;
}

/** Tool calls in one step before the planner must answer: each is a model call. */
const MAX_USE_ROUNDS = 3;

export type StepPath = "refused" | "unheard" | "grammar" | "selection" | "resolver" | "followup" | "model" | "picture";

/** What the step did, for metering and the log. Never any of its text. */
export interface StepResult {
  path: StepPath;
  mode?: "show" | "do";
  /** The model that answered, when one did. */
  model?: string;
  /** Words their writer wrote for them (WRITE, REWRITE, a selection rewrite). */
  words: number;
  audioSeconds: number;
  code?: string;
  /** The deep ladder answered a picture question asked for in detail. */
  deep?: boolean;
  /** Marks drawn, and DRAW lines dropped (unreadable, at an id not on this
   *  screen, at a picture place on a step with no picture, past the cap). */
  draws?: number;
  drawsDropped?: number;
}

const countWords = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const NOT_FOUND = "I couldn't find that here.";
const NOT_SEEN = "I couldn't make that out in the picture.";
/** Sentences a picture answer may run to: about 90 words, or 250 for the
 *  worked one, with room over for short ones. */
const PICTURE_SAYS = 10;
const DEEP_SAYS = 24;

/** Every turn's words and this one's, for the risk checks. */
function everythingSaid(req: AgentStepRequest, said: string): string {
  return [...(req.history ?? []).map((t) => t.said ?? ""), said].join("\n");
}

const verbOf = (line: string) => line.trim().split(/\s+/)[0]?.toUpperCase() ?? "";

/**
 * A goal that goes on past its text: "translate this into hindi and send it",
 * "make it more formal, then post it". Typing the new text is only its first
 * half, so the run is not finished when the text is in. Wide on purpose: a
 * word caught here that was only a noun ("make this post shorter") costs one
 * model call, and one missed ends the run with the message unsent.
 */
const MORE_TO_DO = /\b(?:send|post|submit|reply|respond|share|publish|forward|press|click|tap|hit|enter|save|open|close|attach|upload|schedule|paste|then|after that|afterwards)\b|(?:^|\b(?:and|then)\s+)(?:message|text|e-?mail|mail|dm|ping|tell|answer)\b/im;

export async function runStep(ctx: StepContext, deps: StepDeps, sink: EventSink): Promise<StepResult> {
  const { req } = ctx;
  const names = ctx.names ?? [];
  const history = req.history ?? [];

  // 0. The second lock: the device refuses these first.
  if (req.privateField || sensitiveApp(req.app)) {
    sink.emit({ t: "error", code: "private", message: "Ask doesn't read private windows or sensitive apps." });
    return { path: "refused", words: 0, audioSeconds: 0, code: "private" };
  }
  if (req.step > ctx.maxSteps) {
    sink.emit({ t: "error", code: "too_many_steps", message: "That took too many steps, so I stopped." });
    return { path: "refused", words: 0, audioSeconds: 0, code: "too_many_steps" };
  }

  // 1. What they said. A later step may carry no words of its own: the goal
  // is then the last thing they said in this run.
  let said = req.utterance ?? "";
  let audioSeconds = 0;
  if (deps.hear) {
    const heard = await deps.hear();
    said = heard.text.trim();
    audioSeconds = heard.seconds;
  } else if (!said && req.step > 0) {
    said = [...history].reverse().find((t) => t.said)?.said ?? "";
  }
  if (!said) {
    sink.emit({ t: "error", code: "no_speech", message: "I didn't catch that." });
    return { path: "unheard", words: 0, audioSeconds, code: "no_speech" };
  }
  // The run's mode is its first request's: an answer to a question it asked
  // ("the second one") does not turn a show run into a do run. A picture is
  // only ever shown.
  const mode = ctx.image ? "show" : modeOf(history.find((t) => t.said)?.said ?? said, names);
  sink.emit({ t: "heard", text: said, mode });
  if (ctx.image) return answerPicture(ctx, deps, sink, { said, image: ctx.image, audioSeconds });

  const scene: Scene = { req, said: everythingSaid(req, said) };
  const clean = commandText(said, names);
  const acted = history.some((t) => t.did);
  const done = (path: StepPath, extra: Partial<StepResult> = {}): StepResult =>
    ({ path, mode, words: 0, audioSeconds, ...extra });

  // 2–4. The free paths, and what each would have done, as a line.
  const g: GrammarAction | null = mode === "do" ? grammar(clean, req.platform, req.screen.elements) : null;
  const ask = resolverAsk(clean);
  const hit = ask && (ask.verb === "press") === (mode === "do") ? resolve(ask, req.screen.elements) : null;
  // A browser's labels are written by the page, so there the resolver may
  // show a control but never press one on its own say-so.
  const resolvedPress = hit && mode === "do" && !isBrowser(req.app) ? hit : null;
  const resolvedPoint = hit && mode === "show" ? hit : null;

  if (acted) {
    // The device is back after running something. When that something was
    // this same one-shot command, and it worked, the run is finished. A text
    // edit is one only when it is the whole goal and the whole run so far:
    // the TYPE is the run's only act, and nothing they said in the run asks
    // for more after it. Otherwise the model reads the history, sees the text
    // is in, and presses Send or says DONE.
    const last = history.at(-1);
    const wholeEdit = mode === "do" && aboutTheText(clean)
      && history.filter((t) => t.did).length === 1 && !MORE_TO_DO.test(clean) && !MORE_TO_DO.test(scene.said);
    const expected = g ? verbOf(grammarLine(g))
      : wholeEdit ? "TYPE"
      : resolvedPress ? "PRESS" : "";
    if (expected && last?.did && verbOf(last.did) === expected && last.result === "ok") {
      sink.emit({ t: "done" });
      return done("followup");
    }
  } else {
    if (g) {
      sink.emit(withRisk(g as PlannedAction, scene));
      return done("grammar");
    }
    const selection = req.screen.selection?.trim();
    if (mode === "do" && selection && aboutTheText(clean)) {
      const text = await deps.rewrite(selection, said);
      sink.emit(withRisk({ kind: "type", text }, scene, true));
      return done("selection", { words: countWords(text) });
    }
    if (resolvedPoint) {
      const label = resolvedPoint.element.label!;
      sink.emit({ t: "say", text: `Here's ${label.replace(/[\s.…:]+$/u, "")}.` });
      sink.emit({ t: "point", id: resolvedPoint.element.id, caption: label });
      sink.emit({ t: "done" });
      return done("resolver");
    }
    if (resolvedPress) {
      sink.emit(withRisk({ kind: "press", id: resolvedPress.element.id }, scene));
      return done("resolver");
    }
  }

  // 5. The model.
  return planWithModel(ctx, deps, sink, { said, mode, scene, audioSeconds });
}

async function planWithModel(
  ctx: StepContext,
  deps: StepDeps,
  sink: EventSink,
  s: { said: string; mode: "show" | "do"; scene: Scene; audioSeconds: number },
): Promise<StepResult> {
  const { req } = ctx;
  const user = agentUserMessage(req, s.said, s.mode, ctx.maxSteps);
  const ids = new Set(req.screen.elements.map((e) => e.id));
  const result: StepResult = { path: "model", mode: s.mode, words: 0, audioSeconds: s.audioSeconds };

  // Connected apps: only when the feature is on AND some connected app looks
  // relevant to what was said. Everything else is the request it always was.
  const apps = deps.connectors ? await deps.connectors.cards(req, s.said) : null;
  if (!apps || !deps.connectors) {
    return follow(ctx, deps, sink, {
      reader: new LineReader(ids, s.mode, { draws: drawMax(ctx) }),
      stream: deps.plan(AGENT_SYSTEM, user, deps.signal),
      // The text prompt teaches every model the one order, and its places in
      // a picture are dropped anyway: it has no picture.
      order: () => "xy",
      scene: s.scene,
      nothing: NOT_FOUND,
      result,
    });
  }

  // A tool the planner calls to look something up comes back as a result and
  // the planner is asked again, with it, up to MAX_USE_ROUNDS times; the last
  // round does not read USE lines, so the step always ends.
  const use: UseHold = { said: s.said, allowWrite: s.mode === "do", results: [], again: false };
  for (let round = 0; round <= MAX_USE_ROUNDS; round++) {
    use.again = false;
    const last = round === MAX_USE_ROUNDS;
    await follow(ctx, deps, sink, {
      reader: new LineReader(ids, s.mode, { draws: drawMax(ctx), connectors: !last }),
      stream: deps.plan(apps.system, apps.message(user, use.results), deps.signal),
      order: () => "xy",
      scene: s.scene,
      nothing: NOT_FOUND,
      result,
      use,
    });
    if (!use.again || sink.ended) break;
  }
  await deps.connectors.settle(req.runId, sink.ending).catch(() => {});
  return result;
}

/** What a step that may use connected apps carries between its planner calls. */
interface UseHold {
  said: string;
  allowWrite: boolean;
  /** Results so far, "connector.tool: text", fed back to the next call. */
  results: string[];
  /** The last call ended on a tool that ran and gave a result: ask again. */
  again: boolean;
}

/**
 * The picture path: the picture and the question to a model that can see,
 * its sentences sent on as it writes them. "Step by step", "in detail" and
 * the like go to the deep ladder, with room for a worked answer.
 */
async function answerPicture(
  ctx: StepContext,
  deps: StepDeps,
  sink: EventSink,
  s: { said: string; image: AgentImage; audioSeconds: number },
): Promise<StepResult> {
  const { req } = ctx;
  // The whole run's words: sent again after an ASK, this step's own are only
  // the reply ("the second one"), and the ask for detail came before it.
  const all = everythingSaid(req, s.said);
  const deep = wantsDetail(all);
  const user = agentPictureContent(req, s.said, s.image);
  const result: StepResult = { path: "picture", mode: "show", words: 0, audioSeconds: s.audioSeconds };
  if (deep) result.deep = true;
  return follow(ctx, deps, sink, {
    reader: new LineReader(new Set(req.screen.elements.map((e) => e.id)), "show", {
      picture: true, says: deep ? DEEP_SAYS : PICTURE_SAYS, draws: drawMax(ctx),
    }),
    stream: deps.plan(visionSystemFor, user, deps.signal, { deep }),
    order: drawOrderFor,
    scene: { req, said: all },
    nothing: NOT_SEEN,
    result,
  });
}

/**
 * One planner stream, read a line at a time into the step's events, until
 * the reader has its ending or the stream runs out.
 */
async function follow(
  ctx: StepContext,
  deps: StepDeps,
  sink: EventSink,
  f: {
    reader: LineReader;
    stream: AsyncIterable<PlanChunk>;
    /** How the model that wrote a line places things in the picture. */
    order: (model: string) => SpotOrder;
    scene: Scene;
    nothing: string;
    result: StepResult;
    use?: UseHold;
  },
): Promise<StepResult> {
  const { req } = ctx;
  const { reader, result } = f;
  const splitter = new LineSplitter();

  const take = async (raw: string, model: string) => {
    const line = parseLine(raw, req.platform, { order: f.order(model) });
    if (!line) return;
    for (const out of reader.read(line)) {
      if ("emit" in out) sink.emit(out.emit);
      else if ("use" in out) await useTool(out.use, req.runId, f.use, deps, sink, req.language);
      else result.words += await act(out.act, req, deps, sink, f.scene);
    }
  };

  const stream = f.stream[Symbol.asyncIterator]();
  try {
    for (let next = await stream.next(); !next.done; next = await stream.next()) {
      result.model ??= next.value.model;
      for (const raw of splitter.push(next.value.delta)) {
        await take(raw, next.value.model);
        if (reader.ended) break;
      }
      if (reader.ended) {
        drain(stream);
        break;
      }
    }
    if (!reader.ended && result.model) for (const raw of splitter.flush()) await take(raw, result.model);
  } catch (err) {
    if (!(err instanceof PlannerUnavailable)) throw err;
    if (!reader.produced) {
      sink.emit({ t: "error", code: "model_unavailable", message: "Ask can't think right now. Try again in a moment." });
      return withDraws({ ...result, code: "model_unavailable" }, reader);
    }
  }

  // A tool gave its result and the step goes on: the caller asks again.
  if (f.use?.again && !sink.ended) return withDraws(result, reader);

  // A stream that ended without an ending: whatever it said stands, and
  // nothing usable at all is said plainly rather than left hanging.
  if (!sink.ended) {
    if (!reader.produced) sink.emit({ t: "say", text: f.nothing });
    sink.emit({ t: "done" });
  }
  return withDraws(result, reader);
}

const drawMax = (ctx: StepContext) => ctx.drawMax ?? getConfig().AGENT_DRAW_MAX;

/** The step's marks, counted for its log line when there were any. */
function withDraws(result: StepResult, reader: LineReader): StepResult {
  if (reader.draws) result.draws = reader.draws;
  if (reader.drawsDropped) result.drawsDropped = reader.drawsDropped;
  return result;
}

/**
 * The rest of a planner stream, read in the background once the step has its
 * ending. Nothing in it is used: the model was told to stop at its action, so
 * there is rarely anything left, but the call's token counts arrive only in
 * its last chunk, and without them its cost could not be measured. Bounded by
 * the call's own timeout, and cut short if the device hangs up.
 */
function drain(stream: AsyncIterator<PlanChunk>): void {
  void (async () => {
    try {
      while (!(await stream.next()).done) { /* read to the end */ }
    } catch {
      // A call cut off after its answer has gone changes nothing for anyone.
    }
  })();
}

/**
 * One USE line. A read runs and its result goes back into the step; a change
 * becomes an approval the device must confirm (nothing has happened yet); and
 * anything the person's settings do not allow is said to them, as it is.
 */
async function useTool(line: UseLine, runId: string, hold: UseHold | undefined, deps: StepDeps, sink: EventSink, language?: string): Promise<void> {
  if (!hold || !deps.connectors) return;
  const o = await deps.connectors.use(runId, hold.said, line, { allowWrite: hold.allowWrite, language });
  if (o.kind === "result") {
    hold.results.push(`${line.connector}.${line.tool}: ${o.text}`);
    hold.again = true;
  } else if (o.kind === "open") {
    // The hand-off: say the one line, have the device open the link (Gmail's
    // compose window, written for them to check and send), and finish.
    sink.emit({ t: "say", text: o.say ?? "I've written it in Gmail. Check it and hit Send." });
    sink.emit({ t: "open", url: o.url, label: o.label, ...(o.fallback ? { fallback: o.fallback } : {}) });
    sink.emit({ t: "done" });
  } else if (o.kind === "approval") {
    // The card is the server's: its words, its buttons, the routes they call.
    sink.emit({ t: "approve", taskId: o.taskId, approval: o.approval, ...(o.card ? { card: o.card } : {}) });
  } else {
    sink.emit({ t: "say", text: o.message });
    sink.emit({ t: "done" });
  }
}

/** One action line made into the step's action event. Returns the words
 *  their writer wrote for it. */
async function act(line: ActionLine, req: AgentStepRequest, deps: StepDeps, sink: EventSink, scene: Scene): Promise<number> {
  switch (line.verb) {
    case "PRESS": sink.emit(withRisk({ kind: "press", id: line.id }, scene)); return 0;
    case "FOCUS": sink.emit(withRisk({ kind: "focus", id: line.id }, scene)); return 0;
    case "SET": sink.emit(withRisk({ kind: "set", id: line.id, text: line.text }, scene)); return 0;
    case "TYPE": sink.emit(withRisk({ kind: "type", text: line.text }, scene)); return 0;
    case "KEY": sink.emit(withRisk({ kind: "key", keys: line.keys }, scene)); return 0;
    case "SCROLL": sink.emit(withRisk({ kind: "scroll", dir: line.dir, ...(line.id ? { id: line.id } : {}) }, scene)); return 0;
    case "OPEN": sink.emit(withRisk({ kind: "open", app: line.app }, scene)); return 0;
    case "WRITE": {
      const focused = req.screen.elements.find((e) => e.focused);
      const context = isTextEntry(focused) ? focused?.value : undefined;
      const text = (await deps.write(line.text, context)).trim();
      if (!text) {
        sink.emit({ t: "say", text: "I couldn't write that." });
        sink.emit({ t: "done" });
        return 0;
      }
      sink.emit(withRisk({ kind: "type", text }, scene));
      return countWords(text);
    }
    case "REWRITE": {
      const selection = req.screen.selection?.trim();
      if (!selection) {
        sink.emit({ t: "say", text: "Select the text first, then ask me again." });
        sink.emit({ t: "done" });
        return 0;
      }
      const text = (await deps.rewrite(selection, line.text)).trim();
      sink.emit(withRisk({ kind: "type", text: text || selection }, scene, true));
      return countWords(text);
    }
  }
}
