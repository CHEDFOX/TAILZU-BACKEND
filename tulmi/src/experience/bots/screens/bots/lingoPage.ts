/**
 * LINGO'S SCREENS (src/lingo, docs/lingo.md): the territory, a set, the picker, what the language is for, and leaving one.
 *
 *   bots.lingo         THE TERRITORY. Coming back does not drop somebody into a lesson: Babbl alive along the top, muttering
 *                      conjugations while something is due and humming once nothing is, then a card per language, each with how it
 *                      is going and a Continue of its own, and Add a language beside them. Several at once, by choice. A bin on
 *                      each card opens bots.lingo.leave. With no language yet, the empty state asks which one.
 *   bots.lingo.set     A SET. One exercise at a time, the bot above it, and what the bot makes of the set at the end — the
 *                      celebration SCALED to how it went, and Continue. The app never decides any of that: the exercises, the
 *                      marking, the gesture and the shape of the next set all come from the server (POST /v1/lingo/session,
 *                      /answer, /set).
 *   bots.lingo.add     THE PICKER: a search box at the top, the suggested few, then every language, each named in itself and in
 *                      English. The list and the search are the server's (GET /v1/lingo/languages), so a language is a deploy.
 *   bots.lingo.leave   STOP LEARNING ONE: a box for why, and "Just clean up" beside it. A reason is optional and an empty one is
 *                      a complete answer; somebody who does not want to explain themselves is not made to.
 *
 * VOCABULARY 1, on purpose (docs/renderer.md): every node here is one every installed build already draws, so none of this needs
 * a release — and a lesson must never be the screen that answers "Open X0 again", which is what a client missing a block is sent.
 *
 * The phone and the window alike; `page()` picks the frame.
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import {
  back, botBuddy, botKind, botLook, botMoment, C, call, canBuddy, chip, chips, col, divider, emptyState, grow, icon, listCard,
  listRow, meta, meter, notice, open, page, primaryButton, quietButton, RADIUS, roundButton, row, SCREENS, secondaryButton,
  sectionLabel, seq, statusMark, text, title, when, type BotsCtx,
  up,
} from "../../kit.js";
import { screen, type BotsScreen } from "../../registry.js";
import { field, inputBox, isDesk, sendField } from "./parts.js";
import { searchField, searchLine } from "../keybotParts.js";
import { LINGO_SLUG } from "../../../../bots/builtin.js";
import { lingoTopic } from "../../../../live/topics.js";
import type { Exercise } from "../../../../lingo/session.js";
import type { Gesture, Mastery, Performance } from "../../../../lingo/set.js";
import type { Learner } from "../../../../lingo/types.js";
import type { Progress } from "../../../../lingo/session.js";

const PATH = "/v1/lingo";

/** A course as the territory reads it: what is kept, the two numbers the card draws, and what to call it. */
export interface CourseView extends Learner {
  /** The language's own name ("Español"), from the server. Falls back to the tag only if it has none. */
  name?: string;
  /** The language it is taught in, by its own name ("English"). */
  fromName?: string;
  progress: Progress;
  mastery: Mastery;
}
export interface TerritoryData { courses: CourseView[] }
export interface LanguageRow { tag: string; name: string; en: string }
export interface PickerData { from: string | null; fromName: string | null; suggested: LanguageRow[]; languages: LanguageRow[] }
/** A set, and what the language is called so a prompt can name it. */
export interface SetData {
  exercises: Exercise[]; progress: Progress; mastery: Mastery; name?: string;
  /** Their first unit is being written right now (POST /v1/lingo/session). Only ever sent with no exercises. */
  building?: boolean;
}

const toast = (message: string, tone?: "error"): ActionRef => ({ kind: "toast", message, ...(tone ? { tone } : {}) });

/** Babbl's own colour and icon, for a card's mark. */
const look = (ctx: BotsCtx) => ctx.live.bots.find((b) => b.slug === LINGO_SLUG) ?? botLook(LINGO_SLUG);

/** A language by its own name. The server sends it; the tag is only ever a last resort. */
const nameOf = (c: CourseView): string => c.name?.trim() || c.target;
const fromOf = (c: CourseView): string => c.fromName?.trim() || c.from;

/** "12 due · 41 words · 3 learned", leaving out what is nothing. */
function countsLine(p: Progress): string {
  if (!p.items) return "no words yet";
  const bits = [p.due ? `${p.due} due` : "nothing due", `${p.items} word${p.items === 1 ? "" : "s"}`];
  if (p.learned) bits.push(`${p.learned} learned`);
  return bits.join(" · ");
}

const streakLine = (c: CourseView): string => (c.streakDays ? `${c.streakDays} day${c.streakDays === 1 ? "" : "s"}` : "new");

// ===================================================================== the territory

/**
 * One language's card. The meter is what they would still have RIGHT NOW, from the scheduler's own estimate — not a percentage of
 * a course, because there is no course to be a percentage of. The bin is small and quiet on purpose: it is not a thing to press by
 * accident, and it is not a thing to hide either.
 */
