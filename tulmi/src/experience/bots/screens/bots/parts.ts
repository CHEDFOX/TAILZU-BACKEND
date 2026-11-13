/**
 * What several of the Bots area's screens share.
 */

import { PUSH_BUTTON_CAPABILITY, type ActionSpec, type ActionRef, type Node } from "../../../../../../shared/types/sdui.js";
import { SENT_WORDS, done as momentDone, failed, start as momentStart, streamed, askMoment } from "../../askMoment.js";
import {
  call, seq, botLook, type BotsCtx, C, FACE, row, roundButton, text, box, shapes, divider, col, button, botAvatar, meta, open, SCREENS,
  botKind, icon, labelled, hasSpaces,
} from "../../kit.js";
import { shareTo } from "../../shareAction.js";
import { reportAnswer } from "../../reportAction.js";
import { said } from "../../said.js";
import { showNodes } from "../../show.js";
import type { Shown } from "../../../../show/types.js";

/** This area's routes (routes/bots/botsBots.ts). */
export const A = "/v1/botsapp/bots";
export const enc = encodeURIComponent;
export const MIN = 60_000, DAY = 86_400_000;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ===================================================================== what the screens read
export interface BotView {
  slug: string; name: string; colour: string; purpose: string; principles: string[]; tone: string; builtin: boolean; publicCard: boolean;
  skills: { web: boolean; files: boolean; artifacts: boolean; code: boolean; research: boolean; connectors: string[] };
}
interface Fact { id: string; text: string; createdAt: number }
export interface Memory { facts: Fact[]; summary: string; turns: number }
export interface Linked { id: string; name: string; status: "connected" | "not_connected" | "unavailable" }
export interface Turn {
  id: string; role: "me" | "bot"; text: string; at: number; opens: Array<{ label: string; url: string }>; approvals: Array<{ taskId: string; connector: string; preview: string }>; paise: number;
  /** What the bot drew under its words (src/show). */
  show?: Shown;
}

// ===================================================================== small helpers
export const refresh: ActionSpec = { kind: "refresh" };
export const toast = (message: string, error = false): ActionSpec => ({ kind: "toast", message, ...(error ? { tone: "error" as const } : {}) });
export const setState = (path: string, value: unknown): ActionSpec => ({ kind: "setState", path, value });

/**
 * A notification's hand-off screen (Pay, Send, No, Open map), and what it may do. From inside the app (a page's own button) it opens
 * the other app at once ("go"). From a push, only the button that says so does ("go"): a tap just to look opens the Plan ("look"), so
 * looking never opens WhatsApp or UPI, nor counts as sent. A build that can't tell a tap from a button (no PushButton: the pressed
 * button's id in the `button` param) gets one button here instead ("ask"): one more tap, never a hand-off nobody asked for.
 */
export function handoffOf(ctx: BotsCtx, buttons: readonly string[]): "go" | "look" | "ask" {
  if (ctx.params.pushId === undefined || ctx.params.pushId === null || ctx.params.pushId === "") return "go";
  if (!ctx.can.has(PUSH_BUTTON_CAPABILITY)) return "ask";
  return buttons.includes(String(ctx.params.button ?? "")) ? "go" : "look";
}
export const clearState = (path: string): ActionSpec => ({ kind: "clearState", path });

/** A write: the call, then a quiet toast and a refresh; a failure says so in plain words. */
export function write(method: "POST" | "PUT" | "DELETE", path: string, bodyArg?: Record<string, unknown>, o: { ok?: string; fail?: string; then?: ActionRef } = {}): ActionRef {
  return call(method, path, bodyArg, { ok: seq(o.ok ? toast(o.ok) : undefined, o.then ?? refresh), fail: toast(o.fail ?? "Couldn't do that. Try again.", true) });
}

/** Only when the field at `path` has something in it. */
export const ifFilled = (path: string, then: ActionRef, empty = "Type something first"): ActionSpec => ({ kind: "condition", if: { falsy: path }, then: toast(empty), else: then });

export const lookOf = (slug: string, colour?: string) => botLook(slug, colour);

export const isDesk = (ctx: BotsCtx) => ctx.client === "desktop";

