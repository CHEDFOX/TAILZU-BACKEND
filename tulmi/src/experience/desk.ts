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
import { applyPresetOverrides } from "./personalityPresets.js";
import { DESK_CONTEXTS, DESK_ROOMS, DESK_SAMPLES } from "./deskSamples.js";
import { span } from "./phoneLook.js";

/** Words a minute a person types on a keyboard — the same figure the stats
 *  screen's "minutes saved" has always used (history/store.ts). */
const TYPING_WPM = 40;

export const DESK_SCREENS = new Set(["desk_today", "desk_notes", "desk_note", "desk_insights", "desk_day", "desk_app", "desk_words", "desk_voices", "desk_train", "desk_settings", "desk_plan"]);

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
 *  (it declared "DeskNotes" and has the hotkey). */
export function deskNav(notes: boolean): NavigationShell {
  if (!notes || DESK_NAV.kind !== "tabs") return DESK_NAV;
  const [today, ...rest] = DESK_NAV.tabs;
  return { ...DESK_NAV, tabs: [today!, { id: "desk_notes", title: "Notes", screenId: "desk_notes" }, ...rest] };
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

/**
 * One note: when and where in the margin; said above written; Copy on hover.
 *
 * WRITTEN OUT PER NOTE, NOT AS A LIST TEMPLATE. A template's `$state.item` is
 * only there while the row is drawn; an action reads its values when it is
 * CLICKED, by which time the row's item is gone. So Copy put an empty string
 * on the clipboard and still said "Copied", and Delete asked to delete
 * "/v1/history/" — nothing. Each note now carries its own text in its action.
 *
 * No Delete. A note is the record of what was said; removing one belongs with
 * the history settings, not one stray click away under the pointer.
 */
function entryNode(it: EntryItem): Node {
  return row([
    stack([
      text(it.time, "d-margin-strong"),
      ...(it.app ? [text(it.app, "d-margin")] : []),
    ], { width: 96, flex: "none", paddingTop: 3 }),
    stack([
      ...(it.said ? [text(it.said, "d-said")] : []),
      text(it.written, it.deva ? "d-written d-deva" : "d-written"),
      row([
        link("Copy", { kind: "copyText", text: it.written, message: "Copied" }),
      ], { gap: 18, marginTop: 10 }, "d-tools"),
    ], { flex: 1, minWidth: 0, gap: 4 }),
  ], { gap: 24, paddingTop: 24, paddingBottom: 24 }, "d-entry");
}

function weekSquares(ctx: DeskContext): Node {
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
    text("This week", "d-eyebrow"),
    row(cells, { gap: 6, marginTop: 10 }),
    row(letters, { gap: 6, marginTop: 6 }),
  ]);
}

