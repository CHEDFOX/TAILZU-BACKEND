/**
 * THE MEETING BOT'S PAGE (src/meet, routes/bots/meet.ts): bots.bot with slug "meet". Its chat is the usual bots.chat; this is its meetings.
 *
 *   the head       back, the bot's name, and a line: "In a call: <title>", else what it does
 *   the join card  one card in the Plan Ease idiom (screens/planItem.ts): the meeting link, and once there is one, When (Now, today and
 *                  the next few days), Time, For (a member an admin sends the bot for) and the name it shows in the call, then Join.
 *                  Nothing but the link until a link is in, so the page opens on the meetings and not on a form.
 *   in a call now the meetings it is in or joining, each with where it stands; each opens its meeting (meetScreens.ts)
 *   coming up      shut: a heading and how many. Open: the meetings it will join, soonest first, with when
 *   recent         shut the same way. Open: the latest meetings that are over — when, how long and the state. One with its notes ready
 *                  opens the note in Notes
 *   people       (an admin's) "Your people's meetings", shut the same way: the members' meetings, each "<name> · <title>" with where it
 *                  stands; opens it read only
 *   settings       one row to bots.meet.settings (meetScreens.ts), with the day's minutes under it
 *   the ask bar    the bots' own (parts.ts chatBar): "Ask about your meetings…" goes to the meeting bot's chat
 *
 * With no meeting at all there is just the link to paste: the field says what it takes, and the bot says who it is in the call itself
 * (meet/service.ts introLine). When the overview can't be read, one line says so.
 *
 * A day and a time book the bot for later (POST .../join with day, time and the phone's offset); "Now" and a time ten minutes off or
 * nearer send it in at once, since Recall only holds a bot asked for further ahead (meet/service.ts SCHEDULE_LEAD_MS).
 */
