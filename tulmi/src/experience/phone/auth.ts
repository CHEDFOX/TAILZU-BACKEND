/**
 * Sign-in: the auth screen's copy, Google and Apple, and the screen tree.
 */

import type { Node } from "../../../../shared/types/sdui.js";
import { POLICY } from "../policy.js";

/**
 * Whether the app draws the server-composed sign-in screen or its own.
 *
 * OFF until the screen has been seen working on a device. This is the whole
 * revert: the native screen stays in the binary and stays the thing that owns
 * the auth logic, so flipping this back is a deploy and nobody is ever locked
 * out waiting for a build.
 */
export const AUTH_SDUI = true;

/**
 * The sign-in screen, in one object.
 *
 * Auth was the last screen the server did not compose. Not for a technical
 * reason — bootstrap reaches the app before there is a session — but because
 * the pills and the native sign-in buttons had no registry entries. Those
 * shipped; this is the screen built out of them.
 *
 * Everything below is a string, a size, a spacing or a duration. There is no
 * logic here and there must never be: the flow still lives in the app, because
 * a sign-in screen composed by a server that is having a bad day has to still
 * be a sign-in screen. This decides how it LOOKS.
 */
export const AUTH_UI = {
  brand: "X0 Bot",
  tagline: "You talk. It writes.",

  /** The window. hideChrome is on, so this padding IS the safe area. */
  paddingHorizontal: 28,
  paddingBottom: 42,
  paddingTop: 72,

  /** How dark the scrim over the uploaded backdrop is. 0 shows the art raw. */
  scrim: 0.42,

  /**
   * The pill itself, for both methods. Every key here is forwarded to
   * SwipePill and lands on what draws; anything left out keeps the shipped
   * value, so this can be as small as one line.
   */
  pill: {
    // Pale ink, not amber (not even a dimmed one): signing in is not
    // something live, and amber is kept for what is. The dark icon on it
    // still says "go".
    targetBackground: "#F3E2C6",
    targetIconColor: "#000000",
    // What the empty pill says. The phones take their placeholder from the
    // field definition in the binary; the window reads these, so the one piece
    // of copy inside the form is tunable on the surface that has no other way
    // to change it. An unknown key in `look` is ignored, so sending them costs
    // the phones nothing.
    emailLabel: "Email address",
    phoneLabel: "Phone number",
  },

  entry: {
    gap: 16,
    brandSize: 34,
    brandGap: 6,
    taglineSize: 14,
    /** Space between the copy block and the first pill. */
    blockGap: 34,
    /** When each pill nudges its badge to advertise the swipe. */
    hintDelayMs: 1100,
    hintStaggerMs: 160,
    social: { size: 52, gap: 16, topGap: 22 },
    /**
     * THE BRIDGE, for an Android bundle that cannot come back from Google.
     * That bundle's Google button is a LINK to Supabase's own sign-in, which
     * returns on tulmi:// with the session; and because that bundle has no
     * way to notice a session landing, a second button reloads the app so
     * boot finds it. Revealed only after Google was tapped, so the screen
     * does not carry a button nobody has a use for yet.
     */
    googleWeb: { continueLabel: "Continue", continueTopGap: 18 },
    /**
     * The entrance, PER ELEMENT.
     *
     * There is no stagger index and no "which one am I" — each row carries its
     * own delay. A stagger computed from position means the order is decided by
     * the layout and can only be changed by moving things; a delay per row means
     * the socials can arrive first, or two rows can land together, or the brand
     * can be held back a beat, without touching the composition.
     *
     * Bottom-up as shipped: socials leave the floor first, the brand settles
     * last. `spring` is the shape, shared unless a row overrides it — lower
     * damping overshoots more, higher stiffness lands sooner.
     */
    suction: {
      spring: { damping: 14, stiffness: 110, mass: 0.9 },
      scaleFrom: 0.86,
      // Kept so an older bundle, which reads these three and computes its own
      // stagger, still animates rather than snapping in.
      staggerMs: 95,
      durationMs: 780,
      fromY: 120,
      rows: {
        brand:   { delayMs: 285, fromY: 90 },
        email:   { delayMs: 190, fromY: 120 },
        phone:   { delayMs: 95,  fromY: 120 },
        socials: { delayMs: 0,   fromY: 120 },
        codeTitle: { delayMs: 120, fromY: 80 },
        codePill:  { delayMs: 0,   fromY: 110 },
        // Last in, and barely travels. It is the smallest thing on the screen
        // and should settle rather than arrive.
        legal:   { delayMs: 380, fromY: 40 },
      },
    },
  },

  /**
   * The consent line under everything.
   *
   * Not a link. The tappable Terms and Privacy Policy live in Settings, which
   * is where a store reviewer is told to find them; this is the notice at the
   * point of consent, and a sign-in screen is a bad place to send someone out
   * to a web page mid-flow. Set `text` to "" and the line disappears — it is a
   * value, not a node, so removing it needs no deploy.
   */
  /**
   * The consent line under everything.
   *
   * IT OPENS THE PAGES IT NAMES. It used to be flat text, on the reasoning
   * that the tappable copies live in Settings and a sign-in screen is a bad
   * place to send someone out to a web page. That was the wrong trade: this is
   * the moment of consent, and consenting to terms you cannot read is not
   * consent. It is also what Paddle looks for before it will sell on your
   * behalf, and what a store reviewer expects to find here rather than two
   * screens away.
   *
   * Written as parts rather than one string because only two of them are
   * links. They lay out as one wrapping sentence, so it still reads as a
   * sentence and not as a row of buttons.
   */
  legal: {
    /** Kept, and still the fallback for any bundle too old to draw the parts. */
    text: "Continuing means you agree to our Terms and Privacy Policy.",
    parts: [
      { text: "Continuing means you agree to our " },
      { text: "Terms", url: POLICY.terms },
      { text: " and " },
      { text: "Privacy Policy", url: POLICY.privacy },
      { text: "." },
    ] as ReadonlyArray<{ text: string; url?: string }>,
    fontSize: 10.5,
    lineHeight: 15,
    // Dim enough to read as fine print and no dimmer — this is the one line on
    // the screen that has to survive being looked at by a reviewer.
    color: "rgba(255,255,255,0.40)",
    /** The two that open something. Brighter, and underlined, because fine
     *  print nobody can tell is tappable is fine print nobody taps. */
    linkColor: "rgba(255,255,255,0.78)",
    marginTop: 24,
  },

  code: {
    // Kept as empty strings rather than deleted, so putting a line back is a
    // value rather than a node.
    title: "",
    sub: "",
    titleSize: 26,
    subSize: 14,
    gap: 10,
    blockGap: 30,
    /** The pill that replaced the six circles. */
    height: 56,
    letterSpacing: 8,
    fontSize: 17,
  },
};

