/**
 * A BOT'S PAGE AS ITS CONVERSATIONS (screens/bots.ts botPhone), not one endless chat.
 *
 * The page used to open with the last two turns of one running chat and a type box nailed to the foot. That makes a
 * bot look like a single conversation you can only ever add to — and it buried everything that bot has actually been
 * used for. Sessions were built for exactly this (botsBots/sessions.ts: each names itself from its first words, none
 * ever closes, each keeps the picture it made) and nothing drew them, so the store was ahead of the screen.
 *
 * So the page is the list: what you have talked to this bot about, newest first, each one openable where it stopped.
 *
 *   NO TYPE BOX ON THE PAGE. A box at the foot of a list is a question nobody asked — it says "add to which one?".
 *   The one way to start is the round "+", which is the same gesture as the "+" on Activities: begin something.
 *
 *   "+" STARTS A NEW ONE, which is what sessions.ts always said that gesture meant ("a new one, whatever is open").
 *   Tapping a row carries on with that one instead. A build whose phone cannot fill a "$state.x" param (no
 *   ActionParams) cannot be sent "make one, then open the id it gave back", so its "+" opens the chat, which carries
 *   on the last session — the same place it has always landed.
 */
import type { ActionRef, Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, type LiveBot, box, C, col, icon, labelled, meta, open, row, SCREENS, sectionLabel, text, grow, call,
  picture, botAvatar,
} from "../../kit.js";
import { A } from "./parts.js";

/** A conversation with this bot, as its row draws it (botsBots/sessions.ts Session). */
export interface BotSession {
  id: string;
  title: string;
  frame: string | null;
  startedAt: number;
  touchedAt: number;
}

/** Where the picture a session made is served from, when it kept one (media). */
const frameUrl = (key: string): string => `/v1/media/${encodeURIComponent(key)}`;

/** A build whose phone fills "$state.x" in a navigate's params, so it can be sent "make one, then open it". */
const canOpenMade = (ctx: BotsCtx): boolean => ctx.client === "desktop" || ctx.can.has("ActionParams");

/** "today", "yesterday", "Tue", "9 Nov" — when it was last picked up. */
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function whenWord(at: number, now: number, tz: number): string {
  const d = new Date(at + tz * 60_000);
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return DAY[d.getUTCDay()] ?? "";
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}

/**
 * THE "+": a new conversation, opened. Where the phone cannot fill the id the server hands back, it opens the chat
 * instead — which carries on the last one, exactly as the page has always done.
 */
export function newSession(ctx: BotsCtx, slug: string): ActionRef {
  if (!canOpenMade(ctx)) return open(SCREENS.chat, { slug });
  return call("POST", `${A}/sessions/${encodeURIComponent(slug)}`, {}, {
    assignTo: "made",
    ok: open(SCREENS.session, { s: "$state.made.session.id" }),
    // The session could not be made: the chat still opens, on the last one. Never a dead button.
    fail: open(SCREENS.chat, { slug }),
  });
}

/** The round "+" at the foot of a bot's page: begin something, the same gesture as the one on Activities. */
export function newSessionKey(ctx: BotsCtx, slug: string): Node {
  return row([grow(), labelled(box([icon("plus", { size: 26, color: C.paper, weight: 2.6 })], {
    width: 56, height: 56, borderRadius: 28, backgroundColor: C.ink, alignItems: "center", justifyContent: "center", flexShrink: 0,
  }, newSession(ctx, slug)), "Start a new chat")], {});
}

/** One conversation: the picture it made where it has one, its name, and when it was last picked up. */
function sessionRow(ctx: BotsCtx, bot: LiveBot | { color: string; icon: Parameters<typeof botAvatar>[0]["icon"]; head?: string }, s: BotSession, onPick?: (id: string) => ActionRef): Node {
  const when = whenWord(s.touchedAt, ctx.live.now, ctx.tzOffsetMinutes);
  return row([
    s.frame
      ? picture(frameUrl(s.frame), 40, 40, { radius: 12, label: "" })
      : botAvatar(bot, 34),
    col([
      text(s.title || "A conversation", { size: 15, weight: 500, lineHeight: 20, lines: 2 }),
      meta(when, { size: 12, lines: 1 }),
    ], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    icon("chevron", { size: 16, color: C.meta }),
  ], {
    gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: C.line, alignItems: "center",
    // A bot's conversation opens on its own page. Talk's carries on in Talk, which is a tab and takes no params, so
    // it hands its own action instead (screens/bots/talkThreads.ts).
  }, onPick ? onPick(s.id) : open(SCREENS.session, { s: s.id }));
}

/**
 * The conversations with this bot. Nothing at all where it has none: a new bot's page should say what the bot is for
 * and offer the "+", not an empty list with a heading over it.
 */
export function botSessions(
  ctx: BotsCtx,
  bot: LiveBot | { color: string; icon: Parameters<typeof botAvatar>[0]["icon"]; head?: string },
  sessions: readonly BotSession[] | undefined,
  o: { label?: string; onPick?: (id: string) => ActionRef } = {},
): Node[] {
  const list = (sessions ?? []).filter((s) => s && typeof s.id === "string");
  if (!list.length) return [];
  return [col([
    row([sectionLabel(o.label ?? "Your conversations"), grow(), meta(String(list.length), { size: 12 })], { alignItems: "center" }),
    ...list.map((s) => sessionRow(ctx, bot, s, o.onPick)),
  ], { gap: 10 })];
}

/** What a bot's page starts with, where its "+" makes a session (the id it gets back is read from here). */
export const SESSION_STATE: Record<string, unknown> = { made: null };
