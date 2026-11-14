/**
 * THE PERMISSIONS STEP (the window only): everything the app needs from this
 * computer, in one place, once.
 *
 * The phone has "Make me yours" (yours.ts) and the window had nothing — the
 * handshake's own comment said the microphone "is granted by the OS outside the
 * app, so the two setup steps have nothing to ask a window", which was true of
 * a window that only typed. It now talks, looks, records a room and sits in a
 * call, and all four of those are permissions a Mac keeps:
 *
 *   Microphone        the system's own prompt, through requestPermission
 *   Camera            the same, and only a call ever turns it on
 *   Accessibility     System Settings; ask.openAccessibility opens that page
 *   Screen recording  System Settings; ask.openScreenRecording opens that page
 *
 * WHAT IS ON IS THE COMPUTER'S ANSWER, NOT OURS. Each row reads a state path
 * the window keeps for it ($state.micGranted, camGranted, axGranted,
 * seeGranted: sdui/permissions.js reads them from the main process when the
 * page is painted and again every time the window comes back, which is when
 * System Settings may have turned one on). So a row ticks itself while the
 * person is away in Settings, and Blip says so once they all have.
 *
 * A ROW IS ONLY DRAWN WHERE THE WINDOW CAN ANSWER IT. The two Mac settings are
 * a Mac's alone (`os`), and each row needs the capability that reads it, so an
 * older window is asked for what it can answer and nothing else. Nothing here
 * blocks the flow: Continue is always on, and a refusal is a toast saying where
 * to turn it on, never a step that will not pass.
 */

import type { ActionRef, ActionSpec, Condition, Node } from "../../../../shared/types/sdui.js";
import { EN, type ObKey } from "./copy.js";
import { type Plan, BTN, FINE, H, HD, IC, ICON, OB, P, PUSH, SET, TXT, haptic, seq, setState, toast } from "./kit.js";

/**
 * The window's own two actions, which only a window has (sdui/actions.js):
 * each opens one fixed page of the Mac's settings, through the main process,
 * which holds the address. Not in the shared action union, like the Bots app's
 * own OPEN_AX (screens/firstRun/parts.ts).
 */
const OPEN_AX = { kind: "ask.openAccessibility" } as unknown as ActionSpec;
const OPEN_SEE = { kind: "ask.openScreenRecording" } as unknown as ActionSpec;

/** A thing the window needs, as one row: what it is for, and this computer's answer. */
interface Need {
  icon: keyof typeof IC;
  title: ObKey;
  why: ObKey;
  /** Where the window puts the computer's answer. */
  path: string;
  /** What the row's button does while the answer is no, and the word on it. */
  ask: ActionRef;
  button: ObKey;
}

/** Which rows this window can be asked for, in the order they are drawn. */
export function permNeeds(p: Plan): Need[] {
  const can = (name: string): boolean => p.can?.has(name) === true;
  const out: Need[] = [];
  if (can("DeskMicAsk")) out.push({ icon: "mic", title: "wp.mic", why: "wp.mic.d", path: "micGranted", ask: "askMicW", button: "wp.ask" });
  if (can("DeskCamAsk")) out.push({ icon: "cam", title: "wp.cam", why: "wp.cam.d", path: "camGranted", ask: "askCamW", button: "wp.ask" });
  // The Mac's two: its own settings pages, which the main process opens (it
  // holds the addresses; the window names only which page). No other system
  // has either switch.
  if (p.mac && can("DeskAxState")) {
    out.push({ icon: "keys", title: "wp.ax", why: "wp.ax.d", path: "axGranted", ask: OPEN_AX, button: "wp.open" });
  }
  if (p.mac && can("DeskSeeState")) {
    out.push({ icon: "eye", title: "wp.see", why: "wp.see.d", path: "seeGranted", ask: OPEN_SEE, button: "wp.open" });
  }
  return out;
}

