/**
 * What several of the Code bot at work's screens share.
 */

import { createHash } from "node:crypto";
import type { Node, ActionSpec, ActionRef } from "../../../../../../shared/types/sdui.js";
import {
  type WorkLine, type JobRow, minutesBetween, type JobRead, type WorkEntry, type ProjectRow, type AgentView, isOver, workLines, stepLines,
  isUuid, plainWords, citations, changedFiles, testsPassed, projectName,
} from "../../../../botsCodeWork/read.js";
import { SENT_WORDS, start, streamed, failed } from "../../askMoment.js";
import {
  botLook, C, call, seq, labelled, box, icon, back, row, botAvatar, col, text, statusMark, type Mark, duration, FACE, type BotsCtx, open,
  SCREENS, meta, RADIUS, page, emptyState, button, shapes, mono, blip, card, divider, sectionLabel, grow,
} from "../../kit.js";

export const CODE = botLook("code");
export const MOSS = CODE.color;
export const ASIDE = "#fafafa";

// ===================================================================== small parts

/** A line icon from a path of our own (the kit's ICONS has no picture, file, copy, eye). */
export function glyph(d: string, o: { size?: number; color?: string; weight?: number } = {}): Node {
  const size = o.size ?? 20;
  return {
    type: "SVG",
    props: { viewBox: "0 0 24 24", d, fill: "none", stroke: o.color ?? C.ink, strokeWidth: o.weight ?? 1.9, strokeLinecap: "round", strokeLinejoin: "round" },
    style: { width: size, height: size, flexShrink: 0 },
  };
}
export const G = {
  eye: "M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z",
  arrow: "M5 12h14M13 6l6 6-6 6",
  copy: "M9 9h10.5v10.5H9zM15 9V4.5H4.5V15H9",
  file: "M7 3.5h7l4.5 4.5V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5zM14 3.5V8h4.5",
  image: "M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5zM3.5 16l5-5 4 4 3-3 5 5M15.5 8.5h.01",
  video: "M4 6.5h11a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 16V8A1.5 1.5 0 0 1 4 6.5zM16.5 10.5l5-3v9l-5-3",
  refresh: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.2h-4.2",
  shot: "M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5M9.7 8.5h4.6a1.2 1.2 0 0 1 1.2 1.2v4.6a1.2 1.2 0 0 1-1.2 1.2H9.7a1.2 1.2 0 0 1-1.2-1.2V9.7a1.2 1.2 0 0 1 1.2-1.2z",
  recording: "M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 21h8M12 9.6a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8z",
  failed: "M8 8l8 8M16 8l-8 8",
};

export const toast = (message: string): ActionSpec => ({ kind: "toast", message });
export const oops = (message = "Couldn't do that. Try again."): ActionSpec => ({ kind: "toast", message, tone: "error" });
export const refresh: ActionSpec = { kind: "refresh" };

/** A write the person asked for: the call, then a short ink toast and the screen read again; a plain-words toast if it failed. */
export function write(method: "POST" | "PUT" | "DELETE", path: string, body: Record<string, unknown>, ok: string, fail?: string, then?: ActionRef): ActionSpec {
  return call(method, path, body, { ok: seq(toast(ok), then ?? refresh), fail: oops(fail) });
}

/** A 44 x 44 back chevron (pulled 10 left), as the boards draw it. */
export const backButton = (to?: ActionRef): Node =>
  labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center", flexShrink: 0 }, to ?? back()), "Back");

/** A screen's head: back, an optional avatar, a title over a line, something on the right. */
export function head(o: { title: string; size?: number; weight?: 600 | 700; sub?: Node; avatar?: boolean; right?: Node; back?: ActionRef }): Node {
  return row([
    backButton(o.back),
    ...(o.avatar ? [botAvatar(CODE, 36)] : []),
    col([
      text(o.title, { size: o.size ?? 18, weight: o.weight ?? 600, lineHeight: Math.round((o.size ?? 18) * 1.3), lines: 2, tracking: (o.size ?? 18) >= 24 ? -0.5 : -0.2 }),
      ...(o.sub ? [o.sub] : []),
    ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 }),
    ...(o.right ? [o.right] : []),
  ], { gap: 10, alignItems: "center" });
}

