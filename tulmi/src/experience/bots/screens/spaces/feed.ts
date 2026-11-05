/**
 * INSIDE A SPACE, THE NEW WAY (bots.spaces?id=, for a build that draws it: kit canSpaces2; docs/bots-app.md "Spaces"): no people at the
 * top, only back, the space's name and a door to its people; one feed, newest at the bottom; and at the bottom the person's own tiny
 * bot walking, his thought the box they write in (a pill "Write to everyone, or @ someone" riding over him at rest).
 *
 *   "@"  picks a person: the message goes to them only (and, silently, to the space's admin). Shown "To Mom" to its sender and the admin.
 *   "/"  picks one of the person's bots, then one of its things: whoever it goes to (one person, or everyone) can work on it from that
 *        bot's page (Work in space). The card in the feed opens it there.
 *
 * Reads GET .../spaces/:id/feed and writes POST .../spaces/:id/feed (src/botsBots/spaceFeed.ts does every check: who sees what, the
 * admin's line, blocks). A name said or typed at the start with no person picked is never sent blind: the server answers `confirm`
 * and the box asks "Send this to Mom only?". Until a member taps OK on the line about the admin, the box is that line instead.
 * Voice (double-tap him; the window's one key) only for a build that listens with live words (canVoice).
 */

import type { ActionRef, ActionSpec, Node, ScreenResponse, TalkTo } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, C, SCREENS, box, botKind, botStage, button, call, canScroll, canVoice, card, col, emptyState, icon, liveWords, mentionField,
  meta, open, page, picture, primaryButton, roamFor, row, scrollBox, sectionLabel, seq, text, voiceLive, voiceStop, when,
} from "../../kit.js";
import { said } from "../../said.js";
import {
  A, clearState, enc, failed, iconButton, isDesk, kb, kindBadge, personDot, refresh, rowsCard, SHARE_BOTS, shareLook, isShareBot, toast,
  type Payment, type Task,
} from "./parts.js";
import { KIND_WORD } from "./sharePage.js";
import { clockOf, dayKeyOf, dayWords, link, payRow, plural, taskRow } from "./spaceDetail.js";

// ===================================================================== what it reads (src/botsBots/spaceFeed.ts, as the route answers)

type ShareBotSlug = (typeof SHARE_BOTS)[number];
export interface FeedMessage {
  id: string; at: number;
  from: { userId: string | null; name: string; you: boolean };
  /** A message to one person: who. Shown as "To <name>" to its sender and to the admin; the recipient sees a normal message. */
  to: { userId: string; name: string; you: boolean } | null;
  text: string;
  files: Array<{ id: string; name: string; mime: string; bytes: number; kind: string; url: string }>;
  thing: { grantId: string; bot: ShareBotSlug; botName: string; ownerId: string; id: string; title: string; line: string } | null;
  /** A shared thing from SharedItems (as today's chats show it). */
  item: { id: string; kind: string; title: string } | null;
}
export interface FeedRead {
  space: { id: string; name: string; admin: boolean; adminName: string; consented: boolean; threadId: string };
  people: Array<{ userId: string; name: string; you: boolean; admin: boolean }>;
  messages: FeedMessage[];
  more: boolean; before: number | null;
  payments: Payment[];
  tasks: Task[];
}

// ===================================================================== a message's parts (today's chat draws them too)

/** A file in a message: a photo by its signed link in a sized box, any other file as a row; both open it. */
export function fileNode(f: FeedMessage["files"][number], desk: boolean): Node {
  const go: ActionSpec = { kind: "openUrl", url: f.url, external: true };
  return f.mime.startsWith("image/")
    ? box([picture(f.url, desk ? 280 : 220, desk ? 200 : 160, { radius: 14, fit: "cover", background: C.surface, label: f.name })], {}, go)
    : row([icon("clip", { size: 16 }), text(f.name, { size: 14, lineHeight: 19, lines: 1, style: { flexShrink: 1 } }), meta(kb(f.bytes), { size: 12 })], {
      gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, maxWidth: 280,
    }, go);
}

