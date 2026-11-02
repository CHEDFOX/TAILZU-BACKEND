/**
 * Stats: what the person wrote, and how.
 */

import { type ScreenResponse, type Node, SDUI_SCHEMA_VERSION } from "../../../../shared/types/sdui.js";
import { LANGUAGE_NAMES as WRITTEN_NAMES } from "../../history/writtenIn.js";
import { DESK_ROOMS } from "../deskSamples.js";
import { applyPresetOverrides, TONE_LABELS } from "../personalityPresets.js";
import { t, statsDays, monthFigures, span, label, caption, PHONE_LOOK, STATS_TOP, phoneStatsBody, PHONE_ROOMS } from "../phoneLook.js";
import { freeForAll } from "../policy.js";
import type { ScreenContext } from "../screens.js";
import {
  line, part, shareSlices, tiles, said, dayCurve, kindSlices, pie, curvePaths, DAY_ASPECT, boundTiles, boundCurve, HOUR_LABELS, boundLine,
  curve, columns, meters, SHARE_INKS, axis, TYPED_INK,
} from "../statsCharts.js";
import { readable } from "./layout.js";
import { ACCENT_AMBER, CHART_ON_DARK } from "./palette.js";
import { settingsGear } from "./parts.js";
import { languageSlices, voiceSlices, type Slice, pieNode, dictionarySlices } from "./pie.js";

/**
 * TWO COLOURS, AND THAT IS THE WHOLE DESIGN RULE.
 *
 * The brand amber is the ground and near-black is the ink — the inverse of
 * every other screen, which is what makes this tab read as its own place
 * rather than Home with charts on it. Nothing else appears: no greys, no
 * second accent, no semantic red or green.
 *
 * That constraint is most of the work in the charts. Normally hue separates
 * one series from another; with one hue, WEIGHT and OPACITY have to do it —
 * bars sit at 45% with the peak at full, the streak grid uses three steps of
 * opacity, and rows separate on a 13%-alpha rule rather than a border colour.
 * It holds, but it means no chart here can encode two series by colour: a card
 * that needs that needs two charts.
 */
export const STATS_UI = {
  /**
   * A WARM NEAR-BLACK, not bone.
   *
   * The app is a dark object with one warm light in it. Train is black art;
   * You is black with the voice's art blurred behind it. A bone Stats was a
   * second visual world, and every tab switch was a change of mode — and a
   * colour cannot be sacred if the ground under it changes temperature. On
   * dark, the figures are lights; on bone they were ink. Lights are what a
   * record of your own output should feel like, and lights are what the
   * amber already is. One material system.
   *
   * Biased toward the accent's hue rather than a neutral black, so the amber
   * sits IN the ground rather than ON it; a shade above the You tab's black,
   * so Stats has its own air without being a different room.
   */
  ground: "#0F0D0B",
  /** A card is a step up from the ground, not a hole punched in it. */
  card: "#1A1714",
  /** The reading colour — the app's pale, which is the amber's own family. */
  ink: "#F3E2C6",
  inkDim: "rgba(243,226,198,0.58)",
  inkFaint: "rgba(243,226,198,0.38)",
  onCard: "#F3E2C6",
  onCardDim: "rgba(243,226,198,0.55)",
  onCardFaint: "rgba(243,226,198,0.36)",
  /**
   * AMBER MARKS WHAT IS STILL IN PLAY.
   *
   * Not "one per screen", which is a quota and not a meaning — a rule about
   * how MUCH of a colour there is says nothing about what it is for. This one
   * says what it is for, and the discipline follows from it: almost everything
   * on Stats is a settled fact about a month that has already happened, and a
   * settled fact is read, not acted on. Three things are not settled — the
   * allowance, which depletes while you use it; the streak, which is running
   * right now and breaks tomorrow if you stop; and today, which is not over.
   *
   * Of those, amber goes only to what is LIVE: the running streak — its
   * figure, and today's square in the month while the run holds. The eye
   * picks it out without being told. A dead streak goes pale (and today's
   * square with it), which is the colour doing real work: whether it is
   * amber IS whether it is alive.
   */
  accent: ACCENT_AMBER,
  rule: "rgba(243,226,198,0.10)",
  barRest: 0.45,
  cardRadius: 13,
  gap: 9,
  padding: 16,
};

