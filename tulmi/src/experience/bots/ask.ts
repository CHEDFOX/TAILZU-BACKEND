/**
 * THE ASK BAR (Kit2), and the INSERT CARD that opens from it.
 *
 * It lives here and not in the kit because it needs both halves: the kit's field, buttons and actions, and the media
 * parts' upload (media.ts imports the kit, so the kit cannot import it back).
 *
 * THE SHAPE. A round insert key, a gap, then the type box:
 *
 *     ( + )   [ Ask any bot…                        (mic) ]
 *
 * The key is its OWN circle outside the box rather than another thing crowded inside it, because inserting a file is
 * not part of typing — it is the other way of saying something. A file on its way, and the file once it is on the
 * ask, is a chip above the row (media.ts uploadChip) with a cross that takes it off again.
 *
 * THE CARD. The key blurs the page and pops a small card with the ways in: a photo, the camera, a file, a
 * screenshot, or what is on the clipboard. It is a BotCard in `overlay` — a real modal that blurs what is behind it,
 * with the tiny bot holding it up — and it is drawn inside a `when`, because a BotCard's phases run one way only
 * (wait → open → closing → gone) and a card that must open again every time has to be mounted again every time.
 * Its × and a swipe away come from `onDismiss`.
 *
 * WHERE THE FILE GOES. `uploadPick` sends it to POST /v1/files and puts the attachment ref in `attach`; the ask
 * carries `attachments: $state.attach`, which is the door's own field (routes/bots/botsShell.ts, up to 8), and the
 * door routes on it — a bot with the `files` skill is worth 3 more when a file is there. Nothing new was needed on
 * the way in or out; this is the key that was missing.
 *
 * A build that cannot draw a living card (canMove) gets the attach SCREEN instead, which is what the Ask screen's
 * own attach has always fallen back to. A build that cannot upload at all gets the bar as it was, with no key.
 */
import type { ActionRef, ActionSpec, Condition, Node } from "../../../../shared/types/sdui.js";
import {
  askAction, botCard, box, C, canMove, type Client, col, FACE, icon, labelled, meta, micKey, open, RADIUS, roundButton,
  grow, row, SCREENS, sectionLabel, seq, statusMark, text, when, type BotsCtx,
} from "./kit.js";
import { askMoment } from "./askMoment.js";
import { cardBack } from "./screens/firstRun/parts.js";
import { canUpload, uploadAdd, uploadChip } from "./media.js";

/** Where the insert card's open/closed lives, and where a picked file's ref goes. */
const INSERT = "insert";
const ATTACH = "attach";
/** The same files as pictures still on this phone, in step with ATTACH: what the card draws (media.ts uploadAdd). */
const SHOTS = "shots";
/** The ask door's own limit (routes/bots/botsShell.ts). */
const MOST = 8;

/**
 * What a screen with an ask bar starts with: the card shut, no file on the ask, nothing on its way. Spread into the
 * page's `state` beside the screen's own (`{ ...ASK_BAR_STATE, ... }`).
 */
export const ASK_BAR_STATE = { [INSERT]: false, [ATTACH]: [] as unknown[], [SHOTS]: [] as unknown[], up: null, sent: null };

const shut: ActionSpec = { kind: "setState", path: INSERT, value: false };

/** Any file on the ask. One can be taken off from the middle and leave a gap, so it is any of them, not the first. */
const anyOnAsk: Condition = { any: Array.from({ length: MOST }, (_, i) => ({ truthy: `${ATTACH}.${i}` })) };
/** Take ONE file off the ask: its ref and its picture, at the same place in both lists (the gap is skipped when sent). */
const takeOff = (i: number): ActionRef => seq({ kind: "clearState", path: `${ATTACH}.${i}` }, { kind: "clearState", path: `${SHOTS}.${i}` });

/**
 * One way in, on the card: its icon, its name, and what it opens. A pick SHUTS the card once the file is up, as an
 * attach menu does: the next thing anyone sees is the bar with the file on it, ready to send (askFiles). A pick that is
 * cancelled or fails leaves the card where it was.
 */
function wayIn(name: string, glyph: "clip" | "camera" | "folder" | "computer" | "keyboard", go: ActionRef): Node {
  return labelled(row([
    box([icon(glyph, { size: 18 })], {
      width: 38, height: 38, borderRadius: 19, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", flexShrink: 0,
    }),
    text(name, { size: 16, lineHeight: 21 }),
  ], { gap: 12, minHeight: 52, alignItems: "center" }, go), name);
}

/**
 * ONE PICKED FILE IN THE CARD: the picture itself where there is one, its kind's glyph where there is not.
 *
 * The Image's `source` is BOUND to where the upload left the local copy (`shots.<i>`, an `{ url }` spec — the
 * renderer's `bind` writes any prop from state, and resolveMedia takes that shape). Nothing serves an uploaded
 * file's bytes back, so this local copy is the only picture of it there is; a file with no picture leaves the source
 * undefined, the Image draws nothing, and the glyph underneath is what shows.
 */