/** A pill that fills its share of a row (the boards' paired outline buttons). */
export function half(label: string, onPress: ActionRef, o: { icon?: Node; kind?: "primary" | "secondary" | "quiet"; height?: number; size?: number } = {}): Node {
  const h = o.height ?? 48;
  const kind = o.kind ?? "secondary";
  const fg = kind === "primary" ? C.paper : kind === "quiet" ? C.grey70 : C.ink;
  return row([
    ...(o.icon ? [o.icon] : []),
    text(label, { size: o.size ?? 15, weight: kind === "primary" ? 600 : 500, color: fg, lineHeight: 20, lines: 1 }),
  ], {
    flexGrow: 1, flexBasis: 0, minWidth: 0, height: h, borderRadius: h / 2, gap: 8, justifyContent: "center", paddingHorizontal: 14,
    backgroundColor: kind === "primary" ? C.ink : kind === "quiet" ? "transparent" : C.paper,
    ...(kind === "secondary" ? { borderWidth: 1, borderColor: C.outline } : {}),
  }, onPress);
}

/** An outline chip of mono text (a file:line, a branch). */
const codeChip = (s: string): Node => box([text(s, { size: 12, mono: true, lineHeight: 16, lines: 1 })], { backgroundColor: C.surface, borderRadius: 10, paddingVertical: 5, paddingHorizontal: 10, alignSelf: "flex-start", maxWidth: "100%" });

/** The mark before a line of work: a check for what happened, a breathing dot for now, a dashed ring for what it waits on. */
export function workMark(m: WorkLine["mark"], size: number): Node {
  if (m === "done") return icon("check", { size, color: C.ink, weight: 2 });
  return box([statusMark(m === "working" ? "working" : "waiting", { color: MOSS })], { width: size, height: size, alignItems: "center", justifyContent: "center", flexShrink: 0 });
}

/** The status of a job, in a few words, its mark and its colour. */
function statusOf(job: JobRow, now: number): { mark: Mark; words: string; color: string } {
  const min = duration(minutesBetween(job.createdAt, now));
  const took = duration(Math.max(1, minutesBetween(job.createdAt, job.updatedAt)));
  switch (job.state) {
    case "queued": return { mark: "working", words: "Starting", color: MOSS };
    case "running": return { mark: "working", words: `Working · ${min}`, color: MOSS };
    case "waiting_for_compute": return { mark: "waiting", words: "Waiting for a computer", color: C.ink };
    case "waiting_for_you": return { mark: "needs", words: "Needs you", color: C.ink };
    case "paused": return { mark: "waiting", words: "Paused", color: C.ink };
    case "done": return { mark: "done", words: `Done · ${took}`, color: C.ink };
    case "failed": return { mark: "failed", words: "Couldn't finish", color: C.ink };
    default: return { mark: "failed", words: "Stopped", color: C.ink };
  }
}

/** The status line under a title; a tap reads the job again. */
export function statusLine(job: JobRow, now: number, size = 13, extra = ""): Node {
  const s = statusOf(job, now);
  return labelled(row([
    statusMark(s.mark, { color: s.color }),
    text(s.words + extra, { size, weight: 500, color: s.color, lineHeight: size + 4, lines: 1, style: { flexShrink: 1 } }),
  ], { gap: 7 }, refresh), `${s.words}. Tap to refresh.`);
}

export const jobPath = (id: string, tail = ""): string => `/v1/code/jobs/${id}${tail}`;

/** Stop: the agent's stop for an agent job, the router's cancel otherwise. */
export const stopJob = (job: JobRow): ActionSpec =>
  write("POST", jobPath(job.id, job.agent ? "/stop" : "/cancel"), {}, "Stopped. Nothing more is used.", "Couldn't stop it. Try again.");

// ===================================================================== reading a job

export interface JobData extends JobRead {
  log: WorkEntry[];
  project?: ProjectRow;
}

/** What the job is waiting on, as one line (the last line of "what it did"). */
function waitingWords(job: JobRow, agent?: AgentView): string | undefined {
  if (job.state !== "waiting_for_you") return job.state === "waiting_for_compute" ? "Waiting for a computer" : undefined;
  switch (job.waitingOn) {
    case "answer": return "Waiting for your answer";
    case "approval": return "Waiting for your yes";
    case "budget": return "Waiting for your yes to keep going";
    case "paid": return "Waiting for your yes to paid compute";
    case "commit": return "Waiting for your yes to commit";
    default: return agent?.waiting ? "Waiting for you" : undefined;
  }
}

