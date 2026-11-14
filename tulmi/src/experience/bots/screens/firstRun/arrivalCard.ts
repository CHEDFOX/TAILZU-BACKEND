/**
 * The first run's arrivalCard screen.
 */

import type { Node, ActionRef, ActionSpec, Condition } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, seq, call, when, row, text, canMove, botCard, col, C } from "../../kit.js";
import {
  setState, permitStep, line, AX_STATE, SEE_STATE, MIC_SETTLED, OPEN_AX, KEYS_MISSING, keyboardLines, gotYou, KEYS_ON, CARD_BOT, CHEER_MS,
} from "./parts.js";

/** The read the first-arrival card is due on (GET /v1/bots/first-run/arrival) and the write that ends it. */
export const ARRIVAL_PATH = "/v1/bots/first-run/arrival";

/**
 * THE FIRST ARRIVAL: one card over Home, the first time someone lands in the app (until it is answered or put off;
 * the server keeps that, GET/PUT /v1/bots/first-run/arrival). Step 1 asks for the microphone, for real; allowed or
 * not, the same card moves on to step 2, the keyboard (straight to its settings). Once both are on, a small happy
 * moment and it closes. The microphone step has one button, Continue, which goes straight to the system's own prompt (App
 * Review 5.1.1(iv): no "Allow" on our button, no way to put the prompt off); "Not now" is on the later steps only, and closes
 * the card for good. Over a blurred Home (BotCard overlay) where the build draws it,
 * else a plain card at the top of Home. Nothing at all when there is nothing to ask for.
 */
