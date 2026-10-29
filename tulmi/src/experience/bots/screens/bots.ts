/**
 * THE BOTS THEMSELVES: a bot's page and its chat, Make a bot, Edit, its keys, Find a bot, the Plan bot, the Travel bot, Spaces, sending a
 * shared file or link to a bot, and Blip's five moments (BotPage, Chat, MakeBot, BotEdit, BotKeys, BotStore, PlanBot, TravelBot, Spaces,
 * ShareIn, Avatars; D<Board> in the window).
 *
 * One id serves the phone and the window (ctx.client). Data comes from the app's own routes through deps.api: the bots platform
 * (/v1/bots/..., docs/bots.md), connected apps (/v1/connectors, /v1/tasks), files (/v1/files), and this area's routes
 * (/v1/botsapp/bots/..., routes/botsBots.ts over src/botsBots). A read that fails draws the honest empty state, never a made-up number.
 * Every write is a callEndpoint, then a refresh and a short ink toast; money is always "you press pay".
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../shared/types/sdui.js";
import {
  back, blip, body, botAvatar, botLook, box, button, C, call, card, chip, chips, col, divider, emptyState, FACE, grid, grow, icon,
  infoChip, labelled, listCard, listRow, meta, meter, mono, needsCard, notice, open, page, primaryButton, quietButton, roundButton, row, SCREENS,
  secondaryButton, sectionLabel, segmented, seq, shapes, statusMark, switchMark, switchRow, text, title, toTab, when, whenEq,
  headerBuddy, type BotsCtx, type LiveBot,
} from "../kit.js";
import { withoutAmounts } from "../../../shell/parse.js";
import { screen, type BotsScreen } from "../registry.js";
import { askMoment, done as momentDone, failed, SENT_WORDS, start as momentStart, streamed } from "../askMoment.js";
import { botKind } from "../kit.js";
import { shareButton, shareTo } from "../shareAction.js";
import * as places from "./botsPlaces.js";
import { addAction, itemAction, planItemScreens, tickAction, tickBox } from "./planItem.js";

/** This area's routes (routes/botsBots.ts). */
const A = "/v1/botsapp/bots";
const enc = encodeURIComponent;
const MIN = 60_000, DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const OWN_COLOURS = ["pine", "plum", "sand", "stone"] as const;
const ALL_COLOURS = ["moss", "clay", "ochre", "sea", "pine", "plum", "sand", "stone"] as const;
/** The design gives the built-ins these colours (palette.ts), whatever src/bots calls them. */
const BUILTIN_COLOUR: Record<string, string> = { moss: "Code", clay: "Keybot", ochre: "Plan", sea: "Travel" };

// ===================================================================== what the screens read

interface BotView {
  slug: string; name: string; colour: string; purpose: string; principles: string[]; tone: string; builtin: boolean; publicCard: boolean;
  skills: { web: boolean; files: boolean; artifacts: boolean; code: boolean; research: boolean; connectors: string[] };
}
interface Fact { id: string; text: string; createdAt: number }
interface Memory { facts: Fact[]; summary: string; turns: number }
interface Linked { id: string; name: string; status: "connected" | "not_connected" | "unavailable" }
interface Turn { id: string; role: "me" | "bot"; text: string; at: number; opens: Array<{ label: string; url: string }>; approvals: Array<{ taskId: string; connector: string; preview: string }>; paise: number }
interface App { id: string; name: string; oneLine?: string; connected: boolean }

// ===================================================================== small helpers

const refresh: ActionSpec = { kind: "refresh" };
const toast = (message: string, error = false): ActionSpec => ({ kind: "toast", message, ...(error ? { tone: "error" as const } : {}) });
const setState = (path: string, value: unknown): ActionSpec => ({ kind: "setState", path, value });
const clearState = (path: string): ActionSpec => ({ kind: "clearState", path });

/** A write: the call, then a quiet toast and a refresh; a failure says so in plain words. */
function write(method: "POST" | "PUT" | "DELETE", path: string, bodyArg?: Record<string, unknown>, o: { ok?: string; fail?: string; then?: ActionRef } = {}): ActionRef {
  return call(method, path, bodyArg, { ok: seq(o.ok ? toast(o.ok) : undefined, o.then ?? refresh), fail: toast(o.fail ?? "Couldn't do that. Try again.", true) });
}

/** Only when the field at `path` has something in it. */
const ifFilled = (path: string, then: ActionRef, empty = "Type something first"): ActionSpec => ({ kind: "condition", if: { falsy: path }, then: toast(empty), else: then });

const lookOf = (slug: string, colour?: string) => botLook(slug, colour);
const liveOf = (ctx: BotsCtx, slug: string): LiveBot | undefined => ctx.live.bots.find((b) => b.slug === slug);
const isDesk = (ctx: BotsCtx) => ctx.client === "desktop";
const slugParam = (ctx: BotsCtx): string => String(ctx.params.slug ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);

/** "Ready · made by you", "Working · fixing cart", "Needs you". */
function stateLine(ctx: BotsCtx, bot: { slug: string; builtin: boolean }): string {
  const l = liveOf(ctx, bot.slug);
  const who = bot.builtin ? "X0 Bot's own" : "made by you";
  if (l?.needs) return `Needs you · ${who}`;
  if (l?.working) return `Working · ${l.doing ?? "on it"}`;
  return `Ready · ${who}`;
}

