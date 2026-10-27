/**
 * THE PLANNER, AS THE BENCH HANDS IT TO THE ROUTE.
 *
 * The phone's route takes its planner as a dependency (routes/assistant.ts
 * `plan`, which is StepDeps["plan"]), and that is the one seam the bench
 * uses: everything else, the router, the tools, the cards, the words, is the
 * server's own code. A ModelAdapter is that dependency, in one of three
 * modes (scripted.ts, replay.ts, live.ts), with every call written into the
 * trial's trace: which turn it belonged to, the whole answer, its timing and,
 * when the model reported them, its tokens and cost.
 *
 * The run reads the rest of a stream after the step has its ending (run.ts
 * drain), so a call's whole text, and in live mode its cassette entry, is
 * known only once its stream is finished; settled() waits for that.
 *
 * The cassette key is a hash of everything that makes a planner call what it
 * is: the models it may go to, the system prompt, the user message (Now line,
 * tool cards, results and all) and whether it carried a picture. Change any
 * of them (a prompt edit, a new tool card, a different ladder) and the
 * recorded answer no longer applies, so replay skips rather than plays it.
 */
import { createHash } from "node:crypto";
import type { CallRecord, PictureCall, PlanChunk, SystemPrompt, UserPrompt } from "../../../src/agent/llm.js";
import type { ModelCallTrace } from "../types.js";

export type PlanFn = (system: SystemPrompt, user: UserPrompt, signal?: AbortSignal, picture?: PictureCall, log?: (call: CallRecord) => void) => AsyncIterable<PlanChunk>;

export interface ModelAdapter {
  /**
   * StepDeps["plan"], recording each call into the trace. The fifth argument
   * is the call log a route may hand its planner (the run ledger's); a route
   * that hands none loses nothing.
   */
  plan: PlanFn;
  readonly calls: ModelCallTrace[];
  /** The turn the calls made from now on belong to; the harness moves it. */
  turn: number;
  /** When each call began and wrote its first chunk, on this machine's clock (performance.now), by call. */
  readonly timing: Array<{ startedAt: number; firstAt?: number }>;
  /** Every system prompt it was sent, for the scoreboard's prompt hashes. */
  readonly systems: Set<string>;
  /** Replay: latency is what was recorded, added to what was measured here. */
  readonly recordedLatency: boolean;
  /** Set when a call could not be answered (a stale cassette): the trial is skipped with it. */
  readonly skip: string | undefined;
  /** Resolves once every stream handed out has been read to its end, or after `maxMs`. */
  settled(maxMs?: number): Promise<void>;
}

export const CASSETTE_VERSION = 1;

/** A system prompt as text: a role's stable block, the same for every model. */
export function systemText(system: SystemPrompt): string {
  return system;
}

/** A user message as text: itself, or its parts, a picture by the hash of its data; chosen per model, each model's in ladder order. */
export function userText(user: UserPrompt, models: string[] = []): string {
  if (typeof user === "function") return models.map((m) => userText(user(m))).join("\n␞\n");
  if (typeof user === "string") return user;
  return user.map((p) => (p.type === "text" ? p.text : `[picture ${sha256(p.image_url.url).slice(0, 16)}]`)).join("\n␞\n");
}

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** sha256 of [version, models joined, the system text, the user text, the picture mark]. */
export function cassetteKey(models: string[], system: SystemPrompt, user: UserPrompt, picture?: PictureCall): string {
  const mark = picture ? (picture.deep ? "picture:deep" : "picture") : "";
  return sha256(JSON.stringify([CASSETTE_VERSION, models.join(","), systemText(system), userText(user, models), mark]));
}

/** No recorded answer for this call: the cassette is stale (or was never recorded for this path). */
export class CassetteMiss extends Error {
  constructor(readonly key: string) {
    super(`stale cassette: ${key}`);
  }
}

/**
 * The bookkeeping every mode shares: each call gets its trace entry and its
 * timing as it starts, its text as it streams, and counts as open until its
 * stream has finished, however it finishes.
 */
export abstract class TracedAdapter implements ModelAdapter {
  readonly calls: ModelCallTrace[] = [];
  readonly timing: Array<{ startedAt: number; firstAt?: number }> = [];
  readonly systems = new Set<string>();
  readonly recordedLatency: boolean = false;
  turn = 0;
  skip: string | undefined;
  private readonly open = new Set<Promise<void>>();

  /** The models a call's user message is read for when it is chosen per model. */
  protected abstract readonly models: string[];

  /** One call's answer, as chunks; `trace` is filled in as the mode learns its timing, tokens and key. */
  protected abstract answer(trace: ModelCallTrace, system: SystemPrompt, user: UserPrompt, signal?: AbortSignal, picture?: PictureCall, log?: (call: CallRecord) => void): AsyncIterable<PlanChunk>;

  readonly plan: PlanFn = (system, user, signal, picture, log) => this.traced(system, user, signal, picture, log);

  private async *traced(system: SystemPrompt, user: UserPrompt, signal?: AbortSignal, picture?: PictureCall, log?: (call: CallRecord) => void): AsyncGenerator<PlanChunk> {
    const trace: ModelCallTrace = { turn: this.turn, text: "", model: "" };
    const time: { startedAt: number; firstAt?: number } = { startedAt: performance.now() };
    this.calls.push(trace);
    this.timing.push(time);
    this.systems.add(systemText(system));
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    this.open.add(done);
    try {
      for await (const chunk of this.answer(trace, system, user, signal, picture, log)) {
        time.firstAt ??= performance.now();
        trace.model ||= chunk.model;
        trace.text += chunk.delta;
        yield chunk;
      }
    } finally {
      finish();
      this.open.delete(done);
    }
  }

  async settled(maxMs = 2000): Promise<void> {
    if (!this.open.size) return;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.all([...this.open]),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, maxMs); timer.unref?.(); }),
    ]);
    clearTimeout(timer);
  }
}
