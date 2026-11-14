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
    /** What this phone already has. Device-level, so a different account on
     *  the same handset inherits them — which is why the server routes
     *  onboarding on these rather than on the profile alone. Absent from older
     *  clients; absent reads as not granted. */
    micGranted?: boolean;
    keyboardEnabled?: boolean;
    keyboardReady?: boolean;
  };
  /** The bots' catalog as this build has it (anim/SPEC.md 3.9): at most 512 bytes, no person data. */
  looks?: { v: number; f: number; ok: boolean; why?: string; bad?: string[]; slow?: string[] };

  // --- vocabulary 2 (section 8; pure/SPEC.md 2.11). Absent on every build before V1, which reads as vocab 1. ---
  /** 2 when this build carries the screen kernel. Absent or 1: the old fixed node list, no expressions. */
  vocab?: number;
  /** The sha of the kernel this build carries, for telling one OTA from another. */
  kernel?: string;
  /** The building blocks this build really has, by the names in SDUI_BLOCKS. They arrive over several updates, so one
   *  number could never say which of them a phone holds. */
  blocks?: BlockName[];
  /** The binary's runtime string (app.config.ts runtimeVersion), so the server can tell "open X0 again" (an update is
   *  waiting on the same runtime) from "update X0" (a store build is needed). */
  runtime?: string;
  /** Only what the DEVICE switched off for itself (a kill switch, the crash guard). Never "not built yet". */
  off?: string[];
  /** The safety floor, and what went wrong on this launch. */
  sdui?: { ok?: boolean; safe?: number; bad?: string[]; slow?: string[] };
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

/**
 * How a media slot is shown — the shape of its window, not the file in it.
 *
 * Stored ON the registry entry, so changing how the opening plays is a POST to
 * /v1/media/present, not an edit to a screen builder and a deploy. Every field
 * is optional; whatever is missing falls back to that screen's own default.
 */
export interface MediaPresent {
  /** The window the media plays in.
   *  full  — edge to edge
   *  plate — a circle, the size of the in-app mic
   *  card  — an inset panel, rounded */
  shape?: "full" | "plate" | "card";
  /** How the media meets that window. "cover" fills and crops; "contain"
   *  keeps the whole frame and its proportions. */
  fit?: "cover" | "contain";
  /** Corner radius, px. Ignored by "plate", which is always a circle. */
  radius?: number;
  /** Gap between the media and the screen edges, px. */
  inset?: number;
  /** Diameter of a plate, or max width of a card, px. */
  size?: number;
  /** Width ÷ height. A card keeps this; full and plate ignore it. */
  aspectRatio?: number;
  /** What is painted behind the media. */
  background?: string;
  /** How long the screen holds before it moves on, ms. A GIF reports nothing
   *  when it ends, so for a GIF this IS the length of the scene. */
  holdMs?: number;
  /** Whether the clip repeats. Default true: a hero is ambient. False plays it
   *  once and freezes on the last frame. */
  loop?: boolean;
  /**
   * Move the media inside its window, as a PERCENTAGE of that window —
   * nudgeX of its width, nudgeY of its height. Positive is right and down.
   *
   * `cover` centres the FRAME. The subject of a frame is rarely at its centre,
   * and the opening media is the case in point: its mark sits at (0.474,
   * 0.471) of its own art, so `cover` lands it left of and above the middle of
   * the screen while the launch screen draws the same mark dead centre. That
   * difference is the jump between them, and it is not in the art — it is in
   * where the art is placed.
   *
   * Percentages rather than points because the miss is not a fixed size: on a
   * phone taller than the art, `cover` scales the art to the screen's HEIGHT,
   * so the offset grows with the device. A percentage is right on all of them.
   *
   * Applies to the "full" shape. A nudge replaces the pinned right/bottom
   * edges, so it and `inset` are alternatives — the nudge wins.
   *
   * A nudge is measured from the media's BOX, which `scale` may have shrunk.
   * Scaling centres the box first, so a nudge means the same thing at any
   * scale: how far off centre the media sits.
   */
  nudgeX?: number;
  nudgeY?: number;
  /**
   * WHERE THE SUBJECT IS, and where it should land. The replacement for
   * nudgeX/nudgeY, and the reason placement stopped needing to be re-measured.
   *
   * A nudge stores the ANSWER — an offset someone found by eye, correct for one
   * art file on one aspect ratio, wrong the moment either changes. These store
   * the two FACTS the answer is computed from:
   *
   *   aspect          the art's width ÷ height        a property of the file
   *   focusX/focusY   where the subject sits in it    a property of the file
   *   anchorX/anchorY where it should sit on screen   a property of the screen
   *
   * All 0..1 except aspect. The client measures the box it is actually drawing
   * into and does the arithmetic there, so the placement is right on hardware
   * nobody tested on — which a stored offset can never be. Swap the art and
   * only `focus` changes; move the mark and only `anchor` does.
   *
   * `aspect` is the switch: without the art's shape there is nothing to
   * compute, so media that does not declare one keeps the old centred `cover`.
   */
  aspect?: number;
  focusX?: number;
  focusY?: number;
  anchorX?: number;
  anchorY?: number;
  /**
   * WHICH AXIS THE ART IS MADE TO FIT when it is drawn behind a whole screen.
   *
   * `focus`/`anchor` above choose WHAT SURVIVES a crop. This chooses whether
   * there is a crop at all, and it is the answer for art that must not be cut
   * on any axis — a keyboard reaching almost the full width of a 9:16 frame,
   * say. No phone is 9:16 any more: every one of them is taller, so `cover`
   * matches the height and takes about a tenth of the width off each side,
   * which on that art is the outer column of keys. No focal point saves it,
   * because the thing that must survive is the full width.
   *
   *   window  fill the whole screen, cropping whichever axis overflows. The
   *           default, and right for art that is a texture or a backdrop.
   *   width   the box is as wide as the screen and as tall as the art's own
   *           aspect makes it. NOTHING is cropped; what is left over is the
   *           screen's own ground.
   *   height  the same trade the other way round, for art shorter than the
   *           window is tall.
   *
   * `width` and `height` need `aspect` — without the art's shape there is no
   * box to derive — and fall back to `window` when it is missing.
   *
   * The leftover is only invisible while the art's own edge matches the screen
   * behind it. That is a real condition, not a detail: this is right for art
   * grounded in the screen's colour and wrong for art that ends in a hard edge.
   */
  /**
   * HOLD THE FIRST FRAME FOR THIS LONG, THEN PLAY.
   *
   * So a screen can open on a photograph rather than opening mid-motion. The
   * Video node's `playing` is bindable, so the wait is a delay and a setState
   * — nothing native.
   *
   * This shipped once and had to be pulled, because expo-video has no poster:
   * a player created and then paused has decoded no frames, so a clip told to
   * wait a second and a half showed a second and a half of BLACK, which is
   * indistinguishable from a missing file. The client now primes the surface —
   * play, then stop on the next tick and rewind — so a paused clip holds a real
   * frame. Do not restore this against an app build older than that fix.
   */
  startDelayMs?: number;
  /**
   * HOW LONG THE LAST FRAME IS HELD before whatever is showing the clip moves
   * on. Needs `loop: false`, or there is no last frame to hold.
   *
   * A demo that cuts on its final frame teaches nothing: the thing being
   * demonstrated is the state it ends in, and that state needs a beat to be
   * read. Together with startDelayMs and the measured duration this is what a
   * screen's whole length is computed from, rather than guessed at.
   */
  endHoldMs?: number;
  /**
   * How much of the box the art is drawn at, 0.05–1, with `fill`.
   *
   * `fill: "width"` makes the art exactly as wide as the screen, which is the
   * right answer for art that is meant to reach the edges and the wrong one for
   * art that needs room around it. This shrinks the box, keeping its shape and
   * its pinned edge, so the subject can be pulled back off the sides without
   * re-exporting anything.
   *
   * What is left over is the screen's own ground, so this is invisible on art
   * matted in the same colour and a visible inset on art that is not.
   */
  fill?: "window" | "width" | "height";
  /**
   * Which edge the box is held against when `fill` leaves a remainder.
   *
   * The art was composed against one of its own edges — the keyboard sits on
   * the bottom of its frame because that is where a keyboard is — and pinning
   * it to the matching edge of the screen is what makes the leftover read as
   * the screen continuing rather than as a bar.
   */
  pin?: "top" | "bottom" | "center";
  /**
   * How much of the window the media is drawn at, 0.05–1. 1 fills it, which is
   * the default and what full bleed means.
   *
   * Below 1 the media is drawn smaller and centred, on the window's own
   * background. This exists to MATCH something the media cannot change: a
   * launch screen's icon is a fixed size compiled into the binary, so when the
   * opening film's subject comes out larger than it, the film is the only side
   * that can move without a build.
   *
   * It is a compromise, and it should be named as one. Shrinking the film to
   * meet an undersized launch icon is the wrong direction — the icon is what
   * is wrong — and the moment a build can carry the right icon size, this
   * should go back to 1. A scaled film is also only invisible while its own
   * edges are the same colour as the screen behind it; on brighter art the
   * gutters show.
   */
  scale?: number;
  /**
   * Draw the media in a box of this many POINTS, instead of a share of the
   * screen. Either axis, or both; an axis left out keeps the screen-relative
   * behaviour (`scale`).
   *
   * This is the only way to match something the platform measures in points.
   * A launch screen's icon is a fixed size compiled into the binary — 17pt on
   * a mini and 17pt on a Pro Max. Media under `cover` is a share of the screen
   * — 17pt on a mini, 20pt on a Pro Max. A percentage of a number that changes
   * can never equal a number that does not, so the two only agree on one screen
   * size. Fixing the box in points puts both on the same ruler, and then they
   * agree on all of them.
   *
   * What it costs: the media stops filling the screen, and reads smaller on
   * bigger phones. For art that is a subject on the screen's own background
   * that costs nothing — the subject is the only thing visible and it is now
   * exact. For art that reaches its own edges, the box becomes visible.
   *
   * The box is centred, then nudged, so nudgeX/nudgeY keep their meaning: how
   * far off centre, in percent of the box.
   */
  boxWidth?: number;
  boxHeight?: number;
}

export interface MediaEntry {
  url: string;
  contentType: string;
  size: number;
  uploadedAt: number;
  key?: string;
  /** Set by POST /v1/media/present. Absent means "use the screen's default". */
  present?: MediaPresent;
  /** A video's first frame as a still, cut by the server; `from` is the video it came from. */
  poster?: { url: string; contentType: string; from: string };
}

export interface BootstrapRequest {
  capabilities: ClientCapabilities;
  /** Opaque session/auth token if the user is signed in. */
  authToken?: string;
  /**
   * How many times this install has opened the app, this one included.
   *
   * Lets the server time a prompt by familiarity rather than by calendar —
   * "once they have been here a few times" is a thing only the client can
   * count, and counting it here keeps the decision itself on the server.
   */
  launchCount?: number;
}

export interface BootstrapResponse {
  schemaVersion: number;
  /** Global design tokens; individual screens may override pieces. */
  theme: ThemeTokens;
  /** The app-level navigation chrome (tabs / stack). */
  navigation: NavigationShell;
  /** Screen to render first. */
  initialScreenId: string;
  /**
   * Optional remote feature flags the renderer can read in conditions.
   * Values are opaque to the framework — most flags are primitives, but a
   * few carry small JSON objects (e.g. media specs, deep-link shapes) so
   * the type is intentionally permissive.
   */
  flags?: Record<string, boolean | number | string | Record<string, unknown> | unknown[]>;
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
  /** A card shown over the app on open — an announcement, a nudge, an offer. */
  launchCard?: LaunchCard;
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
  /**
   * Screens to fetch and store on launch, before the user asks for them.
   *
   * Clients used to warm the tab destinations only, so every screen one tap
   * deeper waited on the network the first time it was opened — on every
   * install and again after every cacheVersion bump. The server knows the
   * reachable set; this is it. Absent = the client warms its tabs, as before.
   */
  warmScreenIds?: string[];
  /** Abuse and fraud prevention (docs: trust). Present only when the server wants a check now. The phone runs each step once, in
   *  the background, never blocking a screen, and only the steps its capabilities allow. */
  trust?: TrustAsk;
}

/**
 * WHAT THE PHONE IS ASKED TO PROVE (docs: trust, the perms2 design's §8.5). Never a tracking signal and never an identity: each
 * step asks Apple or Google whether this is the real app on a real device, and the server keeps only the answer.
 */
export interface TrustAsk {
  /** Single use, 5 minutes, base64url of 32 random bytes. Hashed by the phone as "x0|<step>|" + challenge. */
  challenge: string;
  do: ("appAttest" | "appAssert" | "deviceCheck" | "playIntegrity")[];
  /** Play Integrity's Cloud project number (not a secret). */
  cloudProject?: string;
}
/** POST /v1/trust/ios/attest, /ios/assert, /ios/devicecheck, /android/integrity. Each answers 204; nothing comes back to act on. */
export interface TrustAttestBody { challenge: string; keyId: string; attestation: string }      // base64
export interface TrustAssertBody { challenge: string; keyId: string; assertion: string }        // base64
export interface TrustDeviceCheckBody { token: string }                                         // base64
export interface TrustIntegrityBody { challenge: string; token: string }
/** On failure the phone posts the same route with { challenge, failed: "<code>" } (unsupported, throttled, no_play, timeout, …). */
export interface TrustFailedBody { challenge: string; failed: string }

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
/**
 * A card the app puts up when it opens: something to say, and a way to act on
 * it. A new feature to point at, a setup step never finished, an offer.
 *
 * `root` is an ordinary node tree, so there is no fixed card shape to work
 * around — a title and a button, or art and three choices, are the same
 * amount of backend and no amount of app. Its buttons carry ordinary actions;
 * `navigate` is what sends someone to the screen the card is about.
 *
 * Inside the card, `navigate` and `dismiss` both close it first, so a card is
 * never left hanging over the screen it just sent you to. Nothing else needs
 * to know it exists.
 *
 * `id` IS THE SHOWING. A card is shown once per id and then remembered, so
 * changing the copy of a card people have already seen shows nobody anything;
 * changing its id shows everybody. That is the intended way to send a second
 * announcement, and the reason the id is not derived from the content.
 */
