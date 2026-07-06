/**
 * Tulmi — Server-Driven UI (SDUI) contract.
 *
 * This is the SECOND source of truth, alongside ./api.ts. Where api.ts defines
 * the "brain" endpoints (transcribe, refine, draft, speak, personality), THIS
 * file defines how the backend drives the entire UI of the main app.
 *
 * Philosophy: the frontend is a GENERIC RENDERER. It knows how to draw a fixed
 * set of primitive components and how to obey a fixed set of declarative
 * actions. It has NO hardcoded screens. The backend sends a Screen document
 * (a tree of Nodes) and the renderer draws it. Change the JSON on the server →
 * the whole app changes, with no new build.
 *
 * Keep this file framework-free so both the backend and the RN renderer import
 * it directly.
 */

// ===========================================================================
// 0. Versioning & capability negotiation
// ===========================================================================
//
// The renderer ships once and lives for a long time; the server evolves daily.
// To stay safe, the client tells the server what it can render, and the server
// promises never to emit a node/action the client doesn't understand. Unknown
// nodes still degrade gracefully (see Node.fallback).

/** Bumped only on breaking changes to this contract. */
export const SDUI_SCHEMA_VERSION = 1;

export interface ClientCapabilities {
  /** SDUI_SCHEMA_VERSION the renderer was built against. */
  schemaVersion: number;
  /** Native app/renderer version, e.g. "1.4.0". */
  appVersion: string;
  platform: "ios" | "android";
  /** Component `type`s this build can render (the registry keys). */
  components: string[];
  /** Action `kind`s this build can execute. */
  actions: string[];
  /** Device hints the server may use for layout/theming decisions. */
  device?: {
    width: number;
    height: number;
    scale: number;
    colorScheme: "light" | "dark";
    locale: string;
    reduceMotion?: boolean;
  };
}

// ===========================================================================
// 1. Bootstrap — the app's entry point
// ===========================================================================
//
// On launch the client POSTs its capabilities to /v1/app/bootstrap and gets
// back the global theme, the navigation shell (e.g. tab bar), and the id of the
// first screen to load. Everything after that is screen fetches + actions.

/**
 * MediaSpec — canonical way to reference an asset from a node's props.
 *
 * All image / video / audio / SVG source fields across the app + keyboard
 * accept this shape (with sensible fallbacks for unset entries):
 *
 *   { key: "brand.mark" }              → resolve via bootstrap.media[key]
 *   { url: "https://cdn/foo.png" }     → direct URL, disk-cached client-side
 *   { asset: "TailzuMark" }            → bundled iOS/Android/RN asset
 *   { emoji: "🎙️" }                    → render as text glyph
 *   { data: "data:image/png;base64…" } → inline data URI
 *
 * String shorthand ALSO supported for compact backend trees:
 *   "media:brand.mark"    → { key: "brand.mark" }
 *   "asset:TailzuMark"    → { asset: "TailzuMark" }
 *   "https://…"           → { url: "…" }
 *
 * A missing/broken key falls back to bundled defaults so a bad registry
 * entry never blanks out UI — clients render whatever they can.
 */
export type MediaSpec =
  | string
  | { key: string }
  | { url: string; contentType?: string }
  | { asset: string }
  | { emoji: string }
  | { data: string; contentType?: string };

export interface MediaEntry {
  url: string;
  contentType: string;
  size: number;
  uploadedAt: number;
  key?: string;
}

export interface BootstrapRequest {
  capabilities: ClientCapabilities;
  /** Opaque session/auth token if the user is signed in. */
  authToken?: string;
}

export interface BootstrapResponse {
  schemaVersion: number;
  /** Global design tokens; individual screens may override pieces. */
  theme: ThemeTokens;
  /** The app-level navigation chrome (tabs / stack). */
  navigation: NavigationShell;
  /** Screen to render first. */
  initialScreenId: string;
  /** Optional remote feature flags the renderer can read in conditions. */
  flags?: Record<string, boolean | number | string>;
  /**
   * Central copy: every user-facing string the app can show. Nodes reference
   * a label with "@key" (e.g. props.content = "@home.title"), so ALL wording is
   * controlled from the backend and reusable across screens.
   */
  labels?: Record<string, string>;
  /**
   * Central media registry: every image / video / audio / SVG asset the app
   * can render, keyed by a semantic name (e.g. "brand.mark", "onboarding.hero").
   *
   * Nodes reference an entry via MediaSpec { key: "brand.mark" } or the shorthand
   * "media:brand.mark". The runtime resolves the key → entry.url → fetches (with
   * disk cache). Missing key → clients fall back to bundled default or emoji.
   *
   * Populated from admin uploads via POST /v1/media/upload; the registry file
   * lives on the server so uploads persist across restarts. Deleting an entry
   * only removes it from the registry — the underlying file stays on disk
   * (safe: cache-hits from clients still work).
   */
  media?: Record<string, MediaEntry>;
  /** Version gating — force or suggest an app update from the server. */
  update?: UpdateGate;
  /** Languages for the native post-auth picker (code/name/greeting). */
  languages?: LanguageOption[];
  /** Seconds the client may cache bootstrap before refetching. */
  cacheTtlSeconds?: number;
  /**
   * Opaque cache token. When the server catalog changes (deploy, admin bump),
   * this string changes; clients compare it to their stored value and drop
   * every cached screen when it differs. Absent = no cache invalidation
   * negotiated; the client may cache under existing `cacheTtlSeconds` rules.
   */
  cacheVersion?: string;
}