function courseCard(ctx: BotsCtx, c: CourseView): Node {
  const held = Math.round(c.mastery.held * 100);
  const name = nameOf(c);
  return col([
    row([
      col([
        text(name, { size: 17, weight: 700, tracking: -0.2 }),
        meta(`from ${fromOf(c)} · ${streakLine(c)}`, { size: 12 }),
      ], { gap: 2 }),
      grow(),
      roundButton("close", open(SCREENS.lingoLeave, { target: c.target, name }), { size: 28, light: true, label: `Stop learning ${name}` }),
    ], { alignItems: "flex-start", gap: 8 }),
    // No meter on a course with nothing in it: "0% of what you've met" is a measurement of nothing, drawn as a fact.
    ...(c.progress.items ? [meter(c.mastery.held, 1, { label: `${held}% of what you've met, you'd still have now`, color: look(ctx).color, height: 6 })] : []),
    meta(countsLine(c.progress), { size: 13 }),
    // A COURSE WITH NOTHING IN IT STILL GOES TO THE LESSON, because opening one is what makes the first unit for
    // this pair (POST /v1/lingo/session walks the path). This used to offer the chat instead, from before the path
    // existed, when an empty course really did have nothing to ask — and that was the whole reason a new language
    // never got any lessons: the one screen that builds the first unit was the one screen the card never opened.
    c.progress.items === 0
      ? primaryButton("Start learning", open(SCREENS.lingoSet, { target: c.target }))
      : c.progress.due || c.progress.unseen
        ? primaryButton("Continue", open(SCREENS.lingoSet, { target: c.target }))
        : secondaryButton("Practise anyway", open(SCREENS.lingoSet, { target: c.target })),
  ], { gap: 10, padding: 16, borderRadius: RADIUS.card, borderWidth: 1, borderColor: C.line });
}

/**
 * THE TOP OF THE TERRITORY, where a heading would be: Babbl itself, alive, across the width of the page. It greets
 * somebody coming back with what the territory holds: it mutters conjugations under its breath, letter tiles drifting
 * up, while a word is due anywhere (l.mutter), and hums to itself when nothing is (l.hum). Both are idlings of its own
 * on a loop, and no other bot is given them (shared/bots/looks.json). Its kind is the plain custom tile, so the shared
 * engine is untouched and only the colour and the moment are Babbl's.
 *
 * A build that cannot draw him is given the words instead, so the page is never headless.
 */
function territoryHead(ctx: BotsCtx, courses: CourseView[]): Node[] {
  if (!canBuddy(ctx)) {
    return [title("Your languages"), meta("Learning is a set at a time. Stop whenever; it picks up where you were.", { size: 13 })];
  }
  const desk = isDesk(ctx);
  const live = ctx.live.bots.find((b) => b.slug === LINGO_SLUG);
  const due = courses.some((c) => c.progress.due > 0);
  return [botBuddy({
    kind: botKind(LINGO_SLUG), color: look(ctx).color, life: `page.${LINGO_SLUG}`, height: desk ? 120 : 108, size: desk ? 70 : 64,
    state: live?.working ? "working" : live?.needs ? "needs" : "idle", lookTo: "down", label: "Babbl",
    ...botMoment(ctx, due ? "l.mutter" : "l.hum", "loop"),
  })];
}

export function territory(ctx: BotsCtx, data: TerritoryData | undefined): Node[] {
  const courses = data?.courses ?? [];
  if (!courses.length) {
    return [
      emptyState({
        pose: "think",
        title: "Which language?",
        body: "Pick one and Babbl will talk with you in it. You can learn more than one at a time.",
        action: { label: "Add a language", onPress: open(SCREENS.lingoAdd) },
      }),
    ];
  }
  return [
    ...territoryHead(ctx, courses),
    ...courses.map((c) => courseCard(ctx, c)),
    secondaryButton("Add a language", open(SCREENS.lingoAdd), { icon: "plus" }),
  ];
}

// ===================================================================== the picker

/** One language, named in itself with the English name beside it, because somebody looks for the word they call it by. */
/**
 * One language on the picker. It does double duty, because the list and the search behind it are the same either way:
 * normally it is the language to LEARN and picking it goes on to ask what the language is for; with `pick=from` it is
 * the language they already SPEAK, and picking it goes back to that question carrying the answer.
 */
function languageRow(l: LanguageRow, forFrom?: { target: string; name: string }): Node {
  // Picking one does not start the course: it asks what the language is FOR first, and that answer starts it. Going
  // straight in used to land on "Nothing due", because a course nobody has said anything to has no words in it yet.
  return listRow({
    label: l.name,
    ...(l.en && l.en !== l.name ? { value: l.en } : {}),
    chevron: true,
    onPress: forFrom
      ? open(SCREENS.lingoWhy, { target: forFrom.target, name: forFrom.name, from: l.tag, fromName: l.name })
      : open(SCREENS.lingoWhy, { target: l.tag, name: l.name }),
  });
}

// ===================================================================== a unit finished

/** Whether the unit after this one can be asked for yet (GET /v1/lingo/next). */
export interface NextUp { ready: boolean; unit?: string; goal?: string; at?: number; of?: number }

export interface DoneData {
  unit: string;
  goal: string;
  /** The moment the bot plays for THIS unit (course.ts Unit.mark). */
  mark: string;
  at: number;
  of: number;
  /** Every goal they have reached, in order. */
  canDo: string[];
}

/**
 * A UNIT FINISHED, which until now passed in silence: the path moved them on and nobody ever said they had done
 * the last one.
 *
 * What it shows is not a score. It is the thing they can now DO, and under it every other thing they can do —
 * because that list is the only honest answer to "how far have I got", and watching it get longer is the reason
 * finishing a unit is worth anything.
 *
 * The bot's gesture is THIS unit's own, so the first and the fourteenth do not feel identical, and the four units
 * that end a level get the big one.
 */