/**
 * Build it. Returned inside BOOTSTRAP rather than from buildScreen, because the
 * auth gate runs before there is a session and can never fetch a screen — the
 * same reason the backdrop rides in the flags.
 *
 * AuthPhase gates the two halves. The phase lives in a React context in the
 * app, not in the SDUI store, so `visibleIf` has no state path to read; a node
 * is the honest way to express it rather than mirroring the phase into the
 * store and living with a frame where the two disagree.
 */
/**
 * @param googleHidden Omit the Google button entirely. For an Android client
 * whose JavaScript cannot come back from Google: the store binary's bundle
 * never claimed the scheme the native client returns on, and lacks the web
 * path that goes round it — so on a FRESH INSTALL, before any OTA has
 * applied, the button would strand the user on google.com. Omitted, they
 * sign in by email on that first open; the moment the OTA lands, the client
 * declares `googleWeb` and the button is back. The old bundle cannot be
 * changed, but what it draws can, because it draws this.
 */
/**
 * @param googleLink With it, the Google button is a link to Supabase's own
 * sign-in rather than the native GoogleSignIn component — for a bundle whose
 * native client cannot come back (see googleHidden), but which CAN open a
 * URL and CAN reload itself, both of which the shipped action set has. The
 * link returns on tulmi:// with the session; a Continue button, revealed by
 * the tap, reloads the app so boot finds that session. Google on a fresh
 * install's first open, with one extra tap, and no new binary.
 */
/** Google's "G": its four coloured paths on a 48 grid, as the sign-in buttons draw it. */
export const GOOGLE_PATHS: ReadonlyArray<readonly [string, string]> = [
  ["#EA4335", "M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"],
  ["#4285F4", "M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"],
  ["#FBBC05", "M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"],
  ["#34A853", "M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"],
];

