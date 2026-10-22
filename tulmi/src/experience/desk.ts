/**
 * THE DESK — Tailzu's own pages for a desktop window.
 *
 * The phone's screens are drawn for a column and a thumb, and a window framed
 * around them looked like a phone app on a monitor. These are drawn for the
 * window: a masthead with the tabs across the top, pages that run its width,
 * and one idea on every page — what was SAID, in a hand, above what was
 * WRITTEN, in type. That picture is the product's whole claim, and no other
 * dictation app shows it.
 *
 * Sent only to a desktop that declares DeskShell (desktop/sdui.js), so an
 * older installer keeps the rail and the phone's screens. Everything here is
 * composed from the renderer's plain nodes and its named `d-` styles
 * (desktop/app.html); a page changes with a deploy, never an installer.
 *
 * Honest by construction. Every number is one the server holds: words and
 * speaking time from the usage meter, notes from history, the languages read
 * from the written text itself (history/writtenIn.ts). Typing time is the
 * product's standing assumption of 40 words a minute, and the page says so.
 */
import type { ActionRef, Node, NavigationShell, ScreenResponse } from "../../../shared/types/sdui.js";
import { SDUI_SCHEMA_VERSION } from "../../../shared/types/sdui.js";
import type { HistoryEntry, Note, NoteSummary, PaywallPlan, Personality, UsageSummary } from "../../../shared/types/api.js";
import type { StatsForUser } from "../history/store.js";
import type { Allowance } from "../usage/allowance.js";
import { LANGUAGE_NAMES } from "../history/writtenIn.js";
import { applyPresetOverrides, TONE_LABELS } from "./personalityPresets.js";
import { DESK_CONTEXTS, DESK_ROOMS, DESK_SAMPLES } from "./deskSamples.js";
import { span } from "./phoneLook.js";
import { DEFAULT_TTS_VOICE, TTS_VOICES, isValidTtsVoice, ttsVoiceById } from "./ttsVoices.js";
import { nicknameOf } from "./assistantName.js";
import type { AssistantTask, ConnectorInfo } from "../../../shared/types/api.js";
import type { AssistantView } from "../connectors/list.js";
import { en as w } from "../connectors/words.js";

/** Words a minute a person types on a keyboard — the same figure the stats
 *  screen's "minutes saved" has always used (history/store.ts). */
const TYPING_WPM = 40;

export const DESK_SCREENS = new Set(["desk_today", "desk_history", "desk_notes", "desk_note", "desk_insights", "desk_day", "desk_app", "desk_words", "desk_voices", "desk_train", "desk_settings", "desk_voice_read", "desk_assistant_name", "desk_plan", "desk_tasks"]);

/** The desk's tabs, in the masthead. Settings and Plan are reached from its
 *  right-hand side, not from a tab. */
export const DESK_NAV: NavigationShell = {
  kind: "tabs",
  tabs: [
    { id: "desk_today", title: "Today", screenId: "desk_today" },
    { id: "desk_insights", title: "Insights", screenId: "desk_insights" },
    { id: "desk_words", title: "Words", screenId: "desk_words" },
    { id: "desk_voices", title: "Voices", screenId: "desk_voices" },
    { id: "desk_train", title: "Train", screenId: "desk_train" },
  ],
  initialTabId: "desk_today",
};

/** The tabs for a window, with Notes after Today for one that can take them
 *  (it declared "DeskNotes" and has the hotkey), and Tasks after that for one
 *  that can show the assistant's (it declared "DeskConnectors"). */
export function deskNav(notes: boolean, tasks = false): NavigationShell {
  if ((!notes && !tasks) || DESK_NAV.kind !== "tabs") return DESK_NAV;
  const [today, ...rest] = DESK_NAV.tabs;
  return { ...DESK_NAV, tabs: [
    today!,
    ...(notes ? [{ id: "desk_notes", title: "Notes", screenId: "desk_notes" }] : []),
    ...(tasks ? [{ id: "desk_tasks", title: w("a4.h"), screenId: "desk_tasks" }] : []),
    ...rest,
  ] };
}

/** What a desk page is built from. A subset of the catalog's ScreenContext,
 *  named here so this module does not import the catalog it is imported by. */
export interface DeskContext {
  personality: Personality;
  history?: HistoryEntry[];
  usage?: UsageSummary;
  stats?: StatsForUser;
  allowance?: Allowance | null;
  entitlement?: { store?: string; expiresAt?: string; renews?: boolean } | null;
  email?: string;
  phone?: string;
  name?: string;
  tzOffsetMinutes?: number;
  /** Navigation params from the window (fetchScreen sends cur.params): which
   *  day square or app row a detail page was opened from. */
  params?: Record<string, string | number | boolean | undefined>;
  /** The paywall's plans, passed in for the same reason. */
  plans?: PaywallPlan[];
  /** The billing flags the bootstrap would send (manage URL etc.). */
  manageUrl?: string;
  /** This person's network, at the growth they have earned — built by the
   *  catalog, and only for a window that can show it on a page (DeskField). */
  field?: Node;
  /** A newer build published for this window's OS (desktopRelease.ts). */
  update?: { version: string; url: string; sha512?: string } | null;
  /** This build installs its own update in place (it said "DeskSelfUpdate"). */
  selfUpdate?: boolean;
  /** The Notes page's list, newest first. */
  notes?: NoteSummary[];
  /** The note page's note; null when it is gone. */
  note?: Note | null;
  /** This window has the notes hotkey (it said "DeskNotes"). */
  notesHotkey?: boolean;
  /** Tailzu is free for everyone right now (FREE_FOR_ALL): no plan, no price. */
  free?: boolean;
  /** This window can open the Mac's permission for the computer's sound
   *  (it said "DeskSystemAudio"). */
  allowSystemAudio?: boolean;
  /** This window draws Ask's one-time setup card (it said "DeskAskSetup",
   *  which it says only while Ask is on there): where the card's privacy
   *  link goes, and the computer it is on ("mac", "windows"), when known. */
  askSetup?: { privacyUrl: string; os?: string };
  /** The assistant's connected apps and tasks (CONNECTORS is on, and this
   *  window said "DeskConnectors"): the apps for Settings, the tasks for the
   *  Tasks page. Absent, and neither is drawn. */
  assistant?: AssistantView;
}

// ---- nodes ---------------------------------------------------------------------

type Style = Record<string, unknown>;

/**
 * THE DESK'S TYPE AND AIR — lighter than the first release, set from here.
 *
 * app.html's classes carry the sizes the 0.2 installer shipped with, and they
 * read bulky: 40pt titles, 19pt notes, tight pages. Every node below passes
 * through this table, and an inline style wins over a class, so the pages are
 * refined from the server with no installer: one step smaller everywhere,
 * wider margins, more room between sections. Explicit styles on a node still
 * win over the table.
 */
const DESK_TYPE: Record<string, Style> = {
  "d-h1": { fontSize: 30, lineHeight: "36px" },
  "d-h2": { fontSize: 19, lineHeight: "25px" },
  "d-statement": { fontSize: 26, lineHeight: "35px", maxWidth: "32ch" },
  "d-lede": { fontSize: 13, lineHeight: "21px" },
  "d-eyebrow": { fontSize: 10 },
  "d-count": { fontSize: 10.5 },
  "d-said": { fontSize: 16, lineHeight: "22px" },
  "d-written": { fontSize: 16.5, lineHeight: "25px" },
  "d-margin": { fontSize: 10, lineHeight: "16px" },
  "d-margin-strong": { fontSize: 10, lineHeight: "16px" },
  "d-link": { fontSize: 10.5 },
  "d-btn": { fontSize: 10.5, paddingTop: 9, paddingBottom: 9, paddingLeft: 15, paddingRight: 15 },
  "d-price": { fontSize: 26, lineHeight: "30px" },
  "d-k": { fontSize: 13, lineHeight: "19px" },
  "d-v": { fontSize: 15, lineHeight: "22px" },
  "d-num": { fontSize: 11 },
  "d-lane-label": { fontSize: 10 },
  "d-input": { fontSize: 16 },
  "d-seg-item": { fontSize: 10 },
  "d-world-text": { fontSize: 16, lineHeight: "23px" },
  "d-world-name": { fontSize: 9.5 },
  "d-world-use": { fontSize: 9.5 },
  "d-world": { minHeight: 170, paddingTop: 18, paddingBottom: 18, paddingLeft: 18, paddingRight: 18 },
  // The page and the room: wider margins, a narrower column, more air.
  "d-page": { maxWidth: 920, paddingTop: 52, paddingLeft: 56, paddingRight: 56, paddingBottom: 96 },
  "d-room-inner": { maxWidth: 920, paddingTop: 40, paddingLeft: 56, paddingRight: 56, paddingBottom: 34 },
};
const typeFor = (cls?: string): Style =>
  Object.assign({}, ...String(cls ?? "").split(/\s+/).map((c) => DESK_TYPE[c] ?? {}));
const styled = (cls: string | undefined, style?: Style): Style | undefined => {
  const merged = { ...typeFor(cls), ...(style ?? {}) };
  return Object.keys(merged).length ? merged : undefined;
};

const text = (content: string, cls: string, style?: Style): Node => {
  const st = styled(cls, style);
  return { type: "Text", props: { content, cls }, ...(st ? { style: st } : {}) };
};
const stack = (children: Node[], style: Style = {}, cls?: string, extra: Partial<Node> = {}): Node =>
  ({ type: "Stack", props: cls ? { cls } : {}, style: { ...typeFor(cls), ...style }, children, ...extra });
const row = (children: Node[], style: Style = {}, cls?: string, extra: Partial<Node> = {}): Node =>
  stack(children, { direction: "row", ...style }, cls, extra);
const inline = (children: Node[], cls: string, style: Style = {}): Node => stack(children, { display: "block", ...style }, cls);
const link = (label: string, onPress: ActionRef, cls = "d-link", style?: Style): Node => {
  const st = styled(cls, style);
  return { type: "Button", props: { label, cls }, on: { onPress }, ...(st ? { style: st } : {}) };
};

/**
 * A Razorpay subscription's end of the Plan row: it is cancelled here in the
 * app, and once it has been, the row says when Unlimited ends instead.
 * Undefined for any other store, which keeps its Manage link.
 */
