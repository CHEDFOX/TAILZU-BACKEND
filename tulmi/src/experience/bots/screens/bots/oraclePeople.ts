/**
 * CHAMEN'S PEOPLE, DRAWN (oracle/people.ts, docs/oracle.md "People"): the wheels the birth date and time are picked on, the people card
 * the stage's circle opens, and the cards the stage's + opens to add someone.
 *
 *   wheels(p)           the day, the month and the year side by side, each a column to scroll and tap (and the hour, the minute and am/pm
 *                       under them). Server-drawn: a Scroll box and pressable rows, so every build that is out has them; nothing is typed
 *   peopleCard(...)     over the page: "Yours" (themselves, with the gender Chamen reads their chart with, switchable here only, and the
 *                       people they added, each with who it is shared with) and "Shared with you" (a name and who shared it, never when or
 *                       where they were born). A tap picks who the next question is read for: one chat, the answers follow the pick
 *   addCards(...)       who it is (a name, and a gender with none picked), when they were born (the wheels), where (as you type), then
 *                       POST /v1/oracle/people with the lot, and the new person is picked
 */
import type { ActionRef, ActionSpec, Condition, Node } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, botCard, box, C, call, col, icon, labelled, row, segmented, seq, text, when, whenEq } from "../../kit.js";
import type { CircleView } from "../../../../oracle/people.js";
import { genderChips } from "../firstRun/aboutCard.js";
import { cardBack, line, permitStep, setState, toast } from "../firstRun/parts.js";

const PEOPLE = "/v1/oracle/people";
const PLACES = "/v1/oracle/places";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = (m: string) => m.slice(0, 3);
const HITS = 5;
const WIDTH = { phone: 330, desktop: 360 };

/** The state of one set of wheels: `${p}_dd` the day, `_mm` the month's name, `_yy` the year, `_hh` the hour, `_mi` the minute, `_ap` am/pm. */
export const wheelPaths = (p: string) => ({ day: `${p}_dd`, month: `${p}_mm`, year: `${p}_yy`, hour: `${p}_hh`, minute: `${p}_mi`, ampm: `${p}_ap` });
export function wheelState(p: string, parts?: { day: string; month: string; year: string; hour: string; minute: string; ampm: string } | null): Record<string, string> {
  const w = wheelPaths(p);
  return { [w.day]: parts?.day ?? "", [w.month]: parts?.month ?? "", [w.year]: parts?.year ?? "", [w.hour]: parts?.hour ?? "", [w.minute]: parts?.minute ?? "", [w.ampm]: parts?.ampm ?? "" };
}
/** Every part picked. */
export const wheelsPicked = (p: string): Condition => ({ all: Object.values(wheelPaths(p)).map((k) => ({ truthy: k })) });
/** The body a write sends: the parts as picked (birth.ts whenFromParts reads them). */
export const wheelBody = (p: string): Record<string, string> => Object.fromEntries(Object.entries(wheelPaths(p)).map(([k, v]) => [k, `$state.${v}`]));

/** A wheel's row, the room between rows, and the column's own padding: a column shows exactly `rows` of them, no half row cut off. */
const ROW = 40, ROW_GAP = 2, ROW_PAD = 4;
const shows = (rows: number): number => rows * ROW + (rows - 1) * ROW_GAP + 2 * ROW_PAD;
/** The date's columns show three rows at a time, the time's two (am and pm fit exactly). */
const DATE_ROWS = 3, TIME_ROWS = 2;
/** Every column one width, so the time's three sit exactly under the date's three (a Scroll does not share out flex evenly). */
const COL_W = "32%";

/** One value in a column: tapped, it is the one picked (ink), the rest stay plain. */
function cell(path: string, value: string, label: string, width: number | string): Node {
  return labelled(box([text(label, { size: 16, weight: 500, lineHeight: 20, align: "center", style: { color: whenEq(path, value, C.paper, C.ink) } })], {
    height: ROW, width, borderRadius: 12, flexShrink: 0, alignItems: "center", justifyContent: "center", backgroundColor: whenEq(path, value, C.ink, "transparent"),
  }, setState(path, value)), label);
}

