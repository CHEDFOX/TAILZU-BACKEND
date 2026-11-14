/**
 * LINGO'S SCREENS (src/lingo, docs/lingo.md): the territory, a set, the picker, and leaving a language.
 *
 *   bots.lingo         THE TERRITORY. Coming back does not drop somebody into a lesson: a card per language, each with how it is
 *                      going and a Continue of its own, and Add a language beside them. Several at once, by choice. A bin on each
 *                      card opens bots.lingo.leave. With no language yet, the empty state asks which one.
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
import type { ActionRef, Node } from "../../../../../../shared/types/sdui.js";
import {
  back, botLook, box, C, call, chip, col, divider, emptyState, grow, icon, listCard, listRow, meta, meter, notice, open, page,
  primaryButton, quietButton, RADIUS, roundButton, row, SCREENS, secondaryButton, sectionLabel, seq, statusMark, text, title,
  when, type BotsCtx,
} from "../../kit.js";
import { screen, type BotsScreen } from "../../registry.js";
import { LINGO_SLUG } from "../../../../bots/builtin.js";
import type { Exercise } from "../../../../lingo/session.js";
import type { Gesture, Mastery, Performance } from "../../../../lingo/set.js";
import type { Learner } from "../../../../lingo/types.js";
import type { Progress } from "../../../../lingo/session.js";

const PATH = "/v1/lingo";

/** A course as the territory reads it: what is kept, plus the two numbers the card draws. */
export interface CourseView extends Learner {
  progress: Progress;
  mastery: Mastery;
}
export interface TerritoryData { courses: CourseView[] }
export interface LanguageRow { tag: string; name: string; en: string }
export interface PickerData { from: string | null; fromName: string | null; suggested: LanguageRow[]; languages: LanguageRow[] }
export interface SetData { exercises: Exercise[]; progress: Progress; mastery: Mastery }

const toast = (message: string, tone?: "error"): ActionRef => ({ kind: "toast", message, ...(tone ? { tone } : {}) });

/** Lingo's own colour and icon, for a card's mark. */
const look = (ctx: BotsCtx) => ctx.live.bots.find((b) => b.slug === LINGO_SLUG) ?? botLook(LINGO_SLUG);

/** A language by its own name, which is what somebody looks for. */
const nameOf = (c: CourseView, langs: readonly LanguageRow[] = []): string =>
  langs.find((l) => l.tag === c.target)?.name ?? c.target;

/** "12 due · 41 words · 3 learned", leaving out what is nothing. */
function countsLine(p: Progress): string {
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
        meta(`from ${c.from} · ${streakLine(c)}`, { size: 12 }),
      ], { gap: 2 }),
      grow(),
      roundButton("close", open(SCREENS.lingoLeave, { target: c.target, name }), { size: 28, light: true, label: `Stop learning ${name}` }),
    ], { alignItems: "flex-start", gap: 8 }),
    meter(c.mastery.held, 1, { label: `${held}% of what you've met, you'd still have now`, color: look(ctx).color, height: 6 }),
    meta(countsLine(c.progress), { size: 13 }),
    c.progress.due || c.progress.unseen
      ? primaryButton("Continue", open(SCREENS.lingoSet, { target: c.target }))
      : secondaryButton("Practise anyway", open(SCREENS.lingoSet, { target: c.target })),
  ], { gap: 10, padding: 16, borderRadius: RADIUS.card, borderWidth: 1, borderColor: C.line });
}

export function territory(ctx: BotsCtx, data: TerritoryData | undefined): Node[] {
  const courses = data?.courses ?? [];
  if (!courses.length) {
    return [
      emptyState({
        pose: "think",
        title: "Which language?",
        body: "Pick one and Lingo will talk with you in it. You can learn more than one at a time.",
        action: { label: "Add a language", onPress: open(SCREENS.lingoAdd) },
      }),
    ];
  }
  return [
    title("Your languages"),
    meta("Learning is a set at a time. Stop whenever; it picks up where you were.", { size: 13 }),
    ...courses.map((c) => courseCard(ctx, c)),
    secondaryButton("Add a language", open(SCREENS.lingoAdd), { icon: "plus" }),
  ];
}

