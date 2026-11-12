/**
 * THE ORACLE'S CARDS (docs/oracle.md section 2): what the Oracle needs, asked as the microphone and keyboard card asks (firstRun/arrivalCard.ts):
 * one card over the Oracle's page (a BotCard overlay, the page blurred behind it) with the day's character on its stage, and one step after the
 * other, each kept as soon as it is answered, so leaving halfway loses nothing:
 *
 *   1. when      the date of birth, and the time if they know it: PUT /v1/oracle/sky { date, time }. "Not now" puts the card away for this
 *                visit (the Oracle answers without a chart, and the page offers the card again)
 *   2. where     the town or city, with suggestions as they type (GET /v1/oracle/places: Google's with GOOGLE_PLACES_API_KEY, else the
 *                server's own); a tap keeps one (PUT { placeId, place, session }), Keep finds what they typed (PUT { place })
 *   3. you       their name and gender, only when the app does not have them (the About you card's own read, GET /v1/bots/first-run/about,
 *                and its write, PUT /v1/profile { full_name, gender }, so every bot has them). Signed in with Apple the name is never
 *                required (App Review 4). The engine reads a woman's chart as a woman's only with it
 *   then         "Ask away", the character's happy moment, and the page again, with the sky's line
 *
 * The app shows no list from state, so the suggestions are five rows, each shown while its answer has one. Change, on the sky's line, opens
 * the cards again, filled in (bots.chat with `edit`). A build without the living card gets the same steps in a plain card at the top.
 */
import { randomUUID } from "node:crypto";
import type { ActionRef, ActionSpec, Condition, Node } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, botCard, box, C, call, canMove, col, FACE, icon, labelled, row, seq, text, when } from "../../kit.js";
import { SCREENS } from "../../ids.js";
import { genderChips } from "../firstRun/aboutCard.js";
import { type About, GENDERS, line, nameField, permitStep, setState, toast } from "../firstRun/parts.js";

const SKY = "/v1/oracle/sky";
const PLACES = "/v1/oracle/places";
/** The state the cards keep. */
export const OC = {
  date: "oc_date", time: "oc_time", when: "oc_when", q: "oc_q", found: "oc_found", place: "oc_place",
  name: "oc_name", gender: "oc_gender", you: "oc_you", closed: "oc_closed", session: "oc_s",
} as const;
const HITS = 5;
const WIDTH = { phone: 330, desktop: 360 };

/** What the cards read: the Oracle's store (GET /v1/oracle/sky) and the profile (GET /v1/bots/first-run/about). */
export interface OracleCardsData {
  sky?: { sky: unknown; when?: { date: string; time: string } | null } | undefined;
  about?: About | undefined;
}

/** Their name and gender are still owed: no gender, or no name of their own (a guess from the email is not theirs; Apple's need not be given). */
export function needsYou(about: About | undefined): boolean {
  if (!about) return false;
  const gender = GENDERS.some((g) => g.value === about.gender);
  const named = about.via === "apple" || ((about.source === "saved" || about.source === "provider") && !!about.name?.trim());
  return !gender || !named;
}

/** Whether the cards are due: the sky is not whole, the person is owed, or Change asked for them. */
export function cardsDue(ctx: BotsCtx, d: OracleCardsData): boolean {
  return ctx.params.edit === "1" || !d.sky?.sky || needsYou(d.about);
}

/** What the page starts with while the cards are due: every step already kept is passed (Change starts at the first again, filled in). */
export function cardsState(ctx: BotsCtx, d: OracleCardsData): Record<string, unknown> {
  const edit = ctx.params.edit === "1";
  const when = d.sky?.when ?? null;
  const gender = GENDERS.some((g) => g.value === d.about?.gender) ? d.about!.gender! : "";
  return {
    [OC.date]: when?.date ?? "", [OC.time]: when?.time ?? "", [OC.when]: !!when && !edit,
    [OC.q]: "", [OC.found]: { q: "", places: [] }, [OC.place]: !!d.sky?.sky && !edit,
    [OC.name]: d.about?.name ?? "", [OC.gender]: gender, [OC.you]: !needsYou(d.about),
    [OC.closed]: false, [OC.session]: randomUUID(),
  };
}

