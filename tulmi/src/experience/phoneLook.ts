/**
 * THE PHONE, IN THE DESK'S LANGUAGE — and with room to breathe.
 *
 * The same four voices as the desktop: what was WRITTEN set in a book face,
 * what was SAID in a hand, small LABELS in a mono, and the UI in a plain sans.
 * Served by the backend (catalog FONTS, tulmi/fonts), so none of this needs a
 * store release.
 *
 * And a rule for the air, because a screen that is right in every detail can
 * still feel heavy: 24 pt at the sides, 56 between sections, hairlines rather
 * than boxes, one idea per section, small type that steps down rather than
 * shouts. Anything added here should leave the page as light as it found it.
 *
 * React Native Text has no inline runs, so a sentence with one word in italic
 * or colour is a row of word-sized Texts that wraps like a sentence (see
 * `sentence`). And a custom face's weight is its FILE: every text here names
 * its face and sets fontWeight "normal", or the phone falls back to the system
 * font looking for a weight the family does not have.
 */
import type { ActionRef, Node } from "../../../shared/types/sdui.js";
import type { UsageSummary } from "../../../shared/types/api.js";
import type { Allowance } from "../usage/allowance.js";
import { LANGUAGE_NAMES as WRITTEN_NAMES } from "../history/writtenIn.js";
import { curve, ring, shareSlices } from "./statsCharts.js";

/** The phone's typefaces by role, each the name it is registered under. */
export const PHONE_FONT = {
  writtenLight: "Tailzu Written Light",
  writtenLightItalic: "Tailzu Written Light Italic",
  written: "Tailzu Written",
  writtenItalic: "Tailzu Written Italic",
  said: "Tailzu Said",
  label: "Tailzu Label",
  ui: "Tailzu UI",
  uiMedium: "Tailzu UI Medium",
  /** Titles: a card's name, in capitals. */
  uiBold: "Tailzu UI Bold",
  /** Titles in the book face: the month, Today, a section's name. */
  writtenBold: "Tailzu Written Bold",
} as const;

export const PHONE_LOOK = {
  ground: "#0F0D0B",
  ink: "#F3E2C6",
  /** Secondary reading text — 7:1 on the ground. */
  ink2: "rgba(243,226,198,0.66)",
  /** Labels and captions — 4.5:1 on the ground. */
  ink3: "rgba(243,226,198,0.5)",
  rule: "rgba(243,226,198,0.07)",
  track: "rgba(243,226,198,0.08)",
  /** Typing's colour, wherever typed and said are compared. */
  typed: "#E4587B",
  typedInk: "#F28BA5",
  /** Amber: only what is still in play (a streak running today). */
  accent: "#E8A23C",
  side: 24,
  section: 56,
} as const;

type Style = Record<string, unknown>;

/**
 * The least line height each face can be set in without the phone clipping
 * it — measured from the files (tulmi/fonts): the mono's line box is 1.30 of
 * its size, the hand's 1.26, the sans's 1.22 with marks to 1.34, and the book
 * face declares 1.00 while its letters reach 1.43. A line set tighter than
 * that loses the tops of its capitals on Android and shifts on iOS, which is
 * what cut the training card's "IT LEARNS YOU". So every text is held to it,
 * whatever a caller asks for.
 */
// Newsreader reserves 0.735em above the baseline in its metrics and draws up
// to 0.9em (0.925 in italic): at 1.3 the extra leading, split above and
// below, left the tops of its tallest letters shaved off — the training
// card's title, among others. 1.45 gives every glyph its room.
const MIN_LINE: Record<keyof typeof PHONE_FONT, number> = {
  writtenLight: 1.45, writtenLightItalic: 1.45, written: 1.45, writtenItalic: 1.45,
  said: 1.34, label: 1.45, ui: 1.4, uiMedium: 1.4, uiBold: 1.4, writtenBold: 1.45,
};
export const lineFor = (face: keyof typeof PHONE_FONT, size: number, asked?: unknown): number =>
  Math.max(typeof asked === "number" ? asked : 0, Math.ceil(size * MIN_LINE[face]));

