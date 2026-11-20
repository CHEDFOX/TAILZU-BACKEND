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
import type { ActionRef, ActionSpec, Node } from "../../../../shared/types/sdui.js";
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

/**
 * One way in, on the card: its icon, its name, and what it opens. It does NOT shut the card — the picker is a native
 * sheet and goes above everything, this modal included, so the card is still there when the picker closes, with the
 * new file in it. Only Paste shuts it, and it passes that in itself, because there is nothing to come back to.
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
 * WHAT IS ON THE ASK, ABOVE THE BAR. It used to be drawn in the card and nowhere else, on the reasoning that the
 * card is where it was chosen — but the card is a modal you close to type, and the moment it shuts the composer
 * looks exactly as it did before you picked anything. The file was on the ask and being sent; nothing said so.
 *
 * `uploadChip` could not say it either: it reads `up` and `sent`, and `uploadAdd` CLEARS `sent` once the file is
 * on the list, so after a successful pick there is nothing left for it to draw.
 *
 * Small pictures, and the same "Clear" the card has, because taking ONE item out of a list is still not in the
 * vocabulary (appendState adds, clearState empties, nothing removes an index).
 */
function onTheAsk(): Node {
  return when({ truthy: `${ATTACH}.0` }, row([
    ...Array.from({ length: MOST }, (_, i) => chosen(i, 40)),
    grow(),
    labelled(row([text("Clear", { size: 13, weight: 500, lineHeight: 17, color: C.meta })], { minHeight: 30, paddingHorizontal: 4 }),
      "Take them all off"),
  ], { gap: 6, flexWrap: "wrap", alignItems: "center", paddingHorizontal: 4 },
  seq({ kind: "clearState", path: ATTACH }, { kind: "clearState", path: SHOTS })));
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
function insertCard(ctx: BotsCtx, path: string): Node[] {
  if (!canUpload(ctx) || !canMove(ctx)) return [];
  const desk = ctx.client === "desktop";
  const add = (kind: "photo" | "camera" | "file" | "screenshot"): ActionSpec => uploadAdd(kind, { list: ATTACH, shots: SHOTS, max: MOST });
  const ways: Node[] = [
    wayIn("Photo", "clip", add("photo")),
    // The camera is a pick of its own, not a photo from the library: the renderer opens it (pickImage, source camera).
    ...(desk ? [] : [wayIn("Camera", "camera", add("camera"))]),
    wayIn("File", "folder", add("file")),
    wayIn("Screenshot", "computer", add("screenshot")),
    wayIn("Paste", "keyboard", seq(shut, { kind: "readClipboard", assignTo: path })),
  ];
  // What is on the ask, above the ways in: it grows the card as it fills.
  const strip = when({ truthy: `${ATTACH}.0` }, col([
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
  // The key: open the card where a living one can be drawn, else the attach screen the Ask screen has always used.
  const insert: ActionRef = ctx && canMove(ctx)
    ? { kind: "setState", path: INSERT, value: true }
    : open(SCREENS.attach, { kind: "photo", from: "ask", message: `$state.${path}` });
  const key = inserts
    ? [labelled(box([icon("plus", { size: 21 })], {
      width: 46, height: 46, borderRadius: 23, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper,
      alignItems: "center", justifyContent: "center", flexShrink: 0,
    }, insert), "Insert a photo or a file")]
    : [];
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
    ...(inserts ? [uploadChip(ATTACH, { wide: true }), onTheAsk()] : []),
    key.length ? row([...key, bar], { gap: 10, alignItems: "flex-end" }) : bar,
    ctx
      ? askMoment(ctx, { slug: "tailzu", color: C.ink, kind: "custom", busy: "asking", line: "Asking your bots…", bubble: "surface" })
      : when({ truthy: "asking" }, row([statusMark("working", { color: C.ink }), meta("Asking your bots…", { size: 13 })], { gap: 8, paddingLeft: 18 })),
    ...(ctx ? insertCard(ctx, path) : []),
  ], { gap: 8 });
}
