/**
 * KEYBOT'S KEYBOARD CHOICES, ON THE KEYBOARD. What bots.keybot.settings saves (prefs.ts, `keyboard`) laid over the
 * config GET /v1/keyboard/config sends, so the keyboard does what that page says:
 *
 *   height     Short / Tall: every key row in the tree (the four of each layer) gets that height, and kb.height.pt and
 *              kb.height.byWidth move by the same four rows, so the frame and the rows keep agreeing (catalog.ts
 *              derives the one from the other). Normal is the tree as built.
 *   haptics    Strong: kb.haptics.style "medium". Light is the keyboard's own tick, so nothing changes. Off: the PUT
 *              already turned personality.hapticsAll off (kb.haptics.all); with no key picked one by one either,
 *              kb.haptics.enabled false also quiets the hold buzzes. Keys picked one by one keep buzzing, and a master
 *              switch turned on elsewhere afterwards still works: those two live in the personality, not here.
 *   keyAt      Left / Right of space: the mic (the clay Keylessbord key) leaves the tools row and sits beside the space bar
 *              on the letter and 123 / #+= pages, in each appearance's colours. Top is where it already is.
 *   look       kb.look.force "light" | "dark": both keyboards hold that appearance instead of following the phone.
 *   sounds     three ways: not chosen sends nothing and each phone does what it did (iOS clicks as its own Keyboard
 *              Feedback → Sound says; Android is quiet). On: kb.key.sound true (iOS still needs its own setting;
 *              Android plays its keypress sounds, not in silent or vibrate). Off: kb.key.sound false, quiet on both.
 *   holdSpace  kb.space.holdToSpeak: holding space still starts what a tap on the mic starts; sliding still moves the cursor.
 *
 * The three knobs are sent only for a person who chose (absent = as before), and a person with
 * no keyboard choices gets the config exactly as built: the same object, byte for byte.
 */
import type { Personality } from "../../../shared/types/api.js";
import type { KeyboardConfigResponse, KeyboardNode } from "../../../shared/types/sdui.js";
import type { KeybotPrefs } from "./prefs.js";

/** A key row's height as catalog.ts builds the tree, and what each Key height makes it. */
export const KEY_ROW_HEIGHT = 44;
export const KEY_ROW_HEIGHTS = { short: 40, normal: KEY_ROW_HEIGHT, tall: 48 } as const;
/** Key rows on screen at once: letters, 123, #+= and the number pad each have four. */
export const KEY_ROWS = 4;
/** Strong haptics: the impact style one step up from the keyboard's own selection tick. */
export const STRONG_HAPTIC_STYLE = "medium";
/** The mic beside space: a key as wide as the globe key, with the letter keys' corners (theme.keyRadius). */
const MIC_KEY_WIDTH = 44;
const MIC_KEY_RADIUS = 5;

/** A row of keys, not the tools row (mic, suggestions, tone pill), which is the same height. */
function isKeyRow(n: KeyboardNode): boolean {
  return n.type === "Row" && n.style?.height === KEY_ROW_HEIGHT && !(n.children ?? []).some((c) => c.type === "SuggestionBar");
}

/** The mic out of the tools rows and in beside the space bar; the tree unchanged when it has no mic or no space. */
function micBesideSpace(root: KeyboardNode, side: "left" | "right"): KeyboardNode {
  const mics: KeyboardNode[] = [];
  const rows = (root.children ?? []).map((row) => {
    const at = row.type === "Row" ? (row.children ?? []).findIndex((c) => c.type === "MicKey") : -1;
    if (at < 0) return row;
    const mic = row.children![at]!;
    // Each tools row is one appearance's: its mic keeps that row's condition beside its own (not in a password box).
    const conds = [mic.visibleIf, row.visibleIf].filter((c): c is NonNullable<typeof c> => !!c);
    mics.push({
      ...mic,
      ...(conds.length ? { visibleIf: conds.length > 1 ? { all: conds } : conds[0]! } : {}),
      // A width, not a flex: an appearance-hidden child with flex still claims its share on iOS (see the globe key).
      style: { flex: 0, width: MIC_KEY_WIDTH, bg: mic.style?.bg, fg: mic.style?.fg, radius: MIC_KEY_RADIUS },
    });
    return { ...row, children: row.children!.filter((_, i) => i !== at) };
  });
  if (!mics.length || !rows.some((r) => (r.children ?? []).some((c) => c.type === "SpaceKey"))) return root;
  return {
    ...root,
    children: rows.map((row) => {
      const space = (row.children ?? []).findIndex((c) => c.type === "SpaceKey");
      if (row.type !== "Row" || space < 0) return row;
      const kids = [...row.children!];
      kids.splice(side === "left" ? space : space + 1, 0, ...mics);
      return { ...row, children: kids };
    }),
  };
}

export function withKeybotKeyboard<T extends KeyboardConfigResponse>(cfg: T, choices: KeybotPrefs["keyboard"], personality?: Personality): T {
  const k = choices ?? {};
  const flags: Record<string, unknown> = { ...(cfg.flags ?? {}) };
  let root = cfg.root;
  let changed = false;
  const set = (key: string, value: unknown) => { flags[key] = value; changed = true; };

  const rowH = KEY_ROW_HEIGHTS[k.height ?? "normal"] ?? KEY_ROW_HEIGHT;
  const grow = (rowH - KEY_ROW_HEIGHT) * KEY_ROWS;
  if (grow) {
    if (root?.children) {
      root = { ...root, children: root.children.map((r) => (isKeyRow(r) ? { ...r, style: { ...r.style, height: rowH } } : r)) };
      changed = true;
    }
    if (typeof flags["kb.height.pt"] === "number") set("kb.height.pt", (flags["kb.height.pt"] as number) + grow);
    if (Array.isArray(flags["kb.height.byWidth"])) {
      set("kb.height.byWidth", (flags["kb.height.byWidth"] as Array<Record<string, unknown>>).map((b) =>
        typeof b?.height === "number" ? { ...b, height: b.height + grow } : b));
    }
  }

  if (k.haptics === "strong") set("kb.haptics.style", STRONG_HAPTIC_STYLE);
  if (k.haptics === "off" && !personality?.hapticsAll && !personality?.hapticKeys?.length) set("kb.haptics.enabled", false);

  if ((k.keyAt === "left" || k.keyAt === "right") && root) {
    const moved = micBesideSpace(root, k.keyAt);
    if (moved !== root) { root = moved; changed = true; }
  }

  if (k.look === "light" || k.look === "dark") set("kb.look.force", k.look);
  if (typeof k.sounds === "boolean") set("kb.key.sound", k.sounds);
  if (k.holdSpace === true) set("kb.space.holdToSpeak", true);

  return changed ? { ...cfg, flags, ...(root ? { root } : {}) } : cfg;
}