const localDate = (ctx: BotsCtx, ms: number) => new Date(ms + ctx.tzOffsetMinutes * MIN);
export const dayKeyOf = (ctx: BotsCtx, ms: number) => localDate(ctx, ms).toISOString().slice(0, 10);
export function clockOf(ctx: BotsCtx, ms: number): string {
  const d = localDate(ctx, ms);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
export const shortDate = (ctx: BotsCtx, ms: number) => { const d = localDate(ctx, ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

/** "Today", "Yesterday, 9:00 pm", "Mon 26 Oct". */
function dayLabel(ctx: BotsCtx, ms: number): string {
  const k = dayKeyOf(ctx, ms);
  if (k === dayKeyOf(ctx, ctx.live.now)) return "Today";
  if (k === dayKeyOf(ctx, ctx.live.now - DAY)) return `Yesterday, ${clockOf(ctx, ms)}`;
  const d = localDate(ctx, ms);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/** A text field the kit's way (the ask bar's look): no frame of its own, Geist, 44 tall. Put it in `inputBox`. */
export function field(id: string, path: string, placeholder: string, o: { onSubmit?: ActionRef; multiline?: boolean; size?: number } = {}): Node {
  return {
    type: "TextField", id, bind: { value: path },
    props: {
      placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0,
      minHeight: o.multiline ? 72 : 44, color: C.ink, returnKeyType: o.onSubmit ? "send" : "done", ...(o.multiline ? { multiline: true } : {}),
    },
    ...(o.onSubmit ? { on: { onSubmit: o.onSubmit } } : {}),
    style: {
      flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: o.multiline ? 72 : 44, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.regular,
      fontSize: o.size ?? 15, lineHeight: Math.round((o.size ?? 15) * 1.45), color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
    },
  };
}
export function inputBox(children: Node[], o: { ink?: boolean; radius?: number; pad?: number } = {}): Node {
  return row(children, {
    gap: 8, borderWidth: o.ink ? 1.5 : 1, borderColor: o.ink ? C.ink : C.line, borderRadius: o.radius ?? 16, paddingLeft: o.pad ?? 14, paddingRight: 6,
    paddingVertical: 4, minHeight: 48, backgroundColor: C.paper,
  });
}
/** A field with a send button: Enter or the button runs `send` when it has words. */
export function sendField(id: string, path: string, placeholder: string, send: ActionRef, o: { radius?: number; desk?: boolean } = {}): Node {
  const go = ifFilled(path, send);
  return inputBox([
    field(id, path, placeholder, { onSubmit: go }),
    roundButton("send", go, { size: 40, label: "Send" }),
  ], { radius: o.radius ?? 28, pad: o.desk ? 22 : 18 });
}

export const link = (label: string, onPress: ActionRef): Node => row([text(label, { size: 13, weight: 500, lineHeight: 18 })], { minHeight: 32, paddingHorizontal: 4 }, onPress);
export const dotLine = (s: string, size = 13): Node => row([text("·", { size, color: C.idle, lineHeight: 19 }), text(s, { size, lineHeight: 19, style: { flexShrink: 1 } })], { gap: 8, alignItems: "flex-start" });

/** A dot of colour, crossed out when another bot has it, ringed when chosen. */
export function colourDot(name: string, o: { chosen: boolean; taken?: string; onPress?: ActionRef; size?: number }): Node {
  const s = o.size ?? 30;
  const dot = box(o.taken ? [shapes([{ d: "M8 16L16 8", stroke: C.paper, strokeWidth: 2, linecap: "round" }], { size: Math.round(s * 0.8) })] : [], {
    width: s, height: s, borderRadius: s / 2, backgroundColor: lookOf("x", name).color, alignItems: "center", justifyContent: "center",
  });
  return box([dot], {
    padding: 2, borderRadius: s / 2 + 4, borderWidth: 2, borderColor: o.chosen ? C.ink : "transparent",
  }, o.taken || o.chosen ? undefined : o.onPress);
}

// ===================================================================== a bot's answer, and the chat

/**
 * A bot's text as blocks: paragraphs, and runs of "- " lines as a card with the bot's colour on its edge (the boards' plan table).
 * `lists: false`: the lists are left out, because what the bot drew shows them (a choice, a table, the steps: show/types.ts lists).
 */
function answerBlocks(textIn: string, color: string, size = 14, o: { lists?: boolean } = {}): Node[] {
  const out: Node[] = [];
  const lines = textIn.replace(/\r/g, "").split("\n");
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => { if (para.join(" ").trim()) out.push(text(para.join(" ").replace(/\*\*/g, "").trim(), { size, lineHeight: Math.round(size * 1.45) })); para = []; };
  const flushList = () => {
    if (!list.length) return;
    if (o.lists === false) { list = []; return; }
    const rows: Node[] = [];
    list.forEach((l, i) => {
      if (i) rows.push(divider());
      const m = /^(.{1,14}?)\s*[:—–-]\s+(.+)$/.exec(l);
      rows.push(m
        ? row([text(m[1]!, { size: 12, weight: 600, color: C.meta, lineHeight: 17, style: { width: 64, flexShrink: 0 } }), text(m[2]!, { size: Math.min(size, 14), lineHeight: 19, style: { flexShrink: 1 } })], { gap: 8, paddingVertical: 9, paddingHorizontal: 12, alignItems: "flex-start" })
        : row([text(l, { size: Math.min(size, 14), lineHeight: 19, style: { flexShrink: 1 } })], { paddingVertical: 9, paddingHorizontal: 12 }));
    });
    out.push(col(rows, { borderWidth: 1, borderColor: C.line, borderLeftWidth: 3, borderLeftColor: color, borderRadius: 12, overflow: "hidden" }));
    list = [];
  };
  for (const raw of lines) {
    const l = raw.trim();
    const item = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l);
    if (item) { flushPara(); list.push(item[1]!.replace(/\*\*/g, "")); continue; }
    flushList();
    if (!l) flushPara(); else para.push(l);
  }
  flushPara();
  flushList();
  return out.length || o.lists === false ? out : [text("…", { size, lineHeight: 20 })];
}

/** What a bot turn leaves to do: the changes waiting for the person's yes (still waiting), and the links to finish in another app. */
function turnActions(ctx: BotsCtx, t: Turn): Node[] {
  const out: Node[] = [];
  for (const a of t.approvals) {
    const need = ctx.live.needs.find((n) => n.id === `task:${a.taskId}`);
    if (need) out.push(row(need.choices.map((c) => button(c.label, c.action, { kind: c.kind, size: "md" })), { gap: 8, flexWrap: "wrap" }));
  }
  if (t.opens.length) out.push(row(t.opens.slice(0, 3).map((o, i) => button(o.label.length > 28 ? `${o.label.slice(0, 27)}…` : o.label, { kind: "openUrl", url: o.url, handoff: true }, { kind: i ? "secondary" : "primary", size: "md", icon: "link" })), { gap: 8, flexWrap: "wrap" }));
  return out;
}

export function bubble(ctx: BotsCtx, s: string, big = false): Node {
  const desk = isDesk(ctx);
  return row([
    box([text(s, { size: big ? 15 : 14, lineHeight: big ? 21 : 20, color: desk ? C.ink : C.paper })], {
      maxWidth: desk ? "82%" : "80%", backgroundColor: desk ? C.surface : C.ink, paddingVertical: 10, paddingHorizontal: 14,
      borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 18, borderBottomRightRadius: 6,
    }),
  ], { justifyContent: "flex-end" });
}

/**
 * A bot's turn: its words, what it drew under them (show.ts), and what it leaves to do. `draw.live`: the chat's latest turn, whose
 * choices and form can be used; `draw.picked`: what the person said next, for an older one.
 */
export function botTurn(ctx: BotsCtx, look: { color: string; icon: Parameters<typeof botAvatar>[0]["icon"]; head?: string }, t: Turn, big = false,
  draw?: { slug: string; live: boolean; picked?: string }): Node {
  const drawn = t.show && draw ? showNodes(ctx, t.show, { slug: draw.slug, turn: t.id, color: look.color, live: draw.live, ...(draw.picked !== undefined ? { picked: draw.picked } : {}) }) : [];
  const words = answerBlocks(t.text, look.color, big ? 15 : 14, drawn.length && t.show?.lists === "drawn" ? { lists: false } : {});
  const blocks = [...words, ...drawn, ...turnActions(ctx, t)];
  if (!isDesk(ctx)) return col(blocks, { gap: 12 });
  return row([botAvatar(look, 26), col(blocks, { gap: 10, flexGrow: 1, flexShrink: 1, minWidth: 0 })], { gap: 10, alignItems: "flex-start", maxWidth: "92%" });
}

const dayRule = (label: string): Node => row([box([], { height: 1, flexGrow: 1, backgroundColor: C.divider }), meta(label, { size: 12 }), box([], { height: 1, flexGrow: 1, backgroundColor: C.divider })], { gap: 10 });

/** "Share" under a bot's answer: to a space or a person, as a copy (screens/spaces.ts bots.share); only Report while Spaces is off. */
function answerShare(ctx: BotsCtx, slug: string, t: Turn, botName = slug): Node {
  const first = t.text.replace(/[*#>`]/g, "").split("\n").map((l) => l.trim()).find(Boolean) ?? "Answer";
  // Report: App Review 1.2 and 4.7.1, what a bot makes can be reported (reportAction.ts).
  return row([
    ...(hasSpaces(ctx) ? [link("Share", shareTo({ kind: "answer", title: first.length > 60 ? `${first.slice(0, 59)}…` : first, text: t.text, bot: slug }))] : []),
    link("Report", reportAnswer({ bot: botName, text: t.text, ...(t.id ? { id: t.id } : {}) })),
  ], { paddingLeft: 0, gap: 16 });
}

/** The chat: turns oldest first, a day rule where the day changes (the window), the bot's answers with what they leave to do. */
export function chatTurns(ctx: BotsCtx, bot: { slug: string; colour?: string }, turns: Turn[], o: { big?: boolean; days?: boolean } = {}): Node[] {
  const look = lookOf(bot.slug, bot.colour);
  const out: Node[] = [];
  let lastDay = "";
  turns.forEach((t, i) => {
    const day = dayKeyOf(ctx, t.at);
    if (o.days && day !== lastDay) { out.push(dayRule(dayLabel(ctx, t.at))); lastDay = day; }
    const name = ctx.live.bots.find((b) => b.slug === bot.slug)?.name ?? bot.slug;
    // What it drew: live on the chat's last turn; on an older one, still, with what the person said next.
    const next = turns[i + 1];
    const draw = { slug: bot.slug, live: i === turns.length - 1, ...(next?.role === "me" ? { picked: next.text } : {}) };
    out.push(t.role === "me" ? bubble(ctx, t.text, o.big) : col([botTurn(ctx, look, t, o.big, draw), answerShare(ctx, bot.slug, t, name)], { gap: 4 }));
  });
  return out;
}

/** Sends what is typed at `path` to the bot (POST .../chat/:slug), then shows it. */
export function sendToBot(slug: string, path = "say", then?: ActionRef, ctx?: BotsCtx): ActionRef {
  // The words go up as the person's bubble and the box clears at once (askMoment.ts); the answer is written in as it comes.
  const send = call("POST", `${A}/chat/${enc(slug)}`, { message: SENT_WORDS }, {
    ok: seq(setState("sending", false), then ?? refresh, ...momentDone()),
    fail: failed({ busy: "sending", from: path, then: said("Couldn't send that. Try again.") }),
  });
  return seq(...momentStart({ message: `$state.${path}`, from: path, busy: "sending" }), ctx ? streamed(ctx, send as ActionSpec) : send);
}
/** Sends a fixed line (a suggestion chip) and opens the chat with the answer. */
export const askBot = (slug: string, message: string): ActionRef => seq(
  toast("Asking…"),
  call("POST", `${A}/chat/${enc(slug)}`, { message }, { ok: open(SCREENS.chat, { slug }), fail: toast("Couldn't send that. Try again.", true) }),
);

export function chatBar(ctx: BotsCtx, slug: string, name: string, placeholder?: string, then?: ActionRef): Node {
  return col([
    askMoment(ctx, { slug, color: ctx.live.bots.find((b) => b.slug === slug)?.color ?? lookOf(slug).color, kind: botKind(slug), busy: "sending", line: `${name} is on it…` }),
    sendField("say", "say", placeholder ?? (isDesk(ctx) ? `Ask ${name}…  or hold Fn and speak` : `Ask ${name}…`), sendToBot(slug, "say", then, ctx), { desk: isDesk(ctx) }),
  ], { gap: 8 });
}

// ===================================================================== bots.bot and bots.chat
export interface BotPageData { bot?: BotView; memory?: Memory; linked?: Linked[]; turns?: Turn[] }

/** While a chat message is on its way to the bot and its answer is coming (sendToBot's `sending`): the bot thinks. */
export const ANSWERING = { truthy: "sending" };

export function labelledIcon(name: Parameters<typeof icon>[0], onPress: ActionRef, label: string, size = 36): Node {
  return labelled(box([icon(name, { size: 16, color: C.meta })], { width: size, height: size, alignItems: "center", justifyContent: "center", flexShrink: 0 }, onPress), label);
}
