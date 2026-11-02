/**
 * The person's plan and what it includes.
 */

import type { ScreenResponse, ActionRef } from "../../../../shared/types/sdui.js";
import type { DeskContext } from "./context.js";
import { screen, page, text, row, link, stack, n } from "./kit.js";

export function planWords(ctx: DeskContext): { used: number; of: number; paid: boolean } {
  return {
    used: ctx.allowance?.used ?? ctx.usage?.month.words ?? 0,
    of: ctx.allowance?.total ?? 0,
    paid: !!ctx.entitlement,
  };
}

export function deskPlan(ctx: DeskContext): ScreenResponse {
  // Free for everyone: nothing to choose, nothing to buy.
  if (ctx.free) {
    return screen("desk_plan", "Plan", [page([
      text("Plan", "d-eyebrow"),
      text("X0 Bot is free.", "d-h1", { marginTop: 6 }),
      text("Every word, on your phone and this computer. There is no plan to pick and nothing to pay.", "d-lede", { marginTop: 8 }),
      row([link("Back to Today", { kind: "switchTab", tabId: "desk_today" })], { marginTop: 18 }),
    ], { maxWidth: 820 })]);
  }
  const q = planWords(ctx);
  const out = !q.paid && q.of > 0 && q.used >= q.of;
  const plans = (ctx.plans ?? []).filter((p) => !p.free && p.price);
  const cards = plans.map((p) => stack([
    // Every card carries the badge line, empty or not, so the prices line up.
    row([text(p.label, "d-eyebrow"), text(p.badge || "\u00a0", "d-margin")], { justify: "between", align: "center" }),
    text(p.price ?? "", "d-price", { marginTop: 8 }),
    text(p.period ?? "", "d-lede", { marginTop: 2 }),
    row([link(`Choose ${p.label}`, { kind: "iap.subscribe", productId: p.productId ?? p.id } as ActionRef)], { marginTop: 14 }),
  ], { flexBasis: 240 }, `d-plan${p.default ? " d-plan-lead" : ""}`));

  return screen("desk_plan", "Plan", [page([
    text("Plan", "d-eyebrow"),
    text(q.paid ? "Unlimited words, on every device." : out ? "This month's free words are used." : "Unlimited words, when you want them.", "d-h1", { marginTop: 6 }),
    text(q.paid
      ? "Your subscription covers your phone and this computer."
      : `${n(q.used)} of ${n(q.of)} free words used this month. They come back on the 1st.`, "d-lede", { marginTop: 8 }),
    ...(q.paid ? [] : [
      row(cards, { gap: 16, marginTop: 36, flexWrap: "wrap" }),
      // The purchase screen: the one place with a price (the stores' and Razorpay's), so the renewal and the terms are said here too.
      text("One subscription covers your phone and your computer. It renews automatically until you cancel. Checkout opens in your browser; payments by Razorpay.", "d-lede", { marginTop: 18 }),
      row([
        link("Terms", { kind: "openUrl", url: "https://x0bot.com/terms", external: true } as ActionRef),
        link("Privacy", { kind: "openUrl", url: "https://x0bot.com/privacy", external: true } as ActionRef),
      ], { gap: 16, marginTop: 10 }, "d-tools"),
    ]),
  ], { maxWidth: 820 })]);
}