/** A column that scrolls on its own inside the card (components/Scroll.tsx): a wheel to scroll and tap. */
function column(path: string, values: Array<{ value: string; label: string }>, rows: number): Node {
  return {
    type: "Scroll", style: { height: shows(rows), width: COL_W, flexGrow: 0, flexShrink: 0, borderRadius: 14, backgroundColor: C.surface, padding: ROW_PAD, gap: ROW_GAP },
    children: values.map((v) => cell(path, v.value, v.label, "100%")),
  };
}

/** What has been picked so far, as words: "13 July 1994 · 9:30 am", each part shown once it is there. */
function picked(p: string): Node {
  const w = wheelPaths(p);
  const t = (path: string): Node => when({ truthy: path }, text("", { size: 15, weight: 600, lineHeight: 20, bind: path }));
  const plain = (s: string, path: string): Node => when({ truthy: path }, text(s, { size: 15, weight: 600, lineHeight: 20 }));
  return row([
    row([t(w.day), t(w.month), t(w.year)], { gap: 4 }),
    when({ truthy: w.hour }, text("·", { size: 15, color: C.meta, lineHeight: 20 })),
    // The time as one word: "9:30 am", no gaps round the colon.
    row([t(w.hour), plain(":", w.minute), t(w.minute), plain(" ", w.ampm), t(w.ampm)], { gap: 0 }),
  ], { gap: 6, minHeight: 20, flexWrap: "wrap" });
}

/** The date's three wheels, then the time's three, every column the same width so the two rows line up. Years run from this one back. */
export function wheels(ctx: BotsCtx, p: string): Node[] {
  const w = wheelPaths(p);
  const thisYear = new Date(ctx.live.now + ctx.tzOffsetMinutes * 60_000).getUTCFullYear();
  const days = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
  const months = MONTHS.map((m) => ({ value: m, label: SHORT(m) }));
  const years = Array.from({ length: 110 }, (_, i) => ({ value: String(thisYear - i), label: String(thisYear - i) }));
  const hours = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
  const minutes = Array.from({ length: 60 }, (_, i) => ({ value: String(i).padStart(2, "0"), label: String(i).padStart(2, "0") }));
  return [
    picked(p),
    row([column(w.day, days, DATE_ROWS), column(w.month, months, DATE_ROWS), column(w.year, years, DATE_ROWS)], { justifyContent: "space-between" }),
    row([
      column(w.hour, hours, TIME_ROWS), column(w.minute, minutes, TIME_ROWS),
      col([cell(w.ampm, "am", "am", "100%"), cell(w.ampm, "pm", "pm", "100%")], { gap: ROW_GAP, width: COL_W, flexGrow: 0, flexShrink: 0, height: shows(TIME_ROWS), borderRadius: 14, backgroundColor: C.surface, padding: ROW_PAD }),
    ], { justifyContent: "space-between", height: shows(TIME_ROWS) }),
  ];
}

// ===================================================================== the people card (the stage's circle)

/** The state the people card and the add cards keep. */
export const PP = { open: "pp_open", tab: "pp_tab", add: "ap_open", name: "ap_name", gender: "ap_gender", step: "ap_step", q: "ap_q", found: "ap_found", session: "ap_s" } as const;
export function peopleState(session: string): Record<string, unknown> {
  return { [PP.open]: false, [PP.tab]: "mine", [PP.add]: false, [PP.name]: "", [PP.gender]: "", [PP.step]: "who", [PP.q]: "", [PP.found]: { q: "", places: [] }, [PP.session]: session, ...wheelState("ap") };
}

