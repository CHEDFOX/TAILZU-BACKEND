/**
 * The You area's notifyDesk screen.
 */

import type { ActionRef, ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import { MOTION_CAPABILITY } from "../../../../../../shared/types/sdui.js";
import {
  call, seq, row, icon, C, meta, box, text, whenEq, type IconName, labelled, when, col, grow, button, type BotsCtx, botAvatar, page, card,
  table, switchMark, divider, sectionLabel, canFocus, canMotionDrive, switchRow, listRow,
} from "../../kit.js";
import { line as cardLine, permitStep } from "../firstRun/parts.js";
import { DRIVE, FOCUS } from "../permitWords.js";
import { type Settings, toast, refresh, oops, clock, botOf, heading, couldNot, columns, glyph, G } from "./parts.js";

/** `name`: the name Plan Ease calls as ("Zara", else "X0"); `calls`: calls can come here (BOT_CALLS), so the Calls row is drawn. */
export interface NotifyData {
  settings: Settings; today: { done: number; needs: number; spentPaise: number } | null; line: string | null; name?: string; calls?: boolean;
  /** Follow-through is on here (PLAN_V2_FOLLOW): the Must not miss part shows. */
  follow?: boolean;
  /** The people whose must-not-miss items may ring this person louder and call them, by name. */
  followFrom?: Array<{ id: string; name: string }>;
  /** Whether a Focus with X0 Bot's own filter is on right now (docs: perms2 §4.2). Never which Focus. */
  focusOn?: boolean;
  /** A real phone call can go here (the phone channel set up), and this person's own number as they see it. */
  phone?: { number: { state: "none" | "pending" | "verified" | "stopped"; display: string; setup?: { screen: string; params?: Record<string, string> } } | null } | null;
}

/** A setting saved: PUT /v1/you/settings, a short toast, a refresh. */
export const save = (b: Record<string, unknown>, ok: string): ActionRef => call("PUT", "/v1/you/settings", b, { ok: seq(toast(ok), refresh), fail: oops() });
export const when2 = (path: string, then: ActionRef, otherwise: ActionRef): ActionSpec => ({ kind: "condition", if: { truthy: path }, then, else: otherwise });

/** A lock and "Always on": a ping that can't be turned off. */
export const alwaysOn = (label = "Always on"): Node => row([icon("lock", { size: 13, color: C.meta }), meta(label, { size: 12 })], { gap: 4 });

/** A segmented control that saves on press. */
export function segments(options: Array<{ label: string; value: string }>, path: string, onPick: (value: string) => ActionRef, width?: number): Node {
  return row(options.map((opt) => box([text(opt.label, { size: 13, weight: 500, lineHeight: 17, align: "center" })], {
    flexGrow: 1, flexBasis: 0, alignItems: "center", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 9,
    backgroundColor: whenEq(path, opt.value, C.paper, "transparent"),
  }, seq({ kind: "setState", path, value: opt.value }, onPick(opt.value)))), { padding: 3, borderRadius: 12, backgroundColor: C.surface, gap: 2, ...(width ? { width } : {}) });
}

// ===================================================================== bots.notify

// ---- the time picker: any hour, the minutes in fives, am or pm. Made of the kit's own parts (a box, a bound text, a
// condition), so every app that draws these pages can use it; the server turns { h, m, ap } into the minute of the day.
type ClockKey = "sum" | "qf" | "qt";
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
/** A saved minute of the day as the picker's state: its hour, its minute (down to a five), am or pm. */
function clockState(key: ClockKey, minute: number): Record<string, unknown> {
  const h = Math.floor(minute / 60) % 24;
  return { [`${key}_h`]: h % 12 === 0 ? 12 : h % 12, [`${key}_m`]: Math.floor((minute % 60) / 5) * 5, [`${key}_ap`]: h < 12 ? "am" : "pm" };
}
/** The next (or the one before) in a list that goes round: after 12 comes 1, before :00 comes :55. */
function cycle(path: string, values: number[], dir: 1 | -1): ActionSpec {
  let act: ActionSpec = { kind: "setState", path, value: values[0] };
  for (let i = values.length - 1; i >= 0; i--) {
    const next = values[(i + dir + values.length) % values.length];
    act = { kind: "condition", if: { eq: [path, values[i]] }, then: { kind: "setState", path, value: next }, else: act } as ActionSpec;
  }
  return act;
}
const BIG = { size: 26, weight: 600, lineHeight: 32, tracking: -0.4 } as const;
function stepper(path: string, values: number[], pad: boolean, what: string): Node {
  const btn = (name: IconName, dir: 1 | -1) =>
    labelled(box([icon(name, { size: 16, color: C.grey70 })], { width: 34, height: 44, alignItems: "center", justifyContent: "center" }, cycle(path, values, dir)), `${dir > 0 ? "Later" : "Earlier"} ${what}`);
  return row([
    btn("minus", -1),
    row([...(pad ? [when({ lt: [path, 10] }, text("0", BIG))] : []), text(String(values[0]), { ...BIG, bind: path })], { minWidth: 36, justifyContent: "center" }),
    btn("plus", 1),
  ], { alignItems: "center" });
}
/** A saved time, as a chip: tap it to change it (and again to put the picker away). */
export function timeChip(key: ClockKey, minute: number): Node {
  const open = whenEq("edit", key, C.ink, C.outline);
  return box([text(clock(minute, true), { size: 14, weight: 600, lineHeight: 19 })], { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1.5, borderColor: open },
    { kind: "condition", if: { eq: ["edit", key] }, then: { kind: "setState", path: "edit", value: "" }, else: { kind: "setState", path: "edit", value: key } } as ActionSpec);
}
/** The picker for one time, open while its chip is: hour, minutes, am or pm, then Save. */
export function timePicker(key: ClockKey, field: "summaryAt" | "quietFrom" | "quietTo", ok: string): Node {
  const p = (x: string) => `${key}_${x}`;
  return when({ eq: ["edit", key] }, col([
    row([stepper(p("h"), HOURS, false, "hour"), text(":", BIG), stepper(p("m"), MINUTES, true, "minutes")], { alignItems: "center", justifyContent: "center", gap: 4 }),
    row([
      segments([{ label: "am", value: "am" }, { label: "pm", value: "pm" }], p("ap"), () => ({ kind: "haptic", style: "selection" }) as ActionSpec, 96),
      grow(),
      button("Save", seq(save({ notify: { [field]: { h: `$state.${p("h")}`, m: `$state.${p("m")}`, ap: `$state.${p("ap")}` } } }, ok), { kind: "setState", path: "edit", value: "" }), { size: "md" }),
    ], { alignItems: "center", gap: 10 }),
  ], { backgroundColor: C.surface, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 12, gap: 6 }));
}

export const notifyState = (s: Settings, ctx: BotsCtx) => ({
  done: s.notify.done, summary: s.notify.summary, quiet: s.notify.quiet, calls: s.notify.calls !== false, edit: "",
  // Build 8.9.1's two holds (docs: perms2 §4, §5.2): both off until the person turns the row on. The driving row's own card,
  // the Settings line it falls back to, and whether Motion & Fitness is already granted (read, never asked, on appear).
  focusHold: s.notify.focusHold === true, driveWait: s.notify.driveWait === true,
  driveCard: false, driveBlocked: false, motionGranted: false,
  follow: s.notify.follow !== false, followTell: s.notify.followTell !== false, ringMax: String(s.notify.ringMax ?? 6), phoneCall: s.notify.phoneCall === true,
  ...clockState("sum", s.notify.summaryAt), ...clockState("qf", s.notify.quietFrom), ...clockState("qt", s.notify.quietTo),
  ...Object.fromEntries(ctx.live.bots.map((b) => [`bot_${b.slug.replace(/-/g, "_")}`, !s.notify.botsOff.includes(b.slug)])),
});
export const doneSeg = (width?: number) => segments([{ label: "Quiet", value: "quiet" }, { label: "Ping", value: "ping" }], "done",
  (v) => save({ notify: { done: v } }, v === "ping" ? "Done pings you" : "Done comes without a sound"), width);
export const summarySwitch = () => seq({ kind: "toggleState", path: "summary" }, when2("summary", save({ notify: { summary: true } }, "Daily summary on"), save({ notify: { summary: false } }, "Daily summary off")));
/** Calls on or off, saved (after the switch has flipped `calls`): the phone's switchRow flips it first, the window's box with callsSwitch. */
export const callsSave = (): ActionRef => when2("calls", save({ notify: { calls: true } }, "Calls on"), save({ notify: { calls: false } }, "Calls off"));
export const callsSwitch = () => seq({ kind: "toggleState", path: "calls" }, callsSave());
/** What the Calls row says: "Zara calls you when it's time to leave or a bill is due today" (and must-not-miss reminders, with follow-through). */
export const callsLine = (d: NotifyData): string => `${d.name || "X0"} calls you when it's time to leave or a bill is due today${d.follow ? ", and for must-not-miss reminders" : ""}`;

// ------------------------------------------- when a call waits: a Focus, and driving (docs: perms2 §4, §5.2)

/**
 * THE TWO HOLDS, under Calls. Each is drawn only on a store build's phone that declares its capability and only while its own
 * switch is on (kit canFocus / canMotionDrive); the window and every older binary get this card exactly as it is today.
 *
 * THE FOCUS ROW HAS NO CARD, because it asks nothing at all: on iPhone the person adds X0 Bot's own Focus Filter in Settings
 * (the row tells them the three steps, because iOS gives an app no way to open a Focus), and on Android reading Do Not
 * Disturb needs no permission.
 *
 * THE DRIVING ROW DOES ASK, so it has one (docs: perms2 §5.2). Turning it on reads whether Motion & Fitness is already
 * granted — `checkPermission` never prompts — and with it granted the switch just saves. Without it, one card opens, with
 * Continue and nothing else (App Review 5.1.1(iv)), and Continue is the only thing that reaches the iPhone's own prompt. The
 * switch does NOT move until the answer is in: a switch that said "calls wait while you drive" with no Motion grant behind
 * it would promise something nothing does, and `NSMotionUsageDescription`'s driving clause would never be shown in context.
 */
export function holdRows(ctx: BotsCtx, d: NotifyData, o: { desk?: boolean } = {}): Node[] {
  const rows: Node[] = [];
  const sub = (words: string): Node => meta(words, { size: 12, ...(o.desk ? {} : { style: { paddingHorizontal: 16, paddingBottom: 6 } }) });
  if (canFocus(ctx)) {
    const label = ctx.platform === "android" ? FOCUS.androidRow : FOCUS.row;
    const press = flipHold("focusHold", "Calls wait during a Focus", "Calls come as usual");
    rows.push(o.desk
      ? row([
        col([text(label, { size: 14 }), meta(FOCUS.rowSub, { size: 12 })], { flexGrow: 1, flexShrink: 1, gap: 2 }),
        box([switchMark("focusHold")], {}, press),
      ], { gap: 12 })
      : switchRow(label, "focusHold", { left: glyph(G.bell, 18), sub: FOCUS.rowSub, onChange: saveOnly("focusHold", "Calls wait during a Focus", "Calls come as usual", "focusHold") }));
    // iPhone only: the three steps, and what the server last heard. Which Focus it is, is never known.
    if (ctx.platform !== "android") {
      rows.push(when({ truthy: "focusHold" }, col([
        ...FOCUS.steps.map((t, i) => sub(`${i + 1}. ${t}`)),
        sub(d.focusOn ? FOCUS.live : FOCUS.idle),
      ], { gap: 2, ...(o.desk ? { paddingTop: 2 } : {}) })));
    }
  }
  if (canMotionDrive(ctx)) {
    const android = ctx.platform === "android";
    // THE WATCH, BOTH WAYS (8.9.1, `motion.watch`). Nothing is read and nothing comes back: it only tells the phone whether
    // it may watch for getting into a car. ANDROID NEEDS BOTH ENDS — on registers the two IN_VEHICLE transitions, which is
    // the only way it can answer the check at all, and off unregisters and deletes the one line it kept, so with the switch
    // off nothing about driving is left on the phone. The iPhone reads its own motion history at question time, so there is
    // nothing to register and the phone answers true, which is why both paths can send it unconditionally.
    const watch = (on: boolean): ActionSpec => ({ kind: "motion.watch", on } as unknown as ActionSpec);
    // On -> off at once, and the switch moves with the tap. Off -> granted already, so it just saves; else the card, and the
    // switch stays where it is until `onGranted` has saved it (the save ends in a refresh, which draws it on).
    const saveOn: ActionRef = seq(watch(true), save({ notify: { driveWait: true } }, "Calls wait while you drive"));
    const turnOn: ActionRef = { kind: "condition", if: { truthy: "motionGranted" }, then: saveOn, else: { kind: "setState", path: "driveCard", value: true } } as ActionSpec;
    const press: ActionRef = {
      kind: "condition", if: { truthy: "driveWait" },
      then: seq(
        { kind: "toggleState", path: "driveWait" } as ActionSpec,
        watch(false),
        save({ notify: { driveWait: false } }, "Calls come as usual"),
      ),
      else: turnOn,
    } as ActionSpec;
    // The one thing that asks. `onGranted` saves the switch; a refusal leaves it off and says so.
    const ask: ActionSpec = {
      kind: "requestPermission", permission: "motion",
      onGranted: seq({ kind: "setState", path: "driveCard", value: false } as ActionSpec, { kind: "setState", path: "motionGranted", value: true } as ActionSpec, saveOn),
      onDenied: seq({ kind: "setState", path: "driveCard", value: false } as ActionSpec, toast(DRIVE.denied)),
      onBlocked: seq({ kind: "setState", path: "driveCard", value: false } as ActionSpec, { kind: "setState", path: "driveBlocked", value: true } as ActionSpec),
    } as unknown as ActionSpec;
    // Android's answer is sometimes neither "driving" nor "not driving", and the row and the card say so rather than
    // promise a check that will not always come.
    const driveSub = android ? DRIVE.rowSubAndroid : DRIVE.rowSub;
    rows.push(o.desk
      ? row([
        col([text(DRIVE.row, { size: 14 }), meta(driveSub, { size: 12 })], { flexGrow: 1, flexShrink: 1, gap: 2 }),
        box([switchMark("driveWait")], {}, press),
      ], { gap: 12 })
      : listRow({ label: DRIVE.row, sub: driveSub, left: glyph(G.bell, 18), right: switchMark("driveWait"), chevron: false, onPress: press }));
    rows.push(permitStep({
      when: { truthy: "driveCard" }, title: DRIVE.title,
      lines: (android ? DRIVE.linesAndroid : DRIVE.lines).map((l) => cardLine(l)),
      cta: { label: DRIVE.cta, onPress: ask },
    }));
    // Refused once already: the system will not ask again, so Settings is the only useful thing left to offer.
    rows.push(when({ truthy: "driveBlocked" }, col([
      sub(android ? DRIVE.blockedAndroid : DRIVE.blocked),
      button(DRIVE.openSettings, { kind: "openSettings", target: "app" } as ActionSpec, { kind: "secondary", size: "md" }),
    ], { gap: 6, ...(o.desk ? {} : { paddingHorizontal: 16, paddingBottom: 10 }) })));
    // Never prompts: it only reads the answer already on record, so the card is skipped for a phone that said yes before.
    rows.push({ ...box([], { height: 0 }), on: { onAppear: { kind: "checkPermission", permission: "motion", assignTo: "motionGranted" } as ActionSpec } });
  } else if (
    ctx.client === "phone" && ctx.platform === "android" && ctx.can.has(MOTION_CAPABILITY) && d.settings.notify.driveWait === true
  ) {
    // THE SWITCH WENT OFF ON THE SERVER, SO THE PHONE'S REGISTRATION GOES TOO (docs: perms2 §5.2). An Android phone that
    // turned the row on registered the two IN_VEHICLE transitions; with `PERM_MOTION_DRIVE_ANDROID` off there is no row left
    // to turn it off from, so this page quietly unregisters it and deletes the one line it kept. Nothing is read, nothing
    // comes back, and no permission is asked. The iPhone registers nothing, so it needs none of this.
    rows.push({ ...box([], { height: 0 }), on: { onAppear: { kind: "motion.watch", on: false } as unknown as ActionSpec } });
  }
  return rows;
}

/** A hold switch: the phone flips it, then the one PUT saves it. */
const flipHold = (key: "focusHold" | "driveWait", on: string, off: string): ActionRef =>
  seq({ kind: "toggleState", path: key }, when2(key, save({ notify: { [key]: true } }, on), save({ notify: { [key]: false } }, off)));

// ------------------------------------------------------------------ Must not miss (follow-through)

const flip = (path: string, on: string, off: string, key: string): ActionRef => seq({ kind: "toggleState", path }, when2(path, save({ notify: { [key]: true } }, on), save({ notify: { [key]: false } }, off)));
const saveOnly = (path: string, on: string, off: string, key: string): ActionRef => when2(path, save({ notify: { [key]: true } }, on), save({ notify: { [key]: false } }, off));
/** "Calls +91 98••• ••210", "Confirm your number first": the real call's line, from the phone channel. */
const phoneLine = (d: NotifyData): string => {
  const n = d.phone?.number;
  if (n?.state === "verified") return `Only to ${n.display}, never in quiet hours`;
  if (n?.state === "pending") return "Confirm your number first";
  if (n?.state === "stopped") return "You stopped calls from a call";
  return "Add your number first";
};

/** The Must not miss rows (follow-through), as data for both the phone's list and the window's card. Empty unless d.follow. */
export function followRows(d: NotifyData): Array<{ label: string; sub: string; path?: string; press?: ActionRef; save?: ActionRef; chips?: Node; open?: ActionRef; openLabel?: string }> {
  if (!d.follow) return [];
  const rows: Array<{ label: string; sub: string; path?: string; press?: ActionRef; save?: ActionRef; chips?: Node; open?: ActionRef; openLabel?: string }> = [
    { label: "Keep at it", sub: "Louder pings, then a call, until you say done", path: "follow", press: flip("follow", "Keep at it on", "Keep at it off", "follow"), save: saveOnly("follow", "Keep at it on", "Keep at it off", "follow") },
    { label: "Tell the next person", sub: "If you don't answer, X0 tells the next person on it", path: "followTell", press: flip("followTell", "On", "Off", "followTell"), save: saveOnly("followTell", "On", "Off", "followTell") },
    // Each chip saves its own number (never read back from state).
    { label: "Louder pings a day", sub: "Louder pings and calls, at most", chips: row([3, 6, 10].map((n) => box([text(String(n), { size: 13, lineHeight: 17, style: { color: whenEq("ringMax", String(n), C.paper, C.ink) } })], {
      paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: whenEq("ringMax", String(n), C.ink, C.outline),
      backgroundColor: whenEq("ringMax", String(n), C.ink, C.paper),
    }, seq({ kind: "setState", path: "ringMax", value: String(n) }, save({ notify: { ringMax: n } }, `${n} a day`)))), { gap: 8 }) },
  ];
  if (d.phone) {
    rows.push({
      label: "X0 may call my phone if I miss something important", sub: phoneLine(d), path: "phoneCall",
      press: flip("phoneCall", "X0 may call your phone", "No phone calls", "phoneCall"), save: saveOnly("phoneCall", "X0 may call your phone", "No phone calls", "phoneCall"),
      // The number's own screen: to add or confirm it, or (once confirmed) to change or remove it.
      ...(d.phone.number?.setup ? {
        open: { kind: "navigate", screenId: d.phone.number.setup.screen, params: d.phone.number.setup.params ?? {} } as ActionSpec,
        openLabel: d.phone.number.state === "verified" ? "Your number for calls" : d.phone.number.state === "stopped" ? "Turn calls back on" : "Set up your number",
      } : {}),
    });
  }
  return rows;
}

/** "People who can ring you louder": each with Remove (their must-not-miss items then only send notifications). */
export function followFromRows(d: NotifyData): Array<{ name: string; remove: ActionRef }> {
  if (!d.follow) return [];
  return (d.followFrom ?? []).map((p) => ({ name: p.name, remove: save({ notify: { followFrom: { id: p.id, on: false } } }, `Just notifications from ${p.name}`) }));
}
export const quietSwitch = () => seq({ kind: "toggleState", path: "quiet" }, when2("quiet", save({ notify: { quiet: true } }, "Quiet hours on"), save({ notify: { quiet: false } }, "Quiet hours off")));
export const botSwitch = (slug: string) => {
  const path = `bot_${slug.replace(/-/g, "_")}`;
  const saveIt = when2(path, save({ notify: { bot: slug, on: true } }, "Pings on"), save({ notify: { bot: slug, on: false } }, "Pings off"));
  return { path, saveIt, press: seq({ kind: "toggleState", path }, saveIt) };
};
/** From and to, each a chip that opens its picker. */
export const quietTimes = (s: Settings): Node => col([
  row([meta("From", { size: 13 }), timeChip("qf", s.notify.quietFrom), meta("to", { size: 13 }), timeChip("qt", s.notify.quietTo)], { gap: 8, flexWrap: "wrap" }),
  timePicker("qf", "quietFrom", "Quiet hours changed"),
  timePicker("qt", "quietTo", "Quiet hours changed"),
], { gap: 8 });
export const botSub = (slug: string) => (slug === "keybot" ? "Only reminders, like your streak" : slug === "code" ? "Done, stopped or moved jobs" : undefined);

export function summaryPreview(ctx: BotsCtx, d: NotifyData): Node {
  return box([
    row([botAvatar(botOf(ctx, "tailzu").look, 26), col([
      meta(`Tonight, ${clock(d.settings.notify.summaryAt)}`, { size: 12 }),
      text(d.line ?? "Nothing happened yet today. On a quiet day, no note comes.", { size: 13, weight: d.line ? 500 : 400, lineHeight: 18 }),
    ], { gap: 2, flexShrink: 1 })], { gap: 10, alignItems: "flex-start" }),
  ], { backgroundColor: C.surface, borderRadius: 14, padding: 14 });
}

export function notifyDesk(ctx: BotsCtx, d: NotifyData | undefined) {
  if (!d) return page(ctx, { back: true, backTitle: "You", nav: "you", title: "What pings you", maxWidth: 1040, body: [heading(ctx, "What pings you"), couldNot("your settings")] });
  const s = d.settings;
  const H = 24 * 60, pct = (m: number) => `${((m / H) * 100).toFixed(1)}%`;
  const quietBar = s.notify.quietFrom > s.notify.quietTo
    ? row([box([], { width: pct(s.notify.quietTo), height: 6, backgroundColor: C.ink }), box([], { flexGrow: 1, height: 6 }), box([], { width: pct(H - s.notify.quietFrom), height: 6, backgroundColor: C.ink })], { borderRadius: 3, backgroundColor: C.track, overflow: "hidden" })
    : row([box([], { width: pct(s.notify.quietFrom), height: 6 }), box([], { width: pct(s.notify.quietTo - s.notify.quietFrom), height: 6, backgroundColor: C.ink })], { borderRadius: 3, backgroundColor: C.track, overflow: "hidden" });
  return page(ctx, {
    back: true, backTitle: "You", nav: "you", title: "What pings you", maxWidth: 1040, gap: 20, state: notifyState(s, ctx),
    body: [
      heading(ctx, "What pings you", "Needs you always reaches you. The rest waits quietly in Activity."),
      columns([
        card([
          table([{ label: "By bot", flex: 2 }, { label: "Needs you" }, { label: "Done pings", align: "right" }],
            ctx.live.bots.map((b) => {
              const sw = botSwitch(b.slug);
              return [
                row([botAvatar(b, 26), col([text(b.name, { size: 14 }), ...(botSub(b.slug) ? [meta(botSub(b.slug)!, { size: 11 })] : [])], { gap: 1, flexShrink: 1 })], { gap: 10 }),
                alwaysOn("Always"),
                box([switchMark(sw.path)], {}, sw.press),
              ];
            })),
        ], { padding: 0, gap: 0, style: { borderWidth: 0 } }),
        meta("A bot turned off still reaches you when it needs you.", { size: 12 }),
      ], [
        card([
          row([col([text("Done", { size: 15, weight: 600 }), meta("Quiet: no sound. Ping: with sound", { size: 12 })], { flexGrow: 1, gap: 2 }), doneSeg(130)], { gap: 12 }),
          divider(),
          row([col([text("Daily summary", { size: 15, weight: 600 }), row([meta("One note at", { size: 12 }), timeChip("sum", s.notify.summaryAt)], { gap: 8 })], { flexGrow: 1, gap: 6 }), box([switchMark("summary")], {}, summarySwitch())], { gap: 12 }),
          timePicker("sum", "summaryAt", "Summary time changed"),
          sectionLabel("Tonight's summary, as it will look"),
          summaryPreview(ctx, d),
          // "X0 is calling" (botsBots/planCall.ts): only while calls can come here, so the screen never promises one that won't.
          ...(d.calls ? [
            divider(),
            row([col([text("Calls", { size: 15, weight: 600 }), meta(callsLine(d), { size: 12 })], { flexGrow: 1, flexShrink: 1, gap: 2 }), box([switchMark("calls")], {}, callsSwitch())], { gap: 12 }),
            // When a call waits instead of ringing (docs: perms2): a Focus, and driving. Drawn only on a phone that can answer.
            ...holdRows(ctx, d, { desk: true }).flatMap((r) => [divider(), r]),
          ] : []),
        ], { padding: 20, gap: 14 }),
        // Must not miss (follow-through, botsBots/planFollow.ts): only while it is on here.
        ...(d.follow ? [card([
          text("Must not miss", { size: 15, weight: 600 }),
          ...followRows(d).flatMap((r, i) => [
            ...(i ? [divider()] : []),
            r.chips
              ? row([col([text(r.label, { size: 14 }), meta(r.sub, { size: 12 })], { flexGrow: 1, flexShrink: 1, gap: 2 }), r.chips], { gap: 12 })
              : row([col([text(r.label, { size: 14 }), meta(r.sub, { size: 12 })], { flexGrow: 1, flexShrink: 1, gap: 2 }), box([switchMark(r.path!)], {}, r.press)], { gap: 12 }),
            ...(r.open ? [row([text(r.openLabel ?? "Set up your number", { size: 13, lineHeight: 17 }), icon("chevron", { size: 14 })], { gap: 4 }, r.open)] : []),
          ]),
          ...(followFromRows(d).length ? [
            divider(),
            sectionLabel("People who can ring you louder"),
            ...followFromRows(d).map((p) => row([text(p.name, { size: 14, style: { flexGrow: 1 } }), button("Remove", p.remove, { kind: "quiet", size: "md" })], { gap: 12 })),
          ] : []),
        ], { padding: 20, gap: 12 })] : []),
        card([
          row([glyph(G.moon, 18), col([text("Quiet hours", { size: 15, weight: 600 }), meta("Every night", { size: 12 })], { flexGrow: 1, gap: 2 }), switchMark("quiet")], { gap: 12 }, quietSwitch()),
          quietTimes(s),
          quietBar,
          row([meta("12 am", { size: 11 }), grow(), meta("12 pm", { size: 11 }), grow(), meta("11 pm", { size: 11 })]),
          meta("Bots keep working. Done waits in Activity. Needs you still reaches you, without sound.", { size: 12, lineHeight: 17 }),
        ], { padding: 20, gap: 12 }),
      ], { rightWidth: 400 }),
    ],
  });
}
