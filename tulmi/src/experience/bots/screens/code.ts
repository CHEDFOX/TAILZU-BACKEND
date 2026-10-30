/**
 * THE CODE BOT: its home, getting started (meet, pick projects, read the project, the projects overview), a new
 * project's questions and PLAN.md, the plan-first approval, the project's rules, the review, and PR care
 * (CodeHome, Enter1-4, NewProject, CodePlan, ProjectRules, CodeReview, PRCare and their D* boards).
 *
 * Screen ids are "bots.<name>"; one id serves the phone and the window (ctx.client). Everything is the Code bot's own
 * backend (routes/code.ts, routes/codeJobs.ts, src/code/**) read through deps.api, and the few doors the screens needed
 * beyond it (routes/botsCode.ts: start a task plan-first, pick projects, the rules, a new project's answers, the line
 * diff, merge). The job, team, design, preview, attach, done, failed and chat screens are screens/codeWork.ts's: this
 * file links to them through SCREENS.
 *
 *   bots.code            params project?  one project's home; no project yet: meet; several and none named: the overview
 *   bots.code.start      params step: meet | pick | read | home, project (read), q / vis (pick)
 *   bots.code.new        params project?  the idea, then the questions with the plan growing beside them, then Start building
 *   bots.code.plan       params id (a job)  the plan, Start / Change the plan
 *   bots.code.rules      params project
 *   bots.code.review     params id (a job), or project + branch
 *   bots.code.pr-care    params project, pr (and branch, when PR care is off)
 */
import type { ActionRef, ActionSpec, BuddyAct, Node } from "../../../../../shared/types/sdui.js";
import { builtWith, checksOf, firstTasks, health, isEmptyRepo, placeOf, stackChips, testsLine, type BrainLite } from "../../../botsCode/brain.js";
import { estimate, type PastJob } from "../../../botsCode/history.js";
import { QUICK, SHORT, slugOf } from "../../../botsCode/intake.js";
import { hunkRange, type Hunk } from "../../../botsCode/linediff.js";
import { nextValue, ruleWord, type RuleId, type RuleValue } from "../../../botsCode/rules.js";
import {
  back, bigNumber, blip, body, botAvatar, botLook, box, button, C, call, chips, col, emptyState, grid, grow,
  icon, labelled, listCard, listRow, meta, meter, mono, needsCard, notice, open, page, primaryButton, quietButton, row,
  percent, SCREENS, sectionLabel, secondaryButton, segmented, seq, statusMark, text, title, duration, FACE, whenEq, whenWords,
  botBuddy, canBuddy, headerBuddy, keptOffline, spanOf, type BotsCtx, type Mark,
} from "../kit.js";
import type { ScreenResponse } from "../../../../../shared/types/sdui.js";
import type { BotsDeps } from "../live.js";
import { screen, type BotsScreen } from "../registry.js";
import { askMoment, failed, SENT_WORDS, start as momentStart, streamed } from "../askMoment.js";

// ===================================================================== what the routes answer (as much as is read)

interface Project { id: string; fullName: string; defaultBranch: string; private: boolean; createdAt: number }
type JobState = "queued" | "running" | "waiting_for_compute" | "waiting_for_you" | "paused" | "done" | "failed" | "cancelled";
interface Job {
  id: string; projectId: string; branch: string; task: string; state: JobState; waitingOn: string | null;
  spentPaise: number; budgetPaise: number; reason: string; createdAt: number; updatedAt: number; checkpoint?: { notes?: string };
}
interface Branch { branch: string; task: string; prNumber: number | null; prUrl: string | null; state: string; createdAt: number }
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
interface JobView { job: Job; agent?: Agent }
interface Github {
  configured?: boolean; connected: boolean;
  installations: Array<{ id: number; account: string; manageUrl: string }>;
  oauth?: { connected: boolean; login?: string };
}
interface Repo { id: number; fullName: string; private: boolean; defaultBranch: string }
interface CarePull {
  prNumber: number; branch: string; origin: string; prUrl: string | null; title: string | null; ended: string | null;
  checks: { outcome: string; names: string[]; note: string } | null;
  conflict: { outcome: string; note: string } | null;
  waiting: { jobId: string; text: string } | null;
  working: Array<{ jobId: string; kind: string }>;
  notes: Array<{ at: number; text: string }>;
}
interface PrStatus { number: number; url: string; title: string; state: string; draft: boolean; mergeable: boolean | null; reviewDecision: string | null; reviewComments: number }
interface Comment { author: string; body: string; path?: string; line?: number; createdAt: number }
interface FileChange { path: string; status: string; additions: number; deletions: number; why?: string; hunks: Hunk[] | null }
interface Changes { files: FileChange[]; totals: { files: number; additions: number; deletions: number }; commits: number; truncated: boolean }
interface RulesView {
  project: { id: string; fullName: string; defaultBranch: string };
  rules: Record<RuleId, RuleValue>;
  capPaise: number; capSet: boolean; typical: [number, number] | null; checks: string[]; branchExample: string;
  computers: Array<{ name: string; on: boolean }>;
}
interface IntakeView {
  project: { id: string; fullName: string };
  request: string; answers: Record<string, string>;
  questions: Array<{ id: string; ask: string; why: string }>; answered: string[]; state: string;
  spec?: { name: string; summary: string; platforms: string[]; features: string[] };
  stack?: { label: string; hosting: string; tier: string };
  milestones?: Array<{ k: number; title: string }>;
}

// ===================================================================== small pieces

const CODE = botLook("code");
const MOSS = CODE.color;
const HIGHLIGHT = "#f2f2f2";
const ASIDE = "#fafafa";

const get = <T>(deps: BotsDeps, path: string): Promise<T | undefined> => deps.api<T>("GET", path).catch(() => undefined);
const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const short = (fullName: string): string => fullName.split("/").pop() ?? fullName;
const owner = (fullName: string): string => (fullName.includes("/") ? `${fullName.split("/")[0]}/` : "");
const toast = (message: string): ActionSpec => ({ kind: "toast", message });
const REFRESH: ActionSpec = { kind: "refresh" };
const openUrl = (url: string): ActionSpec => ({ kind: "openUrl", url, external: true });
const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const firstLine = (s: string): string => s.split("\n")[0]!.trim();
const ENDED: JobState[] = ["done", "failed", "cancelled"];