export interface LanguageOption {
  code: string;
  name: string;
  greeting: string;
  regions?: string[];
}

/**
 * Lets the backend block or nudge old app versions without an app-store action.
 * The client sends its appVersion in capabilities; the server returns thresholds.
 */
export interface UpdateGate {
  /** Apps below this are hard-blocked with a non-dismissible screen. */
  minVersion?: string;
  /** Apps below this (but >= minVersion) see a dismissible prompt. */
  latestVersion?: string;
  title?: string;
  message?: string;
  cta?: string;
  /** Where the CTA sends the user (store links). */
  url?: { ios?: string; android?: string; default?: string };
}

/** The persistent navigation chrome. Either a tab bar or a plain stack. */
export type NavigationShell =
  | {
      kind: "tabs";
      tabs: Array<{
        id: string;
        title: string;
        icon?: string;
        screenId: string;
      }>;
    }
  | { kind: "stack"; rootScreenId: string };

// ===========================================================================
// 2. Screen documents
// ===========================================================================
//
// A Screen is fetched from /v1/app/screen and is a tree of Nodes plus the data,
// named actions, and theme overrides it needs. The renderer walks `root` and
// draws each Node via its component registry.

export interface ScreenRequest {
  screenId: string;
  capabilities: ClientCapabilities;
  authToken?: string;
  /** Params passed by a `navigate` action (e.g. an item id). */
  params?: Record<string, unknown>;
}

export interface ScreenResponse {
  schemaVersion: number;
  screenId: string;
  /** Shown in the nav bar; omit for a custom header inside `root`. */
  title?: string;
  /** Per-screen theme overrides merged over the global theme. */
  theme?: Partial<ThemeTokens>;
  /**
   * Two ways to describe a screen:
   *  1. `root` — a full, hand-built Node tree (max flexibility).
   *  2. `template` + `blocks` — name a layout the app already knows ("feature",
   *     "list", "scroll"…) and hand it content blocks; the app composes the
   *     chrome. Same idea as Plutto's templates. Provide one or the other.
   */
  template?: string;
  /** Content blocks for the named template (when `template` is set). */
  blocks?: Node[];
  /** The component tree (when not using a template). */
  root?: Node;
  /**
   * Initial client-side state for this screen. Nodes bind to it via `bind`,
   * and actions mutate it via `setState`. Keys are dot-paths.
   */
  state?: Record<string, unknown>;
  /** Named actions referenced by Nodes via ActionRef. Keeps the tree small. */
  actions?: Record<string, ActionSpec>;
  /** Seconds the client may cache this screen. 0 = always refetch. */
  cacheTtlSeconds?: number;
}

// ===========================================================================
// 3. Nodes — the component tree
// ===========================================================================
//
// `type` is a registry key the renderer maps to a native/RN component. The
// renderer ships a fixed set (below); the server may only use types the client
// advertised in capabilities.components. Everything visual — text, layout,
// inputs, lists, images, motion — is expressed as Nodes.

export interface Node {
  /** Registry key, e.g. "Stack" | "Text" | "Button" | "TextField" | "Image". */
  type: string;
  /** Stable id (for state binding, lists, and analytics). */
  id?: string;
  /** Type-specific properties (e.g. Text.content, Image.source). */
  props?: Record<string, unknown>;
  /** Visual style; values may be raw or theme-token refs ("$color.primary"). */
  style?: StyleProps;
  /** Child nodes (for containers like Stack/Card/List). */
  children?: Node[];
  /**
   * Bind a prop to live state/data by dot-path, e.g. { value: "form.email" }.
   * Re-renders when that state changes.
   */
  bind?: Record<string, string>;
  /** Event handlers → action references. e.g. { onPress: "submit" }. */
  on?: Partial<Record<NodeEvent, ActionRef>>;
  /** Entry/exit animation for this node. */
  motion?: MotionSpec;
  /** Render only when this condition is truthy (flag/state driven). */
  visibleIf?: Condition;
  /** Rendered if the client can't draw `type` (forward-compat safety net). */
  fallback?: Node;
}

export type NodeEvent =
  | "onPress"
  | "onLongPress"
  | "onDoubleTap"
  | "onChange"
  | "onSubmit"
  | "onFocus"
  | "onBlur"
  | "onAppear"
  | "onDisappear"
  | "onRefresh"
  | "onEndReached"
  | "onSwipeLeft"
  | "onSwipeRight"
  | "onScroll"
  | "onScrollEnd"
  | "onSelect"
  | "onDismiss"
  | "onComplete"
  | "onResult" // async component produced a value (e.g. VoiceButton transcript)
  | "onError"; // async component failed

