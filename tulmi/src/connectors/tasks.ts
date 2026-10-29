/**
 * A TASK FOR EVERY RUN THAT USES AN APP, AND THE ASK-FIRST RULE.
 *
 * `use()` is the one door a tool call goes through. It finds the tool, judges
 * its risk (risk.ts), applies the app's level and the person's "auto" list,
 * and then does one of three things:
 *
 *   run      the tool is called now and its short result goes back to the run
 *   approve  the task goes to "waiting" with an approval card (the exact
 *            words, recipient or target in plain words), the person's devices
 *            are pushed, and nothing is called until POST .../approve
 *   block    the app's level does not allow this at all; the run is told so
 *
 * An app the person added by link has no level: each of its tools has the
 * policy they set (Allow, Ask, Off; risk.ts gateTool). And once another app's
 * answer is in the run, every call to an app added by link needs a yes,
 * reads included: its arguments are written by a planner that has just read
 * the other app's data, and arguments are how data walks out.
 *
 * Every tool that actually runs, and every refusal by the person, writes an
 * audit row: the tool, its risk, how it ended, a few words. Never arguments,
 * message text or results. The pending call's arguments live on the task only
 * until it runs or is refused, and are never sent out in an API response.
 *
 * An approval is good for an hour: a "yes" given to a card that has been
 * sitting since yesterday is not a yes to what it says now.
 *
 * Before any of that, the call's arguments are read against the tool's own
 * schema (validate.ts). A call that does not fit is "invalid": nothing is
 * judged, shown, run or audited, no task is made, and the run hands what to
 * fix back to its planner. The arguments that go on are the checked ones,
 * with the coercions every reader already makes ("500" for a number), so the
 * card shows and the tool runs exactly what was checked.
 *
 * Every "stopped" says why in a code as well as in words (not_connected,
 * blocked, show_only, unknown_tool, an app's own Fail code), for the run
 * ledger (src/runs), which counts runs and never reads the words.
 */
import { randomUUID } from "node:crypto";
import type { ApprovalCard, DeviceWords } from "../../../shared/types/api.js";
import type { ConnectorHub, Fail } from "./client.js";
import type { ConnectorDef } from "./catalog.js";
import type { HandoffWords } from "./native.js";
import { ConnectorError } from "./oauth.js";
import { policyOf } from "./hygiene.js";
import { gate, gateTool, type Gate, type Level, type Risk } from "./risk.js";
import { TASK_STEPS_MAX, type Approval, type ConnectorStore, type Task } from "./store.js";
import { checkArgs, problemLine } from "./validate.js";
import { en } from "./words.js";

export const APPROVAL_TTL_MS = 60 * 60_000;
/** The step a card that waited past APPROVAL_TTL_MS ends on (the You tab's Activity reads it). */
export const EXPIRED_STEP = "That request expired before you answered";
/** How many approved kinds of change one app remembers (the newest kept). */
const REMEMBER_MAX = 100;
const PREVIEW_MAX = 400;

/** What the run is told about a USE line. */
export type UseOutcome =
  | { kind: "result"; text: string }
  | { kind: "approval"; taskId: string; approval: ApprovalView; card?: ApprovalCard }
  /**
   * Nothing ran; `message` is said to the person as it is. `ask` when it is
   * a hand-off asking for what it was not given ("What's their UPI ID?"):
   * their next words answer it. `code` says why, for the run ledger.
   */
  | { kind: "stopped"; message: string; ask?: boolean; code?: string }
  /**
   * The arguments did not fit the tool's schema (validate.ts), and nothing
   * ran: `problems` is what to fix, for the planner (problemLine, names only),
   * and `message` the line said to the person if it is still not right.
   */
  | { kind: "invalid"; problems: string; message: string }
  /** A tool of "This computer" (device.ts): nothing ran here; the run sends it to the person's desktop, which does it on their own files. */
  | { kind: "device"; tool: string; args: Record<string, unknown>; risk: "read" | "write" | "destructive"; words: DeviceWords }
  /** Something for the person's own device to open (a hand-off): the run says `say`, opens it and ends. `words` is the app's own line, worded for the person before the run sees it. */
  | { kind: "open"; url: string; label: string; fallback?: string; say?: string; words?: HandoffWords };

