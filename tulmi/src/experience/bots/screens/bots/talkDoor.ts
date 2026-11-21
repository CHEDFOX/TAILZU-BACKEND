/**
 * TALK: THE ONE SCREEN (`bots.talk`, the tab the app opens on). docs/talk-door.md has the whole design.
 *
 * The app used to open on a grid of bots, and a person had to know which one a thing belonged to before they could ask
 * for it. On a phone that grid is a list you scroll. So this is the other way round: one thread, you say what you want,
 * and whichever bot it belongs to answers IN it. Nobody picks a bot to get something done.
 *
 * THE SCREEN DRAWS NOTHING NEW, and that is the design, not a shortcut. Everything in a turn is something the app already
 * draws somewhere:
 *
 *   the words           answerBlocks (screens/bots/parts.ts), as every bot's chat draws them
 *   what the bot drew   showNodes (experience/bots/show.ts): the blocks the bot itself chose from its own answer —
 *                       a choice, the steps, a table, a chart, a drawing (docs/show.md). This is why a "bot interface"
 *                       appears in the chat at all, and why it is only ever as big as the answer needs.
 *   what it found       findsCards (screens/finds.ts): flights, stays, money, weather
 *   a routine to save   routineCard (screens/routines.ts)
 *   what it left to do  jobCard / payCard / waitsCard (screens/shell/doorCards.ts), shared with the Ask screen
 *   Share and Report    answerShare (parts.ts), App Review 1.2 and 4.7.1 — a bot's answer is reportable here too
 *
 * WHAT IS NEW is only the thread's own two things: each answer says WHICH bot gave it (a turn's `by`), because one
 * thread holds every bot now; and the pills, because Xode is the one surface a message in a thread cannot stand in for.
 *
 * XODE IS A PILL, NOT A TURN. Everything else answers with words and a card. Xode answers with a project, a branch, a
 * plan, a job and a pull request, and it needs to know which project before it can do anything. That is a place, not a
 * message — so it sits beside Talk and keeps its own page. Asking Xode for something in plain language still works from
 * here: the door routes a code task to it and the answer is the job card, which opens the job.
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import { MENTION_COMMANDS_CAPABILITY, MENTION_FIELD_COMPONENT } from "../../../../../../shared/types/sdui.js";
import type { Card } from "../../../../everyday/index.js";
import type { ChatTurn } from "../../../../botsBots/chat.js";
import { TALK_COMMANDS, slashBots } from "../../../../botsBots/talkWords.js";
import {
  type BotsCtx, page, col, row, text, meta, grow, C, open, SCREENS, seq, chip, atText,
  emptyState, botLook, botKind, canPersonBot, appMark, roundButton,
  pillSwitch, mentionField, hasSpaces,
} from "../../kit.js";
import type { BotsDeps } from "../../live.js";
import { askMoment, SENT_WORDS, start as momentStart, streamed, failed as momentFailed, done as momentDone } from "../../askMoment.js";
import { showNodes } from "../../show.js";
import { answerBlocks, answerShare, bubble, clockOf, FRESH_MS, inputBox, refresh, SCREEN_DOTS, sendField, setState, toast, type Turn } from "./parts.js";
import { findsCards } from "../finds.js";
import { isRoutineToken, routineCard, routineCardState } from "../routines.js";
import { didCards } from "../shell/doorCards.js";
import { nameOf, avatarOf } from "../shell/parts.js";
// Home's asks, drawn here because this is the screen the app opens on (see TalkData.notices).
import { homeNotices } from "../shell/home.js";
import { type DeletionState, DELETION_PATH } from "../accountGrace.js";
import { type AiConsent, AI_CONSENT_PATH } from "../firstRun/aiConsentCard.js";
import { ABOUT_PATH } from "../firstRun/aboutCard.js";
import { arrivalCard, ARRIVAL_PATH } from "../firstRun/arrivalCard.js";
import { PUSH_ASK_PATH } from "../pushAsk.js";
import type { About } from "../firstRun/parts.js";
import { canUpload, uploadChip } from "../../media.js";
import { SHOW_STATE } from "../../show.js";
// The insert key and its card: the ask bar's own, so a file is inserted the one way everywhere (ask.ts).
import { insertCard, insertKey, INSERT_PATHS } from "../../ask.js";

/** The door this screen sends everything to (routes/bots/botsTalk.ts). */
const TALK_PATH = "/v1/botsapp/talk";
/** Where the field keeps what is typed and the two chips it can carry (a MentionDraft). */
const DRAFT = "draft";
/** Where the two marks are copied before the box is cleared, so the call still has them (see `send`). */
const BOT = "toBot";
const TO = "toWho";
/** Where a file on its way, and a file on the message, are kept: the ask bar's own paths, so its card fills the same ones. */
const ATTACH = INSERT_PATHS.attach;
const SHOTS = INSERT_PATHS.shots;
/** The most turns drawn at once. The thread keeps everything; this is what one screen carries (parts.ts SCREEN_DOTS caps its pictures). */
export const TALK_TURNS = 40;