export function doneScreen(ctx: BotsCtx, d: DoneData, target: string, next?: NextUp): Node[] {
  const live = ctx.live.bots.find((b) => b.slug === LINGO_SLUG);
  // THE NEXT UNIT IS BEING WRITTEN WHILE THIS IS ON SCREEN (routes/bots/lingo.ts, the set's end). So the moment
  // runs on a LOOP rather than once, and Continue is not drawn yet: the few seconds a model takes are spent being
  // congratulated instead of staring at a screen with nothing on it, which is where they used to be spent — at
  // the start of the next session, with the unit made only once they had asked for it.
  const waiting = !!next && !next.ready;
  const bot = canBuddy(ctx) ? [botBuddy({
    kind: botKind(LINGO_SLUG), color: look(ctx).color, life: `page.${LINGO_SLUG}`,
    height: isDesk(ctx) ? 150 : 132, size: isDesk(ctx) ? 86 : 76,
    state: live?.working ? "working" : "idle", label: "Babbl",
    ...botMoment(ctx, d.mark, waiting ? "loop" : "once"),
  })] : [];
  const earlier = d.canDo.slice(0, -1);
  return [
    ...bot,
    meta(`Unit ${d.at} of ${d.of}`, { size: 13 }),
    text(d.goal, { size: 26, weight: 700, lineHeight: 32, tracking: -0.4 }),
    ...(earlier.length
      ? [col([
          sectionLabel("And already"),
          ...earlier.slice(-6).reverse().map((g) => row([icon("check", { size: 14, color: C.meta }), text(g, { size: 14, color: C.grey70, lineHeight: 19, style: { flexShrink: 1 } })], { gap: 8, alignItems: "flex-start" })),
        ], { gap: 8 })]
      : []),
    // Stop for now is always there — waiting for the next unit must never be a room with no door — but Keep going
    // arrives with the unit, so it never opens a set that has nothing to ask.
    ...(waiting
      ? [meta(`Lining up ${next?.goal ? "what's next" : "the next one"}…`, { size: 13 })]
      : [primaryButton("Keep going", open(SCREENS.lingoSet, { target }))]),
    quietButton("Stop for now", up(open(SCREENS.lingo))),
  ];
}

// ===================================================================== asking, from anywhere

/**
 * THE ASK BOX, at the foot of every Babbl screen including the middle of a set.
 *
 * The moment somebody wants a word is the moment they are using the language, and sending them off to have a
 * conversation about it loses both the word and their place in the lesson. So this is one question and one card,
 * and `back` is where Continue puts them — exactly where they were.
 */
function askBar(ctx: BotsCtx, target: string, back: string): Node {
  const ask = call("POST", `${PATH}/ask`, { target, q: "$state.say" }, {
    assignTo: "said",
    ok: seq(
      { kind: "setState", path: "say", value: "" },
      open(SCREENS.lingoSaid, {
        target, back,
        say: "$state.said.say", means: "$state.said.means", note: "$state.said.note",
      }),
    ),
    fail: toast("Couldn't answer that just now. Still here when you're back.", "error"),
  });
  return sendField("say", "say", "How do you say…?", ask, { desk: isDesk(ctx) });
}

/**
 * THE ANSWER, ON A CARD. The thing to say is the biggest thing on it and nothing competes with it; what it means
 * is underneath; the note is about USING it and is often not there at all.
 *
 * Continue is the whole point of the screen: it goes back to the screen they asked from, so a word looked up in
 * the middle of a set costs them nothing. And it is already in their course, which the screen says plainly rather
 * than leaving them to wonder whether to write it down.
 */
export function saidScreen(_ctx: BotsCtx, p: { say: string; means: string; note: string; target: string; back: string }): Node[] {
  const go = p.back === SCREENS.lingoSet
    ? open(SCREENS.lingoSet, { target: p.target })
    : open(p.back || SCREENS.lingo);
  return [
    meta("You say", { size: 13 }),
    text(p.say, { size: 30, weight: 700, lineHeight: 38, tracking: -0.5 }),
    text(p.means, { size: 16, color: C.grey70, lineHeight: 22 }),
    ...(p.note ? [notice(p.note)] : []),
    // A check, not the kit's "done" mark: that one is an outlined circle, and at this size beside a line of text it
    // reads as a radio button nobody has ticked — the opposite of what this line says.
    row([icon("check", { size: 14, color: C.meta }), meta("Added to your words — it'll come back in your practice.", { size: 12, style: { flexShrink: 1 } })], { gap: 6, alignItems: "center" }),
    primaryButton("Continue", go),
  ];
}

// ===================================================================== what the language is for

/**
 * Seven answers that between them hold most of the reasons anybody learns a language, and not one of them is a country,
 * a region or a kind of person: the same seven, in the same order, whichever language was picked. "My family speaks it"
 * is there because people learning the language of their own grandparents are a huge share of learners and almost every
 * app writes them out.
 */
const WHY_REASONS: Array<{ label: string; value: string }> = [
  { label: "Someone I love", value: "someone" },
  { label: "A trip", value: "trip" },
  { label: "Living there", value: "living" },
  { label: "Work", value: "work" },
  { label: "My family speaks it", value: "family" },
  { label: "Studying it", value: "study" },
  { label: "Just because", value: "curious" },
];

/**
 * WHAT THE LANGUAGE IS FOR, asked once, as it is added — the only question Babbl ever asks before teaching anything.
 *
 * The box underneath is worth more than the chips and is the reason the chips are not the whole screen: "my partner's
 * mother is in Seville and I meet her in March" tells Babbl what a hundred taps could not. Both are optional, Skip is
 * one tap, and backing out adds no language at all.
 */