export function deskToday(ctx: DeskContext): ScreenResponse {
  const now = local(ctx, Date.now());
  const today = dayKey(now);
  const all = ctx.history ?? [];
  const todays = all.filter((e) => dayKey(local(ctx, Date.parse(e.createdAt))) === today);
  const earlier = todays.length ? [] : all.slice(0, 8);
  const wordsToday = ctx.usage?.today?.words ?? todays.reduce((s, e) => s + (e.wordsOut ?? 0), 0);
  const saidMin = (ctx.usage?.today?.audioSeconds ?? 0) / 60;
  const typedMin = wordsToday / TYPING_WPM;
  const back = Math.max(0, typedMin - saidMin);
  const count = todays.length
    ? `${todays.length} ${todays.length === 1 ? "dictation" : "dictations"} · ${n(wordsToday)} words`
    : "Nothing written yet today";

  const room = stack([
    row([
      stack([
        text("Today", "d-eyebrow"),
        text(dateLine(now), "d-h1", { marginTop: 6 }),
        text(count, "d-count d-on-room", { marginTop: 12 }),
      ], { minWidth: 0 }),
      row([
        keys("tap", true),
        text("tap twice, in any app, and talk", "d-count d-on-room", { maxWidth: 150, marginLeft: 6 }),
      ], { align: "center", gap: 0 }, undefined, { visibleIf: { truthy: "desktop.tap" } }),
      row([
        keys("hotkey", true),
        text("in any app, and talk", "d-count d-on-room", { maxWidth: 150, marginLeft: 6 }),
      ], { align: "center", gap: 0 }, undefined, { visibleIf: { falsy: "desktop.tap" } }),
    ], { justify: "between", align: "end", gap: 24, flexWrap: "wrap" }, "d-room-inner"),
  ], {}, "d-room");

  const notes: Node[] = todays.length
    ? entryItems(ctx, todays).map(entryNode)
    : [
        stack([
          text("Nothing yet today.", "d-written", { fontSize: 19, lineHeight: "27px" }),
          text("Tap twice in any app and say something. It shows up here, what you said above what Tailzu wrote.", "d-lede", { marginTop: 8 }),
          row([link("Talk now", { kind: "dictate" }, "d-btn")], { marginTop: 16 }),
        ], { paddingBottom: 26 }),
        ...(earlier.length ? [
          text("Earlier", "d-eyebrow", { marginTop: 10, marginBottom: 6 }),
          ...entryItems(ctx, earlier, true).map(entryNode),
        ] : []),
      ];

  const aside = stack([
    ...(wordsToday > 0 ? [stack([
      text("Today, said and typed", "d-eyebrow", { marginBottom: 12 }),
      race(saidMin, typedMin),
      ...(back >= 1 ? [inline([text(span(back), "d-em"), text(" back today.", "d-inherit")], "d-written", { fontSize: 18, lineHeight: "26px", marginTop: 16 })] : []),
      text(`Typed at ${TYPING_WPM} words a minute.`, "d-margin", { marginTop: 8 }),
    ])] : []),
    weekSquares(ctx),
    stack([
      text("Train", "d-eyebrow"),
      text(trainLine(ctx.personality), "d-written", { fontSize: 15, lineHeight: "23px", marginTop: 10, marginBottom: 14 }),
      row([link("Train Tailzu", { kind: "switchTab", tabId: "desk_train" })]),
    ]),
  ], { width: 230, flex: "none", gap: 44 }, "d-sticky");

  return screen("desk_today", "Today", [
    room,
    page([row([stack(notes, { flex: 1, minWidth: 0 }), aside], { gap: 72, align: "start" }, "d-wrap-narrow")]),
  ]);
}

function trainLine(p: Personality): string {
  const ex = p.stylePortrait?.examples ?? 0;
  if (ex <= 0) return "A few minutes of talking, and Tailzu writes more like you.";
  return `${ex} ${ex === 1 ? "round" : "rounds"} so far. A few more and it knows how you punctuate.`;
}

// ---- INSIGHTS ------------------------------------------------------------------------

