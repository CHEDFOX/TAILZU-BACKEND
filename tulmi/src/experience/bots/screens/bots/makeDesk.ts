/**
 * The Bots area's makeDesk screen.
 */

import type { Node, ActionRef } from "../../../../../../shared/types/sdui.js";
import {
  row, sectionLabel, grow, seq, call, SCREENS, type BotsCtx, col, when, statusMark, C, meta, text, button, open, switchMark, divider, card,
  botAvatar, roundButton, chip, box, primaryButton, quietButton, emptyState, page, title,
} from "../../kit.js";
import {
  type BotView, type Linked, ifFilled, setState, A, refresh, toast, write, clearState, inputBox, field, lookOf, colourDot, dotLine,
  labelledIcon, bubble, botTurn, sendField, clockOf,
} from "./parts.js";

const OWN_COLOURS = ["pine", "plum", "sand", "stone"] as const;

/** A section's head: the label, and an action on the right. */
const sectionHead = (label: string, right?: Node): Node => row([sectionLabel(label), grow(), ...(right ? [right] : [])], { minHeight: 20 });

// ===================================================================== bots.make
interface DraftDef { name: string; slug: string; colour: string; purpose: string; principles: string[]; skills: BotView["skills"]; tone: string }
interface Draft { definition: DraftDef; tests: string[]; connectors: Linked[]; warnings: string[] }
export interface DraftView { sentence: string; draft: Draft; trial: Array<{ said: string; answered: string }>; updatedAt: number }

export const EXAMPLES = [
  "A bot that plans my workouts around my calendar and reminds me the night before.",
  "A bot that plans my meals for the week, vegetarian.",
  "A bot that turns my class notes into a short quiz every evening.",
];
const ADD_LINES = ["Ask before it spends money", "Keep answers short", "Reply in Hinglish when I do"];

export const drafting = (o: { then?: ActionRef } = {}): ActionRef => ifFilled("sentence", seq(
  setState("drafting", true),
  call("POST", `${A}/draft`, { sentence: "$state.sentence" }, {
    ok: seq(setState("drafting", false), o.then ?? refresh),
    fail: seq(setState("drafting", false), toast("Couldn't draft that. Say it another way, or try again.", true)),
  }),
), "Say what the bot should do first");

const draftEdit = (b: Record<string, unknown>, fail = "Couldn't change that. Try again."): ActionRef => write("PUT", `${A}/draft`, b, { fail });
const tryDraft = (message: string | null): ActionRef => {
  const send = seq(setState("trying", true), call("POST", `${A}/draft/try`, { message: message ?? "$state.trial" }, {
    ok: seq(setState("trying", false), clearState("trial"), refresh),
    fail: seq(setState("trying", false), toast("The draft couldn't answer. Try again.", true)),
  }));
  return message === null ? ifFilled("trial", send) : send;
};
export const approveDraft = (name: string): ActionRef => call("POST", `${A}/draft/approve`, {}, {
  assignTo: "made",
  ok: seq(toast(`${name} is ready`), { kind: "navigate", screenId: SCREENS.bot, params: { slug: "$state.made.bot.slug" }, replace: true }),
  fail: toast("Couldn't make it. Check the name and try again.", true),
});

export function describeBox(_ctx: BotsCtx, size = 15): Node {
  return col([
    inputBox([field("sentence", "sentence", EXAMPLES[0]!, { multiline: true, size })], { ink: true, radius: 18 }),
    when({ truthy: "drafting" }, row([statusMark("working", { color: C.ink }), meta("Drafting your bot…", { size: 13 })], { gap: 8 })),
  ], { gap: 10 });
}

