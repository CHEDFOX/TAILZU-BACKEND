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
import type { HistoryEntry, PaywallPlan, Personality, UsageSummary } from "../../../shared/types/api.js";
import type { StatsForUser } from "../history/store.js";
import type { Allowance } from "../usage/allowance.js";
import { LANGUAGE_NAMES } from "../history/writtenIn.js";
import { applyPresetOverrides } from "./personalityPresets.js";
import { DESK_CONTEXTS, DESK_ROOMS, DESK_SAMPLES } from "./deskSamples.js";

/** Words a minute a person types on a keyboard — the same figure the stats
 *  screen's "minutes saved" has always used (history/store.ts). */
const TYPING_WPM = 40;

export const DESK_SCREENS = new Set(["desk_today", "desk_insights", "desk_words", "desk_voices", "desk_train", "desk_settings", "desk_plan"]);

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

/** What a desk page is built from. A subset of the catalog's ScreenContext,
 *  named here so this module does not import the catalog it is imported by. */
export interface DeskContext {
  personality: Personality;
  history?: HistoryEntry[];
  usage?: UsageSummary;
  stats?: StatsForUser;
  allowance?: Allowance | null;
  entitlement?: { store?: string; expiresAt?: string } | null;
  email?: string;
  phone?: string;
  name?: string;
  tzOffsetMinutes?: number;
  /** The paywall's plans, passed in for the same reason. */
  plans?: PaywallPlan[];
  /** The billing flags the bootstrap would send (manage URL etc.). */
  manageUrl?: string;
  /** This person's network, at the growth they have earned — built by the
   *  catalog, and only for a window that can show it on a page (DeskField). */
  field?: Node;
  /** A newer build published for this window's OS (desktopRelease.ts). */
  update?: { version: string; url: string } | null;
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
const bound = (path: string, cls: string, style?: Style, visibleIf?: Node["visibleIf"]): Node => {
  const st = styled(cls, style);
  return { type: "Text", props: { content: "", cls }, bind: { content: path }, ...(st ? { style: st } : {}), ...(visibleIf ? { visibleIf } : {}) };
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
const keys = (source: "tap" | "hotkey", small = false): Node => ({ type: "Keys", props: { source, cls: small ? "d-keys-small" : "" }, ...(small ? { style: {} } : {}) });
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
/** "40 sec", "9 min", "1 h 43" — the way a person says a length of time. */
function span(minutes: number): string {
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} sec`;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60), m = Math.round(minutes - h * 60);
  return m ? `${h} h ${m}` : `${h} h`;
}
const APP_NAMES: Record<string, string> = { Desktop: "Computer", Generic: "" };
const appName = (a?: string) => (a && a in APP_NAMES ? APP_NAMES[a]! : a || "");

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

/** One note: when and where in the margin; said above written; its tools on hover. */
function entryTemplate(): Node {
  return row([
    stack([bound("item.time", "d-margin-strong"), bound("item.app", "d-margin")], { width: 96, flex: "none", paddingTop: 3 }),
    stack([
      bound("item.said", "d-said", undefined, { truthy: "item.said" }),
      bound("item.written", "d-written", undefined, { falsy: "item.deva" }),
      bound("item.written", "d-written d-deva", undefined, { truthy: "item.deva" }),
      row([
        link("Copy", { kind: "copyText", text: "$state.item.written", message: "Copied" }),
        link("Delete", {
          kind: "callEndpoint", method: "DELETE", path: "/v1/history/$state.item.id",
          onError: { kind: "toast", message: "Couldn't delete that note" },
        }),
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
    ? `${todays.length} ${todays.length === 1 ? "note" : "notes"} · ${n(wordsToday)} words`
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
    ? [{ type: "List", props: { items: entryItems(ctx, todays), itemTemplate: entryTemplate() } }]
    : [
        stack([
          text("Nothing yet today.", "d-written", { fontSize: 19, lineHeight: "27px" }),
          text("Tap twice in any app and say something. It shows up here, what you said above what Tailzu wrote.", "d-lede", { marginTop: 8 }),
          row([link("Talk now", { kind: "dictate" }, "d-btn")], { marginTop: 16 }),
        ], { paddingBottom: 26 }),
        ...(earlier.length ? [
          text("Earlier", "d-eyebrow", { marginTop: 10, marginBottom: 6 }),
          { type: "List", props: { items: entryItems(ctx, earlier, true), itemTemplate: entryTemplate() } } as Node,
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

  const apps = (st?.topApps ?? []).map((a) => ({ ...a, app: appName(a.app) || "Other" }));
  const appTotal = apps.reduce((s, a) => s + a.words, 0) || 1;
  const appRows: Node[] = apps.length > 1
    ? apps.map((a) => row([
        text(a.app, "d-lane-label", { width: 100, flex: "none" }),
        stack([stack([], { width: `${Math.round((a.words / appTotal) * 100)}%` }, "d-bar1-fill")], { flex: 1, minWidth: 0 }, "d-bar1"),
        text(`${Math.round((a.words / appTotal) * 100)}%`, "d-num", { width: 40, textAlign: "right" }),
      ], { align: "center", gap: 12, paddingTop: 9, paddingBottom: 9 }))
    : [];

  const spark = st?.sparklinePerDay ?? [];
  const days = spark.length;
  const squares = spark.map((v, i) => stack([], {}, `d-sq${v > 0 ? " d-sq-on" : ""}${i === days - 1 ? " d-sq-now" : ""}`));

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
        ...(appRows.length ? [text("Where the words went", "d-h2"), stack(appRows, { marginTop: 10, marginBottom: 30 })] : []),
        text("Days you talked", "d-h2"),
        row(squares, { gap: 6, flexWrap: "wrap", marginTop: 14, maxWidth: 330 }),
        text(days ? `${st?.daysActive ?? 0} of the last ${days} days. The longest run was ${st?.bestStreak ?? 0}.` : "Your days show here once you have talked.",
          "d-lede", { marginTop: 10 }),
      ], { flex: 1, minWidth: 0 }),
    ], { gap: 72, marginTop: 64, paddingTop: 40, align: "start" }, "d-rule-top d-wrap-narrow"),
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

  const wordTemplate = row([
    stack([
      bound("item.was", "d-was", undefined, { truthy: "item.was" }),
      bound("item.word", "d-inherit"),
    ], { alignSelf: "flex-start" }, "d-fix"),
    row([link("Remove", {
      kind: "callEndpoint", method: "POST", path: "/v1/words", body: { remove: "$state.item.word", kind: "$state.item.kind" },
      onError: { kind: "toast", message: "Couldn't remove that word" },
    })], {}, "d-tools"),
  ], { justify: "between", align: "center", gap: 14, paddingTop: 14, paddingBottom: 14 }, "d-entry");

  const snipTemplate = stack([
    row([text("say", "d-margin", { marginRight: 6 }), bound("item.say", "d-say")], { align: "baseline" }),
    bound("item.get", "d-get"),
    row([link("Remove", {
      kind: "callEndpoint", method: "POST", path: "/v1/snippets", body: { remove: "$state.item.say" },
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
          ? [{ type: "List", props: { items: words, itemTemplate: wordTemplate } } as Node]
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
          ? [{ type: "List", props: { items: snips, itemTemplate: snipTemplate } } as Node]
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
      defRow("You speak", langs.length ? langs.map((l) => LANGUAGE_NAMES[l] ?? l).join(", ") : "Found on its own, as you talk",
        link("Change", { kind: "navigate", screenId: "languages" })),
    ], { marginBottom: 40 }),
    stack([
      text("Plan", "d-h2", { marginBottom: 8 }),
      defRow(q.paid ? "Unlimited" : "Free", q.paid ? "Every word, on every device" : `${n(q.used)} of ${n(q.of)} words this month`,
        q.paid
          ? (ctx.manageUrl ? link("Manage", { kind: "openUrl", url: ctx.manageUrl }) : undefined)
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
      text("One subscription covers your phone and your computer. Checkout opens in your browser; payments by Paddle.", "d-lede", { marginTop: 18 }),
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
function updateCard(u: { version: string; url: string }): Node {
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
    case "desk_insights": return deskInsights(ctx);
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
  if (s?.root && ctx.update) s.root.children = [updateCard(ctx.update), ...(s.root.children ?? [])];
  return s;
}
