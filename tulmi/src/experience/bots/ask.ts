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
  row, SCREENS, sectionLabel, seq, statusMark, text, when, type BotsCtx,
} from "./kit.js";
import { askMoment } from "./askMoment.js";
import { canUpload, uploadChip, uploadPick } from "./media.js";

/** Where the insert card's open/closed lives, and where a picked file's ref goes. */
const INSERT = "insert";
const ATTACH = "attach";

/**
 * What a screen with an ask bar starts with: the card shut, no file on the ask, nothing on its way. Spread into the
 * page's `state` beside the screen's own (`{ ...ASK_BAR_STATE, ... }`).
 */
export const ASK_BAR_STATE = { [INSERT]: false, [ATTACH]: [] as unknown[], up: null, sent: null };

const shut: ActionSpec = { kind: "setState", path: INSERT, value: false };

/** One way in, on the card: its icon, its name, and what it opens. Shutting the card first, so the picker opens over the page. */
function wayIn(name: string, glyph: "clip" | "camera" | "folder" | "computer" | "keyboard", go: ActionRef): Node {
  return labelled(row([
    box([icon(glyph, { size: 18 })], {
      width: 38, height: 38, borderRadius: 19, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", flexShrink: 0,
    }),
    text(name, { size: 16, lineHeight: 21 }),
  ], { gap: 12, minHeight: 52, alignItems: "center" }, seq(shut, go)), name);
}

/**
 * The card the insert key pops: the page blurred, the tiny bot across the top, and the ways in under him. Inside a
 * `when` so each tap mounts a fresh one — see the note at the top about BotCard's one-way phases.
 */
function insertCard(ctx: BotsCtx, path: string): Node[] {
  if (!canUpload(ctx) || !canMove(ctx)) return [];
  const desk = ctx.client === "desktop";
  const pick = (kind: "photo" | "camera" | "file" | "screenshot"): ActionSpec => uploadPick(kind, ATTACH);
  const ways: Node[] = [
    wayIn("Photo", "clip", pick("photo")),
    // The camera is a pick of its own, not a photo from the library: the renderer opens it (pickImage, source camera).
    ...(desk ? [] : [wayIn("Camera", "camera", pick("camera"))]),
    wayIn("File", "folder", pick("file")),
    wayIn("Screenshot", "computer", pick("screenshot")),
    wayIn("Paste", "keyboard", { kind: "readClipboard", assignTo: path }),
  ];
  const card = botCard([col([sectionLabel("Insert"), ...ways], { gap: 2, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 16 })], {
    kind: "custom", color: C.ink, stageHeight: 72, overlay: true, width: desk ? 360 : 330,
    label: "Insert a photo or a file", onDismiss: shut,
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
    // A file on its way, then the file on the ask, above the row it belongs to.
    ...(inserts ? [uploadChip(ATTACH, { wide: true })] : []),
    key.length ? row([...key, bar], { gap: 10, alignItems: "flex-end" }) : bar,
    ctx
      ? askMoment(ctx, { slug: "tailzu", color: C.ink, kind: "custom", busy: "asking", line: "Asking your bots…", bubble: "surface" })
      : when({ truthy: "asking" }, row([statusMark("working", { color: C.ink }), meta("Asking your bots…", { size: 13 })], { gap: 8, paddingLeft: 18 })),
    ...(ctx ? insertCard(ctx, path) : []),
  ], { gap: 8 });
}
