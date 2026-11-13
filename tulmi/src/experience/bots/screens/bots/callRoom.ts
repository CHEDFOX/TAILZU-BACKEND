/**
 * IN A CALL (src/rooms, docs/rooms.md): bots.room, params r (the call), b (the business it is for), video ("0" for an audio call).
 *
 * The whole screen is ours, like any other; the app holds the call and draws its video. As it opens, roomJoin connects (a host's pass from
 * POST /v1/rooms/:id/join) and writes where the call stands into state `call` (phase, mic, cam, speaker, sharing, people, speaking); the
 * screen reads that state:
 *
 *   the head      the call's title, and where it stands: Connecting…, On the call (who is speaking), Reconnecting…, Call ended, Couldn't connect
 *   who waits     someone at the door (from the server, read again as people come and go: live topic room:<id>), with Let in and Not now
 *   the video     CallVideo, everyone in a grid; the app draws each person's video, or their initial with the camera off
 *   the controls  Mute or Unmute, Camera off or on, Flip and Speaker (the phone), Share screen (the window), Hang up (roomSet). Ended or
 *                 failed: Back, or Try again
 *
 * Only for a build that holds our calls (canRoom); any other is told it comes in the app's next update, with the way back. A call that has
 * ended takes nobody. Hanging up, or the call ended by its host, goes back to the call's own screen (bots.mail.call).
 */
import type { ActionSpec, Condition, Node } from "../../../../../../shared/types/sdui.js";
import type { RoomView } from "../../../../rooms/types.js";
import {
  type BotsCtx, C, FACE, call, callVideo, canRoom, card, col, meta, page, primaryButton, quietButton, roomJoin, roomSet, row, secondaryButton,
  seq, text, when, SCREENS,
} from "../../kit.js";
import { type BotsScreen, screen } from "../../registry.js";
import { toast } from "../firstRun/parts.js";
import { bizParam } from "./mailParts.js";
import { isDesk, setState } from "./parts.js";

const ROOMS = "/v1/rooms";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const roomParam = (v: unknown): string => (UUID.test(String(v ?? "")) ? String(v).toLowerCase() : "");
const refresh: ActionSpec = { kind: "refresh" };

/** The call, in a call: opened from its own screen's Join. */
export const openRoom = (business: string, room: string, video: boolean): ActionSpec =>
  ({ kind: "navigate", screenId: SCREENS.room, params: { b: business, r: room, video: video ? "1" : "0" } });
/** The call's own screen, in this one's place. */
const toCall = (business: string, room: string): ActionSpec => ({ kind: "navigate", screenId: SCREENS.mailCall, params: { b: business, r: room }, replace: true });

/** The call's video: dark, rounded, filling what is left of the screen. */
const DARK = "#141414";
const TILE = "#262626";

export type RoomData = { room?: RoomView };

/** Where the call stands, from the app's state. */
function standing(): Node[] {
  const line = (content: string) => meta(content, { size: 13, lineHeight: 18 });
  return [
    when({ eq: ["call.phase", "connecting"] }, line("Connecting…")),
    when({ all: [{ eq: ["call.phase", "live"] }, { falsy: "call.speaking" }] }, line("On the call")),
    when({ all: [{ eq: ["call.phase", "live"] }, { truthy: "call.speaking" }] }, row([
      text("", { size: 13, color: C.meta, lineHeight: 18, bind: "call.speaking", lines: 1, style: { flexShrink: 1 } }),
      line(" is speaking"),
    ], { alignItems: "center" })),
    when({ eq: ["call.phase", "reconnecting"] }, line("Reconnecting…")),
    when({ eq: ["call.phase", "ended"] }, line("Call ended")),
    when({ eq: ["call.phase", "failed"] }, line("Couldn't connect. Check your connection and try again.")),
  ];
}

/** One control: what it does now, and what it does once it has. */
function toggle(path: string, on: [string, ActionSpec], off: [string, ActionSpec]): Node[] {
  return [
    when({ truthy: path }, secondaryButton(on[0], on[1], { size: "md" })),
    when({ falsy: path }, secondaryButton(off[0], off[1], { size: "md" })),
  ];
}