/** What the screen reads: the thread, who "@" offers, and the cards for the newest answer that found something. */
export interface TalkData {
  turns?: ChatTurn[];
  session?: string | null;
  people?: Array<{ id: string; name: string; bot?: unknown }>;
  /** The everyday tools' cards for the newest answer that has any (GET /v1/everyday/finds/:id), as the Ask page reads them. */
  finds?: { turn: string; cards: Card[] } | undefined;
  down?: boolean;
  /**
   * HOME'S ASKS, WHICH ARE NOW THIS SCREEN'S TOO, because this is the screen the app opens on (shell/home.ts homeNotices).
   *
   * They were on Home because Home was where everyone landed. Moving the landing without moving them would have been the
   * real bug in this change: the AI permission in particular is asked in ONE place and nothing may be sent to a model
   * before it is answered (privacy/aiGate.ts refuses the call) — so a Talk that landed people and never asked would have
   * met them with a refusal and no way to clear it. The microphone and keyboard card, the username card, the
   * notifications ask and the deletion notice are the same kind of thing: an ask that only Home carried.
   *
   * The cards themselves are Home's own, unchanged and drawn by the same code; only where they are shown has changed.
   */
  notices?: TalkNotices;
}

/** The reads Home's asks need, exactly as Home's own load gets them. */
export interface TalkNotices {
  arrival?: boolean;
  back?: boolean;
  leaving?: DeletionState | undefined;
  push?: boolean;
  about?: About | undefined;
  ai?: AiConsent | undefined;
}

/**
 * WHAT THE SCREEN READS. One call for the thread and the "@" list (the door's own GET), and then — only where the newest
 * answer found something — one more for its cards. The cards are read for the NEWEST answer alone and never for the
 * whole thread: an older answer's flights are an old day's prices, and forty turns would be forty calls.
 */
export async function loadTalk(ctx: BotsCtx, deps: BotsDeps): Promise<TalkData> {
  const [read, notices] = await Promise.all([
    deps.api<TalkData>("GET", `${TALK_PATH}?limit=${TALK_TURNS}`).catch(() => undefined),
    loadNotices(ctx, deps),
  ]);
  if (!read) return { down: true, notices };
  const newest = [...(read.turns ?? [])].reverse().find((t) => t.role === "bot" && t.did?.finds);
  const id = newest?.did?.finds;
  const finds = id
    ? await deps.api<{ cards: Card[] }>("GET", `/v1/everyday/finds/${encodeURIComponent(id)}`).then((r: { cards: Card[] }) => r.cards).catch(() => undefined)
    : undefined;
  return { ...read, notices, ...(finds?.length && newest ? { finds: { turn: newest.id, cards: finds } } : {}) };
}

/** Home's asks, read the way Home reads them. Every one fails soft: a read that fails means that ask is simply not shown. */
async function loadNotices(ctx: BotsCtx, deps: BotsDeps): Promise<TalkNotices> {
  const [arrival, leaving, push, about, ai] = await Promise.all([
    deps.api<{ due: boolean; kind?: "first" | "back" }>("GET", ARRIVAL_PATH).catch(() => undefined),
    deps.api<DeletionState>("GET", DELETION_PATH).catch(() => undefined),
    ctx.client === "phone" ? deps.api<{ due: boolean }>("GET", PUSH_ASK_PATH).catch(() => undefined) : Promise.resolve(undefined),
    deps.api<About>("GET", ABOUT_PATH).catch(() => undefined),
    deps.api<AiConsent>("GET", AI_CONSENT_PATH).catch(() => undefined),
  ]);
  return { arrival: arrival?.due === true, back: arrival?.kind === "back", leaving, push: push?.due === true, about, ai };
}

