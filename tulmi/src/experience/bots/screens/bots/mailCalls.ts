/**
 * THE MAIL BOT'S CALLS (src/rooms, docs/rooms.md, docs/mail.md section 9): video and audio calls of our own, under the business's name.
 *
 *   on its page      Calls: Start a call, then the latest calls, each opening its screen. Shown only when calls are switched on and the business
 *                    is the person's to call from (their own, or a member's as their space's admin; never addresses given to them)
 *   bots.mail.call   params b, r: one call. Its link, with Copy and Share; who waits at the door, with Let in and Not now; who is in, a
 *                    guest with Remove; "Ask before letting people in"; End for everyone, on a second yes. Read again as people come and go
 *                    (its live topic room:<id>). A push that someone waits opens it. Join goes into the call itself (callRoom.ts) for a
 *                    client that has the `call` block; any other is told it comes with the app's next update, and never sent to a web page
 *
 * Every write goes to routes/bots/rooms.ts (the call) or routes/bots/mail.ts (a new call, under the business).
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import type { RoomView } from "../../../../rooms/types.js";
import {
  type BotsCtx, C, call, card, col, hasBlock, icon, listCard, listRow, meta, notice, page, primaryButton, quietButton, row,
  secondaryButton, sectionLabel, seq, statusMark, text, when, grow, SCREENS,
} from "../../kit.js";
import { type BotsScreen, screen } from "../../registry.js";
import { toast } from "../firstRun/parts.js";
import { copyAction } from "./keysDesk.js";
import { openRoom } from "./callRoom.js";
import { bizParam, MAIL, MAIL_SLUG } from "./mailParts.js";
import { clockOf, isDesk, plural, setState, shortDate } from "./parts.js";

const ROOMS = "/v1/rooms";
const SHOWN = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const roomParam = (v: unknown): string => (UUID.test(String(v ?? "")) ? String(v).toLowerCase() : "");
const refresh: ActionSpec = { kind: "refresh" };
const said = (message: string): ActionSpec => ({ kind: "toast", message, tone: "success" } as ActionSpec);

export const openCall = (business: string, room: string): ActionSpec => ({ kind: "navigate", screenId: SCREENS.mailCall, params: { b: business, r: room } });
/** The mail bot's page, for the business (replacing this screen: a push may have opened it with nothing behind). */
const toPage = (business: string): ActionSpec => ({ kind: "navigate", screenId: SCREENS.bot, params: { slug: MAIL_SLUG, b: business }, replace: true });

/** A new call under the business, then its screen: its link to share, and Join. */
export function startCall(business: string): ActionRef {
  return seq(setState("mc_busy", true), call("POST", `${MAIL}/businesses/${business}/calls`, {}, {
    assignTo: "mc_new",
    ok: seq(setState("mc_busy", false), { kind: "navigate", screenId: SCREENS.mailCall, params: { b: business, r: "$state.mc_new.call.id" } } as ActionSpec),
    fail: seq(setState("mc_busy", false), toast("Couldn't start a call just now. Try again in a moment.")),
  }));
}

/** Where a call stands, in a few words. */
function standing(ctx: BotsCtx, r: RoomView): string {
  if (r.status === "ended") return "Ended";
  if (r.status === "live") return `On now · ${plural(r.people.length, "person", "people")}`;
  if (r.waiting.length) return `${plural(r.waiting.length, "person", "people")} waiting`;
  const day = shortDate(ctx, r.lastAt) === shortDate(ctx, ctx.live.now) ? clockOf(ctx, r.lastAt) : shortDate(ctx, r.lastAt);
  return r.minutes ? `Last on ${day} · ${plural(r.minutes, "minute")}` : `Made ${day} · nobody has joined yet`;
}

/** The Calls section of the mail page: Start a call, and the latest calls. Absent when calls are off for this business. */
export function callsSection(ctx: BotsCtx, business: string, calls: RoomView[] | undefined): Node[] {
  if (!calls) return [];
  const rows = calls.slice(0, SHOWN).map((r) => listRow({
    label: r.title, sub: standing(ctx, r),
    left: statusMark(r.status === "live" ? "working" : r.waiting.length ? "needs" : r.status === "ended" ? "done" : "waiting", { size: 9 }),
    onPress: openCall(business, r.id),
  }));
  return [col([
    row([sectionLabel("Calls"), grow(), quietButton("Start a call", startCall(business), { size: "md" })], { gap: 8, alignItems: "center" }),
    rows.length
      ? listCard(rows)
      : meta("Video or audio calls with your customers, from your own link. Nobody needs an app or an account to join.", { size: 13, lineHeight: 18 }),
    when({ truthy: "mc_busy" }, meta("Starting a call…", { size: 13 })),
  ], { gap: 8 })];
}

// ===================================================================== one call

export type CallData = { room?: RoomView };

/**
 * Joining. A client that has the `call` block (the live client is in its binary) goes into the call's own screen (callRoom.ts), where
 * it starts muted with its camera off. Every other build is told it comes with the app's next update — never a web page, and never
 * the screen itself, which the gate would answer with "Open X0 again" instead of a page (docs/renderer.md section 4).
 */
