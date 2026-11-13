/**
 * "PLAN SOMETHING" (PLAN_V2_MAKE; docs/plan-ease.md §10): the Plan home's + and its top area open it.
 *
 *   bots.plan.make { from?, day?, kind?, focus? }   a card to fill by hand (what, when, for who, must not miss; repeat and place when
 *                                                    wanted), Check (rules, free), Change, Done; and a box at the bottom: tell X0, and
 *                                                    it fills the card and shows it checked. `from: "plan"`: Done lands on the home on
 *                                                    the new item's day; else Done goes back with a toast. `focus: "box"`: the box is
 *                                                    ready to type in (KitExtras).
 *
 * Every draft lives in this screen's state (MAKE_STATE): the server keeps none. The rules and the AI's read answer drafts
 * (POST .../plan/make/draft), Check answers findings (POST .../plan/make/check), and Done checks everything again on the server, then
 * creates through the calendar and follow-through's own setItem (POST .../plan/make; botsBots/planMakeService.ts). Nothing goes on the
 * Plan and nobody is told until Done. Done's key comes from the server in every draft and check answer, never from this build: a retry
 * after a lost answer sends the same key, and a changed list goes through Check again and gets a new one.
 *
 * Every action is wrapped in the busy guard (IDLE): it sets `busy` before its call and clears it when the answer comes, so a second tap
 * never races the first. The screen is never kept (kit.ts NEVER_KEPT): a kept copy drawn first, then the fresh one swapped in, would
 * wipe what was typed.
 *
 * Only for a build whose state survives an answer (makeFor: PersonBot, and a window with KitExtras or a phone with ActionParams), with
 * PLAN_V2_MAKE and PLAN_V2_PAGE on. Any other build, or the switches off: the old add form (planItem.ts planAddForm), with `day` and
 * `kind` as they were.
 */
import { KIT_EXTRAS_CAPABILITY, type ActionRef, type ActionSpec, type Condition, type Node } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, SCREENS, back, box, C, call, canPersonBot, chips, col, divider, grow, headerBuddy, icon, labelled, listRow, messageText,
  meta, open, page, personBot, primaryButton, row, secondaryButton, sectionLabel, seq, statusMark, switchMark, text, when, whenEq,
} from "../../kit.js";
import { screen, type BotsScreen } from "../../registry.js";
import { said } from "../../said.js";
import { dayOptions, planAddForm } from "../planItem.js";
import { afterBox, boxPicks, boxPlus, boxReply } from "./planPage.js";
import { A, DAY, clearState, dayKeyOf, field, inputBox, isDesk, lookOf, setState, toast } from "./parts.js";
import { makeOn } from "../../../../botsBots/planSwitch.js";
import { CHIP_DAYS, CHIP_TIMES, DRAFTS_MAX, MAKE, NOTES_MAX, PICK_MAX, WORDS_MAX, emptyCard, type CardDraft, type MakeSetup } from "../../../../botsBots/planMake.js";

const OCHRE = lookOf("plan").color;

/**
 * The builds that get the card: PersonBot (the people), and where an answer written into state survives the call: the window with
 * KitExtras (`stay`), the phone with ActionParams (its "$state" navigate params; it never fetches the screen again after a write).
 */
export const makeFor = (ctx: BotsCtx): boolean =>
  makeOn() && canPersonBot(ctx) && (ctx.client === "desktop" ? ctx.can.has(KIT_EXTRAS_CAPABILITY) : ctx.can.has("ActionParams"));

const isKey = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
/**
 * The day the card opens on: `day` (today or later: a past day the home's strip was on opens on today, so a plain Check is never a
 * "That time has passed"), else today, else no day for "Add a to-do".
 */
export const openDay = (ctx: BotsCtx, today: string): string =>
  (isKey(ctx.params.day) && ctx.params.day >= today ? ctx.params.day : ctx.params.kind === "task" && !isKey(ctx.params.day) ? "" : today);