/**
 * The bots "/" offers, from the person's own list: Talk itself and Xode left out (talkWords.ts slashBots — Talk is where
 * you are, Xode is the other pill).
 */
function slashList(ctx: BotsCtx): Array<{ slug: string; name: string; color: string; kind: ReturnType<typeof botKind> }> {
  return slashBots(ctx.live.bots).map((b) => ({ slug: b.slug, name: b.name, color: b.color, kind: botKind(b.slug) }));
}

/** The one line under an answer that says who gave it: its bot's own head, its name, the time. */
function byLine(ctx: BotsCtx, t: ChatTurn): Node {
  const slug = t.by?.slug ?? "tailzu";
  const name = t.by?.name ?? nameOf(ctx, slug);
  return row([
    avatarOf(ctx, slug, 22),
    text(name, { size: 12, weight: 500, lineHeight: 16, color: t.by?.color ?? C.meta }),
    meta(clockOf(ctx, t.at), { size: 11 }),
  ], { gap: 7, alignItems: "center" });
}

/**
 * ONE TURN OF THE THREAD. A bot turn is drawn exactly as a bot's own chat draws one, with two differences: the line
 * above it says which bot answered (the thread holds every bot), and a drawing's taps go back through the DOOR rather
 * than to that bot's chat (`path`), so what is picked is routed on its own merits.
 */
function talkTurn(ctx: BotsCtx, t: ChatTurn, o: { live: boolean; next?: ChatTurn | undefined; budget: { left: number }; finds?: TalkData["finds"] }): Node {
  if (t.role === "me") {
    const mine = bubble(ctx, t.text, true);
    // "@Mom …": who it was for, under the person's own bubble, so the thread says it and not only the bot's answer.
    return t.forName
      ? col([mine, row([meta(`for ${t.forName}`, { size: 11 })], { justifyContent: "flex-end" })], { gap: 4 })
      : mine;
  }
  const slug = t.by?.slug ?? "tailzu";
  // The bot's own look (its icon and head), wearing the colour the turn kept — a bot the person has since recoloured
  // still reads as itself on the answer it gave.
  const look = { ...botLook(slug), ...(t.by?.color ? { color: t.by.color } : {}) };
  const fresh = o.live && ctx.live.now - t.at < FRESH_MS;
  const drawn = t.show
    ? showNodes(ctx, t.show, {
      slug, turn: t.id, live: o.live, fresh, budget: o.budget, path: TALK_PATH,
      ...(o.next?.role === "me" ? { picked: o.next.text } : {}),
    })
    : [];
  // The words, as every chat draws them; the lists left out where the drawing already shows them (docs/show.md section 4).
  const words = answerWords(t, look.color, drawn.length > 0);
  // A routine is not an answer: it is a card to save, and it IS this turn (docs/front-door.md, src/routines).
  const token = t.did?.routine ? openRoutine(t.did.routine) : "";
  const routine = isRoutineToken(token) ? routineCard(ctx, token, "") : [];
  const finds = o.finds && o.finds.turn === t.id ? findsCards(ctx, o.finds.cards) : [];
  return col([
    byLine(ctx, t),
    ...words,
    ...drawn,
    ...routine,
    ...finds,
    ...didCards(ctx, t.did, slug),
    answerShare(ctx, slug, t as Turn, t.by?.name ?? slug),
  ], { gap: 10 });
}

/** A turn's sealed routine draft, as the card reads it (the door kept it as JSON on the turn). */
function openRoutine(raw: string): string {
  try {
    const o = JSON.parse(raw) as { token?: unknown };
    return typeof o?.token === "string" ? o.token : "";
  } catch { return ""; }
}

/**
 * The answer's words, exactly as every other chat draws them (parts.ts answerBlocks): paragraphs, and a run of "- "
 * lines as a card with the bot's colour on its edge. A turn with no words (a job started, a payment filled in) draws
 * none: its card is the answer. Where the drawing already shows the answer's own lists, they are left out of the words
 * so nothing is shown twice (docs/show.md section 4) — the words are kept whole on the turn for Share and Report.
 */
function answerWords(t: ChatTurn, color: string, drawnLists: boolean): Node[] {
  if (!t.text.trim()) return [];
  return answerBlocks(t.text, color, 15, drawnLists && t.show?.lists === "drawn" ? { lists: false } : {});
}

/**
 * THE THREAD. Oldest first, newest at the bottom, and only the newest answer is live (its choices can be used, its
 * pictures spring in) — the same rule every chat here follows.
 */