/** Something shared from the person's things (a list, a trip, a note), opening it. */
export function sharedItemNode(item: NonNullable<FeedMessage["item"]>): Node {
  return row([kindBadge(item.kind, 32), col([text(item.title, { size: 14, weight: 500, lineHeight: 19, lines: 2 }), meta(`${KIND_WORD[item.kind] ?? "Shared"} · open`, { size: 12 })], { gap: 2, flexShrink: 1 })], {
    gap: 10, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, maxWidth: 300,
  }, open(SCREENS.spaceItem, { item: item.id }));
}

// ===================================================================== the feed

/** "To Mom": a message to one person, as its sender and the space's admin see it (the recipient sees a plain message). */
const toLine = (name: string): Node => row([icon("send", { size: 12, color: C.meta }), meta(`To ${name}`, { size: 12, weight: 600 })], { gap: 4 });

/**
 * Stop sharing, under a card: for the one who shared it and the space's admin (the server checks it: grants.ts revoke). The access
 * goes at once and the card leaves the feed for everyone.
 */
const stopSharing = (f: FeedRead, t: NonNullable<FeedMessage["thing"]>): Node => row([link("Stop sharing", call("DELETE", `${A}/spaces/${enc(f.space.id)}/grants/${enc(t.grantId)}`, undefined, {
  stay: true, ok: seq(toast("Stopped sharing"), refresh), fail: said("Couldn't stop sharing it. Try again."),
}))], { justifyContent: "center", minHeight: 28 });

/** A thing shared from a bot: who shared it, what, from which bot, and the way to work on it there. */
function thingCard(f: FeedRead, m: FeedMessage, t: NonNullable<FeedMessage["thing"]>): Node {
  const look = isShareBot(t.bot) ? shareLook(t.bot) : null;
  return col([
    row([box([], { width: 8, height: 8, borderRadius: 4, backgroundColor: look?.color ?? C.idle }), sectionLabel(t.botName)], { gap: 6 }),
    meta(m.from.you ? "You shared" : `${m.from.name} shared`, { size: 12 }),
    text(t.title, { size: 15, weight: 600, lineHeight: 20 }),
    meta(`from ${t.botName}${t.line ? ` · ${t.line}` : ""}`, { size: 12 }),
    button(`Open in ${t.botName}`, open(SCREENS.work, { bot: t.bot, space: f.space.id, owner: t.ownerId, item: t.id }), { kind: "secondary", size: "md", wide: true }),
    ...(m.from.you || f.space.admin ? [stopSharing(f, t)] : []),
  ], {
    width: 256, maxWidth: "100%", gap: 4, paddingTop: 12, paddingHorizontal: 14, paddingBottom: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line,
    backgroundColor: C.paper, ...(m.from.you ? { borderBottomRightRadius: 6 } : { borderBottomLeftRadius: 6 }),
  });
}

