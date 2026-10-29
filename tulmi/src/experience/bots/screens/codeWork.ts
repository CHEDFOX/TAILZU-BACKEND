/**
 * THE CODE BOT AT WORK: the live job and its chat, the team, a design and its preview, attaching, the shipped moment and a job
 * that could not finish. One id serves the phone and the window (ctx.client); built with the kit like screens/shell.ts.
 *
 *   bots.code.job      Job / DeskWork (params id)        watch it work: the stages, what it did, its one quick question (answer,
 *                                                        yes / no, keep going), how much of its share it used, stop. No money. With no job, or a job that
 *                                                        was a question (report "answer"), or after a question (params asked,
 *                                                        answer) it is the Code bot's CHAT (Chat.dc.html; the window draws the
 *                                                        chat beside the live job, DeskWork). Params project, thread, asked,
 *                                                        answer, flow (the answer's diagram artifact)
 *   bots.code.team     TeamBoard / DTeamBoard (id)       a lead and its helpers: GET /v1/code/jobs/:id/team, stop or re-run a part
 *   bots.code.design   Design / DeskDesign (id, job?)    an approved design (an artifact): point at a part and say what to change,
 *                                                        build it into the app (POST /v1/artifacts/:id/build)
 *   bots.code.preview  Preview / DPreview (id | job)     the artifact's parts to point at, its versions, go back to one
 *   bots.attach        Attach / DAttach (id | project)   add a file you already sent, a link or your voice to the chat
 *   bots.done          Done / DDone (id)                 the shipped moment: the pull request, the numbers, what changed
 *   bots.failed        Failed / DFailed (id)             what it tried; try again deeper, tell me more, stop
 *
 * Everything is the existing Code bot backend: routes/codeJobs.ts (the job, its log, its team, answer / approve / deny /
 * budget / stop / message), routes/artifacts.ts, routes/files.ts, and the front door (POST /v1/ask with projectId and a
 * threadId, docs/code-chat.md) for the chat. Live: the screens are never cached (cacheTtlSeconds 0), every write refreshes
 * the screen, the phone refreshes open screens on its own tick and when it comes back to the front, the window when it
 * comes back into focus; a status line taps to refresh. No new transport.
 */
import { createHash } from "node:crypto";
import type { ActionRef, ActionSpec, Node } from "../../../../../shared/types/sdui.js";
import {
  approvalLineOf, type AgentView, type ArtifactRead, ago, changedFiles, citations, firstSentence, flowOf, isOver, isUuid,
  type FileRow, type JobRead, type JobRow, minutesBetween, outline, type Part, plainWords, projectName, type ProjectRow, refOf,
  STAGES, stageOf, stepLines, type TeamRead, testsPassed, tries, type VersionRow, visibleParts, type WorkEntry, type WorkLine,
  workLines, wordsOf, type PartRow,
} from "../../../botsCodeWork/read.js";
import {
  back, blip, botAvatar, botLook, box, button, C, call, card, col, divider, duration, emptyState, grow, icon,
  labelled, meta, meter, mono, open, page, percent, row, SCREENS, sectionLabel, seq, shapes, stages, statusMark, text, title, when,
  whenEq, FACE, RADIUS, type BotsCtx, type Mark,
} from "../kit.js";
import { screen, type BotsScreen } from "../registry.js";
import { shareButton } from "../shareAction.js";
import { canUpload, uploadChip, uploadPick } from "../media.js";
import { canLive, liveView } from "../kit.js";
import { askMoment, failed, SENT_WORDS, start, streamed } from "../askMoment.js";

const CODE = botLook("code");
const MOSS = CODE.color;
const ASIDE = "#fafafa";

// ===================================================================== small parts