function thread(ctx: BotsCtx, d: TalkData): Node[] {
  const turns = (d.turns ?? []).slice(-TALK_TURNS);
  if (!turns.length) return starters(ctx);
  // The newest answer's pictures take the screen's dot budget first, and every copy of a dot counts (parts.ts).
  const budget = { left: SCREEN_DOTS };
  const lastBot = [...turns].reverse().find((t) => t.role === "bot");
  return turns.map((t, i) => talkTurn(ctx, t, {
    live: t === lastBot, next: turns[i + 1], budget, ...(d.finds ? { finds: d.finds } : {}),
  }));
}

/**
 * AN EMPTY THREAD: what you can say, in your own words, and the two marks. Not a list of bots — a list of bots is the
 * thing this screen exists to stop being the first thing anybody sees.
 */
function starters(ctx: BotsCtx): Node[] {
  const has = (slug: string): boolean => ctx.live.bots.some((b) => b.slug === slug);
  const lines = [
    ...(has("plan") ? ["What's on tomorrow?"] : []),
    ...(has("travel") ? ["Plan three days in Goa next month"] : []),
    ...(has("code") ? ["Why is the login page slow?"] : []),
    "Sum up this week every Friday at 5",
  ];
  return [
    col([
      emptyState({ pose: "listen", title: "Say what you need", body: "Whichever bot it belongs to answers here. Nothing to pick first." }),
      row(lines.map((l) => chip(l, { onPress: sendWords(ctx, l) })), { gap: 8, flexWrap: "wrap", justifyContent: "center" }),
      col([
        row([mark("/"), meta("names a bot — /plan, /travel", { size: 12.5 })], { gap: 8, alignItems: "center" }),
        ...(hasSpaces(ctx) ? [row([mark("@"), meta("names a person — @Mom, and it is for them", { size: 12.5 })], { gap: 8, alignItems: "center" })] : []),
      ], { gap: 8, paddingTop: 6 }),
    ], { gap: 18, alignItems: "center", paddingTop: 10 }),
  ];
}

/** One of the two marks, in a small square, as a key cap. `atText`: a bare "@" is a character here, not a catalog key. */
const mark = (ch: string): Node => row([text(atText(ch), { size: 13, weight: 600, lineHeight: 17 })], {
  width: 26, height: 26, borderRadius: 8, borderWidth: 1, borderColor: C.outline, alignItems: "center", justifyContent: "center", flexShrink: 0,
});

// ===================================================================== sending

/**
 * SENDING, which is the whole screen in one action. The words go up as the person's bubble and the box clears at once
 * (askMoment.ts), the answer is written in as it comes, and when it is whole the thread is refreshed — so the answer
 * that lands is the kept turn, with whatever the bot drew under it and whatever it left to do.
 *
 * `from` is where the words are: the draft the "/" and "@" field writes, or the plain box an older build gets.
 */
function send(ctx: BotsCtx, o: { words: string; from: string; bot?: string; to?: string; attach?: boolean }): ActionRef {
  const body: Record<string, unknown> = {
    message: SENT_WORDS, device: ctx.client, mode: "text", tz: ctx.tzOffsetMinutes,
    // THE MARKS ARE READ OFF THEIR OWN PATHS, NOT OFF THE DRAFT, and that is not tidiness.
    //
    // `momentStart` empties the box before the call goes out (that is the point of it: the words go up as a bubble and
    // the field clears at once), and for the "/" and "@" field the box IS the draft — chips and all. A body that still
    // said "$state.draft.bot" would resolve it AFTER the clear, find nothing, and send "/plan …" to no bot at all,
    // silently. So the two marks are copied beside the words first, exactly as the words themselves are (`sent`).
    ...(o.bot ? { bot: `$state.${BOT}` } : {}), ...(o.to ? { to: `$state.${TO}` } : {}),
    ...(o.attach ? { attachments: `$state.${ATTACH}` } : {}),
  };
  const clear = (p: string): ActionSpec => ({ kind: "clearState", path: p });
  const call: ActionSpec = {
    // No `assignTo`: the answer that matters is the kept turn, which the refresh below brings with everything drawn
    // under it. Putting the raw reply in state as well would be a second copy of the same answer, drawn by nothing.
    kind: "callEndpoint", method: "POST", path: TALK_PATH, body,
    onSuccess: seq(
      setState("asking", false),
      ...(o.bot ? [clear(BOT)] : []), ...(o.to ? [clear(TO)] : []),
      ...(o.attach ? [clear(ATTACH), clear(SHOTS)] : []),
      refresh,
      ...momentDone(),
    ),
    // A send that failed puts the words back in the box; the marks go with them, so the chips are not lost either.
    onError: momentFailed({ busy: "asking", from: o.from, then: toast("Couldn't reach your bots. Try again.", true) }),
  };
  return seq(
    ...(o.bot ? [setState(BOT, o.bot)] : []), ...(o.to ? [setState(TO, o.to)] : []),
    ...momentStart({ message: o.words, from: o.from, busy: "asking" }),
    streamed(ctx, call),
  );
}