export function deskInsights(ctx: DeskContext): ScreenResponse {
  const now = local(ctx, Date.now());
  const words = ctx.usage?.month.words ?? ctx.stats?.wordsOut ?? 0;
  const saidMin = (ctx.usage?.month.audioSeconds ?? 0) / 60;
  const typedMin = words / TYPING_WPM;
  const st = ctx.stats;

  const statement: Node = words > 0
    ? inline([
        text(`You said ${n(words)} words this month. Typed, they would have taken `, "d-inherit"),
        text(span(typedMin), "d-typed", { whiteSpace: "nowrap" }),
        text(". Said, ", "d-inherit"),
        text(`${span(saidMin)}.`, "d-em", { whiteSpace: "nowrap" }),
      ], "d-statement", { marginTop: 20, marginBottom: 32 })
    : text("Nothing said yet this month. Tap twice in any app, and this page starts counting.", "d-statement", { marginTop: 20, marginBottom: 32 });

  // The languages as type specimens, each set at a size that is its share.
  const langs = (st?.writtenIn ?? []).slice(0, 5);
  const total = langs.reduce((s, l) => s + l.words, 0) || 1;
  const specimens: Node[] = langs.length
    ? langs.map((l) => {
        const pct = Math.round((l.words / total) * 100);
        const size = Math.round(16 + 26 * Math.sqrt(l.words / total));
        return row([
          text(LANGUAGE_NAMES[l.key] ?? l.key, "d-spec", { fontSize: size, ...(/[^\u0000-ɏ]/.test(LANGUAGE_NAMES[l.key] ?? "") ? { fontFamily: "var(--f-deva)", fontWeight: 400 } : {}) }),
          text(`${pct}%`, "d-num"),
        ], { justify: "between", align: "end", gap: 16, paddingTop: 10, paddingBottom: 10 }, "d-rule-bottom");
      })
    : [text("Talk for a few days and this fills in, read from what Tailzu wrote.", "d-lede")];

  // The raw key is kept beside the display name: a row drills into its app's
  // page (desk_app), which looks the app up by the key the client sent, not by
  // what it reads as. The "Other" bucket is an aggregate with no page.
  const hasApp = new Set((st?.appDetail ?? []).map((a) => a.app));
  const apps = (st?.topApps ?? []).map((a) => ({ raw: a.app, app: appName(a.app) || "Other", words: a.words }));
  const appTotal = apps.reduce((s, a) => s + a.words, 0) || 1;
  const appRows: Node[] = apps.length > 1
    ? apps.map((a) => {
        const pct = Math.round((a.words / appTotal) * 100);
        const r = row([
          text(a.app, "d-lane-label", { width: 100, flex: "none" }),
          stack([stack([], { width: `${pct}%` }, "d-bar1-fill")], { flex: 1, minWidth: 0 }, "d-bar1"),
          text(`${pct}%`, "d-num", { width: 40, textAlign: "right" }),
        ], { align: "center", gap: 12, paddingTop: 9, paddingBottom: 9 });
        return hasApp.has(a.raw)
          ? { ...r, on: { onPress: { kind: "navigate", screenId: "desk_app", params: { app: a.raw } } as ActionRef } }
          : r;
      })
    : [];

  const spark = st?.sparklinePerDay ?? [];
  const days = spark.length;
  // A day with words opens its own page (desk_day), keyed by its place in the
  // run so the page can name the date and read that bucket's detail.
  const squares = spark.map((v, i) => stack([], {}, `d-sq${v > 0 ? " d-sq-on" : ""}${i === days - 1 ? " d-sq-now" : ""}`,
    v > 0 ? { on: { onPress: { kind: "navigate", screenId: "desk_day", params: { day: i } } as ActionRef } } : {}));

  return screen("desk_insights", "Insights", [page([
    text(`Insights · ${MONTHS[now.getUTCMonth()]}`, "d-eyebrow"),
    statement,
    ...(words > 0 ? [race(saidMin, typedMin, true), text(`Typed at ${TYPING_WPM} words a minute. Said is the time you spent talking.`, "d-margin", { marginTop: 10 })] : []),
    row([
      stack([
        text("How you speak", "d-h2"),
        text("Your words this month, by language, each set at its share.", "d-lede", { marginTop: 6, marginBottom: 12 }),
        ...specimens,
      ], { flex: 1, minWidth: 0 }),
      stack([
        ...(appRows.length ? [
          text("Where the words went", "d-h2"),
          ...(hasApp.size ? [text("Open an app to see its own.", "d-lede", { marginTop: 6 })] : []),
          stack(appRows, { marginTop: 10, marginBottom: 30 }),
        ] : []),
        text("Days you talked", "d-h2"),
        row(squares, { gap: 6, flexWrap: "wrap", marginTop: 14, maxWidth: 330 }),
        text(days ? `${st?.daysActive ?? 0} of the last ${days} days. The longest run was ${st?.bestStreak ?? 0}. Open a day to see it.` : "Your days show here once you have talked.",
          "d-lede", { marginTop: 10 }),
      ], { flex: 1, minWidth: 0 }),
    ], { gap: 72, marginTop: 64, paddingTop: 40, align: "start" }, "d-rule-top d-wrap-narrow"),
  ])]);
}

// ---- INSIGHTS: a day, and an app ------------------------------------------------------

/** A small back cue over a detail page — the window's own chevron pops the
 *  stack, this says where back goes and reads the same on every page. */
const backToInsights = () =>
  row([link("← Insights", { kind: "switchTab", tabId: "desk_insights" })], { marginBottom: 20 });

/**
 * When in the day the words happened — one slim column an hour, tallest at the
 * busiest hour, nothing where nothing was said. Drawn from the renderer's plain
 * nodes (no canvas on the desk): a bottom-aligned fill in a fixed-height track,
 * its height the hour's share of the busiest. Noon and the two sixes are named
 * underneath so the shape has a clock to read against.
 */