export function linesOf(d: JobData, max: number): WorkLine[] {
  const waiting = waitingWords(d.job, d.agent);
  const working = !waiting && !isOver(d.job.state) ? phaseWords(d.agent?.phase) : undefined;
  if (d.log.length) return workLines(d.log, { max, ...(waiting ? { waiting } : {}), ...(working ? { working } : {}) });
  const steps = stepLines(d.steps).slice(-(max - (waiting ? 1 : 0)));
  return waiting ? [...steps, { mark: "waiting", text: waiting }] : steps;
}

function phaseWords(phase?: string): string | undefined {
  switch (phase) {
    case "prepare": case "baseline": return "Reading the project";
    case "locate": return "Finding where it goes";
    case "plan": case "split": return "Planning the change";
    case "work": return "Changing the code";
    case "team": return "Helpers are building the parts";
    case "verify": return "Running the checks";
    case "design": return "Comparing with your design";
    case "commit": case "pr": return "Opening the pull request";
    case "report": return "Writing up what it did";
    default: return undefined;
  }
}

/** A text box with send: the field writes `path`, return / Enter and the round button run `onSubmit`. */
export function field(path: string, placeholder: string, onSubmit: ActionRef, o: { compact?: boolean; left?: Node; ink?: boolean; radius?: number } = {}): Node {
  const h = o.compact ? 40 : 44;
  return row([
    ...(o.left ? [o.left] : []),
    {
      type: "TextField", id: path, bind: { value: path },
      props: {
        placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0,
        minHeight: h, returnKeyType: "send", color: C.ink,
      },
      on: { onSubmit },
      style: {
        flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: h, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.regular,
        fontSize: o.compact ? 14 : 15, color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
      },
    },
    labelled(box([icon("send", { size: 18, color: C.paper })], {
      width: h, height: h, borderRadius: h / 2, backgroundColor: C.ink, alignItems: "center", justifyContent: "center", flexShrink: 0,
    }, onSubmit), "Send"),
  ], {
    gap: 10, borderRadius: o.radius ?? 24, borderWidth: o.ink ? 1.5 : 1, borderColor: o.ink ? C.ink : C.line, paddingVertical: 4, paddingRight: 4, paddingLeft: 16, backgroundColor: C.paper,
  });
}

// ===================================================================== the chat (Chat.dc.html, DeskWork's chat pane)