export function whyScreen(ctx: BotsCtx, target: string, name: string): Node[] {
  // WHICH LANGUAGE IT IS TAUGHT IN. The server knows it only once they have a course, so on the first language
  // nobody knows it and it falls back to English — which is the one place this must not quietly decide for them.
  // Every meaning in every exercise is written in this language; being handed English because nobody asked is
  // exactly the assumption this app does not make.
  const from = String(ctx.params?.from ?? "");
  const fromName = String(ctx.params?.fromName ?? "");
  // STRAIGHT INTO THE FIRST EXERCISE. Landing on the territory meant a card to read and another button to find
  // before anything was learned; the answer to "what's it for?" is the last thing anybody wants to answer twice.
  // `replace` so Back from the set goes to their languages and not round the picker again.
  const begin = (why: unknown, whyNote: unknown): ActionRef => call("PUT", `${PATH}/course`, { target, why, whyNote, ...(from ? { from } : {}) }, {
    ok: seq(toast(`Learning ${name}`), { kind: "navigate", screenId: SCREENS.lingoSet, params: { target }, replace: true }),
    fail: toast("Couldn't start that one. Try again in a moment.", "error"),
  });
  return [
    title(`What's ${name} for?`),
    meta("It decides what Babbl teaches you first and what it talks to you about. Nothing here is a test, and you can tell it more any time.", { size: 13 }),
    chips(WHY_REASONS, "why"),
    col([
      sectionLabel("Taught in"),
      listCard([listRow({
        label: fromName || "The language you speak",
        value: "Change",
        chevron: true,
        onPress: open(SCREENS.lingoAdd, { pick: "from", target, name }),
      })]),
      ...(fromName ? [] : [meta("Every meaning is written in this. Pick yours if it is not English.", { size: 12 })]),
    ], { gap: 8 }),
    col([
      sectionLabel("In your own words"),
      inputBox([field("lingo-for", "note", "Who you'll speak it with, and when. A line is plenty.", { multiline: true })], { radius: RADIUS.card }),
    ], { gap: 8 }),
    col([
      primaryButton("Start learning", begin("$state.why", "$state.note")),
      quietButton("Skip", begin("", "")),
    ], { gap: 8 }),
  ];
}

export function picker(ctx: BotsCtx, data: PickerData | undefined): Node[] {
  const suggested = data?.suggested ?? [];
  const all = data?.languages ?? [];
  const q = String(ctx.params?.q ?? "").trim();
  // The same screen, asked the other way round: which language do they already speak. Everything below is the same,
  // because a person looks for their own language exactly as they look for the one they want.
  const target = String(ctx.params?.target ?? "");
  const forFrom = String(ctx.params?.pick ?? "") === "from" && target
    ? { target, name: String(ctx.params?.name ?? target) }
    : undefined;
  const row = (l: LanguageRow) => languageRow(l, forFrom);
  const out: Node[] = [
    title(forFrom ? "Which language do you speak?" : "Add a language"),
    forFrom
      ? meta(`${forFrom.name} will be taught in whichever you pick, and it is what every meaning is written in.`, { size: 13 })
      : data?.fromName ? meta(`Taught in ${data.fromName}, which is what you already speak.`, { size: 13 }) : meta("Search in any language.", { size: 13 }),
    // The search runs on the server (the list of languages never ships in the app), so Enter opens this screen again
    // with `q` and the server answers with what matches. The same field every other search in the app uses.
    searchField(SCREENS.lingoAdd, "Search in any language, or in English"),
    ...(q ? [searchLine(SCREENS.lingoAdd, q)] : []),
  ];
  if (suggested.length) {
    out.push(sectionLabel("Suggested"), listCard(suggested.map(row)));
  }
  if (all.length) {
    out.push(sectionLabel(suggested.length ? "All languages" : "Languages"), listCard(all.map(row)));
  } else {
    out.push(notice("Nothing by that name. Try the language's own name, or the English one."));
  }
  return out;
}

// ===================================================================== leaving one

/**
 * STOP LEARNING A LANGUAGE. Two buttons, and the difference between them is the whole point: one sends what they wrote, the other
 * sends nothing and still does the job. Nobody is held at a text box to get out of something.
 */
export function leaving(_ctx: BotsCtx, target: string, name: string): Node[] {
  const gone = seq(toast(`${name} removed`), { kind: "navigate", screenId: SCREENS.lingo, replace: true });
  const stop = (reason: unknown): ActionRef => call("DELETE", `${PATH}/course/${encodeURIComponent(target)}`, { reason }, {
    ok: gone,
    fail: toast("Couldn't remove it. Try again in a moment.", "error"),
  });
  return [
    title(`Stop learning ${name}?`),
    meta("Its words and its streak go with it. Nothing else of yours is touched.", { size: 13 }),
    col([
      sectionLabel("Why are you stopping?"),
      inputBox([field("lingo-why", "why", "A line is plenty. Or none.", { multiline: true })], { radius: RADIUS.card }),
      meta("Optional. It helps us make this better, and nothing else.", { size: 12 }),
    ], { gap: 8 }),
    // Stacked, not a row: three buttons do not fit across a phone, and the render check caught the third running
    // off the edge. Stopping is the thing they came for, so it leads; the way out without a reason sits under it.
    col([
      primaryButton("Stop learning", stop("$state.why")),
      secondaryButton("Just clean up", stop("")),
      quietButton("Keep learning", back()),
    ], { gap: 8 }),
  ];
}

// ===================================================================== a set

/** The words for a verdict, by the reason the grader gave. No English is in the grader: it is all here. */
const WHY: Record<string, string> = {
  accent: "almost — watch the accent",
  spelling: "almost — one letter out",
  order: "almost — right words, wrong order",
  word: "not quite",
  silence: "I didn't catch that",
};

/** How a set's end reads, by how it went. Nothing is celebrated that was not good: see set.ts gestureFor. */
export const END: Record<Performance, { head: string; body: string }> = {
  flying: { head: "Nice set", body: "That was good. More new words next time, and more saying them." },
  solid: { head: "Good set", body: "Steady. Same again?" },
  shaky: { head: "Nearly there", body: "A few were close. Next set goes over those." },
  struggling: { head: "That was a hard one", body: "Next set is the ones you missed, and nothing new." },
};

/**
 * THE OPTIONS OF A PICK-ONE QUESTION, and what they become once it is marked.
 *
 * Until the mark comes back each option is a row to tap. Once it is back (`mark.correct`, the server's: the app never
 * held the answer) the taps are gone and the list says what was right: that option drawn strong with a tick, the
 * others gone grey, and the one they picked, when it was not the right one, says so. Only then does Next appear
 * (setScreen step), so a wrong pick is always shown its answer before the set moves on.
 */
