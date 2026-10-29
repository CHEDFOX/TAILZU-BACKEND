/**
 * REPORTING AND BLOCKING (App Review guideline 1.2), in Spaces' look: someone's page, the report screen, and Blocked people.
 *
 *   bots.person   someone you share a space or a chat with (params: id): the spaces you share, Message, Report, Block or Unblock.
 *                 Reached from a chat's header, a name in a group chat, and a space's member page.
 *   bots.report   report a message, a shared thing or a person (params: kind, id, thread): what it is, why (one reason), a note if
 *                 they like, and "Also block". Reached from a message's Report, a shared thing's page, and someone's page.
 *   bots.blocked  Blocked people, each with Unblock (You › Blocked people, Settings, Spaces).
 *
 * Data is routes/safety.ts; every rule is src/botsBots/{safety,blocks}.ts. Every write is a call, a short toast and a refresh.
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../shared/types/sdui.js";
import {
  back, box, C, call, col, divider, emptyState, FACE, grow, icon, listCard, listRow, meta, notice, open, page, primaryButton,
  quietButton, row, SCREENS, secondaryButton, sectionLabel, seq, switchRow, text, title, when, whenEq, type BotsCtx,
} from "../kit.js";
import { screen, type BotsScreen } from "../registry.js";

const A = "/v1/botsapp/bots";
const enc = encodeURIComponent;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const refresh: ActionSpec = { kind: "refresh" };
const toast = (message: string, error = false): ActionSpec => ({ kind: "toast", message, ...(error ? { tone: "error" as const } : {}) });
const idParam = (ctx: BotsCtx, k = "id"): string => String(ctx.params[k] ?? "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
const shortDate = (ctx: BotsCtx, ms: number) => { const d = new Date(ms + ctx.tzOffsetMinutes * 60_000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

function personDot(name: string, size = 48): Node {
  return box([text((name.trim()[0] ?? "?").toUpperCase(), { size: Math.round(size * 0.36), weight: 600, color: C.grey70, lineHeight: Math.round(size * 0.44) })], {
    width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", flexShrink: 0,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.outline,
  });
}

function couldNot(ctx: BotsCtx, what: string, body = "It may have gone, or the connection dropped. Try again.") {
  return page(ctx, { back: true, title: what, nav: "you", body: [emptyState({ pose: "think", title: `Couldn't open ${what.toLowerCase()}`, body, action: { label: "Try again", onPress: refresh } })] });
}

/** Block `userId`, then come back here (the two-step: the first press shows what it means). */
const blockAction = (userId: string, name: string): ActionRef => call("POST", `${A}/blocks`, { person: userId }, {
  ok: seq(toast(`${name} is blocked`), { kind: "setState", path: "sure", value: false }, refresh),
  fail: toast("Couldn't block them. Try again.", true),
});
const unblockAction = (userId: string, name: string): ActionRef => call("DELETE", `${A}/blocks/${enc(userId)}`, undefined, {
  ok: seq(toast(`${name} is unblocked`), refresh), fail: toast("Couldn't unblock them. Try again.", true),
});

/** What a block does, in one place (blocks.ts), so the person page and the report screen say the same. */
const BLOCK_MEANS = "You won't see each other's messages or anything they share, and you won't be in each other's lists of people. They can't message you. They aren't told.";

// ===================================================================== bots.person

interface Person { userId: string; name: string; spaces: string[]; blockedByYou: boolean; canMessage: boolean }

