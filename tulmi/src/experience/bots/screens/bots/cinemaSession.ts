/**
 * A SESSION'S OWN SCREEN (bots.session, params s): one conversation with a bot and everything made in it, which never closes.
 *
 *   the head        back, what the session is about, when it began and how much is in it
 *   the talk        what the person said (in their own weight) and what the bot answered, oldest first, with what was made drawn where
 *                   it happened: a film at whatever stage it has reached, a picture full width
 *   picked up       a dotted line across the talk wherever the session was left and come back to (sessions.ts GAP_MS), with the date in
 *                   the break - the same dotted language the thread outside is drawn in
 *   the card        what the bot thinks they want (src/cinema/propose.ts): the length and the shape already chosen from what they said,
 *                   every other length and shape a tap away, the concept in its own words, a line to change it, and Create
 *   the foot        a box to say the next thing
 *
 * The film a session made is drawn AS IT IS, so the making happens in the talk rather than somewhere else: writing the script, the
 * script to say go to, the storyboard, the shots as they are filmed, the finished film to watch. The person never leaves the
 * conversation to find out how it is going.
 *
 * Never a model, a score or a cost (src/cinema/public.ts): the screens read a film as the person sees it.
 */
import type { ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import type { MadeInSession } from "../../../../cinema/service.js";
import type { Proposal } from "../../../../cinema/propose.js";
import { ASPECTS, CINEMA_SLUG, RATIO, type Aspect } from "../../../../cinema/types.js";
import { botTopic } from "../../../../live/topics.js";
import {
  type BotsCtx, C, box, call, col, grow, icon, meta, notice, page, picture, primaryButton, row, SCREENS, secondaryButton, seq, shapes, text,
} from "../../kit.js";
import { botLook } from "../../palette.js";
import { type BotsScreen, screen } from "../../registry.js";
import { toast } from "../firstRun/parts.js";
import { mailField } from "./mailCards.js";
import { abs, CINEMA, openFilm, statusLine } from "./cinemaScreens.js";
import { frameBox, makingFrame, momentFor } from "./cinemaMaking.js";
import { isDesk, setState } from "./parts.js";

type Deps = Parameters<NonNullable<BotsScreen["load"]>>[1];

const A = "/v1/botsapp/bots";
const said = (message: string): ActionSpec => ({ kind: "toast", message, tone: "success" } as ActionSpec);
const refresh: ActionSpec = { kind: "refresh" };
const plain = (s: string | null | undefined): string => String(s ?? "").trim();

/** A silence longer than this is drawn as a break in the talk (botsBots/sessions.ts GAP_MS). */
const GAP_MS = 6 * 3_600_000;

export interface SessionTurn { id: string; role: "me" | "bot"; text: string; at: number }
export interface SessionView {
  session: { id: string; bot: string; title: string; startedAt: number; touchedAt: number };
  turns: SessionTurn[];
  proposal?: Proposal;
  made?: MadeInSession[];
}
export type SessionData = { view?: SessionView; down?: boolean };

export const openSession = (id: string): ActionSpec => ({ kind: "navigate", screenId: SCREENS.session, params: { s: id } });

export async function loadSession(ctx: BotsCtx, deps: Deps): Promise<SessionData> {
  const id = /^[A-Za-z0-9_-]{1,64}$/.test(String(ctx.params.s ?? "")) ? String(ctx.params.s) : "";
  if (!id) return { down: true };
  const view = await deps.api<SessionView>("GET", `${A}/session/${id}`).catch(() => undefined);
  return view ? { view } : { down: true };
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "today", "yesterday", "9 Nov" - how the break in the talk says when it was picked up. */
function whenWord(at: number, now: number): string {
  const d = new Date(at);
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return DAY[d.getUTCDay()] ?? "";
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}

/** The dotted line across the talk where the session was left and come back to. */
function pickedUp(label: string): Node {
  const dots = (): Node => shapes([{ d: "M0 1 H 120", stroke: "#c0adbd", strokeWidth: 2, dash: "1 7", linecap: "round" }], { viewBox: "0 0 120 2", width: 120, height: 2 });
  return row([
    box([dots()], { flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    meta(`picked up again · ${label}`, { size: 11, lines: 1, style: { flexShrink: 0 } }),
    box([dots()], { flexGrow: 1, flexShrink: 1, minWidth: 0 }),
  ], { gap: 10, alignItems: "center", marginVertical: 8 });
}

/**
 * A film in the talk, as it is right now. The same card from the first second to the last: it says what is happening, shows the still
 * once there is one, and carries the one thing to do when the film waits for the person.
 */
function filmInTalk(ctx: BotsCtx, m: Extract<MadeInSession, { kind: "film" }>, desk: boolean, color: string): Node {
  const F = `${CINEMA}/films/${m.id}`;
  const line = m.status === "board" && m.animatic
    ? "Watch the storyboard, then say go"
    : statusLine({ status: m.status, hold: m.hold, shots: m.shots, done: m.done });
  const act = m.status === "script"
    ? primaryButton("Make the storyboard", call("POST", `${F}/approve-script`, {}, { ok: seq(said("Drawing your storyboard."), refresh), fail: toast("Couldn't start just now. Try again.") }), { size: "md" })
    : m.status === "board"
      ? primaryButton("Film it", call("POST", `${F}/approve-board`, {}, { ok: seq(said("Filming."), refresh), fail: toast("Couldn't start just now. Try again.") }), { size: "md" })
      : m.status === "done" && m.film
        ? primaryButton("Watch", { kind: "openUrl", url: abs(m.film), external: true } as ActionSpec, { size: "md" })
        : null;
  // The film's own shape, but never so tall that it swallows the talk around it. Until it is finished the frame is his
  // room, and he is in it doing the work the film is at (cinemaMaking.ts); finished, it is the film.
  const { w, h } = frameBox(m.aspect, desk ? 320 : 358, 260);
  const done = m.status === "done" && !!m.poster;
  const frame = done
    ? picture(abs(m.poster!), w, h, { radius: 14, fit: "cover", background: C.surface, label: plain(m.title) })
    : makingFrame(ctx, { color, life: `film.${m.id}`, moment: momentFor(m), w, h });
  const save = done && m.film
    ? [secondaryButton("Save it", { kind: "download", url: abs(m.film), filename: `${plain(m.title).replace(/[^\w -]+/g, "").trim() || "film"}.mp4` } as ActionSpec, { size: "md" })]
    : [];
  // The animatic, while the storyboard waits on them: the whole film, at its real length, in the frames he drew, with the
  // words over it. It is what "say go" should mean - you have seen it - and it cost nothing to make.
  const watchBoard = m.status === "board" && m.animatic
    ? [secondaryButton(m.animaticSeconds ? `Watch it: ${Math.round(m.animaticSeconds)}s` : "Watch it", { kind: "openUrl", url: abs(m.animatic), external: true } as ActionSpec, { size: "md" })]
    : [];
  return col([
    frame,
    row([col([
      text(plain(m.title) || "Your film", { size: 15.5, weight: 600, lineHeight: 20, lines: 1 }),
      meta(line, { size: 12.5, lineHeight: 17 }),
    ], { gap: 2, flexShrink: 1 }), grow()], { gap: 8, alignItems: "center" }),
    row([...(act ? [act] : []), ...watchBoard, secondaryButton("Open it", openFilm(m.id), { size: "md" }), ...save], { gap: 8, flexWrap: "wrap" }),
  ], { gap: 10, marginVertical: 4 });
}

const SHAPE_GLYPH = (a: Aspect, on: boolean): Node => {
  const r = RATIO[a] ?? 1;
  const w = r >= 1 ? 16 : 16 * r;
  const h = r >= 1 ? 16 / r : 16;
  const x = (18 - w) / 2;
  const y = (18 - h) / 2;
  return shapes([{ d: `M${x + 2} ${y}h${w - 4}a2 2 0 0 1 2 2v${h - 4}a2 2 0 0 1-2 2h-${w - 4}a2 2 0 0 1-2-2v-${h - 4}a2 2 0 0 1 2-2z`, stroke: on ? "#ffffff" : "#9a9a9a", strokeWidth: 1.6 }],
    { viewBox: "0 0 18 18", width: 18, height: 18 });
};

/** One chip of the card: soft when it is not the one chosen, the bot's black when it is. */
function pick(label: string, on: boolean, onPress: ActionSpec, glyph?: Node): Node {
  return row([...(glyph ? [glyph] : []), text(label, { size: 13, weight: on ? 600 : 500, color: on ? C.paper : C.grey70, lineHeight: 17 })], {
    gap: glyph ? 7 : 0, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 18, backgroundColor: on ? C.ink : C.surface, alignItems: "center",
  }, onPress);
}

/**
 * THE CARD. Not a form with defaults: a proposal. The length and the shape are already the ones the bot read out of the talk, and the
 * person nudges one or says what to change. Create makes the film in this session; nothing is filmed until the storyboard is agreed.
 */
function proposalCard(ctx: BotsCtx, p: Proposal, session: string, lengths: readonly number[]): Node {
  const make = call("POST", `${CINEMA}/films`, { idea: "$state.sp_concept", length: "$state.sp_len", aspect: "$state.sp_ar", session }, {
    ok: seq(said("Writing your script. It takes about a minute."), refresh),
    fail: toast("Couldn't start the film. Try again."),
  });
  const change = {
    kind: "condition", if: { truthy: "sp_note" },
    then: call("POST", `${A}/chat/cinema`, { message: "$state.sp_note", session }, {
      ok: seq(setState("sp_note", ""), refresh),
      fail: toast("Couldn't change that. Try saying it another way."),
    }),
    else: toast("Say what to change first."),
  } as ActionSpec;
  return col([
    row([box([], { width: 7, height: 7, borderRadius: 4, backgroundColor: C.ink, opacity: 0.55 }), meta("Chosen from what you said — tap to change", { size: 12.5 })], { gap: 8, alignItems: "center" }),
    col([
      meta("LENGTH", { size: 10.5 }),
      row(lengths.map((n) => pick(`${n}s`, n === p.seconds, setState("sp_len", String(n)))), { gap: 8, flexWrap: "wrap" }),
    ], { gap: 8 }),
    col([
      meta("FRAME", { size: 10.5 }),
      row(shapeOrder(p.aspect).map((a) => pick(a, a === p.aspect, setState("sp_ar", a), SHAPE_GLYPH(a, a === p.aspect))), { gap: 8, flexWrap: "wrap" }),
    ], { gap: 8 }),
    row([
      box([], { width: 3.5, borderRadius: 2, backgroundColor: C.ink, opacity: 0.25 }),
      box([text(plain(p.concept), { size: 13.5, color: C.grey70, lineHeight: 20 })], { flexGrow: 1, flexShrink: 1, paddingVertical: 12, paddingHorizontal: 14 }),
    ], { gap: 0, borderRadius: 14, backgroundColor: C.surface, alignItems: "stretch" }),
    mailField("sp_note", "Say what to change…", isDesk(ctx), { label: "the change", onSubmit: change }),
    primaryButton("Create", make, { size: "lg", wide: true }),
    meta("You see the shots before anything is filmed.", { size: 11.5, align: "center" }),
  ], { gap: 14, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper });
}

export function sessionPage(ctx: BotsCtx, d: SessionData) {
  const desk = isDesk(ctx);
  const v = d.view;
  if (!v) {
    return page(ctx, {
      back: true, title: "Session",
      body: [notice("This conversation couldn't be read.", { mark: "close" })],
      gap: 18,
    });
  }
  const s = v.session;
  const now = Date.now();
  const look = botLook(CINEMA_SLUG, ctx.live.bots.find((b) => b.slug === CINEMA_SLUG)?.color);
  const made = [...(v.made ?? [])];
  const body: Node[] = [
    col([
      text(plain(s.title) || "New session", { size: desk ? 22 : 20, weight: 700, lineHeight: 26 }),
      meta(`${whenWord(s.startedAt, now)} · ${v.turns.length} messages${made.length ? ` · ${made.length} made` : ""}`, { size: 12 }),
    ], { gap: 3 }),
  ];

  // The talk, with what was made drawn where it happened, and a dotted line across every silence.
  let last = 0;
  const drawMade = (until: number) => {
    while (made.length && made[0]!.at <= until) {
      const m = made.shift()!;
      body.push(m.kind === "film" ? filmInTalk(ctx, m, desk, look.color) : col([
        picture(abs(m.url), desk ? 320 : 358, desk ? 320 : 358, { radius: 14, fit: "cover", background: C.surface, label: plain(m.title) }),
        meta(plain(m.title), { size: 12 }),
      ], { gap: 6, marginVertical: 4 }));
    }
  };
  for (const t of v.turns) {
    if (last && t.at - last > GAP_MS) body.push(pickedUp(whenWord(t.at, now)));
    drawMade(t.at);
    body.push(t.role === "me"
      ? text(plain(t.text), { size: 15, weight: 600, lineHeight: 21 })
      : text(plain(t.text), { size: 14, color: C.grey70, lineHeight: 20 }));
    last = t.at;
  }
  drawMade(Number.MAX_SAFE_INTEGER);

  if (v.proposal) body.push(proposalCard(ctx, v.proposal, s.id, lengthsOf(v.proposal.seconds)));

  const say = {
    kind: "condition", if: { truthy: "ss_say" },
    then: call("POST", `${A}/chat/${s.bot}`, { message: "$state.ss_say", session: s.id }, {
      ok: seq(setState("ss_say", ""), refresh),
      fail: toast("Couldn't send that. Try again."),
    }),
    else: toast("Say something first."),
  } as ActionSpec;

  return page(ctx, {
    back: true, backTitle: "Back", title: plain(s.title) || "Session", nav: s.bot,
    ...(desk ? { maxWidth: 720 } : {}),
    body,
    footer: [row([
      box([mailField("ss_say", "Say something…", desk, { label: "your message", onSubmit: say })], { flexGrow: 1, flexShrink: 1 }),
      roundSend(say),
    ], { gap: 10, alignItems: "center" })],
    gap: 14,
    live: [botTopic(s.bot)],
    state: {
      ss_say: "", sp_note: "",
      sp_len: String(v.proposal?.seconds ?? 30), sp_ar: v.proposal?.aspect ?? "9:16", sp_concept: v.proposal?.concept ?? "",
    },
  });
}

/** The shapes, the ones people post in first, and whatever was proposed at the front of all of them. */
const COMMON: readonly Aspect[] = ["9:16", "4:5", "1:1", "16:9"];
const shapeOrder = (pick_: Aspect): Aspect[] => [...new Set<Aspect>([pick_, ...COMMON, ...ASPECTS])];

/** The lengths the card offers: the ladder, with what was proposed in its place (src/cinema/propose.ts lengthsFor). */
const LADDER = [10, 15, 20, 30, 45, 60, 90, 120];
const lengthsOf = (seconds: number): number[] => [...new Set([...LADDER, seconds])].sort((a, b) => a - b);

const roundSend = (onPress: ActionSpec): Node =>
  box([icon("send", { size: 20, color: C.paper })], { width: 48, height: 48, borderRadius: 24, backgroundColor: C.ink, alignItems: "center", justifyContent: "center", flexShrink: 0 }, onPress);

export const sessionScreens: BotsScreen[] = [
  screen<SessionData>({
    id: SCREENS.session,
    load: (ctx, deps: Deps) => loadSession(ctx, deps),
    build: (ctx, d) => sessionPage(ctx, d ?? {}),
  }),
];