/**
 * The component registry the renderer ships. The server discovers the real
 * set from capabilities.components. Grouped by role so future additions land
 * in the right bucket. Every entry here has an implementation in the RN
 * renderer; no aspirational names.
 */
export const CORE_COMPONENTS = [
  // v1 primitives — always present.
  "Screen",       // scroll/safe-area root
  "Stack",        // flex container (props.direction: "row" | "column")
  "Spacer",       // flexible/empty space
  "Text",         // props.content, props.variant
  "Image",        // props.source (url), props.aspectRatio
  "Icon",         // props.name
  "Button",       // props.label, props.variant
  "TextField",    // props.placeholder, bind.value
  "Chip",         // selectable pill
  "Card",         // elevated container
  "List",         // props.items + props.itemTemplate
  "Divider",
  "ProgressBar",
  "VoiceButton",  // records mic → /v1/transcribe-clean → bind.value

  // v2 content blocks (editorial).
  "Overline", "Heading", "Paragraph", "Quote", "Badge", "KeyValue", "Hero",

  // v2 morphing playground controls (Home).
  "VoiceToggle", "RefineButton", "DraftButton", "Pager",

  // v2 settings.
  "Row",

  // v2 dictionary / word chips.
  "DictionaryEditor", "WordChips",

  // v3 layout / navigation additions.
  "Grid",             // props.columns, gap; wraps children
  "MasonryGrid",      // like Grid but variable-height columns
  "Modal",            // props.open (bind), props.dismissable
  "BottomSheet",      // props.open (bind), props.snapPoints
  "ActionSheet",      // props.actions (list of {label, action, destructive})
  "Popover",          // anchored floating panel
  "Tooltip",          // props.content, wraps a child anchor
  "Collapsible",      // props.title, props.defaultOpen
  "StickyHeader",     // pins its first child while children scroll
  "SwipeableRow",     // props.leftActions, props.rightActions
  "PullToRefresh",    // wraps a scrollable; fires onRefresh
  "SafeArea",         // insets-only wrapper for edge-to-edge screens
  "Tabs",             // in-screen tabs, props.tabs

  // v3 inputs.
  "Switch",           // bind.value
  "Slider",           // bind.value; props.min/max/step
  "Stepper",          // bind.value; props.min/max/step
  "SegmentedControl", // props.options, bind.value
  "SearchField",      // props.placeholder, bind.value, on.onSubmit
  "Picker",           // props.options, bind.value
  "DatePicker",       // bind.value, props.mode ("date"|"time"|"datetime")

  // v3 data viz.
  "LineChart",        // props.series (array of {x, y}), props.color
  "BarChart",         // props.series (array of {label, value})
  "Sparkline",        // props.data (array of numbers)
  "ProgressRing",     // props.progress (0..1), props.label
  "Gauge",            // props.value, props.min, props.max
  "StatCard",         // props.label, props.value, props.delta
  "Waveform",         // amplitude visualizer; bind.level

  // v3 media.
  "Video",            // props.source, props.autoplay, props.loop
  "Audio",            // props.source, props.autoplay
  "Camera",           // props.mode ("photo"|"scan"), on.onResult
  "QRScanner",        // on.onResult
  "ImagePickerButton",// on.onResult → {uri}
  "Avatar",           // props.source, props.name (initials fallback)
  "AvatarStack",      // props.avatars

  // v3 feedback.
  "Toast",            // props.tone, props.message (fires from action, not usually authored)
  "Snackbar",         // like Toast but with an action button
  "LoadingSkeleton",  // shimmering placeholder
  "Confetti",         // triggered by action `confetti.fire`
  "Rating",           // props.value, on.onChange; props.max=5
  "EmptyState",       // props.icon, props.title, props.action
  "Countdown",        // props.until (ISO date), on.onComplete
  "LottieAnimation",  // props.preset (server-named), props.loop

  // v3 meta.
  "WebView",          // bounded HTML (terms, help pages)
  "SVG",              // inline SVG (props.d, props.viewBox)
  "Gradient",         // props.colors, props.direction
  "BlurBackground",   // wraps children under an iOS-blur backdrop
  "QRCode",           // props.value

  // v3 conditional / structural helpers.
  "IfElse",           // props.if (Condition), children=[thenNode, elseNode]
  "ForEach",          // props.items (state path), children=[template]
  "Portal",           // renders to a named layer (e.g. above toast)
] as const;

/** Named layouts for `template` + `blocks` screens. */
export const CORE_TEMPLATES = [
  "scroll", "feature", "list", "centered", "detail", "grid", "hero",
] as const;

// ===========================================================================
// 4. Actions — declarative behavior
// ===========================================================================
//
// Nodes reference actions by name (ActionRef) and the renderer interprets them.
// This is how the backend controls flow, navigation, network calls, haptics,
// media, and motion without shipping code.

/** A reference to a named action in ScreenResponse.actions, or an inline spec. */
export type ActionRef = string | ActionSpec;

