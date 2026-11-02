/**
 * The Code bot at work's failed screen.
 */

import type { ActionSpec, ActionRef, Node } from "../../../../../../shared/types/sdui.js";
import { firstSentence, isOver, projectName, tries, minutesBetween } from "../../../../botsCodeWork/read.js";
import {
  type BotsCtx, spanOf, call, seq, open, SCREENS, back, row, box, icon, col, text, meta, grow, duration, divider, sectionLabel, C, page,
  labelled, button, botAvatar, title, card,
} from "../../kit.js";
import { jobScreen } from "./job.js";
import {
  type JobData, toast, oops, type ChatCtx, write, jobPath, askCode, glyph, G, linesOf, workMark, head, backButton, CODE, nothingHere,
  doneDesk, donePhone,
} from "./parts.js";

/** Copy text: the phone's clipboard action, or the window's. */
function copy(ctx: BotsCtx, content: string, said: string): ActionSpec {
  return ctx.client === "desktop" ? { kind: "copyText", text: content, message: said } : { kind: "copyToClipboard", text: content, toastMessage: said };
}

// ===================================================================== bots.failed

/** "11:42" in the person's own day. */
function clock(ms: number, tzOffsetMinutes: number): string {
  const t = new Date(ms + tzOffsetMinutes * 60_000);
  return `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
}

/** "Tests fail on Node 18." → "tests fail on Node 18" (after a colon), leaving a name or an acronym as it is. */
const lowerFirst = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s).replace(/\.$/, "");

function failTitle(ctx: BotsCtx, d: JobData): string {
  const why = lowerFirst(firstSentence(d.job.reason || (d.agent?.report?.outcome === "failed" ? d.agent.report.text : ""), 60));
  if (d.job.state === "cancelled") return why ? `Stopped: ${why}` : "Stopped before it finished";
  if (d.job.waitingOn === "budget") return `Paused: it has used a lot of ${spanOf(ctx)}`;
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
      : { label: "Try again with deeper thinking", sub: `It checks with you before it uses a lot of ${spanOf(ctx)}.`, action: retryDeeper(d) },
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
      head({ title: "Xode", size: 17, avatar: true, sub: meta(`${d.job.task}${pr ? ` · PR #${pr.number}` : ""}`, { size: 12, lines: 1 }) }),
      col([
        labelled(box([glyph(G.failed, { size: 20, weight: 2 })], { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: C.ink, alignItems: "center", justifyContent: "center" }), "Failed"),
        text(failTitle(ctx, d), { size: 25, weight: 700, lineHeight: 31, tracking: -0.5 }),
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
        col([title(failTitle(ctx, d), { size: 26, lineHeight: 32, lines: 2 }), meta(`Xode · ${d.job.task}${pr ? ` · PR #${pr.number}` : ""}`, { size: 13, lines: 1 })], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 4 }),
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
        col([button("Tell me more", m.more, { kind: "secondary", size: "md", wide: true }), meta("Xode explains the error in plain words and what it would try next.", { size: 12.5, lineHeight: 17 })], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 8 }),
        col([button("Stop here", m.stop.action, { kind: "secondary", size: "md", wide: true }), meta(m.stop.sub, { size: 12.5, lineHeight: 17 })], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 8 }),
      ], { gap: 18, alignItems: "flex-start" }), "What next"),
    ],
    state: { said: null, retry: null },
  });
}

export function failedScreen(ctx: BotsCtx, d: JobData | undefined) {
  if (!d) return nothingHere(ctx, "Job");
  if (d.job.state === "done") return ctx.client === "desktop" ? doneDesk(ctx, { job: d, shippedThisWeek: 0 }) : donePhone(ctx, { job: d, shippedThisWeek: 0 });
  if (!isOver(d.job.state) && d.job.waitingOn !== "budget") return jobScreen(ctx, { job: d });
  return ctx.client === "desktop" ? failedDesk(ctx, d) : failedPhone(ctx, d);
}