export function statsScreen(ctx: ScreenContext): ScreenResponse {
  const u = STATS_UI;
  const usage = ctx.usage ?? {
    month: { words: 0, audioSeconds: 0, requests: 0 },
    total: { words: 0, audioSeconds: 0, requests: 0 },
  };
  const st = ctx.stats;

  const wordsMonth = st?.wordsOut ?? usage.month.words;
  const sessions = st?.requests ?? usage.month.requests;
  const minutesSaved = st?.minutesSaved ?? Math.max(0, Math.round(usage.total.words / 40));
  const perDay = st?.wordsPerDay ?? st?.sparklinePerDay ?? [];
  const days = perDay.length || 30;
  const daysActive = st?.daysActive ?? perDay.filter((d) => d > 0).length;
  const streak = st?.currentStreak ?? 0;
  /**
   * Is the streak actually running? A streak only counts while it is unbroken
   * to TODAY — a number left over from a week you stopped is a record, not a
   * streak, and colouring it as live would be the colour lying. The last day
   * in the series is today; if nothing was written on it the run is already
   * over and the tile goes pale.
   */
  const wroteToday = (perDay[perDay.length - 1] ?? 0) > 0;
  const streakLive = streak > 0 && wroteToday;
  const avgPerSession = st?.avgWordsPerSession ?? (sessions ? Math.round(wordsMonth / sessions) : 0);
  const n = (v: number) => v.toLocaleString("en-US");
  /**
   * THE ALLOWANCE, which went missing when this screen was rebuilt.
   *
   * It is the only number here that decides whether the app keeps working, and
   * the only one that goes UP on its own — so it belongs above the pretty ones
   * rather than in a panel behind them. Absent for a signed-out or unreadable
   * user, and then the meter is not drawn at all rather than drawn with zeros,
   * which would read as "you have nothing left".
   */
  const allow = ctx.allowance;
  /**
   * A subscriber has no word limit, so "words left" is not a number they
   * have. Their meter is the month itself: what they have dictated, against a
   * span no month reaches, so the line fills very slowly and never runs out.
   * Nothing about earning appears either — there is nothing to earn.
   */
  const paid = !!ctx.entitlement || freeForAll();
  const PAID_METER_SPAN = 120_000;
  const paidPct = allow ? Math.min(100, (Math.max(0, allow.used) / PAID_METER_SPAN) * 100) : 0;
  const spokenMinutes = st?.speakingMinutes
    ?? Math.round((usage.month.audioSeconds / 60) * 10) / 10;
  /** All time, not this month — the only place the running total is shown. */
  const lifetime = usage.total;
  /** Nothing has been written yet. Zeros in a grid read as a broken screen. */
  const empty = sessions === 0 && wordsMonth === 0;

  /** Split a per-day series into equal buckets — weeks, usually. */
  const bucket = (src: number[], count: number): number[] => {
    if (!src.length) return new Array(count).fill(0);
    const size = Math.ceil(src.length / count);
    return Array.from({ length: count }, (_, i) =>
      src.slice(i * size, (i + 1) * size).reduce((a, b) => a + b, 0));
  };

  /**
   * Bars, drawn from Stacks rather than a chart component — because the chart
   * components colour their own series and this screen may not have a second
   * colour. Height is the value; the tallest bar is the only one at full
   * strength, which is how a peak reads without a label on it.
   */
  const bars = (values: number[], labels: string[], height = 88): Node => {
    const max = Math.max(1, ...values);
    return {
      type: "Stack",
      children: [
        {
          type: "Stack",
          style: { flexDirection: "row", alignItems: "flex-end", gap: 5, height },
          children: values.map((v) => ({
            type: "Stack",
            style: {
              flex: 1,
              height: Math.max(3, Math.round((v / max) * height)),
              backgroundColor: u.onCard,
              opacity: v === max ? 1 : u.barRest,
              borderTopLeftRadius: 3, borderTopRightRadius: 3,
            },
          })),
        },
        {
          type: "Stack",
          style: { flexDirection: "row", gap: 5, marginTop: 6 },
          children: labels.map((l) => ({
            type: "Text", props: { content: l },
            style: { flex: 1, textAlign: "center", fontSize: 7.5, color: u.onCardFaint },
          })),
        },
      ],
    };
  };

  /** A month of days as a grid, three opacity steps: none, some, a lot. */
  const dotGrid = (values: number[]): Node => {
    const max = Math.max(1, ...values);
    const today = values.length - 1;
    // Today is the one square in the month that is not finished, and it is
    // at full strength whether or not anything has been written on it yet,
    // because an empty today is an invitation and an empty Tuesday three
    // weeks ago is not. It is amber ONLY while the streak is live (the same
    // test as the Day streak figure); otherwise it is drawn in the card's own
    // ink, ringed so it still reads as today — filled once written on.
    const todayLook = streakLive
      ? { backgroundColor: u.accent }
      : { backgroundColor: (values[today] ?? 0) > 0 ? u.onCard : "transparent", borderWidth: 1.5, borderColor: u.onCard };
    return {
      type: "Stack",
      style: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
      children: values.map((v, i) => ({
        type: "Stack",
        style: {
          width: "12%", aspectRatio: 1, borderRadius: 4,
          ...(i === today ? todayLook : { backgroundColor: u.onCard }),
          opacity: i === today ? 1 : v === 0 ? 0.16 : v > max * 0.5 ? 1 : 0.5,
        },
      })),
    };
  };

  // One line and one sub-heading for every card, in the page's own faces.
  const row = (name: string, value: string): Node => line(name, value);
  const secLab = (name: string): Node => part(name);

  /**
   * The three field breakdowns, read once so the tile and the panel behind it
   * can never disagree about their own number.
   */
  const langRows = languageSlices(st, CHART_ON_DARK).map((sl) => ({ label: sl.label, words: sl.value }));
  const voiceRows = voiceSlices(st, ctx.personality, CHART_ON_DARK).map((sl) => ({ label: sl.label, words: sl.value }));
  const dictShare = st?.dictionary && st.dictionary.saved > 0
    ? `${Math.round((st.dictionary.used / st.dictionary.saved) * 100)}%`
    : "—";
  const topVoiceShare = (() => {
    const total = voiceRows.reduce((sum, v) => sum + v.words, 0);
    if (!total || !voiceRows.length) return "—";
    return `${Math.round((voiceRows[0]!.words / total) * 100)}%`;
  })();

  /**
   * A ring inside a panel — big, with its legend, on the black card.
   *
   * Centred rather than inline: the panel is a column of rows, and a chart
   * squeezed beside text in a column reads as an afterthought. Here it is the
   * first thing, at the size the legend needs to sit under it.
   */
  const ring = (slices: Slice[], centerValue: string, centerLabel: string, empty: string): Node =>
    pieNode({
      slices,
      size: 148,
      thickness: 22,
      legend: true,
      legendColor: u.onCard,
      ...(centerValue && centerValue !== "—" ? { centerValue, centerLabel } : {}),
      emptyLabel: empty,
      style: { alignSelf: "center", marginTop: 4, marginBottom: 8, width: "100%" },
    });

  /**
   * One card's worth of detail: what it is, its number, a way out, and
   * everything behind the number, scrolling inside itself.
   */
  const panel = (id: string, title: string | Node, value: string | Node, unit: string, inner: Node[], footer?: Node): Node => ({
    type: "Stack",
    visibleIf: { eq: ["openCard", id] },
    style: { flex: 1 },
    children: [
      {
        type: "Stack",
        style: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
        children: [
          {
            type: "Stack",
            style: { flex: 1 },
            children: [
              typeof title === "string" ? t(title, "uiBold", 12, { letterSpacing: 1.4, textTransform: "uppercase", color: u.onCardDim }) : title,
              typeof value === "string"
                ? t(unit ? `${value} ${unit}` : value, "writtenLight", 30, { letterSpacing: -0.8, marginTop: 6 })
                : value,
            ],
          },
          {
            type: "Stack",
            on: { onPress: "closeCard" },
            props: { hitSlop: 10 },
            style: {
              width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: u.rule,
              alignItems: "center", justifyContent: "center",
            },
            children: [{
              type: "SVG",
              props: { viewBox: "0 0 24 24", d: "M6 6 L18 18 M18 6 L6 18",
                       fill: "none", stroke: u.onCard, strokeWidth: 2.4 },
              style: { width: 11, height: 11 },
            }],
          },
        ],
      },
      // The detail scrolls inside the card, all of it: the card is a fixed
      // height and this is the part that takes the rest.
      { type: "Screen", props: { paddingBottom: 28 }, style: { backgroundColor: "transparent", paddingHorizontal: 0, paddingTop: 4 },
        children: inner },
      ...(footer ? [footer] : []),
    ],
  });
  /** A card's way on to the screen where its list is edited. Stays in view. */
  const editButton = (text: string, screenId: string): Node => ({
    type: "Button",
    props: {
      label: text, variant: "primary",
      labelColor: u.card, fontSize: 13, fontWeight: "600", tracking: 0.4,
      paddingVertical: 0, paddingHorizontal: 22, radius: 12,
    },
    on: { onPress: { kind: "sequence", actions: [
      { kind: "haptic", style: "selection" },
      { kind: "clearState", path: "openCard" },
      { kind: "navigate", screenId },
    ] } },
    style: { backgroundColor: u.onCard, height: 46, marginTop: 12 },
  });

  const weeks = bucket(perDay, 4);
  const weekSessions = bucket(st?.sparklinePerDay ?? [], 4);
  const WEEK_NAMES = ["3 wks ago", "2 wks ago", "Last week", "This week"];
  const LENGTH_NAMES = ["1–5", "6–15", "16–40", "41–100", "100+"];
  const dayparts = st?.daypartSessions;
  const daypartSlices = dayparts
    ? shareSlices([
        { label: "Morning", value: dayparts.morning }, { label: "Afternoon", value: dayparts.afternoon },
        { label: "Evening", value: dayparts.evening }, { label: "Night", value: dayparts.night },
      ])
    : [];
  const apps = st?.topApps ?? [];
  const appD = st?.appDetail ?? [];
  const dd = st?.days ?? [];
  const dayNames = statsDays(perDay.length || 30, ctx.tzOffsetMinutes ?? 0);
  const axis30 = [dayNames[0]?.short ?? "", dayNames[Math.floor(dayNames.length / 2)]?.short ?? "", "Today"];
  const month = monthFigures(ctx, { wordsMonth, spokenMinutes, allow });
  const todayD = dd[dd.length - 1];
  const todayWords = ctx.usage?.today?.words ?? perDay[perDay.length - 1] ?? 0;
  const todaySec = ctx.usage?.today?.audioSeconds ?? todayD?.saidSeconds ?? 0;
  const KIND_DONE: Record<string, string> = { voice: "said", typing: "typed", draft: "drafted" };
  const presets = applyPresetOverrides(ctx.personality?.presetOverrides);
  const presetName = (id: string) => presets.find((p) => p.id === id)?.name ?? (id === "signature" ? "Zu" : id);
  const writtenName = (key: string) => WRITTEN_NAMES[key] ?? key;
  const wpm = spokenMinutes > 0 ? n(Math.round(wordsMonth / spokenMinutes)) : "—";
  /** An ISO time as the user's clock reads it: "Today, 14:32", "3 Oct, 09:10". */
  const when = (iso: string): string => {
    const tz = Math.max(-840, Math.min(840, Math.round(ctx.tzOffsetMinutes ?? 0))) * 60_000;
    const at = Date.parse(iso);
    if (!Number.isFinite(at)) return "—";
    const d = new Date(at + tz);
    const clock = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    const dayOf = (ms: number) => Math.floor((ms + tz) / 86_400_000);
    const ago = dayOf(Date.now()) - dayOf(at);
    if (ago === 0) return `Today, ${clock}`;
    if (ago === 1) return `Yesterday, ${clock}`;
    return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}, ${clock}`;
  };

  /** One day's card: the numbers, the day as a curve, how, where, in what. */
  const dayInner = (d: NonNullable<typeof todayD>, words: number, seconds: number): Node[] => [
    tiles([
      { value: n(d.sessions), name: d.sessions === 1 ? "Session" : "Sessions" },
      { value: seconds > 0 ? said(seconds) : "—", name: "Said in" },
      { value: span(words / 40), name: "Typing time" },
    ]),
    secLab("Through the day"), dayCurve(d.hours),
    ...(kindSlices(d.kinds).length ? [secLab("How it was written"), pie(kindSlices(d.kinds), 124)] : []),
    ...(d.apps.length ? [secLab("Where it went"), pie(shareSlices(d.apps.map((a) => ({ label: a.app, value: a.words }))), 124)] : []),
    ...(d.languages.length ? [secLab("Written in"), ...d.languages.map((l) => line(writtenName(l.key), `${n(l.words)} words`, true))] : []),
    secLab("Time"),
    row("Said for", seconds > 0 ? said(seconds) : "—"),
    row("Typed, it would take", span(words / 40)),
    ...(seconds > 0 && words / 40 > seconds / 60 ? [row("Time saved", span(words / 40 - seconds / 60))] : []),
    ...(d.first ? [row("First words", d.first), row("Last words", d.last ?? d.first)] : []),
  ];

  /**
   * EVERY DAY, as the data for the one day card. A block sets `dayView` to
   * its day and opens "day"; the card reads everything from there. One card
   * filled thirty ways, rather than thirty cards: each was 13 KB of nodes,
   * and a month of them was most of the screen.
   */
  const dayData = perDay.map((w, i) => {
    const d = dd[i];
    const name = dayNames[i]?.name ?? "";
    if (w <= 0 || !d) return { name, headline: w > 0 ? `${n(w)} words` : "A quiet day", quiet: w <= 0 };
    const c = curvePaths(d.hours.length === 24 ? d.hours : new Array(24).fill(0), DAY_ASPECT);
    const typed = w / 40, saidMin = d.saidSeconds / 60;
    return {
      name,
      headline: `${n(w)} ${w === 1 ? "word" : "words"}`,
      active: true,
      sessions: n(d.sessions),
      said: d.saidSeconds > 0 ? said(d.saidSeconds) : "—",
      typing: span(typed),
      saved: d.saidSeconds > 0 && typed > saidMin ? span(typed - saidMin) : "",
      first: d.first ?? "",
      last: d.last ?? d.first ?? "",
      curve: { line: c.line, area: c.area },
      kinds: kindSlices(d.kinds),
      apps: shareSlices(d.apps.map((a) => ({ label: a.app, value: a.words }))),
      langs: d.languages.map((l) => ({ name: writtenName(l.key), text: `${n(l.words)} words` })),
    };
  });
  const when$ = (path: string, children: Node[]): Node => ({ type: "Stack", visibleIf: { truthy: path }, children });
  const dayPanel = panel(
    "day",
    { ...label(""), bind: { content: "dayView.name" } } as Node,
    { ...t("", "writtenLight", 30, { letterSpacing: -0.8, marginTop: 6 }), bind: { content: "dayView.headline" } } as Node,
    "",
    [
      when$("dayView.quiet", [caption("Nothing was said or written on this day. Days off count too.", { marginTop: 14 })]),
      when$("dayView.active", [
        boundTiles([
          { path: "dayView.sessions", name: "Sessions" },
          { path: "dayView.said", name: "Said in" },
          { path: "dayView.typing", name: "Typing time" },
        ]),
        secLab("Through the day"), boundCurve("dayView.curve", DAY_ASPECT, HOUR_LABELS),
        when$("dayView.kinds.0", [secLab("How it was written"), { ...pie([], 124), bind: { slices: "dayView.kinds" } } as Node]),
        when$("dayView.apps.0", [secLab("Where it went"), { ...pie([], 124), bind: { slices: "dayView.apps" } } as Node]),
        when$("dayView.langs.0", [secLab("Written in"), {
          type: "List",
          bind: { items: "dayView.langs" },
          props: { itemTemplate: boundLine({ path: "item.name" }, "item.text", true) },
        }]),
        secLab("Time"),
        boundLine("Said for", "dayView.said"),
        boundLine("Typed, it would take", "dayView.typing"),
        when$("dayView.saved", [boundLine("Time saved", "dayView.saved")]),
        when$("dayView.first", [boundLine("First words", "dayView.first"), boundLine("Last words", "dayView.last")]),
      ]),
    ],
  );

  const sessionLengths = st?.sessionLengths;
  const weekAvg = weeks.map((w, i) => (weekSessions[i] ? Math.round(w / weekSessions[i]!) : 0));
  const best = Math.max(st?.bestStreak ?? 0, streak);

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "stats",
    title: "",
    // The ground runs to the top of the window; the tabs stay, because this is
    // a tab root and losing them here strands the user.
    hideHeader: true,
    state: { openCard: "", dayView: {}, dayData },
    actions: {
      closeCard: { kind: "clearState", path: "openCard" },
      openHistory: { kind: "navigate", screenId: "history" },
    },
    root: {
      type: "Stack",
      style: { flex: 1, backgroundColor: u.ground },
      children: [
        {
          type: "Screen",
          style: {
            backgroundColor: "transparent",
            // Under the settings gear, with room: the month starts below it
            // rather than beside it.
            paddingHorizontal: PHONE_LOOK.side, paddingTop: STATS_TOP, paddingBottom: 56,
            // Wider than the You column because this screen is genuinely two
            // things side by side — the cards are already a two-up grid, and
            // on a window they get to be a proper one rather than two narrow
            // strips with a desk of empty ground beside them.
            ...readable(ctx, 760),
          },
          children: [
            ...phoneStatsBody(ctx, {
              wordsMonth, sessions, perDay, days, daysActive, streak, streakLive,
              avgPerSession, spokenMinutes, empty, allow: allow ?? null, paid, paidPct,
              topVoiceShare, dictShare, langCount: langRows.length,
              room: PHONE_ROOMS[DESK_ROOMS[ctx.personality?.activePresetId ?? "signature"] ?? "d-w-zu"],
            }),
          ],
        },

        // The way into Settings — see settingsGear(). The light glyph: this
        // ground is the warm near-black now, and the ink one (from when it
        // was amber) all but vanished on it.
        settingsGear("dark"),

        // THE DETAIL. One overlay, one `openCard`, a panel for each thing
        // that opens. An overlay rather than a Modal: the Modal set its card
        // inside a pressable frame, and a long card (every language, the whole
        // dictionary) was cut at the bottom instead of scrolling. Here nothing
        // pressable holds the card; the frosted page behind it closes it.
        {
          type: "Stack",
          visibleIf: { truthy: "openCard" },
          style: {
            position: "absolute", left: 0, top: 0, right: 0, bottom: 0,
            alignItems: "center", justifyContent: "center",
            paddingHorizontal: 14, paddingTop: 56, paddingBottom: 20,
          },
          children: [
            { type: "BlurBackground", props: { intensity: 40, tint: "dark" },
              style: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } },
            {
              type: "Stack",
              on: { onPress: "closeCard" },
              props: { pressOpacity: 1 },
              style: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(10,8,7,0.6)" },
            },
            {
          type: "Stack",
          style: {
            backgroundColor: u.card, borderRadius: 18, overflow: "hidden",
            padding: 18, width: "100%", maxWidth: 460, height: "100%",
          },
          children: [
            // Opened from the said-and-typed race, which an empty month does
            // not draw — so neither is this. The calendar month, as the race
            // is.
            ...(empty ? [] : [panel("minutes", "This month", n(month.words), month.words === 1 ? "word" : "words", [
              tiles([
                { value: span(month.words / 40), name: "Typed, it takes" },
                { value: month.saidMin > 0 ? span(month.saidMin) : "—", name: "Said, it took" },
                { value: span(Math.max(0, month.words / 40 - month.saidMin)), name: "Saved" },
              ]),
              secLab("Words a day, last 30 days"),
              curve(perDay, { markLast: true, labels: axis30 }),
              secLab("By week"),
              columns(weeks, WEEK_NAMES, { showValues: true, mark: 3 }),
              ...(apps.length ? [secLab("Where it went"),
                meters(apps.map((a) => ({ name: a.app, value: a.words, text: n(a.words) })))] : []),
              secLab("Against typing, last 30 days"),
              row("Words written", n(wordsMonth)),
              row("At 40 a minute, typed", span(wordsMonth / 40)),
              ...(spokenMinutes ? [row("Said", span(spokenMinutes))] : []),
              row("Minutes saved", n(minutesSaved)),
            ])]),

            // TODAY, in full: every session with its time, the day as a
            // curve, how it was written and where it went.
            panel("today", "Today", n(todayWords), todayWords === 1 ? "word" : "words",
              todayD && todayD.sessions > 0
                ? [
                    ...dayInner(todayD, todayWords, todaySec),
                    ...(st?.todaySessions?.length ? [
                      secLab("Every session"),
                      ...st.todaySessions.map((x) => line(
                        `${x.at}${x.app ? `   ${x.app}` : ""}`,
                        `${n(x.words)} ${x.words === 1 ? "word" : "words"}${x.kind && KIND_DONE[x.kind] ? `, ${KIND_DONE[x.kind]}` : ""}`,
                        true,
                      )),
                    ] : []),
                  ]
                : [caption("Nothing yet today. Say something in any app and it shows here, hour by hour.", { marginTop: 14 })]),

            // WHERE THE WORDS WENT, app by app: how much, what for, in which
            // voice, at what time of day, and when last.
            ...(!(appD.length || apps.some((a) => a.words > 0)) ? [] : [panel("apps", "Where the words went", n(appD.length || apps.length),
                  (appD.length || apps.length) === 1 ? "app" : "apps", [
              secLab("Share of words"),
              pie(shareSlices((appD.length ? appD : apps).map((a) => ({ label: a.app, value: a.words }))), 140, "No apps yet"),
              ...appD.flatMap((a) => {
                const kt = a.kinds.voice + a.kinds.typing + a.kinds.draft || 1;
                const uses = ([["Dictation", a.kinds.voice], ["Typed, cleaned up", a.kinds.typing], ["Replies drafted", a.kinds.draft]] as const)
                  .filter(([, v]) => v > 0)
                  .map(([name, v]) => `${name} ${Math.round((v / kt) * 100)}%`)
                  .join(", ");
                return [
                  t(a.app, "writtenLight", 22, { marginTop: 34, letterSpacing: -0.3 }),
                  tiles([
                    { value: n(a.words), name: "Words" },
                    { value: n(a.sessions), name: a.sessions === 1 ? "Session" : "Sessions" },
                    { value: n(a.avgWords), name: "Per session" },
                  ]),
                  ...(uses ? [row("Used for", uses)] : []),
                  ...(() => {
                    const parts = ([["mornings", a.dayparts.morning], ["afternoons", a.dayparts.afternoon],
                                    ["evenings", a.dayparts.evening], ["nights", a.dayparts.night]] as const)
                      .filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
                    return parts.length
                      ? [row("Mostly", `${parts[0]![0]}, ${n(parts[0]![1])} of ${n(a.sessions)}`)]
                      : [];
                  })(),
                  ...(a.voices.length ? [row("Written as", a.voices.map((v) => presetName(v.id)).join(", "))] : []),
                  row("Last used", when(a.lastAt)),
                ];
              }),
            ])]),

            // HOW YOU SPEAK: the languages, small, each with its words; how
            // the words arrived; and how fast you talk.
            (() => {
              const langs = st?.writtenIn?.length
                ? st.writtenIn.map((w) => ({ label: writtenName(w.key), value: w.words }))
                : langRows.filter((l) => l.label !== "Auto").map((l) => ({ label: l.label, value: l.words }));
              const total = langs.reduce((sum, l) => sum + l.value, 0) || 1;
              return panel("languages", "How you speak", String(langs.length || "—"),
                           langs.length === 1 ? "language" : langs.length ? "languages" : "", [
                secLab("What you write in"),
                pie(shareSlices(langs), 140, "No writing yet"),
                ...(langs.length ? [secLab("Each language"),
                  ...langs.map((l) => line(l.label, `${n(l.value)} words, ${Math.round((l.value / total) * 100)}%`, true))] : []),
                ...(kindSlices(st?.kindWords).length ? [secLab("How the words came"), pie(kindSlices(st?.kindWords), 124)] : []),
                secLab("Pace"),
                line("Words a minute, said", wpm, true),
                line("Spoken, last 30 days", spokenMinutes ? span(spokenMinutes) : "—", true),
              ], editButton("Add languages", "languages"));
            })(),

            dayPanel,

            panel("sessions", "Sessions", n(sessions), "", [
              tiles([
                { value: n(sessions), name: "In 30 days" },
                { value: daysActive ? String(Math.round((sessions / daysActive) * 10) / 10) : "0", name: "A writing day" },
                { value: n(avgPerSession), name: "Words each" },
              ]),
              secLab("Sessions a day"), curve(st?.sparklinePerDay ?? perDay, { markLast: true, labels: axis30 }),
              ...(daypartSlices.length ? [secLab("Time of day"), pie(daypartSlices, 124)] : []),
              ...(sessionLengths ? [secLab("How long, in words"), columns(sessionLengths, LENGTH_NAMES, { showValues: true, height: 70 })] : []),
              secLab("Shape"),
              row("Average per session", `${n(avgPerSession)} words`),
              ...(st?.bestDay ? [row("Best day", `${n(st.bestDay.words)} words`)] : []),
              ...(st?.kindWords ? [
                row("Said", `${n(st.kindWords.voice)} words`),
                row("Typed", `${n(st.kindWords.typing)} words`),
                row("Replies drafted", `${n(st.kindWords.draft)} words`),
              ] : []),
            ]),

            panel("streak", "Day streak", n(streak), streak === 1 ? "day" : "days", [
              tiles([
                { value: n(streak), name: "Running now", live: streakLive },
                { value: n(best), name: "Best run" },
                { value: `${n(daysActive)}/${days}`, name: "Days written" },
              ]),
              secLab("Now, against your best"),
              meters([
                { name: "Now", value: streak, text: `${n(streak)} ${streak === 1 ? "day" : "days"}`, ...(streakLive ? { color: u.accent } : {}) },
                { name: "Best", value: best, text: `${n(best)} ${best === 1 ? "day" : "days"}` },
              ], 52),
              secLab("The month"), dotGrid(perDay.length ? perDay : new Array(30).fill(0)),
              ...(daysActive > 0 ? [
                secLab("Written and quiet"),
                pie([
                  { label: "Days written", value: daysActive, color: u.onCard },
                  { label: "Quiet days", value: Math.max(0, days - daysActive), color: SHARE_INKS[4]! },
                ], 120),
              ] : []),
            ]),

            panel("active", "Active days", n(daysActive), `of ${days}`, [
              secLab("Words a day"),
              columns(perDay, [], { mark: perDay.length - 1, gap: 2, height: 80 }), axis(axis30),
              ...(daypartSlices.length ? [secLab("Time of day"), pie(daypartSlices, 124)] : []),
              ...(st?.hourWords?.some((v) => v > 0) ? [secLab("Hour by hour"), dayCurve(st.hourWords)] : []),
              secLab("Pattern"),
              row("Active days", `${n(daysActive)} of ${days}`),
              row("Average per active day",
                  `${n(daysActive ? Math.round(wordsMonth / daysActive) : 0)} words`),
              ...(st?.bestDay ? [row("Biggest day", `${n(st.bestDay.words)} words`)] : []),
            ]),

            panel("persession", "Per session", n(avgPerSession), "words", [
              ...(sessionLengths ? [secLab("Sessions by length, in words"),
                columns(sessionLengths, LENGTH_NAMES, { showValues: true, height: 70 })] : []),
              secLab("Words a session, by week"),
              columns(weekAvg, WEEK_NAMES, { showValues: true, mark: 3, height: 64 }),
              ...(appD.length ? [secLab("By app"),
                meters(appD.map((a) => ({ name: a.app, value: a.avgWords, text: `${n(a.avgWords)} words` })))] : []),
              secLab("Shape"),
              row("Average per session", `${n(avgPerSession)} words`),
              row("Sessions", n(sessions)),
              ...(st?.bestDay ? [row("Best day", `${n(st.bestDay.words)} words`)] : []),
              // ALL TIME, and the only place it appears. Everything above is a
              // rolling month, which is the right window for a habit and the
              // wrong one for "how much has this actually done for me".
              secLab("All time"),
              row("Words", n(lifetime.words)),
              row("Sessions", n(lifetime.requests)),
              row("Spoken", `${Math.round(lifetime.audioSeconds / 60)} min`),
            ]),

            panel("dictionary", "Dictionary", dictShare, dictShare === "—" ? "" : "in use", [
              secLab("What earns its place"),
              ring(dictionarySlices(st, CHART_ON_DARK), dictShare, "IN USE",
                   "Save a word and it starts counting"),
              ...(st?.dictionary?.top?.length ? [
                secLab("Most used"),
                meters(st.dictionary.top.map((w) => ({ name: w.word, value: w.uses, text: `${n(w.uses)}×` }))),
              ] : []),
              ...(st?.dictionary ? [
                secLab("The list"),
                row("Saved", n(st.dictionary.saved)),
                row("Used", n(st.dictionary.used)),
                row("Never used", n(st.dictionary.unused)),
                row("Cleanups scanned", n(st.dictionary.scanned)),
              ] : []),
              // NAMED, not just counted. "Six unused" is a fact; "these six"
              // is something you can act on — prune them, or notice one is
              // spelled a way you never actually type.
              ...(st?.dictionary?.unusedWords?.length ? [
                secLab("Never turned up"),
                ...st.dictionary.unusedWords.map((w) => line(w, "—", true)),
              ] : []),
            ], editButton("Add words", "dictionary")),

            panel("voices", "Voices", topVoiceShare, topVoiceShare === "—" ? "" : "top", [
              secLab("Who writes for you"),
              ring(voiceSlices(st, ctx.personality, CHART_ON_DARK), topVoiceShare, "TOP",
                   "No writing yet"),
              ...(voiceRows.length ? [
                secLab("By words"),
                meters(voiceRows.map((v) => ({ name: v.label, value: v.words, text: n(v.words) }))),
              ] : []),
              // WHICH REGISTER, which is a different question from which
              // voice: a voice is who is writing, a tone is how. Zu written
              // in a formal register is still Zu.
              ...(st?.toneWords?.length ? [
                secLab("In which register"),
                meters(st.toneWords.map((tw) => ({
                  name: TONE_LABELS[tw.tone as keyof typeof TONE_LABELS] ?? tw.tone, value: tw.words, text: n(tw.words),
                }))),
              ] : []),
            ]),

            panel("spoken", "Spoken", spokenMinutes ? String(spokenMinutes) : "0", "min", [
              tiles([
                { value: spokenMinutes ? span(spokenMinutes) : "—", name: "Said" },
                { value: span(wordsMonth / 40), name: "Typed, it takes" },
                { value: wpm, name: "Words a minute" },
              ]),
              ...((st?.saidSecondsPerDay ?? []).some((v) => v > 0) ? [
                secLab("Minutes said, a day"),
                curve(st!.saidSecondsPerDay!.map((v) => v / 60), { markLast: true, labels: axis30 }),
              ] : []),
              secLab("Said, against typing it"),
              meters([
                { name: "Said", value: spokenMinutes, text: spokenMinutes ? span(spokenMinutes) : "—" },
                { name: "Typed", value: wordsMonth / 40, text: span(wordsMonth / 40), color: TYPED_INK },
              ], 52),
              ...(daypartSlices.length ? [secLab("When you write"), pie(daypartSlices, 124)] : []),
              secLab("Rate"),
              row("Spoken, last 30 days", `${spokenMinutes} min`),
              row("Words out", n(wordsMonth)),
              // The one figure here that is genuinely about the user rather
              // than about the app: how fast they talk.
              row("Words a minute", wpm),
              row("All time", `${Math.round(lifetime.audioSeconds / 60)} min`),
            ]),

            // Where the allowance came from. The meter above opens this.
            ...(allow ? [paid ? panel("words", "Words this month", n(allow.used), "", [
              secLab("This month"),
              row("Plan", ctx.entitlement ? "No limit" : "Free, no limit"),
              row("Used", n(allow.used)),
              ...(allow.streakDays ? [row("Day streak", `${n(allow.streakDays)} days`)] : []),
            ]) : panel("words", "Words left", n(allow.remaining), "", [
              secLab("This month"),
              row("Plan", n(allow.base)),
              row("Earned by turning up", n(allow.earned)),
              row("Used", n(allow.used)),
              row("Left", n(allow.remaining)),
              ...(allow.streakDays ? [row("Day streak", `${n(allow.streakDays)} days`)] : []),
              // WHAT EACH VISIT GAVE, as bars rather than the pie this used to
              // be: a pie of thirty visits is thirty slices nobody can read,
              // and a pie needs a colour per slice on a screen that has two.
              ...(allow.perVisit.length ? [
                secLab("Earned per visit"),
                bars(
                  allow.perVisit.slice(-8).map((v) => v.words),
                  allow.perVisit.slice(-8).map((v) => v.day.slice(5)),
                ),
              ] : []),
              ...(allow.maxed
                ? [caption("You have earned the most you can this month.", { marginTop: 14 })]
                : []),
            ])] : []),
          ],
            },
          ],
        },
      ],
    },
    cacheTtlSeconds: 45,
  };
}
