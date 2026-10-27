/**
 * THE REPLAYED PLANNER: a recorded live run, played back for free.
 *
 * Each call is looked up by its key (adapter.ts cassetteKey) in the task's
 * cassette, and trial i plays what live trial i answered under that key
 * (round and round when fewer trials were recorded; the i-th answer under the
 * key when the cassette does not say which trial wrote it), so three trials
 * replay three live trials. The chunks are played as they came, all at once:
 * replay never sleeps. Its latency is the recorded one, added by the harness
 * to what the rest of the run took here, and its tokens and cost are the
 * recorded ones.
 *
 * A call with no recorded answer means the request changed since the
 * recording (a prompt, a tool card, a result): the trial cannot be replayed
 * and is skipped as stale, never answered with something else. The call is
 * refused with CassetteMiss, which the route answers as a failure; the
 * harness sees `skip` and drops the trial from the score.
 */
import { PlannerUnavailable, type CallRecord, type PictureCall, type PlanChunk, type SystemPrompt, type UserPrompt } from "../../../src/agent/llm.js";
import type { ModelCallTrace } from "../types.js";
import { CassetteMiss, TracedAdapter, cassetteKey } from "./adapter.js";
import { recordedTrials, type Cassette } from "./cassette.js";

export class ReplayAdapter extends TracedAdapter {
  override readonly recordedLatency = true;
  protected readonly models: string[];
  /** How many times each key has been played in this trial. */
  private readonly played = new Map<string, number>();
  /** How many live trials wrote the cassette, when its entries say. */
  private readonly recordedTrials: number;

  constructor(private readonly cassette: Cassette, private readonly trial: number) {
    super();
    this.models = cassette.models;
    this.recordedTrials = recordedTrials(cassette);
  }

  protected async *answer(trace: ModelCallTrace, system: SystemPrompt, user: UserPrompt, _signal?: AbortSignal, picture?: PictureCall, log?: (call: CallRecord) => void): AsyncGenerator<PlanChunk> {
    const key = cassetteKey(this.models, system, user, picture);
    trace.key = key;
    const entries = this.cassette.entries[key];
    if (!entries?.length) {
      this.skip ??= `stale cassette: ${key}`;
      throw new CassetteMiss(key);
    }
    const seen = this.played.get(key) ?? 0;
    this.played.set(key, seen + 1);
    const own = entries.filter((x) => x.trial === this.trial % this.recordedTrials);
    const e = own.length ? own[seen % own.length]! : entries[(this.trial + seen) % entries.length]!;
    const c = e.call;
    Object.assign(trace, {
      model: c.model, ms: c.ms,
      ...(c.firstMs !== undefined ? { firstMs: c.firstMs } : e.chunks[0] ? { firstMs: e.chunks[0].at } : {}),
      ...(c.promptTokens !== undefined ? { promptTokens: c.promptTokens } : {}),
      ...(c.cachedTokens !== undefined ? { cachedTokens: c.cachedTokens } : {}),
      ...(c.completionTokens !== undefined ? { completionTokens: c.completionTokens } : {}),
      ...(c.costUsd !== undefined ? { costUsd: c.costUsd } : {}),
    });
    // The route's own call log (the run ledger's) hears the recorded call.
    log?.(c as CallRecord);
    for (const chunk of e.chunks) yield { model: chunk.model, delta: chunk.delta };
    if (e.error === "unavailable") throw new PlannerUnavailable(new Error("recorded: every model failed"));
  }
}