function razorpayPlan(ctx: DeskContext): Node | undefined {
  if (String(ctx.entitlement?.store ?? "").toLowerCase() !== "razorpay") return undefined;
  if (ctx.entitlement?.renews !== false) return link("Cancel", { kind: "navigate", screenId: "cancel_subscription" });
  const end = ctx.entitlement?.expiresAt ? Date.parse(ctx.entitlement.expiresAt) : NaN;
  return text(Number.isFinite(end)
    ? `Ends ${new Date(end).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
    : "Cancelled", "d-margin");
}
const keys = (source: "tap" | "hotkey" | "notes", small = false): Node => ({ type: "Keys", props: { source, cls: small ? "d-keys-small" : "" }, ...(small ? { style: {} } : {}) });
const sw = (key: string, labelText: string): Node => ({
  type: "Switch", props: { cls: "d-switch", accessibilityLabel: labelText },
  bind: { value: "desktop." + key }, on: { onChange: { kind: "desktop.config", key, value: "$toggle" } },
});
const page = (children: Node[], style: Style = {}): Node => stack(children, { gap: 0, ...style }, "d-page");

function screen(screenId: string, title: string, children: Node[], state: Record<string, unknown> = {}): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId,
    title,
    look: "desk",
    root: { type: "Screen", props: { layout: "full" }, children },
    state,
    cacheTtlSeconds: 0,
  };
}

// ---- time and numbers ------------------------------------------------------------

const tzMs = (ctx: DeskContext) => Math.max(-840, Math.min(840, Math.round(ctx.tzOffsetMinutes ?? 0))) * 60_000;
const local = (ctx: DeskContext, ms: number) => new Date(ms + tzMs(ctx));
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dateLine = (d: Date) => `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
function clock(d: Date): string {
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
const n = (v: number) => Math.round(v).toLocaleString("en-US");
const APP_NAMES: Record<string, string> = { Desktop: "Computer", Generic: "" };
// Own keys only: an app is whatever the client named, "constructor" included.
const appName = (a?: string) => (a && Object.hasOwn(APP_NAMES, a) ? APP_NAMES[a]! : a || "");

// ---- the race: said against typed --------------------------------------------------

/** Two lanes, the typed one always the full width, the said one its share. */
function race(saidMin: number, typedMin: number, big = false): Node {
  const share = typedMin > 0 ? Math.max(2, Math.min(100, (saidMin / typedMin) * 100)) : 0;
  const lane = (lbl: string, pct: number, value: string, fill: string, color?: string): Node =>
    row([
      text(lbl, "d-lane-label", { width: big ? 70 : 52, flex: "none", ...(color ? { color } : {}) }),
      stack([stack([], { width: `${pct}%`, height: "100%" }, fill)], { flex: 1, height: big ? 12 : 6, minWidth: 0 }, "d-lane-t"),
      text(value, "d-lane-label", { width: big ? 80 : 58, flex: "none", textAlign: "right", ...(color ? { color } : {}) }),
    ], { align: "center", gap: 10 });
  return stack([
    lane("Said", share, span(saidMin), "d-lane-said"),
    lane("Typed", 100, span(typedMin), "d-lane-typed", "var(--d-typed)"),
  ], { gap: big ? 14 : 10, maxWidth: big ? 720 : undefined });
}

// ---- CHARTS ------------------------------------------------------------------------
//
// THE DESK'S CHARTS, FROM THE RENDERER'S PLAIN NODES — no installer, no canvas.
//
// A donut is a circle whose `backgroundImage` is a conic gradient: the renderer
// turns any camelCase style key into its CSS property (desktop sdui.js css()),
// so the gradient passes straight through, where `background` alone would land
// on background-color. A line or an area is the renderer's one-path `SVG` node,
// layered in one box; bars and columns are stacks.
//
// COLOUR, COMPUTED RATHER THAN CHOSEN. One categorical order, run through the
// data-viz validator against BOTH desk surfaces (#FFFFFF and the dark sheet
// #151210): every check passes in both, so the same four hexes serve both
// themes and nothing waits on a build. A donut wraps — its last slice touches
// its first — and with a fifth colour the wrap pair failed, so a part-to-whole
// carries at most four colours and folds the rest into Other. Other is a
// neutral mixed from the theme's own ink and sheet, never a slot. Text never
// wears a series colour: the swatch beside it carries the identity, and every
// part's value is written in its legend (the renderer has no hover layer, so
// the legend is the table).

const SERIES = ["#C97A12", "#00977F", "#4B5BD0", "#D6456E"] as const;
const OTHER = "color-mix(in srgb, var(--d-ink) 22%, var(--d-sheet))";
/** The one point that matters in a single series — today, this hour. */
const ACCENT = SERIES[0];
/** The figures' face: data reads in the UI sans, proportional at size. */
const NUMBER: Style = { fontFamily: "var(--f-ui)", fontWeight: 500, letterSpacing: "-.02em", color: "var(--d-ink)" };

interface Part { label: string; value: number; color?: string; press?: ActionRef; value2?: string }

/** At most four coloured parts, biggest first; the rest become Other. A part
 *  that already names its colour (an app's slot across the desk) keeps it. */
function foldParts(rows: Part[], max = 4): Part[] {
  const sorted = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, max).map((r, i) => ({ ...r, color: r.color ?? SERIES[i] }));
  const tail = sorted.slice(max);
  const rest = tail.reduce((s, r) => s + r.value, 0);
  return rest > 0 ? [...head, { label: "Other", value: rest, color: OTHER }] : head;
}

const pct = (v: number, total: number) => (total > 0 ? Math.round((v / total) * 100) : 0);
const swatch = (color: string, size = 10): Node => stack([], { width: size, height: size, radius: 3, background: color, flex: "none" });

/**
 * THE SPEAKERS' COLOURS. A note's page gives every voice one colour, the same
 * wherever it appears: the dot by its name at the top, its box in "What
 * mattered", its swatch, slice and lane in the numbers. The colour follows
 * the speaker, never their rank, so a quiet voice keeps its colour whoever
 * talked most.
 *
 * "You" is always the desk's accent. "Speaker n" takes slot n of six, so
 * Speaker 1 is teal on every note, and Speaker 7 is teal again: past six the
 * palette repeats, and the name written beside every colour tells them apart.
 * "Others" (call voices the diarizer could not split) is a neutral, not a
 * person's colour. A label of any other shape is placed by its letters, so it
 * too keeps one colour.
 *
 * You and Speakers 1–3 are the four validated SERIES hues, so the common
 * meeting (four voices or fewer) is the donut's validated set exactly. The
 * three after them were picked by the data-viz validator against both desk
 * surfaces (#FFFFFF, #151210): lightness, chroma and 3:1 contrast pass in
 * both, and the closest pair across all seven is ΔE 13 under normal vision,
 * which is why a colour is never the only thing that says who.
 *
 * A box is a TINT, mixed from the speaker's colour into the theme's own sheet
 * (`color-mix`, as the charts already do), so one value is a soft wash on the
 * light sheet and a quiet glow on the dark one, and nothing waits on a build.
 */
const YOU_COLOR = SERIES[0];
export const SPEAKER_COLORS = ["#00977F", "#4B5BD0", "#D6456E", "#A06DBE", "#248FCC", "#A34D16"] as const;
const UNSPLIT = "color-mix(in srgb, var(--d-ink) 40%, var(--d-sheet))";
export function speakerColor(label: string): string {
  if (label === "You") return YOU_COLOR;
  if (!label || label === "Others") return UNSPLIT;
  const m = /^Speaker (\d+)$/.exec(label);
  let i = m ? Number(m[1]) - 1 : 0;
  if (!m) for (const ch of label) i = (i * 31 + ch.charCodeAt(0)) % 9973;
  return SPEAKER_COLORS[((i % SPEAKER_COLORS.length) + SPEAKER_COLORS.length) % SPEAKER_COLORS.length]!;
}
/** A colour washed into the sheet: `pct` of it, the rest the theme's paper. */
const tint = (color: string, pctOf: number) => `color-mix(in srgb, ${color} ${pctOf}%, var(--d-sheet))`;
/** A round dot of a speaker's colour, for beside their name. */
const speakerDot = (color: string, size = 8): Node => stack([], { width: size, height: size, radius: "50%", background: color, flex: "none" });

/**
 * A DONUT: part-to-whole at a glance, four colours and Other at most. A 2px gap
 * in the sheet's colour separates neighbouring slices (no borders), and the
 * hole carries the whole's figure, so the chart says its total without a key.
 */
function donut(ps: Part[], o: { size?: number; center?: { value: string; label: string } } = {}): Node {
  const size = o.size ?? 152;
  const total = ps.reduce((s, x) => s + x.value, 0) || 1;
  const gap = ps.length > 1 ? (2 / (Math.PI * size)) * 100 : 0;   // 2px of the circumference
  let acc = 0;
  const stops: string[] = [];
  for (const p of ps) {
    const a = (acc / total) * 100;
    acc += p.value;
    const b = (acc / total) * 100;
    const end = Math.max(a, b - gap);
    stops.push(`${p.color ?? OTHER} ${a.toFixed(2)}% ${end.toFixed(2)}%`);
    if (gap) stops.push(`var(--d-sheet) ${end.toFixed(2)}% ${b.toFixed(2)}%`);
  }
  const hole = Math.round(size * 0.66);
  return stack([
    stack(o.center ? [
      text(o.center.value, "d-k", { ...NUMBER, fontSize: Math.round(size * 0.16), lineHeight: "1" }),
      text(o.center.label, "d-margin", { marginTop: 4, textAlign: "center" }),
    ] : [], { width: hole, height: hole, radius: "50%", background: "var(--d-sheet)", align: "center", justify: "center" }),
  ], {
    width: size, height: size, radius: "50%", flex: "none", align: "center", justify: "center",
    backgroundImage: `conic-gradient(${stops.join(", ")})`,
  });
}

/** The legend as a table: swatch, name, share, and the count itself. A part
 *  that opens a page carries its own tap. */
function legend(ps: Part[], unit = ""): Node {
  const total = ps.reduce((s, x) => s + x.value, 0) || 1;
  return stack(ps.map((p) => {
    const line = row([
      swatch(p.color ?? OTHER),
      text(p.label, "d-k", { fontWeight: 500, fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
      text(`${pct(p.value, total)}%`, "d-num", { width: 40, textAlign: "right", color: "var(--d-ink)" }),
      text(p.value2 ?? `${n(p.value)}${unit ? ` ${unit}` : ""}`, "d-num", { minWidth: 48, textAlign: "right", flex: "none", whiteSpace: "nowrap" }),
    ], { align: "center", gap: 8, paddingTop: 8, paddingBottom: 8 }, "d-rule-bottom");
    return p.press ? { ...line, on: { onPress: p.press } } : line;
  }), { flex: 1, minWidth: 168 });
}

/** Donut beside its legend — the desk's part-to-whole block. Sized to sit
 *  beside its key in half the page; it stacks only in a narrow window. */
function donutWithLegend(ps: Part[], center: { value: string; label: string }, unit = ""): Node {
  return row([donut(ps, { center, size: 128 }), legend(ps, unit)], { gap: 24, align: "center", marginTop: 20, flexWrap: "wrap" });
}

/** One 100% bar split into its parts — for a split of two or three, where a
 *  donut would be a fuss. Each part's share is written under its swatch. */
function splitBar(ps: Part[]): Node {
  const total = ps.reduce((s, x) => s + x.value, 0) || 1;
  const segs = ps.map((p, i) => stack([], {
    flex: Math.max(0.0001, p.value / total), height: 10, background: p.color ?? OTHER,
    borderTopLeftRadius: i === 0 ? 4 : 0, borderBottomLeftRadius: i === 0 ? 4 : 0,
    borderTopRightRadius: i === ps.length - 1 ? 4 : 0, borderBottomRightRadius: i === ps.length - 1 ? 4 : 0,
  }));
  return stack([
    row(segs, { gap: 2, marginTop: 16 }),
    row(ps.map((p) => row([swatch(p.color ?? OTHER, 9), text(`${p.label} · ${pct(p.value, total)}%`, "d-num", { color: "var(--d-ink)" })], { gap: 7, align: "center" })),
      { gap: 20, marginTop: 12, flexWrap: "wrap" }),
  ]);
}

// SVG geometry. The one-path SVG node draws in its own viewBox; a chart is a
// stack of them in one box, the first in flow (its width sets the box, its
// viewBox's aspect its height), the rest laid exactly over it.
const f1 = (v: number) => (Math.round(v * 10) / 10).toString();
function svgLayer(d: string, vb: string, o: { stroke?: string; fill?: string; width?: number; color: string; over?: boolean; opacity?: number }): Node {
  return {
    type: "SVG",
    props: { d, viewBox: vb, stroke: o.stroke ?? "none", fill: o.fill ?? "none", strokeWidth: o.width ?? 2 },
    style: {
      color: o.color, width: "100%",
      ...(o.over ? { position: "absolute", left: 0, top: 0, height: "100%" } : {}),
      ...(o.opacity != null ? { opacity: o.opacity } : {}),
    },
  };
}
const dot = (cx: number, cy: number, r: number) =>
  `M${f1(cx - r)},${f1(cy)}a${f1(r)},${f1(r)} 0 1,0 ${f1(2 * r)},0a${f1(r)},${f1(r)} 0 1,0 ${f1(-2 * r)},0`;

/** A monotone curve through the points (Fritsch–Carlson): it never swings
 *  past a point, so a quiet day never dips below zero on the way to a busy one. */
function smoothPath(pts: Array<[number, number]>): string {
  const N = pts.length;
  if (N === 0) return "";
  if (N === 1) return `M${f1(pts[0]![0])},${f1(pts[0]![1])}`;
  const x = pts.map((p) => p[0]), y = pts.map((p) => p[1]);
  const dx: number[] = [], m: number[] = [];
  for (let i = 0; i < N - 1; i++) { dx[i] = x[i + 1]! - x[i]!; m[i] = (y[i + 1]! - y[i]!) / (dx[i] || 1); }
  const t: number[] = new Array(N).fill(0);
  t[0] = m[0]!; t[N - 1] = m[N - 2]!;
  for (let i = 1; i < N - 1; i++) t[i] = m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2;
  for (let i = 0; i < N - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i]! / m[i]!, b = t[i + 1]! / m[i]!, s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]!; t[i + 1] = k * b * m[i]!; }
  }
  let d = `M${f1(x[0]!)},${f1(y[0]!)}`;
  for (let i = 0; i < N - 1; i++) {
    const h = dx[i]! / 3;
    d += `C${f1(x[i]! + h)},${f1(y[i]! + t[i]! * h)} ${f1(x[i + 1]! - h)},${f1(y[i + 1]! - t[i + 1]! * h)} ${f1(x[i + 1]!)},${f1(y[i + 1]!)}`;
  }
  return d;
}

/**
 * A TREND: one series as a 2px line over a 10% wash, solid hairline guides,
 * the average as a labelled reference, and the point that matters (today) as
 * an 8px dot in the accent with a ring of the sheet around it. Labelled
 * selectively — the peak, the average, the end — never a number on every day.
 * Ticks under it name the first, middle and last days.
 */
function trend(values: number[], o: { ticks?: string[]; mark?: number; unit?: string; height?: number; avg?: boolean } = {}): Node {
  const W = 760, H = o.height ?? 170, top = 18, bottom = 8, inset = 8;   // room for the end dot and its ring
  const vals = values.length ? values : [0];
  const max = Math.max(1, ...vals);
  const span = Math.max(1, vals.length - 1);
  const X = (i: number) => (vals.length === 1 ? W / 2 : inset + (i / span) * (W - 2 * inset));
  const Y = (v: number) => top + (1 - v / max) * (H - top - bottom);
  const pts = vals.map((v, i) => [X(i), Y(v)] as [number, number]);
  const line = smoothPath(pts);
  const area = `${line}L${f1(X(vals.length - 1))},${f1(H - bottom)}L${f1(X(0))},${f1(H - bottom)}Z`;
  const vb = `0 0 ${W} ${H}`;
  const grid = [0, 0.5, 1].map((q) => `M0,${f1(top + q * (H - top - bottom))}H${W}`).join("");
  const active = vals.filter((v) => v > 0);
  const avg = active.length ? active.reduce((s, v) => s + v, 0) / active.length : 0;
  const mark = o.mark ?? vals.length - 1;
  const [mx, my] = pts[Math.max(0, Math.min(pts.length - 1, mark))]!;
  const peak = vals.indexOf(max);
  const layers: Node[] = [
    svgLayer(grid, vb, { stroke: "currentColor", width: 1, color: "var(--d-rule)" }),
    svgLayer(area, vb, { fill: "currentColor", color: "var(--d-ink)", over: true, opacity: 0.08 }),
    ...(o.avg !== false && avg > 0 ? [svgLayer(`M0,${f1(Y(avg))}H${W}`, vb, { stroke: "currentColor", width: 1, color: "var(--d-ink3)", over: true })] : []),
    svgLayer(line, vb, { stroke: "currentColor", width: 2, color: "var(--d-ink)", over: true }),
    svgLayer(dot(mx, my, 6), vb, { fill: "currentColor", color: "var(--d-sheet)", over: true }),
    svgLayer(dot(mx, my, 4), vb, { fill: "currentColor", color: ACCENT, over: true }),
  ];
  // Direct labels, placed by percentage over the box so they ride the drawing.
  const lbl = (s: string, x: number, y: number, right = false): Node => text(s, "d-margin", {
    position: "absolute", top: `${((y / H) * 100).toFixed(1)}%`, transform: "translateY(-120%)",
    ...(right ? { right: `${(100 - (x / W) * 100).toFixed(1)}%` } : { left: `${((x / W) * 100).toFixed(1)}%` }),
    whiteSpace: "nowrap", color: "var(--d-ink2)", background: "var(--d-sheet)", paddingLeft: 3, paddingRight: 3,
  });
  const unit = o.unit ?? "words";
  const labels: Node[] = [];
  if (max > 1) labels.push(lbl(`Peak ${n(max)} ${unit}`, Math.min(X(peak), W * 0.78), Y(max)));
  if (o.avg !== false && avg > 0) labels.push(lbl(`Average ${n(avg)}`, W, Y(avg), true));
  const ticks = o.ticks ?? [];
  return stack([
    stack([...layers, ...labels], { position: "relative", width: "100%" }),
    ...(ticks.length ? [row(ticks.map((t) => text(t, "d-margin")), { justify: "between", marginTop: 8 })] : []),
  ], { width: "100%", maxWidth: W, marginTop: 18 });
}

/**
 * COLUMNS: one per bucket, grown from one baseline, ≤ 24px wide with a 4px
 * rounded end and a square foot. One series in ink; the buckets that matter
 * (now, today) in the accent. Ticks under it name a few buckets, not all.
 */
function columns(values: number[], o: { height?: number; highlight?: number[]; ticks?: string[]; labels?: string[]; press?: (i: number) => ActionRef | undefined } = {}): Node {
  const H = o.height ?? 96;
  const max = Math.max(1, ...values);
  const hi = new Set(o.highlight ?? []);
  const cols = values.map((v, i) => {
    const h = v > 0 ? Math.max(3, Math.round((v / max) * H)) : 0;
    const press = o.press?.(i);
    const col = stack(h ? [stack([], {
      height: h, width: "100%", maxWidth: 24, background: hi.has(i) ? ACCENT : "var(--d-ink)",
      borderTopLeftRadius: 4, borderTopRightRadius: 4,
    })] : [], { flex: 1, minWidth: 0, height: H, justify: "end", align: "center" });
    return press && v > 0 ? { ...col, on: { onPress: press } } : col;
  });
  return stack([
    row(cols, { gap: 3, align: "end", height: H }),
    stack([], { height: 1, background: "var(--d-rule)" }),
    ...(o.labels?.length
      ? [row(o.labels.map((t) => text(t, "d-margin", { flex: 1, minWidth: 0, textAlign: "center", whiteSpace: "nowrap" })), { gap: 3, marginTop: 8 })]
      : o.ticks?.length ? [row(o.ticks.map((t) => text(t, "d-margin")), { justify: "between", marginTop: 8 })] : []),
  ], { width: "100%", marginTop: 18 });
}

/**
 * A STAT TILE: the figure in the UI sans at size (proportional), a label over
 * it, and a line under it that says what it is against. On the room the ink
 * is the room's cream.
 */
function statTile(label: string, value: string, sub?: string, onRoom = false, big = false): Node {
  return stack([
    text(label, "d-eyebrow", onRoom ? { color: "rgba(243,226,198,.62)" } : {}),
    text(value, "d-k", { ...NUMBER, fontSize: big ? 44 : 30, lineHeight: big ? "48px" : "34px", marginTop: 8, ...(onRoom ? { color: "#F6EBD9" } : {}) }),
    ...(sub ? [text(sub, "d-margin", { marginTop: 6, ...(onRoom ? { color: "rgba(243,226,198,.55)" } : {}) })] : []),
  ], { minWidth: 120, flex: 1 });
}

/** A 30-day run laid out as a calendar — weekdays down, weeks across — each
 *  day's ink deepening with its words (one hue, light to dark). An empty day
 *  is an outline; today wears a dashed ring; a day with words opens its page. */
function heatmap(values: number[], endDate: Date, o: { press?: (i: number) => ActionRef | undefined } = {}): Node {
  const N = values.length;
  const max = Math.max(1, ...values);
  const start = new Date(endDate.getTime() - (N - 1) * 86_400_000);
  const lead = (start.getUTCDay() + 6) % 7;                     // Monday first
  const weeks = Math.ceil((lead + N) / 7);
  const STEPS = [0.16, 0.34, 0.56, 0.8, 1];
  const cells: Node[][] = Array.from({ length: 7 }, () => []);
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const i = w * 7 + d - lead;
      if (i < 0 || i >= N) { cells[d]!.push(stack([], { width: 18, height: 18, flex: "none" })); continue; }
      const v = values[i] ?? 0;
      const lvl = v > 0 ? STEPS[Math.min(4, Math.floor((v / max) * 5))]! : 0;
      const today = i === N - 1;
      const cell = stack([], {
        width: 18, height: 18, flex: "none", radius: 4,
        ...(v > 0 ? { background: `color-mix(in srgb, var(--d-ink) ${Math.round(lvl * 100)}%, var(--d-sheet))` } : { border: "1.5px solid var(--d-rule)" }),
        ...(today ? { outline: "1.5px dashed var(--d-ink)", outlineOffset: 2 } : {}),
      });
      const press = o.press?.(i);
      cells[d]!.push(press && v > 0 ? { ...cell, on: { onPress: press } } : cell);
    }
  }
  const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
  return stack([
    ...cells.map((c, d) => row([text(DAY_LETTERS[d]!, "d-margin", { width: 14, flex: "none" }), ...c], { gap: 5, align: "center" })),
    row([
      text("Less", "d-margin"),
      ...STEPS.map((s) => stack([], { width: 12, height: 12, radius: 3, background: `color-mix(in srgb, var(--d-ink) ${Math.round(s * 100)}%, var(--d-sheet))` })),
      text("More", "d-margin"),
    ], { gap: 5, align: "center", marginTop: 10, marginLeft: 19 }),
  ], { gap: 5, marginTop: 16 });
}

/** A section of a desk page: a heading in the written face, a line of what it
 *  shows, then the chart. */
function section(title: string, caption: string | undefined, body: Node[], style: Style = {}): Node {
  return stack([
    text(title, "d-h2"),
    ...(caption ? [text(caption, "d-lede", { marginTop: 6 })] : []),
    ...body,
  ], { flex: 1, minWidth: 0, ...style });
}
/** Two sections side by side where the window is wide, stacked where not. */
const twoUp = (a: Node | null, b: Node | null, style: Style = {}): Node[] => {
  const cols = [a, b].filter((x): x is Node => !!x);
  return cols.length ? [row(cols, { gap: 64, marginTop: 52, align: "start", flexWrap: "wrap", ...style }, "d-wrap-narrow")] : [];
};

// ---- TODAY -------------------------------------------------------------------------

interface EntryItem { id: string; time: string; app: string; said: string; written: string; deva: boolean; typed: boolean }

