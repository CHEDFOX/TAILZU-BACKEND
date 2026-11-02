/**
 * A subscription once bought: the subscribed screen, managing and cancelling it.
 */

import { type ScreenResponse, SDUI_SCHEMA_VERSION, type Node, type ActionRef } from "../../../../shared/types/sdui.js";
import type { ScreenContext } from "../screens.js";
import { blipBox } from "../touches.js";

/**
 * What the paywall is for somebody who already pays.
 *
 * One statement and one door. The plan's tier is deliberately not on it: the
 * server knows the entitlement, not which product bought it, and a screen
 * that guesses "Monthly" at somebody on the annual plan is worse than one
 * that says nothing about it.
 */
export function subscribedScreen(store?: string, expiresAt?: string, renewing?: boolean): ScreenResponse {
  const where = MANAGE_AT.find(([, stores]) => stores.includes(String(store ?? "").toLowerCase()));
  const razorpay = String(store ?? "").toLowerCase() === "razorpay";
  // WHO IS CHARGING, AND WHEN NEXT. The one thing the big subscriptions put on
  // this screen that we did not, and the pair of facts somebody actually came
  // for: a subscription with no date on it reads as something you have rather
  // than something you are paying for, and that is how a renewal becomes a
  // surprise. `expires_at` on a live subscription IS the next charge.
  //
  // Said only when both are known. "Renews soon", or a date with no biller
  // against it, is the shape of a number nobody can check.
  const renews = razorpay ? renewLine("Razorpay", expiresAt, renewing !== false) : renewLine(where?.[4], expiresAt);
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "paywall",
    title: "",
    state: {},
    actions: { dismiss: { kind: "navigateBack" } },
    root: {
      type: "Screen",
      style: { padding: 24, justifyContent: "center", flex: 1 },
      children: [
        // DONE: Blip with a tada, small and above the words. The one Blip here.
        (() => { const b = blipBox("tada-s", 0.9); return { ...b, style: { ...b.style, marginBottom: 14 } } as Node; })(),
        {
          type: "Text",
          props: { content: "You're on X0 Bot." },
          style: { fontSize: 30, fontWeight: "800", color: "$color.text", marginBottom: 10 },
        },
        {
          type: "Text",
          props: {
            content:
              "Your subscription covers this account — every device you sign in on, with nothing to buy again.",
          },
          style: { fontSize: 16, lineHeight: 23, color: "$color.muted", marginBottom: renews ? 14 : 26 },
        },
        ...(renews
          ? [{
              type: "Text",
              props: { content: renews },
              style: { fontSize: 14, color: "$color.muted", marginBottom: 26 },
            } as Node]
          : []),
        // The store, named once, where somebody would actually look for it.
        ...(where
          ? [{
              type: "Row",
              props: { label: where[2] },
              on: { onPress: { kind: "openUrl", url: where[3] } as ActionRef },
            } as Node]
          : []),
        // Razorpay has no page of its own for this: it is cancelled here.
        ...(razorpay && renewing !== false
          ? [{
              type: "Row",
              props: { label: "Cancel subscription" },
              on: { onPress: { kind: "navigate", screenId: "cancel_subscription" } as ActionRef },
            } as Node]
          : []),
        {
          type: "Button",
          props: { label: "Done", variant: "primary" },
          on: { onPress: { kind: "navigateBack" } },
          style: { marginTop: 26 },
        },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/**
 * Where a live subscription is managed, grouped by who can actually change it.
 *
 * ONE BOOLEAN PER DESTINATION, NOT A COMPARISON AGAINST THE STORE NAME. The
 * two renderers disagree about what `eq` reads: the window resolves a
 * `flags.`-prefixed reference, and the phones resolve every operand against
 * SCREEN STATE, where a boot flag has never been. A row gated on
 * `eq: ["billing.store", …]` would therefore be correct, silent, and invisible
 * on the phones forever — and a row nobody can see is indistinguishable from
 * the bug this exists to fix. `flag` is understood identically by both.
 *
 * The label says CHANGE as well as cancel, because on a phone this row is
 * the upgrade path too. Moving from monthly to annual is a change Apple and
 * Google each make on their own subscription page, and neither lets anything
 * else make it — so a subscriber who wants the bigger plan is not looking for
 * a paywall, they are looking for this row.
 *
 * Grouped by destination rather than by store because that is the question:
 * the Mac App Store and the App Store are one subscription page, and Paddle,
 * Stripe and RevenueCat's own billing are all "on the web". An unknown store,
 * or a promotional grant, lights none of them — silence beats sending someone
 * to a settings page with nothing of theirs on it.
 */
export const MANAGE_AT: [string, string[], string, string, string][] = [
  // Apple lets nothing but Apple cancel an App Store subscription.
  ["apple", ["app_store", "mac_app_store"], "Change or cancel · App Store", "https://apps.apple.com/account/subscriptions", "Apple"],
  ["google", ["play_store"], "Change or cancel · Google Play", "https://play.google.com/store/account/subscriptions", "Google Play"],
  // Paddle and Stripe each mail a management link on purchase, to a
  // per-customer URL this server never holds. Support is the one address that
  // is true for every one of them. (Razorpay is not here: it is cancelled in
  // the app — see manageFlags and cancelSubscriptionScreen.)
  ["web", ["paddle", "stripe", "rc_billing"], "Change or cancel · billed on the web", "mailto:support@x0bot.com", "the web"],
];

/**
 * "Billed through Apple · renews 12 Oct 2026", or nothing.
 *
 * Nothing is the answer whenever either half is missing or unreadable: a date
 * with no biller against it, or a biller with "soon" after it, is a number
 * nobody can check against their bank. A lifetime grant has no expiry and gets
 * no line, which is correct — it never renews.
 */
function renewLine(biller: string | undefined, expiresAt: string | undefined, renews = true): string | null {
  if (!biller || !expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t) || t <= Date.now()) return null;
  const on = shortDate(t);
  return renews ? `Billed through ${biller} · renews ${on}` : `Cancelled · Unlimited until ${on}`;
}

const shortDate = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * Cancel a Razorpay subscription, from inside the app.
 *
 * A screen of its own rather than a one-tap row, as Delete account is: it is
 * hard to undo, and it is the one place to say what happens next — the
 * period already paid for runs out, nothing is charged again.
 */
export function cancelSubscriptionScreen(ctx: ScreenContext): ScreenResponse {
  const ent = ctx.entitlement;
  const ours = String(ent?.store ?? "").toLowerCase() === "razorpay";
  const end = ent?.expiresAt ? Date.parse(ent.expiresAt) : NaN;
  const until = Number.isFinite(end) && end > Date.now() ? shortDate(end) : null;
  const done = `Cancelled. Unlimited stays on until ${until ?? "the end of the period you paid for"}.`;
  // The cancel call is on the screen only when there is something to cancel.
  const say = (heading: string, body: string, buttons: Node[], offersCancel = false): ScreenResponse => ({
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "cancel_subscription",
    title: "",
    state: {},
    actions: offersCancel ? {
      confirm: { kind: "callEndpoint", method: "POST", path: "/v1/billing/razorpay/cancel", onSuccess: "cancelled", onError: "err" },
      cancelled: { kind: "sequence", actions: [
        { kind: "toast", message: done, tone: "success" },
        { kind: "navigateBack" },
      ] },
      err: { kind: "toast", message: "Couldn't cancel. Try again.", tone: "error" },
    } : {},
    root: { type: "Screen", children: [
      { type: "Heading", props: { content: heading }, style: { fontSize: 28, fontWeight: "800", color: "$color.text", marginBottom: 14 } },
      { type: "Paragraph", props: { content: body }, style: { marginBottom: 32 } },
      ...buttons,
    ] },
    cacheTtlSeconds: 0,
  });
  const back = (label: string, variant = "secondary"): Node =>
    ({ type: "Button", props: { label, variant }, on: { onPress: { kind: "navigateBack" } } });
  if (!ours) {
    return say("Nothing to cancel here",
      "There is no web subscription on this account. A subscription bought in the App Store or Google Play is cancelled there.",
      [back("Done", "primary")]);
  }
  if (ent?.renews === false) return say("Already cancelled", done, [back("Done", "primary")]);
  return say("Cancel subscription",
    `Unlimited stays on until ${until ?? "the end of the period you paid for"}, then this account goes back to the free plan. You will not be charged again.`,
    [
      { type: "Button", props: { label: "Cancel subscription", variant: "danger" }, on: { onPress: "confirm" } },
      { type: "Spacer", style: { height: 10 } },
      back("Keep it"),
    ], true);
}

/**
 * `billing.manage.*` — one destination flag at most, plus the URL itself.
 *
 * THE URL TRAVELS BECAUSE THE CLIENTS SHOULD NOT BE TELLING ANYONE WHERE TO
 * GO. A subscriber who taps Upgrade wants to upgrade; answering with the
 * directions to a settings screen is asking them to do the work of finding it,
 * and it is the part that turns a wrong tap into a support email. With the
 * address here, the tap can simply arrive at the place that can change the
 * plan — and when the destination moves, it moves once, here.
 */
export function manageFlags(store: string | undefined): Record<string, string | boolean> {
  const s = String(store ?? "").trim().toLowerCase();
  if (!s) return {};
  // Razorpay is managed IN the app (the cancel_subscription screen), so it
  // has a flag of its own and no address to send anybody to.
  if (s === "razorpay") return { "billing.manage.razorpay": true };
  const hit = MANAGE_AT.find(([, stores]) => stores.includes(s));
  return hit ? { [`billing.manage.${hit[0]}`]: true, "billing.manage.url": hit[3] } : {};
}