export function roomPage(ctx: BotsCtx, d: RoomData | undefined) {
  const b = bizParam(ctx.params.b), r = roomParam(ctx.params.r);
  const room = d?.room;
  const desk = isDesk(ctx);
  const back = r ? toCall(b, r) : { kind: "navigateBack" } as ActionSpec;

  if (!room || !canRoom(ctx) || room.status === "ended") {
    const why = !room ? "This call couldn't be found."
      : room.status === "ended" ? "This call has ended."
      : "Calls open in X0 Bot's own call screen, which comes with the app's next update.";
    return page(ctx, {
      back, backTitle: "Call", title: room?.title ?? "Call",
      body: [card([text(why, { size: 15, weight: 500, lineHeight: 21 }), secondaryButton("Back to the call", back, { size: "md" })], { gap: 12 })],
    });
  }

  const video = ctx.params.video !== "0";
  const R = `${ROOMS}/${room.id}`;
  const act = (path: string, body: Record<string, unknown>): ActionSpec => call("POST", path, body, { ok: refresh, fail: toast("They're no longer waiting.") });

  const waiting: Node[] = room.waiting.map((k) => card([
    row([
      text(`${k.name} is waiting to join`, { size: 15, weight: 500, lineHeight: 20, lines: 1, style: { flexShrink: 1, flexGrow: 1 } }),
      primaryButton("Let in", act(`${R}/admit`, { knock: k.id }), { size: "md" }),
      quietButton("Not now", act(`${R}/deny`, { knock: k.id }), { size: "md" }),
    ], { gap: 8, alignItems: "center" }),
  ], { padding: 12 }));

  const stage = col([
    callVideo({
      layout: "grid", gap: 6, radius: 14, background: DARK, tile: TILE, nameColor: "#ffffff", speakingColor: "#ffffff", fontFamily: FACE.medium,
      names: true, mirrorMe: true, fit: "cover", empty: "Waiting for others to join",
    }, { flexGrow: 1 }),
  ], { flexGrow: 1, minHeight: desk ? 460 : 420, borderRadius: 20, overflow: "hidden", backgroundColor: DARK, padding: 6 });

  const micCard = when({ truthy: "micCard" }, card([
    text("Let X0 Bot hear you", { size: 16, weight: 600, lineHeight: 21 }),
    meta("The call needs the microphone. Allow it in your settings, then try again.", { size: 13, lineHeight: 18 }),
    row([
      primaryButton("Open Settings", { kind: "openSettings", target: "app" } as ActionSpec, { size: "md" }),
      quietButton("Try again", seq(setState("micCard", false), setState("call.phase", "connecting"), "start"), { size: "md" }),
    ], { gap: 8 }),
  ], { gap: 10 }));

  const live: Condition = { not: { in: ["call.phase", ["ended", "failed"]] } };
  const controls = row([
    ...toggle("call.mic", ["Mute", roomSet("mic", false)], ["Unmute", roomSet("mic", true)]),
    ...toggle("call.cam", ["Camera off", roomSet("cam", false)], ["Camera on", roomSet("cam", true)]),
    ...(desk
      ? toggle("call.sharing", ["Stop sharing", roomSet("share", false)], ["Share screen", roomSet("share", true)])
      : [
        when({ truthy: "call.cam" }, secondaryButton("Flip", roomSet("flip"), { size: "md" })),
        ...toggle("call.speaker", ["Earpiece", roomSet("speaker", false)], ["Speaker", roomSet("speaker", true)]),
      ]),
    primaryButton("Hang up", roomSet("leave"), { size: "md" }),
  ], { gap: 8, flexWrap: "wrap", justifyContent: "center" });
  const after = row([
    when({ eq: ["call.phase", "failed"] }, primaryButton("Try again", seq(setState("call.phase", "connecting"), "start"), { size: "md" })),
    secondaryButton("Back to the call", back, { size: "md" }),
  ], { gap: 8, justifyContent: "center" });

  return page(ctx, {
    back, backTitle: "Call", title: room.title,
    ...(desk ? { maxWidth: 1100, fixed: true } : {}),
    gap: 12,
    state: {
      call: { phase: "connecting", mic: true, cam: video, speaker: true, front: true, sharing: false, people: 0, speaking: "", since: 0 },
      micCard: false,
    },
    actions: {
      start: roomJoin({
        path: `${R}/join`, statePath: "call", video,
        onEnd: toCall(b, room.id),
        onBlocked: setState("micCard", true),
        onError: toast("Couldn't connect to the call. Check your connection and try again."),
      }),
    },
    body: [{
      ...col([
        col([text(room.title, { size: desk ? 19 : 17, weight: 600, lineHeight: desk ? 24 : 22, lines: 1 }), ...standing()], { gap: 2 }),
        ...waiting,
        micCard,
        stage,
      ], { gap: 12, flexGrow: 1 }),
      on: { onAppear: "start" },
    }],
    footer: [when(live, controls), when({ not: live }, after)],
  });
}

export const callRoomScreens: BotsScreen[] = [
  screen<RoomData>({
    id: SCREENS.room,
    load: async (ctx, deps) => {
      const r = roomParam(ctx.params.r);
      if (!r) return {};
      const out = await deps.api<{ room: RoomView }>("GET", `${ROOMS}/${r}`).catch(() => undefined);
      return out?.room ? { room: out.room } : {};
    },
    build: (ctx, d) => roomPage(ctx, d),
  }),
];
