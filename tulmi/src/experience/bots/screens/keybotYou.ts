/**
 * THE OLD YOU TAB'S PAGES THAT KEYBOT HAD NO PAGE FOR, in Keybot's look, for the phone and the window. Each reads
 * GET /v1/personality and writes through the routes the old screens used (docs/bots-keybot-parity.md).
 *
 *   bots.keybot.style    Voice (the old Voice card and "voices" screen, the desk's Voices page): Zu, the voices on
 *                        the keyboard and the rest, each writing the same said line for Chats, Work, Email or Other;
 *                        write as one (PUT /v1/personality), put it on the keyboard or take it off (POST
 *                        /v1/personality/pin), edit, reset, delete or make one (POST /v1/personality/tone)
 *   bots.keybot.haptics  Haptics (the old Buzz card and "haptics" screen): every key, asking first when keys were
 *                        picked by hand, and the keys picked one by one (POST /v1/personality/haptics)
 *   bots.keybot.name     What you call it (the old "assistant_name" screen, the desk's): Tailzu, and a name of
 *                        your own (PUT /v1/personality { assistantName })
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../shared/types/sdui.js";
import type { Personality } from "../../../../../shared/types/api.js";
import { applyPresetOverrides, MAX_PINNED_PRESETS, PERSONALITY_PRESETS, type PersonalityPreset } from "../../personalityPresets.js";
import { DESK_CONTEXTS, DESK_SAMPLES } from "../../deskSamples.js";
import { nicknameOf } from "../../assistantName.js";
import {
  box, button, C, call, card, chips, col, grow, meta, page, primaryButton, quietButton, row, sectionLabel, segmented, seq, SCREENS,
  statusMark, switchMark, text, when, type BotsCtx,
} from "../kit.js";
import { screen, type BotsScreen } from "../registry.js";
import {
  CLAY, couldntLoad, deskHead, DESK_WIDTH, field, oops, phoneHead, plural, sectionHead, toast, twoCols, write,
} from "./keybotParts.js";

interface PersonalityRead { personality: Personality }
const readPersonality = (_ctx: BotsCtx, deps: { api: <T>(m: "GET", p: string) => Promise<T> }) => deps.api<PersonalityRead>("GET", "/v1/personality");

/** A page for both clients: the phone stacks it, the window puts `right` beside `left`. */
function youPage(ctx: BotsCtx, o: { title: string; sub: string; left: Node[]; right?: Node[]; state?: Record<string, unknown>; footer?: Node[] }) {
  if (ctx.client === "desktop") {
    return page(ctx, {
      nav: "keybot", title: o.title, gap: 18, maxWidth: DESK_WIDTH, state: o.state,
      body: [deskHead(o.title, o.sub), ...(o.right?.length ? [twoCols(o.left, o.right, { gap: 16 })] : o.left), ...(o.footer ?? [])],
    });
  }
  return page(ctx, {
    nav: "keybot", title: o.title, gap: 14, state: o.state,
    body: [phoneHead(o.title), meta(o.sub, { size: 13, lineHeight: 18 }), ...o.left, ...(o.right ?? [])],
    ...(o.footer?.length ? { footer: o.footer } : {}),
  });
}

const refresh: ActionSpec = { kind: "refresh" };

// ===================================================================== bots.keybot.style

const ZU = "signature";
const BUILT_IN = new Set(PERSONALITY_PRESETS.map((p) => p.id));

/** The one line, written by this voice for the kind of writing chosen above (or what it was told, for a voice of yours). */
function samples(v: PersonalityPreset): Node[] {
  const set = DESK_SAMPLES[v.id];
  if (!set) {
    const own = (v.promptStyle || v.tagline || "").trim();
    return own ? [meta(own.length > 140 ? `${own.slice(0, 137)}…` : own, { size: 13, lineHeight: 18 })] : [];
  }
  return DESK_CONTEXTS.map((c) => when({ eq: ["vctx", c.id] }, box([text(set[c.id], { size: 14, lineHeight: 20 })],
    { backgroundColor: C.surface, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 })));
}

