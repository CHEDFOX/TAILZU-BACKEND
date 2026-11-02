/**
 * The Bots app shell's askCompose screen.
 */

import type { ActionRef, ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import { streamed, SENT_WORDS, failed, start as momentStart, askMoment } from "../../askMoment.js";
import {
  type BotsCtx, seq, SCREENS, keptOffline, row, text, C, box, col, when, labelled, meta, listCard, listRow, type LiveBot, open, icon, page,
  roundButton, back, divider, sectionLabel, grow, primaryButton, statusMark,
} from "../../kit.js";
import {
  canUpload, uploadPick, canRecord, uploadChip, micBlockedNotice, listenAction, notListening, listening, voiceBars, writingDown,
} from "../../media.js";
import { nameOf, colorOf, toast, avatarOf, idleLine, field, kbd } from "./parts.js";

// ===================================================================== ask

/** POST /v1/shell/route's answer: who will answer, and what they do first. */
export interface Route { slug: string; name: string; color: string; say: string; hint: string; by: string }

/** What a built-in is asked most, as "Or try" (built-ins only: a person's own bot is theirs to word). */
const TRIES: Array<{ bot: string; text: string }> = [
  { bot: "plan", text: "What's on tomorrow?" },
  { bot: "code", text: "What changed in my project this week?" },
  { bot: "keybot", text: "Reply to Sam: running 10 minutes late" },
  { bot: "travel", text: "A weekend in Lisbon next month?" },
];
/** The same, for someone in India (by time zone, as the pay page tells the markets apart): their languages, their trips. */
const TRIES_IN: Array<{ bot: string; text: string }> = [
  { bot: "plan", text: "What's on tomorrow?" },
  { bot: "code", text: "What changed in my project this week?" },
  { bot: "keybot", text: "Mummy ko Hindi mein reply likho" },
  { bot: "travel", text: "A weekend in Goa next month?" },
];
const inIndia = (ctx: BotsCtx): boolean => ctx.tzOffsetMinutes === 330;
/** Under Ask's box: that any language works, and for India that Hinglish does. */
const speakLine = (ctx: BotsCtx, listening = false): string =>
  `${listening ? "Listening" : "Speak or type"} · ${inIndia(ctx) ? "Hinglish works" : "any language works"}`;

const routeFor = (ctx: BotsCtx, slug: string): Route => {
  const name = nameOf(ctx, slug);
  const first: Record<string, string> = {
    travel: "Travel bot shows the plan before it books", plan: "Plan Ease asks before it changes your calendar",
    code: "Xode shows the plan before it changes code", keybot: "Keylessbord writes it, you send it", tailzu: "X0 answers, or hands it to the right bot",
  };
  return { slug, name, color: colorOf(ctx, slug), say: `${name} will take this`, hint: `Tap to send · ${first[slug] ?? `${name} asks before it does anything`}`, by: "chosen" };
};

/** The bots the person can hand a message to: Tailzu, then theirs (the built-ins first). */
function candidates(ctx: BotsCtx): string[] {
  const order = ["code", "keybot", "plan", "travel"];
  const mine = ctx.live.bots.slice().sort((a, b) => (order.indexOf(a.slug) + 1 || 9) - (order.indexOf(b.slug) + 1 || 9)).map((b) => b.slug);
  return ["tailzu", ...mine].slice(0, 7);
}

/** Send what is in `ask` to the bot in `route` (or let the front door pick), then open the answer. */
function sendAsk(ctx: BotsCtx): ActionRef {
  // The words go up as the person's bubble and the box clears at once (askMoment.ts); the answer is written in as it comes.
  const ask = (bot: string): ActionSpec => streamed(ctx, {
    kind: "callEndpoint", method: "POST", path: "/v1/shell/ask",
    body: { message: SENT_WORDS, bot, device: ctx.client, mode: "text", ...(ctx.params.file || canUpload(ctx) ? { attachments: "$state.attach" } : {}) },
    assignTo: "asked",
    onSuccess: seq(
      { kind: "setState", path: "asking", value: false },
      {
        kind: "navigate", screenId: SCREENS.ask, replace: true,
        params: { message: SENT_WORDS, answer: "$state.asked.shell.text", bot: "$state.asked.shell.bot.slug", upi: "$state.asked.shell.upi", needs: "$state.asked.shell.needs", job: "$state.asked.shell.job" },
      },
    ),
    onError: failed({ busy: "asking", from: "ask", then: toast("Couldn't reach your bots. Try again.", "error") }),
  });
  return seq(
    ...momentStart({ message: "$state.ask", from: "ask", busy: "asking" }),
    { kind: "condition", if: { truthy: "route.slug" }, then: ask("$state.route.slug"), else: ask("any") },
  );
}

/** Ask who will answer, without answering (decide only). */
const checkWho: ActionSpec = {
  kind: "callEndpoint", method: "POST", path: "/v1/shell/route", body: { message: "$state.ask" }, assignTo: "route",
  onError: seq({ kind: "setState", path: "route", value: { slug: "any", name: "X0 Bot", say: "X0 Bot picks who answers", hint: "Tap to send" } }, toast("Couldn't check who answers. Tap to send anyway.")),
};

/**
 * The big button: nothing said yet, a word; said but not routed, who will answer; routed, send. Offline (a build with an outbox), the ask
 * is kept there for the bot picked, or any, and goes once the connection is back (kit keptOffline). The "Check" chip (`keep: false`)
 * only ever asks who answers.
 */
function goAction(ctx: BotsCtx, o: { keep?: boolean } = {}): ActionRef {
  const keep = o.keep !== false;
  return {
    kind: "condition", if: { falsy: "ask" }, then: toast("Say or type what you need first"),
    else: {
      kind: "condition", if: { truthy: "route.slug" },
      then: keep ? keptOffline(ctx.client, { message: "$state.ask", bot: "$state.route.slug", who: "$state.route.name", clear: "ask" }, sendAsk(ctx)) : sendAsk(ctx),
      else: keep ? keptOffline(ctx.client, { message: "$state.ask", clear: "ask" }, checkWho) : checkWho,
    },
  };
}

const choose = (ctx: BotsCtx, slug: string): ActionSpec => ({ kind: "setState", path: "route", value: routeFor(ctx, slug) });

/** The "who will answer" chip: one per bot, shown when it is the one; before anyone is picked, Tailzu's. */
function whoChip(ctx: BotsCtx): Node {
  const big = ctx.client === "desktop";
  const chipOf = (slug: string, o: { pre?: boolean } = {}) => row([
    avatarOf(ctx, slug, big ? 32 : 30),
    text(o.pre ? "X0 Bot" : nameOf(ctx, slug), { size: 14, weight: 600, lineHeight: 18 }),
    text(o.pre ? "picks who answers" : "will take this", { size: 14, color: C.meta, lineHeight: 18 }),
    box([], { width: 1, height: 18, backgroundColor: C.line }),
    text(o.pre ? "Check" : "Change", { size: 14, weight: 500, lineHeight: 18 }),
  ], {
    gap: big ? 10 : 8, height: big ? 46 : 44, paddingLeft: 6, paddingRight: 14, borderRadius: 23, alignSelf: "flex-start",
    borderWidth: o.pre ? 1 : 1.5, borderColor: o.pre ? C.line : colorOf(ctx, slug), backgroundColor: C.paper,
  }, o.pre ? goAction(ctx, { keep: false }) : { kind: "toggleState", path: "picking" });
  return col([
    when({ falsy: "route.slug" }, chipOf("tailzu", { pre: true })),
    ...candidates(ctx).map((s) => when({ eq: ["route.slug", s] }, labelled(chipOf(s), `${nameOf(ctx, s)} will take this. Change who answers`))),
    when({ eq: ["route.slug", "any"] }, chipOf("tailzu", { pre: true })),
  ], { gap: 0 });
}

/** "Or hand it to": a head per bot. */
function handTo(ctx: BotsCtx): Node {
  return row([
    meta("Or hand it to", { size: 12 }),
    ...candidates(ctx).map((s) => labelled(box([avatarOf(ctx, s, 30)], {
      width: ctx.client === "desktop" ? 40 : 44, height: ctx.client === "desktop" ? 40 : 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
      ...(ctx.client === "desktop" ? { borderWidth: 1, borderColor: C.line } : {}),
    }, choose(ctx, s)), nameOf(ctx, s))),
  ], { gap: ctx.client === "desktop" ? 6 : 2, flexWrap: "wrap" });
}

/** Every bot as a list to pick from (after Change). */
function pickList(ctx: BotsCtx): Node {
  return when({ truthy: "picking" }, listCard(candidates(ctx).map((s) => listRow({
    label: nameOf(ctx, s), sub: s === "tailzu" ? "Answers, or hands it to the right bot" : idleLine(ctx.live.bots.find((b) => b.slug === s) ?? ({ slug: s, purpose: "" } as LiveBot), ctx.client),
    left: avatarOf(ctx, s, 30), onPress: seq(choose(ctx, s), { kind: "setState", path: "picking", value: false }),
  }))));
}

function tries(ctx: BotsCtx): Node[] {
  const have = new Set(ctx.live.bots.map((b) => b.slug));
  return (inIndia(ctx) ? TRIES_IN : TRIES).filter((t) => have.has(t.bot)).map((t) => row([
    avatarOf(ctx, t.bot, 26),
    text(t.text, { size: 14, lineHeight: 19, lines: 1, style: { flexGrow: 1, flexShrink: 1 } }),
    meta(nameOf(ctx, t.bot), { size: 12, style: { flexShrink: 0 } }),
  ], { gap: 12, minHeight: 44, paddingHorizontal: ctx.client === "desktop" ? 10 : 0, borderRadius: 12 },
  seq({ kind: "setState", path: "ask", value: t.text }, choose(ctx, t.bot))));
}

/** The voice bars beside "Speak or type". */
function bars(heights: number[]): Node {
  return row(heights.map((h) => box([], { width: 3, height: h, borderRadius: 2, backgroundColor: C.ink })), { gap: heights.length > 8 ? 3 : 2, height: Math.max(...heights), alignItems: "center" });
}

/** Attach: pick and send it here (a build that can, FileUpload), else the attach screen as before. */
function attachTo(ctx: BotsCtx, kind: "photo" | "file" | "screen"): ActionSpec {
  if (canUpload(ctx)) return uploadPick(kind === "screen" ? "screenshot" : kind, "attach");
  return open(SCREENS.attach, { kind, from: "ask", message: "$state.ask" });
}

export function askCompose(ctx: BotsCtx, pre: Route | undefined) {
  const message = String(ctx.params.message ?? "");
  const fileName = ctx.params.fileName ? String(ctx.params.fileName) : "";
  const state = {
    ask: message, picking: false, route: pre ?? (ctx.params.bot ? routeFor(ctx, String(ctx.params.bot)) : null),
    ...(ctx.params.file && ctx.params.attachment ? { attach: [ctx.params.attachment] } : {}),
    // A file on its way and the file sent (media.ts uploadChip); the voice (the phone's mic).
    ...(canUpload(ctx) ? { up: null, sent: fileName && ctx.params.attachment ? { name: fileName, size: "" } : null } : {}),
    ...(canRecord(ctx) ? { voice: "idle", level: 0, micBlocked: false } : {}),
  };
  const hint = col([
    when({ falsy: "route.slug" }, meta("Tap once to see who answers, again to send", { size: 13, align: "center" })),
    when({ truthy: "route.slug" }, text("", { size: 13, color: C.meta, lineHeight: 17, align: "center", bind: "route.hint" })),
  ]);
  // The ask out: their words as a bubble, Tailzu carrying it (askMoment.ts).
  const asking = askMoment(ctx, { slug: "tailzu", color: C.ink, kind: "custom", busy: "asking", line: "Asking…", bubble: "surface" });
  const fileChip = canUpload(ctx) ? [uploadChip("attach")] : fileName ? [row([icon("clip", { size: 16 }), text(fileName, { size: 13, lineHeight: 17, lines: 1, style: { flexShrink: 1 } })], {
    gap: 8, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, backgroundColor: C.surface, alignSelf: "flex-start",
  })] : [];

  if (ctx.client === "desktop") {
    const attach = (labelText: string, name: "clip" | "folder" | "computer" | "keyboard", a: ActionRef) =>
      row([icon(name, { size: 16 }), text(labelText, { size: 13, lineHeight: 17 })], { gap: 7, height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: C.outline }, a);
    return page(ctx, {
      back: true, nav: "bots", title: "Ask any bot", gap: 18, state,
      body: [
        col([
          row([
            labelled(roundButton("mic", { kind: "dictate" }, { size: 60 }), "Hold Fn and speak, or click to start"),
            col([
              row([bars([8, 14, 20, 11, 24, 16, 9, 18, 22, 12, 7, 15]), meta(speakLine(ctx), { size: 13 })], { gap: 10 }),
              field("ask", "Ask any bot…", { size: 21, weight: 500, onSubmit: goAction(ctx), returnKey: "send" }),
              ...fileChip,
            ], { gap: 8, flexGrow: 1, flexShrink: 1, minWidth: 0 }),
            labelled(box([kbd("Esc")], { height: 32, justifyContent: "center" }, back()), "Close"),
          ], { gap: 18, paddingTop: 22, paddingBottom: 20, paddingHorizontal: 22, alignItems: "flex-start" }),
          divider(),
          col([sectionLabel("Who will answer"), row([whoChip(ctx), handTo(ctx)], { gap: 14, flexWrap: "wrap" }), pickList(ctx)], { gap: 10, paddingVertical: 14, paddingHorizontal: 22 }),
          divider(),
          row([
            sectionLabel("Attach"), attach("Photo", "clip", attachTo(ctx, "photo")), attach("File", "folder", attachTo(ctx, "file")), attach("Screen", "computer", attachTo(ctx, "screen")),
            grow(), attach("Paste", "keyboard", { kind: "readClipboard", assignTo: "ask" }),
          ], { gap: 8, paddingVertical: 12, paddingHorizontal: 22 }),
          divider(),
          col([box([sectionLabel("Or try")], { paddingTop: 6, paddingBottom: 4, paddingHorizontal: 10 }), ...tries(ctx)], { paddingTop: 8, paddingBottom: 10, paddingHorizontal: 12 }),
          row([
            row([kbd("↵"), meta("send", { size: 12 })], { gap: 6 }),
            row([kbd("Fn"), meta("hold to talk", { size: 12 })], { gap: 6 }),
            grow(),
            when({ truthy: "route.slug" }, text("", { size: 12, color: C.grey70, lineHeight: 16, bind: "route.hint" })),
          ], { gap: 16, paddingVertical: 11, paddingHorizontal: 22, backgroundColor: C.surface }),
        ], { borderRadius: 22, borderWidth: 1, borderColor: C.line, overflow: "hidden", backgroundColor: C.paper }),
        asking,
        row([primaryButton("Send", goAction(ctx), { size: "md" }), hint], { gap: 14 }),
      ],
    });
  }

  const side = (labelText: string, name: "clip" | "folder" | "computer" | "keyboard", a: ActionRef) => col([
    box([icon(name, { size: 20 })], { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center" }),
    text(labelText, { size: 12, color: C.grey70, lineHeight: 16 }),
  ], { gap: 6, alignItems: "center", flexGrow: 1, flexBasis: 0 }, a);
  const voice = askVoice(ctx);
  return page(ctx, {
    title: "Ask any bot", gap: 16, state,
    body: [
      box([box([], { width: 36, height: 5, borderRadius: 3, backgroundColor: C.outline })], { alignItems: "center" }),
      row([text("Ask any bot", { size: 24, weight: 700, tracking: -0.5, lineHeight: 30 }), grow(), labelled(box([icon("close", { size: 22 })], { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -10 }, back()), "Close")]),
      col([
        voice ? voice.line : row([bars([6, 12, 16, 9, 13, 5]), meta(speakLine(ctx), { size: 12 })], { gap: 8 }),
        field("ask", "Say what you need", { size: 22, weight: 500, multiline: true }),
        ...(voice ? [micBlockedNotice()] : []),
        ...fileChip,
      ], { gap: 8 }),
      col([whoChip(ctx), handTo(ctx), pickList(ctx)], { gap: 6 }),
      col([sectionLabel("Or try"), ...tries(ctx)], { gap: 0 }),
    ],
    footer: [
      asking,
      row([
        side("Photo", "clip", attachTo(ctx, "photo")), side("File", "folder", attachTo(ctx, "file")),
        voice ? voice.big : box([labelled(box([icon("send", { size: 30, color: C.paper })], {
          width: 88, height: 88, borderRadius: 44, backgroundColor: C.ink, alignItems: "center", justifyContent: "center",
        }, goAction(ctx)), "Send")], { width: 108, alignItems: "center", flexShrink: 0 }),
        side("Screen", "computer", attachTo(ctx, "screen")), side("Paste", "keyboard", { kind: "readClipboard", assignTo: "ask" }),
      ], { alignItems: "center" }),
      voice ? voice.hint : hint,
    ],
  });
}

/**
 * Speaking in Ask (the phone, a build with VoiceRecord): the line over the field (still bars; listening, the bars follow
 * the voice; then a moment while the words are written down), the big button (the mic while nothing is said, the mic
 * with its ring while it listens, a working mark while it writes, send once there are words) and the line under it.
 * Opened from a mic elsewhere (params voice) it starts listening at once. The words land in the field; who will answer
 * is checked then, and the next tap sends, as a typed ask does.
 */
function askVoice(ctx: BotsCtx): { line: Node; big: Node; hint: Node } | null {
  if (!canRecord(ctx)) return null;
  const listen = listenAction("ask", { kind: "condition", if: { falsy: "route.slug" }, then: checkWho });
  const line: Node = {
    ...col([
      when(notListening, row([bars([6, 12, 16, 9, 13, 5]), meta(speakLine(ctx), { size: 12 })], { gap: 8 })),
      when(listening, row([voiceBars([6, 12, 16, 9, 13, 5], { live: true }), meta(speakLine(ctx, true), { size: 12 })], { gap: 8, height: 16 })),
      when(writingDown, row([statusMark("working", { color: C.ink }), meta("Writing down what you said…", { size: 12 })], { gap: 8, height: 16 })),
    ]),
    ...(ctx.params.voice ? { on: { onAppear: listen } } : {}),
  };
  const disc = (inner: Node, a: ActionRef | undefined, label: string, ring = false): Node => labelled(box([
    box([inner], { width: 88, height: 88, borderRadius: 44, backgroundColor: C.ink, alignItems: "center", justifyContent: "center" }),
  ], { width: 104, height: 104, borderRadius: 52, alignItems: "center", justifyContent: "center", backgroundColor: ring ? C.surface : C.paper }, a), label);
  const big = box([
    when({ all: [notListening, { falsy: "ask" }] }, disc(icon("mic", { size: 34, color: C.paper }), listen, "Speak")),
    when(listening, disc(icon("mic", { size: 34, color: C.paper }), listen, "Listening. Tap when you're done", true)),
    when(writingDown, disc(statusMark("working", { color: C.paper, size: 14 }), undefined, "Writing down what you said")),
    when({ all: [notListening, { truthy: "ask" }] }, disc(icon("send", { size: 30, color: C.paper }), goAction(ctx), "Send")),
  ], { width: 108, alignItems: "center", flexShrink: 0 });
  const hint = col([
    when(listening, meta("Tap the mic when you're done", { size: 13, align: "center" })),
    when({ all: [notListening, { falsy: "ask" }] }, meta("Tap the mic and speak, or type", { size: 13, align: "center" })),
    when({ all: [notListening, { truthy: "ask" }, { falsy: "route.slug" }] }, meta("Tap once to see who answers, again to send", { size: 13, align: "center" })),
    when({ all: [notListening, { truthy: "ask" }, { truthy: "route.slug" }] }, text("", { size: 13, color: C.meta, lineHeight: 17, align: "center", bind: "route.hint" })),
  ]);
  return { line, big, hint };
}
