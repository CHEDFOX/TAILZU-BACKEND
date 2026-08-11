/**
 * Experience service — the screen catalog.
 *
 * This is where the backend "owns the UI". Each screen is built as data (a tree
 * of SDUI Nodes) and handed to the generic renderer in the app. Change these
 * builders → the app changes, with no client rebuild.
 *
 * See ../../../shared/types/sdui.ts for the contract.
 */
import type {
  ActionRef,
  ActionSpec,
  BootstrapResponse,
  KeyboardActionSpec,
  KeyboardConfigResponse,
  KeyboardNode,
  NavigationShell,
  Node,
  ScreenResponse,
  ThemeTokens,
} from "../../../shared/types/sdui.js";
import { SDUI_SCHEMA_VERSION } from "../../../shared/types/sdui.js";
import type { HistoryEntry, PaywallConfig, PaywallPlan, Personality, StatsResponse, UsageSummary } from "../../../shared/types/api.js";
import {
  PERSONALITY_PRESETS,
  findPreset,
  TONE_LABELS,
  MAX_PINNED_PRESETS,
  applyPresetOverrides,
} from "./personalityPresets.js";

/**
 * Optional accessor into the media registry — set at boot by server.ts so the
 * catalog can surface uploaded media URLs into the keyboard config without a
 * circular import. Signature matches routes/media.ts getMediaRegistry().
 */
type MediaEntry = { url: string; contentType: string; size: number; uploadedAt: number };
let getMediaRegistryFn: (() => Record<string, MediaEntry>) | null = null;
export function setMediaRegistryAccessor(fn: () => Record<string, MediaEntry>): void {
  getMediaRegistryFn = fn;
}

// --- Global theme -----------------------------------------------------------

export const THEME: ThemeTokens = {
  color: {
    bg: "#000000",
    surface: "#000000",
    card: "#0b0b0f",
    inputBg: "#0e0e12",
    border: "rgba(255,255,255,0.10)",
    // WHITE primary — matches the original Plutto-style design (black
    // surface with white primary CTAs). The brand accent (used for key
    // press flashes, refined-text word highlight, mic recording state)
    // is the warm amber sampled from mic.animation — not a punchy
    // pure orange. See ACCENT_AMBER below.
    primary: "#FFFFFF",
    text: "rgba(255,255,255,0.96)",
    body: "rgba(255,255,255,0.74)",
    muted: "rgba(255,255,255,0.55)",
    label: "rgba(255,255,255,0.42)",
    danger: "#e0556b",
    success: "#4caf50",
  },
  // Plutto-style scale: airy, editorial.
  space: { xs: 4, sm: 8, md: 12, lg: 18, xl: 26, content: 24, contentTop: 34 },
  radius: { sm: 8, md: 14, card: 18, pill: 999 },
  font: {
    // Headings render in a serif (set per-platform in the renderer); body is sans.
    sizes: { overline: 11, caption: 12, label: 13, body: 15, lg: 18, h1: 24, brand: 30 },
    weights: { light: "300", regular: "400", medium: "500", bold: "700", heavy: "800" },
  },
};

/**
 * Flow Session idle window (ms) — how long the app keeps the background mic
 * warm after the last dictation. ONE constant serves every surface (bootstrap
 * flags, keyboard config, flow_arm screen's armFlowSession action): the same
 * key used to ship 10 min in bootstrap but 5 min in the keyboard config, so
 * app and keyboard disagreed on session lifetime.
 */
const FLOW_IDLE_TIMEOUT_MS = 600_000;

const NAV: NavigationShell = {
  kind: "tabs",
  // Settings is no longer a bottom tab — it's reached via the ⚙ gear in the
  // top-right of the header (client renders it on the tab roots). The settings
  // screen itself still exists at screenId "settings" and is pushed on tap.
  tabs: [
    { id: "home", title: "Home", screenId: "home" },
    { id: "personality", title: "You", screenId: "personality" },
  ],
};

// --- Small Node helpers (keep builders readable) ----------------------------

const text = (content: string, variant = "body", extra: Partial<Node> = {}): Node => ({
  type: "Text",
  props: { content, variant },
  ...extra,
});

const spacer = (height: number): Node => ({ type: "Spacer", style: { height } });

// --- Cache version ----------------------------------------------------------
//
// Opaque token that increments whenever the server catalog changes in a way
// clients should re-fetch. Sent in every bootstrap response as `cacheVersion`;
// clients compare against the value they've stored and drop any locally
// cached screens when it differs. Also bumped on process restart so a code
// deploy invalidates every client on their next bootstrap.

let CACHE_VERSION = `${Date.now().toString(36)}.${Math.floor(Math.random() * 0xffff).toString(36)}`;

/** The current cache-version token clients should compare against. */
export function currentCacheVersion(): string {
  return CACHE_VERSION;
}

/**
 * Bump the token — the next bootstrap every client fetches will carry the new
 * value and any cached screens on the client will be discarded. Called by the
 * admin endpoint (`POST /v1/admin/cache/bump`) and automatically at boot.
 */
export function bumpCacheVersion(): string {
  CACHE_VERSION = `${Date.now().toString(36)}.${Math.floor(Math.random() * 0xffff).toString(36)}`;
  return CACHE_VERSION;
}

// --- Bootstrap --------------------------------------------------------------

export function buildBootstrap(opts: { onboarded?: boolean } = {}): BootstrapResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    // Opaque cache token — clients invalidate any cached screens when this
    // changes. Bumps on every process restart plus any admin-triggered bump.
    cacheVersion: CACHE_VERSION,
    theme: THEME,
    navigation: NAV,
    // The server owns onboarding AND the intro. Intro plays whenever all 4
    // frames are uploaded to the media store; falls through to onboarding /
    // home when they're not, so we never render an intro screen with
    // missing images.
    initialScreenId: pickInitialScreenId(!!opts.onboarded),
    flags: ((): BootstrapResponse["flags"] => {
      const flags: BootstrapResponse["flags"] = {
        // Policy URLs — Settings screen links open these in-browser.
        // Served from tailzu.space (proxied to the backend by Caddy — see
        // deploy/Caddyfile) so the URL a user copies from the address bar looks
        // like a real domain rather than an internal api. host. Same content
        // either way.
        "policy.privacy.url": "https://tailzu.space/privacy",
        "policy.terms.url": "https://tailzu.space/terms",
        "support.url": "mailto:support@tailzu.space",

        // Post-splash intro — max duration + background. `intro.media` is
        // spliced in below from whatever's under the "intro" key in the media
        // registry, so uploading is the entire "swap the intro animation"
        // operation. Absent → client skips the intro entirely.
        "intro.maxDurationMs": 4500,
        "intro.background": THEME.color.bg,
        "intro.showEveryLaunch": false,

        // Paywall gating. When `paywall.entitlement` is set, the client checks
        // RevenueCat for that entitlement on boot; when the user does NOT
        // have it and `paywall.blockUntilEntitled` is true, the client
        // navigates to the "paywall" screen after onboarding. `paywall.config`
        // is the whole PaywallConfig so clients can pre-warm plan copy without
        // a separate fetch.
        "paywall.entitlement": PAYWALL_CONFIG.entitlement ?? "pro",
        "paywall.blockUntilEntitled": false,
        // DISABLED for now: the paywall was auto-showing on every open (user
        // lacks `pro`) and its purchase fails with "could not complete purchase"
        // because the App Store IAP products aren't purchasable yet (not
        // "Ready to Submit" / Paid Apps Agreement / sandbox tester). That blocked
        // the mic-flow testing. Re-enable (true) once the IAP products are live in
        // App Store Connect + RevenueCat so a purchase actually completes. The
        // paywall screen itself still exists and can be opened manually.
        "paywall.showAfterOnboarding": false,
        "paywall.config": PAYWALL_CONFIG as unknown as Record<string, unknown>,

        // The "Hello, name + gender" profile card shows as an overlay on these
        // screen ids. It's placed on the "personality" (You) tab — so right
        // after the activation screen lands the user on You, the card is the
        // first thing they complete there. (Client default is ["home"]; this
        // moves it to You.)
        "profileGate.screenIds": ["personality"],

        // Flow Session warm-keeping (iOS). When true, the app re-arms the
        // background mic on every foreground so the keyboard dictates WITHOUT
        // reopening the app (the Wispr Flow feel). DISABLED for now: on a build
        // without the "don't publish a live session when the engine failed to
        // start" fix, a failed arm-on-foreground leaves a false-active session
        // that makes every mic tap animate into a dead mic. Re-enable once a
        // build with that arm() hardening ships. Costs background mic time
        // (indicator + battery) either way.
        "kb.flow.armOnForeground": true,
        "kb.flow.idleTimeoutMs": FLOW_IDLE_TIMEOUT_MS,
      };

      const reg = getMediaRegistryFn?.() ?? {};
      const intro = reg["intro"];
      if (intro?.url && flags) {
        flags["intro.media"] = { url: intro.url };
      }

      return flags;
    })(),
    // Central copy — every screen can reference these with "@key".
    labels: {
      "app.name": "Tailzu",
      "settings.privacyPolicy": "Privacy Policy",
      "settings.termsOfService": "Terms of Service",
      "settings.support": "Contact Support",
      "onboarding.title": "Welcome To Tailzu",
      "onboarding.subtitle": "Speak Or Type Rough — Tailzu Makes It Sound Like You.",
      "onboarding.cta": "Get Started",

      // Stats screen (see statsScreen). Kept as label refs so localisation
      // controls copy without redeploying the backend.
      "stats.title": "Your usage",
      "stats.hero.subtitle": "This month, in your voice",
      "stats.kv.weekWords": "Words this week",
      "stats.kv.audio": "Audio dictated",
      "stats.kv.saved": "Minutes saved",
      "stats.effort.template":
        "Your effort: you'd have spent {minutes} minutes typing what Tulmi cleaned up in seconds.",
      "stats.sparkline.label": "Requests, last 30 days",
      "stats.cta.history": "See history",

      // History screen (see historyScreen).
      "history.title": "History",
      "history.subtitle":
        "Every cleanup you've kept, newest first. Tap for details, long-press to remove.",
      "history.empty":
        "No history yet. Turn on 'Keep history' in your personality to start collecting your cleanups.",
      "history.detail.toast": "Detail view coming soon",
      "history.delete.error": "Couldn't reach history. Try again.",
    },
    languages: [
      { code: "en", name: "English", greeting: "Hello", regions: ["US","GB","CA","AU","IN"] },
      { code: "hi", name: "हिन्दी", greeting: "नमस्ते", regions: ["IN"] },
      { code: "es", name: "Español", greeting: "Hola", regions: ["ES","MX","AR"] },
      { code: "fr", name: "Français", greeting: "Bonjour", regions: ["FR","CA"] },
      { code: "ar", name: "العربية", greeting: "مرحبا", regions: ["AE","SA","EG"] },
      { code: "pt", name: "Português", greeting: "Olá", regions: ["PT","BR"] },
      { code: "de", name: "Deutsch", greeting: "Hallo", regions: ["DE"] },
      { code: "it", name: "Italiano", greeting: "Ciao", regions: ["IT"] },
      { code: "ru", name: "Русский", greeting: "Привет", regions: ["RU"] },
      { code: "ja", name: "日本語", greeting: "こんにちは", regions: ["JP"] },
      { code: "ko", name: "한국어", greeting: "안녕하세요", regions: ["KR"] },
      { code: "zh", name: "中文", greeting: "你好", regions: ["CN"] },
      { code: "bn", name: "বাংলা", greeting: "নমস্কার", regions: ["BD","IN"] },
      { code: "ta", name: "தமிழ்", greeting: "வணக்கம்", regions: ["IN","LK"] },
      { code: "te", name: "తెలుగు", greeting: "నమస్కారం", regions: ["IN"] },
      { code: "mr", name: "मराठी", greeting: "नमस्कार", regions: ["IN"] },
      { code: "gu", name: "ગુજરાતી", greeting: "નમસ્તે", regions: ["IN"] },
      { code: "pa", name: "ਪੰਜਾਬੀ", greeting: "ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ", regions: ["IN"] },
      { code: "ur", name: "اردو", greeting: "السلام علیکم", regions: ["PK","IN"] },
      { code: "tr", name: "Türkçe", greeting: "Merhaba", regions: ["TR"] },
      { code: "id", name: "Indonesia", greeting: "Halo", regions: ["ID"] },
      { code: "vi", name: "Tiếng Việt", greeting: "Xin chào", regions: ["VN"] },
      { code: "th", name: "ไทย", greeting: "สวัสดี", regions: ["TH"] },
      { code: "nl", name: "Nederlands", greeting: "Hallo", regions: ["NL"] },
    ],
    // Version gate (dormant: thresholds are at/below the shipped app version, so
    // it won't fire — flip these to force/suggest an update from the server).
    update: {
      minVersion: "0.5.0",
      latestVersion: "1.0.0",
      title: "Update Tulmi",
      message: "A newer version of Tulmi is available with the latest improvements.",
      cta: "Update now",
      url: {
        android: "https://play.google.com/store/apps/details?id=com.tulmi.app",
        ios: "https://apps.apple.com/app/id000000000",
        default: "https://github.com/CHEDFOX/tulmi",
      },
    },
    cacheTtlSeconds: 300,
  };
}

// --- Screens ----------------------------------------------------------------

/**
 * Which screen the app opens on. Runs at bootstrap time so its output is
 * baked into the response the client uses.
 *
 * Onboarding is now a SINGLE activation screen (see onboardingWelcome) — the
 * old intro montage + welcome + language + keyboard-enable sequence collapsed
 * into one. So the routing is simply:
 *   - Not-onboarded → onboarding (the activation screen).
 *   - Otherwise → home.
 * (The separate client-side language greeting still runs before this when the
 * needsLanguagePick flag is set — that's independent of this decision.)
 */
function pickInitialScreenId(onboarded: boolean): string {
  return onboarded ? "home" : "onboarding";
}

/**
 * Post-splash intro — a pure SDUI screen. Renders a Slideshow of 5 media
 * frames from the media store (uploaded under intro.0 … intro.4). Frame 0
 * is the "black" hold; frames 1..4 are the wave-move animation. When the
 * slideshow finishes its single loop, its onComplete fires the `done`
 * action which navigates to the real initial screen.
 *
 * Everything about it — the frame count, frame durations, background,
 * transitions, what comes next — is authored here. Zero client code
 * touches the intro path.
 *
 * To customize:
 *   - Swap the 5 frames: POST /v1/media/upload?key=intro.0 (etc.)
 *   - Change speed: edit `frameMs` below
 *   - Change how many loops: edit `loops`
 *   - Change what happens after: edit `done` action's screenId
 *   - Add text overlay / brand mark on top: add sibling nodes to the
 *     Screen's children (Slideshow is styled `position: absolute; inset: 0`
 *     so overlays sit above it naturally).
 */
function introScreen(ctx: ScreenContext): ScreenResponse {
  // Route the post-intro destination the SAME way pickInitialScreenId would when
  // the intro is NOT playing — so a brand-new (not-onboarded) user goes through
  // onboarding instead of being dropped straight on home (which skipped language
  // pick + keyboard-enable and never set onboarded=true → intro replayed forever).
  const next = ctx.onboarded ? "home" : "onboarding";
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "intro",
    title: "",
    // hideChrome removes header + tab bar so the Slideshow fills the whole
    // window — critical for the intro to feel like a splash-adjacent
    // cinematic instead of "media inside the app's content area."
    hideChrome: true,
    state: {},
    actions: {
      done: { kind: "navigate", screenId: next },
    },
    // Root is a flex View (Stack, not the ScrollView-based Screen). The
    // Slideshow gets width:100% + height:100% + flex:1 so it stretches to
    // fill the parent — which is now the whole window because chrome is
    // hidden.
    root: {
      type: "Stack",
      style: {
        flex: 1,
        width: "100%",
        height: "100%",
        backgroundColor: "#000000",
        // Center the small media in the middle of the black window.
        alignItems: "center",
        justifyContent: "center",
      },
      children: [
        {
          type: "Slideshow",
          // Small, centered media on the black backdrop — NOT full-bleed. The
          // black Stack shows around it. Size is backend-tunable here (OTA).
          style: {
            width: 200,
            height: 200,
          },
          props: {
            frames: [
              { key: "intro.1" },
              { key: "intro.2" },
              { key: "intro.3" },
              { key: "intro.4" },
              { key: "intro.0" },
            ],
            frameMs: 120,      // high-speed montage feel
            loops: 1,          // one cycle then done
            // contain (not cover) so the small box never crops the media.
            contentFit: "contain",
          },
          on: { onComplete: "done" },
          // A bundle that predates Slideshow would otherwise render nothing here
          // AND (with hideChrome) have no header/tabs — a blank, navigationally
          // stuck screen, because forward navigation depends entirely on the
          // Slideshow's onComplete. The fallback shows the first frame with a
          // tappable "Get started" that routes to `done` (→ home) so the user
          // is never trapped.
          fallback: {
            type: "Stack",
            style: { flex: 1, width: "100%", height: "100%", backgroundColor: "#000000", alignItems: "center", justifyContent: "center" },
            children: [
              { type: "Image", props: { source: { key: "intro.1" }, contentFit: "contain" }, style: { width: 200, height: 200 } },
              { type: "Button", props: { label: "Get started", variant: "primary" }, on: { onPress: "done" }, style: { position: "absolute", bottom: 56 } },
            ],
          },
        },
      ],
    },
    cacheTtlSeconds: 60,
  };
}

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