/** Write as this voice: it and its tone become what Keybot writes with. */
const activate = (v: PersonalityPreset): ActionSpec => call("PUT", "/v1/personality",
  { activePresetId: v.id, ...(v.defaultTone ? { activeTone: v.defaultTone } : {}) },
  { ok: seq(toast(`Writing as ${v.name}.`), refresh), fail: oops("Couldn't switch voices. Try again.") });

const pin = (v: PersonalityPreset, on: boolean): ActionSpec => write("POST", "/v1/personality/pin", { presetId: v.id, pinned: on },
  on ? `${v.name} is on your keyboard` : `${v.name} is off your keyboard`, "Couldn't change the keyboard's voices. Try again.");

/** The editor, under the voice being edited (or at the top, for a new one): its name and how it writes. */
function editor(v: PersonalityPreset | null): Node {
  const saveIt: ActionSpec = {
    kind: "condition", if: { any: [{ truthy: "vcName" }, { truthy: "vcPrompt" }] },
    then: call("POST", "/v1/personality/tone", { id: "$state.vcId", name: "$state.vcName", promptStyle: "$state.vcPrompt" }, {
      ok: seq({ kind: "setState", path: "edit", value: "" }, toast("Voice saved. Keybot writes in it now."), refresh), fail: oops("Couldn't save that voice. Try again."),
    }),
    else: toast("Give it a name, or say how it writes"),
  };
  const remove = v ? write("POST", "/v1/personality/tone", { id: v.id, remove: true },
    BUILT_IN.has(v.id) ? `${v.name} is back to how it was` : `${v.name} is deleted`, "Couldn't do that. Try again.") : undefined;
  return col([
    sectionLabel(v ? `Edit ${v.name}` : "A new voice"),
    field("vcName", "Its name", { label: "Voice name" }),
    field("vcPrompt", "How it writes: short, warm, no filler…", { label: "How it writes", multiline: true, height: 96 }),
    row([
      button("Save", saveIt, { size: "md" }),
      quietButton("Cancel", { kind: "setState", path: "edit", value: "" }, { size: "md" }),
      grow(),
      ...(v && remove ? [quietButton(BUILT_IN.has(v.id) ? "Reset" : "Delete", remove, { size: "md" })] : []),
    ], { gap: 8, flexWrap: "wrap" }),
  ], { gap: 10, paddingTop: 4 });
}