/** Back to the Oracle's page as it is now (without `edit`, so the cards do not open again). */
const again = (): ActionSpec => ({ kind: "navigate", screenId: SCREENS.chat, params: { slug: "oracle" }, replace: true });
/** Opens the cards again, filled in: the sky line's Change, and the stage's "Add your birth details". */
export const openCards = (): ActionSpec => ({ kind: "navigate", screenId: SCREENS.chat, params: { slug: "oracle", edit: "1" }, replace: true });

/** A field in the cards' look (firstRun/parts.ts nameField's), which can also search as they type. */
function cardField(path: string, placeholder: string, desk: boolean, o: { label: string; onChange?: ActionRef; onSubmit?: ActionRef; autoCapitalize?: string }): Node {
  const input: Node = {
    type: "TextField", id: path, bind: { value: path },
    props: {
      placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0,
      minHeight: 44, color: C.ink, autoCorrect: false, returnKeyType: "done", ...(o.autoCapitalize ? { autoCapitalize: o.autoCapitalize } : {}),
    },
    ...(o.onChange || o.onSubmit ? { on: { ...(o.onChange ? { onChange: o.onChange } : {}), ...(o.onSubmit ? { onSubmit: o.onSubmit } : {}) } } : {}),
    style: {
      flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.medium, fontSize: 17,
      color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
    },
  };
  return row([
    input,
    labelled(box([icon("close", { size: 18, color: C.meta })], { width: 44, height: 44, alignItems: "center", justifyContent: "center", flexShrink: 0 },
      seq(setState(path, ""), ...(o.onChange ? [o.onChange] : []))), `Clear ${o.label}`),
  ], { height: desk ? 54 : 56, borderWidth: 1.5, borderColor: C.ink, borderRadius: desk ? 14 : 16, paddingLeft: 16, paddingRight: desk ? 6 : 4 });
}

/**
 * The cards, while they are due; nothing otherwise. `look`: the character on the stage (the page's day character) and the Oracle's colour.
 */