/** The words-with-no-day day the box sends: the day the person was looking at (the server takes it only when it is after today). */
const shownDay = (ctx: BotsCtx): string => (isKey(ctx.params.day) ? ctx.params.day : "");

/** GET .../plan/make never fails the screen: without it, no people, no AI, nobody to invite. */
export function setupFallback(ctx: BotsCtx): MakeSetup {
  return { today: dayKeyOf(ctx, ctx.live.now), tomorrow: dayKeyOf(ctx, ctx.live.now + DAY), people: [], follow: false, ai: "off", invite: null };
}

/** The screen's state (1.2.1). Strings and booleans only: the phone compares strictly, the window compares String() values. */
export function makeState(ctx: BotsCtx, setup: MakeSetup): Record<string, unknown> {
  return {
    step: "edit", d: emptyCard(openDay(ctx, setup.today)), at: "0", list: [], chk: {},
    say: "", busy: "", pre: {}, boxed: {}, askQ: "", askBusy: false, boxPick: false,
    showPlace: false, showRepeat: false,
    // Done's key: written from an answer's res.key (ON_FILL, ON_CHECK), never made here.
    key: "",
  };
}

// ------------------------------------------------------------------ the actions (1.2.2)

const MK = MAKE;
const cond = (c: Condition, then: ActionRef, otherwise: ActionRef): ActionSpec => ({ kind: "condition", if: c, then, else: otherwise } as ActionSpec);
/** The busy guard: nothing while anything is on its way. Each action sets `busy` before its call (before the first await). */
export const IDLE = (x: ActionRef): ActionSpec => cond({ neq: ["busy", ""] }, seq(), x);
const idle = (): ActionSpec => setState("busy", "");

/** A draft or check answer at `res`: the drafts, the card, which one it is, the check view, Done's key; the check face. */
const ON_FILL_DRAFT: ActionRef = seq(
  setState("list", "$state.res.drafts"), setState("d", "$state.res.d"), setState("at", "$state.res.at"), setState("chk", "$state.res.view"),
  setState("key", "$state.res.key"), setState("step", "check"), clearState("say"), clearState("boxed"), clearState("pre"),
);
/** The box's answer: drafts (the check face), a bill's or a wait's preview, or the box's own answer (planPage.ts afterBox). */
const onFill = (ctx: BotsCtx): ActionRef => cond({ eq: ["res.kind", "draft"] }, ON_FILL_DRAFT,
  // A preview takes the words out of the box (they are in the preview); its Change puts them back.
  cond({ eq: ["res.kind", "preview"] }, seq(setState("pre", "$state.res.preview"), clearState("boxed"), clearState("say")),
    seq(setState("boxed", "$state.res.box"), clearState("pre"), afterBox(ctx))));
/** A check's answer: no drafts left (Take out) is the empty card again; else the check face. */
const ON_CHECK: ActionRef = cond({ truthy: "res.view.empty" },
  seq(setState("d", "$state.res.d"), setState("at", "0"), setState("list", "$state.res.drafts"), clearState("chk"), setState("step", "edit")),
  seq(setState("list", "$state.res.drafts"), setState("d", "$state.res.d"), setState("at", "$state.res.at"), setState("chk", "$state.res.view"),
    setState("key", "$state.res.key"), setState("step", "check")));

/** POST .../make/draft: the box's words (or the card's What, `keep`), the card and the drafts on screen, the day looked at. */
function draftCall(ctx: BotsCtx, words: string, o: { keep?: boolean } = {}): ActionSpec {
  return call("POST", `${MK}/draft`, {
    words, ...(o.keep ? { keep: "1" } : {}), tz: ctx.tzOffsetMinutes, d: "$state.d", list: "$state.list", at: "$state.at", day: shownDay(ctx),
  }, {
    assignTo: "res", stay: true, ok: seq(idle(), onFill(ctx)),
    fail: seq(idle(), said("Couldn't read that. Check your connection and try again.")),
  });
}

