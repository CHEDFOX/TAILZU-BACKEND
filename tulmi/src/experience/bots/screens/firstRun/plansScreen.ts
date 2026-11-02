/**
 * The first run's plansScreen screen.
 */

import type { ScreenResponse, ActionSpec, Node, Condition, ActionRef } from "../../../../../../shared/types/sdui.js";
import { type BotsCtx, button, row, blip, primaryButton, seq, box, when, C, text, type TextOpts, col, grow, meta } from "../../kit.js";
import {
  back, deskBlip, deskHeading, phoneBackLine, phoneHeading, deskFrame, W, signedInAs, deskFoot, deskBack, phoneFrame, toast, saved,
  setState, link,
} from "./parts.js";

// ===================================================================== Plans

/** GET /v1/bots/first-run/plans (routes/bots/botsFirstRun.ts). */
export interface Plans {
  freeForAll: boolean;
  entitled: boolean;
  store?: string;
  freeWords: number;
  features: string[];
  plans: Array<{
    id: string; label: string; price: string; per: string; perTemplate?: string; note?: string; badge?: string; trialDays?: number; default?: boolean; line?: string;
    buy?: { kind: "iap.showPaywall"; offeringId: string; packageId?: string } | { kind: "iap.subscribe"; productId: string };
  }>;
}