export function oracleCards(ctx: BotsCtx, d: OracleCardsData, look: { color: string; avatar?: string; moment?: Record<string, unknown> }): Node[] {
  if (!cardsDue(ctx, d)) return [];
  const desk = ctx.client === "desktop";
  const living = canMove(ctx);
  const you = needsYou(d.about);
  const allKept: Condition = { all: [{ truthy: OC.when }, { truthy: OC.place }, { truthy: OC.you }] };
  // The living card ends with its happy moment, then the page again; the plain one goes back to the page as the last step is kept.
  const kept = (flag: string): ActionRef => seq(
    { kind: "haptic", style: "success" } as ActionSpec, setState(flag, true),
    ...(living ? [] : [{ kind: "condition", if: allKept, then: again() } as ActionSpec]),
  );

  // 1. When.
  const saveWhen: ActionSpec = {
    kind: "condition", if: { truthy: OC.date },
    then: call("PUT", SKY, { date: `$state.${OC.date}`, time: `$state.${OC.time}` }, {
      ok: kept(OC.when), fail: toast("Couldn't read that. Try a date like 13 July 1994, and a time like 9:30 am."),
    }),
    else: toast("Add the date you were born."),
  } as ActionSpec;
  const whenStep = permitStep({
    when: { falsy: OC.when },
    title: "When were you born?",
    lines: [line("The date, and the time if you know it: the time makes the reading sharper. Leave it empty if you don't.")],
    extra: [
      cardField(OC.date, "Date, like 13 July 1994", desk, { label: "the date" }),
      cardField(OC.time, "Time, like 9:30 am", desk, { label: "the time", onSubmit: saveWhen }),
    ],
    cta: { label: "Next", onPress: saveWhen },
    quiet: { label: "Not now", onPress: setState(OC.closed, true) },
  });

  // 2. Where: the search as they type, and five rows for what it found.
  const search = call("GET", `${PLACES}?q=$state.${OC.q}&s=$state.${OC.session}`, undefined, { assignTo: OC.found });
  const pick = (i: number): ActionSpec => call("PUT", SKY, {
    placeId: `$state.${OC.found}.places.${i}.id`, place: `$state.${OC.found}.places.${i}.label`, session: `$state.${OC.session}`,
  }, { ok: kept(OC.place), fail: toast("I couldn't find that place on the map. Try the nearest city.") });
  const hit = (i: number): Node => when({ truthy: `${OC.found}.places.${i}` }, labelled(row([
    icon("pin", { size: 18, color: C.meta }),
    col([
      text("", { size: 15, weight: 500, lineHeight: 20, lines: 1, bind: `${OC.found}.places.${i}.label` }),
      text("", { size: 12, color: C.meta, lineHeight: 16, lines: 1, bind: `${OC.found}.places.${i}.sub` }),
    ], { gap: 1, flexShrink: 1, minWidth: 0 }),
  ], { gap: 12, minHeight: 48, alignItems: "center", paddingHorizontal: 4 }, pick(i)), "Pick this place"));
  const keepTyped: ActionSpec = {
    kind: "condition", if: { truthy: OC.q },
    then: call("PUT", SKY, { place: `$state.${OC.q}` }, { ok: kept(OC.place), fail: toast("I couldn't find that place on the map. Try the nearest city.") }),
    else: toast("Type the town or city you were born in."),
  } as ActionSpec;
  const whereStep = permitStep({
    when: { all: [{ truthy: OC.when }, { falsy: OC.place }] },
    title: "Where were you born?",
    lines: [line("The town or city. Pick it from the list as you type.")],
    extra: [
      cardField(OC.q, "Town or city", desk, { label: "the place", onChange: search, onSubmit: keepTyped, autoCapitalize: "words" }),
      col(Array.from({ length: HITS }, (_, i) => hit(i)), { gap: 0 }),
    ],
    cta: { label: "Keep", onPress: keepTyped },
    quiet: { label: "Back", onPress: setState(OC.when, false) },
  });

  // 3. You: only when the app does not have their name and gender.
  const apple = d.about?.via === "apple";
  const nameShown = !apple || !!d.about?.name?.trim();
  const both = call("PUT", "/v1/profile", { full_name: `$state.${OC.name}`, gender: `$state.${OC.gender}` }, { ok: kept(OC.you), fail: toast("Couldn't save that. Try again.") });
  const genderOnly = call("PUT", "/v1/profile", { gender: `$state.${OC.gender}` }, { ok: kept(OC.you), fail: toast("Couldn't save that. Try again.") });
  const saveYou: ActionSpec = apple
    ? { kind: "condition", if: { truthy: OC.gender }, then: nameShown ? { kind: "condition", if: { truthy: OC.name }, then: both, else: genderOnly } as ActionSpec : genderOnly, else: toast("Pick one to save.") } as ActionSpec
    : { kind: "condition", if: { all: [{ truthy: OC.name }, { truthy: OC.gender }] }, then: both, else: toast("Add your name and pick one.") } as ActionSpec;
  const youStep = you ? [permitStep({
    when: { all: [{ truthy: OC.when }, { truthy: OC.place }, { falsy: OC.you }] },
    title: "And you?",
    lines: [line("Your name and gender. Some of the oldest ways of reading a life use your name, and some read a woman's chart differently from a man's.")],
    extra: [
      ...(nameShown ? [nameField(OC.name, "Your name", { kind: "haptic", style: "selection" } as ActionSpec, desk, { capitalize: true, label: "your name", height: 44 })] : []),
      genderChips(desk, OC.gender),
    ],
    cta: { label: "Save", onPress: saveYou },
  })] : [];

  const done = when(allKept, row([text("Ask away.", { size: 22, weight: 600, tracking: -0.3, lineHeight: 28 })], { justifyContent: "center", paddingTop: 18, paddingBottom: 26 }));
  const steps = [whenStep, whereStep, ...youStep];

  if (living) {
    return [botCard([...steps, done], {
      kind: "custom", color: look.color, stageHeight: 96, overlay: true, width: WIDTH[desk ? "desktop" : "phone"], label: "The Oracle",
      ...(look.avatar ? { avatar: look.avatar } : {}), ...(look.moment ?? {}),
      doneWhen: allKept, doneDelayMs: 1800, onComplete: seq(setState(OC.closed, true), again()), closeWhen: { truthy: OC.closed },
    })];
  }
  return [when({ all: [{ falsy: OC.closed }, { not: allKept }] }, col(steps, {
    width: WIDTH[desk ? "desktop" : "phone"], maxWidth: "100%", alignSelf: "center",
    borderRadius: 24, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, paddingTop: 6,
  }))];
}