const localDate = (ctx: BotsCtx, ms: number) => new Date(ms + ctx.tzOffsetMinutes * MIN);
const dayKeyOf = (ctx: BotsCtx, ms: number) => localDate(ctx, ms).toISOString().slice(0, 10);
function clockOf(ctx: BotsCtx, ms: number): string {
  const d = localDate(ctx, ms);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
const shortDate = (ctx: BotsCtx, ms: number) => { const d = localDate(ctx, ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
/** "4 min ago", "Yesterday", "2 Oct". */
function ago(ctx: BotsCtx, ms: number): string {
  const now = ctx.live.now;
  const m = Math.max(0, Math.round((now - ms) / MIN));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (dayKeyOf(ctx, ms) === dayKeyOf(ctx, now)) return `${Math.round(m / 60)} h ago`;
  if (dayKeyOf(ctx, ms) === dayKeyOf(ctx, now - DAY)) return "yesterday";
  return shortDate(ctx, ms);
}
/** "Today", "Yesterday, 9:00 pm", "Mon 26 Oct". */
function dayLabel(ctx: BotsCtx, ms: number): string {
  const k = dayKeyOf(ctx, ms);
  if (k === dayKeyOf(ctx, ctx.live.now)) return "Today";
  if (k === dayKeyOf(ctx, ctx.live.now - DAY)) return `Yesterday, ${clockOf(ctx, ms)}`;
  const d = localDate(ctx, ms);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
const kb = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** A text field the kit's way (the ask bar's look): no frame of its own, Geist, 44 tall. Put it in `inputBox`. */
function field(id: string, path: string, placeholder: string, o: { onSubmit?: ActionRef; multiline?: boolean; size?: number } = {}): Node {
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
function inputBox(children: Node[], o: { ink?: boolean; radius?: number; pad?: number } = {}): Node {
  return row(children, {
    gap: 8, borderWidth: o.ink ? 1.5 : 1, borderColor: o.ink ? C.ink : C.line, borderRadius: o.radius ?? 16, paddingLeft: o.pad ?? 14, paddingRight: 6,
    paddingVertical: 4, minHeight: 48, backgroundColor: C.paper,
  });
}
/** A field with a send button: Enter or the button runs `send` when it has words. */
function sendField(id: string, path: string, placeholder: string, send: ActionRef, o: { radius?: number; desk?: boolean } = {}): Node {
  const go = ifFilled(path, send);
  return inputBox([
    field(id, path, placeholder, { onSubmit: go }),
    roundButton("send", go, { size: 40, label: "Send" }),
  ], { radius: o.radius ?? 28, pad: o.desk ? 22 : 18 });
}

/** A section's head: the label, and an action on the right. */
const sectionHead = (label: string, right?: Node): Node => row([sectionLabel(label), grow(), ...(right ? [right] : [])], { minHeight: 20 });
const link = (label: string, onPress: ActionRef): Node => row([text(label, { size: 13, weight: 500, lineHeight: 18 })], { minHeight: 32, paddingHorizontal: 4 }, onPress);
const dotLine = (s: string, size = 13): Node => row([text("·", { size, color: C.idle, lineHeight: 19 }), text(s, { size, lineHeight: 19, style: { flexShrink: 1 } })], { gap: 8, alignItems: "flex-start" });

/** A dot of colour, crossed out when another bot has it, ringed when chosen. */
function colourDot(name: string, o: { chosen: boolean; taken?: string; onPress?: ActionRef; size?: number }): Node {
  const s = o.size ?? 30;
  const dot = box(o.taken ? [shapes([{ d: "M8 16L16 8", stroke: C.paper, strokeWidth: 2, linecap: "round" }], { size: Math.round(s * 0.8) })] : [], {
    width: s, height: s, borderRadius: s / 2, backgroundColor: lookOf("x", name).color, alignItems: "center", justifyContent: "center",
  });
  return box([dot], {
    padding: 2, borderRadius: s / 2 + 4, borderWidth: 2, borderColor: o.chosen ? C.ink : "transparent",
  }, o.taken || o.chosen ? undefined : o.onPress);
}

// ===================================================================== a bot's answer, and the chat

/** A bot's text as blocks: paragraphs, and runs of "- " lines as a card with the bot's colour on its edge (the boards' plan table). */
function answerBlocks(textIn: string, color: string, size = 14): Node[] {
  const out: Node[] = [];
  const lines = textIn.replace(/\r/g, "").split("\n");
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => { if (para.join(" ").trim()) out.push(text(para.join(" ").replace(/\*\*/g, "").trim(), { size, lineHeight: Math.round(size * 1.45) })); para = []; };
  const flushList = () => {
    if (!list.length) return;
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
  return out.length ? out : [text("…", { size, lineHeight: 20 })];
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

function bubble(ctx: BotsCtx, s: string, big = false): Node {
  const desk = isDesk(ctx);
  return row([
    box([text(s, { size: big ? 15 : 14, lineHeight: big ? 21 : 20, color: desk ? C.ink : C.paper })], {
      maxWidth: desk ? "82%" : "80%", backgroundColor: desk ? C.surface : C.ink, paddingVertical: 10, paddingHorizontal: 14,
      borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 18, borderBottomRightRadius: 6,
    }),
  ], { justifyContent: "flex-end" });
}

function botTurn(ctx: BotsCtx, look: { color: string; icon: Parameters<typeof botAvatar>[0]["icon"]; head?: string }, t: Turn, big = false): Node {
  const blocks = [...answerBlocks(t.text, look.color, big ? 15 : 14), ...turnActions(ctx, t)];
  if (!isDesk(ctx)) return col(blocks, { gap: 12 });
  return row([botAvatar(look, 26), col(blocks, { gap: 10, flexGrow: 1, flexShrink: 1, minWidth: 0 })], { gap: 10, alignItems: "flex-start", maxWidth: "92%" });
}

const dayRule = (label: string): Node => row([box([], { height: 1, flexGrow: 1, backgroundColor: C.divider }), meta(label, { size: 12 }), box([], { height: 1, flexGrow: 1, backgroundColor: C.divider })], { gap: 10 });

/** "Share" under a bot's answer: to a space or a person, as a copy (screens/spaces.ts bots.share). */
function answerShare(slug: string, t: Turn): Node {
  const first = t.text.replace(/[*#>`]/g, "").split("\n").map((l) => l.trim()).find(Boolean) ?? "Answer";
  return row([link("Share", shareTo({ kind: "answer", title: first.length > 60 ? `${first.slice(0, 59)}…` : first, text: t.text, bot: slug }))], { paddingLeft: 0 });
}

/** The chat: turns oldest first, a day rule where the day changes (the window), the bot's answers with what they leave to do. */
function chatTurns(ctx: BotsCtx, bot: { slug: string; colour?: string }, turns: Turn[], o: { big?: boolean; days?: boolean } = {}): Node[] {
  const look = lookOf(bot.slug, bot.colour);
  const out: Node[] = [];
  let lastDay = "";
  for (const t of turns) {
    const day = dayKeyOf(ctx, t.at);
    if (o.days && day !== lastDay) { out.push(dayRule(dayLabel(ctx, t.at))); lastDay = day; }
    out.push(t.role === "me" ? bubble(ctx, t.text, o.big) : col([botTurn(ctx, look, t, o.big), answerShare(bot.slug, t)], { gap: 4 }));
  }
  return out;
}

/** Sends what is typed at `path` to the bot (POST .../chat/:slug), then shows it. */
function sendToBot(slug: string, path = "say", then?: ActionRef, ctx?: BotsCtx): ActionRef {
  // The words go up as the person's bubble and the box clears at once (askMoment.ts); the answer is written in as it comes.
  const send = call("POST", `${A}/chat/${enc(slug)}`, { message: SENT_WORDS }, {
    ok: seq(setState("sending", false), then ?? refresh, ...momentDone()),
    fail: failed({ busy: "sending", from: path, then: toast("Couldn't send that. Try again.", true) }),
  });
  return seq(...momentStart({ message: `$state.${path}`, from: path, busy: "sending" }), ctx ? streamed(ctx, send as ActionSpec) : send);
}
/** Sends a fixed line (a suggestion chip) and opens the chat with the answer. */
const askBot = (slug: string, message: string): ActionRef => seq(
  toast("Asking…"),
  call("POST", `${A}/chat/${enc(slug)}`, { message }, { ok: open(SCREENS.chat, { slug }), fail: toast("Couldn't send that. Try again.", true) }),
);

function chatBar(ctx: BotsCtx, slug: string, name: string, placeholder?: string, then?: ActionRef): Node {
  return col([
    askMoment(ctx, { slug, color: ctx.live.bots.find((b) => b.slug === slug)?.color ?? lookOf(slug).color, kind: botKind(slug), busy: "sending", line: `${name} is on it…` }),
    sendField("say", "say", placeholder ?? (isDesk(ctx) ? `Ask ${name}…  or hold Fn and speak` : `Ask ${name}…`), sendToBot(slug, "say", then, ctx), { desk: isDesk(ctx) }),
  ], { gap: 8 });
}

/** What to try first, for a bot with no chat yet. */
function starters(slug: string, purpose: string): string[] {
  switch (slug) {
    case "plan": return ["Plan my week", "What's on tomorrow?"];
    case "travel": return ["Plan a weekend trip", "Trains to Pune on Saturday"];
    case "keybot": return ["Write a polite reply saying I'll be late", "Make this sound friendlier"];
    default: return ["What can you do?", purpose.length > 34 ? "Help me with what you're for" : purpose];
  }
}

// ===================================================================== bots.bot and bots.chat

interface BotPageData { bot?: BotView; memory?: Memory; linked?: Linked[]; turns?: Turn[] }

async function loadBot(ctx: BotsCtx, deps: Parameters<NonNullable<BotsScreen["load"]>>[1], turnsLimit: number): Promise<BotPageData> {
  const slug = slugParam(ctx);
  if (!slug) return {};
  const [bot, memory, linked, chat] = await Promise.all([
    deps.api<{ bot?: BotView }>("GET", `/v1/bots/${enc(slug)}`).then((r) => r.bot).catch(() => undefined),
    deps.api<Memory>("GET", `/v1/bots/${enc(slug)}/memory`).catch(() => undefined),
    deps.api<{ connectors: Linked[] }>("GET", `/v1/bots/${enc(slug)}/connectors`).then((r) => r.connectors).catch(() => undefined),
    deps.api<{ turns: Turn[] }>("GET", `${A}/chat/${enc(slug)}?limit=${turnsLimit}`).then((r) => r.turns).catch(() => undefined),
  ]);
  return { bot, memory, linked, turns: chat };
}

/** Tailzu's own calendar and to-dos, as a bot's apps (src/calendar/bots.ts); the old Google ids mean them now. */
const OWN_APP_LINE: Record<string, string> = {
  calendar: "Your days in X0 Bot", tasks: "Your to-dos in X0 Bot", "google-calendar": "Your days in X0 Bot", "google-tasks": "Your to-dos in X0 Bot",
};
/** Not offered in the Bots app: Tailzu keeps its own (routes/botsYou.ts). */
const NOT_OFFERED_APPS = new Set(["google-calendar", "google-tasks"]);

/** "Calendar, Reminders": the apps a bot uses, and its own skills, in a line. */
function usesLine(bot: BotView, linked: Linked[] | undefined): string {
  const apps = (linked ?? bot.skills.connectors.map((id) => ({ id, name: id, status: "connected" as const }))).map((l) => l.name.replace(/^Google /, ""));
  const own = [...(bot.skills.web ? ["Web"] : []), ...(bot.skills.research ? ["Research"] : []), ...(bot.skills.files ? ["Your files"] : [])];
  const all = [...apps, ...own];
  return all.length ? all.slice(0, 3).join(", ") + (all.length > 3 ? ` +${all.length - 3}` : "") : "Nothing yet";
}

function noBot(ctx: BotsCtx): ReturnType<typeof page> {
  return page(ctx, {
    back: true, title: "Bot", nav: "bots",
    body: [emptyState({ pose: "think", title: "Couldn't open this bot", body: "It may have been deleted, or the connection dropped.", action: { label: "Back to your bots", onPress: toTab("bots") } })],
  });
}

const apiLine = (slug: string) => `POST /v1/bots/${slug}/ask`;

/**
 * The phone's head of a bot's own page: back, the bot, its line in its colour (BotPage, PlanBot, TravelBot), and at
 * its right end the bot's own tiny bot where the build draws it (`buddy`, kit headerBuddy).
 */
function phoneHead(look: ReturnType<typeof lookOf>, name: string, line: string, lineColor?: string, buddy: Node[] = []): Node {
  return row([
    labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back"),
    botAvatar(look, 40),
    col([text(name, { size: 19, weight: 600, lineHeight: 24 }), text(line, { size: 12, weight: 500, color: lineColor ?? look.color, lineHeight: 16, lines: 1 })], { gap: 2, flexShrink: 1 }),
    ...(buddy.length ? [grow(), ...buddy] : []),
  ], { gap: 10 });
}

/** While a chat message is on its way to the bot and its answer is coming (sendToBot's `sending`): the bot thinks. */
const ANSWERING = { truthy: "sending" };

function botPhone(ctx: BotsCtx, d: BotPageData) {
  const bot = d.bot!;
  const look = lookOf(bot.slug, bot.colour);
  const turns = (d.turns ?? []).slice(-2);
  const facts = d.memory?.facts ?? [];
  const edit = open(SCREENS.edit, { slug: bot.slug });
  const info: Node[] = [
    listRow({ label: `Rules · ${bot.principles.length}`, value: bot.builtin ? "See" : "Edit", chevron: false, onPress: edit }),
    listRow({ label: `Uses · ${usesLine(bot, d.linked)}`, value: bot.builtin ? "See" : "Edit", chevron: false, onPress: edit }),
    listRow({ label: d.memory ? `Remembers · ${plural(facts.length, "thing")}` : "Remembers", value: "See", chevron: false, onPress: edit }),
    ...(bot.builtin ? [] : [col([
      row([text("Use from your own app", { size: 15, lineHeight: 20 }), grow(), meta("Keys", { size: 14 })]),
      mono(apiLine(bot.slug)),
    ], { gap: 8, paddingVertical: 14, paddingHorizontal: 16 }, open(SCREENS.keys, { slug: bot.slug }))]),
  ];
  return page(ctx, {
    title: bot.name, nav: bot.slug,
    body: [
      phoneHead(look, bot.name, stateLine(ctx, bot), undefined, headerBuddy(ctx, bot.slug, { color: look.color, lookTo: "down", thinkWhen: ANSWERING })),
      ...(turns.length
        ? [col(chatTurns(ctx, bot, turns), { gap: 14 }), ...(d.turns && d.turns.length > 2 ? [quietButton("See the whole chat", open(SCREENS.chat, { slug: bot.slug }), { size: "md" })] : [])]
        : [col([body(bot.purpose, { color: C.grey70 }), row(starters(bot.slug, bot.purpose).map((s) => chip(s, { onPress: askBot(bot.slug, s) })), { gap: 8, flexWrap: "wrap" })], { gap: 12 })]),
      listCard(info),
    ],
    footer: [chatBar(ctx, bot.slug, bot.name)],
  });
}

function asideSection(label: string, action: { label: string; onPress: ActionRef } | null, kids: Node[], last = false): Node {
  return col([
    row([sectionLabel(label), grow(), ...(action ? [link(action.label, action.onPress)] : [])], { minHeight: 32 }),
    ...kids,
  ], { gap: 8, paddingBottom: 18, ...(last ? {} : { borderBottomWidth: 1, borderBottomColor: C.divider }) });
}

function botDesk(ctx: BotsCtx, d: BotPageData) {
  const bot = d.bot!;
  const look = lookOf(bot.slug, bot.colour);
  const turns = d.turns ?? [];
  const facts = d.memory?.facts ?? [];
  const edit = open(SCREENS.edit, { slug: bot.slug });
  const uses: Node[] = [
    ...(d.linked ?? []).map((l) => row([text(l.name, { size: 13, lineHeight: 18 }), grow(), meta(l.status === "connected" ? "connected" : l.status === "not_connected" ? "not connected" : "not here", { size: 13 })])),
    row([text("Search the web", { size: 13, lineHeight: 18 }), grow(), meta(bot.skills.web ? "on" : "off", { size: 13 })]),
    row([text("Your files", { size: 13, lineHeight: 18 }), grow(), meta(bot.skills.files ? "on" : "off", { size: 13 })]),
  ];
  const aside = col([
    asideSection(`Rules · ${bot.principles.length}`, { label: bot.builtin ? "See" : "Edit", onPress: edit }, bot.principles.length ? bot.principles.slice(0, 6).map((p) => dotLine(p)) : [meta("No rules yet. Plain words work.", { size: 13 })]),
    asideSection(`Uses · ${usesLine(bot, d.linked)}`, bot.builtin ? null : { label: "Edit", onPress: edit }, uses),
    asideSection(d.memory ? `Remembers · ${plural(facts.length, "thing")}` : "Remembers", { label: "See", onPress: edit },
      facts.length ? facts.slice(0, 5).map((f) => dotLine(f.text)) : [meta(d.memory ? "Nothing yet. It learns what you tell it about you." : "Couldn't read this just now.", { size: 13 })], bot.builtin),
    ...(bot.builtin ? [] : [asideSection("Use from your own app", { label: "Keys", onPress: open(SCREENS.keys, { slug: bot.slug }) }, [
      col([mono(apiLine(bot.slug), { boxed: false, size: 11.5 }), mono('{"message": "Plan my next week"}', { boxed: false, size: 11.5, color: C.meta })], { backgroundColor: C.surface, borderRadius: 10, padding: 12, gap: 2 }),
      meta("Same rules as here. Your memory stays with you.", { size: 12 }),
    ], true)]),
  ], { width: 300, flexShrink: 0, paddingLeft: 24, borderLeftWidth: 1, borderLeftColor: C.divider, gap: 18 });
  const chat = col([
    col(turns.length
      ? chatTurns(ctx, bot, turns, { days: true })
      : [col([body(bot.purpose, { color: C.grey70 }), row(starters(bot.slug, bot.purpose).map((s) => chip(s, { onPress: askBot(bot.slug, s) })), { gap: 8, flexWrap: "wrap" })], { gap: 12 })],
    { gap: 16, maxWidth: 640, width: "100%" }),
    grow(),
    box([chatBar(ctx, bot.slug, bot.name)], { maxWidth: 640, width: "100%" }),
  ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 20, minHeight: 520 });
  return page(ctx, {
    title: bot.name, nav: bot.slug, maxWidth: 1040,
    body: [
      row([
        botAvatar(look, 48),
        col([title(bot.name, { size: 24, lineHeight: 30 }), meta(stateLine(ctx, bot), { size: 13 })], { gap: 2, flexGrow: 1, flexShrink: 1 }),
        ...headerBuddy(ctx, bot.slug, { color: look.color, lookTo: "down", thinkWhen: ANSWERING }),
        ...(turns.length ? [quietButton("Clear chat", write("DELETE", `${A}/chat/${enc(bot.slug)}`, undefined, { ok: "Chat cleared" }), { size: "md" })] : []),
        secondaryButton(bot.builtin ? "See its rules" : "Edit bot", edit, { size: "md" }),
      ], { gap: 14 }),
      row([chat, aside], { gap: 28, alignItems: "stretch" }),
    ],
  });
}

function chatPage(ctx: BotsCtx, d: BotPageData) {
  const bot = d.bot!;
  const look = lookOf(bot.slug, bot.colour);
  if (bot.slug === "code") {
    return page(ctx, { back: true, title: "Code bot", nav: "code", body: [emptyState({ pose: "think", title: "The Code bot talks on its own page", body: "It reads your projects and answers there.", action: { label: "Open the Code bot", onPress: open(SCREENS.code) } })] });
  }
  const turns = d.turns ?? [];
  // The bot's own tiny bot at the head's right end: it thinks while an answer comes, and glances down at the field.
  const buddy = headerBuddy(ctx, bot.slug, { color: look.color, lookTo: "down", thinkWhen: ANSWERING });
  const head = row([
    botAvatar(look, 30),
    col([text(bot.name, { size: 17, weight: 600, lineHeight: 22 }), meta(stateLine(ctx, bot), { size: 12, lines: 1 })], { gap: 1, flexShrink: 1 }),
    ...(buddy.length ? [grow(), ...buddy] : []),
  ], { gap: 10 });
  const phoneTop = row([
    labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back"),
    col([text(bot.name, { size: 17, weight: 600, lineHeight: 22 }), meta(stateLine(ctx, bot), { size: 12, lines: 1 })], { gap: 1, flexShrink: 1 }),
    ...(buddy.length ? [grow(), ...buddy] : []),
  ], { gap: 6 });
  return page(ctx, {
    back: isDesk(ctx), title: bot.name, nav: bot.slug, ...(isDesk(ctx) ? { maxWidth: 720 } : {}),
    // Pull-a-bot at both ends: what is new is a turn, and new turns land at the bottom.
    pullBot: { top: true, bottom: true, newAt: "bottom", ...(d.turns ? { items: d.turns.map((t) => t.id) } : {}) },
    body: [
      ...(isDesk(ctx) ? [head] : [phoneTop]),
      ...(turns.length
        ? chatTurns(ctx, bot, turns, { big: !isDesk(ctx), days: isDesk(ctx) || turns.length > 6 })
        : [emptyState({ pose: "listen", title: `Ask ${bot.name} anything`, body: bot.purpose })]),
    ],
    footer: [chatBar(ctx, bot.slug, bot.name)],
    gap: 18,
  });
}

// ===================================================================== bots.make

interface DraftDef { name: string; slug: string; colour: string; purpose: string; principles: string[]; skills: BotView["skills"]; tone: string }
interface Draft { definition: DraftDef; tests: string[]; connectors: Linked[]; warnings: string[] }
interface DraftView { sentence: string; draft: Draft; trial: Array<{ said: string; answered: string }>; updatedAt: number }

const EXAMPLES = [
  "A bot that plans my workouts around my calendar and reminds me the night before.",
  "A bot that plans my meals for the week, vegetarian.",
  "A bot that turns my class notes into a short quiz every evening.",
];
const ADD_LINES = ["Ask before it spends money", "Keep answers short", "Reply in Hinglish when I do"];

const drafting = (o: { then?: ActionRef } = {}): ActionRef => ifFilled("sentence", seq(
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
const approveDraft = (name: string): ActionRef => call("POST", `${A}/draft/approve`, {}, {
  assignTo: "made",
  ok: seq(toast(`${name} is ready`), { kind: "navigate", screenId: SCREENS.bot, params: { slug: "$state.made.bot.slug" }, replace: true }),
  fail: toast("Couldn't make it. Check the name and try again.", true),
});

function describeBox(_ctx: BotsCtx, size = 15): Node {
  return col([
    inputBox([field("sentence", "sentence", EXAMPLES[0]!, { multiline: true, size })], { ink: true, radius: 18 }),
    when({ truthy: "drafting" }, row([statusMark("working", { color: C.ink }), meta("Drafting your bot…", { size: 13 })], { gap: 8 })),
  ], { gap: 10 });
}

/** The draft as a card: its look, the colours, its rules, what it can use, what it won't do. */
function draftCard(_ctx: BotsCtx, v: DraftView, o: { desk?: boolean } = {}): Node {
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
function labelledIcon(name: Parameters<typeof icon>[0], onPress: ActionRef, label: string, size = 36): Node {
  return labelled(box([icon(name, { size: 16, color: C.meta })], { width: size, height: size, alignItems: "center", justifyContent: "center", flexShrink: 0 }, onPress), label);
}

function trialPart(ctx: BotsCtx, v: DraftView): Node[] {
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

function makePhone(ctx: BotsCtx, v: DraftView | null | undefined) {
  if (!v) {
    return page(ctx, {
      back: true, title: "Make a bot", nav: "make", state: { sentence: "" },
      body: [
        title("Make a bot"),
        meta("Say what it should do. It shows you the plan before it acts.", { size: 14 }),
        describeBox(ctx),
        col([sectionLabel("Or start from"), ...EXAMPLES.slice(1).map((e) => chip(e, { onPress: setState("sentence", e) }))], { gap: 8 }),
        ...(v === undefined ? [notice("Couldn't load your draft. What you type now starts a new one.")] : []),
      ],
      footer: [primaryButton("Draft it", drafting(), { wide: true })],
    });
  }
  const d = v.draft.definition;
  return page(ctx, {
    back: true, title: "Make a bot", nav: "make", state: { sentence: v.sentence, d_web: d.skills.web, d_files: d.skills.files },
    body: [
      row([title("Make a bot"), grow(), quietButton("Start over", write("DELETE", `${A}/draft`, undefined, { ok: "Draft cleared" }), { size: "md" })]),
      box([text(v.sentence, { size: 15, lineHeight: 21 })], { borderWidth: 1, borderColor: C.ink, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16 }),
      draftCard(ctx, v),
      col([sectionLabel("Try it first"), ...trialPart(ctx, v)], { gap: 10 }),
    ],
    footer: [primaryButton(`Make ${d.name}`, approveDraft(d.name), { wide: true })],
  });
}

function makeDesk(ctx: BotsCtx, v: DraftView | null | undefined) {
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
    title: "Make a bot", nav: "make", maxWidth: 1180, state: { sentence: v?.sentence ?? "", ...(d ? { d_web: d.skills.web, d_files: d.skills.files } : {}) },
    body: [
      row([col([title("Make a bot"), meta("Say what it should do. It shows you the plan before it acts.", { size: 14 })], { gap: 4 }), grow(),
        ...(v ? [meta(`Draft saved · ${clockOf(ctx, v.updatedAt)}`, { size: 12 })] : [])], { alignItems: "flex-end" }),
      row([describe, live, tryCol], { gap: 24, alignItems: "flex-start" }),
    ],
  });
}

// ===================================================================== bots.edit

interface EditData extends BotPageData { apps?: App[]; mine?: Array<{ slug: string; colour: string; name: string; builtin: boolean }>; listed?: boolean }

const botPut = (slug: string, b: Record<string, unknown>, ok?: string) => write("PUT", `/v1/bots/${enc(slug)}`, b, { ok, fail: "Couldn't save that. Try again." });

function editParts(_ctx: BotsCtx, d: EditData) {
  const bot = d.bot!;
  const slug = bot.slug;
  const takenBy = new Map<string, string>(Object.entries(BUILTIN_COLOUR));
  for (const b of d.mine ?? []) if (!b.builtin && b.slug !== slug) takenBy.set(b.colour, b.name.replace(/ bot$/i, ""));
  const facts = d.memory?.facts ?? [];
  const saveName = ifFilled("name", call("PUT", `/v1/bots/${enc(slug)}`, { name: "$state.name" }, { ok: seq(toast("Saved"), refresh), fail: toast("Couldn't save the name. Try again.", true) }), "A bot needs a name");
  const addRule = ifFilled("rule", seq(call("POST", `${A}/rules/${enc(slug)}`, { rule: "$state.rule" }, { ok: seq(clearState("rule"), refresh), fail: toast("Couldn't add that rule. Keep it to one short line.", true) })), "Write the rule first");

  const nameField = inputBox([field("name", "name", bot.name, { onSubmit: saveName })], { radius: 14 });
  const colours = col([
    row(ALL_COLOURS.map((c) => colourDot(c, { chosen: bot.colour === c, taken: takenBy.get(c), onPress: botPut(slug, { colour: c }) })), { gap: 4, flexWrap: "wrap" }),
  ], { gap: 6 });
  const takenLine = `Crossed out: another bot has it (${[...new Set(takenBy.values())].join(", ")})`;

  const ruleRows: Node[] = [
    ...bot.principles.map((p, i) => row([text(p, { size: 14, lineHeight: 19, style: { flexShrink: 1 } }), grow(), ...(bot.builtin ? [] : [labelledIcon("close", write("DELETE", `${A}/rules/${enc(slug)}/${i}`, undefined, { ok: "Rule removed" }), "Remove this rule")])], { gap: 8, paddingVertical: 10, paddingLeft: 16, paddingRight: 8, minHeight: 44 })),
    ...(bot.builtin ? [] : [row([field("rule", "rule", "Add a rule", { onSubmit: addRule }), roundButton("plus", addRule, { size: 34, label: "Add rule", light: true })], { gap: 8, paddingLeft: 16, paddingRight: 8, minHeight: 48 })]),
  ];
  const rules = listCard(ruleRows.length ? ruleRows : [listRow({ label: "No rules" })]);

  const linkedIds = new Set(bot.skills.connectors);
  const apps = new Map<string, { name: string; sub: string; on: boolean; connected: boolean }>();
  for (const l of d.linked ?? []) apps.set(l.id, { name: l.name, sub: OWN_APP_LINE[l.id] ?? (l.status === "connected" ? "Connected" : l.status === "not_connected" ? "Not connected yet" : "Not on this server"), on: true, connected: l.status === "connected" });
  // Tailzu's own calendar and to-dos: always there, nothing to connect (the Google ones are no longer offered).
  for (const id of ["calendar", "tasks"]) if (!apps.has(id) && !apps.has(`google-${id}`)) apps.set(id, { name: id === "calendar" ? "Calendar" : "Tasks", sub: OWN_APP_LINE[id]!, on: false, connected: true });
  for (const a of d.apps ?? []) if (a.connected && !apps.has(a.id) && !NOT_OFFERED_APPS.has(a.id)) apps.set(a.id, { name: a.name, sub: a.oneLine ?? "Connected", on: linkedIds.has(a.id), connected: true });
  const state: Record<string, unknown> = { name: bot.name, rule: "", s_web: bot.skills.web, s_files: bot.skills.files, s_listed: d.listed === true };
  const toolRows: Node[] = [
    switchRow("Search the web", "s_web", { sub: bot.skills.web ? "Finds and reads pages for you" : "Off · it never goes online", onChange: botPut(slug, { skills: { web: !bot.skills.web } }) }),
    switchRow("Your files", "s_files", { sub: bot.skills.files ? "Reads files you give it" : "Off · it never reads your files", onChange: botPut(slug, { skills: { files: !bot.skills.files } }) }),
    ...[...apps.entries()].map(([id, a], i) => {
      state[`a_${i}`] = a.on;
      return switchRow(a.name, `a_${i}`, { sub: a.sub, onChange: write(a.on ? "DELETE" : "PUT", `/v1/bots/${enc(slug)}/connectors/${enc(id)}`, undefined, { fail: "Couldn't change that app. Try again." }) });
    }),
  ];
  const memRows: Node[] = facts.map((f) => row([text(f.text, { size: 14, lineHeight: 19, style: { flexShrink: 1 } }), grow(), labelledIcon("close", write("DELETE", `/v1/bots/${enc(slug)}/memory/${enc(f.id)}`, undefined, { ok: "Forgotten" }), "Forget this")], { gap: 8, paddingVertical: 8, paddingLeft: 16, paddingRight: 8, minHeight: 44 }));
  const memory = memRows.length
    ? listCard([...memRows, row([quietButton("Forget everything", write("DELETE", `/v1/bots/${enc(slug)}/memory`, undefined, { ok: "Forgotten" }), { size: "md" })], { paddingHorizontal: 4 })])
    : card([meta(d.memory ? `Nothing yet. ${bot.name} learns what you tell it about you, and you can forget any of it here.` : "Couldn't read what it remembers just now.", { size: 13 })], { dashed: true });
  const listing = bot.builtin ? null : switchRow("In Find a bot", "s_listed", {
    sub: d.listed ? "Listed · people can add a copy of it" : "People could add a copy: its name, rules and apps. Never your memory, files or keys.",
    onChange: write(d.listed ? "DELETE" : "PUT", `${A}/listing/${enc(slug)}`, undefined, { ok: d.listed ? "Taken off Find a bot" : "Listed in Find a bot" }),
  });
  const del = quietButton("Delete this bot", call("DELETE", `/v1/bots/${enc(slug)}`, undefined, { ok: seq(toast(`${bot.name} deleted`), toTab("bots")), fail: toast("Couldn't delete it. Try again.", true) }), { size: "md" });
  return { saveName, nameField, colours, takenLine, rules, toolRows, memory, listing, del, state, facts };
}

function editPhone(ctx: BotsCtx, d: EditData) {
  const bot = d.bot!;
  const look = lookOf(bot.slug, bot.colour);
  const p = editParts(ctx, d);
  const done = bot.builtin ? back() : call("PUT", `/v1/bots/${enc(bot.slug)}`, { name: "$state.name" }, { ok: back(), fail: toast("Couldn't save the name. Try again.", true) });
  return page(ctx, {
    title: `Edit ${bot.name}`, nav: bot.slug, state: p.state,
    body: [
      row([
        box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()),
        botAvatar(look, 36), text(bot.builtin ? bot.name : `Edit ${bot.name}`, { size: 19, weight: 600, lineHeight: 24, lines: 1, style: { flexShrink: 1 } }), grow(),
        row([text("Done", { size: 15, weight: 600, lineHeight: 20 })], { minHeight: 44, paddingHorizontal: 4 }, done),
      ], { gap: 10 }),
      ...(bot.builtin ? [notice("One of X0 Bot's own bots: its rules are fixed. What it remembers is yours to forget.")] : [
        col([sectionLabel("Name"), p.nameField], { gap: 8 }),
        col([sectionLabel("Colour"), p.colours, meta(p.takenLine, { size: 12 })], { gap: 8 }),
      ]),
      col([sectionLabel(`Rules · ${bot.principles.length}`), p.rules], { gap: 8 }),
      ...(bot.builtin ? [] : [col([sectionLabel("Tools and apps"), listCard(p.toolRows)], { gap: 8 })]),
      ...(p.listing ? [listCard([p.listing])] : []),
      col([sectionLabel(d.memory ? `It remembers · ${p.facts.length}` : "It remembers"), p.memory], { gap: 8 }),
      ...(bot.builtin ? [] : [p.del]),
    ],
  });
}

function settingRow(label: string, sub: string, control: Node, last = false): Node {
  return row([
    col([sectionLabel(label), meta(sub, { size: 12, lineHeight: 17 })], { width: 172, flexShrink: 0, gap: 6 }),
    box([control], { flexGrow: 1, flexShrink: 1, minWidth: 0 }),
  ], { gap: 24, alignItems: "flex-start", paddingVertical: 20, ...(last ? {} : { borderBottomWidth: 1, borderBottomColor: C.divider }) });
}

function editDesk(ctx: BotsCtx, d: EditData) {
  const bot = d.bot!;
  const look = lookOf(bot.slug, bot.colour);
  const p = editParts(ctx, d);
  const last = (d.turns ?? []).slice(-2);
  const preview = col([
    row([sectionLabel("Live preview"), grow(), meta("Its latest answer", { size: 12 })]),
    card([
      row([botAvatar(look, 40), col([text(bot.name, { size: 15, weight: 600, lineHeight: 20 }), text(bot.purpose, { size: 13, color: C.grey70, lineHeight: 18, lines: 2 })], { gap: 2, flexShrink: 1 })], { gap: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.divider }),
      ...(last.length ? chatTurns(ctx, bot, last) : [meta(`Ask ${bot.name} something and its answer shows here, with your rules in it.`, { size: 13 }), button(`Talk to ${bot.name}`, open(SCREENS.chat, { slug: bot.slug }), { kind: "secondary", size: "md" })]),
      ...(last.length ? [row(bot.principles.slice(0, 4).map((r) => box([text(r.length > 24 ? `${r.slice(0, 23)}…` : r, { size: 11.5, color: C.grey70, lineHeight: 15 })], { backgroundColor: C.surface, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8 })), { gap: 6, flexWrap: "wrap", paddingTop: 10, borderTopWidth: 1, borderTopColor: C.divider })] : []),
    ], { gap: 12 }),
    ...(bot.builtin ? [] : [col([p.del, meta(`Removes its rules and what it remembers. Your apps stay as they are.`, { size: 12 })], { gap: 2, alignItems: "flex-start" })]),
  ], { width: 330, flexShrink: 0, gap: 12 });
  const settings = col([
    ...(bot.builtin ? [notice("One of X0 Bot's own bots: its rules are fixed. What it remembers is yours to forget.")] : [
      settingRow("Name", "Shown in your bot list and in Spaces.", p.nameField),
      settingRow("Colour", p.takenLine, p.colours),
    ]),
    settingRow(`Rules · ${bot.principles.length}`, `${bot.name} follows these every time. Plain words work.`, p.rules),
    ...(bot.builtin ? [] : [settingRow("Tools and apps", "It asks before it uses an app for the first time.", listCard(p.toolRows))]),
    ...(p.listing ? [settingRow("Find a bot", "Share a copy with everyone. Turn it off any time.", listCard([p.listing]))] : []),
    settingRow(d.memory ? `It remembers · ${p.facts.length}` : "It remembers", "Learned from your chats. Forget anything, any time.", p.memory, true),
  ], { flexGrow: 1, flexShrink: 1, minWidth: 0 });
  return page(ctx, {
    title: `Edit ${bot.name}`, nav: bot.slug, maxWidth: 1080, state: p.state,
    body: [
      row([
        col([
          row([botAvatar(look, 22), text(bot.name, { size: 13, color: C.grey70, lineHeight: 18 })], { gap: 8, minHeight: 32 }, back()),
          row([botAvatar(look, 36), title(bot.builtin ? bot.name : `Edit ${bot.name}`, { size: 26 })], { gap: 12 }),
        ], { gap: 4 }),
        grow(),
        meta(bot.builtin ? "Read only" : "Changes save as you go", { size: 12 }),
        button("Done", bot.builtin ? back() : call("PUT", `/v1/bots/${enc(bot.slug)}`, { name: "$state.name" }, { ok: back(), fail: toast("Couldn't save the name. Try again.", true) }), { size: "md" }),
      ], { gap: 14, alignItems: "flex-end" }),
      row([settings, preview], { gap: 32, alignItems: "flex-start" }),
    ],
  });
}

// ===================================================================== bots.keys

interface KeyView { id: string; label: string; masked: string; createdAt: number; lastUsedAt: number | null; revokedAt: number | null; active: boolean }
interface Usage { usage: { month: string; requests: number; paise: number; byKey: Record<string, { requests: number; paise: number; lastAt: number }>; days: Array<{ day: string; requests: number }> }; ratePerMin: number; dayCapPaise: number; endpoint: string }
interface KeysData { bot?: BotView; keys?: KeyView[]; usage?: Usage }

const snippets = (endpoint: string, ask: string) => ({
  curl: `curl -X POST \\\n  ${endpoint} \\\n  -H "Authorization: Bearer $TZ_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"message":"${ask}"}'`,
  js: `const r = await fetch("${endpoint}", {\n  method: "POST",\n  headers: { Authorization: \`Bearer \${process.env.TZ_KEY}\`,\n    "Content-Type": "application/json" },\n  body: JSON.stringify({ message: "${ask}" }),\n});\nconst { text } = await r.json();`,
  py: `import os, requests\nr = requests.post("${endpoint}",\n  headers={"Authorization": f"Bearer {os.environ['TZ_KEY']}"},\n  json={"message": "${ask}"})\nprint(r.json()["text"])`,
});
const copyAction = (ctx: BotsCtx, s: string): ActionSpec => (isDesk(ctx) ? { kind: "copyText", text: s, message: "Copied" } : { kind: "copyToClipboard", text: s, toastMessage: "Copied" });
const codeBlock = (s: string): Node => box([text(s, { size: 11.5, mono: true, color: C.grey70, lineHeight: 18 })], { backgroundColor: C.surface, borderRadius: 12, padding: 14 });

function keysParts(ctx: BotsCtx, d: KeysData) {
  const bot = d.bot!;
  const u = d.usage?.usage;
  const keys = (d.keys ?? []).filter((k) => k.active);
  const endpoint = d.usage?.endpoint ?? `/v1/bots/${bot.slug}/ask`;
  const create = seq(
    call("POST", `/v1/bots/${enc(bot.slug)}/keys`, { label: "$state.label" }, { assignTo: "made", ok: seq(toast("Key made. Copy it now."), clearState("label")), fail: toast("Couldn't make a key. Try again.", true) }),
  );
  const revoke = (k: KeyView) => write("DELETE", `/v1/bots/${enc(bot.slug)}/keys/${enc(k.id)}`, undefined, { ok: `${k.label || "Key"} revoked` });
  const keyUse = (k: KeyView) => u?.byKey[k.masked];
  const keyMeta = (k: KeyView) => `Made ${shortDate(ctx, k.createdAt)} · ${k.lastUsedAt ? `used ${ago(ctx, k.lastUsedAt)}` : "not used yet"}`;
  const made = when({ truthy: "made.key" }, card([
    row([statusMark("done"), text("Your new key. It's shown this once.", { size: 13, weight: 600, lineHeight: 18 })], { gap: 8 }),
    box([text("", { size: 12, mono: true, lineHeight: 18, bind: "made.key" })], { backgroundColor: C.surface, borderRadius: 10, padding: 12 }),
    button("Copy key", copyAction(ctx, "$state.made.key"), { kind: "secondary", size: "md", icon: "check" }),
  ], { gap: 10 }));
  const labelField = inputBox([field("label", "label", "Name it: Website, Testing…", { onSubmit: create })], { radius: 14 });
  return { bot, u, keys, endpoint, create, revoke, keyUse, keyMeta, made, labelField };
}

function keysPhone(ctx: BotsCtx, d: KeysData) {
  const k = keysParts(ctx, d);
  const look = lookOf(k.bot.slug, k.bot.colour);
  const snip = snippets(k.endpoint, "Plan my next week");
  return page(ctx, {
    title: "Use it from your app", nav: k.bot.slug, state: { label: "" },
    body: [
      row([labelled(box([icon("back", { size: 24 })], { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" }, back()), "Back"), botAvatar(look, 30), text(k.bot.name, { size: 14, color: C.grey70, lineHeight: 18 })], { gap: 8 }),
      col([title("Use it from your app"), meta(`Your site or app asks ${k.bot.name}. Same rules as here.`, { size: 13 })], { gap: 4 }),
      card([
        grid([
          col([text(k.u ? k.u.requests.toLocaleString("en-IN") : "—", { size: 34, weight: 700, lineHeight: 38, tracking: -0.5 }), meta(k.u ? `requests in ${k.u.month}` : "couldn't read usage", { size: 12 })], { gap: 2 }),
          col([text(d.usage ? String(d.usage.ratePerMin) : "—", { size: 34, weight: 700, lineHeight: 38, tracking: -0.5 }), meta("a minute, for each key", { size: 12 })], { gap: 2 }),
        ], 2, 12),
        divider(),
        row([text("What it uses", { size: 14, lineHeight: 19 }), grow(), meta("Counts toward your plan", { size: 14 })]),
      ], { gap: 14 }),
      k.made,
      col([sectionLabel(`Keys · ${k.keys.length}`), k.keys.length
        ? listCard(k.keys.map((key) => row([
          col([row([text(key.label || "Key", { size: 14, weight: 600, lineHeight: 19 }), mono(key.masked, { size: 11.5 })], { gap: 8, flexWrap: "wrap" }), meta(k.keyMeta(key), { size: 12 })], { gap: 4, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
          row([text("Revoke", { size: 13, color: C.grey70, lineHeight: 18 })], { minHeight: 44, paddingHorizontal: 4 }, k.revoke(key)),
        ], { gap: 10, paddingVertical: 12, paddingHorizontal: 16 })))
        : card([meta("No keys yet. Make one to call this bot from your own site or app.", { size: 13 })], { dashed: true })], { gap: 8 }),
      col([sectionLabel("Endpoint"), mono(`POST ${k.endpoint}`, { size: 11.5 })], { gap: 8 }),
      col([row([sectionLabel("Try it"), grow(), link("Copy", copyAction(ctx, snip.curl))]), codeBlock(snip.curl)], { gap: 8 }),
      k.labelField,
    ],
    footer: [primaryButton("Create key", k.create, { wide: true }), meta("You see a new key once. Each key has a daily limit.", { size: 12, align: "center" })],
  });
}

function keysDesk(ctx: BotsCtx, d: KeysData) {
  const k = keysParts(ctx, d);
  const look = lookOf(k.bot.slug, k.bot.colour);
  const days = k.u?.days ?? [];
  const top = Math.max(1, ...days.map((x) => x.requests));
  const busiest = days.reduce<{ day: string; requests: number } | null>((b, x) => (x.requests > (b?.requests ?? 0) ? x : b), null);
  const bars = row(days.map((x, i) => box([], {
    flexGrow: 1, flexBasis: 0, minWidth: 0, height: Math.max(4, Math.round((x.requests / top) * 100)), borderRadius: 2,
    backgroundColor: i === days.length - 1 ? look.color : C.outline,
  })), { gap: 3, alignItems: "flex-end", height: 104, borderBottomWidth: 1, borderBottomColor: C.line });
  const snip = snippets(k.endpoint, "Plan my next week");
  const usage = card([
    grid([
      col([text(k.u ? k.u.requests.toLocaleString("en-IN") : "—", { size: 34, weight: 700, lineHeight: 38, tracking: -0.5 }), meta(k.u ? `requests in ${k.u.month}` : "couldn't read usage", { size: 12 })], { gap: 2 }),
      col([text("Rate limit", { size: 14, weight: 600, lineHeight: 19 }), text(d.usage ? `${d.usage.ratePerMin} a minute` : "—", { size: 13, color: C.grey70, lineHeight: 18 }), meta("And a daily limit for each key", { size: 12 })], { gap: 4 }),
      col([text("What it uses", { size: 14, weight: 600, lineHeight: 19 }), text("Your plan", { size: 13, color: C.grey70, lineHeight: 18 }), meta("It counts toward Usage, in You", { size: 12 })], { gap: 4 }),
    ], 3, 16),
    col([
      row([sectionLabel("Requests a day"), grow(), meta(busiest ? `Busiest: ${Number(busiest.day.slice(8))} ${MONTHS[Number(busiest.day.slice(5, 7)) - 1]}, ${busiest.requests}` : "None yet this month", { size: 12 })]),
      days.length ? bars : meta("—", { size: 12 }),
      ...(days.length ? [row([meta(`1 ${MONTHS[Number(days[0]!.day.slice(5, 7)) - 1]}`, { size: 11 }), grow(), text("Today", { size: 11, weight: 500, lineHeight: 14 })])] : []),
    ], { gap: 10, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.divider }),
  ], { gap: 16 });
  const keyTable = k.keys.length ? col([
    row([sectionLabel("Name", { style: { flexGrow: 1, flexBasis: 0 } }), sectionLabel("Key", { style: { width: 128 } }), sectionLabel("Last used", { style: { width: 80 } }), sectionLabel(k.u?.month ?? "This month", { style: { width: 100 } }), box([], { width: 52 })], { paddingVertical: 10, paddingHorizontal: 16, gap: 12 }),
    ...k.keys.flatMap((key) => {
      const use = k.keyUse(key);
      return [divider(), row([
        col([text(key.label || "Key", { size: 14, weight: 600, lineHeight: 19, lines: 1 }), meta(`Made ${shortDate(ctx, key.createdAt)}`, { size: 12, lines: 1 })], { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 2 }),
        box([mono(key.masked, { size: 11.5 })], { width: 128 }),
        text(key.lastUsedAt ? ago(ctx, key.lastUsedAt) : "Not yet", { size: 13, color: C.grey70, lineHeight: 18, style: { width: 80 } }),
        text(use ? use.requests.toLocaleString("en-IN") : "0", { size: 13, color: C.grey70, lineHeight: 18, style: { width: 100 } }),
        row([text("Revoke", { size: 13, color: C.grey70, lineHeight: 18 })], { width: 52, minHeight: 32 }, k.revoke(key)),
      ], { paddingVertical: 12, paddingHorizontal: 16, gap: 12 })];
    }),
  ], { borderWidth: 1, borderColor: C.line, borderRadius: 18, overflow: "hidden" }) : card([meta("No keys yet. Make one to call this bot from your own site or app.", { size: 13 })], { dashed: true });
  const tryIt = card([
    col([sectionLabel("Endpoint"), box([row([text("POST", { size: 11.5, mono: true, weight: 500, lineHeight: 17 }), text(k.endpoint, { size: 11.5, mono: true, color: C.grey70, lineHeight: 17, style: { flexShrink: 1 } })], { gap: 8, alignItems: "flex-start" })], { backgroundColor: C.surface, borderRadius: 8, padding: 10 })], { gap: 8 }),
    row([box([segmented([{ label: "curl", value: "curl" }, { label: "JavaScript", value: "js" }, { label: "Python", value: "py" }], "lang")], { flexGrow: 1 }),
      when({ eq: ["lang", "curl"] }, button("Copy", copyAction(ctx, snip.curl), { kind: "secondary", size: "md" })),
      when({ eq: ["lang", "js"] }, button("Copy", copyAction(ctx, snip.js), { kind: "secondary", size: "md" })),
      when({ eq: ["lang", "py"] }, button("Copy", copyAction(ctx, snip.py), { kind: "secondary", size: "md" }))], { gap: 10 }),
    when({ eq: ["lang", "curl"] }, codeBlock(snip.curl)),
    when({ eq: ["lang", "js"] }, codeBlock(snip.js)),
    when({ eq: ["lang", "py"] }, codeBlock(snip.py)),
    col([row([sectionLabel("Reply"), grow(), meta("JSON", { size: 12 })]), codeBlock(`{\n  "bot": "${k.bot.slug}",\n  "text": "…its answer…"\n}`)], { gap: 8 }),
  ], { gap: 14, style: { width: 390, flexShrink: 0 } });
  return page(ctx, {
    title: "Use it from your app", nav: k.bot.slug, maxWidth: 1120, state: { label: "", lang: "curl" },
    body: [
      row([
        col([
          row([botAvatar(look, 22), text(k.bot.name, { size: 13, color: C.grey70, lineHeight: 18 })], { gap: 8, minHeight: 32 }, back()),
          title("Use it from your app", { size: 26 }), meta(`Your site or app asks ${k.bot.name}. Same rules as here.`, { size: 14 }),
        ], { gap: 4, flexGrow: 1, flexShrink: 1 }),
        col([row([box([k.labelField], { width: 240 }), button("Create key", k.create, { size: "md" })], { gap: 10 }), meta("You see a new key once. Each key has a daily limit.", { size: 12 })], { gap: 6, alignItems: "flex-end" }),
      ], { gap: 20, alignItems: "flex-end" }),
      k.made,
      row([col([usage, col([sectionLabel(`Keys · ${k.keys.length}`), keyTable], { gap: 8 })], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 24 }), tryIt], { gap: 24, alignItems: "flex-start" }),
    ],
  });
}

// ===================================================================== bots.store

interface ShopEntry { id: string; kind: "ready" | "people"; slug?: string; name: string; colour: string; purpose: string; by: string; adds: number; status: "yours" | "added" | null; does: string[]; will: string; wont: string; apps: string[] }
interface Shop { readyMade: ShopEntry[]; people: ShopEntry[] }

const count = (n: number) => (n >= 20_000 ? `${Math.round(n / 1000)}k` : n >= 10_000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : n.toLocaleString("en-IN"));
const usedBy = (e: ShopEntry) => `${e.by === "you" ? "By you" : e.kind === "ready" ? "X0 Bot" : `By ${e.by}`} · ${e.adds ? `${count(e.adds)} use it` : "new"}`;
const addEntry = (e: ShopEntry): ActionRef => call("POST", `${A}/store/${enc(e.id)}/add`, {}, { assignTo: "added", ok: seq(toast(`${e.name} added to your bots`), refresh), fail: toast("Couldn't add it. Try again.", true) });
const shopLook = (e: ShopEntry) => lookOf(e.slug ?? e.name.toLowerCase().replace(/\s+/g, "-"), e.colour);
function entryAction(e: ShopEntry, wide = false): Node {
  if (e.status === "yours") return text("Yours", { size: 13, color: C.meta, lineHeight: 18 });
  if (e.status === "added") return text("In Home", { size: 13, color: C.meta, lineHeight: 18 });
  return button("Add", addEntry(e), { kind: "secondary", size: "md", wide });
}

function storeRow(e: ShopEntry, last: boolean): Node {
  return row([
    row([botAvatar(shopLook(e), 40), col([text(e.name, { size: 15, weight: 600, lineHeight: 20 }), text(e.purpose, { size: 13, color: C.grey70, lineHeight: 18, lines: 2 }), meta(usedBy(e), { size: 12 })], { gap: 2, flexShrink: 1, minWidth: 0 })],
      { gap: 12, flexGrow: 1, flexShrink: 1, minWidth: 0 }, open(SCREENS.store, { id: e.id })),
    entryAction(e),
  ], { gap: 10, paddingVertical: 12, ...(last ? {} : { borderBottomWidth: 1, borderBottomColor: C.divider }) });
}

function entryDetail(e: ShopEntry, o: { wide?: boolean } = {}): Node[] {
  return [
    row([botAvatar(shopLook(e), 52), col([text(e.name, { size: 20, weight: 700, lineHeight: 25 }), meta(usedBy(e), { size: 12 })], { gap: 2, flexShrink: 1 })], { gap: 14 }),
    text(e.purpose, { size: 14, color: C.grey70, lineHeight: 20 }),
    e.status ? infoChip(e.status === "yours" ? "You listed this one" : "Already in your bots") : primaryButton(`Add ${e.name}`, addEntry(e), { wide: true, size: o.wide ? "lg" : "md" }),
    ...(e.does.length ? [col([sectionLabel("What it does"), ...e.does.map((x) => row([box([], { width: 4, height: 4, borderRadius: 2, backgroundColor: C.ink, marginTop: 8 }), text(x.replace(/\.$/, ""), { size: 14, lineHeight: 20, style: { flexShrink: 1 } })], { gap: 10, alignItems: "flex-start" }))], { gap: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.divider })] : []),
    col([sectionLabel("Before it acts"),
      row([text("Will", { size: 13, weight: 600, lineHeight: 19, style: { width: 52 } }), text(e.will, { size: 13, color: C.grey70, lineHeight: 19, style: { flexShrink: 1 } })], { alignItems: "flex-start" }),
      row([text("Won't", { size: 13, weight: 600, lineHeight: 19, style: { width: 52 } }), text(e.wont, { size: 13, color: C.grey70, lineHeight: 19, style: { flexShrink: 1 } })], { alignItems: "flex-start" }),
    ], { gap: 6 }),
    ...(e.apps.length ? [col([sectionLabel("Apps it asks for"), row(e.apps.map((a) => box([text(a, { size: 11.5, color: C.grey70, lineHeight: 15 })], { backgroundColor: C.surface, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 9 })), { gap: 6, flexWrap: "wrap" })], { gap: 8 })] : []),
  ];
}

const plusDot = (): Node => box([icon("plus", { size: 20, color: C.paper })], { width: 40, height: 40, borderRadius: 20, backgroundColor: C.ink, alignItems: "center", justifyContent: "center" });
const makeOwn = (dash: boolean): Node => dash
  ? row([plusDot(), col([text("Make your own", { size: 16, weight: 600, lineHeight: 21 }), meta("Say what it should do. Ready in a minute.", { size: 13 })], { gap: 2, flexShrink: 1, flexGrow: 1 }), icon("chevron", { size: 16, color: C.meta })],
    { gap: 12, padding: 16, borderRadius: 18, borderWidth: 1.5, borderColor: C.idle, borderStyle: "dashed" }, open(SCREENS.make))
  : col([plusDot(), col([text("Make your own", { size: 15, weight: 600, lineHeight: 20 }), text("Say what it should do. Ready in a minute.", { size: 13, color: C.grey70, lineHeight: 18 })], { gap: 2 })],
    { gap: 10, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line, minHeight: 210, minWidth: 0 }, open(SCREENS.make));

const FILTERS = [{ label: "All", value: "all" }, { label: "Ready-made", value: "ready" }, { label: "Made by people", value: "people" }];

function storePhone(ctx: BotsCtx, d: Shop | undefined) {
  const id = String(ctx.params.id ?? "");
  const one = id && d ? [...d.readyMade, ...d.people].find((e) => e.id === id) : undefined;
  if (one) {
    return page(ctx, { back: true, title: one.name, nav: "bots", body: entryDetail(one, { wide: true }), footer: [meta("Every bot asks before it uses an app or spends money.", { size: 12, align: "center" })] });
  }
  const section = (label: string, list: ShopEntry[], show: string[]) => when({ in: ["filter", show] }, col([
    sectionLabel(label),
    ...(list.length ? list.map((e, i) => storeRow(e, i === list.length - 1)) : [meta(label === "Made by people" ? "Nobody has listed a bot yet. List yours from its settings." : "Nothing matches.", { size: 13 })]),
  ], { gap: 4 }));
  return page(ctx, {
    back: true, title: "Find a bot", nav: "bots", state: { filter: "all" },
    body: [
      title("Find a bot"),
      makeOwn(true),
      chips(FILTERS, "filter"),
      ...(d ? [section("Ready-made", d.readyMade, ["all", "ready"]), section("Made by people", d.people, ["all", "people"])]
        : [emptyState({ pose: "think", title: "Couldn't load the store", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]),
    ],
    footer: [meta("Every bot asks before it uses an app or spends money.", { size: 12, align: "center" })],
  });
}

function storeCard(e: ShopEntry, selected: boolean): Node {
  const look = shopLook(e);
  return col([
    col([
      botAvatar(look, 40),
      col([text(e.name, { size: 15, weight: 600, lineHeight: 20 }), text(e.purpose, { size: 13, color: C.grey70, lineHeight: 18, lines: 2 })], { gap: 2 }),
      meta(usedBy(e), { size: 12 }),
    ], { gap: 10 }, open(SCREENS.store, { id: e.id })),
    grow(),
    box([entryAction(e, true)], { minHeight: 36, justifyContent: "center" }),
  ], { padding: 16, gap: 12, borderRadius: 18, borderWidth: selected ? 1.5 : 1, borderColor: selected ? look.color : C.line, minWidth: 0, minHeight: 210 });
}

function storeDesk(ctx: BotsCtx, d: Shop | undefined) {
  const all = d ? [...d.readyMade, ...d.people] : [];
  const sel = all.find((e) => e.id === String(ctx.params.id ?? "")) ?? all[0];
  const q = String(ctx.params.q ?? "");
  const search = inputBox([icon("search", { size: 18, color: C.meta }), field("q", "q", "Try 'school', 'UPI' or 'groceries'", { onSubmit: { kind: "navigate", screenId: SCREENS.store, params: { q: "$state.q" }, replace: true } })], { radius: 22 });
  const section = (label: string, list: ShopEntry[], show: string[], extra: Node[] = []) => when({ in: ["filter", show] }, col([
    sectionLabel(`${label} · ${list.length}`),
    grid([...list.map((e) => storeCard(e, e.id === sel?.id)), ...extra], 3, 14),
  ], { gap: 10 }));
  return page(ctx, {
    title: "Find a bot", nav: "bots", maxWidth: 1120, state: { filter: "all", q },
    body: [
      row([col([row([text("Your bots", { size: 13, color: C.grey70, lineHeight: 18 })], { minHeight: 32 }, toTab("bots")), title("Find a bot", { size: 26 })], { gap: 4 }), grow(), box([search], { width: 340 })], { alignItems: "flex-end", gap: 16 }),
      row([chips(FILTERS, "filter"), grow(), meta("Every bot asks before it uses an app or spends money.", { size: 12 })], { gap: 12 }),
      ...(d ? [row([
        col([
          section("Ready-made", d.readyMade, ["all", "ready"]),
          section("Made by people", d.people, ["all", "people"], [makeOwn(false)]),
        ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 28 }),
        ...(sel ? [card(entryDetail(sel), { gap: 14, style: { width: 320, flexShrink: 0 } })] : []),
      ], { gap: 24, alignItems: "flex-start" })] : [emptyState({ pose: "think", title: "Couldn't load the store", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]),
    ],
  });
}

// ===================================================================== bots.plan

/** GET .../plan (src/botsBots/plan.ts): the person's own calendar and to-dos (src/calendar), nothing to connect. */
interface PlanEvent { id: string; title: string; start: number; end: number; allDay: boolean; where?: string; people: number; from?: string; fixed?: boolean; repeat?: string }
interface PlanTask { id: string; title: string; due: string; at?: number | null; done?: boolean; from?: string; fixed?: boolean }
interface PlanDay { key: string; events: PlanEvent[]; tasks: PlanTask[] }
interface Suggestion { key: string; eventId: string; title: string; question: string; detail: string; startIso: string; fromDay: string; toWords: string; savedMin?: number }
interface PlanRead { connected: { calendar: boolean; tasks: boolean }; today: string; tomorrow: string; week: string[]; days: PlanDay[]; suggestion: Suggestion | null; trouble?: string; travel?: places.PlanTravelView; open?: PlanTask[] }

const PLAN_WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const keyDate = (k: string) => new Date(`${k}T00:00:00Z`);
const keyWords = (k: string) => { const d = keyDate(k); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const lengthWords = (ms: number) => { const m = Math.round(ms / MIN); return m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`; };
const hourWords = (ctx: BotsCtx, ms: number) => clockOf(ctx, ms).replace(":00", "");

/** The week the page shows: `week` (weeks from this one), or the one `day` is in (a reminder opens its day), else this week. */
function planWeek(ctx: BotsCtx): number {
  const w = Number(ctx.params.week);
  if (ctx.params.week !== undefined && ctx.params.week !== "" && Number.isFinite(w)) return Math.max(-8, Math.min(8, Math.round(w)));
  const day = String(ctx.params.day ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 0;
  const monday = (k: string) => { const t = Date.parse(`${k}T00:00:00Z`); return t - ((new Date(t).getUTCDay() + 6) % 7) * DAY; };
  return Math.max(-8, Math.min(8, Math.round((monday(day) - monday(dayKeyOf(ctx, ctx.live.now))) / (7 * DAY))));
}
/** The day the phone shows: `day` when it was read, else tomorrow on this week, else the week's Monday. */
function planDay(ctx: BotsCtx, d: PlanRead): string {
  const p = String(ctx.params.day ?? "");
  if (d.days.some((x) => x.key === p)) return p;
  return planWeek(ctx) === 0 ? d.tomorrow : d.week[0] ?? d.tomorrow;
}
const dayLabelOf = (d: PlanRead, key: string) => (key === d.today ? "Today" : key === d.tomorrow ? "Tomorrow" : PLAN_WEEKDAYS_LONG[keyDate(key).getUTCDay()]!);
const planGo = (week: number, day?: string): ActionSpec => ({ kind: "navigate", screenId: SCREENS.plan, params: { week, ...(day ? { day } : {}) }, replace: true } as ActionSpec);

function suggestionCard(_ctx: BotsCtx, s: Suggestion, o: { desk?: boolean } = {}): Node {
  const item: { choices: Array<{ label: string; kind: "primary" | "secondary"; action: ActionRef }> } = {
    choices: [
      { label: "Move it", kind: "primary", action: call("POST", `${A}/plan/move`, { eventId: s.eventId, start: s.startIso, said: s.question }, { ok: seq(toast(`Moved to ${s.toWords}`), refresh), fail: toast("Couldn't move it. Try again.", true) }) },
      { label: `Keep ${s.fromDay}`, kind: "secondary", action: write("POST", `${A}/plan/skip`, { key: s.key }, { ok: "Kept as it is" }) },
    ],
  };
  return col([
    row([statusMark("needs", { size: 8 }), text("Needs you", { size: 11, weight: 600, lineHeight: 14, upper: true, tracking: 0.4 })], { gap: 8 }),
    text(s.question, { size: 17, weight: 600, lineHeight: 23 }),
    text(s.detail, { size: 13, color: C.grey70, lineHeight: 19 }),
    row(item.choices.map((c) => button(c.label, c.action, { kind: c.kind, size: "md" })), { gap: 8, flexWrap: "wrap" }),
  ], { gap: 10, padding: 18, borderRadius: o.desk ? 18 : 20, borderWidth: o.desk ? 1.5 : 1, borderColor: o.desk ? lookOf("plan").color : C.line });
}

function planChips(d: PlanRead): string[] {
  const busy = d.days.filter((x) => x.key > d.today).sort((a, b) => b.events.length - a.events.length)[0];
  return [busy && busy.events.length >= 2 ? `Free up ${PLAN_WEEKDAYS_LONG[keyDate(busy.key).getUTCDay()]}` : "Plan my week", "What should I do first tomorrow?"];
}

/** "From Meera S.", "Added by Plan bot": who put it on the person's days, when not them. */
const fromWords = (x: { from?: string }) => (x.from ? (x.from === "You" ? "" : x.from.endsWith(" bot") ? `Added by ${x.from}` : `From ${x.from}`) : "");

/** A to-do on a day or a list: its tick (on its own), and its words (open it). */
function todoRow(ctx: BotsCtx, t: PlanTask, o: { size?: number; when?: boolean } = {}): Node {
  const sub = [o.when && t.at !== null && t.at !== undefined ? clockOf(ctx, t.at) : "", fromWords(t)].filter(Boolean).join(" · ");
  return row([
    tickBox(!!t.done, tickAction(t.id, !!t.done), t.done ? `${t.title}. Done. Tap to put it back.` : `${t.title}. Tap when it's done.`),
    col([
      text(t.title, { size: o.size ?? 14, lineHeight: 19, lines: 2, color: t.done ? C.meta : C.ink }),
      ...(sub ? [meta(sub, { size: 12, lines: 1 })] : []),
    ], { gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0, paddingVertical: 8 }, itemAction("task", t.id)),
  ], { gap: 10, alignItems: "center" });
}

function dayTimeline(ctx: BotsCtx, d: PlanRead, day: PlanDay): Node {
  const timed = day.events.filter((e) => !e.allDay);
  const rows: Node[] = [];
  const line = (h?: number) => box([], { width: 1.5, alignSelf: "stretch", backgroundColor: C.track, ...(h ? { height: h } : {}) });
  for (const e of day.events.filter((x) => x.allDay)) {
    rows.push(row([text("All day", { size: 12, weight: 600, lineHeight: 16, style: { width: 54 } }), line(), col([
      text(e.title, { size: 14, weight: 500, lineHeight: 19 }), ...(e.where || e.from ? [meta([e.where, fromWords(e)].filter(Boolean).join(" · "), { size: 12, lines: 1 })] : []),
    ], { flexGrow: 1, flexShrink: 1, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 12, gap: 2 }, itemAction("event", e.id))], { gap: 10, alignItems: "stretch" }));
  }
  timed.forEach((e, i) => {
    const target = d.suggestion?.eventId === e.id;
    rows.push(...places.legRowsTo(ctx, d.travel, e.id));
    rows.push(row([
      text(clockOf(ctx, e.start), { size: 12, weight: 600, lineHeight: 16, style: { width: 54, paddingTop: 12 } }),
      line(),
      row([
        col([text(e.title, { size: 14, weight: 500, lineHeight: 19, lines: 1 }), meta([lengthWords(e.end - e.start), ...(e.where ? [e.where] : []), ...(e.people ? [plural(e.people, "other")] : []), fromWords(e)].filter(Boolean).join(" · "), { size: 12, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
        ...(target ? [row([text("Move?", { size: 12, weight: 600, lineHeight: 16 }), statusMark("needs", { size: 8 })], { gap: 6 })] : []),
      ], { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 8, padding: 12, borderRadius: 14, borderWidth: target ? 1.5 : 1, borderColor: target ? C.ink : C.line, ...(target ? { borderStyle: "dashed" } : {}), backgroundColor: C.paper }, itemAction("event", e.id)),
    ], { gap: 10, alignItems: "stretch" }));
    rows.push(...places.headsUpRows(ctx, d.travel, e.id));
    const next = timed[i + 1];
    if (next && next.start - e.end >= 90 * MIN) {
      rows.push(row([box([], { width: 54 }), line(26), meta(`Free · ${hourWords(ctx, e.end)} to ${hourWords(ctx, next.start)}, ${lengthWords(next.start - e.end)}`, { size: 12 })], { gap: 10, minHeight: 26 }));
    }
  });
  for (const t of day.tasks) rows.push(row([text("To do", { size: 12, weight: 600, lineHeight: 16, style: { width: 54, paddingTop: 12 } }), line(), box([todoRow(ctx, t, { when: true })], { flexGrow: 1, flexShrink: 1, minWidth: 0 })], { gap: 10, alignItems: "stretch" }));
  if (!rows.length) {
    return card([
      text(`Nothing on ${day.key === d.today ? "today" : day.key === d.tomorrow ? "tomorrow" : dayLabelOf(d, day.key)}`, { size: 15, weight: 500, lineHeight: 20 }),
      meta("A free day. Add something, or ask Plan bot to fill it.", { size: 13 }),
    ], { dashed: true });
  }
  return col(rows, { gap: 8 });
}

function planHeadLine(d: PlanRead | undefined): string {
  if (!d) return "Couldn't read your days";
  const t = d.days.find((x) => x.key === d.tomorrow);
  const n = t ? t.events.length + t.tasks.filter((x) => !x.done).length : 0;
  const saved = places.savedWords(d.travel);
  return saved ? `${plural(n, "thing")} tomorrow · ${saved}` : d.suggestion ? `${plural(n, "thing")} tomorrow · 1 needs you` : `${plural(n, "thing")} tomorrow`;
}

/** Share a day's plan with a space or a person, as a copy of its lines (screens/spaces.ts bots.share). */
function planShare(ctx: BotsCtx, d: PlanRead, day: PlanDay | undefined): Node[] {
  if (!day) return [];
  const lines = [...day.events.map((e) => `${e.allDay ? "All day" : clockOf(ctx, e.start)} · ${e.title}${e.where ? ` · ${e.where}` : ""}`), ...day.tasks.filter((t) => !t.done).map((t) => `To do · ${t.title}`)];
  const label = dayLabelOf(d, day.key);
  return lines.length ? [shareButton({ kind: "plan", title: `${label} · ${keyWords(day.key)}`, text: lines.join("\n") }, { label: `Share ${label === "Today" || label === "Tomorrow" ? label.toLowerCase() : label}` })] : [];
}

/** The to-dos with no day, ticked off here. */
function openTodos(ctx: BotsCtx, d: PlanRead): Node[] {
  const open = d.open ?? [];
  if (!open.length) return [];
  const kids: Node[] = [];
  open.slice(0, 12).forEach((t, i) => { if (i) kids.push(divider()); kids.push(box([todoRow(ctx, t)], { paddingHorizontal: 14 })); });
  return [col([
    row([sectionLabel(`To do, no day · ${open.length}`), grow(), link("Add", addAction(undefined, "task"))], { gap: 8 }),
    col(kids, { borderRadius: 18, borderWidth: 1, borderColor: C.line, paddingVertical: 2 }),
  ], { gap: 8 })];
}

/** The week as seven days (the phone): each opens its day; the arrows go a week back or on. */
function dayStrip(d: PlanRead, sel: string, week: number): Node {
  const look = lookOf("plan");
  const cell = (k: string): Node => {
    const dt = keyDate(k);
    const on = k === sel;
    const day = d.days.find((x) => x.key === k);
    const busy = !!day && day.events.length + day.tasks.filter((t) => !t.done).length > 0;
    return labelled(col([
      text(WEEKDAYS[dt.getUTCDay()]!, { size: 11, weight: 500, color: on ? C.paper : C.meta, lineHeight: 14 }),
      text(String(dt.getUTCDate()), { size: 15, weight: on || k === d.today ? 600 : 400, color: on ? C.paper : C.ink, lineHeight: 20 }),
      box([], { width: 4, height: 4, borderRadius: 2, backgroundColor: busy ? (on ? C.paper : look.color) : "transparent" }),
    ], {
      flexGrow: 1, flexBasis: 0, minWidth: 0, alignItems: "center", gap: 2, paddingVertical: 7, borderRadius: 14, backgroundColor: on ? C.ink : C.paper,
      ...(k === d.today && !on ? { borderWidth: 1, borderColor: C.line } : {}),
    }, planGo(week, k)), `${PLAN_WEEKDAYS_LONG[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`);
  };
  const arrow = (dir: -1 | 1) => labelled(box([icon(dir < 0 ? "back" : "chevron", { size: 16, color: C.grey70 })], { width: 26, alignSelf: "stretch", alignItems: "center", justifyContent: "center" }, planGo(week + dir)), dir < 0 ? "The week before" : "The week after");
  return row([arrow(-1), ...d.week.map(cell), arrow(1)], { gap: 2, alignItems: "stretch" });
}

function planPhone(ctx: BotsCtx, d: PlanRead | undefined) {
  const look = lookOf("plan");
  const week = planWeek(ctx);
  const sel = d ? planDay(ctx, d) : "";
  const day = d ? d.days.find((x) => x.key === sel) ?? { key: sel, events: [], tasks: [] } : undefined;
  return page(ctx, {
    title: "Plan bot", nav: "plan", live: ["bot:plan", "calendar", "tasks"], state: { ...places.PLAN_STATE },
    body: [
      phoneHead(look, "Plan bot", planHeadLine(d), undefined, headerBuddy(ctx, "plan", { lookTo: "down", thinkWhen: ANSWERING })),
      ...(!d || !day ? [emptyState({ pose: "think", title: "Couldn't read your days", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]
        : [
          dayStrip(d, sel, week),
          col([
            row([sectionLabel(`${dayLabelOf(d, sel)} · ${keyWords(sel)}`), grow(), link("Add", addAction(sel))], { gap: 8 }),
            ...(d.trouble ? [notice(d.trouble)] : []),
            dayTimeline(ctx, d, day),
            ...(sel === d.tomorrow ? places.planFoot(ctx, d.travel) : []),
            ...planShare(ctx, d, day),
          ], { gap: 12 }),
          ...(d.suggestion ? [suggestionCard(ctx, d.suggestion)] : []),
          ...openTodos(ctx, d),
          ...places.homePart(ctx, d.travel),
        ]),
    ],
    footer: [
      ...(d ? [row(planChips(d).map((c) => chip(c, { onPress: askBot("plan", c) })), { gap: 8, flexWrap: "wrap" })] : []),
      chatBar(ctx, "plan", "Plan bot", "Add dentist Fri 5 pm, or plan my week…", open(SCREENS.chat, { slug: "plan" })),
    ],
  });
}

const PX = 40, FROM_H = 8, TO_H = 22;

function weekColumn(ctx: BotsCtx, d: PlanRead, day: PlanDay): Node {
  const start = Date.parse(`${day.key}T00:00:00Z`) - ctx.tzOffsetMinutes * MIN;
  const top = start + FROM_H * 3_600_000, bottom = start + TO_H * 3_600_000;
  const past = day.key < d.today;
  const kids: Node[] = [];
  let at = top;
  const leaves = day.key === d.tomorrow ? places.leaveBlocks(ctx, d.travel, day.events) : [];
  for (const e of [...day.events, ...leaves].filter((x) => !x.allDay && x.end > top && x.start < bottom).sort((a, b) => a.start - b.start)) {
    const s = Math.max(e.start, at), en = Math.min(e.end, bottom);
    if (en <= s) continue;
    if (s > at) kids.push(box([], { height: Math.round(((s - at) / 3_600_000) * PX), flexShrink: 0 }));
    const h = Math.max(20, Math.round(((en - s) / 3_600_000) * PX) - 2);
    const target = d.suggestion?.eventId === e.id;
    const leave = places.isLeave(e.id);
    kids.push(col([
      text(e.title, { size: 11.5, weight: 500, lineHeight: 15, lines: h >= 46 ? 2 : 1, color: past ? C.meta : C.ink }),
      ...(h >= 44 && e.where ? [text(e.where, { size: 10.5, color: C.meta, lineHeight: 13, lines: 1 })] : []),
    ], {
      height: h, flexShrink: 0, marginBottom: 2, borderRadius: 7, paddingVertical: 3, paddingHorizontal: 6, overflow: "hidden",
      backgroundColor: past ? C.surface : C.paper, borderWidth: past ? 0 : target ? 1.5 : 1, borderColor: target ? C.ink : C.line, ...(target ? { borderStyle: "dashed" } : {}),
      ...(leave ? places.leaveStyle() : {}),
    }, leave ? undefined : itemAction("event", e.id)));
    at = en + 2 * MIN;
  }
  const tomorrow = day.key === d.tomorrow;
  return col(kids, { flexGrow: 1, flexBasis: 0, minWidth: 0, height: (TO_H - FROM_H) * PX, paddingHorizontal: 3, borderLeftWidth: 1, borderLeftColor: C.divider, overflow: "hidden", ...(tomorrow ? { backgroundColor: C.surface, borderRadius: 10 } : {}) });
}

function planDesk(ctx: BotsCtx, d: PlanRead | undefined) {
  const look = lookOf("plan");
  const week = planWeek(ctx);
  const weekDays = d ? d.week.map((k) => d.days.find((x) => x.key === k) ?? { key: k, events: [], tasks: [] }) : [];
  const range = weekDays.length ? `${keyDate(weekDays[0]!.key).getUTCDate()} ${MONTHS[keyDate(weekDays[0]!.key).getUTCMonth()]} – ${keyDate(weekDays[6]?.key ?? weekDays[0]!.key).getUTCDate()} ${MONTHS[keyDate(weekDays[6]?.key ?? weekDays[0]!.key).getUTCMonth()]}` : "";
  const nav = row([
    box([icon("back", { size: 16 })], { width: 30, height: 30, alignItems: "center", justifyContent: "center" }, planGo(week - 1)),
    text(range, { size: 13, weight: 500, lineHeight: 18 }),
    box([icon("chevron", { size: 16 })], { width: 30, height: 30, alignItems: "center", justifyContent: "center" }, planGo(week + 1)),
  ], { gap: 6, borderWidth: 1, borderColor: C.outline, borderRadius: 20, height: 38, paddingHorizontal: 4 });
  const head = row([box([], { width: 44 }), ...weekDays.map((x) => {
    const dt = keyDate(x.key);
    const today = x.key === d!.today, tomorrow = x.key === d!.tomorrow;
    const allDay = x.events.filter((e) => e.allDay);
    const open = x.tasks.filter((t) => !t.done).length;
    return col([
      text(tomorrow ? "Tomorrow" : WEEKDAYS[dt.getUTCDay()]!, { size: 12, weight: tomorrow ? 600 : 400, color: tomorrow ? C.ink : C.meta, lineHeight: 16 }),
      today
        ? box([text(String(dt.getUTCDate()), { size: 14, weight: 600, color: C.paper, lineHeight: 18 })], { width: 28, height: 28, borderRadius: 14, backgroundColor: C.ink, alignItems: "center", justifyContent: "center" })
        : box([text(String(dt.getUTCDate()), { size: 14, weight: tomorrow ? 600 : 400, lineHeight: 18 })], { height: 28, justifyContent: "center" }),
      ...allDay.slice(0, 1).map((e) => text(e.title, { size: 10.5, color: C.grey70, lineHeight: 13, lines: 1 })),
      ...(open ? [text(`${plural(open, "to do", "to dos")}`, { size: 10.5, color: look.color, lineHeight: 13 })] : []),
    ], { flexGrow: 1, flexBasis: 0, minWidth: 0, alignItems: "center", gap: 2 }, addAction(x.key));
  })], { gap: 0, alignItems: "flex-start" });
  const hours = col(Array.from({ length: (TO_H - FROM_H) / 2 }, (_, i) => box([meta(`${((FROM_H + i * 2) % 12) || 12} ${FROM_H + i * 2 < 12 ? "am" : "pm"}`, { size: 11 })], { height: PX * 2 })), { width: 44, flexShrink: 0 });
  const grid7 = col([head, row([hours, ...weekDays.map((x) => weekColumn(ctx, d!, x))], { alignItems: "flex-start" })], { gap: 10, flexGrow: 1, flexShrink: 1, minWidth: 0 });
  const tomorrow = d?.days.find((x) => x.key === d.tomorrow);
  const sorted: Node[] = [
    ...places.legListRows(ctx, d?.travel),
    ...(tomorrow?.tasks ?? []).map((t) => box([todoRow(ctx, t, { when: true })], { paddingHorizontal: 16, paddingVertical: 4 })),
    ...(tomorrow?.events.filter((e) => !e.allDay).slice(0, 4) ?? []).map((e) => listRow({ label: e.title, sub: `${clockOf(ctx, e.start)} · ${lengthWords(e.end - e.start)}${e.where ? ` · ${e.where}` : ""}${e.from ? ` · ${fromWords(e)}` : ""}`, left: statusMark(d?.suggestion?.eventId === e.id ? "needs" : "done"), onPress: itemAction("event", e.id) })),
  ];
  const aside = col([
    ...(d?.suggestion ? [suggestionCard(ctx, d.suggestion, { desk: true })] : []),
    col([sectionLabel("Tomorrow, sorted"), sorted.length ? listCard(sorted) : card([meta("Nothing on tomorrow yet.", { size: 13 })], { dashed: true }), ...places.planFoot(ctx, d?.travel), ...(d ? planShare(ctx, d, tomorrow) : [])], { gap: 8 }),
    ...(d ? openTodos(ctx, d) : []),
    ...places.homePart(ctx, d?.travel),
    row(d ? planChips(d).map((c) => chip(c, { onPress: askBot("plan", c) })) : [], { gap: 8, flexWrap: "wrap" }),
    chatBar(ctx, "plan", "Plan bot", "Add dentist Fri 5 pm, or plan my week…", open(SCREENS.chat, { slug: "plan" })),
  ], { width: 300, flexShrink: 0, gap: 18 });
  return page(ctx, {
    title: "Plan bot", nav: "plan", maxWidth: 1180, live: ["bot:plan", "calendar", "tasks"], state: { ...places.PLAN_STATE },
    body: [
      row([botAvatar(look, 44), col([title("Plan bot", { size: 26 }), text(planHeadLine(d), { size: 13, weight: 500, color: look.color, lineHeight: 18 })], { gap: 2 }),
        ...headerBuddy(ctx, "plan", { lookTo: "down", thinkWhen: ANSWERING }), grow(),
        ...(d ? [secondaryButton("Add", addAction(d.tomorrow), { size: "md", icon: "plus" }), nav] : [])], { gap: 14 }),
      ...(!d ? [emptyState({ pose: "think", title: "Couldn't read your days", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]
        : [...(d.trouble ? [notice(d.trouble)] : []), row([grid7, aside], { gap: 28, alignItems: "flex-start" })]),
    ],
  });
}

// ===================================================================== bots.travel

interface TripData { trip: { id: string; place: string; when: string; who: string; packing: Array<{ text: string; done: boolean }>; spots?: string[]; stays?: Array<{ picked: boolean }> } | null; facts: Array<{ id: string; text: string }>; bookings: Array<{ label: string; url: string; at: number; said: string }> }
interface MediaFile { id: string; name: string; mime: string; bytes: number; createdAt: number; pages?: number }
/** `x`: the trip's weather, places and stays compared (GET .../trip/:id/extras, botsPlaces.ts). */
interface TravelData { t?: TripData; files?: MediaFile[]; x?: places.TripExtrasView }

const TRAVELLY = /ticket|pnr|boarding|itinerary|hotel|booking|flight|train|irctc|visa|passport|e-?ticket|bus|stay|trip/i;
const GETTING = /train|flight|bus|cab|ticket|irctc|rail|air|uber|ola|route|maps|direction/i;
const STAYING = /hotel|stay|room|booking\.com|airbnb|hostel|resort|homestay/i;

function tripSteps(ctx: BotsCtx, d: TravelData) {
  const t = d.t?.trip;
  const opens = d.t?.bookings ?? [];
  const files = (d.files ?? []).filter((f) => TRAVELLY.test(f.name));
  const travelNeeds = ctx.live.needs.filter((n) => n.bot === "travel");
  const steps = [
    { name: "Dates", ok: !!t?.when },
    { name: "Getting there", ok: opens.some((o) => GETTING.test(`${o.label} ${o.url} ${o.said}`)) || files.some((f) => GETTING.test(f.name)) },
    { name: "Stay", ok: opens.some((o) => STAYING.test(`${o.label} ${o.url} ${o.said}`)) || files.some((f) => STAYING.test(f.name)) || !!t?.stays?.some((x) => x.picked) },
    { name: "Packed", ok: !!t && t.packing.length > 0 && t.packing.every((p) => p.done) },
    { name: "Nothing waiting", ok: !!t && travelNeeds.length === 0 },
  ];
  return { steps, ready: steps.filter((s) => s.ok).length, files, opens, travelNeeds };
}

function tripForm(_ctx: BotsCtx): Node {
  const start = ifFilled("t_place", write("POST", `${A}/trip`, { place: "$state.t_place", when: "$state.t_when", who: "$state.t_who" }, { ok: "Trip started" }), "Where are you going?");
  return card([
    text("Where to next?", { size: 17, weight: 600, lineHeight: 22 }),
    meta("Travel bot keeps the trip in one place: the bookings it finds for you, your tickets, what to pack.", { size: 13 }),
    inputBox([field("t_place", "t_place", "Where: Pune, Goa, Jaipur…")], { radius: 14 }),
    row([box([inputBox([field("t_when", "t_when", "When: 14–16 Nov")], { radius: 14 })], { flexGrow: 1, flexBasis: 0 }), box([inputBox([field("t_who", "t_who", "Who: you + Rohan")], { radius: 14 })], { flexGrow: 1, flexBasis: 0 })], { gap: 10 }),
    button("Start the trip", start, { size: "md" }),
  ], { gap: 12 });
}

function bookingCards(ctx: BotsCtx, d: TravelData, place: string): Node[] {
  const opens = d.t?.bookings ?? [];
  if (!opens.length) {
    return [card([
      row([box([icon("pin", { size: 18, color: lookOf("travel").color })], { width: 36, height: 36, borderRadius: 10, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }),
        col([text("Nothing to book yet", { size: 15, weight: 600, lineHeight: 20 }), meta("Ask Travel bot for trains, flights or stays. It opens the app for you to book; you press pay.", { size: 12 })], { gap: 2, flexShrink: 1 })], { gap: 12, alignItems: "flex-start" }),
      row([chip(`Trains to ${place}`, { onPress: askBot("travel", `Find trains to ${place}${d.t?.trip?.when ? ` for ${d.t.trip.when}` : ""}`) }), chip(`Stays in ${place}`, { onPress: askBot("travel", `Find two or three stays in ${place}${d.t?.trip?.when ? ` for ${d.t.trip.when}` : ""}`) })], { gap: 8, flexWrap: "wrap" }),
    ], { gap: 12 })];
  }
  return opens.slice(0, 3).map((o) => card([
    row([box([icon(STAYING.test(`${o.label} ${o.url}`) ? "today" : "pin", { size: 18 })], { width: 36, height: 36, borderRadius: 10, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }),
      col([text(withoutAmounts(o.label), { size: 15, weight: 600, lineHeight: 20, lines: 2 }), meta(o.said ? `You asked: ${o.said}` : `From your chat · ${shortDate(ctx, o.at)}`, { size: 12, lines: 2 })], { gap: 2, flexShrink: 1, flexGrow: 1 }),
      statusMark("needs", { size: 8 })], { gap: 12, alignItems: "flex-start" }),
    row([button("Open to book", { kind: "openUrl", url: o.url, handoff: true }, { size: "md", icon: "link" }), meta("Ready to book · you press pay", { size: 12 })], { gap: 12, flexWrap: "wrap" }),
  ], { gap: 12 }));
}

function packingPart(_ctx: BotsCtx, trip: NonNullable<TripData["trip"]>, columns: number): Node {
  const done = trip.packing.filter((p) => p.done).length;
  const add = ifFilled("pack", seq(call("POST", `${A}/trip/${enc(trip.id)}/packing`, { text: "$state.pack" }, { ok: seq(clearState("pack"), refresh), fail: toast("Couldn't add that. Try again.", true) })), "Write what to pack");
  const item = (p: { text: string; done: boolean }, i: number): Node => row([
    box(p.done ? [icon("check", { size: 13, color: C.paper, weight: 2.4 })] : [], { width: 18, height: 18, borderRadius: 5, alignItems: "center", justifyContent: "center", flexShrink: 0, ...(p.done ? { backgroundColor: C.ink } : { borderWidth: 1.5, borderColor: C.ink }) }),
    text(p.text, { size: 13, lineHeight: 18, color: p.done ? C.meta : C.ink, lines: 2, style: { flexShrink: 1 } }),
  ], { gap: 10, minHeight: 36 }, write("PUT", `${A}/trip/${enc(trip.id)}/packing/${i}`));
  return col([
    row([sectionLabel("Packing"), grow(), meta(trip.packing.length ? `${done} of ${trip.packing.length} packed` : "Nothing on the list yet", { size: 12 })]),
    ...(trip.packing.length ? [meter(done, trip.packing.length, { color: lookOf("travel").color }), grid(trip.packing.map(item), columns, 4)]
      : [button("Start a list for me", write("POST", `${A}/trip/${enc(trip.id)}/packing/starter`, {}, { ok: "List started" }), { kind: "secondary", size: "md" })]),
    inputBox([field("pack", "pack", "Add something to pack…", { onSubmit: add }), roundButton("plus", add, { size: 36, label: "Add", light: true })], { radius: 14 }),
  ], { gap: 10 });
}

function travelParts(ctx: BotsCtx, d: TravelData) {
  const look = lookOf("travel");
  const s = tripSteps(ctx, d);
  const trip = d.t?.trip ?? null;
  const live = liveOf(ctx, "travel");
  const headLine = live?.working ? `Working · ${live.doing ?? "on it"}` : trip ? `${s.ready} of ${s.steps.length} ready` : "Plans your trips";
  const segments = row(s.steps.map((st, i) => box([], {
    flexGrow: 1, flexBasis: 0, height: 5, borderRadius: 3,
    backgroundColor: st.ok ? C.ink : i === s.steps.findIndex((x) => !x.ok) ? look.color : C.track,
  })), { gap: 4 });
  const files = s.files.length ? col([sectionLabel("Your tickets and bookings"), listCard(s.files.slice(0, 4).map((f) => listRow({
    label: f.name, sub: `${kb(f.bytes)} · ${shortDate(ctx, f.createdAt)}`, left: icon("clip", { size: 18, color: C.meta }), onPress: open(SCREENS.shareIn, { file: f.id }),
  })))], { gap: 8 }) : null;
  const facts = d.t?.facts ?? [];
  const remembers = facts.length ? col([sectionLabel("Travel bot remembers"), ...facts.slice(0, 5).map((f) => dotLine(f.text))], { gap: 6 }) : null;
  const needs = s.travelNeeds.slice(0, 2).map((n) => needsCard(n));
  // Share the trip with a space or a person (a copy, with its packing list: screens/spaces.ts bots.share).
  const over = trip ? row([shareButton({ kind: "trip", ref: trip.id, title: `Trip to ${trip.place}` }), quietButton("Trip over", write("DELETE", `${A}/trip/${enc(trip.id)}`, undefined, { ok: "Trip cleared" }), { size: "md" })], { gap: 4 }) : null;
  return { look, s, trip, headLine, segments, files, remembers, needs, over };
}

function travelPhone(ctx: BotsCtx, d: TravelData) {
  const p = travelParts(ctx, d);
  return page(ctx, {
    title: "Travel bot", nav: "travel", state: { t_place: "", t_when: "", t_who: "", pack: "", ...places.TRIP_STATE }, live: ["bot:travel"],
    body: [
      phoneHead(p.look, "Travel bot", p.headLine, undefined, headerBuddy(ctx, "travel", { lookTo: "down", thinkWhen: ANSWERING })),
      ...(!d.t ? [emptyState({ pose: "think", title: "Couldn't load your trip", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]
        : !p.trip ? [tripForm(ctx), ...(p.remembers ? [p.remembers] : [])]
          : [
            col([
              row([text(p.trip.when ? `${p.trip.place} · ${p.trip.when}` : p.trip.place, { size: 24, weight: 700, lineHeight: 30, tracking: -0.5, style: { flexShrink: 1 } }), grow(), ...(p.over ? [p.over] : [])], { alignItems: "flex-start" }),
              ...(p.trip.who ? [meta(p.trip.who, { size: 12 })] : []),
              p.segments,
            ], { gap: 8 }),
            ...p.needs,
            ...places.datesHint(p.trip, d.x),
            ...bookingCards(ctx, d, p.trip.place),
            places.staysPart(ctx, p.trip, d.x, d.t?.bookings ?? []),
            ...places.weatherPart(ctx, p.trip, d.x),
            places.spotsPart(ctx, p.trip, d.x),
            ...(p.files ? [p.files] : []),
            packingPart(ctx, p.trip, 2),
            ...(p.remembers ? [p.remembers] : []),
            ...places.tripFoot(d.x),
          ]),
    ],
    footer: [chatBar(ctx, "travel", "Travel bot", "Ask about this trip…", open(SCREENS.chat, { slug: "travel" }))],
  });
}

function travelDesk(ctx: BotsCtx, d: TravelData) {
  const p = travelParts(ctx, d);
  const left: Node[] = !d.t ? [emptyState({ pose: "think", title: "Couldn't load your trip", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]
    : !p.trip ? [tripForm(ctx)]
      : [
        col([
          row([text(p.trip.when ? `${p.trip.place} · ${p.trip.when}` : p.trip.place, { size: 28, weight: 700, lineHeight: 34, tracking: -0.6, style: { flexShrink: 1 } }), grow(), ...(p.over ? [p.over] : [])], { alignItems: "flex-start" }),
          ...(p.trip.who ? [meta(p.trip.who, { size: 13 })] : []),
          p.segments,
          row(p.s.steps.map((st) => text(st.name, { size: 11, weight: st.ok ? 500 : 400, color: st.ok ? C.ink : C.meta, lineHeight: 14, style: { flexGrow: 1, flexBasis: 0 } })), { gap: 4 }),
        ], { gap: 8 }),
        ...p.needs,
        ...places.datesHint(p.trip, d.x),
        grid(bookingCards(ctx, d, p.trip.place), 2, 14),
        ...(d.x ? [places.tripPlanPart(ctx, p.trip, d.x)!] : []),
        places.staysPart(ctx, p.trip, d.x, d.t?.bookings ?? [], { desk: true }),
        places.spotsPart(ctx, p.trip, d.x),
        packingPart(ctx, p.trip, 3),
      ];
  const right: Node[] = [
    ...(p.files ? [p.files] : []),
    ...(p.remembers ? [p.remembers] : []),
    col([sectionLabel("Ask Travel bot"), chatBar(ctx, "travel", "Travel bot", "Ask about this trip…", open(SCREENS.chat, { slug: "travel" }))], { gap: 8 }),
  ];
  return page(ctx, {
    title: "Travel bot", nav: "travel", maxWidth: 1100, state: { t_place: "", t_when: "", t_who: "", pack: "", ...places.TRIP_STATE }, live: ["bot:travel"],
    body: [
      row([botAvatar(p.look, 44), col([title("Travel bot", { size: 26 }), text(p.headLine, { size: 13, weight: 500, color: p.look.color, lineHeight: 18 })], { gap: 2 }),
        ...headerBuddy(ctx, "travel", { lookTo: "right", thinkWhen: ANSWERING })], { gap: 14 }),
      row([col(left, { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 22 }), col(right, { width: 300, flexShrink: 0, gap: 22 })], { gap: 28, alignItems: "flex-start" }),
    ],
  });
}

// bots.spaces and the rest of Spaces (members, invites, sharing, payments, tasks, chats): screens/spaces.ts

// ===================================================================== bots.share-in

interface Attachment { id: string; name: string; mime: string; bytes: number; sha256: string; kind?: string }
interface ShareData { file?: MediaFile; attachment?: Attachment; files?: MediaFile[]; attachments?: Attachment[]; pick?: string | null; ask?: string; line?: string }

/**
 * What came in from another app's Share menu (the phone's share extension and share intent) or was dropped on the window: `text`, `url`,
 * and files already sent to POST /v1/files, as `file` (one id) and `files` (ids, comma separated: a share of several). At most five.
 */
const SHARE_FILES = 5;
function shareFileIds(params: Record<string, unknown>): string[] {
  const ids = [String(params.file ?? ""), ...String(params.files ?? "").split(",")].map((s) => s.trim()).filter((s) => /^[A-Za-z0-9-]{1,64}$/.test(s));
  return [...new Set(ids)].slice(0, SHARE_FILES);
}

function sharedOf(ctx: BotsCtx, d: ShareData) {
  const text0 = String(ctx.params.text ?? "").slice(0, 2000);
  const url = String(ctx.params.url ?? "").slice(0, 2000);
  const files = d.files?.length ? d.files : d.file ? [d.file] : [];
  const file = files[0];
  const kind: "file" | "link" | "text" | null = file ? "file" : url ? "link" : text0 ? "text" : null;
  return { text: text0, url, file, files, kind };
}

function sharedCard(ctx: BotsCtx, s: ReturnType<typeof sharedOf>): Node {
  const badge = (label: string) => box([text(label, { size: 10, weight: 600, color: C.grey70, lineHeight: 12 })], { width: 40, height: 48, borderRadius: 8, backgroundColor: C.surface, alignItems: "center", justifyContent: "center", flexShrink: 0 });
  // Words that came with a file or a link (a caption, a page's title), under it.
  const said = s.text && s.text !== s.url && (s.file || s.url) ? [meta(s.text, { size: 12, lines: 2 })] : [];
  if (s.file) {
    const fileRow = (f: MediaFile, i: number) => row([
      badge((f.name.split(".").pop() ?? "FILE").slice(0, 4).toUpperCase()),
      col([text(f.name, { size: 14, weight: 600, lineHeight: 19, lines: 1 }), meta([kb(f.bytes), ...(f.pages ? [plural(f.pages, "page")] : []), shortDate(ctx, f.createdAt)].join(" · "), { size: 12 })], { gap: 2, flexShrink: 1, minWidth: 0 }),
    ], { gap: 12, ...(i ? { paddingTop: 10, borderTopWidth: 1, borderTopColor: C.divider } : {}) });
    return card([...s.files.map(fileRow), ...said], { padding: 14, gap: 10 });
  }
  if (s.url) return card([row([badge("LINK"), col([text(s.url.replace(/^https?:\/\//, "").slice(0, 80), { size: 14, weight: 600, lineHeight: 19, lines: 2 }), meta("A link", { size: 12 })], { gap: 2, flexShrink: 1, minWidth: 0 })], { gap: 12 }), ...said], { padding: 14, gap: 10 });
  return card([row([badge("TEXT"), text(s.text, { size: 14, lineHeight: 20, lines: 4, style: { flexShrink: 1 } })], { gap: 12, alignItems: "flex-start" })], { padding: 14 });
}

/** What came in, to a space or a person instead of a bot (screens/spaces.ts bots.share): the file (theirs), the link, or the words. */
function sharePeople(s: ReturnType<typeof sharedOf>): ActionRef {
  if (s.file) return shareTo({ kind: "file", ref: s.file.id, title: s.file.name });
  if (s.url) return shareTo({ kind: "link", url: s.url, title: s.text && s.text !== s.url ? s.text.slice(0, 120) : s.url.replace(/^https?:\/\//, "").slice(0, 120) });
  return shareTo({ kind: "text", title: s.text.split("\n")[0]!.slice(0, 60) || "A note", text: s.text });
}

/** "Ask any bot": the front door gives it to the bot that fits (POST /v1/ask with bot "any"). Always on the list, last unless it is the pick. */
const ASK_ANY = "any";
const askAny = (): LiveBot => ({ ...lookOf("tailzu"), slug: ASK_ANY, name: "Ask any bot", builtin: true, state: "idle", working: false, needs: 0, purpose: "X0 Bot picks the bot that fits" });

const shareLineFor = (slug: string, name: string) => {
  switch (slug) {
    case ASK_ANY: return "X0 Bot gives it to the bot that fits best. It asks before it changes anything or spends money.";
    case "travel": return "Travel bot adds the times and booking details to your trip. It won't book or pay for anything.";
    case "plan": return "Plan bot puts it on your calendar in X0 Bot. You can change it or take it out any time.";
    case "code": return "Code bot reads it and answers. It changes code only through a pull request you approve.";
    case "keybot": return "Keybot writes it in your voice. You send it yourself.";
    default: return `${name} reads it and answers here. It asks before it changes anything or spends money.`;
  }
};
const SHARE_LINE: Record<string, string> = { [ASK_ANY]: "X0 Bot picks the bot that fits", travel: "Reads tickets, keeps your trips in order", plan: "Calendar and reminders", code: "Projects and code", keybot: "Writes and replies in your voice" };

function shareSend(ctx: BotsCtx, s: ReturnType<typeof sharedOf>, d: ShareData): ActionRef {
  const names = s.files.map((f) => f.name).join(", ").slice(0, 200);
  const attachments = d.attachments?.length ? d.attachments : d.attachment ? [d.attachment] : [];
  return ifFilled("what", seq(
    setState("sendingShare", true),
    call("POST", `${A}/share/compose`, { what: "$state.what", ...(names ? { name: names } : {}), ...(s.text ? { text: s.text } : {}), ...(s.url ? { url: s.url } : {}) }, {
      assignTo: "composed",
      ok: call("POST", "/v1/ask", { message: "$state.composed.message", bot: "$state.bot", device: ctx.client, mode: "text", ...(attachments.length ? { attachments } : {}) }, {
        assignTo: "asked",
        ok: seq(setState("sendingShare", false), { kind: "navigate", screenId: SCREENS.ask, params: { message: "$state.what", answer: "$state.asked.result.text", id: "$state.asked.id" }, replace: true }),
        fail: seq(setState("sendingShare", false), toast("Couldn't send it. Try again.", true)),
      }),
      fail: seq(setState("sendingShare", false), toast("Couldn't send it. Try again.", true)),
    }),
  ), "Say what it should do");
}

/** The person's bots and "Ask any bot", the pick first. */
function shareBots(ctx: BotsCtx, pick: string | null | undefined): LiveBot[] {
  const list = [...ctx.live.bots, askAny()];
  return list.sort((a, b) => Number(b.slug === pick) - Number(a.slug === pick));
}

/** The front door's pick when it made one, else "Ask any bot". */
const sharePick = (ctx: BotsCtx, d: ShareData): string => (d.pick && ctx.live.bots.some((b) => b.slug === d.pick) ? d.pick : ASK_ANY);

function sharePhone(ctx: BotsCtx, d: ShareData) {
  const s = sharedOf(ctx, d);
  const pick = sharePick(ctx, d);
  const bots = shareBots(ctx, pick);
  const top = bots[0];
  const others = bots.slice(1).filter((b) => b.slug !== ASK_ANY);
  const rest = top?.slug === ASK_ANY ? others.slice(0, 4) : [...others.slice(0, 3), askAny()];
  const radio = (slug: string) => box([box([], { width: 8, height: 8, borderRadius: 4, backgroundColor: C.paper })], {
    width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", flexShrink: 0,
    backgroundColor: whenEq("bot", slug, C.ink, C.paper), borderWidth: 1.5, borderColor: whenEq("bot", slug, C.ink, C.outline),
  });
  const choose = (b: LiveBot) => seq(setState("bot", b.slug), setState("what", "$state.asks." + b.slug));
  if (!s.kind) {
    return page(ctx, { back: true, title: "Send to X0 Bot", nav: "bots", body: [emptyState({ pose: "hello", title: "Nothing to send yet", body: "From any app's Share menu, pick X0 Bot, and it lands here with the bot that fits best." })] });
  }
  const asks: Record<string, string> = {};
  for (const b of bots) asks[b.slug] = b.slug === pick && d.ask ? d.ask : defaultAsk(b.slug, s.kind);
  return page(ctx, {
    title: "Send to X0 Bot", nav: "bots", state: { bot: pick, what: asks[pick] ?? "", asks },
    body: [
      row([row([text("Cancel", { size: 15, color: C.grey70, lineHeight: 20 })], { minHeight: 44, paddingRight: 8 }, back()), grow(), text("Send to X0 Bot", { size: 16, weight: 600, lineHeight: 21 }), grow(), box([], { width: 50 })]),
      sharedCard(ctx, s),
      col([
        sectionLabel("Send to a bot"),
        ...(top ? [row([
          botAvatar(top, 30),
          col([row([text(top.name, { size: 15, weight: 600, lineHeight: 20 }), ...(top.slug === d.pick ? [box([text("Suggested", { size: 11, weight: 600, color: C.grey70, lineHeight: 14 })], { backgroundColor: C.surface, borderRadius: 8, paddingVertical: 2, paddingHorizontal: 7 })] : [])], { gap: 8 }), meta(SHARE_LINE[top.slug] ?? top.purpose, { size: 12, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
          radio(top.slug),
        ], { gap: 12, padding: 14, borderRadius: 18, borderWidth: 1.5, borderColor: whenEq("bot", top.slug, top.color, C.line) }, choose(top))] : []),
        ...(rest.length ? [listCard(rest.map((b) => row([
          botAvatar(b, 30), col([text(b.name, { size: 15, lineHeight: 20 }), meta(SHARE_LINE[b.slug] ?? b.purpose, { size: 12, lines: 1 })], { gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }), radio(b.slug),
        ], { gap: 12, paddingVertical: 12, paddingHorizontal: 14 }, choose(b))))] : []),
      ], { gap: 8 }),
      col([
        sectionLabel("What should it do?"),
        inputBox([field("what", "what", "Say what it should do")], { radius: 14 }),
        ...bots.map((b) => when({ eq: ["bot", b.slug] }, meta(shareLineFor(b.slug, b.name), { size: 12, lineHeight: 17 }))),
        when({ truthy: "sendingShare" }, row([statusMark("working", { color: C.ink }), meta("Sending…", { size: 13 })], { gap: 8 })),
      ], { gap: 8 }),
    ],
    footer: [primaryButton("Send", shareSend(ctx, s, d), { wide: true }), quietButton("Share with a space or person", sharePeople(s), { wide: true, size: "md" })],
  });
}

function defaultAsk(slug: string, kind: "file" | "link" | "text"): string {
  switch (slug) {
    case "travel": return kind === "file" ? "Add this trip to my plan" : "Keep this with my trip";
    case "plan": return "Put this on my calendar";
    case "code": return kind === "link" ? "Look at this and tell me what to change" : "Look at this";
    case "keybot": return "Write a reply to this";
    default: return kind === "file" ? "What's in this?" : "What should I do with this?";
  }
}

function shareDesk(ctx: BotsCtx, d: ShareData) {
  const s = sharedOf(ctx, d);
  const pick = sharePick(ctx, d);
  const bots = shareBots(ctx, pick);
  if (!s.kind) {
    return page(ctx, { title: "Send to a bot", nav: "bots", body: [title("Send to a bot"), emptyState({ pose: "hello", title: "Nothing to send yet", body: "Drop a file, a link or some text on this window, or pick X0 Bot in another app's Share menu. It lands here with the bot that fits best." })] });
  }
  const asks: Record<string, string> = {};
  for (const b of bots) asks[b.slug] = b.slug === pick && d.ask ? d.ask : defaultAsk(b.slug, s.kind);
  const big = (b: LiveBot) => when({ eq: ["bot", b.slug] }, col([
    botAvatar(b, 56),
    text(b.slug === ASK_ANY ? b.name : `Send to ${b.name}`, { size: 24, weight: 700, lineHeight: 30, align: "center" }),
    text(SHARE_LINE[b.slug] ?? b.purpose, { size: 14, color: C.grey70, lineHeight: 20, align: "center" }),
    ...(b.slug === d.pick ? [row([infoChip("Suggested")], { justifyContent: "center" })] : []),
    box([sharedCard(ctx, s)], { width: 360, maxWidth: "100%" }),
  ], { alignItems: "center", gap: 10, paddingVertical: 32, paddingHorizontal: 24, borderRadius: 22, borderWidth: 2, borderColor: b.color, borderStyle: "dashed" }));
  const others = (b: LiveBot) => when({ neq: ["bot", b.slug] }, row([
    botAvatar(b, 30), col([text(b.name, { size: 13, weight: 600, lineHeight: 18 }), text(SHARE_LINE[b.slug] ?? b.purpose, { size: 11.5, color: C.meta, lineHeight: 15, lines: 1 })], { gap: 1, flexShrink: 1, minWidth: 0 }),
  ], { gap: 10, padding: 12, borderRadius: 16, borderWidth: 1.5, borderColor: C.outline, borderStyle: "dashed", minWidth: 0 }, seq(setState("bot", b.slug), setState("what", "$state.asks." + b.slug))));
  return page(ctx, {
    title: "Send to a bot", nav: "bots", maxWidth: 760, state: { bot: pick, what: asks[pick] ?? "", asks },
    body: [
      ...bots.map(big),
      col([sectionLabel("Or send to another bot"), grid(bots.map(others), 3, 10)], { gap: 10 }),
      col([
        row([sectionLabel("What it should do"), grow()]),
        inputBox([field("what", "what", "Say what it should do", { onSubmit: shareSend(ctx, s, d) })], { radius: 14 }),
        ...bots.map((b) => when({ eq: ["bot", b.slug] }, meta(shareLineFor(b.slug, b.name), { size: 12.5, lineHeight: 18 }))),
        when({ truthy: "sendingShare" }, row([statusMark("working", { color: C.ink }), meta("Sending…", { size: 13 })], { gap: 8 })),
      ], { gap: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.divider }),
      row([quietButton("Cancel", back(), { size: "md" }), grow(), secondaryButton("Share with a space or person", sharePeople(s), { size: "md", icon: "share" }), primaryButton("Send", shareSend(ctx, s, d), { size: "md" })], { gap: 12 }),
    ],
  });
}

// ===================================================================== bots.avatars

const MOMENTS: Array<{ pose: "hello" | "listen" | "think" | "needs" | "done"; who: string; slug: string; line: string }> = [
  { pose: "hello", who: "X0 Bot · Hello", slug: "tailzu", line: "Ink · no light · home, welcome" },
  { pose: "listen", who: "Keybot · Listening", slug: "keybot", line: "Clay" },
  { pose: "think", who: "Code bot · On it", slug: "code", line: "Moss" },
  { pose: "needs", who: "Plan bot · Needs you", slug: "plan", line: "Ochre" },
  { pose: "done", who: "Travel bot · All set", slug: "travel", line: "Sea" },
];

function avatarsPage(ctx: BotsCtx) {
  const desk = isDesk(ctx);
  const tiles = MOMENTS.map((m) => col([
    blip(m.pose, desk ? 150 : 120),
    col([text(m.who, { size: 13, weight: 600, lineHeight: 18, align: "center" }), row([statusMark("working", { color: lookOf(m.slug).color, still: true }), meta(m.line, { size: 12 })], { gap: 6, justifyContent: "center" })], { gap: 3, alignItems: "center" }),
  ], { alignItems: "center", gap: 10, minWidth: 0 }));
  return page(ctx, {
    back: true, title: "Blip, as every bot", nav: "you",
    body: [
      col([title("Blip, as every bot"), meta("The app stays black and white; the only colour is each bot's own, in its light. His pose says what's happening.", { size: 13, lineHeight: 19 })], { gap: 6 }),
      grid(tiles, desk ? 5 : 2, 16),
      col([sectionLabel("Small, inside the app"), row(["code", "keybot", "plan", "travel"].map((s) => botAvatar(lookOf(s), 40)), { gap: 12 })], { gap: 10 }),
    ],
  });
}

// ===================================================================== the screens

type Deps = Parameters<NonNullable<BotsScreen["load"]>>[1];

export const botsScreens: BotsScreen[] = [
  screen<BotPageData>({
    id: SCREENS.bot,
    load: (ctx, deps) => loadBot(ctx, deps, isDesk(ctx) ? 30 : 6),
    build: (ctx, d) => (!d?.bot ? noBot(ctx) : isDesk(ctx) ? botDesk(ctx, d) : botPhone(ctx, d)),
  }),
  screen<BotPageData>({
    id: SCREENS.chat,
    load: (ctx, deps) => loadBot(ctx, deps, 30),
    build: (ctx, d) => (!d?.bot ? noBot(ctx) : chatPage(ctx, d)),
  }),
  screen<{ draft: DraftView | null }>({
    id: SCREENS.make,
    load: (_ctx, deps) => deps.api<{ draft: DraftView | null }>("GET", `${A}/draft`),
    build: (ctx, d) => (isDesk(ctx) ? makeDesk(ctx, d ? d.draft : undefined) : makePhone(ctx, d ? d.draft : undefined)),
  }),
  screen<EditData>({
    id: SCREENS.edit,
    load: async (ctx, deps: Deps) => {
      const base = await loadBot(ctx, deps, 2);
      const slug = slugParam(ctx);
      if (!base.bot) return base;
      const [apps, mine, listed] = await Promise.all([
        deps.api<{ connectors: App[] }>("GET", "/v1/connectors").then((r) => r.connectors).catch(() => undefined),
        deps.api<{ bots: Array<{ slug: string; colour: string; name: string; builtin: boolean }> }>("GET", "/v1/bots").then((r) => r.bots).catch(() => undefined),
        base.bot.builtin ? Promise.resolve(false) : deps.api<{ listed: boolean }>("GET", `${A}/listing/${enc(slug)}`).then((r) => r.listed).catch(() => false),
      ]);
      return { ...base, apps, mine, listed };
    },
    build: (ctx, d) => (!d?.bot ? noBot(ctx) : isDesk(ctx) ? editDesk(ctx, d) : editPhone(ctx, d)),
  }),
  screen<KeysData>({
    id: SCREENS.keys,
    load: async (ctx, deps) => {
      const slug = slugParam(ctx);
      const [bot, keys, usage] = await Promise.all([
        deps.api<{ bot?: BotView }>("GET", `/v1/bots/${enc(slug)}`).then((r) => r.bot).catch(() => undefined),
        deps.api<{ keys: KeyView[] }>("GET", `/v1/bots/${enc(slug)}/keys`).then((r) => r.keys).catch(() => undefined),
        deps.api<Usage>("GET", `${A}/keys/${enc(slug)}/usage?tz=${ctx.tzOffsetMinutes}`).catch(() => undefined),
      ]);
      return { bot, keys, usage };
    },
    build: (ctx, d) => (!d?.bot ? noBot(ctx) : d.bot.builtin ? page(ctx, { back: true, title: "Keys", nav: d.bot.slug, body: [emptyState({ pose: "think", title: `${d.bot.name} is X0 Bot's own`, body: "Keys are for bots you make. Make one, and your own site or app can ask it.", action: { label: "Make a bot", onPress: open(SCREENS.make) } })] })
      : isDesk(ctx) ? keysDesk(ctx, d) : keysPhone(ctx, d)),
  }),
  screen<Shop>({
    id: SCREENS.store,
    load: (ctx, deps) => deps.api<Shop>("GET", `${A}/store${ctx.params.q ? `?q=${enc(String(ctx.params.q))}` : ""}`),
    build: (ctx, d) => (isDesk(ctx) ? storeDesk(ctx, d) : storePhone(ctx, d)),
  }),
  screen<PlanRead>({
    id: SCREENS.plan,
    load: (ctx, deps) => deps.api<PlanRead>("GET", `${A}/plan?tz=${ctx.tzOffsetMinutes}&week=${planWeek(ctx)}`),
    build: (ctx, d) => (isDesk(ctx) ? planDesk(ctx, d) : planPhone(ctx, d)),
  }),
  screen<TravelData>({
    id: SCREENS.travel,
    load: async (ctx, deps) => {
      const [t, files] = await Promise.all([
        deps.api<TripData>("GET", `${A}/trip`).catch(() => undefined),
        deps.api<{ files: MediaFile[] }>("GET", "/v1/files").then((r) => r.files).catch(() => undefined),
      ]);
      const x = t?.trip
        ? await deps.api<{ extras: places.TripExtrasView }>("GET", `${A}/trip/${enc(t.trip.id)}/extras?tz=${ctx.tzOffsetMinutes}`).then((r) => r.extras).catch(() => undefined)
        : undefined;
      return { t, files, x };
    },
    build: (ctx, d) => (isDesk(ctx) ? travelDesk(ctx, d ?? {}) : travelPhone(ctx, d ?? {})),
  }),
  screen<ShareData>({
    id: SCREENS.shareIn,
    load: async (ctx, deps) => {
      type Got = { file: MediaFile; attachment: Attachment };
      const got = (await Promise.all(shareFileIds(ctx.params).map((id) => deps.api<Got>("GET", `/v1/files/${enc(id)}`).catch(() => undefined))))
        .filter((g): g is Got => !!g?.file && !!g.attachment);
      const text0 = String(ctx.params.text ?? ""), url = String(ctx.params.url ?? "");
      if (!got.length && !text0 && !url) return {};
      const name = got.map((g) => g.file.name).join(", ").slice(0, 200);
      const sug = await deps.api<{ pick: string | null; ask: string; line: string }>("POST", `${A}/share/suggest`, { ...(name ? { name } : {}), ...(text0 ? { text: text0 } : {}), ...(url ? { url } : {}) }).catch(() => undefined);
      const files = got.length ? { file: got[0]!.file, attachment: got[0]!.attachment, files: got.map((g) => g.file), attachments: got.map((g) => g.attachment) } : {};
      return { ...files, pick: sug?.pick ?? null, ...(sug ? { ask: sug.ask, line: sug.line } : {}) };
    },
    build: (ctx, d) => (isDesk(ctx) ? shareDesk(ctx, d ?? {}) : sharePhone(ctx, d ?? {})),
  }),
  screen({ id: SCREENS.avatars, build: (ctx) => avatarsPage(ctx) }),
  // Plan's own calendar, one event or to-do at a time (screens/planItem.ts).
  ...planItemScreens,
];