export type ActionSpec =
  // --- navigation & flow ---
  | { kind: "navigate"; screenId: string; params?: Record<string, unknown> }
  | { kind: "navigateBack" }
  | { kind: "switchTab"; tabId: string }
  | { kind: "openUrl"; url: string; external?: boolean }
  | { kind: "openSettings"; target?: "app" | "keyboard" }
  | { kind: "openInAppBrowser"; url: string }
  | { kind: "dismiss" }
  // --- data & network ---
  | {
      kind: "callEndpoint";
      method: "GET" | "POST" | "PUT" | "DELETE";
      path: string;
      body?: Record<string, unknown> | string;
      assignTo?: string;
      onSuccess?: ActionRef;
      onError?: ActionRef;
    }
  | { kind: "refresh" }
  // --- local state ---
  | { kind: "setState"; path: string; value: unknown }
  | { kind: "toggleState"; path: string }
  | { kind: "incrementState"; path: string; by?: number }
  | { kind: "clearState"; path: string }
  // --- feedback & sensory ---
  | { kind: "haptic"; style: HapticStyle }
  | { kind: "toast"; message: string; tone?: "info" | "success" | "error" }
  | { kind: "snackbar"; message: string; actionLabel?: string; onAction?: ActionRef }
  | { kind: "playMedia"; url: string }
  | { kind: "stopMedia" }
  | { kind: "speak"; text: string; voice?: string }
  | { kind: "confetti" }
  // --- system / sharing / clipboard ---
  | { kind: "share"; text?: string; url?: string; title?: string }
  | { kind: "shareFile"; path: string; mimeType?: string }
  | { kind: "copyToClipboard"; text: string; toastMessage?: string }
  | { kind: "readClipboard"; assignTo: string }
  | { kind: "sms"; number?: string; body?: string }
  | { kind: "email"; to?: string; subject?: string; body?: string }
  | { kind: "phone"; number: string }
  | { kind: "download"; url: string; filename?: string; onSuccess?: ActionRef; onError?: ActionRef }
  | { kind: "saveToPhotos"; path: string }
  // --- media pickers ---
  | { kind: "pickImage"; assignTo: string; source?: "library" | "camera"; onSuccess?: ActionRef; onError?: ActionRef }
  | { kind: "pickDocument"; assignTo: string; types?: string[]; onSuccess?: ActionRef; onError?: ActionRef }
  | { kind: "scanQR"; assignTo: string; onSuccess?: ActionRef; onError?: ActionRef }
  // --- permissions ---
  | {
      kind: "requestPermission";
      permission:
        | "microphone" | "camera" | "notifications" | "photoLibrary"
        | "contacts" | "calendar" | "location" | "tracking";
      onGranted?: ActionRef;
      onDenied?: ActionRef;
    }
  // --- auth ---
  | { kind: "biometricPrompt"; reason?: string; onSuccess?: ActionRef; onError?: ActionRef }
  | { kind: "signOut" }
  // --- IAP / RevenueCat ---
  | { kind: "iap.showPaywall"; offeringId?: string; packageId?: string; onSuccess?: ActionRef; onError?: ActionRef }
  | { kind: "iap.subscribe"; productId: string; onSuccess?: ActionRef; onError?: ActionRef }
  | { kind: "iap.restore"; onSuccess?: ActionRef; onError?: ActionRef }
  | { kind: "iap.checkEntitlement"; entitlement: string; assignTo: string }
  // --- notifications ---
  | {
      kind: "scheduleNotification";
      title: string;
      body?: string;
      afterSeconds?: number;
      atIso?: string;
      identifier?: string;
      payload?: Record<string, unknown>;
    }
  | { kind: "cancelNotification"; identifier: string }
  | { kind: "requestPushPermission"; onGranted?: ActionRef; onDenied?: ActionRef }
  // --- analytics ---
  | { kind: "analytics.track"; event: string; props?: Record<string, unknown> }
  | { kind: "analytics.identify"; userId: string; traits?: Record<string, unknown> }
  | { kind: "analytics.reset" }
  // --- calendar / contacts ---
  | { kind: "calendar.addEvent"; title: string; startsAtIso: string; endsAtIso?: string; notes?: string; location?: string }
  // --- app-store review prompt ---
  | { kind: "requestReview" }
  // --- keyboard bridge (extension) ---
  | { kind: "keyboard.reload" }
  | { kind: "keyboard.setLayout"; language: string }
  // --- cache / dev ---
  | { kind: "clearCache" }
  | { kind: "reloadApp" }
  // --- composition ---
  | { kind: "sequence"; actions: ActionRef[] }
  | { kind: "parallel"; actions: ActionRef[] }
  | { kind: "condition"; if: Condition; then: ActionRef; else?: ActionRef }
  | { kind: "delay"; ms: number }
  | { kind: "log"; message: string; level?: "info" | "warn" | "error" };

export type HapticStyle =
  | "light"
  | "medium"
  | "heavy"
  | "selection"
  | "success"
  | "warning"
  | "error";