function personPage(ctx: BotsCtx, p: Person | undefined) {
  if (!p) return couldNot(ctx, "This person", "You can only see someone you share a space or a chat with.");
  const message = call("POST", `${A}/threads/direct`, { person: p.userId }, { assignTo: "dm", ok: { kind: "navigate", screenId: SCREENS.thread, params: { id: "$state.dm.id" } }, fail: toast("You can't message them from here.", true) });
  const rows: Node[] = [
    ...(p.canMessage ? [listRow({ label: `Message ${p.name}`, left: icon("send", { size: 18 }), onPress: message })] : []),
    listRow({ label: `Report ${p.name}`, sub: "Tell us they broke the rules", left: icon("shield", { size: 18 }), onPress: open(SCREENS.report, { kind: "person", id: p.userId }) }),
    p.blockedByYou
      ? listRow({ label: `Unblock ${p.name}`, left: icon("lock", { size: 18 }), onPress: unblockAction(p.userId, p.name) })
      : listRow({ label: `Block ${p.name}`, left: icon("lock", { size: 18 }), onPress: { kind: "toggleState", path: "sure" } }),
  ];
  return page(ctx, {
    back: true, title: p.name, nav: "you", maxWidth: 720, state: { sure: false }, live: ["blocks", "spaces", "threads"],
    body: [
      row([personDot(p.name), col([title(p.name, { size: 24 }), meta(p.spaces.length ? `In ${p.spaces.join(", ")}` : "You've chatted before", { size: 13, lines: 2 })], { gap: 2, flexShrink: 1, minWidth: 0 })], { gap: 14 }),
      ...(p.blockedByYou ? [notice(`You blocked ${p.name}. ${BLOCK_MEANS}`, { mark: "lock" })] : []),
      listCard(rows),
      ...(p.blockedByYou ? [] : [when({ truthy: "sure" }, col([
        text(`Block ${p.name}?`, { size: 17, weight: 600, lineHeight: 22 }),
        text(BLOCK_MEANS, { size: 14, lineHeight: 20, color: C.grey70 }),
        meta("You can unblock them any time in You, Blocked people.", { size: 12 }),
        row([primaryButton(`Block ${p.name}`, blockAction(p.userId, p.name), { size: "md" }), secondaryButton("Cancel", { kind: "setState", path: "sure", value: false }, { size: "md" })], { gap: 8, flexWrap: "wrap" }),
      ], { gap: 10, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line }))]),
    ],
  });
}

// ===================================================================== bots.report

interface Preview {
  kind: "message" | "item" | "person"; what: string; text: string; person: { userId: string | null; name: string; blockedByYou: boolean };
  reasons: Array<{ id: string; label: string }>;
}