/** "09:40" in the person's own day. */
function clock(at: number, tz: number): string {
  const d = new Date(at + tz * 60_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** "today", "yesterday", "3 days ago", "last month". */
function ago(at: number, now: number, tz: number): string {
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
const backButton = (to?: ActionRef): Node =>
  labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center", flexShrink: 0 }, to ?? back()), "Back");

/** A line of words and code names: "salon-booking · plan · nothing changed yet". */
function subLine(parts: Array<string | { code: string }>, size = 12): Node {
  return row(parts.map((p) => (typeof p === "string"
    ? text(p, { size, color: C.meta, lineHeight: size + 4 })
    : text(p.code, { size: size - 0.5, mono: true, color: C.meta, lineHeight: size + 4 }))), { gap: 4, flexWrap: "wrap" });
}

/** A screen's head: back, the title and a line under it, and whatever goes on the right. */
function head(ctx: BotsCtx, o: { title: string; sub?: Node; right?: Node[]; to?: ActionRef | false; size?: number; lines?: number }): Node {
  const desk = ctx.client === "desktop";
  const size = o.size ?? (desk ? 26 : 24);
  return row([
    ...(o.to === false ? [] : [backButton(o.to)]),
    col([title(o.title, { size, lineHeight: Math.round(size * 1.25), lines: o.lines ?? 2 }), ...(o.sub ? [o.sub] : [])], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ...(o.right ?? []),
  ], { gap: desk ? 12 : 8, alignItems: "center" });
}

/**
 * How often a job checks with you before it uses more: three levels, each the share of this stretch (the free plan: this month) a job may use before it asks (ours,
 * kept as the project's cap: POST /v1/bots/code/projects/:id/cap). No amounts on the screen.
 */
const ASK_LEVELS = [{ label: "Often", paise: 1000 }, { label: "Sometimes", paise: 3000 }, { label: "Rarely", paise: 10_000 }] as const;
const askLevelOf = (capPaise: number): string => String(capPaise <= 1500 ? 1000 : capPaise <= 5000 ? 3000 : 10_000);
function askLevels(projectId: string): Node {
  return row(ASK_LEVELS.map((l) => box([text(l.label, { size: 13, weight: 500, lineHeight: 17, align: "center" })], {
    flexGrow: 1, flexBasis: 0, alignItems: "center", paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10,
    backgroundColor: whenEq("askLevel", String(l.paise), C.paper, "transparent"),
  }, seq({ kind: "setState", path: "askLevel", value: String(l.paise) },
    call("POST", `/v1/bots/code/projects/${projectId}/cap`, { paise: l.paise }, { ok: seq(toast("Saved."), REFRESH), fail: toast("Couldn't save that. Try again.") })))),
  { padding: 3, borderRadius: 12, backgroundColor: C.surface, gap: 2 });
}

/** A grey tag: "18 of 18 tests pass", "3 files". */
const tag = (s: string, o: { mono?: boolean; white?: boolean; weight?: 400 | 500 | 600 } = {}): Node =>
  box([text(s, { size: 12, mono: o.mono, weight: o.weight, lineHeight: 16 })], {
    backgroundColor: o.white ? C.paper : C.surface, borderRadius: o.mono ? 8 : 12, paddingVertical: o.mono ? 4 : 5, paddingHorizontal: o.mono ? 8 : 10, alignSelf: "flex-start", flexShrink: 0,
  });

/** A file name as code, "new" beside a created one. */
function fileChip(path: string, action?: string, o: { size?: number } = {}): Node {
  return row([
    text(path, { size: o.size ?? 11.5, mono: true, lineHeight: 16 }),
    ...(action === "create" ? [text("new", { size: 10.5, weight: 600, color: C.paper, lineHeight: 14, style: { backgroundColor: C.ink, borderRadius: 6, paddingHorizontal: 5 } })] : []),
    ...(action === "delete" ? [text("removed", { size: 10.5, color: C.meta, lineHeight: 14 })] : []),
  ], { gap: 5, backgroundColor: C.surface, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 6, alignSelf: "flex-start" });
}

/** A numbered circle: a step of a list ("plain"), done (ink ring), now (filled), still to come (grey ring). */
function numberDot(n: number | string, kind: "plain" | "done" | "now" | "todo", size = 22): Node {
  const s = { width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", flexShrink: 0 } as Record<string, unknown>;
  if (kind === "plain") Object.assign(s, { backgroundColor: C.surface });
  if (kind === "done") Object.assign(s, { borderWidth: 1.5, borderColor: C.ink });
  if (kind === "now") Object.assign(s, { backgroundColor: C.ink });
  if (kind === "todo") Object.assign(s, { borderWidth: 1.5, borderColor: C.outline });
  return box([text(String(n), { size: kind === "plain" ? 12 : 11, weight: kind === "plain" ? 600 : 700, color: kind === "now" ? C.paper : kind === "todo" ? C.meta : C.ink, lineHeight: 14 })], s);
}

/** A text field drawn by the kit's rules (no box of its own: the caller draws the edge). */
function field(path: string, placeholder: string, o: { onSubmit?: ActionRef; multiline?: boolean; size?: number; minHeight?: number; label?: string } = {}): Node {
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
const boxedField = (path: string, placeholder: string, o: Parameters<typeof field>[2] = {}): Node =>
  row([field(path, placeholder, o)], { borderWidth: 1, borderColor: C.line, borderRadius: o.multiline ? 18 : 22, paddingHorizontal: 16, paddingVertical: o.multiline ? 10 : 0, alignItems: o.multiline ? "flex-start" : "center" });

/** A round ink button with an icon (send). */
const roundInk = (name: "send" | "mic" | "clip", onPress: ActionRef, label: string, size = 48, light = false): Node =>
  labelled(box([icon(name, { size: 20, color: light ? C.ink : C.paper })], {
    width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", flexShrink: 0,
    backgroundColor: light ? C.paper : C.ink, ...(light ? { borderWidth: 1, borderColor: C.outline } : {}),
  }, onPress), label);

/** The window's right-hand panel (the boards' aside, #fafafa): appended to deskPage's row, full height. */
function withAside(resp: ScreenResponse, aside: Node[], width = 380): ScreenResponse {
  const root = resp.root!;
  root.children = [...(root.children ?? []), col(aside, {
    width, flexShrink: 0, height: "100%", borderLeftWidth: 1, borderLeftColor: C.divider, backgroundColor: ASIDE,
    paddingTop: 30, paddingHorizontal: 24, paddingBottom: 26, gap: 18, overflowY: "auto",
  })];
  return resp;
}

/** The failure page: what could not be read, and the way back. */
function unreachable(ctx: BotsCtx, what: string, o: { nav?: string } = {}): ScreenResponse {
  return page(ctx, {
    back: true, nav: o.nav ?? "code", title: "Code bot",
    body: [emptyState({ pose: "think", title: `I couldn't open ${what}`, body: "It may have been removed, or X0 Bot can't reach GitHub right now.", action: { label: "Try again", onPress: REFRESH } })],
  });
}

// ===================================================================== actions

/** Start a task plan-first in a project (POST /v1/bots/code/start), then open its plan. `task` may be "$state.<path>". */
function startTask(projectId: string, task: string, statePath?: string): ActionRef {
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
 * Ask the Code bot (POST /v1/shell/ask, bot "code": the front door, with the answer written down for Activity as Ask's are) and
 * open the answer: a question, "what changed this week?", "explain this change". Offline (a build with an outbox), an ask about no one
 * project is kept there and goes once the connection is back (kit keptOffline).
 */
function codeAsk(ctx: BotsCtx, message: string, o: { projectId?: string; statePath?: string } = {}): ActionRef {
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
        onError: failed({ busy: "asking", ...(o.statePath ? { from: o.statePath } : {}), then: toast("Couldn't reach Code bot. Try again.") }),
      }),
    ],
  };
  const send: ActionSpec = o.projectId ? asked : keptOffline(ctx.client, { message, bot: "code", who: "Code bot", ...(o.statePath ? { clear: o.statePath } : {}) }, asked);
  return o.statePath ? { kind: "condition", if: { falsy: o.statePath }, then: toast("Type what you need first"), else: send } : send;
}

/** "Tell Code bot what to do…": the field and its send button; in a project it starts a plan, elsewhere it asks the bot. */
function taskBar(ctx: BotsCtx, o: { projectId?: string; placeholder?: string }): Node {
  const send = o.projectId ? startTask(o.projectId, "$state.task", "task") : codeAsk(ctx, "$state.task", { statePath: "task" });
  const desk = ctx.client === "desktop";
  return col([
    askMoment(ctx, { slug: "code", color: MOSS, kind: "code", busy: o.projectId ? "starting" : "asking", line: o.projectId ? "Making a plan…" : "Asking Code bot…" }),
    row([
      field("task", o.placeholder ?? "Tell Code bot what to do…", { onSubmit: send, size: desk ? 15 : 16, label: "Tell Code bot what to do" }),
      roundInk("send", send, "Send", desk ? 46 : 48),
    ], { gap: 10, borderWidth: 1, borderColor: C.line, borderRadius: desk ? 30 : 28, paddingVertical: 6, paddingRight: 6, paddingLeft: desk ? 20 : 18 }),
  ], { gap: 8 });
}

/**
 * A yes to one of the policy's questions, in two steps (routes/code.ts "A QUESTION"): the call, then the same call with the
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

/** Merge a pull request the person is looking at (POST /v1/bots/code/merge), then the quiet "Shipped" moment. */
function mergeAction(projectId: string, branch: string, jobId?: string): ActionRef {
  return seq(
    { kind: "setState", path: "merging", value: true },
    call("POST", "/v1/bots/code/merge", { projectId, branch, ...(jobId ? { jobId } : {}) }, {
      ok: seq({ kind: "setState", path: "merging", value: false }, toast("Merged."),
        jobId ? { kind: "navigate", screenId: SCREENS.done, params: { id: jobId }, replace: true } : REFRESH),
      fail: seq({ kind: "setState", path: "merging", value: false }, toast("Couldn't merge that. Open it on GitHub to see why.")),
    }),
  );
}

// ===================================================================== a job, in a line

function jobMark(j: Job): Mark {
  if (j.state === "waiting_for_you") return "needs";
  if (j.state === "done") return "done";
  if (j.state === "failed" || j.state === "cancelled") return "failed";
  if (j.state === "waiting_for_compute" || j.state === "paused") return "waiting";
  return "working";
}

/** "Working · step 3 of 5", "Needs you · 1 question", "Shipped · PR #126". */
function jobLine(ctx: BotsCtx, j: Job, br: Branch | undefined, o: { money?: boolean; when?: boolean } = {}): { line: string; color: string } {
  const pr = br?.prNumber ? `PR #${br.prNumber}` : "";
  const when = o.when ? ` · ${ago(j.updatedAt, ctx.live.now, ctx.tzOffsetMinutes)}` : "";
  switch (j.state) {
    case "waiting_for_you": {
      const what = j.waitingOn === "answer" ? "1 question" : j.waitingOn === "budget" ? "keep going?" : j.waitingOn === "paid" ? "a paid computer" : "your OK";
      return { line: `Needs you · ${what}`, color: C.meta };
    }
    case "running": case "queued": {
      const note = j.checkpoint?.notes ? ` · ${cut(firstLine(j.checkpoint.notes), 40)}` : "";
      return { line: `Working${note}`, color: MOSS };
    }
    case "waiting_for_compute": case "paused": return { line: "Waiting for a computer", color: C.meta };
    case "done": return { line: `${br?.state === "merged" ? "Shipped" : "Done"}${pr ? ` · ${pr}` : ""}${when}`, color: C.meta };
    case "failed": return { line: `Stopped${j.reason ? ` · ${cut(j.reason, 40)}` : ""}`, color: C.meta };
    default: return { line: "Stopped", color: C.meta };
  }
}

/** Where a job opens: its plan while that waits for a yes, its review once there is a PR to look at, else the job. */
function jobRoute(j: Job, br?: Branch): ActionSpec {
  if (j.state === "waiting_for_you" && j.waitingOn === "approval") return open(br?.prNumber ? SCREENS.codeReview : SCREENS.codePlan, { id: j.id });
  if (j.state === "done" && br?.prNumber && br.state !== "merged") return open(SCREENS.codeReview, { id: j.id });
  return open(SCREENS.codeJob, { id: j.id });
}

// ===================================================================== getting started: meet, pick, read

const STEP_NAMES = ["Meet Code bot", "Pick projects", "Read your project"];

/** The window's "1 Meet Code bot — 2 Pick projects — 3 Read your project". */
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
 * Code bot's own tiny bot across the getting-started steps (meet, pick, read, home), where the build draws him: one
 * life, one stage, in the same place on every step (under the back chevron on the phone, under the steps line in the
 * window), so he carries on from step to step instead of starting again. What he does follows the step: meet waves
 * and juggles his 0s and 1s, pick looks over the list below, read takes in dots and lines, home settles.
 */
function setupBuddy(ctx: BotsCtx, act: BuddyAct): Node | null {
  if (!canBuddy(ctx)) return null;
  const desk = ctx.client === "desktop";
  return botBuddy({ kind: "code", color: MOSS, life: "code.setup", state: "idle", act, height: desk ? 120 : 128, ...(desk ? { width: 300 } : {}), size: desk ? 48 : 52, label: "Code bot" });
}

/** The phone's top of a getting-started step with his stage: the back chevron, then him (the same place on every step). */
const setupTop = (top: Node, stage: Node): Node => col([top, stage], { gap: 14 });

/** While a plan is being made or Code bot is asked (taskBar's `starting` / `asking`): his tiny bot thinks. */
const CODE_BUSY = { any: [{ truthy: "starting" }, { truthy: "asking" }] };

/** The window's top line on the getting-started pages: back, "Bots · Code bot", the steps. */
const enterTop = (to: ActionRef, current: number): Node =>
  row([backButton(to), meta("Bots · Code bot", { size: 13 }), grow(), enterSteps(current)], { gap: 6 });

interface MeetData { gh?: Github; installUrl?: string; off?: boolean }

/**
 * Where "Connect GitHub" goes: the GitHub App's install page; on a server that offers only "Sign in with GitHub" (CODE_GITHUB_OAUTH,
 * no App), that sign-in. Nothing while GitHub is already connected, or neither way is set up.
 */
async function connectUrl(deps: BotsDeps, gh: Github | undefined): Promise<string | undefined> {
  if (!gh || gh.connected) return undefined;
  const install = await deps.api<{ installUrl: string }>("POST", "/v1/code/github/connect").then((r) => r.installUrl).catch(() => undefined);
  if (install || !gh.oauth) return install;
  return deps.api<{ authorizeUrl: string }>("POST", "/v1/code/github/signin").then((r) => r.authorizeUrl).catch(() => undefined);
}

async function loadMeet(deps: BotsDeps): Promise<MeetData> {
  // 404 code_off: the Code bot is off here. 503 not_configured: it is on, but GitHub isn't set up (the notice says which).
  let off = false;
  const gh = await deps.api<Github>("GET", "/v1/code/github").catch((e: { status?: number }) => { off = e?.status === 404; return undefined; });
  return { gh, installUrl: await connectUrl(deps, gh), off };
}

/** Enter1 / DEnter1: who Code bot is, and Connect GitHub. */
function meet(ctx: BotsCtx, d: MeetData | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  const connected = !!d?.gh?.connected;
  const pick = open(SCREENS.codeStart, { step: "pick" });
  const connect: ActionRef | undefined = connected ? pick : d?.installUrl ? seq(openUrl(d.installUrl), pick) : undefined;
  const ways = [
    connect ? primaryButton(connected ? "Pick your projects" : "Connect GitHub", connect, { icon: connected ? undefined : "link", wide: !desk })
      : button("Connect GitHub", undefined, { kind: "disabled", wide: !desk }),
    secondaryButton("Start a new project from scratch", open(SCREENS.newProject), { wide: !desk }),
  ];
  const promise = meta("I only see the projects you pick, and I never change your main branch without you.", { size: 12, lineHeight: 17, align: desk ? undefined : "center" });
  const offLine = !connect ? [notice(d?.off ? "The Code bot isn't switched on here yet." : "GitHub isn't set up on this server yet.", { mark: "lock" })] : [];
  const how = [
    "I read your project and learn where everything is.",
    "I work on a safe copy and test every change.",
    "Nothing goes live until you say yes.",
  ];
  const stage = setupBuddy(ctx, "wave");
  if (!desk) {
    return page(ctx, {
      title: "Code bot", nav: "code",
      body: [
        ...(stage ? [setupTop(backButton(), stage)] : [backButton(), row([blip("think", 210)], { justifyContent: "center" })]),
        col([title("Hi, I'm Code bot.", { size: 30, tracking: -0.8, lineHeight: 36 }), body("Tell me what you want built or fixed. I'll do the work and show you the proof.", { color: C.grey70 })], { gap: 8 }),
        col(how.map((h, i) => row([numberDot(i + 1, "plain", 24), body(h, { style: { flexShrink: 1 } })], { gap: 12 })), { gap: 14 }),
        ...offLine,
      ],
      footer: [...ways, promise], gap: 18,
    });
  }
  const pictures: Node[] = [
    col([["app/", "screens"], ["lib/", "logic"], ["tests/", "tests"]].map(([a, b]) => row([text(a!, { size: 11.5, mono: true, lineHeight: 16 }), grow(), text(b!, { size: 11.5, color: C.meta, lineHeight: 16 })], { gap: 10 })),
      { backgroundColor: C.surface, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, gap: 4 }),
    meta("Each change is tested before you see it", { size: 12 }),
    row([statusMark("done"), text("You press Merge. I never merge on my own.", { size: 12.5, weight: 500, lineHeight: 17, style: { flexShrink: 1 } })], { gap: 7, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 }),
  ];
  const allow = [["check", "Reading the projects you pick"], ["check", "Making branches and pull requests"], ["lock", "Changing main: never without you"]] as const;
  return page(ctx, {
    title: "Code bot", nav: "code", maxWidth: 1100, gap: 18,
    body: [
      enterTop(back(), 1),
      row([
        col([
          stage ?? blip("think", 176),
          col([title("Hi, I'm Code bot."), body("Tell me what you want built or fixed. I'll do the work and show you the proof.", { size: 16, color: C.grey70 })], { gap: 10 }),
          row(ways, { gap: 10, flexWrap: "wrap" }),
          row([icon("shield", { size: 18, color: C.meta }), meta("I only see the projects you pick, and I never change your main branch without you.", { size: 13, lineHeight: 18, style: { flexShrink: 1 } })], { gap: 10, maxWidth: 420, alignItems: "flex-start" }),
          ...offLine,
        ], { flexGrow: 0.85, flexBasis: 0, minWidth: 0, gap: 20 }),
        col([
          sectionLabel("How I work"),
          col(how.map((h, i) => row([
            numberDot(i + 1, "done", 28), text(h, { size: 15, lineHeight: 21, style: { flexGrow: 1, flexBasis: 0, minWidth: 0 } }), box([pictures[i]!], { width: 250, flexShrink: 0 }),
          ], { gap: 18, paddingVertical: 18, paddingHorizontal: 20, ...(i < 2 ? { borderBottomWidth: 1, borderBottomColor: C.divider } : {}) })), { borderWidth: 1, borderColor: C.line, borderRadius: 18 }),
          col([
            text("When you connect, GitHub asks you to allow", { size: 13, weight: 600, lineHeight: 17 }),
            row(allow.map(([ic, w]) => row([icon(ic, { size: 16, color: C.grey70 }), text(w, { size: 13, color: C.grey70, lineHeight: 17, style: { flexShrink: 1 } })], { gap: 8, flexGrow: 1, flexBasis: 0, minWidth: 0, alignItems: "flex-start" })), { gap: 14 }),
          ], { backgroundColor: C.surface, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 18, gap: 10 }),
        ], { flexGrow: 1.15, flexBasis: 0, minWidth: 0, gap: 14 }),
      ], { gap: 56, alignItems: "flex-start" }),
    ],
  });
}

interface PickData { gh?: Github; repos?: { repos: Repo[]; truncated: boolean; needsSignin?: boolean }; projects?: Project[]; installUrl?: string }

async function loadPick(deps: BotsDeps): Promise<PickData> {
  const [gh, repos, projects] = await Promise.all([
    get<Github>(deps, "/v1/code/github"),
    get<PickData["repos"]>(deps, "/v1/code/repos"),
    get<{ projects: Project[] }>(deps, "/v1/code/projects").then((r) => r?.projects),
  ]);
  return { gh, repos, projects, installUrl: await connectUrl(deps, gh) };
}

/** A tick box that follows a state path (not pressable itself: its row is). */
function tickBox(path: string, size = 22): Node {
  const on = { truthy: path };
  return box([{ ...icon("check", { size: size - 6, color: C.paper, weight: 2.4 }), visibleIf: on }], {
    width: size, height: size, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center", flexShrink: 0,
    borderColor: { ...on, then: C.ink, else: C.outline }, backgroundColor: { ...on, then: C.ink, else: C.paper },
  });
}

/** Enter2 / DEnter2: which projects should I work on? */
function pickProjects(ctx: BotsCtx, d: PickData | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  const login = d?.gh?.oauth?.login ?? d?.gh?.installations[0]?.account;
  const added = new Map((d?.projects ?? []).map((p) => [p.fullName, p.id]));
  const q = str(ctx.params.q).trim().toLowerCase();
  const vis = str(ctx.params.vis);
  const all = d?.repos?.repos ?? [];
  const shown = all.filter((r) => (!q || r.fullName.toLowerCase().includes(q)) && (vis === "private" ? r.private : vis === "public" ? !r.private : true));
  const add = call("POST", "/v1/bots/code/projects/add", { picks: "$state.pick" }, {
    assignTo: "made",
    ok: { kind: "navigate", screenId: SCREENS.codeStart, params: { step: "read", project: "$state.made.added.0.id" } },
    fail: toast("Pick a project first, or check X0 Bot can see it on GitHub."),
  });
  const search = (v: string): ActionSpec => ({ kind: "navigate", screenId: SCREENS.codeStart, params: { step: "pick", q: v, vis }, replace: true });
  const manage = d?.gh?.installations[0]?.manageUrl ?? d?.installUrl;
  const missing = row([
    meta("Missing one?", { size: desk ? 13 : 12 }),
    ...(manage ? [text("Give X0 Bot access to it on GitHub.", { size: desk ? 13 : 12, color: C.ink, weight: 500, lineHeight: 17, style: { textDecorationLine: "underline" } })] : []),
  ], { gap: 4, flexWrap: "wrap" }, manage ? openUrl(manage) : undefined);
  const heading = col([
    row([icon("check", { size: 16 }), text(login ? `GitHub connected · @${login}` : d?.gh?.connected ? "GitHub connected" : "GitHub not connected yet", { size: 13, weight: 500, lineHeight: 17 })], { gap: 8 }),
    title("Which projects should I work on?", { size: 26, tracking: -0.6, lineHeight: 32 }),
    meta("Pick one to start. You can add more any time.", { size: 14 }),
  ], { gap: 6 });
  const searchBox = row([icon("search", { size: 18, color: C.meta }), field("q", `Search ${plural(all.length, "repository", "repositories")}`, { onSubmit: search("$state.q"), size: 15, label: "Search your repositories" })],
    { gap: 10, borderWidth: 1, borderColor: C.line, borderRadius: 22, paddingHorizontal: 14, height: 44, flexGrow: 1 });

  // Nothing to show: not connected, nothing GitHub let us see, or a search with no match.
  let empty: Node | null = null;
  if (!d?.repos) {
    empty = emptyState({
      pose: "listen", title: d?.gh?.connected ? "I couldn't reach GitHub" : "Connect GitHub first",
      body: d?.gh?.connected ? "Try again in a moment." : "Once you allow X0 Bot on GitHub, your repositories show here.",
      action: d?.gh?.connected || !d?.installUrl ? { label: "Try again", onPress: REFRESH } : { label: "Connect GitHub", onPress: openUrl(d.installUrl) },
    });
  } else if (!all.length) {
    empty = emptyState({ pose: "listen", title: "No repositories yet", body: "Give X0 Bot access to one on GitHub, then come back.", action: manage ? { label: "Open GitHub", onPress: openUrl(manage) } : { label: "Try again", onPress: REFRESH } });
  } else if (!shown.length) {
    empty = emptyState({ pose: "think", title: `Nothing called "${q}"`, action: { label: "Show all", onPress: search("") } });
  }

  const rowOf = (r: Repo, i: number, n: number): Node => {
    const have = added.get(r.fullName);
    const left = have ? box([statusMark("done", { size: 10 })], { width: 22, alignItems: "center" }) : tickBox(`pick.${r.id}`);
    return row([
      left,
      col([text(short(r.fullName), { size: 15, weight: 600, mono: true, lineHeight: 20, lines: 1 }), meta(`${r.private ? "Private" : "Public"} · ${have ? "added" : r.defaultBranch}`)], { gap: 3, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    ], { gap: 12, paddingVertical: 14, paddingHorizontal: 4, ...(i < n - 1 ? { borderBottomWidth: 1, borderBottomColor: C.divider } : {}) },
    have ? open(SCREENS.code, { project: have }) : { kind: "toggleState", path: `pick.${r.id}` });
  };

  const stage = setupBuddy(ctx, "survey");
  if (!desk) {
    const list = shown.slice(0, 20);
    return page(ctx, {
      back: !stage, title: "Pick projects", nav: "code", state: { pick: {}, q: str(ctx.params.q) },
      body: [...(stage ? [setupTop(backButton(), stage)] : []), heading, searchBox, ...(empty ? [empty] : [col(list.map((r, i) => rowOf(r, i, list.length)))])],
      footer: [...(empty ? [] : [primaryButton("Add projects", add, { wide: true })]), missing], gap: 16,
    });
  }
  const counts = { all: all.length, private: all.filter((r) => r.private).length, public: all.filter((r) => !r.private).length };
  const tabs = row((["all", "private", "public"] as const).map((k) => box([
    text(`${k === "all" ? "All" : k === "private" ? "Private" : "Public"} ${counts[k]}`, { size: 13, weight: (vis || "all") === k ? 600 : 400, color: (vis || "all") === k ? C.ink : C.grey70, lineHeight: 17 }),
  ], { paddingHorizontal: 14, height: 36, justifyContent: "center", borderRadius: 10, ...((vis || "all") === k ? { backgroundColor: C.paper } : {}) },
  (vis || "all") === k ? undefined : { kind: "navigate", screenId: SCREENS.codeStart, params: { step: "pick", q: str(ctx.params.q), vis: k === "all" ? "" : k }, replace: true })),
  { backgroundColor: C.surface, borderRadius: 12, padding: 3 });
  const list = shown.slice(0, 30);
  const tableNode = col([
    row([box([], { width: 22 }), ...["Repository", "Visibility", "Default branch", ""].map((h, j) => box([sectionLabel(h)], j === 0 ? { flexGrow: 1, flexBasis: 0, minWidth: 0 } : { width: j === 3 ? 90 : 120 }))], { gap: 16, paddingVertical: 10, paddingHorizontal: 18 }),
    ...list.map((r) => {
      const have = added.get(r.fullName);
      return row([
        have ? box([statusMark("done", { size: 10 })], { width: 22, alignItems: "center" }) : tickBox(`pick.${r.id}`, 20),
        box([text(short(r.fullName), { size: 14, weight: 600, mono: true, lineHeight: 19, lines: 1 })], { flexGrow: 1, flexBasis: 0, minWidth: 0 }),
        box([text(r.private ? "Private" : "Public", { size: 13, color: C.grey70, lineHeight: 17 })], { width: 120 }),
        box([text(r.defaultBranch, { size: 12.5, mono: true, color: C.grey70, lineHeight: 17 })], { width: 120 }),
        box([meta(have ? "Added" : "", { size: 13 })], { width: 90 }),
      ], { gap: 16, paddingHorizontal: 18, minHeight: 50, borderTopWidth: 1, borderTopColor: C.divider }, have ? open(SCREENS.code, { project: have }) : { kind: "toggleState", path: `pick.${r.id}` });
    }),
  ], { borderWidth: 1, borderColor: C.line, borderRadius: 18, overflow: "hidden" });
  const can = [["check", "Read the code and run its tests"], ["check", "Make a safe copy and open pull requests"], ["close", "Change main without you"], ["close", "See the projects you don't pick"]] as const;
  return page(ctx, {
    title: "Pick projects", nav: "code", maxWidth: 1100, gap: 18, state: { pick: {}, q: str(ctx.params.q) },
    body: [
      enterTop(open(SCREENS.codeStart, { step: "meet" }), 2),
      ...(stage ? [stage] : []),
      heading,
      row([
        col([
          row([searchBox, tabs], { gap: 12 }),
          ...(empty ? [empty] : [tableNode]),
          row([meta(`Showing ${list.length} of ${all.length}${d?.repos?.truncated ? "+" : ""}`, { size: 13 }), grow(), missing], { gap: 8, paddingHorizontal: 4 }),
        ], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 12 }),
        col([
          text("Your picks", { size: 15, weight: 600, lineHeight: 20 }),
          meta("Tick the ones I should work on. I read the first one straight away, about a minute; the rest wait their turn.", { size: 13, lineHeight: 18 }),
          sectionLabel("In those, I can"),
          col(can.map(([ic, w]) => row([icon(ic, { size: 16, color: ic === "check" ? C.ink : C.meta }), text(w, { size: 13, color: C.grey70, lineHeight: 17, style: { flexShrink: 1 } })], { gap: 8 })), { gap: 8 }),
          ...(empty ? [] : [primaryButton("Add projects", add, { wide: true })]),
        ], { width: 290, flexShrink: 0, borderWidth: 1, borderColor: C.line, borderRadius: 18, padding: 18, gap: 14 }),
      ], { gap: 28, alignItems: "flex-start" }),
    ],
  });
}

interface ReadData { brain?: BrainLite; project?: Project; projects?: Project[]; next?: string }

async function loadRead(ctx: BotsCtx, deps: BotsDeps): Promise<ReadData> {
  const id = str(ctx.params.project);
  if (!id) return {};
  const [brain, projects] = await Promise.all([
    get<BrainLite>(deps, `/v1/code/projects/${id}/brain`),
    get<{ projects: Project[] }>(deps, "/v1/code/projects").then((r) => r?.projects),
  ]);
  const others = (projects ?? []).filter((p) => p.id !== id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
  const theirs = await Promise.all(others.map((p) => get<BrainLite>(deps, `/v1/code/projects/${p.id}/brain`)));
  const next = others.find((_, i) => theirs[i]?.status === "building")?.fullName;
  return { brain, project: projects?.find((p) => p.id === id), projects, ...(next ? { next } : {}) };
}

/** The stages of reading a project, by the brain's progress (code/project/build.ts): done, now, still to come. */
const READ_STAGES: Array<[string, number]> = [["Reading the files", 50], ["Mapping how it fits together", 70], ["Learning how your team writes code", 92], ["Checking its health", 100]];

/** Enter3 / DEnter3: reading the project. */
function readProject(ctx: BotsCtx, d: ReadData | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  const id = str(ctx.params.project);
  if (!d?.project) return unreachable(ctx, "that project");
  const name = short(d.project.fullName);
  const b = d.brain;
  const ready = b?.status === "ready" || b?.status === "stale";
  const pct = ready ? 100 : Math.max(0, Math.min(100, b?.progress?.pct ?? 0));
  const s = b?.structure;
  const counts: Array<[string, string]> = [
    ["Files read", s?.fileCount ? s.fileCount.toLocaleString("en-IN") : "—"],
    ["Parts mapped", b?.features?.length ? String(b.features.length) : "—"],
    ["Tests found", s?.testing ? s.testing.testFiles.toLocaleString("en-IN") : "—"],
  ];
  const stages = READ_STAGES.map(([w, at], i) => {
    const prev = i ? READ_STAGES[i - 1]![1] : 0;
    const k: "done" | "now" | "todo" = pct >= at ? "done" : pct >= prev ? "now" : "todo";
    return row([
      box([statusMark(k === "done" ? "done" : k === "now" ? "working" : "waiting", { color: MOSS, size: k === "todo" ? 10 : 9 })], { width: 18, alignItems: "center" }),
      text(w, { size: desk ? 14 : 15, weight: k === "now" ? 500 : 400, color: k === "now" ? MOSS : k === "todo" ? C.meta : C.ink, lineHeight: 20, style: { flexGrow: 1 } }),
    ], { gap: 12, ...(desk ? { paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.divider } : {}) });
  });
  const countRows = counts.map(([l, v]) => row([
    box([], { width: 18 }), text(l, { size: desk ? 14 : 15, lineHeight: 20, style: { flexGrow: 1 } }), text(v, { size: desk ? 14 : 15, weight: 600, mono: true, lineHeight: 20 }),
  ], { gap: 12, ...(desk ? { paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.divider } : {}) }));
  const failed = b?.status === "failed";
  const none = !b || b.status === "none";
  const startRead = call("POST", `/v1/code/projects/${id}/brain`, { mode: "full" }, { ok: REFRESH, fail: toast("Couldn't start reading. Try again.") });
  const words = failed ? `I couldn't read ${name}` : none ? `Ready to read ${name}` : ready ? `I've read ${name}` : `Reading ${name}…`;
  const line = failed ? cut(b?.error || "GitHub didn't let me read it.", 120) : none ? "About a minute. You can leave this screen." : ready ? "Tell me what you want done." : "About a minute. I'll tell you when I'm ready.";
  const whileNote = box([text(d.next ? `While I read: ${short(d.next)} is next in line. You can leave this screen.` : "You can leave this screen. I'll keep reading.", { size: 13, color: C.grey70, lineHeight: 18 })],
    { backgroundColor: C.surface, borderRadius: 16, paddingVertical: desk ? 12 : 14, paddingHorizontal: desk ? 14 : 16 });
  const goHome = ready ? primaryButton(`Go to ${name}`, open(SCREENS.code, { project: id }), { wide: true })
    : failed || none ? primaryButton(failed ? "Try again" : "Start reading", startRead, { wide: true })
      : secondaryButton("Tell me what you want meanwhile", open(SCREENS.code, { project: id }), { wide: true });
  const progress = row([box([meter(pct, 100, { color: MOSS })], { flexGrow: 1 }), meta(`${pct}%`)], { gap: 10 });
  const stage = setupBuddy(ctx, ready ? "wave" : failed || none ? "play" : "read");
  const left: Node[] = [
    stage && desk ? stage : row([blip(ready ? "done" : "think", desk ? 104 : 190)], { justifyContent: desk ? "flex-start" : "center" }),
    col([title(words, { size: 24, lineHeight: 30 }), meta(line, { size: 14, lineHeight: 19 })], { gap: 6 }),
    ...(none || failed ? [] : [progress]),
    col([...countRows, ...stages], { gap: desk ? 0 : 14 }),
    ...(ready || failed || none ? [] : [whileNote]),
  ];
  if (!desk) {
    return page(ctx, {
      title: "Reading your project", nav: "code",
      body: stage ? [setupTop(backButton(), stage), ...left.slice(1)] : [backButton(), ...left],
      footer: [goHome, ...(!ready && !failed && !none ? [quietButton("Check again", REFRESH, { size: "md" })] : [])], gap: 20,
    });
  }
  const feats = (b?.features ?? []).slice(0, 16);
  const conv = (b?.conventions as { linter?: string[]; formatter?: string[] } | null | undefined);
  const style = ready ? [...(conv?.linter ?? []), ...(conv?.formatter ?? [])].slice(0, 2).join(" · ") || "Noted" : "Still learning…";
  const hot = b?.structure?.testing?.untestedHot?.[0];
  const map = col([
    row([
      col([text("The map so far", { size: 15, weight: 600, lineHeight: 20 }), meta(`The parts of ${name}, as I find them`)], { gap: 2, flexGrow: 1 }),
      row([row([box([], { width: 14, height: 10, borderWidth: 1, borderColor: C.ink, borderRadius: 3 }), meta("mapped")], { gap: 6 }),
        row([statusMark("working", { color: MOSS }), meta("reading now")], { gap: 6 })], { gap: 14 }),
    ], { gap: 12 }),
    feats.length
      ? grid(feats.map((f) => col([text(f.name, { size: 12.5, weight: 500, lineHeight: 16, lines: 1 }), text(plural(f.fileCount, "file"), { size: 10.5, color: C.meta, lineHeight: 14 })],
        { height: 44, borderRadius: 10, paddingHorizontal: 10, justifyContent: "center", borderWidth: 1, borderColor: C.ink, gap: 1 })), 4, 10)
      : col([statusMark("working", { color: MOSS }), meta(none || failed ? "Nothing read yet." : "The parts show here as I find them.")], { gap: 8, paddingVertical: 24, alignItems: "center" }),
    grow(),
    row([
      ["Built with", stackChips(b, { files: false }).join(" · ") || "Still reading…"],
      ["Busiest, no tests", hot ? cut(hot, 40) : ready ? "Nothing stands out" : "Still reading…"],
      ["Your team's style", style],
    ].map(([l, v]) => col([sectionLabel(l!), text(v!, { size: 13, lineHeight: 17, lines: 2 })], { gap: 4, flexGrow: 1, flexBasis: 0, minWidth: 0 })), { gap: 18, borderTopWidth: 1, borderTopColor: C.divider, paddingTop: 14 }),
  ], { flexGrow: 1, flexBasis: 0, minWidth: 0, borderWidth: 1, borderColor: C.line, borderRadius: 18, paddingVertical: 18, paddingHorizontal: 20, gap: 16 });
  return page(ctx, {
    title: "Reading your project", nav: "code", maxWidth: 1100, gap: 18,
    body: [
      enterTop(open(SCREENS.codeStart, { step: "pick" }), ready ? 4 : 3),
      row([
        col([...left, grow(), goHome], { width: 310, flexShrink: 0, gap: 14 }),
        map,
      ], { gap: 36, alignItems: "stretch", flexGrow: 1 }),
    ],
  });
}

// ===================================================================== the projects overview (Enter4 / DEnter4)

interface OverviewData { projects: Project[]; jobs: Job[]; brains: Record<string, BrainLite | undefined> }

async function loadOverview(deps: BotsDeps, projects?: Project[]): Promise<OverviewData | undefined> {
  const [list, jobs] = await Promise.all([
    projects ? Promise.resolve(projects) : get<{ projects: Project[] }>(deps, "/v1/code/projects").then((r) => r?.projects),
    get<{ jobs: Job[] }>(deps, "/v1/code/jobs").then((r) => r?.jobs ?? []),
  ]);
  if (!list) return undefined;
  const shown = list.slice(0, 8);
  const brains = await Promise.all(shown.map((p) => get<BrainLite>(deps, `/v1/code/projects/${p.id}/brain`)));
  return { projects: list, jobs: jobs ?? [], brains: Object.fromEntries(shown.map((p, i) => [p.id, brains[i]])) };
}

/** A project's "now": what its jobs are doing, or when it last shipped. */
function projectNow(ctx: BotsCtx, p: Project, jobs: Job[]): { mark: Mark; line: string; color: string } {
  const mine = jobs.filter((j) => j.projectId === p.id).sort((a, b) => b.updatedAt - a.updatedAt);
  const needs = mine.find((j) => j.state === "waiting_for_you");
  if (needs) return { mark: "needs", line: "Needs you", color: C.ink };
  const working = mine.find((j) => j.state === "running" || j.state === "queued");
  if (working) return { mark: "working", line: cut(working.task, 34), color: MOSS };
  const done = mine.find((j) => j.state === "done");
  if (done) return { mark: "done", line: `Done ${ago(done.updatedAt, ctx.live.now, ctx.tzOffsetMinutes)}`, color: C.meta };
  return { mark: "waiting", line: "Nothing yet", color: C.meta };
}

/** The projects overview: Code bot's home with several projects, and the last getting-started step (`setup`). */
function overview(ctx: BotsCtx, d: OverviewData | undefined, setup = false): ScreenResponse {
  const desk = ctx.client === "desktop";
  if (!d) return unreachable(ctx, "your projects");
  const week = ctx.live.now - 7 * 86_400_000;
  const working = d.jobs.filter((j) => j.state === "running" || j.state === "queued");
  const needsN = d.jobs.filter((j) => j.state === "waiting_for_you").length;
  const shipped = d.jobs.filter((j) => j.state === "done" && j.updatedAt >= week).length;
  const need = ctx.live.needs.find((n) => n.bot === "code");
  const status = [
    ...(working.length ? [{ mark: "working" as Mark, w: `Working on ${working.length}` }] : []),
    ...(needsN ? [{ mark: "needs" as Mark, w: `${needsN} need${needsN === 1 ? "s" : ""} you` }] : []),
    ...(shipped ? [{ mark: "done" as Mark, w: `${shipped} done this week` }] : []),
  ];
  const statusLine = status.length ? status.map((s) => s.w).join(" · ") : "Ready when you are";
  const suggestions: Array<{ label: string; action: ActionRef }> = [];
  for (const p of d.projects) {
    const t = firstTasks(d.brains[p.id], 1)[0];
    if (t && suggestions.length < 1) suggestions.push({ label: `${t.label} in ${short(p.fullName)}`, action: startTask(p.id, t.task) });
  }
  suggestions.push({ label: "What changed this week?", action: codeAsk(ctx, "What changed in my projects this week?") });
  const chipRow = row(suggestions.map((s) => box([text(s.label, { size: 13, lineHeight: 17, lines: 1 })], { borderWidth: 1, borderColor: C.outline, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 14, flexShrink: 1 }, s.action)), { gap: 8, flexWrap: "wrap" });
  const addRow = row([icon("plus", { size: 16, color: C.grey70 }), text("Add a project · or start one from scratch", { size: 14, color: C.grey70, lineHeight: 19 })],
    { gap: 8, borderWidth: 1.5, borderStyle: "dashed", borderColor: C.dashed, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16 }, open(SCREENS.codeStart, { step: "pick" }));

  // The last getting-started step: he settles, in the same place as on the steps before.
  const stage = setup ? setupBuddy(ctx, "settle") : null;
  if (!desk) {
    const cards = d.projects.slice(0, 6).map((p) => {
      const now = projectNow(ctx, p, d.jobs);
      const b = d.brains[p.id];
      const facts = [builtWith(b), testsLine(b)].filter(Boolean);
      return col([
        row([text(short(p.fullName), { size: 15, weight: 600, mono: true, lineHeight: 20, lines: 1, style: { flexShrink: 1 } }), grow(),
          row([statusMark(now.mark, { color: MOSS }), text(now.line, { size: 12, weight: now.mark === "needs" ? 600 : 500, color: now.color, lineHeight: 16, lines: 1 })], { gap: 6, flexShrink: 1 })], { gap: 8 }),
        ...(facts.length ? [row(facts.map((f) => meta(f)), { gap: 14, flexWrap: "wrap" })] : []),
      ], { borderWidth: 1, borderColor: C.line, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 8 }, open(SCREENS.code, { project: p.id }));
    });
    const head = row([backButton(), botAvatar(CODE, 40), col([text("Code bot", { size: 20, weight: 600, tracking: -0.3, lineHeight: 25 }), text(statusLine, { size: 12, weight: 500, color: working.length ? MOSS : C.meta, lineHeight: 16 })], { gap: 2, flexGrow: 1, flexShrink: 1 }),
      ...(stage ? [] : headerBuddy(ctx, "code", { lookTo: "down", thinkWhen: CODE_BUSY }))], { gap: 10 });
    return page(ctx, {
      back: false, nav: "code", title: "Code bot",
      body: [
        stage ? setupTop(head, stage) : head,
        ...(need ? [needsCard(need)] : []),
        col([sectionLabel("Projects"), ...cards, addRow], { gap: 10 }),
      ],
      footer: [chipRow, taskBar(ctx, {})], gap: 18,
    });
  }
  const rows = d.projects.slice(0, 8).map((p) => {
    const now = projectNow(ctx, p, d.jobs);
    const b = d.brains[p.id];
    return [
      text(short(p.fullName), { size: 14, weight: 600, mono: true, lineHeight: 19, lines: 1 }),
      text(builtWith(b) || "—", { size: 13, color: C.grey70, lineHeight: 17 }),
      row([statusMark(now.mark, { color: MOSS }), text(now.line, { size: 13, color: now.mark === "working" ? MOSS : C.ink, lineHeight: 17, lines: 1, style: { flexShrink: 1 } })], { gap: 8 }),
      text(testsLine(b) || "—", { size: 13, color: C.grey70, lineHeight: 17, lines: 1 }),
    ];
  });
  const table = col([
    row(["Project", "Built with", "Now", "Tests"].map((h, j) => box([sectionLabel(h)], { flexGrow: [1.1, 0.6, 1.5, 1.2][j], flexBasis: 0, minWidth: 0 })), { gap: 14, paddingVertical: 10, paddingHorizontal: 18 }),
    ...rows.map((r, i) => row([...r.map((c, j) => box([c], { flexGrow: [1.1, 0.6, 1.5, 1.2][j], flexBasis: 0, minWidth: 0 })), icon("chevron", { size: 16, color: C.meta })],
      { gap: 14, paddingHorizontal: 18, minHeight: 58, borderTopWidth: 1, borderTopColor: C.divider }, open(SCREENS.code, { project: d.projects[i]!.id }))),
    row([icon("plus", { size: 16, color: C.meta }), meta("Add a project · or start one from scratch", { size: 13 })], { gap: 10, paddingHorizontal: 18, minHeight: 50, borderTopWidth: 1, borderTopColor: C.divider }, open(SCREENS.codeStart, { step: "pick" })),
  ], { borderWidth: 1, borderColor: C.line, borderRadius: 18, overflow: "hidden" });
  const run = working[0];
  const recent = d.jobs.filter((j) => j.state === "done").sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  const nameOf = (id: string) => short(d.projects.find((p) => p.id === id)?.fullName ?? "");
  const running = col([
    sectionLabel("Running now"),
    run ? col([
      col([text(run.task, { size: 15, weight: 600, lineHeight: 20, lines: 2 }),
        row([statusMark("working", { color: MOSS }), text(`${nameOf(run.projectId)} · working · ${duration(Math.max(1, (ctx.live.now - run.createdAt) / 60_000))}`, { size: 12, weight: 500, color: MOSS, lineHeight: 16 })], { gap: 6 })], { gap: 2 }),
      meter(run.spentPaise, Math.max(run.budgetPaise, 1), { label: "Of what it was given", valueText: `${percent(run.spentPaise / Math.max(run.budgetPaise, 1))} used`, color: MOSS, height: 4 }),
    ], { borderWidth: 1, borderColor: C.line, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 12 }, open(SCREENS.codeJob, { id: run.id }))
      : meta("Nothing running. Tell me what to do below.", { size: 13 }),
    col(recent.map((j) => row([statusMark("done"), col([text(j.task, { size: 13.5, lineHeight: 18, lines: 1 }), meta(`${nameOf(j.projectId)} · ${ago(j.updatedAt, ctx.live.now, ctx.tzOffsetMinutes)}`)], { gap: 1, flexShrink: 1 })],
      { gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: C.divider }, open(SCREENS.codeJob, { id: j.id })))),
  ], { width: 300, flexShrink: 0, gap: 8 });
  return page(ctx, {
    title: "Code bot", nav: "code", maxWidth: 1100, gap: 18,
    body: [
      ...(stage ? [enterTop(open(SCREENS.codeStart, { step: "pick" }), 4), stage] : []),
      row([
        botAvatar(CODE, 44),
        col([title("Code bot"), row(status.length ? status.map((s) => row([statusMark(s.mark, { color: MOSS }), text(s.w, { size: 13, color: C.grey70, lineHeight: 17 })], { gap: 6 })) : [meta(statusLine, { size: 13 })], { gap: 14 })], { gap: 3, flexGrow: 1 }),
        ...(stage ? [] : headerBuddy(ctx, "code", { lookTo: "down", thinkWhen: CODE_BUSY })),
        secondaryButton("Add a project", open(SCREENS.codeStart, { step: "pick" }), { size: "md", icon: "plus" }),
        secondaryButton("Start from scratch", open(SCREENS.newProject), { size: "md" }),
      ], { gap: 14 }),
      ...(need ? [needsCard(need, { layout: "row" })] : []),
      row([col([sectionLabel(`Projects · ${d.projects.length}`), table], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 8 }), running], { gap: 24, alignItems: "flex-start" }),
    ],
    footer: [chipRow, taskBar(ctx, { placeholder: "Tell Code bot what to do" })],
  });
}

// ===================================================================== the Code bot home (CodeHome / DCodeHome)

type HomeData =
  | { kind: "off" }
  | { kind: "meet"; meet: MeetData }
  | { kind: "overview"; overview?: OverviewData }
  | { kind: "project"; project: Project; brain?: BrainLite; jobs: Job[]; branches: Branch[] };

async function loadHome(ctx: BotsCtx, deps: BotsDeps): Promise<HomeData> {
  let status = 0;
  const projects = await deps.api<{ projects: Project[] }>("GET", "/v1/code/projects").then((r) => r.projects).catch((e: { status?: number }) => { status = e?.status ?? 500; return undefined; });
  if (!projects) return status === 404 || status === 503 ? { kind: "meet", meet: await loadMeet(deps) } : { kind: "off" };
  if (!projects.length) return { kind: "meet", meet: await loadMeet(deps) };
  const wanted = str(ctx.params.project);
  const project = wanted ? projects.find((p) => p.id === wanted) : projects.length === 1 ? projects[0] : undefined;
  if (!project) return { kind: "overview", overview: await loadOverview(deps, projects) };
  const [brain, jobs, branches] = await Promise.all([
    get<BrainLite>(deps, `/v1/code/projects/${project.id}/brain`),
    get<{ jobs: Job[] }>(deps, "/v1/code/jobs").then((r) => (r?.jobs ?? []).filter((j) => j.projectId === project.id)),
    get<{ branches: Branch[] }>(deps, `/v1/code/projects/${project.id}/branches`).then((r) => r?.branches ?? []),
  ]);
  return { kind: "project", project, brain, jobs, branches };
}

function codeHome(ctx: BotsCtx, d: HomeData | undefined): ScreenResponse {
  if (!d || d.kind === "off") return unreachable(ctx, "the Code bot");
  if (d.kind === "meet") return meet(ctx, d.meet);
  if (d.kind === "overview") return overview(ctx, d.overview);
  return projectHome(ctx, d);
}

/** Near the usage limit, or at it: one calm line, a tap to Usage (src/you/usage.ts). Nothing while there is plenty left. */
function usageNote(ctx: BotsCtx): Node[] {
  const u = ctx.live.usage;
  if (u.state === "ok") return [];
  const span = spanOf(ctx);
  const when = u.resetsAt ? ` It resets ${whenWords(u.resetsAt, ctx.live.now, ctx.tzOffsetMinutes)}.` : "";
  const words = u.state === "out" ? `You've reached ${span}'s limit.${when}` : `You've used most of ${span}.${when}`;
  return [row([meta(words, { size: 12, lineHeight: 16, style: { flexShrink: 1 } }), icon("chevron", { size: 14, color: C.meta })], { gap: 6 }, open(SCREENS.usage))];
}

function projectHome(ctx: BotsCtx, d: Extract<HomeData, { kind: "project" }>): ScreenResponse {
  const desk = ctx.client === "desktop";
  const p = d.project, b = d.brain;
  const name = short(p.fullName);
  const branchOf = new Map(d.branches.map((x) => [x.branch, x]));
  const jobs = [...d.jobs].sort((a, b2) => (a.state === "waiting_for_you" ? -1 : 0) - (b2.state === "waiting_for_you" ? -1 : 0) || b2.updatedAt - a.updatedAt);
  const h = health(b);
  const tasks = firstTasks(b, 3);
  const building = b?.status === "building" || b?.status === "none" || !b;
  const empty = isEmptyRepo(b);
  const rs = desk ? 36 : 44;
  const rules = labelled(box([icon("settings", { size: desk ? 18 : 20 })], { width: rs, height: rs, borderRadius: rs / 2, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    open(SCREENS.projectRules, { project: p.id })), "Project rules");
  const branchTag = box([text(p.defaultBranch, { size: 12, mono: true, lineHeight: 16 })], { borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingVertical: 4, paddingHorizontal: 10, flexShrink: 0 });
  const chipsOf = stackChips(b);

  // What the brain knows, or where it is.
  const readCard: Node = empty
    ? col([text("This project is empty", { size: 15, weight: 600, lineHeight: 20 }), meta("Tell me your idea. I'll ask a few questions and write the plan with you.", { size: 13, lineHeight: 18 }),
      button("Plan it with me", open(SCREENS.newProject, { project: p.id }), { size: "md" })], { backgroundColor: C.surface, borderRadius: 20, padding: 16, gap: 12 })
    : building
      ? col([row([statusMark("working", { color: MOSS }), text(`Reading ${name}…`, { size: 15, weight: 600, lineHeight: 20 })], { gap: 8 }),
        meter(b?.progress?.pct ?? 0, 100, { color: MOSS }), meta("About a minute. You can tell me what to do meanwhile.", { size: 12 })],
      { backgroundColor: C.surface, borderRadius: 20, padding: 16, gap: 12 }, open(SCREENS.codeStart, { step: "read", project: p.id }))
      : col([
        text(b?.status === "failed" ? "I couldn't read your project" : "I've read your project", { size: 15, weight: 600, lineHeight: 20 }),
        ...(chipsOf.length ? [row(chipsOf.map((c) => tag(c, { white: true })), { gap: 6, flexWrap: "wrap" })] : []),
        ...(h ? [col([
          row([text("Health", { size: 13, lineHeight: 17 }), grow(), text(h.line, { size: 13, weight: 600, lineHeight: 17 })]),
          meter(h.passed ?? (h.failingCount ? 0 : 1), h.total ?? 1, { height: 6 }),
          ...(h.failingCount ? [meta(`${plural(h.failingCount, "was", "were")} already failing before me. I'll keep ${h.failingCount === 1 ? "it" : "them"} apart from my work.`.replace(/^1 was/, "1 was"), { size: 12, lineHeight: 16 })] : []),
        ], { gap: 6 })] : [meta(b?.status === "failed" ? cut(b.error || "Try reading it again.", 100) : "I haven't run its checks yet. I run them before my first change.", { size: 12, lineHeight: 16 })]),
      ], { backgroundColor: C.surface, borderRadius: 20, padding: 16, gap: 12 });

  const lately = jobs.slice(0, desk ? 5 : 3);
  const latelyRow = (j: Job, i: number) => {
    const br = branchOf.get(j.branch);
    const s = jobLine(ctx, j, br, { money: desk, when: desk });
    if (!desk) {
      return row([box([statusMark(jobMark(j), { color: MOSS, size: 10 })], { width: 10 }), col([text(j.task, { size: 15, lineHeight: 20, lines: 1 }), text(s.line, { size: 12, color: s.color, lineHeight: 16, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 })], { gap: 12 }, jobRoute(j, br));
    }
    const answer = j.state === "waiting_for_you";
    return row([
      box([statusMark(jobMark(j), { color: MOSS })], { width: 12, alignItems: "center" }),
      col([text(j.task, { size: 14, weight: 500, lineHeight: 19, lines: 1 }), text(s.line, { size: 12, color: C.meta, lineHeight: 16, lines: 1 })], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      ...(answer ? [secondaryButton(j.waitingOn === "approval" ? "Look" : "Answer", jobRoute(j, br), { size: "md" })] : []),
    ], { gap: 12, paddingHorizontal: 16, minHeight: 60, ...(i ? { borderTopWidth: 1, borderTopColor: C.divider } : {}) }, answer ? undefined : jobRoute(j, br));
  };
  const latelyBlock = lately.length
    ? (desk ? col([sectionLabel("Lately"), col(lately.map(latelyRow), { borderWidth: 1, borderColor: C.line, borderRadius: 18 })], { gap: 8 })
      : col([sectionLabel("Lately"), ...lately.map(latelyRow)], { gap: 10 }))
    : col([sectionLabel("Lately"), meta(empty ? "Nothing yet. Plan it first, then I build it step by step." : "Nothing yet. Tell me what to do below, or pick a first task.", { size: 13 })], { gap: 8 });

  if (!desk) {
    return page(ctx, {
      nav: "code", title: `Code bot · ${name}`,
      body: [
        row([backButton(), col([text("Code bot", { size: 20, weight: 600, tracking: -0.3, lineHeight: 25 }), text(p.fullName, { size: 13, mono: true, color: C.meta, lineHeight: 17, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
          ...headerBuddy(ctx, "code", { width: 64, lookTo: "down", thinkWhen: CODE_BUSY }), branchTag, rules], { gap: 8 }),
        readCard,
        ...usageNote(ctx),
        ...(tasks.length && !building ? [col([sectionLabel("Good first tasks"), ...tasks.map((t, i) => row([
          text(t.sub ? `${t.label} — ${t.sub}` : t.label, { size: 15, lineHeight: 20, style: { flexShrink: 1 } }), grow(), icon("chevron", { size: 16, color: C.meta }),
        ], { height: 52, gap: 8, ...(i < tasks.length - 1 ? { borderBottomWidth: 1, borderBottomColor: C.divider } : {}) }, startTask(p.id, t.task)))], { gap: 4 })] : []),
        latelyBlock,
      ],
      footer: [taskBar(ctx, { projectId: p.id })], gap: 18,
    });
  }

  // The window: the composer up top, then Lately and the pull requests beside the health card.
  const send = startTask(p.id, "$state.task", "task");
  const composer = col([
    field("task", `Tell Code bot what to do in ${name}…`, { multiline: true, size: 19, minHeight: 81, label: "Tell Code bot what to do" }),
    row([
      ...(tasks.length ? [sectionLabel("Good first tasks"), ...tasks.map((t) => box([text(t.label, { size: 13, lineHeight: 17, lines: 1 })], { borderWidth: 1, borderColor: C.outline, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 14, flexShrink: 1 }, startTask(p.id, t.task)))] : []),
      grow(),
      roundInk("clip", open(SCREENS.attach, { project: p.id }), "Attach", 44, true),
      roundInk("mic", { kind: "dictate" }, "Speak", 44, true),
      roundInk("send", send, "Plan it", 48),
    ], { gap: 8, flexWrap: "wrap" }),
  ], { borderWidth: 1.5, borderColor: C.ink, borderRadius: 22, paddingTop: 18, paddingRight: 16, paddingBottom: 14, paddingLeft: 22, gap: 12 });
  const prs = d.branches.filter((x) => x.prNumber).sort((a, b2) => b2.createdAt - a.createdAt).slice(0, 4);
  const jobOn = (br: string) => d.jobs.filter((j) => j.branch === br).sort((a, b2) => b2.updatedAt - a.updatedAt)[0];
  const prRows = prs.map((x, i) => {
    const j = jobOn(x.branch);
    const live = j && !ENDED.includes(j.state);
    const st = live ? { mark: "working" as Mark, w: "Draft · checks running" } : x.state === "merged" ? { mark: "done" as Mark, w: "Merged" }
      : x.state === "closed" ? { mark: "failed" as Mark, w: "Closed" } : x.state === "conflict" ? { mark: "needs" as Mark, w: "Conflicts with main" } : { mark: "waiting" as Mark, w: "Waiting for review" };
    return row([
      box([text(`#${x.prNumber}`, { size: 12, mono: true, color: C.grey70, lineHeight: 16 })], { width: 52 }),
      box([text(x.task || x.branch, { size: 14, lineHeight: 19, lines: 1 })], { flexGrow: 1, flexBasis: 0, minWidth: 0 }),
      box([text(x.branch.startsWith("tailzu/") ? "Code bot" : "Handed over", { size: 13, color: C.grey70, lineHeight: 17, lines: 1 })], { width: 90 }),
      row([statusMark(st.mark, { color: MOSS }), text(st.w, { size: 12.5, color: C.grey70, lineHeight: 16, lines: 1 })], { gap: 7, width: 170 }),
    ], { gap: 12, paddingHorizontal: 16, minHeight: 50, ...(i ? { borderTopWidth: 1, borderTopColor: C.divider } : {}) }, open(SCREENS.prCare, { project: p.id, pr: x.prNumber!, branch: x.branch }));
  });
  const healthCard = col([
    sectionLabel("Health"),
    ...(h ? [
      row([bigNumber(String(h.passed ?? h.failingCount)), text(h.passed !== undefined ? `of ${(h.total ?? 0).toLocaleString("en-IN")} tests pass` : h.failingCount ? "failing" : "checks", { size: 14, color: C.grey70, lineHeight: 19 })], { gap: 8, alignItems: "flex-end" }),
      meter(h.passed ?? (h.failingCount ? 0 : 1), h.total ?? 1, { height: 5 }),
      ...(h.failingCount ? [text(`${plural(h.failingCount, "was", "were")} already failing before me. I'll keep ${h.failingCount === 1 ? "it" : "them"} apart from my work.`, { size: 13, color: C.grey70, lineHeight: 18 })] : []),
      ...(h.failing.length ? [col(h.failing.slice(0, 3).map((f) => row([statusMark("failed"), text(cut(f, 34), { size: 11.5, mono: true, lineHeight: 16, lines: 1 })], { gap: 8 })), { gap: 7, backgroundColor: C.surface, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 })] : []),
    ] : [meta(building ? "Still reading. The health shows here when I'm done." : "I haven't run its checks yet. I run them before my first change.", { size: 13, lineHeight: 18 })]),
    col([
      ...(b?.structure?.testing?.untestedHot?.[0] ? [["Busy, untested", cut(placeOf(b, b.structure.testing.untestedHot[0]).toLowerCase(), 22)]] : []),
      ...(b?.structure?.testing ? [["Test files", b.structure.testing.testFiles.toLocaleString("en-IN")]] : []),
      ...(checksOf(b).length ? [["Checks", String(checksOf(b).length)]] : []),
      ...(b?.builtAt ? [["Last read", `${ago(b.builtAt, ctx.live.now, ctx.tzOffsetMinutes)}, ${clock(b.builtAt, ctx.tzOffsetMinutes)}`]] : []),
    ].map(([l, v], i, a) => row([text(l!, { size: 13, lineHeight: 17 }), grow(), text(v!, { size: 13, color: C.meta, lineHeight: 17, lines: 1 })], { gap: 10, paddingVertical: 9, ...(i < a.length - 1 ? { borderBottomWidth: 1, borderBottomColor: C.divider } : {}) }))),
  ], { width: 290, flexShrink: 0, borderWidth: 1, borderColor: C.line, borderRadius: 18, paddingVertical: 16, paddingHorizontal: 18, gap: 12 });
  return page(ctx, {
    nav: "code", title: `Code bot · ${name}`, maxWidth: 1100, gap: 18,
    state: { task: "" },
    body: [
      row([
        botAvatar(CODE, 36),
        row([text(owner(p.fullName), { size: 26, weight: 500, color: C.meta, tracking: -0.5, lineHeight: 32 }), title(name)], { flexShrink: 1 }),
        branchTag, ...headerBuddy(ctx, "code", { lookTo: "down", thinkWhen: CODE_BUSY }), grow(),
        ...(building || empty ? [] : [row([statusMark("done"), text("I've read your project", { size: 13, color: C.grey70, lineHeight: 17 })], { gap: 7 })]),
        ...(chipsOf.length ? [row(chipsOf.map((c) => tag(c, { mono: true })), { gap: 6, flexShrink: 1, overflow: "hidden" })] : []),
        rules,
      ], { gap: 10 }),
      ...(empty ? [readCard] : [composer,
        { ...row([statusMark("working", { color: MOSS }), meta("Making a plan…", { size: 13 })], { gap: 8 }), visibleIf: { truthy: "starting" } },
        meta("I plan first and show you. Nothing changes until you press Start.", { size: 12 }), ...usageNote(ctx)]),
      ...(building && !empty ? [readCard] : []),
      row([
        col([
          latelyBlock,
          col([sectionLabel("Pull requests"), prs.length ? col(prRows, { borderWidth: 1, borderColor: C.line, borderRadius: 18 }) : meta("None yet. I open one when a change passes its checks.", { size: 13 })], { gap: 8 }),
        ], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 18 }),
        healthCard,
      ], { gap: 24, alignItems: "flex-start" }),
    ],
  });
}

// ===================================================================== bots.code.start

type StartData = { step: "meet"; d: MeetData } | { step: "pick"; d: PickData } | { step: "read"; d: ReadData } | { step: "home"; d?: OverviewData };

async function loadStart(ctx: BotsCtx, deps: BotsDeps): Promise<StartData> {
  const step = str(ctx.params.step) || "meet";
  if (step === "pick") return { step, d: await loadPick(deps) };
  if (step === "read") return { step, d: await loadRead(ctx, deps) };
  if (step === "home") return { step, d: await loadOverview(deps) };
  return { step: "meet", d: await loadMeet(deps) };
}

function start(ctx: BotsCtx, s: StartData | undefined): ScreenResponse {
  if (!s) return meet(ctx, undefined);
  if (s.step === "pick") return pickProjects(ctx, s.d);
  if (s.step === "read") return readProject(ctx, s.d);
  if (s.step === "home") return overview(ctx, s.d, true);
  return meet(ctx, s.d);
}

// ===================================================================== bots.code.new (NewProject / DNewProject)

type NewData =
  | { kind: "pick"; projects: Project[] }
  | { kind: "intake"; v: IntakeView };

async function loadNew(ctx: BotsCtx, deps: BotsDeps): Promise<NewData | undefined> {
  const id = str(ctx.params.project);
  if (id) {
    const v = await get<IntakeView>(deps, `/v1/bots/code/projects/${id}/intake`);
    return v ? { kind: "intake", v } : undefined;
  }
  const projects = await get<{ projects: Project[] }>(deps, "/v1/code/projects").then((r) => r?.projects ?? []);
  return { kind: "pick", projects };
}

/** "The plan so far": what is decided (the answers, or the plan the answers made) and what is still to decide. */
function planSoFar(ctx: BotsCtx, v: IntakeView): Node[] {
  const desk = ctx.client === "desktop";
  const h2 = (s: string, extra?: Node) => row([text("##", { size: 13, color: C.idle, lineHeight: 18 }), text(s, { size: 13, weight: 600, lineHeight: 18 }), ...(extra ? [extra] : [])], { gap: 5 });
  const line = (s: string, color: string = C.grey70) => text(s, { size: 13, color, lineHeight: 18 });
  const blocks: Node[] = [];
  if (v.spec && v.stack) {
    blocks.push(col([text(v.spec.name, { size: desk ? 19 : 16, weight: 700, tracking: -0.3, lineHeight: 24 }), line(cut(v.spec.summary, 220))], { gap: 6 }));
    blocks.push(col([h2("Built with"), line(`${v.stack.label} · ${v.stack.tier === "free" ? "free hosting on " : "hosting on "}${v.stack.hosting}`)], { gap: 5 }));
    if (v.milestones?.length) {
      blocks.push(col([h2("Steps"), ...v.milestones.slice(0, 6).map((m, i) => row([numberDot(m.k, i === 0 ? "done" : "todo"), text(m.title, { size: 13, lineHeight: 18, style: { flexShrink: 1 } })], { gap: 10 })),
        meta("Each step ends with a pull request you check first.", { size: 12 })], { gap: 9 }));
    }
  } else {
    blocks.push(col([text(v.request ? cut(v.request, 80) : "Your idea", { size: desk ? 19 : 16, weight: 700, tracking: -0.3, lineHeight: 24 })], { gap: 6 }));
    const latest = v.answered[v.answered.length - 1];
    for (const id of v.answered) {
      const a = v.answers[id];
      if (!a) continue;
      blocks.push(col([h2(SHORT[id] ?? id, id === latest ? text("just added", { size: 11, weight: 500, color: MOSS, lineHeight: 15 }) : undefined), line(cut(a.replace("(no preference: you decide)", "You decide"), 160))],
        { gap: 5, ...(id === latest ? { borderLeftWidth: 2, borderLeftColor: MOSS, paddingLeft: 10 } : {}) }));
    }
    if (!v.answered.length) blocks.push(line("I write the plan here as you answer.", C.meta));
  }
  if (v.questions.length) blocks.push(col([h2("Still to decide"), line(v.questions.map((q) => SHORT[q.id] ?? q.ask).join(" · "), C.meta)], { gap: 5 }));
  return blocks;
}

function newProject(ctx: BotsCtx, d: NewData | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  if (!d) return unreachable(ctx, "that project");
  const fromHome = back();

  // No project yet, or no idea yet: the idea, and where it lives.
  if (d.kind === "pick" || !d.v.request) {
    const projectId = d.kind === "intake" ? d.v.project.id : null;
    const projects = d.kind === "pick" ? d.projects : [];
    const target = projectId ?? "$state.where";
    const plan: ActionRef = {
      kind: "condition", if: { falsy: "idea" }, then: toast("Say what you want to build first"),
      else: projectId ? call("POST", `/v1/bots/code/projects/${projectId}/intake/answer`, { request: "$state.idea" }, { ok: REFRESH, fail: toast("Couldn't plan that. Try again.") })
        : {
          kind: "condition", if: { falsy: "where" }, then: toast("Pick where it lives first"),
          else: call("POST", `/v1/bots/code/projects/${target}/intake/answer`, { request: "$state.idea" }, {
            ok: { kind: "navigate", screenId: SCREENS.newProject, params: { project: "$state.where" }, replace: true },
            fail: toast("Couldn't plan that. Try again."),
          }),
        },
    };
    // A new repo is made from here: GitHub only checks it's them (a blink when they already allowed X0 Bot), then makes it and it's added.
    const makeRepo: ActionRef = {
      kind: "condition", if: { falsy: "repoName" }, then: toast("Name the repo first"),
      else: call("POST", "/v1/code/repos/new", { name: "$state.repoName", visibility: "$state.repoVis" }, {
        assignTo: "newRepo", ok: openUrl("$state.newRepo.url"), fail: toast("Couldn't start that. Try again."),
      }),
    };
    const where: Node[] = projectId ? [] : [
      sectionLabel("Where it lives"),
      meta("A new repo on your GitHub, made from here. Or pick one you added.", { size: 13 }),
      boxedField("repoName", "my-new-project", { size: 15, label: "New repo name" }),
      row([
        chips([{ label: "Private", value: "private" }, { label: "Public", value: "public" }], "repoVis"),
        secondaryButton("Make the repo", makeRepo, { size: "md", icon: "plus" }),
        quietButton("Add one I have", open(SCREENS.codeStart, { step: "pick" }), { size: "md" }),
      ], { gap: 8, flexWrap: "wrap", alignItems: "center" }),
      ...(projects.length ? [chips(projects.slice(0, 12).map((p) => ({ label: short(p.fullName), value: p.id })), "where")] : []),
    ];
    const bodyNodes: Node[] = [
      ...(desk ? [row([backButton(fromHome), meta("Code bot · New project", { size: 13 })], { gap: 6 })] : [backButton(fromHome)]),
      col([sectionLabel("Your idea"), title(projectId ? `A new project in ${short(d.kind === "intake" ? d.v.project.fullName : "")}` : "Start a new project", { size: desk ? 26 : 24 })], { gap: 6 }),
      meta("Tell me your idea in a sentence or two. I'll ask a few questions and write the plan with you. Nothing is built until you say so.", { size: 14, lineHeight: 19 }),
      boxedField("idea", "A booking app for my salon", { multiline: true, size: 16, minHeight: 90, label: "Your idea" }),
      ...where,
    ];
    return page(ctx, {
      nav: "code", title: "New project", state: { idea: "", where: "" }, gap: 16,
      body: bodyNodes, footer: [primaryButton("Plan it", plan, { wide: !desk })],
      ...(desk ? { maxWidth: 720 } : {}),
    });
  }

  const v = d.v;
  const id = v.project.id;
  const total = v.answered.length + v.questions.length;
  const q = v.questions[0];
  const k = v.answered.length + 1;

  // The plan is written: read it, then start building.
  if (!q) {
    const write = call("POST", `/v1/code/projects/${id}/intake`, { proceed: true }, { ok: REFRESH, fail: toast("Couldn't write the plan. Try again.") });
    const build = seq({ kind: "setState", path: "building", value: true }, call("POST", `/v1/bots/code/projects/${id}/build-new`, {}, {
      assignTo: "built",
      ok: seq({ kind: "setState", path: "building", value: false }, { kind: "navigate", screenId: SCREENS.codeJob, params: { id: "$state.built.job.id" }, replace: true }),
      fail: seq({ kind: "setState", path: "building", value: false }, toast("Couldn't start building. Try again.")),
    }));
    const hasPlan = !!v.spec;
    const article = col(planSoFar(ctx, v), { borderWidth: 1, borderColor: C.line, borderRadius: desk ? 18 : 20, padding: desk ? 20 : 16, gap: 14, backgroundColor: C.paper });
    const foot = [
      hasPlan ? primaryButton("Start building", build, { wide: !desk }) : primaryButton("Write the plan", write, { wide: !desk }),
      { ...row([statusMark("working", { color: MOSS }), meta("Starting…", { size: 13 })], { gap: 8 }), visibleIf: { truthy: "building" } },
    ];
    return page(ctx, {
      nav: "code", title: "New project", gap: 16, ...(desk ? { maxWidth: 760 } : {}),
      body: [
        ...(desk ? [row([backButton(fromHome), meta("Code bot · New project", { size: 13 })], { gap: 6 })] : [backButton(fromHome)]),
        col([sectionLabel("Your idea"), title(cut(v.request, 90), { size: desk ? 26 : 24, lines: 3 })], { gap: 6 }),
        row([text("The plan", { size: 15, weight: 600, lineHeight: 20 }), grow(), meta("PLAN.md")]),
        article,
        meta(hasPlan ? "When you start, I add it to your project as PLAN.md and build step 0. Each step ends with a pull request you check first." : "All your answers are in. I write the plan from them.", { size: 12, lineHeight: 17 }),
      ],
      footer: foot,
    });
  }

  // A question: quick answers to pick, or words to type.
  const quick = QUICK[q.id];
  const send = call("POST", `/v1/bots/code/projects/${id}/intake/answer`, { id: q.id, picks: "$state.picks", text: "$state.answer" }, {
    ok: seq({ kind: "setState", path: "picks", value: {} }, { kind: "clearState", path: "answer" }, REFRESH),
    fail: toast("Pick or type an answer first."),
  });
  const skip = call("POST", `/v1/bots/code/projects/${id}/intake/answer`, { id: q.id, skip: true }, { ok: REFRESH, fail: toast("Couldn't skip that. Try again.") });
  const quickNodes: Node[] = quick ? [desk
    ? grid(quick.options.map((o) => {
      const p = `picks.${slugOf(o.label)}`;
      return col([
        row([tickBox(p, 20), text(o.label, { size: 15, weight: 600, lineHeight: 20 })], { gap: 10 }),
        ...(o.sub ? [text(o.sub, { size: 12.5, color: C.meta, lineHeight: 17 })] : []),
      ], { borderRadius: 16, padding: 14, gap: 8, borderWidth: { truthy: p, then: 1.5, else: 1 }, borderColor: { truthy: p, then: C.ink, else: C.outline } }, { kind: "toggleState", path: p });
    }), Math.min(4, quick.options.length), 10)
    : row(quick.options.map((o) => {
      const p = `picks.${slugOf(o.label)}`;
      return row([text(o.label, { size: 13, lineHeight: 17, style: { color: { truthy: p, then: C.paper, else: C.ink } } })], {
        paddingVertical: 9, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1,
        borderColor: { truthy: p, then: C.ink, else: C.outline }, backgroundColor: { truthy: p, then: C.ink, else: C.paper },
      }, { kind: "toggleState", path: p });
    }), { gap: 8, flexWrap: "wrap" })] : [];
  const typed = boxedField("answer", quick ? "Or say it in your words" : "Type your answer", { size: 15, onSubmit: quick ? undefined : send, label: q.ask });
  const question = col([
    sectionLabel(`Question ${k} of ${total}`),
    text(q.ask, { size: desk ? 20 : 16, weight: desk ? 600 : 500, tracking: desk ? -0.3 : 0, lineHeight: desk ? 26 : 22 }),
    meta(quick?.multi ? "Pick all that fit." : q.why, { size: 13 }),
    ...quickNodes, typed,
  ], { gap: desk ? 12 : 10 });
  const buttons = row([box([primaryButton("Next question", send, { wide: true })], { flexGrow: 1 }), secondaryButton("Skip", skip)], { gap: 10 });
  const ideaTitle = title(cut(v.request, 90), { size: desk ? 26 : 24, lines: 2 });

  if (!desk) {
    return page(ctx, {
      nav: "code", title: "New project", state: { picks: {}, answer: "" }, gap: 14,
      body: [
        backButton(fromHome), ideaTitle, question,
        col([row([text("The plan so far", { size: 15, weight: 600, lineHeight: 20 }), grow(), meta("PLAN.md")]), ...planSoFar(ctx, v).slice(1)],
          { borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 16, gap: 12 }),
      ],
      footer: [buttons],
    });
  }
  const resp = page(ctx, {
    nav: "code", title: "New project", state: { picks: {}, answer: "" }, gap: 18,
    body: [
      row([backButton(fromHome), meta("Code bot · New project", { size: 13 })], { gap: 6 }),
      col([sectionLabel("Your idea"), ideaTitle], { gap: 6 }),
      row(Array.from({ length: total }, (_, i) => box([], { height: 4, borderRadius: 2, flexGrow: 1, flexBasis: 0, backgroundColor: i < k - 1 ? C.ink : i === k - 1 ? MOSS : C.track })), { gap: 6 }),
      ...v.answered.filter((a) => v.answers[a]).slice(-3).map((a) => row([
        numberDot(v.answered.indexOf(a) + 1, "done"),
        row([meta(`${SHORT[a] ?? a}:`, { size: 13 }), text(cut(v.answers[a]!.replace("(no preference: you decide)", "You decide"), 80), { size: 13, weight: 500, lineHeight: 17, lines: 1, style: { flexShrink: 1 } })], { gap: 6, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      ], { gap: 12, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: C.surface, borderRadius: 14 })),
      question,
      ...(v.questions.length > 1 ? [row(v.questions.slice(1).map((x, i) => row([numberDot(k + i + 1, "todo"), text(SHORT[x.id] ?? x.ask, { size: 13, color: C.meta, lineHeight: 17, lines: 1 })], { gap: 8 })), { gap: 16, flexWrap: "wrap" })] : []),
    ],
    footer: [buttons],
  });
  return withAside(resp, [
    row([text("The plan so far", { size: 16, weight: 600, lineHeight: 21 }), grow(), meta("PLAN.md")]),
    col(planSoFar(ctx, v), { backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderRadius: 18, paddingVertical: 20, paddingHorizontal: 22, gap: 14 }),
    grow(),
    meta("I write this as you answer. It's saved in your new project when you start, and you can change it any time.", { size: 12, lineHeight: 17 }),
  ], 440);
}

// ===================================================================== bots.code.plan (CodePlan / DCodePlan)

interface PlanData { view?: JobView; project?: Project; history: PastJob[]; brain?: BrainLite }

async function loadPlan(ctx: BotsCtx, deps: BotsDeps): Promise<PlanData | undefined> {
  const id = str(ctx.params.id);
  if (!id) return undefined;
  const view = await get<JobView>(deps, `/v1/code/jobs/${id}`);
  if (!view) return undefined;
  const pid = view.job.projectId;
  const [project, history, brain] = await Promise.all([
    get<{ project: Project }>(deps, `/v1/code/projects/${pid}`).then((r) => r?.project),
    get<{ jobs: PastJob[] }>(deps, "/v1/code/jobs").then((r) => r?.jobs ?? []),
    get<BrainLite>(deps, `/v1/code/projects/${pid}/brain`),
  ]);
  return { view, project, history, brain };
}

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

function codePlan(ctx: BotsCtx, d: PlanData | undefined): ScreenResponse {
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
      row([backButton(toProject), meta("Code bot · plan first, then start", { size: 13 })], { gap: 6 }),
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

// ===================================================================== bots.code.rules (ProjectRules / DProjectRules)

async function loadRules(ctx: BotsCtx, deps: BotsDeps): Promise<RulesView | undefined> {
  const id = str(ctx.params.project);
  return id ? get<RulesView>(deps, `/v1/bots/code/projects/${id}/rules`) : undefined;
}

const RULE_ROWS: Array<{ id: RuleId; label: string; sub: string }> = [
  { id: "prs", label: "Open pull requests", sub: "Opens one when its checks pass" },
  { id: "merge", label: "Merge", sub: "You press Merge, every time" },
  { id: "main", label: "Push to", sub: "only changes through a PR" },
];

function projectRules(ctx: BotsCtx, v: RulesView | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  if (!v) return unreachable(ctx, "that project's rules");
  const id = v.project.id;
  const name = short(v.project.fullName);
  const main = v.project.defaultBranch;
  const set = (rule: RuleId, to: string): ActionRef => call("POST", `/v1/bots/code/projects/${id}/rules`, { rule, to }, { ok: seq(toast("Saved."), REFRESH), fail: toast("Couldn't save that. Try again.") });
  const comp = v.computers[0];
  const compSub = comp ? `Runs checks on ${comp.name} when awake` : "Runs checks on your computer when the X0 Bot app is open";
  const disconnect = call("POST", `/v1/bots/code/projects/${id}/disconnect`, {}, {
    ok: seq(toast(`Disconnected ${name}.`), { kind: "navigate", screenId: SCREENS.code, replace: true }),
    fail: toast("Couldn't disconnect it. Try again."),
  });
  const ruleLabel = (r: typeof RULE_ROWS[number]): Node => r.id === "main"
    ? row([text("Push to", { size: 15, lineHeight: 20 }), mono(main, { size: 12 })], { gap: 6 })
    : text(r.label, { size: 15, lineHeight: 20 });
  const checks = v.checks.length
    ? row(v.checks.slice(0, 8).map((c) => box([text(c, { size: 12, mono: true, lineHeight: 16 })], { backgroundColor: C.surface, borderRadius: 8, paddingVertical: desk ? 6 : 5, paddingHorizontal: desk ? 9 : 8 })), { gap: 6, flexWrap: "wrap" })
    : meta("None found yet. I look for lint, typecheck, test and build scripts.", { size: 12 });
  const confirm = { ...col([
    text(`Disconnect ${name}?`, { size: 15, weight: 600, lineHeight: 20 }),
    meta("I stop its jobs and forget it here. Nothing on GitHub changes.", { size: 12 }),
    row([button("Yes, disconnect", disconnect, { kind: "secondary", size: "md" }), quietButton("Keep it", { kind: "setState", path: "confirm", value: false }, { size: "md" })], { gap: 8 }),
  ], { gap: 8, paddingTop: 4 }), visibleIf: { truthy: "confirm" } };
  const dangerCard = col([
    row([
      col([text("Disconnect project", { size: 15, weight: 600, lineHeight: 20 }), meta("Stops all jobs here. Your code stays on GitHub.")], { gap: 3, flexGrow: 1, flexShrink: 1 }),
      { ...button("Disconnect", { kind: "setState", path: "confirm", value: true }, { kind: "secondary", size: "md" }), visibleIf: { falsy: "confirm" } },
    ], { gap: 12 }),
    confirm,
  ], { borderWidth: 1, borderColor: C.line, borderRadius: 18, paddingVertical: desk ? 11 : 14, paddingHorizontal: desk ? 18 : 16, gap: 8 });

  if (!desk) {
    const ruleRows = RULE_ROWS.map((r) => row([
      box([ruleLabel(r)], { flexGrow: 1, flexShrink: 1 }), text(ruleWord(v.rules[r.id]), { size: 14, color: C.meta, lineHeight: 19 }), icon("chevron", { size: 16, color: C.meta }),
    ], { gap: 8, paddingVertical: 13, paddingHorizontal: 16, minHeight: 48 }, set(r.id, nextValue(r.id, v.rules[r.id]))));
    return page(ctx, {
      nav: "code", title: "Project rules", state: { confirm: false, askLevel: askLevelOf(v.capPaise) }, gap: 14,
      body: [
        head(ctx, { title: "Project rules", sub: subLine([{ code: name }, "· what Code bot may do"]), to: open(SCREENS.code, { project: id }), right: [botAvatar(CODE, 30)] }),
        col([sectionLabel("On its own"), listCard(ruleRows)], { gap: 8 }),
        col([sectionLabel("Checking with you"), listCard([
          col([col([text("Checks with you", { size: 15, lineHeight: 20 }), meta(`Before a job uses a lot of ${spanOf(ctx)}`)], { gap: 2 }), askLevels(id)], { gap: 10, paddingVertical: 12, paddingHorizontal: 16 }),
          col([row([text("Checks it runs before each PR", { size: 15, lineHeight: 20 }), grow(), meta(String(v.checks.length), { size: 13 })]), checks], { gap: 10, paddingVertical: 14, paddingHorizontal: 16 }),
        ])], { gap: 8 }),
        col([sectionLabel("How it works"), listCard([
          row([text("Branch names", { size: 15, lineHeight: 20 }), grow(), text(cut(v.branchExample, 28), { size: 12, mono: true, color: C.meta, lineHeight: 16 })], { gap: 8, paddingVertical: 13, paddingHorizontal: 16 }),
          listRow({ label: "This computer helps", sub: compSub, value: comp ? (comp.on ? "On" : "Off") : "", onPress: open(SCREENS.computer) }),
        ])], { gap: 8 }),
        col([sectionLabel("Danger area"), dangerCard], { gap: 8 }),
      ],
    });
  }
  const section = (h: string, words: string, content: Node): Node => row([
    col([text(h, { size: 15, weight: 600, lineHeight: 20 }), meta(words, { size: 13, lineHeight: 18 })], { width: 250, flexShrink: 0, gap: 6 }),
    box([content], { flexGrow: 1, flexBasis: 0, minWidth: 0 }),
  ], { gap: 32, alignItems: "flex-start" });
  const opts = (r: RuleId) => (r === "prs" ? [{ label: "Yes", value: "yes" }, { label: "Never", value: "never" }] : [{ label: "Yes", value: "yes" }, { label: "Asks you", value: "ask" }, { label: "Never", value: "never" }]);
  const ruleRows = RULE_ROWS.map((r, i) => row([
    col([ruleLabel(r), r.id === "main" ? row([mono(main, { size: 12 }), meta(r.sub)], { gap: 4 }) : meta(r.sub)], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    box([segmented(opts(r.id), `rule.${r.id}`, { onChange: set(r.id, `$state.rule.${r.id}`) })], { width: r.id === "prs" ? 170 : 250, flexShrink: 0 }),
  ], { gap: 16, paddingVertical: 11, paddingHorizontal: 18, minHeight: 46, ...(i < RULE_ROWS.length - 1 ? { borderBottomWidth: 1, borderBottomColor: C.divider } : {}) }));
  const cardOf = (kids: Node[]) => col(kids, { borderWidth: 1, borderColor: C.line, borderRadius: 18 });
  return page(ctx, {
    nav: "code", title: "Project rules", maxWidth: 1000, gap: 22, state: { confirm: false, rule: v.rules, askLevel: askLevelOf(v.capPaise) },
    body: [
      head(ctx, { title: "Project rules", sub: subLine([{ code: name }, "· what Code bot may do"], 13), to: open(SCREENS.code, { project: id }),
        right: [row([botAvatar(CODE, 26), meta("Saved · applies from the next job", { size: 13 })], { gap: 8 })] }),
      section("On its own", "What Code bot may do without asking. It always works on its own branch, so your code only changes when you say.", cardOf(ruleRows)),
      section("Checking with you", `A job checks with you before it uses a lot of ${spanOf(ctx)}. Checks run before every PR, so you only review work that passes.`, cardOf([
        row([col([text("Checks with you", { size: 15, lineHeight: 20 }), meta(`Before a job uses a lot of ${spanOf(ctx)}`)], { gap: 2, flexGrow: 1 }),
          box([askLevels(id)], { width: 270, flexShrink: 0 })], { gap: 14, paddingVertical: 11, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: C.divider }),
        col([row([text("Checks it runs before each PR", { size: 15, lineHeight: 20 }), grow(), meta(String(v.checks.length), { size: 13 })]), checks], { gap: 10, paddingTop: 12, paddingBottom: 14, paddingHorizontal: 18 }),
      ])),
      section("How it works", "Where the work runs, and how branches are named so you can find them on GitHub.", cardOf([
        row([col([text("Branch names", { size: 15, lineHeight: 20 }), meta("tailzu/ and the job name")], { gap: 2, flexGrow: 1 }), mono(v.branchExample, { size: 12 })], { gap: 16, paddingVertical: 11, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: C.divider }),
        row([col([text("This computer helps", { size: 15, lineHeight: 20 }), meta(compSub)], { gap: 2, flexGrow: 1 }), meta(comp ? (comp.on ? "On" : "Off") : "Set up", { size: 13 }), icon("chevron", { size: 16, color: C.meta })],
          { gap: 12, paddingVertical: 11, paddingHorizontal: 18 }, open(SCREENS.computer)),
      ])),
      section("Danger area", "Nothing here is deleted. You can connect the project again any time.", dangerCard),
    ],
  });
}

// ===================================================================== bots.code.review (CodeReview / DCodeReview)

interface ReviewData { view?: JobView; project?: Project; branch: string; changes?: Changes; pr?: PrStatus }

async function loadReview(ctx: BotsCtx, deps: BotsDeps): Promise<ReviewData | undefined> {
  const id = str(ctx.params.id);
  let view: JobView | undefined, projectId = str(ctx.params.project), branch = str(ctx.params.branch);
  if (id) {
    view = await get<JobView>(deps, `/v1/code/jobs/${id}`);
    if (!view) return undefined;
    projectId = view.job.projectId; branch = view.job.branch;
  }
  if (!projectId || !branch) return undefined;
  const enc = encodeURIComponent(branch);
  const [project, changes, pr] = await Promise.all([
    get<{ project: Project }>(deps, `/v1/code/projects/${projectId}`).then((r) => r?.project),
    get<Changes>(deps, `/v1/bots/code/projects/${projectId}/changes?branch=${enc}${id ? `&job=${id}` : ""}`),
    get<PrStatus>(deps, `/v1/code/projects/${projectId}/branches/${enc}/pr`),
  ]);
  return { view, project, branch, changes, pr };
}

/** Code lines, as the boards draw them: an added line on grey with an ink bar, the old ones grey, numbers in the window. */
function codeLines(h: Hunk, o: { numbers?: boolean; size?: number; max?: number } = {}): Node {
  const size = o.size ?? 11.5;
  const lines = h.lines.slice(0, o.max ?? 40);
  return col(lines.map((l) => row([
    ...(o.numbers ? [box([text(String(l.n), { size: size - 0.5, mono: true, color: l.kind === "ctx" ? C.idle : C.meta, lineHeight: size + 6 })], { width: 40, alignItems: "flex-end", paddingRight: 10 })] : []),
    box([], { width: 3, alignSelf: "stretch", backgroundColor: l.kind === "add" ? C.ink : "transparent" }),
    text(`${l.kind === "del" ? "− " : ""}${l.text.replace(/^ +/, (m) => " ".repeat(m.length)).replace(/\t/g, "  ")}` || " ", {
      size, mono: true, lineHeight: size + 6, color: l.kind === "add" ? C.ink : l.kind === "del" ? C.meta : C.idle, lines: 1,
      style: { flexShrink: 1, paddingLeft: o.numbers ? 8 : 11, ...(l.kind === "del" ? { textDecorationLine: "line-through" } : {}) },
    }),
  ], { alignItems: "stretch", backgroundColor: l.kind === "add" ? HIGHLIGHT : "transparent", paddingRight: 14, ...(o.numbers ? {} : { paddingLeft: 11 }) })));
}

function codeReview(ctx: BotsCtx, d: ReviewData | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  if (!d) return unreachable(ctx, "that review");
  const job = d.view?.job, agent = d.view?.agent;
  const projectId = d.project?.id ?? str(ctx.params.project);
  const task = job?.task ?? d.pr?.title ?? d.branch;
  const files = d.changes?.files ?? [];
  const merged = d.pr?.state === "merged";
  const working = job && !ENDED.includes(job.state) && !(job.state === "waiting_for_you" && agent?.waiting?.for === "ready");
  const status = merged ? "merged" : !d.pr ? (working ? "still working" : "no pull request yet") : working ? "still working" : "ready for you";
  const verify = agent?.verify;
  const tags = [
    ...(verify?.ran ? [cut(firstLine(verify.summary), 34)] : []),
    ...(d.changes ? [plural(d.changes.totals.files, "file")] : []),
  ];
  const explain = (path: string): ActionRef => codeAsk(ctx, `Explain the change to ${path} in "${cut(task, 80)}".`, { projectId });
  const sendChange: ActionRef = {
    kind: "condition", if: { falsy: "change" }, then: toast("Say what to change first"),
    else: job ? call("POST", `/v1/bots/code/jobs/${job.id}/change`, { text: "$state.change" }, {
      assignTo: "changed",
      ok: seq(toast("Sent. I'm on it."), { kind: "navigate", screenId: SCREENS.codeJob, params: { id: "$state.changed.job.id" }, replace: true }),
      fail: toast("Couldn't send that. Try again."),
    }) : toast("Ask on GitHub: this pull request has no job here."),
  };
  const changeBox = { ...col([
    boxedField("change", "What should change?", { multiline: true, size: 15, minHeight: 64, label: "What should change?" }),
    row([button("Send", sendChange, { kind: "secondary", size: "md" }), quietButton("Cancel", { kind: "setState", path: "changing", value: false }, { size: "md" })], { gap: 8 }),
  ], { gap: 10 }), visibleIf: { truthy: "changing" } };
  const canMerge = !!d.pr && d.pr.state === "open" && !working;
  const mergeBtn = canMerge ? primaryButton("Approve and merge", mergeAction(projectId, d.branch, job?.id), { wide: !desk, size: desk ? "md" : "lg" })
    : merged ? secondaryButton("Open on GitHub", openUrl(d.pr!.url), { wide: !desk, size: desk ? "md" : "lg" })
      : working && job ? primaryButton("Watch it work", open(SCREENS.codeJob, { id: job.id }), { wide: !desk, size: desk ? "md" : "lg" })
        : button("Approve and merge", undefined, { kind: "disabled", wide: !desk, size: desk ? "md" : "lg" });
  const askBtn = { ...secondaryButton("Ask for a change", { kind: "setState", path: "changing", value: true }, { wide: !desk, size: desk ? "md" : "lg" }), visibleIf: { falsy: "changing" } };
  const mergingNote = { ...row([statusMark("working", { color: MOSS }), meta("Merging…", { size: 13 })], { gap: 8 }), visibleIf: { truthy: "merging" } };
  const emptyNote = !d.changes ? notice("I couldn't read the changes from GitHub. Try again in a moment.", { mark: "pr" })
    : !files.length ? notice(working ? "Nothing to review yet. The changes show here as I make them." : "Nothing changed on this branch.", { mark: "pr" }) : null;
  const counts = (f: FileChange) => `${f.additions ? `+${f.additions}` : ""}${f.deletions ? ` −${f.deletions}` : ""}`.trim() || "±0";
  const fileHead = (f: FileChange, bar = false) => row([text(f.path, { size: 13, mono: true, weight: 500, lineHeight: 17, lines: 1, style: { flexShrink: 1 } }), grow(), text(counts(f), { size: 12, mono: true, color: C.meta, lineHeight: 16 })],
    { gap: 10, ...(bar ? { paddingHorizontal: 14, height: 33, backgroundColor: ASIDE, borderBottomWidth: 1, borderBottomColor: C.divider } : {}) });
  const why = (f: FileChange) => f.why ?? (f.status === "added" ? "A new file." : f.status === "removed" ? "Removed." : "");

  if (!desk) {
    const [first, ...rest] = files;
    const firstCard = first ? col([
      col([fileHead(first), ...(why(first) ? [text(cut(why(first), 140), { size: 14, lineHeight: 19 })] : [])], { paddingTop: 14, paddingHorizontal: 14, paddingBottom: 10, gap: 4 }),
      ...(first.hunks?.[0] ? [codeLines(first.hunks[0], { max: 8 })] : []),
      row([text("Explain this change", { size: 13, weight: 500, lineHeight: 17 })], { borderTopWidth: 1, borderTopColor: C.divider, paddingVertical: 10, paddingHorizontal: 14 }, explain(first.path)),
    ], { borderWidth: 1, borderColor: C.line, borderRadius: 18, overflow: "hidden" }) : null;
    return page(ctx, {
      nav: "code", title: "Review", state: { change: "", changing: false, merging: false }, gap: 14,
      body: [
        row([backButton(job ? open(SCREENS.codeJob, { id: job.id }) : back()), col([text("Review", { size: 17, weight: 600, lineHeight: 22 }), meta(`${cut(task, 40)} · ${status}`, { lines: 1 })], { gap: 2, flexShrink: 1 })], { gap: 8 }),
        ...(tags.length ? [row(tags.map((t, i) => tag(t, { weight: i === 0 && verify?.ran ? 500 : 400 })), { gap: 6, flexWrap: "wrap" })] : []),
        ...(emptyNote ? [emptyNote] : []),
        ...(firstCard ? [firstCard] : []),
        ...rest.slice(0, 5).map((f) => col([fileHead(f), ...(why(f) ? [text(cut(why(f), 120), { size: 14, lineHeight: 19 })] : [])], { borderWidth: 1, borderColor: C.line, borderRadius: 18, padding: 14, gap: 4 })),
        ...(files.length > 6 ? [meta(`And ${plural(files.length - 6, "more file")}. See them all on GitHub.`)] : []),
      ],
      footer: [mergingNote, mergeBtn, askBtn, changeBox],
    });
  }
  const pairs = files.slice(0, 6).map((f) => row([
    col([fileHead(f, true), ...(f.hunks?.length ? f.hunks.slice(0, 2).map((h) => box([codeLines(h, { numbers: true, size: 12.5, max: 14 })], { paddingVertical: 5 }))
      : [box([meta(f.hunks === null ? "Too big to show here. See it on GitHub." : "Only renamed.", { size: 12 })], { padding: 14 })])],
    { flexGrow: 1, flexBasis: 0, minWidth: 0, borderWidth: 1, borderColor: C.line, borderRadius: 14, overflow: "hidden" }),
    col([
      row([botAvatar(CODE, 20), text("Code bot", { size: 12, weight: 600, lineHeight: 16 }), grow(), ...(f.hunks?.[0] ? [text(hunkRange(f.hunks[0]), { size: 11, mono: true, color: C.meta, lineHeight: 15 })] : [])], { gap: 8 }),
      text(why(f) || "Part of this change.", { size: 13, lineHeight: 18 }),
      text("Explain this change", { size: 12.5, weight: 500, lineHeight: 17, style: { textDecorationLine: "underline" } }),
    ], { width: 292, flexShrink: 0, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, gap: 6 }, explain(f.path)),
  ], { gap: 16, alignItems: "flex-start" }));
  return page(ctx, {
    nav: "code", title: "Review", maxWidth: 1100, gap: 18, state: { change: "", changing: false, merging: false },
    body: [
      head(ctx, {
        title: "Review", sub: meta(`${cut(task, 60)} · ${status}`, { size: 13 }), to: job ? open(SCREENS.codeJob, { id: job.id }) : back(),
        right: [row([...(verify?.ran ? [row([statusMark(verify.ok ? "done" : "failed"), text(cut(firstLine(verify.summary), 40), { size: 13, color: C.grey70, lineHeight: 17 })], { gap: 6 })] : []),
          ...tags.slice(verify?.ran ? 1 : 0).map((t) => text(t, { size: 13, color: C.grey70, lineHeight: 17 }))], { gap: 16 })],
      }),
      ...(emptyNote ? [emptyNote] : [row([box([sectionLabel(`Changes · ${plural(files.length, "file")}`)], { flexGrow: 1 }), box([sectionLabel("Code bot's notes")], { width: 292 })], { gap: 16 }), ...pairs]),
      ...(files.length > 6 ? [meta(`And ${plural(files.length - 6, "more file")}. See them all on GitHub.`)] : []),
    ],
    footer: [row([
      ...(d.pr ? [quietButton("Open on GitHub", openUrl(`${d.pr.url}/files`), { size: "md", icon: "link" })] : []), grow(), mergingNote, askBtn, mergeBtn,
    ], { gap: 12, borderTopWidth: 1, borderTopColor: C.divider, paddingTop: 14 }), changeBox],
  });
}

// ===================================================================== bots.code.pr-care (PRCare / DPRCare)

interface CareData {
  project?: Project; pull?: CarePull; branch: string; pr?: PrStatus; comments: Comment[]; diff?: { commits: unknown[]; totals: { files: number } };
  spentPaise: number; latestJob?: string; careOff: boolean;
}

async function loadCare(ctx: BotsCtx, deps: BotsDeps): Promise<CareData | undefined> {
  const pid = str(ctx.params.project);
  const n = Number(ctx.params.pr);
  if (!pid) return undefined;
  let careOff = false;
  const pulls = await deps.api<{ pulls: CarePull[] }>("GET", `/v1/code/projects/${pid}/care`).then((r) => r.pulls).catch(() => { careOff = true; return [] as CarePull[]; });
  const pull = pulls.find((p) => p.prNumber === n) ?? (n ? undefined : pulls[0]);
  const branch = pull?.branch ?? str(ctx.params.branch);
  if (!branch) return { branch: "", comments: [], spentPaise: 0, careOff, project: await get<{ project: Project }>(deps, `/v1/code/projects/${pid}`).then((r) => r?.project) };
  const enc = encodeURIComponent(branch);
  const [project, pr, comments, diff, jobs] = await Promise.all([
    get<{ project: Project }>(deps, `/v1/code/projects/${pid}`).then((r) => r?.project),
    get<PrStatus>(deps, `/v1/code/projects/${pid}/branches/${enc}/pr`),
    get<{ comments: Comment[] }>(deps, `/v1/code/projects/${pid}/branches/${enc}/pr/comments`).then((r) => r?.comments ?? []),
    get<CareData["diff"]>(deps, `/v1/code/projects/${pid}/branches/${enc}/diff`),
    get<{ jobs: Job[] }>(deps, "/v1/code/jobs").then((r) => (r?.jobs ?? []).filter((j) => j.projectId === pid && j.branch === branch)),
  ]);
  const latest = [...(jobs ?? [])].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return { project, pull, branch, pr, comments: comments ?? [], diff, spentPaise: (jobs ?? []).reduce((s, j) => s + j.spentPaise, 0), ...(latest ? { latestJob: latest.id } : {}), careOff };
}

/** What the checks' outcome reads as, and its mark. */
function checksState(c: CarePull["checks"]): { mark: Mark; word: string } {
  switch (c?.outcome) {
    case "green": return { mark: "done", word: c.names.length ? `${c.names.length} of ${c.names.length} pass` : "All pass" };
    case "pending": return { mark: "waiting", word: "Running" };
    case "fixing": return { mark: "working", word: "Fixing one" };
    case "also_red": return { mark: "needs", word: "Failing on main too" };
    case "infra": return { mark: "waiting", word: "CI trouble, not your code" };
    case "capped": return { mark: "needs", word: "Stopped after 3 tries today" };
    case "unfixed": return { mark: "failed", word: "Couldn't fix it" };
    case "blind": return { mark: "waiting", word: "Can't see them" };
    default: return { mark: "waiting", word: "Not run yet" };
  }
}

function prCare(ctx: BotsCtx, d: CareData | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  if (!d?.project) return unreachable(ctx, "that pull request");
  const p = d.project;
  const name = short(p.fullName);
  const n = d.pull?.prNumber ?? d.pr?.number ?? (Number(ctx.params.pr) || 0);
  if (!d.branch || (!d.pull && !d.pr)) {
    return page(ctx, {
      back: true, nav: "code", title: `PR #${n}`,
      body: [emptyState({ pose: "think", title: n ? `I'm not looking after PR #${n}` : "No pull request here", body: d.careOff ? "Looking after pull requests isn't switched on here yet." : "It may be closed, or not one of mine.", action: { label: `Back to ${name}`, onPress: open(SCREENS.code, { project: p.id }) } })],
    });
  }
  const pull = d.pull;
  const prTitle = pull?.title ?? d.pr?.title ?? d.branch;
  const checks = checksState(pull?.checks ?? null);
  const authors = [...new Set(d.comments.map((c) => c.author).filter((a) => !/\[bot\]$|tailzu/i.test(a)))];
  const conflict = pull?.conflict?.outcome === "fixing" ? { mark: "working" as Mark, word: "Fixing" } : pull?.conflict?.outcome === "asked" ? { mark: "needs" as Mark, word: "Needs you" }
    : d.pr?.mergeable === false ? { mark: "needs" as Mark, word: "Yes" } : { mark: "done" as Mark, word: "None" };
  const open_ = d.pr?.state === "open";
  const ready = open_ && checks.mark === "done" && conflict.mark === "done" && !pull?.waiting && !(pull?.working.length);
  const tags = [
    ...(d.diff ? [plural(d.diff.commits.length, "commit"), plural(d.diff.totals.files, "file")] : []),
  ];
  const fixNote = pull?.checks && ["fixing", "unfixed", "capped", "also_red", "infra"].includes(pull.checks.outcome) && pull.checks.note ? pull.checks.note : "";
  const notes = (pull?.notes ?? []).slice(-7);
  const timeline = col([
    ...notes.map((x) => row([
      box([text(clock(x.at, ctx.tzOffsetMinutes), { size: 11.5, mono: true, color: C.meta, lineHeight: 16 })], { width: desk ? 38 : 36 }),
      box([statusMark("done")], { width: 12, height: 16, alignItems: "center", justifyContent: "center" }),
      text(cut(x.text, 90), { size: 13, lineHeight: 17, style: { flexShrink: 1 } }),
    ], { gap: 10, alignItems: "flex-start" })),
    ...(ready ? [row([box([text("now", { size: 11.5, mono: true, color: C.meta, lineHeight: 16 })], { width: desk ? 38 : 36 }), box([statusMark("needs")], { width: 12, height: 16, alignItems: "center", justifyContent: "center" }), text("Waiting for you to merge", { size: 13, weight: 600, lineHeight: 17 })], { gap: 10 })] : []),
    ...(!notes.length && !ready ? [meta("Nothing yet. I note here everything I do on it.", { size: 13 })] : []),
  ], { gap: desk ? 10 : 9 });
  const waitRow = pull?.waiting ? row([statusMark("needs"), text(cut(pull.waiting.text, 90), { size: 14, lineHeight: 19, style: { flexShrink: 1 } }), grow(), icon("chevron", { size: 16, color: C.meta })], { gap: 10, borderWidth: 1, borderColor: C.ink, borderRadius: 14, padding: 12 }, open(SCREENS.codeJob, { id: pull.waiting.jobId })) : null;
  const merge = ready ? primaryButton("Merge", mergeAction(p.id, d.branch), { wide: true }) : button(d.pr?.state === "merged" ? "Merged" : "Merge", undefined, { kind: "disabled", wide: true });
  const seeChanges = row([text("See the changes first", { size: 14, weight: 500, lineHeight: 19 })], { minHeight: desk ? 40 : 44, justifyContent: "center" }, d.latestJob ? open(SCREENS.codeReview, { id: d.latestJob }) : open(SCREENS.codeReview, { project: p.id, branch: d.branch }));
  const readyWord = d.pr?.state === "merged" ? "Merged" : d.pr?.state === "closed" ? "Closed" : ready ? "Ready to merge" : pull?.waiting ? "Needs you first" : "Not ready yet";
  const release = pull ? quietButton("Stop looking after it", call("DELETE", `/v1/code/projects/${p.id}/care/${n}`, undefined, { ok: seq(toast("I've stopped looking after it."), REFRESH), fail: toast("Couldn't do that. Try again.") }), { size: "md" }) : null;
  const statusRows = [
    { mark: checks.mark, label: "Checks", value: checks.word, extra: fixNote },
    { mark: authors.length || d.comments.length ? "done" as Mark : "waiting" as Mark, label: "Review comments", sub: authors.length ? authors.slice(0, 3).join(" and ") : undefined, value: d.comments.length ? plural(d.comments.length, "comment") : "None yet" },
    { mark: conflict.mark, label: `Conflicts with ${p.defaultBranch}`, value: conflict.word },
  ];

  if (!desk) {
    return page(ctx, {
      nav: "code", title: `PR #${n}`, state: { merging: false }, gap: 14,
      body: [
        head(ctx, { title: `PR #${n}`, sub: subLine([`${cut(prTitle, 30)} ·`, { code: name }]), right: [botAvatar(CODE, 30)] }),
        ...(tags.length ? [row(tags.map((t) => tag(t)), { gap: 6, flexWrap: "wrap" })] : []),
        ...(waitRow ? [waitRow] : []),
        col(statusRows.map((r, i) => col([
          row([box([statusMark(r.mark, { color: MOSS })], { width: 16 }), col([text(r.label, { size: 14, lineHeight: 19 }), ...(r.sub ? [meta(r.sub)] : [])], { gap: 2, flexGrow: 1, flexShrink: 1 }), text(r.value, { size: 13, color: C.meta, lineHeight: 17 })], { gap: 10 }),
          ...(r.extra ? [box([text(cut(r.extra, 160), { size: 13, lineHeight: 18 })], { backgroundColor: C.surface, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 })] : []),
        ], { gap: 10, paddingVertical: 14, paddingHorizontal: 16, ...(i < statusRows.length - 1 ? { borderBottomWidth: 1, borderBottomColor: C.divider } : {}) })), { borderWidth: 1, borderColor: C.line, borderRadius: 18 }),
        col([sectionLabel("What Code bot did"), timeline], { gap: 10 }),
      ],
      footer: [
        { ...row([statusMark("working", { color: MOSS }), meta("Merging…", { size: 13 })], { gap: 8 }), visibleIf: { truthy: "merging" } },
        row([statusMark(ready ? "needs" : "waiting"), text(readyWord, { size: 15, weight: 600, lineHeight: 20 }), grow(), meta("I never merge on my own")], { gap: 10 }),
        merge, seeChanges, ...(release ? [release] : []),
      ],
    });
  }
  const initials = (a: string) => a.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  const threads = d.comments.slice(0, 6);
  const resp = page(ctx, {
    nav: "code", title: `PR #${n}`, state: { merging: false }, gap: 18,
    body: [
      head(ctx, { title: `PR #${n}`, sub: subLine([`${cut(prTitle, 50)} ·`, { code: name }, `· ${pull?.origin === "handed" ? "handed to Code bot" : "opened by Code bot"}`], 13), to: open(SCREENS.code, { project: p.id }),
        right: tags.length ? [row(tags.map((t) => tag(t)), { gap: 6 })] : [] }),
      meta(`Code bot keeps the PR green until you merge${fixNote ? "" : "."}`, { size: 12 }),
      ...(waitRow ? [waitRow] : []),
      col([
        row([sectionLabel("Checks"), grow(), meta(checks.word, { size: 13 })]),
        col([
          ...(pull?.checks?.names.length ? pull.checks.names.slice(0, 6) : ["checks"]).map((nm, i, a) => row([
            box([statusMark(checks.mark, { color: MOSS })], { width: 12 }), box([text(nm, { size: 12.5, mono: true, lineHeight: 17, lines: 1 })], { flexGrow: 1, flexBasis: 0, minWidth: 0 }),
          ], { gap: 12, paddingVertical: 11, paddingHorizontal: 16, ...(i < a.length - 1 ? { borderBottomWidth: 1, borderBottomColor: C.divider } : {}) })),
          ...(fixNote ? [row([botAvatar(CODE, 22), text(cut(fixNote, 200), { size: 13, lineHeight: 18, style: { flexShrink: 1 } })], { gap: 12, backgroundColor: C.surface, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, margin: 12 })] : []),
        ], { borderWidth: 1, borderColor: C.line, borderRadius: 18 }),
      ], { gap: 8 }),
      col([
        row([sectionLabel("Review threads"), grow(), meta(authors.length ? `${authors.slice(0, 3).join(" and ")} · ${plural(d.comments.length, "comment")}` : "None yet", { size: 13 })]),
        threads.length ? col(threads.map((c, i) => row([
          box([text(initials(c.author), { size: 12, weight: 600, lineHeight: 16 })], { width: 28, height: 28, borderRadius: 14, backgroundColor: C.track, alignItems: "center", justifyContent: "center", flexShrink: 0 }),
          col([
            row([text(c.author, { size: 13, weight: 600, lineHeight: 17 }), meta(`· ${clock(c.createdAt, ctx.tzOffsetMinutes)}${c.path ? " · on" : ""}`, { size: 13 }), ...(c.path ? [text(cut(c.path, 40), { size: 11.5, mono: true, color: C.meta, lineHeight: 16 })] : [])], { gap: 4, flexWrap: "wrap" }),
            text(cut(c.body, 240), { size: 14, lineHeight: 19 }),
          ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
        ], { gap: 10, paddingVertical: 13, paddingHorizontal: 16, alignItems: "flex-start", ...(i < threads.length - 1 ? { borderBottomWidth: 1, borderBottomColor: C.divider } : {}) })), { borderWidth: 1, borderColor: C.line, borderRadius: 18 })
          : meta("No comments on it yet.", { size: 13 }),
      ], { gap: 8 }),
    ],
  });
  return withAside(resp, [
    col([
      row([statusMark(ready ? "needs" : "waiting"), text(readyWord, { size: 17, weight: 600, lineHeight: 22 })], { gap: 8 }),
      col(statusRows.map((r) => row([statusMark(r.mark, { color: MOSS }), text(`${r.label}: ${r.value}`, { size: 13, color: C.grey70, lineHeight: 17, style: { flexShrink: 1 } })], { gap: 8 })), { gap: 7 }),
      merge,
      { ...row([statusMark("working", { color: MOSS }), meta("Merging…", { size: 13 })], { gap: 8 }), visibleIf: { truthy: "merging" } },
      seeChanges,
      row([botAvatar(CODE, 20), meta("I never merge on my own. You press Merge.", { size: 12 })], { gap: 8, borderTopWidth: 1, borderTopColor: C.divider, paddingTop: 12 }),
    ], { borderWidth: 1.5, borderColor: C.ink, borderRadius: 18, padding: 16, gap: 12, backgroundColor: C.paper }),
    col([sectionLabel("What Code bot did"), timeline], { gap: 10 }),
    grow(),
    ...(release ? [release] : []),
  ], 360);
}

// ===================================================================== the list

export const codeScreens: BotsScreen[] = [
  screen<HomeData>({ id: SCREENS.code, load: loadHome, build: codeHome }),
  screen<StartData>({ id: SCREENS.codeStart, load: loadStart, build: start }),
  screen<NewData | undefined>({ id: SCREENS.newProject, load: loadNew, build: newProject }),
  screen<PlanData | undefined>({ id: SCREENS.codePlan, load: loadPlan, build: codePlan }),
  screen<RulesView | undefined>({ id: SCREENS.projectRules, load: loadRules, build: projectRules }),
  screen<ReviewData | undefined>({ id: SCREENS.codeReview, load: loadReview, build: codeReview }),
  screen<CareData | undefined>({ id: SCREENS.prCare, load: loadCare, build: prCare }),
];
