/**
 * The first run's last step: they are in, and their bots are ready. One button, Start, and nothing to type.
 *
 * Nothing is asked here (App Review 4: after Sign in with Apple no name is asked, and a "Name" field here was read as
 * one even though it named the assistant). The assistant keeps its default name; it is renamed in Keylessbord's
 * settings (keybotYou.ts, What you call it). The person's own name and gender are the About you card's, on Home after
 * a few visits (aboutCard.ts), and never their name when they signed in with Apple.
 */
import type { ActionSpec, Node } from "../../../../../../shared/types/sdui.js";
import { botAvatar, button, call, col, meta, primaryButton, row, seq, type BotsCtx } from "../../kit.js";
import {
  toast, type Figure, gateStep, deskBody, signedInAs, deskFig, deskHeading, W, deskFoot, phoneStepBody, phoneTop, phoneHeading,
} from "./parts.js";

/** The end of the first run: onboarded, as the onboarding's Done marks it, and on to Bots. */
function finish(): ActionSpec {
  return call("PUT", "/v1/profile", { onboarded: true }, {
    ok: seq({ kind: "haptic", style: "success" } as ActionSpec, { kind: "switchTab", tabId: "bots" }),
    fail: toast("Couldn't finish setting up. Try again."),
  });
}

/** Their first bots, as faces, with how many: what is waiting for them. */
function botsReady(ctx: BotsCtx, size: number): Node[] {
  const heads = ctx.live.bots.slice(0, 4);
  if (!heads.length) return [];
  return [row([
    row(heads.map((b) => botAvatar(b, size)), { gap: 4 }),
    meta(`${heads.length === 1 ? "1 bot is" : `${heads.length} bots are`} ready for you`, { size: 13 }),
  ], { gap: 10, alignItems: "center" })];
}

export function readyStep(ctx: BotsCtx, fig: Figure): Node {
  const start = finish();
  if (ctx.client === "desktop") {
    return gateStep(true, deskBody({
      title: W.readyH, right: signedInAs(ctx), current: 1,
      left: [deskFig(fig, "tada", 140), deskHeading("Last step", W.readyH, W.readyP)],
      main: [col(botsReady(ctx, 22), { gap: 12 })],
      // A window's stage never steps back, so there is no Back here.
      foot: deskFoot(null, [button("Start", start, { size: "lg" })]),
    }), { props: { stepId: "ready" } });
  }
  return gateStep(false, [phoneStepBody([
    phoneTop(1, 1),
    row([fig("tada", 128)], { justifyContent: "center" }),
    phoneHeading(W.readyH, W.readyP),
    ...botsReady(ctx, 26),
  ], [primaryButton("Start", start, { wide: true })])], { props: { stepId: "ready" } });
}