// ===================================================================== the picker

/** One language, named in itself with the English name beside it, because somebody looks for the word they call it by. */
function languageRow(l: LanguageRow): Node {
  const start = call("PUT", `${PATH}/course`, { target: l.tag }, {
    ok: seq(toast(`Learning ${l.name}`), open(SCREENS.lingoSet, { target: l.tag })),
    fail: toast("Couldn't start that one. Try again in a moment.", "error"),
  });
  return listRow({
    label: l.name,
    ...(l.en && l.en !== l.name ? { value: l.en } : {}),
    chevron: true,
    onPress: start,
  });
}

export function picker(_ctx: BotsCtx, data: PickerData | undefined): Node[] {
  const suggested = data?.suggested ?? [];
  const all = data?.languages ?? [];
  const out: Node[] = [
    title("Add a language"),
    data?.fromName ? meta(`Taught in ${data.fromName}, which is what you already speak.`, { size: 13 }) : meta("Search in any language.", { size: 13 }),
    // The search runs on the server, so the list never ships in the app: typing reopens this screen with `q`.
    row([
      icon("search", { size: 16, color: C.meta }),
      box([text("$state.q", { size: 15, color: C.meta })], { flexGrow: 1 }),
    ], { gap: 8, padding: 12, borderRadius: RADIUS.input, borderWidth: 1, borderColor: C.line, alignItems: "center" }),
  ];
  if (suggested.length) {
    out.push(sectionLabel("Suggested"), listCard(suggested.map(languageRow)));
  }
  if (all.length) {
    out.push(sectionLabel(suggested.length ? "All languages" : "Languages"), listCard(all.map(languageRow)));
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
      box([text("$state.why", { size: 15, color: C.meta })], {
        minHeight: 84, padding: 12, borderRadius: RADIUS.card, borderWidth: 1, borderColor: C.line,
      }),
      meta("Optional. It helps us make this better, and nothing else.", { size: 12 }),
    ], { gap: 8 }),
    row([
      quietButton("Keep learning", back()),
      grow(),
      secondaryButton("Just clean up", stop("")),
      primaryButton("Stop learning", stop("$state.why")),
    ], { gap: 10, alignItems: "center" }),
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
const END: Record<Performance, { head: string; body: string }> = {
  flying: { head: "Nice set", body: "That was good. More new words next time, and more saying them." },
  solid: { head: "Good set", body: "Steady. Same again?" },
  shaky: { head: "Nearly there", body: "A few were close. Next set goes over those." },
  struggling: { head: "That was a hard one", body: "Next set is the ones you missed, and nothing new." },
};

/** One exercise, drawn by its kind. Every node here is vocabulary 1. */
function exerciseBody(ex: Exercise, target: string): Node[] {
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
      listCard(ex.options.map((o, i) => listRow({ label: o, onPress: answer({ picked: i }) }))),
    ];
  }
  if (ex.kind === "blank") {
    return [
      meta(ex.prompt, { size: 14 }),
      head(ex.sentence),
      row(ex.options.map((o, i) => chip(o, { onPress: answer({ picked: i }) })), { gap: 8, flexWrap: "wrap" }),
    ];
  }
  if (ex.kind === "chips") {
    return [
      meta(ex.prompt, { size: 14 }),
      box([text("$state.said", { size: 18, weight: 600 })], { minHeight: 44, padding: 12, borderRadius: RADIUS.card, borderWidth: 1, borderColor: C.line }),
      row(ex.chips.map((w) => chip(w, { onPress: { kind: "setState", path: "said", value: `$state.said ${w}` } })), { gap: 8, flexWrap: "wrap" }),
      primaryButton("Check", answer({ chips: "$state.said" })),
    ];
  }
  if (ex.kind === "listen") {
    return [
      head("Type what you hear"),
      secondaryButton("Play it again", { kind: "speak", text: ex.prompt, loud: true }),
      box([text("$state.said", { size: 17, color: C.meta })], { minHeight: 48, padding: 12, borderRadius: RADIUS.card, borderWidth: 1, borderColor: C.line }),
      primaryButton("Check", answer({ said: "$state.said" })),
    ];
  }
  if (ex.kind === "say" || ex.kind === "talk") {
    return [
      meta("Say it out loud", { size: 13 }),
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
    box([text("$state.said", { size: 17, color: C.meta })], { minHeight: 48, padding: 12, borderRadius: RADIUS.card, borderWidth: 1, borderColor: C.line }),
    primaryButton("Check", answer({ said: "$state.said" })),
  ];
}

