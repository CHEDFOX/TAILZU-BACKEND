/**
 * HOME'S ASK, AS HIS THOUGHT (for a build that draws it: kit canHomeThought; docs/bots-app.md "Spaces"): a tiny bot walks the bottom of
 * Home with a dotted box riding over him, "Talk freely". A tap grows it into a square and blurs Home behind; what is typed goes to
 * Ask any bot (POST /v1/shell/ask, the same door as the ask bar), the box grows to near the whole screen, he thinks, and the right bot's
 * answer comes in inside it (streamed where the build can), with Open for the whole answer on the Ask screen.
 *
 * A double tap on him (a double-click in the window) is a voice chat with any bot; a double tap on one of the bot tiles, with that bot
 * (canVoice only). While he listens the box holds only the words he hears. Older builds keep the ask bar.
 */

import type { ActionRef, ActionSpec, Node, TalkTo } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, ASK_PATH, C, SCREENS, answerParams, botPeek, botStage, box, canPeek, canVoice, col, grow, keptOffline, labelled, liveWords,
  meta, roamFor, roundButton, row, sectionLabel, seq, statusMark, text, voiceLive, voiceStop, when, FACE, icon,
} from "../../kit.js";
import { homeListenOn } from "./homeUpdates.js";
import { failed as momentFailed, SENT_WORDS, start as momentStart, streamed as momentStreamed } from "../../askMoment.js";

const setState = (path: string, value: unknown): ActionSpec => ({ kind: "setState", path, value });
const clear = (path: string): ActionSpec => ({ kind: "clearState", path });

/** What Home's state starts with for his thought: closed, any bot, not listening. */
export const HOME_THOUGHT_STATE = { askOpen: false, askBot: "any", voice: "" };

/**
 * The ask, his way: the words up as a bubble at once and the box cleared (askMoment's start), the call to whichever bot `askBot` names
 * ("any", or the tile double-tapped), its answer streamed into the box. No navigate: the answer stays in his thought. `stay`: the window
 * keeps the screen as it is. Offline, in a build that keeps an outbox, the ask is kept there instead.
 */
export function homeSend(ctx: BotsCtx): ActionSpec {
  return {
    kind: "condition", if: { falsy: "ask" }, then: { kind: "toast", message: "Type what you need first" },
    else: keptOffline(ctx.client, { message: "$state.ask", clear: "ask" }, {
      kind: "sequence", actions: [
        ...momentStart({ message: "$state.ask", from: "ask", busy: "asking" }),
        // A follow-up's answer is its own: the last one's bot and Open go while it is out.
        clear("asked"),
        momentStreamed(ctx, {
          kind: "callEndpoint", method: "POST", path: ASK_PATH,
          body: { message: SENT_WORDS, device: ctx.client, mode: "text", bot: "$state.askBot", tz: ctx.tzOffsetMinutes },
          assignTo: "asked", stay: true,
          onSuccess: setState("asking", false),
          onError: momentFailed({ busy: "asking", from: "ask", then: { kind: "toast", message: "Couldn't reach your bots. Try again.", tone: "error" } }),
        }),
      ],
    }),
  };
}

/** A voice chat (or one turn) with the bot `askBot` names: each turn's words go as an ask when he hears a pause. canVoice only. */
export function homeVoice(ctx: BotsCtx, mode: "once" | "chat"): Extract<ActionSpec, { kind: "voiceLive" }> {
  return voiceLive({
    mode, statePath: "voice", into: "ask", silenceMs: 900, onHeard: homeSend(ctx), onEnd: setState("askBot", "any"),
    onBlocked: { kind: "toast", message: "Turn on the microphone for X0 Bot in Settings.", tone: "error" },
  }) as Extract<ActionSpec, { kind: "voiceLive" }>;
}

/** A tile's double tap (canVoice, a person's own bots only): a voice chat with that bot. */
export const tileVoice = (ctx: BotsCtx, slug: string): ActionRef => seq(setState("askBot", slug), homeVoice(ctx, "chat"));

/** The one key, with X0 in front of Home: a turn (or a chat) with any bot (kit page() sends it only to canDeskTalk). */
export const homeTalkTo = (ctx: BotsCtx): TalkTo | undefined => (canVoice(ctx) ? { voice: homeVoice(ctx, "once") } : undefined);

/** The ask's box: a field (two, for the two placeholders, bound to the same words) and send. */
function askField(id: string, placeholder: string, send: ActionRef): Node {
  return {
    type: "TextField", id, bind: { value: "ask" },
    props: {
      placeholder, placeholderColor: C.idle, background: "transparent", borderWidth: 0, radius: 0, paddingHorizontal: 0, paddingVertical: 0, minHeight: 44,
      returnKeyType: "send", color: C.ink, autoFocus: true, maxLength: 4000,
    },
    on: { onSubmit: send },
    style: {
      flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 0, paddingVertical: 0, fontFamily: FACE.regular, fontSize: 17, color: C.ink,
      borderWidth: 0, backgroundColor: "transparent", outlineStyle: "none",
    },
  };
}