export interface LaunchCard {
  /** Shown once per id. Change it to say something new. */
  id: string;
  /** The card itself. Any node tree. */
  root: Node;
  /**
   * "once" (default) — remembered per id, per install.
   * "everyLaunch" — shown on every cold open. For a card that is a state, not
   * an announcement: an expired subscription, a setup step still owed.
   */
  repeat?: "once" | "everyLaunch";
  /** Tap outside to close. Default true; false makes the card's own controls
   *  the only way out, for something that must be answered. */
  dismissOnBackdrop?: boolean;
  /** Behind the card. Defaults to a scrim over the app. */
  backdrop?: string;
  /** The card container's own style — width, radius, padding, fill. */
  sheet?: Record<string, unknown>;
}

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

/**
 * One tab icon, as paths on a 32-unit grid.
 *
 * Two states, one geometry. A layer is stroked at `stroke` when idle and at
 * `activeStroke` when the tab is open; `fill` / `activeFill` switch it to a
 * solid instead. `punch` is for a hole: filled with the bar's own surface
 * colour when active, so a solid shape keeps its cut-out. Colour is never in
 * here — idle takes the bar's muted colour and active the brand amber, and
 * both belong to the theme, not the icon.
 */
export interface TabGlyph {
  /** Defaults to "0 0 32 32". */
  viewBox?: string;
  layers: Array<{
    d: string;
    stroke?: number;
    activeStroke?: number;
    fill?: boolean;
    activeFill?: boolean;
    punch?: boolean;
    opacity?: number;
    /**
     * This layer's own colour, instead of the bar's.
     *
     * The glyph used to be one colour with opacity standing in for a second —
     * and a dimmed accent is not another colour, it is the same colour saying
     * less. Two real tones let the SHAPE be one material and the thing that
     * happened be the accent, which is the whole idea these icons are built on.
     *
     * Absent, the layer takes the bar's colour exactly as before.
     */
    color?: string;
    /** The same, for the selected state. Falls back to `color`, then the bar. */
    activeColor?: string;
  }>;
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
        /**
         * The tab's icon, as DATA. The backend is the creator and the app is
         * a renderer, and an icon is the one place that rule was quietly not
         * true: the app matched the tab id against a set of shapes it carried
         * itself, and the `icon` field above was never read. Now the shape
         * comes down the wire, so a redrawn set ships with a cache bump.
         *
         * Absent → the app falls back to the set it was built with.
         */
        glyph?: TabGlyph;
      }>;
      /** Draw the thread that runs across the whole bar behind the icons.
       *  Absent means yes. */
      rail?: boolean;
      /**
       * Which tab the app opens on. Absent means the first one, which is what
       * every client did before this existed.
       *
       * SERVER-DECIDED, because it depends on something only the server knows:
       * whether this person has ever reached the tabs before. A brand-new user
       * who has just finished onboarding lands on You — the tab that is about
       * setting the product up for them. Everyone after that lands on Stats,
       * which is the one worth reopening the app for.
       */
      initialTabId?: string;
      /**
       * THE DOCK — the tabs as a cluster of separate objects rather than a bar.
       *
       * A bar spreads its tabs across the full width and lets the edges of the
       * screen do the spacing, which is right when the tabs are labels on a
       * strip. These are not: they are three marks, and spread that far apart
       * they stop being one control and become three unrelated things sitting
       * near the bottom of the app.
       *
       * Close together, each on its own rounded ground, they read as one group
       * with three positions in it — which is exactly what a tab bar is, and
       * it says so without a panel behind the lot of them.
       *
       * Absent → the full-width row every client drew before this existed.
       */
      dock?: {
        /** The square each icon sits on. */
        size: number;
        /** Its corner. Half the size would make discs; less keeps them squares. */
        radius: number;
        /** Between one square and the next. Small — that is the whole point. */
        gap: number;
        /** The ground under an icon you are not on. */
        background: string;
        /** And under the one you are. Absent → the same, and only the icon says. */
        activeBackground?: string;
        /** Extra lift above whatever the device reports as its safe inset. */
        lift?: number;
      };
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
  /** Caller's UTC offset in minutes (JS -getTimezoneOffset() convention) so
   * server-baked per-day stats bucket in the user's local day. */
  tzOffsetMinutes?: number;
}

export interface ScreenResponse {
  schemaVersion: number;
  screenId: string;
  /** Live topics (backend src/live/bus.ts): when the server says one changed, the open screen reloads itself. */
  liveTopics?: string[];
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
  /**
   * When true, the client hides its app-level chrome (top bar with brand /
   * back / gear, bottom tab bar) for this screen so the root renders truly
   * full-bleed. Use for splash-adjacent screens like the intro slideshow,
   * paywalls that need immersion, onboarding videos, etc.
   */
  hideChrome?: boolean;
  /**
   * Hide the top bar but KEEP the tab bar. hideChrome is all or nothing, and a
   * tab root cannot use it — losing the tabs on the tab you are standing on
   * leaves no way off it. But the header is IN FLOW, so its status-bar padding
   * is space a full-bleed backdrop can never reach. This is the middle: the
   * screen starts at the top of the window, the tabs stay.
   */
  hideHeader?: boolean;
  /**
   * "desk" — a page drawn for the desktop window's own shell (experience/
   * desk.ts), on its paper-and-ink ground. Absent → a phone screen, which a
   * desk window shows in its own dark room.
   *
   * "bots" — a page of the Bots app (experience/bots), drawn edge to edge
   * from the kit. The window treats a border with a width as a solid one on
   * it, as the phones do; a phone draws it as any other screen.
   */
  look?: "desk" | "bots";
  /** Pull to refresh with a bot in it, on this screen's scroll (section 3g; only for a build that declares PULL_BOT_CAPABILITY). */
  pullBot?: PullBotSpec;
  /** DESK_TALK_TO_CAPABILITY only (section 3i). */
  talkTo?: TalkTo;

  // --- vocabulary 2 (section 8; pure/SPEC.md 2.12). A screen that says nothing here is a vocab-1 screen and is
  //     served exactly as it is today, to every client.
  /**
   * The building blocks this screen cannot be drawn without. A client that declared them all gets the screen; one
   * that did not gets its frozen earlier version, or the short "Open X0 again" / "Update X0" screen — never a
   * lowered one (SPEC 2.0 principle 6). `sdui2/lint.ts` works this list out from the tree and refuses a screen
   * that uses a block it did not declare here.
   */
  needs?: BlockName[];
  /** `defs` block: the screen's own templates, drawn by `Use`. They live in the screen, not in a catalog. */
  defs?: Defs;
  /** `rules` block: when / every / after for the screen as a whole. A node's own `rules` live only while it does. */
  rules?: RuleSpec[];
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
  /** Entry/exit animation for this node. Vocabulary 2 (a screen whose `needs` holds "motion") sends NodeMotion
   *  instead: the animation spec's value model on any style key (section 8). */
  motion?: MotionSpec | NodeMotion;
  /** Render only when this condition is truthy (flag/state driven). `{ expr }` needs the `expr` block (section 8). */
  visibleIf?: Condition | ExprCondition;
  /** Rendered if the client can't draw `type` (forward-compat safety net). */
  fallback?: Node;