/** A small expression evaluated against state + flags for visibleIf/condition. */
export type Condition =
  | { eq: [string, unknown] }              // state path == value
  | { neq: [string, unknown] }             // state path != value
  | { gt: [string, number] }               // state path > value
  | { gte: [string, number] }              // state path >= value
  | { lt: [string, number] }               // state path < value
  | { lte: [string, number] }              // state path <= value
  | { in: [string, unknown[]] }            // state value ∈ list
  | { contains: [string, string] }         // state string includes substring
  | { startsWith: [string, string] }       // state string starts with prefix
  | { endsWith: [string, string] }         // state string ends with suffix
  | { truthy: string }                     // state/flag path is truthy
  | { falsy: string }                      // state/flag path is falsy
  | { entitled: string }                   // IAP entitlement id is active
  | { flag: string }                       // bootstrap flags[path] is truthy
  | { platform: "ios" | "android" }
  | { not: Condition }
  | { all: Condition[] }
  | { any: Condition[] };

// ===========================================================================
// 5. Theme & style tokens
// ===========================================================================
//
// The backend owns the look. Nodes reference tokens ("$color.primary") so the
// server can re-theme the whole app by changing the token map alone.

export interface ThemeTokens {
  color: Record<string, string>; // primary, bg, surface, text, muted, danger…
  space: Record<string, number>; // xs, sm, md, lg, xl
  radius: Record<string, number>;
  font: {
    family?: string;
    sizes: Record<string, number>; // body, h1, caption…
    weights: Record<string, string>; // regular, bold…
  };
}

/** Style values: raw (number/string) or a token ref string starting with "$". */
export type StyleValue = string | number;

export interface StyleProps {
  // layout
  flex?: number;
  direction?: "row" | "column";
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between" | "around";
  gap?: StyleValue;
  padding?: StyleValue;
  margin?: StyleValue;
  width?: StyleValue;
  height?: StyleValue;
  // visual
  background?: StyleValue;
  color?: StyleValue;
  radius?: StyleValue;
  borderWidth?: number;
  borderColor?: StyleValue;
  opacity?: number;
  fontSize?: StyleValue;
  fontWeight?: StyleValue;
  textAlign?: "left" | "center" | "right";
  [key: string]: unknown; // forward-compat; unknown keys ignored by renderer
}

// ===========================================================================
// 6. Motion
// ===========================================================================

export interface MotionSpec {
  appear?: MotionPreset;
  exit?: MotionPreset;
  durationMs?: number;
  delayMs?: number;
  /** Loops (e.g. a pulsing record button). */
  loop?: boolean;
}

export type MotionPreset =
  | "fade"
  | "fadeInUp"
  | "fadeInDown"
  | "scaleIn"
  | "slideInLeft"
  | "slideInRight"
  | "pulse";

// ===========================================================================
// 7. Keyboard config (the OS-legal "SDUI" for the keyboard)
// ===========================================================================
//
// The keyboard is a sandboxed native extension that must draw instantly and
// work offline, so it cannot live-render from the server per keystroke. Instead
// it fetches this config (GET /v1/keyboard/config), CACHES it, and refreshes in
// the background. This server-controls theme, layout, languages, copy, and which
// features are on — while the "brain" (refine/transcribe/tone) stays live API.

