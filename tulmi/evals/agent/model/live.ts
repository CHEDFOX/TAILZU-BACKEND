/**
 * THE LIVE PLANNER: the real planStream, on the real model ladder, paid for.
 *
 * Each call goes to llm.ts planStream exactly as the server makes it (same
 * models, same timeouts, same request body), and each chunk is passed on as
 * it comes and kept with its offset from the call's start. With --record the
 * call is written to the task's cassette once its stream has finished: the
 * run reads the rest of a stream after the step has its ending (run.ts
 * drain), and that rest is where the token counts and the cost arrive.
 *
 * Timing is measured here, on this machine's monotonic clock: during a trial
 * Date.now() is the bench's frozen clock (clock.ts), so the call log's own
 * milliseconds read zero, and the bench's are the ones that count.
 *
 * Needs OPENROUTER_API_KEY. run.ts refuses to start live without one, so this
 * file is never where a missing key is found.
 */
import { PlannerUnavailable, modelLadder, planStream, type CallRecord, type PictureCall, type PlanChunk, type PlanOptions, type SystemPrompt, type UserPrompt } from "../../../src/agent/llm.js";
import type { ModelCallTrace } from "../types.js";
import { TracedAdapter, cassetteKey } from "./adapter.js";
import type { Cassette, CassetteEntry, RecordedCall } from "./cassette.js";

/** planStream's shape, so a test can hand in a fake. */
export type PlanStreamFn = (system: SystemPrompt, user: UserPrompt, opts?: PlanOptions) => AsyncIterable<PlanChunk>;

export interface LiveOptions {
  /** The ladder: --models, else the server's own (AGENT_MODEL, the fallbacks, CLEANUP_MODEL). */
  models?: string[];
  /** --record: each finished call is added to this cassette. */
  record?: Cassette;
  /** Which trial this is, written on each recorded call so replay plays a trial's own answers. */
  trial?: number;
  /** Tests only: a planStream that does not call OpenRouter. */
  planStream?: PlanStreamFn;
}

export class LiveAdapter extends TracedAdapter {
  protected readonly models: string[];
  private readonly stream: PlanStreamFn;

  constructor(private readonly o: LiveOptions = {}) {
    super();
    this.models = o.models?.length ? [...o.models] : modelLadder();
    this.stream = o.planStream ?? planStream;
  }

  protected async *answer(trace: ModelCallTrace, system: SystemPrompt, user: UserPrompt, signal?: AbortSignal, picture?: PictureCall, log?: (call: CallRecord) => void): AsyncGenerator<PlanChunk> {
    const key = cassetteKey(this.models, system, user, picture);
    trace.key = key;
    const t0 = performance.now();
    const chunks: CassetteEntry["chunks"] = [];
    const records: CallRecord[] = [];
    let unavailable = false;
    try {
      const stream = this.stream(system, user, {
        signal, models: this.models, ...(picture ? { picture } : {}),
        log: (c) => { records.push(c); log?.(c); },
      });
      for await (const chunk of stream) {
        chunks.push({ model: chunk.model, delta: chunk.delta, at: Math.round(performance.now() - t0) });
        yield chunk;
      }
    } catch (err) {
      unavailable = err instanceof PlannerUnavailable;
      throw err;
    } finally {
      const call = this.callOf(records, chunks, Math.round(performance.now() - t0));
      Object.assign(trace, {
        ms: call.ms, ...(call.firstMs !== undefined ? { firstMs: call.firstMs } : {}),
        ...(call.promptTokens !== undefined ? { promptTokens: call.promptTokens } : {}),
        ...(call.cachedTokens !== undefined ? { cachedTokens: call.cachedTokens } : {}),
        ...(call.completionTokens !== undefined ? { completionTokens: call.completionTokens } : {}),
        ...(call.costUsd !== undefined ? { costUsd: call.costUsd } : {}),
      });
      trace.model ||= call.model;
      if (this.o.record) {
        (this.o.record.entries[key] ??= []).push({ ...(this.o.trial !== undefined ? { trial: this.o.trial } : {}), chunks, call, ...(unavailable ? { error: "unavailable" as const } : {}) });
      }
    }
  }

  /**
   * The call as the cassette keeps it: the model that answered (the ladder's
   * last attempt), its tokens and OpenRouter's cost (CallRecord.costUsd),
   * with the timing measured here.
   */
  private callOf(records: CallRecord[], chunks: CassetteEntry["chunks"], ms: number): RecordedCall {
    const last = records.find((r) => r.outcome === "ok") ?? records.at(-1);
    const cost = last?.costUsd;
    return {
      model: last?.model ?? chunks[0]?.model ?? this.models[0] ?? "unknown", outcome: last?.outcome ?? (chunks.length ? "ok" : "failed"), ms,
      ...(chunks[0] ? { firstMs: chunks[0].at } : {}),
      ...(last?.promptTokens !== undefined ? { promptTokens: last.promptTokens } : {}),
      ...(last?.cachedTokens !== undefined ? { cachedTokens: last.cachedTokens } : {}),
      ...(last?.completionTokens !== undefined ? { completionTokens: last.completionTokens } : {}),
      ...(last?.reasoningTokens !== undefined ? { reasoningTokens: last.reasoningTokens } : {}),
      ...(typeof cost === "number" && Number.isFinite(cost) ? { costUsd: cost } : {}),
      ...(last?.provider ? { provider: last.provider } : {}),
      ...(last?.served ? { served: last.served } : {}),
      ...(last?.status !== undefined ? { status: last.status } : {}),
    };
  }
}
