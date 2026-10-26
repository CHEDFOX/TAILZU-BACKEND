/**
 * THE RUN LEDGER: every Ask run written down, and its receipt.
 *
 * A route begins a watch on each step (`begin`) and hands its parts to the
 * step: the EventSink's hooks, the plan's log, and the person's apps wrapped.
 * Through them the watch sees how the step ended, what the apps did and what
 * each planner call cost, and nothing the step said or read: a USE is
 * counted by its kind and its tool's declared risk, never its arguments or
 * result. A change it cannot be sure of (a write that timed out, a USE that
 * threw) is counted as one: a run that may have changed something is never
 * offered to the person to try again.
 *
 * The receipt is the run's last word, sent with the step that ends it on the
 * server's side: on the desktop, an event just before done, error, ask or
 * approve (never before action, look or device: the run goes on); on the
 * phone, the answer's `receipt`. A step that ends with nothing done says why
 * to its sink before its done (EventSink.code: nothing usable, arguments that
 * did not fit), so the receipt that goes before the done says it too. `end()`
 * makes it final with what the step returned, which is what the phone's
 * answer carries.
 *
 * Nothing is written while the person waits. A step's row and its planner
 * calls go out once its stream has closed (calls that come in later, from a
 * stream read to its end after the answer, follow on their own), one write
 * after another for each run. The one exception is the phone's question
 * back: its answer can come a second later, so the route waits for that row.
 * The phone's ask also reads (and claims) a question waiting for it before
 * it starts. Neither wait is longer than LEDGER_WAIT_MS: a store slower than
 * that costs the person a question kept, never their answer. A write that
 * fails is logged, and the person never hears of it.
 *
 * WHAT IS KEPT OF WHAT THEY SAID. A row is how the run went, and only on
 * the phone any of their words: the title (for the You tab's Activity), the
 * words to try again with, and a question back with the request before it.
 * A desktop run keeps none of its words, and nor does a request refused as
 * private. A question back asked after the step read an app's answer may
 * carry what the app said, which is never stored: the store keeps only that
 * it was asked, and its words are held in this process for its five minutes,
 * as every question back was before the ledger (on another server, or after
 * a restart, the answer is read without them).
 *
 * With AGENT_RUN_LEDGER off (the default) the store is the in-memory twin;
 * receipts are sent all the same, since they cost nothing.
 */
import type { AgentEvent, AgentTurn, RunReceipt } from "../../../shared/types/api.js";
import type { CallRecord } from "../agent/llm.js";
import { withoutUrlSecrets, type SinkHooks } from "../agent/protocol.js";
import type { ConnectorsRuntime, StepResult } from "../agent/run.js";
import type { ConnectorHub } from "../connectors/client.js";
import type { UseOutcome } from "../connectors/tasks.js";
import { outcomeOf, retrySafe, type Tally } from "./outcome.js";
import { runStore } from "./store.js";
import { SWEEP_TIMES, type CallRow, type RunPlatform, type RunReason, type RunState, type RunStore, type StepRecord, type Surface } from "./types.js";
import { receiptLine } from "./words.js";

export interface StepStart {
  userId: string;
  runId: string;
  surface: Surface;
  platform: RunPlatform;
  step: number;
  /** Their words this step, for the title on the first step and the retry words. */
  said?: string;
  language?: string;
  /** The run whose question this answers (phone). */
  follows?: string;
  /** The run's title when it is not `said`: a phone answer ("rahul@okhdfcbank") is titled by the request it answers. */
  title?: string;
}

export interface StepWatch {
  /** The EventSink's hooks for this step: the receipt before the terminal event, and when each event went. */
  readonly sink: SinkHooks;
  /** The plan dep's log: each planner call, written to agent_calls as it arrives (after a drained stream too). */
  call(c: CallRecord): void;
  /** The person's apps, each USE counted (its kind, its tool's declared risk), never its arguments. */
  watch(rt: ConnectorsRuntime, hub: ConnectorHub): ConnectorsRuntime;
  /** The phone's question back, held for its answer (written by end()). */
  waitForAnswer(turns: AgentTurn[]): void;
  /** The receipt the step sent, if it sent one; after end(), made final with what the step returned. */
  readonly receipt: RunReceipt | undefined;
  /** After the stream has closed. Writes the step; resolves when the row is written; never throws. */
  end(result: StepResult | undefined, o?: { hungUp?: boolean }): Promise<void>;
}

