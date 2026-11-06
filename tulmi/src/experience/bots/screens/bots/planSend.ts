/**
 * A WAIT'S HAND-OFF (Plan Ease step 4, PLAN_V2_WAITS; docs/plan-ease-people.md; design A6, B10).
 *
 *   bots.plan.send   params: item ("pt:<id>"), go ("send", or "notcame" for a visit that didn't happen), from ("page": the card's
 *                    button, so it goes back there)
 *
 * "Still waiting on Rahul" [Send] from a notification, or Send in a wait's details. A notification's button can't open another app by
 * itself, so it opens this: WhatsApp (or the mail app) opens at once with the follow-up already written, Send is noted (it checks again
 * in 2 days), and the Plan is underneath when they come back. The person reads the words there and presses send themselves. Nothing
 * to read here. The link comes from the server (botsBots/planWaits.ts handoff): built from what was in their own words, every part
 * encoded, and the phone checks it against its hand-off list again.
 */
import type { ActionRef, ActionSpec } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, SCREENS, call, col, grow, meta, page, primaryButton, row, secondaryButton, seq } from "../../kit.js";
import { type BotsScreen, screen } from "../../registry.js";
import { A, handoffOf } from "./parts.js";

export interface PlanSendData { url?: string }

const itemOf = (ctx: BotsCtx): string => String(ctx.params.item ?? "").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 120);
const goOf = (ctx: BotsCtx): "send" | "notcame" => (ctx.params.go === "notcame" ? "notcame" : "send");

/** The notification buttons that open WhatsApp or mail from here (planKinds.ts x0_wait, x0_came). */
const SEND_BUTTONS = ["p_send", "p_notcame"] as const;

export function planSendPage(ctx: BotsCtx, d: PlanSendData | undefined) {
  const item = itemOf(ctx);
  const url = typeof d?.url === "string" ? d.url : "";
  // Opened from the page's card: back to it. From a notification: the Plan, in its place.
  const toPlan = (ctx.params.from === "page" ? { kind: "navigateBack" } : { kind: "navigate", screenId: SCREENS.plan, replace: true }) as ActionSpec;
  // Opened is sent: checked again in 2 days (a visit's No: asked again tomorrow). A failed note is no reason to stop them. Only when
  // WhatsApp really opens for them: a notification tapped just to look counts as nothing.
  const noted = call("POST", "/v1/widgets/act", { item, action: goOf(ctx), key: `handoff:${item}:${ctx.live.now}`.slice(0, 120) }, { ok: seq(), fail: seq() }) as ActionSpec;
  const go: ActionRef = url ? seq({ kind: "openUrl", url, handoff: true } as ActionSpec, noted, toPlan) : toPlan;
  const how = handoffOf(ctx, SEND_BUTTONS);
  const opening = url ? (url.startsWith("mailto:") ? "Opening your mail…" : "Opening WhatsApp…") : "";
  if (how === "ask" && url) {
    // A build that can't say which was pressed: one button, the person's own tap, and the Plan underneath.
    return page(ctx, {
      title: "Plan Ease", nav: "plan",
      body: [col([
        meta(goOf(ctx) === "notcame" ? "Ask if they're coming today?" : "Send the follow-up?", { size: 15 }),
        row([
          primaryButton(url.startsWith("mailto:") ? "Open mail" : "Open WhatsApp", go, { size: "md" }),
          secondaryButton("Open Plan", toPlan, { size: "md" }),
        ], { gap: 10, flexWrap: "wrap" }),
      ], { gap: 14, paddingTop: 24 })],
    });
  }
  return page(ctx, {
    title: "Plan Ease", nav: "plan",
    body: [{ ...col([meta(how === "go" ? opening : "", { size: 14 }), grow()], { flexGrow: 1, alignItems: "center", justifyContent: "center", minHeight: 200 }), on: { onAppear: how === "go" ? go : toPlan } }],
  });
}

export const planPeopleScreens: BotsScreen[] = [
  screen<PlanSendData>({
    id: SCREENS.planSend,
    load: (ctx, deps) => {
      const item = itemOf(ctx);
      return item ? deps.api<PlanSendData>("GET", `${A}/plan/handoff?item=${encodeURIComponent(item)}&go=${goOf(ctx)}`).catch(() => ({})) : Promise.resolve({});
    },
    build: (ctx, d) => planSendPage(ctx, d),
  }),
];
