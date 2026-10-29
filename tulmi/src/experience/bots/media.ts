/**
 * THE BOTS APP'S MEDIA PARTS: send a picked file, speak into Ask (the phone), play a sound. Built from the kit like any
 * screen part; each is drawn only for a build that declares the ability (shared/types/sdui.ts, section 3d):
 *
 *   FileUpload   uploadPick(): the renderer picks a file and sends it to POST /v1/files with progress (`up` in state),
 *                the answer lands in `sent`, its attachment ref in the screen's list; uploadChip() draws both moments.
 *   VoiceRecord  listenAction() / voiceBars() / micBlockedNotice(): the phone records, /v1/transcribe-clean writes the
 *                words into the field; `voice` is "listening" · "busy" · "idle" and `level` follows the voice.
 *   AudioPlay    playButton() / playingLine(): one sound at a time from a server path; `playing` holds which and how far.
 *
 * Nothing here reads data. The state paths are fixed so the parts fit together on any screen: up, sent, voice, level,
 * micBlocked, playing.
 */
import type { ActionRef, ActionSpec, Condition, Node, UploadPick } from "../../../../shared/types/sdui.js";
import { AUDIO_PLAY_CAPABILITY, FILE_UPLOAD_CAPABILITY, VOICE_RECORD_CAPABILITY } from "../../../../shared/types/sdui.js";
import { box, C, col, icon, labelled, meta, row, seq, statusMark, text, when, whenEq, type BotsCtx } from "./kit.js";

/** The most a file may be: the upload route's own limit (media/types.ts CAP_MAX); each kind has a lower cap it words itself. */
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export const canUpload = (ctx: BotsCtx): boolean => ctx.can.has(FILE_UPLOAD_CAPABILITY);
export const canPlay = (ctx: BotsCtx): boolean => ctx.can.has(AUDIO_PLAY_CAPABILITY);
/** Speaking inside the app is the phone's; the window has its own (Fn, `dictate`). */
export const canRecord = (ctx: BotsCtx): boolean => ctx.client === "phone" && ctx.can.has(VOICE_RECORD_CAPABILITY);

const toastError = (message: string): ActionSpec => ({ kind: "toast", message, tone: "error" });

// ===================================================================== send a file

/**
 * Pick a file of `pick`'s kind and send it. On the way `up` holds its name and how far it is; then `sent` holds the
 * answer (with `name` and `size`), `list` is that one file's attachment ref (what an ask carries), and `then` runs.
 * A refusal is shown in the server's own words ("That file is over 25 MB…"), or plainly when there are none.
 */
export function uploadPick(pick: UploadPick, list: string, then?: ActionRef): ActionSpec {
  return {
    kind: "uploadFile", pick, path: "/v1/files", assignTo: "sent", progressTo: "up", maxBytes: UPLOAD_MAX_BYTES,
    onSuccess: seq(
      { kind: "clearState", path: list },
      { kind: "appendState", path: list, value: "$state.sent.attachment" },
      then,
    ),
    onError: seq({ kind: "clearState", path: "up" }, toastError("$event")),
  };
}

/** Take the sent file off the ask. */
export const dropSent = (list: string): ActionRef => seq({ kind: "clearState", path: "sent" }, { kind: "clearState", path: list });

const sending: Condition = { truthy: "up.name" };
const sentOne: Condition = { all: [{ truthy: "sent.name" }, { falsy: "up.name" }] };

/** A bar in `segments` steps that fills as `path` (0-100) grows: plain boxes, so both clients draw it from state. */
export function stateBar(path: string, o: { color?: string; segments?: number; height?: number } = {}): Node {
  const n = o.segments ?? 20;
  const h = o.height ?? 4;
  const step = 100 / n;
  return row(Array.from({ length: n }, (_, i) => box([], {
    flexGrow: 1, flexBasis: 0, height: h,
    backgroundColor: { gte: [path, Math.round((i + 1) * step)], then: o.color ?? C.ink, else: C.track },
    ...(i === 0 ? { borderTopLeftRadius: h / 2, borderBottomLeftRadius: h / 2 } : {}),
    ...(i === n - 1 ? { borderTopRightRadius: h / 2, borderBottomRightRadius: h / 2 } : {}),
  })), { gap: 0, flexGrow: 1, flexShrink: 1, minWidth: 0, alignItems: "center" });
}

/**
 * The file on its way, then the file on the ask: its name and how far it is with a bar; once sent, a clip, its name
 * and size, and a cross that takes it off (`list` is the ask's attachments).
 */