export interface KeyboardConfigResponse {
  schemaVersion: number;
  theme: {
    background: string;
    key: string;
    keyText: string;
    accent: string; // the ✨ Refine / active color
    keyPressed: string;
    /**
     * v2 additions honored by the SDUI-capable keyboard build. When present
     * they win over `background`. Older Swift/Kotlin binaries ignore them and
     * continue to read `background` as an opaque hex.
     */
    backgroundEffect?: KeyboardEffect;
    keyEffect?: KeyboardEffect;
    keyRadius?: number;
    keyShadow?: boolean;
  };
  /** Enabled key layouts, one per language; first is default. */
  layouts: KeyboardLayout[];
  /** Feature switches the native shell honors. */
  features: {
    voice: boolean;
    refine: boolean;
    streaming: boolean;
    /**
     * v2: turn on the SDUI-driven renderer. When true, the extension walks
     * `root` instead of laying out from `layouts`+`theme`.
     */
    sdui?: boolean;
  };
  /** All user-facing strings, so copy is server-controlled. */
  labels: Record<string, string>;
  /**
   * Backend-tunable knobs for keyboard visuals + behavior. Every value here
   * has a native default; pushing an override lets you change the look/feel
   * without a rebuild. Full reference (dot-notation keys under "kb.*"):
   *
   *   Press feedback
   *     kb.press.fadeMs        (default 120)  release-fade duration; 0 = instant snap
   *
   *   Backspace-on-hold
   *     kb.delete.initialDelayMs      (default 500)  hold time before repeat starts
   *     kb.delete.repeatIntervalMs    (default 90)   per-char delete cadence
   *     kb.delete.wordAfterChars      (default 20)   how many chars before word-jump mode
   *
   *   Auto-cap
   *     kb.autoCap.enabled            (default true) global auto-cap kill switch
   *
   *   Shift key
   *     kb.shift.iconLowerOutlined    (default "arrowtriangle.down")
   *     kb.shift.iconUpperOutlined    (default "arrowtriangle.up")
   *     kb.shift.iconLowerLocked      (default "arrowtriangle.down.fill")
   *     kb.shift.iconUpperLocked      (default "arrowtriangle.up.fill")
   *     kb.shift.iconSize             (default 16)
   *     kb.shift.iconWeight           (default "semibold")
   *     kb.shift.lockedColor          (default "#FF6B1F")
   *     kb.shift.longPressMs          (default 350)  hold-to-lock threshold
   *
   *   Mic key
   *     kb.mic.idleIcon               icon-spec (default = bundled TailzuMark)
   *     kb.mic.idleIconInset          (default 12)
   *     kb.mic.recordingIcon          icon-spec (default = SF "minus" thick bar)
   *     kb.mic.recordingIconSize      (default 14)
   *     kb.mic.recordingIconWeight    (default "heavy")
   *
   *   Dictation visuals — key dim + dot stream
   *     kb.dictation.dim.enabled      (default true)
   *     kb.dictation.dim.color        (default "#000000")
   *     kb.dictation.dim.alpha        (default 0.45)
   *     kb.dictation.dim.fadeMs       (default 250)
   *     kb.dictation.dots.enabled     (default true)
   *     kb.dictation.dots.color       (default "#FF6B1F")
   *     kb.dictation.dots.size        (default 14)
   *     kb.dictation.dots.birthRate   (default 7)     dots per second
   *     kb.dictation.dots.lifetimeMs  (default 1800)
   *     kb.dictation.dots.decayMs     (default 2500)  post-stop trailing dots
   *     kb.dictation.dots.spread      (default 0.08)
   *     kb.dictation.dots.velocityJitter (default 0.05)
   *     kb.dictation.dots.scale       (default 0.35)
   *     kb.dictation.dots.scaleRange  (default 0.10)
   *     kb.dictation.dots.alphaSpeed  (default -0.55)
   *
   *   Smart typography
   *     kb.smartPunctuation           (default true)  curly quotes / em-dash / ellipsis
   *     kb.smartPeriod                (default true)  double-space → ". "
   *
   *   Tones
   *     kb.tones                      comma-separated list; default "Neutral,Casual,Formal,Excited"
   *
   *   Toast
   *     kb.toast.durationMs   (default 2000)  visible time before fade begins
   *     kb.toast.fadeInMs     (default 180)
   *     kb.toast.fadeOutMs    (default 250)
   *     kb.toast.height       (default 32)
   *     kb.toast.offsetY      (default -18)   negative = above bottom anchor
   *     kb.toast.fontSize     (default 13)
   *     kb.toast.color.error   (default "#FF3B30E6")
   *     kb.toast.color.success (default "#34C759E6")
   *     kb.toast.color.info    (default "#000000D9")
   *
   *   Confetti
   *     kb.confetti.colors            array of hex strings (default 6 system colors)
   *     kb.confetti.birthRate         (default 6)     particles/sec per color
   *     kb.confetti.lifetimeMs        (default 3000)
   *     kb.confetti.velocity          (default 200)
   *     kb.confetti.spin              (default 3)     rad/sec
   *     kb.confetti.scale             (default 0.06)
   *     kb.confetti.burstMs           (default 400)   birth cutoff
   *     kb.confetti.teardownMs        (default 3500)
   *
   *   Waveform
   *     kb.waveform.barCount          (default 24)
   *     kb.waveform.color             (default "#999999")
   *     kb.waveform.radius            (default 1.5)
   *     kb.waveform.spacing           (default 3)
   *     kb.waveform.height            (default 24)
   *     kb.waveform.levelMultiplier   (default 0.6)
   *     kb.waveform.baselineMin       (default 0.2)
   *     kb.waveform.baselineMax       (default 0.6)
   *     kb.waveform.fps               (default 30)
   *
   *   Accent tray (long-press on a letter with accents)
   *     kb.accentTray.longPressMs     (default 500)
   *     kb.accentTray.chipWidth       (default 40)
   *     kb.accentTray.chipFontSize    (default 22)
   *     kb.accentTray.chipRadius      (default 6)
   *     kb.accentTray.chipActiveBg    (default "#007AFF")
   *     kb.accentTray.height          (default 48)
   *     kb.accentTray.offsetY         (default -52)   negative = above the key
   *     kb.accentTray.radius          (default 8)
   *     kb.accentTray.padding         (default 4)
   *     kb.accentTray.gap             (default 4)
   *
   *   Return key
   *     kb.returnKey.actionBg   (default "#007AFF")   accent for Go/Send/Search/Done
   *     kb.returnKey.actionFg   (default "#FFFFFF")
   *
   *   Trackpad (space-bar long-press → cursor mode)
   *     kb.trackpad.enabled           (default true)
   *     kb.trackpad.longPressMs       (default 300)
   *     kb.trackpad.ptPerChar         (default 7)     pt of drag per char step
   *
   *   Smart-period window (double-space → ". " gap)
   *     kb.smartPeriod.windowMs       (default 500)
   *
   *   Network
   *     kb.network.timeoutMs          (default 15000) callEndpoint request timeout
   *
   *   Suggestion bar
   *     kb.suggestion.gap             (default 8)
   *     kb.suggestion.edgeInset       (default 8)
   *     kb.suggestion.chipRadius      (default 12)
   *     kb.suggestion.chipPadV        (default 4)
   *     kb.suggestion.chipPadH        (default 12)
   *     kb.suggestion.height          (default 36)
   *
   *   Key shadow
   *     kb.key.shadow.color           (default "#000000")
   *     kb.key.shadow.offsetY         (default 1)
   *     kb.key.shadow.radius          (default 0)
   *     kb.key.shadow.opacity         (default 0.4)
   *
   *   Audio recorder (dictation input)
   *     kb.audio.sampleRate           (default 16000)
   *     kb.audio.channels             (default 1)
   *     kb.audio.quality              (default "high")  min/low/medium/high/max
   *
   *   Dictation params (sent to backend endpoints)
   *     kb.dictation.targetApp        (default "Generic")
   *     kb.dictation.language         (default "auto")
   *
   * Icon-spec fields accept any of:
   *   { sf: "mic.fill" } / { asset: "TailzuMark" } / { url: "https://…" } / { emoji: "🎙️" }
   *   Or shorthand strings: "sf:mic.fill" | "asset:TailzuMark" | "https://…"
   */
  flags?: Record<string, unknown>;
  /** Seconds before the shell refetches config. */
  cacheTtlSeconds: number;
  /**
   * v2 (SDUI keyboard): the whole keyboard as a Node tree the native
   * renderer walks. Uses KEYBOARD_COMPONENTS + KEYBOARD_ACTIONS below.
   * When absent, the extension falls back to `layouts`+`theme`+`features`.
   */
  root?: KeyboardNode;
  /** v2: named keyboard actions referenced by node `on` handlers. */
  actions?: Record<string, KeyboardActionSpec>;
  /** v2: an opaque cache token — bump to force clients to drop cached configs. */
  cacheVersion?: string;
  /**
   * v3 (dark/light adaptive): explicit per-appearance palettes. When the next
   * SDUI-renderer build lands, it will read `themeDark` / `themeLight` based
   * on the extension's current `UITraitCollection.userInterfaceStyle` and
   * re-render on `traitCollectionDidChange`. Until then, the shipped renderer
   * ignores these fields entirely and reads the top-level `theme` — which we
   * keep populated as a backward-compatible dark-mode default. Same for the
   * SDUI `root`: we may emit `rootDark` / `rootLight` later; today just `root`.
   */
  themeDark?: KeyboardConfigResponse["theme"];
  themeLight?: KeyboardConfigResponse["theme"];
}

