/**
 * THE FITNESS BOT'S "COUNT MY WORKOUTS" ROW, ITS CARD, AND THE MOVES LINE ON ITS PAGE (docs: perms §4).
 *
 * The row is drawn only on a store build's phone that declares Health1, only for a bot THE PERSON MADE whose name or purpose
 * says it is about fitness (`isFitnessBot`), and only while the switch for that phone is on (`canHealth`). The window never
 * gets it, and neither does an older binary, which declares no Health1.
 *
 * Switching it on opens one card — Continue and nothing else (5.1.1(iv)) — and Continue is the only thing that reaches the
 * phone's own Health sheet. The numbers go from the phone straight to `POST /v1/bots/:slug/health/days`; none of them ever
 * lands in `$state`, so nothing of a person's health is in the screen tree, in what the phone keeps, or in a render.
 *
 * Switching it off is the plain `PUT /v1/bots/:slug { skills: { health: false } }`, which deletes the days in the same
 * request. The row's own words promise that.
 *
 * Once health is on, the row is drawn whatever the bot is renamed to, so it can always be switched off.
 */
import type { ActionRef, ActionSpec, Condition, Node } from "../../../../../../shared/types/sdui.js";
import type { Moves } from "../../../../bots/healthDays.js";
import { isFitnessBot } from "../../../../bots/door.js";
import { box, button, canHealth, col, grow, listRow, meta, row, seq, switchMark, text, when, C, type BotsCtx } from "../../kit.js";
import { line, permitStep } from "../firstRun/parts.js";
import { HEALTH, HEALTH_SOURCE, healthLines } from "../permitWords.js";
import { clock, dayLabel } from "../keybotParts.js";

const enc = encodeURIComponent;
const setState = (path: string, value: unknown): ActionSpec => ({ kind: "setState", path, value });
const toast = (message: string, error = false): ActionSpec => ({ kind: "toast", message, ...(error ? { tone: "error" as const } : {}) });
const refresh: ActionSpec = { kind: "refresh" };
const ANDROID: Condition = { platform: "android" };
const IOS: Condition = { not: ANDROID };

/** The state the row and its card need, to merge into the edit page's own. */
export const HEALTH_STATE = { healthCard: false, healthOn: false, healthBlocked: false, healthGone: false, healthEmpty: false };

/** What the bot's OWN page needs, for the quiet re-read's own answer. Merged in only while the switch is on. */
export const HEALTH_PAGE_STATE = { healthNotHere: false };

/** How many days the phone reads and sends. Kept here and in the table's own 31 (bots/healthDays.ts HEALTH_KEEP_DAYS). */
const DAYS = 31;

export interface HealthBot { slug: string; name: string; purpose: string; builtin: boolean; skills: { health?: boolean } }

/**
 * Does this bot get the row at all, and which row?
 *
 *   "on"   the full switch: a phone with Health1 whose platform switch is on, for a fitness bot the person made. This is the
 *          only row that can turn health ON, so it is the only one behind `canHealth`.
 *   "off"  a bot that is ALREADY counting. The way to stop is drawn on every client and whatever the switches say, because
 *          the policy promises it ("You can also turn the switch off at any time, from the bot's edit page", privacy 1.5.1)
 *          and because the switch can go off under a person's feet: Google refuses the form, their account leaves the list,
 *          or they are reading on the window. A row that only stops can never be a dark declaration.
 */
export function healthRowKind(ctx: BotsCtx, bot: HealthBot): "on" | "off" | null {
  if (bot.builtin) return null;
  if (canHealth(ctx) && isFitnessBot(bot.name, bot.purpose)) return "on";
  if (canHealth(ctx) && bot.skills.health === true) return "on";
  return bot.skills.health === true ? "off" : null;
}

/** Does this bot get the row at all? A bot already counting keeps it, whatever it was renamed to and wherever it is read. */
export function hasHealthRow(ctx: BotsCtx, bot: HealthBot): boolean {
  return healthRowKind(ctx, bot) !== null;
}

/**
 * The card's words, both ways, in the same bytes: `healthLines()` writes each platform's version, and only the line that
 * names the source differs, so iOS and Android are sent one tree with two `visibleIf` lines in it.
 */
function cardWords(bot: string): { title: string; lines: Node[] } {
  const ios = healthLines(bot, "ios"), android = healthLines(bot, "android");
  return {
    title: ios.title,
    lines: [when(IOS, line(ios.lines[0]!)), when(ANDROID, line(android.lines[0]!)), ...ios.lines.slice(1).map((l) => line(l))],
  };
}

/**
 * The switch row and, under it, the card. Returned as rows for the edit page's "Tools and apps" list; an empty list for every
 * bot and every build that does not get it.
 */