export function uploadChip(list: string, o: { wide?: boolean; onRemove?: ActionRef } = {}): Node {
  const chipStyle = {
    gap: 8, paddingVertical: 7, paddingLeft: 12, paddingRight: 6, borderRadius: 16, borderWidth: 1, borderColor: C.line,
    backgroundColor: C.paper, alignSelf: o.wide ? "stretch" : "flex-start", maxWidth: "100%",
  };
  return col([
    when(sending, col([
      row([
        statusMark("working", { color: C.ink }),
        text("", { size: 13, lineHeight: 17, lines: 1, bind: "up.name", style: { flexShrink: 1 } }),
        text("", { size: 12, color: C.meta, lineHeight: 16, bind: "up.percent", style: { flexShrink: 0 } }),
      ], { gap: 8, minHeight: 30 }),
      row([stateBar("up.pct")], { paddingRight: 6 }),
    ], { ...chipStyle, gap: 6, paddingRight: 12, ...(o.wide ? {} : { minWidth: 220 }) })),
    when(sentOne, row([
      icon("clip", { size: 16 }),
      text("", { size: 13, lineHeight: 17, lines: 1, bind: "sent.name", style: { flexShrink: 1 } }),
      text("", { size: 12, color: C.meta, lineHeight: 16, bind: "sent.size", style: { flexShrink: 0 } }),
      labelled(box([icon("close", { size: 14, color: C.meta })], { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", flexShrink: 0 },
        seq(dropSent(list), o.onRemove)), "Take the file off"),
    ], chipStyle)),
  ], { gap: 0 });
}

// ===================================================================== speak (the phone)

/**
 * The mic: start listening, or (while it listens) stop and write the words into `field`, after what is there. `done`
 * runs with the words in. Refused for good: `micBlocked` (the notice offers Settings).
 */
export function listenAction(field: string, done?: ActionRef): ActionSpec {
  return {
    kind: "recordVoice", assignTo: field, statePath: "voice", levelTo: "level", append: true, maxSeconds: 120,
    ...(done ? { onDone: done } : {}),
    onError: toastError("$event"),
    onBlocked: { kind: "setState", path: "micBlocked", value: true },
  };
}

export const listening: Condition = { eq: ["voice", "listening"] };
export const writingDown: Condition = { eq: ["voice", "busy"] };
export const notListening: Condition = { all: [{ neq: ["voice", "listening"] }, { neq: ["voice", "busy"] }] };

/** The voice bars: still while nobody speaks, each standing up as the voice gets louder (`level`, 0-1). */
export function voiceBars(heights: number[], o: { live?: boolean } = {}): Node {
  const top = Math.max(...heights);
  // Each bar stands at its own loudness, so a voice fills them from the middle out.
  const order = heights.map((_, i) => Math.abs(i - (heights.length - 1) / 2));
  const far = Math.max(...order) || 1;
  return row(heights.map((h, i) => box([], {
    width: 3, borderRadius: 2, backgroundColor: C.ink,
    height: o.live ? { gte: ["level", Math.round((0.1 + 0.4 * (order[i]! / far)) * 10) / 10], then: h, else: 4 } : h,
  })), { gap: heights.length > 8 ? 3 : 2, height: top, alignItems: "center" });
}

/** The microphone was refused for good: say so, and offer the phone's Settings. */
export function micBlockedNotice(): Node {
  return when({ truthy: "micBlocked" }, row([
    icon("mic", { size: 16, color: C.meta }),
    text("The microphone is off for X0 Bot.", { size: 13, color: C.grey70, lineHeight: 18, style: { flexShrink: 1 } }),
    text("Open Settings", { size: 13, weight: 600, lineHeight: 18 }),
  ], { gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: C.surface, alignSelf: "flex-start" },
  seq({ kind: "setState", path: "micBlocked", value: false }, { kind: "openSettings" })));
}

// ===================================================================== play a sound

const PLAY = "M8 5.5v13l10.5-6.5z";
const PAUSE = "M6.5 5h4v14h-4zM13.5 5h4v14h-4z";

function solid(d: string, color: string, size = 16): Node {
  return { type: "SVG", props: { viewBox: "0 0 24 24", d, fill: color, stroke: "none" }, style: { width: size, height: size, flexShrink: 0 } };
}

/** Is this the sound that is playing? */
export const isPlaying = (id: string): Condition => ({ eq: ["playing.id", id] });

/**
 * A round play button (44): an outline with a play mark; while its sound plays, ink with a pause mark, and a press
 * stops it. `url` is a server path; "$state.x" in it is filled in when it is pressed.
 */
export function playButton(id: string, url: string, label: string): Node {
  return labelled(box([
    when({ neq: ["playing.id", id] }, solid(PLAY, C.ink)),
    when(isPlaying(id), solid(PAUSE, C.paper)),
  ], {
    width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", flexShrink: 0,
    borderWidth: 1, borderColor: whenEq("playing.id", id, C.ink, C.outline), backgroundColor: whenEq("playing.id", id, C.ink, C.paper),
  }, {
    kind: "condition", if: isPlaying(id),
    then: { kind: "stopAudio" },
    else: { kind: "playAudio", url, id, statePath: "playing", onError: toastError("$event") },
  }), label);
}

/** Under the sound that plays: how far it is, as a bar in `color`, and "0:02 / 0:05". */
export function playingLine(id: string, color: string): Node {
  return when(isPlaying(id), row([
    stateBar("playing.pct", { color }),
    text("", { size: 12, mono: true, color: C.meta, lineHeight: 16, bind: "playing.time", style: { flexShrink: 0 } }),
  ], { gap: 10, paddingLeft: 4 }));
}

/** What a line says while its sound plays (" · playing" after it), and otherwise. */
export function playingSub(id: string, words: string): Node[] {
  return [
    when({ neq: ["playing.id", id] }, meta(words, { size: 12 })),
    when(isPlaying(id), meta(`${words} · playing`, { size: 12 })),
  ];
}
