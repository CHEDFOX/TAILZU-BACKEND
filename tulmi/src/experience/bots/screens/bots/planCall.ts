/**
 * "X0 IS CALLING": THE CALL SCREEN (bots.plan.call; botsBots/planCall.ts; docs/plan-ease.md "Calls"). Opened by the ringing
 * notification's Answer (or a tap on it), the missed call's Call back, or Activity's "Missed call from X0". It reads the call
 * (GET .../plan/calls/:id) and draws one of four modes:
 *
 *   talk     a phone whose JS takes calls (kit canCall), the call ringing, answered, or missed but still inside the grace: it answers,
 *            Plan Ease speaks first (the server voice with the person's AI permission, else the phone's own voice: nothing leaves the
 *            phone), then turn by turn the person talks back (only with that permission and a build that listens: kit canVoice).
 *            Without it the call simply plays, and says nothing about AI: Home's card is the one place that asks.
 *            A STORE BUILD THAT CAN HOLD A LIVE CALL (kit canRealtimeCall) and a call the server says may have one (v.rt) gets the same
 *            screen in its live mode: one conversation instead of turns. Anything that breaks falls back to the turns, with no tap
 *   missed   "Missed call · 8:12 am", the reminder's line, Call back (the person's own call about the same thing). Call back pressed on the
 *            missed-call notification lands here whatever became of the call since (answered late and hung up, say), and calls back
 *   ended    the call is over, or was declined
 *   record   the window, or a phone without the call's JS: what the call was, with the item's own buttons, and no voice
 *
 * Look: Plan Ease's own. Paper and ink, the ochre only on its bot and the status dot, Geist, the bot standing on his stage. No green or
 * red, no round phone buttons: it is an ordinary screen of the app, not the phone's call screen. Every item button that leaves the
 * screen ends the call first.
 *
 * Sound paths are built here, never taken whole from state: the phone's playAudio runs `url` through fillPath, which URL-encodes every
 * "$state." value, so the server's own "/v1/..." path would arrive as "%2Fv1%2F..." and never play. A number survives that, so a reply's
 * path is ".../voice/$state.turn.turn".
 */
