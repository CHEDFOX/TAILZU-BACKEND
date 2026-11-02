/**
 * The You tab's assistant card: Ask in a card, the next tasks, the apps, and the last runs.
 */

import type { AssistantTask } from "../../../../shared/types/api.js";
import type { Node, ActionSpec, ActionRef, Condition } from "../../../../shared/types/sdui.js";
import type { ActivityItem } from "../../connectors/list.js";
import { en, isHinglish } from "../../connectors/words.js";
import { receiptLine } from "../../runs/index.js";
import { PHONE_LOOK, label, t } from "../phoneLook.js";
import { sw, SW } from "../settingsWords.js";
import { NEON, neonDot } from "../touches.js";
import { PAPER, askExamples, askParts, askAction } from "./ask.js";
import { type You, type Style, seq, haptic, word, TASKS, mark, customApp, lastStep, fromState, GAP, setState } from "./kit.js";
import type { AssistantScreenCtx } from "./screens.js";

// ---------------------------------------------------------------------------
// The You tab's card: hand a task over, and see what is coming up
// ---------------------------------------------------------------------------

/** Rows in "Coming up", and logos in the card's foot. */
const UP_ROWS = 3;
const UP_APPS = 5;
/** Rows in Activity. */
const ACT_ROWS = 5;

/**
 * The next tasks, as the You tab shows them: what waits for the person's OK
 * first, then what is running, then the latest one done. At most three.
 */
export function comingUp(tasks: readonly AssistantTask[]): AssistantTask[] {
  const waiting = tasks.filter((x) => x.state === "waiting" && x.approval);
  const running = tasks.filter((x) => x.state === "running");
  const done = tasks.filter((x) => x.state === "done").sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return [...waiting, ...running, ...(done ? [done] : [])].slice(0, UP_ROWS);
}

/** The assistant's pages, in the cream ink the You tab's cards are set in. */
/** The assistant's pages on the card's paper, in its ink. */
const paperUi = (ui: You): You => ({
  ...ui, text: PAPER.ink, textDim: PAPER.ink2, textFaint: PAPER.muted, onAccent: PAPER.surf,
  pill: { ...ui.pill, background: PAPER.surf },
});

/** The gap between the task card and the card of what is coming up, and between that and Activity. */
const YOU_CARDS_GAP = 14;
/** Activity's marks in a circle: a question waiting for their answer, and a run that did not finish. */
const CIRCLE = "M12 3 A9 9 0 1 1 12 21 A9 9 0 1 1 12 3 Z";
const ASKED = `${CIRCLE} M9.6 9.4 A2.5 2.5 0 1 1 13.2 11.6 C12.4 12.1 12 12.6 12 13.6 M12 16.8 L12 16.9`;
const FAILED = `${CIRCLE} M12 7.6 L12 13 M12 16.4 L12 16.5`;

const cream = (ui: You): You => ({
  ...ui, text: PHONE_LOOK.ink, textDim: PHONE_LOOK.ink2, textFaint: PHONE_LOOK.ink3,
  pill: { ...ui.pill, background: PHONE_LOOK.track },
});