/** Any text in one of the four faces. */
export function t(content: string, face: keyof typeof PHONE_FONT, size: number, style: Style = {}): Node {
  return {
    type: "Text",
    props: { content },
    style: {
      fontFamily: PHONE_FONT[face], fontWeight: "normal", fontStyle: "normal",
      fontSize: size, color: PHONE_LOOK.ink, ...style,
      lineHeight: lineFor(face, size, style.lineHeight ?? Math.round(size * 1.45)),
    },
  };
}

/** A small uppercase label. */
export const label = (content: string, style: Style = {}): Node =>
  t(content, "label", 9.5, { letterSpacing: 1.5, textTransform: "uppercase", color: PHONE_LOOK.ink3, ...style });

/** A caption in the UI face. */
export const caption = (content: string, style: Style = {}): Node =>
  t(content, "ui", 12.5, { lineHeight: 19, color: PHONE_LOOK.ink2, ...style });

/** A section heading in the written face. */
export const heading = (content: string, style: Style = {}): Node =>
  t(content, "written", 16, style);

/**
 * A sentence whose parts can differ — an italic phrase, a coloured figure —
 * as a wrapping row of words. Each word keeps its part's style; the space
 * travels with the word before it, so the line breaks where a sentence would.
 */
export function sentence(
  parts: Array<string | { text: string; style?: Style; face?: keyof typeof PHONE_FONT }>,
  face: keyof typeof PHONE_FONT, size: number, style: Style = {}, rowStyle: Style = {},
): Node {
  // Words with the space that follows them; a word that touches the one
  // before it (a full stop after a coloured figure) is kept on its line by
  // travelling in one unbreakable group with it.
  const units: Node[][] = [];
  let glued = false;
  for (const p of parts.map((x) => (typeof x === "string" ? { text: x } : x))) {
    for (const m of p.text.matchAll(/(\s*)(\S+)(\s*)/g)) {
      const [, lead, word, trail] = m as unknown as [string, string, string, string];
      const node = t(word + (trail ? " " : ""), p.face ?? face, size, { ...style, ...(p.style ?? {}) });
      if (glued && !lead && units.length) units[units.length - 1]!.push(node);
      else units.push([node]);
      glued = !trail;
    }
    if (/\s$/.test(p.text)) glued = false;
  }
  return {
    type: "Stack",
    style: { flexDirection: "row", flexWrap: "wrap", ...rowStyle },
    children: units.map((u) => (u.length === 1 ? u[0]! : { type: "Stack", style: { flexDirection: "row" }, children: u })),
  };
}

/** A thin bar: `pct` of a track. */
export function bar(pct: number, color: string = PHONE_LOOK.ink, height = 3, style: Style = {}): Node {
  const w = Math.max(0, Math.min(100, pct || 0)); // NaN (0 of 0) is an empty bar, not "NaN%"
  return {
    type: "Stack",
    style: { height, backgroundColor: PHONE_LOOK.track, overflow: "hidden", ...style },
    children: [{ type: "Stack", style: { width: `${w.toFixed(1)}%`, height, backgroundColor: color } }],
  };
}

/**
 * Minutes as a person says them: "38 sec", "15 min", "1 h 45". The phone and
 * the desk both read this one.
 *
 * Rounded ONCE, before it is split. Rounding the remainder after taking the
 * hours read 119.7 minutes as "1 h 60", 59.7 as "60 min" and 0.995 as
 * "60 sec".
 */
export function span(minutes: number): string {
  const sec = Math.round(minutes * 60);
  if (sec < 60) return `${Math.max(1, sec)} sec`;
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60), m = total % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const n = (v: number) => v.toLocaleString("en-US");

/** Open one of the Stats panels (catalog statsScreen, one Modal on `openCard`). */
const open = (id: string): ActionRef => ({ kind: "sequence", actions: [
  { kind: "haptic", style: "selection" },
  { kind: "setState", path: "openCard", value: id },
] });