export interface KeyboardLayout {
  /** ISO code or name, e.g. "en", "hi", "hinglish". */
  language: string;
  /** Human-readable name for the language switcher (endonym). */
  displayName?: string;
  /** Rows of key captions; specials use tokens like "{shift}" "{space}". */
  rows: string[][];
}

/** Backdrop / surface effect the native renderer maps to platform APIs. */
export type KeyboardEffect =
  | { kind: "solid"; color: string }
  | { kind: "blur"; style: "regular" | "chromeMaterialDark" | "chromeMaterialLight" | "systemThinMaterial" | "systemUltraThinMaterial" }
  | { kind: "gradient"; colors: string[]; direction?: "vertical" | "horizontal" };

/**
 * A subset of the app SDUI Node tree — only what the keyboard extension can
 * render safely under the 60MB memory ceiling. Extras (bind, visibleIf) are
 * evaluated against the keyboard's state store, which exposes:
 *
 *   state.shift / capsLock / dictating / refining / hasFullAccess
 *   state.layoutId / tone / trackpadActive / status / micLevel
 *   state.primaryLanguage      → "EN" / "FR" / "DE" (follows input mode)
 *   state.hasMultipleKeyboards → true when needsInputModeSwitchKey is on
 *   state.appearance           → "dark" | "light" (trait collection)
 *   state.deviceModel          → "iPhone" / "iPad"
 *   state.systemVersion        → "18.5" etc.
 *   state.isNetworkReachable   → boolean, updated on major state changes
 *   state.keyboardHeight       → CGFloat, current input view height
 *   state.user.<any>           → backend scratch dict — setState / toggleState /
 *                                 incrementState / clearState / readClipboard /
 *                                 callEndpoint.assignTo all write here. Reads
 *                                 via bind: { text: "user.myFlag" } or
 *                                 visibleIf: { truthy: "state.user.myFlag" }.
 *
 * Backend can use any of these in bind or visibleIf without a native rebuild.
 *
 * Icon shapes accepted by IconKey.props.icon AND Image.props.source (no rebuild):
 *
 *   { sf: "mic.fill" }                    // SF Symbol
 *   { asset: "TailzuMark" }               // bundled UIImage
 *   { url: "https://cdn/mark@3x.png" }    // remote — auto-cached to disk
 *   { emoji: "🎙️" }                      // rendered as title text
 *   "sf:mic.fill" | "asset:TailzuMark" | "https://…"   // string shorthand
 *
 * Style bag additions honored by all nodes:
 *   opacity: number             // 0..1
 *   borderColor / borderWidth   // hex + pt
 *   shadow: { color, opacity, radius, offset: [x, y] }
 */