/** The mark, once the server has sent one back. Three verdicts, and `close` is not a failure. */
function markRow(): Node {
  return when({ truthy: "mark" }, col([
    divider(),
    // The palette has no green and no red, and that is right: a verdict is said with the same marks the rest of the
    // app says state with. `close` gets "waiting" rather than "failed", because it is not a failure.
    when({ eq: ["$state.mark.mark.verdict", "right"] }, row([statusMark("done", { size: 10, still: true }), text("right", { size: 14, weight: 600 })], { gap: 8, alignItems: "center" })),
    when({ eq: ["$state.mark.mark.verdict", "close"] }, row([statusMark("waiting", { size: 10, still: true }), text("$state.whyWords", { size: 14, weight: 600 })], { gap: 8, alignItems: "center" })),
    when({ eq: ["$state.mark.mark.verdict", "wrong"] }, row([statusMark("needs", { size: 10, still: true }), text("$state.whyWords", { size: 14, weight: 600 })], { gap: 8, alignItems: "center" })),
    when({ truthy: "mark.learned" }, meta("Learned — you've said it right twice now.", { size: 12 })),
  ], { gap: 8 }));
}

export function setScreen(ctx: BotsCtx, target: string, data: SetData | undefined): Node[] {
  const exs = data?.exercises ?? [];
  if (!exs.length) {
    return [
      emptyState({
        pose: "done",
        title: "Nothing due",
        body: "Everything you've met is still holding. Come back later, or add some words by talking to Lingo.",
        action: { label: "Back to your languages", onPress: open(SCREENS.lingo) },
      }),
    ];
  }
  const first = exs[0]!;
  return [
    row([meta(`1 of ${exs.length}`, { size: 12 }), grow(), quietButton("Stop for now", open(SCREENS.lingo))], { alignItems: "center" }),
    meter(1, exs.length, { color: look(ctx).color, height: 4 }),
    ...exerciseBody(first, target),
    markRow(),
    // The whole set is handed over at once, so Continue is the server's word on what comes next, not the app's guess.
    when({ truthy: "mark" }, primaryButton("Next", seq({ kind: "setState", path: "mark", value: null }, { kind: "setState", path: "said", value: "" }, { kind: "refresh" }))),
  ];
}

// ===================================================================== the screens

export const LINGO_SCREENS: BotsScreen[] = [
  screen<TerritoryData>({
    id: SCREENS.lingo,
    load: (_ctx, deps) => deps.api<TerritoryData>("GET", `${PATH}/courses`),
    build: (ctx, data) => page(ctx, {
      nav: LINGO_SLUG,
      title: "Lingo",
      back: true,
      backTitle: "Lingo",
      body: territory(ctx, data),
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
    load: (ctx, deps) => deps.api<SetData>("POST", `${PATH}/session`, { target: String(ctx.params?.target ?? "") }),
    build: (ctx, data) => page(ctx, {
      nav: LINGO_SLUG,
      title: "Lingo",
      back: open(SCREENS.lingo),
      backTitle: "Languages",
      body: setScreen(ctx, String(ctx.params?.target ?? ""), data),
      state: { said: "", mark: null },
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

/** The words for a mark's reason, for a screen to show. The grader returns a code, never a sentence. */
export const whyWords = (why: string): string => WHY[why] ?? "not quite";

/** How a finished set reads. The celebration is the server's (set.ts gestureFor); these are only its words. */
export function setEnd(p: Performance, g: Gesture): { head: string; body: string; cheer: boolean; scale: number } {
  const w = END[p];
  return { head: w.head, body: w.body, cheer: g.cheer, scale: g.scale };
}