/** A person's mark: the first letter of their name in a circle (the picked one in ink). */
export function personInitial(name: string, size: number, on = false): Node {
  return box([text((name.trim()[0] ?? "?").toUpperCase(), { size: Math.round(size * 0.42), weight: 700, lineHeight: Math.round(size * 0.5), color: on ? C.paper : C.ink })], {
    width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: C.ink, backgroundColor: on ? C.ink : C.paper,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  });
}

const refresh: ActionSpec = { kind: "refresh" } as ActionSpec;
const pick = (ref: string, name: string): ActionRef => call("PUT", `${PEOPLE}/active`, { ref }, {
  ok: seq(setState(PP.open, false), toast(`Reading for ${name}`), refresh), fail: toast("Couldn't pick them. Try again."),
});

function personRow(o: { ref: string; name: string; sub: string; on: boolean; ready: boolean; extra?: Node[] }): Node {
  return col([
    labelled(row([
      personInitial(o.name, 36, o.on),
      col([text(o.name, { size: 16, weight: 600, lineHeight: 21, lines: 1 }), text(o.sub, { size: 12, color: C.meta, lineHeight: 16, lines: 2 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      ...(o.on ? [icon("check", { size: 18, color: C.ink, weight: 2.4 })] : []),
    ], { gap: 12, alignItems: "center", minHeight: 52 }, o.on || !o.ready ? undefined : pick(o.ref, o.name)), o.on ? `${o.name}, picked` : `Read for ${o.name}`),
    ...(o.extra ?? []),
  ], { gap: 8, padding: 12, borderRadius: 16, borderWidth: o.on ? 1.5 : 1, borderColor: o.on ? C.ink : C.line, backgroundColor: C.paper });
}

/** Who a chart is shared with, as chips to tap on and off (only the spaces they are in). */
function shareChips(ref: string, sharedIn: string[], spaces: CircleView["spaces"], i: string): Node[] {
  if (!spaces.length) return [];
  const open = `pp_sh_${i}`;
  return [
    labelled(row([icon("share", { size: 14, color: C.grey70 }), text(sharedIn.length ? `Shared with ${sharedIn.length === 1 ? spaces.find((s) => s.id === sharedIn[0])?.name ?? "1 space" : `${sharedIn.length} spaces`}` : "Share", { size: 13, weight: 500, lineHeight: 18, color: C.grey70 })],
      { gap: 6, alignSelf: "flex-start", minHeight: 28 }, { kind: "toggleState", path: open } as ActionSpec), "Share"),
    when({ truthy: open }, row(spaces.map((s) => {
      const on = sharedIn.includes(s.id);
      return labelled(row([...(on ? [icon("check", { size: 13, color: C.paper, weight: 2 })] : []), text(s.name, { size: 13, weight: 500, lineHeight: 17, color: on ? C.paper : C.ink })], {
        gap: 5, height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: on ? C.ink : C.outline, backgroundColor: on ? C.ink : C.paper,
      }, call("PUT", `${PEOPLE}/share`, { ref, spaceId: s.id, on: !on }, { ok: seq(toast(on ? `No longer shared with ${s.name}` : `Shared with ${s.name}`), refresh), fail: toast("Couldn't share that. Try again.") })), on ? `Stop sharing with ${s.name}` : `Share with ${s.name}`);
    }), { gap: 6, flexWrap: "wrap" })),
  ];
}

export function peopleCard(ctx: BotsCtx, c: CircleView, look: { color: string; avatar?: string }): Node {
  const desk = ctx.client === "desktop";
  const me = c.me;
  // Their own chart's gender, for Chamen only: the profile is left as it is.
  const meGender = row((["male", "female", "other"] as const).map((g) => {
    const on = me.gender === g;
    return labelled(row([text(g[0]!.toUpperCase() + g.slice(1), { size: 13, weight: 500, lineHeight: 17, color: on ? C.paper : C.ink })], {
      height: 30, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: on ? C.ink : C.outline, backgroundColor: on ? C.ink : C.paper, justifyContent: "center",
    }, on ? undefined : call("PUT", `${PEOPLE}/me`, { gender: g }, { ok: refresh, fail: toast("Couldn't change that. Try again.") })), `Read my chart as ${g}`);
  }), { gap: 6 });
  const mine = col([
    personRow({ ref: "me", name: `${me.name} (you)`, sub: me.line ?? "Your birth details aren't complete yet", on: c.active === "me", ready: true, extra: [
      text("Chamen reads your chart as", { size: 12, color: C.meta, lineHeight: 16 }), meGender, ...shareChips("me", me.sharedIn, c.spaces, "me"),
    ] }),
    ...c.others.map((o, i) => personRow({
      ref: o.ref, name: o.name, sub: o.line ?? "Birth details not complete", on: c.active === o.ref, ready: o.ready,
      extra: [row([
        ...shareChips(o.ref, o.sharedIn, c.spaces, String(i)),
      ], { gap: 12, flexWrap: "wrap" }),
      labelled(row([text("Take out", { size: 13, weight: 500, lineHeight: 18, color: C.meta })], { minHeight: 28, alignSelf: "flex-start" },
        call("DELETE", `${PEOPLE}/${encodeURIComponent(o.ref)}`, undefined, { ok: seq(toast(`${o.name} taken out`), refresh), fail: toast("Couldn't take them out. Try again.") })), `Take ${o.name} out`)],
    })),
    labelled(row([icon("plus", { size: 16, color: C.ink, weight: 2.4 }), text("Add someone", { size: 15, weight: 600, lineHeight: 20 })], { gap: 8, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: C.outline },
      seq(setState(PP.open, false), setState(PP.add, true))), "Add someone"),
  ], { gap: 10 });
  const shared = col(c.shared.length ? c.shared.map((x) => personRow({
    ref: x.ref, name: x.name, sub: `${x.name === x.by ? "Their own chart" : `Shared by ${x.by}`}${x.space ? ` · ${x.space}` : ""}`, on: c.active === x.ref, ready: x.ready,
  })) : [text("Nothing shared with you yet. When someone in your spaces shares a chart, it shows here, and you can ask Chamen about it.", { size: 13, color: C.meta, lineHeight: 19 })], { gap: 10 });
  return when({ truthy: PP.open }, botCard([
    cardBack(setState(PP.open, false), "Close"),
    col([
      col([text("Who to read for", { size: 20, weight: 600, tracking: -0.3, lineHeight: 25 }), line("One chat. Each question is read for the one picked here.")], { gap: 6 }),
      segmented([{ label: "Yours", value: "mine" }, { label: "Shared with you", value: "shared" }], PP.tab),
      when({ eq: [PP.tab, "mine"] }, mine),
      when({ eq: [PP.tab, "shared"] }, shared),
    ], { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 20, gap: 14 }),
  ], {
    kind: "custom", color: look.color, stageHeight: 64, overlay: true, width: WIDTH[desk ? "desktop" : "phone"], label: "Chamen's people",
    ...(look.avatar ? { avatar: look.avatar } : {}), closeWhen: { falsy: PP.open }, onLeave: setState(PP.open, false),
  }));
}

// ===================================================================== adding someone (the stage's +)

export function addCards(ctx: BotsCtx, look: { color: string; avatar?: string }): Node {
  const desk = ctx.client === "desktop";
  const step = (s: string): Condition => ({ eq: [PP.step, s] });
  const close = seq(setState(PP.add, false), setState(PP.step, "who"));
  const toWhen: ActionSpec = { kind: "condition", if: { truthy: PP.name }, then: setState(PP.step, "when"), else: toast("Add their name.") } as ActionSpec;
  const toWhere: ActionSpec = { kind: "condition", if: wheelsPicked("ap"), then: setState(PP.step, "where"), else: toast("Pick the day, the month, the year and the time they were born.") } as ActionSpec;
  const base = { name: `$state.${PP.name}`, gender: `$state.${PP.gender}`, ...wheelBody("ap") };
  const done = (body: Record<string, unknown>): ActionSpec => call("POST", PEOPLE, body, {
    ok: seq({ kind: "haptic", style: "success" } as ActionSpec, close, toast("Added. Chamen reads for them now."), refresh),
    fail: toast("Couldn't add them. Check the date and the place."),
  }) as ActionSpec;
  const search = call("GET", `${PLACES}?q=$state.${PP.q}&s=$state.${PP.session}`, undefined, { assignTo: PP.found });
  const hit = (i: number): Node => when({ truthy: `${PP.found}.places.${i}` }, labelled(row([
    icon("pin", { size: 18, color: C.meta }),
    col([
      text("", { size: 15, weight: 500, lineHeight: 20, lines: 1, bind: `${PP.found}.places.${i}.label` }),
      text("", { size: 12, color: C.meta, lineHeight: 16, lines: 1, bind: `${PP.found}.places.${i}.sub` }),
    ], { gap: 1, flexShrink: 1, minWidth: 0 }),
  ], { gap: 12, minHeight: 48, alignItems: "center", paddingHorizontal: 4 },
  done({ ...base, placeId: `$state.${PP.found}.places.${i}.id`, place: `$state.${PP.found}.places.${i}.label`, session: `$state.${PP.session}` })), "Pick this place"));
  const typed: ActionSpec = { kind: "condition", if: { truthy: PP.q }, then: done({ ...base, place: `$state.${PP.q}` }), else: toast("Type the town or city they were born in.") } as ActionSpec;
  const field = (path: string, placeholder: string, o: { onChange?: ActionRef; capitalize?: boolean } = {}): Node => row([{
    type: "TextField", id: path, bind: { value: path },
    props: { placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0, minHeight: 44, color: C.ink, autoCorrect: false, ...(o.capitalize ? { autoCapitalize: "words" } : {}) },
    ...(o.onChange ? { on: { onChange: o.onChange } } : {}),
    style: { flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 44, fontSize: 17, color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none" },
  } as Node], { height: 56, borderWidth: 1.5, borderColor: C.ink, borderRadius: 16, paddingHorizontal: 16 });

  return when({ truthy: PP.add }, botCard([
    cardBack(close, "Close"),
    permitStep({
      when: step("who"), title: "Who is it?",
      // No gender is picked for someone added: it is theirs to say (only the person's own chart starts from their profile).
      lines: [line("Their name, and their gender if you know it. Some ways of reading use the name, and some read a woman's chart differently.")],
      extra: [field(PP.name, "Their name", { capitalize: true }), genderChips(desk, PP.gender)],
      cta: { label: "Next", onPress: toWhen },
    }),
    permitStep({
      when: step("when"), title: "When were they born?",
      lines: [line("The date, and the time: the time is what fixes the sky to that moment.")],
      extra: wheels(ctx, "ap"),
      cta: { label: "Next", onPress: toWhere }, quiet: { label: "Back", onPress: setState(PP.step, "who") },
    }),
    permitStep({
      when: step("where"), title: "Where were they born?",
      lines: [line("The town or city. Pick it from the list as you type.")],
      extra: [field(PP.q, "Town or city", { onChange: search, capitalize: true }), col(Array.from({ length: HITS }, (_, i) => hit(i)), { gap: 0 })],
      cta: { label: "Add", onPress: typed }, quiet: { label: "Back", onPress: setState(PP.step, "when") },
    }),
  ], {
    kind: "custom", color: look.color, stageHeight: 80, overlay: true, width: WIDTH[desk ? "desktop" : "phone"], label: "Add someone",
    ...(look.avatar ? { avatar: look.avatar } : {}), closeWhen: { falsy: PP.add }, onLeave: close,
  }));
}