/** An approval as the device sees it: no arguments. "read" only for an app added by link (see the top of this file). */
export interface ApprovalView { id: string; connector: string; tool: string; risk: Risk; preview: string }

export interface TaskView {
  id: string;
  state: Task["state"];
  title: string;
  steps: Array<{ at: number; text: string }>;
  approval: ApprovalView | null;
  createdAt: number;
  updatedAt: number;
}

export const viewOfApproval = (a: Approval): ApprovalView =>
  ({ id: a.id, connector: a.connector, tool: a.tool, risk: a.risk, preview: a.preview });

export const viewOfTask = (t: Task): TaskView => ({
  id: t.id, state: t.state, title: t.title, steps: t.steps, approval: t.approval ? viewOfApproval(t.approval) : null,
  createdAt: t.createdAt, updatedAt: t.updatedAt,
});

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const human = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ").trim();

/** Keys that say who or what a call is about come first on the card. */
const KEY_FIRST = /^(to|recipient|recipients|email|channel|chat|user|assignee|title|subject|name|text|body|message|content|description|url|id|target|page|issue|repo|date|start|end)/i;

/** "Post message in Slack: channel: #general; text: "Running late"" for the confirm card. */
export function previewOf(def: ConnectorDef, tool: string, args: Record<string, unknown>): string {
  const show = (v: unknown): string =>
    typeof v === "string" ? `"${clip(v.replace(/\s+/g, " ").trim(), 160)}"`
      : Array.isArray(v) ? v.map(show).join(", ")
        : v !== null && typeof v === "object" ? clip(JSON.stringify(v), 120) : String(v);
  const pairs = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => Number(KEY_FIRST.test(b)) - Number(KEY_FIRST.test(a)))
    .slice(0, 6)
    .map(([k, v]) => `${human(k)}: ${show(v)}`);
  const head = `${clip(human(tool), 60).replace(/^./, (c) => c.toUpperCase())} in ${def.name}`;
  return clip(pairs.length ? `${head} — ${pairs.join("; ")}` : head, PREVIEW_MAX);
}

export interface TasksOptions {
  store: ConnectorStore;
  hub: ConnectorHub;
  now?: () => number;
  /** Tell the person's devices something is waiting. Best effort. */
  notify?: (userId: string, task: Task, approval: Approval) => Promise<void>;
}

export class TaskService {
  private readonly now: () => number;
  /** runId -> task id, for runs this process has seen use an app. */
  private readonly runs = new Map<string, string>();

  constructor(private readonly o: TasksOptions) {
    this.now = o.now ?? Date.now;
  }

  private async step(userId: string, task: Task, text: string, patch: Partial<Pick<Task, "state" | "approval">> = {}): Promise<Task> {
    const steps = [...task.steps, { at: this.now(), text: clip(text, 160) }].slice(-TASK_STEPS_MAX);
    return (await this.o.store.updateTask(userId, task.id, { steps, ...patch })) ?? task;
  }

  private async taskFor(userId: string, runId: string, said: string): Promise<Task> {
    const known = this.runs.get(`${userId}|${runId}`);
    const open = (known ? await this.o.store.getTask(userId, known) : null) ?? (await this.o.store.openTaskForRun(userId, runId));
    if (open && (open.state === "running" || open.state === "waiting")) {
      this.runs.set(`${userId}|${runId}`, open.id);
      return open;
    }
    const made = await this.o.store.createTask(userId, { runId, title: clip(said.replace(/\s+/g, " ").trim() || "Assistant task", 80) });
    this.runs.set(`${userId}|${runId}`, made.id);
    if (this.runs.size > 2000) this.runs.delete(this.runs.keys().next().value!);
    return made;
  }