function entryItems(ctx: DeskContext, entries: HistoryEntry[], withDate = false): EntryItem[] {
  return entries.map((e) => {
    const d = local(ctx, Date.parse(e.createdAt));
    const voice = (e.kind ?? "voice") === "voice";
    const said = voice && e.input && e.input.trim() !== (e.output ?? "").trim() ? e.input.trim() : "";
    return {
      id: e.id,
      time: withDate ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}` : clock(d),
      app: appName(e.targetApp) || (voice ? "" : "Typed"),
      said,
      written: (e.output ?? "").trim(),
      deva: /[ऀ-ॿ]/.test(e.output ?? ""),
      typed: !voice,
    };
  });
}

function weekSquares(ctx: DeskContext, titled = true): Node {
  const now = local(ctx, Date.now());
  // The stats read has thirty days, newest last. Without it (it can miss its
  // deadline), the history in hand says which days had a note.
  const spark = ctx.stats?.sparklinePerDay;
  const had = new Set((ctx.history ?? []).map((e) => dayKey(local(ctx, Date.parse(e.createdAt)))));
  const cells: Node[] = [], letters: Node[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const on = spark && spark.length >= 7 ? (spark[spark.length - 1 - i] ?? 0) > 0 : had.has(dayKey(d));
    cells.push(stack([], {}, `d-sq${on ? " d-sq-on" : ""}${i === 0 ? " d-sq-now" : ""}`));
    letters.push(text(DAYS[d.getUTCDay()]!.slice(0, 1), "d-margin", { width: 16, textAlign: "center" }));
  }
  return stack([
    ...(titled ? [text("This week", "d-eyebrow")] : []),
    row(cells, { gap: 6, marginTop: titled ? 10 : 0 }),
    row(letters, { gap: 6, marginTop: 6 }),
  ]);
}

/**
 * THE ROOM — the band under the tabs. It was a violet gradient, the one colour
 * on the desk that belonged to nothing else in it. It is the brand's own now:
 * a warm espresso ink, lit from the top right by the amber the product uses
 * for whatever is live, with a breath of the typed rose low on the left. The
 * room's cream type (.d-on-room) reads on it unchanged. Inline, so it wins over
 * app.html's .d-room on every installed build.
 */
const ROOM: Style = {
  background: "#17120E",
  backgroundImage: "radial-gradient(70% 160% at 94% -30%, rgba(232,162,60,.34), rgba(232,162,60,0) 62%), radial-gradient(50% 130% at -6% 135%, rgba(214,69,110,.12), rgba(214,69,110,0) 60%), linear-gradient(180deg, #221A13 0%, #14100C 100%)",
  color: "#F3E2C6",
  borderBottom: "1px solid rgba(243,226,198,.08)",
};
const room = (inner: Node[], style: Style = {}): Node =>
  stack([row(inner, { justify: "between", align: "end", gap: 24, flexWrap: "wrap", ...style }, "d-room-inner")], ROOM, "d-room");

/** The keys that start a dictation, as the room shows them. */
const talkKeys = (): Node[] => [
  row([keys("tap", true), text("tap twice, in any app, and talk", "d-count d-on-room", { maxWidth: 150, marginLeft: 6 })],
    { align: "center", gap: 0 }, undefined, { visibleIf: { truthy: "desktop.tap" } }),
  row([keys("hotkey", true), text("in any app, and talk", "d-count d-on-room", { maxWidth: 150, marginLeft: 6 })],
    { align: "center", gap: 0 }, undefined, { visibleIf: { falsy: "desktop.tap" } }),
];

/**
 * An app's share as donut parts: the four biggest in the validated order, the
 * rest (and the client's own "Other") as Other.
 *
 * WHY BY POSITION, NOT BY APP. A donut's neighbours are what the eye compares,
 * and the order was validated as a ring: teal and rose are only safe apart
 * (under deuteranopia they measure 4.2, far under the floor), and in this ring
 * they always sit across from each other. Pinning each app to a colour across
 * pages would put them side by side whenever the day's ranking differs from
 * the month's. The legend names every app, so nothing rides on the colour.
 */
function appParts(rows: Array<{ app: string; words: number }>, press?: (app: string) => ActionRef | undefined): Part[] {
  const known = rows.filter((x) => x.words > 0 && x.app && x.app !== "Other");
  const other = rows.filter((x) => x.words > 0 && (!x.app || x.app === "Other")).reduce((s, x) => s + x.words, 0);
  const ps = foldParts(known.map((r) => ({ label: appName(r.app) || r.app, value: r.words, press: press?.(r.app) })));
  if (!other) return ps;
  const last = ps[ps.length - 1];
  return last && last.label === "Other" && last.color === OTHER
    ? [...ps.slice(0, -1), { ...last, value: last.value + other }]
    : [...ps, { label: "Other", value: other, color: OTHER }];
}

const HOUR_TICKS = ["12a", "6a", "12p", "6p", "12a"];
const hourName = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;

/**
 * TODAY — the day as numbers, not as a list.
 *
 * The room carries the day's four figures; the page under it says where they
 * came from: the day by the hour, said against typed, where the words went and
 * how they came, the last two weeks, the week's squares, training. The notes
 * themselves are one link away, in History, where each can be copied or
 * removed with its reason — a page that listed them here as well was two lists
 * of the same thing, the second without its delete. And there is no "Talk now":
 * the keys in the room are how anyone talks, from wherever they already are.
 *
 * On a day with nothing said yet the page still has its month to show — the
 * usual hours, the usual apps — and says so in each heading.
 */
export function deskToday(ctx: DeskContext): ScreenResponse {
  const now = local(ctx, Date.now());
  const today = dayKey(now);
  const all = ctx.history ?? [];
  const st = ctx.stats;
  const at = (e: HistoryEntry) => local(ctx, Date.parse(e.createdAt));
  const todays = all.filter((e) => dayKey(at(e)) === today);
  const wordsToday = ctx.usage?.today?.words ?? todays.reduce((s, e) => s + (e.wordsOut ?? 0), 0);
  // The history read stops at fifty; on a day past that, the meter counts.
  const dictations = todays.length >= 50 ? Math.max(todays.length, ctx.usage?.today?.requests ?? 0) : todays.length;
  const saidMin = (ctx.usage?.today?.audioSeconds ?? 0) / 60;
  const typedMin = wordsToday / TYPING_WPM;
  const back = Math.max(0, typedMin - saidMin);

  // The month's days, today last (the stats read); without it, the history in hand.
  const perDay = st?.wordsPerDay?.length ? st.wordsPerDay : (() => {
    const out = new Array(14).fill(0) as number[];
    for (const e of all) {
      const ago = Math.floor((Date.parse(today) - Date.parse(dayKey(at(e)))) / 86_400_000);
      if (ago >= 0 && ago < 14) out[13 - ago] += e.wordsOut ?? 0;
    }
    return out;
  })();
  const before = perDay.slice(0, -1).filter((v) => v > 0);
  const avgDay = before.length ? before.reduce((s, v) => s + v, 0) / before.length : 0;
  // A MORNING IS NOT A DAY. Set against a whole day's average, every morning
  // reads as a bad day. With the month's hours in hand, today is set against
  // where a usual day stands BY THIS MINUTE; without them, against a day.
  const hw = st?.hourWords?.length === 24 ? st.hourWords : null;
  const hwTotal = hw ? hw.reduce((s, v) => s + v, 0) : 0;
  const h = now.getUTCHours();
  const shareNow = hw && hwTotal > 0
    ? (hw.slice(0, h).reduce((s, v) => s + v, 0) + (hw[h] ?? 0) * (now.getUTCMinutes() / 60)) / hwTotal
    : 1;
  const expected = avgDay * shareNow;
  const delta = expected >= 15 && wordsToday > 0 ? Math.round((wordsToday / expected - 1) * 100) : null;
  const paceLabel = hw ? "Against your pace" : "Against your day";
  const paceSub = !avgDay ? "an average needs a few days"
    : expected < 15 ? "too early in your day to say"
    : hw ? `by now you usually have ${n(expected)}` : `your average is ${n(avgDay)} words`;

  // ---- the room: the day's four figures --------------------------------------------
  const figures = row([
    statTile("Words today", n(wordsToday), wordsToday ? `${dictations} ${dictations === 1 ? "dictation" : "dictations"}` : "Nothing yet today", true, true),
    statTile("Time back", wordsToday ? span(back) : "—", `against typing at ${TYPING_WPM} wpm`, true),
    statTile(paceLabel, delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta}%`, paceSub, true),
    statTile("Day streak", n(st?.currentStreak ?? 0), st?.bestStreak ? `best run ${st.bestStreak} days` : "days in a row", true),
  ], { gap: 36, flexWrap: "wrap", marginTop: 26, paddingTop: 22, borderTop: "1px solid rgba(243,226,198,.12)", width: "100%" });

  const band = room([
    stack([
      text("Today", "d-eyebrow"),
      text(dateLine(now), "d-h1", { marginTop: 6 }),
    ], { minWidth: 0 }),
    ...talkKeys(),
    figures,
  ]);

  // ---- the day by the hour ----------------------------------------------------------
  const hoursToday = new Array(24).fill(0) as number[];
  for (const e of todays) hoursToday[at(e).getUTCHours()] += e.wordsOut ?? 0;
  const hasToday = hoursToday.some((v) => v > 0);
  const usualHours = st?.hourWords?.length === 24 ? st.hourWords : [];
  const hourVals = hasToday ? hoursToday : usualHours;
  const busiest = hourVals.indexOf(Math.max(...hourVals));
  const hourBlock = hourVals.some((v) => v > 0)
    ? section(hasToday ? "Today, hour by hour" : "Your usual day",
        hasToday ? `Busiest at ${hourName(busiest)}. Now is the amber hour.` : `Nothing yet today — this is your month, by the hour. Busiest at ${hourName(busiest)}.`,
        [columns(hourVals, { highlight: hasToday ? [now.getUTCHours()] : [busiest], ticks: HOUR_TICKS })])
    : null;

  const raceBlock = wordsToday > 0
    ? section("Said against typed", "The time it took you to say today's words, and the time typing them would have.", [
        stack([race(saidMin, typedMin, true)], { marginTop: 20 }),
        ...(back >= 1 ? [inline([text(span(back), "d-em"), text(" back today.", "d-inherit")], "d-written", { fontSize: 20, lineHeight: "28px", marginTop: 18 })] : []),
        text(`Typed at ${TYPING_WPM} words a minute. Said is the time you spent talking.`, "d-margin", { marginTop: 8 }),
      ])
    : null;

  // ---- where the words went, and how they came ----------------------------------------
  const todayApps = new Map<string, number>();
  for (const e of todays) { const a = e.targetApp || "Other"; todayApps.set(a, (todayApps.get(a) ?? 0) + (e.wordsOut ?? 0)); }
  const appRows = hasToday
    ? [...todayApps].map(([app, words]) => ({ app, words }))
    : (st?.topApps ?? []).map((a) => ({ app: a.app, words: a.words }));
  const ap = appParts(appRows);
  const appTotal = ap.reduce((s, p) => s + p.value, 0);
  const appsBlock = ap.length > 1
    ? section(hasToday ? "Where today's words went" : "Where your words go",
        hasToday ? "By the app you were in when you talked." : "Your month, by app — today fills this in.",
        [donutWithLegend(ap, { value: n(appTotal), label: "words" })])
    : ap.length === 1
      ? section(hasToday ? "Where today's words went" : "Where your words go", undefined,
          [statTile(ap[0]!.label, `${n(ap[0]!.value)} words`, hasToday ? "every word today, one app" : "this month")], { marginTop: 0 })
      : null;

  const kindsToday = { voice: 0, typing: 0, draft: 0 };
  for (const e of todays) kindsToday[(e.kind ?? "voice") as keyof typeof kindsToday] += e.wordsOut ?? 0;
  const kindSrc = hasToday ? kindsToday : (st?.kindWords ?? kindsToday);
  const kindParts: Part[] = [
    { label: "Spoken", value: kindSrc.voice, color: SERIES[0] },
    { label: "Typed", value: kindSrc.typing, color: SERIES[3] },
    { label: "Draft", value: kindSrc.draft, color: SERIES[2] },
  ].filter((p) => p.value > 0);
  const perSession = dictations ? Math.round(wordsToday / dictations) : 0;
  const monthPerSession = st?.avgWordsPerSession ?? 0;
  const kindsBlock = kindParts.length || perSession
    ? section(hasToday ? "How today's words came" : "How your words come", "Spoken, typed into the keyboard, or written for you as a draft.", [
        ...(kindParts.length > 1 ? [splitBar(kindParts)]
          : kindParts.length === 1 ? [text(`All ${kindParts[0]!.label.toLowerCase()}.`, "d-written", { fontSize: 17, marginTop: 14 })] : []),
        ...(perSession ? [row([
          statTile("Per dictation", `${n(perSession)}`, "words today"),
          ...(monthPerSession ? [statTile("Your usual", `${n(monthPerSession)}`, "words, this month")] : []),
        ], { gap: 32, marginTop: 30 })] : []),
      ])
    : null;

  // ---- the last two weeks --------------------------------------------------------------
  const last14 = perDay.slice(-14);
  const daysAgoLabel = (k: number) => { const d = new Date(now.getTime() - k * 86_400_000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`; };
  const sum14 = last14.reduce((s, v) => s + v, 0);
  const active14 = last14.filter((v) => v > 0).length;
  const trendBlock = sum14 > 0
    ? section("The last two weeks", `${n(sum14)} words over ${active14} of the last 14 days. Today is the amber point.`,
        [trend(last14, { ticks: [daysAgoLabel(last14.length - 1), daysAgoLabel(Math.floor((last14.length - 1) / 2)), "Today"] })],
        { marginTop: 52, flex: "none", width: "100%" })
    : null;

  // ---- the week, training, and the notes themselves ------------------------------------
  const weekBlock = section("This week", undefined, [
    stack([weekSquares(ctx, false)], { marginTop: 16 }),
    text(st?.currentStreak ? `${st.currentStreak} ${st.currentStreak === 1 ? "day" : "days"} in a row${st.bestStreak ? ` · your longest run is ${st.bestStreak}` : ""}.` : "Talk today to start a run.",
      "d-lede", { marginTop: 14 }),
  ]);
  const trainBlock = section("Train", undefined, [
    text(trainLine(ctx.personality), "d-written", { fontSize: 16, lineHeight: "25px", marginTop: 12, marginBottom: 14, maxWidth: 360 }),
    row([link("Train Tailzu", { kind: "switchTab", tabId: "desk_train" })]),
  ]);

  // THE TALKING HISTORY, ONE LINK AWAY. What was said today and before lives
  // in History, where every note can be copied and removed with its reason.
  const recent = all.filter((e) => Date.now() - Date.parse(e.createdAt) < 14 * 86_400_000).length;
  const historyBlock: Node = {
    ...row([
      stack([
        text("Your dictations", "d-eyebrow"),
        text(dictations
          ? `${dictations} today${recent > dictations ? `, ${recent} in the last two weeks` : ""} — what you said above what Tailzu wrote.`
          : all.length ? `Nothing today yet. ${recent || all.length} in the last two weeks, said above written.` : "Everything you say shows up here, said above written.",
          "d-written", { fontSize: 17, lineHeight: "25px", marginTop: 8, maxWidth: 560 }),
      ], { flex: 1, minWidth: 0 }),
      link("Open history  →", { kind: "navigate", screenId: "desk_history" }, "d-btn"),
    ], { align: "center", gap: 28, flexWrap: "wrap", marginTop: 56, paddingTop: 28, paddingBottom: 28, paddingLeft: 26, paddingRight: 26,
      borderRadius: 14, border: "1px solid var(--d-rule)", cursor: "pointer" }),
    on: { onPress: { kind: "navigate", screenId: "desk_history" } },
  };

  const body: Node[] = [
    ...twoUp(hourBlock, raceBlock, { marginTop: 0 }),
    ...twoUp(appsBlock, kindsBlock),
    ...(trendBlock ? [trendBlock] : []),
    ...twoUp(weekBlock, trainBlock),
    historyBlock,
  ];
  // Ask's one-time setup, above the room: the first thing on the page until
  // every row is on, when the window stops drawing it.
  const setup = ctx.askSetup ? [askSetupCard(ctx.askSetup, "home")] : [];
  return screen("desk_today", "Today", [...setup, band, page(body)]);
}

function trainLine(p: Personality): string {
  const ex = p.stylePortrait?.examples ?? 0;
  if (ex <= 0) return "A few minutes of talking, and Tailzu writes more like you.";
  return `${ex} ${ex === 1 ? "round" : "rounds"} so far. A few more and it knows how you punctuate.`;
}

// ---- HISTORY -------------------------------------------------------------------------
//
// Every cleanup the person has kept, newest first, by day — the window's answer
// to the phone's History screen. A row keeps its Copy, and can be removed; and
// removing one asks why, the way the phone does: it doesn't sound like them, or
// it was just a clean-up. Either reason deletes it, so it stops being learned
// from; the reason is sent on the delete so the first can be told from tidying.

/**
 * ONE ROW, with its own remove-and-reason.
 *
 * PER-ROW STATE, KEYED BY THE ENTRY'S ID. The id goes into a boolean state
 * path, `del.<id>` — the desktop renderer walks a dotted path (sdui.js
 * setStatePath/stateAt) and a history id carries no dots, so each row toggles
 * its own flag and opens its own card, one at a time. Its text and id are
 * written into each action the way the notes on Today carry theirs — a list's
 * item is gone by the time a click is read, so nothing is left to `$state`.
 */
function historyRow(it: EntryItem): Node {
  const id = it.id;
  const flag = "del." + id;
  const remove = (reason: string): ActionRef => ({
    kind: "callEndpoint", method: "DELETE", path: "/v1/history/" + id + "?reason=" + reason,
    onSuccess: { kind: "refresh" },
    onError: { kind: "toast", message: "Couldn't reach history. Try again." },
  });
  // THE CROSS. Always there, quiet until it is wanted — the hover-only
  // "Remove" was a delete nobody found. It opens the same reason card.
  const cross: Node = {
    type: "Button",
    props: { label: "✕", cls: "d-x" },
    on: { onPress: { kind: "setState", path: flag, value: true } },
    style: {
      border: 0, background: "transparent", cursor: "pointer", padding: 0, flexShrink: 0,
      width: 30, height: 30, radius: 15, marginTop: -4,
      font: "400 15px/30px var(--f-ui)", color: "var(--d-ink3)", textAlign: "center",
    },
    visibleIf: { falsy: flag },
  };
  return row([
    stack([
      text(it.time, "d-margin-strong"),
      ...(it.app ? [text(it.app, "d-margin")] : []),
    ], { width: 96, flex: "none", paddingTop: 3 }),
    stack([
      ...(it.said ? [text(it.said, "d-said")] : []),
      text(it.written, it.deva ? "d-written d-deva" : "d-written"),
      {
        ...row([
          link("Copy", { kind: "copyText", text: it.written, message: "Copied" }),
        ], { gap: 18, marginTop: 10 }, "d-tools"),
        visibleIf: { falsy: flag },
      },
      {
        ...stack([
          text("Remove from history", "d-eyebrow"),
          text("Why should it go?", "d-written", { fontSize: 16, lineHeight: "22px", marginTop: 4 }),
          text("Either way it's gone for good, and Tailzu stops learning from it.", "d-lede", { marginTop: 4 }),
          row([
            link("It doesn't sound like me", remove("not_me")),
            link("Just a clean-up", remove("cleanup")),
            link("Leave it", { kind: "setState", path: flag, value: false }),
          ], { gap: 20, marginTop: 14, align: "center", flexWrap: "wrap" }, "d-tools"),
        ], { marginTop: 12, paddingTop: 16, paddingBottom: 16, paddingLeft: 18, paddingRight: 18, borderRadius: 10, border: "1px solid var(--d-rule)", maxWidth: 520 }),
        visibleIf: { truthy: flag },
      },
    ], { flex: 1, minWidth: 0, gap: 4 }),
    cross,
  ], { gap: 24, paddingTop: 24, paddingBottom: 24 }, "d-entry");
}

export function deskHistory(ctx: DeskContext): ScreenResponse {
  const all = ctx.history ?? [];
  const items = entryItems(ctx, all, false);

  const body: Node[] = [];
  if (!all.length) {
    body.push(stack([
      text("Nothing here yet.", "d-written", { fontSize: 19, lineHeight: "27px" }),
      text("What you write with Tailzu shows up here.", "d-lede", { marginTop: 8 }),
    ], { paddingBottom: 26 }));
  }
  let lastDay = "";
  all.forEach((e, i) => {
    const day = dayHeading(ctx, e.createdAt);
    if (day !== lastDay) {
      body.push(text(day, "d-eyebrow", { marginTop: lastDay ? 34 : 0, marginBottom: 4 }));
      lastDay = day;
    }
    body.push(historyRow(items[i]!));
  });

  return screen("desk_history", "History", [page([
    row([link("← Today", { kind: "switchTab", tabId: "desk_today" })], { marginBottom: 20 }),
    text("History", "d-eyebrow"),
    text("Everything you've kept", "d-h1", { marginTop: 6 }),
    text("Every cleanup you've kept, newest first.", "d-lede", { marginTop: 8 }),
    stack(body, { maxWidth: 760, marginTop: 24 }),
  ])], { del: {} });
}

// ---- INSIGHTS ------------------------------------------------------------------------

/**
 * INSIGHTS — the month, read every way it can honestly be read.
 *
 * The statement and the race say the one thing first: what was said, what
 * typing it would have cost. Then the figures, then the month as a line (day
 * by day) and as a running total with where it is heading, and then each
 * breakdown in the form its data wants: parts of a whole as donuts (apps, how
 * the words came, which voice), a split of a few as one bar (register), an
 * order as columns (hours, weekdays, lengths), days as a calendar, languages as
 * type specimens, the dictionary as a ranking. An app opens its own page, a
 * day opens its own; nothing is hidden behind a tap that a page has room for.
 */
export function deskInsights(ctx: DeskContext): ScreenResponse {
  const now = local(ctx, Date.now());
  const words = ctx.usage?.month.words ?? ctx.stats?.wordsOut ?? 0;
  const saidMin = (ctx.usage?.month.audioSeconds ?? 0) / 60;
  const typedMin = words / TYPING_WPM;
  const st = ctx.stats;
  const month = MONTHS[now.getUTCMonth()]!;

  const statement: Node = words > 0
    ? inline([
        text(`You said ${n(words)} words this month. Typed, they would have taken `, "d-inherit"),
        text(span(typedMin), "d-typed", { whiteSpace: "nowrap" }),
        text(". Said, ", "d-inherit"),
        text(`${span(saidMin)}.`, "d-em", { whiteSpace: "nowrap" }),
      ], "d-statement", { marginTop: 20, marginBottom: 32 })
    : text("Nothing said yet this month. Tap twice in any app, and this page starts counting.", "d-statement", { marginTop: 20, marginBottom: 32 });

  // ---- the figures ------------------------------------------------------------------
  const wpd = st?.wordsPerDay ?? st?.days?.map((d) => d.words) ?? [];
  const tiles: Node[] = [];
  if (words > 0) tiles.push(statTile("Words this month", n(words), `${n(ctx.usage?.month.requests ?? st?.requests ?? 0)} dictations`));
  if ((st?.minutesSaved ?? 0) > 0) tiles.push(statTile("Time back", span(st!.minutesSaved), `against typing at ${TYPING_WPM} wpm`));
  if (st?.daysActive != null && wpd.length) tiles.push(statTile("Days you talked", `${st.daysActive}`, `of the last ${wpd.length}`));
  if ((st?.currentStreak ?? 0) > 0) tiles.push(statTile("Day streak", n(st!.currentStreak!), `longest run ${st!.bestStreak ?? st!.currentStreak}`));
  if ((st?.avgWordsPerSession ?? 0) > 0) tiles.push(statTile("Per dictation", n(st!.avgWordsPerSession!), "words, on average"));
  if (st?.bestDay) tiles.push(statTile("Best day", n(st.bestDay.words), `words · ${st.bestDay.date}`));
  const tilesRow: Node[] = tiles.length
    ? [row(tiles.map((t) => ({ ...t, style: { ...(t.style ?? {}), minWidth: 200 } })), { gap: 32, flexWrap: "wrap", marginTop: 36, paddingTop: 28 }, "d-rule-top")]
    : [];

  // ---- the month as a line, and as a running total ------------------------------------
  const dayLabel = (k: number) => { const d = new Date(now.getTime() - k * 86_400_000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`; };
  const sumW = wpd.reduce((s, v) => s + v, 0);
  const activeW = wpd.filter((v) => v > 0).length;
  const lineTicks = wpd.length > 2 ? [dayLabel(wpd.length - 1), dayLabel(Math.floor((wpd.length - 1) / 2)), "Today"] : [];
  const trendBlock: Node | null = sumW > 0
    ? section("Day by day", `${n(sumW)} words over ${activeW} of the last ${wpd.length} days. The amber point is today.`,
        [trend(wpd, { ticks: lineTicks })], { flex: "none", width: "100%", marginTop: 56 })
    : null;
  const cum: number[] = [];
  wpd.reduce((s, v) => { cum.push(s + v); return s + v; }, 0);
  const dom = now.getUTCDate();
  const dim = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const projected = words > 0 && dom > 0 ? Math.round((words / dom) * dim) : 0;
  const cumBlock: Node | null = sumW > 0
    ? section("Running total", projected && dom < dim
        ? `${n(words)} words so far in ${month}. At this pace, about ${n(projected)} by the end of it.`
        : `${n(sumW)} words across the last ${wpd.length} days, added up day by day.`,
        [trend(cum, { ticks: lineTicks, avg: false, height: 150 })], { flex: "none", width: "100%", marginTop: 56 })
    : null;

  // ---- where the words went, and how they came -----------------------------------------
  // An app opens its own page (desk_app), looked up by the key the client
  // sent; the "Other" bucket is an aggregate with no page.
  const hasApp = new Set((st?.appDetail ?? []).map((a) => a.app));
  const ap = appParts((st?.topApps ?? []).map((a) => ({ app: a.app, words: a.words })),
    (app) => (hasApp.has(app) ? { kind: "navigate", screenId: "desk_app", params: { app } } as ActionRef : undefined));
  const apTotal = ap.reduce((s, p) => s + p.value, 0);
  const appsBlock = ap.length > 1
    ? section("Where the words went", hasApp.size ? "By the app you were in. Open one to see its own page." : "By the app you were in.",
        [donutWithLegend(ap, { value: n(apTotal), label: "words" })])
    : null;

  const kw = st?.kindWords;
  const kindParts: Part[] = kw ? [
    { label: "Spoken", value: kw.voice, color: SERIES[0] },
    { label: "Typed", value: kw.typing, color: SERIES[3] },
    { label: "Draft", value: kw.draft, color: SERIES[2] },
  ].filter((p) => p.value > 0) : [];
  const kindsBlock = kindParts.length > 1
    ? section("How the words came", "Spoken, typed into the keyboard, or written for you as a draft.",
        [donutWithLegend(kindParts, { value: `${pct(kindParts[0]!.value, kindParts.reduce((s, p) => s + p.value, 0))}%`, label: kindParts[0]!.label.toLowerCase() })])
    : null;

  // ---- languages, and the days -----------------------------------------------------------
  // The languages as type specimens, each set at a size that is its share.
  const langs = (st?.writtenIn ?? []).slice(0, 5);
  const ltotal = langs.reduce((s, l) => s + l.words, 0) || 1;
  const langBlock = section("How you speak", "Your words this month, by language, each set at its share.", langs.length
    ? [stack(langs.map((l) => {
        const size = Math.round(16 + 26 * Math.sqrt(l.words / ltotal));
        return row([
          text(LANGUAGE_NAMES[l.key] ?? l.key, "d-spec", { fontSize: size, ...(/[^\u0000-ɏ]/.test(LANGUAGE_NAMES[l.key] ?? "") ? { fontFamily: "var(--f-deva)", fontWeight: 400 } : {}) }),
          text(`${pct(l.words, ltotal)}%`, "d-num"),
        ], { justify: "between", align: "end", gap: 16, paddingTop: 10, paddingBottom: 10 }, "d-rule-bottom");
      }), { marginTop: 12 })]
    : [text("Talk for a few days and this fills in, read from what Tailzu wrote.", "d-lede", { marginTop: 12 })]);

  const heatBlock = wpd.length
    ? section("Days you talked", `${st?.daysActive ?? activeW} of the last ${wpd.length} days. The longest run was ${st?.bestStreak ?? 0}. Open a day to see it.`,
        [heatmap(wpd, now, { press: (i) => (st?.days?.[i] ? { kind: "navigate", screenId: "desk_day", params: { day: i } } : undefined) })])
    : section("Days you talked", "Your days show here once you have talked.", []);

  // ---- when: the hour, and the day of the week ------------------------------------------
  const hours = st?.hourWords ?? [];
  const peakHour = hours.indexOf(Math.max(...hours));
  const dp = st?.daypartSessions;
  const dpTotal = dp ? dp.morning + dp.afternoon + dp.evening + dp.night : 0;
  const dpTop = dp && dpTotal ? ([["morning", dp.morning], ["afternoon", dp.afternoon], ["evening", dp.evening], ["night", dp.night]] as Array<[string, number]>)
    .sort((a, b) => b[1] - a[1])[0] : undefined;
  const hourBlock = hours.some((v) => v > 0)
    ? section("Hour by hour", `Busiest at ${hourName(peakHour)}.${dpTop ? ` Mostly in the ${dpTop[0]} — ${pct(dpTop[1], dpTotal)}% of your dictations.` : ""}`,
        [columns(hours, { highlight: [peakHour], ticks: HOUR_TICKS })])
    : null;

  const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const wdSum = new Array(7).fill(0) as number[], wdCount = new Array(7).fill(0) as number[];
  wpd.forEach((v, i) => {
    const d = new Date(now.getTime() - (wpd.length - 1 - i) * 86_400_000);
    const k = (d.getUTCDay() + 6) % 7;
    wdSum[k] += v; wdCount[k] += 1;
  });
  const wdAvg = wdSum.map((s, k) => (wdCount[k] ? s / wdCount[k]! : 0));
  const wdPeak = wdAvg.indexOf(Math.max(...wdAvg));
  const weekdayBlock = wdAvg.some((v) => v > 0)
    ? section("Day of the week", `${["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"][wdPeak]} are your biggest — about ${n(wdAvg[wdPeak]!)} words.`,
        [columns(wdAvg, { highlight: [wdPeak], labels: WD })])
    : null;

  // ---- voice, register, length ---------------------------------------------------------
  // A voice is named the way the person renamed it; a register reads ZU's own as Zu.
  const voiceName = voiceNamer(ctx);
  const toneName = (t: string) => {
    const key = (t || "").trim() || "none";
    return key === "none" ? "Zu" : (TONE_LABELS[key as keyof typeof TONE_LABELS] ?? key);
  };
  const vp = foldParts((st?.voiceWords ?? []).map((v) => ({ label: voiceName(v.id), value: v.words })));
  const voiceBlock = vp.length > 1
    ? section("Who writes for you", "Your words this month, by the voice that wrote them.",
        [donutWithLegend(vp, { value: `${vp.length}`, label: vp.length === 1 ? "voice" : "voices" })])
    : null;
  const tp = foldParts((st?.toneWords ?? []).map((t) => ({ label: toneName(t.tone), value: t.words })));
  const toneBlock = tp.length > 1
    ? section("In which register", "How formal the writing came out.", [splitBar(tp)])
    : null;

  const LENGTH_NAMES = ["1–5", "6–15", "16–40", "41–100", "100+"];
  const sl = st?.sessionLengths?.length === 5 ? st.sessionLengths : [];
  const slPeak = sl.indexOf(Math.max(...sl));
  const lengthBlock = sl.some((v) => v > 0)
    ? section("How long, in words", `Most dictations run ${LENGTH_NAMES[slPeak]} words.`,
        [columns(sl, { highlight: [slPeak], labels: LENGTH_NAMES })])
    : null;

  const dict = st?.dictionary;
  const dictBlock = dict
    ? section("What earns its place", `${n(dict.used)} of ${n(dict.saved)} saved words turned up this month.`, [
        ...(dict.saved > 0 ? [splitBar([
          { label: "Used", value: dict.used, color: SERIES[1] },
          { label: "Not yet", value: Math.max(0, dict.saved - dict.used), color: OTHER },
        ].filter((p) => p.value > 0))] : []),
        ...(dict.top?.length
          ? [text("Most used", "d-eyebrow", { marginTop: 22, marginBottom: 2 }),
             barList(dict.top.map((w) => ({ label: w.word, words: w.uses, value: `${n(w.uses)}×` })))]
          : []),
        ...(dict.unusedWords?.length
          ? [text("Never turned up", "d-eyebrow", { marginTop: 18, marginBottom: 4 }),
             text(dict.unusedWords.join(", "), "d-lede")]
          : []),
      ])
    : null;

  // THE ALLOWANCE METER, only when the window was handed the allowance.
  const allowanceSection: Node[] = ctx.allowance && (ctx.allowance.total ?? 0) > 0
    ? (() => {
        const used = ctx.allowance!.used ?? 0;
        const total = ctx.allowance!.total ?? 0;
        const p = Math.max(2, Math.min(100, Math.round((used / total) * 100)));
        return [section("This month's words", `${n(used)} of ${n(total)} words this month.`, [
          stack([stack([], { width: `${p}%`, height: 8, radius: 4, background: "var(--d-ink)" })],
            { height: 8, radius: 4, background: "var(--d-press)", marginTop: 16, maxWidth: 520 }),
        ], { flex: "none", width: "100%", marginTop: 56 })];
      })()
    : [];

  return screen("desk_insights", "Insights", [page([
    row([
      text(`Insights · ${month}`, "d-eyebrow"),
      link("Full history", { kind: "navigate", screenId: "desk_history" }),
    ], { justify: "between", align: "center" }),
    statement,
    ...(words > 0 ? [race(saidMin, typedMin, true), text(`Typed at ${TYPING_WPM} words a minute. Said is the time you spent talking.`, "d-margin", { marginTop: 10 })] : []),
    ...tilesRow,
    ...(trendBlock ? [trendBlock] : []),
    ...twoUp(appsBlock, kindsBlock),
    ...twoUp(langBlock, heatBlock),
    ...twoUp(hourBlock, weekdayBlock),
    ...twoUp(voiceBlock, toneBlock),
    ...twoUp(lengthBlock, dictBlock),
    ...(cumBlock ? [cumBlock] : []),
    ...allowanceSection,
  ])]);
}

