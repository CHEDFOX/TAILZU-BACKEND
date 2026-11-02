/**
 * The paywall: the plans, their prices and the subscribe flow.
 */

import type { PaywallConfig, PaywallPlan } from "../../../../shared/types/api.js";
import { type ActionSpec, type ScreenResponse, type ActionRef, type Node, SDUI_SCHEMA_VERSION } from "../../../../shared/types/sdui.js";
import { POLICY, freeMonthlyWords } from "../policy.js";
import { screenHero } from "./hero.js";
import { subscribedScreen } from "./subscription.js";
import { THEME } from "./theme.js";

/**
 * Does a user without an entitlement get stopped, or merely shown the price?
 *
 * One edit turns the paywall from a screen you can open into a wall you have
 * to pass. It is false while the store products are not purchasable — see the
 * note at the flag — and reading it from here rather than from a literal in
 * the middle of a flags block is what makes flipping it a one-line change that
 * is findable.
 */
export const PAYWALL_BLOCK = false;

// ---------------------------------------------------------------------------
// Paywall — a backend-authored subscription screen.
// ---------------------------------------------------------------------------
//
// The whole thing is data: media, copy, plan cards, CTA all come from
// PAYWALL_CONFIG below. Swap that constant → the paywall changes, no client
// rebuild. RevenueCat is the store engine; iap.showPaywall drives purchase.
//
// A plan card:
//   - Renders label + price + optional badge + optional footnote.
//   - Tap sets `state.selectedPlanId` (haptic on tap).
//   - Selected card gets a themed border + fill.
// Primary CTA reads `state.selectedPlanId`, looks the plan up, and fires
// iap.showPaywall with the plan's offeringId/packageId, or iap.subscribe if
// only productId is set.
//
// Everything below the plans is optional — the CTA is the only required
// element. Set `dismissible: false` for a hard paywall (no "×"/close).

/**
 * The paywall's LAYOUT, apart from its content.
 *
 * PAYWALL_CONFIG says what is sold; this says where it sits on the art. They
 * are separate because they change for different reasons — a price changes
 * with the business, the composition changes with whatever was uploaded last.
 */
export const PAYWALL_UI = {
  /**
   * Which end of the screen the plan rows sit at.
   *
   * "bottom" is the poster reading: art above, offer beneath, the shape of
   * every app-store screenshot. "top" is for art whose subject is in the
   * lower half and would be covered by rows sitting on it — which is a
   * property of the upload, not of the paywall, so it is a value here and not
   * a rewrite.
   *
   * The scrim follows automatically. It has to: rows are only legible over an
   * unknown image because something darkens the end they sit at.
   */
  plansAt: "top" as "top" | "bottom",
  /** Clear of the status bar and the ✕ when the plans are at the top. */
  paddingTop: 104,
  paddingBottom: 24,
  paddingHorizontal: 16,
  /** Transparent where the art shows, opaque where the rows are. */
  scrim: ["rgba(0,0,0,0)", "rgba(0,0,0,0.20)", "rgba(0,0,0,0.80)", "rgba(0,0,0,0.94)"],
  scrimStops: [0, 0.4, 0.72, 1],
  /**
   * The auto-renewal line under the rows.
   *
   * Quiet, but not decorative — both stores require this sentence to be on the
   * screen where the purchase happens, so it has to be legible over whatever
   * art someone uploads, which is the scrim's job above and this colour's job
   * here. Do not take it below the muted step.
   */
  footnoteColor: "rgba(255,255,255,0.55)",

  /**
   * THE SAME SCREEN, TURNED ON ITS SIDE.
   *
   * `plansAt` above is a portrait idea: art at one end, offer at the other,
   * the shape of every app-store screenshot. A window is wider than it is
   * tall, and landscape art puts its subject SIDEWAYS — so a band across the
   * bottom either covers the subject or leaves the rows on bare art, and the
   * scrim that follows `plansAt` darkens the wrong axis either way.
   *
   * So the window reads the same three decisions on the other axis: which side
   * the rows take, how wide they get, and which side the scrim darkens. As
   * with the sign-in art, these are numbers rather than a stylesheet because
   * the art is an upload — one composed the other way round is an edit here
   * and a cache bump.
   *
   * Set for the art in the paywall slot today: a hand rising from the bottom
   * centre, a pool of light on the right, and a clean dark grey down the left.
   * White rows are only readable on that left side.
   */
  desktop: {
    /** "left" or "right" — which side the rows take. */
    align: "left",
    /** Their column's centre, 0..1 across the window. */
    column: 0.24,
    /** How wide that column is. Wider than the sign-in form: this one holds a
     *  title, three rows, a restore and the auto-renewal notice. */
    columnWidth: 360,
    /**
     * Darkening under the rows, ACROSS rather than down.
     *
     * Doing the same job the vertical scrim does on a phone — rows are only
     * legible over art nobody has seen yet because something darkens the end
     * they sit at — and it is what lets the column be wider than the art's own
     * dark side. The far end stays clear so the subject is not dimmed.
     */
    scrim: ["rgba(0,0,0,0.92)", "rgba(0,0,0,0.78)", "rgba(0,0,0,0.25)", "rgba(0,0,0,0)"],
    scrimStops: [0, 0.3, 0.5, 0.62],
  },
};