function choices(options: readonly string[], answer: (body: Record<string, unknown>) => ActionRef): Node[] {
  const pick = (i: number): ActionRef => seq({ kind: "setState", path: "picked", value: i }, answer({ picked: i }));
  const shown = (o: string, i: number): Node[] => [
    when({ eq: ["mark.correct", i] }, row([
      text(o, { size: 15, weight: 600, lineHeight: 20, style: { flexGrow: 1, flexShrink: 1 } }),
      icon("check", { size: 16, weight: 2.2 }),
    ], { gap: 12, paddingVertical: 14, paddingHorizontal: 16, minHeight: 48, backgroundColor: C.surface })),
    when({ neq: ["mark.correct", i] }, row([
      text(o, { size: 15, lineHeight: 20, color: C.idle, style: { flexGrow: 1, flexShrink: 1 } }),
      when({ eq: ["picked", i] }, text("your pick", { size: 12, color: C.idle })),
    ], { gap: 12, paddingVertical: 14, paddingHorizontal: 16, minHeight: 48 })),
  ];
  return [
    when({ falsy: "mark" }, listCard(options.map((o, i) => listRow({ label: o, onPress: pick(i) })))),
    when({ truthy: "mark" }, listCard(options.map((o, i) => col(shown(o, i))))),
  ];
}

/** The same for a gap in a sentence, whose options are word chips: the right word filled in, the others grey. */
function wordChoices(options: readonly string[], answer: (body: Record<string, unknown>) => ActionRef): Node[] {
  const pick = (i: number): ActionRef => seq({ kind: "setState", path: "picked", value: i }, answer({ picked: i }));
  const faded = (o: string): Node => row([text(o, { size: 13, color: C.idle, lineHeight: 17 })], {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, alignSelf: "flex-start",
  });
  return [
    when({ falsy: "mark" }, row(options.map((o, i) => chip(o, { onPress: pick(i) })), { gap: 8, flexWrap: "wrap" })),
    when({ truthy: "mark" }, row(options.map((o, i) => col([
      when({ eq: ["mark.correct", i] }, chip(o, { selected: true })),
      when({ neq: ["mark.correct", i] }, faded(o)),
    ])), { gap: 8, flexWrap: "wrap" })),
  ];
}

/** One exercise, drawn by its kind. Every node here is vocabulary 1. */
function exerciseBody(ex: Exercise, target: string, lang: string): Node[] {
  // `ref` and never the word: a typed or spoken exercise must not carry its own answer to the client.
  const answer = (body: Record<string, unknown>): ActionRef => call("POST", `${PATH}/answer`, { target, ref: ex.ref, kind: ex.kind, ...body }, {
    assignTo: "mark",
    fail: toast("Couldn't send that. Still here when you're back.", "error"),
  });
  const head = (s: string): Node => text(s, { size: 20, weight: 700, lineHeight: 26, tracking: -0.3 });

  if (ex.kind === "choose") {
    return [
      head(ex.prompt),
      meta("What does it mean?", { size: 13 }),
      ...choices(ex.options, answer),
    ];
  }
  if (ex.kind === "reply") {
    // The same shape as choose, the other way round: the meaning is the question and the answers are things you
    // could really say. Picking what you would say is how somebody reaches conversation before they can speak it.
    return [
      meta("What would you say?", { size: 13 }),
      head(ex.prompt),
      ...choices(ex.options, answer),
    ];
  }
  if (ex.kind === "blank") {
    return [
      meta(ex.prompt, { size: 14 }),
      head(ex.sentence),
      ...wordChoices(ex.options, answer),
    ];
  }
  if (ex.kind === "chips") {
    return [
      meta(ex.prompt, { size: 14 }),
      inputBox([field("lingo-chips", "said", "tap the words")], { radius: RADIUS.card }),
      row(ex.chips.map((w) => chip(w, { onPress: { kind: "setState", path: "said", value: `$state.said ${w}` } })), { gap: 8, flexWrap: "wrap" }),
      primaryButton("Check", answer({ chips: "$state.said" })),
    ];
  }
  if (ex.kind === "listen") {
    return [
      head("Type what you hear"),
      secondaryButton("Play it again", { kind: "speak", text: ex.prompt, loud: true }),
      inputBox([field("lingo-heard", "said", "what you heard")], { radius: RADIUS.card }),
      primaryButton("Check", answer({ said: "$state.said" })),
    ];
  }
  if (ex.kind === "say" || ex.kind === "speak" || ex.kind === "talk") {
    return [
      // `talk` is the only rung that is the real thing: nothing is read back, and what is marked is whether the word
      // came out inside something of their own.
      meta(ex.kind === "talk" ? "Say something that uses it" : ex.kind === "speak" ? "Say the whole thing out loud" : "Say it out loud", { size: 13 }),
      head(ex.prompt),
      // voiceLive writes what was heard into state; the server marks it, never the app.
      // The whole turn's words go into state; the SERVER marks them. `onHeard` only stops the session.
      primaryButton("Hold to speak", {
        kind: "voiceLive", mode: ex.kind === "talk" ? "chat" : "once", statePath: "heard", into: "said",
        onHeard: { kind: "voiceStop" }, ...(ex.kind === "talk" ? { duplex: true } : {}),
      }),
      when({ truthy: "said" }, col([
        meta("I heard", { size: 12 }),
        text("$state.said", { size: 16 }),
        primaryButton("That's it", answer({ said: "$state.said" })),
      ], { gap: 6 })),
    ];
  }
  // write
  return [
    meta(ex.prompt, { size: 14 }),
    head("Write it"),
    inputBox([field("lingo-write", "said", lang ? `in ${lang}` : "your answer")], { radius: RADIUS.card }),
    primaryButton("Check", answer({ said: "$state.said" })),
  ];
}

