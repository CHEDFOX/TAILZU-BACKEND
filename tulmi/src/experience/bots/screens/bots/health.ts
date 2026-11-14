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
import {
  box, button, canHealth, canHealthSleep, canMotion, col, grow, listRow, meta, row, seq, switchMark, text, when, C, type BotsCtx,
} from "../../kit.js";
import { line, permitStep } from "../firstRun/parts.js";
import { HEALTH, HEALTH_SOURCE, MOTION, SLEEP, healthLines, motionLines, sleepLines } from "../permitWords.js";
import { clock, dayLabel } from "../keybotParts.js";

const enc = encodeURIComponent;
const setState = (path: string, value: unknown): ActionSpec => ({ kind: "setState", path, value });
const toast = (message: string, error = false): ActionSpec => ({ kind: "toast", message, ...(error ? { tone: "error" as const } : {}) });
const refresh: ActionSpec = { kind: "refresh" };
const ANDROID: Condition = { platform: "android" };
const IOS: Condition = { not: ANDROID };

/** The state the row and its card need, to merge into the edit page's own. */
export const HEALTH_STATE = {
  healthCard: false, healthOn: false, healthBlocked: false, healthGone: false, healthEmpty: false,
  // Build 8.9.1 (docs: perms2 §5.1, §6.1): the Motion choice and its card, and the sleep sub-row and its card.
  motionCard: false, motionOn: false, motionBlocked: false, sleepCard: false, sleepOn: false,
};

/** What the bot's OWN page needs, for the quiet re-read's own answer. Merged in only while the switch is on. */
export const HEALTH_PAGE_STATE = { healthNotHere: false };

/** How many days the phone reads and sends. Kept here and in the table's own 31 (bots/healthDays.ts HEALTH_KEEP_DAYS). */
const DAYS = 31;

export interface HealthBot {
  slug: string; name: string; purpose: string; builtin: boolean;
  /** `healthSource` (0094) says which reader the days come from, so the row's words and the sleep sub-row follow it. */
  skills: { health?: boolean; healthSleep?: boolean; healthSource?: "health" | "motion" };
}

/** Is this bot counting from the iPhone's own Motion & Fitness rather than Apple Health / Health Connect (0094)? */
const fromMotion = (bot: HealthBot): boolean => bot.skills.healthSource === "motion";

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

/**
 * Does this bot get the row at all? A bot already counting keeps it, whatever it was renamed to and wherever it is read. From
 * 8.9.1 the Motion choice and the sleep sub-row count too: either can be the only thing drawn (Motion with the health switches
 * off, sleep with them on), and the group has to exist for them.
 */
export function hasHealthRow(ctx: BotsCtx, bot: HealthBot): boolean {
  return healthRows(ctx, bot).length > 0;
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
  // Build 8.9.1's two (docs: perms2): the Motion choice, drawn while health is off, and the sleep sub-row, drawn while it is on.
  // Either can be the only row there is, so they are not inside the `kind` branches.
  const more = [...motionRows(ctx, bot), ...sleepRows(ctx, bot)];
  if (!kind) return more;
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
  // COUNTING FROM MOTION & FITNESS (0094): one row, whose words name THAT reader. Apple Health is never mentioned, because
  // it is not where these numbers come from, and there is no card: the only thing left to do is stop.
  if (on && fromMotion(bot)) {
    // On Android the same bot counts steps and nothing else, so the row must not promise walks, runs and rides. The phone
    // that turned it on may not be the one reading, so this names what THIS reader's phone would count.
    const motionAndroid = ctx.platform === "android";
    // SWITCHING IT OFF DELETES THE PHONE'S OWN STEP LEDGER TOO (8.9.1), which is what the row promises. Android keeps a
    // ledger because its step counter is a since-boot total with no history, and `health.sync` with `source: "motion"` and
    // `enable: false` is the one thing that tells the phone to forget it; the iPhone keeps none and answers true. It goes
    // BEFORE the PUT, so the PUT's own deletion is still the last word if this phone posts a last read on its way out, and
    // `ask: false` means it can never be a way to a prompt.
    const forget: ActionSpec = {
      kind: "health.sync", ask: false, enable: false, source: "motion", days: DAYS,
      path: `/v1/bots/${enc(bot.slug)}/health/days`,
    } as unknown as ActionSpec;
    return [listRow({
      label: motionAndroid ? MOTION.rowOnAndroid : MOTION.rowOn, sub: motionAndroid ? MOTION.rowOnSubAndroid : MOTION.rowOnSub,
      chevron: false,
      right: switchMark("healthOn"), onPress: seq({ kind: "toggleState", path: "healthOn" } as ActionSpec, forget, off),
    }), ...more];
  }
  // STOP ONLY. No source is named (the phone that turned it on may not be the one reading), no card and no health.sync: the
  // one thing here is the PUT that switches it off and deletes the days.
  if (kind === "off") {
    return [listRow({
      label: HEALTH.rowOff, sub: HEALTH.rowSub, chevron: false,
      right: switchMark("healthOn"), onPress: seq({ kind: "toggleState", path: "healthOn" } as ActionSpec, off),
    }), ...more];
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
    ...more,
  ];
}