/** A starter chip, or anything else with fixed words: sent as if typed. */
function sendWords(ctx: BotsCtx, words: string): ActionRef {
  return seq(setState("fixed", words), send(ctx, { words: "$state.fixed", from: "fixed" }));
}

/** A build that draws the "/" and "@" field as Talk needs it: a bot picked by "/" becomes a chip (MentionCommands). */
const canMarks = (ctx: BotsCtx): boolean => ctx.can.has(MENTION_FIELD_COMPONENT) && ctx.can.has(MENTION_COMMANDS_CAPABILITY);

/**
 * THE BAR. With the marks: the field that knows "/" and "@", whose draft carries the words and the two chips. Without
 * them: the plain box every build has had, which still sends everything through the same door — the marks are a way of
 * saying something faster, never the only way to say it. Plain language is the way in on every build.
 */
function bar(ctx: BotsCtx, d: TalkData): Node[] {
  const up = canUpload(ctx);
  // A file on its way, the insert key and its card: the ask bar's own, so inserting a file is one thing in one place
  // (ask.ts insertKey / insertCard). The pasted clipboard goes into whichever box this build draws.
  const box = canMarks(ctx) ? `${DRAFT}.text` : "talk";
  const chipAbove = up ? [uploadChip(ATTACH, { wide: true })] : [];
  const key = insertKey(ctx, box);
  const moment = askMoment(ctx, {
    slug: "tailzu", color: C.ink, kind: "custom", busy: "asking", line: "Working on it…", size: 15,
  });
  const withKey = (field: Node): Node => (key.length ? row([...key, field], { gap: 10, alignItems: "flex-end" }) : field);
  if (canMarks(ctx)) {
    const field = mentionField({
      // SHORT ENOUGH FOR ONE LINE. The field is multiline, so a placeholder that does not fit wraps and the bar stands
      // two lines tall before a word is typed, with the insert key stranded beside it. "/ a bot, @ someone" did that.
      life: "talk.compose", placeholder: "Say it…  / a bot, @ someone", draftPath: DRAFT, maxLength: 2000,
      // "/" NAMES A BOT HERE, so picking one is a chip on the message and not that bot's things to share (pick: "bot").
      pick: "bot",
      bots: slashList(ctx),
      // "@" is people, and only where Spaces is on: with it off nobody is connected to anybody (docs/spaces.md).
      people: hasSpaces(ctx) ? (d.people ?? []).map((p) => ({ id: p.id, name: p.name, ...(canPersonBot(ctx) && p.bot ? { bot: p.bot as never } : {}) })) : [],
      // Nothing is shared from a bot here, so no things are ever fetched: Talk's "/" ends at the bot.
      thingsPath: "",
      commands: TALK_COMMANDS.map((c) => ({ name: c.name, line: c.line })),
      words: { people: "People", bots: "Ask a bot", empty: "Nothing here yet" },
    }, send(ctx, { words: `$state.${DRAFT}.text`, from: DRAFT, bot: `$state.${DRAFT}.bot`, to: `$state.${DRAFT}.toId`, ...(up ? { attach: true } : {}) }));
    const filled = col([field], { flexGrow: 1, flexShrink: 1, minWidth: 0 });
    return [moment, ...chipAbove, withKey(inputBox([filled], { radius: 24, pad: 4, grow: true })), ...insertCard(ctx, box)];
  }
  // An older build: the box it already draws, sending to the same door. Plain language is the whole way in there — the
  // marks are a faster way of saying something, never the only way, so nothing is out of reach without them.
  const plain = sendField("talk", "talk", "Say what you need…", send(ctx, { words: "$state.talk", from: "talk", ...(up ? { attach: true } : {}) }), { desk: ctx.client === "desktop" });
  return [moment, ...chipAbove, withKey(plain), ...insertCard(ctx, box)];
}