  // --- vocabulary 2 (section 8). Every one of these is OFF unless the screen's `needs` names its block and the
  //     client declared it; a client without the block is never sent the screen at all (no lowering, SPEC 2.0).
  /** `rules` block: when / every / after on this node, live only while it is on screen. */
  rules?: RuleSpec[];
  /** `gesture` block: fingers on this node, their values written under `ui.`. */
  gestures?: GestureSpec[];
  /** `gesture` block: a Screen's or a Scroll's own offset, under `ui.` (so a motion can drive off it). */
  scrollInto?: string;
  /** `defs` block, on a `Use`: which of the screen's definitions to draw. */
  def?: string;
  /** `defs` block, on a `Use`: the values its parameters take, read inside as `args.*`. */
  args?: Record<string, unknown>;
  /** `defs` block, on a `Use`: what goes into the template's named `Slot`s. */
  slots?: Record<string, Node | Node[]>;
  /** `defs` block, on a `Slot`: its name. */
  name?: string;
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
 * THIS LIST IS HISTORY, NOT THE CONTRACT. It was written when every name here had an implementation; commit
 * `e4d8861` removed most of them. The real contract is what a client declares in `capabilities.components`, and
 * what the clients actually hold:
 *
 *   TAILZU-FRONTEND/app/src/sdui/components/index.ts   the phone's node types
 *   TAILZU-FRONTEND/app/src/sdui/registry.ts           what the phone declares
 *   TAILZU-DESKTOP/src/app/sdui/core.js                the window's
 *
 * Nothing may be sent because it appears below. The kit's own set is `KIT_TYPES` in
 * `tulmi/src/experience/bots/lint.ts`, and `lintTree` refuses anything outside it. Kept here because older
 * builds still name these in their capabilities (pure/SPEC.md 2.0, "Ground truth").
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

// ---------------------------------------------------------------------------
// 3b. The Bots app's kit (tulmi/src/experience/bots, docs/bots-app.md)
// ---------------------------------------------------------------------------
//
// The Bots app is drawn from the core nodes above (Stack, Text, Image, Grid,
// Screen…) and FOUR EXTENSIONS of existing ones, which a build promises by
// declaring the capability below in `components`. The server boots the Bots
// app only for a build that declares it; every other build keeps today's app.
//
//   SVG.shapes          several circles and paths in one glyph, each with its
//                       own fill/stroke/dash, and the kit's three motions:
//                       "breathe" (a working bot, loops), "pop" (lands once,
//                       scale 0→1 with overshoot), "draw" (a ring draws to its
//                       length once). All three stop under Reduce Motion; the
//                       state still reads, because shape and colour carry it.
//                       The living tab icons, the status marks and every line
//                       icon are SVGs with shapes.
//   SafeArea.edges      pads the listed edges by the device's safe-area insets
//                       (`inset: "add"` adds them to the node's own padding,
//                       "max" takes the larger); `barStyle` sets the status
//                       bar's content colour while the node is up. A window
//                       has no insets and ignores both.
//   TextField.onSubmit  the return key (phone) or Enter (window) runs the
//                       node's `on.onSubmit` with the field's text.
//   Text bind.content   a Text bound to state shows the state's value (the
//                       window drew bound text only inside the onboarding).
//
// TextField's keyboard / autoFocus / maxLength come with KIT_EXTRAS_CAPABILITY
// (section 3i, TextFieldExtras), only in the trees that need them.
//
// And `navigate` resolves "$state.x" in its params on the window too.

/** Declared in capabilities.components by a build that draws the Bots app's kit. */
export const BOTS_KIT_CAPABILITY = "BotsKit";

/** One shape of an `SVG` node's `shapes` (Bots kit). A circle or a path. */
export interface SvgShape {
  /** cx, cy, r. */
  circle?: [number, number, number];
  /** A path, in the node's viewBox. */
  d?: string;
  /** Default "none". */
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** stroke-dasharray, e.g. "20.9 56.55" (a ring filled to 37%) or "1.7 1.7" (a dashed ring). */
  dash?: string;
  linecap?: "round" | "butt" | "square";
  linejoin?: "round" | "miter" | "bevel";
  opacity?: number;
  /** Degrees, about the circle's centre (or `origin`): a ring that starts at twelve o'clock is rotate -90. */
  rotate?: number;
  /** The point a path rotates and scales about. Defaults to the viewBox's centre. */
  origin?: [number, number];
  /** breathe: loops (1.8 s, opacity 1→.5, scale 1→.78). pop: once, scale 0→1. draw: once, the dash grows to its length. */
  motion?: "breathe" | "pop" | "draw";
  /** Before a pop or a draw starts (the Bots icon's dots land 60 ms apart). */
  delayMs?: number;
}

// ---------------------------------------------------------------------------
// 3c. The living bot tiles (docs/bots-app.md, "Living tiles")
// ---------------------------------------------------------------------------
//
// A build that declares BOTS_MOTION_CAPABILITY draws two more nodes. Both hold a tiny Blip in his bot's colour
// playing on a faint ink fabric, all of it physics (particles, constraints, forces at a fixed step): one core,
// the phone's src/botTiles/core.ts, which the window's botTiles.js is generated from.
//
//   BotTiles   Home's grid of bot tiles (BotTilesProps). A tap presses the tile in, every other bot turns its
//              head to it and the others' words fade to 35 %, and after about 450 ms the tile's action runs.
//              Reduce Motion: the bots rest in a pose, nothing moves, and a tap goes straight through.
//   BotCard    a card with the tiny bot on its fabric across the top and its children below it (BotCardProps).
//              The children are its steps, each shown by its own visibleIf; a change of step cross-fades and the
//              bot plays on. `overlay`: centred over the screen, which is blurred behind it, with a soft entrance
//              (Reduce Motion: no scale); `closeWhen` takes it away (the blur clears), `once` keeps it away on
//              this device. on.onComplete runs when `doneWhen` holds, after the bot's small happy moment.
//
// A build without it gets today's static tiles and a plain card.

/** Declared in capabilities.components by a build that draws BotTiles and BotCard. */
export const BOTS_MOTION_CAPABILITY = "BotsMotion";

export type BotTileKind = "code" | "keybot" | "plan" | "travel" | "notes" | "make" | "custom";

/** One tile of a BotTiles grid. */
export interface BotTileSpec {
  slug: string;
  name: string;
  /** The line under the name: "Working · fixing cart", "Needs you · 1 question", or the bot's own line. */
  sub: string;
  /** The bot's colour (#rrggbb). Make a bot: ink. */
  color: string;
  /** Which play: the built-ins' own, Make a bot's, or anyone's own bot's. */
  kind: BotTileKind;
  /** working: busier, its colour's dot · needs: stops and looks out, an ink dot · idle. */
  state: "working" | "needs" | "idle";
  action?: ActionRef;
  /** For a screen reader; defaults to name and sub. */
  label?: string;
  /** His look (BOT_MOMENTS_CAPABILITY): an avatar's id in the catalog, or a spec of its own; none: his kind's. */
  avatar?: BotAvatarRef;
  /** A moment he plays (BOT_MOMENTS_CAPABILITY; kit momentProps): once, then his own play again, or as a loop. */
  moment?: string;
  momentMode?: BotMomentMode;
  /** DOUBLE_TAP_CAPABILITY: a double tap on the tile (its single tap then waits about 260 ms). */
  doubleTap?: ActionRef;
}

/**
 * THE BOTS' LOOKS AND MOMENTS (tulmi/src/experience/bots/looks.ts; docs/bots-app.md "Looks and moments"). The catalog
 * (shared/bots/looks.json) holds avatars (a bot's look from parts: head, eyes, mouth, antennae, ears, dots, colours, what
 * he wears), moments (recipes: tracks over time the apps play through their physics: body goals, hands, looks, eyes and
 * mouth, props, particles, fabric, the other bots' answers, named sounds) and the parts both draw with. The bootstrap of
 * the Bots app says which version is current (flag "bots.looks": { v, url }, GET /v1/bots/looks); an app keeps the newest
 * and bundles a starter copy. A build that declares this plays them: `avatar`, `moment`, `momentMode` on a tile, BotBuddy
 * and BotCard, `momentEndWhen` on BotBuddy, `surprises` on BotTiles. Any other build ignores them; the kit sends it a
 * moment's plain act (`act`) instead.
 */
export const BOT_MOMENTS_CAPABILITY = "BotMoments";
/**
 * LOOKS FORMAT 2, SCENES (botTiles/scene.ts). A build that declares this also plays the catalog's `scenes`: drawn,
 * formula-driven animation with springs, ropes and soft rings, reacting to taps, his voice, his own motion and the
 * moment's events, and able to change the bot himself. The server then serves the format-2 projection
 * (GET /v1/bots/looks?v=N&f=2) and the bootstrap's flag carries { v, f, url, off }; a build without it is served
 * exactly what it is served today and plays each format-2 recipe's `fallback` act.
 */
export const BOT_MOMENTS2_CAPABILITY = "BotMoments2";
/** A look: an avatar's id in the catalog, or a spec of its own (over Blip; `extends` an id). */
export type BotAvatarRef = string | Record<string, unknown>;
/** once: then back to his own play · loop: until the node changes, or momentEndWhen (its `end` plays, then it is over). */
export type BotMomentMode = "once" | "loop";

export interface BotTilesProps {
  tiles: BotTileSpec[];
  columns: number;
  /** A tile's height, its padding, the gap between tiles. */
  height: number;
  padding: number;
  gap: number;
  /** The Geist faces by weight, as the app registered them. */
  faces: { regular: string; medium: string; semibold: string };
  /**
   * One more tile as a full-width row under the grid (Notes): its bot on a stage of its own at the left, its name and
   * line on the right. The last bot of the grid's world, so its tap is the tiles' moment. Only for a build that
   * declares BOT_TILES_STRIP; any other ignores it.
   */
  strip?: BotTileSpec;
  /** The strip's height. */
  stripHeight?: number;
  /**
   * Home's rare idle surprises (BOT_MOMENTS_CAPABILITY): every `every` seconds, with `chance`, one bot at his own idle
   * play plays one of `moments` once (the bots near him answer as the recipe asks). Never while a tile is tapped.
   */
  surprises?: { every: number; chance: number; moments: string[] };
}

/** A build that draws BotTilesProps.strip (the phone's BotTiles.tsx, the window's sdui.js). */
export const BOT_TILES_STRIP = "BotTilesStrip";

export interface BotCardProps {
  kind?: BotTileKind;
  /** The bot's colour: a neutral ink or grey on the permission cards. */
  color: string;
  /** The bot's stage across the top of the card. */
  stageHeight: number;
  overlay?: boolean;
  /** The card's width (overlay; inline it fills its row). */
  width?: number;
  /** Shown only once this holds (the app's own readings have arrived). */
  readyWhen?: Condition;
  /** When this holds: the bot's happy moment, then on.onComplete. */
  doneWhen?: Condition;
  doneDelayMs?: number;
  /** When this holds the card goes (and the blur clears). */
  closeWhen?: Condition;
  /** Once closed on this device, never drawn again (a key). */
  once?: string;
  label?: string;
  /** The bot's look, and a moment he plays once the card is open (BOT_MOMENTS_CAPABILITY). */
  avatar?: BotAvatarRef;
  moment?: string;
  momentMode?: BotMomentMode;
}

/**
 * BotBuddy: a bot's own tiny bot on its pages, on the same core as the tiles: its colour, its kind's play, on a small
 * stage of its own (a page's header, the top of a Code bot setup step) that never covers words or controls. Its mood
 * follows the bot (working: busier; needs: stops and faces the person); `act` is the page's moment; while `thinkWhen`
 * holds (an answer is on its way) it thinks; `lookTo` is where the page's ask field is, and it glances at it. Kept by
 * `life` for the life of the app: the same life on the next screen is the same bot, carrying on where he was (the
 * Code bot's setup steps are one bot). Reduce Motion: a still pose. Declared by the component name below (a build
 * that declares BotsMotion without it gets the page as before: its avatar, its Blip).
 */
export const BOT_BUDDY_COMPONENT = "BotBuddy";

/**
 * play: his own · wave: hello, then play · survey: looks over a list below him · read: dots and lines flow into him · settle: sits ·
 * think: an answer is on its way · carry: an answer is on its way, as a load (a build that declares BOT_BUDDY_CARRY) · listen: still,
 * eyes open, head to his thought (section 3i) · stand: still, looking about. Only a build that declares BOT_STAGE_COMPONENT is sent
 * listen and stand.
 */
export type BuddyAct = "play" | "wave" | "survey" | "read" | "settle" | "think" | "carry" | "listen" | "stand";

/**
 * Declared by a build whose BotBuddy CARRIES (act "carry", `doneWhen`): the stage is a full-width lane (no `width`) under a
 * message on its way. A few moments in, the bot comes in from the right with a bag, walks slowly across and out at the left,
 * and comes again with a heavier one, trip after trip (the bag bigger and fuller, the bot leaning and straining, slower,
 * a deeper bob; the heaviest from the sixth trip on). When `doneWhen` holds the answer is here: on stage he sets the bag
 * down and walks off, and the lane folds away once he has gone (at once when he was off stage). Reduce Motion: he stands
 * still holding the bag, with `label` written beside him. A build without it is sent "Asking…" instead.
 */
export const BOT_BUDDY_CARRY = "BotBuddyCarry";

export interface BotBuddyProps {
  kind: BotTileKind;
  color: string;
  /** Who he is across screens: the same life, the same bot. */
  life: string;
  /** The stage: its width (none: fills its row) and height. `size`: the bot's own height. */
  width?: number;
  height: number;
  size?: number;
  state: "working" | "needs" | "idle";
  act?: BuddyAct;
  thinkWhen?: Condition;
  /** Carrying: when this holds the answer is here (BOT_BUDDY_CARRY). */
  doneWhen?: Condition;
  lookTo?: "down" | "left" | "right" | "up";
  label?: string;
  /** His look (BOT_MOMENTS_CAPABILITY): an avatar's id, or a spec of its own; none: his kind's. */
  avatar?: BotAvatarRef;
  /** A moment from the catalog (BOT_MOMENTS_CAPABILITY): it holds him while it plays; thinking or carrying stops it. */
  moment?: string;
  momentMode?: BotMomentMode;
  /** When this holds, the moment's end plays (a loop's `end`: a wake-up, a sigh of relief), then it is over. */
  momentEndWhen?: Condition;
}

/**
 * Home's header, alive: three nodes a build declares by name (with BotsMotion); a build without them gets the same
 * header, still (the mark as an SVG, the line as Text).
 *
 *   WriteOn   the bold line writes itself in word by word, at dictation's uneven pace, with Keybot's clay caret
 *             blinking after the last word; the caret fades a few seconds on. Once per app open and `once` (it
 *             carries the part of the day), never on a return to Home. Reduce Motion: written.
 *   LiveMark  the Tailzu dot mark, alive: ring dots on springs, eyes on the finger or cursor that swing with a
 *             scroll, a ring dot lit in each working bot's colour (`lit`); a tap squishes it and runs on.onPress.
 *   HeadBar   a compact bar (its children) pinned over the top of the page, outside its scroll, shown once the page
 *             is scrolled past `at` (the big header has gone under it). The kit's page() puts it in place (`pinned`).
 */
export const HOME_HEAD_COMPONENTS = ["WriteOn", "LiveMark", "HeadBar"] as const;

export interface WriteOnProps {
  content: string;
  size: number;
  lineHeight: number;
  tracking?: number;
  color?: string;
  fontFamily: string;
  caretColor: string;
  once: string;
}

export interface LiveMarkProps {
  size: number;
  lit: string[];
  life?: string;
  label?: string;
}

export interface HeadBarProps {
  at: number;
}

// ---------------------------------------------------------------------------
// 3d. Media: send a file, speak, play a sound (docs/bots-app.md, "Media")
// ---------------------------------------------------------------------------
//
// Three abilities a build declares by name in capabilities.components (none is a node; each is actions):
//
//   FileUpload   uploadFile: pick a photo, a screenshot, a screen recording or any file, send it with progress
//                (POST multipart, one `file` part: /v1/files), and hand the answer back in state.
//   AudioPlay    playAudio / stopAudio: one sound at a time, from a server path (fetched with the session) or an
//                https address; it stops when the screen changes.
//   VoiceRecord  recordVoice (the phone): record in the app, send it to /v1/transcribe-clean, write the words.
//
// A build without one gets the screen without that control (or the old way to do it).

/** Declared by a build that runs uploadFile. */
export const FILE_UPLOAD_CAPABILITY = "FileUpload";
/** Declared by a build that runs playAudio and stopAudio. */
export const AUDIO_PLAY_CAPABILITY = "AudioPlay";
/** Declared by a build that runs recordVoice. */
export const VOICE_RECORD_CAPABILITY = "VoiceRecord";

/** What uploadFile asks the person to pick. photo: a picture · screenshot: a picture (the window: drag over an area or a
 *  window where it can, else a picture file) · video: a video (a screen recording) · file: any file · camera: take one. */
export type UploadPick = "photo" | "screenshot" | "video" | "file" | "camera";

// ---------------------------------------------------------------------------
// 3e. A live page, and the outbox (docs/bots-app.md, "Live views" and "Offline")
// ---------------------------------------------------------------------------
//
//   LiveView   a running web page or artifact (LiveViewProps), each in a sandbox of its own: the phone, a WebView with no
//              storage of the app's; the window, a webview in a session of its own (never the app's origin). From `url`
//              (http, https, data: or about: only) or `html` the server wrote, run as `origin` (https) or, without one, as an
//              opaque origin. It stays on its page: a link that leaves it does nothing, or with `allowPopups` is OFFERED to open
//              in the browser (the person says yes first). No popups, no downloads, no camera, mic or location. A loading
//              state until it has drawn, an error state with "Try again" if it cannot. The page talks UP with
//              `window.ReactNativeWebView.postMessage(json)` (phone) or `window.tailzuLive.post(obj)` (window): `{ t: "ready" }`
//              (drawn), `{ t: "failed", message }`, `{ t: "open", url }` (a link to offer, with allowPopups), anything else
//              is written to `messagePath` and on.onResult runs (on.onError when it cannot be shown). Every message is
//              untrusted data. DOWN: `send`, whenever it changes, is handed to the page's `window.tzLive(send)`.
//   Outbox     not a node: a build that keeps asks typed offline (the `outbox` action), sends them in order when the
//              connection is back with a client id each (POST /v1/shell/ask answers one id once), and puts in EVERY
//              screen's state `online` (true/false, the device's reading), `outbox` (OutboxItem[], oldest first) and
//              `outboxWaiting` (how many are still to go). It also follows the bootstrap's flags `offline.screenId` (shown in
//              place of a screen in `offline.roots` while offline, and taken away when the connection is back) and
//              `offline.bar` (the line it shows over any other screen while offline).

/** Declared in capabilities.components by a build that draws LiveView. */
export const LIVE_VIEW_COMPONENT = "LiveView";
/** Declared by a build that keeps an outbox (see above). */
export const OUTBOX_CAPABILITY = "Outbox";

export interface LiveViewProps {
  url?: string;
  html?: string;
  /** The https origin `html` runs as (it must be one the page's own frames accept as their parent). */
  origin?: string;
  /** Its height; the page scrolls inside it. */
  height?: number;
  allowPopups?: boolean;
  messagePath?: string;
  send?: Record<string, unknown>;
  /** A page that says `{ t: "ready" }` keeps the loading state until it does (up to 15 s, then the error state). */
  waitForReady?: boolean;
  loadingText?: string;
  errorText?: string;
  retryText?: string;
  /** The face its own words are set in (the kit's Geist). */
  fontFamily?: string;
  /** For a screen reader. */
  title?: string;
}

/** One ask in the outbox, as screens read it from `$state.outbox.N`. */
export interface OutboxItem {
  id: string;
  /** What was typed. */
  label: string;
  /** The line under it, "{time}" filled in with when it was typed ("Any bot · asked 9:38"). */
  sub: string;
  state: "waiting" | "sending" | "sent" | "failed";
  /** When it was typed (ms). */
  typedAt: number;
}

// ---------------------------------------------------------------------------
// 3f. An answer as it is written (docs/bots-app.md, "An answer as it is written")
// ---------------------------------------------------------------------------
//
// A build that declares ASK_STREAM_CAPABILITY runs callEndpoint's `stream`: before the call it makes a stream id (16 to 64
// letters, digits, - or _), writes `{ id, text: "", step: "" }` (AskStreamState) at the `stream` path, and sends the id as
// the body's `streamId`. While the call is out, the server says what it is doing and the answer's words as they are written
// over the live channel (WS /v1/live) to the one person who asked, as events on the topic `ask:<id>` whose `data` is one
// AskStreamPiece. The build appends `text`, sets `step`, starts the text over on `reset`, and stops listening when the call
// settles (or on `end`). Pieces arrive in order, numbered (`n` from 0); one missing (a dropped socket) stops the appending, so
// nothing is ever shown out of place: the call's own answer, whole, follows as before. POST /v1/ask/stop { id } stops the
// ask (the call then fails with 409 `stopped`). A build without it ignores `stream` and gets the whole answer at the end.

/** Declared by a build that runs callEndpoint's `stream`. */
export const ASK_STREAM_CAPABILITY = "AskStream";

/** What a `stream` path holds while (and after) the call is out. */
export interface AskStreamState {
  id: string;
  /** The answer's words so far. */
  text: string;
  /** What it is doing now, in a few words ("Looking at cart.ts…"), from the server's real steps. */
  step: string;
}

/** One live event's `data` on the topic `ask:<id>`. */
export interface AskStreamPiece {
  n: number;
  /** More words, to append (whole words and characters: never half of one). */
  text?: string;
  step?: string;
  /** The words so far are dropped (the bot went to use a tool after writing a little): start over. */
  reset?: true;
  end?: true;
}

// ---------------------------------------------------------------------------
// 3g. Pull-a-bot (docs/bots-app.md, "Pull-a-bot")
// ---------------------------------------------------------------------------
//
// Pull to refresh with a bot in it. A build that declares PULL_BOT_CAPABILITY draws a screen's Screen with a small bot in
// its pull: down at the top he stands on the list (feet first), up at the end he holds it up (head first); let go past
// the line and the list springs back and throws him off, and the screen is fetched again quietly (no spinner, its state
// kept). A pill says "Checking", then how many are new or "You're up to date". The server turns it on per screen with
// `ScreenResponse.pullBot` (kit page `pullBot`), only for a build that declares it; every other build gets the screen as
// before. Its feel (the line, the band, the spring, the throw, which bot) and its words are the app's knobs (pullBot.*).
//
// WHAT IS NEW is counted on the phone: `items` names the ids of the screen's list (ids the server already has: a feed
// row's, a decision's, a chat turn's), and after the refresh every id that was not there before is new. No `items`: it
// counts none ("You're up to date", which the screen then is).

/** Declared by a build that pulls a bot (see above). */
export const PULL_BOT_CAPABILITY = "PullBot";

/** The pull bot's colours; any left out are the prototype's ("x0"). */
export interface PullBotLook {
  shellTop?: string;
  shellBottom?: string;
  body?: string;
  limb?: string;
  visor?: string;
  glow?: string;
  shine?: string;
  /** His ears, antenna tip, feet and chest light. */
  accent?: string;
}

export interface PullBotSpec {
  /** Pull down at the top of the list. */
  top?: boolean;
  /** Pull up at the end of the list. */
  bottom?: boolean;
  /** The ids of the list's items, in any order: after a refresh, those not here before are new. */
  items?: string[];
  /** Where new items land ("top" by default): a pull at the other end says where they are ("2 new at the top"), a tap goes there. */
  newAt?: "top" | "bottom";
  /** Which bot: a look's id (the app's "x0", "ink", or one in the knob pullBot.looks), or colours over the default. None: knob pullBot.avatar. */
  avatar?: string | PullBotLook;
  /** The face the pill's words are set in (the page's own). */
  font?: string;
}

// ---------------------------------------------------------------------------
// 3h. The bots' sounds (docs/bots-app.md, "Sounds")
// ---------------------------------------------------------------------------
//
// Short sounds, made for the bots (tulmi/scripts/make-bot-sounds.py), served as files from /bots/sounds/ (immutable; each
// URL carries its file's hash) with a catalog at GET /v1/bots/sounds (shared/bots/sounds.json; a pushed one wins while its
// v is higher). The Bots app's bootstrap names the catalog in the flag "bots.sounds" ({ v, url }); a build that declares
// BOT_SOUNDS_CAPABILITY fetches it when v moves, keeps the files, and plays: a random "throw" when pull-a-bot throws its
// bot (never the same twice running, weighted, a `rare` one now and then), the "tick" at the line, "new" when a refresh
// found something, "uptodate" when it did not, and a "moment" sound by id when a bots' moment names it. Quiet, mixed with
// other audio, and never when the phone is on silent. The person turns them off on the device (action devicePref
// "sounds"; a screen whose state names `soundsOn` gets the phone's value); the knobs pullBot.sounds.* tune them.

/** Declared by a build that plays the bots' sounds and runs devicePref "sounds". */
export const BOT_SOUNDS_CAPABILITY = "BotSounds";

export type BotSoundKind = "throw" | "tick" | "new" | "uptodate" | "moment";

/** One sound as GET /v1/bots/sounds serves it. */
export interface BotSound {
  /** For a moment: the name its recipe's `sound` track says ("sneeze"). */
  id: string;
  kind: BotSoundKind;
  /** Where the file is: a path on the API's origin ("/bots/sounds/boing.m4a?h=…") or an https address. */
  url: string;
  /** The file's hash (sha-256, its first 12 hex): a changed file is a new one to the apps' caches. */
  hash: string;
  /** How often it comes up among its kind (0: never). */
  weight: number;
  /** A funny one, rarely (pullBot.sounds.rareChance). */
  rare?: boolean;
  ms: number;
  label?: string;
}

export interface BotSoundsCatalog {
  v: number;
  sounds: BotSound[];
}

// ---------------------------------------------------------------------------
// 3i. Spaces, the family redesign: a bot with a thought, a crowd, a vanish, @ and /, live words (docs/bots-app.md, "Spaces")
// ---------------------------------------------------------------------------
//
// Generic blocks the server builds Spaces, Home's Ask and the space feed from. A build declares each name it draws in
// capabilities.components; the server sends the new screens only to a build that has them all (kit canSpaces2 / canHomeThought),
// and every other build keeps today's screens.

/** A full tiny bot on a stage of his own that roams with catalog moments, walks out and back in, listens, thinks and cheers, and
 *  can hold a thought: a box over him, joined to his head by three bubbles, that follows him at rest and opens when tapped. */
export const BOT_STAGE_COMPONENT = "BotStage";
/** A box of many tiny bots playing with the real physics (one canvas), that can grow taller and cheer all at once. */
export const BOT_CROWD_COMPONENT = "BotCrowd";
/** Its children vaporise (blur, rise, fade, ink specks) when goneWhen turns true, and come back when it turns false. */
export const VANISH_COMPONENT = "Vanish";
/** A message field: "@" picks a person (a chip), "/" picks one of the person's bots, then one of its things (a chip). */
export const MENTION_FIELD_COMPONENT = "MentionField";
/** The words of the voice session open on this screen, as they are heard: the newest light grey, settling to ink. Nothing else. */
export const LIVE_WORDS_COMPONENT = "LiveWords";
/** NOT A COMPONENT: actions voiceLive and voiceStop (live words over /v1/transcribe-stream, a turn ends on a pause). */
export const VOICE_LIVE_CAPABILITY = "VoiceLive";
/** NOT A COMPONENT (the phone, a store build only): the actions voiceCall and voiceCallSet — Plan Ease's call held as one live voice
 *  conversation instead of turn by turn (docs/plan-ease.md "Calls"). A build that does not declare it gets today's call unchanged. */
export const VOICE_REALTIME_CAPABILITY = "VoiceRealtime";
/** NOT A COMPONENT: BotStage on.onDoubleTap (the window: a double-click) and BotTileSpec.doubleTap on Home's tiles. */
export const DOUBLE_TAP_CAPABILITY = "DoubleTap";
/** NOT A COMPONENT: TextField keyboard / autoFocus / maxLength; Screen, Scroll and (the window) Stack props.startAtEnd;
 *  callEndpoint.stay; a dotted border with a radius drawn dotted on every platform; a failed call's { code, message } kept at
 *  state `lastError` (the window too, as the phone already does), so a toast can say the server's reason. */
export const KIT_EXTRAS_CAPABILITY = "KitExtras";
/** NOT A COMPONENT, the window only: ScreenResponse.talkTo (the one key, with X0 in front, talks to the bot on screen). */
export const DESK_TALK_TO_CAPABILITY = "DeskTalkTo";

/** NOT A COMPONENT (the phone, a store build only): the action location.area — one foreground fix, named by the phone's own
 *  geocoder. Declared by a JS check that the build's native module has `locationArea` (docs: perms). */
export const LOCATION_CAPABILITY = "Location1";
/** NOT A COMPONENT (the phone, a store build only): the action contact.pick — the system's own contact picker, no permission. */
export const CONTACT_PICK_CAPABILITY = "ContactPick1";
/** NOT A COMPONENT (the phone, a store build only): the action health.sync — daily steps and workouts from Apple Health or
 *  Health Connect, read on the phone and posted straight to the server. */
export const HEALTH_CAPABILITY = "Health1";

/** NOT A COMPONENT (the phone, build 8.9.1+). Each is declared by the phone's own check that the native function, the usage key
 *  or Android permission, and the OS are all there (docs: perms2), so an older binary declares none. */
export const CALENDAR_ADD_CAPABILITY = "CalendarAdd1";       // calendar.editor
export const CALENDAR_READ_CAPABILITY = "CalendarRead1";     // calendar.sync (iPhone 17+; Android behind TULMI_ANDROID_CALENDAR)
export const REMINDERS_CAPABILITY = "Reminders1";            // reminders.sync (iPhone 17+)
export const FOCUS_CAPABILITY = "Focus1";                    // focus.sync; the Focus Filter (iPhone) / Do Not Disturb (Android)
export const MOTION_CAPABILITY = "Motion1";                  // health.sync source "motion"; motion.watch; requestPermission "motion"
export const HEALTH_SLEEP_CAPABILITY = "HealthSleep1";       // health.sync sleep: true
export const ARRIVAL_CAPABILITY = "Arrival1";                // arrival.sync (iPhone; Android behind TULMI_ANDROID_ARRIVAL)
export const APP_ATTEST_CAPABILITY = "AppAttest1";           // TrustAsk "appAttest" | "appAssert"
export const DEVICE_CHECK_CAPABILITY = "DeviceCheck1";       // TrustAsk "deviceCheck"
export const PLAY_INTEGRITY_CAPABILITY = "PlayIntegrity1";   // TrustAsk "playIntegrity"

/** One arrival reminder (arrival.sync). Bounds are checked on the phone too. */
export interface ArrivalItem {
  /** ^[a-z0-9_-]{1,64}$; the phone prefixes "x0.arrive.". */
  id: string;
  lat: number; lon: number;
  /** 100-500. */
  radiusM: number;
  /** <= 60 characters, e.g. "You're at Koramangala Market". */
  title: string;
  /** <= 140 characters, the item's own words. */
  body: string;
  /** The screen a tap opens, <= 120 characters. */
  screen?: string;
}

/** How a bot wanders: walk to a random spot in `span` (fractions of the stage's width), pause, play a random moment, again. */
export interface BotRoam {
  moments: string[];
  /** Seconds between moments, a random value in the range. */
  every: [number, number];
  /** Seconds he stands before and after a walk. */
  pause: [number, number];
  span?: [number, number];
}

export interface BotThoughtSpec {
  /** home: a dotted box (2 px dotted ink, radius 18, white); space: a white field (1 px #d4d4d4, radius 18, soft shadow). */
  style: "home" | "space";
  /** The words in the small box riding over him at rest (a tap on it opens it). None: no box at rest. */
  restText?: string;
  /** A state path holding true while it is open. The app writes true when the resting box is tapped and false when the veil is
   *  tapped, Escape is pressed or (phone) back is pressed; the server's actions may write it too. */
  openPath: string;
  /** Near the whole screen (an answer coming in). Wins over open. */
  fullWhen?: Condition;
  /** square: a square over him (home); wide: the stage's width less the gutters, as tall as its content (space). */
  shape: "square" | "wide";
  /** Blur the screen behind it while open or full. */
  veil: boolean;
  /** follow: over him; low: while open he walks down near the bottom of the screen and the box fills the space above him. */
  place: "follow" | "low";
}

export interface BotStageProps {
  /** Who he is across screens and repaints: the same life, the same bot, carrying on. */
  life: string;
  kind: BotTileKind;
  color: string;
  avatar?: BotAvatarRef;
  /** His height and the stage's, in px. The stage holds everything touchable at rest: him and, with restText, the trail's room and
   *  the rest box. A client never draws it shorter than size + 18, plus (with restText) the trail's rest room (TRAIL: lift + the
   *  three sizes + 3 x 7 + gap, about 82 at scale 1) + 48, whatever `height` says. */
  size: number;
  height: number;
  /** What a tap opens: "bot" (default) only his body, the rest of the stage passing touches to the page; "stage" the whole stage
   *  (a top area that is all his). A double tap is always on his body. */
  hit?: "bot" | "stage";
  /** false: he never plays with props (the person's own bot). */
  toys?: boolean;
  roam?: BotRoam;
  /** While it holds he walks out at `outSide` (none: the edge nearer him then, as the prototype does); when it stops he walks back
   *  in from the edge he left by. */
  outWhen?: Condition;
  outSide?: "left" | "right";
  /** Each time it turns true he gives a happy hop. */
  cheerWhen?: Condition;
  thinkWhen?: Condition;
  /** He stands still and listens (eyes open, head to his thought), his bubbles pulsing with the voice. */
  listenWhen?: Condition;
  thought?: BotThoughtSpec;
  /** What a screen reader says for him. */
  label: string;
}
// on.onPress: a tap on him (or the stage, hit "stage"). on.onDoubleTap (DOUBLE_TAP_CAPABILITY): a double tap / double-click on him
// (a single tap then waits about 260 ms). on.onDismiss: the open thought was closed by the person (veil, Escape, back), after
// openPath is false. These run ONLY from his hit area, never from a press inside the box: lint lets the box hold buttons because of
// that, so a client must not bind them on the stage's outer element.
// children: the thought's content while it is open, full, or he listens (with listenWhen). At rest the box shows restText.

export interface BotCrowdProps {
  life: string;
  /** 5 to 9 tiny bots, each on his own patch, lots of empty space. */
  bots: Array<{ kind: BotTileKind; color: string; avatar?: BotAvatarRef }>;
  /** Each bot's height in px. */
  size: number;
  /** Its height at rest; none: as tall as it is wide. */
  height?: number;
  grownWhen?: Condition;
  grownHeight?: number;
  /** While it holds every bot cheers, again and again (a few seconds at most). */
  cheerWhen?: Condition;
  surprises?: { moments: string[]; every: number; chance: number };
  label: string;
}
// children: drawn over the bots at the top of the box (the bots keep the floor).

export interface VanishProps {
  goneWhen: Condition;
  /** Kept per key: drawn gone at once on a repaint, never replayed. */
  key: string;
}

/** What a MentionField writes to its draftPath on every change (empty strings: none). */
export interface MentionDraft {
  text: string;
  toId: string; toName: string;
  bot: string; botName: string; thingId: string; thingTitle: string;
}
export interface MentionFieldProps {
  life: string;
  placeholder: string;
  draftPath: string;
  /** `bot`: the person's own tiny bot (PERSON_BOT_COMPONENT, section 3j), drawn in their row. */
  people: Array<{ id: string; name: string; bot?: Pick<PersonBotProps, "seed" | "avatar" | "color"> }>;
  bots: Array<{ slug: string; name: string; color: string; kind: BotTileKind }>;
  /**
   * GET path (":bot" replaced; it may carry a query, e.g. "?space=s1&tz=330") answering { items: Array<{ id: string; title: string;
   * line: string }> }. An item's id goes back in the draft as it came: the server shapes it (a space's admin is offered members'
   * things too, by ids it reads back, each line saying whose: "Mom's · Sat 14 Nov · 7:40 pm").
   */
  thingsPath: string;
  /** Rows after the bots in the "/" list, each running its action. */
  tools?: Array<{ id: string; label: string; action: ActionRef }>;
  words: { people: string; bots: string; empty: string };
  maxLength?: number;
  autoFocus?: boolean;
}
// on.onSubmit: Enter / the send button, with the draft in draftPath. Before it runs: text starting with "@word" and no person chip
// is turned into that person's chip when exactly one person's first name is that word (case-insensitive, the "@word" taken out of
// the text); when more than one matches, the People list opens filtered to it and nothing is sent. The server clears draftPath
// after sending; the field empties itself (chips too) when draftPath is cleared.

export interface LiveWordsProps {
  size: number;
  lineHeight: number;
  fontFamily: string;
  color?: string;          // settled words, ink
  freshColor?: string;     // the newest words, #b5b5b5
  settleMs?: number;       // 600
}

/** The window's one key (DESK_TALK_TO_CAPABILITY): with X0 in front, holding it or tapping it twice talks to this screen's bot. */
export interface TalkTo {
  /** Run when a key session starts: the window adopts the session the key opened (it never opens a second one). The key's own
   *  mode wins over voice.mode: a hold or a single tap is one turn, two taps a chat. */
  voice: Extract<ActionSpec, { kind: "voiceLive" }>;
}

/**
 * TextField's extras (KIT_EXTRAS_CAPABILITY), sent only in the new trees:
 *   keyboard   "text" | "email" | "code". email: the email keyboard, no autocapitalise or autocorrect, textContentType
 *              emailAddress (the window: type="email", autocapitalize="off"). code: ASCII capitals, no autocorrect, oneTimeCode.
 *   autoFocus  focus it when it first appears on the screen, by its id: also when a when() shows it later (the email field after
 *              Create), never again on a repaint.
 *   maxLength  the most characters it takes.
 */
export interface TextFieldExtras {
  keyboard?: "text" | "email" | "code";
  autoFocus?: boolean;
  maxLength?: number;
}

// ---------------------------------------------------------------------------
// 3j. People as their own tiny bots, and the messages' face (docs/spaces.md "How people look")
// ---------------------------------------------------------------------------
//
// No initials anywhere in Spaces: a person is their own tiny bot, and a space's messages are set in Bricolage Grotesque. Each is a
// name a build declares in capabilities.components. Without PersonBot the server sends a plain circle in the person's colour (no
// letter); without FontBricolage it sets the same nodes in Geist.

/**
 * A person, as their own full tiny bot standing in a size x size box (feet on its floor): drawn by the bots' engine with an avatar
 * from the catalog and the person's colour, no cloth, no toys. He idles: blinks, a small sway, now and then a small gesture (a rare
 * one), staggered by `seed` so a list never moves in step. Every PersonBot on a screen runs on one animation loop, and one off
 * screen is paused. Reduce Motion: a still pose.
 */
export const PERSON_BOT_COMPONENT = "PersonBot";
/**
 * NOT A COMPONENT: the build has the three Bricolage Grotesque faces registered, each weight a family of its own as Geist's are
 * ("Tailzu Bricolage" 400, "Tailzu Bricolage Medium" 500, "Tailzu Bricolage SemiBold" 600). The phone loads them as it loads Geist
 * (the bootstrap's `fonts`); the window bundles them.
 */
export const FONT_BRICOLAGE_CAPABILITY = "FontBricolage";
/**
 * NOT A COMPONENT (the phone): a notification button that opens the app (Pay, Send, No, Open map) hands its id to the push's screen as
 * the `button` param; a plain tap on the notification has none. The hand-off screens open WhatsApp, UPI or Maps only for the button.
 */
export const PUSH_BUTTON_CAPABILITY = "PushButton";
/** NOT A COMPONENT (the phone): the call screen's pieces — speak.loud, speak.onDone and "$state" in speak.text; voiceLive.duplex;
 *  Text format "elapsed". Also a push-token cap: this JS takes Plan Ease's calls (docs/plan-ease.md "Calls"). */
export const BOT_CALL_CAPABILITY = "BotCall";
// Text props, format "elapsed" (BOT_CALL_CAPABILITY; the phone's components/Text.tsx, elapsedCore.ts): content is a start time (epoch
// ms, or ISO); shows "m:ss" (or "h:mm:ss" past an hour) since then, ticking every second; never negative.

export interface PersonBotProps {
  /** Who he is (the person's id): what staggers his idling, so two of them never blink together. */
  seed: string;
  /** An avatar's id in the looks catalog ("pip", "nova"; the viewer's own bot: "blip"). */
  avatar: string;
  /** His colour (#rrggbb). The viewer's own bot: ink #0a0a0a. */
  color: string;
  /** The box, square, in px. Default 32. */
  size?: number;
  /** false: a still pose (a long list may ask for it). Default true. */
  live?: boolean;
  /** What a screen reader says (the person's name); none: he is decoration beside the name. */
  label?: string;
}
// MentionFieldProps.people items may carry `bot: { seed, avatar, color }`: a build that declares PersonBot draws that bot in the
// person's row of the "@" list (size 28), in place of anything else.

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
  /** `replace: true` swaps the top of the stack instead of pushing onto it, so
   *  there is nothing behind to go back to — what a step in a linear flow
   *  wants: onboarding must not be walkable backwards. */
  | { kind: "navigate"; screenId: string; params?: Record<string, unknown>; replace?: boolean }
  | { kind: "navigateBack" }
  | { kind: "switchTab"; tabId: string }
  /** `handoff: true` holds the link to the assistant's hand-off list (the phone's isHandoffUrl), not every link openUrl takes. A build without it ignores it. */
  | { kind: "openUrl"; url: string; external?: boolean; handoff?: boolean }
  /** `healthConnect` (Android, a build with Health Connect): its own permissions page, where a person who refused twice
   *  turns the bot's reading back on. Anywhere else it falls back to the app's own settings. */
  | { kind: "openSettings"; target?: "app" | "keyboard" | "healthConnect" }
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
      /** The state path an answer is written to as it comes (section 3f, ASK_STREAM_CAPABILITY). */
      stream?: string;
      /** KIT_EXTRAS: the window does not fetch the screen again after this write. */
      stay?: boolean;
    }
  | { kind: "refresh" }
  // --- local state ---
  | { kind: "setState"; path: string; value: unknown }
  | { kind: "toggleState"; path: string }
  /** Add or remove one value in the array at `path` — the primitive a
   *  multi-select needs. `min` refuses the removal that would take the array
   *  below that length, so a required choice cannot be emptied. */
  | { kind: "toggleInArray"; path: string; value: unknown; min?: number }
  | { kind: "appendState"; path: string; value: unknown; max?: number }
  | { kind: "incrementState"; path: string; by?: number }
  | { kind: "clearState"; path: string }
  // --- feedback & sensory ---
  | { kind: "haptic"; style: HapticStyle }
  | { kind: "toast"; message: string; tone?: "info" | "success" | "error" }
  | { kind: "snackbar"; message: string; actionLabel?: string; onAction?: ActionRef }
  | { kind: "playMedia"; url: string }
  | { kind: "stopMedia" }
  | { kind: "speak"; text: string; voice?: string;
      /** BOT_CALL_CAPABILITY: play on the speaker even with the silent switch on (the audio session set to playback first). */
      loud?: boolean;
      /** BOT_CALL_CAPABILITY: when it has been said, stopped or failed (once). */
      onDone?: ActionRef }
  | { kind: "confetti" }
  // --- system / sharing / clipboard ---
  | { kind: "share"; text?: string; url?: string; title?: string }
  | { kind: "shareFile"; path: string; mimeType?: string }
  | { kind: "copyToClipboard"; text: string; toastMessage?: string }
  // --- the desktop window only (desktop src/app/sdui/) ---
  /** Put text on the clipboard and say so. */
  | { kind: "copyText"; text: string; message?: string }
  /** Change one of this computer's own settings (the pill, pausing, start at
   *  login, tap to talk). "$toggle" flips the current value. */
  | { kind: "desktop.config"; key: string; value: unknown }
  /** Start (or stop) dictation, as the hotkey does. */
  | { kind: "dictate" }
  /** Start (or stop) taking notes, as the notes hotkey does (desktop). */
  | { kind: "notes.toggle" }
  /** Open the Mac's Screen & System Audio Recording settings, so notes can
   *  hear the computer's sound (desktop, macOS). */
  | { kind: "notes.allowSystemAudio" }
  /** Connect an app (desktop): POST /v1/connectors/:id/connect, then open the
   *  sign-in page the answer names in the browser. For an app that takes a
   *  pasted link, `urlPath` is the state path that holds it. Only that route;
   *  the window builds the path and checks the page it opens. */
  | { kind: "connector.connect"; id: string; urlPath?: string; onSuccess?: ActionRef; onError?: ActionRef }
  /** Download, check and install a newer build in place of this one, then
   *  restart on it (desktop/updater.js). `words` are the card's line for each
   *  step; "{pct}" in `downloading` is filled in by the window. */
  | { kind: "installUpdate"; version: string; url: string; sha512: string;
      words?: { downloading?: string; installing?: string; failed?: string; manual?: string } }
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
  // --- media: send a file, speak, play (section 3d; each needs its capability) ---
  /** Pick a file of `pick`'s kind and send it (default path /v1/files, multipart, one `file` part). While it goes,
   *  `progressTo` holds { name, kind, pct (0-100), percent ("42%"), size ("412 KB") }; it is cleared at the end. The
   *  answer (/v1/files: { file, attachment, cached }) goes to `assignTo`, then onSuccess. A failure runs onError with
   *  $event the words to show; nothing picked runs onCancel. `maxBytes` refuses a bigger file before sending it. */
  | { kind: "uploadFile"; pick: UploadPick; assignTo: string; path?: string; progressTo?: string; maxBytes?: number;
      onSuccess?: ActionRef; onError?: ActionRef; onCancel?: ActionRef }
  /** Play one sound: `url` is a server path ("/v1/…", fetched with the session; "$state.x" filled in) or an https
   *  address. One at a time: another stops what played. While it plays `statePath` holds { id, pct (0-100), at
   *  ("0:02"), of ("0:05"), time ("0:02 / 0:05") }; it is cleared when it ends, is stopped, or the screen changes.
   *  onEnd when it played to the end; onError (with $event) when it could not play. */
  | { kind: "playAudio"; url: string; id?: string; statePath?: string; onEnd?: ActionRef; onError?: ActionRef }
  | { kind: "stopAudio" }
  /** The phone: start recording (asking for the microphone first), or, while it records, stop and send it to
   *  /v1/transcribe-clean; the words go to `assignTo` (after what is there, with `append`). `statePath` holds
   *  "listening" · "busy" · "idle"; `levelTo` the voice's level (0-1, in tenths) while it listens. onDone with $event
   *  the words; onError with $event the words to show; onBlocked when the microphone was refused for good (Settings).
   *  `maxSeconds` stops it by itself (default 120). Leaving the screen throws the recording away. */
  | { kind: "recordVoice"; assignTo: string; statePath?: string; levelTo?: string; append?: boolean; language?: string;
      maxSeconds?: number; onDone?: ActionRef; onError?: ActionRef; onBlocked?: ActionRef }
  // --- the outbox (section 3e; needs OUTBOX_CAPABILITY) ---
  /** add: keep an ask to send when online (now, if online): `path` (a /v1/ route) and `body` ("$state.x" filled in now),
   *  `label` and `sub` for the screen ("{time}" in `sub` becomes when it was typed); it goes as POST with the item's id as
   *  `clientId` and `typedAt`. remove: take item `id` out (not one already sent). retry: send a failed one (`id`) again.
   *  clear: drop the ones that were sent. */
  | { kind: "outbox"; op: "add" | "remove" | "retry" | "clear"; path?: string; body?: Record<string, unknown>; label?: string; sub?: string; id?: string }
  /** A setting kept on this device, not on the account (section 3h: "sounds", on or off; `value` may be "$state.x").
   *  Only for a build that declares BOT_SOUNDS_CAPABILITY. */
  | { kind: "devicePref"; key: "sounds"; value: unknown }
  // --- live words (section 3i; needs VOICE_LIVE_CAPABILITY) ---
  /** VOICE_LIVE_CAPABILITY. Listen with live words; a turn ends after `silenceMs` without new words. statePath is "listening" while
   *  hearing, "sending" while onHeard runs, "" when over. Each turn's words go to `into`, then onHeard runs (awaited). chat: listen
   *  again after it unless stopWhen holds; it ends on voiceStop, Escape (window), leaving the screen (another screen id or params;
   *  a refresh or quiet reload of the same screen keeps it), the app going to the background (phone), X0 no longer in front
   *  (window), quiet (no words for 12 s), or 20 minutes. once: one turn. onBlocked: no microphone permission. The voice level never
   *  goes into state: the stage reads it. `into` gets the whole turn's words (every segment the stream finalised, then the last
   *  partial), not only the last segment. */
  | { kind: "voiceLive"; mode: "once" | "chat"; statePath: string; into: string; silenceMs?: number; language?: string;
      onHeard: ActionRef; stopWhen?: Condition; onEnd?: ActionRef; onError?: ActionRef; onBlocked?: ActionRef;
      /** BOT_CALL_CAPABILITY: one audio session that plays and records, held between turns (a screen that answers out loud). */
      duplex?: boolean }
  /** Stop the voice session on this screen; the words of the turn not yet sent are dropped. */
  | { kind: "voiceStop" }
  // --- a live voice call (needs VOICE_REALTIME_CAPABILITY) ---
  /** VOICE_REALTIME_CAPABILITY. A live voice call: POST `path` {sdp, resume} -> {sdp, maxSec}; then POST `${path}/ready`; leaving the app
   *  or an audio interruption is POST `${path}/stop`. Writes the phase into `phasePath` (connecting | speaking | listening | thinking |
   *  idle | ended), the bot's words as they are spoken into `saidPath`, the person's last words into `heardPath`, and {spoke} into
   *  `statePath`. After a tool turn it re-reads `viewPath` and sets each `actedState[action]` key to true for every action in the view's
   *  `acted`. Ends on voiceCallSet end, leaving the screen (another screen id or params; a refresh of the same screen keeps it), the app
   *  going to the background or an audio interruption (then onIdle), the reply's maxSec + 10 s, or the server hanging up (re-reads
   *  viewPath: ended -> onEnded, answered -> onFallback). onBlocked: no microphone permission. Any throw while loading the native module
   *  or opening the mic -> onFallback. The level never goes into state: the stage reads it. */
  | { kind: "voiceCall"; path: string; viewPath: string; resume?: boolean;
      statePath: string; phasePath: string; saidPath: string; heardPath: string; actedState?: Record<string, string>;
      onEnded?: ActionRef; onIdle?: ActionRef; onFallback?: ActionRef; onBlocked?: ActionRef }
  /** VOICE_REALTIME_CAPABILITY. warm: get the mic and the offer ready while the call is answered (only if mic permission is already granted). */
  | { kind: "voiceCallSet"; op: "warm" | "end" }
  // --- one of our own calls, block `call` (src/rooms, docs/rooms.md) ---
  /**
   * Block `call`. Take a seat in a call and hold it for this screen. The app opens its microphone (and its camera when `video`), makes
   * an offer, and POSTs `{ sdp, audioMid, videoMid? }` to `join` — the host's `/v1/rooms/:id/join`, or a guest's
   * `/v1/rooms/guest/:code/join` with `knock` added. It gets back a seat, sets the answer, and from then on runs the call by itself
   * against `/v1/rooms/seat/{live,pull,answer,leave}`: the heartbeat every couple of seconds, pulling in whoever is new, answering the
   * SFU, and dropping whoever left. The seat never reaches the screen's state.
   *
   * It writes into `statePath`: `{ phase: connecting | live | reconnecting | ended | failed, mic, cam, speaker, front (booleans),
   * people: [{ identity, name, role, speaking, mic, cam }], waiting: [{ id, name }] (the host's own), me: { identity, name } }`. The
   * screen's words, tiles and buttons are expressions over that, and `Caller` nodes draw the pictures.
   *
   * It ends on `live.leave`, on leaving the screen, or when the call ends or the seat is sent away (then `onEnd`). The app going to the
   * background keeps the sound and stops the camera until it is back. `onBlocked`: no microphone permission. Failing to join or losing
   * the call for good: phase `failed`, then `onError`.
   */
  | { kind: "call.join"; join: string; statePath: string; knock?: string; video?: boolean;
      onEnd?: ActionRef; onBlocked?: ActionRef; onError?: ActionRef }
  /** Block `call`. The call this screen holds: mic, cam or speaker on or off (`value`; without it, the other way), or flip the camera. */
  | { kind: "call.set"; op: "mic" | "cam" | "speaker" | "flip"; value?: boolean }
  /** Block `call`. Hang up, then the join's `onEnd`. */
  | { kind: "call.leave" }
  // --- the phone's own things: where you are, one contact, your workouts ---
  /** Phone, LOCATION_CAPABILITY (docs: perms). One foreground fix, named by the phone's OS geocoder (which sends the point to
   *  Apple or Google, as part of the phone's own system); only the area's words reach `assignTo`. Asks the system first only
   *  when `ask` (the card's Continue). The point never reaches JavaScript, and never reaches this server. */
  | { kind: "location.area"; assignTo: string; ask?: boolean;
      onFound?: ActionRef; onNone?: ActionRef; onDenied?: ActionRef; onBlocked?: ActionRef; onError?: ActionRef }
  /** Phone, CONTACT_PICK_CAPABILITY. The system's own contact picker; no permission, so no card in front of it. Only the ONE
   *  email the person tapped reaches `assignTo`; the address book is never read. */
  | { kind: "contact.pick"; assignTo: string; onPicked?: ActionRef; onCancel?: ActionRef; onError?: ActionRef }
  /** Phone, HEALTH_CAPABILITY. Reads daily step totals and workouts for `days` (31 at most), sums them on the phone, and POSTs
   *  them to `path`, which must match /^\/v1\/bots\/[a-z0-9]+(?:-[a-z0-9]+)*\/health\/days$/ (else refused before any read, so a
   *  screen bug can never send health data to a route that reaches an AI service). Asks only when `ask`; `enable` rides on the
   *  first POST. No health value ever reaches state. */
  | { kind: "health.sync"; path: string; days?: number; ask?: boolean; enable?: boolean;
      /** MOTION_CAPABILITY only: read the steps and the walks, runs and rides from Motion & Fitness instead of Apple Health. */
      source?: "health" | "motion";
      /** HEALTH_SLEEP_CAPABILITY only: ask for the sleep type in a request OF ITS OWN, so a refusal leaves steps working. */
      sleep?: boolean;
      onSynced?: ActionRef; onEmpty?: ActionRef; onDenied?: ActionRef; onBlocked?: ActionRef;
      onUnavailable?: ActionRef; onError?: ActionRef }
  // --- the phone's own things, build 8.9.1 (docs: perms2) ---
  /** Phone, CALENDAR_ADD_CAPABILITY. The phone's own event editor, filled in. No permission (iPhone 17+: out of process; Android:
   *  the calendar app's screen). Nothing is read. Android cannot tell saved from cancelled, so it reports onOpened. */
  | { kind: "calendar.editor"; title: string; startsAtIso: string; endsAtIso?: string; allDay?: boolean; notes?: string;
      onSaved?: ActionRef; onCancel?: ActionRef; onOpened?: ActionRef; onUnavailable?: ActionRef; onError?: ActionRef }
  /** Phone, CALENDAR_READ_CAPABILITY. BUSY TIMES ONLY ({s, e, allDay}; free, declined and cancelled events skipped) for `days`
   *  (14 at most), POSTed to `path`, which must equal "/v1/botsapp/plan/busy" (else refused before any read). No title, place,
   *  note, attendee or calendar name crosses into JavaScript. Asks only when `ask`; `enable` rides on the first POST. */
  | { kind: "calendar.sync"; path: string; days?: number; ask?: boolean; enable?: boolean;
      onSynced?: ActionRef; onDenied?: ActionRef; onBlocked?: ActionRef; onUnavailable?: ActionRef; onError?: ActionRef }
  /** Phone, REMINDERS_CAPABILITY. Two-way sync of ONE list, "X0 Bot" (made on first sync), through `path`, which must equal
   *  "/v1/botsapp/plan/reminders/sync": read that list, POST, apply the reply's {add, update, remove} to that list only, POST
   *  {applied}. No other list's items are fetched. Nothing reaches state. */
  | { kind: "reminders.sync"; path: string; ask?: boolean; enable?: boolean;
      onSynced?: ActionRef; onDenied?: ActionRef; onBlocked?: ActionRef; onUnavailable?: ActionRef; onError?: ActionRef }
  /** Phone, FOCUS_CAPABILITY. Whether a Focus (iPhone: what X0 Bot's Focus Filter last saw) or Do Not Disturb (Android, no
   *  permission) is on, POSTed as {on, hold?, source} to `path`, which must equal "/v1/botsapp/plan/focus". Never which one. */
  | { kind: "focus.sync"; path: string; onSynced?: ActionRef; onError?: ActionRef }
  /** Phone, MOTION_CAPABILITY. "Wait while I'm driving", on or off — the person's own switch, and nothing is read or sent.
   *  ANDROID needs this both ways: it can only answer the driving check while it is registered for car transitions, and
   *  `on: false` deletes that registration and the one line it kept (perms2 5.2). On the iPhone the system answers the
   *  question from its own motion history, so the native side answers true and does nothing. Both switch paths send it. */
  | { kind: "motion.watch"; on: boolean; onDone?: ActionRef; onUnsupported?: ActionRef }
  /** Phone, ARRIVAL_CAPABILITY. Replaces the arrival reminders the phone's OWN system watches with `items` (10 at most). The
   *  places come from this server; the phone's position never reaches JavaScript or this server, and nobody is told of an
   *  arrival. Asks for location (While Using) only when `ask`. onApproximate: Precise Location is off. */
  | { kind: "arrival.sync"; items: ArrivalItem[]; ask?: boolean;
      onArmed?: ActionRef; onApproximate?: ActionRef;
      /** ANDROID ONLY: precise location is held, "Allow all the time" is not. NOT a denial — the server's own card explains
       *  the background use (Play's prominent disclosure) and then offers Settings, which is the only way on from Android 11. */
      onBackground?: ActionRef;
      onDenied?: ActionRef; onBlocked?: ActionRef;
      onUnavailable?: ActionRef; onError?: ActionRef }
  // --- permissions ---
  | {
      kind: "requestPermission";
      permission:
        | "microphone" | "camera" | "notifications" | "photoLibrary"
        | "contacts" | "calendar" | "location" | "tracking"
        /** MOTION_CAPABILITY only: Motion & Fitness (iPhone) / Physical activity (Android), for the driving check before a
         *  Plan Ease call. */
        | "motion"
        /** ARRIVAL_CAPABILITY on Android only: "Allow all the time", as a REQUEST and not a bare openSettings. The iPhone
         *  has no such kind and answers unsupported. */
        | "backgroundLocation";
      onGranted?: ActionRef;
      onDenied?: ActionRef;
      /**
       * THE SYSTEM WILL NOT ASK AGAIN.
       *
       * iOS shows a permission dialog once per install. After the answer is on
       * record — Don't Allow, or the switch turned off in Settings later —
       * requesting returns denied instantly and draws nothing, so a button
       * wired only to onDenied appears to do nothing at all.
       *
       * This branch is that state, and the only useful thing to offer in it is
       * Settings. Falls back to onDenied when unset, so a screen that does not
       * distinguish the two keeps the behaviour it has.
       */
      onBlocked?: ActionRef;
    }
  // Read a permission WITHOUT asking for it. Same shape as requestPermission,
  // but it never shows a system dialog — so a screen can react to a permission
  // it already has (skip itself, hide its CTA) without the act of checking
  // being the very prompt the screen exists to introduce. An undetermined
  // permission reads as denied: we do not have it.
  | {
      kind: "checkPermission";
      permission:
        | "microphone" | "camera" | "notifications" | "photoLibrary"
        | "contacts" | "calendar" | "location" | "tracking" | "motion" | "backgroundLocation";
      onGranted?: ActionRef;
      onDenied?: ActionRef;
      /** Optional: also write the boolean answer to this state path. */
      assignTo?: string;
    }
  // --- auth ---
  /** `onUnavailable` runs when the phone has no Face ID, fingerprint or
   *  passcode to check against (a cancel is onError). */
  | { kind: "biometricPrompt"; reason?: string; onSuccess?: ActionRef; onError?: ActionRef; onUnavailable?: ActionRef }
  | { kind: "signOut" }
  // --- app-level chrome ---
  // Switch the home-screen app icon to one of the alternates declared in the
  // build's Info.plist (via expo-alternate-app-icons plugin). name = null or
  // "" resets to the default icon. Devices without alternate-icon support
  // silently no-op.
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
  // --- mic handoff ---
  // The keyboard extension can't hold the microphone (iOS blocks it in
  // extension processes). So mic taps in the keyboard hand off to the main
  // app, which records + refines and calls back with the cleaned text.
  // See targets/keyboard/TulmiHandoff.swift for the full flow.
  | {
      kind: "completeKeyboardHandoff";
      sessionId?: string;
      text?: string;
      textPath?: string;
      onSuccess?: ActionRef;
    }
  | { kind: "cancelKeyboardHandoff"; sessionId?: string; onSuccess?: ActionRef }
  // Arm the background-audio "Flow Session" (iOS): the app holds the mic alive
  // in the background so the keyboard can drive dictation after swipe-back.
  // Dispatched by the flow_arm screen. iOS-only; a no-op on Android.
  | { kind: "armFlowSession"; idleTimeoutMs?: number; onSuccess?: ActionRef }
  // End the background-audio Flow Session now — the user-visible off switch
  // for the background mic (wired from Settings; no-op when not armed).
  | { kind: "endFlowSession"; onSuccess?: ActionRef }
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