  /** Whether an app other than this one has already answered in this run (an "ok" in its task's audit trail). */
  private async otherAppAnswered(userId: string, runId: string, connectorId: string): Promise<boolean> {
    const known = this.runs.get(`${userId}|${runId}`);
    const task = (known ? await this.o.store.getTask(userId, known) : null) ?? (await this.o.store.openTaskForRun(userId, runId));
    if (!task) return false;
    return (await this.o.store.listAudit(userId, task.id)).some((a) => a.outcome === "ok" && a.connectorId !== connectorId);
  }

  private audit(userId: string, task: Task, connectorId: string, tool: string, risk: Risk, outcome: "ok" | "failed" | "denied", fail?: Fail) {
    return this.o.store.addAudit({
      taskId: task.id, userId, connectorId, tool, risk, outcome, at: this.now(),
      summary: outcome === "ok" ? `${tool} ran` : outcome === "denied" ? `${tool} refused by the person` : `${tool} failed (${fail?.code ?? "failed"})`,
    });
  }

  /** One USE line from the planner. */
  async use(
    userId: string, runId: string, said: string,
    line: { connector: string; tool: string; args: Record<string, unknown> },
    opts: { allowWrite: boolean },
  ): Promise<UseOutcome> {
    const def = await this.o.hub.resolve(userId, line.connector);
    // An app that needs no permission (the email hand-off) has no connection to look for.
    const free = def?.auth === "none";
    const conn = def && !free ? await this.o.store.getConnection(userId, line.connector) : null;
    if (!def || (!free && !conn?.tokensEnc)) {
      return { kind: "stopped", message: `${def?.name ?? "That app"} isn't connected. You can connect it in X0 Bot.`, code: "not_connected" };
    }
    /** The app could not be asked: its own words and code when it gave them. */
    const trouble = (e: unknown): UseOutcome => e instanceof ConnectorError
      ? { kind: "stopped", message: e.message, code: e.code }
      : { kind: "stopped", message: `${def.name} ran into a problem.`, code: "failed" };
    let tools;
    try {
      tools = await this.o.hub.tools(userId, def.id);
    } catch (e) {
      return trouble(e);
    }
    const info = tools.find((t) => t.name === line.tool);
    if (!info) {
      // An app added by link hides a tool that changed since the person approved it, and one they switched off.
      const now = def.custom ? await this.o.store.getConnection(userId, def.id) : null;
      const changed = now?.toolsChanged.includes(line.tool) === true;
      const off = now?.toolPolicy[line.tool] === "off";
      return {
        kind: "stopped",
        message: changed ? `${human(line.tool)} changed in ${def.name} since you approved it. Have a look in X0 Bot first.`
          : off ? `${human(line.tool)} is switched off for ${def.name}. You can change that in X0 Bot.`
            : `${def.name} doesn't have an action called ${clip(line.tool, 40)}.`,
        code: changed || off ? "blocked" : "unknown_tool",
      };
    }

    // The arguments, against the tool's own schema: a call that cannot be
    // right is never judged, shown or run. A hand-off asks for what it was not
    // given in its own words, so only a value it needs is not looked for there.
    const checked = checkArgs(info.inputSchema, line.args, { required: !free });
    if (!checked.ok) return { kind: "invalid", problems: problemLine(checked.problems), message: en("va.failed", { app: def.name }) };
    const args = checked.args;

    let risk: Risk;
    try {
      risk = await this.o.hub.riskFor(userId, def, info, args);
    } catch (e) {
      return trouble(e);
    }
    let verdict: Gate;
    // The hand-off only opens a draft the person sends themselves, so it runs without asking; but only on a command.
    if (free) verdict = opts.allowWrite || risk === "read" ? "run" : "approve";
    else if (def.custom) {
      verdict = gateTool(risk, policyOf(info, conn!));
      if (verdict === "run" && await this.otherAppAnswered(userId, runId, def.id)) verdict = "approve";
    } else verdict = gate(risk, conn!.level, conn!.autoOk.includes(info.name));
    if (verdict === "block") {
      return {
        kind: "stopped", code: "blocked",
        message: def.custom ? `${human(info.name)} is switched off for ${def.name}. You can change that in X0 Bot.` : blockedMessage(def.name, conn!.level, risk),
      };
    }
    if (verdict === "approve" && !opts.allowWrite) {
      return {
        kind: "stopped", code: "show_only",
        message: free ? `Ask me as a command and I'll open it in ${def.name}.`
          : risk === "read" ? `I check with you before using ${def.name}. Ask me as a command and I'll ask you first.`
            : `That would change something in ${def.name}. Ask me as a command and I'll check with you first.`,
      };
    }

    // The card's words first: a call the app finds cannot be done is said now, with no task left behind.
    let preview: string | undefined;
    if (verdict === "approve") {
      try {
        preview = await this.o.hub.previewFor(userId, def, info.name, args);
      } catch (e) {
        return trouble(e);
      }
    }

    let task = await this.taskFor(userId, runId, said);
    if (verdict === "run") {
      const out = await this.o.hub.call(userId, def.id, info.name, args);
      await this.audit(userId, task, def.id, info.name, risk, out.ok ? "ok" : "failed", out.error);
      task = await this.step(userId, task, out.ok ? `${def.name}: ${human(info.name)}` : `${def.name}: ${human(info.name)} failed`);
      if (out.ok && out.open) return { kind: "open", ...out.open };
      if (out.ok) return { kind: "result", text: out.text };
      // A hand-off refuses over what it was given ("What's their UPI ID?"), so their next words answer it.
      const asks = free && out.error!.code === "rejected";
      return { kind: "stopped", message: out.error!.message, code: out.error!.code, ...(asks ? { ask: true } : {}) };
    }

    const approval: Approval = {
      id: randomUUID(), connector: def.id, tool: info.name, risk, args,
      preview: clip(preview ?? previewOf(def, info.name, args), PREVIEW_MAX), at: this.now(),
    };
    task = await this.step(userId, task, `Waiting for you: ${human(info.name)} in ${def.name}`, { state: "waiting", approval });
    void Promise.resolve().then(() => this.o.notify?.(userId, task, approval)).catch(() => {});
    return { kind: "approval", taskId: task.id, approval: viewOfApproval(approval) };
  }