function voiceCard(v: PersonalityPreset, o: { active: boolean; pinned: boolean; full: boolean }): Node {
  const self = v.id === ZU;
  const edit: ActionRef = seq(
    { kind: "setState", path: "edit", value: v.id }, { kind: "setState", path: "vcId", value: v.id },
    { kind: "setState", path: "vcName", value: v.name }, { kind: "setState", path: "vcPrompt", value: v.promptStyle ?? "" },
  );
  return card([
    row([
      col([text(v.name, { size: 16, weight: 600, lineHeight: 21, lines: 1 }), ...(v.tagline ? [meta(v.tagline, { size: 12, lines: 2 })] : [])], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      ...(o.active ? [row([statusMark("working", { color: CLAY, size: 8 }), text("Writing now", { size: 12, weight: 600, lineHeight: 16 })], { gap: 6, flexShrink: 0 })] : []),
    ], { gap: 10, alignItems: "flex-start" }),
    ...(self ? [meta("It asserts nothing, and gets more like you the more you write.", { size: 12, lineHeight: 17 })] : []),
    ...samples(v),
    row([
      ...(o.active ? [] : [button("Write as this", activate(v), { kind: "secondary", size: "md" })]),
      ...(self ? [] : [quietButton(o.pinned ? "Off the keyboard" : "On the keyboard", o.pinned || !o.full ? pin(v, !o.pinned) : toast(`The keyboard holds ${MAX_PINNED_PRESETS}. Take one off first.`), { size: "md" })]),
      ...(self ? [] : [quietButton("Edit", edit, { size: "md" })]),
    ], { gap: 4, flexWrap: "wrap" }),
    ...(self ? [] : [when({ eq: ["edit", v.id] }, editor(v))]),
  ], { gap: 10, radius: 18, ...(o.active ? { selected: CLAY } : {}) });
}

function stylePage(ctx: BotsCtx, d: PersonalityRead | undefined) {
  const title = "Voice", sub = "Same words, in the voice you choose.";
  const p = d?.personality;
  if (!p) return youPage(ctx, { title, sub, left: [couldntLoad("your voices")] });
  const presets = applyPresetOverrides(p.presetOverrides);
  const activeId = presets.some((x) => x.id === p.activePresetId) ? p.activePresetId! : ZU;
  const pinned = (Array.isArray(p.pinnedPresetIds) ? p.pinnedPresetIds : []).filter((id) => id !== ZU && presets.some((x) => x.id === id));
  const full = pinned.length >= MAX_PINNED_PRESETS;
  const self = presets.find((x) => x.id === ZU);
  const onKeyboard = pinned.map((id) => presets.find((x) => x.id === id)!).filter(Boolean);
  const rest = presets.filter((x) => x.id !== ZU && !pinned.includes(x.id));
  const card_ = (v: PersonalityPreset) => voiceCard(v, { active: v.id === activeId, pinned: pinned.includes(v.id), full });
  const make: ActionRef = seq(
    { kind: "setState", path: "edit", value: "new" }, { kind: "setState", path: "vcId", value: "" },
    { kind: "setState", path: "vcName", value: "" }, { kind: "setState", path: "vcPrompt", value: "" },
  );
  const said = DESK_CONTEXTS.map((c) => when({ eq: ["vctx", c.id] }, meta(`You said: “${c.said}”`, { size: 13, lineHeight: 18 })));
  const left: Node[] = [
    col([chips(DESK_CONTEXTS.map((c) => ({ label: c.label, value: c.id })), "vctx"), ...said], { gap: 10 }),
    ...(self ? [card_(self)] : []),
    col([sectionHead(`On your keyboard · ${onKeyboard.length} of ${MAX_PINNED_PRESETS}`),
      ...(onKeyboard.length ? onKeyboard.map(card_) : [meta("None yet. Put a voice on the keyboard to switch to it while you type.", { size: 13 })])], { gap: 10 }),
  ];
  const right: Node[] = [
    when({ eq: ["edit", "new"] }, card([editor(null)], { radius: 18, selected: CLAY })),
    col([sectionHead(`Every voice · ${plural(rest.length, "more", "more")}`), ...rest.map(card_)], { gap: 10 }),
  ];
  return youPage(ctx, {
    title, sub, left, right, state: { vctx: "chats", edit: "", vcId: "", vcName: "", vcPrompt: "" },
    footer: [when({ neq: ["edit", "new"] }, ctx.client === "desktop"
      ? row([button("Make a voice", make, { kind: "secondary", size: "md", icon: "plus" })])
      : primaryButton("Make a voice", make, { icon: "plus", wide: true }))],
  });
}

// ===================================================================== bots.keybot.haptics

type Key = { id: string; label: string; flex?: number; gap?: boolean };
const k = (id: string, label = id, flex = 1): Key => ({ id, label, flex });
const chars = (list: string[]): Key[] => list.map((c) => k(c));
const gapKey = (flex: number): Key => ({ id: "", label: "", flex, gap: true });
const bottom = (left: Key): Key[] => [{ ...left, flex: 1.6 }, k(".", ".", 1), k("space", "space", 4.2), k("@", "@", 1), k("return", "return", 1.8)];

/**
 * The keyboard's layers, as the keyboard has them (catalog.ts KB_ROW_*, which the keyboard itself is built from): the
 * letters, the numbers, the symbols, and Keybot's own keys. A key on two layers is on the first only, so a key picked
 * on one never looks unpicked on another; where it would repeat, its place stays empty at its own width.
 */
const LAYERS: Array<{ value: string; label: string; rows: Key[][] }> = (() => {
  const raw = [
    { value: "letters", label: "Letters", rows: [
      chars(["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"]),
      [gapKey(0.5), ...chars(["a", "s", "d", "f", "g", "h", "j", "k", "l"]), gapKey(0.5)],
      [k("shift", "shift", 1.5), ...chars(["z", "x", "c", "v", "b", "n", "m"]), k("backspace", "delete", 1.5)],
      bottom(k("123")),
    ] },
    { value: "numbers", label: "123", rows: [
      chars(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]),
      chars(["-", "/", ":", ";", "(", ")", "$", "&", "@", "\""]),
      [k("#+=", "#+=", 1.5), ...chars([".", ",", "?", "!", "'"]), k("backspace", "delete", 1.5)],
      bottom(k("abc", "ABC")),
    ] },
    { value: "symbols", label: "#+=", rows: [
      chars(["[", "]", "{", "}", "#", "%", "^", "*", "+", "="]),
      chars(["_", "\\", "|", "~", "<", ">", "€", "£", "¥", "·"]),
      [k("123", "123", 1.5), ...chars([".", ",", "?", "!", "'"]), k("backspace", "delete", 1.5)],
      bottom(k("abc", "ABC")),
    ] },
    { value: "keybot", label: "Keybot", rows: [[k("mic", "Mic"), k("refine", "Refine"), k("globe", "Globe")]] },
  ];
  const seen = new Set<string>();
  return raw.map((l) => ({ ...l, rows: l.rows.map((r) => r.map((key) => {
    if (key.gap || !key.id) return key;
    if (seen.has(key.id)) return gapKey(key.flex ?? 1);
    seen.add(key.id);
    return key;
  })) }));
})();