export const PAYWALL_CONFIG: PaywallConfig = {
  heroFrames: [
    { key: "paywall.1" },
    { key: "paywall.2" },
    { key: "paywall.3" },
  ],
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
      id: "annual",
      // VERIFIED against the RevenueCat dashboard (entitlement "TAILZU AIR",
      // Associated products): "tailzu_annu" is the exact full identifier.
      productId: "tailzu_annu",
      offeringId: "default",
      packageId: "$rc_annual",
      label: "Elite",
      price: "$59.99",
      period: "per year",
      perUnit: "$5.00/mo, billed annually",
      badge: "Save 50%",
      default: true,
    },
    {
      id: "monthly",
      // VERIFIED against the RevenueCat dashboard: "TAILZU_MONT" is exact.
      productId: "TAILZU_MONT",
      offeringId: "default",
      packageId: "$rc_monthly",
      label: "Lite",
      price: "$9.99",
      period: "per month",
    },
  ],
  cta: "Start free trial",
  restoreLabel: "Restore purchases",
  footnote:
    "Auto-renews unless canceled 24h before period end. Manage in Settings.",
  terms: "https://tailzu.space/terms",
  privacy: "https://tailzu.space/privacy",
  dismissible: true,
  dismissLabel: "Not now",
  // The RevenueCat entitlement IDENTIFIER (case/space-sensitive). The app calls
  // hasEntitlement(this). Per the RevenueCat dashboard the Identifier is
  // "TAILZU AIR" — "ON AIR" is only the Display Name, which the SDK does NOT
  // match on. Products tailzu_annu (Elite) + TAILZU_MONT (Lite) are attached to
  // this entitlement, so once a purchase completes the app unlocks.
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
function paywallScreen(): ScreenResponse {
  const cfg = PAYWALL_CONFIG;
  const defaultPlan = cfg.plans.find((p) => p.default) ?? cfg.plans[0];

  // One action per plan — the CTA references the currently-selected one
  // via a `condition` chain.
  const planActions: Record<string, ActionRef> = {};
  cfg.plans.forEach((plan) => {
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
  const ctaCondition: ActionRef = cfg.plans.reduceRight<ActionRef>(
    (acc, plan) => ({
      kind: "condition",
      if: { eq: ["state.selectedPlanId", plan.id] },
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
        { kind: "navigate", screenId: "home" },
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
    openTerms: { kind: "openUrl", url: cfg.terms ?? "https://tailzu.space/terms", external: true },
    openPrivacy: { kind: "openUrl", url: cfg.privacy ?? "https://tailzu.space/privacy", external: true },
  };

  const heroValid = (cfg.heroFrames ?? []).filter(
    (f) => f.key || f.url || f.asset,
  );

  const planCard = (plan: PaywallPlan): Node => ({
    type: "Card",
    style: {
      flex: 1,
      padding: 14,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: {
        eq: ["selectedPlanId", plan.id],
        then: plan.accent ?? THEME.color.primary,
        else: THEME.color.border,
      } as unknown as string,
      backgroundColor: {
        eq: ["selectedPlanId", plan.id],
        then: "rgba(255,255,255,0.06)",
        else: "transparent",
      } as unknown as string,
      minHeight: 118,
    },
    on: {
      onPress: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "selection" },
          { kind: "setState", path: "selectedPlanId", value: plan.id },
        ],
      },
    },
    children: [
      ...(plan.badge
        ? [
            {
              type: "Badge",
              props: { text: plan.badge, tone: "brand" },
              style: {
                alignSelf: "flex-start",
                backgroundColor: plan.accent ?? THEME.color.primary,
                color: "#000",
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 999,
                fontSize: 11,
                fontWeight: "700",
                marginBottom: 8,
              },
            } satisfies Node,
          ]
        : []),
      text(plan.label, "label", { style: { color: THEME.color.muted, fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase" } }),
      spacer(6),
      text(plan.price, "h1", { style: { color: THEME.color.text, fontSize: 22, fontWeight: "800" } }),
      ...(plan.period
        ? [text(plan.period, "caption", { style: { color: THEME.color.body, fontSize: 12, marginTop: 2 } })]
        : []),
      ...(plan.perUnit
        ? [text(plan.perUnit, "caption", { style: { color: THEME.color.muted, fontSize: 11, marginTop: 6 } })]
        : []),
    ],
  });

  const featureRow = (line: string): Node => ({
    type: "Stack",
    style: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 8 },
    children: [
      text("✓", "body", { style: { color: THEME.color.primary, fontWeight: "700", fontSize: 16, lineHeight: 22 } }),
      text(line, "body", { style: { color: THEME.color.body, fontSize: 14, flex: 1, lineHeight: 22 } }),
    ],
  });

  const children: Node[] = [];

  // Hero — Slideshow when 2+ frames, single MediaPlayer when 1.
  if (heroValid.length >= 2) {
    children.push({
      type: "Slideshow",
      style: { width: "100%", aspectRatio: 1.3, borderRadius: 20, overflow: "hidden", marginBottom: 20 },
      props: {
        frames: heroValid,
        frameMs: cfg.heroFrameMs ?? 2200,
        loops: cfg.heroLoops ?? 0,
        contentFit: "cover",
      },
    });
  } else if (heroValid.length === 1) {
    children.push({
      type: "Image",
      style: { width: "100%", aspectRatio: 1.3, borderRadius: 20, marginBottom: 20 },
      props: { source: heroValid[0].url, spec: heroValid[0] },
    });
  }

  children.push(
    text(cfg.title, "h1", {
      style: { fontSize: 28, fontWeight: "800", color: THEME.color.text, textAlign: "center", lineHeight: 34 },
    }),
  );

  if (cfg.subtitle) {
    children.push(
      spacer(10),
      text(cfg.subtitle, "body", {
        style: { fontSize: 15, color: THEME.color.body, textAlign: "center", lineHeight: 22 },
      }),
    );
  }

  if (cfg.features?.length) {
    children.push(spacer(22));
    children.push({
      type: "Stack",
      style: { paddingHorizontal: 8 },
      children: cfg.features.map(featureRow),
    });
  }

  children.push(spacer(20));
  children.push({
    type: "Stack",
    style: { flexDirection: "row", gap: 10 },
    children: cfg.plans.map(planCard),
  });

  children.push(spacer(22));
  children.push({
    type: "Button",
    props: { label: cfg.cta, variant: "primary" },
    style: { paddingVertical: 18 },
    on: { onPress: "cta" },
  });

  if (cfg.footnote) {
    children.push(
      spacer(10),
      text(cfg.footnote, "caption", {
        style: { fontSize: 11, color: THEME.color.muted, textAlign: "center", lineHeight: 16 },
      }),
    );
  }

  children.push(spacer(14));
  children.push({
    type: "Stack",
    style: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: 16 },
    children: [
      cfg.restoreLabel
        ? {
            type: "Button",
            props: { label: cfg.restoreLabel, variant: "ghost" },
            style: { paddingVertical: 8, paddingHorizontal: 4 },
            on: { onPress: "restore" },
          }
        : null,
      cfg.terms
        ? {
            type: "Button",
            props: { label: "Terms", variant: "ghost" },
            style: { paddingVertical: 8, paddingHorizontal: 4 },
            on: { onPress: "openTerms" },
          }
        : null,
      cfg.privacy
        ? {
            type: "Button",
            props: { label: "Privacy", variant: "ghost" },
            style: { paddingVertical: 8, paddingHorizontal: 4 },
            on: { onPress: "openPrivacy" },
          }
        : null,
    ].filter(Boolean) as Node[],
  });

  const root: Node = {
    type: "Screen",
    style: {
      backgroundColor: THEME.color.bg,
      padding: 20,
      paddingTop: 12,
      paddingBottom: 32,
    },
    children: [
      // Close row — visible only when dismissible.
      ...(cfg.dismissible !== false
        ? [
            {
              type: "Stack",
              style: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 6 },
              children: [
                {
                  type: "Button",
                  props: { label: cfg.dismissLabel ?? "Not now", variant: "ghost" },
                  style: { paddingVertical: 8, paddingHorizontal: 12 },
                  on: { onPress: "dismiss" },
                } satisfies Node,
              ],
            } satisfies Node,
          ]
        : []),
      ...children,
    ],
  };

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "paywall",
    title: "",
    state: { selectedPlanId: defaultPlan.id },
    actions,
    root,
    cacheTtlSeconds: 60,
  };
}

export interface ScreenContext {
  personality: Personality;
  language: string;
  email?: string;
  usage?: UsageSummary;
  /**
   * Optional per-user stats projection for the "stats" screen. Populated by
   * the screen route handler when it has been wired to fetch statsForUser();
   * when absent, the stats screen falls back to the numbers in `usage`.
   */
  stats?: StatsResponse;
  /** Pre-fetched history for the "history" screen (optional; the screen also
   * refetches via callEndpoint on mount for freshness). */
  history?: HistoryEntry[];
  name?: string;
  /** Whether the user has completed onboarding — routes the intro's `done`
   * action to onboarding (new user) vs home, so the intro never skips it. */
  onboarded?: boolean;
  dictionary?: Array<{ word: string; replacement: string }>;
  frequentWords?: string[];
  /** Deep-link / navigation params — e.g. keyboard_record receives
   * { session, host } from the keyboard extension's tulmi://s/... URL. */
  params?: Record<string, string | number | boolean | undefined>;
}

export function buildScreen(screenId: string, ctx: ScreenContext): ScreenResponse | null {
  switch (screenId) {
    case "home":
      return homeScreen(ctx);
    case "dictionary":
      return dictionaryScreen(ctx);
    case "language_select":
      return languageSelectScreen(ctx);
    case "delete_account":
      return deleteAccountScreen();
    case "reply":
      return replyScreen();
    case "personality":
      return personalityScreen();
    case "voices":
      return voicesScreen(ctx);
    case "tone_edit":
      return toneEditScreen(ctx);
    case "personality_customize":
      return personalityCustomizeScreen(ctx.personality);
    case "personality_edit":
      return personalityEditScreen(
        ctx.personality,
        typeof ctx.params?.presetId === "string" ? ctx.params.presetId : undefined,
      );
    case "personality_detail":
      return personalityDetailScreen(
        ctx.personality,
        typeof ctx.params?.presetId === "string" ? ctx.params.presetId : undefined,
      );
    case "settings":
      return settingsScreen(ctx);
    case "stats":
      return statsScreen(ctx);
    case "history":
      return historyScreen(ctx);
    case "onboarding":
      return onboardingWelcome();
    case "onboarding_language":
      return onboardingLanguage(ctx.language);
    case "onboarding_keyboard":
      return onboardingKeyboard();
    case "keyboard_record":
      return keyboardRecordScreen(ctx);
    case "keyboard_primer":
      return keyboardPrimerScreen(ctx);
    case "flow_arm":
      return flowArmScreen(ctx);
    case "intro":
      return introScreen(ctx);
    case "paywall":
      return paywallScreen();
    default:
      return null;
  }
}

/** Languages offered in onboarding + settings. */
const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: "auto", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "hinglish", label: "Hinglish" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "ar", label: "Arabic" },
  { value: "pt", label: "Portuguese" },
];

