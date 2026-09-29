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
import type { Node } from "../../../shared/types/sdui.js";
import type { UsageSummary } from "../../../shared/types/api.js";
import type { Allowance } from "../usage/allowance.js";
import { LANGUAGE_NAMES as WRITTEN_NAMES } from "../history/writtenIn.js";

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

/** Any text in one of the four faces. */
export function t(content: string, face: keyof typeof PHONE_FONT, size: number, style: Style = {}): Node {
  return {
    type: "Text",
    props: { content },
    style: {
      fontFamily: PHONE_FONT[face], fontWeight: "normal", fontStyle: "normal",
      fontSize: size, lineHeight: Math.round(size * (face === "label" ? 1.25 : 1.4)),
      color: PHONE_LOOK.ink, ...style,
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
  t(content, "written", 18, { lineHeight: 23, ...style });

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
  const w = Math.max(0, Math.min(100, pct));
  return {
    type: "Stack",
    style: { height, backgroundColor: PHONE_LOOK.track, overflow: "hidden", ...style },
    children: [{ type: "Stack", style: { width: `${w.toFixed(1)}%`, height, backgroundColor: color } }],
  };
}

/** Minutes as a person says them: "38 sec", "15 min", "1 h 45". */
export function span(minutes: number): string {
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} sec`;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const n = (v: number) => v.toLocaleString("en-US");
/** Latin letters only, which is all the written face carries. */
const latin = (s: string) => /^[\u0000-ɏ\s]*$/.test(s);

/** One figure: its label, its value; the whole thing opens its panel. */
function figure(id: string, name: string, value: string, unit = "", live = false): Node {
  return {
    type: "Stack",
    on: { onPress: { kind: "setState", path: "openCard", value: id } },
    props: { pressOpacity: 0.6 },
    style: { flex: 1, paddingVertical: 6 },
    children: [
      label(name),
      {
        type: "Stack",
        style: { flexDirection: "row", alignItems: "baseline", marginTop: 8 },
        children: [
          t(value, "writtenLight", 22, { lineHeight: 26, color: live ? PHONE_LOOK.accent : PHONE_LOOK.ink }),
          ...(unit ? [t(` ${unit}`, "ui", 11, { lineHeight: 14, color: PHONE_LOOK.ink3 })] : []),
        ],
      },
    ],
  };
}

/** "How you speak" with nothing to set to size yet — still the way in. */
function howYouSpeakNote(count: number): Node {
  return {
    type: "Stack",
    on: { onPress: { kind: "setState", path: "openCard", value: "languages" } },
    props: { pressOpacity: 0.6 },
    style: { marginTop: PHONE_LOOK.section },
    children: [
      heading("How you speak"),
      caption(count > 0
        ? `${count} ${count === 1 ? "language" : "languages"} this month.`
        : "Each language you speak shows here, at its share.", { marginTop: 6 }),
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
}

/**
 * The Stats tab's page — what used to be a 62 pt number and a grid of eight
 * tiles, as a sentence and a few quiet sections. Every section that has more
 * behind it opens the same panel it always did (`openCard`), exactly once.
 */
export function phoneStatsBody(
  ctx: { tzOffsetMinutes?: number; usage?: UsageSummary; stats?: unknown; personality?: unknown },
  s: PhoneStatsInput,
): Node[] {
  const L = PHONE_LOOK;
  const st = (ctx.stats ?? {}) as {
    topApps?: Array<{ app: string; words: number }>;
    writtenIn?: Array<{ key: string; words: number }>;
    languageWords?: Array<{ language: string; words: number }>;
    bestStreak?: number;
  };
  const tz = Math.max(-840, Math.min(840, Math.round(ctx.tzOffsetMinutes ?? 0)));
  const now = new Date(Date.now() + tz * 60_000);
  const out: Node[] = [label(MONTHS[now.getUTCMonth()]!, { marginBottom: 22 })];

  if (s.empty) {
    out.push(
      t("Nothing here yet.", "writtenLight", 24, { lineHeight: 32 }),
      caption("Say a few things in any app and this fills in: how much you said, where it went, the days you talked.", { marginTop: 10, maxWidth: 300 }),
    );
  } else {
    // THE MONTH, AS ONE SENTENCE — and under it the race it describes.
    const typedMin = s.wordsMonth / 40;
    const saidMin = s.spokenMinutes;
    out.push(sentence(
      saidMin > 0
        ? [`You said ${n(s.wordsMonth)} words this month. Typed, they would have taken `,
           { text: span(typedMin), style: { color: L.typedInk } }, ". Said, ",
           { text: `${span(saidMin)}.`, face: "writtenLightItalic" }]
        : [`You wrote ${n(s.wordsMonth)} words this month. Typed by hand, they would have taken `,
           { text: `${span(typedMin)}.`, style: { color: L.typedInk } }],
      "writtenLight", 24, { lineHeight: 33, letterSpacing: -0.3 },
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
      on: { onPress: { kind: "setState", path: "openCard", value: "minutes" } },
      props: { pressOpacity: 0.6 },
      style: { gap: 12, marginTop: 24, paddingVertical: 4 },
      children: [
        ...(saidMin > 0 ? [lane("Said", saidMin, L.ink, L.ink)] : []),
        lane("Typed", typedMin, L.typed, L.typedInk),
      ],
    });

    // TODAY — a line, and the week as seven dots with today ringed.
    // The caller's own day, when the server counted it; else the last bucket.
    const todayWords = ctx.usage?.today?.words ?? s.perDay[s.perDay.length - 1] ?? 0;
    const todaySec = ctx.usage?.today?.audioSeconds ?? 0;
    const week = s.perDay.slice(-7);
    while (week.length < 7) week.unshift(0);
    out.push({
      type: "Stack",
      style: { marginTop: L.section },
      children: [
        {
          type: "Stack",
          style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
          children: [
            label("Today"),
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
              "writtenLight", 19, { lineHeight: 27 }, { marginTop: 10 })
          : t("Nothing yet today.", "writtenLight", 19, { lineHeight: 27, marginTop: 10, color: L.ink2 }),
      ],
    });
  }

  // WORDS LEFT — a line and a thread. Opens where the words came from.
  if (s.allow) {
    const a = s.allow;
    out.push({
      type: "Stack",
      on: { onPress: { kind: "setState", path: "openCard", value: "words" } },
      props: { pressOpacity: 0.6 },
      style: { marginTop: s.empty ? L.section : 40 },
      children: [
        label(s.paid ? "Words this month" : "Words left"),
        s.paid
          ? t(`${n(a.used)}. No limit on your plan.`, "writtenLight", 19, { lineHeight: 27, marginTop: 10 })
          : t(`${n(a.remaining)} of ${n(a.total)}, back on the 1st.`, "writtenLight", 19, { lineHeight: 27, marginTop: 10 }),
        s.paid
          ? bar(s.paidPct, L.ink, 3, { marginTop: 12 })
          : bar(a.total ? (a.remaining / a.total) * 100 : 0, L.ink, 3, { marginTop: 12 }),
        ...(!s.paid && a.earned > 0 ? [caption(
          a.maxed ? `${n(a.earned)} earned, the most there is this month.` : `${n(a.earned)} of these you earned by turning up.`,
          { marginTop: 10 },
        )] : []),
      ],
    });
  }

  if (!s.empty) {
    // HOW YOU SPEAK — each language set to its share, named as it is written.
    const byScript = st.writtenIn?.length
      ? st.writtenIn.map((w) => ({ name: WRITTEN_NAMES[w.key] ?? w.key, words: w.words }))
      : (st.languageWords ?? []).filter((l) => l.language !== "auto").map((l) => ({ name: WRITTEN_NAMES[l.language] ?? l.language, words: l.words }));
    const total = byScript.reduce((sum, l) => sum + l.words, 0);
    if (total > 0) {
      const sizes = [36, 27, 20, 17];
      out.push({
        type: "Stack",
        on: { onPress: { kind: "setState", path: "openCard", value: "languages" } },
        props: { pressOpacity: 0.6 },
        style: { marginTop: L.section },
        children: [
          heading("How you speak"),
          ...byScript.slice(0, 4).map((l, i) => ({
            type: "Stack",
            style: {
              flexDirection: "row", alignItems: "baseline", justifyContent: "space-between",
              paddingVertical: 10, ...(i < Math.min(4, byScript.length) - 1 ? { borderBottomWidth: 1, borderBottomColor: L.rule } : {}),
              ...(i === 0 ? { marginTop: 6 } : {}),
            },
            children: [
              latin(l.name)
                ? t(l.name, "writtenLight", sizes[i]!, { lineHeight: Math.round(sizes[i]! * 1.15), letterSpacing: -0.4 })
                : { type: "Text", props: { content: l.name }, style: { fontSize: Math.min(20, sizes[i]!), lineHeight: Math.round(Math.min(20, sizes[i]!) * 1.5), color: L.ink } } as Node,
              label(`${Math.round((l.words / total) * 100)}%`, { color: L.ink2 }),
            ],
          } as Node)),
        ],
      });
    } else {
      out.push(howYouSpeakNote(s.langCount));
    }

    // WHERE THE WORDS WENT — hairlines, a short mark each.
    const apps = (st.topApps ?? []).filter((a) => a.words > 0).slice(0, 4);
    const appTotal = apps.reduce((sum, a) => sum + a.words, 0);
    if (appTotal > 0) {
      out.push({
        type: "Stack",
        style: { marginTop: L.section },
        children: [
          heading("Where the words went", { marginBottom: 8 }),
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

  // Before there is anything to read, the section still says what it will be.
  if (s.empty) out.push(howYouSpeakNote(0));

  // THE DAYS — a small square for each, today ringed. Opens the pattern.
  const month = s.perDay.length ? s.perDay : new Array(30).fill(0);
  out.push({
    type: "Stack",
    on: { onPress: { kind: "setState", path: "openCard", value: "active" } },
    props: { pressOpacity: 0.6 },
    style: { marginTop: L.section },
    children: [
      heading("Days you talked"),
      {
        type: "Stack",
        style: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16, maxWidth: 300 },
        children: month.map((v, i) => ({
          type: "Stack",
          style: {
            width: 12, height: 12, borderRadius: 3, borderWidth: 1,
            borderColor: v > 0 ? L.ink : "rgba(243,226,198,0.2)",
            backgroundColor: v > 0 ? L.ink : "transparent",
            ...(i === month.length - 1 ? { transform: [{ scale: 1.2 }] } : {}),
          },
        })),
      },
      caption(
        s.daysActive
          ? `${n(s.daysActive)} of the last ${n(s.days)} days. The longest run was ${n(Math.max(st.bestStreak ?? 0, s.streak))}.`
          : `None of the last ${n(s.days)} days yet.`,
        { marginTop: 14 },
      ),
    ],
  });

  // A FEW FIGURES, each opening the detail behind it.
  out.push(
    {
      type: "Stack",
      style: { flexDirection: "row", gap: 16, marginTop: L.section },
      children: [
        figure("sessions", "Sessions", n(s.sessions)),
        figure("streak", "Day streak", n(s.streak), s.streak === 1 ? "day" : "days", s.streakLive),
        figure("persession", "Per session", n(s.avgPerSession), "words"),
      ],
    },
    {
      type: "Stack",
      style: { flexDirection: "row", gap: 16, marginTop: 24 },
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
      style: { marginTop: 44, alignSelf: "flex-start", paddingVertical: 12 },
      children: [label("Full history", { color: L.ink, textDecorationLine: "underline" })],
    },
  );
  return out;
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
