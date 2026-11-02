/**
 * The Code bot's codeReview screen.
 */

import type { Node, ScreenResponse, ActionRef } from "../../../../../../shared/types/sdui.js";
import { type Hunk, hunkRange } from "../../../../botsCode/linediff.js";
import {
  col, row, box, text, C, type BotsCtx, call, seq, SCREENS, button, quietButton, primaryButton, secondaryButton, open, statusMark, meta,
  notice, grow, page, back, botAvatar, sectionLabel,
} from "../../kit.js";
import {
  type JobView, type Project, type PrStatus, unreachable, str, ENDED, cut, firstLine, plural, codeAsk, toast, boxedField, mergeAction,
  openUrl, MOSS, ASIDE, backButton, tag, CODE, head,
} from "./parts.js";

interface FileChange { path: string; status: string; additions: number; deletions: number; why?: string; hunks: Hunk[] | null }
export interface Changes { files: FileChange[]; totals: { files: number; additions: number; deletions: number }; commits: number; truncated: boolean }

const HIGHLIGHT = "#f2f2f2";

// ===================================================================== bots.code.review (CodeReview / DCodeReview)
export interface ReviewData { view?: JobView; project?: Project; branch: string; changes?: Changes; pr?: PrStatus }

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

export function codeReview(ctx: BotsCtx, d: ReviewData | undefined): ScreenResponse {
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
      row([botAvatar(CODE, 20), text("Xode", { size: 12, weight: 600, lineHeight: 16 }), grow(), ...(f.hunks?.[0] ? [text(hunkRange(f.hunks[0]), { size: 11, mono: true, color: C.meta, lineHeight: 15 })] : [])], { gap: 8 }),
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
      ...(emptyNote ? [emptyNote] : [row([box([sectionLabel(`Changes · ${plural(files.length, "file")}`)], { flexGrow: 1 }), box([sectionLabel("Xode's notes")], { width: 292 })], { gap: 16 }), ...pairs]),
      ...(files.length > 6 ? [meta(`And ${plural(files.length - 6, "more file")}. See them all on GitHub.`)] : []),
    ],
    footer: [row([
      ...(d.pr ? [quietButton("Open on GitHub", openUrl(`${d.pr.url}/files`), { size: "md", icon: "link" })] : []), grow(), mergingNote, askBtn, mergeBtn,
    ], { gap: 12, borderTopWidth: 1, borderTopColor: C.divider, paddingTop: 14 }), changeBox],
  });
}