/**
 * A plan row's `storePrice` (app billing/storePrice.ts): the phone shows the store's own price for the package, in the
 * person's currency, in place of the words this file holds. With a template, the store's monthly price in that line.
 */
function storePriceOf(
  plan: { offeringId?: string; packageId?: string }, template?: string,
): { storePrice?: { packageId: string; offeringId?: string; field?: "perMonth"; template?: string } } {
  if (!plan.packageId) return {};
  return { storePrice: {
    packageId: plan.packageId,
    ...(plan.offeringId ? { offeringId: plan.offeringId } : {}),
    ...(template ? { field: "perMonth" as const, template } : {}),
  } };
}

export const PAYWALL_CONFIG: PaywallConfig = {
  // Empty on purpose: with no frames the paywall renders BinaryReveal — the
  // wordmark decoding out of 0s and 1s on a loop. Add keys back here and the
  // uploaded art takes over instead.
  heroFrames: [],
  heroFrameMs: 2200,
  heroLoops: 0,
  title: "Type once. Sound like you always.",
  subtitle: "Unlock unlimited voice cleanups, every tone, every language.",
  features: [
    "Unlimited voice-to-text refinement",
    "All 12 personality presets + tones",
    "Priority speech recognition",
    "Cancel anytime",
  ],
  // Two auto-renewing tiers, branded Lite (monthly) / Elite (annual). Both
  // grant the same `pro` entitlement — they differ only by billing period.
  // productId MUST match the App Store product exactly (see below); packageId is
  // RevenueCat's built-in duration slot ($rc_monthly / $rc_annual). Prices are
  // DISPLAY COPY — set the real prices in App Store Connect and keep in sync (or
  // ask to switch the paywall to live RevenueCat prices). Elite first;
  // `default: true` pre-selects it.
  plans: [
    {
      // BITE — the free tier, shown but not sold.
      //
      // A paywall listing only paid tiers implies the free one has run out or
      // never existed. Standing it next to Lite and Elite is what makes the
      // other two read as a choice rather than a toll.
      //
      // NO NUMBER HERE. It is filled in by paywallScreen from the allowance the
      // server actually enforces, because writing "800" in this file would be a
      // promise the backend never agreed to — and the day the allowance moves,
      // the paywall would keep quoting the old one to everyone who reads it.
      //
      // It cannot be computed here either: this object is built when the module
      // is imported, and config is resolved after that, so anything read at this
      // point is whatever the environment looked like before boot.
      id: "free",
      free: true,
      label: "Stay free",
      price: "",
      /** One line, and it is the number that makes the paid rows read as a
       *  choice. Filled from the allowance the server actually enforces. */
      note: "",
    },
    {
      // Both plans are monthly (Elite was yearly until the move to two monthly plans; yearly subscribers keep it, but it
      // is no longer sold). Elite's own allowance follows its product (you/usage.ts planOf, USAGE_ELITE_MONTH_PAISE).
      id: "elite",
      // Made in both stores and in RevenueCat (offering "default", custom package "elite_monthly"), attached to the
      // same entitlement as Lite.
      productId: "x0_elite_monthly",
      offeringId: "default",
      packageId: "elite_monthly",
      // THE TIER'S NAME. Both stores list these as Elite and Lite, so a customer who checks their subscriptions sees
      // the names the app showed them. The period disclosure both stores require lives in `period` and `note`: do not
      // remove either of those to make room for anything.
      label: "Elite",
      price: "$500",
      period: "per month",
      // With no confirm button, the ROW is where the commitment gets disclosed, which is also what the stores require
      // before a purchase.
      note: "Billed monthly, cancel anytime",
    },
    {
      id: "lite",
      // VERIFIED against the RevenueCat dashboard: "TAILZU_MONT" is exact.
      productId: "TAILZU_MONT",
      offeringId: "default",
      packageId: "$rc_monthly",
      label: "Lite",
      price: "$50",
      period: "per month",
      note: "Billed monthly, cancel anytime",
      // Where most people start: chosen when the paywall opens.
      default: true,
    },
  ],
  /**
   * NOT DRAWN, and required by the type rather than by the screen.
   *
   * This paywall has no confirm button: tapping a plan row IS the purchase,
   * which is why each row carries its own commitment line. There is no free
   * trial: the free plan's allowance is the trial.
   */
  cta: "Choose a plan",
  restoreLabel: "Restore purchases",
  footnote:
    "Auto-renews unless canceled 24h before period end. Manage in Settings.",
  terms: POLICY.terms,
  privacy: POLICY.privacy,
  dismissible: true,
  dismissLabel: "Not now",
  // The RevenueCat entitlement IDENTIFIER (case/space-sensitive). The app calls
  // hasEntitlement(this). Per the RevenueCat dashboard the Identifier is
  // "TAILZU AIR" — "ON AIR" is only the Display Name, which the SDK does NOT
  // match on. Products x0_elite_monthly (Elite) + TAILZU_MONT (Lite) are attached
  // to this entitlement (and tailzu_annu, the yearly plan no longer sold, for
  // those still on it), so once a purchase completes the app unlocks.
  entitlement: "TAILZU AIR",
};

