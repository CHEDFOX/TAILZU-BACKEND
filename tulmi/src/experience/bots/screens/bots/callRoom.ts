/**
 * IN A CALL (src/rooms, docs/rooms.md): bots.mail.room, params b (the business) and r (the call).
 *
 * The whole screen is server data; the app only holds the call. `call.join` runs as the screen opens, takes a seat and writes the call
 * into the screen's state (`c`), and every word, tile and button here is an expression over that state:
 *
 *   the head      the call's title, and where it stands: Connecting…, On the call, Reconnecting…, Call ended, Couldn't connect
 *   who waits     Each over c.waiting: Let in, Not now, without leaving the call
 *   the tiles     Each over c.people, a Caller in each, their name and a ring while they talk; their own picture in the corner
 *   the controls  Mute, Camera, Flip and Speaker (the phone), Hang up — each reading c.mic, c.cam and the rest for its own label
 *   the bot       X0 sits in every call, says so, and writes the document as it goes (docs/brief.md): the line under the title,
 *                 whatever it last said, and the document itself beside the call (a window) or under it (a phone). It is the
 *                 server's own data on the room, so the page redraws when the document changes and nothing in the apps knows
 *                 anything about it
 *
 * EVERYONE WALKS IN MUTED AND DARK. Joining captures nothing; turning the microphone or the camera on is what opens it, and the
 * permission for it was granted once, after onboarding, so no card stands in the way here.
 *
 * ONLY FOR A CLIENT THAT HAS THE `call` BLOCK. The screen states `needs`, so the gate would send anyone else "Open X0 again" instead
 * of a page; `mailCalls.ts` therefore only offers Join to a client that has it, and everyone else is told, on the call's own page, that
 * joining comes with the app's next update (docs/renderer.md section 4).
 */