/**
 * Google's "G", in its four colours, as four SVG nodes over one another — the
 * shipped bundle has an SVG node that takes one path, and has had since June.
 * The circle matches the native social button to the half-point border. The
 * tap records itself in the screen's store before opening the link, which is
 * what reveals Continue.
 */
function googleLinkButton(url: string, size: number): Record<string, unknown> {
  const G = 20, inset = (size - G) / 2;
  const paths = GOOGLE_PATHS;
  return {
    type: "Stack",
    on: { onPress: { kind: "sequence", actions: [
      { kind: "setState", path: "googleStarted", value: true },
      { kind: "openUrl", url, external: true },
    ] } },
    props: { pressOpacity: 0.7, accessibilityLabel: "Sign in with Google" },
    style: {
      width: size, height: size, borderRadius: size / 2, borderWidth: 0.5,
      borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.03)",
    },
    children: paths.map(([fill, d]) => ({
      type: "SVG",
      props: { viewBox: "0 0 48 48", d, fill },
      style: { position: "absolute", left: inset, top: inset, width: G, height: G },
    })),
  };
}

export function authScreenTree(
  isDesktop = false,
  opts: { googleHidden?: boolean; googleLink?: string | null; appleHidden?: boolean } = {},
): Record<string, unknown> {
  const ui = AUTH_UI;
  // A STACK, NOT A SCREEN.
  //
  // Screen is a ScrollView that paints theme.color.bg and adds its own content
  // padding. Both are wrong here and both were visible: the paint covered the
  // uploaded backdrop entirely, and a scroll container does not honour
  // justifyContent unless its content is told to grow — so the rows sat under
  // the top padding instead of at the bottom. A plain filling stack has
  // neither problem.
  //
  // A WINDOW ANCHORS DIFFERENTLY. On a phone this fills the screen and the rows
  // sit at the bottom, where a thumb is. A window has no thumb and no bottom to
  // reach for: the form is a column beside the art, placed by gateLayout, and a
  // tree that fills the viewport and pushes to the floor would fight that
  // placement for control of the same pixels. So the same rows, in a box that
  // lets its container decide where it sits.
  const root: Record<string, unknown> = isDesktop
    ? {
        position: "relative",
        backgroundColor: "transparent",
        justifyContent: "center",
      }
    : {
        position: "absolute",
        top: 0, left: 0, right: 0, bottom: 0,
        // Transparent, so the art behind is the background rather than being
        // hidden by one.
        backgroundColor: "transparent",
        justifyContent: "flex-end",
        paddingHorizontal: ui.paddingHorizontal,
        paddingTop: ui.paddingTop,
        paddingBottom: ui.paddingBottom,
      };
  return {
    type: "Stack",
    style: root,
    children: [
      // ── entry ──────────────────────────────────────────────────────────
      {
        type: "AuthPhase",
        props: { phases: ["entry", "sending"] },
        children: [
          {
            type: "Stack",
            style: { gap: ui.entry.gap },
            children: [
              // Email is always offered. Phone draws nothing when the backend
              // has not enabled it, so the row simply is not there rather than
              // being there and failing when someone taps it.
              { type: "Rise",
                props: { ...ui.entry.suction.spring, scaleFrom: ui.entry.suction.scaleFrom, ...ui.entry.suction.rows.email },
                children: [{ type: "SwipePill", props: { method: "email", hintDelayMs: ui.entry.hintDelayMs, ...ui.pill } }] },
              { type: "Rise",
                props: { ...ui.entry.suction.spring, scaleFrom: ui.entry.suction.scaleFrom, ...ui.entry.suction.rows.phone },
                children: [{ type: "SwipePill", props: { method: "phone", hintDelayMs: ui.entry.hintDelayMs + ui.entry.hintStaggerMs, ...ui.pill } }] },
              { type: "Rise",
                props: { ...ui.entry.suction.spring, scaleFrom: ui.entry.suction.scaleFrom, ...ui.entry.suction.rows.socials },
                children: [{
                  type: "Stack",
                  style: {
                    direction: "row", gap: ui.entry.social.gap,
                    justifyContent: "center", marginTop: ui.entry.social.topGap,
                  },
                  children: [
                    // Apple's button on a Windows or Linux desktop is a door
                    // to an account almost nobody there has. A Mac keeps it.
                    ...(opts.appleHidden ? [] : [{ type: "AppleSignIn", props: { size: ui.entry.social.size } }]),
                    ...(opts.googleLink
                      ? [googleLinkButton(opts.googleLink, ui.entry.social.size)]
                      : opts.googleHidden ? [] : [{ type: "GoogleSignIn", props: { size: ui.entry.social.size } }]),
                  ],
                }] },
              // The consent notice, under everything. Inside the same Rise
              // sequence as the rows above it, because a static line appearing
              // instantly beneath five that fly in reads as a rendering fault.
              ...(ui.legal.text
                ? [{
                    type: "Rise",
                    props: {
                      ...ui.entry.suction.spring,
                      scaleFrom: ui.entry.suction.scaleFrom,
                      ...ui.entry.suction.rows.legal,
                    },
                    children: [{
                      // ONE SENTENCE, TWO OF WHOSE WORDS OPEN SOMETHING.
                      //
                      // A row that wraps, so it stays a sentence rather than
                      // becoming a row of buttons. The parts with a `url` get
                      // the brighter colour and the underline, because fine
                      // print nobody can tell is tappable is fine print nobody
                      // taps — and the whole point of moving these here was
                      // that they can be read at the moment of consent.
                      //
                      // The action is written inline rather than named: the
                      // sign-in screen runs before there is a session and has
                      // no action table to look a name up in.
                      type: "Stack",
                      style: {
                        flexDirection: "row",
                        flexWrap: "wrap",
                        justifyContent: "center",
                        alignItems: "center",
                        marginTop: ui.legal.marginTop,
                      },
                      children: ui.legal.parts.map((part) => ({
                        type: "Text",
                        props: { content: part.text },
                        ...(part.url
                          ? { on: { onPress: { kind: "openUrl", url: part.url, external: true } } }
                          : {}),
                        style: {
                          fontSize: ui.legal.fontSize,
                          lineHeight: ui.legal.lineHeight,
                          color: part.url ? ui.legal.linkColor : ui.legal.color,
                          ...(part.url ? { textDecorationLine: "underline" } : {}),
                        },
                      })) as Node[],
                      // A bundle that cannot lay this out still shows the
                      // sentence, because consent copy missing entirely is
                      // worse than consent copy that does not open.
                      fallback: {
                        type: "Text",
                        props: { content: ui.legal.text },
                        style: {
                          textAlign: "center",
                          fontSize: ui.legal.fontSize,
                          lineHeight: ui.legal.lineHeight,
                          color: ui.legal.color,
                          marginTop: ui.legal.marginTop,
                        },
                      },
                    }],
                  }]
                : []),
            ],
          },
        ],
      },

      // ── code ───────────────────────────────────────────────────────────
      {
        type: "AuthPhase",
        props: { phases: ["verify", "verifying"] },
        children: [
          {
            type: "Stack",
            style: { gap: ui.code.gap },
            children: [
              // No heading and no supporting line. The step is one field and one
              // way on, exactly like the screen before it.
              // THE SECOND HALF OF THE BRIDGE. Only with the link, only after the
              // link was tapped: reloads the bundle, and boot finds the session the
              // link brought back. A bundle that could notice a session landing
              // would not need this; the one this is for cannot.
              ...(opts.googleLink ? [{
                type: "Stack",
                visibleIf: { eq: ["googleStarted", true] },
                on: { onPress: { kind: "reloadApp" } },
                props: { pressOpacity: 0.75 },
                style: {
                  alignSelf: "center", marginTop: ui.entry.googleWeb.continueTopGap,
                  height: 44, paddingHorizontal: 26, borderRadius: 22,
                  backgroundColor: "rgba(255,255,255,0.10)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
                  alignItems: "center", justifyContent: "center",
                },
                children: [{
                  type: "Text",
                  props: { content: ui.entry.googleWeb.continueLabel },
                  style: { fontSize: 15, fontWeight: "600", color: "#FFFFFF" },
                }],
              }] : []),
              { type: "Rise",
                props: { ...ui.entry.suction.spring, scaleFrom: ui.entry.suction.scaleFrom, ...ui.entry.suction.rows.codePill },
                children: [{
                  type: "CodeEntry",
                  props: {
                    height: ui.code.height,
                    letterSpacing: ui.code.letterSpacing,
                    fontSize: ui.code.fontSize,
                  },
                }] },
            ],
          },
        ],
      },
    ],
  };
}