/**
 * One role in the type scale: everything needed to set a run of text, so no
 * size, weight, leading, tracking or rhythm is decided on the device.
 *
 * `family` names a SLOT, not a font — "display" for the heading face, "body"
 * for the running face. The slots are filled by `font.display` / `font.family`
 * below, so a typeface swap is one line in the theme and none in the renderer.
 * A literal face name is also accepted, for a one-off.
 *
 * `color` is a key in `ThemeTokens.color`, resolved on the device, so a role
 * keeps its colour across themes. Margins live here because a role's rhythm
 * (the air under a heading) is part of the role, not of each screen.
 */
export interface TypeRole {
  size: number;
  weight?: string;
  lineHeight?: number;
  letterSpacing?: number;
  family?: "display" | "body" | string;
  italic?: boolean;
  transform?: "uppercase" | "lowercase" | "capitalize" | "none";
  align?: "left" | "center" | "right";
  color?: string;
  marginTop?: number;
  marginBottom?: number;
  marginVertical?: number;
}

export interface ThemeTokens {
  color: Record<string, string>; // primary, bg, surface, text, muted, danger…
  space: Record<string, number>; // xs, sm, md, lg, xl
  radius: Record<string, number>;
  font: {
    /** Running face for the whole app. Unset = the system font. */
    family?: string;
    /** Heading face. Unset = `family`, else the platform serif. */
    display?: string;
    sizes: Record<string, number>; // body, h1, caption…
    weights: Record<string, string>; // regular, bold…
    /**
     * The type scale, by role. Every run of text the renderer sets on its
     * own — Text variants, content blocks, buttons, rows, the shell's title
     * bar, error and update cards — reads one of these by name. A role the
     * theme leaves out falls back to the renderer's built-in copy of it, so
     * a bootstrap cached before the scale existed still draws.
     */
    roles?: Record<string, TypeRole>;
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
     * Android only: live-stream the mic straight from the keyboard (an Android
     * IME can hold the mic in-process). true → the Android keyboard opens a
     * WebSocket and shows words as you speak; false → batch record→upload. iOS
     * ignores this (it uses kb.mic.mode, since iOS extensions can't record).
     */
    liveVoice?: boolean;
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
   *   Typing engine (K4+ binaries)
   *     kb.keyPlane.rolloverCommit    (default true)  press-order rollover: a new
   *                                     finger down commits the still-held key so
   *                                     overlapped presses land in press order
   *     kb.keyPlane.accentTrays       (default true)  accent long-press trays
   *                                     routed through the multi-touch plane
   *     kb.autocorrect.enabled        (default false) word-boundary autocorrect —
   *                                     UITextChecker guesses re-ranked by physical
   *                                     key adjacency; typed original becomes a
   *                                     one-tap revert chip in the suggestion bar
   *     kb.autocorrect.minLen         (default 3)     shortest word considered
   *     kb.autocorrect.maxDistance    (default 2)     weighted edit-distance cap
   *                                     (neighbor-key substitution costs 0.5,
   *                                      apostrophe/space insertion costs 0.5)
   *     kb.autocorrect.lang           (default ""     = follow primaryLanguage)
   *     kb.suggestions.enabled        (default false) completion chips for the
   *                                     in-progress word in the SuggestionBar
   *     kb.suggestions.max            (default 3)
   *     kb.touch.lmBias.enabled       (default false) next-letter hit-target bias
   *     kb.touch.lmBias.pt            (default 3)     extra gap points a likely
   *                                     letter claims; in-bounds hits never stolen
   *     kb.touch.bigrams              object: prev char → string of likely next
   *                                     letters, most likely first; " " row =
   *                                     word-start letter frequency
   *     kb.host.traitRefreshMs        (default 500)   min interval between host
   *                                     trait reads from textDidChange; 0 = every
   *                                     keystroke (pre-K4 behavior)
   *
   *   Touch spaces (K5+ binaries) — native-style key reach; real controls
   *   (shift/delete/space/return/mic/tone/chips) always veto the reach
   *     kb.touch.vSlop                (default 8)     vertical reach beyond each
   *                                     key's rect; row gaps resolve to the
   *                                     nearest row via dx+dy scoring
   *     kb.touch.topRowUpSlop         (default 12)    extra upward reach for the
   *                                     top letter row
   *     kb.touch.bottomRowDownSlop    (default 10)    extra downward reach for
   *                                     the bottom letter row
   *     kb.touch.edgeToMargin         (default true)  a row's outermost key owns
   *                                     its side margin to the keyboard edge
   *                                     (dead corners beside a/l type a/l)
   *
   *   Space-bar trackpad (hold space → cursor scrubbing; K5 fixed the gesture
   *   being cancelled by its own remount — state change is now in-place)
   *     kb.trackpad.enabled           (default true)
   *     kb.trackpad.longPressMs       (default 300)   hold-to-activate
   *     kb.trackpad.ptPerChar         (default 7)     drag pt per cursor step
   *
   *   Layer ergonomics (K6+)
   *     kb.layer.returnAfterSpace     (default true)  space/return on 123/#+=
   *                                     flips back to the letter layer (native)
   *
   *   Swipe typing + role keys (K7+)
   *     kb.swipe.enabled              (default false) QuickPath glide typing —
   *                                     embedded frequency lexicon, first/last-key
   *                                     anchoring, neighbor-tolerant path match
   *     kb.swipe.minKeys              (default 3)     distinct keys before a drag
   *                                     promotes from roll to swipe
   *     kb.swipe.maxAlternates        (default 3)     runner-up chips in the bar
   *     kb.swipe.trail.color/.width/.fadeMs — the fading ink trail
   *     kb.swipe.extraWords           array — OTA lexicon extension
   *     kb.keyPlane.shift             (default true)  shift rides the plane:
   *                                     arms on touch-down, slide-to-letter
   *                                     one-shot capitals, hold locks caps
   *     kb.layerPeek.enabled          (default true)  123/#+=/ABC switch on
   *                                     touch-down; press-slide-release types a
   *                                     key and bounces back (native layer-peek)
   *     kb.autocorrect.backspaceRevert (default true) backspace right after an
   *                                     autocorrect restores the typed original
   *     kb.autocorrect.confusables    object: word → alternatives OFFERED as
   *                                     chips when the word is spelled fine
   *                                     (their/there, your/you're…)
   *     kb.flow.glyphSize             (default 16)    Start Flow bolt size; the
   *                                     SDUI mic shows kb.flow.startGlyph when
   *                                     no flow session is armed (K7+)
   *     kb.height.pt                  (default 0 = system height) explicit
   *                                     keyboard height constraint
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
   *     kb.mic.liveText               (default true)  dictation "button logic":
   *                                     true  = words paint the field live as you speak
   *                                     false = nothing shows until STOP, then the whole
   *                                             utterance lands in one block (after-stop).
   *                                     Governs iOS Flow, iOS stream, and Android liveVoice.
   *                                     Batch STT (Groq) is always after-stop regardless;
   *                                     this flag makes a streaming STT (Deepgram) defer too.
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
  // --- the desktop window only (desktop src/app/sdui/) ---
  /** Put text on the clipboard and say so. */
  | { kind: "copyText"; text: string; message?: string }
  /** Change one of this computer's own settings (the pill, pausing, start at
   *  login, tap to talk). "$toggle" flips the current value. */
  | { kind: "desktop.config"; key: string; value: unknown }
  /** Start (or stop) dictation, as the hotkey does. */
  | { kind: "dictate" }
  /** Start (or stop) taking notes, as the notes hotkey does (desktop). */
  | { kind: "notes.toggle" }
  /** Open the Mac's Screen & System Audio Recording settings, so notes can
   *  hear the computer's sound (desktop, macOS). */
  | { kind: "notes.allowSystemAudio" }
  /** Download, check and install a newer build in place of this one, then
   *  restart on it (desktop/updater.js). `words` are the card's line for each
   *  step; "{pct}" in `downloading` is filled in by the window. */
  | { kind: "installUpdate"; version: string; url: string; sha512: string;
      words?: { downloading?: string; installing?: string; failed?: string; manual?: string } }
  | { kind: "readClipboard"; assignTo: string }
  | { kind: "share"; text?: string; url?: string; title?: string }
  // ----- state store (backend scratch dict) -----
  | { kind: "setState"; path: string; value: unknown }
  | { kind: "toggleState"; path: string }
  /** Add or remove one value in the array at `path` — the primitive a
   *  multi-select needs. `min` refuses the removal that would take the array
   *  below that length, so a required choice cannot be emptied. */
  | { kind: "toggleInArray"; path: string; value: unknown; min?: number }
  | { kind: "appendState"; path: string; value: unknown; max?: number }
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

// ===========================================================================
// 8. Vocabulary 2 — the building blocks (pure/SPEC.md section 2)
// ===========================================================================
//
// Vocabulary 1 is the fixed node list above: one node type per feature, so every new construction needed a new
// client build. Vocabulary 2 is about ten GENERAL blocks — expressions, templates, rules, motion, gestures, lists,
// inputs, media, paint, device facts, phone-local values, data and the shell — after which a new screen, flow or
// interaction is new server data and nothing else.
//
// WHERE THE TRUTH LIVES. Every shape below mirrors a spec object in the phone's own code, which is what the
// renderer implements. These are the TypeScript mirrors; when one disagrees with the phone, the phone is right:
//
//   kernel/limits.ts LIMITS       the numbers (the server reads them from the generated shared/sdui/kernel.cjs,
//                                 never from a copy here, so there is one set and not two that drift)
//   kernel/blocks.ts BLOCKS       the closed list of block names
//   components/v3Spec.ts SPEC     List, Each, Input, Video, Audio, Camera
//   motion/spec.ts MOTION_SPEC    motion on any node
//   gesture/spec.ts GESTURE_SPEC  gestures on any node
//   theme/paintCore.ts PAINT_SPEC paint on any box
//   device/factsCore.ts           the device facts, and DEVICE_SPEC
//   localCore.ts LOCAL_SPEC       phone-local values
//   shell/blocks/index.ts SPEC    the shell trees and presentations
//   data/index.ts SPEC            callEndpoint's new options, and subscribe
//
// THE GATE. `tulmi/src/experience/sdui2/lint.ts` checks a screen against the generated kernel and works out its
// `needs`; `gate.ts` serves it only to a client that declared every one of them. Nothing here is reachable until
// a screen says `needs` and a client says `blocks` (SPEC 2.0 principles 2 and 6).

/** The vocabulary the blocks below belong to. A client says `vocab: 2` once it carries the kernel. */
export const SDUI_VOCAB = 2;

/** The closed list of block names, in the order of pure/SPEC.md 2.1. Mirrors kernel/blocks.ts BLOCKS exactly. */
export const SDUI_BLOCKS = [
  "expr", "defs", "rules", "device", "local", "paint", "motion", "gesture", "list", "input", "media", "data", "shell", "call",
] as const;

export type BlockName = (typeof SDUI_BLOCKS)[number];

/** Planned, but owned by another spec: `scene` is the standalone drawing node, which arrives with animation format 3. */
export const SDUI_LATER_BLOCKS = ["scene"] as const;

// --------------------------------------------------------------------------- 8a. expressions (`expr`)
//
// ONLY TWO OBJECT SHAPES ARE EVER EVALUATED. A bare string is never looked at for "{{ }}", because the server puts
// people's own words into string props — a note's title, a stranger's calendar invite — and a title reading
// "{{ state.token }}" must draw as those characters. A value that arrives through the store, a `bind`, a list row
// or an endpoint is data too: it is never parsed a second time.

/** Text with holes: `{ "$t": "{{ count(state.done) }} of {{ count(state.items) }} done" }`. */
export interface TextTemplate { $t: string }

/** One value: `{ "$": "state.busy ? 0.4 : 1" }`. */
export interface ValueBinding { $: string }

/** A condition written as an expression: `{ "expr": "device.perm.mic == 'granted' && !state.dismissed" }`. */
export interface ExprCondition { expr: string }

/** A prop that may be written as data or worked out on the device. */
export type Val<T> = T | ValueBinding;
/** A text prop: as written (and shown as written), or text with holes, or one value. */
export type Txt = string | TextTemplate | ValueBinding;

// --------------------------------------------------------------------------- 8b. templates (`defs`)

/** One screen-local template: the names it takes, and the tree it draws. Read inside as `args.<name>`. */
export interface DefSpec {
  params?: string[];
  root: Node;
}

/** A screen's templates, by name. No recursion, direct or indirect; the kernel refuses it at compile. */
export type Defs = Record<string, DefSpec>;

/** `{ type: "Use", def, args, slots }` draws a template. A `Use` leaves nothing of itself behind, so a `visibleIf`,
 *  an `id` or a `style` on it would simply disappear: lint refuses those rather than let them go quiet. */
export const USE_NODE = "Use";
/** `{ type: "Slot", name }` marks where a `Use`'s `slots` content goes inside a template. */
export const SLOT_NODE = "Slot";

// --------------------------------------------------------------------------- 8c. rules and timers (`rules`)

/** A rule: exactly one of `when`, `every` or `after`, and what to do. Mirrors kernel/rules.ts RuleSpec. */
export interface RuleSpec {
  /** This rule's own name on the screen. */
  id: string;
  /** Fired on the change from false to true. */
  when?: ExprCondition;
  /** Milliseconds between fires. */
  every?: number;
  /** Milliseconds after the rule starts, once. */
  after?: number;
  /** The action to run. */
  do: ActionRef;
  /** Fire at most once, ever. */
  once?: boolean;
  /** `when` must hold this long before it fires. */
  debounceMs?: number;
  /** Live only while the node is on screen. A node's rules always are. */
  whileVisible?: boolean;
}

// --------------------------------------------------------------------------- 8d. motion on any node (`motion`)

/** One ease by name, or a cubic `[x1, y1, x2, y2]`. */
export type MotionEase = "lin" | "in" | "out" | "inout" | "step" | [number, number, number, number];

/** Keyframes over a clock in seconds: `[[time, value], [time, value, ease]]`. */
export interface MotionKeys { k: Array<[number, number] | [number, number, MotionEase]>; loop?: boolean }

/** A damped spring, mass 1, damping = 2 * damp * sqrt(k). */
export interface MotionSpring { spring: number; k?: number; damp?: number; from?: number }

/** A value: hold a number, run keyframes, or settle through a spring. */
export type MotionValue = number | MotionKeys | MotionSpring;

/** ONE input, mapped piecewise — `ui.scrollY`, a gesture's own `ui.<into>.x | y | scale | progress`, or a state
 *  path. One input and no expressions, deliberately: that is what keeps it on the UI thread. */
export interface MotionDrive { by: string; k: Array<[number, number] | [number, number, MotionEase]> }

/** The style keys motion may move, and nothing else. An unknown key is ignored, never an error. */
export const MOTION_KEYS = [
  "opacity", "translateX", "translateY", "scale", "scaleX", "scaleY", "rotate", "skewX", "skewY",
] as const;
export type MotionKey = (typeof MOTION_KEYS)[number];

/** `motion` on a node, in vocabulary 2. Mirrors motion/spec.ts MOTION_SPEC. */
export interface NodeMotion {
  /** Played once when the node arrives. */
  enter?: Partial<Record<MotionKey, MotionValue>>;
  /** Played once as it leaves. Keyframes only: a spring has no end to leave on. */
  exit?: Partial<Record<MotionKey, MotionKeys>>;
  /** Played round and round. */
  loop?: Partial<Record<MotionKey, MotionValue>>;
  /** Follows one input, piecewise. */
  drive?: Partial<Record<MotionKey, MotionDrive>>;
  /** The node settles into its new box through a spring. */
  layout?: true | { k?: number; damp?: number } | { spring: false; ms: number };
  /** A shared-element id: the same id on two screens flies from one box to the other (drawn as a JS overlay). */
  shared?: string;
}

// --------------------------------------------------------------------------- 8e. gestures on any node (`gesture`)

export const GESTURE_KINDS = ["tap", "doubleTap", "longPress", "drag", "pan", "swipe", "pinch", "hover"] as const;
export type GestureKind = (typeof GESTURE_KINDS)[number];

/**
 * One gesture on a node. Mirrors gesture/spec.ts GESTURE_SPEC.
 *
 * THE TWO KINDS OF `ui.*` VALUE, which is the whole design: while a finger moves, `ui.<into>.x | y | scale |
 * progress` live only on the UI thread, and only `motion.drive` reads them; when it lifts, those four are written
 * to the store, once. In expressions, in `commitIf` and in rules, `ui.*` always means that value at the end.
 */
export interface GestureSpec {
  kind: GestureKind;
  /** This gesture's own name, so another can ask to run after it. */
  id?: string;
  /** Where its values go, under `ui.`. A plain name. */
  into?: string;
  /** How it gets on with the others. */
  claim?: "exclusive" | "simultaneous" | `after:${string}`;
  axis?: "x" | "y" | "both";
  /** A drag's run. NUMBERS: the device reads these through a finite check that takes numbers only, so V1 resolves
   *  any `{ "$": … }` before the gesture is compiled. */
  min?: number;
  max?: number;
  snap?: number[];
  rubber?: boolean | number;
  springK?: number;
  springDamp?: number;
  projectMs?: number;
  taps?: number;
  window?: number;
  hold?: number;
  slop?: number;
  distance?: number;
  velocity?: number;
  minScale?: number;
  maxScale?: number;
  do?: ActionRef;
  /** Asked after the end values are in the store. */
  commitIf?: ExprCondition;
  onCommit?: ActionRef;
  onCancel?: ActionRef | { kind: "spring"; to: number };
  onLeft?: ActionRef;
  onRight?: ActionRef;
  onUp?: ActionRef;
  onDown?: ActionRef;
}

// --------------------------------------------------------------------------- 8f. lists (`list`)

/** Where a list's next page comes from, and where its rows go. `cursor` and `into` are plain store dot-paths
 *  (`feedCursor`), not `state.feedCursor`. */
export interface ListPage {
  endpoint: string;
  cursor?: string;
  into: string;
  mode?: "append" | "prepend" | "replace";
}

/** `List`: rows from an array, one template each, windowed, paged. A List in a Screen becomes the screen's
 *  scroller — the nodes above it become its header, the ones below its footer. Mirrors v3Spec.ts SPEC.List. */
export interface ListProps {
  data?: Val<unknown[]>;
  item: Node;
  key?: string;
  estimatedSize?: number;
  uniform?: boolean;
  horizontal?: boolean;
  /** This List is its own bounded scroller; it then needs a numeric `height` or `maxHeight` in its style too. */
  scroll?: boolean;
  page?: ListPage;
  pageMode?: "append" | "prepend" | "replace";
  onEndReached?: "page" | "none";
  endThreshold?: number;
  refresh?: boolean;
  /** Which rows stick to the top: an expression asked ONCE PER ROW, with `item` and `index` in scope
   *  (blocks/scope.ts itemBool) — `"item.isHeader"`, or the same source as `{ "$": "item.isHeader" }`. The List
   *  never works it out itself (nodeCore.ts keeps `sticky` and `item` out of compileMap, because the List's own
   *  scope holds no row), so it arrives at the list as written. Not a `{ "expr" }` and not a `{ "$t" }`: itemBool
   *  reads no source out of either, which is silently no sticky rows at all. */
  sticky?: string | ValueBinding;
  clip?: boolean;
}

/** `Each`: one template repeated over a small array. Everything is drawn; nothing is windowed. */
export interface EachProps {
  data?: Val<unknown[]>;
  item: Node;
  key?: string;
  max?: number;
}

// --------------------------------------------------------------------------- 8g. one Input node (`input`)

export const INPUT_KINDS_WAVE1 = [
  "text", "multiline", "number", "code", "search", "switch", "toggle", "slider", "segmented", "slideToConfirm",
] as const;
export const INPUT_KINDS_WAVE2 = ["stepper", "picker", "date", "time", "rating", "chips"] as const;
export const INPUT_KINDS = [...INPUT_KINDS_WAVE1, ...INPUT_KINDS_WAVE2] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

/**
 * `Input`: one field node with a `kind`. The value is sanitized, capped and written to the node's bound path —
 * never evaluated. Mirrors v3Spec.ts SPEC.Input.
 *
 * Formats: number → number | null; switch → boolean; chips → string[]; date → YYYY-MM-DD; time → HH:MM (24h);
 * segmented and picker → one of the option values.
 */
export interface InputProps {
  kind: InputKind;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  /** code: how many boxes. */
  length?: number;
  digitsOnly?: boolean;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  /** slider: write while the finger moves, at most ten times a second. */
  live?: boolean;
  /** slideToConfirm: how far across counts (0.5..1). */
  threshold?: number;
  options?: Array<string | { value: string; label: string }>;
  stars?: number;
  minuteStep?: number;
  /** Where to write when the node has no `bind.value`. */
  into?: string;
  autoFocus?: boolean;
}

// --------------------------------------------------------------------------- 8h. media (`media`)

/** Where a player writes what it is doing. Every field is a store dot-path. */
export interface MediaInto {
  playing?: string;
  time?: string;
  duration?: string;
  progress?: string;
  ended?: string;
  loading?: string;
}

/** `Video`: a clip, played by expo-video. */
export interface VideoProps {
  source: string;
  contentFit?: "contain" | "cover" | "fill";
  loop?: boolean;
  muted?: boolean;
  volume?: number;
  rate?: number;
  autoplay?: boolean;
  playing?: Val<boolean>;
  controls?: boolean;
  fullscreen?: boolean;
  into?: MediaInto;
  tickMs?: number;
}

/**
 * `Caller` (block `call`): one person in the call this screen holds, drawn from the call itself — their camera, or their name's first
 * letter while it is off. `who` is "me", "speaker" (whoever is talking) or someone's `identity` as the call's state lists them.
 *
 * It draws nothing and takes no room until the call is up, so a tile can be laid out before anyone is in it.
 */
export interface CallerProps {
  who: Val<string>;
  /** Their own front camera shown as a mirror (true for "me"). */
  mirror?: boolean;
  fit?: "cover" | "contain";
  radius?: number;
  /** Behind the picture, and what a letter sits on while a camera is off. */
  background?: string;
  /** The letter's colour. */
  nameColor?: string;
  fontFamily?: string;
}

/** `Audio`: a sound, played by expo-audio. It draws its children; the player is behind them. */
export interface AudioProps {
  source: string;
  loop?: boolean;
  muted?: boolean;
  volume?: number;
  rate?: number;
  playing?: Val<boolean>;
  into?: MediaInto;
}

export const BARCODE_TYPES = [
  "qr", "ean13", "ean8", "upc_a", "upc_e", "code39", "code93", "code128", "codabar", "itf14", "pdf417", "aztec",
  "datamatrix",
] as const;
export type BarcodeType = (typeof BARCODE_TYPES)[number];

/** `Camera`: the viewfinder, and the code scanner. It never asks for the permission itself — the screen draws its
 *  own card first (the children), and `requestPermission` asks. */
export interface CameraProps {
  mode?: "photo" | "scan";
  facing?: "back" | "front";
  zoom?: number;
  torch?: boolean;
  active?: boolean;
  quality?: number;
  /** Usually bound: false to true takes one picture, and the node puts it back to false. */
  capture?: Val<boolean>;
  barcodeTypes?: BarcodeType[];
  /** The last scan, `{ type, data }`. */
  scanInto?: string;
  readyInto?: string;
  /** granted | unasked | blocked. */
  permissionInto?: string;
}

/** The node types each block brings. Mirrors v3Spec.ts BLOCK_NODES, with `defs`' two. */
export const BLOCK_NODES: Record<string, readonly string[]> = {
  defs: ["Use", "Slot"],
  list: ["List", "Each"],
  input: ["Input"],
  media: ["Video", "Audio", "Camera"],
  call: ["Caller"],
};

// --------------------------------------------------------------------------- 8i. paint on any box (`paint`)

/** The paint keys a box's `style` may carry. React Native 0.85's own keys; the window maps them to CSS.
 *  Mirrors theme/paintCore.ts PAINT_SPEC. */
export const PAINT_KEYS = ["backgroundImage", "boxShadow", "filter", "mixBlendMode", "blur"] as const;
export type PaintKey = (typeof PAINT_KEYS)[number];

/** The filter functions BOTH iOS and Android draw on RN 0.85. Lint keeps `filter` to these. */
export const PAINT_FILTERS = ["brightness", "opacity"] as const;

export const PAINT_BLEND_MODES = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light",
  "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity",
] as const;

export const PAINT_BLUR_TINTS = ["light", "dark", "default", "extraLight", "regular", "prominent"] as const;

export interface PaintGradientStop { color: string; at?: number }
export interface PaintGradient { kind: "linear" | "radial"; angle?: number; stops: PaintGradientStop[] }
export interface PaintShadow {
  offsetX?: number; offsetY?: number; blurRadius?: number; spreadDistance?: number; color?: string; inset?: boolean;
}

/** The paint half of a style. Everything else in `style` stays what it is today. */
export interface PaintStyle {
  backgroundImage?: string | PaintGradient | Array<string | PaintGradient>;
  boxShadow?: string | PaintShadow | PaintShadow[];
  filter?: string | Array<Partial<Record<(typeof PAINT_FILTERS)[number], number>>>;
  mixBlendMode?: (typeof PAINT_BLEND_MODES)[number];
  /** A real blur of what is BEHIND the box (expo-blur), not of the box itself. */
  blur?: number | { intensity?: number; tint?: (typeof PAINT_BLUR_TINTS)[number] };
}

// --------------------------------------------------------------------------- 8j. device facts, phone-local (`device`, `local`)

/** What a permission reads. `photos` is iPhone only; on Android it reads `unsupported`, on purpose. */
export type PermState = "granted" | "denied" | "blocked" | "unasked" | "unsupported";

/**
 * Every `device.*` an expression may read. A FIXED LIST: no identifiers, no advertising ids, no location values
 * (only whether location is allowed), and no installed-app list beyond the six payment schemes a "pay with…"
 * chooser needs. Mirrors device/factsCore.ts FACT_PATHS.
 *
 * `canOpen.*` is for drawing a chooser ON THE PHONE. Lint refuses it in a request body, so the server never
 * collects a list of what someone has installed. On Android only `canOpen.upi` is real; the other five read null
 * (unknown), because the binary's <queries> lists only that one.
 */
export const DEVICE_FACTS = [
  "insets.top", "insets.bottom", "insets.left", "insets.right",
  "keyboard.visible", "keyboard.height", "keyboard.enabled", "keyboard.ready",
  "reduceMotion", "scheme", "locale", "fontScale", "width", "height", "sizeClass", "online", "appState",
  "perm.mic", "perm.camera", "perm.notifications", "perm.location", "perm.photos",
  "canOpen.upi", "canOpen.phonepe", "canOpen.gpay", "canOpen.paytm", "canOpen.cred", "canOpen.bhim",
  "platform", "appVersion", "runtime", "blocks",
] as const;
export type DeviceFact = (typeof DEVICE_FACTS)[number];

/** The `device.canOpen.*` names, and the scheme each one probes (declared in LSApplicationQueriesSchemes). */
export const CAN_OPEN_SCHEMES: Record<string, string> = {
  upi: "upi://", phonepe: "phonepe://", gpay: "tez://", paytm: "paytmmp://", cred: "credpay://", bhim: "bhim://",
};

/** `local`: what this phone remembers between launches — a hint dismissed, a draft, a last choice. Its own
 *  namespace per account, cleared on sign-out, never for secrets (lint refuses a name that reads like one). */
export interface LocalSetSpec { kind: "local.set"; path: string; value: unknown; onError?: ActionRef }
export interface LocalRemoveSpec { kind: "local.remove"; path: string; onError?: ActionRef }

// --------------------------------------------------------------------------- 8k. data and streams (`data`)

export interface MultipartFile { field: string; uri: string; name?: string; type?: string }
/** What `callEndpoint` gains with the `data` block. Paths stay relative, under /v1/, our API origin only. */
export interface CallDataOptions {
  multipart?: { files: MultipartFile[]; fields?: Record<string, string | number | boolean> };
  /** A state path; it gets `{ loaded, total, pct }`. */
  progressInto?: string;
  retry?: { times?: number; backoff?: "exp" | "fixed" | number; idempotent?: boolean };
  /** "outbox": kept offline and sent in order. */
  queue?: "outbox";
  /** GET only; emptied by any successful write and by sign-out. */
  cache?: { key: string; ttlMs: number };
  /** Applied at once and undone if the call fails. */
  optimistic?: { path: string; value: unknown };
}

/** `subscribe`: a live topic on the socket we already keep open. A topic, not a path, so the /v1/ rules do not
 *  apply to it; it has its own grammar instead. Mirrors live/subscribe.ts. */
export interface SubscribeSpec {
  topic: string;
  into: string;
  mode?: "replace" | "append" | "merge";
  max?: number;
}

// --------------------------------------------------------------------------- 8l. shell and presentations (`shell`)

export const PRESENTATIONS = ["push", "sheet", "modal", "overlay", "fade"] as const;
export type Presentation = (typeof PRESENTATIONS)[number];

export const SHELL_TRANSITIONS = ["default", "slide", "fade", "none"] as const;
export type ShellTransition = (typeof SHELL_TRANSITIONS)[number];

/** A sheet's resting heights: these names, or a fraction 0.1..1. At most four. */
export const DETENT_NAMES: Record<string, number> = { small: 0.25, medium: 0.5, large: 0.9 };

/** What `navigate` gains with the `shell` block. A missing or wrong value is `push`, which is today's behaviour. */
export interface NavigatePresentation {
  presentation?: Presentation;
  detents?: Array<keyof typeof DETENT_NAMES | number>;
  transition?: ShellTransition | NodeMotion;
  dismissible?: boolean;
}

/** The shell's own trees, sent in the bootstrap. Nothing here replaces today's tab bar, header or toast: they draw
 *  when the server sends no tree. Mirrors shell/blocks/index.ts SPEC. */
export interface ShellTrees {
  "shell.tabBar"?: Node;
  "shell.header"?: Node;
  "shell.toast"?: Node;
}

/** The shell's node types, drawn only inside those trees. */
export const SHELL_NODES = ["TabBar", "Header", "Toast", "Modal", "Sheet"] as const;
