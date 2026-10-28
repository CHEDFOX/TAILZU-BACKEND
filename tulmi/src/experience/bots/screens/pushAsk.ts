/**
 * THE "TURN ON NOTIFICATIONS" ASK (today's app's pushAsk, in the Bots app; Notify.dc.html is what the pings then are).
 *
 * Today's app asked the system's question the first time Stats showed. The Bots app asks when a ping is worth having: on a phone's
 * Home, the first time a bot is working or needs the person (and not while the first-arrival card is up), as a small card that says
 * why first, then the system's own ask (requestPushPermission, which also registers the phone for pushes). Allowed or "Not now", it
 * is answered for good (PUT /v1/bots/push-ask; routes/botsPushAsk.ts). It shows only while the phone itself says notifications are
 * not allowed: the page reads that as it appears (checkPermission, never asking), so a phone that already allows them never sees it.
 * What pings you (bots.notify) carries a quiet "Notifications are off on this phone" line instead, for as long as they are off.
 *
 * A window has no push (its pings are the computer's own notifications), so none of this is sent there.
 */
import type { ActionRef, ActionSpec, Condition, Node } from "../../../../../shared/types/sdui.js";
import { button, C, call, card, col, labelled, meta, row, seq, shapes, text, when, type BotsCtx } from "../kit.js";

/** GET { due } / PUT { answer } (routes/botsPushAsk.ts). */
export const PUSH_ASK_PATH = "/v1/bots/push-ask";

/** What a page with the ask starts with: the phone's answer unknown (null) until it reads it, and not answered on this page yet. */
export const PUSH_STATE = { pushGranted: null, pushAsked: false } as const;

const setState = (path: string, value: unknown): ActionSpec => ({ kind: "setState", path, value });
const toast = (message: string): ActionSpec => ({ kind: "toast", message });
const BELL = "M6.5 16v-5a5.5 5.5 0 0 1 11 0v5l1.5 2h-14zM10 20.5a2 2 0 0 0 4 0";

/** Reads whether this phone lets Tailzu notify (never asks) into `pushGranted`. */
const CHECK = { kind: "checkPermission", permission: "notifications", assignTo: "pushGranted" } as ActionSpec;

/**
 * `node` (one that is always on the page: a header, a title) reads whether this phone allows notifications as it appears, so the
 * ask needs no node of its own (an empty one would still take a gap in the page's column). A window's node is left as it is.
 */
export function withPushCheck(ctx: BotsCtx, node: Node): Node {
  if (ctx.client !== "phone") return node;
  const before = node.on?.onAppear;
  return { ...node, on: { ...(node.on ?? {}), onAppear: before ? seq(before, CHECK) : CHECK } };
}

/** Answered for good: the card goes now, and the server keeps it. */
const answered = (answer: "granted" | "dismissed"): ActionRef => seq(setState("pushAsked", true), call("PUT", PUSH_ASK_PATH, { answer }, {}));

/** The system's own ask. Allowed: the app registers for pushes itself. Refused (now or before): it stays off, and says where to change it. */
export const turnOnPush = (o: { record?: boolean } = {}): ActionSpec => ({
  kind: "requestPushPermission",
  onGranted: seq(setState("pushGranted", true), o.record === false ? undefined : answered("granted"), toast("Notifications on")),
  onDenied: seq(o.record === false ? undefined : answered("dismissed"), toast("Notifications stay off. You can turn them on in Settings.")),
});

const bell = (size: number): Node => shapes([{ d: BELL, stroke: C.ink, strokeWidth: 1.9, linecap: "round", linejoin: "round" }], { size });

/** What the card says: what is going on right now, by the bot's name. */
function why(ctx: BotsCtx): { title: string; line: string } {
  const need = ctx.live.needs[0];
  if (need) return { title: "Get a ping when a bot needs you", line: `${need.botName} is waiting on you now. Turn on notifications so you don't miss the next one.` };
  const busy = ctx.live.working[0];
  const name = (busy ? ctx.live.bots.find((b) => b.slug === busy.bot)?.name : undefined) ?? "A bot";
  return { title: "Get a ping when it's done", line: `${name} is working. Turn on notifications and your bots tell you when they finish or need you.` };
}

/** Whether Home has the card: a phone, never answered (`due`, the server's word), and something a ping would be for. */
export const pushAskDue = (ctx: BotsCtx, due: boolean): boolean =>
  ctx.client === "phone" && due && (ctx.live.working.length > 0 || ctx.live.needs.length > 0);

/**
 * The card, for a phone's Home (when pushAskDue). The page's state must start with PUSH_STATE, and one node that is always on it
 * must read the phone's answer (withPushCheck).
 */
export function pushAskCard(ctx: BotsCtx, due: boolean): Node[] {
  if (!pushAskDue(ctx, due)) return [];
  const shown: Condition = { all: [{ eq: ["pushGranted", false] }, { falsy: "pushAsked" }] };
  const w = why(ctx);
  // Quiet on purpose: an outline pill (Home's one black choice stays the needs-you card's), and "Not now" beside it.
  return [
    when(shown, card([
      row([
        bell(20),
        col([
          text(w.title, { size: 15, weight: 600, lineHeight: 20 }),
          text(w.line, { size: 13, color: C.grey70, lineHeight: 18 }),
        ], { gap: 3, flexGrow: 1, flexShrink: 1 }),
      ], { gap: 12, alignItems: "flex-start" }),
      row([
        button("Turn on notifications", turnOnPush(), { kind: "secondary", size: "md" }),
        labelled(row([text("Not now", { size: 14, weight: 500, color: C.meta, lineHeight: 18 })], { minHeight: 44, paddingHorizontal: 12, justifyContent: "center" }, answered("dismissed")), "Not now"),
      ], { gap: 4, paddingLeft: 32 }),
    ], { padding: 16, gap: 10 })),
  ];
}

/**
 * What pings you, on a phone: while this phone does not allow notifications, a line that says so and a way to turn them on (no
 * "Not now": it is the settings page). Nothing on a window. The page's state must start with PUSH_STATE, and one node that is
 * always on it must read the phone's answer (withPushCheck).
 */
export function pushOffRow(ctx: BotsCtx): Node[] {
  if (ctx.client !== "phone") return [];
  return [
    when({ eq: ["pushGranted", false] }, card([
      row([
        bell(18),
        col([
          text("Notifications are off on this phone", { size: 15, weight: 500, lineHeight: 20 }),
          meta("Nothing here reaches you until they're on.", { size: 12, lineHeight: 16 }),
        ], { gap: 2, flexGrow: 1, flexShrink: 1 }),
        button("Turn on", turnOnPush({ record: false }), { kind: "secondary", size: "md" }),
      ], { gap: 12 }),
    ], { padding: 14, gap: 0, style: { backgroundColor: C.surface, borderWidth: 0 } })),
  ];
}
