/**
 * The Code bot at work's team screen.
 */

import type { Node } from "../../../../../../shared/types/sdui.js";
import { type TeamRead, type PartRow, firstSentence, type JobRow, isOver, projectName } from "../../../../botsCodeWork/read.js";
import {
  statusMark, box, row, C, col, text, meta, button, card, botAvatar, grow, labelled, icon, percent, meter, open, SCREENS, type BotsCtx,
  page, type Mark, sectionLabel, divider, title,
} from "../../kit.js";
import { type JobData, MOSS, jobPath, write, CODE, half, glyph, G, stopJob, head, statusLine, ASIDE, backButton, nothingHere } from "./parts.js";

// ===================================================================== bots.code.team
export interface TeamData { team: TeamRead; job: JobData }

type ItemMark = "done" | "working" | "todo" | "failed";
interface TeamItem { text: string; sub?: string; mark: ItemMark }

const BUILT: PartRow["status"][] = ["reviewing", "fixing", "approved", "merged"];
const PART_OVER_BAD: PartRow["status"][] = ["failed", "stopped", "exhausted", "skipped"];

/** A helper's three things: build its part, be checked by the reviewer, be handed to the lead. */
function partItems(p: PartRow): TeamItem[] {
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
function leadItems(t: TeamRead["team"]): TeamItem[] {
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
      memberCard({ name: "Xode · lead", sub: "Splits the job, joins the parts", extra: shareOf(leadSpent, t.budget.totalPaise), items: leadItems(t) }),
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
    { who: whoCell(botAvatar(CODE, 30), "Xode · lead", "Splits the job, joins the parts", shareOf(Math.max(0, t.budget.spentPaise - helpers.reduce((s, p) => s + p.spentPaise, 0)), t.budget.totalPaise)), items: leadItems(t) },
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
          meta(`Xode · a lead and ${helpers.length} ${helpers.length === 1 ? "helper" : "helpers"} · ${projectName(d.job.project)}`, { size: 13 }),
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

export function teamScreen(ctx: BotsCtx, d: TeamData | undefined) {
  if (!d) return nothingHere(ctx, "Team", "This job isn't leading a team, or it couldn't be read. Open the job to see how it's going.");
  return ctx.client === "desktop" ? teamDesk(ctx, d) : teamPhone(ctx, d);
}