function chosen(i: number, size = 64): Node {
  return when({ truthy: `${ATTACH}.${i}` }, box([
    icon("clip", { size: size > 48 ? 17 : 13, color: C.meta }),
    {
      type: "Image", bind: { source: `${SHOTS}.${i}` },
      props: { contentFit: "cover" },
      style: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
    },
  ], {
    width: size, height: size, borderRadius: size > 48 ? 14 : 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0,
  }));
}

/**
 * WHAT IS ON THE ASK, ABOVE THE BAR, the way a chat app shows an attachment before it goes: each file as a small
 * picture (its glyph where there is no picture) with a cross that takes THAT one off, and a send button.
 *
 * The send is here and not only in the box because a photo on its own is a message, and the box's own send stays
 * greyed until something is typed (the apps' field decides that, and an app release is the only way to change it). It
 * sends whatever is typed too, so it is the one send while files are on the ask.
 *
 * The picture is BOUND to where the upload left one (`shots.<i>`): the phone's own copy of what was picked, or the
 * server's signed link to it (routes/files.ts `pic`) on a window that keeps none. A file with no picture shows its glyph.
 */
export function askFiles(o: { send?: ActionRef; desk?: boolean } = {}): Node {
  return when(anyOnAsk, row([
    row(Array.from({ length: MOST }, (_, i) => fileTile(i)), { gap: 8, flexWrap: "wrap", flexShrink: 1, alignItems: "center" }),
    // On the phone the send sits over the box's own, at the right; the window's column is wide and its box is not, so
    // there the send stays beside the files.
    ...(o.desk ? [] : [grow()]),
    ...(o.send ? [roundButton("send", o.send, { size: 40, label: "Send" })] : []),
  ], { gap: 8, alignItems: "flex-end", paddingHorizontal: 4, paddingBottom: 2 }));
}

/** One file on the ask: its picture, and a cross in the corner that takes it off. */
function fileTile(i: number): Node {
  return when({ truthy: `${ATTACH}.${i}` }, box([
    chosen(i, 56),
    box([labelled(box([icon("close", { size: 11, color: C.paper })], {
      width: 22, height: 22, borderRadius: 11, backgroundColor: C.ink, alignItems: "center", justifyContent: "center",
      borderWidth: 2, borderColor: C.paper,
    }, takeOff(i)), "Remove this file")], { position: "absolute", top: 0, right: 0 }),
  ], { width: 62, height: 62, paddingTop: 6, paddingRight: 6 }));
}

/**
 * The card the insert key pops: the page blurred, the tiny bot across the top, and the ways in under him. Inside a
 * `when` so each tap mounts a fresh one — see the note at the top about BotCard's one-way phases.
 *
 * IT GROWS WITH WHAT YOU CHOOSE. The ways in stay where they are and the chosen files appear above them as a
 * wrapping strip of pictures, so the card is taller every time one is added and you can see what is on the ask
 * without closing anything. A card's height follows its content, so nothing here sets one.
 *
 * The picker opens OVER the card (a native sheet goes above everything, this modal included) and the card is still
 * there when it closes, holding the new file. That is why a way in no longer shuts it.
 *
 * WHAT IS MISSING, and it is a vocabulary gap rather than a decision: there is no action that takes ONE item out of
 * a list (`appendState` adds, `clearState` empties — nothing removes an index), so "Clear" takes them all off. A
 * cross per picture needs a new action kind, which is a change to the contract both clients read.
 */
export function insertCard(ctx: BotsCtx, path: string): Node[] {
  if (!canUpload(ctx) || !canMove(ctx)) return [];
  const desk = ctx.client === "desktop";
  const add = (kind: "photo" | "camera" | "file" | "screenshot"): ActionSpec => uploadAdd(kind, { list: ATTACH, shots: SHOTS, max: MOST, then: shut });
  const ways: Node[] = [
    wayIn("Photo", "clip", add("photo")),
    // The camera is a pick of its own, not a photo from the library: the renderer opens it (pickImage, source camera).
    ...(desk ? [] : [wayIn("Camera", "camera", add("camera"))]),
    wayIn("File", "folder", add("file")),
    wayIn("Screenshot", "computer", add("screenshot")),
    wayIn("Paste", "keyboard", seq(shut, { kind: "readClipboard", assignTo: path })),
  ];
  // What is on the ask, above the ways in: it grows the card as it fills.
  const strip = when(anyOnAsk, col([
    row([sectionLabel("On the ask"), grow(), labelled(row([
      text("Clear", { size: 13, weight: 500, lineHeight: 17, color: C.meta }),
    ], { minHeight: 30 }, seq({ kind: "clearState", path: ATTACH }, { kind: "clearState", path: SHOTS })), "Take them all off")], { gap: 8 }),
    row(Array.from({ length: MOST }, (_, i) => chosen(i)), { gap: 8, flexWrap: "wrap" }),
  ], { gap: 8, paddingBottom: 6 }));
  // THE WAY OUT IS THE SERVER'S (firstRun/parts.ts cardBack). The apps draw nothing: an overlay card is a modal, so
  // they answer only what markup cannot — a swipe to the right, and the phone's own back. An iPhone has neither a
  // hardware back nor an edge swipe that reaches a modal, so without this the card is a trap.
  const card = botCard([cardBack(shut, "Close"), col([strip, sectionLabel("Insert"), ...ways], { gap: 2, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 16 })], {
    kind: "custom", color: C.ink, stageHeight: 72, overlay: true, width: desk ? 360 : 330,
    label: "Insert a photo or a file", onLeave: shut,
  });
  return [when({ truthy: INSERT }, card)];
}