/**
 * WHAT WAS SAID AND WHAT CAME BACK: the words as a bubble, his thinking, the answer with who answered, and Open for
 * the whole of it. The same nodes in the walking bot's thought and in the peeker's panel, from one place, because two
 * copies of an answer's layout drift apart the first time one of them is touched.
 *
 * It reads only state the ask already writes (`sent`, `asking`, `reply.text`, `asked.shell.*`), so whichever bot is
 * drawing it, the exchange is the same exchange.
 */
export function askExchange(): Node[] {
  const asking = { truthy: "asking" }, replied = { truthy: "reply.text" }, sent = { truthy: "sent" };
  const who = (bind: string): Node => col([
    when({ truthy: "asked.shell.bot.name" }, row([text("", { size: 13, weight: 600, lineHeight: 17, bind: "asked.shell.bot.name" }), meta(" answered", { size: 13 })])),
    text("", { size: 16, lineHeight: 23, bind }),
  ], { gap: 6 });
  return [
    when(sent, row([box([text("", { size: 15, lineHeight: 21, color: C.paper, bind: "sent", lines: 4 })], {
      backgroundColor: C.ink, borderRadius: 20, borderBottomRightRadius: 6, paddingVertical: 10, paddingHorizontal: 15, maxWidth: "86%",
    })], { justifyContent: "flex-end" })),
    when({ all: [asking, { falsy: "reply.text" }] }, row([statusMark("working", { color: C.ink }), meta("Thinking", { size: 13 })], { gap: 8 })),
    // "Nudj answered" only once the answer has come back with who answered (while the words stream in, there is no name yet).
    when(replied, who("reply.text")),
    // A build that does not stream: the whole answer, when it is back.
    when({ all: [{ falsy: "reply.text" }, { truthy: "asked.shell.text" }] }, who("asked.shell.text")),
    when({ all: [{ truthy: "asked.shell" }, { falsy: "asking" }] }, row([
      labelled(row([text("Open", { size: 14, weight: 500, lineHeight: 18 }), icon("chevron", { size: 14 })], { gap: 4, minHeight: 32 }, { kind: "navigate", screenId: SCREENS.ask, params: answerParams(SENT_WORDS) }), "Open the whole answer"),
    ])),
  ];
}

/** Home's foot: him, walking, and his thought (the ask). */
export function homeThought(ctx: BotsCtx): Node {
  const desk = ctx.client === "desktop";
  const voice = canVoice(ctx);
  const send = homeSend(ctx);
  const asking = { truthy: "asking" }, sent = { truthy: "sent" };
  // Closed by him (the veil, Escape, back) or by its own ×: the asked words, the answer and the bot picked go.
  const reset = seq(clear("sent"), clear("reply"), clear("asked"), setState("askBot", "any"));
  const close = seq(setState("askOpen", false), ...(voice ? [voiceStop()] : []), reset);
  const children: Node[] = [
    when(sent, row([sectionLabel("Ask any bot"), grow(), labelled(box([icon("close", { size: 16 })], {
      width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: C.outline, alignItems: "center", justifyContent: "center",
    }, close), "Close")], { gap: 8 })),
    ...askExchange(),
    when({ falsy: "voice" }, row([
      box([
        when({ falsy: "sent" }, askField("ask", "Talk freely", send)),
        when(sent, askField("askMore", "Ask a follow-up...", send)),
      ], { flexGrow: 1, flexShrink: 1, minWidth: 0 }),
      roundButton("send", send, { size: 40, label: "Send" }),
    ], { gap: 10, alignItems: "flex-end" })),
    ...(voice ? [
      when({ truthy: "voice" }, liveWords({ size: 17, lineHeight: 24 })),
      when({ all: [{ falsy: "sent" }, { falsy: "voice" }] }, meta(desk ? "Or double-click me to talk" : "Or double-tap me to talk", { size: 12 })),
    ] : []),
  ];
  const tapHim: ActionRef = voice ? { kind: "condition", if: { truthy: "voice" }, then: voiceStop(), else: setState("askOpen", true) } : setState("askOpen", true);
  return botStage({
    life: "home.ask", kind: "custom", color: C.ink, size: desk ? 30 : 26, height: desk ? 140 : 136, toys: false, roam: roamFor(ctx),
    thinkWhen: { all: [asking, { falsy: "reply.text" }] }, cheerWhen: { truthy: "asked.shell.text" },
    // Listening while the voice turn is on, sending included: no one-frame shrink to the pill before the box goes full.
    ...(voice ? { listenWhen: { truthy: "voice" } } : {}),
    thought: { style: "home", restText: "Talk freely", openPath: "askOpen", fullWhen: sent, shape: "square", veil: true, place: "follow" },
    label: voice ? `Ask any bot. ${desk ? "Double-click" : "Double-tap"} him to talk.` : "Ask any bot.",
  }, [col(children, { padding: 18, gap: 14 })], {
    onPress: tapHim,
    ...(voice ? { onDoubleTap: seq(setState("askBot", "any"), homeVoice(ctx, "chat")) } : {}),
    onDismiss: reset,
  });
}

