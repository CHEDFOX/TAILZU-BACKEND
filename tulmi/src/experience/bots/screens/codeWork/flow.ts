/**
 * THE XODE FLOW IN THE CHAT (routes/bots/botsXode.ts): the gate before it, the plan in it, and where a message goes.
 *
 *   gatePage(ctx, c, gate)      before the chat opens: Xode reading the project (its progress), and beside it the owner's direction (their
 *                               vision, what must not change), saved while it reads, or "Let Xode suggest". The chat opens once both are done
 *   planCard(ctx, c, flow)      under the talk: where the project stands and where it heads (the first plan), the goal and its steps, what
 *                               changed in a new version, the mockup made for it, and Approve. Once approved: the work, and a way to it
 *   flowSend(ctx, c, flow, m)   what the message box does: before the work, talk the plan over (say); during it, a message judged against the
 *                               plan (work), and a mockup it made opened at once
 */
import type { ActionRef, ActionSpec, Node, ScreenResponse } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, C, box, call, col, icon, meta, meter, open, page, primaryButton, row, SCREENS, seq, statusMark, text, when, button } from "../../kit.js";
import { SENT_WORDS, failed, start } from "../../askMoment.js";
import { type ChatCtx, oops } from "./parts.js";

export interface FlowGate { open: boolean; reading: { status: string; pct: number; phase: string }; vision: "given" | "skipped" | "missing" }
export interface FlowPlan {
  v: number; goal: string; state: string; direction: string; suggested: boolean; steps: string[];
  status: "proposed" | "approved" | "working" | "done"; change?: string; mockup?: string; jobId?: string;
}
export interface FlowData { gate: FlowGate; plan: FlowPlan | null; job?: { job: { id: string; state: string } } | null }

const flowPath = (c: ChatCtx, what: string) => `/v1/bots/code/flow/${c.projectId}/${what}`;
const MOSS = "#4F6B3A";
const refresh = { kind: "refresh" } as ActionSpec;
const toast = (message: string): ActionSpec => ({ kind: "toast", message });

/** Reading the project: a meter while it reads, a line once it has. */
function readingCard(g: FlowGate): Node {
  const read = g.open || g.reading.status === "ready" || g.reading.status === "stale";
  const failedRead = g.reading.status === "failed";
  return col([
    row([
      read ? statusMark("done", { size: 10 }) : failedRead ? statusMark("failed", { size: 10 }) : statusMark("working", { size: 10, color: MOSS }),
      text(read ? "Xode has read your project" : failedRead ? "The read stopped" : "Xode is reading your project", { size: 15, weight: 600, lineHeight: 20 }),
    ], { gap: 10, alignItems: "center" }),
    ...(read || failedRead ? [] : [
      col([
        box([meter(g.reading.pct, 100, { color: MOSS })], {}),
        meta(`${g.reading.pct}%${g.reading.phase ? ` · ${g.reading.phase}` : ""}`, { size: 12 }),
      ], { gap: 6 }),
    ]),
  ], { gap: 12, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line });
}

/** The owner's direction: their vision in their words, and what must not change. Saved while Xode reads. */
function visionCard(c: ChatCtx, g: FlowGate): Node {
  if (g.vision !== "missing") {
    return row([statusMark("done", { size: 10 }), col([
      text(g.vision === "given" ? "Your direction is saved" : "Xode will suggest a direction", { size: 15, weight: 600, lineHeight: 20 }),
      meta(g.vision === "given" ? "Xode plans every piece of work toward it." : "You'll see it in the first plan, and can change it there.", { size: 12 }),
    ], { gap: 2, flexShrink: 1 })], { gap: 10, alignItems: "flex-start", padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line });
  }
  const save = call("POST", flowPath(c, "vision"), { vision: "$state.vision", keep: "$state.keep" }, { ok: seq(toast("Saved"), refresh), fail: oops("Couldn't save that. Try again.") });
  const guarded: ActionSpec = { kind: "condition", if: { falsy: "vision" }, then: toast("Write where you want to take it first"), else: save } as ActionSpec;
  const skip = call("POST", flowPath(c, "vision"), { skip: true }, { ok: refresh, fail: oops("Couldn't do that. Try again.") });
  const field = (path: string, placeholder: string, lines: number): Node => ({
    type: "TextField", id: path, bind: { value: path },
    props: { placeholder, placeholderColor: C.idle, multiline: lines > 1, numberOfLines: lines, background: "transparent", borderWidth: 0, color: C.ink },
    style: { minHeight: lines > 1 ? 96 : 44, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line, fontSize: 15, color: C.ink, textAlignVertical: "top" },
  } as Node);
  return col([
    col([text("Where do you want to take it?", { size: 17, weight: 600, lineHeight: 22 }), meta("Your vision, the direction, everything you're thinking for this project. Xode plans every piece of work toward it.", { size: 13, lineHeight: 18 })], { gap: 4 }),
    field("vision", "e.g. Students check their results on their phones in seconds. Next: the results page, then notifications.", 5),
    field("keep", "Anything that must not change? (optional)", 1),
    primaryButton("Save", guarded, { wide: true }),
    row([text("Let Xode suggest one", { size: 14, weight: 500, color: C.meta, lineHeight: 19 })], { justifyContent: "center", minHeight: 40, alignItems: "center" }, skip),
  ], { gap: 12 });
}

