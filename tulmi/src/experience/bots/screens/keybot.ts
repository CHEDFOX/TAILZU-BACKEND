/**
 * KEYBOT: the keyboard bot's pages, for the phone and the window (one id each, ctx.client picks the layout).
 *
 *   bots.keybot            Keybot / DKeybot         the week's words, minutes saved, by app, what the key does, the keys
 *   bots.keybot.tone       KeyTone / DKeyTone       a tone for each kind of app (Chats, Mail, Work chat)
 *   bots.keybot.words      KeyWords / DKeyWords     the words it spells your way: added, learned, how often said
 *   bots.keybot.voices     KeyVoices / DKeyVoices   the read-aloud voice, speed, when it reads
 *   bots.keybot.train      KeyTrain / DKeyTrain     ten everyday lines said your way, and what it learned
 *   bots.keybot.history    KeyHistory / DKeyHistory what you said: copy it, forget it, clear it
 *   bots.keybot.settings   KeySettings / DKeySettings  the phone keyboard (look, feel, typing, the key); in the window,
 *                          this computer's keys, the pill and listening (desktop.config), and the languages
 *
 * Each page reads one view from routes/botsKeybot.ts (GET /v1/keybot[/page], shaped in src/keybot/views.ts) and
 * writes through it or the routes that were already there (PUT /v1/personality, POST /v1/words, DELETE /v1/history).
 * A failed read draws the page's honest "couldn't load" state, never a made-up number.
 *
 * Not here: bots.keybot.on (first run, screens/firstRun.ts). bots.keybot.pill / .reply / .rewrite are the desktop's
 * own windows (TAILZU-DESKTOP pill.html and guide.html, behind the same switch), and the phone keyboard's KeyLive,
 * KeyReply and KeyRewrite are the keyboard extension itself: neither is a server-drawn screen.
 */
import type { ActionRef, ActionSpec, Condition, Node } from "../../../../../shared/types/sdui.js";
import type { HistoryEntry } from "../../../../../shared/types/api.js";
import type {
  KeybotHistoryView, KeybotHomeView, KeybotSettingsView, KeybotToneView, KeybotTrainView, KeybotVoicesView, KeybotWordsView,
} from "../../../keybot/views.js";
import { TONE_GROUP_DEFS, TONE_PRESETS, TONE_SAID, groupOfApp } from "../../../keybot/tones.js";
import {
  back, blip, botAvatar, botLook, box, button, C, call, card, chip, col, divider, emptyState, grow, icon, listCard, listRow,
  meta, open, page, primaryButton, quietButton, row, SCREENS, sectionLabel, segmented, seq, shapes, statusMark,
  switchMark, switchRow, text, title, when, whenEq, type BotsCtx,
} from "../kit.js";
import { screen, type BotsScreen } from "../registry.js";

const KEYBOT = botLook("keybot");
const CLAY = KEYBOT.color;
const DESK_WIDTH = 1000;
const n = (v: number) => Math.round(v).toLocaleString("en-IN");
const plural = (v: number, one: string, many: string) => `${n(v)} ${v === 1 ? one : many}`;

// ===================================================================== small parts

/** Line glyphs the kit does not carry: an app's kind, copy, forget. */
const GLYPHS = {
  chats: "M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-4.5 3.5v-3.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z",
  mail: "M4.5 6h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5v-9A1.5 1.5 0 0 1 4.5 6zM3.5 7l8.5 6 8.5-6",
  work: "M4 8.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM9 8.5V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2.5M3 13.5h18",
  app: "M6 4.5h12a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5zM8.5 9h7M8.5 12.5h7M8.5 16h4",
  copy: "M9 8.5h9.5a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1zM5 15.5V5a1 1 0 0 1 1-1h9",
  forget: "M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10.5 11v5.5M13.5 11v5.5",
} as const;
type Glyph = keyof typeof GLYPHS;

function glyph(name: Glyph, o: { size?: number; color?: string; label?: string } = {}): Node {
  return shapes([{ d: GLYPHS[name], stroke: o.color ?? C.ink, strokeWidth: 1.9, linecap: "round", linejoin: "round" }], { size: o.size ?? 18, ...(o.label ? { label: o.label } : {}) });
}

/** An app's little square: its kind's glyph on the surface grey (white when it is the one picked). */
function appSquare(kind: Glyph, size = 32, light?: unknown): Node {
  return box([glyph(kind, { size: Math.round(size * 0.55) })], {
    width: size, height: size, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0,
    backgroundColor: light ?? C.surface,
  });
}

/** A key on a keyboard drawing ("Fn", "Esc"); `bind` shows a state value (the window's own keys) in its place. */
function kbd(label: string, bind?: string): Node {
  return row([text(label, { size: 12, weight: 500, lineHeight: 16, ...(bind ? { bind } : {}) })], {
    height: 26, paddingHorizontal: 7, borderRadius: 7, borderWidth: 1, borderColor: C.outline, backgroundColor: C.paper, flexShrink: 0,
  });
}

