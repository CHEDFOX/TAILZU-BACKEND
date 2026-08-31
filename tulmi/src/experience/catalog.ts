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
import { applyRollouts, activeRollouts } from "./rollout.js";
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
  // GOLDEN SCALE (φ via the Fibonacci ladder 5·8·13·21·34·55): every spacing
  // step and type size in the app comes off this ladder, so screens compose
  // on one ratio instead of ad-hoc values.
  space: { xs: 5, sm: 8, md: 13, lg: 21, xl: 34, content: 21, contentTop: 34 },
  radius: { sm: 8, md: 13, card: 18, pill: 999 },
  font: {
    // Headings render in a serif (set per-platform in the renderer); body is sans.
    // Ladder pairs: 13/21 captions, 15 body, 21 lg, 26/34 h1, 34 brand display.
    sizes: { overline: 11, caption: 13, label: 13, body: 15, lg: 21, h1: 26, brand: 34 },
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

/**
 * Transport for a Flow dictation: "stream" (socket, live) or "oneshot"
 * (buffer + one POST at stop). Env-overridable so the switch can be thrown
 * without a deploy; see kb.flow.transport for the trade-off.
 */
const FLOW_TRANSPORT = process.env.FLOW_TRANSPORT === "oneshot" ? "oneshot" : "stream";

/**
 * Whether the sign-in gate offers SMS. Env-gated so it can be turned on the
 * moment Twilio is verified in Supabase, without a deploy — and turned off just
 * as fast if SMS delivery goes bad in a region.
 */
const AUTH_ENABLE_PHONE = process.env.AUTH_ENABLE_PHONE === "true";

/**
 * When the intro plays: "firstRun" (default), "everyLaunch", or "never".
 *
 * firstRun means "until they finish onboarding" — the cinematic belongs to
 * meeting the product, and a returning user opening the app to write something
 * does not want to sit through it.
 */
const INTRO_PLAY_WHEN =
  process.env.INTRO_PLAY_WHEN === "everyLaunch" ? "everyLaunch"
  : process.env.INTRO_PLAY_WHEN === "never" ? "never"
  : "firstRun";

/**
 * Free words per month, mirrored from the same env the server enforces
 * (FREE_MONTHLY_WORDS). Read here so the number the app SHOWS and the number
 * the server ENFORCES can never drift — one source, two readers.
 */
const FREE_MONTHLY_WORDS = Number(process.env.FREE_MONTHLY_WORDS ?? 2500) || 0;

const NAV: NavigationShell = {
  kind: "tabs",
  // Settings is no longer a bottom tab — it's reached via the ⚙ gear in the
  // top-right of the header (client renders it on the tab roots). The settings
  // screen itself still exists at screenId "settings" and is pushed on tap.
  tabs: [
    // Home IS the training surface — refine, pick the version that sounds
    // like you, and the style portrait learns from every pick.
    { id: "home", title: "Train", screenId: "home" },
    { id: "stats", title: "Stats", screenId: "stats" },
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

export function buildBootstrap(
  opts: { onboarded?: boolean; profileComplete?: boolean } = {},
): BootstrapResponse {
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
    initialScreenId: pickInitialScreenId(
      !!opts.onboarded,
      !!getMediaRegistryFn?.()?.["intro"]?.url,
    ),
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
        // The free tier, in WORDS REFINED per month. The app reads this to show
        // progress and to know when to put the paywall in front of someone —
        // without it the client has to guess the number, and a guess that
        // disagrees with the server means a user hitting a wall the UI never
        // warned them about. 0 = unlimited.
        "quota.freeMonthlyWords": FREE_MONTHLY_WORDS,
        "paywall.showAfterOnboarding": false,
        "paywall.config": PAYWALL_CONFIG as unknown as Record<string, unknown>,

        // Show the native language picker (client-side gliding-greeting screen)
        // right after auth for users who haven't picked a language yet. The
        // flow is: auth → language → "onboarding" (voice permission) →
        // "onboarding_keyboard" (enable keyboard → Settings) → home.
        // postLanguageScreenId is intentionally unset: after the pick the
        // client falls through to initialScreenId, which is "onboarding" for
        // new users and "home" for returning ones.
        "needsLanguagePick": true,

        // IN-APP mic capture mode — the app's counterpart to the keyboard's
        // kb.mic.mode, so both surfaces are switchable from here with no app
        // update:
        //   "oneshot" — tap, speak, tap stop; the whole clip is transcribed at
        //               once. Slower to first word, but it's the path that
        //               runs multi-engine fusion, so it's the most ACCURATE.
        //   "live"    — words appear while speaking (WebSocket). Feels faster;
        //               single engine, no fusion.
        // Which engine backs "live" is a separate SERVER-side choice
        // (STT_LIVE_PROVIDER) and needs no client flag at all.
        "voice.mode": "oneshot",

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
        // Whether the name + gender card has been filled in, ANSWERED BY THE
        // SERVER. It used to be a flag in the phone's own storage, which meant
        // a reinstall or a second device asked the same user again. Their
        // answers live on the profile now, so this follows the account.
        "profile.complete": opts.profileComplete === true,
        // SMS sign-in. The auth gate runs BEFORE there is a session, so it
        // reads this from the (auth-optional) bootstrap. Off until an SMS
        // provider is actually live in Supabase — turning it on without one
        // gives every user who picks the phone pill a dead end.
        "auth.enablePhone": AUTH_ENABLE_PHONE,
        "kb.flow.armOnForeground": true,
        "kb.flow.idleTimeoutMs": FLOW_IDLE_TIMEOUT_MS,
        // How each utterance travels to the server. The APP reads this when it
        // arms the session, so it must be in the boot flags as well as the
        // keyboard config — and both must say the same thing.
        "kb.flow.transport": FLOW_TRANSPORT,
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
/**
 * Where the app opens.
 *
 * The intro was unreachable until now: this returned only home/onboarding, and
 * no client code routed to "intro" either — so the screen existed, the media
 * key existed, and nothing could ever play it. Uploading a file would not have
 * helped, which is the confusing part of that kind of bug.
 *
 * It plays only when a file is actually there. An intro slot with nothing in it
 * must not cost the user a black screen on the way in.
 */
function pickInitialScreenId(onboarded: boolean, introReady: boolean): string {
  const play = introReady && (
    INTRO_PLAY_WHEN === "everyLaunch" ||
    (INTRO_PLAY_WHEN === "firstRun" && !onboarded)
  );
  if (play) return "intro";
  return onboarded ? "home" : "onboarding";
}

/**
 * Post-splash intro — a pure SDUI screen. ONE piece of media (the `intro`
 * key), played inside the same circular white plate the in-app mic wears, on
 * black. Same shape, same size: the first thing a user sees is the thing
 * they will be tapping every day.
 *
 * The same `intro` key already gates whether the intro plays at all
 * (flags["intro.media"] in the bootstrap), so uploading one file both turns
 * the intro on and supplies it.
 *
 * Slideshow with a single frame is the player: its timer is what fires
 * onComplete, since neither a GIF nor a video reports its own length back to
 * the screen tree. That makes INTRO_PLAY_MS the intro's duration — set it to
 * roughly the length of the file you upload.
 *
 * To customize:
 *   - Swap the media:  POST /v1/media/upload?key=intro
 *   - Change duration: INTRO_PLAY_MS
 *   - Change size:     INTRO_PLATE (the plate) / INTRO_INSET (the media)
 *   - Change what comes after: the `done` action's screenId
 */
/** The onboarding hero's particle field. Larger than the mic — it is the
 *  screen's centrepiece, not a control. */
const HERO_PARTICLE = 208;

/**
 * Explicit hero overrides, as raw SDUI nodes, keyed by slot id.
 *
 * The last word on what a hero is. Set an entry here — or via the HERO_<SLOT>
 * env vars below — and that node renders instead of anything else: a video, a
 * Lottie, a stack of text, a chart, whatever the renderer knows how to draw.
 * Nothing about the surrounding screen has to change.
 *
 * Empty by default, because the built-ins are the intended look.
 */
const HERO_OVERRIDES: Record<string, Node | undefined> = {
  onboarding: parseNodeEnv("HERO_ONBOARDING"),
  paywall: parseNodeEnv("HERO_PAYWALL"),
};

/** A hero node handed in as JSON on an env var, so a hero can be swapped
 *  without a code change. Malformed JSON is ignored rather than crashing boot —
 *  a bad paste must not take the app's first screen down with it. */
function parseNodeEnv(name: string): Node | undefined {
  const raw = process.env[name];
  if (!raw?.trim()) return undefined;
  try {
    const node = JSON.parse(raw) as Node;
    if (node && typeof node === "object" && typeof node.type === "string") return node;
    console.warn(`[hero] ${name} is not an SDUI node ({ type: ... }) — ignoring.`);
  } catch (err) {
    console.warn(`[hero] ${name} is not valid JSON — ignoring.`, (err as Error).message);
  }
  return undefined;
}

/**
 * Resolve one hero slot. Three sources, highest first:
 *
 *   1. an explicit override node   (HERO_OVERRIDES / HERO_<SLOT> env)
 *   2. uploaded media              (POST /v1/media/upload?key=<mediaKeys[n]>)
 *   3. the built-in animation
 *
 * The point is that every hero on every screen answers to the same three
 * questions in the same order, so replacing one is an upload or an env var
 * rather than an edit somewhere inside a screen tree.
 */
function heroSlot(opts: {
  id: string;
  mediaKeys: string[];
  style: Record<string, unknown>;
  builtIn: Node;
  frameMs?: number;
}): Node {
  const override = HERO_OVERRIDES[opts.id];
  if (override) return { ...override, style: { ...opts.style, ...(override.style ?? {}) } };

  const reg = getMediaRegistryFn?.() ?? {};
  const frames = opts.mediaKeys
    .filter((k) => reg[k]?.url)
    .map((k) => ({ key: k }));

  if (frames.length >= 2) {
    return {
      type: "Slideshow",
      style: { ...opts.style, overflow: "hidden" },
      props: { frames, frameMs: opts.frameMs ?? 2200, loops: 0, contentFit: "cover" },
    };
  }
  if (frames.length === 1) {
    return {
      type: "Image",
      style: opts.style,
      props: { source: frames[0], contentFit: "cover" },
    };
  }
  return { ...opts.builtIn, style: { ...opts.style, ...(opts.builtIn.style ?? {}) } };
}

/** Diameter of the intro plate — the in-app mic's own size, deliberately. */
const INTRO_PLATE = 128;
/** How long the intro holds before moving on. Match your file's length. */
const INTRO_PLAY_MS = 2600;
/** Round window on black. Shared by the player and its still fallback so the
 *  two can never drift apart. */
const PLATE_STYLE = {
  width: INTRO_PLATE,
  height: INTRO_PLATE,
  borderRadius: INTRO_PLATE / 2,
  backgroundColor: "#FFFFFF",
  overflow: "hidden" as const,
};

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
          // The plate: a white circle the size of the in-app mic, clipping the
          // media to a round window. Same shape and size the user will be
          // tapping every day.
          style: PLATE_STYLE,
          props: {
            // ONE frame. Slideshow is here for its timer and its onComplete,
            // not to cycle anything.
            frames: [{ key: "intro" }],
            frameMs: INTRO_PLAY_MS,
            loops: 1,
            // cover, so the media fills the circle edge to edge rather than
            // leaving white corners inside it.
            contentFit: "cover",
          },
          on: { onComplete: "done" },
          // A bundle predating Slideshow would render nothing here AND —
          // chrome being hidden — have no header or tabs to leave by, since
          // moving forward depends entirely on onComplete. The fallback shows
          // the still in the same plate and gives the user a way out.
          fallback: {
            type: "Stack",
            style: {
              flex: 1, width: "100%", height: "100%",
              backgroundColor: "#000000",
              alignItems: "center", justifyContent: "center",
            },
            children: [
              {
                type: "Image",
                props: { source: { key: "intro" }, contentFit: "cover" },
                style: PLATE_STYLE,
              },
              {
                type: "Button",
                props: { label: "Get started", variant: "primary" },
                on: { onPress: "done" },
                style: { position: "absolute", bottom: 56 },
              },
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

  // Swappable: put keys back in PAYWALL_CONFIG.heroFrames, or set HERO_PAYWALL
  // to an SDUI node, and this becomes that instead.
  children.push(heroSlot({
    id: "paywall",
    mediaKeys: heroValid.map((f) => f.key).filter((k): k is string => !!k),
    frameMs: cfg.heroFrameMs ?? 2200,
    style: { width: "100%", aspectRatio: 1.3, borderRadius: 20, marginBottom: 20 },
    builtIn: {
      // The wordmark decoding itself out of binary. The product's claim is that
      // it turns raw noise into finished words; this is that claim made literal
      // at the moment the user is deciding whether to believe it.
      type: "BinaryReveal",
      props: {
        text: "Tailzu",
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
        props: { content: "Tailzu" },
        style: {
          backgroundColor: "#000000", color: THEME.color.primary,
          textAlign: "center", fontSize: 46, lineHeight: 200,
        },
      },
    },
  }));

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
  /** Set instead of `email` for an SMS-only account. */
  phone?: string;
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
    case "haptics":
      return hapticsScreen(ctx);
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
      return onboardingVoice();
    // "onboarding_language" removed — the language pick is the client's native
    // post-auth screen now (needsLanguagePick bootstrap flag). Unknown ids fall
    // through to null → 404, which the client surfaces gracefully.
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

  // Train picker: the user's WHOLE voice library (built-ins + their custom
  // tones), not a hardcoded tone list — tap any voice to train it. "Core
  // style" trains the tone-independent base portrait. Server-authored, so a
  // new custom voice appears here on the next screen fetch with no app update.
  const effective = applyPresetOverrides(ctx.personality.presetOverrides);
  const TONE_OPTIONS: Array<{ id: string; label: string; hint: string }> = [
    { id: "none", label: "ZU 8.8", hint: "Your own way of talking — detected, cleaned, no vibe added" },
    ...effective.map((p) => ({
      id: p.id,
      label: p.name,
      hint: (p as { tagline?: string }).tagline ?? "Custom voice",
    })),
  ];
  // Seed the pill with the voice the user actually writes with, so "just tap
  // Refine" trains what they use daily.
  const activeVoice = effective.find(
    (e) => e.id === (ctx.personality.activePresetId ?? "signature"),
  );
  // A tappable voice row inside the blurred sheet: pick it → store the id +
  // its pill label, then close the sheet. All state, so the next Refine
  // trains in that voice.
  const toneRow = (opt: { id: string; label: string; hint: string }, i: number): Node => ({
    type: "Row",
    props: { label: opt.label, value: opt.hint, chevron: false, divider: i < TONE_OPTIONS.length - 1 },
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

  // One pick action per variant slot. Order matters: snapshot the pick into
  // private keys FIRST (the endpoint body resolves at call time), then apply
  // the optimistic UI (chosen text replaces the input, variants clear), and
  // only then fire the learn call — the tap must feel instant even though the
  // portrait update is an LLM round-trip.
  const pickAction = (chosen: "variantA" | "variantB" | "variantC"): ActionRef => {
    const others = (["variantA", "variantB", "variantC"] as const).filter((v) => v !== chosen);
    return { kind: "sequence", actions: [
      { kind: "haptic", style: "success" },
      { kind: "setState", path: "_input", value: "$state.input" },
      { kind: "setState", path: "_chosen", value: `$state.${chosen}` },
      { kind: "setState", path: "_rejA", value: `$state.${others[0]}` },
      { kind: "setState", path: "_rejB", value: `$state.${others[1]}` },
      { kind: "setState", path: "input", value: `$state.${chosen}` },
      { kind: "setState", path: "variantA", value: "" },
      { kind: "setState", path: "variantB", value: "" },
      { kind: "setState", path: "variantC", value: "" },
      {
        kind: "callEndpoint",
        method: "POST",
        path: "/v1/train/pick",
        body: {
          input: "$state._input",
          chosen: "$state._chosen",
          rejectedA: "$state._rejA",
          rejectedB: "$state._rejB",
          tone: "$state.tone",
        },
        onSuccess: "learned",
        onError: "err",
      },
    ] };
  };

  // One tappable variant card. The angle rides as a small kicker so the three
  // options read as directions ("closest" / "tighter" / "warmer"), not clones.
  const variantCard = (slot: "variantA" | "variantB" | "variantC", angleKey: string): Node => ({
    type: "Card",
    visibleIf: { truthy: slot },
    style: { paddingVertical: 13, paddingHorizontal: 14, marginBottom: 8 },
    on: { onPress: pickAction(slot) },
    children: [
      { type: "Text", bind: { content: angleKey }, props: { content: "" },
        style: { fontSize: 11, fontWeight: "700", color: "$color.label", marginBottom: 5 } },
      { type: "Text", bind: { content: slot }, props: { content: "" },
        style: { fontSize: 14, lineHeight: 23, color: "$color.text" } },
    ],
  });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "home",
    title: "",
    state: {
      input: "", recording: false, refining: false,
      // Training target: which VOICE this session trains (and which the
      // variants speak in). "none" trains the core style. Seeded to the
      // user's active voice so Refine trains what they actually use.
      tone: activeVoice?.id ?? "none",
      toneLabel: activeVoice?.name ?? "ZU 8.8",
      toneSheetOpen: false,
      variantA: "", variantB: "", variantC: "",
      angleA: "", angleB: "", angleC: "",
      _train: null, _input: "", _chosen: "", _rejA: "", _rejB: "",
    },
    actions: {
      err: { kind: "toast", message: "Something went wrong. Check your connection.", tone: "error" },
      // Echoes the real reason ($event) the mic control failed — permission /
      // audio-session / transcribe failures each show their own cause.
      micError: { kind: "toast", message: "$event", tone: "error" },
      refine: { kind: "sequence", actions: [
        { kind: "haptic", style: "light" },
        { kind: "setState", path: "variantA", value: "" },
        { kind: "setState", path: "variantB", value: "" },
        { kind: "setState", path: "variantC", value: "" },
        { kind: "setState", path: "refining", value: true },
        {
          kind: "callEndpoint",
          method: "POST",
          path: "/v1/train/variants",
          body: { text: "$state.input", tone: "$state.tone", language: "auto" },
          assignTo: "_train",
          onSuccess: "gotVariants",
          onError: "variantsErr",
        },
      ] },
      gotVariants: { kind: "sequence", actions: [
        { kind: "setState", path: "refining", value: false },
        { kind: "setState", path: "variantA", value: "$state._train.variants.0.text" },
        { kind: "setState", path: "angleA", value: "$state._train.variants.0.angle" },
        { kind: "setState", path: "variantB", value: "$state._train.variants.1.text" },
        { kind: "setState", path: "angleB", value: "$state._train.variants.1.angle" },
        { kind: "setState", path: "variantC", value: "$state._train.variants.2.text" },
        { kind: "setState", path: "angleC", value: "$state._train.variants.2.angle" },
        { kind: "haptic", style: "light" },
      ] },
      variantsErr: { kind: "sequence", actions: [
        { kind: "setState", path: "refining", value: false },
        { kind: "toast", message: "Couldn\u2019t refine that. Check your connection and try again.", tone: "error" },
      ] },
      learned: { kind: "toast", message: "Learned \u2014 that\u2019s more you.", tone: "success" },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 24, paddingTop: 16 },
      children: [
        { type: "Heading", props: { content: "Train your voice" },
          style: { fontSize: 26, lineHeight: 34, color: "$color.text", marginBottom: 13 } },
        boxWithVoice("input"),
        { type: "Spacer", style: { height: 21 } },
        // Refine trigger \u2014 the brand MEDIA itself, not a text button: tap \u2192
        // it PLAYS while the variants generate \u2192 pauses when they land. An
        // mp4 upload freezes on its frame when paused; the GIF unmounts when
        // paused, revealing the static three-bar wave mark beneath. Same
        // living-mark language as the mic in the input box.
        { type: "Stack", visibleIf: { falsy: "recording" }, style: { align: "center", direction: "column", gap: 21 }, children: [
          { type: "Stack", style: { align: "center", direction: "column", gap: 8 }, children: [
            {
              type: "Card",
              on: { onPress: "refine" },
              style: {
                width: 68, height: 68, borderRadius: 34, padding: 0, borderWidth: 0,
                backgroundColor: "#E8A23C", overflow: "hidden",
                alignItems: "center", justifyContent: "center", position: "relative",
              },
              children: [
                // Static under-layer: the three-bar wave mark.
                { type: "Stack", style: { direction: "row", gap: 4, alignItems: "center" }, children: [
                  { type: "Stack", style: { width: 4, height: 11, borderRadius: 2, backgroundColor: "#FFFFFF" } },
                  { type: "Stack", style: { width: 4, height: 21, borderRadius: 2, backgroundColor: "#FFFFFF" } },
                  { type: "Stack", style: { width: 4, height: 11, borderRadius: 2, backgroundColor: "#FFFFFF" } },
                ] },
                {
                  type: "Video",
                  bind: { playing: "refining" },
                  props: { source: micIdle, loop: true, muted: true, contentFit: "cover" },
                  style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
                  // Old bundles rendered Video as a text stub \u2014 hide it there;
                  // the wave-mark circle alone stays a perfectly good button.
                  fallback: { type: "Spacer", style: { height: 0 } },
                },
              ],
            },
            { type: "Text", visibleIf: { falsy: "refining" }, props: { content: "Refine" },
              style: { fontSize: 11, fontWeight: "600", color: "$color.muted", letterSpacing: 0.5 } },
            { type: "Text", visibleIf: { truthy: "refining" }, props: { content: "Refining\u2026" },
              style: { fontSize: 11, fontWeight: "600", color: "$color.muted", letterSpacing: 0.5 } },
          ] },
          // Voice pill \u2014 which voice this session trains. A full golden step
          // (21) away from the trigger so the two reads never crowd.
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
        { type: "Spacer", style: { height: 21 } },
        { type: "Text", visibleIf: { truthy: "variantA" },
          props: { content: "Which sounds most like you?" },
          style: { fontSize: 13, fontWeight: "700", color: "$color.label", marginBottom: 10 } },
        variantCard("variantA", "angleA"),
        variantCard("variantB", "angleB"),
        variantCard("variantC", "angleC"),
        // Blurred tone-picker sheet \u2014 pick which tone to train.
        {
          type: "Modal",
          bind: { open: "toneSheetOpen" },
          props: { blur: true, blurIntensity: 55, dismissable: true },
          children: [
            { type: "Text", props: { content: "Pick a voice to train" }, style: { fontSize: 18, fontWeight: "700", color: "#FFFFFF", textAlign: "center", marginBottom: 12 } },
            ...TONE_OPTIONS.map(toneRow),
          ],
        },
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
    actions: {
      endFlow: {
        kind: "sequence",
        actions: [
          { kind: "endFlowSession" },
          { kind: "toast", message: "Background microphone turned off.", tone: "success" },
        ],
      },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 24 },
      children: [
        mediaCard("Voice", "Your tones & presets", "card.voice", "voices"),
        { type: "Spacer", style: { height: 18 } },
        mediaCard("Dictionary", "Words & shortcuts you add", "card.dictionary", "dictionary"),
        { type: "Spacer", style: { height: 18 } },
        // Same card treatment as the two above, so the third one does not read
        // as an afterthought. Its media slot is "card.haptics" — upload to that
        // key and it fills, exactly like Voice and Dictionary.
        mediaCard("Haptics", "Choose which keys buzz", "card.haptics", "haptics"),
        { type: "Spacer", style: { height: 34 } },
        // MOVED here from Settings, not removed. App Review 2.5.4 requires a
        // background capture to be stoppable without force-quitting the app,
        // and this is the only control that does it. It sits on the tab that
        // owns the user's voice, which is a more findable home than a legal
        // list anyway.
        {
          type: "Button",
          props: { label: "Turn off background microphone", variant: "secondary" },
          on: { onPress: "endFlow" },
          style: { width: "100%" },
        },
        { type: "Spacer", style: { height: 8 } },
        {
          type: "Paragraph",
          props: {
            content: "Tailzu holds the microphone in the background so the keyboard can dictate without reopening the app. This ends that session.",
          },
          style: { fontSize: 13, lineHeight: 21, color: "$color.muted" },
        },
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
  const pinned = Array.isArray(p.pinnedPresetIds) ? p.pinnedPresetIds : [];
  // The keyboard set, in pin order; ids whose preset was deleted are dropped.
  const kbVoices = pinned
    .map((id) => effective.find((e) => e.id === id))
    .filter((e): e is (typeof effective)[number] => !!e);

  // Small trailing button on a row. Nested pressables win over the row press
  // (standard RN nesting), so these never also activate the voice.
  const rowBtn = (label: string, onPress: ActionRef): Node => ({
    type: "Button",
    props: { label, variant: "secondary" },
    style: { paddingVertical: 6, paddingHorizontal: 12 },
    on: { onPress },
  });
  const pinAction = (presetId: string, pinnedFlag: boolean): ActionRef => ({
    kind: "sequence",
    actions: [
      { kind: "haptic", style: "selection" },
      {
        kind: "callEndpoint",
        method: "POST",
        path: "/v1/personality/pin",
        body: { presetId, pinned: pinnedFlag },
        onSuccess: "pinChanged",
        onError: "pinErr",
      },
    ],
  });

  // One voice row. Tap = make it the ACTIVE voice (what refine writes with);
  // the trailing buttons manage the keyboard set / open the editor.
  const voiceRow = (preset: (typeof effective)[number], where: "kb" | "all"): Node => {
    const isActive = preset.id === activeId;
    const isPinned = pinned.includes(preset.id);
    return {
      type: "Card",
      style: { paddingVertical: 12, paddingHorizontal: 14, marginBottom: 6 },
      on: { onPress: { kind: "sequence", actions: [
        { kind: "haptic", style: "selection" },
        {
          kind: "callEndpoint",
          method: "PUT",
          path: "/v1/personality",
          // Carry the voice's tone along so the keyboard's tone pill follows
          // the voice instead of keeping a stale tone.
          body: {
            activePresetId: preset.id,
            ...(preset.defaultTone ? { activeTone: preset.defaultTone } : {}),
          },
          onSuccess: "activated",
          onError: "activateErr",
        },
      ] } },
      children: [
        {
          type: "Stack",
          style: { direction: "row", alignItems: "center", gap: 10 },
          children: [
            { type: "Text", props: { content: preset.name }, style: {
              flex: 1,
              fontSize: 16,
              fontWeight: isActive ? "800" : "600",
              color: isActive ? "$color.primary" : "$color.text",
            } },
            ...(isActive
              ? [{ type: "Text", props: { content: "Active" }, style: {
                  fontSize: 11, fontWeight: "700", color: "$color.primary",
                } } as Node]
              : []),
            ...(where === "kb"
              ? [rowBtn("Remove", pinAction(preset.id, false))]
              : [
                  // Already-pinned voices are managed from the keyboard card,
                  // so the library row only offers Add when it's not there yet.
                  ...(!isPinned ? [rowBtn("Add", pinAction(preset.id, true))] : []),
                  rowBtn("Edit", { kind: "navigate", screenId: "tone_edit", params: { presetId: preset.id } }),
                ]),
          ],
        },
      ],
    };
  };

  // Card 1 — the voices that show on the keyboard (the pinned set, max 6).
  const keyboardCard: Node = {
    type: "Card",
    style: { padding: 14, marginBottom: 16 },
    children: [
      { type: "Overline", props: { content: "Keyboard voices" }, style: { marginBottom: 4 } },
      { type: "Paragraph", props: { content: kbVoices.length
          ? "These are on your keyboard — up to 6. Tap one to write with it now; Remove takes it off the keyboard (it stays in All voices)."
          : "Nothing on the keyboard yet — Add a voice from All voices below, or create a new one." },
        style: { fontSize: 12, marginBottom: 10 } },
      ...kbVoices.map((e) => voiceRow(e, "kb")),
      gap(4),
      // Creates a tone AND pins it in one save — it lands in All voices too.
      { type: "Button", props: { label: "＋  New voice for keyboard", variant: "secondary" }, on: { onPress: "addKbTone" } },
    ],
  };

  // Card 2 — the whole library.
  const allCard: Node = {
    type: "Card",
    style: { padding: 14 },
    children: [
      { type: "Overline", props: { content: "All voices" }, style: { marginBottom: 4 } },
      { type: "Paragraph", props: { content: "Your whole library. Add puts a voice on the keyboard; Edit changes how it writes." },
        style: { fontSize: 12, marginBottom: 10 } },
      ...effective.map((e) => voiceRow(e, "all")),
      gap(4),
      { type: "Button", props: { label: "＋  Add a tone", variant: "secondary" }, on: { onPress: "addTone" } },
    ],
  };

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
      // Same, but the save also pins the new tone to the keyboard set.
      addKbTone: { kind: "sequence", actions: [
        { kind: "haptic", style: "selection" },
        { kind: "navigate", screenId: "tone_edit", params: { pin: true } },
      ] },
      // A voice was made active: confirm + re-render so the "Active" badge
      // moves. The keyboard picks it up on its next config fetch.
      activated: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "refresh" },
      ] },
      activateErr: {
        kind: "toast",
        tone: "error",
        message: "Couldn't switch voices — check your connection and try again.",
      },
      // Keyboard set changed (Add/Remove): re-render both cards.
      pinChanged: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "refresh" },
      ] },
      pinErr: {
        kind: "toast",
        tone: "error",
        message: "Couldn't update the keyboard voices — check your connection and try again.",
      },
    },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24 },
      children: [
        { type: "Heading", props: { content: "Voice" }, style: { fontSize: 30, fontWeight: "800", color: "$color.text", marginBottom: 6 } },
        { type: "Paragraph", props: { content: "Tap a voice to write with it. Keyboard voices are the ones you can switch between right on the keyboard." }, style: { fontSize: 13, marginBottom: 16 } },
        keyboardCard,
        allCard,
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
  // Opened from the "New voice for keyboard" button — the save also pins the
  // tone to the keyboard set (it lands in All voices either way).
  const pinOnSave = ctx.params?.pin === true || ctx.params?.pin === "true" || ctx.params?.pin === "1";
  const effective = applyPresetOverrides(ctx.personality.presetOverrides);
  const preset = presetId ? effective.find((e) => e.id === presetId) : undefined;
  const isBuiltin = !!presetId && PERSONALITY_PRESETS.some((b) => b.id === presetId);
  const gap = (h: number): Node => ({ type: "Spacer", style: { height: h } });

  // Save body: bake the id when editing; omit it when creating (backend mints a
  // custom id). $state.name / $state.prompt are the two fields.
  const saveBody: Record<string, unknown> = { name: "$state.name", promptStyle: "$state.prompt" };
  if (presetId) saveBody.id = presetId;
  if (pinOnSave) saveBody.pin = true;

  const label = (t: string): Node => ({ type: "Overline", props: { content: t }, style: { marginBottom: 8 } });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "tone_edit",
    title: preset ? `Edit ${preset.name}` : pinOnSave ? "New keyboard voice" : "New tone",
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
          props: { content: "Rename it or reshape how it writes. Reset any time to bring the original back." },
          style: { fontSize: 13, color: "$color.muted", marginBottom: 20 } },

        label("Name"),
        { type: "TextField", bind: { value: "editName" }, props: { placeholder: "Voice name" } },
        gap(16),

        label("Emoji"),
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
          { kind: "toast", message: "Couldn't draft. Check Connection + your key.", tone: "error" },
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
      // openHistory / historyOn removed with the rows that fired them —
      // Settings no longer has a History entry or a retention toggle. History
      // stays reachable from Stats, which keeps its own openHistory alias.
      err: { kind: "toast", message: "Couldn't save that. Try again.", tone: "error" },
    },
    root: {
      type: "Screen",
      children: [
        // Left-aligned title, tighter gap. The prior right-aligned title with a
        // 64 px gap made the list appear to be missing when the first rows fell
        // just below the fold.
        { type: "Heading", props: { content: "Settings" }, style: { fontSize: 30, fontWeight: "800", color: "$color.text", marginBottom: 20 } },

        // Personality and Stats are BOTTOM TABS — listing them here too was
        // two doors to one room. Dictionary is reached from the You tab.
        //
        // History and "Keep my history" are gone from Settings by owner
        // decision. NOTE the consequence, because it is not cosmetic: the
        // retainHistory consent flag now has NO switch anywhere in the app, so
        // it stays at its default of OFF, nothing is ever written to
        // cleanup_history, and the History screen — still reachable from Stats
        // — will always be empty. The screen and its endpoint are left intact
        // so restoring the toggle is a backend edit if that is wanted later.

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

  const wordsMonth = stats?.wordsOut ?? usage.month.words;
  const sessions = stats?.requests ?? usage.month.requests;
  // Same 40 wpm baseline the /v1/stats endpoint uses (see history/store.ts).
  const minutesSaved = stats?.minutesSaved ?? Math.max(0, Math.round(usage.total.words / 40));
  const typingMinutes = Math.max(1, Math.round((stats?.wordsOut ?? usage.total.words) / 40));
  const hasData = sessions > 0;

  // A small metric tile (StatCard v3 node, plain KeyValue fallback for old
  // bundles).
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
  const kv = (label: string, value: string): Node => ({ type: "KeyValue", props: { label, value } });

  // 14-day words bar chart; Text sparkline fallback for old bundles.
  const wordsBars = (stats?.wordsPerDay ?? stats?.sparklinePerDay ?? []).slice(-14)
    .map((v) => ({ label: "", value: Math.max(0, Number(v) || 0) }));
  const sparklineText = renderSparkline(stats?.wordsPerDay ?? stats?.sparklinePerDay);

  // "How you write" — words by capture kind.
  const kindData = [
    { label: "Voice", value: stats?.kindWords?.voice ?? 0, color: "#E8A23C" },
    { label: "Typed", value: stats?.kindWords?.typing ?? 0, color: "#6EA8FE" },
    { label: "Drafts", value: stats?.kindWords?.draft ?? 0, color: "#48D39A" },
  ];
  const kindTotal = kindData.reduce((s, d) => s + d.value, 0);

  // "When you write" — sessions by local time of day.
  const dp = stats?.daypartSessions;
  const daypartData = [
    { label: "Morning", value: dp?.morning ?? 0, color: "#F2C078" },
    { label: "Afternoon", value: dp?.afternoon ?? 0, color: "#E8A23C" },
    { label: "Evening", value: dp?.evening ?? 0, color: "#B98CFF" },
    { label: "Night", value: dp?.night ?? 0, color: "#6EA8FE" },
  ];
  const daypartTotal = daypartData.reduce((s, d) => s + d.value, 0);

  // "Where you write" — top apps by words.
  const appData = (stats?.topApps ?? []).map((a, i) => ({
    label: a.app,
    value: a.words,
    // Amber leads; the rest of the categorical set follows in rank order.
    color: ["#E8A23C", "#6EA8FE", "#48D39A", "#F0736A", "#B98CFF", "#7DD3FC"][i % 6],
  }));
  const appTotal = appData.reduce((s, d) => s + d.value, 0);

  const streak = stats?.currentStreak ?? 0;
  const bestStreak = Math.max(streak, stats?.bestStreak ?? 0);

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "stats",
    title: "Stats",
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
        spacer(13),
        // Headline tiles — golden ladder spacing (8·13·21·34).
        {
          type: "Stack",
          style: { direction: "row", gap: 8 },
          children: [
            stat("Minutes saved", minutesSaved.toLocaleString()),
            stat("Sessions", sessions.toLocaleString()),
          ],
        },
        spacer(8),
        {
          type: "Stack",
          style: { direction: "row", gap: 8 },
          children: [
            stat("Day streak", String(streak)),
            stat("Active days", String(stats?.daysActive ?? 0)),
          ],
        },
        spacer(21),
        ...(hasData ? [] : [{
          type: "Card",
          children: [
            { type: "Paragraph", props: { content: "Your stats build as you write. Dictate or refine a few messages and this page fills with charts — words per day, streaks, where and when you write." }, style: { marginBottom: 0 } },
          ],
        } as Node, spacer(21)]),
        // Words per day — the last 14 days.
        ...(wordsBars.some((b) => b.value > 0) ? [chartCard(
          "Words per day — last 14 days",
          {
            type: "BarChart",
            props: { series: wordsBars, color: "#E8A23C" },
            style: { height: 110 },
          },
          text(sparklineText, "body", { style: { fontSize: 22, letterSpacing: 2 } }),
        ), spacer(13)] : []),
        // How you write — voice vs typed vs drafts.
        ...(kindTotal > 0 ? [chartCard("How you write", {
          type: "PieChart",
          props: {
            data: kindData,
            donut: true,
            size: 150,
            legend: "right",
            centerValue: kindTotal.toLocaleString(),
            centerLabel: "words",
          },
        }), spacer(13)] : []),
        // Where you write — top apps.
        ...(appTotal > 0 ? [chartCard("Where you write", {
          type: "PieChart",
          props: { data: appData, donut: true, size: 150, legend: "right" },
        }), spacer(13)] : []),
        // When you write — sessions by time of day.
        ...(daypartTotal > 0 ? [chartCard("When you write", {
          type: "PieChart",
          props: { data: daypartData, donut: false, size: 150, legend: "right" },
        }), spacer(13)] : []),
        // Records + averages.
        ...(hasData ? [{
          type: "Card",
          children: [
            text("Records", "label"),
            spacer(8),
            ...(stats?.bestDay ? [kv("Best day", `${stats.bestDay.words.toLocaleString()} words · ${stats.bestDay.date}`)] : []),
            kv("Average per session", `${(stats?.avgWordsPerSession ?? 0).toLocaleString()} words`),
            ...(stats?.speakingMinutes ? [kv("Speaking time", `${stats.speakingMinutes.toLocaleString()} min`)] : []),
            kv("Best streak", bestStreak > 0 ? `${bestStreak} days` : "—"),
          ],
        } as Node, spacer(21)] : []),
        {
          type: "Paragraph",
          props: {
            content:
              `Your effort: you'd have spent ${typingMinutes.toLocaleString()} minutes typing ` +
              `what Tailzu cleaned up in seconds.`,
          },
        },
        spacer(21),
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
/**
 * Words spoken vs words written, across the history rows on screen.
 *
 * wordsIn is what the user said; wordsOut is what Tailzu produced. Showing both
 * is the honest version of "look what we saved you" — the user can see the
 * whole trade rather than a number we chose.
 */
function historyBreakdown(entries: HistoryEntry[] | undefined): Array<{ label: string; value: number }> {
  const rows = entries ?? [];
  if (rows.length === 0) return [];
  const spoken = rows.reduce((n, e) => n + (e.wordsIn ?? 0), 0);
  const written = rows.reduce((n, e) => n + (e.wordsOut ?? 0), 0);
  if (spoken === 0 && written === 0) return [];
  return [
    { label: "Written", value: written },
    { label: "Spoken", value: spoken },
  ];
}

function historyScreen(ctx: ScreenContext): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "history",
    title: "History",
    state: {
      entries: ctx.history ?? [],
      loading: false,
      // Summed server-side from the same rows the list shows, so the ring and
      // the entries can never disagree.
      historyBreakdown: historyBreakdown(ctx.history),
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
        // The ease, at the top. Words SPOKEN against words WRITTEN across the
        // entries below — the gap between the two is the work Tailzu did, which
        // is the only number on this screen the user did not produce themselves.
        // Hidden when there is nothing to summarise rather than drawing an
        // empty ring.
        {
          type: "Card",
          visibleIf: { truthy: "entries" },
          style: { marginBottom: 18 },
          children: [
            text("The ease", "label", { style: { marginBottom: 12 } }),
            {
              type: "DonutChart",
              bind: { data: "historyBreakdown" },
              props: {
                donut: true,
                size: 150,
                legend: "right",
                centerLabel: "words written",
              },
            },
          ],
        },
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
                { type: "Spacer", style: { height: 10 } },
                // What was heard, then what was written. Labelled and in that
                // order, because the whole point of the pair is the difference
                // between them — unlabelled, the raw transcript reads as a
                // mistake rather than as the input.
                text("You said", "label", { style: { fontSize: 11, opacity: 0.6 } }),
                {
                  type: "Text",
                  bind: { content: "$item.input" },
                  props: { variant: "muted", numberOfLines: 3 },
                },
                { type: "Spacer", style: { height: 10 } },
                text("Tailzu wrote", "label", { style: { fontSize: 11, opacity: 0.6, color: "$color.primary" } }),
                {
                  type: "Text",
                  bind: { content: "$item.output" },
                  props: { variant: "body", numberOfLines: 6 },
                  style: { fontWeight: "600", color: "$color.text" },
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
 * Onboarding is a server-driven, two-step flow (the language pick happens
 * BEFORE it, on the client's native post-auth language screen — see the
 * `needsLanguagePick` bootstrap flag):
 *   onboarding (voice permission) → onboarding_keyboard (enable keyboard) → home
 * The keyboard step saves `onboarded` to the profile, so completion is
 * remembered server-side (not just on the device).
 */

/**
 * Onboarding step 1 — the VOICE PERMISSION screen (screenId stays "onboarding"
 * so routing — pickInitialScreenId, the intro's `done`, cached clients — is
 * untouched).
 *
 * Why mic comes before the keyboard step: iOS only gives an app a per-app
 * Settings page AFTER at least one permission has been requested. The keyboard
 * step's "Open Settings" (app-settings:) needs that page to exist — granting
 * (or even just answering) the mic prompt here is what makes the next screen
 * able to open Settings DIRECTLY.
 *
 * Both outcomes advance to the keyboard step: denial isn't a dead end (the
 * user can still type with the keyboard; voice can be enabled later in
 * Settings → Tailzu). Fully backend-authored — copy/media/flow change OTA.
 */
function onboardingVoice(): ScreenResponse {
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "onboarding",
    title: "",
    // Full-bleed: no header/back/tabs — this is the gate.
    hideChrome: true,
    state: {},
    actions: {
      // CTA — fire the system mic prompt. Either answer moves forward; the
      // permission REQUEST itself (not the grant) is what creates the per-app
      // Settings page the next screen deep-links to.
      allowMic: {
        kind: "requestPermission",
        permission: "microphone",
        onGranted: "goKeyboard",
        onDenied: "deniedNext",
      },
      goKeyboard: { kind: "navigate", screenId: "onboarding_keyboard" },
      deniedNext: {
        kind: "sequence",
        actions: [
          { kind: "toast", tone: "info", message: "You can allow the microphone anytime in Settings → Tailzu." },
          { kind: "navigate", screenId: "onboarding_keyboard" },
        ],
      },
    },
    root: {
      type: "Stack",
      // hideChrome = truly full-bleed, so the top/bottom padding IS the safe
      // area: 76 clears the status bar on notch phones, 48 clears the home
      // indicator (28/28 put the title under the clock and clipped "Not now").
      style: {
        flex: 1,
        direction: "column",
        alignItems: "center",
        backgroundColor: "#000000",
        paddingHorizontal: 28,
        paddingTop: 76,
        paddingBottom: 48,
      },
      // GOLDEN SCALE (φ ≈ 1.618, via the Fibonacci ladder 8·13·21·34·55):
      // type pairs size×φ≈lineHeight — 34/42 display (display tracks tighter),
      // 21/34 pitch, 14/23 body, 13/21 sub, 11 kicker; spacing steps come from
      // the same ladder (13, 21, 34, 55). One ratio everywhere is what makes
      // the screen read composed instead of arbitrary.
      children: [
        { type: "Overline", props: { content: "Step 1 of 2" }, style: { textAlign: "center", marginBottom: 13 } },
        {
          type: "Heading",
          props: { content: "Speak. Tailzu writes." },
          style: { textAlign: "center", fontSize: 34, lineHeight: 42, color: "$color.text", marginBottom: 0 },
        },
        // The vertical middle. Swappable: upload onboarding.hero, or set
        // HERO_ONBOARDING to an SDUI node, and this becomes that instead.
        {
          type: "Stack",
          style: { flex: 1, width: "100%", alignItems: "center", justifyContent: "center" },
          children: [heroSlot({
            id: "onboarding",
            mediaKeys: ["onboarding.hero"],
            style: { width: HERO_PARTICLE, height: HERO_PARTICLE, borderRadius: HERO_PARTICLE / 2 },
            builtIn: {
              // The mark comes apart in vacuum, holds, and springs back
              // together. This screen is asking for the microphone, so the
              // most honest illustration is the motion the microphone makes.
              type: "ParticleMark",
              props: {
                count: 160,
                dotRadius: 1.5,
                color: THEME.color.primary,
                speed: 1,
                circular: true,
                holdMark: true,
              },
              // Older bundles have no ParticleMark and would leave the middle
              // of the screen empty.
              fallback: {
                type: "Paragraph",
                props: { content: "Talk the way you talk. Tailzu turns it into clean, finished writing — in your voice." },
                style: { textAlign: "center", fontSize: 21, lineHeight: 34, fontWeight: "300", color: "$color.text", maxWidth: 300 },
              },
            },
          })],
        },
        {
          type: "Paragraph",
          props: { content: "Allow the microphone so dictation works in every app you type in." },
          style: { textAlign: "center", fontSize: 13, lineHeight: 21, marginBottom: 21 },
        },
        {
          type: "Button",
          props: { label: "Allow Microphone", variant: "primary" },
          on: { onPress: "allowMic" },
          style: { width: "100%" },
        },
        { type: "Spacer", style: { height: 13 } },
        {
          type: "Button",
          props: { label: "Maybe later", variant: "secondary" },
          on: { onPress: "goKeyboard" },
          style: { width: "100%" },
        },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/** Step 2 — enable the Tailzu keyboard, then finish (marks onboarded). */
function onboardingKeyboard(): ScreenResponse {
  // Golden body pair: 14/23 (14 × φ ≈ 22.65) — see the voice screen's scale note.
  const step = (n: string, body: string): Node => ({
    type: "Stack", style: { direction: "row", gap: 13, alignItems: "flex-start" }, children: [
      // Fixed-width number column so all five step bodies left-align.
      { type: "Text", props: { content: n }, style: { color: "$color.text", fontSize: 14, fontWeight: "700", width: 18, lineHeight: 23 } },
      { type: "Paragraph", props: { content: body }, style: { marginBottom: 0, flex: 1, fontSize: 14, lineHeight: 23 } },
    ],
  });
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "onboarding_keyboard",
    title: "",
    // Full-bleed like the voice step: without this the tab bar + back chevron
    // render, and a user who taps Home escapes onboarding WITHOUT the
    // finish/skip PUT — profile.onboarded stays false and every next launch
    // routes back into onboarding (the "voice screen forever" loop).
    hideChrome: true,
    template: "scroll",
    state: { keyboardReady: false }, // the app overwrites keyboardReady live
    actions: {
      // Prefer openUrl("app-settings:") over openSettings — same underlying
      // iOS mechanism but a different Linking code path. Critically, this
      // action only reliably opens iOS Settings AFTER at least one permission
      // has been requested — before that, iOS has no per-app Settings surface
      // and the URL resolves silently. The VOICE PERMISSION screen right
      // before this one fires that prompt, so Settings opens DIRECTLY here.
      // The leading requestPermission is an idempotent belt-and-suspenders for
      // the "Not now" path (already-decided permissions return instantly with
      // no prompt).
      openSettings: {
        kind: "sequence",
        actions: [
          { kind: "requestPermission", permission: "microphone" },
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
          // Land on You: profileGate.screenIds = ["personality"], so the
          // name/gender card is the immediate next step. Landing on Home
          // silently deferred it until the user happened to open You.
          { kind: "switchTab", tabId: "personality" },
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
      // hideChrome = full-bleed: this spacer IS the top safe area (the card
      // used to start under the status-bar clock). Golden ladder throughout —
      // 13/21/34/55 spacing, 26/34 heading, 13/21 sub, 14/23 steps.
      { type: "Spacer", style: { height: 66 } },
      { type: "Overline", props: { content: "Step 2 of 2" }, style: { marginBottom: 13 } },
      { type: "Heading", props: { content: "Add the Tailzu keyboard" },
        style: { fontSize: 26, lineHeight: 34, color: "$color.text", marginBottom: 8 } },
      { type: "Paragraph", props: { content: "One minute in Settings — after that, Tailzu writes with you in every app." },
        style: { fontSize: 13, lineHeight: 21, marginBottom: 21 } },
      // The steps card. Apple does NOT allow deep-linking into
      // Settings > Keyboards, so the button below lands on Tailzu's own
      // Settings page (which exists because the voice-permission screen just
      // fired the mic prompt). Show every navigation step so the user knows
      // the path.
      { type: "Card", style: { paddingVertical: 21, paddingHorizontal: 16 }, children: [
        step("1", "Open Settings, then tap General."),
        { type: "Spacer", style: { height: 13 } },
        step("2", "Tap Keyboard → Keyboards → Add New Keyboard."),
        { type: "Spacer", style: { height: 13 } },
        step("3", "Choose Tailzu from the list."),
        { type: "Spacer", style: { height: 13 } },
        step("4", "Tap Tailzu again and turn on “Allow Full Access”."),
        { type: "Spacer", style: { height: 13 } },
        step("5", "Return to Tailzu — the globe key switches keyboards."),
      ] },
      { type: "Spacer", style: { height: 34 } },
      // "Open Settings" (not "Open Keyboard Settings") — iOS can't deliver
      // what the old label promised; be honest about where the button lands.
      { type: "Button", visibleIf: { not: { truthy: "keyboardReady" } },
        props: { label: "Open Settings", variant: "primary" }, on: { onPress: "openSettings" } },
      { type: "Button", visibleIf: { truthy: "keyboardReady" },
        props: { label: "Start using Tailzu", variant: "primary" }, on: { onPress: "finish" } },
      { type: "Spacer", style: { height: 13 } },
      // Ghost / text-only "Skip" so users aren't trapped if they can't or
      // won't add the keyboard right now.
      { type: "Button", visibleIf: { not: { truthy: "keyboardReady" } },
        props: { label: "Skip for now", variant: "secondary" }, on: { onPress: "skip" } },
      { type: "Spacer", style: { height: 55 } },
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
          props: { content: "Flow is on" },
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


/**
 * Haptics picker — the three keyboard layouts, exactly as they are laid out on
 * the keyboard, with every key tappable.
 *
 * Selection is SERVER state, not client state. Each tap posts one key and the
 * screen refreshes, so what you see is always what the keyboard will do. The
 * alternative — mirroring the set locally and syncing later — is how a settings
 * screen ends up disagreeing with the thing it configures.
 *
 * The master toggle and the individual keys stay INDEPENDENT. Turning "all keys"
 * off must not discard the keys someone picked one by one, and the toggle reads
 * as on whenever either is true, because in both cases keys are buzzing.
 */
function hapticsScreen(ctx: ScreenContext): ScreenResponse {
  const chosen = new Set((ctx.personality?.hapticKeys ?? []).map((k) => String(k).toLowerCase()));
  const all = ctx.personality?.hapticsAll === true;

  // A key as it appears in the picker. Orange when it will buzz — including
  // when the master switch is what makes it buzz, so the screen never shows a
  // grey key that is about to vibrate.
  const pk = (label: string, id: string, flex = 1): Node => ({
    type: "Button",
    props: { label, variant: "ghost" },
    style: {
      flex,
      height: 44,
      borderRadius: 6,
      paddingHorizontal: 0,
      backgroundColor: (all || chosen.has(id)) ? "#E8A23C" : "#FFFFFF14",
      color: (all || chosen.has(id)) ? "#000000" : "$color.text",
      fontSize: label.length > 2 ? 13 : 17,
      fontWeight: "500",
    },
    on: {
      onPress: {
        kind: "sequence",
        actions: [
          { kind: "haptic", style: "selection" },
          { kind: "callEndpoint", method: "POST", path: "/v1/personality/haptics",
            body: { key: id }, onError: "err" },
          { kind: "refresh" },
        ],
      },
    },
  });

  const row = (children: Node[]): Node => ({
    type: "Stack",
    props: { direction: "horizontal" },
    style: { gap: 6, marginBottom: 6 },
    children,
  });
  const letters = (s2: string) => s2.split("").map((c) => pk(c, c));
  const gap = (flex: number): Node => ({ type: "Spacer", style: { flex } });

  const board = (title: string, rows: Node[]): Node => ({
    type: "Card",
    style: { padding: 12, borderRadius: 16, marginBottom: 16, backgroundColor: "#0b0b0f" },
    children: [
      { type: "Overline", props: { content: title },
        style: { color: "$color.muted", marginBottom: 10 } },
      ...rows,
    ],
  });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "haptics",
    title: "Haptics",
    actions: { err: { kind: "toast", message: "Couldn't save that.", tone: "error" } },
    root: {
      type: "Screen",
      style: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 32 },
      children: [
        { type: "Heading", props: { content: "Haptics" },
          style: { fontSize: 28, fontWeight: "800", color: "$color.text", marginBottom: 8 } },
        { type: "Paragraph", props: { content: "Tap any key to give it a buzz. Tap again to take it away." },
          style: { marginBottom: 20 } },
        {
          type: "Row",
          props: { label: "Every key", value: all ? "On" : "Off" },
          style: { marginBottom: 22 },
          on: {
            onPress: {
              kind: "sequence",
              actions: [
                { kind: "haptic", style: "selection" },
                { kind: "callEndpoint", method: "POST", path: "/v1/personality/haptics",
                  body: { all: !all }, onError: "err" },
                { kind: "refresh" },
              ],
            },
          },
        },
        board("Letters", [
          row(letters("qwertyuiop")),
          row([gap(0.5), ...letters("asdfghjkl"), gap(0.5)]),
          row([pk("shift", "shift", 1.35), gap(0.22), ...letters("zxcvbnm"), gap(0.22), pk("del", "backspace", 1.35)]),
          row([pk("123", "123", 2.4), pk(".", ".", 1.29), pk("space", "space", 5.2), pk("@", "@", 1.29), pk("return", "return", 2.4)]),
        ]),
        board("Numbers", [
          row(letters("1234567890")),
          row("-/:;()$&@\"".split("").map((c) => pk(c, c))),
          row([pk("#+=", "#+=", 1.5), ...".,?!'".split("").map((c) => pk(c, c)), pk("del", "backspace", 1.5)]),
        ]),
        board("Tools", [
          row([pk("mic", "mic"), pk("refine", "refine"), pk("globe", "globe")]),
        ]),
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
      // signOut lives in onSuccess, NOT after the call in a sequence: a failed
      // DELETE used to fall through to signOut anyway, so the user saw an
      // error toast, got signed out, and reasonably concluded the deletion
      // worked — a live 5.1.1(v) hazard.
      confirm: {
        kind: "callEndpoint",
        method: "DELETE",
        path: "/v1/account",
        onSuccess: "deleted",
        onError: "err",
      },
      deleted: { kind: "sequence", actions: [
        { kind: "toast", message: "Your account has been deleted.", tone: "success" },
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
    // Middle slot — the suggestion strip (autocorrect revert chip + word
    // completions, K4+ binaries). Replaces the plain spacer: when empty it
    // renders as clear space exactly like the spacer did (and pre-K4 builds
    // never populate it), so the row reads identical until chips appear
    // between the mic and the tone pill. Height 36 matches the row's inner
    // height (44 minus 4pt padding) so no constraint fight with .fill
    // alignment. kb.suggestion.height must agree (it defaults to 36).
    { type: "SuggestionBar", style: { flex: 1, height: 36 } },
    // Tone pill — RIGHT side. Compact oval with a subtle border for shape
    // definition against the transparent keyboard region.
    {
      type: "LetterKey",
      props: { char: "ZU 8.8" },
      bind: { content: "tone" },
      on: { onPress: { kind: "cycleTone" } },
      style: {
        flex: 0,
        width: 96,
        // 36, NOT 32: the row's inner content box is 44 − 2×4 padding = 36pt,
        // and the renderer's .fill alignment + required-priority height
        // constraints make any other value an unsatisfiable-constraints break
        // on every mount (mic and suggestion bar are 36 for the same reason).
        height: 36,
        bg: opts.toneBg,
        fg: opts.toneFg,
        radius: 18,
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

export function buildKeyboardConfig(
  personality?: Personality,
  /** Stable id used to place this user in a rollout slice. Omit for anonymous
   *  callers — they get the baseline rather than a per-request coin flip. */
  userId?: string,
): KeyboardConfigResponse {
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
      // NOTE: no standalone suggestion bar row. The suggestion strip lives in
      // the middle of the tools row (see makeToolsRow) so predictions appear
      // without adding a whole 44pt band — the keyboard keeps its 272pt
      // height. (The old standalone node was gated on state.hasSuggestions,
      // which pre-K5 clients never exposed, so it never rendered anyway;
      // K5+ exposes it should a future tree want a dedicated row.)

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

      // Row 4 (LETTER page) — 123 · 🌐 · space · return.
      //
      // The globe key is REQUIRED, not optional: a keyboard extension has no
      // "system bar" — when needsInputModeSwitchKey is true (any device with
      // more than one keyboard, i.e. virtually all of them) the extension must
      // draw its own switcher, and App Review checks for it. Without it there
      // was no way to reach emoji or another keyboard without leaving the app.
      // visibleIf-gated on the OS signal so the rare single-keyboard setup
      // gets the wider space bar instead.
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "en"] },
        children: [
          {
            type: "LetterKey",
            props: { char: "123" },
            on: { onPress: { kind: "switchLayout", language: "123" } },
            style: { flex: 2.4, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" },
          },
          {
            type: "GlobeKey",
            visibleIf: { truthy: "state.hasMultipleKeyboards" },
            // Explicit width, NOT flex: a visibleIf-hidden child with flex
            // still gets a required proportional-width constraint from the
            // stack builder while UIStackView collapses it to zero — an
            // unsatisfiable-constraints break on single-keyboard devices.
            // Width children are excluded from the flex pass (like MicKey).
            style: { width: 44, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION },
          },
          // Period and at-sign flank the space bar. Both are constantly needed
          // and both were two taps away on the 123 page — an address or a
          // sentence end should not cost a layer switch.
          //
          // The widths are rebalanced rather than added to: 123 and return give
          // up 0.35 each and space gives up 1.88, so the row's flex total is
          // unchanged and every other key keeps the size it had. Nothing is
          // squeezed to make room.
          { type: "LetterKey", props: { char: "." },
            style: { flex: 1.29, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 20, fontWeight: "regular" } },
          { type: "SpaceKey", style: { flex: 5.2, bg: KEY_FILL_SPACE, fontSize: 16, fontWeight: "regular" } },
          { type: "LetterKey", props: { char: "@" },
            style: { flex: 1.29, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 20, fontWeight: "regular" } },
          { type: "ReturnKey", style: { flex: 2.4, bg: KEY_FILL_RETURN, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" } },
        ],
      },
      // Row 4 for the NUMBER or SYMBOL page — ABC returns to letters; same
      // globe placement as the letter page.
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
            style: { flex: 2.4, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" },
          },
          {
            type: "GlobeKey",
            visibleIf: { truthy: "state.hasMultipleKeyboards" },
            // Explicit width, NOT flex: a visibleIf-hidden child with flex
            // still gets a required proportional-width constraint from the
            // stack builder while UIStackView collapses it to zero — an
            // unsatisfiable-constraints break on single-keyboard devices.
            // Width children are excluded from the flex pass (like MicKey).
            style: { width: 44, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION },
          },
          // Period and at-sign flank the space bar. Both are constantly needed
          // and both were two taps away on the 123 page — an address or a
          // sentence end should not cost a layer switch.
          //
          // The widths are rebalanced rather than added to: 123 and return give
          // up 0.35 each and space gives up 1.88, so the row's flex total is
          // unchanged and every other key keeps the size it had. Nothing is
          // squeezed to make room.
          { type: "LetterKey", props: { char: "." },
            style: { flex: 1.29, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 20, fontWeight: "regular" } },
          { type: "SpaceKey", style: { flex: 5.2, bg: KEY_FILL_SPACE, fontSize: 16, fontWeight: "regular" } },
          { type: "LetterKey", props: { char: "@" },
            style: { flex: 1.29, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 20, fontWeight: "regular" } },
          { type: "ReturnKey", style: { flex: 2.4, bg: KEY_FILL_RETURN, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" } },
        ],
      },

      // ========================= NUMBER-ONLY LAYER (num) ======================
      // Shown when the FIELD itself only accepts numbers — an OTP box, a phone
      // number, an amount. The client sets layoutId to "num" on focus and back
      // to "en" when it leaves; nothing switches to this layer by hand.
      //
      // A dialer grid, not our 123 page: a number field wants big targets in
      // the arrangement people already know, and the 123 page is a full QWERTY-
      // width row of tiny keys with punctuation the field will reject anyway.
      //
      // ABC is kept in the corner deliberately. If we ever misread a field as
      // numeric, the user must not be trapped in a pad that cannot type — the
      // same reason the globe key exists.
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "num"] },
        children: [
          ...["1", "2", "3"].map(kPunct),
          { type: "BackspaceKey", style: { flex: 1, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION } },
        ],
      },
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "num"] },
        children: [
          ...["4", "5", "6"].map(kPunct),
          { type: "Spacer", style: { flex: 1 } },
        ],
      },
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "num"] },
        children: [
          ...["7", "8", "9"].map(kPunct),
          { type: "Spacer", style: { flex: 1 } },
        ],
      },
      {
        type: "Row",
        style: { gap: 6, height: 44 },
        visibleIf: { eq: ["state.layoutId", "num"] },
        children: [
          {
            type: "LetterKey",
            props: { char: "ABC" },
            on: { onPress: { kind: "switchLayout", language: "en" } },
            style: { flex: 1, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" },
          },
          kPunct("0"),
          kPunct("."),
          { type: "ReturnKey", style: { flex: 1, bg: KEY_FILL_RETURN, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" } },
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
      // Field-driven, never reached from the layer switcher — but it must be
      // listed or switchLayout("num") is rejected as an unknown language.
      { language: "num", displayName: "Number pad", rows: [] },
      // "emoji" removed: no tree rows are gated on it, so switching to it
      // rendered a keyboard with no keys and no way back — a live trap now
      // that the globe key exists (its long-press language menu lists every
      // layout here). System emoji is reached via the globe instead.
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
      refine: "Refine",
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
      // Blank by owner decision: the keyboard stays icon-only — no Flow hint
      // text over the keys, no "Start Flow" state. The background-mic story
      // is carried by the App Review notes, the mic purpose string, the
      // privacy policy's Flow Session section, and the Settings off switch.
      // Any string here re-introduces on-keyboard guidance OTA if ever wanted.
      flow_start_hint: "",
      flow_arming: "",
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
        // While the mic is recording, the keys go behind frosted glass AND stop
        // taking touches.
        //
        // The blur is the signal — the keys are still there, they are just not
        // yours for the moment — and blocksTouches is what makes it true rather
        // than decorative. Without it the keyboard looked disabled and typed
        // anyway, so a stray thumb mid-utterance inserted a character into the
        // very text the refine pass was about to rewrite.
        //
        // The tools row is deliberately NOT covered: the mic that stops the
        // recording lives there, and blurring the way out of a state is how you
        // strand someone in it.
        "kb.dictation.dim.enabled": true,
        "kb.dictation.dim.blur": true,          // iOS UIVisualEffectView
        "kb.dictation.dim.blurRadius": 14,      // Android RenderEffect, API 31+
        "kb.dictation.dim.alpha": 0.35,         // tint under the blur
        "kb.dictation.dim.keyAlpha": 0.45,      // Android: how far the keys fade
        "kb.dictation.dim.blocksTouches": true,
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
        // Draw the key rows instead of building a Button per key.
        //
        // This is the one structural difference left between us and the system
        // keyboards: they paint every key into a single surface, we built ~30
        // views and paid a measure/layout pass for each. Drawn mode collapses a
        // row to ONE view whose keys are geometry.
        //
        // OFF until it has been used on a real device. Both renderers are in
        // the binary and the touch resolution is shared, so this is a flip in
        // either direction with NO rebuild — which is the whole point of
        // shipping it behind a flag rather than swapping the renderer outright.
        // Rows the drawn path does not fully reproduce (anything with a globe,
        // mic or suggestion strip) fall back to views on their own.
        "kb.render.drawnKeys": false,
        // --- K18: the last compiled-in choices, now data ------------------
        // Functional-key glyphs. Full icon-spec vocabulary, so a symbol can
        // become an emoji or a hosted image without a rebuild:
        //   { "sf": "delete.left" } | { "emoji": "⌫" } | { "url": "https://…" }
        // A per-key override can also ride in the tree as props.icon.
        // "kb.icon.backspace": { "sf": "delete.left" },
        // "kb.icon.globe": { "sf": "globe" },
        // "kb.icon.refine": { "sf": "sparkles" },
        //
        // Suggestion bar SHAPE (not just its colours):
        //   "chips" (default) — rounded pills, brand amber on the lead
        //   "flat"            — the native three-slot strip: no surfaces, thin
        //                       dividers, lead distinguished by weight/colour
        // "kb.suggestion.style": "chips",
        // "kb.suggestion.dividerColor": "#FFFFFF24",
        // "kb.suggestion.dividerHeight": 18,
        // --- K12 knobs: everything below was hardcoded in the binary until
        // now, and each is a value real-world use is likely to argue with.
        //
        // Key haptics — the most polarizing keyboard setting there is.
        // enabled=false silences them entirely; style is "selection"
        // (default, the crisp native tick) | light | medium | heavy | rigid |
        // soft. iOS still requires Full Access for any of it.
        // ---- Per-key haptics -------------------------------------------
        // Two ways to be on, because "all keys" and "the keys I chose" are
        // different preferences and neither should erase the other:
        //
        //   kb.haptics.all   — every key buzzes. The card's master toggle.
        //   kb.haptics.keys  — a set of individual keys the user picked. A key
        //                      listed here buzzes even when .all is off.
        //
        // Default is silence on both. A keyboard that buzzes on every letter
        // out of the box is a setting people go looking for how to turn OFF,
        // so it is opt-in in either direction.
        //
        // Keys are named by what they insert (" ", ".", "a") or by role
        // ("shift", "backspace", "return", "space", "mic", "refine"), so the
        // picker in the app and the keyboard agree without a shared table.
        "kb.haptics.all": false,
        "kb.haptics.keys": {},
        // "kb.haptics.style": "selection",
        //
        // Touch feel (K11). holdMultiplier is how far a finger may drift off
        // the pressed key before the press cancels, as a multiple of the key's
        // own size — native keeps a key held through a lot of drift, so 1.0
        // means "one key-width of slack". Lower = twitchier, higher =
        // stickier, 0 = the old behavior where any drift onto dead space
        // dropped the keystroke.
        // "kb.touch.holdMultiplier": 1.0,
        // cancelCommit rescues taps iOS CANCELS rather than ends — the
        // home-indicator band overlaps the bottom row and steals quick light
        // taps there. A cancelled touch shorter than maxMs that moved less
        // than maxDriftPt is treated as a real tap. maxMs 0 disables the
        // rescue.
        // "kb.touch.cancelCommit.maxMs": 300,
        // "kb.touch.cancelCommit.maxDriftPt": 12,
        //
        // Autocorrect aggressiveness. Together with maxDistance these ARE the
        // dial: a neighbor-key substitution ("gome"→"home") costs
        // neighborCost, a missing apostrophe/space ("dont"→"don't") costs
        // punctCost, everything else costs 1. LOWER = more words get
        // "fixed". A wrong correction costs far more trust than a missed one,
        // so raise these to make it more conservative.
        // "kb.autocorrect.neighborCost": 0.5,
        // "kb.autocorrect.punctCost": 0.5,
        // Debug build stamp (orange "K1" in the keyboard's corner). The Swift
        // default is FALSE so store builds never show it. To verify a fresh
        // binary + live OTA delivery in one shot: flip this to true + cache
        // bump — the stamp appearing proves both — then flip back off.
        "kb.buildStamp.enabled": false,
        // Cold-open field diagnostics (K3+ binaries). With this on, tapping the
        // keyboard mic shows "<stamp> · <path>" in the status bar — e.g.
        // "K3 · app✓@2 open=NO" (found UIApplication, iOS refused the open) or
        // "K3 · app✗ legacy=YES" (no UIApplication in the chain, legacy path
        // claimed a hit). A console-log substitute readable on the phone.
        // Flip OFF (with the deploy's automatic cache bump) once diagnosed.
        "kb.coldOpen.debugStatus": false,
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
        // Show ONLY the finished sentence. Both engines still stream while the
        // user speaks — transcription is done by the time they stop, so this
        // costs no real time — but nothing reaches the cursor until the text is
        // written properly. Watching "whats up" appear and turn into "WhatsApp"
        // makes the product look like it is correcting its own mistakes;
        // landing one finished sentence makes it look like it understood.
        // Set false to paint the raw transcript live and rewrite it on stop.
        "kb.mic.deferUntilStop": true,
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
        // TRANSPORT — how a dictated utterance reaches the server. Flippable
        // per cohort, no rebuild (build 53+).
        //   "stream"  → PCM goes up a socket as the user speaks. Transcription
        //               finishes as they stop, so the written sentence lands
        //               fastest. Cost: a dropped socket loses the words
        //               outright — they existed nowhere but in flight.
        //   "oneshot" → the app buffers the utterance and POSTs it once to
        //               /v1/transcribe-clean, the same endpoint (and the same
        //               Sarvam+Whisper fusion) the in-app mic uses. The audio
        //               still exists on the phone afterwards, so a failed
        //               request retries instead of losing the dictation, and
        //               the two surfaces stop diverging. Cost: transcription
        //               starts at stop, so the wait is longer on long
        //               utterances.
        // Streaming stays the default: it is faster, and it is the path with
        // real usage behind it.
        // Set this globally (FLOW_TRANSPORT), NOT as a cohort rollout: the app
        // reads it from /v1/app/bootstrap and the keyboard from
        // /v1/keyboard/config, and only the latter runs rollouts — so a
        // targeted rule would put the two halves of one dictation into
        // different modes.
        "kb.flow.transport": FLOW_TRANSPORT,
        // How long to wait after the mic stops before writing what was said —
        // the tail of an utterance is usually still in flight. Also the poll
        // interval while waiting for a one-shot upload to come back.
        "kb.flow.settleMs": 450,
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

        // ------- Typing engine (K4+ binaries; older builds ignore all of it) --
        //
        // These are the "close the native-keyboard gap" knobs. Every one has a
        // conservative Swift default (autocorrect/suggestions/bias default OFF
        // in the binary), so THIS block is the rollout switch — flip any of
        // them off here to kill the feature OTA, no rebuild.
        //
        // Press-order rollover: a second finger down commits the still-held
        // key immediately, so overlapped two-thumb presses land in press order
        // ("the", not "teh"). Matches the system keyboard's rollover.
        "kb.keyPlane.rolloverCommit": true,
        // Accent long-press trays routed through the multi-touch plane (the
        // v1 plane dropped them; K4 restores them plane-side).
        "kb.keyPlane.accentTrays": true,
        // On-device autocorrect at word boundaries (space/return/punctuation):
        // UITextChecker guesses re-ranked by PHYSICAL key adjacency from the
        // live layout — a candidate that differs only by neighbor-key
        // substitutions is a fat-finger, not a different word. The typed
        // original shows as a suggestion chip for one-tap revert.
        "kb.autocorrect.enabled": true,
        "kb.autocorrect.minLen": 3,
        "kb.autocorrect.maxDistance": 2,
        // Completion chips for the in-progress word (UITextChecker
        // completions), rendered into the existing SuggestionBar node.
        "kb.suggestions.enabled": true,
        "kb.suggestions.max": 3,
        // Language-model hit-target bias — the cheap version of Apple's
        // dynamic key resizing. After typing a character, the letters likely
        // to FOLLOW it (table below) claim lmBias.pt extra points of the
        // ambiguous gap/slop zone around them. Direct hits inside a key's
        // real bounds are never stolen.
        //
        // OFF. The table below is ENGLISH bigram frequency, and it is the only
        // table there is — so for anyone typing Hinglish, Hindi, Tamil or any
        // of the other languages this product exists to serve, it biases
        // ambiguous taps toward letters that are not likely at all. It is also
        // unproven: nothing in the telemetry says it ever helped, and it can
        // only ever change which letter an uncertain tap produces. That is the
        // exact shape of "the keyboard typed something I didn't press".
        //
        // Both flags stay live, so this is one backend edit to re-enable — and
        // the honest way to turn it back on is per-language tables plus the
        // revert counter showing it wins, not an assumption that it does.
        "kb.touch.lmBias.enabled": false,
        "kb.touch.lmBias.pt": 0,
        // prev-char → likely next letters, most likely first (top-6, English
        // corpus bigram frequencies). The " " row is word-START letter
        // frequency, so the bias works on the first letter of every word too.
        "kb.touch.bigrams": {
          " ": "taoswcbp",
          "a": "ntsrlc",
          "b": "elouar",
          "c": "oheatk",
          "d": "eioasu",
          "e": "rnsdal",
          "f": "oierau",
          "g": "ehoari",
          "h": "eaiotu",
          "i": "nstocl",
          "j": "uoaei",
          "k": "einsal",
          "l": "eiloay",
          "m": "eaoiup",
          "n": "gdetos",
          "o": "nurfmt",
          "p": "eroali",
          "q": "u",
          "r": "eoiast",
          "s": "teosai",
          "t": "heioar",
          "u": "rnstlp",
          "v": "eiaoyu",
          "w": "aiheon",
          "x": "ptcaie",
          "y": "oestia",
          "z": "eaioyz",
        },
        // ------- Touch spaces (K5+ binaries) — native-style key reach -------
        //
        // Every key owns the space AROUND it, not just its painted rect, and
        // real controls (shift/delete/space/return/mic/tone/chips) veto that
        // reach so nothing is ever stolen from them.
        //
        // Vertical reach beyond each key's rect. The 10pt row gaps are fully
        // covered from both sides; the nearest row wins (dx+dy scoring).
        "kb.touch.vSlop": 8,
        // The TOP letter row (q..p) reaches further UP toward the tools row —
        // overshooting the top row still types.
        "kb.touch.topRowUpSlop": 12,
        // The BOTTOM letter row (z..m) reaches further DOWN toward the space
        // row; the space/return/123 keys themselves are veto-protected.
        "kb.touch.bottomRowDownSlop": 10,
        // Each row's outermost key owns its side margin to the keyboard edge —
        // the dead corners beside "a" and "l" on the indented middle row now
        // type "a" / "l", exactly like native.
        "kb.touch.edgeToMargin": true,
        // Space-bar trackpad (native hold-for-cursor). These are the Swift
        // defaults, pinned here so the behavior is explicit + OTA-tunable.
        // K5 fixed the bug where entering trackpad mode remounted the tree and
        // cancelled its own gesture — hold-space now scrubs the cursor like
        // the system keyboard, with keys dimming while active.
        "kb.trackpad.enabled": true,
        "kb.trackpad.longPressMs": 300,
        "kb.trackpad.ptPerChar": 7,
        // Space/return on the 123/#+= layer flips back to letters (native
        // behavior; K6+). false = stay on the symbol layer.
        "kb.layer.returnAfterSpace": true,

        // ------- K7: swipe typing + role keys + smarter corrections --------
        //
        // QuickPath-style glide typing. Both binaries default OFF; this is the
        // rollout switch, and it drives BOTH platforms. Trail is the fading ink
        // line behind the finger.
        //
        // OFF until it is measured. It was reported wrong on iOS, and the fix —
        // decode by path geometry against a real dictionary — has never run on
        // a device. Shipping it on while the same feature is held back on
        // Android for being unproven was not a judgement, it was an oversight:
        // the unproven one was the one users had.
        //
        // A swipe that guesses wrong costs far more trust than no swipe. Turn it
        // on for a cohort once a build has been used and swipeCommitted /
        // autocorrectReverted say it earns its place.
        "kb.swipe.enabled": false,
        "kb.swipe.minKeys": 3,
        "kb.swipe.maxAlternates": 3,
        "kb.swipe.trail.color": "#E8A23CD9",   // brand amber, mostly opaque
        "kb.swipe.trail.width": 7,
        "kb.swipe.trail.fadeMs": 260,
        // OTA lexicon extension — appended to the embedded frequency list.
        // Push product / domain vocabulary here without a rebuild.
        "kb.swipe.extraWords": ["tailzu", "tulmi"],
        // Shift + layer keys ride the touch plane (K7): shift arms on touch-
        // down and supports slide-to-letter one-shot capitals; 123/#+=/ABC
        // switch instantly on touch-down and support press-slide-release
        // layer-peek. Both individually OTA-reversible.
        "kb.keyPlane.shift": true,
        "kb.layerPeek.enabled": true,
        // Backspace immediately after an autocorrect restores the original.
        "kb.autocorrect.backspaceRevert": true,
        // Real-word confusion pairs — the word is spelled correctly, so the
        // alternatives are OFFERED as chips (tap swaps in place), never
        // auto-applied. Both directions listed explicitly.
        "kb.autocorrect.confusables": {
          "their": ["there", "they're"],
          "there": ["their", "they're"],
          "theyre": ["they're"],
          "your": ["you're"],
          "youre": ["you're"],
          "its": ["it's"],
          "whose": ["who's"],
          "were": ["we're", "where"],
          "where": ["were", "wear"],
          "then": ["than"],
          "than": ["then"],
          "to": ["too", "two"],
          "too": ["to", "two"],
          "affect": ["effect"],
          "effect": ["affect"],
          "lose": ["loose"],
          "loose": ["lose"],
          "weather": ["whether"],
          "whether": ["weather"],
          "accept": ["except"],
          "except": ["accept"],
          "advice": ["advise"],
          "advise": ["advice"],
        },

        // How often the keyboard re-reads host-field traits (return-key label,
        // language, multi-keyboard) from textDidChange. They only change on
        // focus switches, yet the reads are host-process round-trips that were
        // firing per keystroke. 0 restores per-keystroke reads.
        "kb.host.traitRefreshMs": 500,
        // Explicit keyboard height (pt). Locks the height the current tree
        // already renders at (spec: docs/keyboard-spec.md) instead of
        // inheriting whatever the system picks. Remove to fall back to the
        // system default sizing.
        "kb.height.pt": 272,
        // Native scales the keyboard with the phone; one constant cannot. This
        // table is what K17+ binaries actually use — first bucket whose
        // maxWidth >= the screen width wins, kb.height.pt above is the
        // fallback for older builds.
        //
        // Derived from the row arithmetic in the tree below:
        //   height = padTop + toolsRow + 4×(rowGap + rowHeight) + padBottom
        // so if you change kb.geometry.* you must re-derive these, or the
        // rows and the frame stop agreeing and the bottom row gets clipped.
        //   ≤375  (SE, mini)      8 + 44 + 4×(9+40)  + 4 = 252
        //   ≤413  (13/14/15, Pro) 8 + 44 + 4×(10+42) + 4 = 264
        //   >413  (Plus, Max)     8 + 44 + 4×(11+44) + 4 = 276
        "kb.height.byWidth": [
          { maxWidth: 375, height: 252 },
          { maxWidth: 413, height: 264 },
          { maxWidth: 9999, height: 276 },
        ],
      };

      // Mic media: OWNER DECISION — the keyboard's IDLE mic is always the
      // static brand mark baked into the binary. The media-registry
      // mic.animation upload is for the in-app mic only and is deliberately
      // NOT exported as kb.mic.idleIcon / kb.mic.idleIcon.url (doing so made
      // the keyboard mic play the GIF at idle). Only the recording art is
      // still pushed; it shows exclusively while audio is being captured.
      const reg = getMediaRegistryFn?.() ?? {};
      const micRecording = reg["mic.animation.recording"];
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
          .map((p) => ({ id: p.id, name: p.name, tone: p.defaultTone }));
        flags["kb.personality.pinned"] = chips;
      }
      if (personality?.activePresetId) {
        flags["kb.personality.activeId"] = personality.activePresetId;
      }
      if (personality?.activeTone) {
        flags["kb.personality.activeTone"] = personality.activeTone;
      }
      // The user's own dictionary — names, brands, jargon. The keyboard biases
      // swipe decoding and autocorrect toward these; a generic lexicon will
      // never contain a colleague's name, and "fixing" it is exactly the kind
      // of wrong correction that costs trust.
      if (personality?.vocabulary?.trim()) {
        flags["kb.personality.vocabulary"] = personality.vocabulary.trim().slice(0, 4000);
      }
      // Haptics the user chose, in the shape the keyboards read: a master
      // switch and a set of individual keys. Kept INDEPENDENT — turning the
      // master off must not discard the keys someone picked one by one.
      if (personality?.hapticsAll) flags["kb.haptics.all"] = true;
      if (personality?.hapticKeys?.length) {
        const keys: Record<string, boolean> = {};
        for (const k of personality.hapticKeys.slice(0, 128)) {
          const id = String(k).toLowerCase();
          if (id) keys[id] = true;
        }
        flags["kb.haptics.keys"] = keys;
      }
      // Fast-tone list for the long-press tone sheet (iOS + Android read
      // `kb.personality.tones`). Rich `{ id, label }` shape so the clients apply
      // the exact tone id (→ per-tone refine) and the labels/order/set are fully
      // backend-controlled — rename, reorder, or add a tone with no app update.
      flags["kb.personality.tones"] = (
        Object.keys(TONE_LABELS) as Array<keyof typeof TONE_LABELS>
      ).map((id) => ({ id, label: TONE_LABELS[id] }));
      // Staged rollout LAST, so an experiment can override anything above.
      // Keyed on the user id, so a user's slice is stable across requests —
      // settings must never flip under their fingers mid-sentence.
      return applyRollouts(flags, userId, activeRollouts());
    })(),
    // Was 600 (10 min). A live theme fix couldn't reach users mid-session.
    // 60 s keeps cost negligible and lets themed rollouts hit within a minute.
    cacheTtlSeconds: 60,
  };
}