/**
 * "paywall" SDUI screen. Renders a scrollable page:
 *   [close] [hero media Slideshow]
 *   [title / subtitle]
 *   [feature bullets]
 *   [plan cards row]
 *   [primary CTA sticky-ish at the bottom]
 *   [restore + terms + privacy]
 *
 * Selection state lives in `state.selectedPlanId`. CTA action tree branches
 * on that value to fire the right iap.showPaywall (offering+package) or
 * iap.subscribe (product).
 */
export function paywallScreen(
  isDesktop = false,
  live?: { store?: string; expiresAt?: string; renews?: boolean } | null,
  // Where a purchase lands: the phone's Stats, or the desk's Today.
  landing: ActionSpec = { kind: "navigate", screenId: "stats" },
): ScreenResponse {
  // NOBODY IS SOLD SOMETHING THEY HAVE ALREADY BOUGHT.
  //
  // This screen sold to everyone who reached it, and one account reaches a
  // phone, another phone and a window — so a subscriber who opened it saw
  // plans, prices and a buy button for the thing they were already paying
  // for. Every guard in the clients exists because of that: the refusal, the
  // alert, the sentence about which store it lives on. All of it is the cost
  // of a sales page that should not have been drawn.
  //
  // The subscription belongs to the account, so this is what an account that
  // has one looks like. Nothing to choose, nothing to refuse, and the store
  // named exactly once — in the one place somebody would look for it, which
  // is when they want to stop or change it.
  if (live) return subscribedScreen(live.store, live.expiresAt, live.renews);
  const cfg = PAYWALL_CONFIG;
  const pw = PAYWALL_UI;
  const dk = pw.desktop;
  /**
   * WHICH END OF THE SCREEN THE PLANS SIT AT, and therefore which end the
   * scrim darkens. The two cannot be set separately: a scrim that falls away
   * at the bottom under rows pinned to the top is rows on bare art, and the
   * pairing is the only thing keeping them readable over an upload nobody has
   * seen yet.
   */
  const atTop = pw.plansAt === "top";
  // A window reads the same decision on the other axis — see PAYWALL_UI.desktop.
  const atLeft = dk.align === "left";
  const scrimStops = isDesktop
    ? (atLeft ? dk.scrim : [...dk.scrim].reverse())
    : (atTop ? [...pw.scrim].reverse() : pw.scrim);
  const scrimAt = isDesktop
    ? (atLeft ? dk.scrimStops : [...dk.scrimStops].reverse().map((v) => 1 - v))
    : (atTop ? [...pw.scrimStops].reverse().map((v) => 1 - v) : pw.scrimStops);
  // The cards that can actually be bought. A `free` plan is a card and nothing
  // else: no purchase action is built for it, the CTA chain never dispatches to
  // it, and it can never become the fallback — a CTA aimed at a plan with no
  // product id is a button that fails in front of the user, every time.
  const sellable = cfg.plans.filter((p) => !p.free);
  const defaultPlan = sellable.find((p) => p.default) ?? sellable[0];

  // One action per plan — the CTA references the currently-selected one
  // via a `condition` chain.
  const planActions: Record<string, ActionRef> = {};
  sellable.forEach((plan) => {
    planActions[`buy.${plan.id}`] = {
      kind: "sequence",
      actions: [
        { kind: "haptic", style: "medium" },
        plan.offeringId
          ? {
              kind: "iap.showPaywall",
              offeringId: plan.offeringId,
              packageId: plan.packageId,
              onSuccess: "unlocked",
              onError: "purchaseFailed",
            }
          : {
              kind: "iap.subscribe",
              productId: plan.productId ?? plan.id,
              onSuccess: "unlocked",
              onError: "purchaseFailed",
            },
      ],
    };
  });

  // CTA chain: check selectedPlanId, dispatch to matching buy.* action.
  const ctaCondition: ActionRef = sellable.reduceRight<ActionRef>(
    (acc, plan) => ({
      kind: "condition",
      if: { eq: ["selectedPlanId", plan.id] },
      then: `buy.${plan.id}`,
      else: acc,
    }),
    `buy.${defaultPlan.id}`,
  );

  const actions: Record<string, ActionSpec> = {
    ...(planActions as Record<string, ActionSpec>),
    cta: ctaCondition as ActionSpec,
    unlocked: {
      kind: "sequence",
      actions: [
        { kind: "haptic", style: "success" },
        { kind: "toast", message: "You're in.", tone: "success" },
        landing,
      ],
    },
    purchaseFailed: {
      kind: "toast",
      message: "Couldn't complete purchase.",
      tone: "error",
    },
    restore: {
      kind: "sequence",
      actions: [
        { kind: "iap.restore", onSuccess: "restoreDone" },
      ],
    },
    restoreDone: {
      kind: "toast",
      message: "Purchases restored.",
      tone: "success",
    },
    dismiss: { kind: "navigateBack" },
    openTerms: { kind: "openUrl", url: cfg.terms ?? POLICY.terms, external: true },
    openPrivacy: { kind: "openUrl", url: cfg.privacy ?? POLICY.privacy, external: true },
  };

  // heroFrames is gone with the slideshow it fed. The pitch is one piece of
  // art in the `paywall` media slot now, behind everything, rather than a
  // carousel above a wall of copy that no longer exists.

  /**
   * A PLAN IS A BUTTON. There is no confirm step.
   *
   * Choosing and buying were two acts, and with the benefit list gone the
   * second one carried no new information — it asked the same question again.
   * The row commits, so the row is also where the terms are stated, which is
   * what the stores require before a purchase rather than after.
   */
  const planRow = (plan: PaywallPlan): Node => ({
    type: "Stack",
    on: { onPress: plan.free ? "dismiss" : `buy.${plan.id}` },
    props: {
      pressOpacity: 0.82,
      // NO BORDER UNTIL A FINGER IS ON IT.
      //
      // Every row here is selectable, so a border on all of them says nothing
      // about which one is being chosen — it is just the loudest thing a row
      // can wear, worn by everything. Drawn on press, it says exactly that and
      // nothing the rest of the time.
      pressBorderColor: plan.free ? "rgba(255,255,255,0.28)" : "#F3E2C6",
      pressBorderWidth: 1,
    },
    style: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderRadius: 16,
      paddingVertical: 13,
      paddingHorizontal: 15,
      marginBottom: 8,
      // The paid rows are the way through, so they carry a warm pale-ink
      // fill — quiet, and still set apart from the free row. Not amber:
      // amber is for what is live, and a price is not.
      backgroundColor: plan.free ? "rgba(255,255,255,0.05)" : "rgba(243,226,198,0.08)",
    },
    children: [
      {
        type: "Stack",
        style: { flex: 1 },
        children: [
          { type: "Text", props: { content: plan.label },
            style: { fontSize: 15, fontWeight: "500", color: "#FFFFFF" } },
          ...(plan.note
            ? [{ type: "Text", props: { content: plan.note },
                 style: { fontSize: 11, color: "rgba(255,255,255,0.52)", marginTop: 1 } } as Node]
            : []),
        ],
      },
      ...(plan.price
        ? [{
            type: "Stack",
            style: { alignItems: "flex-end" },
            children: [
              // The store's own price once it answers (in the person's currency); these words until then.
              { type: "Text", props: { content: plan.price, ...storePriceOf(plan) },
                style: { fontSize: 15, fontWeight: "600", color: "#FFFFFF" } },
              ...(plan.period
                ? [{ type: "Text", props: { content: plan.period, ...storePriceOf(plan, plan.periodTemplate) },
                     style: { fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 1 } } as Node]
                : []),
            ],
          } as Node]
        : []),
      // The arrow. It is what says a row goes somewhere rather than selects.
      {
        type: "Stack",
        style: {
          width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center",
          backgroundColor: plan.free ? "rgba(255,255,255,0.10)" : "#F3E2C6",
        },
        children: [{
          type: "SVG",
          props: {
            viewBox: "0 0 24 24", d: "M9 5 L16 12 L9 19", fill: "none",
            // The ground's ink on the pale circle.
            stroke: plan.free ? "rgba(255,255,255,0.6)" : "#0B0B0D", strokeWidth: 2.6,
          },
          style: { width: 11, height: 11 },
        }],
      },
    ],
  });

  const tiny = (label: string, action: ActionRef): Node => ({
    type: "Stack",
    on: { onPress: action },
    style: { paddingHorizontal: 7, paddingVertical: 4 },
    children: [{ type: "Text", props: { content: label },
      style: { fontSize: 9.5, color: "rgba(255,255,255,0.34)" } }],
  });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "paywall",
    title: "",
    // Full bleed. The paywall owns the window — no header, no tabs.
    hideChrome: true,
    state: { selectedPlanId: defaultPlan.id },
    actions,
    root: {
      type: "Stack",
      style: { flex: 1, backgroundColor: "#000000" },
      children: [
        // The pitch. With the headline and the benefit list gone, the art is
        // the whole argument — so it is not painted over until something has
        // to be read.
        ...screenHero("paywall", {
          behind: true, fit: "cover",
          desktop: isDesktop,
          // Until something is uploaded, the wordmark decoding itself out of
          // binary. The product's claim is that it turns raw noise into
          // finished words; this is that claim made literal at the moment the
          // user is deciding whether to believe it — and it is what keeps this
          // screen from being plain black on a fresh install.
          builtIn: {
            type: "BinaryReveal",
            props: {
              text: "X0 Bot",
              color: THEME.color.primary,
              background: "#000000",
              flipMs: 36,
              lockMs: 70,
              scrambleMs: 620,
              holdMs: 2200,
              fontSize: 46,
            },
            fallback: {
              type: "Heading",
              props: { content: "X0 Bot" },
              style: { fontSize: 46, fontWeight: "800", color: THEME.color.primary },
            },
          },
        }),
        {
          type: "Gradient",
          props: {
            colors: scrimStops, locations: scrimAt,
            direction: isDesktop ? "horizontal" : "vertical",
          },
          style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
        },
        ...(cfg.dismissible
          ? [{
              type: "Stack",
              on: { onPress: "dismiss" },
              style: {
                position: "absolute", top: 56, right: 16, width: 32, height: 32,
                borderRadius: 16, backgroundColor: "rgba(255,255,255,0.12)",
                alignItems: "center", justifyContent: "center",
              },
              children: [{
                type: "SVG",
                props: { viewBox: "0 0 24 24", d: "M6 6 L18 18 M18 6 L6 18",
                         fill: "none", stroke: "#FFFFFF", strokeWidth: 2.4 },
                style: { width: 12, height: 12 },
              }],
            } as Node]
          : []),
        {
          type: "Stack",
          style: isDesktop
            ? {
                // A COLUMN, PLACED BY ITS OWN CENTRE. One number from
                // `column` positions it whatever the window is doing, the same
                // way the sign-in form is placed on its art.
                flex: 1,
                justifyContent: "center",
                // STRETCH, not the side it is on. The column is already placed
                // by its margin; aligning its contents to one edge as well
                // left every plan row as wide as its own text, so the three of
                // them had three different widths and none of them the
                // column's. Where the column sits is the margin's job; how
                // wide a row is inside it is this one's.
                alignItems: "stretch",
                paddingHorizontal: 0,
                // Left and right both set, because a percentage margin on one
                // side leaves the other free to stretch the column wider than
                // it asked to be.
                marginLeft: atLeft ? `calc(${dk.column * 100}% - ${dk.columnWidth / 2}px)` : 0,
                marginRight: atLeft ? 0 : `calc(${(1 - dk.column) * 100}% - ${dk.columnWidth / 2}px)`,
                maxWidth: dk.columnWidth,
                width: dk.columnWidth,
              }
            : {
                flex: 1,
                justifyContent: atTop ? "flex-start" : "flex-end",
                paddingHorizontal: pw.paddingHorizontal,
                paddingTop: atTop ? pw.paddingTop : 0,
                paddingBottom: atTop ? 0 : pw.paddingBottom,
              },
          children: [
            // Not a headline — a label on what is being bought.
            { type: "Text", props: { content: cfg.title ? "X0 Unlimited" : "" },
              style: { fontSize: 9, letterSpacing: 3, textTransform: "uppercase",
                       color: "rgba(255,255,255,0.5)", textAlign: "center", marginBottom: 14 } },
            // PAID FIRST. The free row is the way out, and a way out listed
            // above the offer reads as the recommendation.
            ...[...cfg.plans].sort((a, b) => Number(!!a.free) - Number(!!b.free))
              .map((plan) => planRow(
                plan.free
                  ? { ...plan, note: plan.note || `${freeMonthlyWords().toLocaleString()} words a month` }
                  : plan,
              )),
            // THE AUTO-RENEWAL DISCLOSURE, which was written and never drawn.
            //
            // It sat in PAYWALL_CONFIG.footnote and nothing rendered it, so
            // the screen where the purchase happens never said the thing both
            // stores require it to say: that this renews by itself until it is
            // cancelled. The rows carry the price and the period; this is the
            // sentence that turns those into terms.
            //
            // It goes ABOVE the restore/terms/privacy row rather than below
            // it, because it is a condition of the thing just above it and not
            // a piece of chrome at the foot of the screen.
            ...(cfg.footnote
              ? [{
                  type: "Text",
                  props: { content: cfg.footnote, variant: "caption" },
                  style: {
                    textAlign: "center", marginTop: 12,
                    paddingHorizontal: 8, color: pw.footnoteColor,
                  },
                } as Node]
              : []),
            {
              type: "Stack",
              style: { flexDirection: "row", justifyContent: "center", marginTop: 8 },
              children: [
                tiny(cfg.restoreLabel ?? "Restore", "restore"),
                tiny("Terms", "openTerms"),
                tiny("Privacy", "openPrivacy"),
              ],
            },
          ],
        },
      ],
    },
    cacheTtlSeconds: 300,
  };
}