/** The refine playground — proves the full SDUI loop incl. a brain call. */
function homeScreen(ctx: ScreenContext): ScreenResponse {
  // fontSize 30 overflowed the Pager page width (peek:44 leaves ~screen-88 usable),
  // so long titles ("Reply in your voice") got clipped mid-word. 24 lets both
  // titles wrap to at most two lines; flexShrink lets them break cleanly.
  const titleStyle = {
    fontSize: 24,
    fontWeight: "800" as const,
    color: "$color.text",
    marginBottom: 20,
    flexShrink: 1,
    flexWrap: "wrap" as const,
  };
  // Pinning each page Stack to width:100% keeps titles measuring against the
  // page viewport, not the scroll content width — otherwise "Reply in your
  // voice" renders on one line and overflows past the right edge.
  const pageStyle = { paddingHorizontal: 24, paddingTop: 16, width: "100%" as const };

  // In-app mic media. Prefer an MP4 upload (mic.animation.mp4) when present —
  // MediaPlayer's video branch freezes it on-frame while paused AND reacts its
  // speed to the mic level (voiceReactive), so the in-app mic feels alive and
  // pauses cleanly. Fall back to the GIF (mic.animation) otherwise; a GIF can't
  // pause on a frame, so freezeOnPause stays false and VoiceToggle swaps to the
  // static mark between takes. The keyboard keeps reading mic.animation (the
  // GIF) — an MP4 can't render in its image-based key button.
  const micReg = getMediaRegistryFn?.() ?? {};
  const micHasMp4 = !!micReg["mic.animation.mp4"]?.url;
  const micIdle = micHasMp4
    ? { source: { key: "mic.animation.mp4" }, autoplay: false, loop: true, muted: true, voiceReactive: true, freezeOnPause: true }
    : { source: { key: "mic.animation" }, autoplay: false, loop: true, voiceReactive: true };

  // Home tone picker. Each row selects the tone the Refine button runs in — the
  // id maps 1:1 to the per-tone refine endpoints the client routes to
  // (/v1/refine/<id>; "none" → skip-refine). Authored here so the tone set can
  // be reordered/renamed/extended from the backend with no app update.
  const TONE_OPTIONS: Array<{ id: string; label: string; hint: string }> = [
    { id: "none", label: "Tone", hint: "Clean-up only — keep my words" },
    { id: "formal", label: "Formal", hint: "Polished and professional" },
    { id: "casual", label: "Casual", hint: "Relaxed and friendly" },
    { id: "very-casual", label: "Very casual", hint: "Loose, texting-with-friends" },
    { id: "excited", label: "Excited", hint: "Upbeat and energetic" },
  ];
  // A tappable tone row inside the blurred sheet: pick it → store the tone id +
  // its button label, then close the sheet. All state, so the Refine button
  // (bind.tone) picks it up on its next press.
  const toneRow = (opt: { id: string; label: string; hint: string }): Node => ({
    type: "Row",
    props: { label: opt.label, value: opt.hint, chevron: false, divider: opt.id !== "excited" },
    on: { onPress: { kind: "sequence", actions: [
      { kind: "haptic", style: "selection" },
      { kind: "setState", path: "tone", value: opt.id },
      { kind: "setState", path: "toneLabel", value: opt.label },
      { kind: "setState", path: "toneSheetOpen", value: false },
    ] } },
  });

  const boxWithVoice = (bindKey: string): Node => ({
    type: "Stack", style: { position: "relative" }, children: [
      { type: "TextField", bind: { value: bindKey }, props: { placeholder: "Type here…", multiline: true }, style: { paddingRight: 56, minHeight: 96 } },
      { type: "Stack", style: { position: "absolute", right: 12, top: 0, bottom: 0, justify: "center" }, children: [
        {
          type: "VoiceToggle",
          bind: { value: bindKey },
          props: {
            targetApp: "WhatsApp",
            language: "auto",
            size: 38,
            background: "#E8A23C",
            iconIdle: micIdle,
          },
          // micError echoes the real failure ($event) — a permission denial or
          // an audio-session error must NOT look like a generic "check your
          // connection" toast, or it's undebuggable in the field.
          on: { onError: "micError" },
          // Older bundles don't have VoiceToggle in their registry. VoiceButton
          // has shipped since the initial SDUI release, drives the same bind,
          // and reads state → mic → transcript → writes back. Same product
          // outcome, one-tap-record instead of press-and-hold.
          fallback: {
            type: "VoiceButton",
            bind: { value: bindKey },
            props: { targetApp: "WhatsApp", language: "auto" },
            on: { onError: "micError" },
          },
        },
      ] },
    ],
  });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "home",
    title: "",
    state: {
      input: "", screenContent: "", intent: "", result: "", recording: false,
      // Refine tone: which per-tone endpoint the Refine button targets. "none"
      // = clean-up only. `toneLabel` is the Tone button's caption; `toneSheetOpen`
      // drives the blurred tone-picker sheet.
      tone: "none", toneLabel: "Tone", toneSheetOpen: false,
      dictionary: ctx.dictionary ?? [],
      frequentWords: ctx.frequentWords ?? [],
    },
    actions: {
      err: { kind: "toast", message: "Something went wrong. Check your connection.", tone: "error" },
      // Echoes the real reason ($event) the mic control failed. The client's
      // toast action resolves $event to the message VoiceToggle fired, so
      // permission / audio-session / transcribe failures each show their own
      // cause instead of a single misleading generic string.
      micError: { kind: "toast", message: "$event", tone: "error" },
      openDictionary: { kind: "navigate", screenId: "dictionary" },
    },
    root: {
      type: "Screen",
      // Zero the Screen's default horizontal padding so the Pager renders
      // edge-to-edge (no black side strips). Non-pager sections wrap in a
      // padded inner Stack below.
      style: { paddingHorizontal: 0 },
      children: [
        // 1) Refine ⇄ Reply swipe (fixed-height pager inside the vertical scroll)
        // Pager is a modern (post-v1) component. Old bundles get the same two
        // panes stacked vertically via fallback — no swipe, but every screen
        // element remains reachable.
        {
          type: "Pager",
          props: { hint: true, peek: 44, height: 360 },
          children: [
            { type: "Stack", style: pageStyle, children: [
              { type: "Heading", props: { content: "Make it sound like you", numberOfLines: 2 }, style: titleStyle },
              boxWithVoice("input"),
              { type: "Spacer", style: { height: 22 } },
              // Refine + Tone. The whole action row hides while the mic is
              // recording (visibleIf falsy recording) and springs back when it
              // stops — so the button is out of the way during voice capture.
              { type: "Stack", visibleIf: { falsy: "recording" }, style: { align: "center", direction: "column", gap: 12 }, children: [
                {
                  type: "RefineButton",
                  // bind.value = the text to refine; bind.tone = the selected
                  // tone id → RefineButton routes to /v1/refine/<tone>. Press
                  // again to iterate on the box text in the same tone.
                  bind: { value: "input", tone: "tone" },
                  props: { targetApp: "WhatsApp", language: "auto", width: 160 },
                  on: { onError: "err" },
                  // Old-bundle fallback: plain Button that fires /v1/refine
                  // via the callEndpoint action (present since v1 CORE_ACTIONS).
                  // Result is written back into `input` so the user still sees
                  // the cleaned text where they typed.
                  fallback: {
                    type: "Button",
                    props: { label: "Refine", variant: "primary" },
                    // /v1/refine responds with { refinedText, usage } — assignTo
                    // would drop the whole object into state.input. Two-step:
                    // land the response in a private key, then setState pulls
                    // out refinedText via dot-path resolution.
                    on: { onPress: {
                      kind: "callEndpoint",
                      method: "POST",
                      path: "/v1/refine",
                      body: { text: "$state.input", targetApp: "WhatsApp", language: "auto" },
                      assignTo: "_refined",
                      onSuccess: { kind: "setState", path: "input", value: "$state._refined.refinedText" },
                      onError: "err",
                    } },
                  },
                },
                // Tone button — opens the blurred tone sheet. Its caption is the
                // active tone (bind label ← toneLabel); tap to change which tone
                // Refine runs in.
                {
                  type: "Button",
                  bind: { label: "toneLabel" },
                  props: { variant: "secondary" },
                  style: { paddingVertical: 10, paddingHorizontal: 22, borderRadius: 22 },
                  on: { onPress: { kind: "sequence", actions: [
                    { kind: "haptic", style: "light" },
                    { kind: "setState", path: "toneSheetOpen", value: true },
                  ] } },
                },
              ] },
              // Blurred tone-picker sheet. Everything behind the card frosts
              // (props.blur) while the user picks the tone Refine speaks in.
              {
                type: "Modal",
                bind: { open: "toneSheetOpen" },
                props: { blur: true, blurIntensity: 55, dismissable: true },
                children: [
                  { type: "Text", props: { content: "Refine in…" }, style: { fontSize: 18, fontWeight: "700", color: "#FFFFFF", textAlign: "center", marginBottom: 12 } },
                  ...TONE_OPTIONS.map(toneRow),
                ],
              },
            ] },
            { type: "Stack", style: pageStyle, children: [
              { type: "Heading", props: { content: "Reply in your voice", numberOfLines: 2 }, style: titleStyle },
              { type: "TextField", bind: { value: "screenContent" }, props: { placeholder: "Paste their message…", multiline: true }, style: { minHeight: 70 } },
              { type: "Spacer", style: { height: 14 } },
              boxWithVoice("intent"),
              { type: "Spacer", style: { height: 18 } },
              { type: "Stack", style: { align: "center" }, children: [
                {
                  type: "DraftButton",
                  bind: { value: "intent" },
                  props: { messageKey: "screenContent", resultKey: "result", width: 160 },
                  on: { onError: "err" },
                  // Old-bundle fallback: plain Button that fires /v1/draft.
                  fallback: {
                    type: "Button",
                    props: { label: "Draft reply", variant: "primary" },
                    // /v1/draft responds with { draftText, usage } — same
                    // pattern as Refine: land, then setState pulls draftText.
                    on: { onPress: {
                      kind: "callEndpoint",
                      method: "POST",
                      path: "/v1/draft",
                      body: {
                        intent: "$state.intent",
                        screenContent: "$state.screenContent",
                        targetApp: "WhatsApp",
                        language: "auto",
                      },
                      assignTo: "_drafted",
                      onSuccess: { kind: "setState", path: "result", value: "$state._drafted.draftText" },
                      onError: "err",
                    } },
                  },
                },
              ] },
            ] },
          ],
          // Pager fallback: same two children in a vertical Stack. Old bundles
          // scroll through them instead of swiping. Product usable.
          fallback: {
            type: "Stack",
            style: { direction: "column" },
            children: [
              { type: "Stack", style: pageStyle, children: [
                { type: "Heading", props: { content: "Make it sound like you", numberOfLines: 2 }, style: titleStyle },
                boxWithVoice("input"),
                { type: "Spacer", style: { height: 22 } },
                { type: "Stack", style: { align: "center" }, children: [
                  {
                    type: "Button",
                    props: { label: "Refine", variant: "primary" },
                    on: { onPress: {
                      kind: "callEndpoint",
                      method: "POST",
                      path: "/v1/refine",
                      body: { text: "$state.input", targetApp: "WhatsApp", language: "auto" },
                      assignTo: "_refined",
                      onSuccess: { kind: "setState", path: "input", value: "$state._refined.refinedText" },
                      onError: "err",
                    } },
                  },
                ] },
              ] },
              { type: "Spacer", style: { height: 32 } },
              { type: "Stack", style: { paddingHorizontal: 24 }, children: [
                { type: "Heading", props: { content: "Reply in your voice", numberOfLines: 2 }, style: titleStyle },
                { type: "TextField", bind: { value: "screenContent" }, props: { placeholder: "Paste their message…", multiline: true }, style: { minHeight: 70 } },
                { type: "Spacer", style: { height: 14 } },
                boxWithVoice("intent"),
                { type: "Spacer", style: { height: 18 } },
                { type: "Stack", style: { align: "center" }, children: [
                  {
                    type: "Button",
                    props: { label: "Draft reply", variant: "primary" },
                    on: { onPress: {
                      kind: "callEndpoint",
                      method: "POST",
                      path: "/v1/draft",
                      body: {
                        intent: "$state.intent",
                        screenContent: "$state.screenContent",
                        targetApp: "WhatsApp",
                        language: "auto",
                      },
                      assignTo: "_drafted",
                      onSuccess: { kind: "setState", path: "result", value: "$state._drafted.draftText" },
                      onError: "err",
                    } },
                  },
                ] },
              ] },
            ],
          },
        },

        // Dictionary + "Your words" moved to the You (Voice) page — Home is now
        // just the Refine ⇄ Reply pager above.
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/**
 * The "You" tab — two large media-background cards with a gap between them.
 * Tapping "Voice" opens the tone list; tapping "Dictionary" opens the word
 * editor. Each card's art is uploaded under the `card.voice` / `card.dictionary`
 * media keys (swap OTA). The "Hello, name + gender" profile card overlays this
 * screen on first visit (profileGate.screenIds = ["personality"]).
 */
function personalityScreen(): ScreenResponse {
  const mediaCard = (title: string, subtitle: string, key: string, screen: string): Node => ({
    type: "Card",
    // Card now honors onPress (client fix); padding/border stripped so the media
    // fills edge-to-edge, overflow:hidden clips it to the rounded corners.
    style: {
      position: "relative",
      height: 178,
      borderRadius: 20,
      overflow: "hidden",
      padding: 0,
      borderWidth: 0,
      backgroundColor: "#0b0b0f",
      marginBottom: 0,
    },
    on: {
      onPress: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "selection" },
          { kind: "navigate", screenId: screen },
        ],
      },
    },
    children: [
      // Background media (uploaded under `key`). contentFit cover fills the card;
      // a GIF animates. Absolute inset so it fills regardless of the card height.
      {
        type: "Image",
        props: { source: { key }, contentFit: "cover" },
        style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%", borderRadius: 0 },
      },
      // Scrim so the title stays legible over any art.
      { type: "Stack", style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.34)" } },
      {
        type: "Stack",
        style: { position: "absolute", left: 20, right: 20, bottom: 18, direction: "column", gap: 3 },
        children: [
          { type: "Text", props: { content: title }, style: { fontSize: 24, fontWeight: "800", color: "#FFFFFF" } },
          { type: "Text", props: { content: subtitle }, style: { fontSize: 13, fontWeight: "500", color: "rgba(255,255,255,0.82)" } },
        ],
      },
    ],
  });
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "personality",
    title: "",
    state: {},
    actions: {},
    root: {
      type: "Screen",
      style: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 24 },
      children: [
        mediaCard("Voice", "Your tones & presets", "card.voice", "voices"),
        { type: "Spacer", style: { height: 18 } },
        mediaCard("Dictionary", "Words & shortcuts you add", "card.dictionary", "dictionary"),
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/**
 * The Voice list — every tone (built-in + the user's custom ones), opened from
 * the Voice card on the You tab. The active tone is tinted; tapping a tone opens
 * the two-field editor (name + prompt). The "＋ Add a tone" button opens the
 * same editor with empty fields to create a new one.
 */
function voicesScreen(ctx: ScreenContext): ScreenResponse {
  const p = ctx.personality;
  const gap = (h: number): Node => ({ type: "Spacer", style: { height: h } });

  const effective = applyPresetOverrides(p.presetOverrides);
  const activeId = p.activePresetId ?? "signature";

  const toneCard = (preset: (typeof effective)[number]): Node => ({
    type: "Card",
    style: { paddingVertical: 14, paddingHorizontal: 16, marginBottom: 6 },
    on: { onPress: { kind: "sequence", actions: [
      { kind: "haptic", style: "selection" },
      // Tap a tone → edit its name + prompt.
      { kind: "navigate", screenId: "tone_edit", params: { presetId: preset.id } },
    ] } },
    children: [
      { type: "Text", props: { content: preset.name }, style: {
        fontSize: 16,
        fontWeight: preset.id === activeId ? "800" : "600",
        color: preset.id === activeId ? "$color.primary" : "$color.text",
      } },
    ],
  });

  const pinned = Array.isArray(p.pinnedPresetIds) ? p.pinnedPresetIds : [];
  const goCards = effective.filter((e) => pinned.includes(e.id)).map(toneCard);
  const restCards = effective.filter((e) => !pinned.includes(e.id)).map(toneCard);

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "voices",
    title: "Voice",
    state: {},
    actions: {
      // Open the editor with NO presetId → the "new tone" path.
      addTone: { kind: "sequence", actions: [
        { kind: "haptic", style: "selection" },
        { kind: "navigate", screenId: "tone_edit" },
      ] },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24 },
      children: [
        { type: "Heading", props: { content: "Voice" }, style: { fontSize: 30, fontWeight: "800", color: "$color.text", marginBottom: 16 } },
        ...goCards,
        ...(goCards.length ? [gap(16)] : []),
        ...restCards,
        gap(20),
        { type: "Button", props: { label: "＋  Add a tone", variant: "secondary" }, on: { onPress: "addTone" } },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/**
 * The two-field tone editor. Opened from a tone card (edit — fields pre-filled)
 * or the "Add a tone" button (create — empty fields). Just a NAME and a PROMPT.
 * Save upserts the tone (POST /v1/personality/tone) and makes it the active
 * voice. A built-in can be Reset; a custom tone can be Deleted.
 */
function toneEditScreen(ctx: ScreenContext): ScreenResponse {
  const presetId = typeof ctx.params?.presetId === "string" ? ctx.params.presetId : undefined;
  const effective = applyPresetOverrides(ctx.personality.presetOverrides);
  const preset = presetId ? effective.find((e) => e.id === presetId) : undefined;
  const isBuiltin = !!presetId && PERSONALITY_PRESETS.some((b) => b.id === presetId);
  const gap = (h: number): Node => ({ type: "Spacer", style: { height: h } });

  // Save body: bake the id when editing; omit it when creating (backend mints a
  // custom id). $state.name / $state.prompt are the two fields.
  const saveBody: Record<string, unknown> = { name: "$state.name", promptStyle: "$state.prompt" };
  if (presetId) saveBody.id = presetId;

  const label = (t: string): Node => ({ type: "Overline", props: { content: t }, style: { marginBottom: 8 } });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "tone_edit",
    title: preset ? `Edit ${preset.name}` : "New tone",
    state: {
      name: preset?.name ?? "",
      prompt: preset?.promptStyle ?? "",
    },
    actions: {
      saveErr: { kind: "toast", tone: "error", message: "Couldn't save. Check your connection." },
      saved: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "navigateBack" },
      ] },
      save: { kind: "callEndpoint", method: "POST", path: "/v1/personality/tone", body: saveBody, onSuccess: "saved", onError: "saveErr" },
      // Reset a built-in / delete a custom — both clear the override.
      remove: { kind: "callEndpoint", method: "POST", path: "/v1/personality/tone", body: { id: presetId, remove: true }, onSuccess: "saved", onError: "saveErr" },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24 },
      children: [
        label("Tone name"),
        { type: "TextField", bind: { value: "name" }, props: { placeholder: "e.g. Professional" } },
        gap(18),
        label("Tone prompt"),
        { type: "TextField", bind: { value: "prompt" }, props: { placeholder: "How this voice should write — e.g. Clear, warm, and direct. No filler.", multiline: true }, style: { minHeight: 120 } },
        gap(24),
        { type: "Button", props: { label: "Save", variant: "primary" }, on: { onPress: "save" } },
        ...(presetId ? [
          gap(10),
          {
            type: "Button",
            props: { label: isBuiltin ? "Reset to default" : "Delete tone", variant: isBuiltin ? "secondary" : "danger" },
            on: { onPress: "remove" },
          } as Node,
        ] : []),
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/**
 * Tone detail — reached by tapping a tone card on the Voice (You) page.
 * Deliberately spare: the tone name and its prompt, then two actions —
 * "Use this voice" (make it active) and add/remove it from the keyboard
 * toggle set. No taglines, no emoji, no supporting copy.
 */
function personalityDetailScreen(p: Personality, presetId: string | undefined): ScreenResponse {
  const effective = applyPresetOverrides(p.presetOverrides);
  const preset = effective.find((e) => e.id === presetId) ?? effective[0]!;
  const pinned = Array.isArray(p.pinnedPresetIds) ? p.pinnedPresetIds : [];
  const isPinned = pinned.includes(preset.id);
  const gap = (h: number): Node => ({ type: "Spacer", style: { height: h } });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "personality_detail",
    title: preset.name,
    state: { presetId: preset.id, status: "" },
    actions: {
      saveErr: { kind: "toast", tone: "error", message: "Couldn't save. Check your connection." },
      used: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "navigateBack" },
      ] },
      use: { kind: "sequence", actions: [
        { kind: "haptic", style: "medium" },
        { kind: "callEndpoint", method: "PUT", path: "/v1/personality", body: {
          activePresetId: preset.id,
          activeTone: preset.defaultTone,
        }, onSuccess: "used", onError: "saveErr" },
      ] },
      togglePin: { kind: "sequence", actions: [
        { kind: "haptic", style: "selection" },
        { kind: "callEndpoint", method: "POST", path: "/v1/personality/pin", body: { presetId: preset.id }, onSuccess: "refresh", onError: "saveErr" },
      ] },
      refresh: { kind: "refresh" },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24 },
      children: [
        { type: "Heading", props: { content: preset.name }, style: { fontSize: 28, fontWeight: "800", color: "$color.text", marginBottom: 16 } },
        { type: "Text", props: { content: preset.promptStyle }, style: { fontSize: 16, color: "$color.text", lineHeight: 24 } },
        gap(28),
        { type: "Button", props: { label: "Use this voice", variant: "primary" }, on: { onPress: "use" } },
        gap(10),
        { type: "Button", props: { label: isPinned ? "Remove from keyboard" : "Add to keyboard", variant: "secondary" }, on: { onPress: "togglePin" } },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/**
 * Per-preset editor. Reached from a preset card's ✎ button. Lets the user
 * override any of the built-in preset's cosmetic + prompt fields (name,
 * emoji, tagline, description, defaultTone, promptStyle) without changing
 * the preset itself — the override lives on their profile as
 * `presetOverrides[<id>]` and is merged in on every read.
 */
function personalityEditScreen(p: Personality, presetId: string | undefined): ScreenResponse | null {
  const id = presetId ?? p.activePresetId ?? "signature";
  const base = findPreset(id);
  const override = p.presetOverrides?.[id] ?? {};
  const eff = {
    name: (override.name ?? base.name),
    emoji: (override.emoji ?? base.emoji),
    tagline: (override.tagline ?? base.tagline),
    description: (override.description ?? base.description),
    defaultTone: (override.defaultTone ?? base.defaultTone),
    promptStyle: (override.promptStyle ?? base.promptStyle),
  };

  const gap = (h: number): Node => ({ type: "Spacer", style: { height: h } });
  const label = (content: string): Node => ({
    type: "Text", props: { content, variant: "label" },
    style: { fontSize: 11, color: "$color.muted", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  });
  const chip = (title: string, value: string): Node => ({
    type: "Chip",
    props: { label: title, group: "editTone", value },
    on: { onPress: { kind: "haptic", style: "selection" } },
  });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "personality_edit",
    title: `Edit ${eff.name}`,
    state: {
      editPresetId: id,
      editName: eff.name,
      editEmoji: eff.emoji,
      editTagline: eff.tagline,
      editDescription: eff.description,
      editTone: eff.defaultTone,
      editPromptStyle: eff.promptStyle,
      status: "",
    },
    actions: {
      save: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "medium" },
          {
            kind: "callEndpoint",
            method: "PUT",
            path: "/v1/personality",
            body: {
              presetOverrides: {
                [id]: {
                  name: "$state.editName",
                  emoji: "$state.editEmoji",
                  tagline: "$state.editTagline",
                  description: "$state.editDescription",
                  defaultTone: "$state.editTone",
                  promptStyle: "$state.editPromptStyle",
                },
              },
            },
            onSuccess: "saved",
            onError: "saveErr",
          },
        ],
      },
      reset: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "medium" },
          {
            kind: "callEndpoint",
            method: "PUT",
            path: "/v1/personality",
            body: {
              presetOverrides: { [id]: null },
            },
            onSuccess: "resetDone",
            onError: "saveErr",
          },
        ],
      },
      saved: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "success" },
          { kind: "toast", tone: "success", message: "Saved." },
          { kind: "navigateBack" },
        ],
      },
      resetDone: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "success" },
          { kind: "toast", tone: "info", message: "Reset to default." },
          { kind: "navigateBack" },
        ],
      },
      saveErr: { kind: "toast", tone: "error", message: "Couldn't save. Check your connection." },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24 },
      children: [
        { type: "Heading", props: { content: "Edit voice" },
          style: { fontSize: 26, fontWeight: "800", color: "$color.text", marginBottom: 4 } },
        { type: "Paragraph",
          props: { content: "Rename it, change the emoji, or reshape how it writes. Reset any time to bring the original back." },
          style: { fontSize: 13, color: "$color.muted", marginBottom: 20 } },

        label("Name"),
        { type: "TextField", bind: { value: "editName" }, props: { placeholder: "Voice name" } },
        gap(16),

        label("Emoji"),
        { type: "TextField", bind: { value: "editEmoji" }, props: { placeholder: "✨" } },
        gap(16),

        label("Tagline"),
        { type: "TextField", bind: { value: "editTagline" }, props: { placeholder: "Short one-liner" } },
        gap(16),

        label("Description"),
        { type: "TextField", bind: { value: "editDescription" }, props: { placeholder: "How this voice sounds", multiline: true, rows: 3 } },
        gap(16),

        label("Default tone"),
        { type: "Stack", style: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }, children: [
          chip(TONE_LABELS.none, "none"),
          chip(TONE_LABELS.formal, "formal"),
          chip(TONE_LABELS.casual, "casual"),
          chip(TONE_LABELS["very-casual"], "very-casual"),
          chip(TONE_LABELS.excited, "excited"),
        ] },
        gap(16),

        label("Prompt style"),
        { type: "Paragraph",
          props: { content: "The instruction the refine step reads. Advanced — change only if you know the phrasing you want." },
          style: { fontSize: 12, color: "$color.muted", marginBottom: 8 } },
        { type: "TextField", bind: { value: "editPromptStyle" },
          props: { placeholder: "e.g. Write with a poetic ear…", multiline: true, rows: 5 } },
        gap(24),

        { type: "Button", props: { label: "Save changes", variant: "primary" }, on: { onPress: "save" } },
        gap(10),
        { type: "Button", props: { label: "Reset to default", variant: "secondary" }, on: { onPress: "reset" } },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/**
 * The "advanced" customize screen — the OLD personality form. Only reached
 * from the new personality picker when the user wants to add a dictionary
 * word, a snippet, or a sign-off on top of a selected preset. Kept
 * intentionally out of the main flow so first-time users don't stall on it.
 */