import type { ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import { DEFAULT_BOT_NAME, type MeetingView } from "../../../../meet/types.js";
import { botTopic } from "../../../../live/topics.js";
import {
  type BotsCtx, page, row, col, text, box, icon, labelled, back, grow, card, meta, notice, primaryButton, botAvatar, listCard, listRow,
  sectionLabel, open, SCREENS, call, seq, chips, when, whenEq, divider, RADIUS, C, canScrollX, scrollRow,
} from "../../kit.js";
import { toast } from "../firstRun/parts.js";
import { mailField } from "./mailCards.js";
import { type MeetData, MEET, isLive, lengthOf, openMeeting, plain, statusLine, whenOf } from "./meetScreens.js";
import { type BotPageData, DAY, MONTHS, WEEKDAYS, chatBar, dayKeyOf, isDesk, lookOf, setState } from "./parts.js";

export type MeetPageData = BotPageData & { meet?: MeetData };

const said = (message: string): ActionSpec => ({ kind: "toast", message, tone: "success" } as ActionSpec);
const refresh: ActionSpec = { kind: "refresh" };
const titleOf = (m: MeetingView): string => plain(m.title) || "Meeting";
/** The line under a meeting, and "· Sent by <name>" when an admin sent the bot to it. */
const subOf = (text: string, m: MeetingView): string => (m.by ? `${text} · Sent by ${plain(m.by)}` : text);
/** A label over its row, as the Plan Ease card sets one (screens/planItem.ts). */
const section = (label: string, kids: Node[]): Node => col([sectionLabel(label), ...kids], { gap: 8 });
/**
 * A list that opens on its heading: the heading says how many are in it, and the rows (with the lines between them) are behind
 * `path`, so a shut one is the heading alone — no stray line under it, which is why this is not listCard.
 */
function fold(title: string, path: string, rows: Node[]): Node {
  const inside = rows.flatMap((r, i) => (i ? [divider(), r] : [r]));
  return {
    type: "Stack",
    style: { flexDirection: "column", borderRadius: RADIUS.list, borderWidth: 1, borderColor: C.line, overflow: "hidden", backgroundColor: C.paper },
    children: [
      listRow({ label: title, value: String(rows.length), strong: true, onPress: { kind: "toggleState", path } }),
      when({ truthy: path }, col([divider(), ...inside])),
    ],
  };
}

/**
 * The days the strip offers after "Now". A build that draws a row sideways (kit canScrollX) gets a fortnight to swipe
 * along, as Plan Ease's week strip does (planHome.ts stripNodes); one that cannot gets the few that fit the width.
 */
const STRIP_DAYS = 14;
const STRIP_FIT = 5;
/** Seven of these and their gaps leave the week shown whole on a phone, with the edge of the next day past it (planHome.ts). */
const STRIP_CELL = 42;
const TIMES = [
  { label: "9 am", value: "09:00" }, { label: "12 pm", value: "12:00" }, { label: "4 pm", value: "16:00" },
  { label: "6 pm", value: "18:00" }, { label: "8 pm", value: "20:00" },
];
const TIME_VALUES = TIMES.map((t) => t.value);

/** A meeting in the call now: its title and where it stands, set strong so it reads apart from the ones that are over. */
const liveRow = (ctx: BotsCtx, m: MeetingView): Node => listRow({ label: titleOf(m), sub: subOf(statusLine(ctx, m), m), strong: true, onPress: openMeeting(m.id) });

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

/**
 * WHEN: "Now", then the days, as Plan Ease's week strip draws them (planHome.ts stripNodes) — the weekday over the date,
 * the chosen one filled in. "Now" is kept out of the scroller, the way the strip keeps its arrow out, so it is there
 * however far along the days have been pushed.
 */
function dayStrip(ctx: BotsCtx): Node {
  const scroll = canScrollX(ctx);
  const keys = Array.from({ length: scroll ? STRIP_DAYS : STRIP_FIT }, (_, i) => dayKeyOf(ctx, ctx.live.now + i * DAY));
  const shell = (kids: Node[], value: string, width: number): Node => col(kids, {
    width, alignItems: "center", justifyContent: "center", gap: 2, paddingVertical: 7, borderRadius: 14, flexShrink: 0,
    backgroundColor: whenEq("mj_day", value, C.ink, C.paper), borderWidth: 1, borderColor: whenEq("mj_day", value, C.ink, C.line),
  }, setState("mj_day", value));
  const cell = (k: string): Node => {
    const d = new Date(`${k}T00:00:00Z`);
    return labelled(shell([
      text(WEEKDAYS[d.getUTCDay()]!, { size: 11, weight: 500, lineHeight: 14, style: { color: whenEq("mj_day", k, C.paper, C.meta) } }),
      text(String(d.getUTCDate()), { size: 15, weight: 600, lineHeight: 20, style: { color: whenEq("mj_day", k, C.paper, C.ink) } }),
    ], k, STRIP_CELL), `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`);
  };
  const now = labelled(shell([
    text("Now", { size: 13, weight: 600, lineHeight: 34, style: { color: whenEq("mj_day", "", C.paper, C.ink) } }),
  ], "", STRIP_CELL + 10), "Join the call now");
  const cells = keys.map(cell);
  return scroll
    ? row([now, scrollRow(cells, { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 4 })], { gap: 4, alignItems: "stretch" })
    : row([now, ...cells], { gap: 4, alignItems: "stretch" });
}

/**
 * The join card: the link, and under it — only once a link is in — when, for who and the name it shows. One Join.
 * The name is the person's own (meet settings): joining with another keeps it, so the next call has it too.
 */
function joinCard(ctx: BotsCtx, sendFor: Array<{ id: string; name: string }>, desk: boolean): Node {
  const send = call("POST", `${MEET}/join`, {
    url: "$state.mj_url", forUser: "$state.mj_for", botName: "$state.mj_name",
    day: "$state.mj_day", time: "$state.mj_time", tz: ctx.tzOffsetMinutes,
  }, {
    ok: seq(
      setState("mj_url", ""), setState("mj_day", ""), setState("mj_time", ""), setState("mj_for", ""),
      said("Done. Let it in if the call asks."), refresh,
    ),
    fail: toast("Couldn't do that. Check the link and the time."),
  });
  // A day with no time is no moment, and the server would only say so: ask here instead.
  const join: ActionSpec = {
    kind: "condition", if: { truthy: "mj_url" },
    then: { kind: "condition", if: { all: [{ truthy: "mj_day" }, { falsy: "mj_time" }] }, then: toast("Say the time as well, or pick Now."), else: send },
    else: toast("Paste a meeting link first."),
  } as ActionSpec;

  const rest: Node[] = [
    section("When", [dayStrip(ctx)]),
    when({ truthy: "mj_day" }, section("Time", [
      chips(TIMES, "mj_time"),
      when({ not: { in: ["mj_time", TIME_VALUES] } }, mailField("mj_time", "Or type a time, like 17:30", desk, { label: "the time" })),
    ])),
    ...(sendFor.length ? [section("For", [
      chips([{ label: "Me", value: "" }, ...sendFor.map((p) => ({ label: plain(p.name) || "Member", value: p.id }))], "mj_for"),
    ])] : []),
    section("Name in the call", [mailField("mj_name", DEFAULT_BOT_NAME, desk, { label: "the name in calls", capitalize: true })]),
    primaryButton("Join", join, { wide: true }),
  ];

  return card([
    section("Meeting link", [mailField("mj_url", "Meet, Zoom, Teams or Webex", desk, { label: "the meeting link", keyboard: "email", onSubmit: join })]),
    when({ truthy: "mj_url" }, col(rest, { gap: 14 })),
  ], { gap: 14, padding: desk ? 20 : 16 });
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
    body.push(joinCard(ctx, o.sendFor ?? [], desk));

    // What it is in now is the one thing worth seeing without asking; the rest open on their heading.
    if (o.live.length) body.push(listCard(o.live.map((m) => liveRow(ctx, m)), { title: "In a call now" }));
    if (o.upcoming.length) body.push(fold("Coming up", "mp_up", o.upcoming.map((m) => upcomingRow(ctx, m))));
    if (o.recent.length) body.push(fold("Recent", "mp_recent", o.recent.map((m) => recentRow(ctx, m))));
    if (o.people?.length) body.push(fold("Your people's meetings", "mp_people", o.people.map((m) => personRow(ctx, m))));

    // The switches, and the day's minutes under the row that holds them (meetScreens.ts meetSettingsPage).
    body.push(listCard([listRow({
      label: "Settings",
      sub: `${o.minutesToday} of ${o.minutesCap} minutes used today`,
      onPress: open(SCREENS.meetSettings),
    })]));
  }

  return page(ctx, {
    back: desk, title: bot.name, nav: bot.slug, ...(desk ? { maxWidth: 720 } : {}),
    body,
    footer: o ? [chatBar(ctx, bot.slug, bot.name, "Ask about your meetings…", open(SCREENS.chat, { slug: bot.slug }))] : [],
    gap: 18,
    live: [botTopic("meet")],
    state: { mj_url: "", mj_day: "", mj_time: "", mj_for: "", mj_name: o?.settings.botName ?? "", mp_up: false, mp_recent: false, mp_people: false },
  });
}
