/**
 * The Keybot's words screen, on the phone and in the window (wordsPhone, wordsDesk).
 */

import type { ActionSpec, Condition, Node } from "../../../../../../shared/types/sdui.js";
import type { KeybotWordsView } from "../../../../keybot/views.js";
import {
  row, text, C, call, seq, box, button, quietButton, whenEq, card, meta, meter, sectionLabel, col, type BotsCtx, page, when, divider,
  SCREENS, emptyState, primaryButton, grow,
} from "../../kit.js";
import {
  plural, write, toast, oops, field, n, sectionHead, CLAY, hbars, statRow, glyph, phoneHead, couldntLoad, searchField, searchLine,
  deskHead, DESK_WIDTH, dayLabel, twoCols,
} from "../keybotParts.js";

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

/** Adding a word: Enter or Add saves it (POST /v1/words), and Keylessbord spells it that way from then on. */
const addWord: ActionSpec = {
  kind: "condition", if: { falsy: "newWord" }, then: toast("Type the word first"),
  else: call("POST", "/v1/words", { add: "$state.newWord" }, {
    ok: seq({ kind: "clearState", path: "newWord" }, { kind: "setState", path: "adding", value: false }, toast("Added. Keylessbord spells it your way now."), { kind: "refresh" }),
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

/**
 * How the saved words do (the old Stats tab's Dictionary card): the share that turned up this month, the most used,
 * the list's counts, and the ones never heard, named so they can be pruned or spelled the way they are said.
 */
function wordUse(d: KeybotWordsView): Node | null {
  const u = d.use;
  if (!u || !u.saved) return null;
  return card([
    sectionHead("Your words at work · this month"),
    row([text(`${u.inUse}%`, { size: 26, weight: 700, tracking: -0.5, lineHeight: 32 }), meta(`in use · ${n(u.used)} of ${n(u.saved)} saved words turned up`, { size: 13, style: { flexShrink: 1 } })], { gap: 8, alignItems: "flex-end", flexWrap: "wrap" }),
    meter(u.used, u.saved, { color: CLAY }),
    ...(u.top.length ? [sectionLabel("Most used"), hbars(u.top.slice(0, 5).map((w) => ({ label: w.word, value: w.uses, text: `${n(w.uses)}×` })))] : []),
    col([
      statRow("Saved", n(u.saved)), statRow("Used", n(u.used)), statRow("Never used", n(u.unused)), statRow("What you said, read for them", n(u.scanned)),
    ]),
    ...(u.unusedWords.length ? [col([sectionLabel("Never turned up"), text(u.unusedWords.join(", "), { size: 13, color: C.grey70, lineHeight: 18 })], { gap: 6 })] : []),
  ], { gap: 10, radius: 18 });
}

/** A spelling: when Keylessbord hears this, it writes that (the old Dictionary's pairs). The whole list goes back, with the new one. */
function addSpelling(d: KeybotWordsView): ActionSpec {
  return {
    kind: "condition", if: { any: [{ falsy: "heard" }, { falsy: "writeAs" }] }, then: toast("Say what it hears, and how to write it"),
    else: call("PUT", "/v1/profile", { dictionary: [...d.pairs, { word: "$state.heard", replacement: "$state.writeAs" }] }, {
      ok: seq({ kind: "clearState", path: "heard" }, { kind: "clearState", path: "writeAs" }, toast("Added. Keylessbord writes it your way now."), { kind: "refresh" }),
      fail: oops("Couldn't add that spelling. Try again."),
    }),
  };
}

/** Spellings: what it hears, what it writes; the pairs already kept are in the list above, as Spelling. */
function spellingsCard(d: KeybotWordsView): Node {
  return card([
    sectionHead("Spellings"),
    meta("When Keylessbord hears one thing, it writes another: a name it mishears, a short form you want written out.", { size: 13, lineHeight: 18 }),
    field("heard", "When I say, like “sarvari”", { label: "When I say" }),
    field("writeAs", "Write it as, like “Sharvari”", { label: "Write it as", onSubmit: addSpelling(d) }),
    button("Add the spelling", addSpelling(d), { kind: "secondary", size: "md" }),
  ], { gap: 10, radius: 18 });
}

const addShortcut: ActionSpec = {
  kind: "condition", if: { any: [{ falsy: "say" }, { falsy: "get" }] }, then: toast("Give it a name and what it writes"),
  else: call("POST", "/v1/snippets", { say: "$state.say", get: "$state.get" }, {
    ok: seq({ kind: "clearState", path: "say" }, { kind: "clearState", path: "get" }, toast("Added. Say its name and the whole thing is written."), { kind: "refresh" }),
    fail: oops("Couldn't add that shortcut. Try again."),
  }),
};

/** Shortcuts (the desk's Words page, "Said short, written long"): say a name, the whole thing is written. */
function shortcutsCard(d: KeybotWordsView): Node {
  const one = (x: { say: string; get: string }): Node => row([
    col([text(x.say, { size: 14, weight: 600, lineHeight: 19, lines: 1 }), meta(x.get, { size: 12, lines: 2 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
    box([glyph("forget", { size: 18, color: C.grey70, label: `Remove ${x.say}` })], { width: 44, height: 44, alignItems: "center", justifyContent: "center", flexShrink: 0 },
      write("POST", "/v1/snippets", { remove: x.say }, `Removed “${x.say}”`, "Couldn't remove that shortcut. Try again.")),
  ], { gap: 8, minHeight: 48 });
  return card([
    sectionHead(d.snippets.length ? `Shortcuts · ${n(d.snippets.length)}` : "Shortcuts"),
    meta("Say a shortcut's name and the whole thing is written: an address, a UPI id, a sign-off you type every day.", { size: 13, lineHeight: 18 }),
    ...(d.snippets.length ? [col(d.snippets.slice(0, 40).map(one))] : []),
    field("say", "Its name, like “my upi”", { label: "Shortcut name" }),
    field("get", "What it writes", { label: "What it writes", onSubmit: addShortcut }),
    button("Add the shortcut", addShortcut, { kind: "secondary", size: "md" }),
  ], { gap: 10, radius: 18 });
}

const WORDS_STATE = { heard: "", writeAs: "", say: "", get: "" };

export function wordsPhone(ctx: BotsCtx, d: KeybotWordsView | undefined) {
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
    nav: "keybot", title: "Your words", gap: 14, state: { q, filter: "all", sel: "", adding: false, newWord: "", ...WORDS_STATE },
    body: [
      phoneHead("Your words"),
      col([text(plural(total, "word", "words"), { size: 34, weight: 700, tracking: -0.8, lineHeight: 40 }),
        meta(`Keylessbord knows now · ${n(d.total.learned)} learned from you`, { size: 13 })], { gap: 2 }),
      searchField(SCREENS.keyWords, "Search names, places, work words"),
      ...(q ? [searchLine(SCREENS.keyWords, q)] : []),
      ...(total ? [wordsChips(d)] : []),
      ...(!total
        ? [emptyState({ pose: "hello", title: "No words yet", body: "Names, places, the words only your team uses. Add one and Keylessbord spells it your way, everywhere." })]
        : !rows.length ? [meta("No word matches that. Try fewer letters.", { size: 14 })]
        : [section("added", "Added by you"), section("learned", "Learned from you")]),
      ...(wordUse(d) ? [wordUse(d)!] : []),
      spellingsCard(d),
      shortcutsCard(d),
    ],
    footer: [
      when({ falsy: "adding" }, primaryButton("Add a word", { kind: "setState", path: "adding", value: true }, { icon: "plus", wide: true })),
      when({ truthy: "adding" }, addRow()),
    ],
  });
}

export function wordsDesk(ctx: BotsCtx, d: KeybotWordsView | undefined) {
  const q = String(ctx.params.q ?? "");
  const head = deskHead("Your words", d ? `${plural(d.total.added + d.total.learned, "word", "words")} Keylessbord knows now · ${n(d.total.learned)} learned from you` : "The words Keylessbord spells your way",
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
      ...(r.was ? [divider(), row([meta("Keylessbord writes it as", { size: 13 }), grow(), text(r.word, { size: 13, weight: 600, lineHeight: 17 })], { gap: 10, paddingVertical: 8 })] : []),
    ]),
    ...(r.recent ? [col([meta("Recently said", { size: 13 }), col([
      text(`“${r.recent.text}”`, { size: 13, lineHeight: 18, lines: 3 }),
      meta(`${dayLabel(ctx, Date.parse(r.recent.at))} · ${r.recent.app}`, { size: 12 }),
    ], { gap: 2, backgroundColor: C.surface, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 })], { gap: 6 })] : []),
    row([button("Forget it", r.forget, { kind: "secondary", size: "md" })], { gap: 8 }),
  ], { gap: 12 }));
  return page(ctx, {
    nav: "keybot", title: "Your words", gap: 18, maxWidth: DESK_WIDTH,
    state: { q, filter: "all", sel: rows[0]?.key ?? "", adding: false, newWord: "", ...WORDS_STATE },
    body: [
      head,
      when({ truthy: "adding" }, card([addRow()], { padding: 12, radius: 18 })),
      row([box([searchField(SCREENS.keyWords, "Search your words")], { flexGrow: 1, flexShrink: 1, flexBasis: 300, minWidth: 220 }), wordsChips(d)], { gap: 8, flexWrap: "wrap" }),
      ...(q ? [searchLine(SCREENS.keyWords, q)] : []),
      !rows.length
        ? (d.total.added + d.total.learned
          ? meta("No word matches that. Try fewer letters.", { size: 14 })
          : emptyState({ pose: "hello", title: "No words yet", body: "Names, places, the words only your team uses. Add one and Keylessbord spells it your way, everywhere.", action: { label: "Add a word", onPress: { kind: "setState", path: "adding", value: true } } }))
        : twoCols([
          box([headRow, divider(), ...group("added", "Added by you"), ...group("learned", "Learned from you")], { borderRadius: 18, borderWidth: 1, borderColor: C.line, overflow: "hidden", paddingBottom: 6 }),
        ], [
          card(rows.map(panel), { radius: 18, gap: 0 }),
        ], { leftWeight: 2.6, rightWeight: 1, gap: 16 }),
      twoCols([...(wordUse(d) ? [wordUse(d)!] : []), spellingsCard(d)], [shortcutsCard(d)], { gap: 16 }),
    ],
  });
}
