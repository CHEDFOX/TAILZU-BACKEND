/**
 * THE MOMENT AN ASK IS OUT, IN EVERY CHAT: Xode's project chat and its task bar, every bot's chat, Ask and Home's ask bar.
 *
 * The person sends: their words go up at once as their bubble (bound to `sent`) and the box is cleared. Under the bubble, a lane
 * where the bot of the chat (its colour and its look; Tailzu's own in Ask) carries the ask as a bag, trip after trip, heavier each
 * trip (BotBuddy act "carry", component BotBuddyCarry). Under him, what he is really doing, in a few words, from the server's own
 * steps (`reply.step`), and Stop. When the answer's first words come (`reply.text`, written in as they are written: callEndpoint
 * `stream`, capability AskStream) he sets the bag down and walks off and the words flow in where he was. What happens when the
 * answer is whole is the chat's own, as before (it opens the answer, or the chat fills in). Stopped: what was written stays, marked.
 *
 *   start(...)           the actions before the call: the bubble, the box cleared, the stream reset, busy
 *   streamed(ctx, call)  the call, its answer streamed where the build can
 *   failed(...)          the call's onError: stopped, it stays; else the words go back in the box and the chat's own words say why
 *   askMoment(ctx, o)    the nodes, for above the box
 *
 * A build without BotBuddyCarry gets today's line ("Asking Xode…") under the bubble; one without AskStream, no Stop and no
 * step line, and the whole answer at the end. No model names, no money: short, plain words.
 */
import type { ActionRef, ActionSpec, BotTileKind, Condition, Node } from "../../../../shared/types/sdui.js";
import { ASK_STREAM_CAPABILITY, BOT_BUDDY_CARRY } from "../../../../shared/types/sdui.js";
import { botBuddy, canBuddy, C, col, labelled, meta, row, statusMark, text, when, box, grow, FACE, type BotsCtx } from "./kit.js";

/** A build whose BotBuddy carries an ask (a lane under it). */
export const canCarry = (ctx: BotsCtx): boolean => canBuddy(ctx) && ctx.can.has(BOT_BUDDY_CARRY);
/** A build that writes an answer in as it comes, and can stop it. */
export const canStream = (ctx: BotsCtx): boolean => ctx.can.has(ASK_STREAM_CAPABILITY);

/** Where the moment keeps what it shows. */
export const SENT = "sent";
export const REPLY = "reply";
export const STOPPED = "stopped";
/** The person's words, as the call sends them (the box is cleared before it goes). */
export const SENT_WORDS = `$state.${SENT}`;

/** Before the call: `message` (often "$state.<box>") up as the bubble, the box emptied, the last answer's words gone, busy. */
export function start(o: { message: string; from?: string; busy: string }): ActionSpec[] {
  return [
    { kind: "setState", path: SENT, value: o.message },
    { kind: "setState", path: STOPPED, value: false },
    { kind: "setState", path: REPLY, value: null },
    ...(o.from ? [{ kind: "clearState", path: o.from } as ActionSpec] : []),
    { kind: "setState", path: o.busy, value: true },
  ];
}

/** The call, its answer written in as it comes where the build can (`reply`). */
export function streamed(ctx: BotsCtx, call: ActionSpec): ActionSpec {
  return call.kind === "callEndpoint" && canStream(ctx) ? { ...call, stream: REPLY } : call;
}

/** After the chat has its answer in place (a refresh): the bubble and the streamed words go; the chat shows them now. */
export const done = (): ActionSpec[] => [{ kind: "clearState", path: SENT }, { kind: "clearState", path: REPLY }];

/**
 * The call's onError. Stopped by the person: no longer busy, and what was written stays with "Stopped". Otherwise the words go
 * back in the box (`from`), the bubble goes, and `then` says why (the chat's own toast).
 */