/**
 * THE INSERT KEY: the round + outside the box, and what it opens. Talk's bar draws the same one (screens/bots/talkDoor.ts),
 * because inserting a file is the same act wherever you are saying something — two keys that opened two different cards
 * would be the same thing twice. `path` is the box the clipboard pastes into.
 *
 * Nothing where the build cannot upload at all: then there is no key, as there has never been.
 */
export function insertKey(ctx: BotsCtx, path: string): Node[] {
  if (!canUpload(ctx)) return [];
  // The card where a living one can be drawn, else the attach screen the Ask screen has always fallen back on.
  const go: ActionRef = canMove(ctx)
    ? { kind: "setState", path: INSERT, value: true }
    : open(SCREENS.attach, { kind: "photo", from: "ask", message: `$state.${path}` });
  return [labelled(box([icon("plus", { size: 21 })], {
    width: 46, height: 46, borderRadius: 23, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  }, go), "Insert a photo or a file")];
}

/** Where a file picked by the insert key lands, for a bar that sends it on itself (Talk's). */
export const INSERT_PATHS = { attach: ATTACH, shots: SHOTS, open: INSERT, most: MOST } as const;

/**
 * The ask bar: "Ask any bot…" with the mic, or send once something is typed. Enter / return sends. The phone's mic
 * opens the Ask screen listening; the window's starts dictation (hold Fn and speak). The insert key is on the left,
 * in its own circle, where the build can upload.
 */
export function askBar(client: Client, o: { placeholder?: string; path?: string; ctx?: BotsCtx } = {}): Node {
  const path = o.path ?? "ask";
  const ctx = o.ctx;
  const inserts = !!ctx && canUpload(ctx);
  const send = askAction(client, path, ctx, inserts ? { attachments: `$state.${ATTACH}` } : {});
  const mic: ActionRef = client === "desktop" ? { kind: "dictate" } : { kind: "navigate", screenId: SCREENS.ask, params: { voice: true } };
  const key = ctx ? insertKey(ctx, path) : [];
  const bar: Node = row([
    {
      type: "TextField", id: "ask", bind: { value: path },
      props: {
        placeholder: o.placeholder ?? (client === "desktop" ? "Ask any bot…  or hold Fn and speak" : "Ask any bot…"),
        placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0, minHeight: 44,
        returnKeyType: "send", color: C.ink,
      },
      on: { onSubmit: send },
      style: {
        flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 0, paddingVertical: 0,
        fontFamily: FACE.regular, fontSize: 16, color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
      },
    },
    when({ truthy: path }, roundButton("send", send, { label: "Send" })),
    // The keyboard's own mic key, so speaking looks the same in the app as in every other app.
    when({ falsy: path }, micKey(mic, { label: "Speak" })),
  ], {
    gap: 10, borderRadius: client === "desktop" ? 30 : RADIUS.input, borderWidth: 1, borderColor: C.line,
    paddingVertical: 6, paddingRight: 6, paddingLeft: client === "desktop" ? 22 : 18, backgroundColor: C.paper,
    flexGrow: 1, flexShrink: 1, minWidth: 0,
  });
  return col([
    // A file on its way, then the files on the ask, above the row they belong to. The chip is the one ON ITS WAY
    // (uploadChip reads `up`); the strip under it is what is already attached, which the card alone used to show —
    // so closing the card left a composer that looked empty and an ask that was carrying a photo.
    // (Its send is the box's: Ask asks a question, so words come first here. Talk's strip has a send of its own.)
    ...(inserts ? [uploadChip(ATTACH, { wide: true }), askFiles()] : []),
    key.length ? row([...key, bar], { gap: 10, alignItems: "flex-end" }) : bar,
    ctx
      ? askMoment(ctx, { slug: "tailzu", color: C.ink, kind: "custom", busy: "asking", line: "Asking your bots…", bubble: "surface" })
      : when({ truthy: "asking" }, row([statusMark("working", { color: C.ink }), meta("Asking your bots…", { size: 13 })], { gap: 8, paddingLeft: 18 })),
    ...(ctx ? insertCard(ctx, path) : []),
  ], { gap: 8 });
}