/** One message: theirs on the left (their dot and name over it), yours on the right in ink; "To Mom" over a message to one person. */
function feedRow(ctx: BotsCtx, f: FeedRead, m: FeedMessage, named: boolean): Node {
  const mine = m.from.you;
  const desk = isDesk(ctx);
  const parts: Node[] = [];
  if (!mine && named) parts.push(row([meta(m.from.name, { size: 12, weight: 600 })], { paddingLeft: 4, minHeight: 16 }));
  // Only its sender and the space's admin are shown who it went to; to the one it went to, it is a message like any other.
  if (m.to && (mine || f.space.admin) && !m.to.you) parts.push(toLine(m.to.name));
  if (m.thing) parts.push(thingCard(f, m, m.thing));
  for (const x of m.files) parts.push(fileNode(x, desk));
  if (m.item) parts.push(sharedItemNode(m.item));
  if (m.text) {
    parts.push(box([text(m.text, { size: 15, lineHeight: 20, color: mine ? C.paper : C.ink })], {
      backgroundColor: mine ? C.ink : C.surface, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 18,
      ...(mine ? { borderBottomRightRadius: 6 } : { borderBottomLeftRadius: 6 }),
    }));
  }
  // Someone else's message can be reported, right under it (App Review 1.2), as in every chat.
  parts.push(mine ? meta(clockOf(ctx, m.at), { size: 11 }) : row([
    meta(clockOf(ctx, m.at), { size: 11 }),
    row([meta("Report", { size: 11 })], { minHeight: 20, paddingHorizontal: 4 }, open(SCREENS.report, { kind: "message", id: m.id, thread: f.space.threadId })),
  ], { gap: 6 }));
  const bubble = col(parts, { gap: 4, maxWidth: desk ? "72%" : "84%", alignItems: mine ? "flex-end" : "flex-start", minWidth: 0 });
  if (mine) return row([bubble], { justifyContent: "flex-end" });
  // Their dot sits by their last line, as a chat draws it.
  return row([named ? personDot(m.from.name, false, 28) : box([], { width: 28, flexShrink: 0 }), bubble], { gap: 8, alignItems: "flex-end" });
}

const dayRule = (label: string): Node => row([meta(label, { size: 12, weight: 500 })], { justifyContent: "center", paddingTop: 6 });

function feedRows(ctx: BotsCtx, f: FeedRead): Node[] {
  const out: Node[] = [];
  let day = "", last = "";
  for (const m of f.messages) {
    const k = dayKeyOf(ctx, m.at);
    if (k !== day) { out.push(dayRule(dayWords(ctx, m.at))); day = k; last = ""; }
    const who = m.from.userId ?? m.from.name;
    out.push(feedRow(ctx, f, m, who !== last));
    last = who;
  }
  return out;
}

// ===================================================================== writing

/** Nothing in the box: every key empty (MentionDraft). */
const EMPTY_DRAFT = { text: "", toId: "", toName: "", bot: "", botName: "", thingId: "", thingTitle: "" };

/** After a post went: the question, the box and its words go, it closes, and the feed shows the new message. */
const sent = (): ActionRef => seq(clearState("said"), clearState("draft"), { kind: "setState", path: "thOpen", value: false }, refresh);
const openBox: ActionSpec = { kind: "setState", path: "thOpen", value: true };

/**
 * What the box sends: the words, the person picked (none: everyone) and the thing picked. `stay`: the window keeps this screen as it is
 * (a fetch would wipe `said` before "Send this to Mom only?" could show). The server answers `confirm` for a name at the start with no
 * person picked: the box opens on the question.
 */
function sendAction(id: string): ActionRef {
  return {
    kind: "condition", if: { any: [{ truthy: "draft.text" }, { truthy: "draft.thingId" }] },
    then: call("POST", `${A}/spaces/${enc(id)}/feed`, { text: "$state.draft.text", to: "$state.draft.toId", thing: { bot: "$state.draft.bot", id: "$state.draft.thingId" } }, {
      assignTo: "said", stay: true,
      ok: { kind: "condition", if: { truthy: "said.confirm" }, then: openBox, else: sent() },
      fail: said("Couldn't send it. Try again."),
    }),
    else: toast("Write something first"),
  };
}

/**
 * A voice turn (canVoice): his words, at a pause (900 ms), go as a message to everyone; a name said first comes back as `confirm`, and
 * the box opens on the question (at rest it shows only its words). No refresh while he listens: the feed follows its live topics.
 */
function voiceTurn(id: string, mode: "once" | "chat"): Extract<ActionSpec, { kind: "voiceLive" }> {
  return voiceLive({
    mode, statePath: "voice", into: "heard", silenceMs: 900,
    onHeard: call("POST", `${A}/spaces/${enc(id)}/feed`, { text: "$state.heard", voice: true }, {
      assignTo: "said", stay: true, ok: { kind: "condition", if: { truthy: "said.confirm" }, then: openBox }, fail: said("Couldn't send it. Try again."),
    }),
    stopWhen: { truthy: "said.confirm" }, onBlocked: toast("Turn on the microphone for X0 Bot in Settings.", true),
  }) as Extract<ActionSpec, { kind: "voiceLive" }>;
}