/** The box's Send. */
export const sendAction = (ctx: BotsCtx): ActionSpec => IDLE(cond({ falsy: "say" }, toast("Type something first"),
  seq(setState("busy", "fill"), draftCall(ctx, "$state.say"))));
/**
 * "Read it with AI": the card's own What words through the box's one AI path; the read fills only what the card left empty. Only for
 * someone who said yes to AI after onboarding (setup.ai "on"): this screen never asks for AI itself.
 */
const readAiAction = (ctx: BotsCtx): ActionSpec => IDLE(seq(setState("busy", "fill"), draftCall(ctx, "$state.d.title", { keep: true })));

/** POST .../make/check with `body`, the check face from its answer. */
function checkCall(ctx: BotsCtx, body: Record<string, unknown>, fail = "Couldn't check that. Try again."): ActionSpec {
  return call("POST", `${MK}/check`, { list: "$state.list", tz: ctx.tzOffsetMinutes, ...body }, {
    assignTo: "res", stay: true, ok: seq(idle(), ON_CHECK), fail: seq(idle(), said(fail)),
  });
}

/** Check: the card (merged into the drafts at `at`), with the day it opened on (the What words fill only what is still as it was). */
const checkAction = (ctx: BotsCtx, day0: string): ActionSpec => IDLE(cond({ falsy: "d.title" }, toast("Say what it is first"),
  seq(setState("busy", "check"), checkCall(ctx, { d: "$state.d", at: "$state.at", day0 }))));
/** A note's fix on draft `n` ("past:tomorrow", "time:18:00", "who:<id>", …). */
const fixAction = (ctx: BotsCtx, n: number, id: string): ActionSpec =>
  IDLE(seq(setState("busy", "check"), checkCall(ctx, { fix: { item: String(n), id } }, "Couldn't change that. Try again.")));
/** Take out draft `n`. */
const dropAction = (ctx: BotsCtx, n: number): ActionSpec =>
  IDLE(seq(setState("busy", "check"), checkCall(ctx, { drop: String(n) }, "Couldn't take it out. Try again.")));
/** Change draft `n`: the card again, filled with it. */
const changeAction = (n: number): ActionSpec => IDLE(seq(setState("d", `$state.list.${n}`), setState("at", String(n)), setState("step", "edit")));

/**
 * Done: refused with the stop's words while there is one; else POST .../make with the key the last answer gave. From the home it lands
 * on the home on the new item's day ("Added: …" and Undo there); from anywhere else it goes back with the toast. A 400 fix_first (the
 * day moved on since Check) draws the check face again with the stop and its fixes.
 */
export function doneAction(ctx: BotsCtx): ActionSpec {
  const fromPlan = ctx.params.from === "plan";
  const again = seq(setState("busy", "check"), call("POST", `${MK}/check`, { list: "$state.list", tz: ctx.tzOffsetMinutes }, {
    assignTo: "res", stay: true, ok: seq(idle(), ON_CHECK), fail: idle(),
  }));
  const ok = fromPlan
    ? seq(back(), { kind: "navigate", screenId: SCREENS.plan, replace: true, params: { day: "$state.made.day", made: "$state.made.key", n: "$state.made.n" } } as ActionSpec)
    : seq(back(), toast("$state.made.line"));
  return IDLE(cond({ truthy: "chk.stop" }, toast("$state.chk.stopLine"), seq(setState("busy", "done"), call("POST", MK, { key: "$state.key", list: "$state.list", tz: ctx.tzOffsetMinutes }, {
    assignTo: "made", stay: true, ok,
    fail: seq(idle(), said("Couldn't add it. Try again."), cond({ eq: ["lastError.code", "fix_first"] }, again, seq())),
  }))));
}

