/**
 * THE WIDGETS' SHADES HOLD THEIR CONTRAST (shared/native/looks.json, widgets/defaults.ts).
 *
 * A widget is not the app. It is read at a glance, at a third of the size, over whatever wallpaper the person chose,
 * often dimmed by Always-On, and on the Lock Screen iOS renders it in `vibrant` mode, which throws the colour away and
 * maps everything onto a luminance ramp. A shade that is merely "a light grey" in a full-screen app is nothing there.
 *
 * The palettes were copied from the app's own (experience/bots/palette.ts) role for role, and the TEXT roles were
 * thought about — `dim` carries a note saying it was lifted from #8A8A8A because 3.4:1 "read as faded". The STRUCTURE
 * roles never were, and shipped at 1.2:1 to 2.4:1, which is what "the shades are fading" means.
 *
 * THE LADDER, and why it is three numbers and not one. `line`, `outline` and `hollow` are three roles on purpose
 * (nlook.ts says so): a rule, a control's ring, and a mark that means "not yet". Flattening them all to one floor
 * would make a hairline as loud as a button's edge and lose what the three are for.
 *
 *   line     2.2:1   a rule between rows, a track, a card's edge. Seen, and no louder than that.
 *   outline  3.0:1   a secondary button's ring: a control boundary, so WCAG 1.4.11's floor.
 *   hollow   3.5:1   the week's open bead, the island's stages to come. It CARRIES MEANING — an open bead against a
 *                    filled one is the information — so it is held above the boundary floor, not at it.
 *
 * Text roles keep 4.5:1 on their own ground and on `surface`, which is a FILL and so is never measured against the
 * ground itself (a card that contrasted with its page would be a card nobody wanted).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const looks = JSON.parse(readFileSync(join(HERE, "../../shared/native/looks.json"), "utf8")) as {
  palettes: Record<string, Record<string, Record<string, string> | string | undefined>>;
};

/** WCAG 2 relative luminance of "#RRGGBB" (any alpha suffix ignored: these are opaque roles). */
function luminance(hex: string): number {
  const h = hex.replace("#", "").slice(0, 6);
  const part = (i: number): number => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * part(0) + 0.7152 * part(2) + 0.0722 * part(4);
}

/** WCAG 2 contrast ratio, 1:1 to 21:1. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Every real scheme in the catalog: [name, scheme, roles]. */
function schemes(): Array<[string, string, Record<string, string>]> {
  const out: Array<[string, string, Record<string, string>]> = [];
  for (const [name, pal] of Object.entries(looks.palettes)) {
    for (const [mode, roles] of Object.entries(pal)) {
      if (!roles || typeof roles !== "object" || typeof roles.ground !== "string") continue;
      out.push([name, mode, roles as Record<string, string>]);
    }
  }
  return out;
}

const STRUCTURE: Array<[string, number]> = [["line", 2.2], ["outline", 3.0], ["hollow", 3.5]];
const TEXT = ["ink", "meta", "dim", "accent"];

describe("the widgets' palettes", () => {
  it("has the schemes this test thinks it has, so a new palette cannot slip past unmeasured", () => {
    expect(schemes().map(([n, m]) => `${n}/${m}`).sort())
      .toEqual(["dusk/dark", "dusk/light", "ink/dark", "ink/light", "island/dark", "island/light"]);
  });

  for (const [name, mode, roles] of schemes()) {
    describe(`${name}/${mode}`, () => {
      it("sets every structure shade far enough off the ground to be seen", () => {
        const got: Record<string, string> = {};
        for (const [role, want] of STRUCTURE) {
          const v = contrast(roles[role]!, roles.ground!);
          got[role] = `${roles[role]} ${v.toFixed(2)}:1 (want ${want})`;
          expect(v, `${role} ${roles[role]} on ${roles.ground}: ${v.toFixed(2)}:1, wants ${want}`).toBeGreaterThanOrEqual(want);
        }
        expect(Object.keys(got)).toHaveLength(3);
      });

      it("keeps the three apart, so a rule never reads as loud as a ring or a bead", () => {
        const [line, outline, hollow] = STRUCTURE.map(([r]) => contrast(roles[r]!, roles.ground!));
        expect(line!).toBeLessThan(outline!);
        expect(outline!).toBeLessThan(hollow!);
      });

      it("sets words at 4.5:1 on the ground and on the surface they sit on", () => {
        for (const role of TEXT) {
          if (!roles[role]) continue;
          expect(contrast(roles[role]!, roles.ground!), `${role} on ground`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(roles[role]!, roles.surface!), `${role} on surface`).toBeGreaterThanOrEqual(4.5);
        }
      });
    });
  }
});