/** The thread of a project's chat when no job names it: one per person and project, made the same way every time. */
export function threadFor(userId: string, projectId: string): string {
  const h = createHash("sha256").update(`tailzu:code-chat:${userId}:${projectId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface ChatCtx { projectId: string; threadId: string; jobId?: string; projectName: string }

/**
 * Ask Xode about the project (the front door with projectId and threadId: code/chat answers with path:line, or
 * "ok, change it" starts a job). An answer opens the chat with it; a job that started opens the job.
 */
export function askCode(ctx: BotsCtx, c: ChatCtx, message: string, o: { from?: string; attachments?: string } = {}): ActionRef {
  // The words go up as the person's bubble and the box clears at once (askMoment.ts); the call sends them from there.
  const said = SENT_WORDS;
  const carry = { project: c.projectId, thread: c.threadId, ...(c.jobId ? { id: c.jobId } : {}), ...(c.jobId && isUuid(ctx.params.from) ? { from: ctx.params.from } : {}) };
  return seq(
    ...start({ message, busy: "asking", ...(o.from ? { from: o.from } : {}) }),
    streamed(ctx, call("POST", "/v1/ask", {
      message: said, projectId: c.projectId, threadId: c.threadId, device: ctx.client, mode: "text",
      ...(o.attachments ? { attachments: o.attachments } : {}),
    }, {
      assignTo: "said",
      ok: seq(
        { kind: "setState", path: "asking", value: false },
        {
          kind: "condition", if: { truthy: "said.result.job.id" },
          // A question that became a job keeps the chat it was asked in, above the job.
          then: open(SCREENS.codeJob, { id: "$state.said.result.job.id", ...(c.jobId ? {} : { from: c.threadId }) }),
          else: open(SCREENS.codeJob, { ...carry, asked: said, answer: "$state.said.result.text", flow: "$state.said.result.artifacts.0.id" }),
        },
      ),
      fail: failed({ busy: "asking", ...(o.from ? { from: o.from } : {}), then: oops("Couldn't reach Xode. Try again.") }),
    })),
  );
}

/** The person's words: an ink bubble on the right. */
export function mine(s: string, size = 15): Node {
  return row([box([text(s, { size, color: C.paper, lineHeight: Math.round(size * 1.4) })], {
    backgroundColor: C.ink, borderRadius: 20, borderBottomRightRadius: 6, paddingVertical: 11, paddingHorizontal: 16, maxWidth: "86%",
  })], { justifyContent: "flex-end" });
}

/** Xode's words: paragraphs, code in mono, the flow it drew, and the files and lines it rests on. */
export function theirs(s: string, o: { flow?: string[]; size?: number } = {}): Node {
  const size = o.size ?? 15;
  const blocks = plainWords(s);
  const cites = citations(s);
  return col([
    ...blocks.map((b) => b.kind === "code"
      ? box([text(b.text, { size: 12, mono: true, lineHeight: 18 })], { backgroundColor: C.surface, borderRadius: 12, padding: 12 })
      : b.kind === "head"
        ? text(b.text, { size, weight: 600, lineHeight: Math.round(size * 1.35), color: C.ink })
        : text(b.text, { size, lineHeight: Math.round(size * 1.45), color: C.ink })),
    ...(o.flow && o.flow.length >= 2 ? [flowCard(o.flow)] : []),
    ...(cites.length ? [row(cites.map(codeChip), { gap: 6, flexWrap: "wrap" })] : []),
  ], { gap: 10 });
}

/** A flow the chat drew from the import graph: boxes and arrows, the one the question is about in ink. */
function flowCard(boxes: string[]): Node {
  const chipOf = (label: string, i: number) => box([text(label, { size: 13, lineHeight: 17, color: i === Math.floor(boxes.length / 2) ? C.paper : C.ink, lines: 1 })], {
    borderWidth: 1, borderColor: C.ink, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10,
    backgroundColor: i === Math.floor(boxes.length / 2) ? C.ink : C.paper, maxWidth: "100%",
  });
  const items: Node[] = [];
  boxes.forEach((b, i) => { if (i) items.push(glyph(G.arrow, { size: 14, color: C.meta })); items.push(chipOf(b, i)); });
  return col([
    row(items, { gap: 6, flexWrap: "wrap", alignItems: "center" }),
    meta("I drew this because a flow is quicker to see than read.", { size: 12 }),
  ], { gap: 10, borderWidth: 1, borderColor: C.line, borderRadius: RADIUS.card, padding: 14 });
}

export function noProject(ctx: BotsCtx) {
  return page(ctx, {
    back: true, nav: "code", title: "Xode",
    body: [emptyState({ pose: "think", title: "Which project?", body: "Open a project first, then ask about its code or tell Xode what to change.", action: { label: "Your projects", onPress: open(SCREENS.code) } })],
  });
}

// ===================================================================== bots.code.job: watch it work

export function nothingHere(ctx: BotsCtx, what: string, body = "It may have been removed, or it's someone else's. Your other jobs are on Xode's page.") {
  return page(ctx, {
    back: true, nav: "code", title: what,
    body: [emptyState({ pose: "think", title: `Couldn't open this ${what.toLowerCase()}`, body, action: { label: "Go to Xode", onPress: open(SCREENS.code) } })],
  });
}

// ===================================================================== bots.done
export interface DoneData { job: JobData; shippedThisWeek: number }

function numberTile(value: string, label: string, sub?: string, size = 20, center = false): Node {
  return col([
    text(value, { size, weight: size > 20 ? 700 : 600, lineHeight: Math.round(size * 1.25), tracking: -0.3 }),
    text(label, { size: size > 20 ? 13 : 11, color: size > 20 ? C.grey70 : C.meta, lineHeight: size > 20 ? 17 : 14 }),
    ...(sub ? [meta(sub, { size: 11.5 })] : []),
  ], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 2, ...(center ? { alignItems: "center" } : {}) });
}

