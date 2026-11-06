/**
 * HOME'S ASK, AS HIS THOUGHT (for a build that draws it: kit canHomeThought; docs/bots-app.md "Spaces"): a tiny bot walks the bottom of
 * Home with a dotted box riding over him, "Ask any bot...". A tap grows it into a square and blurs Home behind; what is typed goes to
 * Ask any bot (POST /v1/shell/ask, the same door as the ask bar), the box grows to near the whole screen, he thinks, and the right bot's
 * answer comes in inside it (streamed where the build can), with Open for the whole answer on the Ask screen.
 *
 * A double tap on him (a double-click in the window) is a voice chat with any bot; a double tap on one of the bot tiles, with that bot
 * (canVoice only). While he listens the box holds only the words he hears. Older builds keep the ask bar.
 */

import type { ActionRef, ActionSpec, Node, TalkTo } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, ASK_PATH, C, SCREENS, answerParams, botStage, box, canVoice, col, grow, keptOffline, labelled, liveWords, meta, roamFor,
  roundButton, row, sectionLabel, seq, statusMark, text, voiceLive, voiceStop, when, FACE, icon,
} from "../../kit.js";
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

/** Home's foot: him, walking, and his thought (the ask). */
export function homeThought(ctx: BotsCtx): Node {
  const desk = ctx.client === "desktop";
  const voice = canVoice(ctx);
  const send = homeSend(ctx);
  const asking = { truthy: "asking" }, sent = { truthy: "sent" }, replied = { truthy: "reply.text" };
  // Closed by him (the veil, Escape, back) or by its own ×: the asked words, the answer and the bot picked go.
  const reset = seq(clear("sent"), clear("reply"), clear("asked"), setState("askBot", "any"));
  const close = seq(setState("askOpen", false), ...(voice ? [voiceStop()] : []), reset);
  const bubble = row([box([text("", { size: 15, lineHeight: 21, color: C.paper, bind: "sent", lines: 4 })], {
    backgroundColor: C.ink, borderRadius: 20, borderBottomRightRadius: 6, paddingVertical: 10, paddingHorizontal: 15, maxWidth: "86%",
  })], { justifyContent: "flex-end" });
  const children: Node[] = [
    when(sent, row([sectionLabel("Ask any bot"), grow(), labelled(box([icon("close", { size: 16 })], {
      width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: C.outline, alignItems: "center", justifyContent: "center",
    }, close), "Close")], { gap: 8 })),
    when(sent, bubble),
    when({ all: [asking, { falsy: "reply.text" }] }, row([statusMark("working", { color: C.ink }), meta("Thinking", { size: 13 })], { gap: 8 })),
    // "Plan Ease answered" only once the answer has come back with who answered (while the words stream in, there is no name yet).
    when(replied, col([
      when({ truthy: "asked.shell.bot.name" }, row([text("", { size: 13, weight: 600, lineHeight: 17, bind: "asked.shell.bot.name" }), meta(" answered", { size: 13 })])),
      text("", { size: 16, lineHeight: 23, bind: "reply.text" }),
    ], { gap: 6 })),
    // A build that does not stream: the whole answer, when it is back.
    when({ all: [{ falsy: "reply.text" }, { truthy: "asked.shell.text" }] }, col([
      when({ truthy: "asked.shell.bot.name" }, row([text("", { size: 13, weight: 600, lineHeight: 17, bind: "asked.shell.bot.name" }), meta(" answered", { size: 13 })])),
      text("", { size: 16, lineHeight: 23, bind: "asked.shell.text" }),
    ], { gap: 6 })),
    when({ all: [{ truthy: "asked.shell" }, { falsy: "asking" }] }, row([
      labelled(row([text("Open", { size: 14, weight: 500, lineHeight: 18 }), icon("chevron", { size: 14 })], { gap: 4, minHeight: 32 }, { kind: "navigate", screenId: SCREENS.ask, params: answerParams(SENT_WORDS) }), "Open the whole answer"),
    ])),
    when({ falsy: "voice" }, row([
      box([
        when({ falsy: "sent" }, askField("ask", "Ask any bot...", send)),
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
    thought: { style: "home", restText: "Ask any bot...", openPath: "askOpen", fullWhen: sent, shape: "square", veil: true, place: "follow" },
    label: voice ? `Ask any bot. ${desk ? "Double-click" : "Double-tap"} him to talk.` : "Ask any bot.",
  }, [col(children, { padding: 18, gap: 14 })], {
    onPress: tapHim,
    ...(voice ? { onDoubleTap: seq(setState("askBot", "any"), homeVoice(ctx, "chat")) } : {}),
    onDismiss: reset,
  });
}