/** The phone page's head: back, the title, Keybot's face. */
function phoneHead(heading: string): Node {
  return row([
    box([icon("back", { size: 24, label: "Back to Keybot" })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()),
    text(heading, { size: 24, weight: 700, tracking: -0.5, lineHeight: 30, lines: 1, style: { flexShrink: 1 } }),
    grow(),
    botAvatar(KEYBOT, 30),
  ], { gap: 8, minHeight: 44 });
}

/** The window page's head: "‹ Keybot" back, the title and its line, what the page does on the right. */
function deskHead(heading: string, sub: string, right: Node[] = []): Node {
  return col([
    row([icon("back", { size: 14, color: C.grey70 }), botAvatar(KEYBOT, 20), text("Keybot", { size: 13, color: C.grey70, lineHeight: 18 })],
      { gap: 6, paddingVertical: 2, paddingRight: 8, alignSelf: "flex-start", borderRadius: 8 }, back()),
    row([
      col([title(heading, { size: 26 }), text(sub, { size: 14, color: C.grey70, lineHeight: 19 })], { gap: 4, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      ...(right.length ? [row(right, { gap: 10 })] : []),
    ], { gap: 16, alignItems: "flex-end", flexWrap: "wrap" }),
  ], { gap: 6 });
}

/** A text field in the kit's look (the ask bar's): a pill with a line. */
function field(path: string, placeholder: string, o: { onSubmit?: ActionRef; lead?: Node; height?: number; returnKey?: string; label?: string } = {}): Node {
  const h = o.height ?? 44;
  return row([
    ...(o.lead ? [o.lead] : []),
    {
      type: "TextField", id: path.replace(/\W/g, "_"), bind: { value: path },
      props: {
        placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0,
        minHeight: h - 2, returnKeyType: o.returnKey ?? "done", color: C.ink, ...(o.label ? { accessibilityLabel: o.label } : {}),
      },
      ...(o.onSubmit ? { on: { onSubmit: o.onSubmit } } : {}),
      style: {
        flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: h - 2, paddingHorizontal: 0, paddingVertical: 0,
        fontFamily: "Tailzu Geist", fontSize: 15, color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
      },
    },
  ], { gap: 10, height: h, borderRadius: h / 2, borderWidth: 1, borderColor: C.line, paddingHorizontal: 16, backgroundColor: C.paper });
}

/** A search field: Enter opens the page again for what was typed. */
function searchField(screenId: string, placeholder: string): Node {
  return field("q", placeholder, {
    lead: icon("search", { size: 18, color: C.meta }), returnKey: "search", label: placeholder,
    onSubmit: { kind: "navigate", screenId, params: { q: "$state.q" }, replace: true },
  });
}

/** "Results for “x”", and the way back to all of it. */
function searchLine(screenId: string, q: string): Node {
  return row([meta(`Results for “${q}”`, { size: 13, style: { flexShrink: 1 } }), grow(),
    quietButton("Show all", { kind: "navigate", screenId, replace: true }, { size: "md" })], { gap: 8 });
}

/** A row with a switch that follows a state path and saves through `onChange`. The window's settings cards use it. */
function toggleRow(label: string, path: string, onChange: ActionRef, sub?: string): Node {
  return row([
    col([text(label, { size: 14, lineHeight: 19 }), ...(sub ? [meta(sub, { size: 12 })] : [])], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    switchMark(path),
  ], { gap: 12, paddingVertical: 10, minHeight: 44 }, seq({ kind: "toggleState", path }, onChange));
}

/** A settings card in the window: a label and its rows. */
function deskCard(label: string, children: Node[], o: { gap?: number; padding?: number } = {}): Node {
  return card([sectionLabel(label), ...children], { gap: o.gap ?? 8, padding: o.padding ?? 16, radius: 18 });
}

/** Two columns side by side in the window: `left` fixed or weighted, `right` takes the rest. */
function twoCols(left: Node[], right: Node[], o: { left?: number; leftWeight?: number; rightWeight?: number; gap?: number } = {}): Node {
  return row([
    col(left, { gap: 16, ...(o.left ? { width: o.left, flexShrink: 0 } : { flexGrow: o.leftWeight ?? 1, flexBasis: 0, minWidth: 0 }) }),
    col(right, { gap: 16, flexGrow: o.rightWeight ?? 1, flexBasis: 0, minWidth: 0 }),
  ], { gap: o.gap ?? 20, alignItems: "flex-start" });
}

/** The page could not be read: say so, and offer to try again. */
function couldntLoad(what: string): Node {
  return card([
    row([statusMark("failed", { size: 10 }), text(`Couldn't load ${what}.`, { size: 15, weight: 500 })], { gap: 10 }),
    meta("Check your connection, then try again.", { size: 13 }),
    button("Try again", { kind: "refresh" }, { kind: "secondary", size: "md" }),
  ], { gap: 10 });
}

const toast = (message: string): ActionSpec => ({ kind: "toast", message });
const oops = (what = "Couldn't save that. Try again."): ActionSpec => ({ kind: "toast", message: what, tone: "error" });
/** A write: the call, a refresh (the window refetches by itself after a write too), and a quiet word. */
const write = (method: "POST" | "PUT" | "DELETE", path: string, body: Record<string, unknown> | undefined, done?: string, fail?: string): ActionSpec =>
  call(method, path, body, { ok: seq(...(done ? [toast(done)] : []), { kind: "refresh" }), fail: oops(fail) });
/** A save that changes nothing on the page but the control itself (which already follows its state). */
const save = (method: "POST" | "PUT", path: string, body: Record<string, unknown>, fail?: string): ActionSpec =>
  call(method, path, body, { fail: oops(fail) });

// ===================================================================== bots.keybot

const MODES = [
  { name: "Speak", blurb: "Hold and talk, clean text comes out" },
  { name: "Rewrite", blurb: "Select text, say how to change it" },
  { name: "Translate", blurb: "Hindi, Hinglish, English" },
  { name: "Reply", blurb: "Drafts an answer in your tone" },
];

function modeCard(m: (typeof MODES)[number], i: number, hint?: Node): Node {
  return card([
    text(m.name, { size: 15, weight: 600, lineHeight: 20 }),
    meta(m.blurb, { size: 12 }),
    ...(hint ? [hint] : []),
  ], { gap: 6, padding: 14, radius: 18, ...(i === 0 ? { selected: CLAY } : {}) });
}

/** "3,240 words" and what it saved; the honest zero when nothing was said yet. */
function weekNumbers(w: KeybotHomeView["week"]): Node[] {
  const said = w.words > 0 && w.spoken >= w.words * 0.9 ? "spoken this week instead of typed" : "written with Keybot this week";
  return [
    text(plural(w.words, "word", "words"), { size: 34, weight: 700, tracking: -0.8, lineHeight: 40 }),
    meta(w.words > 0 ? `${said} · about ${plural(w.minutesSaved, "minute", "minutes")} saved` : "Hold the Keybot key and speak in any app. Your week fills in here.", { size: 13, lineHeight: 18 }),
  ];
}

/** The "Make it yours" pages, each with a real line about it. */
function yoursLinks(d: KeybotHomeView | undefined, client: "phone" | "desktop"): Array<{ label: string; sub: string; to: string }> {
  return [
    { label: "Tone per app", sub: d ? `Chats · ${d.tones.chats ?? "as you say it"}` : "Chats, mail, work chat", to: SCREENS.keyTone },
    { label: "Teach your style", sub: d ? (d.train.done ? `${d.train.done} of ${d.train.total} done` : "Ten lines, about 3 min") : "Ten lines, about 3 min", to: SCREENS.keyTrain },
    { label: "Your words", sub: d ? `${plural(d.words.added + d.words.learned, "word", "words")} · ${n(d.words.learned)} learned` : "Names, places, work words", to: SCREENS.keyWords },
    { label: "Read aloud", sub: d ? `${d.voice.label} · ${d.voice.speed}` : "The voice that reads to you", to: SCREENS.keyVoices },
    { label: "What you said", sub: d ? `Today · ${plural(d.today, "word", "words")}` : "Copy anything you spoke", to: SCREENS.keyHistory },
    { label: "Keyboard", sub: client === "desktop" ? "Keys, the pill, languages" : (d?.keyboard ?? "Look, feel, the Keybot key"), to: SCREENS.keySettings },
  ];
}

/** The phone keyboard, drawn: two rows of keys, the clay Keybot key beside the space bar. */
function phoneKeys(keyAt: "left" | "right" | "top" = "left", scale = 1): Node {
  const k = (grow_: number, bg: string, kids: Node[] = [], h = 36): Node =>
    box(kids, { flexGrow: grow_, flexBasis: 0, height: Math.round(h * scale), borderRadius: 7 * scale, backgroundColor: bg, alignItems: "center", justifyContent: "center" });
  const mic = icon("mic", { size: Math.round(18 * scale), color: C.paper });
  const top = keyAt === "top"
    ? row([...Array.from({ length: 9 }, () => k(1, C.paper)), k(1, CLAY, [mic])], { gap: 5 * scale })
    : row(Array.from({ length: 10 }, () => k(1, C.paper)), { gap: 5 * scale });
  const bottom = keyAt === "right"
    ? row([k(1.4, C.track, [], 38), k(4, C.paper, [], 38), k(1, CLAY, [mic], 38), k(1.4, C.track, [], 38)], { gap: 5 * scale })
    : keyAt === "top"
      ? row([k(1.4, C.track, [], 38), k(5, C.paper, [], 38), k(1.4, C.track, [], 38)], { gap: 5 * scale })
      : row([k(1.4, C.track, [], 38), k(1, CLAY, [mic], 38), k(4, C.paper, [], 38), k(1.4, C.track, [], 38)], { gap: 5 * scale });
  return col([top, bottom], { gap: 8 * scale, backgroundColor: C.surface, borderRadius: 22 * scale, paddingTop: 12 * scale, paddingBottom: 14 * scale, paddingHorizontal: 8 * scale });
}

function keybotPhone(ctx: BotsCtx, d: KeybotHomeView | undefined) {
  const head = row([
    box([icon("back", { size: 24, label: "Back" })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()),
    botAvatar(KEYBOT, 40),
    col([text("Keybot", { size: 19, weight: 600, lineHeight: 24 }), meta("Your keyboard, in every app")], { gap: 2 }),
  ], { gap: 10 });
  return page(ctx, {
    back: false, nav: "keybot", title: "Keybot", gap: 18,
    body: [
      head,
      d ? col(weekNumbers(d.week), { gap: 4 }) : couldntLoad("your week"),
      col([sectionLabel("What the key does"), col([
        row([modeCard(MODES[0]!, 0), modeCard(MODES[1]!, 1)].map((c) => box([c], { flexGrow: 1, flexBasis: 0 })), { gap: 10, alignItems: "stretch" }),
        row([modeCard(MODES[2]!, 2), modeCard(MODES[3]!, 3)].map((c) => box([c], { flexGrow: 1, flexBasis: 0 })), { gap: 10, alignItems: "stretch" }),
      ], { gap: 10 })], { gap: 10 }),
      listCard(yoursLinks(d, "phone").map((l) => listRow({ label: l.label, value: l.sub, onPress: open(l.to) })), { title: "Make it yours" }),
      col([phoneKeys(), meta("The clay key is Keybot. Hold to speak, tap for more.", { size: 12 })], { gap: 10 }),
    ],
  });
}

/** The week by day: a column a day, today in clay, the days still to come a flat line. */
function weekBars(days: KeybotHomeView["week"]["days"]): Node {
  const max = Math.max(1, ...days.map((x) => x.words));
  return row(days.map((day) => col([
    text(day.ahead || !day.words ? " " : n(day.words), { size: 11, weight: day.today ? 600 : 400, color: day.today ? C.ink : C.meta, lineHeight: 14, align: "center" }),
    box([box([], day.ahead
      ? { width: "100%", height: 3, borderRadius: 2, backgroundColor: C.divider }
      : { width: "100%", height: Math.max(3, Math.round((day.words / max) * 74)), borderRadius: 4, backgroundColor: day.today ? CLAY : day.words ? C.outline : C.divider })],
    { height: 74, width: "100%", justifyContent: "flex-end" }),
    text(day.label, { size: 11, weight: day.today ? 600 : 400, color: day.today ? C.ink : C.meta, lineHeight: 14, align: "center" }),
  ], { flexGrow: 1, flexBasis: 0, gap: 4, alignItems: "center" })), { gap: 10, alignItems: "flex-end" });
}

function byAppCard(d: KeybotHomeView): Node {
  const max = Math.max(1, ...d.apps.map((a) => a.words));
  const rows = d.apps.map((a) => row([
    appSquare((groupOfApp(a.app)?.id as Glyph | undefined) ?? "app", 32),
    col([text(a.app, { size: 14, weight: 500, lineHeight: 18, lines: 1 }), meta(a.line, { size: 12, lines: 1 })], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    row([box([], { width: `${Math.max(4, Math.round((a.words / max) * 100))}%`, height: 6, borderRadius: 3, backgroundColor: CLAY })],
      { width: 120, height: 6, borderRadius: 3, backgroundColor: C.surface, flexShrink: 1 }),
    text(n(a.words), { size: 13, lineHeight: 17, align: "right", style: { width: 50, flexShrink: 0 } }),
  ], { gap: 12, paddingVertical: 9, paddingHorizontal: 18 }));
  return card([
    row([sectionLabel("By app · this week"), grow(),
      row([text("Tone per app", { size: 13, lineHeight: 17 }), icon("chevron", { size: 14 })], { gap: 2 }, open(SCREENS.keyTone))], { paddingTop: 14, paddingHorizontal: 18, paddingBottom: 6 }),
    ...(rows.length ? rows : [meta("Nothing yet this week. Speak in any app and it shows up here, by app.", { size: 13, style: { paddingHorizontal: 18, paddingBottom: 6 } })]),
  ], { padding: 0, gap: 0, radius: 18, style: { paddingBottom: 8 } });
}

/** The laptop's bottom row, the Keybot key in clay with the key this computer holds to talk. */
function laptopKeys(): Node {
  const k = (f: number, label: string, o: { clay?: boolean } = {}): Node => box([
    ...(o.clay ? [icon("mic", { size: 13, color: C.paper })] : []),
    text(label, { size: o.clay ? 10.5 : 10, weight: o.clay ? 600 : 400, color: o.clay ? C.paper : C.meta, lineHeight: 13, ...(o.clay ? { bind: "desktop.holdKey" } : {}) }),
  ], { flexGrow: f, flexBasis: 0, height: 42, borderRadius: 7, backgroundColor: o.clay ? CLAY : C.paper, alignItems: "center", justifyContent: "center", gap: 2, minWidth: 0 });
  return row([k(1, "fn", { clay: true }), k(1.05, "control"), k(1, "option"), k(1.3, "command"), k(4.4, ""), k(1.3, "command"), k(1, "option")],
    { gap: 5, padding: 9, borderRadius: 14, backgroundColor: C.surface });
}

/** This computer's keys, as main.js has them bound (desktop state): a row each. */
function keyList(): Node {
  const line = (label: string, key: string, bind: string) => row([text(label, { size: 13, lineHeight: 18 }), grow(), kbd(key, bind)], { gap: 10, paddingVertical: 6 });
  return col([
    when({ truthy: "desktop.hold" }, line("Hold to speak", "F9", "desktop.holdKey")),
    line("Start or stop talking", "Ctrl+Space", "desktop.hotkey"),
    line("Meeting notes", "Ctrl+Shift+N", "desktop.notesHotkey"),
  ], { gap: 0 });
}

function keybotDesk(ctx: BotsCtx, d: KeybotHomeView | undefined) {
  const holdHint = (verb: string) => [
    when({ truthy: "desktop.hold" }, row([text(verb, { size: 12, color: C.grey70, lineHeight: 16 }), kbd("Fn", "desktop.holdKey")], { gap: 5 })),
    when({ falsy: "desktop.hold" }, row([text("Press", { size: 12, color: C.grey70, lineHeight: 16 }), kbd("Ctrl+Space", "desktop.hotkey")], { gap: 5 })),
  ];
  const hints: Node[] = [
    col(holdHint("Hold"), { gap: 0 }),
    col(holdHint("Select, then hold"), { gap: 0 }),
    text("End with “in Hindi”", { size: 12, color: C.grey70, lineHeight: 16 }),
    text("Speak in the reply box", { size: 12, color: C.grey70, lineHeight: 16 }),
  ];
  return page(ctx, {
    nav: "keybot", title: "Keybot", gap: 18, maxWidth: DESK_WIDTH,
    body: [
      row([
        botAvatar(KEYBOT, 48),
        col([title("Keybot", { size: 26 }), text("Your keyboard, in every app", { size: 14, color: C.grey70, lineHeight: 19 })], { gap: 3, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
        when({ truthy: "desktop.hold" }, row([kbd("Fn", "desktop.holdKey"), text("Hold to speak in any app", { size: 13, color: C.grey70, lineHeight: 17 })], { gap: 8 })),
        when({ falsy: "desktop.hold" }, row([kbd("Ctrl+Space", "desktop.hotkey"), text("Press to speak in any app", { size: 13, color: C.grey70, lineHeight: 17 })], { gap: 8 })),
        button("Settings", open(SCREENS.keySettings), { kind: "secondary", size: "md", icon: "settings" }),
      ], { gap: 14, flexWrap: "wrap" }),
      d ? twoCols([
        card([sectionLabel("This week"), col(weekNumbers(d.week), { gap: 4 }), weekBars(d.week.days)], { gap: 12, radius: 18, style: { paddingHorizontal: 20, paddingBottom: 14 } }),
      ], [byAppCard(d)], { leftWeight: 1, rightWeight: 1.1, gap: 16 }) : couldntLoad("your week"),
      col([sectionLabel("What the key does"), row(MODES.map((m, i) => box([modeCard(m, i, hints[i])], { flexGrow: 1, flexBasis: 0, minWidth: 0 })), { gap: 12, alignItems: "stretch" })], { gap: 10 }),
      twoCols([
        card([sectionLabel("Shortcut keys"), laptopKeys(), meta("The clay key is Keybot. Hold to speak, tap twice to keep listening.", { size: 12 }), keyList()], { gap: 10, radius: 18 }),
      ], [
        col([sectionLabel("Make it yours"), col([0, 2, 4].map((i) => row(yoursLinks(d, "desktop").slice(i, i + 2).map((l) => box([
          row([col([text(l.label, { size: 14, weight: 500, lineHeight: 18 }), meta(l.sub, { size: 12, lines: 1 })], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 }), icon("chevron", { size: 16, color: C.meta })],
            { gap: 10, paddingVertical: 10, paddingLeft: 14, paddingRight: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper }, open(l.to)),
        ], { flexGrow: 1, flexBasis: 0, minWidth: 0 })), { gap: 10 })), { gap: 10 })], { gap: 10 }),
      ], { gap: 16 }),
    ],
  });
}

// ===================================================================== bots.keybot.tone

const GROUP_GLYPH: Record<string, Glyph> = { chats: "chats", mail: "mail", work: "work" };
const presetName = (id: string | null) => TONE_PRESETS.find((p) => p.id === id)?.name ?? null;

/** The state a tone page starts from: the kind it opens on, each kind's preset (and its name), the little things. */
function toneState(d: KeybotToneView): Record<string, unknown> {
  const tone: Record<string, string> = {}, toneName: Record<string, string> = {}, little: Record<string, unknown> = {};
  for (const g of d.groups) {
    tone[g.id] = g.preset ?? "";
    toneName[g.id] = presetName(g.preset) ?? "As you say it";
    little[g.id] = { noStop: g.noStop, latin: g.latin, signOff: g.signOff };
  }
  return { group: d.focus, tone, toneName, little };
}

/** A kind of app in the list: picked shows on the surface grey. */
function groupRow(g: KeybotToneView["groups"][number], desk: boolean): Node {
  const def = TONE_GROUP_DEFS.find((x) => x.id === g.id)!;
  const on = whenEq("group", g.id, C.surface, C.paper);
  return row([
    appSquare(GROUP_GLYPH[g.id]!, desk ? 34 : 32, whenEq("group", g.id, C.paper, C.surface)),
    desk
      ? col([text(def.label, { size: 15, weight: 500, lineHeight: 20 }), meta(def.appsLine, { size: 12 })], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 })
      : text(def.label, { size: 15, weight: 500, lineHeight: 20, style: { flexGrow: 1, flexShrink: 1 } }),
    text(presetName(g.preset) ?? "As you say it", { size: 13, color: C.grey70, lineHeight: 17, bind: `toneName.${g.id}`, align: "right" }),
    ...(desk ? [] : [icon("chevron", { size: 16, color: C.meta })]),
  ], { gap: 12, paddingVertical: 12, paddingLeft: 16, paddingRight: 14, backgroundColor: on, minHeight: 56 }, { kind: "setState", path: "group", value: g.id });
}

/** The four presets for one kind: the chosen one in clay. A tap chooses and saves it. */
function presetGrid(groupId: string): Node {
  const cardOf = (p: (typeof TONE_PRESETS)[number]) => col([
    text(p.name, { size: 15, weight: 600, lineHeight: 20 }),
    meta(p.blurb, { size: 12 }),
  ], {
    gap: 4, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1.5, backgroundColor: C.paper,
    borderColor: whenEq(`tone.${groupId}`, p.id, CLAY, C.line), flexGrow: 1, flexBasis: 0, minWidth: 0,
  }, seq(
    { kind: "setState", path: `tone.${groupId}`, value: p.id },
    { kind: "setState", path: `toneName.${groupId}`, value: p.name },
    save("POST", "/v1/keybot/tone", { group: groupId, preset: p.id }, "Couldn't change the tone. Try again."),
  ));
  return col([0, 2].map((i) => row([cardOf(TONE_PRESETS[i]!), cardOf(TONE_PRESETS[i + 1]!)], { gap: 10, alignItems: "stretch" })), { gap: 10 });
}

/** One kind's line in its chosen tone (or as said, when none is chosen), following the state. */
function sampleFor(groupId: string, desk: boolean): Node[] {
  const label = TONE_GROUP_DEFS.find((g) => g.id === groupId)!.label;
  const variant = (preset: string, name: string, line: string): Node => when({ eq: [`tone.${groupId}`, preset] }, col([
    meta(`${label} · ${name}`, { size: 12 }),
    text(line, { size: desk ? 15 : 14, lineHeight: desk ? 21 : 19 }),
  ], { gap: desk ? 6 : 2 }));
  return [...TONE_PRESETS.map((p) => variant(p.id, p.name, p.sample)), variant("", "As you say it", TONE_SAID)];
}

function tonePhone(ctx: BotsCtx, d: KeybotToneView | undefined) {
  if (!d) return page(ctx, { nav: "keybot", title: "Tone per app", gap: 14, body: [phoneHead("Tone per app"), couldntLoad("your tones")] });
  return page(ctx, {
    nav: "keybot", title: "Tone per app", gap: 14, state: toneState(d),
    body: [
      phoneHead("Tone per app"),
      text("Keybot writes like you, a bit different per app.", { size: 14, color: C.grey70, lineHeight: 19 }),
      box(d.groups.flatMap((g, i) => [...(i ? [divider()] : []), groupRow(g, false)]), { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      ...TONE_GROUP_DEFS.map((g) => when({ eq: ["group", g.id] }, col([sectionLabel(`Presets for ${g.label}`), presetGrid(g.id)], { gap: 10 }))),
      col([sectionLabel("One line, each tone"), box([
        row([glyph("chats", { size: 16, color: C.meta }), meta(`You said: “${TONE_SAID}”`, { size: 13, style: { flexShrink: 1 } })], { gap: 8, paddingVertical: 12, paddingHorizontal: 16 }),
        ...TONE_GROUP_DEFS.flatMap((g) => [divider(), col(sampleFor(g.id, false), { paddingVertical: 10, paddingHorizontal: 16 })]),
      ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" })], { gap: 10 }),
    ],
    footer: [row([text(`Teach Keybot your style · ${d.train.done} of ${d.train.total} done`, { size: 14, weight: 500, lineHeight: 18 }), icon("chevron", { size: 16 })],
      { gap: 8, justifyContent: "center", minHeight: 44 }, open(SCREENS.keyTrain))],
  });
}

function toneDesk(ctx: BotsCtx, d: KeybotToneView | undefined) {
  const head = deskHead("Tone per app", "Keybot writes like you, a bit different per app.", d
    ? [button(`Teach Keybot your style · ${d.train.done} of ${d.train.total} done`, open(SCREENS.keyTrain), { kind: "secondary", size: "md" })] : []);
  if (!d) return page(ctx, { nav: "keybot", title: "Tone per app", gap: 18, maxWidth: DESK_WIDTH, body: [head, couldntLoad("your tones")] });
  const little = (g: (typeof TONE_GROUP_DEFS)[number]) => when({ eq: ["group", g.id] }, deskCard(`Little things in ${g.label}`, [
    toggleRow("Skip the full stop at the end", `little.${g.id}.noStop`, save("POST", "/v1/keybot/tone", { group: g.id, noStop: `$state.little.${g.id}.noStop` }), "No full stop to end a message"),
    toggleRow("Write Hindi words in English letters", `little.${g.id}.latin`, save("POST", "/v1/keybot/tone", { group: g.id, latin: `$state.little.${g.id}.latin` }), "“haan”, “kal”, “7 baje”"),
    toggleRow("Add a sign-off", `little.${g.id}.signOff`, save("POST", "/v1/keybot/tone", { group: g.id, signOff: `$state.little.${g.id}.signOff` }), "Your name at the end, where it fits"),
  ], { gap: 0 }));
  return page(ctx, {
    nav: "keybot", title: "Tone per app", gap: 18, maxWidth: DESK_WIDTH, state: toneState(d),
    body: [
      head,
      twoCols([
        col([sectionLabel("Apps"), box(d.groups.flatMap((g, i) => [...(i ? [divider()] : []), groupRow(g, true)]), { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" })], { gap: 8 }),
        ...TONE_GROUP_DEFS.map(little),
      ], [
        ...TONE_GROUP_DEFS.map((g) => when({ eq: ["group", g.id] }, col([sectionLabel(`Presets for ${g.label}`), presetGrid(g.id)], { gap: 8 }))),
        col([sectionLabel("One line, each tone"), card([
          row([text("You said:", { size: 13, color: C.meta, lineHeight: 17 }), text(`“${TONE_SAID}”`, { size: 13, lineHeight: 17, style: { flexShrink: 1 } })], { gap: 8 }),
          row(TONE_GROUP_DEFS.map((g) => col(sampleFor(g.id, true), {
            flexGrow: 1, flexBasis: 0, minWidth: 0, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1.5,
            borderColor: whenEq("group", g.id, CLAY, C.line),
          })), { gap: 10, alignItems: "stretch" }),
        ], { gap: 12, radius: 18 })], { gap: 8 }),
        meta("Keybot picks the tone from the app you’re in. Say “make it formal” any time to change just one message.", { size: 12 }),
      ], { left: 330, gap: 24 }),
    ],
  });
}

// ===================================================================== bots.keybot.words

type WordRow = { key: string; word: string; source: "added" | "learned"; kind: string; heard: string; was?: string; recent?: KeybotWordsView["added"][number]["recent"]; forget: ActionSpec };

function wordRows(d: KeybotWordsView): WordRow[] {
  const said = (u: number | undefined) => (u === undefined ? "" : u === 0 ? "not heard yet" : `said ${plural(u, "time", "times")}`);
  return [
    ...d.added.map((w): WordRow => ({
      key: `a:${w.word}`, word: w.word, source: "added", kind: w.kind === "pair" ? "Spelling" : "Word", was: w.was,
      heard: said(w.uses) || (w.was ? `heard as “${w.was}”` : "you added it"), recent: w.recent,
      forget: write("POST", "/v1/words", { remove: w.word, kind: w.kind }, `Forgot “${w.word}”`, "Couldn't forget that word. Try again."),
    })),
    ...d.learned.map((w): WordRow => ({
      key: `l:${w.word}`, word: w.word, source: "learned", kind: "Your word", heard: w.means || "heard in what you say", recent: w.recent,
      forget: write("POST", "/v1/keybot/learned/forget", { kind: "word", key: w.word }, `Forgot “${w.word}”`, "Couldn't forget that word. Try again."),
    })),
  ];
}

const sourceIs = (src: "added" | "learned"): Condition => ({ any: [{ eq: ["filter", "all"] }, { eq: ["filter", src] }] });

function badge(source: "added" | "learned"): Node {
  return source === "added"
    ? row([text("Added", { size: 12, lineHeight: 16 })], { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 10, borderWidth: 1, borderColor: C.outline, flexShrink: 0 })
    : row([text("Learned from you", { size: 12, color: C.grey70, lineHeight: 16 })], { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 10, backgroundColor: C.surface, flexShrink: 0 });
}

/** Adding a word: Enter or Add saves it (POST /v1/words), and Keybot spells it that way from then on. */
const addWord: ActionSpec = {
  kind: "condition", if: { falsy: "newWord" }, then: toast("Type the word first"),
  else: call("POST", "/v1/words", { add: "$state.newWord" }, {
    ok: seq({ kind: "clearState", path: "newWord" }, { kind: "setState", path: "adding", value: false }, toast("Added. Keybot spells it your way now."), { kind: "refresh" }),
    fail: oops("Couldn't add that word. Try again."),
  }),
};

function addRow(): Node {
  return row([
    box([field("newWord", "A name, a place, a work word", { onSubmit: addWord, label: "New word" })], { flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    button("Add", addWord, { size: "md" }),
    quietButton("Cancel", { kind: "setState", path: "adding", value: false }, { size: "md" }),
  ], { gap: 8 });
}

function wordsChips(d: KeybotWordsView): Node {
  const c = (label: string, value: string) => row([text(label, { size: 13, lineHeight: 17, style: { color: whenEq("filter", value, C.paper, C.ink) } })], {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1,
    borderColor: whenEq("filter", value, C.ink, C.outline), backgroundColor: whenEq("filter", value, C.ink, C.paper),
  }, { kind: "setState", path: "filter", value });
  return row([c("All", "all"), c(`Learned from you · ${n(d.learned.length)}`, "learned"), c(`Added · ${n(d.added.length)}`, "added")], { gap: 8, flexWrap: "wrap" });
}

function wordsPhone(ctx: BotsCtx, d: KeybotWordsView | undefined) {
  const q = String(ctx.params.q ?? "");
  if (!d) return page(ctx, { nav: "keybot", title: "Your words", gap: 14, body: [phoneHead("Your words"), couldntLoad("your words")] });
  const total = d.total.added + d.total.learned;
  const rows = wordRows(d);
  const section = (src: "added" | "learned", label: string): Node => {
    const list = rows.filter((r) => r.source === src).slice(0, 40);
    if (!list.length) return { type: "Stack", style: { height: 0 } };
    const more = rows.filter((r) => r.source === src).length - list.length;
    return when(sourceIs(src), col([
      sectionLabel(`${label} · ${n(rows.filter((r) => r.source === src).length)}`),
      box(list.flatMap((r, i) => [
        ...(i ? [divider()] : []),
        row([
          col([text(r.word, { size: 15, weight: 500, lineHeight: 20, lines: 1 }), meta(r.heard, { size: 12, lines: 1 })], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
          badge(r.source),
        ], { gap: 8, paddingVertical: 11, paddingLeft: 16, paddingRight: 14 }, { kind: "setState", path: "sel", value: r.key }),
        when({ eq: ["sel", r.key] }, row([
          meta(r.recent ? `Last said: “${r.recent.text}”` : "Not said since it was learned.", { size: 12, lines: 2, style: { flexGrow: 1, flexShrink: 1 } }),
          button("Forget it", r.forget, { kind: "secondary", size: "md" }),
        ], { gap: 10, paddingHorizontal: 16, paddingBottom: 12 })),
      ]), { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      ...(more > 0 ? [meta(`And ${n(more)} more. Search to find one.`, { size: 12 })] : []),
    ], { gap: 8 }));
  };
  return page(ctx, {
    nav: "keybot", title: "Your words", gap: 14, state: { q, filter: "all", sel: "", adding: false, newWord: "" },
    body: [
      phoneHead("Your words"),
      col([text(plural(total, "word", "words"), { size: 34, weight: 700, tracking: -0.8, lineHeight: 40 }),
        meta(`Keybot knows now · ${n(d.total.learned)} learned from you`, { size: 13 })], { gap: 2 }),
      searchField(SCREENS.keyWords, "Search names, places, work words"),
      ...(q ? [searchLine(SCREENS.keyWords, q)] : []),
      ...(total ? [wordsChips(d)] : []),
      ...(!total
        ? [emptyState({ pose: "hello", title: "No words yet", body: "Names, places, the words only your team uses. Add one and Keybot spells it your way, everywhere." })]
        : !rows.length ? [meta("No word matches that. Try fewer letters.", { size: 14 })]
        : [section("added", "Added by you"), section("learned", "Learned from you")]),
    ],
    footer: [
      when({ falsy: "adding" }, primaryButton("Add a word", { kind: "setState", path: "adding", value: true }, { icon: "plus", wide: true })),
      when({ truthy: "adding" }, addRow()),
    ],
  });
}

function wordsDesk(ctx: BotsCtx, d: KeybotWordsView | undefined) {
  const q = String(ctx.params.q ?? "");
  const head = deskHead("Your words", d ? `${plural(d.total.added + d.total.learned, "word", "words")} Keybot knows now · ${n(d.total.learned)} learned from you` : "The words Keybot spells your way",
    [when({ falsy: "adding" }, button("Add a word", { kind: "setState", path: "adding", value: true }, { size: "md", icon: "plus" }))]);
  if (!d) return page(ctx, { nav: "keybot", title: "Your words", gap: 18, maxWidth: DESK_WIDTH, body: [head, couldntLoad("your words")] });
  const rows = wordRows(d).slice(0, 80);
  const COLS = [{ w: 1.2 }, { fixed: 92 }, { w: 1 }, { fixed: 132 }] as const;
  const cellStyle = (j: number) => ("fixed" in COLS[j]! ? { width: (COLS[j] as { fixed: number }).fixed, flexShrink: 0 } : { flexGrow: (COLS[j] as { w: number }).w, flexBasis: 0, minWidth: 0 });
  const headRow = row(["Word", "Kind", "Heard", "From"].map((h, j) => box([sectionLabel(h, { size: 10.5 })], cellStyle(j))), { gap: 12, paddingTop: 10, paddingBottom: 8, paddingHorizontal: 16 });
  const wordRow = (r: WordRow): Node => row([
    box([text(r.word, { size: 14, weight: 600, lineHeight: 19, lines: 1 })], cellStyle(0)),
    box([text(r.kind, { size: 13, color: C.grey70, lineHeight: 17 })], cellStyle(1)),
    box([meta(r.heard, { size: 13, lines: 1 })], cellStyle(2)),
    box([text(r.source === "added" ? "Added" : "Learned from you", { size: 13, color: r.source === "added" ? C.ink : C.grey70, lineHeight: 17 })], cellStyle(3)),
  ], { gap: 12, paddingHorizontal: 16, minHeight: 40, backgroundColor: whenEq("sel", r.key, C.surface, C.paper) }, { kind: "setState", path: "sel", value: r.key });
  const group = (src: "added" | "learned", label: string): Node[] => {
    const list = rows.filter((r) => r.source === src);
    return list.length ? [when(sourceIs(src), col([
      box([sectionLabel(`${label} · ${n(list.length)}`)], { paddingTop: 8, paddingBottom: 6, paddingHorizontal: 16 }),
      ...list.map(wordRow),
    ]))] : [];
  };
  const panel = (r: WordRow): Node => when({ eq: ["sel", r.key] }, col([
    col([sectionLabel("Selected word"), text(r.word, { size: 24, weight: 700, tracking: -0.4, lineHeight: 30 }),
      meta(`${r.kind} · ${r.source === "added" ? "Added by you" : "Learned from you"}`, { size: 12 })], { gap: 2 }),
    col([
      ...(r.heard ? [row([meta(r.source === "learned" ? "Means" : "Heard", { size: 13 }), grow(), text(r.heard, { size: 13, lineHeight: 17, align: "right", style: { flexShrink: 1 } })], { gap: 10, paddingVertical: 8 })] : []),
      ...(r.was ? [divider(), row([meta("Keybot writes it as", { size: 13 }), grow(), text(r.word, { size: 13, weight: 600, lineHeight: 17 })], { gap: 10, paddingVertical: 8 })] : []),
    ]),
    ...(r.recent ? [col([meta("Recently said", { size: 13 }), col([
      text(`“${r.recent.text}”`, { size: 13, lineHeight: 18, lines: 3 }),
      meta(`${dayLabel(ctx, Date.parse(r.recent.at))} · ${r.recent.app}`, { size: 12 }),
    ], { gap: 2, backgroundColor: C.surface, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 })], { gap: 6 })] : []),
    row([button("Forget it", r.forget, { kind: "secondary", size: "md" })], { gap: 8 }),
  ], { gap: 12 }));
  return page(ctx, {
    nav: "keybot", title: "Your words", gap: 18, maxWidth: DESK_WIDTH,
    state: { q, filter: "all", sel: rows[0]?.key ?? "", adding: false, newWord: "" },
    body: [
      head,
      when({ truthy: "adding" }, card([addRow()], { padding: 12, radius: 18 })),
      row([box([searchField(SCREENS.keyWords, "Search your words")], { flexGrow: 1, flexShrink: 1, flexBasis: 300, minWidth: 220 }), wordsChips(d)], { gap: 8, flexWrap: "wrap" }),
      ...(q ? [searchLine(SCREENS.keyWords, q)] : []),
      !rows.length
        ? (d.total.added + d.total.learned
          ? meta("No word matches that. Try fewer letters.", { size: 14 })
          : emptyState({ pose: "hello", title: "No words yet", body: "Names, places, the words only your team uses. Add one and Keybot spells it your way, everywhere.", action: { label: "Add a word", onPress: { kind: "setState", path: "adding", value: true } } }))
        : twoCols([
          box([headRow, divider(), ...group("added", "Added by you"), ...group("learned", "Learned from you")], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden", paddingBottom: 6 }),
        ], [
          card(rows.map(panel), { radius: 18, gap: 0 }),
        ], { leftWeight: 2.6, rightWeight: 1, gap: 16 }),
    ],
  });
}

// ===================================================================== bots.keybot.voices

const SPEEDS = [{ label: "0.8×", value: "0.8" }, { label: "Normal", value: "1" }, { label: "1.25×", value: "1.25" }, { label: "1.5×", value: "1.5" }];

function voiceCard(v: KeybotVoicesView["voices"][number], desk: boolean): Node {
  return row([
    col([text(v.label, { size: 15, weight: 600, lineHeight: 20 }), meta(v.blurb, { size: 12 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    when({ eq: ["voice", v.id] }, text("In use", { size: 12, weight: 600, lineHeight: 16 })),
  ], {
    gap: 12, paddingVertical: 12, paddingHorizontal: 16, minHeight: 60, borderRadius: 18, borderWidth: 1.5, backgroundColor: C.paper,
    borderColor: whenEq("voice", v.id, CLAY, C.line), ...(desk ? { flexGrow: 1, flexBasis: 0, minWidth: 0 } : {}),
  }, seq({ kind: "setState", path: "voice", value: v.id }, save("PUT", "/v1/personality", { ttsVoice: v.id }, "Couldn't change the voice. Try again.")));
}

const readSave = (key: string) => save("PUT", "/v1/keybot/prefs", { read: { [key]: `$state.read.${key}` } });

function voicesPhone(ctx: BotsCtx, d: KeybotVoicesView | undefined) {
  if (!d) return page(ctx, { nav: "keybot", title: "Read aloud", gap: 14, body: [phoneHead("Read aloud"), couldntLoad("the voices")] });
  return page(ctx, {
    nav: "keybot", title: "Read aloud", gap: 14, state: { voice: d.current, read: d.read },
    body: [
      phoneHead("Read aloud"),
      text("Pick the voice Keybot uses to read messages and your drafts.", { size: 14, color: C.grey70, lineHeight: 19 }),
      col([sectionLabel("Voices"), ...d.voices.map((v) => voiceCard(v, false))], { gap: 8 }),
      col([sectionLabel("Speed"), segmented(SPEEDS, "read.speed", { onChange: readSave("speed") })], { gap: 8 }),
      listCard([
        switchRow("Read new messages aloud while driving", "read.driving", { sub: "Starts when the phone joins your car. Pinned people only.", onChange: readSave("driving") }),
        switchRow("Read my draft back before sending", "read.draftBack", { onChange: readSave("draftBack") }),
      ]),
      meta("Keybot reads Ask’s answers to you in this voice.", { size: 12 }),
    ],
  });
}

function voicesDesk(ctx: BotsCtx, d: KeybotVoicesView | undefined) {
  const head = deskHead("Read aloud", "Pick the voice Keybot uses to read messages and your drafts.");
  if (!d) return page(ctx, { nav: "keybot", title: "Read aloud", gap: 18, maxWidth: DESK_WIDTH, body: [head, couldntLoad("the voices")] });
  const pairs: Node[] = [];
  for (let i = 0; i < d.voices.length; i += 2) {
    pairs.push(row([voiceCard(d.voices[i]!, true), d.voices[i + 1] ? voiceCard(d.voices[i + 1]!, true) : box([], { flexGrow: 1, flexBasis: 0 })], { gap: 10, alignItems: "stretch" }));
  }
  return page(ctx, {
    nav: "keybot", title: "Read aloud", gap: 18, maxWidth: DESK_WIDTH, state: { voice: d.current, read: d.read },
    body: [
      head,
      twoCols([
        col([sectionLabel("Voices"), ...pairs], { gap: 10 }),
        col([sectionLabel("Speed"), segmented(SPEEDS, "read.speed", { onChange: readSave("speed") })], { gap: 8 }),
      ], [
        deskCard("On this computer", [toggleRow("Read my draft back before sending", "read.draftBack", readSave("draftBack"), "Hear it once before you press send")], { gap: 0 }),
        deskCard("On your phone", [toggleRow("Read new messages aloud while driving", "read.driving", readSave("driving"), "Starts when the phone joins your car. Pinned people only.")], { gap: 0 }),
        box([text("Keybot reads Ask’s answers to you in this voice, here and on your phone.", { size: 13, color: C.grey70, lineHeight: 18 })],
          { backgroundColor: C.surface, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 }),
      ], { leftWeight: 1.7, rightWeight: 1, gap: 24 }),
    ],
  });
}

// ===================================================================== bots.keybot.train

/** Keybot's turn: its face, what it says, and the line to say (in clay when it is the one now). */
function botTurn(says: string, line: string, now: boolean): Node {
  return row([
    botAvatar(KEYBOT, 30),
    col([
      text(says, { size: 14, color: C.grey70, lineHeight: 19 }),
      box([text(`“${line}”`, { size: 15, lineHeight: 21 })], {
        alignSelf: "flex-start", paddingVertical: 10, paddingHorizontal: 14, borderWidth: now ? 1.5 : 1, borderColor: now ? CLAY : C.line,
        borderTopLeftRadius: 6, borderTopRightRadius: 18, borderBottomLeftRadius: 18, borderBottomRightRadius: 18,
      }),
    ], { gap: 6, flexShrink: 1, minWidth: 0 }),
  ], { gap: 10, alignItems: "flex-start" });
}

function youTurn(said: string): Node {
  return col([
    box([text(said, { size: 15, color: C.paper, lineHeight: 21 })], {
      backgroundColor: C.ink, paddingVertical: 10, paddingHorizontal: 14,
      borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomLeftRadius: 20, borderBottomRightRadius: 6, maxWidth: "85%",
    }),
    meta("You said", { size: 12 }),
  ], { gap: 4, alignItems: "flex-end" });
}

const kindFor = (k: string) => (k === "Work" ? "for work" : k === "Mail" ? "for mail" : "for a chat");

function conversation(d: KeybotTrainView): Node[] {
  const cur = d.lines[d.current];
  if (!cur) return [];
  if (d.previous < 0) return [botTurn("Say this your way:", cur.text, true)];
  const prev = d.lines[d.previous]!;
  return [botTurn("Say this your way:", prev.text, false), youTurn(prev.said ?? ""), botTurn(`Got it. Next one, ${kindFor(cur.kind)}:`, cur.text, true)];
}

function progress(d: KeybotTrainView): Node {
  const left = d.lines.filter((l) => !l.said && !l.skipped).length;
  return col([
    row([text(`${d.done} of ${d.lines.length}`, { size: 14, weight: 600, lineHeight: 18 }), grow(),
      meta(left ? `about ${Math.max(1, Math.round(left * 0.3))} min left` : "all done", { size: 12 })]),
    row(d.lines.map((l, i) => box([], { flexGrow: 1, flexBasis: 0, height: 5, borderRadius: 3, backgroundColor: l.said ? C.ink : i === d.current ? CLAY : C.track })), { gap: 4 }),
  ], { gap: 8 });
}

function learnedCard(d: KeybotTrainView, desk: boolean): Node {
  if (!d.learned.length) return col([sectionLabel("What I learned"), meta("Nothing yet. Say a line your way, and what it hears shows up here.", { size: 13 })], { gap: 8 });
  return col([sectionLabel("What I learned"), box(d.learned.flatMap((l, i) => [
    ...(i ? [divider()] : []),
    row([
      col([text(l.title, { size: 14, lineHeight: 19 }), ...(l.sub ? [meta(l.sub, { size: 12, lines: 2 })] : [])], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0, paddingVertical: 10 }),
      desk
        ? row([text("Not me", { size: 12, color: C.grey70, lineHeight: 16 })], { height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: C.line },
          write("POST", "/v1/keybot/learned/forget", { kind: l.kind, key: l.key }, "Forgotten", "Couldn't forget that. Try again."))
        : box([text("Not me", { size: 12, color: C.meta, lineHeight: 16 })], { minHeight: 44, paddingHorizontal: 10, justifyContent: "center" },
          write("POST", "/v1/keybot/learned/forget", { kind: l.kind, key: l.key }, "Forgotten", "Couldn't forget that. Try again.")),
    ], { gap: 10, paddingLeft: 16, paddingRight: 6, minHeight: 52 }),
  ]), { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" })], { gap: 8 });
}

function trainActions(d: KeybotTrainView, client: "phone" | "desktop"): Node[] {
  if (d.current < 0) return [];
  const next: ActionSpec = {
    kind: "condition", if: { falsy: "said" }, then: toast("Say it your way first"),
    else: call("POST", "/v1/keybot/train", { line: d.current, said: "$state.said" }, {
      ok: seq({ kind: "clearState", path: "said" }, { kind: "refresh" }), fail: oops("Couldn't learn from that. Try again."),
    }),
  };
  const skip = write("POST", "/v1/keybot/train/skip", { line: d.current }, undefined, "Couldn't skip it. Try again.");
  return [
    field("said", client === "desktop" ? "Type it, or hold your Keybot key and say it" : "Type it, or hold the clay key and say it", { onSubmit: next, label: "Your way", returnKey: "send" }),
    row([
      box([button("Skip", skip, { kind: "secondary", wide: true, size: client === "desktop" ? "md" : "lg" })], { flexGrow: 1, flexBasis: 0 }),
      box([button("That's how I say it", next, { wide: true, icon: "check", size: client === "desktop" ? "md" : "lg" })], { flexGrow: 2.4, flexBasis: 0 }),
    ], { gap: 8 }),
  ];
}

function trainDone(): Node {
  return col([
    blip("done", 140),
    text("All ten done", { size: 18, weight: 600, lineHeight: 24, align: "center" }),
    meta("Keybot writes more like you now. It keeps learning from what you say.", { size: 13, align: "center" }),
    button("Start again", write("POST", "/v1/keybot/train/restart", undefined, undefined, "Couldn't start again. Try again."), { kind: "secondary", size: "md" }),
  ], { gap: 10, alignItems: "center", paddingVertical: 8 });
}

function trainPhone(ctx: BotsCtx, d: KeybotTrainView | undefined) {
  if (!d) return page(ctx, { nav: "keybot", title: "Teach your style", gap: 14, body: [phoneHead("Teach your style"), couldntLoad("your lines")] });
  return page(ctx, {
    nav: "keybot", title: "Teach your style", gap: 14, state: { said: "" },
    body: [
      phoneHead("Teach your style"),
      progress(d),
      ...(d.current < 0 ? [trainDone()] : [col(conversation(d), { gap: 10 })]),
      learnedCard(d, false),
    ],
    footer: trainActions(d, "phone"),
  });
}

function trainDesk(ctx: BotsCtx, d: KeybotTrainView | undefined) {
  const head = deskHead("Teach your style", "Say 10 everyday lines your way. Keybot picks up how you really talk.");
  if (!d) return page(ctx, { nav: "keybot", title: "Teach your style", gap: 18, maxWidth: DESK_WIDTH, body: [head, couldntLoad("your lines")] });
  const lastDone = d.lines.reduce((m, l, i) => (l.said || l.skipped ? i + 1 : m), 0);
  const lineRow = (l: KeybotTrainView["lines"][number], i: number): Node => row([
    box([l.said ? statusMark("done") : i === d.current ? statusMark("working", { color: CLAY }) : l.skipped ? statusMark("waiting") : box([], { width: 8, height: 8 })], { width: 12, alignItems: "center" }),
    text(String(i + 1), { size: 12, color: C.meta, lineHeight: 16, style: { width: 20 } }),
    text(`“${l.text}”`, { size: 13, weight: i === d.current ? 600 : 400, color: l.said || l.skipped ? C.idle : C.ink, lineHeight: 18, style: { flexGrow: 1, flexShrink: 1, minWidth: 0, paddingVertical: 4 } }),
    meta(l.kind, { size: 12 }),
  ], { gap: 8, minHeight: 30 });
  return page(ctx, {
    nav: "keybot", title: "Teach your style", gap: 18, maxWidth: DESK_WIDTH, state: { said: "" },
    body: [
      head,
      twoCols([
        card([
          progress(d),
          ...(lastDone ? [row([text(lastDone === 1 ? "Line 1 done" : `Lines 1 to ${lastDone} done`, { size: 11, color: C.meta, lineHeight: 14 })],
            { alignSelf: "center", backgroundColor: C.surface, borderRadius: 10, paddingVertical: 3, paddingHorizontal: 10 })] : []),
          ...(d.current < 0 ? [trainDone()] : conversation(d)),
          ...trainActions(d, "desktop"),
        ], { gap: 14, radius: 18, style: { paddingHorizontal: 18 } }),
      ], [
        learnedCard(d, true),
        col([sectionLabel(`All ${d.lines.length} lines`), card(d.lines.map(lineRow), { gap: 0, radius: 18, style: { paddingVertical: 6 } })], { gap: 6 }),
      ], { leftWeight: 1.15, rightWeight: 1, gap: 20 }),
    ],
  });
}

// ===================================================================== bots.keybot.history

/** The person's own clock (ctx.tzOffsetMinutes): "9:42 pm". */
function clock(ctx: BotsCtx, ms: number): string {
  const d = new Date(ms + ctx.tzOffsetMinutes * 60_000);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayKey = (ctx: BotsCtx, ms: number) => new Date(ms + ctx.tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
/** "Today", "Yesterday", "Mon 26 Oct". */
function dayLabel(ctx: BotsCtx, ms: number): string {
  if (!Number.isFinite(ms)) return "Earlier";
  const k = dayKey(ctx, ms), today = dayKey(ctx, ctx.live.now);
  if (k === today) return "Today";
  if (k === dayKey(ctx, ctx.live.now - 86_400_000)) return "Yesterday";
  const d = new Date(ms + ctx.tzOffsetMinutes * 60_000);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const HOW: Record<HistoryEntry["kind"], string> = { voice: "Spoken", typing: "Rewritten", draft: "Reply" };
const words = (e: HistoryEntry) => e.wordsOut ?? (e.output ? e.output.trim().split(/\s+/).filter(Boolean).length : 0);

function byDay(ctx: BotsCtx, entries: HistoryEntry[]): Array<{ label: string; words: number; entries: HistoryEntry[] }> {
  const out: Array<{ key: string; label: string; words: number; entries: HistoryEntry[] }> = [];
  for (const e of entries) {
    const ms = Date.parse(e.createdAt);
    const key = Number.isFinite(ms) ? dayKey(ctx, ms) : "earlier";
    let g = out.find((x) => x.key === key);
    if (!g) { g = { key, label: dayLabel(ctx, ms), words: 0, entries: [] }; out.push(g); }
    g.entries.push(e);
    g.words += words(e);
  }
  return out;
}

/** The kind of app a line went to, for the chips: chats, mail, work, or none of them. */
const kindOf = (e: HistoryEntry) => groupOfApp(e.targetApp)?.id ?? "other";
const shownFor = (e: HistoryEntry): Condition => ({ any: [{ eq: ["app", "all"] }, { eq: ["app", kindOf(e)] }] });
const appOf = (e: HistoryEntry) => groupOfApp(e.targetApp)?.label ?? (e.targetApp && e.targetApp !== "Generic" ? (e.targetApp === "Desktop" ? "Computer" : e.targetApp) : "");

function copyAction(client: "phone" | "desktop", textToCopy: string): ActionSpec {
  return client === "desktop" ? { kind: "copyText", text: textToCopy, message: "Copied" } : { kind: "copyToClipboard", text: textToCopy, toastMessage: "Copied" };
}
const forgetLine = (e: HistoryEntry) => write("DELETE", `/v1/history/${encodeURIComponent(e.id)}`, undefined, "Forgotten", "Couldn't forget that. Try again.");

function historyChips(): Node {
  const c = (label: string, value: string) => row([text(label, { size: 13, lineHeight: 17, style: { color: whenEq("app", value, C.paper, C.ink) } })], {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1,
    borderColor: whenEq("app", value, C.ink, C.outline), backgroundColor: whenEq("app", value, C.ink, C.paper),
  }, { kind: "setState", path: "app", value });
  return row([c("All", "all"), ...TONE_GROUP_DEFS.map((g) => c(g.label, g.id))], { gap: 8, flexWrap: "wrap" });
}

const clearAll = write("POST", "/v1/keybot/history/clear", undefined, "Cleared", "Couldn't clear it. Try again.");

function clearConfirm(): Node {
  return when({ truthy: "confirmClear" }, card([
    text("Clear everything you said? This can't be undone.", { size: 14, weight: 500, lineHeight: 19 }),
    row([button("Clear it all", clearAll, { size: "md" }), quietButton("Keep it", { kind: "setState", path: "confirmClear", value: false }, { size: "md" })], { gap: 8 }),
  ], { gap: 10, padding: 14, radius: 18 }));
}

function historyEmpty(d: KeybotHistoryView): Node {
  if (d.off) {
    return emptyState({ pose: "think", title: "Nothing is kept", body: "History is off, so what you say isn't saved anywhere. Turn it on to copy things you said before.",
      action: { label: "Keep what I say", onPress: write("PUT", "/v1/personality", { retainHistory: true }, "History is on") } });
  }
  if (d.q) return meta("Nothing you said matches that.", { size: 14 });
  return emptyState({ pose: "listen", title: "Nothing here yet", body: "Hold the Keybot key and speak in any app. What you said shows up here, to copy again." });
}

function historyPhone(ctx: BotsCtx, d: KeybotHistoryView | undefined) {
  const q = String(ctx.params.q ?? "");
  if (!d) return page(ctx, { nav: "keybot", title: "What you said", gap: 14, body: [phoneHead("What you said"), couldntLoad("what you said")] });
  const days = byDay(ctx, d.entries.slice(0, 80));
  const actionBtn = (g: Glyph, label: string, a: ActionRef) => box([glyph(g, { size: 18, color: C.grey70, label })], { width: 44, height: 44, alignItems: "center", justifyContent: "center", flexShrink: 0 }, a);
  return page(ctx, {
    nav: "keybot", title: "What you said", gap: 14, state: { q, app: "all", confirmClear: false },
    body: [
      phoneHead("What you said"),
      searchField(SCREENS.keyHistory, "Search what you said"),
      ...(q ? [searchLine(SCREENS.keyHistory, q)] : []),
      ...(d.entries.length ? [historyChips()] : []),
      ...(!d.entries.length ? [historyEmpty(d)] : days.map((g) => col([
        row([sectionLabel(g.label), grow(), meta(plural(g.words, "word", "words"), { size: 12 })]),
        box(g.entries.flatMap((e, i) => [
          ...(i ? [when(shownFor(e), divider())] : []),
          when(shownFor(e), row([
            col([
              meta([clock(ctx, Date.parse(e.createdAt)), appOf(e), HOW[e.kind]].filter(Boolean).join(" · "), { size: 12 }),
              text(e.output, { size: 14, lineHeight: 19, lines: 3 }),
            ], { gap: 3, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
            actionBtn("copy", "Copy", copyAction("phone", e.output)),
            actionBtn("forget", "Forget this", forgetLine(e)),
          ], { gap: 2, paddingVertical: 10, paddingLeft: 16, paddingRight: 4 })),
        ]), { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      ], { gap: 8 }))),
    ],
    footer: d.off ? [] : [
      clearConfirm(),
      row([
        icon("lock", { size: 16, color: C.grey70 }),
        text("Kept with your account until you clear it.", { size: 13, color: C.grey70, lineHeight: 17, style: { flexGrow: 1, flexShrink: 1 } }),
        box([text("Clear now", { size: 13, weight: 600, lineHeight: 17 })], { minHeight: 40, paddingHorizontal: 10, justifyContent: "center" }, { kind: "setState", path: "confirmClear", value: true }),
      ], { gap: 10, backgroundColor: C.surface, borderRadius: 18, paddingVertical: 4, paddingLeft: 14, paddingRight: 6 }),
    ],
  });
}

function historyDesk(ctx: BotsCtx, d: KeybotHistoryView | undefined) {
  const q = String(ctx.params.q ?? "");
  const head = deskHead("What you said", "Copy anything you spoke, or forget it.", d && d.entries.length
    ? [button("Clear now", { kind: "setState", path: "confirmClear", value: true }, { kind: "secondary", size: "md" })] : []);
  if (!d) return page(ctx, { nav: "keybot", title: "What you said", gap: 18, maxWidth: DESK_WIDTH, body: [head, couldntLoad("what you said")] });
  const COLS: Array<{ w?: number; fixed?: number; label: string }> = [
    { fixed: 70, label: "Time" }, { fixed: 108, label: "App" }, { w: 1, label: "What you said" }, { fixed: 52, label: "Words" }, { fixed: 78, label: "How" }, { fixed: 84, label: "" },
  ];
  const cell = (j: number, kid: Node) => box([kid], COLS[j]!.fixed ? { width: COLS[j]!.fixed, flexShrink: 0 } : { flexGrow: 1, flexBasis: 0, minWidth: 0 });
  const round = (g: Glyph, label: string, a: ActionRef) => box([glyph(g, { size: 16, color: C.grey70, label })], {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center",
  }, a);
  const line = (e: HistoryEntry): Node => when(shownFor(e), row([
    cell(0, text(clock(ctx, Date.parse(e.createdAt)), { size: 13, color: C.grey70, lineHeight: 17 })),
    cell(1, text(appOf(e) || "—", { size: 13, lineHeight: 17, lines: 1 })),
    cell(2, text(e.output, { size: 14, lineHeight: 19, lines: 2 })),
    cell(3, text(n(words(e)), { size: 13, color: C.grey70, lineHeight: 17 })),
    cell(4, meta(HOW[e.kind], { size: 12 })),
    cell(5, row([round("copy", "Copy", copyAction("desktop", e.output)), round("forget", "Forget this", forgetLine(e))], { gap: 6 })),
  ], { gap: 12, paddingVertical: 4, paddingLeft: 16, paddingRight: 12, minHeight: 48 }));
  const days = byDay(ctx, d.entries.slice(0, 150));
  return page(ctx, {
    nav: "keybot", title: "What you said", gap: 18, maxWidth: DESK_WIDTH, state: { q, app: "all", confirmClear: false },
    body: [
      head,
      clearConfirm(),
      row([box([searchField(SCREENS.keyHistory, "Search what you said")], { flexGrow: 1, flexShrink: 1, flexBasis: 300, minWidth: 220 }), ...(d.entries.length ? [historyChips()] : [])], { gap: 8, flexWrap: "wrap" }),
      ...(q ? [searchLine(SCREENS.keyHistory, q)] : []),
      ...(!d.entries.length ? [historyEmpty(d)] : [
        box([
          row(COLS.map((c, j) => cell(j, sectionLabel(c.label, { size: 10.5 }))), { gap: 12, paddingTop: 10, paddingBottom: 8, paddingLeft: 16, paddingRight: 12 }),
          ...days.flatMap((g) => [
            row([text(g.label, { size: 11, weight: 600, tracking: 0.4, upper: true, lineHeight: 15 }), grow(), meta(plural(g.words, "word", "words"), { size: 12 })],
              { paddingTop: 9, paddingBottom: 7, paddingHorizontal: 16, backgroundColor: C.surface }),
            ...g.entries.map(line),
          ]),
        ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" }),
      ]),
      ...(d.off ? [] : [row([icon("lock", { size: 14, color: C.meta }), meta("Kept with your account until you clear it. Only you can see it.", { size: 12 })], { gap: 8 })]),
    ],
  });
}

// ===================================================================== bots.keybot.settings

const kbSave = (key: string) => save("PUT", "/v1/keybot/prefs", { keyboard: { [key]: `$state.kb.${key}` } });

/** A small keyboard in the light or dark look. */
function lookPreview(dark: boolean): Node {
  const key = dark ? C.grey70 : C.paper, side = dark ? C.meta : C.track;
  const k = (f: number, bg: string, h = 14) => box([], { flexGrow: f, flexBasis: 0, height: h, borderRadius: 3, backgroundColor: bg });
  return col([
    row(Array.from({ length: 7 }, () => k(1, key)), { gap: 3 }),
    row(Array.from({ length: 7 }, () => k(1, key)), { gap: 3 }),
    row([k(1.2, side, 15), k(1, CLAY, 15), k(4, key, 15), k(1.4, side, 15)], { gap: 3 }),
  ], { gap: 4, backgroundColor: dark ? C.ink : C.surface, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 6 });
}

function lookCard(value: "light" | "dark", label: string, note: string): Node {
  return col([
    lookPreview(value === "dark"),
    row([text(label, { size: 14, weight: 600, lineHeight: 18 }), grow(), when({ eq: ["kb.look", value] }, meta("In use", { size: 12 })), when({ neq: ["kb.look", value] }, meta(note, { size: 12 }))], { paddingHorizontal: 2 }),
  ], {
    gap: 8, padding: 10, borderRadius: 18, borderWidth: 1.5, borderColor: whenEq("kb.look", value, CLAY, C.line), flexGrow: 1, flexBasis: 0, minWidth: 0,
  }, seq({ kind: "setState", path: "kb.look", value }, kbSave("look")));
}

/** A segmented control whose words need the room: less side padding in each segment. */
function tight(seg: Node): Node {
  return { ...seg, children: (seg.children ?? []).map((c) => ({ ...c, style: { ...(c.style ?? {}), paddingHorizontal: 4 } })) };
}

/** A label with a small segmented control on its right. */
function segRow(label: string, options: Array<{ label: string; value: string }>, path: string, onChange: ActionRef, width = 200): Node {
  return row([text(label, { size: 15, lineHeight: 20, style: { flexGrow: 1, flexShrink: 1 } }), box([segmented(options, path, { onChange })], { width, flexShrink: 0 })],
    { gap: 10, paddingVertical: 10, paddingLeft: 16, paddingRight: 12, minHeight: 52 });
}

function settingsPhone(ctx: BotsCtx, d: KeybotSettingsView | undefined) {
  if (!d) return page(ctx, { nav: "keybot", title: "Keyboard", gap: 14, body: [phoneHead("Keyboard"), couldntLoad("your keyboard")] });
  const langs = d.languages.map((l) => l.label).join(", ") || "Not set";
  return page(ctx, {
    nav: "keybot", title: "Keyboard", gap: 14, state: { kb: d.keyboard },
    body: [
      phoneHead("Keyboard"),
      col([sectionLabel("Look"), row([lookCard("light", "Light", "Bright keys"), lookCard("dark", "Dark", "Easy at night")], { gap: 10, alignItems: "stretch" })], { gap: 8 }),
      col([sectionLabel("Feel"), box([
        segRow("Haptics", [{ label: "Off", value: "off" }, { label: "Light", value: "light" }, { label: "Strong", value: "strong" }], "kb.haptics", kbSave("haptics")),
        divider(),
        segRow("Key height", [{ label: "Short", value: "short" }, { label: "Normal", value: "normal" }, { label: "Tall", value: "tall" }], "kb.height", kbSave("height"), 210),
        divider(),
        switchRow("Key sounds", "kb.sounds", { onChange: kbSave("sounds") }),
      ], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden" })], { gap: 8 }),
      listCard([
        listRow({ label: "Languages", value: langs, onPress: open(SCREENS.language) }),
        switchRow("Hold space to speak", "kb.holdSpace", { sub: "Same as holding the clay key", onChange: kbSave("holdSpace") }),
      ], { title: "Typing" }),
      col([sectionLabel("Keybot key"), card([
        tight(segmented([{ label: "Left of space", value: "left" }, { label: "Right of space", value: "right" }, { label: "Top row", value: "top" }], "kb.keyAt", { onChange: kbSave("keyAt") })),
        ...(["left", "right", "top"] as const).map((at) => when({ eq: ["kb.keyAt", at] }, phoneKeys(at, 0.9))),
      ], { gap: 10, padding: 12, radius: 18 })], { gap: 8 }),
    ],
  });
}

const COMMON_LANGS = [{ value: "en", label: "English" }, { value: "hi", label: "Hindi" }, { value: "hinglish", label: "Hinglish" }];

function settingsDesk(ctx: BotsCtx, d: KeybotSettingsView | undefined) {
  const cfg = (key: string): ActionSpec => ({ kind: "desktop.config", key, value: "$toggle" } as ActionSpec);
  const deskToggle = (label: string, key: string, sub: string) => row([
    col([text(label, { size: 14, lineHeight: 19 }), meta(sub, { size: 12 })], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    switchMark(`desktop.${key}`),
  ], { gap: 14, paddingVertical: 8, minHeight: 44 }, cfg(key));
  const chosen = new Set((d?.languages ?? []).map((l) => l.value));
  const langChips = [...(d?.languages ?? []), ...COMMON_LANGS.filter((l) => !chosen.has(l.value))].map((l) => chip(l.label, {
    selected: chosen.has(l.value),
    onPress: write("POST", "/v1/keybot/language", { value: l.value, on: !chosen.has(l.value) }, undefined, "Couldn't change your languages. Try again."),
  }));
  const pillPreview = col([
    box([], { height: 6, width: "70%", borderRadius: 3, backgroundColor: C.track }),
    row([box([], { height: 6, width: "34%", borderRadius: 3, backgroundColor: C.track }), box([], { width: 1.5, height: 12, backgroundColor: C.ink })], { gap: 2 }),
    row([
      box([icon("mic", { size: 10, color: C.paper })], { width: 16, height: 16, borderRadius: 8, backgroundColor: CLAY, alignItems: "center", justifyContent: "center" }),
      row([4, 8, 5, 10, 6, 3, 7].map((h) => box([], { width: 2, height: h, borderRadius: 1, backgroundColor: CLAY })), { gap: 2 }),
      text("kal 7 baje", { size: 11, lineHeight: 14 }),
    ], { gap: 6, alignSelf: "flex-start", backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingVertical: 4, paddingLeft: 4, paddingRight: 10 }),
  ], { gap: 6, backgroundColor: C.surface, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 });
  return page(ctx, {
    nav: "keybot", title: "Keyboard", gap: 18, maxWidth: DESK_WIDTH,
    body: [
      deskHead("Keyboard", "How Keybot listens and shows up on this computer."),
      twoCols([
        deskCard("Shortcut", [
          row([text("Keybot key", { size: 14, lineHeight: 19 }), grow(),
            when({ truthy: "desktop.hold" }, kbd("Fn", "desktop.holdKey")), when({ falsy: "desktop.hold" }, kbd("Ctrl+Space", "desktop.hotkey"))], { gap: 12, minHeight: 32 }),
          laptopKeys(),
          keyList(),
          divider(),
          deskToggle("Tap twice to keep listening", "tap", "Hands free. Tap the key again to stop."),
          row([meta("Change these keys in Settings.", { size: 12 }), grow(),
            quietButton("Open Settings", open(ctx.desk.pages ? "desk_settings" : "settings"), { size: "md" })], { gap: 8 }),
        ]),
        deskCard("Languages", d ? [
          row([...langChips, row([text("+ Add a language", { size: 13, color: C.meta, lineHeight: 17 })], {
            paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: C.outline, borderStyle: "dashed",
          }, open(SCREENS.language))], { gap: 6, flexWrap: "wrap", paddingTop: 2, paddingBottom: 4 }),
          meta("Keybot hears and writes these, and switches mid-sentence, like you do.", { size: 12 }),
        ] : [couldntLoad("your languages")]),
      ], [
        deskCard("Pill", [
          pillPreview,
          deskToggle("Show the pill", "pill", "By your text cursor while Keybot listens"),
          deskToggle("Show the words as I speak", "live", "A line of what it heard, as you say it"),
        ]),
        deskCard("Listening", [
          deskToggle("Write while I pause", "pauseFlush", "Each pause puts in what you said so far"),
        ]),
      ], { gap: 14 }),
    ],
  });
}

// ===================================================================== the list

const load = <T>(path: string) => (ctx: BotsCtx, deps: { api: <R>(m: "GET", p: string) => Promise<R> }) => {
  const tz = `tz=${ctx.tzOffsetMinutes}`;
  return deps.api<T>("GET", path.includes("?") ? `${path}&${tz}` : `${path}?${tz}`);
};
const withQ = (base: string) => (ctx: BotsCtx) => (ctx.params.q ? `${base}?q=${encodeURIComponent(String(ctx.params.q))}` : base);
const both = <D>(phone: (c: BotsCtx, d: D | undefined) => ReturnType<typeof page>, desk: (c: BotsCtx, d: D | undefined) => ReturnType<typeof page>) =>
  (ctx: BotsCtx, d: D | undefined) => (ctx.client === "desktop" ? desk(ctx, d) : phone(ctx, d));

export const keybotScreens: BotsScreen[] = [
  screen<KeybotHomeView>({ id: SCREENS.keybot, load: load<KeybotHomeView>("/v1/keybot"), build: both(keybotPhone, keybotDesk) }),
  screen<KeybotToneView>({ id: SCREENS.keyTone, load: load<KeybotToneView>("/v1/keybot/tone"), build: both(tonePhone, toneDesk) }),
  screen<KeybotWordsView>({ id: SCREENS.keyWords, load: (ctx, deps) => load<KeybotWordsView>(withQ("/v1/keybot/words")(ctx))(ctx, deps), build: both(wordsPhone, wordsDesk) }),
  screen<KeybotVoicesView>({ id: SCREENS.keyVoices, load: load<KeybotVoicesView>("/v1/keybot/voices"), build: both(voicesPhone, voicesDesk) }),
  screen<KeybotTrainView>({ id: SCREENS.keyTrain, load: load<KeybotTrainView>("/v1/keybot/train"), build: both(trainPhone, trainDesk) }),
  screen<KeybotHistoryView>({ id: SCREENS.keyHistory, load: (ctx, deps) => load<KeybotHistoryView>(withQ("/v1/keybot/history")(ctx))(ctx, deps), build: both(historyPhone, historyDesk) }),
  screen<KeybotSettingsView>({ id: SCREENS.keySettings, load: load<KeybotSettingsView>("/v1/keybot/settings"), build: both(settingsPhone, settingsDesk) }),
];