export function healthRows(ctx: BotsCtx, bot: HealthBot): Node[] {
  const kind = healthRowKind(ctx, bot);
  if (!kind) return [];
  const on = bot.skills.health === true;
  const off: ActionRef = {
    kind: "callEndpoint", method: "PUT", path: `/v1/bots/${enc(bot.slug)}`, body: { skills: { health: false } },
    onSuccess: seq(toast("Off. What it counted is deleted."), refresh),
    onError: toast("Couldn't switch that off. Try again.", true),
  } as unknown as ActionSpec;
  /**
   * On -> off at once, and the switch moves with the tap. Off -> the card opens and the switch DOES NOT move: nothing is on
   * until the phone's own sheet has been answered and the first days are stored, and a switch that said "on" while the person
   * was still reading the card, or after they refused, would be a lie. `onSynced` refreshes the page, which draws it on.
   */
  const change: ActionRef = on
    ? seq({ kind: "toggleState", path: "healthOn" } as ActionSpec, off)
    : setState("healthCard", true);
  const sync: ActionSpec = {
    kind: "health.sync", ask: true, enable: true, days: DAYS, path: `/v1/bots/${enc(bot.slug)}/health/days`,
    onSynced: seq(setState("healthCard", false), refresh),
    onEmpty: seq(setState("healthCard", false), refresh),
    onDenied: seq(setState("healthCard", false), toast(HEALTH.deniedAndroid.replace("{bot}", bot.name))),
    onBlocked: seq(setState("healthCard", false), setState("healthBlocked", true)),
    onUnavailable: seq(setState("healthCard", false), setState("healthGone", true)),
    onError: seq(setState("healthCard", false), toast("Couldn't read that just now. Try again.", true)),
  } as unknown as ActionSpec;

  const label = (where: "ios" | "android") => HEALTH.row.replace("{source}", HEALTH_SOURCE[where]);
  // The row itself is drawn twice, once per platform, and each is shown only on its own: the label names the source the
  // person's phone really has, and both phones are sent the same bytes.
  const switchRowFor = (where: "ios" | "android"): Node => listRow({
    label: label(where), sub: HEALTH.rowSub, chevron: false,
    right: switchMark("healthOn"), onPress: change,
  });
  // STOP ONLY. No source is named (the phone that turned it on may not be the one reading), no card and no health.sync: the
  // one thing here is the PUT that switches it off and deletes the days.
  if (kind === "off") {
    return [listRow({
      label: HEALTH.rowOff, sub: HEALTH.rowSub, chevron: false,
      right: switchMark("healthOn"), onPress: seq({ kind: "toggleState", path: "healthOn" } as ActionSpec, off),
    })];
  }
  return [
    when(IOS, switchRowFor("ios")),
    when(ANDROID, switchRowFor("android")),
    permitStep({
      when: { truthy: "healthCard" },
      ...cardWords(bot.name),
      cta: { label: HEALTH.cta, onPress: sync },
    }),
    // Refused twice on Android: the system will not ask again, so Health Connect's OWN permissions page is the only thing
    // left to offer. `openSettings` with this target opens it, and falls back to the app's settings on a phone without it.
    when({ truthy: "healthBlocked" }, col([
      meta(HEALTH.blockedAndroid, { size: 12 }),
      button(HEALTH.openHealthConnect, { kind: "openSettings", target: "healthConnect" } as ActionSpec, { kind: "secondary", size: "md" }),
    ], { gap: 6, paddingHorizontal: 16, paddingVertical: 10 })),
    // No Health Connect on this phone at all, or it needs an update.
    when({ truthy: "healthGone" }, col([
      meta(HEALTH.unavailable, { size: 12 }),
      button(HEALTH.getHealthConnect, { kind: "openUrl", url: HEALTH.healthConnectUrl, external: true } as ActionSpec, { kind: "secondary", size: "md" }),
    ], { gap: 6, paddingHorizontal: 16, paddingVertical: 10 })),
  ];
}

/**
 * THE QUIET RE-READ, on the bot's own page: with `ask: false` it NEVER prompts, so this cannot be a way round the card. If
 * the person has turned the permission off since, it comes back denied and the row says health is off.
 *
 * There is no background delivery, so this is the only thing that keeps the numbers current, and the Moves line says when
 * they are from. The phone throttles it to once an hour; the server asks for it once per appearance.
 *
 * It is behind `canHealth` like the switch itself. Without that, a phone whose platform switch (or account list) has since
 * gone off would still read Apple Health or Health Connect on every visit and post days the route then refuses with 403 —
 * health data leaving the phone for a feature the server has switched off, over and over.
 *
 * `onDenied` matters as much as `onSynced`: on a new phone, after a reinstall, or when a Health Connect grant is taken back,
 * `ask: false` comes back denied, and without this the page would quietly stop counting while the row still said on.
 */
