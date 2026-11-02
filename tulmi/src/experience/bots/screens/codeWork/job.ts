/**
 * The Code bot at work's job screen.
 */

import type { ActionSpec, Node, ActionRef } from "../../../../../../shared/types/sdui.js";
import {
  type WorkLine, type JobRow, isOver, approvalLineOf, type ProjectRow, isUuid, projectName, stageOf, STAGES, firstSentence,
} from "../../../../botsCodeWork/read.js";
import type { ChatTurn } from "../../../../code/chat/threads.js";
import { askMoment } from "../../askMoment.js";
import {
  seq, call, col, row, box, text, C, meta, percent, grow, meter, type BotsCtx, statusMark, button, card, spanOf, labelled, icon, open,
  SCREENS, when, FACE, RADIUS, page, stages,
} from "../../kit.js";
import {
  toast, refresh, oops, workMark, type JobData, write, jobPath, field, stopJob, type ChatCtx, threadFor, mine, theirs, MOSS, askCode,
  noProject, head, half, glyph, G, statusLine, linesOf, ASIDE, nothingHere,
} from "./parts.js";

/** A yes that the server may first answer with a question ({ needsApproval, approvalId }): say it again with the id. */
function twoStep(path: string, ok: string): ActionSpec {
  const done = seq(toast(ok), refresh);
  return call("POST", path, {}, {
    assignTo: "yes",
    ok: { kind: "condition", if: { truthy: "yes.needsApproval" }, then: call("POST", path, { approvalId: "$state.yes.approvalId" }, { ok: done, fail: oops("That yes ran out. Try again.") }), else: done },
    fail: oops("Couldn't send that. Try again."),
  });
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

// ===================================================================== the one quick question

/** The decision a waiting job needs: its question, a yes, keep going, paid compute, a commit. Null when it needs nothing. */
function quickQuestion(ctx: BotsCtx, d: JobData, o: { compact?: boolean } = {}): Node | null {
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
    const q = w?.question ?? job.reason ?? "Xode has a question.";
    const opts = (w?.options ?? []).filter((x) => x.trim()).slice(0, 3);
    const answer = (s: string) => write("POST", jobPath(job.id, "/answer"), { answer: s }, "Sent to Xode", "Couldn't send that. Try again.");
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
      btn("No", write("POST", jobPath(job.id, "/deny"), {}, "Told Xode no"), "secondary"),
    ])]);
  }
  if (job.waitingOn === "budget" || w?.kind === "budget") {
    const more = agent?.report?.continueWithPaise ?? Math.max(1000, Math.round(job.spentPaise / 200) * 100);
    return shell([label("Needs your yes"), ask(`This job has used a lot of ${spanOf(ctx)}. Keep going?`), choices([
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

/**
 * "New chat": a thread of its own, the way a chat starts afresh. Its id comes from the thread it leaves and how far that went, so the button
 * on a page kept in the cache still opens a new thread once the old one has moved on, and the same one while it has not.
 */
function nextThread(userId: string, c: Pick<ChatCtx, "projectId" | "threadId">, turns: number): string {
  return threadFor(userId, `${c.projectId}:after:${c.threadId}:${turns}`);
}

/** The "New chat" button, on a chat that has something in it. */
function newChat(ctx: BotsCtx, c: ChatCtx, turns: number): Node {
  return labelled(row([icon("plus", { size: 16, color: C.ink }), text("New chat", { size: 13, weight: 500, lineHeight: 17 })], {
    gap: 4, alignItems: "center", borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 10, flexShrink: 0,
  }, open(SCREENS.codeJob, { project: c.projectId, thread: nextThread(ctx.user?.id ?? "anon", c, turns) })), "New chat");
}

/** The turns of a project chat drawn in full; the ones before them fold behind "Show earlier", each as its question and its answer's start. */
const SHOW_TURNS = 4;
const FOLDED_ANSWER = 280;

/** The chat about the project so far: the last SHOW_TURNS turns in full, the earlier ones folded. A long chat stays one light page. */
function history(turns: readonly ChatTurn[], size: number, show = SHOW_TURNS, fold = "earlier"): Node[] {
  const full = show > 0 ? turns.slice(-show) : [];
  const folded = turns.slice(0, Math.max(0, turns.length - show));
  const out: Node[] = [];
  if (folded.length) {
    out.push(when({ falsy: fold }, labelled(row([
      icon("down", { size: 16, color: C.meta }),
      meta(`Show ${folded.length} earlier ${folded.length === 1 ? "question" : "questions"}`, { size: 13 }),
    ], { gap: 6, alignItems: "center", alignSelf: "center", paddingVertical: 6 }, { kind: "toggleState", path: fold }), "Show earlier questions")));
    out.push(when({ truthy: fold }, col(folded.flatMap((t) => [
      mine(t.q, size - 1),
      text(clip(t.a.replace(/[#*`_]/g, "").replace(/\s+/g, " ").trim(), FOLDED_ANSWER), { size: size - 2, lineHeight: Math.round((size - 2) * 1.45), color: C.meta }),
    ]), { gap: 10 })));
  }
  for (const t of full) out.push(mine(t.q, size), t.a ? theirs(t.a, { size }) : meta("Xode didn't send words back.", { size: 13 }));
  return out;
}
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * The conversation, the way a chat keeps it: the project chat a job was started from (its last turns, the rest folded); the job, what was
 * asked, its questions and the answers, what it said at the end; then the chat so far (the job's own, or the project's), and the question
 * just asked.
 */
function conversation(d: JobData | undefined, p: { asked?: string; answer?: string; flow?: string[]; turns?: readonly ChatTurn[]; before?: readonly ChatTurn[] }, size: number): Node[] {
  const out: Node[] = [];
  if (p.before?.length) out.push(...history(p.before, size, 2, "earlierBefore"));
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
  const turns = p.turns ?? [];
  // The question just asked is the chat's last turn once it is kept; drawn from the params only when it was not.
  const kept = !!p.asked && turns.at(-1)?.q === p.asked.trim();
  if (turns.length) {
    // The question just asked counts as one of the turns drawn in full.
    out.push(...(kept ? history(turns.slice(0, -1), size, SHOW_TURNS - 1) : history(turns, size, p.asked ? SHOW_TURNS - 1 : SHOW_TURNS)));
  }
  if (p.asked) {
    out.push(mine(p.asked, size));
    out.push(p.answer ? theirs(p.answer, { size, ...(p.flow ? { flow: p.flow } : {}) }) : meta("Xode didn't send words back. Ask again?", { size: 13 }));
  }
  return out;
}

/** The composer: the message box, attach, and (in the window) speak. A live job hears it as a message, a question as its answer. */
/** The moment an ask is out (askMoment.ts): the person's words and Xode carrying them, under the chat's last turn. */
const chatMoment = (ctx: BotsCtx): Node => askMoment(ctx, { slug: "code", color: MOSS, kind: "code", busy: "asking", line: "Asking Xode…" });

function composer(ctx: BotsCtx, c: ChatCtx, d: JobData | undefined, placeholder: string, o: { moment?: boolean } = {}): Node {
  const job = d?.job;
  const live = job && !isOver(job.state);
  const send: ActionRef = live
    ? job!.waitingOn === "answer"
      ? seq(write("POST", jobPath(job!.id, "/answer"), { answer: "$state.msg" }, "Sent to Xode"), { kind: "clearState", path: "msg" })
      : seq(write("POST", jobPath(job!.id, "/message"), { text: "$state.msg" }, "Xode will read it next"), { kind: "clearState", path: "msg" })
    : askCode(ctx, c, "$state.msg", { from: "msg" });
  const guarded: ActionSpec = { kind: "condition", if: { falsy: "msg" }, then: toast("Type what you need first"), else: send };
  const attach = labelled(box([icon("clip", { size: 20, color: C.ink })], { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    open(SCREENS.attach, { ...(job ? { id: job.id } : {}), project: c.projectId, thread: c.threadId })), "Add to chat");
  return col([
    ...(o.moment === false ? [] : [chatMoment(ctx)]),
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

/** What the last answer suggested asking next (its own "Next:" line, code/chat/answer.ts), while it is the last thing on the page. */
function nextOf(turns: readonly ChatTurn[], p: { asked?: string }): string[] {
  const last = turns.at(-1);
  if (!last?.n?.length) return [];
  return !p.asked || last.q === p.asked.trim() ? last.n : [];
}

/** Under the last answer: the questions it suggested, each one tap to ask. None when the answer gave none: nothing is made up. */
function nextMoves(ctx: BotsCtx, c: ChatCtx, next: readonly string[]): Node[] {
  if (!next.length) return [];
  return [col(next.map((q) => labelled(box([text(q, { size: 14, lineHeight: 19, color: C.ink })], {
    borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 12, maxWidth: "100%",
  }, askCode(ctx, c, q)), q)), { gap: 8, alignItems: "flex-start" })];
}

export interface ChatData {
  job?: JobData; project?: ProjectRow; flow?: string[];
  /** The chat so far: the job's own (its thread is the job), else the project's (the thread named, or the latest). */
  chat?: { thread: string | null; turns: ChatTurn[] };
  /** The project chat a job was started from (`from`): drawn above the job. */
  before?: ChatTurn[];
}

function chatCtx(ctx: BotsCtx, data: ChatData | undefined): ChatCtx | null {
  const projectId = data?.job?.job.projectId ?? (typeof ctx.params.project === "string" ? ctx.params.project : "");
  if (!isUuid(projectId)) return null;
  const jobId = data?.job?.job.id;
  const threadId = jobId ?? (isUuid(ctx.params.thread) ? ctx.params.thread : isUuid(data?.chat?.thread) ? data!.chat!.thread! : threadFor(ctx.user?.id ?? "anon", projectId));
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
  const turns = data?.chat?.turns ?? [];
  const talk = conversation(data?.job, { ...p, ...(data?.flow ? { flow: data.flow } : {}), turns, ...(data?.before ? { before: data.before } : {}) }, 15);
  return page(ctx, {
    nav: "code", title: "Xode", gap: 18,
    body: [
      head({ title: "Xode", size: 17, sub: meta(c.projectName, { size: 12 }), avatar: true, ...(turns.length || p.asked ? { right: newChat(ctx, c, turns.length) } : {}) }),
      ...(talk.length ? talk : [col([text("Ask anything about your code.", { size: 16, weight: 500, lineHeight: 22 }), meta("Where something is, how it works, what would break. I answer with the files and lines, and change it when you say so.", { size: 13, lineHeight: 18 })], { gap: 6, paddingTop: 8 })]),
      ...nextMoves(ctx, c, nextOf(turns, p)),
    ],
    footer: [composer(ctx, c, data?.job, "Ask about your code…")],
    state: { msg: "", said: null, earlier: false, earlierBefore: false },
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
    marginTop: -40, marginBottom: -32, marginRight: -48, overflowY: "auto", minHeight: 0,
  });
}

function chatPane(ctx: BotsCtx, data: ChatData, c: ChatCtx): Node {
  const p = askedOf(ctx);
  const d = data.job;
  const turns = data.chat?.turns ?? [];
  const talk = conversation(d, { ...p, ...(data.flow ? { flow: data.flow } : {}), turns, ...(data.before ? { before: data.before } : {}) }, 15);
  const pr = d?.agent?.pr;
  return col([
    row([
      text(c.projectName, { size: 18, weight: 600, lineHeight: 23 }),
      ...(d ? [box([text(d.job.branch, { size: 12, lineHeight: 16, mono: true, lines: 1 })], { borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingVertical: 3, paddingHorizontal: 9, maxWidth: 260 })] : []),
      ...(pr ? [meta(`PR #${pr.number}${pr.ready ? " · ready" : " · draft"}`, { size: 12 })] : []),
      ...(turns.length || p.asked ? [grow(), newChat(ctx, c, turns.length)] : []),
    ], { gap: 10, flexWrap: "wrap", alignItems: "center" }),
    // The messages scroll on their own, and open at the newest (column-reverse starts a scroll at its end); the box stays put under them.
    col([
      col([
        ...(talk.length ? talk : [col([text("Ask anything about your code.", { size: 18, weight: 500, lineHeight: 24 }), meta("Where something is, how it works, what would break. Xode answers with the files and lines, and changes it when you say so.", { size: 14, lineHeight: 20 })], { gap: 6 })]),
        ...nextMoves(ctx, c, nextOf(turns, p)),
        chatMoment(ctx),
      // A short chat sits at the top (the auto margin takes the room under it); a long one opens at its newest turn.
      ], { gap: 20, paddingRight: 32, paddingBottom: 8, marginBottom: "auto" }),
    ], { flexGrow: 1, flexShrink: 1, minHeight: 0, overflowY: "auto", flexDirection: "column-reverse" }),
    box([composer(ctx, c, d, "Ask about the code, or tell Xode what to change…", { moment: false })], { paddingRight: 32, flexShrink: 0 }),
  ], { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0, gap: 16 });
}

function jobDesk(ctx: BotsCtx, data: ChatData) {
  const c = chatCtx(ctx, data);
  if (!c) return noProject(ctx);
  return page(ctx, {
    nav: "code", title: data.job?.job.task ?? "Xode", maxWidth: 1400, fixed: true,
    body: [row([chatPane(ctx, data, c), ...(data.job && data.job.agent?.report?.outcome !== "answer" ? [jobAside(ctx, data.job)] : [])], { alignItems: "stretch", flexGrow: 1, flexShrink: 1, minHeight: 0 })],
    state: { msg: "", said: null, earlier: false, earlierBefore: false },
  });
}

/** Is this job a conversation (or did the person just ask something)? Then the phone draws the chat. */
const isChat = (ctx: BotsCtx, d?: JobData): boolean => !d || d.agent?.report?.outcome === "answer" || !!askedOf(ctx).asked;

export function jobScreen(ctx: BotsCtx, data: ChatData | undefined) {
  if (ctx.params.id !== undefined && !data?.job) return nothingHere(ctx, "Job");
  if (ctx.client === "desktop") return jobDesk(ctx, data ?? {});
  if (isChat(ctx, data?.job)) return chatPhone(ctx, data);
  return jobPhone(ctx, data!.job!);
}