function doneNumbers(d: JobData): Array<{ value: string; label: string; sub?: string }> {
  const files = changedFiles(d.log, d.agent?.staged ?? []).length;
  const tests = testsPassed(d.agent, d.log);
  const mins = minutesBetween(d.job.createdAt, d.job.updatedAt);
  const out: Array<{ value: string; label: string; sub?: string }> = [];
  if (files) out.push({ value: String(files), label: files === 1 ? "file changed" : "files changed" });
  if (tests) out.push({ value: String(tests.pass), label: "tests pass", ...(tests.total && tests.total !== tests.pass ? { sub: `of ${tests.total}` } : {}) });
  else if (d.agent?.verify?.ran) out.push({ value: d.agent.verify.ok ? "All" : "Some", label: d.agent.verify.ok ? "checks pass" : "checks fail" });
  out.push({ value: mins < 60 ? `${Math.max(1, mins)}m` : duration(mins), label: "start to end" });
  return out;
}

function shippedLine(d: JobData): string {
  const pr = d.agent?.pr;
  const checks = d.agent?.verify?.ran ? (d.agent.verify.ok ? " · all checks pass" : " · some checks fail") : "";
  if (pr) return `PR #${pr.number} is ${pr.ready ? "ready" : "a draft"}${checks}`;
  if (d.agent?.report?.outcome === "answer") return "Answered. Nothing in the code was changed.";
  if (d.agent?.commits.length) return `Committed to ${d.job.branch}${checks}`;
  return `Finished on ${d.job.branch}`;
}

function weekBeads(n: number, words: string): Node {
  return row([
    row(Array.from({ length: Math.min(n, 6) }, () => box([], { width: 8, height: 8, borderRadius: 4, backgroundColor: C.ink })), { gap: 4 }),
    text(words, { size: 13, color: C.grey70, lineHeight: 17 }),
  ], { gap: 10 });
}

function doneButtons(d: JobData, md: boolean): Node[] {
  const pr = d.agent?.pr;
  const answer = d.agent?.report?.outcome === "answer";
  const first = pr ? button("Review the PR", { kind: "openUrl", url: pr.url, external: true }, { kind: "primary", wide: !md, size: md ? "md" : "lg" })
    : answer ? button("Ask a follow-up", open(SCREENS.codeJob, { id: d.job.id }), { kind: "primary", wide: !md, size: md ? "md" : "lg" })
      : button("See the work", open(SCREENS.codeJob, { id: d.job.id }), { kind: "primary", wide: !md, size: md ? "md" : "lg" });
  return [first, button("Start the next job", open(SCREENS.codeStart), { kind: "secondary", wide: !md, size: md ? "md" : "lg" })];
}

function noteBox(d: JobData): Node | null {
  const note = d.agent?.notes[0] ?? d.agent?.findings.find((f) => f.severity !== "info")?.text;
  if (!note) return null;
  return row([icon("spark", { size: 18, color: C.grey70 }), text(note, { size: 13, color: C.grey70, lineHeight: 18, style: { flexShrink: 1 } })], { gap: 10, alignItems: "flex-start", backgroundColor: C.surface, borderRadius: 16, padding: 14 });
}

/** The quiet moment: the Tailzu mark with a few dots in Xode's colour around it (Done.dc.html). */
const doneMark = (size: number): Node => shapes([
  ...([[17, 4, 2], [26, 7, 2], [30, 16, 2], [27, 25, 2], [17, 30, 2], [7, 25, 2], [4, 16, 2], [8, 7, 2], [13, 15, 2.6], [21, 15, 2.6]] as Array<[number, number, number]>)
    .map(([x, y, r]) => ({ circle: [x + 8, y + 8, r] as [number, number, number], fill: C.ink, motion: "pop" as const })),
  ...([[3, 10], [47, 8], [2, 36], [48, 38], [12, 49], [40, 2]] as Array<[number, number]>).map(([x, y]) => ({ circle: [x, y, 1.6] as [number, number, number], fill: MOSS, motion: "pop" as const })),
], { size, viewBox: "0 0 50 50", label: "Done" });