/** A text field the kit's way (as spaces.ts draws them): no frame of its own, in a 1px box. */
function noteField(path: string, placeholder: string): Node {
  return row([{
    type: "TextField", id: path, bind: { value: path },
    props: { placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0, minHeight: 72, color: C.ink, multiline: true, returnKeyType: "done" },
    style: { flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 72, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.regular, fontSize: 15, lineHeight: 22, color: C.ink, borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none" },
  }], { borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: C.paper });
}

function reportPage(ctx: BotsCtx, d: Preview | undefined) {
  const kind = String(ctx.params.kind ?? "");
  if (!d) return couldNot(ctx, "This report", "It may have been taken out already, or you can't see it any more.");
  const id = idParam(ctx), thread = idParam(ctx, "thread");
  const who = d.person.name || "them";
  const heading = d.kind === "message" ? "Report a message" : d.kind === "item" ? "Report something shared" : `Report ${who}`;
  const canBlock = !!d.person.userId && !d.person.blockedByYou;
  const send: ActionSpec = {
    kind: "condition", if: { falsy: "reason" }, then: toast("Pick why you're reporting it"),
    else: call("POST", `${A}/reports`, { kind: d.kind || kind, id, ...(thread ? { thread } : {}), reason: "$state.reason", note: "$state.note", block: "$state.block" }, {
      ok: seq(toast("Thanks. We'll look at it within 24 hours."), back()),
      fail: toast("Couldn't send the report. Try again.", true),
    }),
  };
  const reasonRows = d.reasons.map((r) => listRow({
    label: r.label, chevron: false,
    right: box([when({ eq: ["reason", r.id] }, icon("check", { size: 14, color: C.paper }))], {
      width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", flexShrink: 0,
      borderWidth: whenEq("reason", r.id, 0, 1.5), borderColor: C.outline, backgroundColor: whenEq("reason", r.id, C.ink, C.paper),
    }),
    onPress: { kind: "setState", path: "reason", value: r.id },
  }));
  return page(ctx, {
    back: true, title: heading, nav: "you", maxWidth: 720, state: { reason: "", note: "", block: false },
    body: [
      col([title(heading), meta(`We look at every report within 24 hours. ${d.kind === "person" ? who : "They"} won't be told who reported it.`, { size: 13 })], { gap: 4 }),
      col([
        text(d.what, { size: 15, weight: 600, lineHeight: 20 }),
        ...(d.text ? [text(d.text, { size: 14, lineHeight: 20, color: C.grey70, lines: 4 })] : []),
      ], { gap: 4, padding: 16, borderRadius: 18, backgroundColor: C.surface }),
      col([sectionLabel("Why are you reporting it?"), listCard(reasonRows)], { gap: 8 }),
      col([sectionLabel("Anything else (if you like)"), noteField("note", "What happened, in a few words")], { gap: 8 }),
      ...(canBlock ? [listCard([switchRow(`Also block ${who}`, "block", { sub: "You won't see each other's messages, and they can't message you" })])] : []),
      meta("If someone is in danger, call your local emergency number first.", { size: 12 }),
    ],
    footer: [primaryButton("Send report", send, { wide: true })],
  });
}

// ===================================================================== bots.blocked

interface BlockedData { blocked: Array<{ userId: string; name: string; at: number }> }

function blockedPage(ctx: BotsCtx, d: BlockedData | undefined) {
  const list = d?.blocked;
  return page(ctx, {
    back: true, title: "Blocked people", nav: "you", maxWidth: 720, live: ["blocks"],
    body: [
      col([title("Blocked people"), meta(BLOCK_MEANS, { size: 13 })], { gap: 4 }),
      ...(!list ? [emptyState({ pose: "think", title: "Couldn't load who you blocked", body: "Check your connection and try again.", action: { label: "Try again", onPress: refresh } })]
        : list.length ? [col(list.flatMap((b, i) => [
          ...(i ? [divider()] : []),
          row([personDot(b.name, 36), col([text(b.name, { size: 15, weight: 500, lineHeight: 20, lines: 1 }), meta(`Blocked ${shortDate(ctx, b.at)}`, { size: 12 })], { gap: 2, flexShrink: 1, minWidth: 0 }), grow(),
            secondaryButton("Unblock", unblockAction(b.userId, b.name), { size: "md" })], { gap: 12, paddingVertical: 12, paddingHorizontal: 16 }),
        ]), { borderWidth: 1, borderColor: C.line, borderRadius: 18, overflow: "hidden" })]
          : [emptyState({ pose: "hello", title: "Nobody blocked", body: "To block someone, open their name in a chat or a space." })]),
      quietButton("Spaces and chats", open(SCREENS.spaces), { size: "md" }),
    ],
  });
}

// ===================================================================== the screens

export const safetyScreens: BotsScreen[] = [
  screen<Person>({ id: SCREENS.person, load: (ctx, deps) => deps.api<{ person: Person }>("GET", `${A}/people/${enc(idParam(ctx))}`).then((r) => r.person), build: personPage }),
  screen<Preview>({
    id: SCREENS.report,
    load: (ctx, deps) => {
      const kind = String(ctx.params.kind ?? "").replace(/[^a-z]/g, "").slice(0, 10);
      const thread = idParam(ctx, "thread");
      return deps.api<Preview>("GET", `${A}/reports/preview?kind=${enc(kind)}&id=${enc(idParam(ctx))}${thread ? `&thread=${enc(thread)}` : ""}`);
    },
    build: reportPage,
  }),
  screen<BlockedData>({ id: SCREENS.blocked, load: (_ctx, deps) => deps.api<BlockedData>("GET", `${A}/blocks`), build: blockedPage }),
];