/** Before the chat: reading, and the direction, side by side in time. */
export function gatePage(ctx: BotsCtx, c: ChatCtx, g: FlowGate): ScreenResponse {
  const both = g.vision !== "missing";
  return page(ctx, {
    nav: "code", title: "Xode", gap: 18, back: true,
    body: [
      col([text(c.projectName || "Your project", { size: 24, weight: 700, tracking: -0.4, lineHeight: 30 }), meta("The chat opens once Xode has read it and knows where you want it to go.", { size: 13 })], { gap: 4 }),
      readingCard(g),
      visionCard(c, g),
      ...(both ? [button("Check again", refresh, { kind: "secondary", size: "md" })] : []),
    ],
    state: { vision: "", keep: "" },
  });
}

/** The plan under the talk: what it is, what changed, its mockup, and its yes (or where the work stands). */
export function planCard(c: ChatCtx, f: FlowData): Node | null {
  const p = f.plan;
  if (!p) return null;
  const working = p.status === "working" && p.jobId;
  const done = p.status === "done";
  const approve: ActionRef = call("POST", flowPath(c, "approve"), { thread: c.threadId, v: p.v }, {
    ok: seq({ kind: "haptic", style: "success" } as ActionSpec, toast(p.jobId ? "Xode will follow the new plan" : "Approved. Xode is on it"), refresh),
    fail: seq(oops("The plan changed or couldn't start. Look again."), refresh),
  });
  return col([
    ...(p.v === 1 && p.state ? [col([meta("Where it stands", { size: 12, weight: 600 }), text(p.state, { size: 14, lineHeight: 20 })], { gap: 2 })] : []),
    ...(p.v === 1 && p.direction ? [col([meta(p.suggested ? "Where it could go (Xode's suggestion)" : "Where you're taking it", { size: 12, weight: 600 }), text(p.direction, { size: 14, lineHeight: 20 })], { gap: 2 })] : []),
    col([
      row([text(done ? "Done" : p.v > 1 ? `The plan · version ${p.v}` : "The plan", { size: 12, weight: 600, color: C.meta, lineHeight: 16 })], {}),
      text(p.goal, { size: 16, weight: 600, lineHeight: 22 }),
      ...(p.change ? [meta(`Changed: ${p.change}`, { size: 12 })] : []),
    ], { gap: 4 }),
    col(p.steps.map((s, i) => row([box([text(`${i + 1}`, { size: 13, weight: 600, color: C.meta, lineHeight: 19 })], { width: 16 }), text(s, { size: 14, lineHeight: 19, style: { flexShrink: 1 } })], { gap: 8, alignItems: "flex-start" })), { gap: 8 }),
    ...(p.mockup ? [row([icon("spark", { size: 16, color: C.ink }), text("See the mockup", { size: 14, weight: 500, lineHeight: 19 })], { gap: 8, alignItems: "center", minHeight: 36 }, open(SCREENS.design, { id: p.mockup, project: c.projectId }))] : []),
    ...(p.status === "proposed"
      ? [primaryButton(p.jobId ? "Approve the change" : "Approve and start", approve, { wide: true }), meta(p.jobId ? "Only the steps it touches wait. The rest of the work goes on." : "Xode works on it piece by piece. Message any time: only a change to the plan stops anything.", { size: 12 })]
      : working
        ? [row([statusMark(f.job && ["done", "failed", "cancelled"].includes(f.job.job.state) ? "done" : "working", { size: 10, color: MOSS }), text("Xode is working on it", { size: 14, weight: 500, lineHeight: 19, style: { flexGrow: 1 } }), text("Open", { size: 14, weight: 600, lineHeight: 19 })], { gap: 10, alignItems: "center", minHeight: 40 }, open(SCREENS.codeJob, { id: p.jobId!, from: c.threadId }))]
        : done ? [meta("Tell Xode what's next, and it plans the next piece.", { size: 12 })] : []),
  ], { gap: 14, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper });
}

/** The message box's send, by where the plan is. Before the work: talk it over. During it: judged against the plan. */
export function flowSend(c: ChatCtx, working: boolean, message: string, o: { from?: string; attachments?: string } = {}): ActionRef {
  const path = flowPath(c, working ? "work" : "say");
  return seq(
    ...start({ message, busy: "asking", ...(o.from ? { from: o.from } : {}) }),
    call("POST", path, { thread: c.threadId, text: SENT_WORDS, ...(o.attachments ? { attachments: o.attachments } : {}) }, {
      assignTo: "flowed",
      ok: seq(
        { kind: "setState", path: "asking", value: false } as ActionSpec,
        // A mockup made beside the work opens at once; anything else shows in the chat and its plan.
        { kind: "condition", if: { truthy: "flowed.artifact" }, then: open(SCREENS.design, { id: "$state.flowed.artifact", project: c.projectId }), else: refresh } as ActionSpec,
      ),
      fail: failed({ busy: "asking", ...(o.from ? { from: o.from } : {}), then: oops("Couldn't reach Xode. Try again.") }),
    }),
  );
}

/** Is the plan at work (a message is judged against it), rather than being talked over? */
export const atWork = (f: FlowData | undefined): boolean => f?.plan?.status === "working";

/** The confirm under a "stop" Xode read in a message: never stopped on a guess. */
export function stopConfirm(): Node {
  return when({ truthy: "flowed.stop" }, row([
    button("Stop the work", call("POST", "/v1/code/jobs/$state.flowed.stop/stop", {}, { ok: seq(toast("Stopped"), refresh), fail: oops() }), { kind: "secondary", size: "md" }),
    button("Keep going", { kind: "setState", path: "flowed", value: null } as ActionSpec, { kind: "quiet", size: "md" }),
  ], { gap: 8 }));
}