import type { ActionRef, ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import { BOT_STAGE_COMPONENT } from "../../../../../../shared/types/sdui.js";
import {
  type BotsCtx, C, SCREENS, botAvatar, botStage, box, call, canCall, canRealtimeCall, canVoice, card, col, liveWords, meta, open, page,
  primaryButton, quietButton, row, secondaryButton, seq, statusMark, text, voiceCall, voiceCallSet, voiceLive, voiceStop, when,
} from "../../kit.js";
import { couldNot } from "../you/parts.js";
import { clearState, isDesk, lookOf, setState, toast } from "./parts.js";
import { CALLS, type CallView } from "../../../../botsBots/planCallWords.js";

const OCHRE = lookOf("plan").color;
const ACT = "/v1/widgets/act";

type Mode = "talk" | "missed" | "ended" | "record";

/** Which of the four this screen is, for this build and this call. */
export function callMode(ctx: BotsCtx, v: CallView): Mode {
  if (!canCall(ctx)) return "record";
  if (v.state === "missed" && (ctx.params.state === "missed" || !v.late)) return "missed";
  // Call back pressed on the missed-call notification, for a call that is over by now: that missed push can outlive the call (a late
  // answer that then hung up), and its button must still call back. One still ringing or on is answered, as Call back would.
  if (ctx.params.button === "p_callback" && v.state !== "ringing" && v.state !== "answered") return "missed";
  if (v.state === "ended" || v.state === "declined") return "ended";
  return "talk";
}

const cond = (c: Parameters<typeof when>[0], then: ActionRef, otherwise?: ActionRef): ActionSpec =>
  ({ kind: "condition", if: c, then, ...(otherwise ? { else: otherwise } : {}) });
const go = (screenId: string, params?: Record<string, unknown>): ActionSpec => ({ kind: "navigate", screenId, ...(params ? { params } : {}), replace: true });
const toPlan = go(SCREENS.plan);

/** "On a call · 0:12": a start time the phone counts up from (Text format "elapsed"; only for a build that has it: canCall). */
function elapsed(bind: string): Node {
  const t = text("", { bind, size: 13, color: C.meta, lineHeight: 18 });
  return { ...t, props: { ...(t.props ?? {}), format: "elapsed" } };
}

/** The status line: a dot in Plan Ease's ochre (breathing while it rings or talks), then the words. */
function status(words: Node, live = false): Node {
  const dot = live ? statusMark("working", { color: OCHRE, size: 8 }) : box([], { width: 8, height: 8, borderRadius: 4, backgroundColor: OCHRE, flexShrink: 0 });
  return row([dot, words], { gap: 8, alignItems: "center", justifyContent: "center" });
}
const statusWords = (s: string): Node => meta(s, { size: 13, lineHeight: 18 });

/** The item's own buttons: Open map and Move for a leave-by, Pay and Paid for a bill. In a call, one that leaves the screen ends it first. */
function itemActions(ctx: BotsCtx, v: CallView, hangup: boolean): Node[] {
  const c = v.card;
  const leaving = (to: ActionSpec): ActionRef => (hangup ? seq("hangup", to) : to);
  const md = { size: "md" as const };
  if (v.source === "leave") {
    const day = c.item.split(":")[2] ?? "";
    return [
      ...(c.to ? [secondaryButton("Open map", leaving(go(SCREENS.planGo, { go: "map", to: c.to, mode: c.mode ?? "driving" })), md)] : []),
      ...(c.eventId ? [secondaryButton("Move", leaving(go(SCREENS.planItem, { kind: "event", id: c.eventId, ...(day ? { day } : {}) })), md)] : []),
    ];
  }
  if (v.source === "item") {
    // A call the call judge asked for: the item's own buttons. An event is moved with Move (a call never removes anything).
    const day = c.item.split(":")[2] ?? "";
    if (c.kind === "event") {
      return [
        ...(c.to ? [secondaryButton("Open map", leaving(go(SCREENS.planGo, { go: "map", to: c.to, mode: c.mode ?? "driving" })), md)] : []),
        ...(c.eventId ? [secondaryButton("Move", leaving(go(SCREENS.planItem, { kind: "event", id: c.eventId, ...(day ? { day } : {}) })), md)] : []),
      ];
    }
    if (c.kind === "due") return billActions(ctx, v, leaving);
    const tick = (action: "done" | "later", label: string, msg: string, primary = false) => {
      const act = call("POST", ACT, { item: c.item, action, key: `${c.item}:${action}:${ctx.live.now}`.slice(0, 120) }, {
        ok: seq(toast(msg), setState("itemDone", true)), fail: toast("Couldn't do that. Try again.", true), stay: true,
      });
      return primary ? primaryButton(label, act, md) : secondaryButton(label, act, md);
    };
    return [
      when({ falsy: "itemDone" }, row([tick("done", "Done", "Done", true), tick("later", "Later", "I'll remind you later")], { gap: 10, flexWrap: "wrap" })),
      when({ truthy: "itemDone" }, row([statusMark("done"), meta("Answered", { size: 14, lineHeight: 19 })], { gap: 8, minHeight: 44, alignItems: "center" })),
    ];
  }
  if (v.source === "follow") {
    // A followed item (follow-through): Done, Later, Can't, answered through the act door on the climb it rang for (pf:<id>:<n>).
    const answer = (action: string, label: string, msg: string, primary = false) => {
      const act = call("POST", ACT, { item: c.item, action, key: `${c.item}:${action}:${ctx.live.now}`.slice(0, 120) }, {
        ok: seq(toast(msg), setState("followDone", true), ...(hangup ? ["hangup" as const] : [])), fail: toast("Couldn't do that. Try again.", true), stay: true,
      });
      return primary ? primaryButton(label, act, md) : secondaryButton(label, act, md);
    };
    return [
      when({ falsy: "followDone" }, row([
        answer("done", "Done", "Done", true), answer("later", "Later", "I'll remind you later"), answer("cant", "Can't", "I'll ask the next one"),
      ], { gap: 10, flexWrap: "wrap" })),
      when({ truthy: "followDone" }, row([statusMark("done"), meta("Answered", { size: 14, lineHeight: 19 })], { gap: 8, minHeight: 44, alignItems: "center" })),
    ];
  }
  return billActions(ctx, v, leaving);
}

/** A bill's own buttons: Pay (it leaves the screen, so the call ends first) and Paid. */
function billActions(ctx: BotsCtx, v: CallView, leaving: (to: ActionSpec) => ActionRef): Node[] {
  const c = v.card;
  const md = { size: "md" as const };
  const paid = call("POST", ACT, { item: c.item, action: "paid", key: `${c.item}:paid:${ctx.live.now}`.slice(0, 120) }, {
    ok: seq(toast("Marked paid"), setState("paidDone", true)), fail: toast("Couldn't do that. Try again.", true), stay: true,
  });
  return [
    ...(c.pay ? [secondaryButton("Pay", leaving(go(SCREENS.planGo, { go: "pay", item: c.item })), md)] : []),
    when({ falsy: "paidDone" }, secondaryButton("Paid", paid, md)),
    when({ truthy: "paidDone" }, row([statusMark("done"), meta("Paid", { size: 14, lineHeight: 19 })], { gap: 8, minHeight: 44, alignItems: "center" })),
  ];
}

/** The thing it called about: its full title (inside the app), its line, and its own buttons. */
function itemCard(ctx: BotsCtx, v: CallView, hangup: boolean): Node {
  const actions = itemActions(ctx, v, hangup);
  return card([
    col([text(v.card.title, { size: 17, weight: 600, lineHeight: 22, lines: 2 }), meta(v.card.sub, { size: 13, lineHeight: 18 })], { gap: 4 }),
    ...(actions.length ? [row(actions, { gap: 10, flexWrap: "wrap", alignItems: "center" })] : []),
  ], { gap: 14 });
}

/** The stage's width, and how far right of the middle it sits so that he stands in the middle (see him()). */
const STAGE_W = 180;
const STAGE_NUDGE = 86;

/**
 * Plan Ease standing on his stage (listening and thinking with the call), or his face where the build has no stage. He doesn't roam on
 * a call, so he stays where a bot first stands, a quarter of the way into his stage (0.2 to 0.32 of its width, botTiles' setup): the
 * stage is kept narrow and set that much right of the middle, so he stands under the name, with or without Reduce Motion.
 */
function him(ctx: BotsCtx, v: CallView, voice: boolean): Node {
  if (!ctx.can.has(BOT_STAGE_COMPONENT)) return row([botAvatar(lookOf("plan"), 96)], { justifyContent: "center", paddingVertical: 12 });
  const stage = botStage({
    life: `call.${v.id}`, kind: "plan", color: OCHRE, size: 64, height: 120, toys: false,
    thinkWhen: { eq: ["phase", "thinking"] }, ...(voice ? { listenWhen: { eq: ["phase", "listening"] } } : {}),
    label: v.name,
  }, []);
  return row([box([], { width: STAGE_NUDGE, flexShrink: 0 }), box([stage], { width: STAGE_W, flexShrink: 0 })], { justifyContent: "center" });
}

/** Which of the view's own actions a live call ticks off from the server's `acted` after a tool turn. */
function actedState(v: CallView): Record<string, string> {
  if (v.source === "follow") return { done: "followDone", later: "followDone", cant: "followDone" };
  if (v.source === "item") {
    if (v.card.kind === "due") return { paid: "paidDone" };
    if (v.card.kind === "event") return {};
    return { done: "itemDone", later: "itemDone" };
  }
  return { paid: "paidDone" };
}

/**
 * The named actions of a call in talk mode (the contract's 3.17). `voice`: the person can talk back on this build. `rt`: this build and
 * this call can hold one live conversation. Today's turn actions stay whatever happens: the fallback is made of them.
 */
function talkActions(v: CallView, voice: boolean, rt: boolean): Record<string, ActionSpec> {
  const B = `${CALLS}/${v.id}`;
  const speak0: ActionSpec = { kind: "speak", text: "$state.ans.opening", loud: true, onDone: "afterSpeak" };
  const speakN: ActionSpec = { kind: "speak", text: "$state.turn.spoken", loud: true, onDone: "afterSpeak" };
  const idle = setState("phase", "idle");
  const answer: ActionSpec = {
    kind: "callEndpoint", method: "POST", path: `${B}/answer`, body: { talk: voice, ...(rt ? { rt: true } : {}) }, assignTo: "ans", stay: true,
    onSuccess: "answered", onError: setState("phase", "failed"),
  };
  const acts: Record<string, ActionSpec> = {
    // With a live call to come, the microphone and the offer are made ready beside the answer, so the bot speaks sooner.
    start: cond({ falsy: "ans" }, rt ? seq(voiceCallSet("warm"), answer) : answer),
    // Answered: speak first only when this is the answer that connected it (a reload or a second tap stays quiet). Anything else (missed
    // past the grace, ended, declined): the screen is drawn again from the server, in that mode.
    answered: cond({ eq: ["ans.state", "answered"] },
      cond({ truthy: "ans.fresh" }, seq(setState("phase", "speaking"), setState("said", "$state.ans.opening"), "say0"), idle),
      { kind: "refresh" }),
    say0: cond({ truthy: "ans.voice" }, { kind: "playAudio", url: `${B}/voice/0`, id: "call", onEnd: "afterSpeak", onError: speak0 }, speak0),
    // An End call meanwhile set "ended": nothing more is said or heard.
    afterSpeak: cond({ eq: ["phase", "speaking"] }, cond({ truthy: "turn.ended" }, "hangup",
      voice ? { kind: "checkPermission", permission: "microphone", onGranted: "listen", onDenied: idle } : idle)),
    // Its failure is ignored: the sweep ends an answered call after 5 minutes alone. Never from onDisappear: a rebuild of the screen
    // would end a call the person is still on.
    hangup: seq(setState("phase", "ended"), ...(rt ? [voiceCallSet("end")] : []), ...(voice ? [voiceStop()] : []), { kind: "stopAudio" }, { kind: "stopMedia" },
      { kind: "callEndpoint", method: "POST", path: `${B}/end`, body: {}, stay: true }) as ActionSpec,
  };
  if (!voice) return acts;
  const turns: Record<string, ActionSpec> = {
    ...acts,
    listen: seq(setState("micCard", false), setState("phase", "listening"), voiceLive({
      mode: "once", statePath: "voice", into: "heard", silenceMs: 1000, duplex: true, onHeard: "reply",
      onEnd: cond({ eq: ["phase", "listening"] }, idle),
      onBlocked: seq(idle, setState("micCard", true), setState("micBlocked", true)),
      onError: seq(idle, toast("$event", true)),
    })) as ActionSpec,
    // A tap never asks for the microphone by itself: without it, the Continue card says why first (Apple 5.1.1(iv)).
    talk: { kind: "checkPermission", permission: "microphone", onGranted: "listen", onDenied: setState("micCard", true) },
    // `primed`: the card above ("Let X name hear you") is the one explanation, and its Continue is the only thing
    // that reaches here — so the phone goes straight to the system instead of drawing its own box first.
    askMic: {
      kind: "requestPermission", permission: "microphone", primed: true, onGranted: "listen",
      onDenied: seq(setState("micCard", false), toast(`${v.name} can't hear you yet. Allow the microphone to talk.`)),
      onBlocked: setState("micBlocked", true),
    },
    reply: seq(setState("phase", "thinking"), setState("said", ""), {
      kind: "callEndpoint", method: "POST", path: `${B}/say`, body: { words: "$state.heard" }, stream: "reply", assignTo: "turn", stay: true,
      onSuccess: "spoke",
      onError: seq(idle, cond({ truthy: "lastError.message" }, toast("$state.lastError.message", true), toast("Couldn't hear back. Tap to talk again.", true))),
    }) as ActionSpec,
    spoke: seq(setState("said", "$state.turn.text"), setState("phase", "speaking"),
      cond({ truthy: "turn.voice" }, { kind: "playAudio", url: `${B}/voice/$state.turn.turn`, id: "call", onEnd: "afterSpeak", onError: speakN }, speakN)) as ActionSpec,
  };
  if (!rt) return turns;
  // THE LIVE CALL. The turn actions above stay as they are: a live call that cannot start, or breaks, falls into them with no tap.
  const live = (resume: boolean): ActionSpec => voiceCall({
    path: `${B}/live`, viewPath: B, ...(resume ? { resume: true } : {}),
    statePath: "rt", phasePath: "phase", saidPath: "said", heardPath: "heard", actedState: actedState(v),
    onEnded: setState("phase", "ended"), onIdle: idle, onFallback: "rtFallback",
    onBlocked: seq(setState("mode", "turns"), setState("micCard", true), setState("micBlocked", true), idle),
  });
  return {
    ...turns,
    // Answered freshly: the live call starts. Anything else (a reload, a second tap) sits idle, as it does today.
    answered: cond({ eq: ["ans.state", "answered"] },
      cond({ truthy: "ans.fresh" }, seq(setState("phase", "connecting"), "rtGo"), idle),
      { kind: "refresh" }),
    // No microphone yet: the call plays the opening and shows the mic card, exactly as today.
    rtGo: {
      kind: "checkPermission", permission: "microphone", onGranted: "rtCall",
      onDenied: seq(setState("mode", "turns"), setState("phase", "speaking"), setState("said", "$state.ans.opening"), "say0"),
    },
    rtCall: live(false),
    rtResume: live(true),
    // The live part could not start, or it broke: carry on turn by turn. If the bot was never heard, the opening is played now.
    rtFallback: seq(setState("mode", "turns"), cond({ truthy: "rt.spoke" },
      seq(setState("phase", "speaking"), "afterSpeak"),
      seq(setState("phase", "speaking"), setState("said", "$state.ans.opening"), "say0"))) as ActionSpec,
    // Tap to talk: the turns' own listen after a fallback, the live call again while it is still live.
    talk: cond({ eq: ["mode", "turns"] }, { kind: "checkPermission", permission: "microphone", onGranted: "listen", onDenied: setState("micCard", true) }, "rtResume"),
  };
}

/**
 * The words of the call, centred: what is heard while listening, the reply as it streams in, else what was last said. A live call has
 * no partial words to show (nothing comes back as it is spoken), so while it listens it shows the last thing the person said.
 */
function words(voice: boolean, rt: boolean): Node[] {
  const big = { size: 20, lineHeight: 28, align: "center" as const };
  const listening = col([
    rt ? text("", { ...big, bind: "heard" }) : liveWords({ size: 20, lineHeight: 28 }),
    meta("Listening…", { size: 13, lineHeight: 18 }),
  ], { gap: 8, alignItems: "center" });
  return [
    ...(voice ? [when({ eq: ["phase", "listening"] }, listening)] : []),
    when({ eq: ["phase", "thinking"] }, col([
      when({ truthy: "reply.text" }, text("", { ...big, bind: "reply.text" })),
      when({ falsy: "reply.text" }, row([statusMark("working", { color: C.ink }), meta("Thinking", { size: 13, lineHeight: 18 })], { gap: 8, justifyContent: "center", alignItems: "center" })),
    ], { alignItems: "stretch" })),
    when({ not: { in: ["phase", ["listening", "thinking"]] } }, text("", { ...big, bind: "said" })),
  ];
}

/** The call screen. No call (it couldn't be read): says so, with the way to the Plan. */
export function planCallPage(ctx: BotsCtx, v?: CallView) {
  if (!v) {
    return page(ctx, {
      back: true, nav: "plan", title: "Call", body: [couldNot("this call")], footer: [secondaryButton("Open Plan", open(SCREENS.plan), { wide: true })],
    });
  }
  const mode = callMode(ctx, v);
  const voice = mode === "talk" && canVoice(ctx) && v.ai;
  // One live conversation instead of turns: only a store build that can hold it, and only when the server says this call may have one
  // (the switch, the key, the allow-list, live time left). No money is asked. When it is false the screen is today's, byte for byte.
  const rt = mode === "talk" && voice && canRealtimeCall(ctx) && v.rt;
  const desk = isDesk(ctx);
  const head = (statusLine: Node[]): Node => col([...statusLine, text(v.name, { size: 30, weight: 600, lineHeight: 36, align: "center" })], {
    gap: 6, alignItems: "stretch", paddingTop: 24,
  });

  if (mode === "talk") {
    const body: Node[] = [
      head([
        when({ eq: ["phase", "connecting"] }, status(statusWords("Calling…"), true)),
        when({ in: ["phase", ["speaking", "listening", "thinking", "idle"]] }, status(row([statusWords("On a call · "), elapsed("ans.answeredAt")], { alignItems: "center" }), true)),
        when({ eq: ["phase", "ended"] }, status(statusWords("Call ended"))),
        when({ eq: ["phase", "failed"] }, status(statusWords("Couldn't connect"))),
      ]),
      him(ctx, v, voice),
      col(words(voice, rt), { gap: 8, alignItems: "stretch", minHeight: 56, paddingHorizontal: 4 }),
      ...(voice ? [when({ truthy: "micCard" }, card([
        text(`Let ${v.name} hear you`, { size: 16, weight: 600, lineHeight: 21 }),
        meta(`${v.name} uses the microphone to hear your answer. Next, your phone asks you.`, { size: 13, lineHeight: 18 }),
        when({ falsy: "micBlocked" }, primaryButton("Continue", "askMic", { size: "md" })),
        when({ truthy: "micBlocked" }, primaryButton("Open Settings", { kind: "openSettings", target: "app" }, { size: "md" })),
      ], { gap: 10 }))] : []),
      itemCard(ctx, v, true),
    ];
    // On a live call there is one button: End call. Stop belongs to the turns, so it is drawn only once the call has fallen into
    // them (mode "turns"); Tap to talk stays, because an idle live call resumes with it.
    const onTurns = (n: Node): Node => (rt ? when({ eq: ["mode", "turns"] }, n) : n);
    const footer: Node[] = [
      row([
        ...(voice ? [
          when({ eq: ["phase", "idle"] }, box([secondaryButton("Tap to talk", "talk", { wide: true })], { flexGrow: 1, flexBasis: 0 })),
          onTurns(when({ eq: ["phase", "listening"] }, box([secondaryButton("Stop", voiceStop(), { wide: true })], { flexGrow: 1, flexBasis: 0 }))),
        ] : []),
        when({ not: { in: ["phase", ["ended", "failed"]] } }, box([primaryButton("End call", "hangup", { wide: true })], { flexGrow: 1, flexBasis: 0 })),
        when({ eq: ["phase", "ended"] }, box([primaryButton("Done", toPlan, { wide: true })], { flexGrow: 1 })),
        when({ eq: ["phase", "failed"] }, box([primaryButton("Try again", seq(clearState("ans"), setState("phase", "connecting"), "start"), { wide: true })], { flexGrow: 1 })),
      ], { gap: 10 }),
    ];
    return page(ctx, {
      nav: "plan", title: `Call with ${v.name}`, gap: 18,
      state: {
        phase: "connecting", ans: null, said: "", heard: "", voice: "", reply: null, turn: null, micCard: false, micBlocked: false,
        paidDone: false, ...(v.source === "item" ? { itemDone: false } : {}), ...(rt ? { mode: "rt", rt: { spoke: false } } : {}),
      },
      actions: talkActions(v, voice, rt),
      body: [{ ...col(body, { gap: 18 }), on: { onAppear: "start" } }],
      footer,
    });
  }

  if (mode === "missed") {
    const B = `${CALLS}/${v.id}`;
    const missed = v.state === "missed";
    const body: Node[] = [
      head([status(statusWords(missed ? `Missed call · ${v.missedClock}` : "Call ended"))]),
      him(ctx, v, false),
      // The reminder's own line is not repeated over the card: the card says it, and more (inside the app).
      itemCard(ctx, v, false),
    ];
    return page(ctx, {
      back: true, nav: "plan", title: missed ? `Missed call from ${v.name}` : `Call with ${v.name}`, gap: 18, state: { phase: "missed", paidDone: false },
      actions: {
        // The person's own call about the same thing: a new call, answered as it starts, opened in place of this one.
        callBack: {
          kind: "callEndpoint", method: "POST", path: `${B}/back`, body: {}, assignTo: "back",
          onSuccess: { kind: "navigate", screenId: SCREENS.planCall, params: { call: "$state.back.call", button: "p_answer" }, replace: true },
          onError: toast("Couldn't call back. Try again.", true),
        },
      },
      // Call back pressed on the notification: it calls back as the screen opens.
      body: [{ ...col(body, { gap: 18 }), ...(ctx.params.button === "p_callback" ? { on: { onAppear: "callBack" } } : {}) }],
      footer: [row([
        box([primaryButton("Call back", "callBack", { wide: true })], { flexGrow: 1 }),
        quietButton("Close", toPlan),
      ], { gap: 8, alignItems: "center" })],
    });
  }

  // Ended, or a record (the window; a phone without the call's JS): what it was, with the item's own buttons.
  const recordStatus = v.state === "missed" ? `Missed call · ${v.missedClock}` : mode === "ended" || v.state === "ended" || v.state === "declined" ? "Call ended" : "Call";
  return page(ctx, {
    back: true, nav: "plan", title: v.state === "missed" ? `Missed call from ${v.name}` : `Call with ${v.name}`, gap: desk ? 24 : 18,
    ...(desk ? { maxWidth: 640 } : {}),
    state: { paidDone: false },
    // The window keeps its one button under the card (its footer sits at the foot of a tall window, far from what it is about).
    body: [head([status(statusWords(recordStatus))]), him(ctx, v, false), itemCard(ctx, v, false),
      ...(desk && mode === "record" ? [row([secondaryButton("Open Plan", open(SCREENS.plan))], { justifyContent: "center" })] : [])],
    ...(desk && mode === "record" ? {} : {
      footer: [mode === "ended" ? primaryButton("Done", toPlan, { wide: true }) : secondaryButton("Open Plan", open(SCREENS.plan), { wide: true })],
    }),
  });
}