export function healthRefresh(ctx: BotsCtx, bot: HealthBot): Node[] {
  if (bot.skills.health !== true || !canHealth(ctx)) return [];
  const sync: ActionSpec = {
    kind: "health.sync", ask: false, days: DAYS, path: `/v1/bots/${enc(bot.slug)}/health/days`,
    onSynced: seq(setState("healthNotHere", false), refresh),
    // Nothing came back, which on iPhone is also what a refusal looks like. The Moves line already says so; a refresh here
    // would only be a second read of the same nothing.
    onEmpty: setState("healthNotHere", false),
    onDenied: setState("healthNotHere", true),
  } as unknown as ActionSpec;
  return [{ ...box([], { height: 0 }), on: { onAppear: sync } }];
}

/** "9 workouts this month" / "no workouts yet". */
const workoutWords = (m: Moves): string => (m.workouts === 1 ? "1 workout this month" : `${m.workouts} workouts this month`);

/**
 * A day as it reads inside a sentence: "today", "yesterday", "Tue 10 Nov". `dayLabel` writes Today and Yesterday for a row
 * of their own, and "last Today" is not English.
 */
const dayWords = (ctx: BotsCtx, at: number): string => {
  const day = dayLabel(ctx, at);
  return day === "Today" || day === "Yesterday" ? day.toLowerCase() : day;
};

/** When the numbers last came in, in the person's own clock: "today 9:40 am", "Tue 10 Nov 7:15 pm". */
const asOfWords = (ctx: BotsCtx, at: number): string => `${dayWords(ctx, at)} ${clock(ctx, at)}`;

/**
 * THE MOVES LINE on a fitness bot's own page: "Moves · 9 workouts this month · last Tuesday, 48 min · as of today 9:40".
 *
 * "As of" is the last time the numbers came in, not now: there is no background delivery, so they are as of the last time the
 * person opened this bot, and saying "today 9:40" is the honest version of that.
 *
 * With the switch on and nothing counted, the line says so rather than show a zero: Apple Health never reports a refused
 * read, so a silent zero would look like a streak the person had not got.
 */
export function movesLine(ctx: BotsCtx, bot: HealthBot, moves: Moves | undefined): Node[] {
  if (bot.skills.health !== true || !moves) return [];
  if (!moves.workouts && !moves.steps) {
    // Where to look is the phone's own place, and the two phones have different ones. Both lines go in the same bytes, as
    // the row itself does, so iOS and Android are sent one tree.
    const empty = (where: Condition, words: string): Node => when(where, row([
      text("Moves", { size: 13, weight: 600, lineHeight: 18 }),
      meta(words, { size: 12, style: { flexShrink: 1 } }),
    ], { gap: 8, alignItems: "center", paddingVertical: 10, paddingHorizontal: 16 }));
    return [empty(IOS, HEALTH.emptyIos), empty(ANDROID, HEALTH.emptyAndroid), ...notHereLine()];
  }
  const bits = [
    workoutWords(moves),
    ...(moves.lastDay ? [`${lastWords(ctx, moves.lastDay)}, ${moves.lastMinutes} min`] : []),
    ...(moves.stepDays ? [`${Math.round(moves.steps / moves.stepDays).toLocaleString("en-IN")} steps a day`] : []),
    // The day AND the time: "as of today 9:40 am". Without background delivery this is the whole honesty of the line, and a
    // bare day would read as if the numbers were fresh all day.
    ...(moves.asOf ? [`as of ${asOfWords(ctx, moves.asOf)}`] : []),
  ];
  return [
    row([
      text("Moves", { size: 13, weight: 600, lineHeight: 18 }),
      meta(bits.join(" · "), { size: 12, style: { flexShrink: 1 } }),
      grow(),
    ], { gap: 8, alignItems: "center", paddingVertical: 10, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: C.divider }),
    ...notHereLine(),
  ];
}

/**
 * The last workout, inside the sentence: "yesterday" and "today" read oddly after "last", so they lose it.
 *
 * The day comes as the PHONE'S OWN day key, which is already the person's local day. Putting it back on the clock means
 * undoing the offset `dayLabel` will add, so the words name that very day at any offset, +14 and -12 alike.
 */
const lastWords = (ctx: BotsCtx, day: string): string => {
  const at = Date.parse(`${day}T12:00:00Z`) - ctx.tzOffsetMinutes * 60_000;
  const words = Number.isFinite(at) ? dayWords(ctx, at) : day;
  return words === "today" || words === "yesterday" ? words : `last ${words}`;
};

/**
 * Under the Moves line, and only once the quiet re-read has come back denied (`healthNotHere`): the counting has stopped on
 * this phone although the switch is still on, so the line says that and where to start it again.
 */
const notHereLine = (): Node[] => [
  when({ truthy: "healthNotHere" }, row([
    meta(HEALTH.notHere, { size: 12, style: { flexShrink: 1 } }),
  ], { gap: 8, alignItems: "center", paddingBottom: 10, paddingHorizontal: 16 })),
];