export function failed(o: { busy: string; from?: string; then: ActionRef }): ActionSpec {
  return {
    kind: "condition", if: { truthy: STOPPED },
    then: { kind: "setState", path: o.busy, value: false },
    else: {
      kind: "sequence", actions: [
        { kind: "setState", path: o.busy, value: false },
        ...(o.from ? [{ kind: "setState", path: o.from, value: SENT_WORDS } as ActionSpec] : []),
        { kind: "clearState", path: SENT },
        { kind: "clearState", path: REPLY },
        o.then,
      ],
    },
  };
}

/** Stop the ask that is out: the server stops it (its words stay); the call then fails, and `failed` keeps them. */
export const stop = (): ActionSpec => ({
  kind: "sequence", actions: [
    { kind: "setState", path: STOPPED, value: true },
    { kind: "callEndpoint", method: "POST", path: "/v1/ask/stop", body: { id: `$state.${REPLY}.id` } },
  ],
});

export interface MomentOpts {
  /** The chat's bot: its slug (the lane's life), colour and look. */
  slug: string;
  color: string;
  kind: BotTileKind;
  /** The state that holds while the ask is out ("asking", "sending"). */
  busy: string;
  /** Today's line, for a build that cannot carry: "Asking Xode…". */
  line: string;
  /** The bubble: ink (a chat) or a light grey (Ask). */
  bubble?: "ink" | "surface";
  /** The words' size (15 a chat, 14 a bar). */
  size?: number;
}

/** The nodes of the moment, for above the box: the bubble, the words as they come, the lane, what it is doing and Stop. */
export function askMoment(ctx: BotsCtx, o: MomentOpts): Node {
  const desk = ctx.client === "desktop";
  const size = o.size ?? 15;
  const lh = Math.round(size * 1.4);
  const busy: Condition = { truthy: o.busy };
  const ink = (o.bubble ?? "ink") === "ink";
  const bubble = row([box([text("", { size, lineHeight: lh, color: ink ? C.paper : C.ink, bind: SENT, lines: 4 })], {
    backgroundColor: ink ? C.ink : C.surface, borderRadius: 20, borderBottomRightRadius: 6, paddingVertical: 10, paddingHorizontal: 15, maxWidth: "86%",
  })], { justifyContent: "flex-end" });
  // The answer's words, where the bot was: the head of them while they come (the whole answer follows in the chat).
  const words = text("", { size, lineHeight: Math.round(size * 1.45), color: C.ink, bind: `${REPLY}.text`, lines: desk ? 14 : 9 });
  const lane = canCarry(ctx)
    ? botBuddy({
      kind: o.kind, color: o.color, life: `carry.${o.slug}`, height: desk ? 70 : 68, size: desk ? 46 : 44, state: "idle", act: "carry",
      doneWhen: { truthy: `${REPLY}.text` }, label: "Working on it…",
    })
    : row([statusMark("working", { color: o.color }), meta(o.line, { size: 13 })], { gap: 8, paddingLeft: 4 });
  const stream = canStream(ctx);
  const doing = stream
    ? [when(busy, row([
      when({ truthy: `${REPLY}.step` }, text("", { size: 13, lineHeight: 17, color: C.meta, bind: `${REPLY}.step`, lines: 1, style: { flexShrink: 1 } })),
      grow(),
      labelled(box([text("Stop", { size: 13, weight: 500, lineHeight: 17, style: { fontFamily: FACE.medium } })], {
        height: 32, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: C.outline, alignItems: "center", justifyContent: "center", flexShrink: 0,
      }, stop()), "Stop"),
    ], { gap: 10, minHeight: 32 }))]
    : [];
  return col([
    when({ truthy: SENT }, bubble),
    when({ truthy: `${REPLY}.text` }, words),
    when(busy, lane),
    ...doing,
    when({ all: [{ truthy: STOPPED }, { falsy: o.busy }] }, meta("Stopped", { size: 12 })),
  ], { gap: 10 });
}