/** A bill's or a wait's preview, Done: the box's own path (with its own Undo). The box has no key, so never twice. */
const previewDone = (ctx: BotsCtx): ActionSpec => IDLE(seq(setState("busy", "box"), call("POST", `${A}/plan/box`, { words: "$state.pre.words", tz: ctx.tzOffsetMinutes }, {
  assignTo: "boxed", stay: true, ok: seq(idle(), clearState("pre"), afterBox(ctx)), fail: seq(idle(), said("Couldn't add that. Try again.")),
})));

// ------------------------------------------------------------------ small parts

/** A field of the card, with its cap where the build keeps one (KitExtras maxLength). */
function cardField(ctx: BotsCtx, id: string, path: string, placeholder: string, max: number): Node {
  const f = field(id, path, placeholder);
  return ctx.can.has(KIT_EXTRAS_CAPABILITY) ? { ...f, props: { ...(f.props ?? {}), maxLength: max } } : f;
}
const pill = (label: Node, onPress: ActionRef): Node => row([label], {
  minHeight: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: C.outline, alignItems: "center", justifyContent: "center",
}, onPress);
const pillText = (content: string, bind?: string): Node => text(content, { size: 13, weight: 500, lineHeight: 18, ...(bind ? { bind } : {}) });
/** A word that does something: "+ Repeat", "Change", "Take out", "Read it with AI". */
const wordButton = (content: string, onPress: ActionRef, o: { grey?: boolean; size?: number } = {}): Node =>
  row([text(content, { size: o.size ?? 14, weight: o.grey ? 400 : 500, lineHeight: (o.size ?? 14) + 5, color: o.grey ? C.meta : C.ink })], { minHeight: o.size && o.size < 14 ? 32 : 36, alignItems: "center" }, onPress);
/** `n` also held by an existing visibleIf: both must hold. */

const TIME_LABEL: Record<string, string> = { "09:00": "9 am", "12:00": "12 pm", "16:00": "4 pm", "18:00": "6 pm", "20:00": "8 pm" };
const REPEATS = [{ label: "Once", value: "" }, { label: "Every day", value: "daily" }, { label: "Every week", value: "weekly" }, { label: "Every month", value: "monthly" }];
const WEEK = [["Mon", "1"], ["Tue", "2"], ["Wed", "3"], ["Thu", "4"], ["Fri", "5"], ["Sat", "6"], ["Sun", "0"]] as const;

// ------------------------------------------------------------------ the card: the edit face