// ---- INSIGHTS: a day, and an app ------------------------------------------------------

/** A small back cue over a detail page — the window's own chevron pops the
 *  stack, this says where back goes and reads the same on every page. */
const backToInsights = () =>
  row([link("← Insights", { kind: "switchTab", tabId: "desk_insights" })], { marginBottom: 20 });

/** A voice's name the way the person renamed it; Zu's own signature reads as Zu. */
function voiceNamer(ctx: DeskContext): (id: string) => string {
  const named = applyPresetOverrides(ctx.personality?.presetOverrides);
  return (id: string) => {
    const key = (id || "").trim();
    if (!key || key === "none" || key === "signature") return "Zu";
    return named.find((p) => p.id === key)?.name ?? key;
  };
}

/** A ranked set of horizontal bars — the same lane the apps use on Insights,
 *  reused for a day's apps, a split by how it was written, its languages, an
 *  app's time of day. A row carries its own tap when one is handed in. */
function barList(rows: Array<{ label: string; words: number; press?: ActionRef; value?: string }>): Node {
  const total = rows.reduce((s, r) => s + r.words, 0) || 1;
  return stack(rows.map((r) => {
    const pct = Math.round((r.words / total) * 100);
    // The right-hand number is the share by default — but a count ("12×") is
    // what reads where the bar is a ranking (the dictionary's most-used words),
    // so a row may name its own.
    const line = row([
      text(r.label, "d-lane-label", { width: 100, flex: "none" }),
      stack([stack([], { width: `${Math.max(2, pct)}%` }, "d-bar1-fill")], { flex: 1, minWidth: 0 }, "d-bar1"),
      text(r.value ?? `${pct}%`, "d-num", { minWidth: 48, textAlign: "right", whiteSpace: "nowrap", flex: "none" }),
    ], { align: "center", gap: 12, paddingTop: 9, paddingBottom: 9 });
    return r.press ? { ...line, on: { onPress: r.press } } : line;
  }), { marginTop: 10 });
}

/**
 * ONE DAY, on its own page — reached from a filled square on Insights. The
 * square sent its place in the run (params.day); the date is read back from
 * that, and the bucket's detail is the stats read the window already made for
 * Insights, so this costs no extra work. Said against typed at the top, when in
 * the day under it, and down the side where the words went, how they were
 * written, and in what.
 */
export function deskDay(ctx: DeskContext): ScreenResponse {
  const st = ctx.stats;
  const list = st?.days ?? [];
  const idx = Math.trunc(Number(ctx.params?.day));
  const d = Number.isInteger(idx) && idx >= 0 && idx < list.length ? list[idx] : undefined;
  if (!st || !d) {
    return screen("desk_day", "Day", [page([
      backToInsights(),
      text("Insights", "d-eyebrow"),
      text("That day isn't here.", "d-h1", { marginTop: 6 }),
      text("Open it again from a filled square on Insights.", "d-lede", { marginTop: 8 }),
    ])]);
  }
  const now = local(ctx, Date.now());
  const date = new Date(now.getTime() - (list.length - 1 - idx) * 86_400_000);
  const saidMin = d.saidSeconds / 60;
  const typedMin = d.words / TYPING_WPM;
  const saved = Math.max(0, typedMin - saidMin);
  const times = d.first && d.last && d.first !== d.last ? `${d.first}–${d.last}` : (d.first || "");

  const head = stack([
    backToInsights(),
    text("Insights", "d-eyebrow"),
    text(dateLine(date), "d-h1", { marginTop: 6 }),
  ], { marginBottom: 32 });

  const tiles = row([
    statTile("Words", n(d.words), `${d.sessions} ${d.sessions === 1 ? "dictation" : "dictations"}`),
    statTile("Time back", d.words ? span(saved) : "—", `against typing at ${TYPING_WPM} wpm`),
    statTile("Per dictation", d.sessions ? n(Math.round(d.words / d.sessions)) : "—", "words, on average"),
    ...(times ? [statTile("From first to last", times, "your talking hours")] : []),
  ], { gap: 32, flexWrap: "wrap", paddingTop: 26, marginBottom: 8 }, "d-rule-top");

  const raceBlock = d.words > 0
    ? section("Said against typed", undefined, [
        stack([race(saidMin, typedMin, true)], { marginTop: 18 }),
        ...(saved >= 1 ? [inline([text(span(saved), "d-em"), text(" back on the day.", "d-inherit")], "d-written", { fontSize: 18, lineHeight: "26px", marginTop: 16 })] : []),
        text(`Typed at ${TYPING_WPM} words a minute.`, "d-margin", { marginTop: 8 }),
      ])
    : null;
  const hours = d.hours?.length === 24 ? d.hours : new Array(24).fill(0) as number[];
  const peak = hours.indexOf(Math.max(...hours));
  const hourBlock = hours.some((v) => v > 0)
    ? section("Hour by hour", `Busiest at ${hourName(peak)}.`, [columns(hours, { highlight: [peak], ticks: HOUR_TICKS })])
    : null;

  const ap = appParts((d.apps ?? []).map((a) => ({ app: a.app, words: a.words })));
  const appsBlock = ap.length > 1
    ? section("Where the words went", "By the app you were in.", [donutWithLegend(ap, { value: n(d.words), label: "words" })])
    : ap.length === 1 ? section("Where the words went", `Every word in ${ap[0]!.label}.`, []) : null;
  const kp: Part[] = [
    { label: "Spoken", value: d.kinds.voice, color: SERIES[0] },
    { label: "Typed", value: d.kinds.typing, color: SERIES[3] },
    { label: "Draft", value: d.kinds.draft, color: SERIES[2] },
  ].filter((p) => p.value > 0);
  const lp = foldParts((d.languages ?? []).map((l) => ({ label: LANGUAGE_NAMES[l.key] ?? l.key, value: l.words })));
  const howBlock = kp.length > 1 || lp.length > 1
    ? section("How, and in what", undefined, [
        ...(kp.length > 1 ? [text("How the words came", "d-eyebrow", { marginTop: 18 }), splitBar(kp)] : []),
        ...(lp.length > 1 ? [text("Languages", "d-eyebrow", { marginTop: 30 }), splitBar(lp)] : []),
      ])
    : null;

  return screen("desk_day", dateLine(date), [page([
    head,
    tiles,
    ...twoUp(raceBlock, hourBlock),
    ...twoUp(appsBlock, howBlock),
  ])]);
}

/**
 * ONE APP, on its own page — reached from a bar on Insights. The bar sent the
 * key the client wrote the words into (params.app); its detail is matched out
 * of the same stats read. How much went there and in how many pieces, the time
 * of day it happens, and how it was written.
 */