// ---------------------------------------------------------------- the peek (BotPeek, kit canPeek)

/**
 * HOME'S PEEKER — and, where a build can draw him, HOME'S WHOLE ASK.
 *
 * At rest he rises from behind an edge of the screen every so often, looks out, and ducks back: the window's own
 * gesture (TAILZU-DESKTOP blip.js `rise`, guide/peek.js), including the one it cannot make — he HANGS UPSIDE DOWN
 * FROM THE NOTCH, head first, so the hardware cuts off his crown.
 *
 * CALLED, HE IS THE SCREEN. His ear opens with the page and stays open, with nothing to press (`onAppear`, the same
 * always-listening turn the updates bot uses; `HOME_LISTEN=false` shuts it). Say something and he comes to the notch
 * and holds there, antenna lit from the voice's own level, Home blurred behind him, and the exchange is drawn in his
 * panel — the words as he hears them, his thinking, the answer, Open for the whole of it. When the answer has landed
 * he hops once and ducks away. A tap on the veil ends the turn.
 *
 * Which bot answers is not his to decide and never was: the words go to `POST /v1/shell/ask` with `bot: "any"`, the
 * same door the ask bar and his thought used, which reads the ask and routes it. So "ask anything" is one road, and
 * he is the way onto it rather than a second one beside it.
 *
 * WHAT HE REPLACES. A build that declares him gets no walking bot with a thought at the foot of Home: he is the ask,
 * and typing is the ask bar (`homePhone`). A build that cannot draw him keeps that bot exactly as it is, because it
 * can answer and he could not until this landed. The window keeps it too — it has its own Blip, in its own frame,
 * and no notch.
 */
export function homePeek(ctx: BotsCtx, o: { asks?: boolean } = {}): Node[] {
  if (!canPeek(ctx) || ctx.client === "desktop") return [];
  // `asks: false` — the updates bot is at the foot and already has an open ear on the same `voice` path, so he keeps
  // the gesture and the listening, and that bot keeps the words and the answer. Two things listening is a bug.
  const voice = canVoice(ctx) && homeListenOn();
  const asks = o.asks !== false;
  // Ending the turn: the microphone stops and the exchange goes, so the next call starts clean.
  const reset = seq(clear("sent"), clear("reply"), clear("asked"), setState("askBot", "any"));
  const done = seq(...(voice ? [voiceStop()] : []), reset);
  const panel: Node[] = voice && asks
    ? [col([
      when({ truthy: "voice" }, liveWords({ size: 17, lineHeight: 24 })),
      ...askExchange(),
    ], { padding: 18, gap: 14 })]
    : [];
  return [botPeek({
    // The same figure every other bot on Home is drawn from, in ink, wearing Blip's own look — which is where his
    // two ball-tipped antennae come from (shared/bots/looks.json, avatar "blip"). Not a sprite of his own.
    bot: { kind: "custom", color: C.ink, life: "home.peek", state: "idle", avatar: "blip" },
    // Down the right, from the notch, down the left, and the right again lower. `along` is 0 at the top of the safe
    // area and 1 at its foot. The bottom edge is free now that nothing walks there, and it is his lowest spot.
    spots: [
      { edge: "right", along: 0.3 },
      { edge: "notch", along: 0 },
      { edge: "left", along: 0.52 },
      { edge: "bottom", along: 0.72 },
      { edge: "right", along: 0.76 },
    ],
    // A few seconds out, a longer while gone: often enough to be a surprise, rare enough not to be a pet.
    up: [2.2, 4],
    every: [14, 34],
    size: 54,
    // Called: he comes to the notch (spots[1]), holds there with the page blurred behind him, and the panel opens.
    ...(voice ? { liveWhen: { truthy: "voice" }, home: 1 } : {}),
    ...(voice && asks ? { veil: true } : {}),
    // The answer is here: one hop, then away.
    doneWhen: { truthy: "asked.shell.text" },
    ...(voice && asks ? { onDismiss: done } : {}),
  }, panel)];
}

/**
 * THE EAR, on the peeker himself. It opens when Home comes to the front and stays open with nothing to press, unless
 * they are at the keyboard — which is the one thing that shuts it — and `HOME_LISTEN=false` shuts it everywhere. It
 * falls quiet by itself after a long while with nothing said, and opens again the next time Home comes forward.
 *
 * It hangs off HIS node and not off the page because he is the one listening, and because a build that cannot draw
 * him must not be sent an open microphone it has nothing to show for.
 */
export function homePeekEar(ctx: BotsCtx, o: { asks?: boolean } = {}): ActionSpec | undefined {
  if (o.asks === false) return undefined;
  if (!canPeek(ctx) || ctx.client === "desktop" || !canVoice(ctx) || !homeListenOn()) return undefined;
  return { kind: "condition", if: { all: [{ falsy: "typing" }, { falsy: "voice" }] }, then: homeVoice(ctx, "chat") };
}
