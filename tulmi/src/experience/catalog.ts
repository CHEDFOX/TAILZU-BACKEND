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
import type { HistoryEntry, Personality, StatsResponse, UsageSummary } from "../../../shared/types/api.js";

// --- Global theme -----------------------------------------------------------

export const THEME: ThemeTokens = {
  color: {
    bg: "#000000",
    surface: "#000000",
    card: "#0b0b0f",
    inputBg: "#0e0e12",
    border: "rgba(255,255,255,0.10)",
    // WHITE — matches the original Plutto-style design (black surface with
    // white primary CTAs). Client-side readableOn() auto-contrast is expected
    // to render text as #000 on the pill. If pills render invisible on a
    // particular build (older readableOn), swap to "#ff6b1f" (brand orange)
    // as a fallback that lands high-contrast regardless of the client's
    // auto-contrast implementation.
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

const NAV: NavigationShell = {
  kind: "tabs",
  tabs: [
    { id: "home", title: "Home", screenId: "home" },
    { id: "personality", title: "You", screenId: "personality" },
    { id: "settings", title: "Settings", screenId: "settings" },
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
    // The server owns onboarding: first-run users land on the flow; everyone
    // else goes straight to the app.
    initialScreenId: opts.onboarded ? "home" : "onboarding",
    flags: {},
    // Central copy — every screen can reference these with "@key".
    labels: {
      "app.name": "Tailzu",
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
  dictionary?: Array<{ word: string; replacement: string }>;
  frequentWords?: string[];
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
      return personalityScreen(ctx.personality);
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

  const boxWithVoice = (bindKey: string): Node => ({
    type: "Stack", style: { position: "relative" }, children: [
      { type: "TextField", bind: { value: bindKey }, props: { placeholder: "Type here…", multiline: true }, style: { paddingRight: 56, minHeight: 96 } },
      { type: "Stack", style: { position: "absolute", right: 12, top: 0, bottom: 0, justify: "center" }, children: [
        {
          type: "VoiceToggle",
          bind: { value: bindKey },
          props: { targetApp: "WhatsApp", language: "auto", size: 38 },
          on: { onError: "err" },
          // Older bundles don't have VoiceToggle in their registry. VoiceButton
          // has shipped since the initial SDUI release, drives the same bind,
          // and reads state → mic → transcript → writes back. Same product
          // outcome, one-tap-record instead of press-and-hold.
          fallback: {
            type: "VoiceButton",
            bind: { value: bindKey },
            props: { targetApp: "WhatsApp", language: "auto" },
            on: { onError: "err" },
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
      dictionary: ctx.dictionary ?? [],
      frequentWords: ctx.frequentWords ?? [],
    },
    actions: {
      err: { kind: "toast", message: "Something went wrong. Check your connection.", tone: "error" },
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
              { type: "Stack", style: { align: "center" }, children: [
                {
                  type: "RefineButton",
                  bind: { value: "input" },
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
              ] },
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

        // Everything below the Pager sits inside a padded Stack so it keeps
        // the standard 24px side margin (the Screen wrapper's padding is off
        // to let the Pager span edge-to-edge).
        {
          type: "Stack",
          style: { paddingHorizontal: 24 },
          children: [
            { type: "Spacer", style: { height: 56 } }, // HIGH gap between sections

            // 2) Dictionary (tappable header → full page)
            {
              type: "Row",
              props: { label: "Dictionary" },
              on: { onPress: "openDictionary" },
              style: { borderBottomWidth: 0, paddingVertical: 4, marginBottom: 10 },
              // Fallback: a Button labelled Dictionary (visible + tappable on old
              // bundles). Same navigate action fires.
              fallback: {
                type: "Button",
                props: { label: "Dictionary", variant: "secondary" },
                on: { onPress: "openDictionary" },
                style: { marginBottom: 10 },
              },
            },
            {
              type: "DictionaryEditor",
              bind: { value: "dictionary" },
              props: { rows: 2 },
              on: { onError: "err" },
              // Old-bundle fallback: point them to the full-page editor via the
              // Dictionary row above. Cannot inline-edit without the component.
              fallback: {
                type: "Text",
                props: { content: "Tap Dictionary above to edit your saved words.", variant: "muted" },
              },
            },

            { type: "Spacer", style: { height: 56 } }, // HIGH gap

            // 3) The user's frequent words (computed by the backend)
            { type: "Heading", props: { content: ctx.name ? `${ctx.name}'s words` : "Your words" }, style: { fontSize: 22, fontWeight: "800", color: "$color.text", marginBottom: 4 } },
            { type: "Text", props: { content: "Words you use often", variant: "muted" }, style: { marginBottom: 16 } },
            {
              type: "WordChips",
              bind: { value: "frequentWords" },
              // Old-bundle fallback: pre-join the words server-side into a plain
              // Text — same info, no chip layout. Empty list falls through to
              // "You haven't dictated much yet." for a friendlier empty state.
              fallback: (ctx.frequentWords ?? []).length > 0
                ? {
                    type: "Text",
                    props: {
                      content: (ctx.frequentWords ?? []).join(" · "),
                      variant: "muted",
                    },
                    style: { paddingHorizontal: 4 },
                  }
                : {
                    type: "Text",
                    props: {
                      content: "You haven't dictated much yet.",
                      variant: "muted",
                    },
                    style: { paddingHorizontal: 4 },
                  },
            },
          ],
        },
      ],
    },
    cacheTtlSeconds: 0,
  };
}

/** The personality form — server seeds it with the user's saved profile. */
function personalityScreen(p: Personality): ScreenResponse {
  const SECTION = 30; // consistent gap between sections
  const chip = (label: string, group: string, value: string): Node => ({
    type: "Chip",
    props: { label, group, value },
    on: { onPress: { kind: "haptic", style: "selection" } },
  });
  const label = (content: string): Node => ({ type: "Text", props: { content, variant: "label" }, style: { marginBottom: 8 } });
  const gap = (h: number): Node => ({ type: "Spacer", style: { height: h } });

  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "personality",
    title: "",
    state: {
      form: {
        tone: p.tone ?? "",
        formality: p.formality ?? "neutral",
        emoji: p.emoji ?? "minimal",
        vocabulary: p.vocabulary ?? "",
        // preserved across saves even though they're not shown here:
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
        { kind: "setState", path: "status", value: "Saved. Tailzu writes in this voice." },
        { kind: "haptic", style: "success" },
      ] },
      saveErr: { kind: "toast", message: "Couldn't save. Check your connection.", tone: "error" },
      learn: { kind: "sequence", actions: [
        { kind: "setState", path: "status", value: "Learning your voice…" },
        { kind: "callEndpoint", method: "POST", path: "/v1/personality/learn", body: { sample: "$state.sample" }, onSuccess: "learned", onError: "saveErr" },
      ] },
      learned: { kind: "sequence", actions: [
        { kind: "haptic", style: "success" },
        { kind: "toast", message: "Learned your voice — updating…", tone: "success" },
        { kind: "refresh" },
      ] },
    },
    root: {
      type: "Screen",
      children: [
        { type: "Heading", props: { content: "Your personality" }, style: { fontSize: 30, fontWeight: "800", color: "$color.text", marginBottom: 10 } },
        { type: "Paragraph", props: { content: "Set once — it shapes everything Tailzu writes for you." }, style: { marginBottom: SECTION } },

        label("Tone"),
        { type: "TextField", bind: { value: "form.tone" }, props: { placeholder: "warm and concise, a little witty" } },
        gap(SECTION),

        label("Formality"),
        { type: "Stack", style: { direction: "row", gap: 8 }, children: [
          chip("casual", "form.formality", "casual"), chip("neutral", "form.formality", "neutral"), chip("formal", "form.formality", "formal"),
        ] },
        gap(SECTION),

        label("Emoji"),
        { type: "Stack", style: { direction: "row", gap: 8 }, children: [
          chip("none", "form.emoji", "none"), chip("minimal", "form.emoji", "minimal"), chip("expressive", "form.emoji", "expressive"),
        ] },
        gap(SECTION),

        label("Words it should know"),
        { type: "TextField", bind: { value: "form.vocabulary" }, props: { placeholder: "Aarav\nNykaa\nKubernetes", multiline: true } },
        gap(SECTION + 2),

        { type: "Button", props: { label: "Save", variant: "primary" }, on: { onPress: "save" } },
        { type: "Text", bind: { content: "status" }, props: { variant: "muted" }, style: { marginTop: 10, textAlign: "center" } },

        gap(40),
        { type: "Divider" },
        gap(28),

        label("Or learn it from a sample"),
        { type: "TextField", bind: { value: "sample" }, props: { placeholder: "Paste a few messages you've written…", multiline: true } },
        gap(14),
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

  // NOTE: we render the sparkline as a small Unicode bar chart in a plain
  // Text node because the client renderer doesn't ship a Chart component yet.
  // Replace this with a real ChartLine node once the app registry gains one.
  const sparklineText = renderSparkline(stats?.sparklinePerDay);

  const kv = (label: string, value: string): Node => ({
    type: "KeyValue",
    props: { label, value },
    style: { flex: 1 },
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
            subtitle: "This month, in your voice",
          },
        },
        spacer(20),
        {
          type: "Stack",
          style: { direction: "row", gap: 8 },
          children: [
            kv("Words this week", wordsWeek.toLocaleString()),
            kv("Audio dictated", `${mins(audioSecondsMonth)} min`),
            kv("Minutes saved", `${minutesSaved.toLocaleString()}`),
          ],
        },
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
        // Sparkline block — Text-only until the renderer ships a chart node.
        text("Requests, last 30 days", "label"),
        spacer(6),
        {
          type: "Card",
          children: [
            text(sparklineText, "body", { style: { fontSize: 22, letterSpacing: 2 } }),
          ],
        },
        spacer(24),
        {
          type: "Button",
          props: { label: "See history", variant: "secondary" },
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
      openDetail: { kind: "toast", message: "Detail view coming soon", tone: "info" },
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
      err: { kind: "toast", message: "Couldn't reach history. Try again.", tone: "error" },
    },
    root: {
      type: "Screen",
      children: [
        {
          type: "Heading",
          props: { content: "History" },
          style: { fontSize: 30, fontWeight: "800", color: "$color.text", marginBottom: 6 },
        },
        {
          type: "Paragraph",
          props: {
            content:
              "Every cleanup you've kept, newest first. Tap for details, long-press to remove.",
          },
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
            emptyLabel:
              "No history yet. Turn on 'Keep history' in your personality to start collecting your cleanups.",
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

/** Step 1 — welcome + what Tulmi does. */
function onboardingWelcome(): ScreenResponse {
  const feature = (title: string, body: string): Node => ({
    type: "Stack",
    style: { direction: "column", gap: 4 },
    motion: { appear: "fadeInUp" },
    children: [
      { type: "Text", props: { content: title }, style: { color: "$color.text", fontSize: 16, fontWeight: "500", letterSpacing: 0.3 } },
      { type: "Paragraph", props: { content: body }, style: { marginBottom: 0 } },
    ],
  });
  return {
    schemaVersion: SDUI_SCHEMA_VERSION,
    screenId: "onboarding",
    title: "Welcome",
    template: "scroll",
    state: {},
    actions: { next: { kind: "navigate", screenId: "onboarding_language" } },
    blocks: [
      ...stepHeader(1, 3, "Welcome"),
      { type: "Heading", props: { content: "@onboarding.title" }, style: { textAlign: "center", fontSize: 30, lineHeight: 38, marginBottom: 12 } },
      { type: "Paragraph", props: { content: "@onboarding.subtitle" }, style: { textAlign: "center", marginBottom: 36 } },
      {
        type: "Stack",
        style: { direction: "column", gap: 22 },
        children: [
          feature("🎙️  Talk, don't type", "Tap the mic on the Tulmi keyboard and just speak."),
          feature("✨  One-tap polish", "Refine turns messy text into clean, clear writing."),
          feature("💬  Replies in your voice", "Paste a message, say your intent, get a perfect reply."),
          feature("🎚️  Always you", "Set your tone once — every word matches your style."),
        ],
      },
      { type: "Spacer", style: { height: 40 } },
      { type: "Button", props: { label: "Continue", variant: "primary" }, on: { onPress: "next" } },
    ],
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
const makeToolsRow = (opts: {
  micBg: string;
  micFg: string;
  toneBg: string;
  toneFg: string;
  refineBg: string;
  refineFg: string;
  visibleIf: any;
}): KeyboardNode => ({
  type: "Row",
  style: { gap: 8, height: 44, padding: 6 },
  visibleIf: opts.visibleIf,
  children: [
    {
      type: "MicKey",
      style: { flex: 0, width: 44, bg: opts.micBg, fg: opts.micFg, radius: 22 },
    },
    { type: "Spacer", style: { flex: 1 } },
    {
      type: "LetterKey",
      props: { char: "Neutral" },
      bind: { content: "tone" },
      on: { onPress: { kind: "cycleTone" } },
      style: {
        flex: 0,
        width: 120,
        bg: opts.toneBg,
        fg: opts.toneFg,
        radius: 22,
        fontSize: 15,
        fontWeight: "regular",
      },
    },
    { type: "Spacer", style: { flex: 1 } },
    {
      type: "RefineKey",
      style: { flex: 0, width: 44, bg: opts.refineBg, fg: opts.refineFg, radius: 22 },
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
const KEY_PRESSED = "#FFFFFFBF";          // 75% white — pressed state brightens for visible touch feedback
// Brand orange kept only for functional signals — right now that's the
// waveform bars during dictation. Colored feedback when the user is
// speaking; invisible the rest of the time. Not a decorative accent.
const BRAND_ACCENT = "#FF6B1F";

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
const LIGHT_KEY_FILL_FUNCTION = "#C7CDD3E6";   // ~90% opaque light gray — the darker "function key" recess
const LIGHT_KEY_TEXT = "#000000";

export function buildKeyboardConfig(): KeyboardConfigResponse {
  // English QWERTY. The physical layout arrays are also emitted (below) so
  // older keyboard binaries — the ones without the SDUI renderer — can still
  // render the legacy hand-built keyboard. `features.sdui: true` is the switch
  // the SDUI-capable binary flips to walk `root` instead.
  const letterRow1 = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"];
  const letterRow2 = ["a", "s", "d", "f", "g", "h", "j", "k", "l"];
  const letterRow3 = ["z", "x", "c", "v", "b", "n", "m"];

  // Popular emoji grid (Unicode CLDR 2024 usage rankings) — 6 rows × 10 cols.
  // Third-party keyboards can't show Apple's system emoji picker (private API),
  // so we ship our own inline grid. Each emoji is inserted as its Unicode
  // character via LetterKey's insertKey path — Swift's Character.count == 1
  // treats a single emoji as one grapheme, so uppercase/lowercase transforms
  // are no-ops for these entries.
  const emojiRows: string[][] = [
    ["😂", "❤️", "😍", "🤣", "😊", "🙏", "💕", "😭", "😘", "👍"],
    ["😅", "👏", "😁", "🥰", "🤩", "🙂", "😉", "💯", "😄", "😃"],
    ["😆", "😎", "✨", "😢", "🎉", "🔥", "💖", "😀", "💪", "👌"],
    ["🙄", "🤔", "😳", "🥺", "🤗", "😜", "🌟", "🌈", "😌", "🤪"],
    ["😴", "🙃", "😇", "😋", "🤤", "😱", "🤯", "🥳", "🎈", "🎁"],
    ["👀", "💀", "🤡", "🥱", "🥲", "🫠", "🥹", "🫶", "🤝", "🙌"],
  ];

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
    // Padding measurements from archagon Dimensions.md (pixel-measured against
    // iPhone 6-class screenshots — canonical iOS keyboard geometry): 3pt L/R,
    // 5pt top, 4pt bottom (the 34pt home-indicator area sits below this on
    // Face ID phones automatically — that's why native bottom padding is small,
    // not 8pt). Row gap 6pt matches Apple's inclusive 43pt row height (a letter
    // key is ~37pt visible + 6pt of gap = 43). Previous values (top:10, bot:8)
    // were making our keyboard feel taller and more "boxed in" than native.
    // Container padding stays snug L/R (native measurements) but gap between
    // rows widens 6 → 10 for a roomier feel, and top/bottom picks up a couple
    // extra points so the whole keyboard reads as taller. Row height inside
    // each Row is also explicitly 50pt (up from ~40pt natural) — see below.
    style: { paddingLeft: 3, paddingRight: 3, paddingTop: 8, paddingBottom: 6, gap: 10 },
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

      // Dictation status label — only during voice sessions. Bound to
      // state.status which the native side updates as
      // "" → "Listening…" → "Transcribing…" → "Refining…" → "".
      {
        type: "StatusLabel",
        bind: { text: "status" },
        style: { height: 22, fontSize: 12, fg: "#B0B0B4" },
        visibleIf: { truthy: "state.status" },
      },

      // Live waveform — visible only while dictating. Provides visible feedback
      // that we're actually listening (vs the "no visible cue" problem the
      // native path had before).
      {
        type: "Waveform",
        bind: { level: "micLevel" },
        props: { bars: 24, color: BRAND_ACCENT },
        style: { height: 44 },
        visibleIf: { truthy: "state.dictating" },
      },

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
      makeToolsRow({
        micBg: KEY_FILL_FUNCTION,
        micFg: KEY_TEXT_FUNCTION,
        toneBg: KEY_FILL_LETTER,
        toneFg: KEY_TEXT,
        refineBg: KEY_FILL_FUNCTION,
        refineFg: KEY_TEXT_FUNCTION,
        visibleIf: {
          all: [
            { falsy: "state.dictating" },
            { neq: ["state.appearance", "light"] },  // dark or unset → show this row
          ],
        },
      }),
      makeToolsRow({
        micBg: LIGHT_KEY_FILL_FUNCTION,
        micFg: LIGHT_KEY_TEXT,
        toneBg: LIGHT_KEY_FILL_LETTER,
        toneFg: LIGHT_KEY_TEXT,
        refineBg: LIGHT_KEY_FILL_FUNCTION,
        refineFg: LIGHT_KEY_TEXT,
        visibleIf: {
          all: [
            { falsy: "state.dictating" },
            { eq: ["state.appearance", "light"] },
          ],
        },
      }),

      // ============================ LETTER LAYER (en) =========================
      // Visible when state.layoutId is "en" (default). Prefixed with "state."
      // so Swift's condition evaluator actually resolves the value — bare
      // paths return null and everything reads as "always shown / never shown".

      // Row 1: q..p
      {
        type: "Row",
        style: { gap: 6, height: 50 },
        visibleIf: { eq: ["state.layoutId", "en"] },
        children: letterRow1.map(kLetter),
      },
      // Row 2: a..l (indented half-key each side)
      {
        type: "Row",
        style: { gap: 6, height: 50 },
        visibleIf: { eq: ["state.layoutId", "en"] },
        children: [kHalfSpacer(), ...letterRow2.map(kLetter), kHalfSpacer()],
      },
      // Row 3: shift, z..m (7 letters), backspace.
      // True flex ratios now that the SDUI renderer honors them proportionally:
      // shift = backspace = 1.33× a letter key (archagon's 42/31.5 = 1.333).
      {
        type: "Row",
        style: { gap: 6, height: 50 },
        visibleIf: { eq: ["state.layoutId", "en"] },
        children: [
          { type: "ShiftKey", style: { flex: 1.33, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION } },
          ...letterRow3.map(kLetter),
          { type: "BackspaceKey", style: { flex: 1.33, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION } },
        ],
      },

      // ============================ NUMBER LAYER (123) ========================
      // Apple's iOS number page. Row 1 = digits; Row 2 = -/:;()$&@";
      // Row 3 = #+= · . , ? ! ' · backspace. Tapping "#+=" switches to the
      // symbol page; tapping "ABC" (from row 4) returns to letters.

      // Row 1: 1..0
      {
        type: "Row",
        style: { gap: 6, height: 50 },
        visibleIf: { eq: ["state.layoutId", "123"] },
        children: ["1","2","3","4","5","6","7","8","9","0"].map(kPunct),
      },
      // Row 2: - / : ; ( ) $ & @ "
      {
        type: "Row",
        style: { gap: 6, height: 50 },
        visibleIf: { eq: ["state.layoutId", "123"] },
        children: ["-","/",":",";","(",")","$","&","@","\""].map(kPunct),
      },
      // Row 3: [#+=] . , ? ! ' [backspace]
      {
        type: "Row",
        style: { gap: 6, height: 50 },
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
        style: { gap: 6, height: 50 },
        visibleIf: { eq: ["state.layoutId", "sym"] },
        children: ["[","]","{","}","#","%","^","*","+","="].map(kPunct),
      },
      // Row 2: _ \ | ~ < > € £ ¥ ·
      {
        type: "Row",
        style: { gap: 6, height: 50 },
        visibleIf: { eq: ["state.layoutId", "sym"] },
        children: ["_","\\","|","~","<",">","€","£","¥","·"].map(kPunct),
      },
      // Row 3: [123] . , ? ! ' [backspace]
      {
        type: "Row",
        style: { gap: 6, height: 50 },
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
      // Flex ratios (archagon, measured 375pt): 123 = globe = 1.29,
      // space = 5.79, return = 2.78. The shipped SDUI renderer now honors
      // these proportionally on every screen size (Pro / Plus / Pro Max
      // scale correctly, no more hardcoded widths).

      // Mode switcher — three variants, each visibleIf-gated:
      // ============================ EMOJI LAYER (emoji) =======================
      // Third-party keyboards can't show Apple's system emoji picker, so we
      // build our own inline. Grid of ~60 popular emojis ranked by usage.
      // Each LetterKey has char = the emoji glyph; tapping inserts it.
      // "ABC" on row 7 returns to letters.

      ...emojiRows.map((row): KeyboardNode => ({
        type: "Row",
        style: { gap: 4 },
        visibleIf: { eq: ["state.layoutId", "emoji"] },
        children: row.map((glyph) => ({
          type: "LetterKey",
          props: { char: glyph },
          style: { flex: 1, fontSize: 26, bg: "#00000000", fg: KEY_TEXT },
        })),
      })),

      // Row 4 (LETTER page) — 123 · 😀 · space · return.
      // No globe on the keyboard itself — iOS shows its own next-keyboard button
      // in the system extension bar below Tulmi, so an on-keyboard globe would
      // just be duplicating what the OS already provides. Space bar grows to
      // fill the freed width.
      {
        type: "Row",
        style: { gap: 6, height: 50 },
        visibleIf: { eq: ["state.layoutId", "en"] },
        children: [
          {
            type: "LetterKey",
            props: { char: "123" },
            on: { onPress: { kind: "switchLayout", language: "123" } },
            style: { flex: 1.29, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" },
          },
          {
            // Emoji switcher — jumps to our emoji layer. Third-party keyboards
            // can't show Apple's system emoji picker (private API); we ship our
            // own grid layer instead.
            type: "LetterKey",
            props: { char: "😀" },
            on: { onPress: { kind: "switchLayout", language: "emoji" } },
            style: { flex: 1.29, bg: KEY_FILL_FUNCTION, fontSize: 22 },
          },
          { type: "SpaceKey", style: { flex: 5.79, bg: KEY_FILL_SPACE, fontSize: 16, fontWeight: "regular" } },
          { type: "ReturnKey", style: { flex: 2.78, bg: KEY_FILL_RETURN, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" } },
        ],
      },
      // Row 4 for the NUMBER or SYMBOL page — ABC returns to letters. Same
      // "no globe" pattern; iOS's system bar still handles keyboard switching.
      {
        type: "Row",
        style: { gap: 6, height: 50 },
        visibleIf: { any: [
          { eq: ["state.layoutId", "123"] },
          { eq: ["state.layoutId", "sym"] },
        ] },
        children: [
          {
            type: "LetterKey",
            props: { char: "ABC" },
            on: { onPress: { kind: "switchLayout", language: "en" } },
            style: { flex: 1.29, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" },
          },
          { type: "SpaceKey", style: { flex: 7.08, bg: KEY_FILL_SPACE, fontSize: 16, fontWeight: "regular" } },
          { type: "ReturnKey", style: { flex: 2.78, bg: KEY_FILL_RETURN, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" } },
        ],
      },
      // Row 4 for the EMOJI page — "ABC" back to letters, no globe, no 123.
      // Big space bar with a backspace on the right.
      {
        type: "Row",
        style: { gap: 6, height: 50 },
        visibleIf: { eq: ["state.layoutId", "emoji"] },
        children: [
          {
            type: "LetterKey",
            props: { char: "ABC" },
            on: { onPress: { kind: "switchLayout", language: "en" } },
            style: { flex: 1.29, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION, fontSize: 16, fontWeight: "regular" },
          },
          { type: "SpaceKey", style: { flex: 6, bg: KEY_FILL_SPACE, fontSize: 16, fontWeight: "regular" } },
          { type: "BackspaceKey", style: { flex: 1.5, bg: KEY_FILL_FUNCTION, fg: KEY_TEXT_FUNCTION } },
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
      keyPressed: LIGHT_KEY_FILL_FUNCTION,
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
    },
    root,
    actions,
    // Was 600 (10 min). A live theme fix couldn't reach users mid-session.
    // 60 s keeps cost negligible and lets themed rollouts hit within a minute.
    cacheTtlSeconds: 60,
  };
}