function editFace(ctx: BotsCtx, setup: MakeSetup, day0: string): Node {
  // Today and the next 4 days (CHIP_DAYS), then No day and Other day: few enough that What, When, For who and Check fit one phone screen.
  const days = [...dayOptions(ctx, isKey(day0) ? day0 : null, CHIP_DAYS), { label: "No day", value: "" }, { label: "Other day", value: "other" }];
  const times = [{ label: "Any time", value: "" }, ...CHIP_TIMES.map((t) => ({ label: TIME_LABEL[t] ?? t, value: t })), { label: "Other time", value: "other" }];
  const people = setup.people.slice(0, PICK_MAX);
  const forWho = setup.follow && people.some((p) => !p.me) ? [col([
    sectionLabel("For who"),
    row(people.map((p) => {
      const v = p.me ? "" : p.id;
      const name = p.me ? "You" : p.name;
      // The tiny bot on a small white ground, so it shows on the picked (ink) chip too.
      return row([
        box([personBot(ctx, p.look, { size: 22, label: name })], { width: 26, height: 26, borderRadius: 13, backgroundColor: C.paper, alignItems: "center", justifyContent: "center", flexShrink: 0 }),
        text(name, { size: 13, lineHeight: 17, style: { color: whenEq("d.who", v, C.paper, C.ink) } }),
      ], {
        gap: 6, alignItems: "center", paddingVertical: 4, paddingLeft: 4, paddingRight: 14, borderRadius: 18, borderWidth: 1,
        borderColor: whenEq("d.who", v, C.ink, C.outline), backgroundColor: whenEq("d.who", v, C.ink, C.paper),
      }, setState("d.who", v));
    }), { gap: 8, flexWrap: "wrap" }),
    when({ neq: ["d.who", ""] }, meta("They get the reminder on their phone.", { size: 12 })),
  ], { gap: 8 })] : [];
  // One switch row, as the item page's: off is "" (X0 decides); "normal" comes only from the check face's Keep normal, and shows off.
  const mustOn: Condition = { eq: ["d.imp", "must"] };
  const mustRow = listRow({
    label: "Must not miss", sub: "X0 keeps reminding until it's done.", chevron: false, right: switchMark("d.imp", mustOn),
    onPress: cond(mustOn, setState("d.imp", ""), setState("d.imp", "must")),
  });
  const must = setup.follow ? [{ ...mustRow, style: { ...(mustRow.style ?? {}), paddingHorizontal: 0, paddingVertical: 0 } }] : [];
  const repeatOpen: Condition = { any: [{ truthy: "showRepeat" }, { truthy: "d.repeat" }] };
  const placeOpen: Condition = { any: [{ truthy: "showPlace" }, { truthy: "d.place" }] };
  const weekday = ([label, v]: readonly [string, string]): Node => {
    const on: Condition = { contains: ["d.days", v] };
    return row([text(label, { size: 13, lineHeight: 17, style: { color: { ...on, then: C.paper, else: C.ink } } })], {
      paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1,
      borderColor: { ...on, then: C.ink, else: C.outline }, backgroundColor: { ...on, then: C.ink, else: C.paper },
    }, { kind: "toggleInArray", path: "d.days", value: v } as ActionSpec);
  };
  return when({ eq: ["step", "edit"] }, col([
    col([sectionLabel("What"), inputBox([cardField(ctx, "mk-title", "d.title", "Dentist, Dad's medicine, school fees…", 120)])], { gap: 8 }),
    col([
      sectionLabel("When"),
      chips(days, "d.day"),
      when({ eq: ["d.day", "other"] }, inputBox([cardField(ctx, "mk-day", "d.dayWords", "Type a day, like 20 Nov", 40)])),
    ], { gap: 8 }),
    // The times are their own group under their own label: read as more days, "Any time" after "Other day" was lost.
    col([
      sectionLabel("Time"),
      chips(times, "d.time"),
      when({ eq: ["d.time", "other"] }, inputBox([cardField(ctx, "mk-time", "d.timeWords", "Type a time, like 5:30 pm", 20)])),
    ], { gap: 8 }),
    ...forWho,
    ...must,
    // Repeat and Place stay closed until wanted (or filled by the box).
    row([
      when({ all: [{ falsy: "showRepeat" }, { falsy: "d.repeat" }] }, wordButton("+ Repeat", setState("showRepeat", true))),
      when({ all: [{ falsy: "showPlace" }, { falsy: "d.place" }] }, wordButton("+ Place", setState("showPlace", true))),
    ], { gap: 20, flexWrap: "wrap" }),
    when(repeatOpen, col([
      sectionLabel("Repeat"),
      chips(REPEATS, "d.repeat"),
      when({ eq: ["d.repeat", "weekly"] }, col([row(WEEK.map(weekday), { gap: 6, flexWrap: "wrap" }), meta("Pick the days.", { size: 12 })], { gap: 6 })),
    ], { gap: 8 })),
    when(placeOpen, col([sectionLabel("Where"), inputBox([cardField(ctx, "mk-place", "d.place", "Where, like Indiranagar", 160)])], { gap: 8 })),
    when({ eq: ["busy", "check"] }, row([statusMark("working", { color: OCHRE, size: 8 }), meta("Checking…", { size: 13 })], { gap: 8, alignItems: "center", minHeight: 54 })),
    // Hidden while anything is on its way: a second tap would race the first answer.
    when({ eq: ["busy", ""] }, primaryButton("Check", checkAction(ctx, day0), { wide: true })),
    // 14 between the parts (not 18): with For who open, What, When, Time, For who and Check fit a 390 x 844 phone over the box.
  ], { gap: 14 }));
}

