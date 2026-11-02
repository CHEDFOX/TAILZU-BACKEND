/**
 * The Code bot's overview screen.
 */

import type { ScreenResponse, ActionRef } from "../../../../../../shared/types/sdui.js";
import { firstTasks, builtWith, testsLine } from "../../../../botsCode/brain.js";
import {
  type BotsCtx, type Mark, C, row, box, text, icon, open, SCREENS, col, grow, statusMark, meta, botAvatar, headerBuddy, page, needsCard,
  sectionLabel, duration, meter, percent, title, secondaryButton,
} from "../../kit.js";
import {
  type Project, type Job, cut, MOSS, ago, type OverviewData, unreachable, short, startTask, codeAsk, setupBuddy, backButton, CODE,
  CODE_BUSY, setupTop, taskBar, enterTop,
} from "./parts.js";

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

/** The projects overview: Xode's home with several projects, and the last getting-started step (`setup`). */
export function overview(ctx: BotsCtx, d: OverviewData | undefined, setup = false): ScreenResponse {
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
    const head = row([backButton(), botAvatar(CODE, 40), col([text("Xode", { size: 20, weight: 600, tracking: -0.3, lineHeight: 25 }), text(statusLine, { size: 12, weight: 500, color: working.length ? MOSS : C.meta, lineHeight: 16 })], { gap: 2, flexGrow: 1, flexShrink: 1 }),
      ...(stage ? [] : headerBuddy(ctx, "code", { lookTo: "down", thinkWhen: CODE_BUSY }))], { gap: 10 });
    return page(ctx, {
      back: false, nav: "code", title: "Xode",
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
    title: "Xode", nav: "code", maxWidth: 1100, gap: 18,
    body: [
      ...(stage ? [enterTop(open(SCREENS.codeStart, { step: "pick" }), 4), stage] : []),
      row([
        botAvatar(CODE, 44),
        col([title("Xode"), row(status.length ? status.map((s) => row([statusMark(s.mark, { color: MOSS }), text(s.w, { size: 13, color: C.grey70, lineHeight: 17 })], { gap: 6 })) : [meta(statusLine, { size: 13 })], { gap: 14 })], { gap: 3, flexGrow: 1 }),
        ...(stage ? [] : headerBuddy(ctx, "code", { lookTo: "down", thinkWhen: CODE_BUSY })),
        secondaryButton("Add a project", open(SCREENS.codeStart, { step: "pick" }), { size: "md", icon: "plus" }),
        secondaryButton("Start from scratch", open(SCREENS.newProject), { size: "md" }),
      ], { gap: 14 }),
      ...(need ? [needsCard(need, { layout: "row" })] : []),
      row([col([sectionLabel(`Projects · ${d.projects.length}`), table], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 8 }), running], { gap: 24, alignItems: "flex-start" }),
    ],
    footer: [chipRow, taskBar(ctx, { placeholder: "Tell Xode what to do" })],
  });
}