/** A line icon from a path of our own (the kit's ICONS has no picture, file, copy, eye). */
function glyph(d: string, o: { size?: number; color?: string; weight?: number } = {}): Node {
  const size = o.size ?? 20;
  return {
    type: "SVG",
    props: { viewBox: "0 0 24 24", d, fill: "none", stroke: o.color ?? C.ink, strokeWidth: o.weight ?? 1.9, strokeLinecap: "round", strokeLinejoin: "round" },
    style: { width: size, height: size, flexShrink: 0 },
  };
}
const G = {
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

const toast = (message: string): ActionSpec => ({ kind: "toast", message });
const oops = (message = "Couldn't do that. Try again."): ActionSpec => ({ kind: "toast", message, tone: "error" });
const refresh: ActionSpec = { kind: "refresh" };

/** A write the person asked for: the call, then a short ink toast and the screen read again; a plain-words toast if it failed. */
function write(method: "POST" | "PUT" | "DELETE", path: string, body: Record<string, unknown>, ok: string, fail?: string, then?: ActionRef): ActionSpec {
  return call(method, path, body, { ok: seq(toast(ok), then ?? refresh), fail: oops(fail) });
}

/** A yes that the server may first answer with a question ({ needsApproval, approvalId }): say it again with the id. */
function twoStep(path: string, ok: string): ActionSpec {
  const done = seq(toast(ok), refresh);
  return call("POST", path, {}, {
    assignTo: "yes",
    ok: { kind: "condition", if: { truthy: "yes.needsApproval" }, then: call("POST", path, { approvalId: "$state.yes.approvalId" }, { ok: done, fail: oops("That yes ran out. Try again.") }), else: done },
    fail: oops("Couldn't send that. Try again."),
  });
}

/** Copy text: the phone's clipboard action, or the window's. */
function copy(ctx: BotsCtx, content: string, said: string): ActionSpec {
  return ctx.client === "desktop" ? { kind: "copyText", text: content, message: said } : { kind: "copyToClipboard", text: content, toastMessage: said };
}

/** A 44 x 44 back chevron (pulled 10 left), as the boards draw it. */
const backButton = (to?: ActionRef): Node =>
  labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center", flexShrink: 0 }, to ?? back()), "Back");

/** A screen's head: back, an optional avatar, a title over a line, something on the right. */
function head(o: { title: string; size?: number; weight?: 600 | 700; sub?: Node; avatar?: boolean; right?: Node; back?: ActionRef }): Node {
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
function half(label: string, onPress: ActionRef, o: { icon?: Node; kind?: "primary" | "secondary" | "quiet"; height?: number; size?: number } = {}): Node {
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
function workMark(m: WorkLine["mark"], size: number): Node {
  if (m === "done") return icon("check", { size, color: C.ink, weight: 2 });
  return box([statusMark(m === "working" ? "working" : "waiting", { color: MOSS })], { width: size, height: size, alignItems: "center", justifyContent: "center", flexShrink: 0 });
}

function workList(lines: WorkLine[], size: 13 | 12 = 13): Node {
  return col(lines.map((l) => row([
    box([workMark(l.mark, size + 3)], { height: size + 5, justifyContent: "center" }),
    col([
      text(l.text, { size: size - 0.5, mono: true, lineHeight: size + 5, color: l.mark === "waiting" ? C.meta : C.ink, lines: 2 }),
      ...(l.sub ? [meta(l.sub, { size: 12, lines: 1 })] : []),
    ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 1 }),
  ], { gap: 10, alignItems: "flex-start" })), { gap: size === 13 ? 10 : 8 });
}

/** The status of a job, in a few words, its mark and its colour. */
export function statusOf(job: JobRow, now: number): { mark: Mark; words: string; color: string } {
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
function statusLine(job: JobRow, now: number, size = 13, extra = ""): Node {
  const s = statusOf(job, now);
  return labelled(row([
    statusMark(s.mark, { color: s.color }),
    text(s.words + extra, { size, weight: 500, color: s.color, lineHeight: size + 4, lines: 1, style: { flexShrink: 1 } }),
  ], { gap: 7 }, refresh), `${s.words}. Tap to refresh.`);
}

/** Where the job's computer is, in words (the window's aside). */
function placeLine(job: JobRow): string {
  if (isOver(job.state)) return "";
  switch (job.placement) {
    case "desktop": return "Running on this computer";
    case "github": return "Running on GitHub's free computers";
    case "paid": return "Running on paid compute";
    default: return job.state === "waiting_for_compute" ? job.reason || "Waiting for a computer to run on" : "";
  }
}

/** How much of what the job was given it has used, as a share: never an amount. */
function spendMeter(job: JobRow, size = 13): Node {
  const value = job.budgetPaise > 0 ? `${percent(job.spentPaise / job.budgetPaise)} used` : "";
  return col([
    row([text("Of what it was given", { size, color: C.meta, lineHeight: size + 4 }), grow(), text(value, { size, weight: 600, lineHeight: size + 4 })]),
    meter(job.spentPaise, Math.max(job.budgetPaise, job.spentPaise, 1), { height: 6 }),
  ], { gap: 8 });
}

const jobPath = (id: string, tail = ""): string => `/v1/code/jobs/${id}${tail}`;

/** Stop: the agent's stop for an agent job, the router's cancel otherwise. */
const stopJob = (job: JobRow): ActionSpec =>
  write("POST", jobPath(job.id, job.agent ? "/stop" : "/cancel"), {}, "Stopped. Nothing more is used.", "Couldn't stop it. Try again.");

// ===================================================================== reading a job

interface JobData extends JobRead {
  log: WorkEntry[];
  project?: ProjectRow;
}

async function readJob(deps: Parameters<NonNullable<BotsScreen["load"]>>[1], id: unknown): Promise<JobData | undefined> {
  if (!isUuid(id)) return undefined;
  const r = await deps.api<JobRead>("GET", jobPath(id));
  const [log, project] = await Promise.all([
    deps.api<{ entries: WorkEntry[] }>("GET", jobPath(id, "/log")).then((x) => x.entries ?? []).catch(() => [] as WorkEntry[]),
    deps.api<{ project: ProjectRow }>("GET", `/v1/code/projects/${r.job.projectId}`).then((x) => x.project).catch(() => undefined),
  ]);
  return { ...r, log, ...(project ? { project } : {}) };
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

function linesOf(d: JobData, max: number): WorkLine[] {
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

// ===================================================================== the one quick question

/** The decision a waiting job needs: its question, a yes, keep going, paid compute, a commit. Null when it needs nothing. */
function quickQuestion(_ctx: BotsCtx, d: JobData, o: { compact?: boolean } = {}): Node | null {
  const { job, agent } = d;
  if (job.state !== "waiting_for_you") return null;
  const small = !!o.compact;
  const label = (words: string) => row([statusMark("needs", { size: 10 }), text(words, { size: small ? 11 : 12, weight: 600, lineHeight: 16, tracking: 0.4, upper: true })], { gap: 8 });
  const ask = (s: string) => text(s, { size: small ? 14 : 16, weight: 500, lineHeight: small ? 20 : 22 });
  const btn = (l: string, a: ActionRef, kind: "primary" | "secondary" | "quiet") => button(l, a, { kind, size: "md" });
  const choices = (list: Node[]) => row(list, { gap: 8, flexWrap: "wrap" });
  const shell = (kids: Node[]) => card(kids, { gap: small ? 10 : 14, padding: small ? 14 : 18, radius: small ? 18 : 20 });
  const w = agent?.waiting;

  if (job.waitingOn === "answer" || w?.kind === "question") {
    const q = w?.question ?? job.reason ?? "Code bot has a question.";
    const opts = (w?.options ?? []).filter((x) => x.trim()).slice(0, 3);
    const answer = (s: string) => write("POST", jobPath(job.id, "/answer"), { answer: s }, "Sent to Code bot", "Couldn't send that. Try again.");
    if (opts.length) {
      return shell([label("Quick question"), ask(q), choices([
        ...opts.map((x, i) => btn(x, answer(x), i === 0 ? "primary" : "secondary")),
      ])]);
    }
    const send = { kind: "condition" as const, if: { falsy: "reply" }, then: toast("Type your answer first"), else: seq(answer("$state.reply"), { kind: "clearState", path: "reply" }) };
    return shell([label("Quick question"), ask(q), field("reply", "Your answer…", send, { compact: small })]);
  }
  if (job.waitingOn === "approval" || w?.kind === "approval") {
    const what = approvalLineOf(w?.action ?? "", w?.summary ?? {});
    const plan = agent?.plan?.steps.slice(0, 3).map((s) => `${s.n}. ${s.do}`) ?? [];
    return shell([label("Needs your yes"), ask(what), ...plan.map((p) => meta(p, { size: 13, lines: 2 })), choices([
      btn("Yes, go ahead", twoStep(jobPath(job.id, "/approve"), "Going ahead"), "primary"),
      btn("No", write("POST", jobPath(job.id, "/deny"), {}, "Told Code bot no"), "secondary"),
    ])]);
  }
  if (job.waitingOn === "budget" || w?.kind === "budget") {
    const more = agent?.report?.continueWithPaise ?? Math.max(1000, Math.round(job.spentPaise / 200) * 100);
    return shell([label("Needs your yes"), ask("This job has used a lot of this stretch. Keep going?"), choices([
      btn("Keep going", write("POST", jobPath(job.id, "/budget"), { addPaise: more }, "Going on", "Couldn't go on. Try again."), "primary"),
      btn("Stop here", stopJob(job), "secondary"),
    ])]);
  }
  if (job.waitingOn === "paid") {
    return shell([label("Needs your yes"), ask(job.reason || "No free computer is free. Use paid compute for this job?"), choices([
      btn("Yes, use paid", write("POST", jobPath(job.id, "/compute-ok"), {}, "Going on with paid compute", "Couldn't say yes. Try again."), "primary"),
      btn("Stop", stopJob(job), "secondary"),
    ])]);
  }
  if (job.waitingOn === "commit") {
    return shell([label("Needs your yes"), ask(job.reason || "Okay to commit what it made?"), choices([
      btn("Yes, commit", twoStep(jobPath(job.id, "/commit-ok"), "Committing"), "primary"),
      btn("Stop", stopJob(job), "secondary"),
    ])]);
  }
  return null;
}

/** A text box with send: the field writes `path`, return / Enter and the round button run `onSubmit`. */
function field(path: string, placeholder: string, onSubmit: ActionRef, o: { compact?: boolean; left?: Node; ink?: boolean; radius?: number } = {}): Node {
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

interface ChatCtx { projectId: string; threadId: string; jobId?: string; projectName: string }

/**
 * Ask the Code bot about the project (the front door with projectId and threadId: code/chat answers with path:line, or
 * "ok, change it" starts a job). An answer opens the chat with it; a job that started opens the job.
 */
function askCode(ctx: BotsCtx, c: ChatCtx, message: string, o: { from?: string; attachments?: string } = {}): ActionRef {
  // The words go up as the person's bubble and the box clears at once (askMoment.ts); the call sends them from there.
  const said = SENT_WORDS;
  const carry = { project: c.projectId, thread: c.threadId, ...(c.jobId ? { id: c.jobId } : {}) };
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
          then: open(SCREENS.codeJob, { id: "$state.said.result.job.id" }),
          else: open(SCREENS.codeJob, { ...carry, asked: said, answer: "$state.said.result.text", flow: "$state.said.result.artifacts.0.id" }),
        },
      ),
      fail: failed({ busy: "asking", ...(o.from ? { from: o.from } : {}), then: oops("Couldn't reach Code bot. Try again.") }),
    })),
  );
}

/** The person's words: an ink bubble on the right. */
function mine(s: string, size = 15): Node {
  return row([box([text(s, { size, color: C.paper, lineHeight: Math.round(size * 1.4) })], {
    backgroundColor: C.ink, borderRadius: 20, borderBottomRightRadius: 6, paddingVertical: 11, paddingHorizontal: 16, maxWidth: "86%",
  })], { justifyContent: "flex-end" });
}

/** The Code bot's words: paragraphs, code in mono, the flow it drew, and the files and lines it rests on. */
function theirs(s: string, o: { flow?: string[]; size?: number } = {}): Node {
  const size = o.size ?? 15;
  const blocks = plainWords(s);
  const cites = citations(s);
  return col([
    ...blocks.map((b) => b.kind === "code"
      ? box([text(b.text, { size: 12, mono: true, lineHeight: 18 })], { backgroundColor: C.surface, borderRadius: 12, padding: 12 })
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

/** The conversation of a job: what was asked, its questions and the answers, what it said at the end; then the question just asked. */
function conversation(d: JobData | undefined, p: { asked?: string; answer?: string; flow?: string[] }, size: number): Node[] {
  const out: Node[] = [];
  if (d) {
    out.push(mine(d.job.task, size));
    for (const e of d.log) {
      if (e.kind !== "question") continue;
      out.push(theirs(e.text, { size }));
      if (typeof e.data?.answer === "string") out.push(mine(e.data.answer, size));
    }
    const w = d.agent?.waiting;
    if (w?.kind === "question" && w.question && !d.log.some((e) => e.kind === "question" && e.text === w.question)) out.push(theirs(w.question, { size }));
    if (d.agent?.report?.text) out.push(theirs(d.agent.report.text, { size }));
  }
  if (p.asked) {
    out.push(mine(p.asked, size));
    out.push(p.answer ? theirs(p.answer, { size, ...(p.flow ? { flow: p.flow } : {}) }) : meta("Code bot didn't send words back. Ask again?", { size: 13 }));
  }
  return out;
}

/** The composer: the message box, attach, and (in the window) speak. A live job hears it as a message, a question as its answer. */
function composer(ctx: BotsCtx, c: ChatCtx, d: JobData | undefined, placeholder: string): Node {
  const job = d?.job;
  const live = job && !isOver(job.state);
  const send: ActionRef = live
    ? job!.waitingOn === "answer"
      ? seq(write("POST", jobPath(job!.id, "/answer"), { answer: "$state.msg" }, "Sent to Code bot"), { kind: "clearState", path: "msg" })
      : seq(write("POST", jobPath(job!.id, "/message"), { text: "$state.msg" }, "Code bot will read it next"), { kind: "clearState", path: "msg" })
    : askCode(ctx, c, "$state.msg", { from: "msg" });
  const guarded: ActionSpec = { kind: "condition", if: { falsy: "msg" }, then: toast("Type what you need first"), else: send };
  const attach = labelled(box([icon("clip", { size: 20, color: C.ink })], { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    open(SCREENS.attach, { ...(job ? { id: job.id } : {}), project: c.projectId, thread: c.threadId })), "Add to chat");
  return col([
    askMoment(ctx, { slug: "code", color: MOSS, kind: "code", busy: "asking", line: "Asking Code bot…" }),
    row([
      attach,
      {
        type: "TextField", id: "msg", bind: { value: "msg" },
        props: { placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0, minHeight: 44, returnKeyType: "send", color: C.ink },
        on: { onSubmit: guarded },
        style: { flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.regular, fontSize: 15, color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none" },
      },
      when({ truthy: "msg" }, labelled(box([icon("send", { size: 20, color: C.paper })], { width: 46, height: 46, borderRadius: 23, backgroundColor: C.ink, alignItems: "center", justifyContent: "center", flexShrink: 0 }, guarded), "Send")),
      when({ falsy: "msg" }, labelled(box([icon("mic", { size: 20, color: C.paper })], { width: 46, height: 46, borderRadius: 23, backgroundColor: C.ink, alignItems: "center", justifyContent: "center", flexShrink: 0 },
        ctx.client === "desktop" ? { kind: "dictate" } : open(SCREENS.ask, { voice: true })), "Speak")),
    ], { gap: 6, borderRadius: ctx.client === "desktop" ? 30 : RADIUS.input, borderWidth: 1, borderColor: C.line, paddingVertical: 5, paddingRight: 5, paddingLeft: 8, backgroundColor: C.paper }),
  ], { gap: 8 });
}

/** After an answer: change it (the front door hands the place the chat found to a job), or see the code itself. */
function nextMoves(ctx: BotsCtx, c: ChatCtx): Node {
  return row([
    button("Change something here", askCode(ctx, c, "Ok, change it the way we just talked about."), { kind: "primary", size: "md" }),
    button("Show the code", askCode(ctx, c, "Show me the exact code for that, line by line."), { kind: "secondary", size: "md" }),
  ], { gap: 8, flexWrap: "wrap" });
}

interface ChatData { job?: JobData; project?: ProjectRow; flow?: string[] }

function chatCtx(ctx: BotsCtx, data: ChatData | undefined): ChatCtx | null {
  const projectId = data?.job?.job.projectId ?? (typeof ctx.params.project === "string" ? ctx.params.project : "");
  if (!isUuid(projectId)) return null;
  const jobId = data?.job?.job.id;
  const threadId = jobId ?? (isUuid(ctx.params.thread) ? ctx.params.thread : threadFor(ctx.user?.id ?? "anon", projectId));
  return { projectId, threadId, ...(jobId ? { jobId } : {}), projectName: projectName(data?.job?.project ?? data?.project) };
}

const askedOf = (ctx: BotsCtx) => ({
  ...(typeof ctx.params.asked === "string" && ctx.params.asked && !ctx.params.asked.startsWith("$state.") ? { asked: ctx.params.asked } : {}),
  ...(typeof ctx.params.answer === "string" && ctx.params.answer && !ctx.params.answer.startsWith("$state.") ? { answer: ctx.params.answer } : {}),
});

function chatPhone(ctx: BotsCtx, data: ChatData | undefined) {
  const c = chatCtx(ctx, data);
  if (!c) return noProject(ctx);
  const p = askedOf(ctx);
  const talk = conversation(data?.job, { ...p, ...(data?.flow ? { flow: data.flow } : {}) }, 15);
  return page(ctx, {
    nav: "code", title: "Code bot", gap: 18,
    body: [
      head({ title: "Code bot", size: 17, sub: meta(c.projectName, { size: 12 }), avatar: true }),
      ...(talk.length ? talk : [col([text("Ask anything about your code.", { size: 16, weight: 500, lineHeight: 22 }), meta("Where something is, how it works, what would break. I answer with the files and lines, and change it when you say so.", { size: 13, lineHeight: 18 })], { gap: 6, paddingTop: 8 })]),
      ...(p.answer ? [nextMoves(ctx, c)] : []),
    ],
    footer: [composer(ctx, c, data?.job, "Ask about your code…")],
    state: { msg: "", said: null },
  });
}

function noProject(ctx: BotsCtx) {
  return page(ctx, {
    back: true, nav: "code", title: "Code bot",
    body: [emptyState({ pose: "think", title: "Which project?", body: "Open a project first, then ask about its code or tell Code bot what to change.", action: { label: "Your projects", onPress: open(SCREENS.code) } })],
  });
}

// ===================================================================== bots.code.job: watch it work

function nothingHere(ctx: BotsCtx, what: string, body = "It may have been removed, or it's someone else's. Your other jobs are on Code bot's page.") {
  return page(ctx, {
    back: true, nav: "code", title: what,
    body: [emptyState({ pose: "think", title: `Couldn't open this ${what.toLowerCase()}`, body, action: { label: "Go to Code bot", onPress: open(SCREENS.code) } })],
  });
}

/** The buttons under a job: its preview or its team, stop; or, once it is over, what came of it. */
function jobButtons(d: JobData, size: number): Node {
  const { job, agent } = d;
  const h = size === 15 ? 48 : 44;
  if (isOver(job.state)) {
    if (job.state === "done") return row([half(agent?.report?.outcome === "answer" ? "Read the answer" : "See what shipped", open(SCREENS.done, { id: job.id }), { kind: "primary", height: h + 6, size: 16 })]);
    return row([half("See what happened", open(SCREENS.failed, { id: job.id }), { kind: "primary", height: h + 6, size: 16 })]);
  }
  const list: Node[] = [];
  if (agent?.spec) list.push(half("Live preview", open(SCREENS.preview, { id: agent.spec.artifactId, job: job.id }), { icon: glyph(G.eye, { size: 18 }), height: h, size }));
  else if (agent?.team) list.push(half("Team", open(SCREENS.team, { id: job.id }), { icon: icon("person", { size: 18 }), height: h, size }));
  list.push(half("Stop", stopJob(job), { icon: icon("stop", { size: 18 }), height: h, size }));
  return row(list, { gap: 10 });
}

function jobPhone(ctx: BotsCtx, d: JobData) {
  const { job, agent } = d;
  const stage = stageOf(agent?.phase, job.state);
  const q = quickQuestion(ctx, d);
  return page(ctx, {
    nav: "code", title: job.task, gap: 22,
    body: [
      head({ title: job.task, sub: statusLine(job, ctx.live.now) }),
      labelled(stages(STAGES, stage, MOSS), `Step ${Math.min(stage + 1, 5)} of 5: ${STAGES[Math.min(stage, 4)]}`),
      workList(linesOf(d, 4)),
      ...(q ? [q] : []),
      ...(isOver(job.state) && agent?.report?.text ? [card([text(firstSentence(agent.report.text, 180), { size: 14, lineHeight: 20, color: C.grey70 })], { padding: 14 })] : []),
    ],
    footer: [spendMeter(job), jobButtons(d, 15)],
  });
}

/** DeskWork's aside: the live job beside the chat. */
function jobAside(ctx: BotsCtx, d: JobData): Node {
  const { job, agent } = d;
  const stage = stageOf(agent?.phase, job.state);
  const q = quickQuestion(ctx, d, { compact: true });
  const where = placeLine(job);
  return col([
    col([text(job.task, { size: 16, weight: 600, lineHeight: 21, lines: 3 }), statusLine(job, ctx.live.now, 13)], { gap: 6 }),
    labelled(stages(STAGES, stage, MOSS), `Step ${Math.min(stage + 1, 5)} of 5: ${STAGES[Math.min(stage, 4)]}`),
    workList(linesOf(d, 6), 12),
    ...(q ? [q] : []),
    grow(),
    col([spendMeter(job, 12), ...(where ? [meta(where, { size: 12 })] : [])], { gap: 8 }),
    jobButtons(d, 14),
  ], {
    width: 340, flexShrink: 0, gap: 18, padding: 22, backgroundColor: ASIDE, borderLeftWidth: 1, borderLeftColor: C.divider,
    marginTop: -40, marginBottom: -32, marginRight: -48,
  });
}

function chatPane(ctx: BotsCtx, data: ChatData, c: ChatCtx): Node {
  const p = askedOf(ctx);
  const d = data.job;
  const talk = conversation(d, { ...p, ...(data.flow ? { flow: data.flow } : {}) }, 15);
  const pr = d?.agent?.pr;
  return col([
    row([
      text(c.projectName, { size: 18, weight: 600, lineHeight: 23 }),
      ...(d ? [box([text(d.job.branch, { size: 12, lineHeight: 16, mono: true, lines: 1 })], { borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingVertical: 3, paddingHorizontal: 9, maxWidth: 260 })] : []),
      ...(pr ? [meta(`PR #${pr.number}${pr.ready ? " · ready" : " · draft"}`, { size: 12 })] : []),
    ], { gap: 10, flexWrap: "wrap" }),
    ...(talk.length ? talk : [col([text("Ask anything about your code.", { size: 18, weight: 500, lineHeight: 24 }), meta("Where something is, how it works, what would break. Code bot answers with the files and lines, and changes it when you say so.", { size: 14, lineHeight: 20 })], { gap: 6 })]),
    ...(p.answer ? [nextMoves(ctx, c)] : []),
    grow(),
    composer(ctx, c, d, "Ask about the code, or tell Code bot what to change…"),
  ], { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, gap: 20, paddingRight: 32 });
}

function jobDesk(ctx: BotsCtx, data: ChatData) {
  const c = chatCtx(ctx, data);
  if (!c) return noProject(ctx);
  return page(ctx, {
    nav: "code", title: data.job?.job.task ?? "Code bot", maxWidth: 1400,
    body: [row([chatPane(ctx, data, c), ...(data.job && data.job.agent?.report?.outcome !== "answer" ? [jobAside(ctx, data.job)] : [])], { alignItems: "stretch", flexGrow: 1, minHeight: 600 })],
    state: { msg: "", said: null },
  });
}

/** Is this job a conversation (or did the person just ask something)? Then the phone draws the chat. */
const isChat = (ctx: BotsCtx, d?: JobData): boolean => !d || d.agent?.report?.outcome === "answer" || !!askedOf(ctx).asked;

async function loadJobOrChat(ctx: BotsCtx, deps: Parameters<NonNullable<BotsScreen["load"]>>[1]): Promise<ChatData> {
  const [job, flow, project] = await Promise.all([
    ctx.params.id !== undefined ? readJob(deps, ctx.params.id) : Promise.resolve(undefined),
    isUuid(ctx.params.flow)
      ? deps.api<ArtifactRead>("GET", `/v1/artifacts/${ctx.params.flow}`).then((a) => flowOf(a.content)).catch(() => undefined)
      : Promise.resolve(undefined),
    ctx.params.id === undefined && isUuid(ctx.params.project)
      ? deps.api<{ project: ProjectRow }>("GET", `/v1/code/projects/${ctx.params.project}`).then((x) => x.project).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);
  return { ...(job ? { job } : {}), ...(flow?.length ? { flow } : {}), ...(project ? { project } : {}) };
}

function jobScreen(ctx: BotsCtx, data: ChatData | undefined) {
  if (ctx.params.id !== undefined && !data?.job) return nothingHere(ctx, "Job");
  if (ctx.client === "desktop") return jobDesk(ctx, data ?? {});
  if (isChat(ctx, data?.job)) return chatPhone(ctx, data);
  return jobPhone(ctx, data!.job!);
}

// ===================================================================== bots.code.team

interface TeamData { team: TeamRead; job: JobData }

type ItemMark = "done" | "working" | "todo" | "failed";
interface TeamItem { text: string; sub?: string; mark: ItemMark }

const BUILT: PartRow["status"][] = ["reviewing", "fixing", "approved", "merged"];
const PART_OVER_BAD: PartRow["status"][] = ["failed", "stopped", "exhausted", "skipped"];

/** A helper's three things: build its part, be checked by the reviewer, be handed to the lead. */
export function partItems(p: PartRow): TeamItem[] {
  const bad = PART_OVER_BAD.includes(p.status);
  const build: ItemMark = bad ? "failed" : BUILT.includes(p.status) ? "done" : p.status === "running" || p.status === "blocked" ? "working" : "todo";
  const review: ItemMark = p.status === "approved" || p.status === "merged" ? "done" : p.status === "reviewing" || p.status === "fixing" ? "working" : bad && p.review ? "failed" : "todo";
  return [
    { text: p.title, ...(p.status === "blocked" ? { sub: "Needs you" } : bad ? { sub: p.reason ? firstSentence(p.reason, 60) : p.status === "stopped" ? "You stopped it" : p.status === "exhausted" ? "Used its share of the job" : p.status === "skipped" ? "A part it needs didn't finish" : "Couldn't finish" } : {}), mark: build },
    { text: p.review ? (p.review.verdict === "pass" || p.status === "approved" || p.status === "merged" ? "Passed the check" : firstSentence(p.review.summary, 60)) : "Checked by a second bot", ...(p.fixRounds ? { sub: `${p.fixRounds} fix ${p.fixRounds === 1 ? "round" : "rounds"}` } : {}), mark: review },
    { text: "Handed to the lead", mark: p.status === "merged" ? "done" : "todo" },
  ];
}

/** The lead's own things: split the goal, the shared groundwork (part 0), join the parts, the last full check. */
export function leadItems(t: TeamRead["team"]): TeamItem[] {
  const helpers = t.parts.filter((p) => p.id !== 0);
  const zero = t.parts.find((p) => p.id === 0);
  const merged = helpers.filter((p) => p.status === "merged").length;
  const items: TeamItem[] = [{ text: `Split the job into ${helpers.length} ${helpers.length === 1 ? "part" : "parts"}`, mark: "done" }];
  if (zero) items.push({ text: "Shared groundwork first", mark: zero.status === "merged" || t.stage !== "contracts" ? "done" : "working" });
  items.push({
    text: "Joining the parts on one branch",
    mark: t.stage === "final" || t.stage === "done" ? "done" : t.stage === "run" && merged > 0 ? "working" : "todo",
    ...(t.stage === "run" && merged ? { sub: `${merged} of ${helpers.length} joined` } : {}),
  });
  items.push({ text: "Run every check once more", mark: t.stage === "done" ? "done" : t.stage === "final" ? "working" : "todo" });
  return items;
}

function itemMark(m: ItemMark): Node {
  const inner = m === "done" ? statusMark("done") : m === "working" ? statusMark("working", { color: MOSS }) : m === "failed" ? statusMark("failed") : statusMark("waiting");
  return box([inner], { width: 16, height: 18, alignItems: "flex-start", justifyContent: "center", flexShrink: 0 });
}

const RANK: Record<ItemMark, number> = { done: 0, working: 1, failed: 2, todo: 3 };
const ranked = (items: TeamItem[]): TeamItem[] => items.slice().sort((a, b) => RANK[a.mark] - RANK[b.mark]);

function miniBar(items: TeamItem[]): Node {
  return row(ranked(items).map((it) => box([], { width: 14, height: 6, borderRadius: 2, backgroundColor: it.mark === "done" ? C.ink : it.mark === "working" ? MOSS : it.mark === "failed" ? C.grey70 : C.track })), { gap: 3 });
}

function itemList(items: TeamItem[]): Node {
  return col(items.map((it) => row([
    itemMark(it.mark),
    col([text(it.text, { size: 13, lineHeight: 18, color: it.mark === "todo" ? C.meta : C.ink, lines: 2 }), ...(it.sub ? [meta(it.sub, { size: 12, lines: 1 })] : [])], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 1 }),
  ], { gap: 8, alignItems: "flex-start" })), { gap: 8 });
}

function partActions(job: JobRow, p: PartRow): Node | null {
  if (isOver(job.state)) return null;
  const path = (op: string) => jobPath(job.id, `/team/parts/${p.id}/${op}`);
  if (["running", "blocked", "reviewing", "fixing", "ready", "waiting"].includes(p.status)) {
    return button("Stop part", write("POST", path("stop"), {}, `Stopped ${p.title}`, "Couldn't stop that part. Try again."), { kind: "quiet", size: "md" });
  }
  if (PART_OVER_BAD.includes(p.status) && p.status !== "skipped") {
    return button("Run again", write("POST", path("rerun"), p.status === "exhausted" ? { addPaise: Math.max(500, p.budgetPaise) } : {}, "Running it again", "Couldn't run it again. Try again."), { kind: "secondary", size: "md" });
  }
  return null;
}

function memberCard(o: { name: string; sub: string; extra?: string; items: TeamItem[]; avatar?: Node; action?: Node | null }): Node {
  return card([
    row([
      o.avatar ?? botAvatar(CODE, 30),
      col([text(o.name, { size: 14, weight: 600, lineHeight: 19, lines: 1 }), meta(o.sub, { size: 12, lines: 1 }), ...(o.extra ? [meta(o.extra, { size: 11.5 })] : [])], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 1 }),
      miniBar(o.items),
    ], { gap: 10 }),
    itemList(o.items),
    ...(o.action ? [o.action] : []),
  ], { padding: 14, gap: 12, radius: 18 });
}

function teamCounts(t: TeamRead["team"]): { done: number; working: number; todo: number; all: TeamItem[] } {
  const all = [...leadItems(t), ...t.parts.filter((p) => p.id !== 0).flatMap(partItems)];
  return {
    done: all.filter((i) => i.mark === "done").length, working: all.filter((i) => i.mark === "working").length,
    todo: all.filter((i) => i.mark === "todo" || i.mark === "failed").length, all,
  };
}

function progressBlock(t: TeamRead["team"], size = 13): Node {
  const n = teamCounts(t);
  const left = n.todo + n.working;
  return col([
    row([text(`${n.done} of ${n.all.length} steps done`, { size, weight: 600, lineHeight: size + 4 }), grow(), meta(left ? `${left} to go` : "All done", { size })]),
    labelled(row(ranked(n.all).map((i) => box([], { flexGrow: 1, flexBasis: 0, height: 6, borderRadius: 3, backgroundColor: i.mark === "done" ? C.ink : i.mark === "working" ? MOSS : C.track })), { gap: 4 }),
      `${n.done} done, ${n.working} working, ${n.todo} to go`),
  ], { gap: 8 });
}

function reviewNote(t: TeamRead["team"]): Node | null {
  const reviewed = t.parts.filter((p) => p.review);
  if (!reviewed.length && !t.parts.some((p) => p.status === "reviewing")) return null;
  const passed = reviewed.filter((p) => p.status === "approved" || p.status === "merged").map((p) => p.title);
  const next = t.parts.find((p) => p.status === "reviewing" || p.status === "fixing");
  const family = reviewed.find((p) => p.review?.family)?.review?.family;
  const words = [passed.length ? `${passed.slice(0, 2).join(", ")} passed` : "", next ? `${next.title} next` : ""].filter(Boolean).join(" · ");
  return row([
    box([icon("shield", { size: 16 })], { width: 30, height: 30, borderRadius: 15, backgroundColor: C.paper, alignItems: "center", justifyContent: "center", flexShrink: 0 }),
    col([
      text(`Checked by a second bot${family ? ` (${family})` : ""} from another family`, { size: 14, weight: 500, lineHeight: 19 }),
      ...(words ? [meta(words, { size: 12 })] : []),
    ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 }),
  ], { gap: 12, backgroundColor: C.surface, borderRadius: 18, padding: 14 });
}

/** "12% of the job": how much of the job's share a member used. */
const shareOf = (paise: number, total: number): string => `${percent(paise / Math.max(1, total))} of the job`;

function teamCost(d: TeamData, size = 13): Node {
  const b = d.team.team.budget;
  const bots = 1 + d.team.team.parts.filter((p) => p.id !== 0 && (p.jobId || p.spentPaise > 0)).length;
  return col([
    row([text(`Used so far · ${bots} ${bots === 1 ? "bot" : "bots"}`, { size, color: C.meta, lineHeight: size + 4 }), grow(), text(`${percent(b.spentPaise / Math.max(1, b.totalPaise))} of its share`, { size, weight: 600, lineHeight: size + 4 })]),
    meter(b.spentPaise, Math.max(1, b.totalPaise, b.spentPaise)),
  ], { gap: 8 });
}

function teamButtons(d: TeamData, o: { stacked?: boolean } = {}): Node | null {
  const job = d.job.job;
  const h = o.stacked ? 46 : 54, size = o.stacked ? 14 : 16;
  const wrap = (kids: Node[]) => (o.stacked ? col(kids.map((k) => row([k])), { gap: 10 }) : row(kids, { gap: 10 }));
  if (isOver(job.state)) return wrap([half(job.state === "done" ? "See what shipped" : "See what happened", open(job.state === "done" ? SCREENS.done : SCREENS.failed, { id: job.id }), { kind: "primary", height: h, size })]);
  return wrap([
    d.job.agent?.spec ? half("Live preview", open(SCREENS.preview, { id: d.job.agent.spec.artifactId, job: job.id }), { icon: glyph(G.eye, { size: 18 }), height: h, size }) : half("Watch the lead", open(SCREENS.codeJob, { id: job.id }), { height: h, size }),
    half("Stop all", stopJob(job), { icon: icon("stop", { size: 18 }), height: h, size }),
  ]);
}

function helperName(p: PartRow): string {
  return `Helper · ${p.title.length > 26 ? p.title.slice(0, 25).trimEnd() + "…" : p.title}`;
}

function teamPhone(ctx: BotsCtx, d: TeamData) {
  const { job } = d.job;
  const t = d.team.team;
  const helpers = t.parts.filter((p) => p.id !== 0);
  const leadSpent = Math.max(0, t.budget.spentPaise - helpers.reduce((s, p) => s + p.spentPaise, 0));
  const note = reviewNote(t);
  const buttons = teamButtons(d);
  return page(ctx, {
    nav: "code", title: job.task, gap: 18,
    body: [
      head({ title: job.task, size: 24, weight: 700, sub: statusLine(job, ctx.live.now, 12, ` · team of ${helpers.length + 1}`) }),
      progressBlock(t),
      memberCard({ name: "Code bot · lead", sub: "Splits the job, joins the parts", extra: shareOf(leadSpent, t.budget.totalPaise), items: leadItems(t) }),
      ...helpers.map((p) => memberCard({ name: helperName(p), sub: p.ownedPaths[0] ?? p.goal, extra: shareOf(p.spentPaise, t.budget.totalPaise), items: partItems(p), action: partActions(job, p) })),
      ...(note ? [note] : []),
    ],
    footer: [teamCost(d), ...(buttons ? [buttons] : [])],
  });
}

/** The window's board: who (lead, helpers, the reviewer) by to do · working · done. */
function teamBoard(d: TeamData): Node {
  const t = d.team.team;
  const helpers = t.parts.filter((p) => p.id !== 0);
  const rowsOf: Array<{ who: Node; items: TeamItem[] }> = [
    { who: whoCell(botAvatar(CODE, 30), "Code bot · lead", "Splits the job, joins the parts", shareOf(Math.max(0, t.budget.spentPaise - helpers.reduce((s, p) => s + p.spentPaise, 0)), t.budget.totalPaise)), items: leadItems(t) },
    ...helpers.map((p) => ({ who: whoCell(botAvatar(CODE, 30), helperName(p), p.ownedPaths[0] ?? p.goal, shareOf(p.spentPaise, t.budget.totalPaise)), items: partItems(p).slice(0, 1) })),
    {
      who: whoCell(box([icon("shield", { size: 15 })], { width: 30, height: 30, borderRadius: 15, backgroundColor: C.surface, borderWidth: 1, borderColor: C.outline, alignItems: "center", justifyContent: "center" }), "Review", "A second bot from another family", "Checks each part"),
      items: helpers.map((p) => ({ text: `Check ${p.title}`, mark: p.status === "approved" || p.status === "merged" ? "done" as const : p.status === "reviewing" || p.status === "fixing" ? "working" as const : "todo" as const, ...(p.review ? { sub: firstSentence(p.review.summary, 50) } : {}) })),
    },
  ];
  const n = teamCounts(t);
  const cols: Array<{ label: string; mark?: Mark; pick: (i: TeamItem) => boolean }> = [
    { label: `To do · ${n.todo}`, pick: (i) => i.mark === "todo" || i.mark === "failed" },
    { label: `Working · ${n.working}`, mark: "working", pick: (i) => i.mark === "working" },
    { label: `Done · ${n.done}`, mark: "done", pick: (i) => i.mark === "done" },
  ];
  const cell = (kids: Node[], first = false): Node => col(kids, { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 8, ...(first ? { width: 210, flexGrow: 0, flexBasis: 210 } : {}) });
  const itemCard = (i: TeamItem): Node => row([
    ...(i.mark === "todo" ? [] : [itemMark(i.mark)]),
    col([text(i.text, { size: 13, lineHeight: 18, color: i.mark === "todo" ? C.meta : C.ink, lines: 2 }), ...(i.sub ? [meta(i.sub, { size: 11.5, lines: 1 })] : [])], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 1 }),
  ], { gap: 8, alignItems: "flex-start", padding: 10, borderRadius: 12, borderWidth: 1, borderColor: i.mark === "working" ? C.ink : C.line, backgroundColor: C.paper });
  return col([
    row([cell([sectionLabel("Who")], true), ...cols.map((c) => cell([row([...(c.mark ? [statusMark(c.mark, { color: MOSS })] : []), sectionLabel(c.label)], { gap: 6 })]))], { gap: 14, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: ASIDE }),
    ...rowsOf.flatMap((r) => [divider(), row([cell([r.who], true), ...cols.map((c) => cell(r.items.filter(c.pick).map(itemCard)))], { gap: 14, paddingVertical: 14, paddingHorizontal: 16, alignItems: "flex-start" })]),
  ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" });
}

function whoCell(avatar: Node, name: string, sub: string, extra: string): Node {
  return row([avatar, col([text(name, { size: 13.5, weight: 600, lineHeight: 18, lines: 1 }), meta(sub, { size: 12, lines: 2 }), meta(extra, { size: 11.5 })], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 1 })], { gap: 10, alignItems: "flex-start" });
}

function teamDesk(ctx: BotsCtx, d: TeamData) {
  const { job } = d.job;
  const t = d.team.team;
  const helpers = t.parts.filter((p) => p.id !== 0);
  const b = t.budget;
  const leadSpent = Math.max(0, b.spentPaise - helpers.reduce((s, p) => s + p.spentPaise, 0));
  const greys = [C.ink, C.grey70, C.idle, C.outline, C.track];
  const segs = [{ name: "Lead", paise: leadSpent }, ...helpers.map((p) => ({ name: p.title, paise: p.spentPaise }))];
  const buttons = teamButtons(d, { stacked: true });
  return page(ctx, {
    nav: "code", title: job.task, gap: 22, maxWidth: 1100,
    body: [
      row([
        backButton(),
        col([
          meta(`Code bot · a lead and ${helpers.length} ${helpers.length === 1 ? "helper" : "helpers"} · ${projectName(d.job.project)}`, { size: 13 }),
          title(job.task, { size: 26, lineHeight: 32, lines: 2 }),
          statusLine(job, ctx.live.now, 13, ` · team of ${helpers.length + 1}`),
        ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 4 }),
        box([progressBlock(t)], { width: 300, flexShrink: 0 }),
      ], { gap: 14, alignItems: "flex-end" }),
      teamBoard(d),
      row([
        card([
          row([sectionLabel(`Used so far · ${segs.filter((s) => s.paise > 0).length || 1} bots`), grow(), text(`${percent(b.spentPaise / Math.max(1, b.totalPaise))} `, { size: 14, weight: 600, lineHeight: 18 }), meta("of the job's share", { size: 14, lineHeight: 18 })]),
          meter(b.spentPaise, Math.max(1, b.totalPaise, b.spentPaise), { segments: segs.map((s, i) => ({ value: s.paise, color: greys[i % greys.length]! })) }),
          row(segs.map((s, i) => row([box([], { width: 8, height: 8, borderRadius: 2, backgroundColor: greys[i % greys.length]! }), meta(`${s.name.length > 18 ? s.name.slice(0, 17) + "…" : s.name} ${percent(s.paise / Math.max(1, b.totalPaise))}`, { size: 12 })], { gap: 6 })), { gap: 14, flexWrap: "wrap" }),
        ], { gap: 12, padding: 16, radius: 18, style: { flexGrow: 1, flexBasis: 0, minWidth: 0 } }),
        card([
          sectionLabel("Branches"),
          ...[{ name: job.branch, words: t.stage === "run" ? "lead is joining" : t.stage === "final" ? "last checks" : t.stage === "done" ? "done" : "groundwork", mark: (t.stage === "done" ? "done" : "working") as Mark },
            ...helpers.filter((p) => p.branch).map((p) => ({ name: p.branch!, words: p.status === "merged" ? "handed to lead" : p.status, mark: (p.status === "merged" ? "done" : PART_OVER_BAD.includes(p.status) ? "failed" : "working") as Mark }))]
            .slice(0, 5).map((r) => row([statusMark(r.mark, { color: MOSS }), text(r.name, { size: 11.5, mono: true, lineHeight: 16, lines: 1, style: { flexShrink: 1 } }), grow(), meta(r.words, { size: 11.5 })], { gap: 8 })),
        ], { gap: 10, padding: 16, radius: 18, style: { flexGrow: 1, flexBasis: 0, minWidth: 0 } }),
        ...(buttons ? [col([buttons], { width: 200, flexShrink: 0, justifyContent: "flex-end" })] : []),
      ], { gap: 16, alignItems: "stretch" }),
    ],
  });
}

function teamScreen(ctx: BotsCtx, d: TeamData | undefined) {
  if (!d) return nothingHere(ctx, "Team", "This job isn't leading a team, or it couldn't be read. Open the job to see how it's going.");
  return ctx.client === "desktop" ? teamDesk(ctx, d) : teamPhone(ctx, d);
}

// ===================================================================== artifacts: design and preview

/** `live`: the page the app runs the artifact in (GET /v1/artifacts/:id/live), for a build that draws LiveView while a viewer is set. */
interface ArtData { art: ArtifactRead; versions: VersionRow[]; job?: JobData; live?: LivePage }
interface LivePage { html: string; origin: string }

async function readArtifact(deps: Parameters<NonNullable<BotsScreen["load"]>>[1], id: string): Promise<{ art: ArtifactRead; versions: VersionRow[] }> {
  const [art, versions] = await Promise.all([
    deps.api<ArtifactRead>("GET", `/v1/artifacts/${id}`),
    deps.api<{ versions: VersionRow[] }>("GET", `/v1/artifacts/${id}/versions`).then((v) => v.versions ?? []).catch(() => [] as VersionRow[]),
  ]);
  return { art, versions };
}

/** The artifact a screen is about: its id, or the design a job builds, or the newest one of the job's project. */
async function loadArt(ctx: BotsCtx, deps: Parameters<NonNullable<BotsScreen["load"]>>[1]): Promise<ArtData> {
  const job = isUuid(ctx.params.job) ? await readJob(deps, ctx.params.job).catch(() => undefined) : undefined;
  let id = isUuid(ctx.params.id) ? ctx.params.id : job?.agent?.spec?.artifactId;
  if (!id && job) {
    const list = await deps.api<{ artifacts: Array<{ id: string }> }>("GET", `/v1/artifacts?projectId=${job.job.projectId}`).catch(() => ({ artifacts: [] }));
    id = list.artifacts[0]?.id;
  }
  if (!id) throw new Error("nothing to show");
  // The running page too, for a build that can show one: none (no viewer set, an older build) draws the parts as before.
  const [a, live] = await Promise.all([
    readArtifact(deps, id),
    canLive(ctx) ? deps.api<LivePage>("GET", `/v1/artifacts/${id}/live?pick=1`).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  return { ...a, ...(job ? { job } : {}), ...(live && typeof live.html === "string" && typeof live.origin === "string" ? { live } : {}) };
}

/**
 * The artifact running (LiveView), for point and change: a tap on a part (in "Point to change") picks it into `sel` / `selName`, as the
 * drawn parts do; an error the page reports goes to POST /v1/artifacts/:id/errors, and a fix it lands reloads the screen.
 */
function liveArt(d: ArtData, height: number): Node | null {
  if (!d.live) return null;
  const art = d.art;
  const report = call("POST", `/v1/artifacts/${art.artifact.id}/errors`, {
    version: art.version, kind: "$state.live.kind", message: "$state.live.message", line: "$state.live.line", col: "$state.live.col",
  }, { assignTo: "fixed", ok: { kind: "condition", if: { eq: ["fixed.status", "fixed"] }, then: seq(toast("Fixed a problem in the page"), refresh) } });
  const onMessage: ActionSpec = {
    kind: "condition", if: { eq: ["live.t", "select"] },
    then: seq({ kind: "setState", path: "sel", value: "$state.live.id" }, { kind: "setState", path: "selName", value: "$state.live.name" }),
    else: { kind: "condition", if: { eq: ["live.t", "error"] }, then: report },
  };
  return liveView({
    html: d.live.html, origin: d.live.origin, title: art.artifact.title, messagePath: "live", waitForReady: true,
    loadingText: "Opening the page…", errorText: "Couldn't open the page.",
  }, { sendPath: "liveSend", onResult: onMessage, style: { width: "100%", height, borderRadius: 16 } });
}

/** "Use it" or "Point to change": whether a tap on the running page uses it or picks a part (the page is told, nothing reloads). */
function liveMode(o: { compact?: boolean } = {}): Node {
  const tab = (labelText: string, pick: boolean, glyphNode?: Node) => box([row([
    ...(glyphNode ? [glyphNode] : []),
    text(labelText, { size: 13, weight: 500, lineHeight: 17, align: "center" }),
  ], { gap: 6, justifyContent: "center" })], {
    flexGrow: o.compact ? 0 : 1, flexBasis: o.compact ? undefined : 0, paddingVertical: o.compact ? 6 : 9, paddingHorizontal: 14, borderRadius: 10,
    backgroundColor: whenEq("liveSend.pick", pick, C.paper, "transparent"),
  }, { kind: "setState", path: "liveSend.pick", value: pick });
  return labelled(row([tab("Use it", false), tab("Point to change", true, glyph("M5 3l14 7-6 2-2 6z", { size: 14 }))], { gap: 2, padding: 3, borderRadius: 12, backgroundColor: C.surface }), "Preview mode");
}

const POINTABLE = new Set(["html", "react", "svg", "jsx", "tsx"]);

/**
 * The artifact's parts as the screen draws them, each one a person can tap to pick (its viewer id goes to `sel`, its name to
 * `selName`). The picked part is outlined in ink. Not the running page: the parts, their words and their order.
 */
function partsView(art: ArtifactRead, o: { scale?: number; max?: number } = {}): Node {
  const s = o.scale ?? 1;
  const parts = POINTABLE.has(art.artifact.type) ? visibleParts(outline(art.content)) : [];
  if (!parts.length) {
    const words = plainWords(art.content, 6);
    return col(words.length ? words.map((b) => text(b.text, { size: Math.round(13 * s), lineHeight: Math.round(19 * s), mono: b.kind === "code" })) : [meta("Nothing to show yet.")], { gap: 8 });
  }
  let budget = o.max ?? 28;
  const draw = (p: Part, depth: number): Node | null => {
    if (budget <= 0) return null;
    budget--;
    const words = p.text || (p.kids.length ? "" : wordsOf(p));
    const pick = seq({ kind: "setState", path: "sel", value: p.id }, { kind: "setState", path: "selName", value: `${p.kind}${words ? ` · ${words.slice(0, 40)}` : ""}` });
    const ring = { borderWidth: 1.5, borderColor: whenEq("sel", p.id, C.ink, "transparent"), borderRadius: 8 };
    const kids = depth < 4 ? p.kids.map((k) => draw(k, depth + 1)).filter((k): k is Node => !!k) : [];
    let own: Node | null = null;
    if (p.kind === "Button") {
      own = labelled(row([text(words || "Button", { size: Math.round(13 * s), weight: 600, color: C.paper, lineHeight: Math.round(17 * s), lines: 1 })], {
        backgroundColor: C.ink, borderRadius: 10, paddingVertical: Math.round(7 * s), paddingHorizontal: Math.round(12 * s), alignSelf: "flex-start",
        borderWidth: 1.5, borderColor: whenEq("sel", p.id, C.outline, C.ink),
      }, pick), `Button ${words}`);
    } else if (p.kind === "Field") {
      own = row([text(words || "Field", { size: Math.round(12 * s), color: C.idle, lineHeight: Math.round(16 * s), lines: 1 })], { ...ring, borderColor: whenEq("sel", p.id, C.ink, C.line), borderWidth: 1, paddingVertical: 7, paddingHorizontal: 10 }, pick);
    } else if (p.kind === "Picture") {
      own = box([glyph(G.image, { size: Math.round(18 * s), color: C.idle })], { ...ring, borderColor: whenEq("sel", p.id, C.ink, C.line), borderWidth: 1, height: Math.round(54 * s), alignItems: "center", justifyContent: "center", backgroundColor: C.surface }, pick);
    } else if (words) {
      const strong = p.kind === "Heading" || /^(strong|b|h\d)$/i.test(p.tag);
      const big = /^h[12]$/i.test(p.tag);
      own = box([text(words, { size: Math.round((big ? 18 : strong ? 15 : 12) * s), weight: strong ? (big ? 700 : 600) : 400, lineHeight: Math.round((big ? 23 : strong ? 20 : 16) * s), color: strong ? C.ink : C.meta, lines: 3 })],
        { ...ring, paddingVertical: 1, paddingHorizontal: 4, marginHorizontal: -4 }, pick);
    }
    if (!kids.length) return own;
    // A part made only of words and buttons is drawn as a card; a part made of parts is a column of them.
    const leafy = p.kids.every((k) => !k.kids.length);
    return col([...(own ? [own] : []), ...kids], leafy
      ? { gap: Math.round(4 * s), backgroundColor: C.paper, borderRadius: 14, padding: Math.round(12 * s) }
      : { gap: Math.round(8 * s) });
  };
  return col(parts.map((p) => draw(p, 0)).filter((n): n is Node => !!n), { gap: Math.round(8 * s) });
}

function versionDots(head: number, size = 8): Node {
  const n = Math.min(head, 6);
  return labelled(row(Array.from({ length: n }, (_, i) => box([], { width: size, height: size, borderRadius: size / 2, backgroundColor: i === n - 1 ? C.ink : C.outline })), { gap: 5 }),
    `Version ${head} of ${head}`);
}

/** Say what to change about the picked part (or the whole thing): POST /v1/artifacts/:id/edit. */
function changeAction(art: ArtifactRead): ActionSpec {
  return {
    kind: "condition", if: { falsy: "change" }, then: toast("Say what to change first"), else: seq(
      { kind: "setState", path: "changing", value: true },
      call("POST", `/v1/artifacts/${art.artifact.id}/edit`, { instruction: "$state.change", elementId: "$state.sel" }, {
        ok: seq({ kind: "setState", path: "changing", value: false }, { kind: "clearState", path: "change" }, toast("Changed. The old version is kept."), refresh),
        fail: seq({ kind: "setState", path: "changing", value: false }, oops("Couldn't change that. Try again.")),
      }),
    ),
  };
}

const changing = (): Node => when({ truthy: "changing" }, row([statusMark("working", { color: MOSS }), meta("Changing it…", { size: 13 })], { gap: 8 }));

/** Build the approved version into the project (a Code bot job whose spec it is), then watch it work. */
function buildAction(art: ArtifactRead): ActionSpec | null {
  if (!art.artifact.projectId) return null;
  return call("POST", `/v1/artifacts/${art.artifact.id}/build`, { projectId: art.artifact.projectId, version: art.version }, {
    assignTo: "built",
    ok: seq(toast("Code bot is building it"), open(SCREENS.codeJob, { id: "$state.built.job.id" })),
    fail: oops("Couldn't start the build. Try again."),
  });
}

function selectedLabel(): Node {
  return row([
    text("Selected · ", { size: 11, weight: 600, upper: true, tracking: 0.4, lineHeight: 15 }),
    text("Tap a part", { size: 11, weight: 600, upper: true, tracking: 0.4, lineHeight: 15, bind: "selName", lines: 1, style: { flexShrink: 1 } }),
  ]);
}

function designPhone(ctx: BotsCtx, d: ArtData) {
  const { art } = d;
  const build = buildAction(art);
  const live = liveArt(d, 420);
  return page(ctx, {
    nav: "code", title: art.artifact.title, gap: 16,
    body: [
      head({ title: art.artifact.title, sub: meta(`In your app's style · version ${art.version}`, { size: 12 }), right: versionDots(art.artifact.headVersion) }),
      col([live ?? partsView(art), selectedLabel()], { backgroundColor: C.surface, borderRadius: 24, padding: 14, gap: 12 }),
      field("change", "Make it stand out more", changeAction(art), { ink: true }),
      changing(),
      meta("Tap any part, say what to change. Only that part is redone.", { size: 12 }),
    ],
    footer: build ? [
      button("Build it into my app", build, { kind: "primary", wide: true, icon: undefined }),
      meta("After building, I'll compare the real screen with this and fix any difference.", { size: 12, align: "center" }),
    ] : [meta("This design isn't part of a project, so there's nowhere to build it yet.", { size: 12, align: "center" })],
    state: { sel: "", selName: "Tap a part", change: "", changing: false, ...liveState(live) },
  });
}

/** DeskDesign's right side: the build job, if one is named: where it is, and how close the real screen is to the design. */
function builtSide(ctx: BotsCtx, d: ArtData): Node {
  const j = d.job;
  if (!j) {
    const build = buildAction(d.art);
    return col([
      sectionLabel("Your real app"),
      card([
        text("Not built yet", { size: 16, weight: 600, lineHeight: 21 }),
        meta("Code bot builds this version into your project with your own components, runs the app, puts it next to the design and fixes any difference before it asks you to review.", { size: 13, lineHeight: 18 }),
        ...(build ? [button("Build it into my app", build, { kind: "primary", size: "md" })] : [meta("This design isn't part of a project yet.", { size: 13 })]),
      ], { gap: 12, padding: 18 }),
    ], { gap: 10, flexGrow: 1, flexBasis: 0, minWidth: 0 });
  }
  const dz = j.agent?.design;
  const match = dz?.match;
  return col([
    row([sectionLabel("Your real app"), grow(), meta(projectName(j.project), { size: 12 })]),
    card([
      statusLine(j.job, ctx.live.now, 14),
      ...(j.agent?.pr ? [meta(`PR #${j.agent.pr.number}${j.agent.verify?.ok ? " · all checks pass" : ""}`, { size: 13 })] : []),
      ...(match !== undefined ? [meter(match, 100, { label: "Matches your design", valueText: `${Math.round(match)}%` })] : []),
      ...(dz ? [meta(dz.skipped ? dz.skipped : dz.round ? `Compared ${dz.round} ${dz.round === 1 ? "time" : "times"} and sent it back to fix the differences.` : "Compares the built screen with this design before review.", { size: 12, lineHeight: 17 })] : []),
      button("Watch it work", open(SCREENS.codeJob, { id: j.job.id }), { kind: "secondary", size: "md" }),
    ], { gap: 12, padding: 18 }),
  ], { gap: 10, flexGrow: 1, flexBasis: 0, minWidth: 0 });
}

function designDesk(ctx: BotsCtx, d: ArtData) {
  const { art } = d;
  const pr = d.job?.agent?.pr;
  const live = liveArt(d, 520);
  return page(ctx, {
    nav: "code", title: art.artifact.title, gap: 22, maxWidth: 1100,
    body: [
      row([
        backButton(),
        text(art.artifact.title, { size: 17, weight: 600, lineHeight: 22 }),
        meta(`In ${projectName(d.job?.project)}'s style · version ${art.version}`, { size: 12 }),
        grow(),
        ...(pr ? [button("Review the PR", { kind: "openUrl", url: pr.url, external: true }, { kind: "primary", size: "md" })] : []),
      ], { gap: 12 }),
      row([
        col([
          sectionLabel("The design you approved"),
          col([live ?? partsView(art), selectedLabel()], { backgroundColor: C.surface, borderRadius: 24, padding: 16, gap: 12 }),
          field("change", "Click any part, then say what to change…", changeAction(art)),
          changing(),
        ], { gap: 12, flexGrow: 1, flexBasis: 0, minWidth: 0 }),
        builtSide(ctx, d),
      ], { gap: 28, alignItems: "flex-start" }),
    ],
    state: { sel: "", selName: "Click a part", change: "", changing: false, ...liveState(live) },
  });
}

function versionRows(ctx: BotsCtx, d: ArtData): Node[] {
  const head = d.art.artifact.headVersion;
  return d.versions.slice().sort((a, b) => b.version - a.version).slice(0, 8).map((v) => {
    const now = v.version === head;
    return row([
      col([
        text(`v${v.version}${now ? " · now" : ""}`, { size: 13, weight: now ? 600 : 500, lineHeight: 17 }),
        meta(v.note || (v.madeBy === "person" ? "Your change" : "Code bot's change"), { size: 12, lines: 1 }),
        meta(ago(v.createdAt, ctx.live.now), { size: 11.5 }),
      ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 1 }),
      ...(now ? [] : [labelled(box([text("Go back", { size: 12, weight: 500, lineHeight: 16 })], { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: C.outline },
        write("POST", `/v1/artifacts/${d.art.artifact.id}/revert`, { version: v.version }, `Back to v${v.version}. Nothing is lost.`, "Couldn't go back. Try again.")), `Go back to version ${v.version}`)]),
    ], { gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, ...(now ? { backgroundColor: C.surface } : {}) });
  });
}

/** The running page's state: point and change on, and nothing heard from it yet. */
const liveState = (live: Node | null): Record<string, unknown> => (live ? { liveSend: { pick: true }, live: null, fixed: null } : {});

/**
 * DPreview's frame around the running page: a phone (300 wide, its bar) or the window's width, by the Phone / Desktop switch. One frame
 * whose look follows state, so switching does not reload the page.
 */
function liveFrame(live: Node): Node {
  return col([
    when({ eq: ["frame", "phone"] }, row([text("9:41", { size: 9.5, weight: 600, lineHeight: 12 }), grow(), box([], { width: 56, height: 14, borderRadius: 7, backgroundColor: C.ink }), grow(), text("5G", { size: 9, lineHeight: 12 })])),
    live,
  ], {
    width: whenEq("frame", "phone", 300, "100%"), borderWidth: whenEq("frame", "phone", 6, 1), borderColor: whenEq("frame", "phone", C.ink, C.line),
    borderRadius: whenEq("frame", "phone", 34, 14), padding: whenEq("frame", "phone", 12, 0), gap: 10, backgroundColor: C.paper, alignSelf: "center", overflow: "hidden",
  });
}

function phoneFrame(inner: Node, width: number): Node {
  return col([
    row([text("9:41", { size: 9.5, weight: 600, lineHeight: 12 }), grow(), box([], { width: 56, height: 14, borderRadius: 7, backgroundColor: C.ink }), grow(), text("5G", { size: 9, lineHeight: 12 })]),
    inner,
  ], { width, borderWidth: 6, borderColor: C.ink, borderRadius: 34, backgroundColor: C.paper, paddingVertical: 12, paddingHorizontal: 12, gap: 10, alignSelf: "center" });
}

/** Share the preview with a space or a person: its name and version, as a card (screens/spaces.ts bots.share). */
const previewShare = (art: ArtifactRead): Node => shareButton({ kind: "preview", ref: art.artifact.id, title: art.artifact.title, text: `A live preview Code bot made: ${art.artifact.title}, version ${art.version}.` });

function previewPhone(ctx: BotsCtx, d: ArtData) {
  const { art } = d;
  const head0 = art.artifact.headVersion;
  const live = liveArt(d, 440);
  return page(ctx, {
    nav: "code", title: "Live preview", gap: 16,
    body: [
      head({
        title: "Live preview", size: 24, weight: 700,
        sub: meta(`${art.artifact.title} · updated ${ago(art.artifact.updatedAt, ctx.live.now)}`, { size: 12, lines: 1 }),
        right: col([versionDots(head0), meta(`v${art.version} of ${head0}`, { size: 12 })], { gap: 4, alignItems: "flex-end" }, { kind: "toggleState", path: "showVersions" }),
      }),
      live ? liveMode() : row([icon("search", { size: 15, color: C.meta }), meta("Point to change: tap any part of the preview.", { size: 13 })], { gap: 6, backgroundColor: C.surface, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 }),
      when({ truthy: "showVersions" }, col(versionRows(ctx, d), { gap: 2 })),
      box([phoneFrame(live ?? partsView(art, { scale: 0.85, max: 22 }), 260)], { backgroundColor: C.surface, borderRadius: 24, paddingVertical: 16, alignItems: "center" }),
      selectedLabel(),
      field("change", "Make this bigger and say 'Book now'", changeAction(art), { ink: true }),
      changing(),
      meta(`Only the part you picked changes. v${head0} stays, so you can go back.`, { size: 12 }),
      previewShare(art),
    ],
    state: { sel: "", selName: "Tap a part", change: "", changing: false, showVersions: false, ...liveState(live) },
  });
}

function previewDesk(ctx: BotsCtx, d: ArtData) {
  const { art } = d;
  const head0 = art.artifact.headVersion;
  const live = liveArt(d, 560);
  return page(ctx, {
    nav: "code", title: "Live preview", gap: 20, maxWidth: 1180,
    body: [
      row([
        backButton(),
        text("Live preview", { size: 20, weight: 700, lineHeight: 26, tracking: -0.3 }),
        meta(`${art.artifact.title} · updated ${ago(art.artifact.updatedAt, ctx.live.now)}`, { size: 13 }),
        grow(),
        box([row([
          box([text("Phone", { size: 13, weight: 500, lineHeight: 17, align: "center" })], { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 10, backgroundColor: whenEq("frame", "phone", C.paper, "transparent") }, { kind: "setState", path: "frame", value: "phone" }),
          box([text("Desktop", { size: 13, weight: 500, lineHeight: 17, align: "center" })], { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 10, backgroundColor: whenEq("frame", "desktop", C.paper, "transparent") }, { kind: "setState", path: "frame", value: "desktop" }),
        ], { gap: 2 })], { padding: 3, borderRadius: 12, backgroundColor: C.surface }),
        ...(live ? [liveMode({ compact: true })] : []),
        previewShare(art),
      ], { gap: 12 }),
      row([
        col([sectionLabel("Versions"), ...versionRows(ctx, d), meta("Every change makes a new version. Older ones stay.", { size: 12, lineHeight: 17 })], { width: 220, flexShrink: 0, gap: 6 }),
        box(live ? [liveFrame(live)] : [
          when({ eq: ["frame", "phone"] }, phoneFrame(partsView(art, { scale: 0.9, max: 30 }), 300)),
          when({ eq: ["frame", "desktop"] }, box([partsView(art, { scale: 1, max: 40 })], { width: "100%", borderWidth: 1, borderColor: C.line, borderRadius: 14, backgroundColor: C.paper, padding: 18 })),
        ], { flexGrow: 1, flexBasis: 0, minWidth: 0, backgroundColor: C.surface, borderRadius: 24, padding: 22, alignItems: "center" }),
        col([
          sectionLabel("Selected"),
          text("Click a part", { size: 14, weight: 600, lineHeight: 19, bind: "selName", lines: 2 }),
          sectionLabel("What should change?"),
          field("change", "Make this button bigger and say 'Book now'", changeAction(art), { compact: true, radius: 16 }),
          changing(),
          meta(`Only that part changes. v${head0} stays, so you can go back.`, { size: 12, lineHeight: 17 }),
          card([
            row([botAvatar(CODE, 24), text("Before Code bot acts", { size: 13, weight: 600, lineHeight: 17 })], { gap: 8 }),
            row([meta("Changes", { size: 12 }), grow(), text("Only the part you picked", { size: 12, lineHeight: 16 })]),
            row([meta("Leaves alone", { size: 12 }), grow(), text("The rest of the page", { size: 12, lineHeight: 16 })]),
            row([meta("Keeps", { size: 12 }), grow(), text(`v${head0}, to go back to`, { size: 12, lineHeight: 16 })]),
          ], { gap: 8, padding: 14, radius: 16 }),
          meta("Click any part of the preview to pick it.", { size: 12 }),
        ], { width: 280, flexShrink: 0, gap: 10 }),
      ], { gap: 22, alignItems: "flex-start" }),
    ],
    state: { sel: "", selName: "Click a part", change: "", changing: false, frame: "phone", ...liveState(live) },
  });
}

function artScreen(kind: "design" | "preview") {
  return (ctx: BotsCtx, d: ArtData | undefined) => {
    if (!d) {
      return page(ctx, {
        back: true, nav: "code", title: kind === "design" ? "Design" : "Live preview",
        body: [emptyState({ pose: "think", title: "Nothing to preview yet", body: "When Code bot makes a design or a component for your project, it shows here, and you can point at any part to change it.", action: { label: "Go to Code bot", onPress: open(SCREENS.code) } })],
      });
    }
    if (kind === "design") return ctx.client === "desktop" ? designDesk(ctx, d) : designPhone(ctx, d);
    return ctx.client === "desktop" ? previewDesk(ctx, d) : previewPhone(ctx, d);
  };
}

// ===================================================================== bots.attach

interface AttachData { files: FileRow[]; job?: JobData; project?: ProjectRow }

function fileTile(f: FileRow, ctx: BotsCtx): Node {
  const kind = f.kind;
  const pic = kind === "image" ? glyph(G.image, { size: 22, color: C.grey70 }) : kind === "video" ? glyph(G.video, { size: 22, color: C.paper })
    : kind === "pdf" ? box([text("PDF", { size: 10, weight: 500, lineHeight: 13 })], { width: 40, height: 28, borderRadius: 4, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center" })
    : glyph(G.file, { size: 22, color: C.grey70 });
  const sub = kind === "video" || kind === "audio" ? (f.durationSeconds ? `${Math.floor(f.durationSeconds / 60)}:${String(Math.round(f.durationSeconds % 60)).padStart(2, "0")}` : "") : ago(f.createdAt, ctx.live.now);
  const pick = seq({ kind: "setState", path: "pick", value: f.id }, { kind: "setState", path: "atts", value: [refOf(f)] }, { kind: "setState", path: "pickName", value: f.name });
  return labelled(col([
    box([pic], {
      height: 72, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: kind === "video" ? C.grey70 : C.surface,
      borderWidth: 1.5, borderColor: whenEq("pick", f.id, C.ink, "transparent"),
    }),
    text(f.name, { size: 12, color: C.grey70, lineHeight: 16, lines: 1 }),
    when({ eq: ["pick", f.id] }, text("Added", { size: 11, weight: 600, lineHeight: 14 })),
    when({ neq: ["pick", f.id] }, meta(sub, { size: 11, lines: 1 })),
  ], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 6 }, pick), `${f.name}, ${sub}`);
}

/** A line under an option: words, or the lines to choose between by what the window reports (each with its own `when`). */
function optionTile(label: string, sub: string | Node[] | undefined, glyphNode: Node, onPress: ActionRef, desk: boolean): Node {
  const subNodes = typeof sub === "string" ? [meta(sub, { size: 12 })] : sub ?? [];
  return labelled(desk
    ? row([box([glyphNode], { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", flexShrink: 0 }),
      col([text(label, { size: 14, weight: 500, lineHeight: 19 }), ...subNodes], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 1 })],
    { gap: 12, padding: 10, borderRadius: 14 }, onPress)
    : col([box([glyphNode], { width: 52, height: 52, borderRadius: 26, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }), text(label, { size: 13, lineHeight: 17, align: "center" })],
      { alignItems: "center", gap: 8, flexGrow: 1, flexBasis: 0 }, onPress), label);
}

function attachScreen(ctx: BotsCtx, d: AttachData | undefined) {
  const projectId = d?.job?.job.projectId ?? (isUuid(ctx.params.project) ? ctx.params.project : undefined);
  if (!projectId) return noProject(ctx);
  const jobId = d?.job?.job.id;
  const c: ChatCtx = { projectId, threadId: jobId ?? (isUuid(ctx.params.thread) ? ctx.params.thread : threadFor(ctx.user?.id ?? "anon", projectId)), ...(jobId ? { jobId } : {}), projectName: projectName(d?.job?.project ?? d?.project) };
  const desk = ctx.client === "desktop";
  const files = (d?.files ?? []).slice(0, desk ? 6 : 4);
  const send: ActionSpec = {
    kind: "condition", if: { falsy: "msg" }, then: {
      kind: "condition", if: { truthy: "pick" }, then: askCode(ctx, c, "Here's the file. Have a look.", { attachments: "$state.atts" }), else: toast("Pick a file or type something first"),
    }, else: askCode(ctx, c, "$state.msg", { from: "msg", attachments: "$state.atts" }),
  };
  const voice: ActionRef = desk ? { kind: "dictate" } : open(SCREENS.ask, { voice: true });
  // A picked file goes up at once (media.ts uploadPick) and is the one this message carries, as a recent one is.
  const picked = seq({ kind: "setState", path: "pick", value: "$state.sent.file.id" }, { kind: "setState", path: "pickName", value: "$state.sent.name" });
  const sendIt = (what: Parameters<typeof uploadPick>[0]) => uploadPick(what, "atts", picked);
  const options = [
    ...(canUpload(ctx) ? [
      optionTile("Photo", desk ? "From this computer" : undefined, glyph(G.image, { size: 22 }), sendIt("photo"), desk),
      // A Mac takes it with its own picker; elsewhere the window has none and asks for a picture you saved (desktop media.js).
      optionTile("Screenshot", desk ? [
        when({ eq: ["desktop.os", "mac"] }, meta("Pick a window or an area", { size: 12 })),
        when({ neq: ["desktop.os", "mac"] }, meta("Pick a screenshot you saved", { size: 12 })),
      ] : undefined, glyph(G.shot, { size: 22 }), sendIt("screenshot"), desk),
      optionTile("Screen recording", desk ? "A video from this computer" : undefined, glyph(G.recording, { size: 22 }), sendIt("video"), desk),
      optionTile("File", desk ? "PDF, Word, CSV, zip" : undefined, glyph(G.file, { size: 22 }), sendIt("file"), desk),
    ] : []),
    optionTile("Link", desk ? "Figma, Drive or any page" : undefined, icon("link", { size: 22 }), { kind: "setState", path: "linkHint", value: true }, desk),
    optionTile("Voice note", desk ? "Say it instead of typing" : undefined, icon("mic", { size: 22 }), voice, desk),
  ];
  const optionRows = options.length > 3 ? col([row(options.slice(0, 3), { gap: 10, alignItems: "flex-start" }), row(options.slice(3), { gap: 10, alignItems: "flex-start" })], { gap: 18 }) : row(options, { gap: 12 });
  const sentChip = canUpload(ctx) ? [uploadChip("atts", { wide: desk, onRemove: seq({ kind: "clearState", path: "pick" }, { kind: "clearState", path: "pickName" }) })] : [];
  const recent = files.length
    ? col([sectionLabel("Recent"), row(files.map((f) => fileTile(f, ctx)), { gap: 10, alignItems: "flex-start" })], { gap: 10 })
    : card([text("Nothing sent yet", { size: 14, weight: 600, lineHeight: 19 }), meta("Files you send to your bots show here, ready to add to any chat. Paste a link below, or say it.", { size: 13, lineHeight: 18 })], { dashed: true, gap: 6, padding: 16 });
  const box1 = col([
    when({ truthy: "linkHint" }, meta("Paste the link in the message. Code bot opens it and reads it.", { size: 12 })),
    ...sentChip,
    field("msg", "Message Code bot", send, { compact: desk }),
    when({ truthy: "asking" }, row([statusMark("working", { color: MOSS }), meta("Sending to Code bot…", { size: 13 })], { gap: 8 })),
  ], { gap: 8 });
  const reads = row([botAvatar(CODE, 24), col([text("Code bot reads designs, PDFs and videos", { size: 13, color: C.grey70, lineHeight: 18 }),
    ...(desk ? [meta(`It uses them only for this chat and never shares them outside ${c.projectName}.`, { size: 12 })] : [])], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 1 })], { gap: 10 });
  const context: Node[] = [
    head({ title: "Code bot", size: 17, sub: meta(c.projectName, { size: 12 }), avatar: true }),
    ...(d?.job ? [mine(d.job.job.task), ...(d.job.agent?.waiting?.question ? [theirs(d.job.agent.waiting.question)] : [])] : []),
  ];
  if (desk) {
    return page(ctx, {
      nav: "code", title: "Add to chat", gap: 20, maxWidth: 1100,
      body: [row([
        col([...context, grow(), box1], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 18 }),
        col([
          row([text("Add to chat", { size: 17, weight: 600, lineHeight: 22 }), grow(), labelled(box([icon("close", { size: 20 })], { width: 40, height: 40, alignItems: "center", justifyContent: "center" }, back()), "Close")]),
          ...options, divider(), recent, grow(), reads,
        ], { width: 340, flexShrink: 0, gap: 8, padding: 20, borderRadius: 20, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }),
      ], { gap: 28, alignItems: "stretch", flexGrow: 1 })],
      state: { msg: "", pick: "", pickName: "", atts: [], linkHint: false, said: null, up: null, sent: null },
    });
  }
  return page(ctx, {
    nav: "code", title: "Add to chat", gap: 16,
    body: context,
    footer: [col([
      row([box([], { width: 36, height: 4, borderRadius: 2, backgroundColor: C.outline })], { justifyContent: "center" }),
      row([text("Add to chat", { size: 17, weight: 600, lineHeight: 22 }), grow(), labelled(box([icon("close", { size: 20 })], { width: 44, height: 44, marginRight: -10, alignItems: "center", justifyContent: "center" }, back()), "Close")]),
      optionRows,
      recent,
      box1,
      reads,
    ], { gap: 14, paddingTop: 10, paddingHorizontal: 20, paddingBottom: 6, marginHorizontal: -20, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: C.line, backgroundColor: C.paper })],
    state: { msg: "", pick: "", pickName: "", atts: [], linkHint: false, said: null, up: null, sent: null },
  });
}

// ===================================================================== bots.done

interface DoneData { job: JobData; shippedThisWeek: number }

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

/** The quiet moment: the Tailzu mark with a few dots in the Code bot's colour around it (Done.dc.html). */
const doneMark = (size: number): Node => shapes([
  ...([[17, 4, 2], [26, 7, 2], [30, 16, 2], [27, 25, 2], [17, 30, 2], [7, 25, 2], [4, 16, 2], [8, 7, 2], [13, 15, 2.6], [21, 15, 2.6]] as Array<[number, number, number]>)
    .map(([x, y, r]) => ({ circle: [x + 8, y + 8, r] as [number, number, number], fill: C.ink, motion: "pop" as const })),
  ...([[3, 10], [47, 8], [2, 36], [48, 38], [12, 49], [40, 2]] as Array<[number, number]>).map(([x, y]) => ({ circle: [x, y, 1.6] as [number, number, number], fill: MOSS, motion: "pop" as const })),
], { size, viewBox: "0 0 50 50", label: "Done" });

function donePhone(ctx: BotsCtx, d: DoneData) {
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

function doneDesk(ctx: BotsCtx, d: DoneData) {
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

function doneScreen(ctx: BotsCtx, d: DoneData | undefined) {
  if (!d) return nothingHere(ctx, "Job");
  if (d.job.job.state !== "done") {
    return isOver(d.job.job.state) ? failedScreen(ctx, d.job) : jobScreen(ctx, { job: d.job });
  }
  return ctx.client === "desktop" ? doneDesk(ctx, d) : donePhone(ctx, d);
}

// ===================================================================== bots.failed

/** "11:42" in the person's own day. */
function clock(ms: number, tzOffsetMinutes: number): string {
  const t = new Date(ms + tzOffsetMinutes * 60_000);
  return `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
}

/** "Tests fail on Node 18." → "tests fail on Node 18" (after a colon), leaving a name or an acronym as it is. */
const lowerFirst = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s).replace(/\.$/, "");

function failTitle(d: JobData): string {
  const why = lowerFirst(firstSentence(d.job.reason || (d.agent?.report?.outcome === "failed" ? d.agent.report.text : ""), 60));
  if (d.job.state === "cancelled") return why ? `Stopped: ${why}` : "Stopped before it finished";
  if (d.job.waitingOn === "budget") return "Paused: it has used a lot of this stretch";
  return why ? `Couldn't finish: ${why}` : "Couldn't finish this one";
}

function failWords(d: JobData): string {
  const r = d.agent?.report;
  const words = r && r.outcome !== "done" ? r.text : d.job.reason;
  return (words || "It stopped before it could finish.").replace(/\s+/g, " ").trim().slice(0, 400) + (d.job.state === "failed" ? " Your branch is as you left it." : "");
}

const RETRY_PAISE = 1500;

/** Try again, thinking it through first: a new job on the same branch, the reason it failed in its task, a small share to use (ours). */
function retryDeeper(d: JobData): ActionSpec {
  const task = `${d.job.task}\n\nThe last try did not finish: ${(d.job.reason || d.agent?.report?.text || "it stopped").slice(0, 400)}\nThink it through first: find the cause before changing anything, then change as little as needed.`;
  return call("POST", "/v1/code/jobs", { projectId: d.job.projectId, branch: d.job.branch, task, budgetPaise: RETRY_PAISE, mode: "guided", planFirst: false }, {
    assignTo: "retry",
    ok: seq(toast("Trying again, more carefully"), open(SCREENS.codeJob, { id: "$state.retry.job.id" })),
    fail: oops("Couldn't start it again. Try again."),
  });
}

function failMoves(ctx: BotsCtx, d: JobData): { primary: { label: string; sub: string; action: ActionRef }; more: ActionRef; stop: { sub: string; action: ActionRef } } {
  const live = !isOver(d.job.state);
  const more = d.agent?.report?.continueWithPaise ?? RETRY_PAISE;
  const c: ChatCtx = { projectId: d.job.projectId, threadId: d.job.id, jobId: d.job.id, projectName: projectName(d.project) };
  const pr = d.agent?.pr;
  return {
    primary: live && d.job.waitingOn === "budget"
      ? { label: "Keep going", sub: "It goes on from where it stopped, and checks with you again before using more.", action: write("POST", jobPath(d.job.id, "/budget"), { addPaise: more }, "Going on", "Couldn't go on. Try again.", open(SCREENS.codeJob, { id: d.job.id })) }
      : { label: "Try again with deeper thinking", sub: "It checks with you before it uses a lot of this stretch.", action: retryDeeper(d) },
    more: askCode(ctx, c, `Why did "${d.job.task.slice(0, 200)}" not finish? Explain the error in plain words and what you would try next.`),
    stop: {
      sub: `Nothing more is used.${pr ? ` PR #${pr.number} stays open for you.` : ""}`,
      action: live ? seq(write("POST", jobPath(d.job.id, d.job.agent ? "/stop" : "/cancel"), {}, "Stopped. Nothing more is used."), back()) : seq(toast("Okay. Nothing more is used."), back()),
    },
  };
}

function triedCard(d: JobData, desk: boolean): Node {
  const list = tries(d.log, 3);
  const mins = Math.max(1, minutesBetween(d.job.createdAt, d.job.updatedAt));
  const rows: Node[] = list.length ? list.map((t, i) => row([
    box([t.ok ? icon("check", { size: 16, weight: 2 }) : glyph(G.failed, { size: 16 })], { height: 20, justifyContent: "center" }),
    col([text(t.title, { size: 14, lineHeight: 19, lines: 2 }), meta(t.result, { size: 12, lines: 1 })], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 }),
    ...(desk ? [meta(`Try ${i + 1}`, { size: 12 })] : []),
  ], { gap: 12, alignItems: "flex-start", paddingVertical: 12, paddingHorizontal: 16 }))
    : linesOf(d, 3).map((l) => row([box([workMark(l.mark, 16)], { height: 20, justifyContent: "center" }), text(l.text, { size: 14, lineHeight: 19, lines: 2, style: { flexShrink: 1 } })], { gap: 12, alignItems: "flex-start", paddingVertical: 12, paddingHorizontal: 16 }));
  const spent = row([text("How long it worked", { size: 14, weight: 600, lineHeight: 19 }), grow(), text(duration(mins), { size: 14, weight: 600, lineHeight: 19 })], { paddingVertical: 13, paddingHorizontal: 16 });
  const kids: Node[] = [];
  [...rows, spent].forEach((r, i) => { if (i) kids.push(divider()); kids.push(r); });
  return col([
    sectionLabel(list.length ? `What it tried · ${list.length} ${list.length === 1 ? "try" : "tries"}` : "What it did"),
    col(kids, { borderWidth: 1, borderColor: C.line, borderRadius: 18 }),
  ], { gap: 8 });
}

/** The end of what each step printed (the logs), as mono lines, at most `max`. */
function logLines(d: JobData, max: number): string[] {
  const out: string[] = [];
  d.steps.filter((s) => s.kind === "exec").forEach((s, i) => {
    out.push(`── Step ${i + 1} · ${s.commands[0] ?? "ran"}`);
    for (const c of s.commands.slice(0, 3)) out.push(`$ ${c}`);
    out.push(...s.outputTail.split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(-8));
  });
  if (!out.length) for (const e of d.log.filter((e) => e.kind === "command")) { out.push(`$ ${e.text}`); if (typeof e.data?.summary === "string") out.push(e.data.summary); }
  return out.slice(-max);
}

function failedPhone(ctx: BotsCtx, d: JobData) {
  const m = failMoves(ctx, d);
  const pr = d.agent?.pr;
  return page(ctx, {
    nav: "code", title: "Couldn't finish", gap: 22,
    body: [
      head({ title: "Code bot", size: 17, avatar: true, sub: meta(`${d.job.task}${pr ? ` · PR #${pr.number}` : ""}`, { size: 12, lines: 1 }) }),
      col([
        labelled(box([glyph(G.failed, { size: 20, weight: 2 })], { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: C.ink, alignItems: "center", justifyContent: "center" }), "Failed"),
        text(failTitle(d), { size: 25, weight: 700, lineHeight: 31, tracking: -0.5 }),
        text(failWords(d), { size: 14, color: C.grey70, lineHeight: 20 }),
      ], { gap: 12 }),
      triedCard(d, false),
    ],
    footer: [
      button(m.primary.label, m.primary.action, { kind: "primary", wide: true }),
      meta(m.primary.sub, { size: 12, align: "center" }),
      button("Tell me more", m.more, { kind: "secondary", wide: true }),
      button("Stop here", m.stop.action, { kind: "quiet", wide: true }),
    ],
    state: { said: null, retry: null },
  });
}

function failedDesk(ctx: BotsCtx, d: JobData) {
  const m = failMoves(ctx, d);
  const pr = d.agent?.pr;
  const logs = logLines(d, 40);
  const mins = Math.max(1, minutesBetween(d.job.createdAt, d.job.updatedAt));
  return page(ctx, {
    nav: "code", title: "Couldn't finish", gap: 24, maxWidth: 1100,
    body: [
      row([
        backButton(), botAvatar(CODE, 36),
        col([title(failTitle(d), { size: 26, lineHeight: 32, lines: 2 }), meta(`Code bot · ${d.job.task}${pr ? ` · PR #${pr.number}` : ""}`, { size: 13, lines: 1 })], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 4 }),
        text(`Stopped at ${clock(d.job.updatedAt, ctx.tzOffsetMinutes)} · ${duration(mins)}`, { size: 13, color: C.grey70, lineHeight: 17 }),
      ], { gap: 12 }),
      row([
        col([text(failWords(d), { size: 15, lineHeight: 22 }), triedCard(d, true)], { width: 372, flexShrink: 0, gap: 18 }),
        col([
          row([sectionLabel("Logs"), grow(), ...(logs.length ? [button("Copy logs", copy(ctx, logs.join("\n"), "Logs copied"), { kind: "secondary", size: "md", icon: undefined })] : [])]),
          logs.length
            ? col(logs.map((l) => text(l, { size: 12, mono: true, lineHeight: 18, color: l.startsWith("──") ? C.meta : l.startsWith("$") ? C.ink : /fail|error|err_/i.test(l) ? C.ink : C.grey70, weight: /fail|error|err_/i.test(l) ? 500 : 400 })), { backgroundColor: C.surface, borderRadius: 16, padding: 16, gap: 1 })
            : card([meta("No logs: it stopped before running anything on a computer.", { size: 13 })], { dashed: true }),
        ], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 10 }),
      ], { gap: 28, alignItems: "flex-start" }),
      labelled(row([
        col([button(m.primary.label, m.primary.action, { kind: "primary", size: "md", wide: true }), meta(m.primary.sub, { size: 12.5, lineHeight: 17 })], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 8 }),
        col([button("Tell me more", m.more, { kind: "secondary", size: "md", wide: true }), meta("Code bot explains the error in plain words and what it would try next.", { size: 12.5, lineHeight: 17 })], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 8 }),
        col([button("Stop here", m.stop.action, { kind: "secondary", size: "md", wide: true }), meta(m.stop.sub, { size: 12.5, lineHeight: 17 })], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 8 }),
      ], { gap: 18, alignItems: "flex-start" }), "What next"),
    ],
    state: { said: null, retry: null },
  });
}

function failedScreen(ctx: BotsCtx, d: JobData | undefined) {
  if (!d) return nothingHere(ctx, "Job");
  if (d.job.state === "done") return ctx.client === "desktop" ? doneDesk(ctx, { job: d, shippedThisWeek: 0 }) : donePhone(ctx, { job: d, shippedThisWeek: 0 });
  if (!isOver(d.job.state) && d.job.waitingOn !== "budget") return jobScreen(ctx, { job: d });
  return ctx.client === "desktop" ? failedDesk(ctx, d) : failedPhone(ctx, d);
}

// ===================================================================== the screens

type Deps = Parameters<NonNullable<BotsScreen["load"]>>[1];

/** Jobs that ended done since Monday, in the person's own week. */
async function shippedThisWeek(ctx: BotsCtx, deps: Deps): Promise<number> {
  const r = await deps.api<{ jobs: Array<{ state: string; updatedAt: number }> }>("GET", "/v1/code/jobs").catch(() => ({ jobs: [] }));
  const local = new Date(ctx.live.now + ctx.tzOffsetMinutes * 60_000);
  const sinceMonday = ((local.getUTCDay() + 6) % 7) * 86_400_000 + (local.getUTCHours() * 60 + local.getUTCMinutes()) * 60_000 + local.getUTCSeconds() * 1000;
  const monday = ctx.live.now - sinceMonday;
  return r.jobs.filter((j) => j.state === "done" && j.updatedAt >= monday).length;
}

export const codeWorkScreens: BotsScreen[] = [
  screen<ChatData>({ id: SCREENS.codeJob, load: loadJobOrChat, build: jobScreen }),
  screen<TeamData>({
    id: SCREENS.team,
    load: async (ctx, deps) => {
      const job = await readJob(deps, ctx.params.id);
      if (!job) throw new Error("no job");
      return { job, team: await deps.api<TeamRead>("GET", jobPath(job.job.id, "/team")) };
    },
    build: teamScreen,
  }),
  screen<ArtData>({ id: SCREENS.design, load: loadArt, build: artScreen("design") }),
  screen<ArtData>({ id: SCREENS.preview, load: loadArt, build: artScreen("preview") }),
  screen<AttachData>({
    id: SCREENS.attach,
    load: async (ctx, deps) => {
      const [files, job, project] = await Promise.all([
        deps.api<{ files: FileRow[] }>("GET", "/v1/files").then((f) => f.files ?? []).catch(() => [] as FileRow[]),
        ctx.params.id !== undefined ? readJob(deps, ctx.params.id).catch(() => undefined) : Promise.resolve(undefined),
        isUuid(ctx.params.project) ? deps.api<{ project: ProjectRow }>("GET", `/v1/code/projects/${ctx.params.project}`).then((x) => x.project).catch(() => undefined) : Promise.resolve(undefined),
      ]);
      return { files, ...(job ? { job } : {}), ...(project ? { project } : {}) };
    },
    build: attachScreen,
  }),
  screen<DoneData>({
    id: SCREENS.done,
    load: async (ctx, deps) => {
      const job = await readJob(deps, ctx.params.id);
      if (!job) throw new Error("no job");
      return { job, shippedThisWeek: await shippedThisWeek(ctx, deps) };
    },
    build: doneScreen,
  }),
  screen<JobData>({ id: SCREENS.failed, load: (ctx, deps) => readJob(deps, ctx.params.id).then((j) => { if (!j) throw new Error("no job"); return j; }), build: failedScreen }),
];
