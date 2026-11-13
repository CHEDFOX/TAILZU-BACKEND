/**
 * THE MEETING BOT'S PAGE (src/meet, routes/bots/meet.ts): bots.bot with slug "meet". Its chat is the usual bots.chat; this is its meetings.
 *
 *   the head       back, the bot's name, and a line: "In a call: <title>", else what it does
 *   join           a field for a meeting link (Meet, Zoom, Teams), For (Me, or a member an admin sends the bot for), Answer out loud, and Join. Everyone in the call sees it join
 *   in a call now the meetings it is in or joining, each with where it stands; each opens its meeting (meetScreens.ts)
 *   coming up      the meetings it will join, soonest first, with when
 *   recent         the latest meetings that are over: when, how long and the state. One with its notes ready opens the note in Notes
 *   people       (an admin's) "Your people's meetings": the members' meetings, each "<name> · <title>" with where it stands; opens it read only
 *   settings       Join my calendar's meetings, Answer out loud by default, the name it shows in calls, and the day's minutes used
 *   the ask bar    the bots' own (parts.ts chatBar): "Ask about your meetings…" goes to the meeting bot's chat
 *
 * With no meeting at all, a card says what it does. When the overview can't be read, one line says so.
 */
import type { ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import { DEFAULT_BOT_NAME, type MeetingView } from "../../../../meet/types.js";
import { botTopic } from "../../../../live/topics.js";
import {
  type BotsCtx, page, row, col, text, box, icon, labelled, back, grow, card, meta, notice, primaryButton, secondaryButton, C, botAvatar, listCard, listRow,
  sectionLabel, open, SCREENS, call, seq, switchRow, chips,
} from "../../kit.js";
import { toast } from "../firstRun/parts.js";
import { mailField } from "./mailCards.js";
import { type MeetData, MEET, isLive, lengthOf, openMeeting, plain, statusLine, whenOf } from "./meetScreens.js";
import { type BotPageData, chatBar, isDesk, lookOf, setState } from "./parts.js";

export type MeetPageData = BotPageData & { meet?: MeetData };

const said = (message: string): ActionSpec => ({ kind: "toast", message, tone: "success" } as ActionSpec);
const refresh: ActionSpec = { kind: "refresh" };
const titleOf = (m: MeetingView): string => plain(m.title) || "Meeting";
/** The line under a meeting, and "· Sent by <name>" when an admin sent the bot to it. */
const subOf = (text: string, m: MeetingView): string => (m.by ? `${text} · Sent by ${plain(m.by)}` : text);

/** A meeting in the call now: its title and where it stands. */
const liveRow = (ctx: BotsCtx, m: MeetingView): Node => listRow({ label: titleOf(m), sub: subOf(statusLine(ctx, m), m), onPress: openMeeting(m.id) });

/** A meeting still to come: its title and when. */
const upcomingRow = (ctx: BotsCtx, m: MeetingView): Node => listRow({ label: titleOf(m), sub: subOf(m.joinAt ? whenOf(ctx, m.joinAt) : "Scheduled", m), onPress: openMeeting(m.id) });

/** A member's meeting, seen by their admin: whose, then where it stands. */
const personRow = (ctx: BotsCtx, m: MeetingView): Node => {
  const when = isLive(m) || !(m.startedAt ?? m.endedAt ?? m.joinAt) ? "" : whenOf(ctx, (m.status === "scheduled" ? m.joinAt : m.startedAt ?? m.endedAt ?? m.joinAt)!);
  return listRow({
    label: `${plain(m.owner?.name) || "A member"} · ${titleOf(m)}`,
    sub: subOf([when, m.status === "done" || m.status === "ended" ? lengthOf(m) : "", statusLine(ctx, m)].filter(Boolean).join(" · "), m),
    onPress: openMeeting(m.id),
  });
};

/** A meeting that is over: when, how long and the state. Its notes, once ready, open in Notes; the others open the meeting. */
function recentRow(ctx: BotsCtx, m: MeetingView): Node {
  const at = m.startedAt ?? m.endedAt ?? m.joinAt;
  const sub = subOf([at ? whenOf(ctx, at) : "", lengthOf(m), statusLine(ctx, m)].filter(Boolean).join(" · "), m);
  const notes = !!m.noteId && m.status === "done";
  return listRow({
    label: titleOf(m), sub, strong: notes,
    onPress: notes ? { kind: "navigate", screenId: SCREENS.note, params: { id: m.noteId } } as ActionSpec : openMeeting(m.id),
  });
}

export function meetPage(ctx: BotsCtx, d: MeetPageData) {
  const bot = d.bot!;
  const look = lookOf(bot.slug, bot.colour);
  const data: MeetData = d.meet ?? {};
  const o = data.overview;
  const desk = isDesk(ctx);

  const now = o?.live[0];
  const line = now ? `In a call: ${titleOf(now)}` : "Joins your calls, takes the notes, answers questions";
  const name = col([
    text(bot.name, { size: desk ? 17 : 19, weight: 600, lineHeight: desk ? 22 : 24 }),
    meta(line, { size: 12, lines: 1 }),
  ], { gap: 1, flexShrink: 1 });
  const head = desk
    ? row([botAvatar(look, 30), name, grow()], { gap: 10 })
    : row([
      labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back"),
      name, grow(),
    ], { gap: 6 });

  const body: Node[] = [head];

  if (!o) {
    body.push(notice("The meetings couldn't be read just now. Pull to try again.", { mark: "close" }));
  } else {
    // Join: the link, whether it answers out loud, and Join.
    const join: ActionSpec = {
      kind: "condition", if: { truthy: "mt_url" },
      then: call("POST", `${MEET}/join`, { url: "$state.mt_url", voice: "$state.mt_voice", forUser: "$state.mt_for" }, {
        ok: seq(setState("mt_url", ""), setState("mt_for", ""), said("Joining. Let it in if the call asks."), refresh),
        fail: toast("Couldn't join. Check that the link is a Meet, Zoom or Teams call."),
      }),
      else: toast("Paste a meeting link first."),
    } as ActionSpec;
    body.push(col([
      sectionLabel("Join a meeting"),
      mailField("mt_url", "Paste a meeting link (Meet, Zoom, Teams)", desk, { label: "the meeting link", keyboard: "email", onSubmit: join }),
      ...(o.sendFor?.length ? [col([
        meta("For", { size: 12 }),
        chips([{ label: "Me", value: "" }, ...o.sendFor.map((p) => ({ label: plain(p.name) || "Member", value: p.id }))], "mt_for"),
      ], { gap: 6 })] : []),
      listCard([switchRow("Answer out loud", "mt_voice")]),
      primaryButton("Join", join, { size: "md" }),
    ], { gap: 10 }));

    if (!o.live.length && !o.upcoming.length && !o.recent.length && !o.people?.length) {
      body.push(card([
        row([icon("mic", { size: 28, color: look.color })], { justifyContent: "center" }),
        text("Paste a meeting link and your bot joins the call. It takes the notes, answers questions in the chat and out loud, and turns what was agreed into your to-dos.", { size: 14, color: C.ink, align: "center", lineHeight: 20 }),
        text("Everyone in the call sees it join, and it says so in the chat.", { size: 13, color: C.meta, align: "center", lineHeight: 18 }),
      ], { dashed: true, gap: 10, padding: 22, style: { alignItems: "center" } }));
    }
    if (o.live.length) body.push(listCard(o.live.map((m) => liveRow(ctx, m)), { title: "In a call now" }));
    if (o.upcoming.length) body.push(listCard(o.upcoming.map((m) => upcomingRow(ctx, m)), { title: "Coming up" }));
    if (o.recent.length) body.push(listCard(o.recent.map((m) => recentRow(ctx, m)), { title: "Recent" }));
    if (o.people?.length) body.push(listCard(o.people.map((m) => personRow(ctx, m)), { title: "Your people's meetings" }));

    // Settings: each switch saves as it is turned; the name, on Save.
    const put = (k: string, v: string): ActionSpec => call("PUT", `${MEET}/settings`, { [k]: v }, { fail: toast("Couldn't save that. Try again.") }) as ActionSpec;
    body.push(col([
      sectionLabel("Settings"),
      listCard([
        switchRow("Join my calendar's meetings", "ms_auto", { sub: "It joins each one by itself, a minute early.", onChange: put("autoJoin", "$state.ms_auto") }),
        switchRow("Answer out loud by default", "ms_voice", { onChange: put("voice", "$state.ms_voice") }),
      ]),
      ...(o.calendar ? [] : [meta("Connect Google Calendar in You › Connected apps first.", { size: 13, lineHeight: 18 })]),
      meta("Name in calls", { size: 12 }),
      mailField("ms_name", DEFAULT_BOT_NAME, desk, { label: "the name in calls", capitalize: true }),
      secondaryButton("Save", call("PUT", `${MEET}/settings`, { botName: "$state.ms_name" }, { ok: said("Saved."), fail: toast("Couldn't save the name. Try again.") }), { size: "md" }),
      meta(`${o.minutesToday} of ${o.minutesCap} minutes used today`, { size: 12 }),
    ], { gap: 10 }));
  }

  return page(ctx, {
    back: desk, title: bot.name, nav: bot.slug, ...(desk ? { maxWidth: 720 } : {}),
    body,
    footer: o ? [chatBar(ctx, bot.slug, bot.name, "Ask about your meetings…", open(SCREENS.chat, { slug: bot.slug }))] : [],
    gap: 18,
    live: [botTopic("meet")],
    state: {
      mt_url: "", mt_for: "", mt_voice: !!o?.settings.voice,
      ms_auto: !!o?.settings.autoJoin, ms_voice: !!o?.settings.voice, ms_name: o?.settings.botName ?? "",
    },
  });
}