/** One figure: its label, its value; the whole thing opens its panel. */
function figure(id: string, name: string, value: string, unit = "", live = false): Node {
  return {
    type: "Stack",
    on: { onPress: open(id) },
    props: { pressOpacity: 0.6 },
    style: { flex: 1, paddingVertical: 6 },
    children: [
      label(name),
      {
        type: "Stack",
        style: { flexDirection: "row", alignItems: "baseline", marginTop: 8 },
        children: [
          t(value, "writtenLight", 20, { color: live ? PHONE_LOOK.accent : PHONE_LOOK.ink }),
          ...(unit ? [t(` ${unit}`, "ui", 10.5, { color: PHONE_LOOK.ink3 })] : []),
        ],
      },
    ],
  };
}

/** A section's name on the Stats tab. */
const sectionTitle = (content: string, style: Style = {}): Node =>
  t(content, "writtenBold", 24, { letterSpacing: -0.4, ...style });

/** "How you speak" with nothing to set to size yet — still the way in. */
function howYouSpeakNote(count: number): Node {
  return {
    type: "Stack",
    on: { onPress: open("languages") },
    props: { pressOpacity: 0.6 },
    style: { marginTop: STATS_SECTION },
    children: [
      sectionTitle("How you speak"),
      caption(count > 0
        ? `${count} ${count === 1 ? "language" : "languages"} this month.`
        : "Each language you speak shows here, at its share.", { marginTop: 8 }),
    ],
  };
}

/**
 * THE AIR BETWEEN THE STATS TAB'S SECTIONS. Asked for more room: each
 * section is one idea, and at 56 they read as one long list.
 */
export const STATS_SECTION = 96;

/**
 * Where the Stats tab's words start: under the settings gear (catalog GEAR,
 * 58 from the top and 34 tall), with room before the month begins.
 */
export const STATS_TOP = 132;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface StatsDay {
  /** Day of the month. */
  day: number;
  /** 0 Sunday … 6 Saturday. */
  weekday: number;
  /** "Tue 1 Oct", or "Today". */
  name: string;
  /** "1 Oct". */
  short: string;
}

/**
 * The date of each day bucket in the stats (oldest first, today last), in
 * the user's own day — the same buckets history/store.ts counts into.
 */