function personalityCustomizeScreen(p: Personality): ScreenResponse {
  const SECTION = 24;
  const label = (content: string): Node => ({ type: "Text", props: { content, variant: "label" }, style: { marginBottom: 8 } });
  const gap = (h: number): Node => ({ type: "Spacer", style: { height: h } });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "personality_customize",
    title: "Customize",
    state: {
      form: {
        tone: p.tone ?? "",
        formality: p.formality ?? "neutral",
        emoji: p.emoji ?? "minimal",
        vocabulary: p.vocabulary ?? "",
        customInstructions: p.customInstructions ?? "",
        signature: p.signature ?? "",
        snippets: p.snippets ?? "",
      },
      status: "",
      sample: "",
    },
    actions: {
      save: { kind: "sequence", actions: [
        { kind: "setState", path: "status", value: "Saving…" },
        { kind: "callEndpoint", method: "PUT", path: "/v1/personality", body: "$state.form", onSuccess: "saved", onError: "saveErr" },
      ] },
      saved: { kind: "sequence", actions: [
        { kind: "setState", path: "status", value: "Saved." },
        { kind: "haptic", style: "success" },
      ] },
      saveErr: { kind: "toast", message: "Couldn't save.", tone: "error" },
      learn: { kind: "sequence", actions: [
        { kind: "setState", path: "status", value: "Learning your voice…" },
        { kind: "callEndpoint", method: "POST", path: "/v1/personality/learn", body: { sample: "$state.sample" }, onSuccess: "learned", onError: "saveErr" },
      ] },
      learned: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "toast", message: "Learned.", tone: "success" },
        { kind: "refresh" },
      ] },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24 },
      children: [
        { type: "Heading", props: { content: "Customize" }, style: { fontSize: 26, fontWeight: "800", color: "$color.text", marginBottom: 6 } },
        { type: "Paragraph", props: { content: "Fine-tune the selected voice with your own dictionary, sign-off, and instructions." }, style: { marginBottom: SECTION } },

        label("Sign-off (optional)"),
        { type: "TextField", bind: { value: "form.signature" }, props: { placeholder: "— A" } },
        gap(SECTION),

        label("Words it should know"),
        { type: "TextField", bind: { value: "form.vocabulary" }, props: { placeholder: "Aarav\nNykaa\nKubernetes", multiline: true } },
        gap(SECTION),

        label("Custom instructions"),
        { type: "TextField", bind: { value: "form.customInstructions" }, props: { placeholder: "avoid exclamation marks, use British spelling", multiline: true } },
        gap(SECTION),

        label("Snippets — trigger = expansion, one per line"),
        { type: "TextField", bind: { value: "form.snippets" }, props: { placeholder: "brb = be right back\naddr = 42 Baker St", multiline: true } },
        gap(SECTION),

        { type: "Button", props: { label: "Save", variant: "primary" }, on: { onPress: "save" } },
        { type: "Text", bind: { content: "status" }, props: { variant: "muted" }, style: { marginTop: 10, textAlign: "center" } },

        gap(28),
        { type: "Divider" },
        gap(20),

        label("Or learn my voice from a sample"),
        { type: "TextField", bind: { value: "sample" }, props: { placeholder: "Paste a few messages you've written…", multiline: true } },
        gap(10),
        { type: "Button", props: { label: "Learn my voice", variant: "secondary" }, on: { onPress: "learn" } },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/** Reply helper — drafts a personalized reply via /v1/draft. */
function replyScreen(): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "reply",
    title: "Reply helper",
    state: { screenContent: "", intent: "", busy: false, result: {} },
    actions: {
      draft: {
        kind: "sequence",
        actions: [
          { kind: "setState", path: "busy", value: true },
          {
            kind: "callEndpoint",
            method: "POST",
            path: "/v1/draft",
            body: {
              screenContent: "$state.screenContent",
              intent: "$state.intent",
              targetApp: "WhatsApp",
              language: "auto",
            },
            assignTo: "result",
            onSuccess: "draftDone",
            onError: "draftErr",
          },
        ],
      },
      draftDone: {
        kind: "sequence",
        actions: [
          { kind: "setState", path: "busy", value: false },
          { kind: "haptic", style: "success" },
        ],
      },
      draftErr: {
        kind: "sequence",
        actions: [
          { kind: "setState", path: "busy", value: false },
          { kind: "toast", message: "Couldn't draft. Check ⚙ Connection + your key.", tone: "error" },
        ],
      },
    },
    root: {
      type: "Screen",
      children: [
        { type: "Overline", props: { content: "Reply" } },
        text("Reply helper", "h1"),
        { type: "Paragraph", props: { content: "Paste what you got, say what you mean — get a reply in your voice." }, style: { marginBottom: 20 } },
        text("What they wrote", "label"),
        {
          type: "TextField",
          bind: { value: "screenContent" },
          props: { placeholder: "Paste the message you received…", multiline: true },
        },
        spacer(12),
        text("What you want to say", "label"),
        {
          type: "TextField",
          bind: { value: "intent" },
          props: { placeholder: "politely decline, suggest next week" },
        },
        spacer(12),
        { type: "Button", props: { label: "Draft reply", variant: "primary" }, on: { onPress: "draft" } },
        spacer(16),
        { type: "ProgressBar", visibleIf: { truthy: "busy" } },
        {
          type: "Card",
          visibleIf: { truthy: "result.draftText" },
          motion: { appear: "fadeInUp" },
          children: [text("", "body", { bind: { content: "result.draftText" } })],
        },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/** Settings — server-driven app info, account, language, and links. */
function settingsScreen(ctx: ScreenContext): ScreenResponse {
  const current = LANGUAGES.find((l) => l.value === ctx.language)?.label ?? "Auto";
  // Row helper attaches a Button-styled-as-row fallback so old bundles that
  // lack the "Row" component still render each Settings item as a full-width
  // tappable strip, not a pill. Uses only v1 primitives (Button + style
  // overrides) which the shipped bundle understands.
  const row = (label: string, action: ActionRef, extra: Partial<Node> = {}): Node => {
    const extraProps = (extra.props as Record<string, unknown> | undefined) ?? {};
    const danger = extraProps.danger === true;
    const value = extraProps.value as string | undefined;
    // Use the value in the label if present (v1 Button only shows props.label,
    // not a separate value slot). Wraps the label to avoid missing context.
    const rowLabel = value ? `${label}    ${value}` : label;
    return {
      type: "Row",
      props: { label },
      on: { onPress: action },
      ...extra,
      fallback: {
        type: "Button",
        props: {
          label: rowLabel,
          variant: danger ? "danger" : "secondary",
        },
        on: { onPress: action },
        // Style the button to read as a full-width row with a hairline
        // divider below — closer to iOS list rows than a pill.
        style: {
          width: "100%",
          borderRadius: 0,
          paddingVertical: 16,
          paddingHorizontal: 8,
          borderBottomWidth: 1,
          borderColor: "rgba(255,255,255,0.06)",
          backgroundColor: "transparent",
        },
      },
    };
  };

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "settings",
    title: "",
    state: { language: ctx.language },
    actions: {
      signOut: { kind: "signOut" },
      privacy: { kind: "openUrl", url: "https://tailzu.space/privacy", external: true },
      terms: { kind: "openUrl", url: "https://tailzu.space/terms", external: true },
      openPersonality: { kind: "switchTab", tabId: "personality" },
      openDictionary: { kind: "navigate", screenId: "dictionary" },
      openHistory: { kind: "navigate", screenId: "history" },
      openStats: { kind: "navigate", screenId: "stats" },
    },
    root: {
      type: "Screen",
      children: [
        // Left-aligned title, tighter gap. The prior right-aligned title with a
        // 64 px gap made the list appear to be missing when the first rows fell
        // just below the fold.
        { type: "Heading", props: { content: "Settings" }, style: { fontSize: 30, fontWeight: "800", color: "$color.text", marginBottom: 20 } },

        // Personalisation
        row("Personality", "openPersonality", { props: { label: "Personality", value: "You" } }),
        row("Dictionary", "openDictionary", { props: { label: "Dictionary" } }),
        row("History", "openHistory", { props: { label: "History" } }),
        row("Stats", "openStats", { props: { label: "Stats" } }),

        // Preferences
        row("Language", { kind: "navigate", screenId: "language_select" }, { props: { label: "Language", value: current } }),

        // Legal + account
        row("Privacy Policy", "privacy", { props: { label: "Privacy Policy" } }),
        row("Terms of Use", "terms", { props: { label: "Terms of Use" } }),
        row("Sign out", "signOut", { props: { label: "Sign out", chevron: false } }),
        row("Delete account", { kind: "navigate", screenId: "delete_account" }, { props: { label: "Delete account", danger: true, chevron: false } }),
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/**
 * Server-rendered usage stats screen. Prefers a fresh StatsResponse
 * (`ctx.stats`) when the screen route provides one, otherwise degrades to
 * the aggregate UsageSummary that /v1/app/screen already knows how to fetch.
 * The screen itself does no client-side fetching — see the "history" screen
 * below for the opposite pattern.
 */
function statsScreen(ctx: ScreenContext): ScreenResponse {
  const usage = ctx.usage ?? {
    month: { words: 0, audioSeconds: 0, requests: 0 },
    total: { words: 0, audioSeconds: 0, requests: 0 },
  };
  const stats = ctx.stats;
  const mins = (s: number) => Math.round(s / 60);

  // Weekly words: prefer the explicit stats projection; else derive from the
  // monthly aggregate as a rough seven-day proxy. Not perfect, but the number
  // still reads as "your recent activity" rather than a phantom placeholder.
  const wordsWeek = stats?.window === "week"
    ? stats.wordsOut
    : Math.round(usage.month.words / 4);
  const wordsMonth = usage.month.words;
  const audioSecondsMonth = usage.month.audioSeconds;
  // Same 40 wpm baseline the /v1/stats endpoint uses (see history/store.ts).
  const minutesSaved = stats?.minutesSaved ?? Math.max(0, Math.round(usage.total.words / 40));
  const typingMinutes = Math.max(1, Math.round(usage.total.words / 40));

  // Last-7-day activity, now a real BarChart (was a Unicode sparkline). The
  // Text fallback still ships in old bundles that lack the chart node.
  const perDay = (stats?.sparklinePerDay ?? []).slice(-7);
  const barSeries = perDay.map((v) => ({ label: "", value: Math.max(0, Number(v) || 0) }));
  const sparklineText = renderSparkline(stats?.sparklinePerDay);

  // Donut breakdown: how much of this month's words landed in the last 7 days.
  const earlier = Math.max(0, wordsMonth - wordsWeek);
  const donutData = [
    { label: "This week", value: wordsWeek, color: "#E8A23C" },
    { label: "Earlier", value: earlier, color: "#3A3A44" },
  ];

  // A small metric tile (StatCard v3 node, plain KeyValue fallback for old
  // bundles). delta is optional week-over-week movement when the projection
  // carries it.
  const stat = (label: string, value: string, delta?: number): Node => ({
    type: "StatCard",
    props: { label, value, ...(delta != null ? { delta } : {}) },
    style: { flex: 1 },
    fallback: { type: "KeyValue", props: { label, value }, style: { flex: 1 } },
  });

  // A chart wrapped in a titled Card — the reusable "stat block" template.
  const chartCard = (title: string, chart: Node, fallback?: Node): Node => ({
    type: "Card",
    children: [
      text(title, "label"),
      spacer(10),
      fallback ? { ...chart, fallback } : chart,
    ],
  });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "stats",
    title: "Your usage",
    state: {},
    actions: {
      openHistory: { kind: "navigate", screenId: "history" },
    },
    root: {
      type: "Screen",
      children: [
        {
          type: "Hero",
          props: {
            title: wordsMonth.toLocaleString() + " words",
            subtitle: "@stats.hero.subtitle",
          },
        },
        spacer(20),
        {
          type: "Stack",
          style: { direction: "row", gap: 8 },
          children: [
            stat("@stats.kv.weekWords", wordsWeek.toLocaleString()),
            stat("@stats.kv.audio", `${mins(audioSecondsMonth)} min`),
            stat("@stats.kv.saved", `${minutesSaved.toLocaleString()}`),
          ],
        },
        spacer(20),
        // Donut: this-week vs earlier words. Center shows the month total.
        chartCard("This month", {
          type: "PieChart",
          props: {
            data: donutData,
            donut: true,
            size: 150,
            legend: "right",
            centerValue: wordsMonth.toLocaleString(),
            centerLabel: "words",
          },
        }),
        spacer(16),
        // Bar chart of the last 7 days; Text sparkline fallback for old bundles.
        chartCard(
          "@stats.sparkline.label",
          {
            type: "BarChart",
            props: { series: barSeries, color: "#E8A23C" },
            style: { height: 110 },
          },
          text(sparklineText, "body", { style: { fontSize: 22, letterSpacing: 2 } }),
        ),
        spacer(20),
        {
          type: "Paragraph",
          props: {
            content:
              `Your effort: you'd have spent ${typingMinutes.toLocaleString()} minutes typing ` +
              `what Tulmi cleaned up in seconds.`,
          },
        },
        spacer(24),
        {
          type: "Button",
          props: { label: "@stats.cta.history", variant: "secondary" },
          on: { onPress: "openHistory" },
        },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/**
 * Render a request-per-day series as a compact Unicode block-chart. The input
 * is normalised to the eight-glyph ramp below; missing/empty input renders as
 * a neutral flat baseline so the screen never looks broken.
 */
function renderSparkline(series: number[] | undefined): string {
  const glyphs = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const s = series && series.length > 0 ? series : [0, 0, 0, 0, 0, 0, 0];
  const max = Math.max(1, ...s);
  return s
    .map((v) => {
      const idx = Math.max(0, Math.min(glyphs.length - 1, Math.round((v / max) * (glyphs.length - 1))));
      return glyphs[idx];
    })
    .join("");
}

/**
 * History browser. Loads the caller's opt-in cleanup history via /v1/history
 * and renders each row as a Card. Rows tap into a placeholder toast until we
 * ship a full-fat detail screen; long-press soft-deletes via /v1/history/:id.
 */
function historyScreen(ctx: ScreenContext): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "history",
    title: "History",
    state: {
      entries: ctx.history ?? [],
      loading: false,
    },
    actions: {
      // Called on mount + after a delete succeeds — a single source of truth
      // for "get the freshest list" keeps the UI honest.
      refresh: {
        kind: "sequence",
        actions: [
          { kind: "setState", path: "loading", value: true },
          {
            kind: "callEndpoint",
            method: "GET",
            path: "/v1/history",
            assignTo: "entries",
            onSuccess: "refreshDone",
            onError: "err",
          },
        ],
      },
      refreshDone: { kind: "setState", path: "loading", value: false },
      // Tap on a card — detail view is intentionally deferred until we know
      // what belongs there beyond input/output/timestamp.
      openDetail: { kind: "toast", message: "@history.detail.toast", tone: "info" },
      // Long-press on a card — the row template resolves the entry id via a
      // "$item.id" placeholder that the renderer expands per row.
      deleteEntry: {
        kind: "sequence",
        actions: [
          {
            kind: "callEndpoint",
            method: "DELETE",
            path: "/v1/history/$item.id",
            onSuccess: "refresh",
            onError: "err",
          },
          { kind: "haptic", style: "success" },
        ],
      },
      err: { kind: "toast", message: "@history.delete.error", tone: "error" },
    },
    root: {
      type: "Screen",
      children: [
        {
          type: "Heading",
          props: { content: "@history.title" },
          style: { fontSize: 30, fontWeight: "800", color: "$color.text", marginBottom: 6 },
        },
        {
          type: "Paragraph",
          props: { content: "@history.subtitle" },
          style: { marginBottom: 20 },
        },
        { type: "ProgressBar", visibleIf: { truthy: "loading" } },
        {
          type: "List",
          bind: { items: "entries" },
          on: {
            onAppear: "refresh",
            onRefresh: "refresh",
          },
          props: {
            emptyLabel: "@history.empty",
            itemTemplate: {
              type: "Card",
              style: { marginBottom: 10 },
              on: {
                onPress: "openDetail",
                onLongPress: "deleteEntry",
              },
              children: [
                {
                  type: "Stack",
                  style: { direction: "row", justify: "between", align: "center" },
                  children: [
                    {
                      type: "Text",
                      bind: { content: "$item.createdAt" },
                      props: { variant: "label" },
                    },
                    {
                      type: "Badge",
                      bind: { label: "$item.targetApp" },
                      props: { tone: "accent" },
                      visibleIf: { truthy: "$item.targetApp" },
                    },
                  ],
                },
                { type: "Spacer", style: { height: 6 } },
                {
                  type: "Text",
                  bind: { content: "$item.input" },
                  props: { variant: "muted", numberOfLines: 2 },
                },
                { type: "Spacer", style: { height: 6 } },
                {
                  type: "Text",
                  bind: { content: "$item.output" },
                  props: { variant: "body", numberOfLines: 3 },
                  style: { fontWeight: "700", color: "$color.text" },
                },
              ],
            },
          },
        },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/**
 * Onboarding is a server-driven, multi-step flow:
 *   onboarding (welcome) → onboarding_language → onboarding_keyboard → home
 * Each step is its own screen; the server saves choices to the user's profile,
 * so completion is remembered server-side (not just on the device).
 */

/** A small step header used across the onboarding flow. */
function stepHeader(step: number, total: number, overline: string): Node[] {
  return [
    { type: "Spacer", style: { height: 20 } },
    { type: "Overline", props: { content: `${overline} · Step ${step} of ${total}` }, style: { textAlign: "center" } },
  ];
}

/**
 * The single activation screen — replaces the old intro + welcome + language +
 * keyboard-enable sequence with one screen.
 *
 * Flow:
 *   1. On appear it requests MICROPHONE permission. This is deliberate: iOS only
 *      gives an app a per-app Settings page AFTER a permission has been asked,
 *      and that page is where the keyboard + "Allow Full Access" toggles live.
 *      So requesting mic first is what makes the "Activate" button below able to
 *      land the user on the right Settings page.
 *   2. A centered media (uploaded under the `onboarding.hero` key — swap it OTA:
 *      POST /v1/media/upload?key=onboarding.hero). An animated GIF animates; a
 *      still image shows; contentFit is "contain" so it never crops.
 *   3. Tiny instructions between the media and the button.
 *   4. "Activate" → re-ensures mic is requested (so the button works even on a
 *      bundle where onAppear doesn't fire), marks the user onboarded so this
 *      screen never reappears, then opens Settings (Settings → Tailzu →
 *      Keyboards → allow Full Access).
 *
 * Fully backend-authored — copy, media, instructions, and the whole flow change
 * OTA with no rebuild.
 */
function onboardingWelcome(): ScreenResponse {
  const stepLine = (n: string, s: string): Node => ({
    type: "Text",
    props: { content: `${n}   ${s}` },
    style: { textAlign: "center", fontSize: 11.5, color: "$color.label", letterSpacing: 0.2, marginBottom: 0 },
  });
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "onboarding",
    title: "",
    // Full-bleed: no header/back/tabs — this is the gate.
    hideChrome: true,
    state: {},
    actions: {
      // Fired on appear — get mic permission up front so the Settings deep link
      // has a page to land on.
      reqMic: {
        kind: "requestPermission",
        permission: "microphone",
        onDenied: "micDenied",
      },
      micDenied: {
        kind: "toast",
        tone: "info",
        message: "You can allow the microphone later in Settings → Tailzu.",
      },
      // The Activate button. Re-requesting mic here (idempotent — returns the
      // cached status if already decided) guarantees the Settings page exists
      // even if onAppear never fired. Then persist onboarded and — on success —
      // land the user on the "You" tab, so returning from Settings drops them
      // there with the "Hello, name" card (profileGate) as the next step rather
      // than back on this activation screen. Finally open Settings.
      activate: {
        kind: "sequence",
        actions: [
          { kind: "requestPermission", permission: "microphone" },
          {
            kind: "callEndpoint",
            method: "PUT",
            path: "/v1/profile",
            body: { onboarded: true },
            onSuccess: "goYou",
            onError: "onboardErr",
          },
          { kind: "openUrl", url: "app-settings:", external: true },
          { kind: "toast", tone: "info", message: "Settings → Tailzu → Keyboards → turn on Allow Full Access." },
        ],
      },
      // Land on the You tab; its profileGate overlay collects name + gender.
      goYou: { kind: "switchTab", tabId: "personality" },
      onboardErr: {
        kind: "toast",
        tone: "error",
        message: "Couldn't save your setup — check your connection and tap Activate again.",
      },
    },
    root: {
      type: "Stack",
      on: { onAppear: "reqMic" },
      style: {
        flex: 1,
        direction: "column",
        alignItems: "center",
        backgroundColor: "#000000",
        paddingHorizontal: 28,
        paddingTop: 40,
        paddingBottom: 28,
      },
      children: [
        {
          type: "Heading",
          props: { content: "Tailzu — your writing assistant" },
          style: { textAlign: "center", fontSize: 26, lineHeight: 32, fontWeight: "800", color: "$color.text" },
        },
        // Centered media — flex:1 pushes it to the vertical middle.
        {
          type: "Stack",
          style: { flex: 1, width: "100%", alignItems: "center", justifyContent: "center" },
          children: [
            {
              type: "Image",
              props: { source: { key: "onboarding.hero" }, contentFit: "contain" },
              style: { width: 260, height: 260 },
            },
          ],
        },
        // Tiny instructions between the media and the button.
        {
          type: "Stack",
          style: { direction: "column", gap: 6, alignItems: "center", marginBottom: 18 },
          children: [
            stepLine("1", "Open Settings"),
            stepLine("2", "Keyboards → Add Tailzu"),
            stepLine("3", "Allow Full Access"),
            stepLine("4", "You’re all set"),
          ],
        },
        {
          type: "Button",
          props: { label: "Activate", variant: "primary" },
          on: { onPress: "activate" },
          style: { width: "100%" },
        },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/** Step 2 — pick the main language; saved to the profile on Continue. */
function onboardingLanguage(current: string): ScreenResponse {
  const chip = (l: { value: string; label: string }): Node => ({
    type: "Chip",
    props: { label: l.label, group: "language", value: l.value },
    on: { onPress: { kind: "haptic", style: "selection" } },
  });
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "onboarding_language",
    title: "Language",
    template: "scroll",
    state: { language: current || "auto" },
    actions: {
      next: {
        kind: "sequence",
        actions: [
          { kind: "callEndpoint", method: "PUT", path: "/v1/profile", body: { language: "$state.language" } },
          { kind: "navigate", screenId: "onboarding_keyboard" },
        ],
      },
    },
    blocks: [
      ...stepHeader(2, 3, "Your language"),
      { type: "Heading", props: { content: "What do you mostly speak?" }, style: { textAlign: "center", fontSize: 26, lineHeight: 32, marginBottom: 10 } },
      { type: "Paragraph", props: { content: "Tulmi works in many languages. Pick your main one — you can change it anytime in Settings." }, style: { textAlign: "center", marginBottom: 28 } },
      {
        type: "Stack",
        style: { direction: "row", gap: 8, wrap: "wrap", justify: "center" },
        children: LANGUAGES.map(chip),
      },
      { type: "Spacer", style: { height: 40 } },
      { type: "Button", props: { label: "Continue", variant: "primary" }, on: { onPress: "next" } },
    ],
    cacheTtlSeconds: 0,
  };
}

/** Step 3 — enable the Tulmi keyboard, then finish (marks onboarded). */
function onboardingKeyboard(): ScreenResponse {
  const step = (n: string, body: string): Node => ({
    type: "Stack", style: { direction: "row", gap: 12 }, children: [
      { type: "Text", props: { content: n }, style: { color: "$color.text", fontSize: 16, fontWeight: "700" } },
      { type: "Paragraph", props: { content: body }, style: { marginBottom: 0, flex: 1 } },
    ],
  });
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "onboarding_keyboard",
    title: "",
    template: "scroll",
    state: { keyboardReady: false, dictationSample: "" }, // the app overwrites keyboardReady live
    actions: {
      err: {
        kind: "toast",
        tone: "error",
        message: "Voice failed. Check your connection.",
      },
      // Prefer openUrl("app-settings:") over openSettings — same underlying
      // iOS mechanism but a different Linking code path. Critically, this
      // action only reliably opens iOS Settings AFTER at least one permission
      // has been requested (mic/notif/etc.) — before that, iOS has no
      // per-app Settings surface and the URL resolves silently. The
      // "Try dictating" step above intentionally fires the mic permission
      // prompt, so by the time the user reaches this button Tulmi has a
      // Settings page to route to.
      openSettings: {
        kind: "sequence",
        actions: [
          { kind: "openUrl", url: "app-settings:", external: true },
          { kind: "toast", tone: "info", message: "In Settings: General → Keyboard → Keyboards → Add New → Tailzu" },
        ],
      },
      // Split the finish flow so `switchTab` only runs after the PUT succeeds.
      // Previously the write was fire-and-forget: any network blip / 401 / 5xx
      // was swallowed and the user still visually "completed" onboarding,
      // producing the "home tab + onboarding content" loop on next launch.
      finish: {
        kind: "callEndpoint",
        method: "PUT",
        path: "/v1/profile",
        body: { onboarded: true },
        onSuccess: "finishOk",
        onError: "finishErr",
      },
      finishOk: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "success" },
          { kind: "switchTab", tabId: "home" },
        ],
      },
      finishErr: {
        kind: "toast",
        tone: "error",
        message: "Couldn't finish setup. Check your connection and try again.",
      },
      // Escape hatch — user can skip onboarding even if `keyboardReady` never
      // flips true (e.g. the iOS keyboard extension isn't installed on this
      // build, or Full Access can't be detected). Same server confirmation as
      // finish, so the flag actually persists.
      skip: {
        kind: "callEndpoint",
        method: "PUT",
        path: "/v1/profile",
        body: { onboarded: true },
        onSuccess: "finishOk",
        onError: "finishErr",
      },
    },
    blocks: [
      // STEP 1: Try dictating — this is genuinely a nice preview of the
      // product AND has a critical side-effect: tapping the mic triggers
      // iOS's mic-permission prompt. That prompt is what gives Tulmi a
      // per-app Settings page. Without it, tapping "Open Settings" below
      // resolves silently on iOS (nothing to route to). So the two-step
      // "Try voice → then Settings" ordering isn't just onboarding UX —
      // it's what makes the Settings button actually work.
      { type: "Card", children: [
        { type: "Heading", props: { content: "Try Tulmi's voice first" }, style: { fontSize: 20, fontWeight: "800", color: "$color.text", marginBottom: 6 } },
        { type: "Paragraph", props: { content: "Tap the mic and say anything. We'll clean it up in your voice." }, style: { marginBottom: 14 } },
        {
          type: "Stack", style: { position: "relative" }, children: [
            { type: "TextField", bind: { value: "dictationSample" }, props: { placeholder: "Your dictation appears here…", multiline: true }, style: { paddingRight: 56, minHeight: 84 } },
            { type: "Stack", style: { position: "absolute", right: 12, top: 0, bottom: 0, justify: "center" }, children: [
              {
                type: "VoiceToggle",
                bind: { value: "dictationSample" },
                props: { targetApp: "Notes", language: "auto", size: 34 },
                on: { onError: "err" },
                fallback: {
                  type: "VoiceButton",
                  bind: { value: "dictationSample" },
                  props: { targetApp: "Notes", language: "auto" },
                  on: { onError: "err" },
                },
              },
            ] },
          ],
        },
      ] },

      { type: "Spacer", style: { height: 20 } },

      // STEP 2: The keyboard-enable card. Apple does NOT allow deep-linking
      // into Settings > Keyboards, so the button below only lands on Tulmi's
      // own Settings page (which now exists because mic was requested
      // above). Show every navigation step so the user knows the path.
      { type: "Card", children: [
        { type: "Heading", props: { content: "Now enable the Tulmi keyboard" }, style: { fontSize: 20, fontWeight: "800", color: "$color.text", marginBottom: 10 } },
        step("1", "Open Settings, then tap General."),
        { type: "Spacer", style: { height: 12 } },
        step("2", "Tap Keyboard → Keyboards → Add New Keyboard."),
        { type: "Spacer", style: { height: 12 } },
        step("3", "Choose Tailzu from the list."),
        { type: "Spacer", style: { height: 12 } },
        step("4", "Tap Tailzu again and turn on “Allow Full Access”."),
        { type: "Spacer", style: { height: 12 } },
        step("5", "Return to Tailzu — the 🌐 globe key switches between keyboards."),
      ] },
      { type: "Spacer", style: { height: 22 } },
      // "Open Settings" (not "Open Keyboard Settings") — iOS can't deliver
      // what the old label promised; be honest about where the button lands.
      { type: "Button", visibleIf: { not: { truthy: "keyboardReady" } },
        props: { label: "Open Settings", variant: "primary" }, on: { onPress: "openSettings" } },
      { type: "Button", visibleIf: { truthy: "keyboardReady" },
        props: { label: "Start Using Tailzu", variant: "primary" }, on: { onPress: "finish" } },
      { type: "Spacer", style: { height: 14 } },
      // Ghost / text-only "Skip" so users aren't trapped if they can't or
      // won't add the keyboard right now.
      { type: "Button", visibleIf: { not: { truthy: "keyboardReady" } },
        props: { label: "Skip for now", variant: "secondary" }, on: { onPress: "skip" } },
    ],
    cacheTtlSeconds: 0,
  };
}

/**
 * The main app's landing screen when the keyboard extension hands off a
 * mic tap. `params.session` (from the deep link) is threaded into
 * state.handoffSessionId so the completeKeyboardHandoff action knows which
 * session to write back to the App Group.
 *
 * The user sees the recording UI, speaks, and taps Send — the SDUI
 * VoiceToggle already records + uploads to /v1/transcribe-clean and puts
 * the cleaned text in state.dictationSample. Send fires
 * completeKeyboardHandoff, which writes the text to the App Group +
 * fires a Darwin notification the keyboard observes to insert.
 *
 * Fully backend-designed: swap the media, copy, layout, any which way,
 * without a rebuild. Add hero art, a Lottie, whatever — it's just SDUI.
 */
function keyboardRecordScreen(ctx: ScreenContext): ScreenResponse {
  const sessionId = String(ctx.params?.session ?? "");
  const hostApp = String(ctx.params?.host ?? "");
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "keyboard_record",
    title: "",
    state: {
      handoffSessionId: sessionId,
      hostApp,
      dictationSample: "",
      sending: false,
    },
    actions: {
      // Fired by VoiceToggle when transcription fails.
      err: { kind: "toast", tone: "error", message: "Voice failed. Check your connection." },
      // Called by the Send button — writes the text back through the native
      // module and shows a "swipe back" hint. Backend can localize the toast
      // or swap it for a full-screen "Sent" card by editing this action.
      send: {
        kind: "sequence",
        actions: [
          { kind: "setState", path: "sending", value: true },
          { kind: "completeKeyboardHandoff" },
          { kind: "haptic", style: "success" },
          { kind: "toast", tone: "success", message: "Sent to Tailzu keyboard — swipe back to your app." },
        ],
      },
      // User bailed — cancel the pending handoff so the keyboard doesn't
      // sit in "listening" forever.
      cancel: {
        kind: "sequence",
        actions: [
          { kind: "cancelKeyboardHandoff" },
          { kind: "navigateBack" },
        ],
      },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 20, paddingTop: 40, paddingBottom: 24 },
      children: [
        { type: "Overline", props: { content: "Voice keyboard" } },
        { type: "Heading", props: { content: "Speak, then swipe back" }, style: { fontSize: 26, fontWeight: "800", color: "$color.text", marginTop: 6, marginBottom: 6 } },
        { type: "Paragraph", props: { content: "We'll clean it up and drop the text into your keyboard. Nothing gets sent from here — the keyboard inserts it into whatever app you were in." }, style: { marginBottom: 28 } },
        // Big centered mic. VoiceToggle handles record → upload →
        // dictationSample.
        //
        // Media on the mic:
        //   iconIdle       — media for the idle (not-recording) state
        //   iconRecording  — media for the recording state
        //
        // Each accepts EITHER the simple shape:
        //     { key: "mic.idle" }                             ← MediaSpec
        // OR the rich playback shape:
        //     {
        //       source: { key: "mic.recording" },             ← required
        //       autoplay: true,                                ← play on show
        //       loop: true,                                    ← loop forever
        //       speed: 1.0,                                    ← Lottie / video
        //       muted: true,                                   ← video (default)
        //       maxDurationMs: 4000,                           ← hard cap
        //       tint: "#FFCC00",                               ← PNG tint
        //       playing: true,                                 ← controlled play
        //       fireOnEnd: true,                               ← ⇢ node.onComplete
        //     }
        //
        // When fireOnEnd is true, the VoiceToggle's onComplete NodeEvent
        // fires when the media's playback ends (natural end OR after
        // maxDurationMs). Wire an SDUI action in `on.onComplete` on the
        // VoiceToggle node to react — the payload is
        // { state: "idle" | "recording" } so one action can handle both.
        //
        // Supported source formats (auto-detected):
        //   PNG · JPG · WebP · SVG · GIF · APNG · Lottie JSON · MP4 / MOV / WebM
        //
        // Uploading:
        //   POST /v1/media/upload?key=mic.idle       (any of the above)
        //   POST /v1/media/upload?key=mic.recording  (any of the above)
        //
        // Missing keys fall back to the built-in Tailzu-mark → line morph,
        // so a fresh deploy without uploaded assets still works.
        { type: "Stack", style: { alignItems: "center", justifyContent: "center", marginBottom: 20 }, children: [
          {
            type: "VoiceToggle",
            bind: { value: "dictationSample" },
            props: {
              targetApp: hostApp || "Generic",
              language: "auto",
              size: 128,
              autoStart: true,
              // Backend-owned mic art with full playback control.
              //
              // Single-media mode: supply ONLY iconIdle → the mic uses the
              // same asset in both states and the client auto-binds `playing`
              // to the recording state. tap → play, tap → pause (holds the
              // current frame), tap → resume from that frame. Works for
              // Lottie + video; GIF/APNG can't pause so the visual just
              // keeps looping while recording state does its own thing.
              //
              // Two-media mode: also supply iconRecording → the two swap on
              // state change (see the commented block below to re-enable).
              //
              // Voice-reactive playback:
              //   voiceReactive:true → media speed is driven by mic level
              //                         while recording (loud → fast, quiet
              //                         → slow). Amplitude-based, not
              //                         fundamental-pitch, but visually
              //                         reads the same.
              //   speedRange:[a,b]   → min/max playback multiplier
              //   levelRange:[a,b]   → dB window mapped into speedRange
              //   speedSmoothing:0..1 → higher = laggier attack/release
              //
              //   NOTE: only Lottie + MP4 can be retimed at runtime. GIF/APNG
              //   ignore live speed changes and keep their baked-in rate.
              iconIdle: {
                source: { key: "mic.animation" },
                loop: true,
                speed: 1,
                muted: true,
                voiceReactive: true,
                speedRange: [0.5, 2.5],
                levelRange: [-45, -5],
                speedSmoothing: 0.7,
              },
              // iconRecording: { source: { key: "mic.recording" }, loop: true },
              background: "#ffffff",
              contentScale: 0.72,
            },
            on: { onError: "err" },
            fallback: {
              type: "VoiceButton",
              bind: { value: "dictationSample" },
              props: { targetApp: hostApp || "Generic", language: "auto" },
              on: { onError: "err" },
            },
          },
        ] },
        // Live transcription preview so the user can trust what's being sent.
        { type: "Card", style: { marginBottom: 20 }, children: [
          { type: "Paragraph", visibleIf: { falsy: "dictationSample" }, props: { content: "Tap the mic to start. Tap again to stop." }, style: { color: "$color.muted" } },
          { type: "TextField", visibleIf: { truthy: "dictationSample" }, bind: { value: "dictationSample" }, props: { multiline: true } },
        ] },
        // Send + Cancel row.
        { type: "Button", visibleIf: { truthy: "dictationSample" }, props: { label: "Send to keyboard", variant: "primary" }, on: { onPress: "send" } },
        { type: "Spacer", style: { height: 10 } },
        { type: "Button", props: { label: "Cancel", variant: "secondary" }, on: { onPress: "cancel" } },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/**
 * Flow arming screen — the ONE-TIME hop the keyboard mic makes to turn on the
 * background-audio "Flow Session" (kb.mic.mode="flow", the Wispr model). On
 * appear it requests mic permission (required for the background session) and
 * arms the session; after that it's just a "swipe back and dictate" prompt.
 * Once the user swipes back, dictations run from the keyboard without returning
 * here until the session idles out (kb.flow.idleTimeoutMs). Fully
 * backend-authored — restyle/recopy freely, it's pure SDUI.
 */
function flowArmScreen(_ctx: ScreenContext): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "flow_arm",
    title: "",
    state: { armed: false },
    actions: {
      // Fired on appear: get mic permission, then arm the background session.
      arm: {
        kind: "requestPermission",
        permission: "microphone",
        onGranted: "doArm",
        onDenied: "micDenied",
      },
      doArm: {
        kind: "sequence",
        actions: [
          { kind: "armFlowSession", idleTimeoutMs: FLOW_IDLE_TIMEOUT_MS },
          { kind: "setState", path: "armed", value: true },
          { kind: "haptic", style: "success" },
        ],
      },
      micDenied: {
        kind: "toast",
        tone: "error",
        message:
          "Allow the microphone in Settings → Tailzu, then swipe back and tap the keyboard mic again.",
      },
    },
    root: {
      type: "Screen",
      on: { onAppear: "arm" },
      style: { paddingHorizontal: 28, alignItems: "center", justify: "center", flex: 1 },
      children: [
        {
          type: "Heading",
          props: { content: "🎙️  Flow is on" },
          style: { fontSize: 30, fontWeight: "800", color: "$color.text", marginBottom: 14, textAlign: "center" },
        },
        {
          type: "Paragraph",
          props: {
            content:
              "Swipe back to your app, then tap the keyboard mic and just talk — your words appear as you speak. No need to come back here until you’ve been idle a while.",
          },
          style: { textAlign: "center", marginBottom: 30, color: "$color.muted" },
        },
        {
          type: "Text",
          props: { content: "⟵  swipe back to continue" },
          style: { fontSize: 15, fontWeight: "700", color: "$color.primary", textAlign: "center" },
        },
      ],
    },
  };
}

/**
 * Cold-start primer — shown the FIRST time the keyboard hands off before
 * the main app has been foregrounded (or after a long absence). We can't
 * record right away because iOS hasn't granted mic yet; instead we prompt
 * the user, then tell them to swipe back and re-tap the keyboard mic.
 *
 * On subsequent handoffs the main app will be warm and go straight to
 * keyboard_record. Same backend-owned design freedom as everything else.
 */
function keyboardPrimerScreen(ctx: ScreenContext): ScreenResponse {
  const sessionId = String(ctx.params?.session ?? "");
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "keyboard_primer",
    title: "",
    state: { handoffSessionId: sessionId, micGranted: false },
    actions: {
      grantMic: {
        kind: "requestPermission",
        permission: "microphone",
        onGranted: "granted",
        onDenied: "denied",
      },
      granted: {
        kind: "sequence",
        actions: [
          { kind: "setState", path: "micGranted", value: true },
          { kind: "haptic", style: "success" },
        ],
      },
      denied: {
        kind: "toast",
        tone: "error",
        message: "Allow the microphone in Settings → Tailzu, then swipe back and tap the keyboard mic again.",
      },
      openMainSettings: {
        kind: "openSettings",
      },
      dismiss: {
        kind: "sequence",
        actions: [
          { kind: "cancelKeyboardHandoff" },
          { kind: "navigateBack" },
        ],
      },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 24 },
      children: [
        { type: "Overline", props: { content: "One-time setup" } },
        { type: "Heading", props: { content: "Turn on voice for the keyboard" }, style: { fontSize: 28, fontWeight: "800", color: "$color.text", marginTop: 6, marginBottom: 12 } },
        { type: "Paragraph", props: { content: "iOS requires this app to grant microphone access before the keyboard can use it. Tap Allow, then swipe back to your app — the keyboard mic will work from then on." }, style: { marginBottom: 28 } },
        { type: "Card", style: { marginBottom: 22, padding: 16 }, children: [
          { type: "Stack", style: { flexDirection: "row", alignItems: "center", marginBottom: 10 }, children: [
            { type: "Text", props: { content: "1." }, style: { fontSize: 15, fontWeight: "800", color: "$color.primary", width: 24 } },
            { type: "Text", props: { content: "Tap the Allow mic button below" }, style: { fontSize: 15, color: "$color.text", flex: 1 } },
          ] },
          { type: "Stack", style: { flexDirection: "row", alignItems: "center", marginBottom: 10 }, children: [
            { type: "Text", props: { content: "2." }, style: { fontSize: 15, fontWeight: "800", color: "$color.primary", width: 24 } },
            { type: "Text", props: { content: "Approve the iOS microphone prompt" }, style: { fontSize: 15, color: "$color.text", flex: 1 } },
          ] },
          { type: "Stack", style: { flexDirection: "row", alignItems: "center" }, children: [
            { type: "Text", props: { content: "3." }, style: { fontSize: 15, fontWeight: "800", color: "$color.primary", width: 24 } },
            { type: "Text", props: { content: "Swipe back to your app and tap the keyboard mic again" }, style: { fontSize: 15, color: "$color.text", flex: 1 } },
          ] },
        ] },
        {
          type: "Button",
          visibleIf: { not: { truthy: "micGranted" } },
          props: { label: "Allow microphone", variant: "primary" },
          on: { onPress: "grantMic" },
        },
        {
          type: "Card",
          visibleIf: { truthy: "micGranted" },
          motion: { appear: "fadeInUp" },
          style: { padding: 16, marginBottom: 12 },
          children: [
            { type: "Heading", props: { content: "You're set" }, style: { fontSize: 18, fontWeight: "800", color: "$color.text", marginBottom: 6 } },
            { type: "Paragraph", props: { content: "Swipe back to your app now and tap the keyboard mic. It'll work from here on out." } },
          ],
        },
        { type: "Spacer", style: { height: 10 } },
        {
          type: "Button",
          visibleIf: { not: { truthy: "micGranted" } },
          props: { label: "Open Tailzu Settings", variant: "secondary" },
          on: { onPress: "openMainSettings" },
        },
        { type: "Spacer", style: { height: 8 } },
        {
          type: "Button",
          props: { label: "Cancel", variant: "secondary" },
          on: { onPress: "dismiss" },
        },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

function dictionaryScreen(ctx: ScreenContext): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "dictionary",
    title: "Dictionary",
    state: { dictionary: ctx.dictionary ?? [] },
    actions: { err: { kind: "toast", message: "Couldn't save.", tone: "error" } },
    root: { type: "Screen", children: [
      { type: "Heading", props: { content: "Dictionary" }, style: { fontSize: 28, fontWeight: "800", color: "$color.text", marginBottom: 8 } },
      { type: "Paragraph", props: { content: "Type the word, get the replacement — anywhere you use the Tailzu keyboard." }, style: { marginBottom: 28 } },
      { type: "DictionaryEditor", bind: { value: "dictionary" }, props: { full: true }, on: { onError: "err" } },
    ] },
    cacheTtlSeconds: 0,
  };
}

function languageSelectScreen(ctx: ScreenContext): ScreenResponse {
  const row = (l: { value: string; label: string }): Node => ({
    type: "Row",
    props: { label: l.label, value: l.value === ctx.language ? "✓" : "", chevron: false },
    on: { onPress: { kind: "sequence", actions: [
      { kind: "haptic", style: "selection" },
      { kind: "callEndpoint", method: "PUT", path: "/v1/profile", body: { language: l.value } },
      { kind: "navigateBack" },
    ] } },
  });
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "language_select",
    title: "Language",
    state: { language: ctx.language },
    actions: {},
    root: { type: "Screen", children: LANGUAGES.map(row) },
    cacheTtlSeconds: 0,
  };
}

function deleteAccountScreen(): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "delete_account",
    title: "",
    state: {},
    actions: {
      confirm: { kind: "sequence", actions: [
        { kind: "callEndpoint", method: "DELETE", path: "/v1/account", onError: "err" },
        { kind: "signOut" },
      ] },
      err: { kind: "toast", message: "Couldn't delete the account. Try again.", tone: "error" },
    },
    root: { type: "Screen", children: [
      { type: "Heading", props: { content: "Delete account" }, style: { fontSize: 28, fontWeight: "800", color: "$color.text", marginBottom: 14 } },
      { type: "Paragraph", props: { content: "This permanently deletes your account, your personality, and your usage. This cannot be undone." }, style: { marginBottom: 32 } },
      { type: "Button", props: { label: "Delete my account", variant: "danger" }, on: { onPress: "confirm" } },
      { type: "Spacer", style: { height: 10 } },
      { type: "Button", props: { label: "Cancel", variant: "secondary" }, on: { onPress: { kind: "navigateBack" } } },
    ] },
    cacheTtlSeconds: 0,
  };
}

// --- Keyboard config (server-driven keyboard; cached by the native shell) ----

// ---------------------------------------------------------------------------
// SDUI keyboard — the whole thing as a Node tree the native renderer walks.
// ---------------------------------------------------------------------------
//
// Design goals (in order):
//   1. Look and feel indistinguishable from Apple's stock dark keyboard until
//      the user notices the top bar + refine key.
//   2. Real iOS translucency via UIVisualEffectView(systemChromeMaterialDark) —
//      the ONE thing the previous hand-built path could never do because the
//      color parser was hex-only and there was no backing blur view.
//   3. Brand touch WITHOUT screaming: the Return key wears the brand accent,
//      the mic key wears the brand mark. Everything else stays system-neutral.
//   4. Every visible behavior is a data change here — new layouts, new colors,
//      new key shapes, new feature keys all ship as backend JSON.

/** Letter-key builder. Font size 23pt is Apple's actual letter-key size
 * (KeyboardKit unit tests). Weight regular; the shipped SDUI-renderer build
 * applies these to every LetterKey via applyStyle. */
const kLetter = (char: string): KeyboardNode => ({
  type: "LetterKey",
  props: { char },
  style: { flex: 1, fontSize: 23, fontWeight: "regular" },
});

/** Punctuation key on the 123 / #+= pages — same visual + font weight as a
 * letter key but bigger font because these pages use flex-1 across fewer
 * items so each key is naturally wider. */
const kPunct = (char: string): KeyboardNode => ({
  type: "LetterKey",
  props: { char },
  style: { flex: 1, fontSize: 20, fontWeight: "regular" },
});

/** Half-key row-2 indent (Apple pattern). flex:0.5 gives the letters in
 * a-l the exact same width as q-p on ANY screen size — was hardcoded to
 * width:13 before the shipped SDUI renderer supported proportional flex.
 * Post-rebuild, flex works properly and we can scale correctly. */
const kHalfSpacer = (): KeyboardNode => ({ type: "Spacer", style: { flex: 0.5 } });

/** Emits one variant of the tools row (mic / tone pill / refine). Called
 * twice — once with dark palette, once with light — each gated by a
 * visibleIf on state.appearance. Style hex literals don't auto-flip on
 * trait change, so we can't just pass one row and hope the renderer knows.
 */
/** Two-toggle tools row — mic (left, orange) and tone pill (right, defined
 * dark oval). No refine key: stopping the mic auto-runs refinement via the
 * sequence action on tap (needs the queued MicKey Swift patch to fire runRefine
 * inside stopDictation; the sequence-based fallback below handles it TODAY
 * whether or not the patch has landed).
 */
const makeToolsRow = (opts: {
  micBg: string;
  micFg: string;
  toneBg: string;
  toneFg: string;
  toneBorderColor: string;
  visibleIf: any;
}): KeyboardNode => ({
  type: "Row",
  // Compact 44pt row — the two toggles read as accents, not "here's the tools
  // bar you must respect". Uniform padding matches container L/R so the mic
  // sits flush with the keyboard's own left edge and the tone pill flush right.
  style: { gap: 8, height: 44, padding: 4 },
  visibleIf: opts.visibleIf,
  children: [
    // Mic — LEFT side. Solid brand-orange circle. When idle it starts
    // dictation; when recording it stops + immediately fires runRefine so the
    // captured text moves straight into the refinement pipeline.
    //
    // NO explicit `on.onPress` here. The Swift MicKey renderer has a
    // built-in fallback that handles the exact same "tap-to-toggle-and-
    // refine" behavior when no backend action is supplied. This shape works
    // on every client version — new AND old — because it doesn't depend on
    // the client understanding a `condition` action node. Older TestFlight
    // builds without the `condition` action handler were silently no-op-ing
    // on tap; this restores start/stop for them.
    {
      type: "MicKey",
      style: {
        flex: 0,
        width: 36,
        height: 36,
        bg: opts.micBg,
        fg: opts.micFg,
        radius: 18,          // circular
      },
    },
    // Middle spacer — pushes tone pill to the right edge, symmetric to mic.
    { type: "Spacer", style: { flex: 1 } },
    // Tone pill — RIGHT side. Compact oval with a subtle border for shape
    // definition against the transparent keyboard region.
    {
      type: "LetterKey",
      props: { char: "Neutral" },
      bind: { content: "tone" },
      on: { onPress: { kind: "cycleTone" } },
      style: {
        flex: 0,
        width: 96,
        height: 32,
        bg: opts.toneBg,
        fg: opts.toneFg,
        radius: 16,
        fontSize: 13,
        fontWeight: "medium",
        borderColor: opts.toneBorderColor,
        borderWidth: 1,
      },
    },
  ],
});

/**
 * Colors picked to match Apple's iOS 17 dark-mode system keyboard exactly.
 *
 * Native iOS uses TWO layers of hierarchy:
 *   - Letter keys sit LIGHTER + more transparent so the blur backdrop reads
 *     through them — this is where the "frosted glass" premium feel comes
 *     from. Fully opaque flat gray is what makes third-party keyboards look
 *     cheap.
 *   - Function keys (shift, backspace, 123, globe, return, etc.) sit DARKER
 *     + more opaque, creating a subtle "recessed" band that visually anchors
 *     the outer edges of the layout.
 *
 * The palette is deliberately restrained — Apple doesn't tint their return
 * key at all in typing fields, and the brand orange we tried before read
 * as "kids-app CTA button" against the muted gray hierarchy. Any brand
 * touch we add later should be far subtler (a colored glyph, not a filled
 * key).
 */
// Palette derived from cross-verified pixel-measurement research (archagon
// tasty-imitation-keyboard, KeyboardKit, sotto-voce). Apple's dark-mode
// keys are NOT semi-transparent dark gray — they're semi-transparent WHITE
// and GRAY over the blur backdrop. That inversion is what makes the keys
// look luminous against the frosted glass instead of dark blocks.
//
//   Letter key:   rgba(255,255,255,0.30)  → #FFFFFF4D
//   Function key: rgba(128,128,128,0.30)  → #8080804D
//   Pressed:      the two swap (letter → function color, and vice-versa)
// Comparing to freshly-captured screenshots of the native iOS dark keyboard:
// letter keys are luminous chips (~55% white over the chrome blur); function
// keys sit recessed (~20% white — darker/dimmer, not brighter). Pressed state
// on both flips brighter for visible touch feedback. Our previous #FFFFFF40
// (25%) letter fill was too thin — the blur swallowed it and everything read
// dimmer than native.
const KEY_FILL_LETTER = "#FFFFFF8C";      // 55% white — luminous "floating chip" like native letter keys
const KEY_FILL_FUNCTION = "#FFFFFF33";    // 20% white — recessed/dimmer than letter keys (matches native hierarchy)
const KEY_FILL_SPACE = "#FFFFFF8C";       // matches letter fill
const KEY_FILL_RETURN = "#FFFFFF33";      // matches function fill
const KEY_TEXT = "#FFFFFF";
const KEY_TEXT_FUNCTION = "#FFFFFF";
// Brand amber press color — every key (letter, function, shift, backspace,
// return) flashes brand accent for ~120ms on tap. Fires on touch-down inside
// the Swift renderer's keyTouchDown handler (theme.keyPressed → this hex),
// then keyTouchUp animates back to the resting bg via UIView.animate. This is
// the "typing has our color" identity moment — not a permanent tint.
// Sampled from the mic.animation media so the whole app reads as one palette
// family (previously #FF6B1F pure orange — too punchy against the amber
// media, felt like two different brands sharing the screen).
const KEY_PRESSED = "#E8A23C";            // BRAND_ACCENT — warm amber press feedback on every key
// Brand amber kept only for functional signals — right now that's the
// waveform bars during dictation. Colored feedback when the user is
// speaking; invisible the rest of the time. Not a decorative accent.
const BRAND_ACCENT = "#E8A23C";

// -------- Light-mode counterparts (used by the next SDUI build) -----------
//
// Apple's light-mode dark-keyboard-equivalent palette:
//   Letter key:   rgba(0,0,0,0.05)   → #0000000D  (near-transparent dark)
//   Function key: rgba(0,0,0,0.10)   → #0000001A  (slightly darker recess)
//   Key text:     #000000            (pure black)
//   Blur:         systemChromeMaterialLight
//
// The shipped keyboard renderer doesn't read these yet — until the next build
// adds trait-collection detection, the top-level `theme` (dark) is what's
// applied on every device regardless of mode. But by emitting the light
// palette NOW, the day the build lands the keyboard automatically flips
// with zero backend edit.
// Light-mode letter keys are near-solid WHITE (Apple's actual value has almost
// no transparency — very light chips on a light-gray keyboard region). Our
// previous 5% black was so translucent it dissolved into the app content.
// #FFFFFFE6 (90% white) is what native reads as against the light keyboard
// backdrop and holds up over any light-app content behind it.
const LIGHT_KEY_FILL_LETTER = "#FFFFFFE6";     // 90% white — solid-white chips
export const LIGHT_KEY_FILL_FUNCTION = "#C7CDD3E6";   // ~90% opaque light gray — kept exported for the next light-mode row expansion
const LIGHT_KEY_TEXT = "#000000";

export function buildKeyboardConfig(personality?: Personality): KeyboardConfigResponse {
  // English QWERTY. The physical layout arrays are also emitted (below) so
  // older keyboard binaries — the ones without the SDUI renderer — can still
  // render the legacy hand-built keyboard. `features.sdui: true` is the switch
  // the SDUI-capable binary flips to walk `root` instead.
  const letterRow1 = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"];
  const letterRow2 = ["a", "s", "d", "f", "g", "h", "j", "k", "l"];
  const letterRow3 = ["z", "x", "c", "v", "b", "n", "m"];

  // Emoji layer removed. Users can access the system emoji keyboard via the
  // globe key in the iOS extension bar below Tulmi, so shipping our own
  // grid was duplicating that at the cost of a keyboard slot.

  // The whole keyboard as a tree. Column of rows; suggestion bar + waveform
  // are conditionally visible via visibleIf against KBState the renderer maintains.
  //
  // IMPORTANT: the blur backdrop is set on theme.backgroundEffect (which the
  // renderer applies to the ENTIRE inputView — Apple's exact behavior). We do
  // NOT put a `blur` effect on this Container too, or we double up and the
  // whole thing reads slightly dimmer than native. Padding is also minimal
  // (3px each side) — Apple's own keyboard edges the keys almost to the screen
  // border; more inner padding is what was making our keyboard look boxed.
  const root: KeyboardNode = {
    type: "Container",
    // Geometry aligned to NATIVE iOS to minimise user discomfort (values from
    // measured Apple teardowns; Apple publishes none officially):
    //   • L/R margin 3pt, top 8pt, bottom 4pt — matches native padding; the 34pt
    //     home-indicator area sits below this on Face ID phones automatically,
    //     which is why native bottom padding is small.
    //   • Horizontal gap between keys 6pt (native constant) — set per-row below.
    //   • Vertical gap between rows 10pt — inside Apple's measured ~10–12pt.
    //   • Row/key height 44pt (set per-row below) — matches a modern iPhone's
    //     ~43–46pt key. (Was 50pt "for a roomier feel"; that read taller than
    //     native, especially on smaller phones.)
    style: { paddingLeft: 3, paddingRight: 3, paddingTop: 8, paddingBottom: 4, gap: 10 },
    children: [
      // Suggestion bar — populated by state.suggestions when we start emitting
      // predictions. Empty right now; visibleIf hides the strip so it doesn't
      // eat vertical space. Height 44pt matches Apple's QuickType bar exactly
      // (measured against multiple developer sources).
      {
        type: "SuggestionBar",
        style: { height: 44 },
        visibleIf: { truthy: "state.hasSuggestions" },
      },

      // Status label + waveform intentionally removed — the mic button's own
      // orange press state + the flash-across-keys animation on refined-text
      // arrival provide all the "is something happening?" feedback we need.
      // A separate status band above the tone chips just adds vertical noise
      // and makes error strings ("Error: 401 …") loud when we want the
      // keyboard to feel calm.

      // Tulmi's tools bar — emitted twice: one dark palette variant and one
      // light palette variant, gated by state.appearance. The Swift renderer's
      // theme.key / theme.keyText auto-flip for letter keys, but style.bg hex
      // literals like KEY_FILL_FUNCTION don't — so a single tree using dark
      // hex reads as dark ovals on a light backdrop. Two variants means the
      // right palette shows up regardless of the OS trait.
      //
      // 44pt matches Apple's suggestion-bar height so tools reads as sitting
      // at the vertical rhythm the OS uses when its own predictive bar would be.
      // Dark-mode tools row — visible when appearance is dark. state.appearance
      // is initialized to "dark" in Swift, so the eq check handles the default
      // case; no need for a redundant `falsy` OR (which forced two evaluations
      // per remount for zero real benefit and added latency to every keystroke).
      // Dark-mode tools row. Mic = solid brand-orange with black icon target
      // (icon renders white on current shipped Swift until the queued tint fix
      // lands — orange bg still reads confidently). Tone pill = solid dark
      // gray with a 1pt subtle border for definition.
      makeToolsRow({
        micBg: BRAND_ACCENT,
        micFg: "#000000",
        toneBg: "#2C2C2E",         // Apple systemGray5 dark — solid, no melt into blur
        toneFg: "#FFFFFF",
        toneBorderColor: "#FFFFFF29",  // 16% white — barely-there border for shape definition
        visibleIf: { neq: ["state.appearance", "light"] },
      }),
      // Light-mode tools row. Same brand orange (works in both modes). Tone
      // pill is solid white with a light-gray border for definition against
      // a light backdrop.
      makeToolsRow({
        micBg: BRAND_ACCENT,
        micFg: "#000000",
        toneBg: "#FFFFFF",
        toneFg: "#000000",
        toneBorderColor: "#00000029",   // 16% black — subtle border on light
        visibleIf: { eq: ["state.appearance", "light"] },
      }),

      // ============================ LETTER LAYER (en) =========================
      // Visible when state.layoutId is "en" (default). Prefixed with "state."
      // so Swift's condition evaluator actually resolves the value — bare
      // paths return null and everything reads as "always shown / never shown".

      // Row 1: q..p
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "en"] },
        children: letterRow1.map(kLetter),
      },
      // Row 2: a..l (indented half-key each side)
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "en"] },
        children: [kHalfSpacer(), ...letterRow2.map(kLetter), kHalfSpacer()],
      },
      // Row 3: shift, z..m (7 letters), backspace.
      // Shift + backspace are a touch SMALLER (flex 1.1) than a full function
      // key and carry an extra inner spacer, so there's a clear gap between them
      // and the outer letter keys — the letter touch-plane's reach no longer
      // overlaps the shift/backspace hit area, so edge taps don't cross over.
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "en"] },
        children: [
          { type: "ShiftKey", style: { flex: 1.35, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION } },
          { type: "Spacer", style: { flex: 0.22 } },
          ...letterRow3.map(kLetter),
          { type: "Spacer", style: { flex: 0.22 } },
          { type: "BackspaceKey", style: { flex: 1.35, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION } },
        ],
      },

      // ============================ NUMBER LAYER (123) ========================
      // Apple's iOS number page. Row 1 = digits; Row 2 = -/:;()$&@";
      // Row 3 = #+= · . , ? ! ' · backspace. Tapping "#+=" switches to the
      // symbol page; tapping "ABC" (from row 4) returns to letters.

      // Row 1: 1..0
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "123"] },
        children: ["1","2","3","4","5","6","7","8","9","0"].map(kPunct),
      },
      // Row 2: - / : ; ( ) $ & @ "
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "123"] },
        children: ["-","/",":",";","(",")","$","&","@","\""].map(kPunct),
      },
      // Row 3: [#+=] . , ? ! ' [backspace]
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "123"] },
        children: [
          {
            type: "LetterKey",
            props: { char: "#+=" },
            on: { onPress: { kind: "switchLayout", language: "sym" } },
            style: { flex: 1.5, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 15, fontWeight: "regular" },
          },
          ...[".",",","?","!","'"].map(kPunct),
          { type: "BackspaceKey", style: { flex: 1.5, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION } },
        ],
      },

      // ============================ SYMBOL LAYER (sym) ========================

      // Row 1: [ ] { } # % ^ * + =
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "sym"] },
        children: ["[","]","{","}","#","%","^","*","+","="].map(kPunct),
      },
      // Row 2: _ \ | ~ < > € £ ¥ ·
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "sym"] },
        children: ["_","\\","|","~","<",">","€","£","¥","·"].map(kPunct),
      },
      // Row 3: [123] . , ? ! ' [backspace]
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "sym"] },
        children: [
          {
            type: "LetterKey",
            props: { char: "123" },
            on: { onPress: { kind: "switchLayout", language: "123" } },
            style: { flex: 1.5, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 15, fontWeight: "regular" },
          },
          ...[".",",","?","!","'"].map(kPunct),
          { type: "BackspaceKey", style: { flex: 1.5, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION } },
        ],
      },

      // ============================ BOTTOM ROW (all layers) ===================
      //
      // Row 4 is functionally shared across every layer, but the leftmost key
      // is a mode-switcher whose LABEL and TARGET LAYOUT depend on the current
      // state.layoutId. We emit one variant per mode with visibleIf gates.
      //
      // Flex ratios: the mode-switch key (123 / ABC) is set EQUAL to the return
      // key (2.75) so the space bar sits dead-center of the row — equal flex on
      // both flanks is what centers it — and the numbers key matches the size of
      // the return/search key. The SDUI renderer honors these proportionally on
      // every screen size (Pro / Plus / Pro Max scale correctly, no hardcoded widths).

      // Mode switcher — two variants, each visibleIf-gated:

      // Row 4 (LETTER page) — 123 · space · return.
      // Emoji switcher removed: iOS's own next-keyboard button in the system
      // extension bar covers keyboard switching, and the emoji picker on the
      // system keyboard is a native shortcut users already know. Space bar
      // grows to fill the freed width.
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "en"] },
        children: [
          {
            type: "LetterKey",
            props: { char: "123" },
            on: { onPress: { kind: "switchLayout", language: "123" } },
            style: { flex: 2.75, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" },
          },
          { type: "SpaceKey", style: { flex: 7.08, bg: KEY_FILL_SPACE, fontSize: 16, fontWeight: "regular" } },
          { type: "ReturnKey", style: { flex: 2.75, bg: KEY_FILL_RETURN, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" } },
        ],
      },
      // Row 4 for the NUMBER or SYMBOL page — ABC returns to letters. Same
      // "no globe" pattern; iOS's system bar still handles keyboard switching.
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { any: [
          { eq: ["state.layoutId", "123"] },
          { eq: ["state.layoutId", "sym"] },
        ] },
        children: [
          {
            type: "LetterKey",
            props: { char: "ABC" },
            on: { onPress: { kind: "switchLayout", language: "en" } },
            style: { flex: 2.75, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" },
          },
          { type: "SpaceKey", style: { flex: 7.08, bg: KEY_FILL_SPACE, fontSize: 16, fontWeight: "regular" } },
          { type: "ReturnKey", style: { flex: 2.75, bg: KEY_FILL_RETURN, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" } },
        ],
      },
    ],
  };

  // Named actions — referenced by node `on` handlers by string name. Lets us
  // change the bound behavior of a key (e.g. what the 123 key does) without
  // editing the tree, and keeps the tree readable.
  const actions: Record<string, KeyboardActionSpec> = {
    cycleLayout: { kind: "switchLayout" },      // no language = cycle
    showLangs: { kind: "showLanguageMenu" },
    dictateStart: { kind: "startDictation" },
    dictateStop: { kind: "stopDictation" },
    refine: { kind: "runRefine" },
  };

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    // Bump so warm keyboard sessions re-fetch on next open when we push a new
    // tree; the native cache respects this the same way SduiApp does.
    cacheVersion: currentCacheVersion(),
    theme: {
      // Legacy fields — read by the pre-SDUI binary as opaque hex. New builds
      // walk `root` and ignore these once features.sdui takes over.
      //
      // theme.key IS what SDUI LetterKey nodes use when they don't set an
      // explicit `bg` in their style — so wiring the new palette here is what
      // makes the letter keys actually pick up the lighter, more translucent
      // fill instead of the legacy #48484a opaque gray.
      // Fully transparent — no our-blur, no our-fill. This lets iOS's own
      // keyboard-region backdrop show through (the "OS chrome"), which every
      // third-party keyboard sits over. Whatever the OS paints there IS what
      // the user sees behind the keys. If this reads cleaner than our applied
      // blur was, we ditch the blur entirely.
      background: "#00000000",
      key: KEY_FILL_LETTER,
      keyText: KEY_TEXT,
      // Accent used ONLY by legacy path for the shift-active indicator dot.
      // The SDUI tree above doesn't reference this — return + refine keys
      // are plain function-key styled now.
      accent: "#8E8E93",
      keyPressed: KEY_PRESSED,
      // v2 fields — used only by the SDUI renderer:
      // No backgroundEffect. When set to null, the Swift renderer skips
      // installing the UIVisualEffectView backdrop entirely — the extension
      // is truly transparent and iOS's own region backdrop is the only
      // thing behind the keys.
      keyRadius: 5,     // Apple's letter-key radius on dark mode is 5, not 6
      keyShadow: true,  // hard 1pt drop shadow — matches Apple's key depth
    },
    // v3 adaptive palettes — the SDUI-renderer build picks between these
    // based on the current userInterfaceStyle and re-renders on trait change.
    themeDark: {
      background: "#00000000",
      key: KEY_FILL_LETTER,
      keyText: KEY_TEXT,
      accent: "#8E8E93",
      keyPressed: KEY_PRESSED,
      keyRadius: 5,
      keyShadow: true,
    },
    themeLight: {
      // Fully transparent — no our-backdrop. Keys sit directly on whatever
      // iOS composits behind the keyboard region (usually a subtle light-gray
      // system chrome). This is the "no sheet, keys on the base surface"
      // pattern — same as themeDark. Removed backgroundEffect so we don't
      // paint our own blur that would double-tint the light system chrome.
      background: "#00000000",
      key: LIGHT_KEY_FILL_LETTER,
      keyText: LIGHT_KEY_TEXT,
      accent: "#8E8E93",
      // Same brand-orange press flash as dark mode — the moment of tap
      // reads as the Tulmi accent regardless of appearance.
      keyPressed: KEY_PRESSED,
      keyRadius: 5,
      keyShadow: true,
    },
    // Layouts array stays populated for the legacy path. Adding a new language
    // here + shipping a matching { type: "LetterKey" } tree gets the new SDUI
    // keyboard when we generate per-language roots.
    // Every layout the mode-switcher on row 4 can jump to. The SDUI-renderer
    // build's switchLayout(language:) validates against this list; the legacy
    // path still renders the "en" entry (never sees the 123/sym metadata).
    layouts: [
      {
        language: "en",
        displayName: "English",
        rows: [
          letterRow1,
          letterRow2,
          ["{shift}", ...letterRow3, "{backspace}"],
          ["{globe}", "{mic}", "{refine}", "{space}", "{return}"],
        ],
      },
      { language: "123", displayName: "Numbers", rows: [] },
      { language: "sym", displayName: "Symbols", rows: [] },
      { language: "emoji", displayName: "Emoji", rows: [] },
    ],
    features: {
      voice: true,
      refine: true,
      streaming: false,
      // Android ONLY: record + live-stream the mic directly IN the keyboard
      // (an Android IME can hold the mic in-process, unlike an iOS extension).
      // So Android needs no Flow Session and no arming screen — tap the mic and
      // dictate, words appear live. iOS ignores this and uses kb.mic.mode="flow"
      // (the background-audio path) since iOS forbids extension recording.
      liveVoice: true,
      // The switch: capable binaries walk root+actions; older ones fall through
      // to the hand-built layout.
      sdui: true,
    },
    labels: {
      refine: "✨ Refine",
      listening: "Listening…",
      transcribing: "Transcribing…",
      refining: "Refining…",
      space: "space",
      return: "return",
      needFullAccess: "Enable Full Access to use voice + Refine.",
      language: "Language",
      // Branded, non-technical status text (both keyboards fall back to these
      // exact strings if the backend omits them — editing here re-words them
      // over-the-air, no rebuild). 444 = mic/capture failed ("not listening");
      // 222 = backend/processing failed ("we'll be back").
      voice_not_listening: "444 : Not Listening",
      voice_unavailable: "222 : will let you know when we are back",
      // Flow Session (kb.mic.mode="flow", iOS). Wispr-style copy — but the mic
      // button should read as a clean, native, ICON-ONLY control (bolt → mic →
      // ✓), so ALL three flow status strings are blanked. Blank ("") means the
      // keyboard shows no hint text at all in that state — the glyph is the only
      // cue. Put any string back here (OTA, no rebuild) to reintroduce guidance:
      //   flow_start_hint → shown under the "Start Flow" (no-session) state
      //   flow_arming     → shown after the first tap opens the app to arm
      //   flow_arm_manual → shown when iOS refused the auto-open (open by hand)
      flow_start_hint: "",
      flow_arming: "",
      // Kept blank — the keyboard stays icon-only, no hint text over the keys
      // (user preference). A refused open is silent; the mic glyph is the only
      // cue. Put a string back here (OTA, no rebuild) to reintroduce guidance.
      flow_arm_manual: "",
    },
    root,
    actions,
    // Backend-tunable knobs. Every value here has a Swift-side default so
    // this can stay empty and everything still works; overriding any key
    // changes that specific behavior without a rebuild.
    //
    // Uncomment / add entries as needed. See shared/types/sdui.ts for the
    // full authoritative list of keys and their defaults.
    flags: (() => {
      // Assemble the flag bag. Static entries first; then splice in the mic
      // media if there's one in the media registry so the keyboard's mic
      // matches the main app's without a rebuild.
      const flags: Record<string, unknown> = {
        // Example overrides (uncomment to try):
        //
        // "kb.press.fadeMs": 120,
        // "kb.dictation.dots.color": "#E8A23C",
        // "kb.dictation.dots.birthRate": 7,
        // "kb.dictation.dots.decayMs": 2500,
        // "kb.dictation.dim.alpha": 0.45,
        // "kb.mic.recordingIcon": { sf: "pause.fill" },
        // "kb.mic.recordingIcon": { sf: "waveform" },
        // "kb.mic.recordingIcon": { emoji: "⏹" },
        // "kb.mic.recordingIcon": { url: "https://cdn.tailzu.space/kb/stop.png" },
        // "kb.mic.idleIcon": { asset: "TailzuMark" },
        // Recording particle swarm (iOS), OTA-tuned — takes effect on the
        // CURRENT installed build (these keys are read live). Tiny dots (radius
        // in pt), fewer + a larger play area (smaller inset) so they read as
        // very tiny wandering specks, not a compact blob.
        "kb.mic.particles.radius": 0.55,
        "kb.mic.particles.count": 42,
        "kb.mic.particles.inset": 4,
        // Kill the flowing dot-stream that rises off the mic while recording —
        // birthRate 0 emits nothing. Only the in-button swarm remains.
        "kb.dictation.dots.birthRate": 0,
        // No black dim overlay over the keys while recording — keep the keyboard
        // looking normal during dictation. (Set true / raise dim.alpha to bring
        // the focus-dim back.)
        "kb.dictation.dim.enabled": false,
        // "kb.shift.lockedColor": "#E8A23C",
        // "kb.shift.longPressMs": 350,
        // "kb.shift.iconLowerOutlined": "arrowtriangle.down",
        // Double-tap shift → caps lock (system-keyboard behavior). Window in ms
        // for the second tap; hold-to-lock still works too. Default 300.
        // "kb.shift.doubleTapMs": 300,
        // "kb.delete.repeatIntervalMs": 90,
        // "kb.autoCap.enabled": true,
        // "kb.smartPunctuation": true,
        // Key-pop callout — the native magnified bubble above a pressed letter.
        // On by default; every value below has a native default in Swift, so
        // these only need setting to OVERRIDE. iOS-only.
        //   kb.callout.enabled  (bool, default true) — set false to disable the pop
        //   kb.callout.bg       (hex) — balloon fill; default white (light theme)
        //                         / lighter-than-key gray (dark theme)
        //   kb.callout.text     (hex) — glyph color; default near-black / white
        // "kb.callout.enabled": true,
        // "kb.callout.bg": "#FFFFFF",
        // "kb.callout.text": "#111111",
        // Multi-touch / rolling key plane (iOS). Routes the character keys
        // through the custom KeyPlaneView for true rolling + two-thumb typing +
        // gap routing (the fast-typing gap vs the system keyboard). iOS-only —
        // Android ignores this flag.
        // Re-enabled after hardening the plane's key detection: it now re-derives
        // the key rects at the start of every touch (touchesBegan → refreshFrames)
        // instead of trusting a layout-time cache that could go stale and
        // mis-detect keys — the earlier "only a dead-center tap types" cause.
        // The same build also carries the hit-slop per-button grid, so this flag
        // is a clean OTA A/B switch: false falls straight back to that grid
        // (which also restores accent long-press trays) if a device ever shows
        // trouble — no rebuild needed.
        "kb.keyPlane.enabled": true,
        // Debug build stamp (orange "K1" in the keyboard's corner). The Swift
        // default is FALSE so store builds never show it. To verify a fresh
        // binary + live OTA delivery in one shot: flip this to true + cache
        // bump — the stamp appearing proves both — then flip back off.
        "kb.buildStamp.enabled": true,
        // Idle mic mark inset (points). The TailzuMark spans its full canvas
        // width, so 0 makes the "structure" touch the button's side walls
        // instead of sitting small in the middle. OTA-tunable — takes effect on
        // the current build without a rebuild.
        "kb.mic.idleIconInset": 0,
        // Mic mode (iOS only — Android reads `liveVoice` and records in-process,
        // which iOS extensions CANNOT do). iOS blocks microphone recording
        // inside a keyboard extension: even with Full Access,
        // AVAudioRecorder.record() returns false ("doesn't have entitlements to
        // record audio"). So the working iOS path is a background-audio "Flow
        // Session" (the Wispr Flow model): the first mic tap opens the app,
        // which holds the mic alive in the BACKGROUND; the user swipes back and
        // then dictations run from the keyboard without leaving it, until the
        // session idles out. See FlowSessionManager / TulmiFlow. Requires the
        // native flow code in the build. OTA-flippable to "handoff" (open app
        // per dictation) / "local" / "stream".
        "kb.mic.mode": "flow",
        // How long a Flow Session stays live (mic held in the background) with
        // no dictation before it must be re-armed by re-opening the app.
        // Wispr's default is 5 min; raise for fewer app hops.
        "kb.flow.idleTimeoutMs": FLOW_IDLE_TIMEOUT_MS,
        // Flow mic button glyphs (SF Symbol names). Wispr's exact model:
        //   startGlyph → shown when NO session is live (the "Start Flow" state;
        //                first tap opens the app to arm).
        //   stopGlyph  → shown WHILE recording (tap it to finish — Wispr's ✓).
        // The armed-idle state uses the normal mic/brand mark. OTA-tunable.
        "kb.flow.startGlyph": "bolt.fill",
        "kb.flow.stopGlyph": "checkmark",
        // Dictation "button logic" — WHEN the words hit the field. This is the
        // one knob that flips live-vs-after-stop without a rebuild (once the
        // reader is in the build; build 39+):
        //   true  → words paint the field LIVE as you speak (streaming feel)
        //   false → nothing shows until you STOP; then the whole utterance lands
        //           in one block (cleaner, no half-formed words on the typepad)
        // Governs iOS Flow, the iOS in-keyboard stream, and Android liveVoice
        // alike. Note a batch provider (Groq) has no interim partials to begin
        // with, so it already behaves as after-stop; this flag is what lets a
        // STREAMING provider (Deepgram) ALSO defer to after-stop. Default here is
        // false to match "don't show text while recording — wait for stop".
        "kb.mic.liveText": false,
      };

      // Mic media: whatever the media registry has under `mic.animation`
      // becomes the keyboard's idle mic art. The SDUI-rendered keyboard
      // reads kb.mic.idleIcon (icon spec shape) and the hand-built keyboard
      // reads kb.mic.idleIcon.url (raw string) — surface both so a single
      // upload lights up both codepaths without either needing a rebuild.
      // Files are content-addressed by SHA, so a new upload with the same
      // key auto-invalidates the on-disk cache once the URL changes.
      const reg = getMediaRegistryFn?.() ?? {};
      const micIdle = reg["mic.animation"];
      const micRecording = reg["mic.animation.recording"];
      if (micIdle?.url) {
        flags["kb.mic.idleIcon"] = { url: micIdle.url };
        flags["kb.mic.idleIcon.url"] = micIdle.url;
      }
      if (micRecording?.url) {
        flags["kb.mic.recordingIcon"] = { url: micRecording.url };
        flags["kb.mic.recordingIcon.url"] = micRecording.url;
      }

      // Personality quick-swap: the user's pinned presets (max 6) render as
      // a chip row above the keyboard rows. Each chip carries the preset id
      // + a display emoji + a short name; tapping it sets the active
      // preset for subsequent refine calls. The active preset id is passed
      // through too so the current chip can highlight without an extra
      // fetch. When the user hasn't picked anything, the built-in tone
      // cycle stays as the fallback (that's the client-side default).
      const pinnedIds = Array.isArray(personality?.pinnedPresetIds)
        ? personality!.pinnedPresetIds!
        : [];
      if (pinnedIds.length > 0) {
        const chips = pinnedIds
          .map((id) => PERSONALITY_PRESETS.find((p) => p.id === id))
          .filter((p): p is (typeof PERSONALITY_PRESETS)[number] => !!p)
          .slice(0, MAX_PINNED_PRESETS)
          .map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, tone: p.defaultTone }));
        flags["kb.personality.pinned"] = chips;
      }
      if (personality?.activePresetId) {
        flags["kb.personality.activeId"] = personality.activePresetId;
      }
      if (personality?.activeTone) {
        flags["kb.personality.activeTone"] = personality.activeTone;
      }
      // Fast-tone list for the long-press tone sheet (iOS + Android read
      // `kb.personality.tones`). Rich `{ id, label }` shape so the clients apply
      // the exact tone id (→ per-tone refine) and the labels/order/set are fully
      // backend-controlled — rename, reorder, or add a tone with no app update.
      flags["kb.personality.tones"] = (
        Object.keys(TONE_LABELS) as Array<keyof typeof TONE_LABELS>
      ).map((id) => ({ id, label: TONE_LABELS[id] }));
      return flags;
    })(),
    // Was 600 (10 min). A live theme fix couldn't reach users mid-session.
    // 60 s keeps cost negligible and lets themed rollouts hit within a minute.
    cacheTtlSeconds: 60,
  };
}