/** The draft as a card: its look, the colours, its rules, what it can use, what it won't do. */
export function draftCard(_ctx: BotsCtx, v: DraftView, o: { desk?: boolean } = {}): Node {
  const d = v.draft.definition;
  const look = lookOf(d.slug, d.colour);
  const appRows: Node[] = [
    ...v.draft.connectors.map((c) => {
      const on = d.skills.connectors.includes(c.id);
      return row([
        text(c.name, { size: 14, lineHeight: 19, style: { flexShrink: 1 } }), grow(),
        c.status === "not_connected"
          ? button("Connect", open(SCREENS.appConnect, { id: c.id }), { kind: "secondary", size: "md" })
          : row([meta(on ? "On" : "Off", { size: 13 })], { minHeight: 36, paddingHorizontal: 6 }, draftEdit({ connector: { id: c.id, on: !on } })),
      ], { minHeight: 44, gap: 8 });
    }),
    row([text("Search the web", { size: 14, lineHeight: 19 }), grow(), switchMark("d_web")], { minHeight: 44, gap: 8 }, seq({ kind: "toggleState", path: "d_web" }, draftEdit({ web: !d.skills.web }))),
    row([text("Your files", { size: 14, lineHeight: 19 }), grow(), switchMark("d_files")], { minHeight: 44, gap: 8 }, seq({ kind: "toggleState", path: "d_files" }, draftEdit({ files: !d.skills.files }))),
  ];
  const apps: Node[] = [];
  appRows.forEach((r, i) => { if (i) apps.push(divider()); apps.push(r); });
  const never = d.principles.find((p) => /^(never|don't|do not)\b/i.test(p));
  return card([
    row([botAvatar(look, o.desk ? 46 : 44), col([text(d.name, { size: o.desk ? 18 : 17, weight: 600, lineHeight: 23 }), meta(d.purpose, { size: o.desk ? 13 : 12, lines: 2 })], { gap: 2, flexShrink: 1 })], { gap: 12 }),
    row(OWN_COLOURS.map((c) => colourDot(c, { chosen: d.colour === c, onPress: draftEdit({ colour: c }), size: 26 }))),
    col([
      sectionHead("Its rules"),
      ...(d.principles.length ? d.principles.map((p, i) => row([dotLine(p), grow(), labelledIcon("close", draftEdit({ dropRule: i }), "Remove this rule", 28)], { gap: 6 })) : [meta("No rules yet.", { size: 13 })]),
      inputBox([field("rule", "rule", "Add a rule…", { onSubmit: ifFilled("rule", seq(draftEdit({ addRule: "$state.rule" }), clearState("rule"))) }),
        roundButton("plus", ifFilled("rule", seq(draftEdit({ addRule: "$state.rule" }), clearState("rule"))), { size: 36, label: "Add rule", light: true })], { radius: 14 }),
    ], { gap: 8 }),
    col([sectionHead("It can use"), col(apps)], { gap: 4 }),
    ...(v.draft.warnings.length ? [meta(v.draft.warnings[0]!, { size: 12 })] : []),
    meta(never ? `It won't: ${never.replace(/^(never|don't|do not)\s+/i, "").replace(/\.$/, "")}.` : "It asks before it books, pays or messages anyone.", { size: 12.5 }),
  ], { gap: 14, ...(o.desk ? { selected: look.color } : {}) });
}

export function trialPart(ctx: BotsCtx, v: DraftView): Node[] {
  const look = lookOf(v.draft.definition.slug, v.draft.definition.colour);
  const last = v.trial.slice(-2);
  return [
    row(v.draft.tests.slice(0, 3).map((t) => chip(t, { onPress: tryDraft(t) })), { gap: 8, flexWrap: "wrap" }),
    ...last.flatMap((t) => [bubble(ctx, t.said), botTurn(ctx, look, { id: "", role: "bot", text: t.answered, at: 0, opens: [], approvals: [], paise: 0 })]),
    when({ truthy: "trying" }, row([statusMark("working", { color: look.color }), meta("Trying it…", { size: 13 })], { gap: 8 })),
    meta("Trial run · nothing is saved or added to your apps", { size: 12 }),
    sendField("trial", "trial", "Ask the draft…", tryDraft(null), { radius: 24 }),
  ];
}

/** What Home already said the bot should do: the window's "A bot that…" (`say`), or an idea tapped on the first day (`idea`). */
export const saidFirst = (ctx: BotsCtx): string => String(ctx.params.say ?? ctx.params.idea ?? "").slice(0, 600);

export function makeDesk(ctx: BotsCtx, v: DraftView | null | undefined) {
  const d = v?.draft.definition;
  const has = (re: RegExp) => !!d && d.principles.some((p) => re.test(p));
  const checks: Array<[string, string, boolean]> = [
    ["What to do", d ? d.purpose : "Say what it does", !!d],
    ["When", has(/\b(morning|evening|night|daily|every|before|after|weekday|weekend|am|pm|\d+\s*(?:am|pm))\b/i) ? "It has a time to work to" : "Say when it should work", has(/\b(morning|evening|night|daily|every|before|after|weekday|weekend|am|pm)\b/i)],
    ["What it must never do", has(/^(never|don't|do not)\b/i) ? d!.principles.find((p) => /^(never|don't|do not)\b/i.test(p))! : "Not said yet · add a rule that starts with Never", has(/^(never|don't|do not)\b/i)],
  ];
  const describe = col([
    sectionLabel("1 · Describe it"),
    describeBox(ctx, 16),
    row([roundButton("mic", { kind: "dictate" }, { size: 44, label: "Speak instead" }), meta("or hold Fn and speak", { size: 12 }), grow(), button(v ? "Draft again" : "Draft it", drafting(), { kind: v ? "secondary" : "primary", size: "md" })], { gap: 10 }),
    col([
      text("A good bot hears three things", { size: 13, weight: 600, lineHeight: 18 }),
      ...checks.map(([k, s, ok]) => row([box([statusMark(ok ? "done" : "waiting")], { height: 18, justifyContent: "center" }), col([text(k, { size: 13, weight: 500, lineHeight: 18 }), meta(s, { size: 12, lines: 2 })], { gap: 1, flexShrink: 1 })], { gap: 10, alignItems: "flex-start" })),
    ], { backgroundColor: C.surface, borderRadius: 16, padding: 16, gap: 12 }),
    ...(v ? [sectionLabel("Add a line"), row(ADD_LINES.map((l) => chip(`+ ${l}`, { onPress: draftEdit({ addRule: `${l}.` }) })), { gap: 8, flexWrap: "wrap" })] : []),
  ], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 14 });
  const live = col(v ? [
    row([sectionLabel("2 · Live draft"), grow(), row([statusMark("done"), meta("Saved as you change it", { size: 12 })], { gap: 6 })]),
    draftCard(ctx, v, { desk: true }),
    primaryButton(`Make ${d!.name}`, approveDraft(d!.name), { wide: true }),
    quietButton("Start over", write("DELETE", `${A}/draft`, undefined, { ok: "Draft cleared" }), { size: "md" }),
  ] : [
    sectionLabel("2 · Live draft"),
    emptyState({ pose: "think", title: "Your bot shows up here", body: "Describe it on the left and press Draft it. Nothing is made until you say so." }),
  ], { flexGrow: 1.05, flexBasis: 0, minWidth: 0, gap: 14 });
  const tryCol = col(v ? [sectionLabel("3 · Try it first"), card(trialPart(ctx, v), { gap: 12 })] : [
    sectionLabel("3 · Try it first"),
    card([meta("Once there's a draft, ask it something here. A trial saves nothing.", { size: 13 })], { dashed: true }),
  ], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 14 });
  return page(ctx, {
    title: "Make a bot", nav: "make", maxWidth: 1180, state: { sentence: v?.sentence ?? saidFirst(ctx), ...(d ? { d_web: d.skills.web, d_files: d.skills.files } : {}) },
    body: [
      row([col([title("Make a bot"), meta("Say what it should do. It shows you the plan before it acts.", { size: 14 })], { gap: 4 }), grow(),
        ...(v ? [meta(`Draft saved · ${clockOf(ctx, v.updatedAt)}`, { size: 12 })] : [])], { alignItems: "flex-end" }),
      row([describe, live, tryCol], { gap: 24, alignItems: "flex-start" }),
    ],
  });
}