/** The mark, once the server has sent one back. Three verdicts, and `close` is not a failure. */
function markRow(): Node {
  return when({ truthy: "mark" }, col([
    divider(),
    // The palette has no green and no red, and that is right: a verdict is said with the same marks the rest of the
    // app says state with. `close` gets "waiting" rather than "failed", because it is not a failure.
    when({ eq: ["mark.mark.verdict", "right"] }, row([statusMark("done", { size: 10, still: true }), text("right", { size: 14, weight: 600 })], { gap: 8, alignItems: "center" })),
    when({ eq: ["mark.mark.verdict", "close"] }, row([statusMark("waiting", { size: 10, still: true }), ...whyLine()], { gap: 8, alignItems: "center" })),
    when({ eq: ["mark.mark.verdict", "wrong"] }, row([statusMark("needs", { size: 10, still: true }), ...whyLine()], { gap: 8, alignItems: "center" })),
    when({ truthy: "mark.learned" }, meta("Learned — you've said it right twice now.", { size: 12 })),
  ], { gap: 8 }));
}

/**
 * STILL BEING WRITTEN. A third empty, and the only one that ENDS BY ITSELF: they started the course a moment ago and
 * the unit for their pair is being made (a model call, once per pair, ever).
 *
 * So it has no button and nothing to read. There is nothing for them to decide, and a button that only means "ask
 * again" is the app putting its own not-knowing in front of the person — it makes somebody who is already waiting do
 * the waiting's work. An explanation of our model call is ours to carry too, not theirs to read.
 *
 * What there is instead is Babbl, muttering over it: `l.mutter` is its own idling, conjugations under its breath
 * with letter tiles drifting up, and it is exactly what is happening. The screen listens on the course's topic
 * (src/live/topics.ts) and the server says when the unit has settled, so this swaps itself for the first exercise
 * where it stands — the reload is quiet, and the exercise simply appears under him.
 *
 * A build that cannot draw him still says what is happening rather than nothing.
 */
function building(ctx: BotsCtx): Node[] {
  if (!canBuddy(ctx)) return [emptyState({ pose: "think", title: "Getting your first lesson ready" })];
  return [
    col([
      botBuddy({
        kind: botKind(LINGO_SLUG), color: look(ctx).color, life: `page.${LINGO_SLUG}`,
        height: isDesk(ctx) ? 150 : 132, size: isDesk(ctx) ? 86 : 76,
        state: "working", lookTo: "down", label: "Babbl",
        ...botMoment(ctx, "l.mutter", "loop"),
      }),
      text("Getting your first lesson ready", { size: 16, weight: 600, align: "center" }),
    ], { gap: 12, padding: 24, style: { alignItems: "center" } }),
  ];
}

export function setScreen(ctx: BotsCtx, target: string, data: SetData | undefined): Node[] {
  const exs = data?.exercises ?? [];
  if (!exs.length) {
    if (data?.building) return building(ctx);
    // THREE DIFFERENT EMPTIES, and telling somebody the wrong one is how this screen read as broken. "Nothing due"
    // means they have met things and are holding them. A course with NOTHING IN IT has not earned that sentence:
    // they picked a language a minute ago and are being told they are up to date on a language they cannot speak.
    // It happens whenever the shared bank has no sentences for the pair yet, which is every pair nobody has poured
    // a corpus into — so the way out is the one thing that always works, which is saying something to Babbl.
    const nothingYet = (data?.progress?.items ?? 0) === 0;
    if (nothingYet) {
      return [
        emptyState({
          pose: "listen",
          title: "Nothing to learn yet",
          body: "Babbl hasn't got any words for you in this one. Tell it something you want to say, or ask how to say a word, and it will start from there.",
          action: { label: "Talk to Babbl", onPress: open(SCREENS.chat, { slug: LINGO_SLUG }) },
        }),
      ];
    }
    return [
      emptyState({
        pose: "done",
        title: "Nothing due",
        body: "Everything you've met is still holding. Come back later, or add some words by talking to Babbl.",
        action: { label: "Back to your languages", onPress: open(SCREENS.lingo) },
      }),
    ];
  }
  const lang = data?.name?.trim() ?? "";
  const last = exs.length - 1;

  /**
   * THE END OF A SET, which is the last thing they see and therefore most of what they remember it by (order.ts
   * keeps the peak-end rule for the exercises; this is the end itself). It used to roll straight into the next
   * set, so a sitting had no end at all — and `setEnd`, written for this moment, had never had a caller.
   */
  const ended = when({ truthy: "done" }, col([
    ...endWords(),
    primaryButton("Keep going", { kind: "navigate", screenId: SCREENS.lingoSet, replace: true, params: { target, shape: "$state.done.next" } }),
    quietButton("Stop for now", up(open(SCREENS.lingo))),
  ], { gap: 14, paddingTop: 8 }));

  // THE APP REPORTS NOTHING. Every answer was marked and written into the set by the server as it was given
  // (/v1/lingo/answer, migration 0109), so closing a set off sends which course and nothing else. An app that
  // handed its own list back would be the one message in Babbl that could say "I was right".
  const clear: ActionSpec[] = [{ kind: "setState", path: "mark", value: null }, { kind: "setState", path: "said", value: "" }, { kind: "setState", path: "picked", value: null }];

  /**
   * THE END OF THE SET, and the only time the server is asked anything between the first exercise and the last.
   * What comes back decides all three of: whether the bot celebrates (and it does NOT for a set that went badly —
   * set.ts gestureFor), whether a unit was finished, and the shape of the next set, which the next session is
   * asked for by name so the difficulty follows the person instead of starting fresh every time.
   */
  const finish = (): ActionRef => seq(
    ...clear,
    call("POST", `${PATH}/set`, { target }, {
      assignTo: "done",
      ok: seq(
        { kind: "condition", if: { truthy: "done.gesture.cheer" }, then: { kind: "confetti" } },
        {
          // A finished UNIT goes to its own celebration. A finished SET stays here and is said something about:
          // `done` is in state now, so the screen draws the end instead of the exercises (endWords).
          kind: "condition", if: { truthy: "done.finished" },
          then: { kind: "navigate", screenId: SCREENS.lingoDone, replace: true, params: { target, done: "$state.done.finished" } },
        },
      ),
      // Nothing is lost that mattered: each answer was marked and scheduled the moment it was given.
      fail: toast("Couldn't close off that set. Every answer in it already counted.", "error"),
    }),
  );

  /**
   * THE WHOLE SET IS IN THE TREE and the one they are on is the one drawn. A set is a dozen exercises handed over
   * at once (session.ts), so moving to the next is not a trip to the server — it used to refetch the session and
   * draw ITS first exercise, which is why the counter read "1 of 12" for ever and no set ever ended.
   */
  const step = (ex: Exercise, i: number): Node => when({ all: [{ eq: ["i", i] }, { falsy: "done" }] }, col([
    row([meta(`${i + 1} of ${exs.length}`, { size: 12 }), grow(), meta("Stop for now", { size: 12 })], { alignItems: "center" }, up(open(SCREENS.lingo))),
    meter(i + 1, exs.length, { color: look(ctx).color, height: 4 }),
    ...exerciseBody(ex, target, lang),
    markRow(),
    when({ truthy: "mark" }, primaryButton(i === last ? "Finish" : "Next",
      i === last ? finish() : seq(...clear, { kind: "incrementState", path: "i", by: 1 }))),
  ], { gap: 14 }));

  return [...exs.map(step), ended];
}

