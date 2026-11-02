/**
 * The Keybot's history screen, on the phone and in the window (historyPhone, historyDesk).
 */

import type { HistoryEntry } from "../../../../../../shared/types/api.js";
import type { Condition, ActionSpec, Node, ActionRef } from "../../../../../../shared/types/sdui.js";
import { groupOfApp, TONE_GROUP_DEFS } from "../../../../keybot/tones.js";
import type { KeybotHistoryView } from "../../../../keybot/views.js";
import {
  type BotsCtx, call, seq, when, card, text, C, meta, col, button, quietButton, row, whenEq, emptyState, page, box, SCREENS, sectionLabel,
  grow, divider, icon,
} from "../../kit.js";
import {
  dayKey, dayLabel, toast, oops, write, phoneHead, couldntLoad, type Glyph, glyph, searchField, searchLine, plural, clock, deskHead,
  DESK_WIDTH, n,
} from "../keybotParts.js";
import { speakVerb } from "./parts.js";

// ===================================================================== bots.keybot.history
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
/** Forget a line: first ask why (the old History card did), so "doesn't sound like me" can teach the writer. */
const forgetLine = (e: HistoryEntry): ActionSpec => ({ kind: "setState", path: "askDelete", value: e.id });
const forgetFor = (reason: "not_me" | "cleanup"): ActionSpec =>
  call("DELETE", `/v1/history/$state.askDelete?reason=${reason}`, undefined, {
    ok: seq({ kind: "setState", path: "askDelete", value: false }, toast("Gone for good"), { kind: "refresh" }),
    fail: oops("Couldn't forget that. Try again."),
  });

/** Why should it go? Asked before a line is forgotten. Either way it is gone for good, and the writer stops learning from it. */
function whyCard(): Node {
  return when({ truthy: "askDelete" }, card([
    text("Forget this line", { size: 11, weight: 600, tracking: 0.4, upper: true, color: C.meta, lineHeight: 15 }),
    text("Why should it go?", { size: 20, weight: 700, tracking: -0.3, lineHeight: 26 }),
    meta("Either way it's gone for good, and X0 Bot stops learning from it.", { size: 13 }),
    col([
      button("It doesn't sound like me", forgetFor("not_me"), { size: "md" }),
      button("Just a clean-up", forgetFor("cleanup"), { kind: "secondary", size: "md" }),
      quietButton("Leave it", { kind: "setState", path: "askDelete", value: false }, { size: "md" }),
    ], { gap: 8 }),
  ], { gap: 8, padding: 16, radius: 18 }));
}

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

function historyEmpty(d: KeybotHistoryView, desk = false): Node {
  if (d.off) {
    return emptyState({ pose: "think", title: "Nothing is kept", body: "History is off, so what you say isn't saved anywhere. Turn it on to copy things you said before.",
      action: { label: "Keep what I say", onPress: write("PUT", "/v1/personality", { retainHistory: true }, "History is on") } });
  }
  if (d.q) return meta("Nothing you said matches that.", { size: 14 });
  return emptyState({ pose: "listen", title: "Nothing here yet", body: `${speakVerb(desk)} the Keylessbord key and speak in any app. What you said shows up here, to copy again.` });
}

export function historyPhone(ctx: BotsCtx, d: KeybotHistoryView | undefined) {
  const q = String(ctx.params.q ?? "");
  if (!d) return page(ctx, { nav: "keybot", title: "What you said", gap: 14, body: [phoneHead("What you said"), couldntLoad("what you said")] });
  const days = byDay(ctx, d.entries.slice(0, 80));
  const actionBtn = (g: Glyph, label: string, a: ActionRef) => box([glyph(g, { size: 18, color: C.grey70, label })], { width: 44, height: 44, alignItems: "center", justifyContent: "center", flexShrink: 0 }, a);
  return page(ctx, {
    nav: "keybot", title: "What you said", gap: 14, state: { q, app: "all", confirmClear: false, askDelete: false },
    body: [
      phoneHead("What you said"),
      searchField(SCREENS.keyHistory, "Search what you said"),
      ...(q ? [searchLine(SCREENS.keyHistory, q)] : []),
      ...(d.entries.length ? [historyChips()] : []),
      ...(!d.entries.length ? [historyEmpty(d, ctx.client === "desktop")] : days.map((g) => col([
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
      whyCard(),
      clearConfirm(),
      row([
        icon("lock", { size: 16, color: C.grey70 }),
        text("Kept with your account until you clear it.", { size: 13, color: C.grey70, lineHeight: 17, style: { flexGrow: 1, flexShrink: 1 } }),
        box([text("Clear now", { size: 13, weight: 600, lineHeight: 17 })], { minHeight: 40, paddingHorizontal: 10, justifyContent: "center" }, { kind: "setState", path: "confirmClear", value: true }),
      ], { gap: 10, backgroundColor: C.surface, borderRadius: 18, paddingVertical: 4, paddingLeft: 14, paddingRight: 6 }),
    ],
  });
}

export function historyDesk(ctx: BotsCtx, d: KeybotHistoryView | undefined) {
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
    nav: "keybot", title: "What you said", gap: 18, maxWidth: DESK_WIDTH, state: { q, app: "all", confirmClear: false, askDelete: false },
    body: [
      head,
      whyCard(),
      clearConfirm(),
      row([box([searchField(SCREENS.keyHistory, "Search what you said")], { flexGrow: 1, flexShrink: 1, flexBasis: 300, minWidth: 220 }), ...(d.entries.length ? [historyChips()] : [])], { gap: 8, flexWrap: "wrap" }),
      ...(q ? [searchLine(SCREENS.keyHistory, q)] : []),
      ...(!d.entries.length ? [historyEmpty(d, ctx.client === "desktop")] : [
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
