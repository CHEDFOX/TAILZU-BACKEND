/**
 * The You area's notifyDesk screen.
 */

import type { ActionRef, ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import {
  call, seq, row, icon, C, meta, box, text, whenEq, type IconName, labelled, when, col, grow, button, type BotsCtx, botAvatar, page, card,
  table, switchMark, divider, sectionLabel,
} from "../../kit.js";
import { type Settings, toast, refresh, oops, clock, botOf, heading, couldNot, columns, glyph, G } from "./parts.js";

/** `name`: the name Plan Ease calls as ("Zara", else "X0"); `calls`: calls can come here (BOT_CALLS), so the Calls row is drawn. */
export interface NotifyData { settings: Settings; today: { done: number; needs: number; spentPaise: number } | null; line: string | null; name?: string; calls?: boolean }

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
  ...clockState("sum", s.notify.summaryAt), ...clockState("qf", s.notify.quietFrom), ...clockState("qt", s.notify.quietTo),
  ...Object.fromEntries(ctx.live.bots.map((b) => [`bot_${b.slug.replace(/-/g, "_")}`, !s.notify.botsOff.includes(b.slug)])),
});
export const doneSeg = (width?: number) => segments([{ label: "Quiet", value: "quiet" }, { label: "Ping", value: "ping" }], "done",
  (v) => save({ notify: { done: v } }, v === "ping" ? "Done pings you" : "Done comes without a sound"), width);
export const summarySwitch = () => seq({ kind: "toggleState", path: "summary" }, when2("summary", save({ notify: { summary: true } }, "Daily summary on"), save({ notify: { summary: false } }, "Daily summary off")));
/** Calls on or off, saved (after the switch has flipped `calls`): the phone's switchRow flips it first, the window's box with callsSwitch. */
export const callsSave = (): ActionRef => when2("calls", save({ notify: { calls: true } }, "Calls on"), save({ notify: { calls: false } }, "Calls off"));
export const callsSwitch = () => seq({ kind: "toggleState", path: "calls" }, callsSave());
/** What the Calls row says: "Zara calls you when it's time to leave or a bill is due today". */
export const callsLine = (d: NotifyData): string => `${d.name || "X0"} calls you when it's time to leave or a bill is due today`;
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
          ] : []),
        ], { padding: 20, gap: 14 }),
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