// ------------------------------------------------------------------ the card: the check face

/** One note of draft `n`: a dot (filled for a stop), its words, and its fixes (at most 2), Invite and Pick. */
function noteNode(ctx: BotsCtx, setup: MakeSetup, n: number, k: number): Node {
  const q = `chk.items.${n}.notes.${k}`;
  const stop: Condition = { truthy: `${q}.stop` };
  const fix = (i: number): Node => when({ truthy: `${q}.fixes.${i}.label` }, pill(pillText("", `${q}.fixes.${i}.label`), fixAction(ctx, n, `$state.${q}.fixes.${i}.id`)));
  return when({ truthy: `${q}.text` }, col([
    row([
      box([], { width: 7, height: 7, borderRadius: 4, marginTop: 7, flexShrink: 0, borderWidth: 1.5, borderColor: { ...stop, then: C.ink, else: C.outline }, backgroundColor: { ...stop, then: C.ink, else: C.paper } }),
      text("", { size: 14, lineHeight: 20, bind: `${q}.text`, style: { flexShrink: 1 } }),
    ], { gap: 8, alignItems: "flex-start" }),
    row([
      fix(0), fix(1),
      ...(setup.invite ? [when({ truthy: `${q}.invite` }, pill(pillText("Invite"), open(setup.invite.screen, setup.invite.params)))] : []),
      // "Say what it is." opens the card to fill it in; every other note's Pick opens it to pick.
      when({ all: [{ truthy: `${q}.change` }, { neq: [`${q}.id`, "no_title"] }] }, pill(pillText("Pick"), changeAction(n))),
      when({ all: [{ truthy: `${q}.change` }, { eq: [`${q}.id`, "no_title"] }] }, pill(pillText("Fill it in"), changeAction(n))),
    ], { gap: 8, flexWrap: "wrap", paddingLeft: 15 }),
  ], { gap: 6 }));
}

/** Draft `n` as checked: its head, when, for who (their tiny bot), must not miss, where, its notes, "Looks good"; Change and Take out. */
function slotNode(ctx: BotsCtx, setup: MakeSetup, n: number): Node {
  const p = `chk.items.${n}`;
  const bots = setup.people.slice(0, PICK_MAX).map((x) => when({ eq: [`${p}.who`, x.me ? "me" : x.id] }, personBot(ctx, x.look, { size: 22, label: x.me ? "You" : x.name })));
  const inner = col([
    text("", { size: 17, weight: 600, lineHeight: 23, bind: `${p}.head` }),
    text("", { size: 15, lineHeight: 21, bind: `${p}.when` }),
    when({ truthy: `${p}.whoLine` }, row([...bots, text("", { size: 15, lineHeight: 21, color: C.meta, bind: `${p}.whoLine`, style: { flexShrink: 1 } })], { gap: 8, alignItems: "center" })),
    when({ truthy: `${p}.mustLine` }, text("", { size: 14, weight: 600, lineHeight: 19, bind: `${p}.mustLine` })),
    when({ truthy: `${p}.place` }, text("", { size: 14, lineHeight: 19, color: C.meta, bind: `${p}.place` })),
    ...Array.from({ length: NOTES_MAX }, (_, k) => noteNode(ctx, setup, n, k)),
    when({ truthy: `${p}.good` }, row([icon("check", { size: 14 }), text("Looks good", { size: 14, lineHeight: 19 })], { gap: 6, alignItems: "center" })),
    when({ truthy: "chk.multi" }, row([wordButton("Change", changeAction(n)), wordButton("Take out", dropAction(ctx, n), { grey: true })], { gap: 16 })),
  ], { gap: 6 });
  // Shown with a head or a note: a draft with no name still says "Say what it is." (and its when), never an empty "X0 checked".
  return when({ any: [{ truthy: `${p}.head` }, { truthy: `${p}.notes.0.text` }] }, n ? col([divider(), inner], { gap: 16 }) : inner);
}