export function statsDays(count: number, tzOffsetMinutes = 0): StatsDay[] {
  const tz = Math.max(-840, Math.min(840, Math.round(tzOffsetMinutes)));
  const now = Date.now() + tz * 60_000;
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now - (count - 1 - i) * 86_400_000);
    const short = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`;
    return {
      day: d.getUTCDate(),
      weekday: d.getUTCDay(),
      name: i === count - 1 ? "Today" : i === count - 2 ? "Yesterday" : `${WEEKDAYS[d.getUTCDay()]} ${short}`,
      short,
    };
  });
}

/**
 * THE DAYS, as a calendar of blocks big enough for a thumb: Monday first,
 * each block its date, filled by how much was written that day. Each opens
 * that day in the one day card — a quiet day too, which the card names.
 */
function dayBlocks(perDay: number[], days: StatsDay[], streakLive: boolean, tzMinutes = 0): Node {
  const L = PHONE_LOOK;
  const max = Math.max(1, ...perDay);
  const FILL = ["transparent", "rgba(243,226,198,0.24)", "rgba(243,226,198,0.58)", L.ink];
  const cells: Node[] = perDay.map((v, i) => {
    const today = i === perDay.length - 1;
    const lvl = v <= 0 ? 0 : v > max * 0.66 ? 3 : v > max * 0.33 ? 2 : 1;
    const live = today && streakLive;
    return {
      type: "Stack",
      on: {
        // Today has its own card. Any other day fills the one day card
        // from the screen's `dayData` (catalog statsScreen) and opens it.
        onPress: today ? open("today") : ({ kind: "sequence", actions: [
          { kind: "haptic", style: "selection" },
          { kind: "setState", path: "dayView", value: `$state.dayData.${i}` },
          { kind: "setState", path: "openCard", value: "day" },
        ] } as ActionRef),
      },
      props: { pressOpacity: 0.55, hitSlop: 3 },
      style: {
        flex: 1, aspectRatio: 1, borderRadius: 10,
        alignItems: "center", justifyContent: "center",
        backgroundColor: live ? L.accent : FILL[lvl],
        ...(lvl === 0 || today
          ? { borderWidth: 1.5, borderColor: today ? (live ? L.accent : L.ink) : "rgba(243,226,198,0.16)" }
          : {}),
      },
      children: [t(String(days[i]?.day ?? ""), "label", 10.5, {
        color: live || lvl >= 2 ? L.ground : today ? L.ink : L.ink3, letterSpacing: 0,
      })],
    };
  });
  // The weeks run Monday to Sunday, so the first and last rows are filled
  // out with the dates either side of the thirty days — drawn faint and not
  // tappable, the way a calendar shows the next month's first days. A blank
  // square there would read as a day that failed to load.
  const DAY = 86_400_000;
  const outside = (offset: number): Node => {
    const d = new Date(Date.now() + tzMinutes * 60_000 + offset * DAY);
    return {
      type: "Stack",
      style: { flex: 1, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
      children: [t(String(d.getUTCDate()), "label", 10.5, { color: "rgba(243,226,198,0.16)", letterSpacing: 0 })],
    };
  };
  const lead = days.length ? (days[0]!.weekday + 6) % 7 : 0;
  // Offsets in days from today: the window is -(n-1)..0.
  const n0 = -(perDay.length - 1);
  const slots: Node[] = [
    ...Array.from({ length: lead }, (_, k) => outside(n0 - (lead - k))),
    ...cells,
  ];
  for (let k = 1; slots.length % 7; k++) slots.push(outside(k));
  const weeks: Node[] = [];
  for (let i = 0; i < slots.length; i += 7) {
    weeks.push({
      type: "Stack",
      style: { flexDirection: "row", gap: 7 },
      children: slots.slice(i, i + 7),
    });
  }
  return {
    type: "Stack",
    style: { gap: 7, marginTop: 20, maxWidth: 400 },
    children: [
      {
        type: "Stack",
        style: { flexDirection: "row", gap: 7 },
        children: ["M", "T", "W", "T", "F", "S", "S"].map((d) => ({
          type: "Stack", style: { flex: 1, alignItems: "center" },
          children: [label(d, { letterSpacing: 0 })],
        } as Node)),
      },
      ...weeks,
    ],
  };
}

export interface PhoneStatsInput {
  wordsMonth: number;
  sessions: number;
  perDay: number[];
  days: number;
  daysActive: number;
  streak: number;
  streakLive: boolean;
  avgPerSession: number;
  spokenMinutes: number;
  empty: boolean;
  allow: Allowance | null;
  paid: boolean;
  paidPct: number;
  topVoiceShare: string;
  dictShare: string;
  langCount: number;
  /** The active voice's colours, for the card that leads to the You tab. */
  room?: { bg: string; ink: string; dim: string; edge?: string };
}

/**
 * The words of the calendar month, and its speech in minutes, as the meter
 * counted them.
 *
 * The words are the allowance's own count when there is one: the same number
 * "Words this month" shows further down, so the two can never disagree.
 * They did — the line under the month was summed from a read that stopped at
 * a thousand rows (usage/metering.ts readUsageRows), the meter from the month
 * alone.
 */
export function monthFigures(
  ctx: { usage?: UsageSummary },
  s: { wordsMonth: number; spokenMinutes: number; allow?: Allowance | null },
) {
  const words = s.allow?.used ?? ctx.usage?.month.words ?? s.wordsMonth;
  const saidMin = ctx.usage ? ctx.usage.month.audioSeconds / 60 : s.spokenMinutes;
  return { words, saidMin };
}

/**
 * WORDS THIS MONTH (or words left, on the free plan) — a line and a thread,
 * under the month's name. Opens where the words came from.
 */
function wordsMeter(a: Allowance, paid: boolean, paidPct: number): Node {
  const L = PHONE_LOOK;
  return {
    type: "Stack",
    on: { onPress: open("words") },
    props: { pressOpacity: 0.6 },
    style: { marginTop: 14, paddingVertical: 4 },
    children: [
      label(paid ? "Words this month" : "Words left"),
      paid
        ? t(`${n(a.used)}. No limit on your plan.`, "writtenLight", 20, { marginTop: 8 })
        : t(`${n(a.remaining)} of ${n(a.total)}, back on the 1st.`, "writtenLight", 20, { marginTop: 8 }),
      paid
        ? bar(paidPct, L.ink, 3, { marginTop: 12 })
        : bar(a.total ? (a.remaining / a.total) * 100 : 0, L.ink, 3, { marginTop: 12 }),
      ...(!paid && a.earned > 0 ? [caption(
        a.maxed ? `${n(a.earned)} earned, the most there is this month.` : `${n(a.earned)} of these you earned by turning up.`,
        { marginTop: 10 },
      )] : []),
    ],
  };
}

/**
 * The Stats tab's page. The month by name, large, and what it held; then
 * today, where the words went, the allowance, how you speak, the days as a
 * calendar, and six figures. Everything that has more behind it opens its
 * card in the one Modal (`openCard`): a section, a figure, a single day.
 */
export function phoneStatsBody(
  ctx: { tzOffsetMinutes?: number; usage?: UsageSummary; stats?: unknown; personality?: unknown },
  s: PhoneStatsInput,
): Node[] {
  const L = PHONE_LOOK;
  const GAP = STATS_SECTION;
  const st = (ctx.stats ?? {}) as {
    topApps?: Array<{ app: string; words: number }>;
    writtenIn?: Array<{ key: string; words: number }>;
    languageWords?: Array<{ language: string; words: number }>;
    kindWords?: { voice: number; typing: number; draft: number };
    bestStreak?: number;
    days?: Array<{ hours: number[]; saidSeconds: number }>;
  };
  const tz = Math.max(-840, Math.min(840, Math.round(ctx.tzOffsetMinutes ?? 0)));
  const now = new Date(Date.now() + tz * 60_000);
  const month = monthFigures(ctx, s);

  // THE MONTH — its name, large, and under it what it held. The calendar
  // month, as the meter counted it: "this month" under "October" means
  // October, not the thirty days the figures further down are about.
  const out: Node[] = [t(MONTHS[now.getUTCMonth()]!, "writtenBold", 46, { letterSpacing: -1.2 })];

  // UNDER THE MONTH, ITS WORDS: the meter, which is the month's count and
  // what is left of it. It used to sit further down, under a line of its own
  // that said the month's words a second time.
  const meter = s.allow ? wordsMeter(s.allow, s.paid, s.paidPct) : null;
  if (s.empty && month.words === 0) {
    out.push(
      t("Nothing here yet.", "writtenLight", 20, { marginTop: 6, color: L.ink2 }),
      caption("Say a few things in any app and this fills in: how much you said, where it went, the days you talked.", { marginTop: 10, maxWidth: 300 }),
      ...(meter ? [meter] : []),
    );
  } else if (month.words === 0) {
    out.push(meter ?? t("Nothing yet this month.", "writtenLight", 20, { marginTop: 6, color: L.ink2 }));
  } else {
    out.push(meter ?? sentence(
      [`${n(month.words)} `, { text: `${month.words === 1 ? "word" : "words"} this month.`, style: { color: L.ink2 } }],
      "writtenLight", 22, { letterSpacing: -0.2 }, { marginTop: 4 },
    ));
    const typedMin = month.words / 40;
    const saidMin = month.saidMin;
    out.push(sentence(
      saidMin > 0
        ? ["Typed, they would have taken ", { text: span(typedMin), style: { color: L.typedInk } }, ". Said, ",
           { text: `${span(saidMin)}.`, face: "writtenLightItalic" }]
        : ["Typed by hand, they would have taken ", { text: `${span(typedMin)}.`, style: { color: L.typedInk } }],
      "writtenLight", 16, { color: L.ink2 }, { marginTop: 18 },
    ));
    const most = Math.max(typedMin, saidMin, 0.01);
    const lane = (name: string, min: number, color: string, ink: string): Node => ({
      type: "Stack",
      style: { flexDirection: "row", alignItems: "center", gap: 12 },
      children: [
        label(name, { width: 44, color: ink, letterSpacing: 1.2 }),
        bar((min / most) * 100, color, 3, { flex: 1 }),
        label(span(min), { width: 52, textAlign: "right", color: ink, letterSpacing: 0.8 }),
      ],
    });
    out.push({
      type: "Stack",
      on: { onPress: open("minutes") },
      props: { pressOpacity: 0.6 },
      style: { gap: 12, marginTop: 22, paddingVertical: 4 },
      children: [
        ...(saidMin > 0 ? [lane("Said", saidMin, L.ink, L.ink)] : []),
        lane("Typed", typedMin, L.typed, L.typedInk),
      ],
    });
  }

  if (!s.empty) {
    // TODAY — large, the week as seven dots, and the day so far as a curve
    // that ends at now. The whole of it opens today's card.
    const todayWords = ctx.usage?.today?.words ?? s.perDay[s.perDay.length - 1] ?? 0;
    const todaySec = ctx.usage?.today?.audioSeconds ?? st.days?.[st.days.length - 1]?.saidSeconds ?? 0;
    const sofar = (st.days?.[st.days.length - 1]?.hours ?? []).slice(0, now.getUTCHours() + 1);
    const week = s.perDay.slice(-7);
    while (week.length < 7) week.unshift(0);
    out.push({
      type: "Stack",
      on: { onPress: open("today") },
      props: { pressOpacity: 0.6 },
      style: { marginTop: GAP },
      children: [
        {
          type: "Stack",
          style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
          children: [
            t("Today", "writtenBold", 34, { letterSpacing: -0.8 }),
            {
              type: "Stack",
              style: { flexDirection: "row", gap: 5 },
              children: week.map((v, i) => ({
                type: "Stack",
                style: {
                  width: 8, height: 8, borderRadius: 2.5, borderWidth: 1,
                  borderColor: v > 0 ? L.ink : "rgba(243,226,198,0.25)",
                  backgroundColor: v > 0 ? L.ink : "transparent",
                  ...(i === 6 ? { transform: [{ scale: 1.25 }] } : {}),
                },
              })),
            },
          ],
        },
        todayWords > 0
          ? sentence(
              [`${n(todayWords)} ${todayWords === 1 ? "word" : "words"}`,
               ...(todaySec > 0 ? [{ text: `, said in ${span(todaySec / 60).replace("sec", "seconds")}.`, face: "writtenLightItalic" as const }] : ["."])],
              "writtenLight", 17, {}, { marginTop: 6 })
          : t("Nothing yet today.", "writtenLight", 17, { marginTop: 6, color: L.ink2 }),
        ...(sofar.some((v) => v > 0)
          ? [{ type: "Stack", style: { marginTop: 16 }, children: [curve(sofar, { aspect: 6, markLast: true })] } as Node]
          : []),
      ],
    });

    // WHERE THE WORDS WENT — under today. A short mark each; the card has
    // each app in full: how it was used, in which voice, when.
    const apps = (st.topApps ?? []).filter((a) => a.words > 0).slice(0, 4);
    const appTotal = apps.reduce((sum, a) => sum + a.words, 0);
    if (appTotal > 0) {
      out.push({
        type: "Stack",
        on: { onPress: open("apps") },
        props: { pressOpacity: 0.6 },
        style: { marginTop: GAP },
        children: [
          sectionTitle("Where the words went", { marginBottom: 10 }),
          ...apps.map((a) => ({
            type: "Stack",
            style: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 9 },
            children: [
              label(a.app, { width: 84, color: L.ink, letterSpacing: 1 }),
              bar((a.words / appTotal) * 100, PHONE_LOOK.ink, 3, { flex: 1 }),
              label(`${Math.round((a.words / appTotal) * 100)}%`, { width: 36, textAlign: "right", color: L.ink2 }),
            ],
          } as Node)),
        ],
      });
    }
  }

  if (!s.empty) {
    // HOW YOU SPEAK — a ring of the languages with their count in it, and
    // beside it how the words arrived. The names and every number are in
    // the card.
    const byScript = st.writtenIn?.length
      ? st.writtenIn.map((w) => ({ label: WRITTEN_NAMES[w.key] ?? w.key, value: w.words }))
      : (st.languageWords ?? []).filter((l) => l.language !== "auto").map((l) => ({ label: WRITTEN_NAMES[l.language] ?? l.language, value: l.words }));
    const total = byScript.reduce((sum, l) => sum + l.value, 0);
    if (total > 0) {
      const k = st.kindWords;
      const kTotal = k ? k.voice + k.typing + k.draft : 0;
      const how = k && kTotal > 0
        ? [
            { name: "Said", v: k.voice, color: L.ink, ink: L.ink },
            { name: "Typed", v: k.typing, color: L.typed, ink: L.typedInk },
            { name: "Drafted", v: k.draft, color: "rgba(243,226,198,0.4)", ink: L.ink2 },
          ].filter((x) => x.v > 0)
        : [];
      out.push({
        type: "Stack",
        on: { onPress: open("languages") },
        props: { pressOpacity: 0.6 },
        style: { marginTop: GAP },
        children: [
          sectionTitle("How you speak"),
          {
            type: "Stack",
            style: { flexDirection: "row", alignItems: "center", gap: 24, marginTop: 20 },
            children: [
              ring(shareSlices(byScript), 116, String(byScript.length), byScript.length === 1 ? "LANGUAGE" : "LANGUAGES"),
              {
                type: "Stack",
                style: { flex: 1, gap: 16 },
                children: how.length
                  ? how.map((x) => ({
                      type: "Stack",
                      children: [
                        {
                          type: "Stack",
                          style: { flexDirection: "row", justifyContent: "space-between" },
                          children: [
                            label(x.name, { color: x.ink, letterSpacing: 1.2 }),
                            label(`${Math.round((x.v / kTotal) * 100)}%`, { color: x.ink, letterSpacing: 0.6 }),
                          ],
                        },
                        bar((x.v / kTotal) * 100, x.color, 3, { marginTop: 7 }),
                      ],
                    } as Node))
                  : [caption(`${byScript.length} ${byScript.length === 1 ? "language" : "languages"} in the last 30 days.`)],
              },
            ],
          },
        ],
      });
    } else {
      out.push(howYouSpeakNote(s.langCount));
    }
  }

  // Before there is anything to read, the section still says what it will be.
  if (s.empty) out.push(howYouSpeakNote(0));

  // THE DAYS — a calendar of blocks, today ringed, each opening its day.
  const perDay = s.perDay.length ? s.perDay : new Array(30).fill(0);
  out.push({
    type: "Stack",
    style: { marginTop: GAP },
    children: [
      sectionTitle("Days you talked"),
      dayBlocks(perDay, statsDays(perDay.length, tz), s.streakLive, tz),
      {
        type: "Stack",
        on: { onPress: open("active") },
        props: { pressOpacity: 0.6 },
        style: { marginTop: 16, paddingVertical: 4 },
        children: [caption(
          s.daysActive
            ? `${n(s.daysActive)} of the last ${n(s.days)} days. The longest run was ${n(Math.max(st.bestStreak ?? 0, s.streak))}.`
            : `None of the last ${n(s.days)} days yet.`,
        )],
      },
    ],
  });

  // A FEW FIGURES over the same thirty days, each opening the detail behind it.
  out.push(
    label("The last 30 days", { marginTop: GAP }),
    {
      type: "Stack",
      style: { flexDirection: "row", gap: 16, marginTop: 18 },
      children: [
        figure("sessions", "Sessions", n(s.sessions)),
        figure("streak", "Day streak", n(s.streak), s.streak === 1 ? "day" : "days", s.streakLive),
        figure("persession", "Per session", n(s.avgPerSession), "words"),
      ],
    },
    {
      type: "Stack",
      style: { flexDirection: "row", gap: 16, marginTop: 28 },
      children: [
        figure("spoken", "Spoken", s.spokenMinutes ? String(s.spokenMinutes) : "0", "min"),
        figure("voices", "Voices", s.topVoiceShare, s.topVoiceShare === "—" ? "" : "top"),
        figure("dictionary", "Dictionary", s.dictShare, s.dictShare === "—" ? "" : "in use"),
      ],
    },
    {
      type: "Stack",
      on: { onPress: "openHistory" },
      props: { pressOpacity: 0.6 },
      style: { marginTop: 56, alignSelf: "flex-start", paddingVertical: 12 },
      children: [label("Full history", { color: L.ink, textDecorationLine: "underline" })],
    },
    makeItYours(s.room),
  );
  return out;
}

/**
 * THE WAY FROM WHAT YOU DID TO HOW IT IS DONE. The page ends on the one
 * thing here that is not a record: the You tab, where the voice, the words,
 * the languages and the keys are set. In the active voice's own colour, the
 * same card that tab opens with, so it reads as a door to that room. A title
 * and a button, nothing else.
 */
function makeItYours(room: { bg: string; ink: string; dim: string; edge?: string } = PHONE_ROOMS["d-w-zu"]!): Node {
  const go: ActionRef = { kind: "sequence", actions: [
    { kind: "haptic", style: "selection" },
    { kind: "switchTab", tabId: "personality" },
  ] };
  return {
    type: "Stack",
    on: { onPress: go },
    props: { pressOpacity: 0.85 },
    style: {
      marginTop: STATS_SECTION - 40, borderRadius: 22, padding: 22, backgroundColor: room.bg,
      ...(room.edge ? { borderWidth: 1, borderColor: room.edge } : {}),
    },
    children: [
      t("Personalise your experience", "writtenBold", 26, { color: room.ink, letterSpacing: -0.4 }),
      {
        type: "Button",
        props: {
          label: "Les go", variant: "primary",
          labelColor: room.bg, fontSize: 13, fontWeight: "600", tracking: 0.4,
          paddingVertical: 0, paddingHorizontal: 26, radius: 12,
        },
        on: { onPress: go },
        style: { backgroundColor: room.ink, height: 46, alignSelf: "flex-start", marginTop: 22 },
      },
    ],
  };
}

/**
 * Each voice's colour on the phone — the desk's rooms (deskSamples.ts
 * DESK_ROOMS), solid rather than graded: a card the size of a thumb reads a
 * colour, not a gradient. `ink` is the text on it.
 */
export const PHONE_ROOMS: Record<string, { bg: string; ink: string; dim: string; edge?: string }> = {
  "d-w-zu": { bg: "#F3EDE2", ink: "#1B1712", dim: "rgba(27,23,18,0.56)" },
  "d-w-indigo": { bg: "#221F5E", ink: "#F3E2C6", dim: "rgba(243,226,198,0.64)" },
  "d-w-saffron": { bg: "#EFA232", ink: "#1B1712", dim: "rgba(27,23,18,0.6)" },
  "d-w-teal": { bg: "#106A60", ink: "#F3E2C6", dim: "rgba(243,226,198,0.66)" },
  "d-w-rose": { bg: "#B8466A", ink: "#FBF3EA", dim: "rgba(251,243,234,0.7)" },
  "d-w-paper": { bg: "#F6F1E7", ink: "#1B1712", dim: "rgba(27,23,18,0.56)" },
  "d-w-noir": { bg: "#0B0B0B", ink: "#EDEDED", dim: "rgba(237,237,237,0.6)", edge: "rgba(243,226,198,0.12)" },
  "d-w-night": { bg: "#050505", ink: "#FFFFFF", dim: "rgba(255,255,255,0.6)", edge: "rgba(243,226,198,0.12)" },
};

/**
 * A fix, drawn as a proofreader would: what it heard, in the hand and struck
 * through, above the word as it is now written.
 */
export function proofMark(was: string, word: string, size = 18): Node {
  return {
    type: "Stack",
    // Their words, as they spelled them: no capital added (titleCase.ts).
    props: { keepCase: true },
    style: { alignItems: "flex-start" },
    children: [
      ...(was ? [{
        type: "Stack",
        style: { position: "relative", alignSelf: "flex-start" },
        children: [
          t(was, "said", Math.round(size * 0.78), { lineHeight: Math.round(size * 0.95), color: PHONE_LOOK.ink3 }),
          { type: "Stack", style: {
            position: "absolute", left: -2, right: -2, top: "52%", height: 1.5, borderRadius: 1,
            backgroundColor: PHONE_LOOK.typed, transform: [{ rotate: "-4deg" }],
          } },
        ],
      } as Node] : []),
      t(word, "written", size, { lineHeight: Math.round(size * 1.25) }),
    ],
  };
}
