/**
 * The Code bot at work's attach screen.
 */

import type { Node, ActionRef, ActionSpec } from "../../../../../../shared/types/sdui.js";
import { type FileRow, type ProjectRow, ago, refOf, isUuid, projectName } from "../../../../botsCodeWork/read.js";
import {
  type BotsCtx, C, box, text, seq, labelled, col, whenEq, when, meta, row, open, SCREENS, icon, sectionLabel, card, statusMark, botAvatar,
  page, grow, back, divider,
} from "../../kit.js";
import { uploadPick, canUpload, uploadChip } from "../../media.js";
import { type JobData, glyph, G, noProject, type ChatCtx, threadFor, askCode, toast, field, MOSS, CODE, head, mine, theirs } from "./parts.js";

// ===================================================================== bots.attach
export interface AttachData { files: FileRow[]; job?: JobData; project?: ProjectRow }

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

export function attachScreen(ctx: BotsCtx, d: AttachData | undefined) {
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
    when({ truthy: "linkHint" }, meta("Paste the link in the message. Xode opens it and reads it.", { size: 12 })),
    ...sentChip,
    field("msg", "Message Xode", send, { compact: desk }),
    when({ truthy: "asking" }, row([statusMark("working", { color: MOSS }), meta("Sending to Xode…", { size: 13 })], { gap: 8 })),
  ], { gap: 8 });
  const reads = row([botAvatar(CODE, 24), col([text("Xode reads designs, PDFs and videos", { size: 13, color: C.grey70, lineHeight: 18 }),
    ...(desk ? [meta(`It uses them only for this chat and never shares them outside ${c.projectName}.`, { size: 12 })] : [])], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 1 })], { gap: 10 });
  const context: Node[] = [
    head({ title: "Xode", size: 17, sub: meta(c.projectName, { size: 12 }), avatar: true }),
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
