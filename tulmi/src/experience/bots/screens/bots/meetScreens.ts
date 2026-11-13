/**
 * THE MEETING BOT'S SCREENS BEHIND ITS PAGE (src/meet, routes/bots/meet.ts), and what its page reads.
 *
 *   bots.meet.meeting   params m: one meeting. Its title, where it stands (joining, in the call, scheduled, ended, couldn't join), the
 *                       platform in words and who is in it. In the call: Leave the call, Answer out loud, and the notes so far (the points
 *                       and who does what). Scheduled: Call it off, on a second yes. With a note: Open the notes. Under it, each question
 *                       people asked the bot, with its answer and whether it was said out loud or in the chat. Gone: a card and a way back.
 *                       An admin looking at a member's meeting (readOnly) sees whose it is and the notes, with no Leave, switch, call-off or note;
 *                       a meeting the admin sent the bot to says "Sent by"
 *
 * With notes or answers there is also a Share with a space or person (the notes and the Q and A as text; none while Spaces is off).
 *
 * The page itself is meetPage.ts. Everything here is the person's own (routes/bots/meet.ts): nothing is read from the call but the notes.
 */
import type { ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import { MEET_SLUG, type MeetAsk, type MeetingDetail, type MeetingView, type MeetOverview, type Platform } from "../../../../meet/types.js";
import { botTopic, noteTopic } from "../../../../live/topics.js";
import {
  type BotsCtx, page, row, col, text, card, chip, meta, notice, primaryButton, secondaryButton, quietButton, sectionLabel, switchRow, listCard,
  listRow, call, seq, when, SCREENS, statusMark,
} from "../../kit.js";
import { type BotsScreen, screen } from "../../registry.js";
import { toast } from "../firstRun/parts.js";
import { clockOf, dayKeyOf, isDesk, setState, shortDate } from "./parts.js";
import { shareButtonsFor } from "../../shareAction.js";

type Deps = Parameters<NonNullable<BotsScreen["load"]>>[1];

export const MEET = "/v1/meet";
const MIN = 60_000, DAY = 86_400_000;
const said = (message: string): ActionSpec => ({ kind: "toast", message, tone: "success" } as ActionSpec);
const refresh: ActionSpec = { kind: "refresh" };
const idParam = (v: unknown): string => (/^[A-Za-z0-9_-]{1,64}$/.test(String(v ?? "")) ? String(v) : "");

// ===================================================================== shared with the page

/** What the bot's page reads: the overview, or that it could not be read. */
export type MeetData = { overview?: MeetOverview; down?: boolean };

export async function loadMeet(_ctx: BotsCtx, deps: Deps): Promise<MeetData> {
  const overview = await deps.api<MeetOverview>("GET", `${MEET}/overview`).catch(() => undefined);
  return overview ? { overview } : { down: true };
}

/** A text from a call (a title, a name, a question) never starts with "@": the apps read that as a mention. */
export const plain = (s: string | null | undefined): string => String(s ?? "").trim().replace(/^[@\s]+/, "");

export const PLATFORM_WORDS: Record<Platform, string> = { google_meet: "Google Meet", zoom: "Zoom", teams: "Microsoft Teams", webex: "Webex" };

/** The meeting's page, opened from a row. */
export const openMeeting = (id: string): ActionSpec => ({ kind: "navigate", screenId: SCREENS.meetMeeting, params: { m: id } });
/** The bot's page, replacing this screen (a push may have opened it with nothing behind). */
export const toMeetPage: ActionSpec = { kind: "navigate", screenId: SCREENS.bot, params: { slug: MEET_SLUG }, replace: true };

/** "Today, 3:00 pm", "Tomorrow, 9:30 am", "12 Nov, 4:00 pm". */
export function whenOf(ctx: BotsCtx, ms: number): string {
  const k = dayKeyOf(ctx, ms), now = ctx.live.now;
  const day = k === dayKeyOf(ctx, now) ? "Today" : k === dayKeyOf(ctx, now + DAY) ? "Tomorrow" : k === dayKeyOf(ctx, now - DAY) ? "Yesterday" : shortDate(ctx, ms);
  return `${day}, ${clockOf(ctx, ms)}`;
}

/** "42 min", "1 h 5 min": how long a meeting ran; nothing before it started or without an end. */
export function lengthOf(m: Pick<MeetingView, "startedAt" | "endedAt">): string {
  if (!m.startedAt || !m.endedAt || m.endedAt <= m.startedAt) return "";
  const mins = Math.max(1, Math.round((m.endedAt - m.startedAt) / MIN));
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ""}`;
}

export const isLive = (m: Pick<MeetingView, "status">): boolean => m.status === "joining" || m.status === "waiting" || m.status === "in_call";

const people = (n: number): string => (n === 1 ? "1 person" : `${n} people`);

/** Where a meeting stands, in a few words. */
export function statusLine(ctx: BotsCtx, m: MeetingView): string {
  switch (m.status) {
    case "joining": return "Joining…";
    case "waiting": return "Waiting to be let in";
    case "in_call": return m.participants.length ? `In the call · ${people(m.participants.length)}` : "In the call";
    case "scheduled": return m.joinAt ? `Scheduled for ${whenOf(ctx, m.joinAt)}` : "Scheduled";
    case "failed": return `Couldn't join: ${plain(m.error) || "it didn't work out"}`;
    case "cancelled": return "Called off";
    case "done": return m.noteId ? "Notes ready" : "Notes being written";
    default: return m.noteId ? "Ended · notes ready" : "Ended";
  }
}