// ===================================================================== the screens

export const LINGO_SCREENS: BotsScreen[] = [
  screen<TerritoryData>({
    id: SCREENS.lingo,
    load: (_ctx, deps) => deps.api<TerritoryData>("GET", `${PATH}/courses`),
    build: (ctx, data) => page(ctx, {
      nav: LINGO_SLUG,
      title: "Babbl",
      back: true,
      backTitle: "Babbl",
      body: territory(ctx, data),
      // TALKING TO IT. Every other bot with a page of its own has this in its footer, and Babbl — the one bot whose
      // whole point is conversation — had no way to be spoken to at all: its tile opens the territory rather than
      // the shared bot page, and nothing on any of its four screens asked for a word. It is not on a lesson, only
      // here: the middle of a set is not the moment to be offered a chat.
      // The ask box, here and on every other Babbl screen. On the territory there is no one course to ask about,
      // so it asks about the one they opened last, which is the one the cards are showing.
      footer: [askBar(ctx, String(data?.courses?.[0]?.target ?? ""), SCREENS.lingo)],
    }),
  }),
  screen<PickerData>({
    id: SCREENS.lingoAdd,
    load: (ctx, deps) => deps.api<PickerData>("GET", `${PATH}/languages?q=${encodeURIComponent(String(ctx.params?.q ?? ""))}`),
    build: (ctx, data) => page(ctx, {
      nav: LINGO_SLUG,
      title: "Add a language",
      back: true,
      backTitle: "Languages",
      body: picker(ctx, data),
      state: { q: String(ctx.params?.q ?? "") },
    }),
  }),
  screen<SetData>({
    id: SCREENS.lingoSet,
    // `shape` is what the LAST set earned (set.ts shapeNext), handed back by name so the difficulty follows the
    // person. Without it every set is the first of a sitting and a struggling day is asked as much as a flying one.
    load: (ctx, deps) => deps.api<SetData>("POST", `${PATH}/session`, {
      target: String(ctx.params?.target ?? ""),
      ...(ctx.params?.shape ? { shape: ctx.params.shape } : {}),
    }),
    build: (ctx, data) => page(ctx, {
      nav: LINGO_SLUG,
      title: "Babbl",
      back: open(SCREENS.lingo),
      backTitle: "Languages",
      body: setScreen(ctx, String(ctx.params?.target ?? ""), data),
      // Mid-lesson is exactly when somebody wants a word, and Continue puts them back on this set.
      footer: [askBar(ctx, String(ctx.params?.target ?? ""), SCREENS.lingoSet)],
      // ONLY WHILE IT IS WAITING. The screen hears that the unit has settled and reloads into the first exercise,
      // which is what lets the waiting screen have no button on it. Listening at any other time would mean a set
      // could be pulled out from under somebody mid-exercise, so the topic is named on no other screen and at no
      // other moment.
      ...(data?.building ? { live: [lingoTopic(String(ctx.params?.target ?? ""))] } : {}),
      // `i` is how far through the set they are. That is all the app keeps of a set: the answers themselves are
      // the server's, written as they were marked.
      // `done` is what the finished set came back as: while it is null the exercises are drawn, and once it is
      // there the set's end is (setScreen `ended`).
      state: { i: 0, said: "", mark: null, say: "", done: null, picked: null },
    }),
  }),
  screen({
    id: SCREENS.lingoWhy,
    build: (ctx) => page(ctx, {
      nav: LINGO_SLUG,
      title: "Getting started",
      back: true,
      backTitle: "Languages",
      body: whyScreen(ctx, String(ctx.params?.target ?? ""), String(ctx.params?.name ?? "it")),
      state: { why: "", note: "" },
    }),
  }),
  screen<NextUp>({
    id: SCREENS.lingoDone,
    // The one thing on this screen that changes: whether the unit being written under the celebration is done.
    load: (ctx, deps) => deps.api<NextUp>("GET", `${PATH}/next?target=${encodeURIComponent(String(ctx.params?.target ?? ""))}`),
    build: (ctx, data) => {
      // The set's end hands the whole `finished` object over; the older shape, one param each, still reads.
      const f = (ctx.params?.done ?? null) as Record<string, unknown> | null;
      const at = f ?? (ctx.params ?? {});
      const list = at["canDo"];
      const target = String(ctx.params?.target ?? "");
      return page(ctx, {
        nav: LINGO_SLUG,
        title: "Done",
        back: open(SCREENS.lingo),
        backTitle: "Languages",
        body: doneScreen(ctx, {
          unit: String(at["unit"] ?? ""),
          goal: String(at["goal"] ?? ""),
          mark: String(at["mark"] ?? "celebrate"),
          at: Number(at["at"] ?? 1),
          of: Number(at["of"] ?? 24),
          canDo: Array.isArray(list) ? list.map(String) : String(list ?? "").split("\u0000").filter(Boolean),
        }, target, data),
        footer: [askBar(ctx, target, SCREENS.lingo)],
        // Listening only while the next unit is being written, as on the set screen: this is what brings Continue.
        ...(data && !data.ready ? { live: [lingoTopic(target)] } : {}),
        state: { say: "" },
      });
    },
  }),
  screen({
    id: SCREENS.lingoSaid,
    build: (ctx) => page(ctx, {
      nav: LINGO_SLUG,
      title: "How to say it",
      back: true,
      backTitle: "Babbl",
      body: saidScreen(ctx, {
        say: String(ctx.params?.say ?? ""),
        means: String(ctx.params?.means ?? ""),
        note: String(ctx.params?.note ?? ""),
        target: String(ctx.params?.target ?? ""),
        back: String(ctx.params?.back ?? SCREENS.lingo),
      }),
      footer: [askBar(ctx, String(ctx.params?.target ?? ""), String(ctx.params?.back ?? SCREENS.lingo))],
      state: { say: "" },
    }),
  }),
  screen({
    id: SCREENS.lingoLeave,
    build: (ctx) => page(ctx, {
      nav: LINGO_SLUG,
      title: "Stop learning",
      back: true,
      backTitle: "Languages",
      body: leaving(ctx, String(ctx.params?.target ?? ""), String(ctx.params?.name ?? "this language")),
      state: { why: "" },
    }),
  }),
];