export function donePhone(ctx: BotsCtx, d: DoneData) {
  const j = d.job;
  const nums = doneNumbers(j).slice(0, 4);
  const note = noteBox(j);
  const answer = j.agent?.report?.outcome === "answer";
  return page(ctx, {
    nav: "code", title: answer ? "Answered" : "Shipped", gap: 24,
    body: [
      row([backButton(), text(j.job.task, { size: 15, color: C.meta, lineHeight: 20, lines: 1, style: { flexShrink: 1 } })], { gap: 4 }),
      col([
        doneMark(96),
        text(answer ? "Answered." : "Shipped.", { size: 34, weight: 700, tracking: -0.8, lineHeight: 40, align: "center" }),
        row([box([], { width: 10, height: 10, borderRadius: 5, backgroundColor: MOSS }), text(shippedLine(j), { size: 15, lineHeight: 20, style: { flexShrink: 1 } })], { gap: 8 }),
      ], { gap: 12, paddingTop: 8, alignItems: "center" }),
      ...(answer && j.agent?.report?.text ? [theirs(j.agent.report.text, { size: 14 })] : [row(nums.map((n) => numberTile(n.value, n.label.replace(/ changed$/, ""), undefined, 20, true)), { gap: 8 })]),
      ...(note ? [note] : []),
    ],
    footer: [...doneButtons(j, false), ...(d.shippedThisWeek ? [weekBeads(d.shippedThisWeek, `${d.shippedThisWeek} shipped this week`)] : [])],
  });
}

export function doneDesk(ctx: BotsCtx, d: DoneData) {
  const j = d.job;
  const nums = doneNumbers(j);
  const files = changedFiles(j.log, j.agent?.staged ?? []).slice(0, 6);
  const note = noteBox(j);
  const answer = j.agent?.report?.outcome === "answer";
  return page(ctx, {
    nav: "code", title: answer ? "Answered" : "Shipped", gap: 26, maxWidth: 1040,
    body: [
      row([backButton(), text(`${j.job.task} · `, { size: 15, color: C.meta, lineHeight: 20, lines: 1, style: { flexShrink: 1 } }), mono(projectName(j.project), { size: 13 })], { gap: 4 }),
      row([
        blip("done", 150),
        col([
          text(answer ? "Answered." : "Shipped.", { size: 44, weight: 700, tracking: -1, lineHeight: 50 }),
          row([box([], { width: 10, height: 10, borderRadius: 5, backgroundColor: MOSS }), text(shippedLine(j), { size: 16, lineHeight: 21 })], { gap: 8 }),
          row(doneButtons(j, true), { gap: 10, paddingTop: 6 }),
        ], { gap: 10, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
        ...(d.shippedThisWeek ? [col([weekBeads(d.shippedThisWeek, `${d.shippedThisWeek} shipped this week`)], { alignSelf: "flex-end" })] : []),
      ], { gap: 28, alignItems: "center" }),
      ...(answer && j.agent?.report?.text ? [card([theirs(j.agent.report.text)], { padding: 20 })]
        : [labelled(row(nums.flatMap((n, i) => [...(i ? [divider({ vertical: true })] : []), box([numberTile(n.value, n.label, n.sub, 24)], { flexGrow: 1, flexBasis: 0, paddingVertical: 18, paddingHorizontal: 20 })]),
          { borderWidth: 1, borderColor: C.line, borderRadius: 18, alignItems: "stretch" }), "By the numbers")]),
      ...(files.length || note ? [col([
        sectionLabel("What changed"),
        ...(files.length ? [col(files.flatMap((f, i) => [...(i ? [divider()] : []), col([
          row([text(f.path, { size: 12.5, mono: true, weight: i === 0 ? 500 : 400, lineHeight: 17, lines: 1, style: { flexShrink: 1 } }), grow(), meta(f.action === "create" ? "new" : f.action === "delete" ? "removed" : "changed", { size: 12 })], { gap: 8 }),
          ...(f.why ? [text(f.why, { size: 13, color: C.grey70, lineHeight: 18, lines: 2 })] : []),
        ], { gap: 4, paddingVertical: 12, paddingHorizontal: 16 })]), { borderWidth: 1, borderColor: C.line, borderRadius: 18 })] : []),
        ...(note ? [note] : []),
      ], { gap: 10 })] : []),
    ],
  });
}