/**
 * The two the window asks the system for itself. A no says where to turn it on; it never holds the step up.
 *
 * Not `primed` (shared/types/sdui.ts): a row's own Ask button fires these, with no card in front of it. The window
 * ignores the field either way — its renderer has no card of its own — but this step is a window step, and the mark
 * would be a lie if the same tree ever reached a phone.
 */
export function permsActions(): Record<string, ActionSpec> {
  const blocked = toast(EN["wp.blocked"]);
  const ask = (permission: "microphone" | "camera", path: string): ActionSpec => ({
    kind: "requestPermission", permission,
    onGranted: seq(setState(path, true), haptic("success")),
    onDenied: blocked,
    // Refused once, the system will not ask again: only its settings can turn it on.
    onBlocked: blocked,
  });
  return { askMicW: ask("microphone", "micGranted"), askCamW: ask("camera", "camGranted") };
}

/** One row: the glyph, what it is for, and either "Allowed" or the button that asks. */
function needRow(n: Need, last: boolean): Node {
  const on = { truthy: n.path };
  const off = { falsy: n.path };
  return {
    type: "Stack",
    style: {
      flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 11, paddingHorizontal: 14,
      ...(last ? {} : { borderBottomWidth: 1, borderBottomColor: OB.hair }),
    },
    children: [
      {
        type: "Stack",
        style: {
          width: 38, height: 38, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center",
          backgroundColor: OB.card, borderColor: OB.hair,
        },
        children: [
          { ...ICON(n.icon, 20, OB.ink), visibleIf: off },
          { ...ICON("check", 20, OB.ink), visibleIf: on },
        ],
      },
      {
        type: "Stack",
        style: { flex: 1 },
        children: [
          TXT(EN[n.title], { fontSize: 15.5, fontWeight: "700", color: OB.ink }),
          TXT(EN[n.why], { fontSize: 13, lineHeight: 17, color: OB.ink2 }),
        ],
      },
      // Allowed: the word, and nothing to press — only the computer's own
      // settings can take it back.
      {
        ...TXT(EN["wp.on"], { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", color: OB.ink2 }),
        visibleIf: on,
      },
      {
        type: "Stack",
        visibleIf: off,
        on: { onPress: n.ask },
        props: { pressOpacity: 0.7 },
        style: {
          height: 34, paddingHorizontal: 14, borderRadius: 999, backgroundColor: OB.ink,
          flexDirection: "row", alignItems: "center", justifyContent: "center",
        },
        children: [TXT(EN[n.button], { fontSize: 13.5, fontWeight: "600", color: OB.surf })],
      },
    ],
  };
}

export function permsStep(p: Plan): Node {
  const needs = permNeeds(p);
  // Every row ticked: Blip says so. (With nothing to ask for — a window too old
  // to answer any of them — there is nothing to tick, so he keeps his first
  // line.)
  const all: Condition = { all: needs.map((n) => ({ truthy: n.path })) };
  const mac = p.mac && needs.some((n) => n.button === "wp.open");
  return p.step("perms", [
    needs.length
      ? HD(
          { ...p.spot("pointd", 100, "wp.say"), visibleIf: { not: all } },
          { ...p.spot("thumbs", 100, "wp.say2"), visibleIf: all },
        )
      : HD(p.spot("pointd", 100, "wp.say")),
    H("wp.h"),
    P("wp.p"),
    needs.length
      ? {
          type: "Stack",
          style: { backgroundColor: OB.surf, borderWidth: 1.5, borderColor: OB.ink, borderRadius: 20, overflow: "hidden" },
          children: needs.map((n, i) => needRow(n, i === needs.length - 1)),
        }
      : null,
    // Where to go for the Mac's two, while either is still off.
    mac ? { ...FINE("wp.mac"), visibleIf: { not: all } } : null,
    FINE("wp.foot"),
    PUSH(),
    BTN(EN["ob.cont"], SET(p.next("perms"))),
  ]);
}