/** "Send this to Mom only?": Just them (when one person matched), Everyone, Cancel. */
function confirmRow(id: string): Node {
  const post = (body: Record<string, unknown>) => call("POST", `${A}/spaces/${enc(id)}/feed`, body, { stay: true, ok: sent(), fail: said("Couldn't send it. Try again.") });
  return col([
    text("", { size: 15, weight: 500, lineHeight: 20, bind: "said.confirm.line" }),
    row([
      when({ truthy: "said.confirm.toId" }, primaryButton("Just them", post({ text: "$state.said.confirm.text", to: "$state.said.confirm.toId" }), { size: "md" })),
      // They chose everyone: the server is told so, and doesn't ask about the name again.
      button("Everyone", post({ text: "$state.said.confirm.whole", everyone: true }), { kind: "secondary", size: "md" }),
      link("Cancel", seq(clearState("said"), { kind: "setState", path: "thOpen", value: false })),
    ], { gap: 8, flexWrap: "wrap" }),
  ], { gap: 12 });
}

/** His stage at the foot of the space: the box he thinks in is where the person writes. Its height holds him, the trail and the pill. */
function stage(ctx: BotsCtx, f: FeedRead): Node {
  const id = f.space.id;
  const desk = isDesk(ctx);
  const voice = canVoice(ctx);
  const shareBots = SHARE_BOTS.map((slug) => ({ slug, name: shareLook(slug).name, color: shareLook(slug).color, kind: botKind(slug) }));
  const field = mentionField({
    life: `space.compose.${id}`, placeholder: "Write to everyone, or @ someone", draftPath: "draft", autoFocus: true, maxLength: 4000,
    people: f.people.filter((p) => !p.you).map((p) => ({ id: p.userId, name: p.name })),
    bots: shareBots, thingsPath: `${A}/work/:bot/mine`,
    tools: [
      { id: "money", label: "Ask for money", action: open(SCREENS.spacePay, { id }) },
      { id: "task", label: "Give a task or plan", action: open(SCREENS.spaceTasks, { id, new: "task" }) },
      { id: "memory", label: "Group memory", action: open(SCREENS.spaceMemory, { id }) },
    ],
    words: { people: "People in this space", bots: "Share from a bot", empty: "Nothing here yet" },
  }, sendAction(id));
  const tapHim: ActionRef = voice ? { kind: "condition", if: { truthy: "voice" }, then: voiceStop(), else: openBox } : openBox;
  return botStage({
    life: "space.me", kind: "custom", color: C.ink, size: desk ? 30 : 26, height: desk ? 184 : 176, toys: false, roam: roamFor(ctx),
    // Listening for the whole voice chat, sending included: the box keeps its words between turns, never the rest pill.
    ...(voice ? { listenWhen: { truthy: "voice" }, thinkWhen: { eq: ["voice", "sending"] } } : {}),
    thought: { style: "space", restText: "Write to everyone, or @ someone", openPath: "thOpen", shape: "wide", veil: false, place: "follow" },
    label: voice ? `Your bot. Tap the box to write. ${desk ? "Double-click" : "Double-tap"} him to talk.` : "Your bot. Tap the box to write.",
  }, [
    when({ all: [{ falsy: "voice" }, { falsy: "said.confirm" }] }, field),
    ...(voice ? [when({ truthy: "voice" }, liveWords())] : []),
    when({ truthy: "said.confirm" }, confirmRow(id)),
  ], { onPress: tapHim, ...(voice ? { onDoubleTap: voiceTurn(id, "chat") } : {}) });
}