export function deskApp(ctx: DeskContext): ScreenResponse {
  const st = ctx.stats;
  const key = String(ctx.params?.app ?? "");
  const a = (st?.appDetail ?? []).find((x) => x.app === key);
  if (!st || !a) {
    return screen("desk_app", "App", [page([
      backToInsights(),
      text("Insights", "d-eyebrow"),
      text("Nothing for that app.", "d-h1", { marginTop: 6 }),
      text("Open it again from a bar on Insights.", "d-lede", { marginTop: 8 }),
    ])]);
  }
  const disp = appName(a.app) || "Other";
  const now = local(ctx, Date.now());
  const lastAt = Date.parse(a.lastAt);
  const lastLine = Number.isFinite(lastAt) ? `Last used ${dateLine(local(ctx, lastAt))}` : "";

  const head = stack([
    backToInsights(),
    text("Where the words went", "d-eyebrow"),
    text(disp, "d-h1", { marginTop: 6 }),
    ...(lastLine ? [text(lastLine, "d-margin", { marginTop: 10 })] : []),
  ], { marginBottom: 32 });

  // Its place among the others: the share of every word that went to an app,
  // and where it ranks — the same read Insights draws its donut from.
  const all = [...(st.appDetail ?? [])].sort((x, y) => y.words - x.words);
  const allWords = all.reduce((s, x) => s + x.words, 0) || 1;
  const rank = all.findIndex((x) => x.app === a.app) + 1;
  const overallAvg = st.avgWordsPerSession ?? 0;
  const perDay = (st.days ?? []).map((d) => d.apps.find((x) => x.app === a.app)?.words ?? 0);
  const daysUsed = perDay.filter((v) => v > 0).length;
  const avgDelta = overallAvg > 0 && a.avgWords > 0 ? Math.round(((a.avgWords - overallAvg) / overallAvg) * 100) : null;

  const tiles = row([
    statTile("Words", n(a.words), `${pct(a.words, allWords)}% of all your words`),
    statTile("Dictations", n(a.sessions), rank > 0 ? (rank === 1 ? "your most-used app" : `number ${rank} of ${all.length} apps`) : undefined),
    statTile("Per dictation", a.avgWords > 0 ? n(a.avgWords) : "—",
      avgDelta == null ? "words, on average" : avgDelta === 0 ? "the same as everywhere else" : `${Math.abs(avgDelta)}% ${avgDelta > 0 ? "longer" : "shorter"} than your usual`),
    ...(perDay.length ? [statTile("Days used", `${daysUsed}`, `of the last ${perDay.length}`)] : []),
  ], { gap: 32, flexWrap: "wrap", paddingTop: 26 }, "d-rule-top");

  const dayLabel = (k: number) => { const d = new Date(now.getTime() - k * 86_400_000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`; };
  const dayBlock = daysUsed > 1
    ? section("Day by day", `${disp}, every day of the last ${perDay.length}. The amber column is the biggest.`,
        [columns(perDay, { highlight: [perDay.indexOf(Math.max(...perDay))], ticks: [dayLabel(perDay.length - 1), dayLabel(Math.floor((perDay.length - 1) / 2)), "Today"] })],
        { flex: "none", width: "100%", marginTop: 52 })
    : null;

  const dp =[a.dayparts.morning, a.dayparts.afternoon, a.dayparts.evening, a.dayparts.night];
  const dpPeak = dp.indexOf(Math.max(...dp));
  const whenBlock = dp.some((v) => v > 0)
    ? section("When in the day", `Mostly in the ${DAYPARTS[dpPeak]!.toLowerCase()}${dpPeak === 3 ? "" : "s"}. Dictations by time of day.`,
        [stack([columns(dp, { highlight: [dpPeak], labels: [...DAYPARTS], height: 110 })], { maxWidth: 360, marginTop: 18 })])
    : null;

  const kp: Part[] = [
    { label: "Spoken", value: a.kinds.voice, color: SERIES[0] },
    { label: "Typed", value: a.kinds.typing, color: SERIES[3] },
    { label: "Draft", value: a.kinds.draft, color: SERIES[2] },
  ].filter((p) => p.value > 0);
  const voiceName = voiceNamer(ctx);
  const vp = foldParts((a.voices ?? []).map((v) => ({ label: voiceName(v.id), value: v.words })));
  const howBlock = kp.length > 1 || vp.length > 1
    ? section("How it was written", undefined, [
        ...(kp.length > 1 ? [text("Spoken, typed, drafted", "d-eyebrow", { marginTop: 18 }), splitBar(kp)] : []),
        ...(vp.length > 1 ? [text("In which voice", "d-eyebrow", { marginTop: 30 }), splitBar(vp)] : []),
      ])
    : kp.length === 1 ? section("How it was written", `All ${kp[0]!.label.toLowerCase()}.`, []) : null;

  const blocks = [...(dayBlock ? [dayBlock] : []), ...twoUp(whenBlock, howBlock)];
  return screen("desk_app", disp, [page([
    head,
    tiles,
    ...(blocks.length ? blocks : [text("Talk into this app for a few days and its shape fills in here.", "d-lede", { marginTop: 32 })]),
  ])]);
}

// ---- WORDS -----------------------------------------------------------------------------

function vocabularyLines(p: Personality): string[] {
  return String(p.vocabulary ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}
function snippetPairs(p: Personality): Array<{ say: string; get: string }> {
  return String(p.snippets ?? "").split(/\r?\n/).map((l) => {
    const i = l.indexOf("=");
    return i > 0 ? { say: l.slice(0, i).trim(), get: l.slice(i + 1).trim().replace(/\\n/g, "\n") } : null;
  }).filter((x): x is { say: string; get: string } => !!x && !!x.say && !!x.get);
}

export function deskWords(ctx: DeskContext): ScreenResponse {
  const p = ctx.personality;
  // The dictionary's pairs are proof marks — what it was heard as, struck,
  // above what it is written as. The vocabulary's lines are words it knows.
  const pairs = (p.dictionary ?? []).filter((d) => d && d.word && d.replacement)
    .map((d) => ({ word: d.replacement, was: d.word, kind: "pair" }));
  // A word already shown as a proof mark is not listed again under it.
  const marked = new Set(pairs.map((x) => x.word.toLowerCase()));
  const vocab = vocabularyLines(p).filter((w) => !marked.has(w.toLowerCase())).map((w) => ({ word: w, was: "", kind: "word" }));
  const words = [...pairs, ...vocab].slice(0, 200);
  const snips = snippetPairs(p);

  const addWord: ActionRef = {
    kind: "callEndpoint", method: "POST", path: "/v1/words", body: { add: "$state.form.word" },
    onError: { kind: "toast", message: "Couldn't add that word" },
  };
  const addSnip: ActionRef = {
    kind: "callEndpoint", method: "POST", path: "/v1/snippets", body: { say: "$state.form.say", get: "$state.form.get" },
    onError: { kind: "toast", message: "Say a name and what it writes, then add" },
  };

  // Rows written out, each with its own values in its action — the same
  // reason as the notes on Today (entryNode): a template's item is gone by
  // the time Remove is clicked, so it removed nothing.
  const wordRow = (w: { word: string; was: string; kind: string }): Node => row([
    stack([
      ...(w.was ? [text(w.was, "d-was")] : []),
      text(w.word, "d-inherit"),
    ], { alignSelf: "flex-start" }, "d-fix"),
    row([link("Remove", {
      kind: "callEndpoint", method: "POST", path: "/v1/words", body: { remove: w.word, kind: w.kind },
      onError: { kind: "toast", message: "Couldn't remove that word" },
    })], {}, "d-tools"),
  ], { justify: "between", align: "center", gap: 14, paddingTop: 14, paddingBottom: 14 }, "d-entry");

  const snipRow = (x: { say: string; get: string }): Node => stack([
    row([text("say", "d-margin", { marginRight: 6 }), text(x.say, "d-say")], { align: "baseline" }),
    text(x.get, "d-get"),
    row([link("Remove", {
      kind: "callEndpoint", method: "POST", path: "/v1/snippets", body: { remove: x.say },
      onError: { kind: "toast", message: "Couldn't remove that snippet" },
    })], { marginTop: 6 }, "d-tools"),
  ], { gap: 4, paddingTop: 14, paddingBottom: 14 }, "d-entry");

  return screen("desk_words", "Words", [page([
    text("Words", "d-eyebrow"),
    text("What Tailzu knows about your words", "d-h1", { marginTop: 6 }),
    row([
      stack([
        text("Spelled your way", "d-h2"),
        text("Add a name once, or fix it once anywhere, and it is right from then on.", "d-lede", { marginTop: 6 }),
        row([
          { type: "TextField", props: { cls: "d-input", placeholder: "Add a name or a word" }, bind: { value: "form.word" }, on: { onSubmit: addWord } },
          link("Add", addWord, "d-btn"),
        ], { gap: 10, marginTop: 18, marginBottom: 10, align: "center" }),
        ...(words.length
          ? words.map(wordRow)
          : [text("No words yet. Names, places, the words only your team uses: add them here.", "d-lede", { marginTop: 8 })]),
      ], { flex: 1, minWidth: 0 }),
      stack([
        text("Said short, written long", "d-h2"),
        text("Say a snippet's name and the whole thing is written.", "d-lede", { marginTop: 6 }),
        stack([
          { type: "TextField", props: { cls: "d-input", placeholder: "Its name, like my upi" }, bind: { value: "form.say" } },
          { type: "TextField", props: { cls: "d-input", placeholder: "What it writes" }, bind: { value: "form.get" }, on: { onSubmit: addSnip } },
          row([link("Add snippet", addSnip, "d-btn")]),
        ], { gap: 12, marginTop: 18, marginBottom: 10 }),
        ...(snips.length
          ? snips.map(snipRow)
          : [text("No snippets yet. An address, a UPI id, a sign-off you type every day.", "d-lede", { marginTop: 8 })]),
      ], { flex: 1, minWidth: 0 }),
    ], { gap: 72, marginTop: 48, align: "start" }, "d-wrap-narrow"),
  ])], { form: { word: "", say: "", get: "" } });
}

// ---- VOICES -----------------------------------------------------------------------------

/** Zu's id. Zu is the person's own voice, not a style laid on top — it asserts
 *  nothing and has no prompt to change, so it is never editable, exactly as the
 *  phone's Voice page treats it (catalog.ts selfBlock only activates Zu). */
const ZU_ID = "signature";

export function deskVoices(ctx: DeskContext): ScreenResponse {
  const p = ctx.personality;
  const active = p.activePresetId || "signature";
  const voices = applyPresetOverrides(p.presetOverrides);
  const ordered = [...voices.filter((v) => v.id === active), ...voices.filter((v) => v.id !== active)];
  // Every voice but Zu can be renamed and re-prompted — a built-in picks up a
  // per-user override, a custom one is edited in place (server.ts
  // /v1/personality/tone). The same name + "How it writes" prompt the phone's
  // voice editor carries.
  const editable = ordered.filter((v) => v.id !== ZU_ID);

  const seg = row(DESK_CONTEXTS.map((c) => ({
    type: "Button",
    props: { label: c.label, cls: "d-seg-item" },
    on: { onPress: { kind: "setState", path: "ctx", value: c.id } },
    visibleIf: { neq: ["state.ctx", c.id] },
    fallback: { type: "Button", props: { label: c.label, cls: "d-seg-item d-seg-on" } },
  } as Node)), { alignSelf: "flex-start" }, "d-seg");

  const saidLines = DESK_CONTEXTS.map((c) => row([
    text("You said", "d-margin", { marginRight: 10 }),
    text(c.said, "d-said", { fontSize: 18, lineHeight: "24px", color: "var(--d-ink2)" }),
  ], { align: "baseline", flexWrap: "wrap" }, undefined, { visibleIf: { eq: ["state.ctx", c.id] } }));

  // THE DESK HAS NO MODAL. The editor reveals in place, the way the Words page
  // reveals its add-word field and History its delete-reason card: a boolean
  // state path (`edit.<id>`, or `edit.add` for a new one) toggled by setState,
  // and the two fields bound to `vc.<id>.{name,prompt}`, pre-filled from the
  // voice and seeded in the screen's state below. `id` is sent on save when
  // editing; an absent id upserts a new custom voice. Save refreshes — the page
  // comes back with the new/renamed voice and the editor closed.
  const editor = (key: string, id?: string): Node => {
    const save: ActionRef = {
      kind: "callEndpoint", method: "POST", path: "/v1/personality/tone",
      body: { ...(id ? { id } : {}), name: `$state.vc.${key}.name`, promptStyle: `$state.vc.${key}.prompt` },
      onSuccess: { kind: "refresh" },
      onError: { kind: "toast", message: "Couldn't save that voice. Try again." },
    };
    return {
      ...stack([
        text(id ? "Edit voice" : "New voice", "d-eyebrow"),
        text("Name", "d-eyebrow", { marginTop: 14, marginBottom: 6 }),
        { type: "TextField", props: { cls: "d-input", placeholder: "Voice name" }, bind: { value: `vc.${key}.name` } },
        text("How it writes", "d-eyebrow", { marginTop: 14, marginBottom: 6 }),
        {
          type: "TextField",
          props: { cls: "d-input", placeholder: "Short, warm, no filler…", multiline: true },
          bind: { value: `vc.${key}.prompt` }, style: { minHeight: 96, marginTop: 0 },
        },
        row([
          link("Save", save, "d-btn"),
          link("Cancel", { kind: "setState", path: "edit." + key, value: false }),
        ], { gap: 18, marginTop: 16, align: "center" }, "d-tools"),
      ], { marginTop: 12, paddingTop: 16, paddingBottom: 18, paddingLeft: 18, paddingRight: 18, borderRadius: 10, border: "1px solid var(--d-rule)" }),
      visibleIf: { truthy: "edit." + key },
    } as Node;
  };

  const rooms = ordered.map((v) => {
    const on = v.id === active;
    const samples = DESK_SAMPLES[v.id];
    const canEdit = v.id !== ZU_ID;
    // The colour card — what you compare and tap to switch. Unchanged: tapping
    // it still activates the voice, and the active one is not pressable.
    const card = stack([
      text(v.name, "d-world-name"),
      ...(samples
        ? DESK_CONTEXTS.map((c) => ({ ...text(samples[c.id], "d-world-text"), visibleIf: { eq: ["state.ctx", c.id] } } as Node))
        // A custom voice has no hand-written sample; it shows what it was told
        // to do, the way the phone's card does (catalog.ts voiceCardOf).
        : [text(v.promptStyle || v.tagline, "d-world-text")]),
      text(on ? "In use, everywhere" : (v.tagline || "Your voice"), "d-world-use", { marginTop: "auto" }),
    ], { gap: 14 },
      `d-world ${DESK_ROOMS[v.id] ?? "d-w-zu"}${on ? " d-world-on" : ""}`,
      on ? {} : { on: { onPress: {
        kind: "callEndpoint", method: "PUT", path: "/v1/personality",
        body: { activePresetId: v.id, ...(v.defaultTone ? { activeTone: v.defaultTone } : {}) },
        onError: { kind: "toast", message: "Couldn't switch voices" },
      } } });
    // The card and its Edit affordance are SIBLINGS under a wrapper with no
    // press of its own — the desk renderer does not stop click propagation, so
    // an Edit link inside the pressable card would also switch the voice. Here
    // tapping the card activates; tapping Edit only opens the editor.
    return stack([
      card,
      ...(canEdit ? [
        { ...row([link("Edit", { kind: "setState", path: "edit." + v.id, value: true })], {}, "d-tools"),
          visibleIf: { falsy: "edit." + v.id } } as Node,
        editor(v.id, v.id),
      ] : []),
    ], { flexBasis: "calc(33.333% - 10px)", minWidth: 220, gap: 10, alignSelf: "flex-start" });
  });

  // Field seeds, keyed by voice id: the editor for a voice opens pre-filled
  // with its current name and prompt; `add` starts empty for a new voice.
  const vc: Record<string, { name: string; prompt: string }> = { add: { name: "", prompt: "" } };
  for (const v of editable) vc[v.id] = { name: v.name, prompt: v.promptStyle ?? "" };

  return screen("desk_voices", "Voices", [page([
    text("Voices", "d-eyebrow"),
    text("Same words. The voice you choose.", "d-h1", { marginTop: 6 }),
    text("The voice you pick writes everything you say, on your phone and here. See each one in the kind of writing you do. Add your own, or change how one writes.", "d-lede", { marginTop: 8 }),
    // Add a voice — the one affordance on the page that is not a card, so it is
    // findable. Opens the same inline editor with empty fields.
    { ...row([link("Add voice", { kind: "setState", path: "edit.add", value: true })], { marginTop: 14 }, "d-tools"),
      visibleIf: { falsy: "edit.add" } },
    editor("add"),
    stack([seg], { marginTop: 22, marginBottom: 18 }),
    ...saidLines,
    row(rooms, { gap: 14, flexWrap: "wrap", marginTop: 18, align: "start" }),
  ])], { ctx: "chats", edit: {}, vc });
}

// ---- TRAIN --------------------------------------------------------------------------------

/**
 * TRAIN — what Tailzu has learned about how this person writes, as figures and
 * charts, the way Insights shows what they wrote.
 *
 * The band carries the start button and four figures (rounds, sittings, words
 * it knows, how long it has been learning), over the network at this person's
 * growth where the window can draw it. Under it: how well it knows them (three
 * stages, by sittings), the portrait in its own words, their words with what
 * each means to them, the modes they write in, how they change through the day,
 * what it noted per voice, and what it learns from — the days it heard them,
 * the voices and languages they write in (the stats read, when it arrived).
 */
export function deskTrain(ctx: DeskContext): ScreenResponse {
  const portrait = ctx.personality.stylePortrait;
  const st = ctx.stats;
  const now = local(ctx, Date.now());
  const rounds = portrait?.examples ?? 0;
  const sittings = portrait?.sessions ?? 0;
  const words = (portrait?.words ?? []).filter((w) => w?.term);
  const styles = (portrait?.styles ?? []).filter((x) => x?.name);
  const rhythms = (portrait?.rhythms ?? []).filter((x) => x?.when && x?.vibe);
  const voiceName = voiceNamer(ctx);
  const tones = Object.entries(portrait?.tones ?? {}).filter(([, v]) => String(v ?? "").trim());
  const first = portrait?.firstSeenAt ? Date.parse(portrait.firstSeenAt) : NaN;
  const ageDays = Number.isFinite(first) ? Math.max(0, Math.floor((Date.now() - first) / 86_400_000)) : 0;
  const ageText = !Number.isFinite(first) ? "—" : ageDays < 1 ? "today" : ageDays < 14 ? `${ageDays} ${ageDays === 1 ? "day" : "days"}`
    : ageDays < 60 ? `${Math.floor(ageDays / 7)} weeks` : `${Math.floor(ageDays / 30)} months`;
  const since = Number.isFinite(first) ? (() => { const d = local(ctx, first); return `since ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`; })() : "from your first dictation";

  // ---- the band ----------------------------------------------------------------------
  const start = link(rounds ? "Continue training" : "Start training", { kind: "navigate", screenId: "training_live" }, "d-btn",
    { backgroundColor: "#F3E2C6", color: "#17120E" });
  const figures = row([
    statTile("Training rounds", n(rounds), rounds ? "spoken sessions and picks" : "none yet", true, true),
    statTile("Sittings learned from", n(sittings), since, true),
    statTile("Words it knows", n(words.length), words.length ? "with what they mean to you" : "it learns them as you talk", true),
    statTile("Learning for", ageText, (portrait?.observed ?? 0) > 0 ? `${n(portrait!.observed!)} dictations read since the last rewrite` : "every dictation teaches it", true),
  ], { gap: 36, flexWrap: "wrap", marginTop: 30, paddingTop: 22, borderTop: "1px solid rgba(243,226,198,.12)", width: "100%" });
  const head: Node[] = [
    stack([
      text("Train", "d-eyebrow"),
      text("A few minutes of talking, and it writes like you.", "d-h1", { marginTop: 6, maxWidth: "22ch" }),
      text("Tailzu asks a few questions and listens to how you answer. What it learns stays with your account, on every device.",
        "d-lede", { marginTop: 10, maxWidth: "46ch", color: "rgba(243,226,198,.72)" }),
      row([start], { marginTop: 22 }),
    ], { minWidth: 0 }),
    figures,
  ];
  // THE NETWORK, where the window can show it, behind the band's words: the
  // same field the phone's training card carries, at this person's growth. A
  // plain ground under it — a gradient would sit over the field.
  const band: Node = ctx.field
    ? stack([
        ctx.field,
        stack([row(head, { justify: "between", align: "end", gap: 24, flexWrap: "wrap" })], { position: "relative" }, "d-room-inner"),
      ], { position: "relative", overflow: "hidden", ...ROOM, backgroundImage: "none", minHeight: 300, justify: "end" }, "d-room")
    : room(head);

  // ---- how well it knows them ----------------------------------------------------------
  const STAGES = [
    { name: "First impression", when: "a sitting or two" },
    { name: "Getting to know you", when: "three to nine sittings" },
    { name: "Knows how you write", when: "ten sittings and on" },
  ];
  const stage = sittings >= 10 ? 2 : sittings >= 3 ? 1 : 0;
  const stageBlock = section("How well it knows you", sittings
      ? `${STAGES[stage]!.name}: ${n(sittings)} ${sittings === 1 ? "sitting" : "sittings"} so far.${stage < 2 ? ` ${stage === 0 ? 3 - sittings : 10 - sittings} more and it moves on.` : " One odd day no longer changes what it knows."}`
      : "Nothing yet. Talk to it once, or dictate anywhere, and it starts.", [
    row(STAGES.map((x, i) => stack([
      stack([], { height: 8, radius: 4, background: i <= stage && sittings > 0 ? (i === stage ? ACCENT : "var(--d-ink)") : "var(--d-rule)" }),
      text(x.name, "d-k", { fontWeight: 600, fontSize: 13, marginTop: 10, ...(i === stage && sittings > 0 ? {} : { color: "var(--d-ink3)" }) }),
      text(x.when, "d-margin", { marginTop: 2 }),
    ], { flex: 1, minWidth: 0 })), { gap: 6, marginTop: 20 }),
  ], { flex: "none", width: "100%" });

  // ---- the portrait, in its own words -------------------------------------------------
  const core = String(portrait?.core ?? "").trim();
  const coreBlock = core
    ? section("What it knows about how you write", "In its own words. Every dictation is written with this in mind.", [
        text(core, "d-written", { fontSize: 18, lineHeight: "29px", marginTop: 16, maxWidth: 720 }),
      ], { flex: "none", width: "100%", marginTop: 52 })
    : null;

  // ---- their words, and how they write -------------------------------------------------
  const wordsBlock = section("Your words", words.length
      ? `${n(words.length)} ${words.length === 1 ? "word" : "words"} it keeps, with what each means to you.`
      : "Names, slang and words you use your own way show up here as it hears them.",
    words.length ? [stack(words.slice(0, 14).map((w) => row([
      text(w.term, "d-k", { fontWeight: 600, fontSize: 14, width: 130, flex: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
      text(String(w.means ?? ""), "d-lede", { flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: "20px" }),
    ], { gap: 14, paddingTop: 10, paddingBottom: 10, align: "start" }, "d-rule-bottom")), { marginTop: 14 }),
      ...(words.length > 14 ? [text(`and ${n(words.length - 14)} more`, "d-margin", { marginTop: 10 })] : [])] : []);
  const stylesBlock = section("How you write", styles.length
      ? "The modes you actually write in, and when each one shows up."
      : "Short or long, formal or not, and when. It fills in as it reads more of you.",
    styles.length ? [stack(styles.slice(0, 8).map((x, i) => row([
      stack([], { width: 10, height: 10, radius: 3, marginTop: 6, background: SERIES[i % SERIES.length]!, flex: "none" }),
      stack([text(x.name, "d-k", { fontWeight: 600, fontSize: 14 }), ...(x.when ? [text(x.when, "d-lede", { fontSize: 13.5, lineHeight: "20px", marginTop: 2 })] : [])], { flex: 1, minWidth: 0 }),
    ], { gap: 12, paddingTop: 10, paddingBottom: 10, align: "start" }, "d-rule-bottom")), { marginTop: 14 })] : []);

  // ---- through the day, and per voice --------------------------------------------------
  const rhythmBlock = rhythms.length
    ? section("Through the day", "How you change from morning to night.", [stack(rhythms.slice(0, 6).map((x) => row([
        text(x.when, "d-margin-strong", { width: 110, flex: "none", paddingTop: 3 }),
        text(x.vibe, "d-written", { flex: 1, minWidth: 0, fontSize: 15.5, lineHeight: "23px" }),
      ], { gap: 14, paddingTop: 10, paddingBottom: 10, align: "start" }, "d-rule-bottom")), { marginTop: 14 })])
    : section("Through the day", "How you change from morning to night, once it has seen a few of your days.", []);
  const toneBlock = tones.length
    ? section("Per voice", "What it noticed about you in each voice.", [stack(tones.slice(0, 6).map(([id, note]) => row([
        text(voiceName(id), "d-margin-strong", { width: 110, flex: "none", paddingTop: 3 }),
        text(String(note), "d-lede", { flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: "20px" }),
      ], { gap: 14, paddingTop: 10, paddingBottom: 10, align: "start" }, "d-rule-bottom")), { marginTop: 14 })])
    : null;

  // ---- what it learns from -------------------------------------------------------------
  const wpd = st?.wordsPerDay ?? st?.days?.map((d) => d.words) ?? [];
  const heardDays = wpd.filter((v) => v > 0).length;
  const dayLabel = (k: number) => { const d = new Date(now.getTime() - k * 86_400_000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`; };
  const fromBlock = heardDays
    ? section("What it learns from", `Every dictation teaches it a little. It heard you on ${heardDays} of the last ${wpd.length} days; the amber column is today.`,
        [columns(wpd, { highlight: [wpd.length - 1], ticks: [dayLabel(wpd.length - 1), dayLabel(Math.floor((wpd.length - 1) / 2)), "Today"] })],
        { flex: "none", width: "100%", marginTop: 52 })
    : null;
  const vp = foldParts((st?.voiceWords ?? []).map((v) => ({ label: voiceName(v.id), value: v.words })));
  const voicesBlock = vp.length > 1
    ? section("The voices you write in", "Your words this month, by the voice that wrote them.", [donutWithLegend(vp, { value: `${vp.length}`, label: "voices" })])
    : null;
  const lp = foldParts((st?.writtenIn ?? []).map((l) => ({ label: LANGUAGE_NAMES[l.key] ?? l.key, value: l.words })));
  const kinds = st?.kindWords;
  const kp: Part[] = kinds ? [
    { label: "Spoken", value: kinds.voice, color: SERIES[0] },
    { label: "Typed", value: kinds.typing, color: SERIES[3] },
    { label: "Draft", value: kinds.draft, color: SERIES[2] },
  ].filter((p) => p.value > 0) : [];
  const langBlock = lp.length > 1 || kp.length > 1
    ? section("What it hears", undefined, [
        ...(lp.length > 1 ? [text("Languages", "d-eyebrow", { marginTop: 18 }), splitBar(lp)] : []),
        ...(kp.length > 1 ? [text("Spoken, typed, drafted", "d-eyebrow", { marginTop: 30 }), splitBar(kp)] : []),
      ])
    : null;

  return screen("desk_train", "Train", [band, page([
    stageBlock,
    ...(coreBlock ? [coreBlock] : []),
    ...twoUp(wordsBlock, stylesBlock),
    ...twoUp(rhythmBlock, toneBlock),
    ...(fromBlock ? [fromBlock] : []),
    ...twoUp(voicesBlock, langBlock),
  ])]);
}

// ---- NOTES ---------------------------------------------------------------------------
//
// The note-taker's pages: every note, by day, and one note in full. A note is
// what the window heard while the hotkey was on — a meeting, a lecture, a
// thought said aloud — organised by the writer (src/notes/organise.ts) into
// what came up, what was decided, who will do what, and what is still open.
// People stay apart: every point that belongs to someone says whose it is.

const NOTE_STATUS: Record<string, string> = {
  recording: "Still recording, or stopped before it finished",
  organising: "Organising. This takes a minute",
  failed: "Couldn't organise this one. What was heard is kept",
};

/**
 * THE NOTE PAGE'S AIR. One rhythm for the whole page, so it reads as a few
 * calm sections and not one long list: the most room between sections, less
 * between the parts of one, and a heading always closer to what it heads than
 * to what came before it.
 */
const NOTE_AIR = { section: 72, part: 56, head: 20, box: 12 } as const;
/** A note section's heading: the desk's h2, a step up, set apart from its body. */
const NOTE_HEAD: Style = { fontSize: 24, lineHeight: "30px", marginBottom: NOTE_AIR.head };
/** The text column: summary and boxes keep a comfortable line length. */
const NOTE_MEASURE = 720;

/** A speaker as a small chip: a dot of their colour and their name. */
function speakerChip(name: string, color: string): Node {
  return row([speakerDot(color, 7), text(name, "d-margin-strong", { color: "var(--d-ink)", whiteSpace: "nowrap" })], {
    gap: 7, align: "center", paddingTop: 4, paddingBottom: 4, paddingLeft: 9, paddingRight: 11,
    radius: 999, background: tint(color, 11), border: `1px solid ${tint(color, 24)}`,
  });
}

/**
 * One turn in "What mattered": what a speaker said in a row, in a soft box
 * of their colour, their dot and name at the top. Text stays in the ink; the
 * colour is only the wash, the hairline and the dot.
 */
function speakerBox(name: string, color: string, points: string[]): Node {
  return stack([
    row([speakerDot(color), text(name, "d-margin-strong", { color: "var(--d-ink)" })], { gap: 8, align: "center" }),
    ...points.map((p, i) => /[ऀ-ॿ]/.test(p)
      ? text(p, "d-said d-deva", { fontSize: 16, lineHeight: "25px", color: "var(--d-ink)", marginTop: i ? 12 : 10 })
      : text(p, "d-said", { fontSize: 20, lineHeight: "27px", color: "var(--d-ink)", marginTop: i ? 12 : 8 })),
  ], {
    background: tint(color, 9), border: `1px solid ${tint(color, 22)}`, radius: 12,
    paddingTop: 14, paddingBottom: 18, paddingLeft: 20, paddingRight: 22,
  }, "d-speaker");
}

/** "You, Priya, Speaker 3" — names where the writer found them. */
function peopleLine(people: NoteSummary["people"], transcript?: Note["transcript"]): string {
  const named = new Map((people ?? []).map((p) => [p.label, p.name]));
  return peopleLabels(people, transcript).map((l) => named.get(l) || l).join(", ");
}
/** Who is in a note, by label, in the order they first spoke. */
function peopleLabels(people: NoteSummary["people"], transcript?: Note["transcript"]): string[] {
  return transcript?.length
    ? [...new Set(transcript.map((s) => s.speaker ?? "").filter(Boolean))]
    : (people ?? []).map((p) => p.label);
}

function noteTitle(ctx: DeskContext, nt: Pick<NoteSummary, "title" | "startedAt">): string {
  if (nt.title) return nt.title;
  const d = local(ctx, Date.parse(nt.startedAt));
  return `Notes, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)} at ${clock(d)}`;
}

function dayHeading(ctx: DeskContext, iso: string): string {
  const d = local(ctx, Date.parse(iso)), now = local(ctx, Date.now());
  const k = dayKey(d);
  if (k === dayKey(now)) return "Today";
  if (k === dayKey(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return dateLine(d);
}

const startNotes: ActionRef = { kind: "notes.toggle" };

const DAYPARTS = ["Morning", "Afternoon", "Evening", "Night"] as const;
/** Morning from five, afternoon from noon, evening from five, night from nine. */
const daypart = (h: number) => (h >= 5 && h < 12 ? 0 : h >= 12 && h < 17 ? 1 : h >= 17 && h < 21 ? 2 : 3);

/**
 * NOTES — the room carries the four figures (how many, how long, how many
 * words, who), then the notes as numbers: the last two weeks, how long they
 * run, when in the day, who is in them. Every note follows, newest first.
 * The charts only come once there are two notes to compare.
 */
export function deskNotes(ctx: DeskContext): ScreenResponse {
  const all = ctx.notes ?? [];
  const now = local(ctx, Date.now());
  const secs = all.reduce((s, x) => s + (x.durationSeconds || 0), 0);
  const heard = all.reduce((s, x) => s + (x.words || 0), 0);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const thisWeek = all.filter((x) => Date.parse(x.startedAt) >= weekAgo).length;
  // The people the writer could name, each counted once per note they were in.
  const met = new Map<string, number>();
  for (const nt of all) {
    for (const name of new Set((nt.people ?? []).filter((p) => p.name && p.label !== "You").map((p) => p.name!))) {
      met.set(name, (met.get(name) ?? 0) + 1);
    }
  }

  const figures = all.length ? row([
    statTile("Notes", n(all.length), `${thisWeek} in the last 7 days`, true, true),
    statTile("Time heard", span(secs / 60), `about ${span(secs / all.length / 60)} each`, true),
    statTile("Words heard", n(heard), secs >= 60 ? `${n(heard / (secs / 60))} a minute` : "across every note", true),
    statTile("People met", n(met.size), met.size ? "named in your notes" : "no names heard yet", true),
  ], { gap: 36, flexWrap: "wrap", marginTop: 26, paddingTop: 22, borderTop: "1px solid rgba(243,226,198,.12)", width: "100%" }) : null;

  const band = room([
    stack([
      text("Notes", "d-eyebrow"),
      text("Meetings, lectures, thoughts", "d-h1", { marginTop: 6 }),
      ...(all.length ? [] : [text("Nothing yet", "d-count d-on-room", { marginTop: 12 })]),
    ], { minWidth: 0 }),
    ...(ctx.notesHotkey ? [row([
      keys("notes", true),
      text("to start or stop. Nothing is typed anywhere.", "d-count d-on-room", { maxWidth: 170, marginLeft: 6 }),
    ], { align: "center", gap: 0 })] : []),
    ...(figures ? [figures] : []),
  ]);

  // ---- the notes as numbers -------------------------------------------------------------
  const charts: Node[] = [];
  if (all.length >= 2) {
    const today = dayKey(now);
    const perDay = new Array(14).fill(0) as number[];
    const lengths = [0, 0, 0, 0, 0];
    const parts = [0, 0, 0, 0];
    let together = 0, alone = 0;
    for (const nt of all) {
      const d = local(ctx, Date.parse(nt.startedAt));
      const ago = Math.round((Date.parse(today) - Date.parse(dayKey(d))) / 86_400_000);
      const min = (nt.durationSeconds || 0) / 60;
      if (ago >= 0 && ago < 14) perDay[13 - ago] += min;
      lengths[min < 5 ? 0 : min < 15 ? 1 : min < 30 ? 2 : min < 60 ? 3 : 4]! += 1;
      parts[daypart(d.getUTCHours())]! += 1;
      if ((nt.people ?? []).length > 1) together += 1; else alone += 1;
    }
    const dayLabel = (k: number) => { const d = new Date(now.getTime() - k * 86_400_000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]!.slice(0, 3)}`; };
    const activeDays = perDay.filter((v) => v > 0).length;
    const daysBlock = activeDays
      ? section("The last two weeks", `Minutes heard each day. ${activeDays} of the 14 days had a note.`,
          [columns(perDay, { highlight: [13], ticks: [dayLabel(13), dayLabel(7), "Today"] })])
      : null;
    const lPeak = lengths.indexOf(Math.max(...lengths));
    const lengthBlock = section("How long they run", `Most notes run ${["under 5 minutes", "5 to 15 minutes", "15 to 30 minutes", "half an hour to an hour", "over an hour"][lPeak]}.`,
      [columns(lengths, { highlight: [lPeak], labels: ["<5 min", "5–15", "15–30", "30–60", "60+"] })]);
    const pPeak = parts.indexOf(Math.max(...parts));
    const whenBlock = section("When you take them", `Mostly in the ${DAYPARTS[pPeak]!.toLowerCase()}${pPeak === 3 ? "" : "s"}.`,
      [columns(parts, { highlight: [pPeak], labels: [...DAYPARTS] })]);
    const people = [...met.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
    const whoBlock = section("Who's in them", together && alone
        ? `${pct(together, all.length)}% are conversations; the rest, you on your own.`
        : together ? "Every note is a conversation." : "Every note is you on your own.", [
      ...(together && alone ? [splitBar([
        { label: "With others", value: together, color: SERIES[1] },
        { label: "On your own", value: alone, color: SERIES[0] },
      ])] : []),
      ...(people.length ? [
        text("Who comes up most", "d-eyebrow", { marginTop: 28 }),
        barList(people.map(([name, k]) => ({ label: name, words: k, value: `${k} ${k === 1 ? "note" : "notes"}` }))),
      ] : []),
    ]);
    charts.push(...twoUp(daysBlock, lengthBlock, { marginTop: 0 }), ...twoUp(whenBlock, whoBlock));
  }

  const body: Node[] = [];
  if (!all.length) {
    body.push(stack([
      text("No notes yet.", "d-written", { fontSize: 19, lineHeight: "27px" }),
      text("Start it in a meeting, a lecture, or on a walk around your own ideas. Tailzu listens to your microphone and to your computer's sound, tells the voices apart, and keeps it short here: what the meeting was, a paragraph on the whole conversation, and the few things people said that mattered, with who said them.", "d-lede", { marginTop: 8, maxWidth: 560 }),
      ...(ctx.notesHotkey ? [row([link("Start taking notes", startNotes, "d-btn")], { marginTop: 16 })] : []),
    ], { paddingBottom: 26 }));
  } else if (charts.length) {
    body.push(text("Every note", "d-h2", { marginTop: 60, marginBottom: 18 }));
  }
  let lastDay = "";
  for (const nt of all) {
    const day = dayHeading(ctx, nt.startedAt);
    if (day !== lastDay) {
      body.push(text(day, "d-eyebrow", { marginTop: lastDay ? 34 : 0, marginBottom: 4 }));
      lastDay = day;
    }
    const d = local(ctx, Date.parse(nt.startedAt));
    const who = peopleLine(nt.people);
    const status = nt.status !== "ready" ? NOTE_STATUS[nt.status] : !nt.organised ? "Nothing was heard"
      : nt.systemAudio === "denied" ? "Your side only" : "";
    body.push(row([
      stack([
        text(clock(d), "d-margin-strong"),
        ...(nt.durationSeconds ? [text(span(nt.durationSeconds / 60), "d-margin")] : []),
      ], { width: 96, flex: "none", paddingTop: 3 }),
      stack([
        text(noteTitle(ctx, nt), "d-written"),
        ...(nt.summary ? [text(nt.summary, "d-lede")] : []),
        ...(who || status ? [text([who, status].filter(Boolean).join(" · "), "d-margin", { marginTop: 4 })] : []),
      ], { flex: 1, minWidth: 0, gap: 4 }),
    ], { gap: 24, paddingTop: 22, paddingBottom: 22 }, "d-entry", {
      on: { onPress: { kind: "navigate", screenId: "desk_note", params: { noteId: nt.id } } },
    }));
  }

  return screen("desk_notes", "Notes", [band, page([...charts, stack(body, { maxWidth: 760 })])]);
}

/** The Mac did not let Tailzu hear the computer's sound: only the
 *  microphone is in this note. A window that can open the setting gets a
 *  button for it; an older one, where to find it. */
function onlyYourSide(canOpen: boolean): Node {
  return stack([
    text("Only your side", "d-eyebrow"),
    text("Tailzu couldn't hear your computer's sound, so this note has only what your microphone heard.", "d-written", { marginTop: 6, maxWidth: 620 }),
    text("Allow it once, and your next note includes everyone on the call.", "d-lede", { marginTop: 4 }),
    canOpen
      ? row([link("Allow", { kind: "notes.allowSystemAudio" }, "d-btn")], { marginTop: 14 })
      : text("System Settings → Privacy & Security → Screen & System Audio Recording → turn on Tailzu.", "d-margin", { marginTop: 10 }),
  ], { paddingTop: 18, paddingBottom: 20, paddingLeft: 22, paddingRight: 22, marginBottom: 44, radius: 12, background: "var(--d-press)", border: "1px solid var(--d-rule)", maxWidth: NOTE_MEASURE });
}

/** The note as plain text, for Copy: the meeting, the paragraph, the lines. */
function noteText(ctx: DeskContext, nt: Note): string {
  const named = new Map(nt.people.map((p) => [p.label, p.name]));
  const d = local(ctx, Date.parse(nt.startedAt));
  const out = [noteTitle(ctx, nt), `${dateLine(d)}, ${clock(d)}`];
  const who = peopleLine(nt.people, nt.transcript);
  if (who) out.push(`With: ${who}`);
  if (nt.summary) out.push("", nt.summary);
  if (nt.highlights.length) out.push("", ...nt.highlights.map((h) => `${named.get(h.speaker) || h.speaker}: ${h.text}`));
  return out.join("\n");
}

interface Voice { label: string; name: string; seconds: number; words: number; turns: number; longest: number; questions: number }

/**
 * The conversation as numbers, read off the kept transcript: for each voice,
 * how long it talked, how many words, how many turns, its longest unbroken
 * stretch, how many questions. A stretch runs to the next one's start, but no
 * longer than its words could take at a slow two a second, so a silence after
 * someone stops is not counted as their talking.
 */
function talkStats(nt: Note): { voices: Voice[]; spans: Array<{ label: string; at: number; end: number }>; words: number; turns: number; questions: number } {
  const named = new Map(nt.people.map((p) => [p.label, p.name]));
  const segs = [...nt.transcript].filter((x) => x.text?.trim()).sort((x, y) => x.at - y.at);
  const by = new Map<string, Voice>();
  const spans: Array<{ label: string; at: number; end: number }> = [];
  let prev = "", run = 0, words = 0, turns = 0, questions = 0;
  segs.forEach((g, i) => {
    const label = g.speaker || "Others";
    const w = g.text.trim().split(/\s+/).length;
    const next = segs[i + 1]?.at ?? Math.max(nt.durationSeconds || 0, g.at + w / 2.5);
    const secs = Math.max(0.5, Math.min(next - g.at, w / 2));
    const q = (g.text.match(/\?/g) ?? []).length;
    const v = by.get(label) ?? { label, name: named.get(label) || label, seconds: 0, words: 0, turns: 0, longest: 0, questions: 0 };
    v.seconds += secs; v.words += w; v.questions += q;
    if (label !== prev) { v.turns += 1; turns += 1; run = 0; prev = label; }
    run += secs; v.longest = Math.max(v.longest, run);
    by.set(label, v);
    spans.push({ label, at: g.at, end: g.at + secs });
    words += w; questions += q;
  });
  return { voices: [...by.values()].sort((x, y) => y.seconds - x.seconds), spans, words, turns, questions };
}

/** m:ss, or h:mm:ss past the hour — a place in a recording. */
const stamp = (secs: number) => {
  const t = Math.max(0, Math.round(secs)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s2 = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s2).padStart(2, "0")}` : `${m}:${String(s2).padStart(2, "0")}`;
};

/** Seconds as the page says them: "45 sec", "3 min", "1 h 05". */
const secsLine = (secs: number) => (secs < 60 ? `${Math.max(1, Math.round(secs))} sec` : span(secs / 60));

/**
 * The conversation in numbers: who talked (a donut of the talking time), who
 * said what (a small table), and who spoke when — every stretch of talk on
 * one line per voice, under the words-a-minute of the meeting as it went.
 */
function noteNumbers(nt: Note): Node[] {
  const t = talkStats(nt);
  if (!t.spans.length) return [];
  const length = Math.max(nt.durationSeconds || 0, ...t.spans.map((x) => x.end), 1);
  // One colour per voice for the whole page (speakerColor): the same as its
  // box in "What mattered". The donut shows the four who talked most, anyone
  // past them as Others.
  const colorOf = new Map(t.voices.map((v) => [v.label, speakerColor(v.label)]));
  const parts = foldParts(t.voices.map((v) => ({ label: v.name, value: v.seconds, value2: secsLine(v.seconds), color: colorOf.get(v.label) })));
  if (t.voices.length > 4) {
    const rest = t.voices.slice(4).reduce((s, v) => s + v.seconds, 0);
    parts[parts.length - 1] = { label: "Others", value: rest, color: OTHER, value2: secsLine(rest) };
  }

  const tiles = row([
    statTile("Pace", n(t.words / (length / 60)), "words a minute"),
    statTile("Voices", n(t.voices.length), t.voices.length === 1 ? "just one" : "told apart"),
    statTile("Turns", n(t.turns), "changes of speaker"),
    statTile("Questions", n(t.questions), "asked out loud"),
  ].map((x) => ({ ...x, style: { ...(x.style ?? {}), minWidth: 150 } })), { gap: 32, flexWrap: "wrap", paddingTop: 28 }, "d-rule-top");

  const share = t.voices.length > 1
    ? section("Who talked", "Each voice's share of the talking time.",
        [donutWithLegend(parts, { value: secsLine(t.voices.reduce((s, v) => s + v.seconds, 0)), label: "talking" })])
    : section("Who talked", `Only ${t.voices[0]!.name === "You" ? "you" : t.voices[0]!.name}, for ${secsLine(t.voices[0]!.seconds)}.`, []);

  const cell = (v: string, w: number, strong = false): Node =>
    text(v, strong ? "d-margin-strong" : "d-num", { width: w, flex: "none", textAlign: "right" });
  const table = section("Who said what", undefined, [stack([
    row([text("", "d-margin", { flex: 1 }), cell("Words", 60, true), cell("Turns", 52, true), cell("Longest", 64, true), cell("Asked", 48, true)],
      { gap: 10, paddingBottom: 10 }, "d-rule-bottom"),
    ...t.voices.slice(0, 8).map((v) => row([
      row([swatch(colorOf.get(v.label) ?? OTHER), text(v.name, "d-k", { fontWeight: 500, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 })],
        { gap: 8, align: "center", flex: 1, minWidth: 0 }),
      cell(n(v.words), 60), cell(n(v.turns), 52), cell(secsLine(v.longest), 64), cell(n(v.questions), 48),
    ], { gap: 10, align: "center", paddingTop: 10, paddingBottom: 10 }, "d-rule-bottom")),
  ], { marginTop: 20 })]);

  // Words a minute through the meeting: about a column a minute, at most 40.
  const B = Math.max(6, Math.min(40, Math.round(length / 60)));
  const flow = new Array(B).fill(0) as number[];
  for (const g of nt.transcript) {
    if (!g.text?.trim()) continue;
    flow[Math.min(B - 1, Math.floor((g.at / length) * B))]! += g.text.trim().split(/\s+/).length * (B / (length / 60));
  }
  const fPeak = flow.indexOf(Math.max(...flow));
  // Each lane is read at 300 steps and drawn as its runs, so an hour of short
  // turns is a few dozen marks on the page, not a thousand.
  const STEPS = 300;
  const lanes = t.voices.slice(0, 6).map((v) => {
    const on = new Array(STEPS).fill(false) as boolean[];
    for (const x of t.spans) {
      if (x.label !== v.label) continue;
      const a = Math.floor((x.at / length) * STEPS), b = Math.max(a, Math.ceil((x.end / length) * STEPS) - 1);
      for (let k = a; k <= Math.min(STEPS - 1, b); k++) on[k] = true;
    }
    const marks: Node[] = [];
    for (let k = 0; k < STEPS; k++) {
      if (!on[k]) continue;
      let e = k;
      while (e + 1 < STEPS && on[e + 1]) e++;
      marks.push(stack([], {
        position: "absolute", top: 0, bottom: 0,
        left: `${((k / STEPS) * 100).toFixed(2)}%`, width: `${(((e - k + 1) / STEPS) * 100).toFixed(2)}%`,
        background: colorOf.get(v.label) ?? OTHER, radius: 2,
      }));
      k = e;
    }
    return row([
      text(v.name, "d-margin-strong", { width: 110, flex: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
      stack(marks, { position: "relative", flex: 1, minWidth: 0, height: 14, radius: 3, background: "color-mix(in srgb, var(--d-ink) 5%, var(--d-sheet))" }),
    ], { gap: 14, align: "center" });
  });
  const timeline = section("Who spoke when", `Every stretch of talk across the ${secsLine(length)}, under how fast the words came.`, [
    stack([
      row([stack([], { width: 110, flex: "none" }), stack([columns(flow, { highlight: [fPeak], height: 64 })], { flex: 1, minWidth: 0 })], { gap: 14 }),
      stack(lanes, { gap: 10, marginTop: 16 }),
      row([stack([], { width: 110, flex: "none" }),
        row([stamp(0), stamp(length / 2), stamp(length)].map((l) => text(l, "d-margin")), { justify: "between", flex: 1, minWidth: 0 })],
        { gap: 14, marginTop: 10 }),
    ], { marginTop: 20 }),
  ], { flex: "none", width: "100%", marginTop: NOTE_AIR.part });

  return [
    text("The conversation in numbers", "d-h2", { ...NOTE_HEAD, marginTop: NOTE_AIR.section }),
    tiles,
    ...twoUp(share, table, { marginTop: NOTE_AIR.part }),
    timeline,
  ];
}

/**
 * One note: the meeting, one paragraph on the whole conversation, and the
 * few things people said that matter — each with who said it, in their own
 * voice, worded the best way. Under them, the conversation in numbers (see
 * noteNumbers); the transcript itself is never shown.
 */
export function deskNote(ctx: DeskContext): ScreenResponse {
  const nt = ctx.note;
  if (!nt) {
    return screen("desk_note", "Note", [page([
      text("Notes", "d-eyebrow"),
      text("This note is gone.", "d-h1", { marginTop: 6 }),
      row([link("All notes", { kind: "switchTab", tabId: "desk_notes" })], { marginTop: 18 }),
    ])]);
  }
  const d = local(ctx, Date.parse(nt.startedAt));
  const named = new Map(nt.people.map((p) => [p.label, p.name]));
  const nameOf = (label: string) => named.get(label) || label;
  const who = peopleLabels(nt.people, nt.transcript);
  const meta = [dateLine(d), clock(d), nt.durationSeconds ? span(nt.durationSeconds / 60) : ""].filter(Boolean).join(" · ");
  const busy = nt.status === "organising";
  const canOrganise = nt.status === "failed" || nt.status === "recording" || (nt.status === "ready" && !nt.organised && nt.transcript.length > 0);

  const head = stack([
    row([link("All notes", { kind: "switchTab", tabId: "desk_notes" })], { marginBottom: 18 }),
    text("Meeting", "d-eyebrow"),
    text(noteTitle(ctx, nt), "d-h1", { marginTop: 6 }),
    text(meta, "d-count", { marginTop: 12 }),
    // Who was in it, each in their colour: the page's key to the boxes below.
    ...(who.length ? [row([
      text("With", "d-margin", { marginRight: 2 }),
      ...who.map((l) => speakerChip(nameOf(l), speakerColor(l))),
    ], { gap: 8, align: "center", flexWrap: "wrap", marginTop: 16 })] : []),
    ...(nt.status !== "ready" ? [text(NOTE_STATUS[nt.status] ?? "", "d-lede", { marginTop: 12 })] : []),
    ...(nt.status === "ready" && !nt.organised ? [text("Nobody spoke in this one.", "d-lede", { marginTop: 12 })] : []),
    row([
      ...(nt.organised ? [link("Copy", { kind: "copyText", text: noteText(ctx, nt), message: "Copied" })] : []),
      ...(busy ? [link("Refresh", { kind: "refresh" })] : []),
      ...(canOrganise ? [link(nt.status === "recording" ? "Organise now" : "Organise again", {
        kind: "callEndpoint", method: "POST", path: `/v1/notes/${nt.id}/organise`,
        onSuccess: { kind: "toast", message: "Organising. Give it a minute." },
      } as ActionRef)] : []),
      { ...link("Delete", { kind: "setState", path: "noteDel", value: true }), visibleIf: { falsy: "noteDel" } },
      { ...row([
        text("Delete this note?", "d-margin-strong"),
        link("Delete", {
          kind: "callEndpoint", method: "DELETE", path: `/v1/notes/${nt.id}`,
          onSuccess: { kind: "switchTab", tabId: "desk_notes" },
        } as ActionRef),
        link("Keep", { kind: "setState", path: "noteDel", value: false }),
      ], { gap: 14, align: "center" }), visibleIf: { truthy: "noteDel" } },
    ], { gap: 22, marginTop: 22, align: "center", flexWrap: "wrap" }),
  ], { paddingBottom: 30, marginBottom: 44 }, "d-rule-bottom");

  const body: Node[] = [];
  // THE COMPUTER'S SOUND WAS OFF. The note is still made, from the
  // microphone; this says so, and how to have everyone in the next one.
  if (nt.systemAudio === "denied") body.push(onlyYourSide(!!ctx.allowSystemAudio));
  if (nt.summary) body.push(text(nt.summary, "d-written", { fontSize: 19, lineHeight: "31px", maxWidth: 680 }));
  if (nt.highlights.length) {
    // A turn is what one speaker said in a row: one box, their colour.
    const turns: Array<{ speaker: string; points: string[] }> = [];
    for (const h of nt.highlights) {
      const last = turns[turns.length - 1];
      if (last && last.speaker === h.speaker) last.points.push(h.text);
      else turns.push({ speaker: h.speaker, points: [h.text] });
    }
    body.push(stack([
      text("What mattered", "d-h2", NOTE_HEAD),
      stack(turns.map((t) => speakerBox(nameOf(t.speaker), speakerColor(t.speaker), t.points)), { gap: NOTE_AIR.box }),
    ], { marginTop: nt.summary ? NOTE_AIR.section - 8 : 0 }));
  }

  return screen("desk_note", noteTitle(ctx, nt), [page([head, stack(body, { maxWidth: NOTE_MEASURE }), ...noteNumbers(nt)])], { noteDel: false });
}

// ---- SETTINGS and PLAN ----------------------------------------------------------------

const defRow = (k: string, v: Node | string, right?: Node): Node => row([
  text(k, "d-k", { width: 220, flex: "none" }),
  typeof v === "string" ? text(v, "d-v", { flex: 1, minWidth: 0 }) : stack([v], { flex: 1, minWidth: 0 }),
  ...(right ? [right] : []),
], { align: "center", gap: 28, paddingTop: 20, paddingBottom: 20, flexWrap: "wrap" }, "d-entry");

function planWords(ctx: DeskContext): { used: number; of: number; paid: boolean } {
  return {
    used: ctx.allowance?.used ?? ctx.usage?.month.words ?? 0,
    of: ctx.allowance?.total ?? 0,
    paid: !!ctx.entitlement,
  };
}

/**
 * LET ASK SEE WHAT YOU SEE: Ask's one-time setup, in the app (the window's
 * sdui.js askSetupNode draws it). The owner: "if the user accepts there, we
 * don't have to ask every time on the working screens." Three rows, each a
 * permission with its own button: read the screen (the Mac's
 * Accessibility), see it (Screen Recording), and look when it's needed
 * without stopping to ask (a yes for every app, kept on that computer).
 *
 * Only the words come from here. Whether a row is on is the computer's to
 * say, and none of it comes to the server: the window asks its main process
 * and draws each row's state and button from that answer. The home card
 * puts itself away once every row is on; the one in Settings always shows.
 *
 * NOT ONE WORD ABOUT SENDING. The owner: "dont use the send the pic words
 * while asking permissions". The card says Ask sees or looks at the screen
 * when it is needed. That a picture of part of it goes with a question that
 * needs one, and where, is the privacy policy's to say (its Ask section,
 * routes/policies/privacy.ts), and the card links to it.
 */
function askSetupCard(a: NonNullable<DeskContext["askSetup"]>, place: "home" | "settings"): Node {
  const home = place === "home";
  // Windows asks for neither system permission, so there the row is simply
  // on, and a line about opening the Mac's setting would be about another
  // computer. A window that did not say which it is gets the Mac's line.
  const mac = a.os !== "windows" && a.os !== "linux";
  return {
    type: "DeskAskSetup",
    props: {
      place,
      // On the home page the card is a page of its own above the room, on the
      // page's measure; in Settings it sits in its section's column.
      ...(home ? { cls: "d-page" } : {}),
      eyebrow: "Ask · one-time setup",
      title: "Let Ask see",
      titleEm: "what you see.",
      lede: "Allow these once and Ask answers straight away on any screen, without stopping to ask.",
      rows: [
        { key: "read", title: "Read the screen", sub: "Buttons, fields and text, so it can point at things and do small jobs." },
        { key: "see", title: "See the screen", sub: mac ? "Text in pictures, charts and diagrams. Opens the Mac's Screen Recording setting." : "Text in pictures, charts and diagrams." },
        { key: "pictures", title: "Look at the screen when it's needed", sub: "When a question is about something on your screen, Ask looks without stopping to ask." },
      ],
      on: "On",
      allow: "Allow",
      turnOff: "Turn off",
      restart: "Restart Tailzu to finish",
      restartButton: "Restart",
      // "Change these any time in Settings" is the home card's to say: read
      // on the Settings page, it sent you to the page you were on.
      foot: home ? "Change these any time in Settings. How Ask uses what it sees:" : "How Ask uses what it sees:",
      policyLabel: "Privacy policy",
      policyUrl: a.privacyUrl,
    },
    ...(home ? { style: { ...typeFor("d-page"), paddingTop: 44, paddingBottom: 44 } } : {}),
  };
}

export function deskSettings(ctx: DeskContext): ScreenResponse {
  const q = planWords(ctx);
  const langs = (ctx.personality.languages ?? []).filter((l) => l && l !== "auto");
  const who = ctx.email || ctx.phone || "";
  // The read-aloud voice, as a friendly label — the stored one, or the default.
  const readVoice = isValidTtsVoice(ctx.personality.ttsVoice) ? ctx.personality.ttsVoice : DEFAULT_TTS_VOICE;
  const readVoiceLabel = ttsVoiceById(readVoice)?.label ?? readVoice;
  return screen("desk_settings", "Settings", [page([
    text("Settings", "d-eyebrow"),
    text("How Tailzu works on this computer", "d-h1", { marginTop: 6, marginBottom: 26 }),
    stack([
      text("Talking", "d-h2", { marginBottom: 8 }),
      defRow("Shortcut", row([
        text("Tap", "d-v"), keys("tap", true), text("twice, or press", "d-v"), keys("hotkey", true),
      ], { gap: 8, align: "center", flexWrap: "wrap" }), text("Change it from the tray", "d-margin")),
      defRow("Tap to talk", "Tap the key twice to start, twice again to finish", sw("tap", "Tap to talk")),
      defRow("The pill", "Shown at the foot of the screen while you talk", sw("pill", "Show the pill")),
      defRow("Write on a pause", "Each pause writes what you said, and it keeps listening", sw("pauseFlush", "Write on a pause")),
      defRow("Live words", "Words appear above the pill as you speak", sw("live", "Live words")),
      defRow("Start with the computer", "Ready when you sign in", sw("autoStart", "Start with the computer")),
    ], { marginBottom: 40 }),
    // Ask's three permissions, always here with their states, so a yes given
    // once on the home card can be seen and taken back.
    ...(ctx.askSetup ? [stack([
      text("Ask", "d-h2", { marginBottom: 14 }),
      askSetupCard(ctx.askSetup, "settings"),
    ], { marginBottom: 40 })] : []),
    ...(ctx.assistant?.apps?.length ? [connectedApps(ctx.assistant.apps)] : []),
    stack([
      text("Languages", "d-h2", { marginBottom: 8 }),
      defRow("You speak", langs.length ? langs.map((l) => (Object.hasOwn(LANGUAGE_NAMES, l) ? LANGUAGE_NAMES[l] : l)).join(", ") : "Found on its own, as you talk",
        link("Change", { kind: "navigate", screenId: "languages" })),
    ], { marginBottom: 40 }),
    stack([
      text("Its name", "d-h2", { marginBottom: 8 }),
      defRow("You call it", nicknameOf(ctx.personality) ? `Tailzu, or ${nicknameOf(ctx.personality)}` : "Tailzu",
        link(nicknameOf(ctx.personality) ? "Change" : "Give it a name", { kind: "navigate", screenId: "desk_assistant_name" })),
    ], { marginBottom: 40 }),
    stack([
      text("Reading aloud", "d-h2", { marginBottom: 8 }),
      defRow("Voice", readVoiceLabel,
        link("Change", { kind: "navigate", screenId: "desk_voice_read" })),
    ], { marginBottom: 40 }),
    ctx.free && !q.paid ? stack([
      text("Plan", "d-h2", { marginBottom: 8 }),
      defRow("Free", "Every word, on every device. Nothing to pay.", text("No limit", "d-margin")),
    ], { marginBottom: 40 }) : stack([
      text("Plan", "d-h2", { marginBottom: 8 }),
      defRow(q.paid ? "Unlimited" : "Free", q.paid ? "Every word, on every device" : `${n(q.used)} of ${n(q.of)} words this month`,
        q.paid
          ? razorpayPlan(ctx) ?? (ctx.manageUrl ? link("Manage", { kind: "openUrl", url: ctx.manageUrl }) : undefined)
          : link("See plans", { kind: "navigate", screenId: "desk_plan" })),
    ], { marginBottom: 40 }),
    stack([
      text("Privacy", "d-h2", { marginBottom: 8 }),
      defRow("Your audio", "Deleted as soon as it is written", text("Always", "d-margin")),
      defRow("History", "Kept so you can copy a note again", {
        type: "Switch", props: { cls: "d-switch", accessibilityLabel: "Keep history" },
        bind: { value: "retainHistory" },
        on: { onChange: { kind: "sequence", actions: [
          { kind: "toggleState", path: "retainHistory" },
          { kind: "callEndpoint", method: "PUT", path: "/v1/personality", body: { retainHistory: "$state.retainHistory" } },
        ] } },
      }),
    ], { marginBottom: 40 }),
    stack([
      text("Account", "d-h2", { marginBottom: 8 }),
      defRow("Signed in as", who || "This account", link("Sign out", { kind: "signOut" })),
    ]),
  ], { maxWidth: 820 })], { retainHistory: ctx.personality.retainHistory !== false });
}

// ---- CONNECTED APPS and TASKS ---------------------------------------------------------
//
// The assistant's side of the desk, built here and only drawn by the window:
// the words are connectors/words.ts (the approved design's, in English; the
// translator has the design's Hinglish for them), the rows are the plain nodes
// above, and every button is an action the window already has (callEndpoint to
// the routes in routes/connectors.ts) plus "connector.connect", which opens the
// sign-in page that route answers with. Nothing here is decided on the device.

const LEVELS = ["look", "draft", "send"] as const;
const failToast = (key: "err.level" | "err.connect" | "err.generic"): ActionRef => ({ kind: "toast", message: w(key) });

/** One app: its state, how far the assistant may go in it, and the way out. */
function appRow(c: ConnectorInfo): Node {
  const again = c.connected && c.needsSignIn === true;
  const on = c.connected && !again;
  const detail: Node[] = [text(c.oneLine, "d-v")];
  // An app that takes a pasted link (Zapier) asks for it before the button.
  if (c.auth === "url" && !on) {
    detail.push({
      type: "TextField", props: { cls: "d-input", placeholder: w("link.ph", { app: c.name }) },
      bind: { value: `link.${c.id}` }, style: { marginTop: 6, maxWidth: 420 },
    } as Node);
  }
  if (c.connected) {
    const level = LEVELS.includes(c.level) ? c.level : "look";
    detail.push(
      text(w("a2.q", { app: c.name }), "d-margin", { marginTop: 10 }),
      row(LEVELS.map((l) => l === level
        ? ({ type: "Button", props: { label: w(`lv.${l}`), cls: "d-seg-item d-seg-on" } } as Node)
        : link(w(`lv.${l}`), {
            kind: "callEndpoint", method: "POST", path: `/v1/connectors/${c.id}/level`, body: { level: l },
            onError: failToast("err.level"),
          } as ActionRef, "d-seg-item")), { alignSelf: "flex-start" }, "d-seg"),
      text(w(`lv.${level}.d`), "d-lede", { marginTop: 2 }),
      text(w("a2.foot"), "d-margin", { marginTop: 6 }),
      row([link(w("a2.dis", { app: c.name }), {
        kind: "callEndpoint", method: "DELETE", path: `/v1/connectors/${c.id}`, onError: failToast("err.generic"),
      } as ActionRef)], { marginTop: 4 }),
    );
  }
  const state = on ? w("st.ok") : again ? w("st.re") : w("st.no");
  const right = on
    ? text(state, "d-margin")
    : row([
        text(state, "d-margin"),
        link(w("connect"), {
          kind: "connector.connect", id: c.id, ...(c.auth === "url" ? { urlPath: `link.${c.id}` } : {}),
          onError: failToast("err.connect"),
        } as ActionRef, "d-btn"),
      ], { gap: 14, align: "center" });
  return defRow(c.name, stack(detail, { gap: 2, flex: 1, minWidth: 0 }), right);
}

/** Settings > Connected apps: every app switched on, with its state, its level and its button. */
function connectedApps(apps: ConnectorInfo[]): Node {
  return stack([
    text(w("apps.h"), "d-h2", { marginBottom: 4 }),
    text(w("apps.p"), "d-lede", { marginBottom: 8 }),
    ...apps.map(appRow),
  ], { marginBottom: 40 });
}

/** The newest step, in the words the server wrote it in. */
const lastStep = (t: AssistantTask): string => t.steps[t.steps.length - 1]?.text ?? "";

/**
 * TASKS: what the assistant is doing in the person's apps, grouped Waiting for
 * you, Running and Done, each with what happened in plain words. A waiting one
 * shows the exact words and answers to Approve or Not now, the same two the
 * confirm card gives (routes/connectors.ts approve and deny).
 */
export function deskTasks(ctx: DeskContext): ScreenResponse {
  const tasks = ctx.assistant?.tasks ?? [];
  const names = ctx.assistant?.names ?? {};
  const waiting = tasks.filter((t) => t.state === "waiting" && t.approval);
  const running = tasks.filter((t) => t.state === "running");
  const done = tasks.filter((t) => t.state === "done" || t.state === "failed" || t.state === "cancelled");
  const item = (t: AssistantTask, body: Node[], right?: Node): Node => row([
    stack([text(t.title, "d-v"), ...body], { flex: 1, minWidth: 0, gap: 4 }),
    ...(right ? [right] : []),
  ], { align: "center", gap: 28, paddingTop: 18, paddingBottom: 18, flexWrap: "wrap" }, "d-entry");
  const answer = (t: AssistantTask, route: "approve" | "deny"): ActionRef => ({
    kind: "callEndpoint", method: "POST", path: `/v1/tasks/${t.id}/${route}`,
    ...(route === "approve" ? { body: { approvalId: t.approval!.id } } : {}),
    // An answer that came too late is gone; the list says so by redrawing.
    onError: { kind: "sequence", actions: [failToast("err.generic"), { kind: "refresh" }] },
  } as ActionRef);
  const group = (title: string, rows: Node[]): Node[] => rows.length
    ? [stack([text(title, "d-h2", { marginBottom: 8 }), ...rows], { marginBottom: 40 })]
    : [];
  return screen("desk_tasks", w("a4.h"), [page([
    text(w("a4.h"), "d-eyebrow"),
    text(w("tasks.h"), "d-h1", { marginTop: 6, marginBottom: 26 }),
    ...group(w("a4.w"), waiting.map((t) => item(
      t,
      [text(w("a4.wm", { app: names[t.approval!.connector] ?? t.approval!.connector }), "d-margin"), text(t.approval!.preview, "d-written")],
      row([link(w("a3.ok"), answer(t, "approve"), "d-btn"), link(w("a3.later"), answer(t, "deny"))], { gap: 14, align: "center" }),
    ))),
    ...group(w("a4.r"), running.map((t) => item(t, lastStep(t) ? [text(lastStep(t), "d-margin")] : []))),
    ...group(w("a4.d"), done.map((t) => item(t, lastStep(t) ? [text(t.state === "done" ? `${w("a3.done")} ${lastStep(t)}` : lastStep(t), "d-margin")] : []))),
    tasks.length ? text(w("a4.end"), "d-margin") : text(w("tasks.empty"), "d-lede", { maxWidth: "52ch" }),
  ], { maxWidth: 820 })]);
}

/**
 * READ-ALOUD VOICE — the desk's picker for the voice /v1/speak reads in.
 *
 * The same curated set the phone offers (experience/ttsVoices.ts), one row
 * each: the name, how it sounds, and — for every voice but the one in use — a
 * link that writes it to personality.ttsVoice and refreshes. The active voice
 * carries "In use" instead of a link, the way the Voices page marks the voice
 * that is writing. No preview: nothing in the window plays audio from an
 * endpoint, and the voice is heard where it is used.
 */
export function deskVoiceRead(ctx: DeskContext): ScreenResponse {
  const current = isValidTtsVoice(ctx.personality.ttsVoice) ? ctx.personality.ttsVoice : DEFAULT_TTS_VOICE;
  const rows = TTS_VOICES.map((v) => defRow(
    v.label,
    v.blurb,
    v.id === current
      ? text("In use", "d-margin")
      : link("Use", {
          kind: "callEndpoint", method: "PUT", path: "/v1/personality",
          body: { ttsVoice: v.id },
          onSuccess: { kind: "refresh" },
          onError: { kind: "toast", message: "Couldn't save that voice. Try again." },
        }),
  ));
  return screen("desk_voice_read", "Read-aloud voice", [page([
    text("Read-aloud voice", "d-eyebrow"),
    text("The voice that reads answers back to you.", "d-h1", { marginTop: 6, marginBottom: 26 }),
    stack(rows),
    row([link("Back to Settings", { kind: "navigate", screenId: "desk_settings" })], { marginTop: 28 }, "d-tools"),
  ], { maxWidth: 820 })]);
}

/**
 * ITS NAME, on the desk. Tailzu always answers; a name of their own beside it
 * is saved to personality.assistantName, which the writer and the recognizer
 * both read (experience/assistantName). One field, Save, and "Tailzu only".
 */
export function deskAssistantName(ctx: DeskContext): ScreenResponse {
  const nick = nicknameOf(ctx.personality);
  const put = (assistantName: string): ActionRef => ({
    kind: "callEndpoint", method: "PUT", path: "/v1/personality",
    body: { assistantName },
    onSuccess: { kind: "sequence", actions: [{ kind: "toast", message: "Saved." }, { kind: "refresh" }] },
    onError: { kind: "toast", message: "A name is letters, spaces, ' and -, up to 24 characters." },
  } as ActionRef);
  return screen("desk_assistant_name", "Its name", [page([
    text("Its name", "d-eyebrow"),
    text(nick ? `Tailzu, or ${nick}` : "Tailzu", "d-h1", { marginTop: 6 }),
    text("Tailzu is its name, and always works. Give it a name of your own too, and call it either while you talk: \u201cZara, make it formal.\u201d",
      "d-lede", { marginTop: 10, maxWidth: "52ch" }),
    row([
      { type: "TextField", props: { cls: "d-input", placeholder: "A name of your own", maxLength: 24 }, bind: { value: "nick" }, on: { onSubmit: put("$state.nick") } } as Node,
      link("Save", put("$state.nick"), "d-btn"),
    ], { gap: 12, align: "center", marginTop: 26, maxWidth: 520 }),
    ...(nick ? [row([link("Tailzu only", put(""))], { marginTop: 14 })] : []),
    row([link("Back to Settings", { kind: "navigate", screenId: "desk_settings" })], { marginTop: 28 }, "d-tools"),
  ], { maxWidth: 820 })], { nick: nick ?? "" });
}

export function deskPlan(ctx: DeskContext): ScreenResponse {
  // Free for everyone: nothing to choose, nothing to buy.
  if (ctx.free) {
    return screen("desk_plan", "Plan", [page([
      text("Plan", "d-eyebrow"),
      text("Tailzu is free.", "d-h1", { marginTop: 6 }),
      text("Every word, on your phone and this computer. There is no plan to pick and nothing to pay.", "d-lede", { marginTop: 8 }),
      row([link("Back to Today", { kind: "switchTab", tabId: "desk_today" })], { marginTop: 18 }),
    ], { maxWidth: 820 })]);
  }
  const q = planWords(ctx);
  const out = !q.paid && q.of > 0 && q.used >= q.of;
  const plans = (ctx.plans ?? []).filter((p) => !p.free && p.price);
  const cards = plans.map((p) => stack([
    // Every card carries the badge line, empty or not, so the prices line up.
    row([text(p.label, "d-eyebrow"), text(p.badge || "\u00a0", "d-margin")], { justify: "between", align: "center" }),
    text(p.price ?? "", "d-price", { marginTop: 8 }),
    text(p.period ?? "", "d-lede", { marginTop: 2 }),
    row([link(`Choose ${p.label}`, { kind: "iap.subscribe", productId: p.productId ?? p.id } as ActionRef)], { marginTop: 14 }),
  ], { flexBasis: 240 }, `d-plan${p.default ? " d-plan-lead" : ""}`));

  return screen("desk_plan", "Plan", [page([
    text("Plan", "d-eyebrow"),
    text(q.paid ? "Unlimited words, on every device." : out ? "This month's free words are used." : "Unlimited words, when you want them.", "d-h1", { marginTop: 6 }),
    text(q.paid
      ? "Your subscription covers your phone and this computer."
      : `${n(q.used)} of ${n(q.of)} free words used this month. They come back on the 1st.`, "d-lede", { marginTop: 8 }),
    ...(q.paid ? [] : [
      row(cards, { gap: 16, marginTop: 36, flexWrap: "wrap" }),
      text("One subscription covers your phone and your computer. Checkout opens in your browser; payments by Razorpay.", "d-lede", { marginTop: 18 }),
    ]),
  ], { maxWidth: 820 })]);
}

/** The desk's page for an id, or null for an id that is not one of them. */
/**
 * A NEWER TAILZU, SAID IN THE WINDOW.
 *
 * The tray's notification was the only notice, and a notification is gone in
 * five seconds and off entirely for anyone who silenced the app. This sits at
 * the top of every page until the new build is installed, and its one button
 * downloads the installer itself — not a page to find it on.
 */
/**
 * THE UPDATE, INSTALLED FROM HERE.
 *
 * A build that says it can ("DeskSelfUpdate") gets one button: it downloads
 * the new build, checks it against the SHA-512 recorded when it was
 * published, puts it in place of this one and restarts on it. No browser, no
 * installer to click through, still signed in. The words for each step are
 * sent with the action; the window only fills in the percentage.
 *
 * Anything else — an older build, or a publish with no checksum recorded —
 * gets the link, which is all it could do before.
 */
function updateCard(u: { version: string; url: string; sha512?: string }, selfUpdate = false): Node {
  if (selfUpdate && u.sha512) {
    const install: ActionRef = {
      kind: "installUpdate", version: u.version, url: u.url, sha512: u.sha512,
      words: {
        downloading: "Downloading. {pct}%",
        installing: "Installing. Tailzu restarts in a moment.",
        failed: "The update didn't finish. Try again.",
        manual: "This copy can't update itself. The download is opening in your browser.",
      },
    };
    return stack([
      row([
        stack([
          text("Update", "d-eyebrow"),
          text(`Tailzu ${u.version} is ready.`, "d-written", { marginTop: 4 }),
          { ...text("It installs itself and restarts. You stay signed in.", "d-lede", { marginTop: 2 }), bind: { content: "upd.line" } },
        ], { flex: 1, minWidth: 0 }),
        { ...link("Update now", install, "d-btn"), visibleIf: { falsy: "upd.busy" } },
      ], { align: "center", gap: 24, justify: "between", flexWrap: "wrap", paddingTop: 18, paddingBottom: 18 }, "d-room-inner"),
    ], { borderBottom: "1px solid var(--d-rule)" });
  }
  return stack([
    row([
      stack([
        text("Update", "d-eyebrow"),
        text(`Tailzu ${u.version} is ready.`, "d-written", { marginTop: 4 }),
        text("Download it, open it, and this window restarts on the new version.", "d-lede", { marginTop: 2 }),
      ], { flex: 1, minWidth: 0 }),
      link("Download update", { kind: "openUrl", url: u.url }, "d-btn"),
    ], { align: "center", gap: 24, justify: "between", flexWrap: "wrap", paddingTop: 18, paddingBottom: 18 }, "d-room-inner"),
  ], { borderBottom: "1px solid var(--d-rule)" });
}

function deskPage(screenId: string, ctx: DeskContext): ScreenResponse | null {
  switch (screenId) {
    case "desk_today": return deskToday(ctx);
    case "desk_history": return deskHistory(ctx);
    case "desk_notes": return deskNotes(ctx);
    case "desk_note": return deskNote(ctx);
    case "desk_insights": return deskInsights(ctx);
    case "desk_day": return deskDay(ctx);
    case "desk_app": return deskApp(ctx);
    case "desk_words": return deskWords(ctx);
    case "desk_voices": return deskVoices(ctx);
    case "desk_train": return deskTrain(ctx);
    case "desk_settings": return deskSettings(ctx);
    case "desk_voice_read": return deskVoiceRead(ctx);
    case "desk_assistant_name": return deskAssistantName(ctx);
    case "desk_plan": return deskPlan(ctx);
    case "desk_tasks": return deskTasks(ctx);
    default: return null;
  }
}

export function buildDeskScreen(screenId: string, ctx: DeskContext): ScreenResponse | null {
  const s = deskPage(screenId, ctx);
  if (s?.root && ctx.update) s.root.children = [updateCard(ctx.update, !!ctx.selfUpdate), ...(s.root.children ?? [])];
  return s;
}