function checkFace(ctx: BotsCtx, setup: MakeSetup): Node {
  return when({ eq: ["step", "check"] }, col([
    // The tick only when nothing stops Done: with a stop the fixes are the next step, not a "checked, fine".
    row([when({ falsy: "chk.stop" }, icon("check", { size: 14 })), sectionLabel("X0 checked")], { gap: 8, alignItems: "center" }),
    ...Array.from({ length: DRAFTS_MAX }, (_, n) => slotNode(ctx, setup, n)),
    when({ truthy: "chk.count" }, meta("", { size: 14, lineHeight: 19, bind: "chk.count" })),
    when({ truthy: "chk.extra" }, meta("", { size: 13, lineHeight: 18, bind: "chk.extra" })),
    when({ truthy: "chk.unsure" }, meta("", { size: 13, lineHeight: 18, bind: "chk.unsure" })),
    // The owner's "ai checks", on the card: Check (rules) says the What words still look messy; the read happens only on a tap.
    ...(setup.ai === "on" ? [when({ all: [{ truthy: "chk.messy" }, { eq: ["busy", ""] }] }, row([
      meta("Some words were hard to read.", { size: 13, lineHeight: 18 }), wordButton("Read it with AI", readAiAction(ctx), { size: 13 }),
    ], { gap: 6, flexWrap: "wrap", alignItems: "center" }))] : []),
    when({ eq: ["busy", "check"] }, row([statusMark("working", { color: OCHRE, size: 8 }), meta("Checking…", { size: 13 })], { gap: 8, alignItems: "center", minHeight: 44 })),
    when({ eq: ["busy", "done"] }, row([statusMark("working", { color: OCHRE, size: 8 }), meta("Adding…", { size: 13 })], { gap: 8, alignItems: "center", minHeight: 44 })),
    // Hidden while Done, a fix or a read is on its way: no second Done.
    when({ eq: ["busy", ""] }, row([
      when({ falsy: "chk.multi" }, secondaryButton("Change", changeAction(0), { size: "md" })),
      // With a stop Done is a plain outline (it only says the stop): the fix pills above are the obvious next step.
      when({ falsy: "chk.stop" }, primaryButton("Done", doneAction(ctx), { size: "md" })),
      when({ truthy: "chk.stop" }, secondaryButton("Done", doneAction(ctx), { size: "md" })),
    ], { gap: 10, flexWrap: "wrap" })),
  ], { gap: 14 }));
}

// ------------------------------------------------------------------ the box and its answers

/** The type box: Photo, Camera, File over it (the phone); the +, the words, Send (or X0 filling it in). */
function typeBox(ctx: BotsCtx): Node {
  const desk = isDesk(ctx);
  const send = sendAction(ctx);
  const f = field("say", "say", desk ? "Tell X0, like Dentist Fri 5 pm, or drop a file" : "Tell X0, like Dentist Fri 5 pm", { onSubmit: send });
  const extras = ctx.can.has(KIT_EXTRAS_CAPABILITY);
  const say: Node = extras ? { ...f, props: { ...(f.props ?? {}), maxLength: WORDS_MAX, ...(ctx.params.focus === "box" ? { autoFocus: true } : {}) } } : f;
  const plus = boxPlus(ctx);
  const input = row([
    ...plus,
    say,
    when({ neq: ["busy", "fill"] }, labelled(box([icon("send", { size: 18, color: C.paper })], { width: 40, height: 40, borderRadius: 20, backgroundColor: C.ink, alignItems: "center", justifyContent: "center", flexShrink: 0 }, send), "Send")),
    when({ eq: ["busy", "fill"] }, labelled(box([statusMark("working", { color: OCHRE, size: 10 })], { width: 40, height: 40, alignItems: "center", justifyContent: "center", flexShrink: 0 }), "X0 is filling it in")),
  ], { gap: 8, alignItems: "center", borderWidth: 1, borderColor: C.line, borderRadius: 28, paddingLeft: plus.length ? 8 : 18, paddingRight: 6, paddingVertical: 4, minHeight: 52, backgroundColor: C.paper });
  return col([...boxPicks(ctx), input], { gap: 8 });
}

