/**
 * The Code bot's prCare screen.
 */

import type { ScreenResponse } from "../../../../../../shared/types/sdui.js";
import {
  type Mark, type BotsCtx, page, emptyState, open, SCREENS, col, row, box, text, C, statusMark, meta, grow, icon, primaryButton, button,
  quietButton, call, seq, botAvatar, sectionLabel,
} from "../../kit.js";
import {
  type Project, type PrStatus, unreachable, short, plural, clock, cut, mergeAction, toast, REFRESH, head, subLine, CODE, tag, MOSS,
  withAside,
} from "./parts.js";

export interface CarePull {
  prNumber: number; branch: string; origin: string; prUrl: string | null; title: string | null; ended: string | null;
  checks: { outcome: string; names: string[]; note: string } | null;
  conflict: { outcome: string; note: string } | null;
  waiting: { jobId: string; text: string } | null;
  working: Array<{ jobId: string; kind: string }>;
  notes: Array<{ at: number; text: string }>;
}

export interface Comment { author: string; body: string; path?: string; line?: number; createdAt: number }

// ===================================================================== bots.code.pr-care (PRCare / DPRCare)
export interface CareData {
  project?: Project; pull?: CarePull; branch: string; pr?: PrStatus; comments: Comment[]; diff?: { commits: unknown[]; totals: { files: number } };
  spentPaise: number; latestJob?: string; careOff: boolean;
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

export function prCare(ctx: BotsCtx, d: CareData | undefined): ScreenResponse {
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
        col([sectionLabel("What Xode did"), timeline], { gap: 10 }),
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
      head(ctx, { title: `PR #${n}`, sub: subLine([`${cut(prTitle, 50)} ·`, { code: name }, `· ${pull?.origin === "handed" ? "handed to Xode" : "opened by Xode"}`], 13), to: open(SCREENS.code, { project: p.id }),
        right: tags.length ? [row(tags.map((t) => tag(t)), { gap: 6 })] : [] }),
      meta(`Xode keeps the PR green until you merge${fixNote ? "" : "."}`, { size: 12 }),
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
    col([sectionLabel("What Xode did"), timeline], { gap: 10 }),
    grow(),
    ...(release ? [release] : []),
  ], 360);
}
