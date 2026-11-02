/**
 * The Code bot's projectHome screen.
 */

import type { ActionSpec, Node, ScreenResponse } from "../../../../../../shared/types/sdui.js";
import { type BrainLite, health, firstTasks, isEmptyRepo, stackChips, placeOf, checksOf } from "../../../../botsCode/brain.js";
import {
  type Mark, type BotsCtx, C, open, SCREENS, spanOf, whenWords, row, meta, icon, labelled, box, text, col, button, statusMark, meter, grow,
  secondaryButton, sectionLabel, page, headerBuddy, bigNumber, botAvatar, title,
} from "../../kit.js";
import {
  type Job, ago, cut, firstLine, MOSS, type MeetData, type OverviewData, type Project, short, tag, plural, backButton, CODE_BUSY,
  startTask, taskBar, field, roundInk, ENDED, clock, CODE,
} from "./parts.js";

export interface Branch { branch: string; task: string; prNumber: number | null; prUrl: string | null; state: string; createdAt: number }

const owner = (fullName: string): string => (fullName.includes("/") ? `${fullName.split("/")[0]}/` : "");

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

// ===================================================================== Xode home (CodeHome / DCodeHome)
export type HomeData =
  | { kind: "off" }
  | { kind: "meet"; meet: MeetData }
  | { kind: "overview"; overview?: OverviewData }
  | { kind: "project"; project: Project; brain?: BrainLite; jobs: Job[]; branches: Branch[] };

/** Near the usage limit, or at it: one calm line, a tap to Usage (src/you/usage.ts). Nothing while there is plenty left. */
function usageNote(ctx: BotsCtx): Node[] {
  const u = ctx.live.usage;
  if (u.state === "ok") return [];
  const span = spanOf(ctx);
  const when = u.resetsAt ? ` It resets ${whenWords(u.resetsAt, ctx.live.now, ctx.tzOffsetMinutes)}.` : "";
  const words = u.state === "out" ? `You've reached ${span}'s limit.${when}` : `You've used most of ${span}.${when}`;
  return [row([meta(words, { size: 12, lineHeight: 16, style: { flexShrink: 1 } }), icon("chevron", { size: 14, color: C.meta })], { gap: 6 }, open(SCREENS.usage))];
}

export function projectHome(ctx: BotsCtx, d: Extract<HomeData, { kind: "project" }>): ScreenResponse {
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
  const bookBtn = labelled(box([icon("book", { size: desk ? 18 : 20 })], { width: rs, height: rs, borderRadius: rs / 2, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    open(SCREENS.projectBook, { project: p.id })), "Project book");
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
      nav: "code", title: `Xode · ${name}`,
      body: [
        row([backButton(), col([text("Xode", { size: 20, weight: 600, tracking: -0.3, lineHeight: 25 }), text(p.fullName, { size: 13, mono: true, color: C.meta, lineHeight: 17, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
          ...headerBuddy(ctx, "code", { width: 64, lookTo: "down", thinkWhen: CODE_BUSY }), branchTag, bookBtn, rules], { gap: 8 }),
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
    field("task", `Tell Xode what to do in ${name}…`, { multiline: true, size: 19, minHeight: 81, label: "Tell Xode what to do" }),
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
      box([text(x.branch.startsWith("tailzu/") ? "Xode" : "Handed over", { size: 13, color: C.grey70, lineHeight: 17, lines: 1 })], { width: 90 }),
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
    nav: "code", title: `Xode · ${name}`, maxWidth: 1100, gap: 18,
    state: { task: "" },
    body: [
      row([
        botAvatar(CODE, 36),
        row([text(owner(p.fullName), { size: 26, weight: 500, color: C.meta, tracking: -0.5, lineHeight: 32 }), title(name)], { flexShrink: 1 }),
        branchTag, ...headerBuddy(ctx, "code", { lookTo: "down", thinkWhen: CODE_BUSY }), grow(),
        ...(building || empty ? [] : [row([statusMark("done"), text("I've read your project", { size: 13, color: C.grey70, lineHeight: 17 })], { gap: 7 })]),
        ...(chipsOf.length ? [row(chipsOf.map((c) => tag(c, { mono: true })), { gap: 6, flexShrink: 1, overflow: "hidden" })] : []),
        bookBtn,
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