// ===================================================================== the head

/**
 * THE HEAD: the mark, the two pills, and the ways out. One row, and short — the thread is what the screen is for, and a
 * header that took a third of the first screen (Home's does, on purpose) would push the conversation off it.
 */
function head(ctx: BotsCtx): Node {
  const desk = ctx.client === "desktop";
  const size = desk ? 34 : 30;
  const working = ctx.live.bots.filter((b) => b.working).map((b) => b.color);
  const quiet = (glyph: "search" | "person", onPress: ActionRef, label: string) => roundButton(glyph, onPress, { size: desk ? 36 : 34, light: true, label });
  return row([
    // The mark is the way to your people and your spaces (kit appMark). The person button on the right is YOU; this
    // one is everyone else.
    appMark(ctx, size, working),
    pillSwitch([
      { label: "Talk", here: true },
      // Xode keeps its own page: a project, a branch and a job are a place, not a message (see this file's head).
      { label: "Xode", onPress: open(SCREENS.code), label2: "Xode, your code" },
    // A little clear of the mark: against it the track read as one lump with the logo.
    ], { marginLeft: 8 }),
    grow(),
    quiet("search", open(SCREENS.search), "Search everything"),
    quiet("person", open(SCREENS.you), "Profile and settings"),
  ], { gap: 10, alignItems: "center", paddingBottom: desk ? 8 : 10 });
}

// ===================================================================== the page

/** What the screen's state starts with: the box empty, nothing on its way, no drawing answered yet. */
export const TALK_STATE: Record<string, unknown> = {
  [DRAFT]: {}, [BOT]: "", [TO]: "", [ATTACH]: [] as unknown[], [SHOTS]: [] as unknown[], talk: "", fixed: "", asking: false, sent: null, reply: null, stopped: false,
  [SHOW_STATE]: {},
};

export function talkPage(ctx: BotsCtx, d: TalkData | undefined): ReturnType<typeof page> {
  const data = d ?? { down: true };
  const turns = data.turns ?? [];
  // A routine card on the newest turn needs its own state (which bot it is for), as the Ask page gives it.
  const newest = [...turns].reverse().find((t) => t.role === "bot");
  const rt = newest?.did?.routine ? openRoutine(newest.did.routine) : "";
  // HOME'S ASKS, ON THE SCREEN THE APP NOW OPENS ON: one at a time, in Home's own order, drawn by Home's own code.
  const nt = data.notices ?? {};
  const n = homeNotices(ctx, nt.arrival === true, {
    leaving: nt.leaving, push: nt.push === true, about: nt.about, ai: nt.ai, back: nt.back === true,
  });
  return page(ctx, {
    tab: "talk", title: "Talk", nav: "talk", ...(ctx.client === "desktop" ? { maxWidth: 760, fixed: true } : {}),
    state: { ...TALK_STATE, ...n.state, ...(rt ? routineCardState(ctx, rt, newest?.by?.slug ?? "") : {}) },
    // Opens at the newest turn and stays there as answers come in, as a chat should (only for a build that keeps it).
    startAtEnd: true,
    // Pull-a-bot at both ends; what is new is a turn, and new turns land at the bottom.
    pullBot: { top: true, bottom: true, newAt: "bottom", items: turns.map((t) => t.id) },
    // The topics are live/topics.ts's, where every screen's are: this thread, every bot, and Activity.
    body: [
      // The head carries the notifications check where that ask is due, as Home's does (n.head).
      n.head(head(ctx)),
      // The deletion notice comes before anything else and nothing else asks while it is up (homeNotices' own rule).
      ...n.leaving,
      // The AI permission, or the username card: whichever is due, in the one slot Home gives them.
      ...n.about,
      ...n.push,
      // The microphone and keyboard card, the first time anyone lands in the app — which is here now.
      ...(n.arrival ? arrivalCard(ctx) : []),
      ...(data.down ? [downNote()] : thread(ctx, data)),
    ],
    footer: bar(ctx, data),
    gap: 18,
  });
}

/** The thread could not be read: said plainly, with the way to try again. Never an empty chat pretending to be one. */
const downNote = (): Node => emptyState({
  pose: "think", title: "Couldn't open your thread", body: "Check your connection and try again.",
  action: { label: "Try again", onPress: refresh },
});