function joinButtons(ctx: BotsCtx, b: string, r: RoomView): Node[] {
  if (r.status === "ended") return [];
  if (!hasBlock(ctx, "call")) {
    return [notice("Joining from X0 Bot comes with the app's next update. Your link is ready to share now.", { mark: "phone" })];
  }
  // One way in: everyone joins muted and dark, and turns on what they want once they are there.
  return [primaryButton("Join the call", openRoom(b, r.id), { size: "md" })];
}

function linkCard(ctx: BotsCtx, r: RoomView): Node {
  const share: ActionSpec = { kind: "share", url: r.link, title: r.title, text: `Join my call: ${r.link}` };
  return card([
    sectionLabel("The link"),
    text(r.link || "The link couldn't be read just now.", { size: 14, mono: true, lineHeight: 20, lines: 1 }),
    meta(r.lobby ? "Anyone with it can ask to join. You let them in." : "Anyone with it comes straight in.", { size: 12 }),
    ...(r.link ? [row([
      secondaryButton("Copy", copyAction(ctx, r.link), { size: "md" }),
      secondaryButton("Share", share, { size: "md", icon: "share" }),
    ], { gap: 8 })] : []),
  ], { gap: 8 });
}

export function callPage(ctx: BotsCtx, d: CallData | undefined) {
  const b = bizParam(ctx.params.b);
  const r = d?.room;
  if (!r) {
    return page(ctx, {
      back: toPage(b), backTitle: "Call", title: "Call",
      body: [card([
        text("This call couldn't be found.", { size: 15, weight: 500, lineHeight: 21 }),
        secondaryButton("Back to the mail", toPage(b), { size: "md" }),
      ], { gap: 12 })],
    });
  }
  const R = `${ROOMS}/${r.id}`;
  const ended = r.status === "ended";
  const act = (path: string, body: Record<string, unknown>, failed: string): ActionSpec => call("POST", path, body, { ok: refresh, fail: toast(failed) });

  const waiting = r.waiting.length ? [listCard(r.waiting.map((k) => listRow({
    label: k.name, sub: `Waiting since ${clockOf(ctx, k.since)}`, chevron: false,
    right: row([
      primaryButton("Let in", act(`${R}/admit`, { knock: k.id }, "They're no longer waiting."), { size: "md" }),
      quietButton("Not now", act(`${R}/deny`, { knock: k.id }, "They're no longer waiting."), { size: "md" }),
    ], { gap: 6 }),
  })), { title: "Waiting to join" })] : [];

  const people = r.people.length ? [listCard(r.people.map((p) => listRow({
    label: p.name, sub: p.role === "host" ? "You" : p.role === "guest" ? `Joined at ${clockOf(ctx, p.since)}` : "In the call",
    left: icon("person", { size: 18, color: C.meta }), chevron: false,
    ...(p.role === "guest" ? { right: quietButton("Remove", act(`${R}/remove`, { identity: p.identity }, "Couldn't remove them. Try again."), { size: "md" }) } : {}),
  })), { title: "In the call" })] : [];

  const settings = ended ? [] : [listCard([
    listRow({
      label: "Ask before letting people in", sub: r.lobby ? "People with the link wait for you" : "People with the link come straight in",
      right: text(r.lobby ? "On" : "Off", { size: 14, color: C.meta }), chevron: false,
      onPress: call("PUT", R, { lobby: !r.lobby }, { ok: refresh, fail: toast("Couldn't change that. Try again.") }),
    }),
  ])];

  const endIt = call("POST", `${R}/end`, {}, { ok: seq(setState("rc_sure", false), said("The call has ended."), refresh), fail: toast("Couldn't end the call. Try again.") });
  const end = ended ? [] : [col([
    when({ falsy: "rc_sure" }, quietButton("End the call for everyone", setState("rc_sure", true), { size: "md" })),
    when({ truthy: "rc_sure" }, card([
      row([statusMark("failed", { size: 10 }), text("End the call for everyone? The link stops working.", { size: 15, weight: 600, lineHeight: 20, style: { flexShrink: 1 } })], { gap: 8, alignItems: "center" }),
      row([primaryButton("End it", endIt, { size: "md" }), quietButton("Cancel", setState("rc_sure", false), { size: "md" })], { gap: 8 }),
    ], { gap: 10 })),
  ], { gap: 8 })];

  return page(ctx, {
    back: toPage(b), backTitle: "Call", title: r.title,
    ...(isDesk(ctx) ? { maxWidth: 720 } : {}),
    body: [
      col([
        text(r.title, { size: 19, weight: 600, lineHeight: 24 }),
        meta(`${r.host} · ${standing(ctx, r)}`, { size: 13 }),
      ], { gap: 2 }),
      ...(ended ? [notice("This call has ended, and its link no longer works. Start a new one from the mail page.", { mark: "check" })] : []),
      ...joinButtons(ctx, b, r),
      ...waiting,
      ...people,
      ...(ended ? [] : [linkCard(ctx, r)]),
      ...settings,
      ...end,
    ],
    gap: 16,
    state: { rc_sure: false },
  });
}

export const mailCallScreens: BotsScreen[] = [
  screen<CallData>({
    id: SCREENS.mailCall,
    load: async (ctx, deps) => {
      const r = roomParam(ctx.params.r);
      if (!r) return {};
      const out = await deps.api<{ room: RoomView }>("GET", `${ROOMS}/${r}`).catch(() => undefined);
      return out?.room ? { room: out.room } : {};
    },
    build: (ctx, d) => callPage(ctx, d),
  }),
];