function hourChart(hours: number[]): Node {
  const h = hours.length === 24 ? hours : new Array(24).fill(0);
  const max = Math.max(1, ...h);
  const H = 72;
  const cols = h.map((w) => {
    const ph = w > 0 ? Math.max(3, Math.round((w / max) * H)) : 0;
    return stack(ph ? [stack([], { background: "var(--d-ink)", width: "100%", height: ph, radius: 2 })] : [],
      { flex: 1, minWidth: 0, height: H, justify: "end" });
  });
  return stack([
    row(cols, { gap: 3, align: "end", height: H }),
    row(["12a", "6a", "12p", "6p", "12a"].map((l) => text(l, "d-margin")), { justify: "between", marginTop: 8 }),
  ], { maxWidth: 520 });
}

/** A ranked set of horizontal bars — the same lane the apps use on Insights,
 *  reused for a day's apps, a split by how it was written, its languages, an
 *  app's time of day. A row carries its own tap when one is handed in. */
function barList(rows: Array<{ label: string; words: number; press?: ActionRef }>): Node {
  const total = rows.reduce((s, r) => s + r.words, 0) || 1;
  return stack(rows.map((r) => {
    const pct = Math.round((r.words / total) * 100);
    const line = row([
      text(r.label, "d-lane-label", { width: 100, flex: "none" }),
      stack([stack([], { width: `${Math.max(2, pct)}%` }, "d-bar1-fill")], { flex: 1, minWidth: 0 }, "d-bar1"),
      text(`${pct}%`, "d-num", { width: 40, textAlign: "right" }),
    ], { align: "center", gap: 12, paddingTop: 9, paddingBottom: 9 });
    return r.press ? { ...line, on: { onPress: r.press } } : line;
  }), { marginTop: 10 });
}

/** The voice / typed / draft split as bar rows, only the ones that happened. */
function kindRows(k: { voice: number; typing: number; draft: number }): Array<{ label: string; words: number }> {
  return [
    { label: "Spoken", words: k.voice },
    { label: "Typed", words: k.typing },
    { label: "Draft", words: k.draft },
  ].filter((x) => x.words > 0);
}

/** A detail section: a small heading over its bars, with the air above it the
 *  earlier sections have earned. */