function keyCap(key: Key, picked: Set<string>): Node {
  if (key.gap) return box([], { flexGrow: key.flex ?? 1, flexBasis: 0, minWidth: 0, height: 42 });
  const lit = picked.has(key.id);
  // A word starting with "@" is a label key to the phone's renderer (it would draw nothing): "@" is shown from state.
  const at = key.label.startsWith("@");
  return box([text(at ? " " : key.label, {
    size: key.label.length > 2 ? 11 : 15, weight: 500, lineHeight: key.label.length > 2 ? 14 : 19, align: "center", lines: 1, ...(at ? { bind: "keyAt" } : {}),
    style: { color: { truthy: "all", then: C.paper, else: lit ? C.paper : C.ink } },
  })], {
    flexGrow: key.flex ?? 1, flexBasis: 0, minWidth: 0, height: 42, borderRadius: 8, alignItems: "center", justifyContent: "center",
    backgroundColor: { truthy: "all", then: CLAY, else: lit ? CLAY : C.paper }, borderWidth: 1, borderColor: { truthy: "all", then: CLAY, else: lit ? CLAY : C.line },
  }, write("POST", "/v1/personality/haptics", { key: key.id }, undefined, "Couldn't change that key. Try again."));
}

function hapticsPage(ctx: BotsCtx, d: PersonalityRead | undefined) {
  const title = "Haptics", sub = "A small buzz under your finger, on every key or the ones you pick.";
  const p = d?.personality;
  if (!p) return youPage(ctx, { title, sub, left: [couldntLoad("your keys")] });
  const picked = new Set((p.hapticKeys ?? []).map((x) => String(x).toLowerCase()));
  const saveAll: ActionRef = seq({ kind: "toggleState", path: "all" }, write("POST", "/v1/personality/haptics", { all: "$state.all" }, undefined, "Couldn't save that. Try again."));
  // Off, with keys picked by hand: ask first, as the old card did; those go quiet too.
  const onEvery: ActionRef = picked.size ? { kind: "condition", if: { truthy: "all" }, then: { kind: "setState", path: "askOff", value: true }, else: saveAll } : saveAll;
  const every = card([
    row([
      col([text("Every key", { size: 15, weight: 500, lineHeight: 20 }), meta(picked.size ? `${plural(picked.size, "key", "keys")} picked by hand` : "Or pick keys one by one below", { size: 12 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      switchMark("all"),
    ], { gap: 12, minHeight: 44 }, onEvery),
    when({ truthy: "askOff" }, col([
      text("Turn every key off?", { size: 15, weight: 600, lineHeight: 20 }),
      meta("The keys you picked by hand go quiet too. You can pick them again any time.", { size: 13, lineHeight: 18 }),
      row([
        button("Turn them all off", seq({ kind: "setState", path: "askOff", value: false }, { kind: "setState", path: "all", value: false },
          write("POST", "/v1/personality/haptics", { all: false, clear: true }, "Haptics off", "Couldn't save that. Try again.")), { kind: "secondary", size: "md" }),
        quietButton("Leave it", { kind: "setState", path: "askOff", value: false }, { size: "md" }),
      ], { gap: 8, flexWrap: "wrap" }),
    ], { gap: 8, paddingTop: 4 })),
  ], { gap: 8, radius: 18 });
  const board = col([
    segmented(LAYERS.map((l) => ({ label: l.label, value: l.value })), "layer"),
    ...LAYERS.map((l) => when({ eq: ["layer", l.value] }, col(l.rows.map((r) => row(r.map((key) => keyCap(key, picked)), { gap: 5 })),
      { gap: 7, backgroundColor: C.surface, borderRadius: 18, padding: 8 }))),
    meta("Tap a key to buzz on it, or tap it again to stop. Lit keys buzz.", { size: 12 }),
  ], { gap: 10 });
  return youPage(ctx, {
    title, sub, left: [every, col([sectionLabel("Pick keys one by one"), board], { gap: 8 })],
    state: { all: p.hapticsAll === true, askOff: false, layer: "letters", keyAt: "@" },
  });
}

// ===================================================================== bots.keybot.name

function namePage(ctx: BotsCtx, d: PersonalityRead | undefined) {
  const title = "What you call it";
  const p = d?.personality;
  if (!p) return youPage(ctx, { title, sub: "Tailzu, and a name of your own", left: [couldntLoad("its name")] });
  const nick = nicknameOf(p);
  const put = (name: string, done: string): ActionSpec => call("PUT", "/v1/personality", { assistantName: name }, {
    ok: seq(toast(done), refresh), fail: oops("A name is letters, spaces, ' and -, up to 24 characters."),
  });
  const saveIt: ActionSpec = { kind: "condition", if: { truthy: "name" }, then: put("$state.name", "Saved. Call it by either name."), else: toast("Type a name first") };
  return youPage(ctx, {
    title, sub: nick ? `Tailzu, or ${nick}` : "Tailzu",
    left: [
      text("Tailzu is its name, and always works. Give it a name of your own too, and call it either while you talk: “Zara, make it formal.”", { size: 15, color: C.grey70, lineHeight: 22 }),
      field("name", "A name of your own", { label: "A name of your own", onSubmit: saveIt }),
      row([
        ...(ctx.client === "desktop" ? [button("Save", saveIt, { size: "md" })] : []),
        ...(nick ? [quietButton("Tailzu only", put("", "It's Tailzu again"), { size: "md" })] : []),
      ], { gap: 8 }),
    ],
    state: { name: nick ?? "" },
    footer: ctx.client === "desktop" ? [] : [primaryButton("Save", saveIt, { wide: true })],
  });
}

// ===================================================================== the list

export const keybotYouScreens: BotsScreen[] = [
  screen<PersonalityRead>({ id: SCREENS.keyStyle, load: readPersonality, build: stylePage }),
  screen<PersonalityRead>({ id: SCREENS.keyHaptics, load: readPersonality, build: hapticsPage }),
  screen<PersonalityRead>({ id: SCREENS.keyName, load: readPersonality, build: namePage }),
];