/** A small arrow that says a line goes somewhere. */
const goes = (ui: You): Node => ({
  type: "SVG",
  props: { viewBox: "0 0 24 24", d: "M9 5 L16 12 L9 19", fill: "none", stroke: ui.textDim, strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" },
  style: { width: 11, height: 11 },
});

/** A line you press that goes to another page, with the arrow after it. */
const link = (ui: You, text: string, screenId: string, style: Style = {}): Node => ({
  type: "Stack",
  on: { onPress: seq(haptic("selection"), { kind: "navigate", screenId }) },
  props: { pressOpacity: 0.6, hitSlop: 10 },
  style: { flexDirection: "row", alignItems: "center", gap: 6, ...style },
  children: [word(text, "uiMedium", 13, { color: ui.text }), goes(ui)],
});

/**
 * HAND IT TO ME: a card on the You tab, only while connected apps are on.
 *
 * It does what Ask does, from the tab: a field, the mic, Do it (the very
 * actions assistant_ask runs, built by the same code), and a few examples
 * to tap. Under them, Coming up, the person's next three tasks (the same
 * data as Tasks), and in the foot the apps that are connected and a way to
 * add more. No Blip: the greeting above has the one this tab gets.
 *
 * Everything the person or an app wrote (a task's title, its step, an app's
 * letter) is drawn from this card's state, never from a node, as on Tasks.
 * A read of the assistant that failed leaves the card without Coming up (it
 * would say "Nothing" about a list that was never read), and the rest works.
 *
 * ACTIVITY, a third card under it, while there is anything to show: the
 * person's last runs (connectors/list.ts activityOf, from the run ledger),
 * what waits for them first, then what is running, then the newest that
 * ended, at most five, and none whose task Coming up already shows. Each says
 * how it ended in one line in their voice (src/runs receiptLine): "Done.",
 * "You said no.", "This stopped before it finished.". A card still waiting
 * opens the confirm sheet, as Coming up's do; a run that failed having
 * changed nothing has Try again, which puts their words back in the field
 * above and runs the card's own Do it, once: not while an ask is on its way,
 * and the pill goes once pressed. A desktop run's row says where it ran, as
 * its words are not kept. It is made of what the store build already draws
 * (tests/store-audit.ts), so it needs no capability to be sent.
 */
export function youCard(
  ctx: AssistantScreenCtx, base: You, o: { marginBottom?: number } = {},
): { node: Node; state: Record<string, unknown>; roams: boolean } | null {
  if (!ctx.connectorsOn) return null;
  const ui = cream(base);
  const names = ctx.assistant?.names ?? {};
  const apps = ctx.assistant?.apps;
  const tasks = ctx.assistant?.tasks;
  const examples = askExamples(ctx.language);
  const rows: Array<{ title: string; sub: string }> = [];
  const ini: Record<string, string> = {};
  const letter = (name: string): string => name.trim().charAt(0).toUpperCase() || "?";

  const toTasks: ActionSpec = { kind: "navigate", screenId: TASKS };
  const open = (x: AssistantTask): ActionSpec => ({ kind: "navigate", screenId: "assistant_approve", params: { taskId: x.id } });

  const box: Style = { width: 34, height: 34, alignItems: "center", justifyContent: "center" };
  /** A mark drawn with the pen, in a row's 34-point box. */
  const glyph = (d: string, stroke: string, width = 2.8, size = 20): Node => ({
    type: "Stack", style: box,
    children: [{
      type: "SVG",
      props: { viewBox: "0 0 24 24", d, fill: "none", stroke, strokeWidth: width, strokeLinecap: "round", strokeLinejoin: "round" },
      style: { width: size, height: size },
    }],
  });
  // Done: a neon tick, which is what neon is for here.
  const tick = (): Node => glyph("M5 12.5 L10 17.5 L19 7", NEON);
  // Running: the dot Tasks draws for it.
  const dot = (): Node => ({
    type: "Stack", style: box,
    children: [{ type: "Stack", style: { width: 10, height: 10, borderRadius: 5, backgroundColor: ui.textDim } }],
  });
  /** A waiting card's app: its logo, or its letter from state. */
  const appMark = (id: string): Node => {
    ini[id] = letter(names[id] ?? id);
    return mark(ui, id, 34, customApp(ctx, id));
  };
  /** A row's line of text, kept to one line. */
  const line = (n: Node): Node => ({ ...n, props: { ...n.props, numberOfLines: 1 } });
  /** The small outlined pill at a row's end: Needs your OK, Try again. */
  const rowPill = (text: string, onPress: ActionRef): Node => ({
    type: "Stack",
    on: { onPress },
    props: { pressOpacity: 0.7 },
    style: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: "rgba(243,226,198,0.5)" },
    children: [word(text, "uiMedium", 12, { color: ui.text })],
  });

  const status = (x: AssistantTask): Node =>
    x.state === "waiting" ? appMark(x.approval!.connector) : x.state === "done" ? tick() : dot();

  const rowOf = (x: AssistantTask, i: number): Node => {
    const waits = x.state === "waiting";
    rows.push({ title: x.title, sub: waits ? names[x.approval!.connector] ?? x.approval!.connector : lastStep(x) });
    return {
      type: "Stack",
      on: { onPress: seq(haptic("selection"), waits ? open(x) : toTasks) },
      props: { pressOpacity: 0.7 },
      style: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingLeft: 10, paddingRight: 12, borderRadius: 16, backgroundColor: PHONE_LOOK.track },
      children: [
        status(x),
        { type: "Stack", style: { flex: 1, gap: 2 }, children: [
          line(fromState(`up.${i}.title`, "uiMedium", 14.5, { color: ui.text })),
          line(fromState(`up.${i}.sub`, "ui", 12, { color: ui.textDim })),
        ] },
        ...(waits ? [rowPill(sw("y.ok"), seq(haptic("selection"), open(x)))] : []),
      ],
    };
  };

  const next = tasks ? comingUp(tasks) : undefined;
  const comingSection: Node[] = next ? [
    {
      type: "Stack", style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
      children: [label(sw("y.up")), link(ui, sw("y.all"), TASKS)],
    },
    next.length
      ? { type: "Stack", style: { gap: 8 }, children: next.map(rowOf) }
      : {
          type: "Stack", style: { padding: 14, borderRadius: 16, backgroundColor: PHONE_LOOK.track },
          children: [t(sw("y.none"), "ui", 14.5, { lineHeight: 21, color: ui.textDim })],
        },
  ] : [];

  // The foot: the apps that are connected (their logos or letters), and the way to more.
  const shown = (apps ?? []).filter((a) => a.connected).slice(0, UP_APPS);
  for (const a of shown) ini[a.id] = letter(a.name);
  const foot: Node = {
    type: "Stack",
    style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    children: [
      {
        type: "Stack", style: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
        children: shown.length ? [
          // Connected: neon, once, before the logos.
          { type: "Stack", style: { marginRight: 4 }, children: [neonDot(7)] },
          ...shown.map((a) => mark(ui, a.id, 28, a.custom)),
        ] : [],
      },
      link(ui, sw("y.more"), "assistant_apps"),
    ],
  };

  // ---- the task, handed over: on the onboarding's paper ----------------------------
  // Blip is not in the card: he walks its top edge (BlipRoam: sneaking,
  // peeking over it, jumping in), from a bundle that has him; an older one
  // keeps the waving picture by the greeting. The card says his line under
  // its heading, in his hand, and "On it…" while it works.
  const p = paperUi(base);
  const roams = ctx.can?.has("BlipRoam") === true;
  const says = (text: string, when: Condition): Node => ({
    ...t(text, "hand", 19, { lineHeight: 23, color: PAPER.ink2 }), props: { content: text, keepCase: true }, visibleIf: when,
  });
  const handCard: Node = {
    type: "Stack",
    // keepCase: the words are set as written; the phone capitalises its own (word).
    props: { keepCase: true },
    style: { borderRadius: 24, paddingTop: 16, paddingHorizontal: 18, paddingBottom: 18, backgroundColor: PAPER.ground },
    children: [
      word(sw("y.h"), "grotesk", 26, { letterSpacing: -0.6, color: PAPER.ink, marginTop: 4 }),
      { type: "Stack", style: { marginTop: 4, marginBottom: 14 }, children: [says(sw("y.p"), { falsy: "ask.busy" }), says(en("ask.busy"), { truthy: "ask.busy" })] },
      askParts.field(true),
      GAP(10),
      askParts.controls(ctx, p, true),
      askParts.answer(p, PAPER.surf, 12),
      { type: "Stack", style: { marginTop: 14 }, children: [askParts.chips(p, examples, true)] },
    ],
  };

  // ---- what is coming up, and the apps it works in: the tab's own card ---------------
  const insightCard: Node = {
    type: "Stack",
    props: { keepCase: true },
    style: { borderRadius: 20, padding: 20, backgroundColor: "#1A1611", borderWidth: 1, borderColor: "rgba(243,226,198,0.12)" },
    children: [
      ...comingSection,
      ...(comingSection.length ? [{ type: "Stack", style: { height: 1, backgroundColor: PHONE_LOOK.rule, marginTop: 20, marginBottom: 14 } } as Node] : []),
      foot,
    ],
  };

  // ---- what happened to the last things they asked: the third card, when there is any -----
  // A run whose task is already in Coming up is said there.
  const inUp = new Set((next ?? []).map((x) => x.id));
  const act: ActivityItem[] = (ctx.assistant?.activity ?? []).filter((a) => !a.taskId || !inUp.has(a.taskId)).slice(0, ACT_ROWS);
  // A desktop run keeps none of their words: its row says where it ran.
  const desk = SW["y.desk"][isHinglish(ctx.language) ? "hg" : "en"];
  const actRows = act.map((a) => ({
    title: a.title || (a.surface === "desktop" ? desk : ""), line: receiptLine(a.outcome, a.reason, ctx.language), ...(a.retry ? { retry: a.retry } : {}),
  }));
  const actRow = (a: ActivityItem, i: number): Node => {
    // Waiting on a card: the sheet for that task, from the row or its pill.
    const card = a.state === "waiting" && a.taskId ? seq(haptic("selection"), { kind: "navigate", screenId: "assistant_approve", params: { taskId: a.taskId } }) : undefined;
    const sign = a.state === "waiting" ? (a.app ? appMark(a.app) : glyph(ASKED, ui.text, 2.2, 22))
      : a.state === "running" ? dot()
        : a.state === "done" ? tick()
          : glyph(FAILED, ui.textDim, 2.2, 22);
    return {
      type: "Stack",
      ...(card ? { on: { onPress: card }, props: { pressOpacity: 0.7 } } : {}),
      style: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingLeft: 10, paddingRight: 12, borderRadius: 16, backgroundColor: PHONE_LOOK.track },
      children: [
        sign,
        { type: "Stack", style: { flex: 1, gap: 2 }, children: [
          line(fromState(`act.${i}.title`, "uiMedium", 14.5, { color: ui.text })),
          line(fromState(`act.${i}.line`, "ui", 12, { color: ui.textDim })),
        ] },
        ...(card ? [rowPill(sw("y.ok"), card)] : []),
        // Their own words back in the field above, and the card's Do it, as if
        // they had typed them again: once. Not while an ask is on its way, and
        // the pill goes when pressed (its words are let go from state), so a
        // second tap cannot send it twice.
        ...(a.retry ? [{
          ...rowPill(sw("y.again"), {
            kind: "condition", if: { falsy: "ask.busy" },
            then: seq(setState("ask.text", `$state.act.${i}.retry`), setState(`act.${i}.retry`, ""), askAction(ctx)),
          }),
          visibleIf: { truthy: `act.${i}.retry` },
        } as Node] : []),
      ],
    };
  };
  const activityCard: Node | null = act.length ? {
    type: "Stack",
    props: { keepCase: true },
    style: { borderRadius: 20, padding: 20, backgroundColor: "#1A1611", borderWidth: 1, borderColor: "rgba(243,226,198,0.12)" },
    children: [
      label(sw("y.act"), { marginBottom: 12 }),
      // Asked again from here, it is answered in the card above: said here too while it is on its way.
      { ...word(en("ask.busy"), "ui", 13, { color: ui.textDim, marginBottom: 10 }), visibleIf: { truthy: "ask.busy" } },
      { type: "Stack", style: { gap: 8 }, children: act.map(actRow) },
    ],
  } : null;

  const node: Node = {
    type: "Stack",
    props: { keepCase: true },
    style: o.marginBottom !== undefined ? { marginBottom: o.marginBottom } : {},
    children: [
      // His feet on the card's top edge: the strip sits right on it.
      ...(roams ? [{ type: "BlipRoam", props: { h: 60, thinkWhile: "ask.busy" } } as Node] : []),
      handCard,
      GAP(YOU_CARDS_GAP),
      insightCard,
      ...(activityCard ? [GAP(YOU_CARDS_GAP), activityCard] : []),
    ],
  };
  return { node, state: { ...askParts.state(examples), up: rows, ini, act: actRows }, roams };
}