export function arrivalCard(ctx: BotsCtx, o: { after?: string } = {}): Node[] {
  const desk = ctx.client === "desktop";
  const close = seq(setState("permitClosed", true), call("PUT", ARRIVAL_PATH, {}, {}));
  const notNow = { label: "Not now", onPress: close };
  // `primed`: the step below is the explanation, and its Continue is the only way here, so the phone asks the
  // system straight away rather than putting its own box in front of ours.
  const askMic = (onGranted: ActionRef, extra: ActionRef): ActionSpec => ({
    kind: "requestPermission", permission: "microphone", primed: true,
    onGranted, onDenied: extra, onBlocked: extra,
  } as ActionSpec);
  const mic = (whenMic: Condition) => permitStep({
    when: whenMic,
    title: "Let X0 Bot hear you",
    lines: [line("X0 Bot uses the microphone so you can talk to any bot, in any app. Next, your phone asks you.")],
    cta: { label: "Continue", onPress: askMic(seq(setState("micGranted", true), setState("micAsked", true)), setState("micAsked", true)) },
  });
  let steps: Node[], ready: Condition | undefined, done: Condition | undefined;
  if (desk) {
    // A WINDOW ASKS FOR WHAT A COMPUTER KEEPS, in the same card: its microphone
    // (where it can tell), and then the switches only System Settings can
    // flip — typing your words where the cursor is, and letting Ask answer
    // about the window in front of you. A window that reads those itself
    // (AX_STATE, SEE_STATE) lets the step go on its own once they are on, and
    // the card close; one that only shows them (DeskAskSetup) keeps a Done.
    //
    // The camera is not here. A call is the only thing that opens one, and only
    // when the person turns it on there, so it is asked for at that moment
    // (the window's own card, sdui/permCard.js) and never up front.
    const hasMic = ctx.can.has("DeskMicAsk"), askCard = ctx.can.has("DeskAskSetup");
    const axRead = ctx.can.has(AX_STATE), seeRead = ctx.can.has(SEE_STATE);
    const hasAx = askCard || axRead;
    if (!hasMic && !hasAx) return [];
    const axTurn: Condition = hasMic ? MIC_SETTLED : { falsy: "permitClosed" };
    // What the Mac still owes us, as this window can read it. Off a Mac both
    // answer "nothing to ask for", so the step hides itself there.
    const macOwed: Condition = seeRead && axRead
      ? { any: [{ falsy: "axGranted" }, { falsy: "seeGranted" }] }
      : { falsy: "axGranted" };
    const macOn: Condition[] = [...(axRead ? [{ truthy: "axGranted" } as Condition] : []), ...(seeRead ? [{ truthy: "seeGranted" } as Condition] : [])];
    const allSet: Condition | undefined = axRead
      ? { all: [...(hasMic ? [MIC_SETTLED] : []), ...macOn] }
      : hasMic && !hasAx ? MIC_SETTLED : undefined;
    // Each row says what it is for; the line under them gives the Mac's own
    // names, which is the only way to find the switches in its settings.
    const macRows = [
      { key: "read", title: "Typing for you", sub: "So your words land where your cursor is, in any app, instead of only being copied." },
      ...(seeRead ? [{ key: "see", title: "Answering about your screen", sub: "So Ask can answer about what's in front of you when you ask it to. The picture is never kept." }] : []),
    ];
    steps = [
      ...(hasMic ? [mic({ all: [{ falsy: "micGranted" }, { falsy: "micAsked" }] })] : []),
      ...(hasAx ? [permitStep({
        when: axRead ? { all: [axTurn, macOwed] } : axTurn,
        title: macRows.length > 1 ? "Two switches in your Mac's settings" : "One switch in your Mac's settings",
        lines: [line(macRows.length > 1
          ? "Your Mac keeps these two for itself, under the names Accessibility and Screen Recording. Turn X0 Bot on in each and come back — they tick themselves off here."
          : "Your Mac keeps this one for itself, under the name Accessibility. Turn X0 Bot on and come back.")],
        ...(askCard ? {
          extra: [{
            type: "DeskAskSetup",
            props: {
              place: "settings", eyebrow: "", title: "", titleEm: "", lede: "",
              on: "Allowed", allow: "Open Settings", turnOff: "Turn off", restart: "Restart X0 Bot to finish", restartButton: "Restart",
              rows: macRows,
            },
          }],
        } : {
          // The Mac's own page; the window asks the main process, which opens only that fixed address.
          cta: { label: "Open Settings", onPress: OPEN_AX },
        }),
        quiet: axRead ? notNow : { label: "Done", onPress: close },
      })] : []),
      ...(allSet ? [permitStep({ when: allSet, title: "You're all set", lines: [
        // The key this computer holds to talk (desktop.holdKey: the one key, as main.js has it bound): "Hold Fn to talk".
        when({ truthy: "desktop.hold" }, row([line("Hold"), text("Fn", { size: 14, weight: 600, lineHeight: 20, bind: "desktop.holdKey" }), line("to talk, in any app.")], { gap: 4, flexWrap: "wrap" })),
        when({ falsy: "desktop.hold" }, line("Hold the clay key to speak, in any app.")),
      ] })] : []),
    ];
    const known: Condition[] = [
      ...(hasMic ? [{ neq: ["micGranted", null] } as Condition] : []),
      ...(axRead ? [{ neq: ["axGranted", null] } as Condition] : []),
      ...(seeRead ? [{ neq: ["seeGranted", null] } as Condition] : []),
    ];
    ready = known.length > 1 ? { all: known } : known[0];
    done = allSet;
  } else {
    steps = [
      mic({ all: [{ falsy: "micGranted" }, { falsy: "micAsked" }] }),
      permitStep({
        when: { all: [MIC_SETTLED, KEYS_MISSING] },
        title: "Add the X0 Bot keyboard",
        lines: keyboardLines(),
        cta: { label: "Open Settings", onPress: { kind: "openSettings", target: "keyboard" } as ActionSpec },
        quiet: notNow,
      }),
      gotYou({ all: [MIC_SETTLED, KEYS_ON] }),
    ];
    // Known enough to decide: the microphone, and the keyboard switched on or not. Full Access is only read once the
    // keyboard has run; an iPhone may not have that yet, and KEYS_ON does not need it there.
    ready = { all: [{ neq: ["micGranted", null] }, { neq: ["keyboardEnabled", null] }, { any: [{ neq: ["keyboardReady", null] }, { platform: "ios" }] }] };
    done = { all: [MIC_SETTLED, KEYS_ON] };
  }
  if (canMove(ctx)) {
    // `after`: a state path that must be true first (Home's hello plays alone, then the card comes). Home waits on the card
    // closing then, so it is not also kept per device: a second account on the same phone still gets it.
    const wait: Condition | undefined = o.after ? (ready ? { all: [ready, { truthy: o.after }] } : { truthy: o.after }) : ready;
    return [botCard(steps, {
      ...CARD_BOT, kind: "custom", overlay: true, width: desk ? 360 : 330, label: "Set up Keylessbord",
      ...(wait ? { readyWhen: wait } : {}), ...(done ? { doneWhen: done } : {}),
      closeWhen: { truthy: "permitClosed" }, ...(o.after ? {} : { once: "bots.arrival" }), doneDelayMs: CHEER_MS, onComplete: close,
    })];
  }
  // A build without the living tiles: the same steps in a plain card at the top, gone when answered or all done.
  const shown: Condition = { all: [{ falsy: "permitClosed" }, ...(ready ? [ready] : []), ...(done ? [{ not: done }] : [])] };
  return [when(shown, col(steps.filter((st) => !texts(st).includes("You're all set")), { borderRadius: 24, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, paddingTop: 6 }))];
}

/** Every text in a tree. */
function texts(n: Node): string[] {
  const out: string[] = [];
  const visit = (x: Node) => { if (x.type === "Text" && typeof x.props?.content === "string") out.push(x.props.content); (x.children ?? []).forEach(visit); };
  visit(n);
  return out;
}