import type { ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import type { RoomView } from "../../../../rooms/types.js";
import { caller, callJoin, callLeave, callSet, each, v, vocab2, whenExpr } from "../../../sdui2/build.js";
import {
  type BotsCtx, FACE, call, card, col, meta, page, primaryButton, quietButton, row, secondaryButton, seq, text, SCREENS,
} from "../../kit.js";
import { type BotsScreen, screen } from "../../registry.js";
import { showNodes } from "../../show.js";
import { roomTopic } from "../../../../live/topics.js";
import { toast } from "../firstRun/parts.js";
import { bizParam } from "./mailParts.js";
import { isDesk, setState } from "./parts.js";

const ROOMS = "/v1/rooms";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const roomParam = (v2: unknown): string => (UUID.test(String(v2 ?? "")) ? String(v2).toLowerCase() : "");
const refresh: ActionSpec = { kind: "refresh" };

/** The dark the tiles sit on. */
const DARK = "#141414", TILE = "#262626";

/** In the call: opened from the call's own page, with video or audio only. */
export const openRoom = (business: string, room: string): ActionSpec =>
  ({ kind: "navigate", screenId: SCREENS.mailRoom, params: { b: business, r: room } });

/** The call's own page, in this one's place (hanging up, or a call that ended). */
const toCall = (business: string, room: string): ActionSpec =>
  ({ kind: "navigate", screenId: SCREENS.mailCall, params: { b: business, r: room }, replace: true });

export type RoomData = { room?: RoomView };

/**
 * THE BOT'S OWN COLUMN: that it is here and listening, the last thing it said, and the document it has made so far — the
 * same blocks a bot draws under its words, so there is nothing new to draw (docs/brief.md, docs/show.md).
 */
function botColumn(ctx: BotsCtx, room: RoomView, desk: boolean): Node[] {
  const bot = room.bot;
  if (!bot) return [];
  const parts = bot.brief?.parts ?? [];
  return [col([
    row([
      text(bot.taking ? `${bot.name} is in this call` : `${bot.name} was in this call`, { size: 14, weight: 600, lineHeight: 19 }),
      ...(bot.taking ? [meta("listening and writing", { size: 12 })] : []),
    ], { gap: 8, alignItems: "baseline", flexWrap: "wrap" }),
    ...(bot.said ? [card([text(bot.said.text, { size: 14, lineHeight: 20 })], { gap: 6, padding: 12 })] : []),
    ...(parts.length
      ? parts.flatMap((part) => [
          ...(part.title ? [text(part.title, { size: 14, weight: 600, lineHeight: 19 })] : []),
          ...showNodes(ctx, { blocks: part.blocks as never }, { slug: "mail", turn: `room.${part.id}.${part.v}`, live: false }),
        ])
      : bot.taking ? [meta("The document fills in as you talk.", { size: 12 })] : []),
  ], { gap: 10, ...(desk ? { width: 320, flexShrink: 0 } : {}) })];
}

/** One person's tile: their picture, their name, and a ring while they are talking. */
function tile(desk: boolean): Node {
  return col([
    caller({
      who: v("item.identity"), fit: "cover", radius: 14, background: TILE, nameColor: "#ffffff", fontFamily: FACE.medium,
    }, { style: { flexGrow: 1, minHeight: desk ? 200 : 150 } }),
    row([
      text("", { size: 12, color: "#ffffff", lineHeight: 16, lines: 1, bind: "item.name" }),
      whenExpr("!item.mic", meta("muted", { size: 11 })),
    ], { gap: 6, alignItems: "center" }),
  ], {
    gap: 4, flexGrow: 1, flexBasis: desk ? 260 : 150, padding: 4, borderRadius: 16, borderWidth: 2,
    // A ring while they talk, and the same colour as the ground when they are not, so nothing jumps.
    borderColor: v("item.speaking ? '#ffffff' : '#141414'"),
  });
}

export function roomPage(ctx: BotsCtx, d: RoomData | undefined) {
  const b = bizParam(ctx.params.b), r = roomParam(ctx.params.r);
  const room = d?.room;
  const desk = isDesk(ctx);
  const back = r ? toCall(b, r) : ({ kind: "navigateBack" } as ActionSpec);

  if (!room || room.status === "ended") {
    return page(ctx, {
      back, backTitle: "Call", title: room?.title ?? "Call",
      body: [card([
        text(room ? "This call has ended." : "This call couldn't be found.", { size: 15, weight: 500, lineHeight: 21 }),
        secondaryButton("Back to the call", back, { size: "md" }),
      ], { gap: 12 })],
    });
  }

  const R = `${ROOMS}/${room.id}`;
  const act = (path: string, body: Record<string, unknown>): ActionSpec =>
    call("POST", path, body, { ok: refresh, fail: toast("They're no longer waiting.") });

  const standing = col([
    whenExpr("state.c.phase == 'connecting'", meta("Connecting…", { size: 13 })),
    whenExpr("state.c.phase == 'live'", meta("On the call", { size: 13 })),
    whenExpr("state.c.phase == 'reconnecting'", meta("Reconnecting…", { size: 13 })),
    whenExpr("state.c.phase == 'ended'", meta("Call ended", { size: 13 })),
    whenExpr("state.c.phase == 'failed'", meta("Couldn't connect. Check your connection and try again.", { size: 13 })),
  ], { gap: 0 });

  // Who is at the door, from the call's own state, so it arrives without the page being read again.
  const waiting = whenExpr("count(state.c.waiting) > 0", col([
    each({
      data: v("state.c.waiting"),
      item: card([row([
        text("", { size: 15, weight: 500, lineHeight: 20, lines: 1, bind: "item.name", style: { flexGrow: 1, flexShrink: 1 } }),
        primaryButton("Let in", act(`${R}/admit`, { knock: v("item.id") }), { size: "md" }),
        quietButton("Not now", act(`${R}/deny`, { knock: v("item.id") }), { size: "md" }),
      ], { gap: 8, alignItems: "center" })], { padding: 12 }),
    }),
  ], { gap: 8 }));

  const stage = col([
    // Everyone else, each in a tile; their own picture sits in the corner over them.
    each({ data: v("state.c.people"), item: tile(desk), key: "identity" }),
    whenExpr("count(state.c.people) == 0", col([
      meta("Waiting for others to join", { size: 13, align: "center" }),
    ], { flexGrow: 1, justifyContent: "center" })),
  ], {
    flexGrow: 1, minHeight: desk ? 420 : 380, borderRadius: 20, overflow: "hidden", backgroundColor: DARK, padding: 6,
    flexDirection: "row", flexWrap: "wrap", gap: 6, alignContent: "flex-start",
  });

  const mine = whenExpr("state.c.cam", caller({ who: "me", mirror: true, fit: "cover", radius: 12, background: TILE },
    { style: { width: desk ? 180 : 108, height: desk ? 120 : 150, alignSelf: "flex-end", marginTop: -8 } }));

  /** One switch, drawn as whichever of its two faces the call is wearing now. */
  const two = (on: string, onAct: ActionSpec, off: string, offAct: ActionSpec, is: string): Node[] => [
    whenExpr(is, secondaryButton(on, onAct, { size: "md" })),
    whenExpr(`!(${is})`, secondaryButton(off, offAct, { size: "md" })),
  ];

  const controls = row([
    ...two("Mute", callSet("mic", false), "Unmute", callSet("mic", true), "state.c.mic"),
    ...two("Camera off", callSet("cam", false), "Camera on", callSet("cam", true), "state.c.cam"),
    ...(desk ? [] : [
      whenExpr("state.c.cam", secondaryButton("Flip", callSet("flip"), { size: "md" })),
      ...two("Earpiece", callSet("speaker", false), "Speaker", callSet("speaker", true), "state.c.speaker"),
    ]),
    primaryButton("Hang up", callLeave(), { size: "md" }),
  ], { gap: 8, flexWrap: "wrap", justifyContent: "center" });

  const after = row([
    whenExpr("state.c.phase == 'failed'", primaryButton("Try again", seq(setState("c.phase", "connecting"), "start"), { size: "md" })),
    secondaryButton("Back to the call", back, { size: "md" }),
  ], { gap: 8, justifyContent: "center" });

  const live = "state.c.phase != 'ended' && state.c.phase != 'failed'";
  return vocab2(page(ctx, {
    back, backTitle: "Call", title: room.title,
    // The document is the server's own data on the room, so the page is redrawn whenever it changes (rooms/scribe.ts
    // publishes the room's topic). The call itself is the app's and is not touched by a redraw.
    live: [roomTopic(room.id)],
    ...(desk ? { maxWidth: 1100, fixed: true } : {}),
    gap: 12,
    state: {
      // Everyone walks in muted and dark: nothing is captured until they turn one on.
      c: { phase: "connecting", mic: false, cam: false, speaker: true, front: true, me: null, people: [], waiting: [] },
    },
    actions: {
      start: callJoin({
        join: `${R}/join`, statePath: "c",
        onEnd: toCall(b, room.id),
        // The permissions were granted once, after onboarding, so a refusal here is rare and is said plainly rather than with a card.
        onBlocked: toast("X0 Bot can't reach your microphone or camera. Check its permissions in your settings."),
        onError: toast("Couldn't connect to the call. Check your connection and try again."),
      }),
    },
    body: [{
      ...col([
        col([
          text(room.title, { size: desk ? 19 : 17, weight: 600, lineHeight: desk ? 24 : 22, lines: 1 }),
          standing,
        ], { gap: 2 }),
        waiting,
        // A window puts the document beside the call; a phone puts it under it.
        ...(desk
          ? [row([col([stage, mine], { gap: 12, flexGrow: 1 }), ...botColumn(ctx, room, true)], { gap: 16, alignItems: "flex-start" })]
          : [stage, mine, ...botColumn(ctx, room, false)]),
      ], { gap: 12, flexGrow: 1 }),
      on: { onAppear: "start" },
    }],
    footer: [whenExpr(live, controls), whenExpr(`!(${live})`, after)],
  }));
}

export const callRoomScreens: BotsScreen[] = [
  screen<RoomData>({
    id: SCREENS.mailRoom,
    load: async (ctx, deps) => {
      const r = roomParam(ctx.params.r);
      if (!r) return {};
      const out = await deps.api<{ room: RoomView }>("GET", `${ROOMS}/${r}`).catch(() => undefined);
      return out?.room ? { room: out.room } : {};
    },
    build: (ctx, d) => roomPage(ctx, d),
  }),
];