function detailBlock(title: string, rows: Array<{ label: string; words: number; press?: ActionRef }>, first: boolean): Node {
  return stack([text(title, "d-h2"), barList(rows)], { marginTop: first ? 0 : 40 });
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
  const count = [
    `${d.sessions} ${d.sessions === 1 ? "dictation" : "dictations"}`,
    `${n(d.words)} words`,
    ...(times ? [times] : []),
  ].join(" · ");

  const head = stack([
    backToInsights(),
    text("Insights", "d-eyebrow"),
    text(dateLine(date), "d-h1", { marginTop: 6 }),
    text(count, "d-count", { marginTop: 12 }),
  ], { marginBottom: 40 });

  const left = stack([
    ...(d.words > 0 ? [stack([
      text("Said and typed", "d-eyebrow", { marginBottom: 12 }),
      race(saidMin, typedMin, true),
      ...(saved >= 1 ? [inline([text(span(saved), "d-em"), text(" back on the day.", "d-inherit")], "d-written", { fontSize: 18, lineHeight: "26px", marginTop: 16 })] : []),
      text(`Typed at ${TYPING_WPM} words a minute.`, "d-margin", { marginTop: 8 }),
    ])] : []),
    stack([
      text("When", "d-eyebrow", { marginBottom: 14 }),
      hourChart(d.hours),
    ], { marginTop: d.words > 0 ? 44 : 0 }),
  ], { flex: 1, minWidth: 0 });

  const apps = (d.apps ?? []).map((a) => ({ label: appName(a.app) || "Other", words: a.words }));
  const kinds = kindRows(d.kinds);
  const langs = (d.languages ?? []).slice(0, 6).map((l) => ({ label: LANGUAGE_NAMES[l.key] ?? l.key, words: l.words }));
  const sections: Node[] = [];
  if (apps.length) sections.push(detailBlock("Where the words went", apps, sections.length === 0));
  if (kinds.length > 1) sections.push(detailBlock("How", kinds, sections.length === 0));
  if (langs.length) sections.push(detailBlock("In", langs, sections.length === 0));
  const right = stack(sections, { flex: 1, minWidth: 0 });

  return screen("desk_day", dateLine(date), [page([
    head,
    row([left, right], { gap: 72, align: "start" }, "d-wrap-narrow"),
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
  const lastAt = Date.parse(a.lastAt);
  const lastLine = Number.isFinite(lastAt) ? `Last used ${dateLine(local(ctx, lastAt))}` : "";
  const count = [
    `${n(a.words)} words`,
    `${a.sessions} ${a.sessions === 1 ? "dictation" : "dictations"}`,
    ...(a.avgWords > 0 ? [`~${n(a.avgWords)} words each`] : []),
  ].join(" · ");

  const head = stack([
    backToInsights(),
    text("Where the words went", "d-eyebrow"),
    text(disp, "d-h1", { marginTop: 6 }),
    text(count, "d-count", { marginTop: 12 }),
    ...(lastLine ? [text(lastLine, "d-margin", { marginTop: 6 })] : []),
  ], { marginBottom: 40 });

  const dayparts = [
    { label: "Morning", words: a.dayparts.morning },
    { label: "Afternoon", words: a.dayparts.afternoon },
    { label: "Evening", words: a.dayparts.evening },
    { label: "Night", words: a.dayparts.night },
  ].filter((x) => x.words > 0);
  const kinds = kindRows(a.kinds);
  const voices = (a.voices ?? []).map((v) => ({ label: v.id || "Zu", words: v.words }));
  const sections: Node[] = [];
  if (dayparts.length) sections.push(detailBlock("When", dayparts, sections.length === 0));
  if (kinds.length > 1) sections.push(detailBlock("How", kinds, sections.length === 0));
  if (voices.length > 1) sections.push(detailBlock("In which voice", voices, sections.length === 0));

  return screen("desk_app", disp, [page([
    head,
    ...(sections.length ? [row([stack(sections, { flex: 1, minWidth: 0, maxWidth: 520 })], { align: "start" })] : [
      text("Talk into this app for a few days and its shape fills in here.", "d-lede"),
    ]),
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

export function deskVoices(ctx: DeskContext): ScreenResponse {
  const p = ctx.personality;
  const active = p.activePresetId || "signature";
  const voices = applyPresetOverrides(p.presetOverrides);
  const ordered = [...voices.filter((v) => v.id === active), ...voices.filter((v) => v.id !== active)];

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

  const rooms = ordered.map((v) => {
    const on = v.id === active;
    const samples = DESK_SAMPLES[v.id];
    return stack([
      text(v.name, "d-world-name"),
      ...(samples
        ? DESK_CONTEXTS.map((c) => ({ ...text(samples[c.id], "d-world-text"), visibleIf: { eq: ["state.ctx", c.id] } } as Node))
        : [text(v.tagline, "d-world-text")]),
      text(on ? "In use, everywhere" : v.tagline, "d-world-use", { marginTop: "auto" }),
    ], { gap: 14, flexBasis: "calc(33.333% - 10px)", minWidth: 220 },
      `d-world ${DESK_ROOMS[v.id] ?? "d-w-zu"}${on ? " d-world-on" : ""}`,
      on ? {} : { on: { onPress: {
        kind: "callEndpoint", method: "PUT", path: "/v1/personality",
        body: { activePresetId: v.id, ...(v.defaultTone ? { activeTone: v.defaultTone } : {}) },
        onError: { kind: "toast", message: "Couldn't switch voices" },
      } } });
  });

  return screen("desk_voices", "Voices", [page([
    text("Voices", "d-eyebrow"),
    text("Same words. The voice you choose.", "d-h1", { marginTop: 6 }),
    text("The voice you pick writes everything you say, on your phone and here. See each one in the kind of writing you do.", "d-lede", { marginTop: 8 }),
    stack([seg], { marginTop: 22, marginBottom: 18 }),
    ...saidLines,
    row(rooms, { gap: 14, flexWrap: "wrap", marginTop: 18 }),
  ])], { ctx: "chats" });
}

// ---- TRAIN --------------------------------------------------------------------------------

export function deskTrain(ctx: DeskContext): ScreenResponse {
  const portrait = ctx.personality.stylePortrait;
  const rounds = portrait?.examples ?? 0;
  const terms = (portrait?.words ?? []).map((w) => w.term).filter(Boolean).slice(0, 12);
  const styles = (portrait?.styles ?? []).map((s) => s.name).filter(Boolean).slice(0, 6);
  const item = (done: boolean, k: string, v: string): Node => row([
    stack([], { marginTop: 4 }, `d-sq${done ? " d-sq-on" : ""}`),
    stack([text(k, "d-written"), text(v, "d-lede", { marginTop: 2 })], { flex: 1, minWidth: 0 }),
  ], { gap: 14, paddingTop: 16, paddingBottom: 16, align: "start" }, "d-entry");

  const start = (onRoom: boolean) => link(
    rounds ? "Continue training" : "Start training",
    { kind: "navigate", screenId: "training_live" }, "d-btn",
    onRoom ? { backgroundColor: "var(--d-pale)", color: "var(--d-violet)" } : undefined,
  );
  const head = (onRoom: boolean): Node[] => [
    text("Train", "d-eyebrow"),
    text("A few minutes of talking, and it writes like you.", "d-h1", { marginTop: 6, maxWidth: "22ch" }),
    text("Tailzu asks a few questions and listens to how you answer. What it learns stays with your account, on every device.",
      "d-lede", { marginTop: 10, maxWidth: "46ch", ...(onRoom ? { color: "rgba(243,226,198,.72)" } : {}) }),
    row([start(onRoom)], { marginTop: 26 }),
  ];
  // THE NETWORK, where the window can show it: the same field the phone's
  // training card carries, at this person's growth, behind the page's head.
  // A plain ground rather than the room's gradient — the renderer hands the
  // colour to the field, and a gradient would sit over it.
  const room: Node[] = ctx.field
    ? [stack([
        ctx.field,
        stack(head(true), { position: "relative" }, "d-room-inner"),
      ], { position: "relative", overflow: "hidden", backgroundColor: "var(--d-violet)", backgroundImage: "none", minHeight: 300, justify: "end" }, "d-room")]
    : [];

  return screen("desk_train", "Train", [...room, page([
    ...(ctx.field ? [] : head(false)),
    stack([
      item(rounds > 0, rounds ? `${rounds} ${rounds === 1 ? "round" : "rounds"} of training` : "Your first round", rounds ? "Each one teaches it a little more of how you write." : "Two or three minutes, whenever you like."),
      item(terms.length > 0, "Your words", terms.length ? terms.join(", ") : "Names and words it hears you use, spelled your way."),
      item(styles.length > 0, "How you write", styles.length ? styles.join(" · ") : "Short or long, formal or not, and when."),
    ], { marginTop: ctx.field ? 0 : 26, maxWidth: 640 }),
  ], ctx.field ? { paddingTop: 28 } : {})]);
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

/** "You, Priya, Speaker 3" — names where the writer found them. */
function peopleLine(people: NoteSummary["people"], transcript?: Note["transcript"]): string {
  const named = new Map((people ?? []).map((p) => [p.label, p.name]));
  const labels = transcript?.length
    ? [...new Set(transcript.map((s) => s.speaker ?? "").filter(Boolean))]
    : (people ?? []).map((p) => p.label);
  return labels.map((l) => named.get(l) || l).join(", ");
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

export function deskNotes(ctx: DeskContext): ScreenResponse {
  const all = ctx.notes ?? [];
  const minutes = all.reduce((s, x) => s + (x.durationSeconds || 0), 0) / 60;
  const count = all.length
    ? `${all.length} ${all.length === 1 ? "note" : "notes"} · ${span(minutes)} heard`
    : "Nothing yet";

  const room = stack([
    row([
      stack([
        text("Notes", "d-eyebrow"),
        text("Meetings, lectures, thoughts", "d-h1", { marginTop: 6 }),
        text(count, "d-count d-on-room", { marginTop: 12 }),
      ], { minWidth: 0 }),
      ...(ctx.notesHotkey ? [row([
        keys("notes", true),
        text("to start or stop. Nothing is typed anywhere.", "d-count d-on-room", { maxWidth: 170, marginLeft: 6 }),
      ], { align: "center", gap: 0 })] : []),
    ], { justify: "between", align: "end", gap: 24, flexWrap: "wrap" }, "d-room-inner"),
  ], {}, "d-room");

  const body: Node[] = [];
  if (!all.length) {
    body.push(stack([
      text("No notes yet.", "d-written", { fontSize: 19, lineHeight: "27px" }),
      text("Start it in a meeting, a lecture, or on a walk around your own ideas. Tailzu listens to your microphone and to your computer's sound, tells the voices apart, and keeps it short here: what the meeting was, a paragraph on the whole conversation, and the few things people said that mattered, with who said them.", "d-lede", { marginTop: 8, maxWidth: 560 }),
      ...(ctx.notesHotkey ? [row([link("Start taking notes", startNotes, "d-btn")], { marginTop: 16 })] : []),
    ], { paddingBottom: 26 }));
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

  return screen("desk_notes", "Notes", [room, page([stack(body, { maxWidth: 760 })])]);
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
  ], { paddingTop: 18, paddingBottom: 20, marginBottom: 34, borderTop: "1px solid var(--d-rule)", borderBottom: "1px solid var(--d-rule)", maxWidth: 760 });
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

/**
 * One note: the meeting, one paragraph on the whole conversation, and the
 * few things people said that matter — each with who said it, in their own
 * voice, worded the best way. Nothing else: no transcript, no lists.
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
  const who = peopleLine(nt.people, nt.transcript);
  const meta = [dateLine(d), clock(d), nt.durationSeconds ? span(nt.durationSeconds / 60) : ""].filter(Boolean).join(" · ");
  const busy = nt.status === "organising";
  const canOrganise = nt.status === "failed" || nt.status === "recording" || (nt.status === "ready" && !nt.organised && nt.transcript.length > 0);

  const head = stack([
    row([link("All notes", { kind: "switchTab", tabId: "desk_notes" })], { marginBottom: 18 }),
    text("Meeting", "d-eyebrow"),
    text(noteTitle(ctx, nt), "d-h1", { marginTop: 6 }),
    text(meta, "d-count", { marginTop: 10 }),
    ...(who ? [text(`With ${who}`, "d-margin", { marginTop: 4 })] : []),
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
    ], { gap: 22, marginTop: 18, align: "center", flexWrap: "wrap" }),
  ], { marginBottom: 34 });

  const body: Node[] = [];
  // THE COMPUTER'S SOUND WAS OFF. The note is still made, from the
  // microphone; this says so, and how to have everyone in the next one.
  if (nt.systemAudio === "denied") body.push(onlyYourSide(!!ctx.allowSystemAudio));
  if (nt.summary) body.push(text(nt.summary, "d-written", { fontSize: 18, lineHeight: "28px", maxWidth: 680 }));
  if (nt.highlights.length) {
    body.push(stack([
      text("What mattered", "d-eyebrow", { marginBottom: 6 }),
      ...nt.highlights.map((h) => row([
        text(named.get(h.speaker) || h.speaker, "d-margin-strong", { width: 120, flex: "none", paddingTop: 4 }),
        text(h.text, /[ऀ-ॿ]/.test(h.text) ? "d-said d-deva" : "d-said", { flex: 1, minWidth: 0 }),
      ], { gap: 20, paddingTop: 16, paddingBottom: 16 }, "d-entry")),
    ], { marginTop: nt.summary ? 40 : 0, maxWidth: 760 }));
  }

  return screen("desk_note", noteTitle(ctx, nt), [page([head, stack(body, { maxWidth: 760 })])], { noteDel: false });
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

export function deskSettings(ctx: DeskContext): ScreenResponse {
  const q = planWords(ctx);
  const langs = (ctx.personality.languages ?? []).filter((l) => l && l !== "auto");
  const who = ctx.email || ctx.phone || "";
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
    stack([
      text("Languages", "d-h2", { marginBottom: 8 }),
      defRow("You speak", langs.length ? langs.map((l) => (Object.hasOwn(LANGUAGE_NAMES, l) ? LANGUAGE_NAMES[l] : l)).join(", ") : "Found on its own, as you talk",
        link("Change", { kind: "navigate", screenId: "languages" })),
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
    case "desk_notes": return deskNotes(ctx);
    case "desk_note": return deskNote(ctx);
    case "desk_insights": return deskInsights(ctx);
    case "desk_day": return deskDay(ctx);
    case "desk_app": return deskApp(ctx);
    case "desk_words": return deskWords(ctx);
    case "desk_voices": return deskVoices(ctx);
    case "desk_train": return deskTrain(ctx);
    case "desk_settings": return deskSettings(ctx);
    case "desk_plan": return deskPlan(ctx);
    default: return null;
  }
}

export function buildDeskScreen(screenId: string, ctx: DeskContext): ScreenResponse | null {
  const s = deskPage(screenId, ctx);
  if (s?.root && ctx.update) s.root.children = [updateCard(ctx.update, !!ctx.selfUpdate), ...(s.root.children ?? [])];
  return s;
}