/** The terminals after which a desktop run is over as far as the server can tell. */
const ENDS_DESKTOP_RUN = new Set<AgentEvent["t"]>(["done", "error", "ask", "approve"]);
/** Desktop actions that change something; scrolling and focusing do not. */
const CHANGES = new Set(["press", "set", "type", "key", "open"]);
const TITLE_MAX = 80;
/** As much of their words as a step may carry (protocol.ts LIMITS.utterance). */
const SAID_MAX = 1000;
/**
 * How a call can fail after it reached the app, having perhaps done its work:
 * a call that took too long is not called off (connectors/client.ts races it
 * against a timer), and a lost connection or an app's own error can come after
 * the change was made. A tool that changes things and stopped this way is
 * counted as a change, so the run is never offered again as safe.
 */
const MAY_HAVE_RUN = new Set(["timeout", "unreachable", "failed", "tool_error"]);
/** Runs whose earlier steps' changes are remembered here, for the next receipt. */
const RUNS_MAX = 2000;
/** The longest a person's request waits on the store: to claim the question its words may answer, or to keep the one it asks. */
export const LEDGER_WAIT_MS = 2000;

/** What `p` gives, or `fallback` once `ms` have gone by without it. `p` goes on either way. */
export function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<T>((r) => { timer = setTimeout(() => r(fallback), ms); timer.unref?.(); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** One line of their words: no control characters, single spaces. */
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

interface Log { warn(o: object, msg: string): void }

export interface LedgerOptions {
  /** runStore() when not given, read when first used. */
  store?: RunStore;
  now?: () => number;
  log?: Log;
  /** The longest a request waits on the store (LEDGER_WAIT_MS). */
  waitMs?: number;
}

export class RunLedger {
  private readonly now: () => number;
  /** userId|runId -> the run's writes, one after another; dropped when the last settles. */
  private readonly chains = new Map<string, Promise<void>>();
  /**
   * userId|runId -> changes made by this run's earlier steps, for the next
   * step's receipt. In memory: after a restart a receipt counts from the step
   * it is on (the row's total is the store's, and stays right).
   */
  private readonly earlier = new Map<string, number>();
  /** userId|runId -> a phone question back whose words the store does not keep, held for its answer. */
  private readonly held = new Map<string, { turns: AgentTurn[]; at: number }>();
  /** userId|runId of an answer -> the turns of its history whose words were held here, to keep out of the store again. */
  private readonly heldIn = new Map<string, number[]>();

  constructor(private readonly o: LedgerOptions = {}) {
    this.now = o.now ?? Date.now;
  }

  /** The longest a request waits on the store before it goes on without it. */
  get waitMs(): number { return this.o.waitMs ?? LEDGER_WAIT_MS; }

  /** The store, read when it is used: the config may be set after this is made. */
  private get store(): RunStore { return this.o.store ?? runStore(); }

  begin(s: StepStart): StepWatch {
    const key = `${s.userId}|${s.runId}`;
    const heldIn = this.heldIn.get(key) ?? [];
    this.heldIn.delete(key);
    return new Step(s, {
      now: this.now,
      store: () => this.store,
      after: (f) => this.after(key, f),
      earlier: () => this.earlier.get(key) ?? 0,
      remember: (effects, open) => {
        this.earlier.delete(key);
        if (!open) return;
        if (this.earlier.size >= RUNS_MAX) this.earlier.delete(this.earlier.keys().next().value!);
        this.earlier.set(key, effects);
      },
      heldIn,
      hold: (turns) => {
        const at = this.now();
        // Oldest first: anything past its five minutes can no longer be answered.
        for (const [k, v] of this.held) {
          if (at - v.at <= SWEEP_TIMES.followUpMs && this.held.size < RUNS_MAX) break;
          this.held.delete(k);
        }
        this.held.set(key, { turns, at });
      },
    });
  }

  /** The phone's question waiting for this answer, claimed (RunStore.takeFollowUp). Null when there is none, or the store failed or was too slow. */
  async takeFollowUp(userId: string, by: string, since: number): Promise<{ runId: string; turns: AgentTurn[] } | null> {
    const read = this.store.takeFollowUp(userId, by, since).catch((err: unknown) => {
      this.o.log?.warn({ error: (err as Error)?.message }, "run ledger: follow-up not read");
      return null;
    });
    const got = await within(read, this.waitMs, null);
    if (!got) return null;
    const kept = this.held.get(`${userId}|${got.runId}`);
    this.held.delete(`${userId}|${got.runId}`);
    if (!kept || kept.turns.length !== got.turns.length) return got;
    // The question's words, held here, go back with the request; the answer's run keeps them out of the store again.
    const hidden = got.turns.flatMap((t, i) => (t.note === undefined && kept.turns[i]!.note !== undefined ? [i] : []));
    if (this.heldIn.size >= RUNS_MAX) this.heldIn.delete(this.heldIn.keys().next().value!);
    this.heldIn.set(`${userId}|${by}`, hidden);
    return { runId: got.runId, turns: kept.turns };
  }

  /** A write for one run, after the ones before it. Never rejects. */
  private after(key: string, write: () => Promise<void>): Promise<void> {
    const next = (this.chains.get(key) ?? Promise.resolve())
      .then(write)
      .catch((err: unknown) => { this.o.log?.warn({ error: (err as Error)?.message }, "run ledger: not written"); });
    this.chains.set(key, next);
    void next.then(() => { if (this.chains.get(key) === next) this.chains.delete(key); });
    return next;
  }
}

/**
 * A planner call as the ledger keeps it: the CallRecord's numbers under the
 * run, step and time it belongs to. The one place a CallRecord becomes a
 * CallRow, shared by a step's watch and by the Code bot's model gateway
 * (code/brain/gateway.ts), which writes its calls to the same table. Never any
 * of what was asked or answered: a CallRecord has none.
 */
export function callRowOf(c: CallRecord, at: { runId: string; step: number; surface: Surface; at: number }): CallRow {
  return {
    runId: at.runId, step: at.step, surface: at.surface, at: at.at, model: c.model, outcome: c.outcome, ms: c.ms,
    ...(c.provider ? { provider: c.provider } : {}), ...(c.served ? { served: c.served } : {}),
    ...(typeof c.firstMs === "number" ? { firstMs: c.firstMs } : {}),
    ...(typeof c.promptTokens === "number" ? { promptTokens: c.promptTokens } : {}),
    ...(typeof c.cachedTokens === "number" ? { cachedTokens: c.cachedTokens } : {}),
    ...(typeof c.completionTokens === "number" ? { completionTokens: c.completionTokens } : {}),
    ...(typeof c.reasoningTokens === "number" ? { reasoningTokens: c.reasoningTokens } : {}),
    ...(typeof c.costUsd === "number" ? { costUsd: c.costUsd } : {}),
    ...(typeof c.status === "number" ? { status: c.status } : {}),
    ...(c.picture ? { picture: true } : {}), ...(c.deep ? { deep: true } : {}),
  };
}

/** What a step's watch needs of its ledger. */
interface Keeper {
  now: () => number;
  store: () => RunStore;
  after: (write: () => Promise<void>) => Promise<void>;
  /** Changes made by this run's earlier steps. */
  earlier: () => number;
  /** The run's changes so far, kept while it is still open. */
  remember: (effects: number, open: boolean) => void;
  /** The turns of this answer's history whose words were held, not stored (RunLedger.held). */
  heldIn: readonly number[];
  /** Holds this step's question back, words and all, for its answer. */
  hold: (turns: AgentTurn[]) => void;
}

class Step implements StepWatch {
  private readonly t0: number;
  private firstAt: number | undefined;
  private terminal: AgentEvent | undefined;
  /** A tool's answer was read in this step: what the planner says after it may carry an app's words. */
  private readApp = false;
  private readonly tally: Tally = { effects: 0, uses: 0, opened: false };
  private turns: AgentTurn[] | undefined;
  /** Planner calls held until the step ends; null once it has, and they go out as they come. */
  private calls: CallRow[] | null = [];
  private last: RunReceipt | undefined;
  private written: Promise<void> | undefined;

  constructor(private readonly s: StepStart, private readonly d: Keeper) {
    this.t0 = d.now();
  }

  readonly sink: SinkHooks = {
    beforeEnd: (terminal, code) => {
      this.terminal = terminal;
      if (terminal.t === "action" && this.s.surface === "desktop" && CHANGES.has(terminal.kind)) this.tally.effects += 1;
      if (this.s.surface === "desktop" && !ENDS_DESKTOP_RUN.has(terminal.t)) return null;
      this.firstAt ??= this.d.now();
      const ended = outcomeOf({ surface: this.s.surface, terminal, ...(code ? { code } : {}), tally: this.tally });
      if (ended.outcome === "running") return null;
      this.last = this.receiptOf(ended.outcome, ended.reason, this.d.now());
      return { t: "receipt", receipt: this.last };
    },
    seen: (e) => {
      if (e.t !== "heard" && e.t !== "receipt") this.firstAt ??= this.d.now();
    },
  };

  get receipt(): RunReceipt | undefined { return this.last; }

  call(c: CallRecord): void {
    const row = callRowOf(c, { runId: this.s.runId, step: this.s.step, surface: this.s.surface, at: this.d.now() });
    if (this.calls) this.calls.push(row);
    else void this.d.after(() => this.d.store().addCalls(this.s.userId, [row]));
  }

  watch(rt: ConnectorsRuntime, hub: ConnectorHub): ConnectorsRuntime {
    const tally = this.tally;
    const userId = this.s.userId;
    return {
      cards: (req, said) => rt.cards(req, said),
      settle: (runId, ending) => rt.settle(runId, ending),
      use: async (runId, said, line, opts) => {
        let o: UseOutcome;
        try {
          o = await rt.use(runId, said, line, opts);
        } catch (err) {
          // It may have thrown after the tool ran (its audit row not written): unsure is a change.
          tally.uses += 1;
          if (await changes(hub, userId, line)) tally.effects += 1;
          throw err;
        }
        tally.uses += 1;
        // Only the last USE's stop says how the step ended: a later one that ran clears it.
        tally.stopped = o.kind === "stopped" ? { ...(o.code ? { code: o.code } : {}), ...(o.ask ? { ask: true } : {}) } : undefined;
        if (o.kind === "result") {
          this.readApp = true;
          if (await changes(hub, userId, line)) tally.effects += 1;
        }
        else if (o.kind === "stopped") { if (o.code && MAY_HAVE_RUN.has(o.code) && await changes(hub, userId, line)) tally.effects += 1; }
        else if (o.kind === "open") { tally.effects += 1; tally.opened = true; }
        else if (o.kind === "device") { if (o.risk !== "read") tally.effects += 1; }
        else if (o.kind === "approval") tally.approvalTaskId = o.taskId;
        return o;
      },
    };
  }

  waitForAnswer(turns: AgentTurn[]): void {
    this.turns = turns;
  }

  end(result: StepResult | undefined, o: { hungUp?: boolean } = {}): Promise<void> {
    if (this.written) return this.written;
    const at = this.d.now();
    const { surface } = this.s;
    const ended = outcomeOf({ surface, terminal: this.terminal, code: result?.code, tally: this.tally, hungUp: o.hungUp });
    const effects = this.d.earlier() + this.tally.effects;
    const words = this.retryWords(ended.outcome, ended.reason, effects);
    if (ended.outcome !== "running") this.last = this.receiptOf(ended.outcome, ended.reason, at);
    // Open: the desktop will be back with its next step (after an action, or with the answer to its question).
    this.d.remember(effects, surface === "desktop" && (ended.outcome === "running" || ended.reason === "question"));
    const t = this.terminal;
    const taskId = t?.t === "approve" ? t.taskId : this.tally.approvalTaskId;
    // Kept for a month and shown back, from the phone only, and never for a
    // request refused as private: a link's query (where reset tokens live) is
    // not kept with it.
    const title = surface === "phone" && result?.code !== "private"
      ? clip(withoutUrlSecrets(clean(this.s.title ?? this.s.said ?? "")), TITLE_MAX) : "";
    const record: StepRecord = {
      runId: this.s.runId, surface, platform: this.s.platform, step: this.s.step, outcome: ended.outcome,
      ...(ended.reason ? { reason: ended.reason } : {}),
      effects: this.tally.effects,
      ms: Math.max(0, at - this.t0),
      ...(this.firstAt !== undefined ? { firstMs: Math.max(0, this.firstAt - this.t0) } : {}),
      ...(result?.path ? { path: result.path } : {}),
      ...(result?.mode ? { mode: result.mode } : {}),
      ...(this.s.language ? { language: this.s.language } : {}),
      ...(taskId ? { taskId } : {}),
      ...(this.s.follows ? { follows: this.s.follows } : {}),
      ...(title ? { title } : {}),
      said: words,
      ...(surface === "phone" ? { turns: this.keptTurns() } : {}),
    };
    const calls = this.calls ?? [];
    this.calls = null;
    // Asked again in the same words (Try again, or typed the same): the run
    // that kept them to try again with stops offering it. Before this step's
    // own row, which may keep them anew.
    const again = surface === "phone" && !this.s.follows ? clean(this.s.said ?? "").slice(0, SAID_MAX) : "";
    if (again) void this.d.after(() => this.d.store().forgetRetry(this.s.userId, again));
    this.written = this.d.after(async () => {
      await this.d.store().saveStep(this.s.userId, record);
      if (calls.length) await this.d.store().addCalls(this.s.userId, calls);
    });
    return this.written;
  }

  /**
   * The phone's question back as the store keeps it. One asked after the step
   * read an app's answer may carry what the app said: the store keeps that it
   * was asked, and its words are held in this process for the answer. So are
   * the words of an earlier question in the chain that was held.
   */
  private keptTurns(): AgentTurn[] | null {
    const turns = this.turns;
    if (!turns) return null;
    const hide = new Set(this.d.heldIn);
    if (this.readApp) hide.add(turns.length - 1);
    if (!hide.size) return turns;
    this.d.hold(turns);
    return turns.map((t, i) => (hide.has(i) ? withoutNote(t) : t));
  }

  /**
   * Their words to ask again with: a phone run that failed for a passing
   * reason having changed nothing. Not an answer to a question back: its
   * words alone ("rahul@okhdfcbank") are not the request.
   */
  private retryWords(outcome: RunState, reason: RunReason | undefined, effects: number): string | null {
    const said = clean(this.s.said ?? "").slice(0, SAID_MAX);
    return said && !this.s.follows && retrySafe(this.s.surface, outcome, reason, effects) ? said : null;
  }

  private receiptOf(outcome: Exclude<RunState, "running">, reason: RunReason | undefined, at: number): RunReceipt {
    const effects = this.d.earlier() + this.tally.effects;
    const t = this.terminal;
    const taskId = reason === "approval" ? (t?.t === "approve" ? t.taskId : this.tally.approvalTaskId) : undefined;
    return {
      runId: this.s.runId, outcome, ...(reason ? { reason } : {}),
      line: receiptLine(outcome, reason, this.s.language),
      effects,
      steps: this.s.surface === "phone" ? 1 : this.s.step + 1,
      ms: Math.max(0, at - this.t0),
      ...(this.firstAt !== undefined ? { firstMs: Math.max(0, this.firstAt - this.t0) } : {}),
      ...(taskId ? { taskId } : {}),
      ...(this.retryWords(outcome, reason, effects) ? { retry: true as const } : {}),
    };
  }
}

/** A turn without its note: that something was asked, not what. */
function withoutNote(t: AgentTurn): AgentTurn {
  const { note: _note, ...rest } = t;
  return rest;
}

/** Whether a tool that ran and answered changed something: its declared risk is not a read. Unsure counts as a change, so a run is never wrongly offered again. */
async function changes(hub: ConnectorHub, userId: string, line: { connector: string; tool: string }): Promise<boolean> {
  try {
    const def = await hub.resolve(userId, line.connector);
    if (!def) return true;
    const info = (await hub.tools(userId, def.id)).find((t) => t.name === line.tool);
    return !info || hub.toolRisk(def, info) !== "read";
  } catch {
    return true;
  }
}
