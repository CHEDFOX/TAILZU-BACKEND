/**
 * The Code bot's codePlan screen.
 */

import type { Node, ActionRef, ScreenResponse, ActionSpec } from "../../../../../../shared/types/sdui.js";
import type { BrainLite } from "../../../../botsCode/brain.js";
import { type PastJob, estimate } from "../../../../botsCode/history.js";
import {
  row, text, C, type BotsCtx, call, open, SCREENS, page, botAvatar, statusMark, meta, listCard, listRow, secondaryButton, quietButton, seq,
  primaryButton, col, button, sectionLabel, box, title, bigNumber, duration, spanOf, grow,
} from "../../kit.js";
import {
  toast, type JobView, type Project, unreachable, short, ENDED, subLine, head, CODE, MOSS, numberDot, REFRESH, boxedField, plural,
  backButton, tag, ASIDE, withAside,
} from "./parts.js";

/** A file name as code, "new" beside a created one. */
function fileChip(path: string, action?: string, o: { size?: number } = {}): Node {
  return row([
    text(path, { size: o.size ?? 11.5, mono: true, lineHeight: 16 }),
    ...(action === "create" ? [text("new", { size: 10.5, weight: 600, color: C.paper, lineHeight: 14, style: { backgroundColor: C.ink, borderRadius: 6, paddingHorizontal: 5 } })] : []),
    ...(action === "delete" ? [text("removed", { size: 10.5, color: C.meta, lineHeight: 14 })] : []),
  ], { gap: 5, backgroundColor: C.surface, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 6, alignSelf: "flex-start" });
}

/**
 * A yes to one of the policy's questions, in two steps (routes/code/code.ts "A QUESTION"): the call, then the same call with the
 * approvalId it gave. Face ID first where it asks for it (the phone); the window says to use the phone.
 */
function twoStep(ctx: BotsCtx, path: string, o: { ok: ActionRef; fail: ActionRef }): ActionRef {
  const again = call("POST", path, { approvalId: "$state.q.approvalId" }, { ok: o.ok, fail: o.fail });
  const faceId: ActionRef = ctx.client === "phone"
    ? { kind: "biometricPrompt", reason: "Say yes to this", onSuccess: again, onError: toast("Not done. Face ID didn't match."), onUnavailable: toast("This needs Face ID on this phone.") }
    : toast("This one needs Face ID. Say yes on your phone.");
  return call("POST", path, {}, {
    assignTo: "q",
    ok: { kind: "condition", if: { truthy: "q.needsApproval" }, then: { kind: "condition", if: { truthy: "q.faceId" }, then: faceId, else: again }, else: o.ok },
    fail: o.fail,
  });
}

// ===================================================================== bots.code.plan (CodePlan / DCodePlan)
export interface PlanData { view?: JobView; project?: Project; history: PastJob[]; brain?: BrainLite }

/** A plan step's files: "edit app/globals.css" -> { action, path }. */
const fileOf = (f: string): { action: string; path: string } => {
  const m = /^(edit|create|delete)\s+(.+)$/.exec(f);
  return m ? { action: m[1]!, path: m[2]! } : { action: "edit", path: f };
};

/** The project's parts the plan does not touch (the brain's features, the sensitive ones first): "Not in this plan". */
function untouched(b: BrainLite | undefined, files: string[]): string[] {
  const touched = new Set(files);
  const SENSITIVE = /pay|billing|checkout|auth|sign|login|database|db|migration|secret|sms|email|otp|wallet|upi/i;
  const out = (b?.features ?? []).filter((f) => !f.files.some((x) => touched.has(x))).sort((a, b2) => Number(SENSITIVE.test(b2.name)) - Number(SENSITIVE.test(a.name))).map((f) => f.name);
  if ((b?.structure?.secretFiles?.length ?? 0) > 0 && !files.some((f) => b!.structure!.secretFiles!.includes(f))) out.splice(Math.min(2, out.length), 0, "Secret keys");
  return out.slice(0, 4);
}