/**
 * A mark's reason in words, on the screen: one line per reason the grader can give, shown when it is the one (the
 * reply carries the code, `mark.mark.why`, never a sentence), and "not quite" when it gives none.
 */
function whyLine(): Node[] {
  const words = (w: string): Node => text(w, { size: 14, weight: 600 });
  return [...Object.entries(WHY).map(([why, w]) => when({ eq: ["mark.mark.why", why] }, words(w))), when({ falsy: "mark.mark.why" }, words(whyWords("")))];
}

/** The words for a mark's reason, for a screen to show. The grader returns a code, never a sentence. */
export const whyWords = (why: string): string => WHY[why] ?? "not quite";

/** How a finished set reads. The celebration is the server's (set.ts gestureFor); these are only its words. */
export function setEnd(p: Performance, g: Gesture): { head: string; body: string; cheer: boolean; scale: number } {
  const w = END[p];
  return { head: w.head, body: w.body, cheer: g.cheer, scale: g.scale };
}

/**
 * WHAT IS SAID AT THE END OF A SET, and it is the only reward in here — there are no points, no gems and no score,
 * on purpose: a reward made contingent on doing the thing reliably weakens the wanting to do it, and somebody
 * chasing a number is not chasing the language.
 *
 * So the words have to be worth something, and what makes them worth something is that they NAME WHAT HAPPENED.
 * "Nice set" is worth nothing: it would have been said whatever they did. "gracias is yours now" is worth
 * something, because it is true, it is theirs, and it is new.
 *
 * NEVER ABOUT THE PERSON. Not "you're a natural", not "you're good at this". Person praise is the one kind the
 * evidence is clear about — it is what leaves somebody helpless at the first failure, worse than saying nothing —
 * and it is a promise the next bad set breaks. The set, the word and the work are what get praised here.
 *
 * In order of what is worth saying: a word that crossed into LEARNED (said out loud and held — the biggest thing
 * that can happen in a sitting), then words said out loud at all, then the band's own line.
 */
function endWords(): Node[] {
  const line = (t: string) => text(t, { size: 14, color: C.grey70, lineHeight: 19 });
  const bound = (before: string, path: string, after: string) => row([
    ...(before ? [line(before)] : []),
    text("", { size: 14, weight: 600, lineHeight: 19, bind: path }),
    ...(after ? [line(after)] : []),
  ], { gap: 5, alignItems: "baseline", flexWrap: "wrap" });
  return [
    // The band's own head: the only part that is fixed, and none of it is about them.
    ...(["flying", "solid", "shaky", "struggling"] as Performance[]).map((p) =>
      when({ eq: ["done.performance", p] }, text(END[p].head, { size: 26, weight: 700, tracking: -0.5, lineHeight: 32 }))),
    // A word that became theirs this set. The one thing worth interrupting anybody for.
    when({ truthy: "done.result.learned.0" }, col([
      bound("", "done.result.learned.0", "is yours now — said out loud, and held."),
      when({ truthy: "done.result.learned.1" }, bound("And", "done.result.learned.1", "too.")),
    ], { gap: 4 })),
    // Else what they said out loud, which is the thing that makes a word stick.
    when({ all: [{ falsy: "done.result.learned.0" }, { gte: ["done.result.spoken", 2] }] },
      bound("", "done.result.spoken", "of them said out loud. That is the part that stays.")),
    // Else the band's line, which says what the next set does rather than how they did.
    ...(["flying", "solid", "shaky", "struggling"] as Performance[]).map((p) =>
      when({ all: [{ eq: ["done.performance", p] }, { falsy: "done.result.learned.0" }, { lt: ["done.result.spoken", 2] }] }, line(END[p].body))),
  ];
}