export interface KeyboardNode {
  type: string;
  id?: string;
  props?: Record<string, unknown>;
  style?: Record<string, unknown>;
  children?: KeyboardNode[];
  bind?: Record<string, string>;
  on?: Partial<Record<"onPress" | "onLongPress" | "onDoubleTap", KeyboardActionRef>>;
  effect?: KeyboardEffect;
  visibleIf?: Condition;
}

/** Component types the native keyboard renderer understands. */
export const KEYBOARD_COMPONENTS = [
  // ----- layout / structure -----
  "Container",     // vertical column, main root
  "Row",           // horizontal row (a layout row of keys)
  "Column",        // vertical group
  "Spacer",        // fills flex space
  "ScrollView",    // horizontal or vertical scrollable region (props.horizontal)
  // ----- keys (specialized behaviors) -----
  "LetterKey",     // props.char
  "IconKey",       // props.icon (sf/asset/url/emoji spec — see IconKey docs above)
  "SpaceKey",
  "ShiftKey",
  "ReturnKey",
  "BackspaceKey",
  "GlobeKey",      // language switcher
  "MicKey",        // triggers dictation
  "RefineKey",     // triggers /v1/refine on current text
  // ----- data + status -----
  "SuggestionBar", // predictions row
  "Waveform",      // live mic amplitude
  "StatusLabel",   // text status (Listening…, Refining…)
  "Divider",
  "BlurBackdrop",  // wraps children under a UIVisualEffectView
  // ----- generic display + input (backend can render arbitrary UI) -----
  "TextLabel",     // props.text + style.fg/fontSize/fontWeight/align; bind.text supported
  "Image",         // props.source (icon spec: sf/asset/url/emoji) — same shape as IconKey.icon
  "ProgressBar",   // bind.value → 0..1; style trackBg/fg/radius
  "Toggle",        // UISwitch bound to state.user.* via bind.value; on.onChange action ref
] as const;

/**
 * Actions the keyboard extension can execute. This union is intentionally
 * broad — the goal is to let backend compose almost any keyboard behavior
 * without a native rebuild.
 *
 * Extension slot: `{ kind: "extension", name, params? }` invokes a native
 * handler registered via SDUIRenderer.registerExtension(). Unknown names
 * silently no-op, so backend can push forward-looking action names to older
 * builds without crashing them.
 */
export type KeyboardActionRef = string | KeyboardActionSpec;
export type KeyboardActionSpec =
  // ----- text + editing -----
  | { kind: "insertText"; text: string }
  | { kind: "insertKey"; char: string }
  | { kind: "deleteBackward" }
  | { kind: "deleteWord" }
  | { kind: "shift" }              // toggle shift
  | { kind: "capsLock" }
  | { kind: "return" }
  // ----- layouts + dictation + refine -----
  | { kind: "switchLayout"; language?: string }   // cycle if not provided
  | { kind: "showLanguageMenu" }
  | { kind: "startDictation" }
  | { kind: "stopDictation" }
  | { kind: "runRefine" }
  | { kind: "cycleTone" }
  // ----- app / system -----
  | { kind: "openApp"; screenId?: string }
  | { kind: "openSettings" }
  | { kind: "openUrl"; url: string; external?: boolean }
  // ----- feedback -----
  | { kind: "haptic"; style: HapticStyle }
  | { kind: "toast"; message: string; tone?: "info" | "success" | "error" }
  | { kind: "confetti" }
  | { kind: "speak"; text: string; voice?: string }
  | { kind: "playMedia"; url: string }
  | { kind: "stopMedia" }
  // ----- clipboard + share -----
  | { kind: "copyToClipboard"; text: string; toastMessage?: string }
  | { kind: "readClipboard"; assignTo: string }
  | { kind: "share"; text?: string; url?: string; title?: string }
  // ----- state store (backend scratch dict) -----
  | { kind: "setState"; path: string; value: unknown }
  | { kind: "toggleState"; path: string }
  | { kind: "incrementState"; path: string; by?: number }
  | { kind: "clearState"; path: string }
  // ----- network + analytics + logging -----
  | {
      kind: "callEndpoint";
      method: "GET" | "POST" | "PUT" | "DELETE";
      path: string;
      body?: Record<string, unknown> | string;
      assignTo?: string;
      onSuccess?: KeyboardActionRef;
      onError?: KeyboardActionRef;
    }
  | { kind: "analytics.track"; event: string; props?: Record<string, unknown> }
  | { kind: "log"; message: string; level?: "info" | "warn" | "error" }
  // ----- cache / reload -----
  | { kind: "clearCache" }
  | { kind: "reloadApp" }
  // ----- flow control -----
  | { kind: "sequence"; actions: KeyboardActionRef[] }
  | { kind: "parallel"; actions: KeyboardActionRef[] }
  | { kind: "condition"; if: Condition; then: KeyboardActionRef; else?: KeyboardActionRef }
  | { kind: "delay"; ms: number }
  // ----- extensibility (forward-compat slot) -----
  | { kind: "extension"; name: string; params?: Record<string, unknown> };