/** A bill's or a wait's preview: "Looks like a bill. Add it?", their words, Done (the box's own path) or Change (back in the box). */
function previewPart(ctx: BotsCtx): Node {
  return when({ truthy: "pre.line" }, col([
    text("", { size: 15, lineHeight: 21, bind: "pre.line" }),
    // What Done would add ("Electricity ₹2,140 · due Sat 14 Nov"); the person's own words when the server can't say.
    when({ truthy: "pre.sum" }, text("", { size: 15, weight: 600, lineHeight: 21, bind: "pre.sum" })),
    when({ falsy: "pre.sum" }, messageText(ctx, "", { lines: 3, color: C.meta, size: 14, bind: "pre.words" })),
    when({ eq: ["busy", ""] }, row([
      primaryButton("Done", previewDone(ctx), { size: "md" }),
      secondaryButton("Change", seq(setState("say", "$state.pre.words"), clearState("pre")), { size: "md" }),
    ], { gap: 10, flexWrap: "wrap" })),
    when({ eq: ["busy", "box"] }, row([statusMark("working", { color: OCHRE, size: 8 }), meta("Adding…", { size: 13 })], { gap: 8, alignItems: "center", minHeight: 44 })),
  ], { gap: 8, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }));
}

// ------------------------------------------------------------------ the screen

export function makePage(ctx: BotsCtx, setup: MakeSetup) {
  const desk = isDesk(ctx);
  const state = makeState(ctx, setup);
  const day0 = (state.d as CardDraft).day;
  const head = row([
    col([
      text("Plan something", { size: desk ? 24 : 22, weight: 700, tracking: -0.4, lineHeight: desk ? 30 : 28 }),
      meta("Fill it in, or tell X0 below.", { size: 13, lineHeight: 18 }),
    ], { gap: 4, flexShrink: 1 }),
    grow(),
    ...headerBuddy(ctx, "plan", { thinkWhen: { any: [{ eq: ["busy", "fill"] }, { eq: ["busy", "check"] }] } }),
  ], { gap: 10, alignItems: "center" });
  const cardNode = col([editFace(ctx, setup, day0), checkFace(ctx, setup)], {
    gap: 18, padding: 18, borderRadius: 20, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper,
  });
  return page(ctx, {
    back: true, ...(desk ? { backTitle: "Plan Ease", maxWidth: 640 } : {}), title: "Plan something", nav: "plan", gap: 16, state,
    // The box's answers (a bill's preview, a day's answer, the chat's) sit under the header, above the card: below the edit face's long
    // card they were off the phone's screen, and the person had to scroll to find what their words did.
    body: [head, previewPart(ctx), ...boxReply(ctx, { pill: true }), cardNode],
    // The box at the bottom, outside what scrolls: the phone's footer, the window's foot (a footer there scrolls with the column and
    // sits under a long card, off the window).
    dock: [typeBox(ctx)],
  });
}

export const planMakeScreens: BotsScreen[] = [
  screen<MakeSetup>({
    id: SCREENS.planMake,
    // Only the card reads anything; the old form reads nothing. A failed read is the card with no people and no AI.
    load: async (ctx, deps) => (makeFor(ctx)
      ? deps.api<MakeSetup>("GET", `${MK}?tz=${ctx.tzOffsetMinutes}`).catch(() => setupFallback(ctx))
      : setupFallback(ctx)),
    build: (ctx, d) => (makeFor(ctx) ? makePage(ctx, d ?? setupFallback(ctx)) : planAddForm(ctx)),
  }),
];
