/**
 * The Code bot's readProject screen.
 */

import type { ScreenResponse, Node } from "../../../../../../shared/types/sdui.js";
import { type BrainLite, stackChips } from "../../../../botsCode/brain.js";
import {
  type BotsCtx, row, box, statusMark, text, C, call, primaryButton, open, SCREENS, secondaryButton, meter, meta, blip, col, title, page,
  quietButton, grid, grow, sectionLabel,
} from "../../kit.js";
import { type Project, str, unreachable, short, MOSS, REFRESH, toast, cut, setupBuddy, setupTop, backButton, plural, enterTop } from "./parts.js";

export interface ReadData { brain?: BrainLite; project?: Project; projects?: Project[]; next?: string }

/** The stages of reading a project, by the brain's progress (code/project/build.ts): done, now, still to come. */
const READ_STAGES: Array<[string, number]> = [["Reading the files", 50], ["Mapping how it fits together", 70], ["Learning how your team writes code", 92], ["Checking its health", 100]];

/** Enter3 / DEnter3: reading the project. */
export function readProject(ctx: BotsCtx, d: ReadData | undefined): ScreenResponse {
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