/**
 * "COUNT MY STEPS WITH MOTION & FITNESS INSTEAD" (docs: perms2 §5.1): for a person who does not want Apple Health, or has not
 * got it set up. Only a phone that declares Motion1 while its platform's switch is on (kit `canMotion`), only a fitness bot
 * they made, and only while health is OFF — one bot has one source at a time, and the server deletes the other source's days
 * when it changes.
 *
 * ON ANDROID IT IS THE PHONE'S OWN STEP COUNTER AND NO WORKOUTS AT ALL (8.9.1, behind PERM_MOTION_ANDROID). There is no
 * reliable workout source there, and a guessed ride on a streak is worse than none, so the row, the card's first line and
 * the Moves line all promise steps only. "Motion & Fitness" is iOS's name for the grant and never shows on Android, where
 * it is called Physical activity.
 *
 * The payload is the health one, exactly, with `source: "motion"`: the same route, the same 31 days, the same deletions, and
 * the same import line keeping it away from every AI service.
 */
export function motionRows(ctx: BotsCtx, bot: HealthBot): Node[] {
  if (!canMotion(ctx) || bot.builtin || bot.skills.health === true || !isFitnessBot(bot.name, bot.purpose)) return [];
  const android = ctx.platform === "android";
  const sync: ActionSpec = {
    kind: "health.sync", ask: true, enable: true, source: "motion", days: DAYS, path: `/v1/bots/${enc(bot.slug)}/health/days`,
    onSynced: seq(setState("motionCard", false), refresh),
    onEmpty: seq(setState("motionCard", false), refresh),
    onDenied: seq(setState("motionCard", false), toast(MOTION.denied.replace("{bot}", bot.name))),
    onBlocked: seq(setState("motionCard", false), setState("motionBlocked", true)),
    onUnavailable: seq(setState("motionCard", false), toast(android ? MOTION.unavailableAndroid : "This iPhone can't count steps.")),
    onError: seq(setState("motionCard", false), toast("Couldn't read that just now. Try again.", true)),
  } as unknown as ActionSpec;
  const words = motionLines(bot.name, android ? "android" : "ios");
  // THE WATCH, AND ITS OFF SWITCH (8.9.1). The driving check reads the same grant, so it is registered the moment the grant
  // lands and taken off the moment the steps go: on Android that is a real Play-services registration, on iPhone there is
  // nothing to register and the phone answers true. See `driveRows` for the switch of its own.
  return [
    listRow({
      label: android ? MOTION.rowAndroid : MOTION.row, sub: android ? MOTION.rowSubAndroid : MOTION.phoneOnly,
      chevron: false, right: switchMark("motionOn"), onPress: setState("motionCard", true),
    }),
    permitStep({ when: { truthy: "motionCard" }, title: words.title, lines: words.lines.map((l) => line(l)), cta: { label: MOTION.cta, onPress: sync } }),
    when({ truthy: "motionBlocked" }, col([
      meta(android ? MOTION.blockedAndroid : MOTION.blocked, { size: 12 }),
      button(MOTION.openSettings, { kind: "openSettings", target: "app" } as ActionSpec, { kind: "secondary", size: "md" }),
    ], { gap: 6, paddingHorizontal: 16, paddingVertical: 10 })),
  ];
}

/**
 * "ALSO COUNT MY SLEEP" (docs: perms2 §6.1): a sub-row of the health switch, drawn only while that one is already ON, and only
 * where the sleep capability and this platform's own sleep switch are on too (kit canHealthSleep).
 *
 * The sleep type is asked for in a REQUEST OF ITS OWN (`sleep: true`), so the steps-and-workouts grant is not shown again and a
 * refusal of sleep leaves the steps counting. Switching it off nulls the nights in the same request; the steps stay.
 */