/** "4 Nov": the day a trial that starts now ends. */
function dayAfter(nowMs: number, tzOffsetMinutes: number, days: number): string {
  const d = new Date(nowMs + tzOffsetMinutes * 60_000 + days * 86_400_000);
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${m}`;
}

export function plansScreen(ctx: BotsCtx, data: Plans | undefined): ScreenResponse {
  const desk = ctx.client === "desktop";
  // Reached from You and Billing, not the first run any more: every way out goes back to where it was opened from.
  const done: ActionSpec = back;
  const doneHeading = (h: string, sub: string): Node[] => desk ? [deskBlip("done", 140), deskHeading("Plans", h, sub)] : [phoneBackLine(), phoneHeading(h, sub, 6)];
  // Nothing to choose: free for everyone, already paying, or the plans could not be read. Say so, and go in.
  const simple = (h: string, sub: string, cta: string): ScreenResponse => desk
    ? deskFrame(ctx, { title: W.plansH, right: signedInAs(ctx), current: null, left: doneHeading(h, sub), main: [], foot: deskFoot(deskBack(), [button(cta, done, { size: "lg" })]) })
    : phoneFrame(ctx, { title: W.plansH, body: [...doneHeading(h, sub), row([blip("done", 160)], { justifyContent: "center", paddingTop: 20 })], footer: [primaryButton(cta, done, { wide: true })] });
  if (!data) return simple("Plans", "Plans couldn't load just now. Try again in a moment.", "Done");
  if (data.freeForAll) return simple("Plans", "X0 Bot is free for everyone right now. Nothing to pick, nothing to pay.", "Done");
  if (data.entitled) return simple("You have a plan", "This account already has a plan. It covers your phone and your computer.", "Done");
  const paid = data.plans;
  if (!paid.length) return simple("Plans", "You're on Free. Plans to buy aren't available here yet.", "Done");

  const chosen = (paid.find((p) => p.default) ?? paid[0]!).id;
  const isOn = (id: string): Condition => ({ eq: ["plan", id] });
  const sel = (id: string, then: unknown, otherwise: unknown) => ({ ...isOn(id), then, else: otherwise });
  const buyAction = (p: Plans["plans"][number]): ActionRef | undefined => {
    if (!p.buy) return undefined;
    const failed = toast("Couldn't complete the purchase. Nothing was charged.");
    // The window has no store: the pay page opens in the browser, and the account is ready when they come back.
    if (desk) return seq(p.buy as ActionSpec, done);
    return { ...p.buy, onSuccess: seq(saved("You're in."), done), onError: failed } as ActionSpec;
  };
  const radio = (id: string): Node => box([when(isOn(id), box([], { width: 10, height: 10, borderRadius: 5, backgroundColor: C.ink }))], {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: sel(id, C.ink, C.outline), alignItems: "center", justifyContent: "center", flexShrink: 0,
  });
  const tag = (s: string): Node => box([text(s, { size: 12, weight: 500, lineHeight: 16 })], { backgroundColor: C.surface, borderRadius: 10, paddingVertical: 3, paddingHorizontal: 8 });
  // A phone's plans carry their store package: the price shows as the store words it once it answers (phone/paywall.ts storePriceOf).
  const store = (p: Plans["plans"][number], o: { field?: "perMonth"; template?: string } = {}): TextOpts =>
    p.buy?.kind === "iap.showPaywall" && p.buy.packageId
      ? { storePrice: { packageId: p.buy.packageId, offeringId: p.buy.offeringId, ...o } }
      : {};
  // A plan is its name, its price and period, and one line that is the same for every bot. The selected one shows its
  // billing terms too (the stores want the commitment before the purchase).
  const planCard = (p: Plans["plans"][number]): Node => col([
    row([radio(p.id), text(p.label, { size: 17, weight: 600, lineHeight: 22 }),
      ...(p.trialDays ? [tag(`${p.trialDays} days free`)] : p.badge ? [tag(p.badge)] : []),
      grow(), text(p.price, { size: 17, weight: 700, lineHeight: 22, ...store(p) })], { gap: 10 }),
    col([
      ...(p.per ? [meta(p.per, { size: 12, ...(p.perTemplate ? store(p, { field: "perMonth", template: p.perTemplate }) : {}) })] : []),
      ...(p.line ? [text(p.line, { size: 14, lineHeight: 19 })] : []),
      ...(p.note && !p.trialDays ? [when(isOn(p.id), meta(p.note, { size: 12 }))] : []),
    ], { gap: 6, paddingLeft: 32, marginTop: -6 }),
  ], {
    paddingVertical: 14, paddingHorizontal: 16, gap: 10, borderRadius: 18, borderWidth: sel(p.id, 1.5, 1), borderColor: sel(p.id, C.ink, C.line),
  }, setState("plan", p.id));
  const cards = paid.map(planCard);
  /** What a trial costs, day by day: nothing today, the price when it ends. */
  const trial = (p: Plans["plans"][number]): Node | null => p.trialDays ? when(isOn(p.id), col([
    text(`Try ${p.label} free for ${p.trialDays} days. Cancel any time before it ends and you pay nothing.`, { size: 14, lineHeight: 20 }),
    row([
      col([meta("Today", { size: 12 }), text("Free", { size: 13, weight: 600, lineHeight: 17 })], { gap: 2, paddingHorizontal: 14, flexGrow: 1, flexBasis: 0 }),
      col([meta(dayAfter(ctx.live.now, ctx.tzOffsetMinutes, p.trialDays), { size: 12 }), text(`Then ${p.price}`, { size: 13, weight: 600, lineHeight: 17, ...store(p, { template: "Then {price}" }) })], {
        gap: 2, paddingHorizontal: 14, flexGrow: 1, flexBasis: 0, borderLeftWidth: 1, borderLeftColor: C.track,
      }),
    ], { backgroundColor: C.surface, borderRadius: 14, paddingVertical: 10 }),
  ], { gap: 10 })) : null;
  const trials = paid.map(trial).filter((n): n is Node => !!n);
  const ctaFor = (p: Plans["plans"][number]): string =>
    p.trialDays ? (p.trialDays === 7 ? "Start free week" : `Start ${p.trialDays} free days`) : `Choose ${p.label}`;
  const ctas: Node[] = [
    ...paid.map((p) => when(isOn(p.id), button(ctaFor(p), buyAction(p), { size: "lg", wide: !desk, ...(p.buy ? {} : { kind: "disabled" }) }))),
  ];
  const stay = link("Not now", done, { center: true });
  // A plan bought before (another phone, a reinstall) is the store's to give back, when the person asks for it (App Review 3.1.1):
  // RevenueCat's restore, then the screen read again, which says "You have a plan" once it is theirs.
  const restore = link(W.restore, {
    kind: "iap.restore", onSuccess: seq(toast(W.restoreDone), { kind: "refresh" } as ActionSpec), onError: toast(W.restoreErr),
  } as ActionSpec, { center: true });
  const sub = "Start today. Switch any time from You.";
  // THE PURCHASE SCREEN, AND THE ONLY ONE WITH MONEY ON IT: the stores (App Review 3.1.2, Google Play) want the price and its period
  // shown before someone buys, with the renewal and the terms. Everywhere else the app shows no money.
  const fine = desk
    ? "Renews automatically until you cancel. You pay in your browser, and nothing is charged until you confirm there."
    : "Renews automatically until you cancel. Cancel any time in your store's subscriptions. Your store shows the final price before you pay.";
  const legal = row([link("Terms", { kind: "openUrl", url: "https://x0bot.com/terms", external: true }, { size: 13, color: C.meta }), link("Privacy", { kind: "openUrl", url: "https://x0bot.com/privacy", external: true }, { size: 13, color: C.meta })], { gap: 18, justifyContent: "center" });
  const state = { plan: chosen };

  if (desk) {
    return deskFrame(ctx, {
      title: W.plansH, right: signedInAs(ctx), current: null, state,
      left: [...doneHeading(W.plansH, sub), ...(trials.length ? [box(trials, { maxWidth: 400 })] : []), meta(fine, { size: 12, style: { maxWidth: 400 } }), legal],
      main: [col(cards, { gap: 12 })],
      foot: deskFoot(deskBack(), [stay, ...ctas]),
    });
  }
  return phoneFrame(ctx, {
    title: W.plansH, state, gap: 16,
    body: [...doneHeading(W.plansH, sub), col(cards, { gap: 12 }), ...trials],
    footer: [...ctas, stay, restore, meta(fine, { size: 11, align: "center" }), legal],
  });
}
