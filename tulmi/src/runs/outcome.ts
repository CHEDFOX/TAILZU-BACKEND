/**
 * HOW A STEP ENDED THE RUN, IN A WORD: pure, so every case can be tested.
 *
 * Read from what the step sent last (its terminal event), the code the step
 * returned, and what the person's apps did in it (the Tally the runtime
 * wrapper keeps, ledger.ts). In this order, the first that fits:
 *
 *   the device hung up before the terminal      cancelled / hung_up
 *   no terminal at all (the step threw)         failed / internal
 *   error                                       failed / its code
 *   approve                                     needs_you / approval
 *   ask                                         needs_you / question
 *   action, look, device                        desktop: running (the run goes on)
 *                                               phone: failed / desk_only
 *   done, nothing usable or arguments unfit     failed / that
 *   done after a USE that stopped               asked, on the phone: needs_you / question
 *                                               else failed / its code
 *   done after a hand-off opened                done / handoff
 *   done                                        done
 *
 * A failure after something in the world was already changed is `partial`:
 * part of it happened, and asking again could do that part twice.
 *
 * A tool's own question ("Where to?") keeps a run open only on the phone,
 * whose route holds it for the answer. The desktop says it and ends the run
 * (agent/run.ts useTool), and its next words start a new one: there, the run
 * failed, and nothing waits.
 */
import type { AgentEvent } from "../../../shared/types/api.js";
import type { RunReason, RunState, Surface } from "./types.js";

/** What the run's tools did, counted by the runtime wrapper (ledger.ts). */
export interface Tally {
  /** Changes in the world (see agent_runs.effects). */
  effects: number;
  uses: number;
  opened: boolean;
  approvalTaskId?: string;
  /** The last USE that stopped: its code (connectors/tasks.ts UseOutcome) and whether it asked. */
  stopped?: { code?: string; ask?: boolean };
}

const ITSELF = new Set<RunReason>([
  "not_connected", "needs_reconnect", "blocked",
  "model_unavailable", "internal", "no_speech", "private", "too_many_steps", "bad_target",
  "nothing_usable", "invalid_args",
]);
const BY_CODE: Readonly<Record<string, RunReason>> = {
  timeout: "app_timeout",
  unreachable: "app_unreachable",
  blocked_address: "app_unreachable",
  tool_error: "app_error",
  failed: "app_error",
  unknown_tool: "app_error",
  phone_only: "desk_only",
};

/** An error code, the planner's or an app's (connectors/client.ts), as a reason. Anything unknown: stopped. */
export function reasonOfCode(code: string | undefined): RunReason {
  if (!code) return "stopped";
  if (ITSELF.has(code as RunReason)) return code as RunReason;
  return BY_CODE[code] ?? "stopped";
}

/** Failed, or partial when something was already changed. */
const failed = (reason: RunReason, effects: number): { outcome: RunState; reason: RunReason } =>
  ({ outcome: effects > 0 ? "partial" : "failed", reason });

export function outcomeOf(o: {
  surface: Surface;
  terminal: AgentEvent | undefined;
  /** StepResult.code: an error code, or the step's own "nothing_usable" / "invalid_args". */
  code?: string;
  tally: Tally;
  hungUp?: boolean;
}): { outcome: RunState; reason?: RunReason } {
  const { terminal: t, tally } = o;
  if (o.hungUp) return { outcome: "cancelled", reason: "hung_up" };
  if (!t) return { outcome: "failed", reason: "internal" };
  switch (t.t) {
    case "error":
      return failed(reasonOfCode(t.code || o.code), tally.effects);
    case "approve":
      return { outcome: "needs_you", reason: "approval" };
    case "ask":
      return { outcome: "needs_you", reason: "question" };
    case "action":
    case "look":
    case "device":
      return o.surface === "desktop" ? { outcome: "running" } : { outcome: "failed", reason: "desk_only" };
    case "done":
      if (o.code === "nothing_usable" || o.code === "invalid_args") return failed(o.code, tally.effects);
      if (tally.stopped) {
        return tally.stopped.ask && o.surface === "phone"
          ? { outcome: "needs_you", reason: "question" }
          : failed(reasonOfCode(tally.stopped.code), tally.effects);
      }
      return tally.opened ? { outcome: "done", reason: "handoff" } : { outcome: "done" };
    default:
      // Not a terminal event: the step ended without one, which only a throw does.
      return { outcome: "failed", reason: "internal" };
  }
}

const RETRY_REASONS = new Set<RunReason>(["model_unavailable", "internal", "nothing_usable", "invalid_args", "app_timeout", "app_unreachable"]);

/**
 * Asking again exactly as before is safe and may well work: a phone run that
 * failed for a passing reason having changed nothing. A desktop run is the
 * device's to start again; a run that changed something is never offered.
 */
export function retrySafe(surface: Surface, outcome: RunState, reason: RunReason | undefined, effects: number): boolean {
  return surface === "phone" && outcome === "failed" && effects === 0 && !!reason && RETRY_REASONS.has(reason);
}