export function codePlan(ctx: BotsCtx, d: PlanData | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  if (!d?.view) return unreachable(ctx, "that plan");
  const { job, agent } = d.view;
  const name = short(d.project?.fullName ?? "");
  const toProject = open(SCREENS.code, { project: job.projectId });
  const waitingPlan = job.state === "waiting_for_you" && agent?.waiting?.kind === "approval" && agent.waiting.for === "plan";
  const steps = agent?.plan?.steps ?? ((agent?.waiting?.summary?.steps as Array<{ n: number; do: string; files: string[] }> | undefined) ?? []);
  const files = [...new Set(steps.flatMap((s) => s.files.map((f) => fileOf(f).path)))];
  const ended = ENDED.includes(job.state);
  const est = estimate(d.history, job.projectId);
  const sub = subLine([{ code: name }, `· plan · ${waitingPlan || !steps.length ? "nothing changed yet" : ended ? "over" : "you said yes"}`], desk ? 13 : 12);
  const headNode = head(ctx, { title: job.task, sub, to: toProject, lines: 2 });

  // Still planning, or past the plan: say where it is and the way on.
  if (!waitingPlan) {
    const asking = job.state === "waiting_for_you";
    const planning = !ended && !asking && !steps.length;
    const words = planning ? "I'm reading the code and making a plan. Nothing changes until you press Start."
      : ended ? (job.state === "done" ? "This job is done." : job.reason || "This plan was turned down. Nothing was changed.")
        : asking ? "The plan has its yes. Now I'm waiting for you on the next step."
          : "You said yes. I'm working on it now.";
    return page(ctx, {
      back: false, nav: "code", title: "Plan", gap: 16, ...(desk ? { maxWidth: 760 } : {}),
      body: [
        headNode,
        row([botAvatar(CODE, 30), text(words, { size: desk ? 15 : 14, lineHeight: 20, style: { flexShrink: 1 } })], { gap: 10 }),
        ...(planning ? [row([statusMark("working", { color: MOSS }), meta("Making a plan…", { size: 13 })], { gap: 8 })] : []),
        ...(steps.length ? [listCard(steps.map((s) => listRow({ label: s.do, left: numberDot(s.n, "plain") })))] : []),
      ],
      footer: planning
        ? [secondaryButton("Check again", REFRESH, { wide: !desk }), quietButton("Stop", call("POST", `/v1/code/jobs/${job.id}/stop`, {}, { ok: seq(toast("Stopped."), toProject), fail: toast("Couldn't stop it. Try again.") }), { size: "md" })]
        : ended ? [secondaryButton(`Back to ${name || "the project"}`, toProject, { wide: !desk })]
          : [primaryButton(asking ? "See what it needs" : "Watch it work", open(SCREENS.codeJob, { id: job.id }), { wide: !desk })],
    });
  }

  const go: ActionSpec = { kind: "navigate", screenId: SCREENS.codeJob, params: { id: job.id }, replace: true };
  const startIt = twoStep(ctx, `/v1/code/jobs/${job.id}/approve`, { ok: go, fail: toast("Couldn't start it. Try again.") });
  const replan = {
    kind: "condition", if: { falsy: "change" }, then: toast("Say what to change first"),
    else: call("POST", `/v1/bots/code/jobs/${job.id}/replan`, { change: "$state.change" }, {
      assignTo: "replanned",
      ok: { kind: "navigate", screenId: SCREENS.codePlan, params: { id: "$state.replanned.job.id" }, replace: true },
      fail: toast("Couldn't change the plan. Try again."),
    }),
  } as ActionSpec;
  const changeBox = { ...col([
    boxedField("change", "What should I do differently?", { multiline: true, size: 15, minHeight: 64, label: "What should I do differently?" }),
    row([button("Make a new plan", replan, { kind: "secondary", size: "md" }), quietButton("Cancel", { kind: "setState", path: "changing", value: false }, { size: "md" })], { gap: 8 }),
  ], { gap: 10 }), visibleIf: { truthy: "changing" } };
  const not = untouched(d.brain, files);
  const notNode = not.length ? col([sectionLabel("Not in this plan"), row(not.map((n) => box([text(n, { size: 13, lineHeight: 17 })], { borderWidth: 1, borderColor: desk ? C.outline : C.line, borderRadius: 18, paddingVertical: desk ? 7 : 8, paddingHorizontal: desk ? 12 : 14 })), { gap: 6, flexWrap: "wrap" }),
    ...(desk ? [meta("If a step needs one of these, it shows in the review.", { size: 12 })] : [])], { gap: 8 }) : null;
  const stepFiles = (s: { files: string[] }) => row(s.files.map((f) => fileOf(f)).map((f) => fileChip(f.path, f.action, { size: desk ? 12 : 11.5 })), { gap: 4, flexWrap: "wrap" });
  const buttons = [primaryButton("Start", startIt, { wide: true }), { ...secondaryButton("Change the plan", { kind: "setState", path: "changing", value: true }, { wide: true }), visibleIf: { falsy: "changing" } }, changeBox];

  if (!desk) {
    return page(ctx, {
      nav: "code", title: "Plan", state: { change: "", changing: false }, gap: 14,
      body: [
        headNode,
        row([botAvatar(CODE, 30), text("Here's how I'd do it. Nothing changes until you press Start.", { size: 14, lineHeight: 19, style: { flexShrink: 1 } })], { gap: 10 }),
        col([sectionLabel(`${plural(steps.length, "step")} · ${plural(files.length, "file")}`), col(steps.map((s, i) => row([
          numberDot(s.n, "plain"), col([text(s.do, { size: 14, weight: 500, lineHeight: 19 }), stepFiles(s)], { gap: 4, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
        ], { gap: 12, paddingVertical: 10, paddingHorizontal: 16, alignItems: "flex-start", ...(i < steps.length - 1 ? { borderBottomWidth: 1, borderBottomColor: C.divider } : {}) })), { borderWidth: 1, borderColor: C.line, borderRadius: 18 })], { gap: 8 }),
        estimateGrid(est, steps.length, files.length),
        ...(notNode ? [notNode] : []),
      ],
      footer: buttons,
    });
  }

  const resp = page(ctx, {
    nav: "code", title: "Plan", state: { change: "", changing: false }, gap: 18,
    body: [
      row([backButton(toProject), meta("Xode · plan first, then start", { size: 13 })], { gap: 6 }),
      col([title(job.task, { lines: 2 }), row([tag(name, { mono: true }), meta(`· plan · nothing changed yet`, { size: 13 })], { gap: 8 })], { gap: 6 }),
      row([botAvatar(CODE, 30), text("Here's how I'd do it. Nothing changes until you press Start.", { size: 15, lineHeight: 20 })], { gap: 12 }),
      col([
        row([box([], { width: 26 }), box([sectionLabel(plural(steps.length, "step"))], { flexGrow: 1, flexBasis: 0 }), box([sectionLabel(`${plural(files.length, "file")} it touches`)], { flexGrow: 1.15, flexBasis: 0 })],
          { gap: 14, paddingVertical: 12, paddingHorizontal: 18, backgroundColor: ASIDE, borderBottomWidth: 1, borderBottomColor: C.divider }),
        ...steps.map((s, i) => row([
          numberDot(s.n, "done", 26),
          box([text(s.do, { size: 14.5, weight: 500, lineHeight: 20 })], { flexGrow: 1, flexBasis: 0, minWidth: 0 }),
          box([stepFiles(s)], { flexGrow: 1.15, flexBasis: 0, minWidth: 0 }),
        ], { gap: 14, paddingVertical: 13, paddingHorizontal: 18, alignItems: "flex-start", ...(i ? { borderTopWidth: 1, borderTopColor: C.divider } : {}) })),
      ], { borderWidth: 1, borderColor: C.line, borderRadius: 18, overflow: "hidden" }),
      ...(notNode ? [notNode] : []),
    ],
  });
  const fileRows = steps.flatMap((s) => s.files.map(fileOf)).filter((f, i, a) => a.findIndex((x) => x.path === f.path) === i).slice(0, 10);
  return withAside(resp, [
    sectionLabel("Estimate"),
    col([
      row([bigNumber(est ? duration(est.minutes) : plural(steps.length, "step")), meta(est ? "about" : "to do", { size: 13 })], { gap: 8, alignItems: "flex-end" }),
      meta(`I check with you before this job uses a lot of ${spanOf(ctx)}.${est ? ` From your last ${est.from} jobs${est.here ? " here" : ""}.` : ""}`, { size: 12, lineHeight: 17 }),
    ], { gap: 8 }),
    row([
      col([text(String(steps.length), { size: 24, weight: 700, lineHeight: 30 }), meta(steps.length === 1 ? "step" : "steps")], { flexGrow: 1, flexBasis: 0, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14, gap: 2 }),
      col([text(String(files.length), { size: 24, weight: 700, lineHeight: 30 }), meta("files changed")], { flexGrow: 1, flexBasis: 0, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14, gap: 2 }),
    ], { gap: 12 }),
    col([sectionLabel("Files it touches"), ...fileRows.map((f) => row([text(f.path, { size: 11.5, mono: true, lineHeight: 16, lines: 1, style: { flexShrink: 1 } }), grow(), meta(f.action === "create" ? "new" : f.action === "delete" ? "removed" : "changed", { size: 11 })], { gap: 10 }))], { gap: 9 }),
    grow(),
    col(buttons, { gap: 8 }),
  ]);
}

/** The phone's estimate strip: three numbers on the surface grey. No money: how long, how many steps, how many files. */
function estimateGrid(est: ReturnType<typeof estimate>, steps: number, files: number): Node {
  const cell = (big: string, small: string) => col([text(big, { size: 20, weight: 600, lineHeight: 25 }), meta(small)], { gap: 2, flexGrow: 1, flexBasis: 0, minWidth: 0 });
  return row([
    cell(est ? duration(est.minutes) : "—", "about"),
    cell(String(steps), steps === 1 ? "step" : "steps"),
    cell(String(files), files === 1 ? "file changed" : "files changed"),
  ], { backgroundColor: C.surface, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 8, alignItems: "flex-start" });
}
