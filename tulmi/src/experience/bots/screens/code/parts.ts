/**
 * What several of the Code bot's screens share.
 */

import type { ActionSpec, ActionRef, Node, ScreenResponse, BuddyAct } from "../../../../../../shared/types/sdui.js";
import type { BrainLite } from "../../../../botsCode/brain.js";
import { start as momentStart, SENT_WORDS, failed, streamed, askMoment } from "../../askMoment.js";
import {
  botLook, labelled, box, icon, back, row, text, C, type BotsCtx, col, title, FACE, page, emptyState, seq, call, SCREENS, keptOffline,
  canBuddy, botBuddy, meta, grow,
} from "../../kit.js";

// ===================================================================== what the routes answer (as much as is read)
export interface Project { id: string; fullName: string; defaultBranch: string; private: boolean; createdAt: number }
type JobState = "queued" | "running" | "waiting_for_compute" | "waiting_for_you" | "paused" | "done" | "failed" | "cancelled";
export interface Job {
  id: string; projectId: string; branch: string; task: string; state: JobState; waitingOn: string | null;
  spentPaise: number; budgetPaise: number; reason: string; createdAt: number; updatedAt: number; checkpoint?: { notes?: string };
}

interface Agent {
  phase: string;
  waiting?: { kind: string; question?: string; for?: string; faceId?: boolean; summary?: Record<string, unknown> };
  plan?: { risk: string; steps: Array<{ n: number; do: string; files: string[] }> };
  staged?: string[];
  commits?: string[];
  pr?: { number: number; url: string; ready: boolean };
  verify?: { ran: boolean; ok: boolean; summary: string };
  report?: { outcome: string; text: string; costPaise: number };
  notes?: string[];
}
export interface JobView { job: Job; agent?: Agent }
export interface Github {
  configured?: boolean; connected: boolean;
  installations: Array<{ id: number; account: string; manageUrl: string }>;
  oauth?: { connected: boolean; login?: string };
}

export interface PrStatus { number: number; url: string; title: string; state: string; draft: boolean; mergeable: boolean | null; reviewDecision: string | null; reviewComments: number }

// ===================================================================== small pieces
export const CODE = botLook("code");
export const MOSS = CODE.color;

export const ASIDE = "#fafafa";

export const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
export const short = (fullName: string): string => fullName.split("/").pop() ?? fullName;

export const toast = (message: string): ActionSpec => ({ kind: "toast", message });
export const REFRESH: ActionSpec = { kind: "refresh" };
export const openUrl = (url: string): ActionSpec => ({ kind: "openUrl", url, external: true });
export const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
export const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
export const firstLine = (s: string): string => s.split("\n")[0]!.trim();
export const ENDED: JobState[] = ["done", "failed", "cancelled"];