  /** The run ended: close its task, if it has one. */
  async settle(userId: string, runId: string, ending: string | undefined): Promise<void> {
    const id = this.runs.get(`${userId}|${runId}`);
    if (!id || !ending) return;
    const state = ending.startsWith("error") ? "failed" : ending === "done" ? "done" : null;
    if (!state) return;
    this.runs.delete(`${userId}|${runId}`);
    const task = await this.o.store.getTask(userId, id);
    if (task?.state === "running") await this.step(userId, task, state === "done" ? "Finished" : "Stopped with a problem", { state });
  }

  async list(userId: string, limit = 20): Promise<TaskView[]> {
    return (await this.o.store.listTasks(userId, limit)).map(viewOfTask);
  }

  /** Yes. Runs the waiting call once, whoever taps first. */
  async approve(userId: string, taskId: string, approvalId?: string):
    Promise<{ status: "ok" | "failed" | "not_found" | "not_waiting" | "expired"; result?: string; error?: Fail; task?: TaskView }> {
    const peek = await this.o.store.getTask(userId, taskId);
    if (!peek) return { status: "not_found" };
    if (peek.state !== "waiting" || !peek.approval) return { status: "not_waiting", task: viewOfTask(peek) };
    if (approvalId && approvalId !== peek.approval.id) return { status: "not_waiting", task: viewOfTask(peek) };
    const task = await this.o.store.claimWaiting(userId, taskId);
    if (!task?.approval) return { status: "not_waiting", task: peek ? viewOfTask(peek) : undefined };
    const a = task.approval;
    const def = await this.o.hub.resolve(userId, a.connector).catch(() => undefined);

    if (this.now() - a.at > APPROVAL_TTL_MS) {
      const t = await this.step(userId, task, EXPIRED_STEP, { state: "cancelled", approval: null });
      return { status: "expired", task: viewOfTask(t) };
    }
    const conn = def ? await this.o.store.getConnection(userId, a.connector) : null;
    if (!def || !conn?.tokensEnc) {
      const error = { code: "not_connected", message: `${def?.name ?? "That app"} isn't connected any more.` };
      const t = await this.step(userId, task, error.message, { state: "failed", approval: null });
      return { status: "failed", error, task: viewOfTask(t) };
    }
    // Switched off, or changed and not looked at, while the card was waiting: a yes to the card is not a yes to that.
    if (def.custom && (conn.toolPolicy[a.tool] === "off" || conn.toolsChanged.includes(a.tool))) {
      const error = { code: "blocked", message: `${human(a.tool)} isn't available in ${def.name} any more.` };
      const t = await this.step(userId, task, error.message, { state: "failed", approval: null });
      return { status: "failed", error, task: viewOfTask(t) };
    }
    const out = await this.o.hub.call(userId, a.connector, a.tool, a.args);
    await this.audit(userId, task, a.connector, a.tool, a.risk, out.ok ? "ok" : "failed", out.error);
    const t = await this.step(
      userId, task,
      out.ok ? `${def.name}: ${human(a.tool)} (you approved)` : `${def.name}: ${human(a.tool)} failed`,
      { state: out.ok ? "done" : "failed", approval: null },
    );
    // A yes is the one-time permission for this kind of change in this app:
    // from now on it runs without asking. A delete or a payment is asked every
    // time, and an app added by link keeps its own per-tool choices.
    if (out.ok && !def.custom && (a.risk === "write" || a.risk === "send")) {
      const autoOk = conn.autoOk.includes(a.tool) ? conn.autoOk : [...conn.autoOk, a.tool].slice(-REMEMBER_MAX);
      await this.o.store.upsertConnection(userId, a.connector, { autoOk, ...(conn.level !== "send" ? { level: "send" as Level } : {}) }).catch(() => {});
    }
    return out.ok ? { status: "ok", result: out.text, task: viewOfTask(t) } : { status: "failed", error: out.error, task: viewOfTask(t) };
  }

  /** No. Nothing is called. */
  async deny(userId: string, taskId: string): Promise<{ status: "ok" | "not_found" | "not_waiting"; task?: TaskView }> {
    const peek = await this.o.store.getTask(userId, taskId);
    if (!peek) return { status: "not_found" };
    const task = peek.state === "waiting" && peek.approval ? await this.o.store.claimWaiting(userId, taskId) : null;
    if (!task?.approval) return { status: "not_waiting", task: viewOfTask(peek) };
    const a = task.approval;
    await this.audit(userId, task, a.connector, a.tool, a.risk, "denied");
    const t = await this.step(userId, task, `You said no to ${human(a.tool)}`, { state: "cancelled", approval: null });
    return { status: "ok", task: viewOfTask(t) };
  }
}

function blockedMessage(app: string, level: Level, risk: Risk): string {
  const what = risk === "send" ? "send things" : risk === "destructive" ? "delete things" : risk === "pay" ? "make payments" : "change things";
  return level === "look"
    ? `${app} is set to look only, so I can't ${what} there. You can change that in X0 Bot.`
    : `${app} is set to drafts only, so I can't ${what} there. You can change that in X0 Bot.`;
}