/** Before a member writes here: the line about the space's admin, once. OK (consent), or the way to leave. */
function consentCard(f: FeedRead): Node {
  return card([
    text("The space's admin can see your work and messages here.", { size: 15, lineHeight: 21 }),
    meta(`${f.space.adminName} made ${f.space.name}, so they are its admin.`, { size: 12 }),
    row([
      primaryButton("OK", call("PUT", `${A}/spaces/${enc(f.space.id)}/consent`, undefined, { ok: refresh, fail: said("Couldn't save that. Try again.") }), { size: "md" }),
      link("Leave the space", open(SCREENS.spacePeople, { id: f.space.id })),
    ], { gap: 12 }),
  ], { gap: 10, padding: 16 });
}

/** What waits on the person here (payments for a yes, tasks and plans): three at most, then the way to the rest. */
function waitingRows(ctx: BotsCtx, f: FeedRead): Node[] {
  const rows = [...f.payments.map((p) => payRow(ctx, f.space.id, p)), ...f.tasks.map((t) => taskRow(ctx, t))];
  if (!rows.length) return [];
  const more = rows.length - 3;
  return [rowsCard(rows.slice(0, 3)), ...(more > 0 ? [row([link(`and ${plural(more, "more thing")}`, open(SCREENS.spaceTasks, { id: f.space.id }))], { justifyContent: "flex-end" })] : [])];
}

// ===================================================================== bots.spaces?id=

export function feedScreen(ctx: BotsCtx, f: FeedRead | undefined): ScreenResponse {
  if (!f) return failed(ctx, "This space");
  const id = f.space.id;
  const desk = isDesk(ctx);
  // No people at the top: the name, and one neutral door to the space's people and its tools (Leave, Report, Block, the code).
  const head = row([
    ...(desk ? [] : [iconButton("back", { kind: "navigateBack" }, "Back", 40)]),
    text(f.space.name, { size: 17, weight: 600, lineHeight: 22, lines: 1, style: { flexGrow: 1, flexShrink: 1, minWidth: 0 } }),
    iconButton("more", open(SCREENS.spacePeople, { id }), `About ${f.space.name}`, 40),
  ], { gap: 8, minHeight: 44 });
  const top = [head, ...waitingRows(ctx, f)];
  const before = Number(ctx.params.before) || 0;
  const feed: Node[] = [
    ...(f.more && f.before ? [row([link("Older messages", open(SCREENS.spaces, { id, before: f.before }))], { justifyContent: "center" })] : []),
    ...(f.messages.length ? feedRows(ctx, f) : [emptyState({ pose: "hello", title: "Nothing here yet", body: "Write to everyone, or @ someone to write to just them." })]),
    ...(before ? [row([link("Back to the newest", { kind: "navigate", screenId: SCREENS.spaces, params: { id }, replace: true })], { justifyContent: "center" })] : []),
  ];
  const voice = canVoice(ctx);
  const talkTo: TalkTo | undefined = f.space.consented && voice ? { voice: voiceTurn(id, "once") } : undefined;
  // The window: the feed scrolls in its own box over his stage, opening at its newest; a window without one scrolls the page.
  const boxed = desk && canScroll(ctx);
  const feedBox = boxed ? [{ ...scrollBox(feed, { flexGrow: 1, flexShrink: 1, minHeight: 0, gap: 14 }), props: { startAtEnd: true } }] : feed;
  return page(ctx, {
    title: f.space.name, nav: "you", gap: 14, maxWidth: 760, startAtEnd: !boxed, ...(boxed ? { fixed: true } : {}),
    state: { thOpen: false, draft: EMPTY_DRAFT, voice: "", heard: "", said: null },
    live: [`space:${id}`, `thread:${f.space.threadId}`],
    ...(desk ? {} : { pinned: [col(top, { gap: 10, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 6, backgroundColor: C.paper })] }),
    // The window's page is fixed, so the rows over the feed must keep their height: only the feed's own box gives way.
    body: desk ? [col(top, { gap: 14, flexShrink: 0 }), ...feedBox] : feed,
    dock: [f.space.consented ? stage(ctx, f) : consentCard(f)],
    ...(talkTo ? { talkTo } : {}),
  });
}