/** "09:40" in the person's own day. */
export function clock(at: number, tz: number): string {
  const d = new Date(at + tz * 60_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** "today", "yesterday", "3 days ago", "last month". */
export function ago(at: number, now: number, tz: number): string {
  const day = (t: number) => Math.floor((t + tz * 60_000) / 86_400_000);
  const d = day(now) - day(at);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  if (d < 14) return "last week";
  if (d < 31) return `${Math.floor(d / 7)} weeks ago`;
  if (d < 62) return "last month";
  return d < 365 ? `${Math.floor(d / 30)} months ago` : "last year";
}

/** The back chevron, 44 x 44, pulled 10 to the left (STYLE.md). */
export const backButton = (to?: ActionRef): Node =>
  labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center", flexShrink: 0 }, to ?? back()), "Back");

/** A line of words and code names: "salon-booking · plan · nothing changed yet". */
export function subLine(parts: Array<string | { code: string }>, size = 12): Node {
  return row(parts.map((p) => (typeof p === "string"
    ? text(p, { size, color: C.meta, lineHeight: size + 4 })
    : text(p.code, { size: size - 0.5, mono: true, color: C.meta, lineHeight: size + 4 }))), { gap: 4, flexWrap: "wrap" });
}

/** A screen's head: back, the title and a line under it, and whatever goes on the right. */
export function head(ctx: BotsCtx, o: { title: string; sub?: Node; right?: Node[]; to?: ActionRef | false; size?: number; lines?: number }): Node {
  const desk = ctx.client === "desktop";
  const size = o.size ?? (desk ? 26 : 24);
  return row([
    ...(o.to === false ? [] : [backButton(o.to)]),
    col([title(o.title, { size, lineHeight: Math.round(size * 1.25), lines: o.lines ?? 2 }), ...(o.sub ? [o.sub] : [])], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ...(o.right ?? []),
  ], { gap: desk ? 12 : 8, alignItems: "center" });
}

/** A grey tag: "18 of 18 tests pass", "3 files". */
export const tag = (s: string, o: { mono?: boolean; white?: boolean; weight?: 400 | 500 | 600 } = {}): Node =>
  box([text(s, { size: 12, mono: o.mono, weight: o.weight, lineHeight: 16 })], {
    backgroundColor: o.white ? C.paper : C.surface, borderRadius: o.mono ? 8 : 12, paddingVertical: o.mono ? 4 : 5, paddingHorizontal: o.mono ? 8 : 10, alignSelf: "flex-start", flexShrink: 0,
  });

/** A numbered circle: a step of a list ("plain"), done (ink ring), now (filled), still to come (grey ring). */
export function numberDot(n: number | string, kind: "plain" | "done" | "now" | "todo", size = 22): Node {
  const s = { width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", flexShrink: 0 } as Record<string, unknown>;
  if (kind === "plain") Object.assign(s, { backgroundColor: C.surface });
  if (kind === "done") Object.assign(s, { borderWidth: 1.5, borderColor: C.ink });
  if (kind === "now") Object.assign(s, { backgroundColor: C.ink });
  if (kind === "todo") Object.assign(s, { borderWidth: 1.5, borderColor: C.outline });
  return box([text(String(n), { size: kind === "plain" ? 12 : 11, weight: kind === "plain" ? 600 : 700, color: kind === "now" ? C.paper : kind === "todo" ? C.meta : C.ink, lineHeight: 14 })], s);
}

/** A text field drawn by the kit's rules (no box of its own: the caller draws the edge). */
export function field(path: string, placeholder: string, o: { onSubmit?: ActionRef; multiline?: boolean; size?: number; minHeight?: number; label?: string } = {}): Node {
  const size = o.size ?? 16;
  return {
    type: "TextField", id: path, bind: { value: path },
    props: {
      placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0,
      minHeight: o.minHeight ?? 44, color: C.ink, ...(o.multiline ? { multiline: true } : { returnKeyType: o.onSubmit ? "send" : "done" }),
      accessibilityLabel: o.label ?? placeholder,
    },
    ...(o.onSubmit && !o.multiline ? { on: { onSubmit: o.onSubmit } } : {}),
    style: {
      flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: o.minHeight ?? 44, paddingHorizontal: 0, paddingVertical: 0,
      fontFamily: FACE.regular, fontSize: size, lineHeight: Math.round(size * 1.4), color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
      ...(o.multiline ? { textAlignVertical: "top" } : {}),
    },
  };
}

/** A boxed text field (an outline, radius 22). */
export const boxedField = (path: string, placeholder: string, o: Parameters<typeof field>[2] = {}): Node =>
  row([field(path, placeholder, o)], { borderWidth: 1, borderColor: C.line, borderRadius: o.multiline ? 18 : 22, paddingHorizontal: 16, paddingVertical: o.multiline ? 10 : 0, alignItems: o.multiline ? "flex-start" : "center" });

/** A round ink button with an icon (send). */
export const roundInk = (name: "send" | "mic" | "clip", onPress: ActionRef, label: string, size = 48, light = false): Node =>
  labelled(box([icon(name, { size: 20, color: light ? C.ink : C.paper })], {
    width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", flexShrink: 0,
    backgroundColor: light ? C.paper : C.ink, ...(light ? { borderWidth: 1, borderColor: C.outline } : {}),
  }, onPress), label);

/** The window's right-hand panel (the boards' aside, #fafafa): appended to deskPage's row, full height. */
export function withAside(resp: ScreenResponse, aside: Node[], width = 380): ScreenResponse {
  const root = resp.root!;
  root.children = [...(root.children ?? []), col(aside, {
    width, flexShrink: 0, height: "100%", borderLeftWidth: 1, borderLeftColor: C.divider, backgroundColor: ASIDE,
    paddingTop: 30, paddingHorizontal: 24, paddingBottom: 26, gap: 18, overflowY: "auto",
  })];
  return resp;
}

/** The failure page: what could not be read, and the way back. */
export function unreachable(ctx: BotsCtx, what: string, o: { nav?: string } = {}): ScreenResponse {
  return page(ctx, {
    back: true, nav: o.nav ?? "code", title: "Xode",
    body: [emptyState({ pose: "think", title: `I couldn't open ${what}`, body: "It may have been removed, or X0 Bot can't reach GitHub right now.", action: { label: "Try again", onPress: REFRESH } })],
  });
}

// ===================================================================== actions

/** Start a task plan-first in a project (POST /v1/bots/code/start), then open its plan. `task` may be "$state.<path>". */
export function startTask(projectId: string, task: string, statePath?: string): ActionRef {
  // The words go up as the person's bubble and the box clears at once (askMoment.ts); the call sends them from there.
  const go = seq(
    ...momentStart({ message: task, busy: "starting", ...(statePath ? { from: statePath } : {}) }),
    call("POST", "/v1/bots/code/start", { projectId, task: SENT_WORDS }, {
      assignTo: "started",
      ok: seq({ kind: "setState", path: "starting", value: false },
        { kind: "navigate", screenId: SCREENS.codePlan, params: { id: "$state.started.job.id" } }),
      fail: failed({ busy: "starting", ...(statePath ? { from: statePath } : {}), then: toast("Couldn't start that. Try again.") }),
    }),
  );
  return statePath ? { kind: "condition", if: { falsy: statePath }, then: toast("Say what you want done first"), else: go } : go;
}

/**
 * Ask Xode (POST /v1/shell/ask, bot "code": the front door, with the answer written down for Activity as Ask's are) and
 * open the answer: a question, "what changed this week?", "explain this change". Offline (a build with an outbox), an ask about no one
 * project is kept there and goes once the connection is back (kit keptOffline).
 */
export function codeAsk(ctx: BotsCtx, message: string, o: { projectId?: string; statePath?: string } = {}): ActionRef {
  const asked: ActionSpec = {
    kind: "sequence", actions: [
      ...momentStart({ message, busy: "asking", ...(o.statePath ? { from: o.statePath } : {}) }),
      streamed(ctx, {
        kind: "callEndpoint", method: "POST", path: "/v1/shell/ask",
        body: { message: SENT_WORDS, device: ctx.client, mode: "text", bot: "code", ...(o.projectId ? { projectId: o.projectId } : {}) },
        assignTo: "asked",
        onSuccess: seq(
          { kind: "setState", path: "asking", value: false },
          { kind: "navigate", screenId: SCREENS.ask, params: { message: SENT_WORDS, answer: "$state.asked.result.text", id: "$state.asked.id" } },
        ),
        onError: failed({ busy: "asking", ...(o.statePath ? { from: o.statePath } : {}), then: toast("Couldn't reach Xode. Try again.") }),
      }),
    ],
  };
  const send: ActionSpec = o.projectId ? asked : keptOffline(ctx.client, { message, bot: "code", who: "Xode", ...(o.statePath ? { clear: o.statePath } : {}) }, asked);
  return o.statePath ? { kind: "condition", if: { falsy: o.statePath }, then: toast("Type what you need first"), else: send } : send;
}

/** "Tell Xode what to do…": the field and its send button; in a project it starts a plan, elsewhere it asks the bot. */
export function taskBar(ctx: BotsCtx, o: { projectId?: string; placeholder?: string }): Node {
  const send = o.projectId ? startTask(o.projectId, "$state.task", "task") : codeAsk(ctx, "$state.task", { statePath: "task" });
  const desk = ctx.client === "desktop";
  return col([
    askMoment(ctx, { slug: "code", color: MOSS, kind: "code", busy: o.projectId ? "starting" : "asking", line: o.projectId ? "Making a plan…" : "Asking Xode…" }),
    row([
      field("task", o.placeholder ?? "Tell Xode what to do…", { onSubmit: send, size: desk ? 15 : 16, label: "Tell Xode what to do" }),
      roundInk("send", send, "Send", desk ? 46 : 48),
    ], { gap: 10, borderWidth: 1, borderColor: C.line, borderRadius: desk ? 30 : 28, paddingVertical: 6, paddingRight: 6, paddingLeft: desk ? 20 : 18 }),
  ], { gap: 8 });
}

/** Merge a pull request the person is looking at (POST /v1/bots/code/merge), then the quiet "Shipped" moment. */
export function mergeAction(projectId: string, branch: string, jobId?: string): ActionRef {
  return seq(
    { kind: "setState", path: "merging", value: true },
    call("POST", "/v1/bots/code/merge", { projectId, branch, ...(jobId ? { jobId } : {}) }, {
      ok: seq({ kind: "setState", path: "merging", value: false }, toast("Merged."),
        jobId ? { kind: "navigate", screenId: SCREENS.done, params: { id: jobId }, replace: true } : REFRESH),
      fail: seq({ kind: "setState", path: "merging", value: false }, toast("Couldn't merge that. Open it on GitHub to see why.")),
    }),
  );
}

// ===================================================================== getting started: meet, pick, read
const STEP_NAMES = ["Meet Xode", "Pick projects", "Read your project"];

/** The window's "1 Meet Xode — 2 Pick projects — 3 Read your project". */
function enterSteps(current: number): Node {
  const parts: Node[] = [];
  STEP_NAMES.forEach((n, i) => {
    if (i) parts.push(box([], { width: 22, height: 1, backgroundColor: C.outline }));
    const k = i + 1;
    parts.push(row([
      k < current ? box([icon("check", { size: 13, weight: 2.2 })], { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: C.ink, alignItems: "center", justifyContent: "center" })
        : numberDot(k, k === current ? "now" : "todo"),
      text(n, { size: 13, weight: k === current ? 600 : 400, color: k === current ? C.ink : k < current ? C.grey70 : C.meta, lineHeight: 17 }),
    ], { gap: 7 }));
  });
  return row(parts, { gap: 10 });
}

/**
 * Xode's own tiny bot across the getting-started steps (meet, pick, read, home), where the build draws him: one
 * life, one stage, in the same place on every step (under the back chevron on the phone, under the steps line in the
 * window), so he carries on from step to step instead of starting again. What he does follows the step: meet waves
 * and juggles his 0s and 1s, pick looks over the list below, read takes in dots and lines, home settles.
 */
export function setupBuddy(ctx: BotsCtx, act: BuddyAct): Node | null {
  if (!canBuddy(ctx)) return null;
  const desk = ctx.client === "desktop";
  return botBuddy({ kind: "code", color: MOSS, life: "code.setup", state: "idle", act, height: desk ? 120 : 128, ...(desk ? { width: 300 } : {}), size: desk ? 48 : 52, label: "Xode" });
}

/** The phone's top of a getting-started step with his stage: the back chevron, then him (the same place on every step). */
export const setupTop = (top: Node, stage: Node): Node => col([top, stage], { gap: 14 });

/** While a plan is being made or Xode is asked (taskBar's `starting` / `asking`): his tiny bot thinks. */
export const CODE_BUSY = { any: [{ truthy: "starting" }, { truthy: "asking" }] };

/** The window's top line on the getting-started pages: back, "Bots · Xode", the steps. */
export const enterTop = (to: ActionRef, current: number): Node =>
  row([backButton(to), meta("Bots · Xode", { size: 13 }), grow(), enterSteps(current)], { gap: 6 });

export interface MeetData { gh?: Github; installUrl?: string; off?: boolean }

/** A tick box that follows a state path (not pressable itself: its row is). */
export function tickBox(path: string, size = 22): Node {
  const on = { truthy: path };
  return box([{ ...icon("check", { size: size - 6, color: C.paper, weight: 2.4 }), visibleIf: on }], {
    width: size, height: size, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center", flexShrink: 0,
    borderColor: { ...on, then: C.ink, else: C.outline }, backgroundColor: { ...on, then: C.ink, else: C.paper },
  });
}

// ===================================================================== the projects overview (Enter4 / DEnter4)
export interface OverviewData { projects: Project[]; jobs: Job[]; brains: Record<string, BrainLite | undefined> }
