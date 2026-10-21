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
 * Every tool that actually runs, and every refusal by the person, writes an
 * audit row: the tool, its risk, how it ended, a few words. Never arguments,
 * message text or results. The pending call's arguments live on the task only
 * until it runs or is refused, and are never sent out in an API response.
 *
 * An approval is good for an hour: a "yes" given to a card that has been
 * sitting since yesterday is not a yes to what it says now.
 */
import { randomUUID } from "node:crypto";
import type { ConnectorHub, Fail } from "./client.js";
import type { ConnectorDef } from "./catalog.js";
import { ConnectorError } from "./oauth.js";
import { gate, riskOf, type Level, type Risk } from "./risk.js";
import type { Approval, ConnectorStore, Task } from "./store.js";

export const APPROVAL_TTL_MS = 60 * 60_000;
const STEPS_MAX = 30;
const PREVIEW_MAX = 400;

/** What the run is told about a USE line. */
export type UseOutcome =
  | { kind: "result"; text: string }
  | { kind: "approval"; taskId: string; approval: ApprovalView }
  /** Nothing ran; `message` is said to the person as it is. */
  | { kind: "stopped"; message: string };

/** An approval as the device sees it: no arguments. */
export interface ApprovalView { id: string; connector: string; tool: string; risk: Exclude<Risk, "read">; preview: string }

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
  ({ id: a.id, connector: a.connector, tool: a.tool, risk: a.risk as ApprovalView["risk"], preview: a.preview });

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
    const steps = [...task.steps, { at: this.now(), text: clip(text, 160) }].slice(-STEPS_MAX);
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
    const def = this.o.hub.def(line.connector);
    const conn = def ? await this.o.store.getConnection(userId, line.connector) : null;
    if (!def || !conn?.tokensEnc) {
      return { kind: "stopped", message: `${def?.name ?? "That app"} isn't connected. You can connect it in Tailzu.` };
    }
    let tools;
    try {
      tools = await this.o.hub.tools(userId, def.id);
    } catch (e) {
      return { kind: "stopped", message: e instanceof ConnectorError ? e.message : `${def.name} ran into a problem.` };
    }
    const info = tools.find((t) => t.name === line.tool);
    if (!info) return { kind: "stopped", message: `${def.name} doesn't have an action called ${clip(line.tool, 40)}.` };

    const risk = riskOf(info);
    const verdict = gate(risk, conn.level, conn.autoOk.includes(info.name));
    if (verdict === "block") {
      return { kind: "stopped", message: blockedMessage(def.name, conn.level, risk) };
    }
    if (verdict === "approve" && !opts.allowWrite) {
      return { kind: "stopped", message: `That would change something in ${def.name}. Ask me as a command and I'll check with you first.` };
    }

    let task = await this.taskFor(userId, runId, said);
    if (verdict === "run") {
      const out = await this.o.hub.call(userId, def.id, info.name, line.args);
      await this.audit(userId, task, def.id, info.name, risk, out.ok ? "ok" : "failed", out.error);
      task = await this.step(userId, task, out.ok ? `${def.name}: ${human(info.name)}` : `${def.name}: ${human(info.name)} failed`);
      return out.ok ? { kind: "result", text: out.text } : { kind: "stopped", message: out.error!.message };
    }

    const approval: Approval = {
      id: randomUUID(), connector: def.id, tool: info.name, risk, args: line.args,
      preview: previewOf(def, info.name, line.args), at: this.now(),
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
    const def = this.o.hub.def(a.connector);

    if (this.now() - a.at > APPROVAL_TTL_MS) {
      const t = await this.step(userId, task, "That request expired before you answered", { state: "cancelled", approval: null });
      return { status: "expired", task: viewOfTask(t) };
    }
    const conn = def ? await this.o.store.getConnection(userId, a.connector) : null;
    if (!def || !conn?.tokensEnc) {
      const error = { code: "not_connected", message: `${def?.name ?? "That app"} isn't connected any more.` };
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
    ? `${app} is set to look only, so I can't ${what} there. You can change that in Tailzu.`
    : `${app} is set to drafts only, so I can't ${what} there. You can change that in Tailzu.`;
}