// ===================================================================== bots.meet.meeting

export type MeetingData = { detail?: MeetingDetail };

function askCard(a: MeetAsk): Node {
  return card([
    row([
      text(plain(a.askedBy) || "Someone", { size: 13, weight: 600, lineHeight: 17, style: { flexShrink: 1 } }),
      meta(a.how === "voice" ? "out loud" : "in the chat", { size: 12 }),
    ], { gap: 8, justifyContent: "space-between" }),
    text(plain(a.question), { size: 14, lineHeight: 19 }),
    text(plain(a.answer), { size: 14, lineHeight: 19, weight: 500 }),
  ], { gap: 6, padding: 14 });
}

export function meetingPage(ctx: BotsCtx, d: MeetingData | undefined) {
  const desk = isDesk(ctx);
  const m = d?.detail?.meeting;
  if (!m) {
    return page(ctx, {
      back: true, backTitle: "Meetings", title: "Meeting", nav: MEET_SLUG, ...(desk ? { maxWidth: 720 } : {}),
      body: [card([
        text("This meeting isn't here any more.", { size: 16, weight: 600, lineHeight: 21 }),
        meta("It may have been called off or removed.", { size: 13, lineHeight: 18 }),
        primaryButton("Back to meetings", toMeetPage, { size: "md" }),
      ], { gap: 10, padding: 20 })],
    });
  }
  const asks = d?.detail?.asks ?? [];
  const M = `${MEET}/meetings/${m.id}`;
  const live = isLive(m);
  const ro = !!d?.detail?.readOnly;
  const title = plain(m.title) || "Meeting";

  const out = call("DELETE", M, undefined, { ok: seq(said("Called off."), toMeetPage), fail: toast("Couldn't call it off. Try again.") });
  const leave = call("POST", `${M}/leave`, {}, { ok: seq(said("Leaving the call."), refresh), fail: toast("Couldn't leave just now. Try again.") });

  const body: Node[] = [
    col([
      text(title, { size: 20, weight: 600, lineHeight: 25, tracking: -0.3 }),
      row([live ? statusMark("working", { size: 9 }) : statusMark(m.status === "failed" ? "failed" : m.status === "scheduled" ? "waiting" : "done", { size: 9 }),
        meta(statusLine(ctx, m), { size: 13, lineHeight: 18, style: { flexShrink: 1 } })], { gap: 8, alignItems: "center" }),
      ...(ro && m.owner ? [meta(`${plain(m.owner.name) || "A member"}'s meeting`, { size: 13, lineHeight: 18 })] : []),
      ...(m.by ? [meta(`Sent by ${plain(m.by)}`, { size: 13, lineHeight: 18 })] : []),
      meta([PLATFORM_WORDS[m.platform] ?? "Video call", m.startedAt && m.endedAt ? lengthOf(m) : ""].filter(Boolean).join(" · "), { size: 12 }),
    ], { gap: 6 }),
  ];
  if (m.status === "failed") body.push(notice(`Couldn't join: ${plain(m.error) || "it didn't work out"}`, { mark: "close" }));
  if (m.participants.length) {
    body.push(col([sectionLabel("In the call"), row(m.participants.map((p) => chip(plain(p) || "Guest")), { gap: 6, flexWrap: "wrap" })], { gap: 8 }));
  }

  if (live && !ro) {
    body.push(listCard([switchRow("Answer out loud", "mm_voice", {
      sub: "On, it says its answers. Off, it writes them in the call's chat.",
      onChange: call("PUT", M, { voice: "$state.mm_voice" }, { fail: toast("Couldn't change that. Try again.") }),
    })]));
    body.push(secondaryButton("Leave the call", leave, { size: "md" }));
  }
  if (live) {
    const n = m.liveNotes;
    body.push(col([
      sectionLabel("Notes so far"),
      ...(n && (n.points.length || n.actions.length) ? [
        ...n.points.map((p) => text(plain(p), { size: 14, lineHeight: 19 })),
        ...(n.actions.length ? [listCard(n.actions.map((a) => listRow({ label: plain(a.who) ? `${plain(a.who)}: ${plain(a.what)}` : plain(a.what), chevron: false })))] : []),
      ] : [meta("Notes appear a few minutes in.", { size: 13 })]),
    ], { gap: 8 }));
  }

  if (m.status === "scheduled" && !ro) {
    body.push(col([
      when({ falsy: "mm_sure" }, quietButton("Call it off", setState("mm_sure", true), { size: "md" })),
      when({ truthy: "mm_sure" }, card([
        text(`Call off ${title}?`, { size: 15, weight: 600, lineHeight: 20 }),
        meta("The bot won't join. You can paste the link again any time.", { size: 13, lineHeight: 18 }),
        row([primaryButton("Call it off", out, { size: "md" }), quietButton("Keep it", setState("mm_sure", false), { size: "md" })], { gap: 8 }),
      ], { gap: 10 })),
    ], { gap: 8 }));
  }

  if (m.noteId && !ro) body.push(primaryButton("Open the notes", { kind: "navigate", screenId: SCREENS.note, params: { id: m.noteId } } as ActionSpec, { size: "md" }));

  if (asks.length) body.push(col([sectionLabel("Questions it answered"), ...asks.map(askCard)], { gap: 8 }));

  // Share with a space or person: the notes so far and the questions it answered, as text. Only when there is something to share.
  const n = m.liveNotes;
  const noted = [
    ...(n?.points.length ? n.points.map((p) => plain(p)) : []),
    ...(n?.actions.length ? ["Who does what:", ...n.actions.map((a) => (plain(a.who) ? `${plain(a.who)}: ${plain(a.what)}` : plain(a.what)))] : []),
    ...(asks.length ? ["Questions it answered:", ...asks.map((a) => `Q: ${plain(a.question)}\nA: ${plain(a.answer)}`)] : []),
  ];
  if (noted.length) body.push(...shareButtonsFor(ctx, { kind: "text", title: plain(m.title) || "Meeting notes", text: noted.join("\n"), bot: "meet" }));

  return page(ctx, {
    back: true, backTitle: "Meetings", title, nav: MEET_SLUG, ...(desk ? { maxWidth: 720 } : {}),
    body, gap: 18,
    live: [botTopic(MEET_SLUG), noteTopic(m.noteId)].filter(Boolean),
    state: { mm_voice: !!m.voice, mm_sure: false },
  });
}

export const meetScreens: BotsScreen[] = [
  screen<MeetingData>({
    id: SCREENS.meetMeeting,
    load: async (ctx, deps: Deps) => {
      const m = idParam(ctx.params.m);
      return m ? { detail: await deps.api<MeetingDetail>("GET", `${MEET}/meetings/${m}`).catch(() => undefined) } : {};
    },
    build: (ctx, d) => meetingPage(ctx, d),
  }),
];