export function sleepRows(ctx: BotsCtx, bot: HealthBot): Node[] {
  if (bot.skills.health !== true || !canHealthSleep(ctx)) return [];
  // Motion & Fitness counts steps and movement, never sleep (0094): a bot counting from it is not offered the row at all,
  // and the route refuses `sleep: true` for one, so the card could never be a way in either.
  if (fromMotion(bot)) return [];
  const on = bot.skills.healthSleep === true;
  const off: ActionRef = {
    kind: "callEndpoint", method: "PUT", path: `/v1/bots/${enc(bot.slug)}`, body: { skills: { healthSleep: false } },
    onSuccess: seq(toast(SLEEP.off), refresh),
    onError: toast("Couldn't switch that off. Try again.", true),
  } as unknown as ActionSpec;
  const sync: ActionSpec = {
    kind: "health.sync", ask: true, sleep: true, days: DAYS, path: `/v1/bots/${enc(bot.slug)}/health/days`,
    onSynced: seq(setState("sleepCard", false), refresh),
    onEmpty: seq(setState("sleepCard", false), refresh),
    onDenied: seq(setState("sleepCard", false), toast(SLEEP.denied.replace("{source}", HEALTH_SOURCE[ctx.platform === "android" ? "android" : "ios"]))),
    onBlocked: seq(setState("sleepCard", false), setState("healthBlocked", true)),
    onUnavailable: seq(setState("sleepCard", false), setState("healthGone", true)),
    onError: seq(setState("sleepCard", false), toast("Couldn't read that just now. Try again.", true)),
  } as unknown as ActionSpec;
  const change: ActionRef = on
    ? seq({ kind: "toggleState", path: "sleepOn" } as ActionSpec, off)
    : setState("sleepCard", true);
  const ios = sleepLines(bot.name, "ios"), android = sleepLines(bot.name, "android");
  return [
    listRow({ label: SLEEP.row, sub: SLEEP.rowSub, chevron: false, right: switchMark("sleepOn"), onPress: change }),
    permitStep({
      when: { truthy: "sleepCard" }, title: ios.title,
      // Only the line that names the source differs, so iOS and Android are sent one tree with two `visibleIf` lines in it.
      lines: [when(IOS, line(ios.lines[0]!)), when(ANDROID, line(android.lines[0]!)), ...ios.lines.slice(1).map((l) => line(l))],
      cta: { label: SLEEP.cta, onPress: sync },
    }),
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
  if (bot.skills.health !== true) return [];
  const motion = fromMotion(bot);
  // The switch the row itself is drawn behind, for THIS bot's reader: a Motion bot is behind PERM_MOTION, so a quiet re-read
  // is never asked of a phone whose Motion row the server has since switched off.
  if (!(motion ? canMotion(ctx) : canHealth(ctx))) return [];
  const sync: ActionSpec = {
    kind: "health.sync", ask: false, days: DAYS, path: `/v1/bots/${enc(bot.slug)}/health/days`,
    // WHICH READER TO RE-READ (0094). Without it the phone read Apple Health for a Motion bot, so the Motion days never
    // refreshed — and if Apple Health had anything, it posted source "health" and the Motion days were deleted as the
    // other source's.
    source: motion ? "motion" : "health",
    // AND THE NIGHTS, for a bot that counts them. The server strips `sleepMinutes` from any POST that did not ask for the
    // sleep type, so without this only the first sleep POST ever stored a night and "Slept X last night" froze. `ask: false`
    // never prompts, so the card rule still holds.
    ...(!motion && bot.skills.healthSleep === true && canHealthSleep(ctx) ? { sleep: true } : {}),
    onSynced: seq(setState("healthNotHere", false), refresh),
    // Nothing came back, which on iPhone is also what a refusal looks like. The Moves line already says so; a refresh here
    // would only be a second read of the same nothing.
    onEmpty: setState("healthNotHere", false),
    onDenied: setState("healthNotHere", true),
  } as unknown as ActionSpec;
  return [{ ...box([], { height: 0 }), on: { onAppear: sync } }];
}

/** "Slept 7 h 10 min last night", and the average when there is more than one night. Nothing finer than a night, ever. */
function sleepWords(m: Moves): string[] {
  if (m.sleepLast === null) return [];
  const words = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}` : `${min} min`);
  return [
    `slept ${words(m.sleepLast)} last night`,
    ...(m.sleepNights > 1 && m.sleepAvg !== null ? [`${words(m.sleepAvg)} a night`] : []),
  ];
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
  // AN ANDROID BOT COUNTING FROM THE STEP COUNTER HAS NO WORKOUTS AT ALL (8.9.1): the phone sends none, so "0 workouts this
  // month" would be a count of something nobody measured. The line says steps and nothing else, and where to look when
  // there are none is the phone's own permission page, not Health Connect.
  const steppedOnly = fromMotion(bot) && ctx.platform === "android";
  if (!moves.workouts && !moves.steps) {
    // Where to look is the phone's own place, and the two phones have different ones. Both lines go in the same bytes, as
    // the row itself does, so iOS and Android are sent one tree.
    const empty = (where: Condition, words: string): Node => when(where, row([
      text("Moves", { size: 13, weight: 600, lineHeight: 18 }),
      meta(words, { size: 12, style: { flexShrink: 1 } }),
    ], { gap: 8, alignItems: "center", paddingVertical: 10, paddingHorizontal: 16 }));
    if (steppedOnly) return [empty(ANDROID, MOTION.emptyAndroid), ...notHereLine()];
    return [empty(IOS, HEALTH.emptyIos), empty(ANDROID, HEALTH.emptyAndroid), ...notHereLine()];
  }
  const bits = [
    ...(steppedOnly ? [] : [workoutWords(moves)]),
    // The nights, only for a bot that counts them: "Slept 7 h 10 min last night · 6 h 50 min a night this week".
    ...(bot.skills.healthSleep === true ? sleepWords(moves) : []),
    ...(moves.lastDay && !steppedOnly ? [`${lastWords(ctx, moves.lastDay)}, ${moves.lastMinutes} min`] : []),
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
