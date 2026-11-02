/**
 * Small parts several phone screens use: the settings gear and the allow pill.
 */

import type { Node, ActionRef } from "../../../../shared/types/sdui.js";

/**
 * THE WAY INTO SETTINGS, ON EVERY TAB ROOT.
 *
 * Settings has never been a tab. The app draws a gear in the header of
 * whichever root is showing and pushes the screen from there — so when all
 * three roots went full bleed and hid that header, the gear went with it and
 * the Settings screen became a screen nothing could reach.
 *
 * Drawn by the screens rather than by restoring the header, because the
 * full-bleed roots are the design and a bar above them is not. One helper, so
 * it sits in the same place on all three and cannot drift: a control that
 * moves between tabs has to be found again on each one.
 *
 * The colour is the caller's, because the ground is not the same on all three
 * — white on the Train art and the You backdrop, ink on the Stats amber. A
 * light glyph on amber is the kind of thing that survives review and then
 * cannot be seen on a phone.
 */
const GEAR = {
  size: 34,
  inset: 16,
  top: 58,
  glyph: 15,
  stroke: 2.1,
  onDark: "rgba(255,255,255,0.66)",
  onDarkBackground: "rgba(255,255,255,0.10)",
  onLight: "rgba(11,11,13,0.62)",
  onLightBackground: "rgba(11,11,13,0.08)",
};

export function settingsGear(on: "dark" | "light" = "dark"): Node {
  const color = on === "light" ? GEAR.onLight : GEAR.onDark;
  const background = on === "light" ? GEAR.onLightBackground : GEAR.onDarkBackground;
  return {
    type: "Stack",
    on: { onPress: { kind: "sequence", actions: [
      { kind: "haptic", style: "selection" },
      { kind: "navigate", screenId: "settings" },
    ] } },
    props: { pressOpacity: 0.6 },
    style: {
      position: "absolute", top: GEAR.top, right: GEAR.inset,
      width: GEAR.size, height: GEAR.size, borderRadius: GEAR.size / 2,
      alignItems: "center", justifyContent: "center",
      backgroundColor: background,
    },
    children: [{
      type: "SVG",
      // Three right-aligned lines, shortest at the top — the same mark the
      // header drew, at the same weight, so nothing has to be relearnt.
      props: {
        viewBox: "0 0 24 24",
        d: "M12 7 H21 M7.5 12 H21 M3 17 H21",
        fill: "none", stroke: color, strokeWidth: GEAR.stroke,
        strokeLinecap: "round",
      },
      style: { width: GEAR.glyph, height: GEAR.glyph },
    }],
  };
}

/**
 * THE ALLOW PILL — one control that carries both answers.
 *
 * A light track, a dismiss on the left, and a dark pill taking everything
 * else. The weighting IS the argument: yes is the whole width of the control
 * and no is a glyph, so the recommended path is obvious before a word is read
 * — and the way out is still there, in plain sight, which a permission screen
 * has to offer or it is a wall.
 *
 * It replaces a row of two buttons on both permission steps. Two buttons side
 * by side make the choice look balanced, and it is not: one of them is what
 * the app needs to work and the other is "not yet".
 *
 * Every value is here, so its shape and its colours are a deploy rather than
 * a build.
 */
const ALLOW_PILL = {
  height: 64,
  /** The light track the dark pill floats in. */
  track: "#F4F4F2",
  padding: 6,
  radius: 999,
  /** The dismiss, on the left. Its box is the tap target, not the glyph. */
  dismissWidth: 54,
  dismissColor: "#141416",
  dismissSize: 17,
  dismissStroke: 2.1,
  /** The action. */
  fill: "#0D0D0F",
  color: "#FFFFFF",
  fontSize: 16,
  tracking: 0.1,
  /** Lift, so the control sits above the screen rather than on it. */
  shadowColor: "#000000",
  shadowOpacity: 0.34,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 8,
};

/**
 * Build one. `label` is the promise, `onPress` keeps it, `onDismiss` is the
 * way past. Omit onDismiss and the ✕ is not drawn at all — some screens have
 * nothing to decline.
 */
export function allowPill(label: string, onPress: ActionRef, onDismiss?: ActionRef): Node {
  const p = ALLOW_PILL;
  return {
    type: "Stack",
    style: {
      flexDirection: "row",
      alignItems: "center",
      height: p.height,
      borderRadius: p.radius,
      backgroundColor: p.track,
      padding: p.padding,
      shadowColor: p.shadowColor,
      shadowOpacity: p.shadowOpacity,
      shadowRadius: p.shadowRadius,
      shadowOffset: p.shadowOffset,
      elevation: p.elevation,
    },
    children: [
      ...(onDismiss
        ? [{
            type: "Stack",
            on: { onPress: onDismiss },
            style: {
              width: p.dismissWidth,
              height: "100%",
              alignItems: "center",
              justifyContent: "center",
            },
            children: [{
              type: "SVG",
              props: {
                viewBox: "0 0 24 24",
                // Two strokes in one path — a ✕ drawn rather than typed, so it
                // keeps its weight and its soft ends at any size.
                d: "M6 6 L18 18 M18 6 L6 18",
                fill: "none",
                stroke: p.dismissColor,
                strokeWidth: p.dismissStroke,
                strokeLinecap: "round",
              },
              style: { width: p.dismissSize, height: p.dismissSize },
            }],
          } as Node]
        : []),
      {
        type: "Stack",
        on: { onPress },
        style: {
          flex: 1,
          height: "100%",
          borderRadius: p.radius,
          backgroundColor: p.fill,
          alignItems: "center",
          justifyContent: "center",
          // No dismiss means the dark pill is the whole control, so it needs
          // the inset back on the left that the ✕ was standing in.
          marginLeft: onDismiss ? 0 : 0,
        },
        children: [{
          type: "Text",
          props: { content: label },
          style: {
            fontSize: p.fontSize,
            letterSpacing: p.tracking,
            color: p.color,
            fontWeight: "500",
          },
        }],
      },
    ],
  };
}
