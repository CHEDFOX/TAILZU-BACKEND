/**
 * The shared projection (shared/bots/project.mjs; anim/SPEC.md 5.1): the catalog cut down to a format. The rule that
 * matters is that an installed build is served exactly what it is served today, byte for byte — so a projection of
 * the live file at format 1 must equal the file with its format-2 parts taken out, and nothing else moved.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FORMAT_KEYS, LOOKS_FORMAT_MAX, ProjectError, formatOfCatalog, projectLooks } from "../../shared/bots/project.mjs";

const FILE = new URL("../../shared/bots/looks.json", import.meta.url);
const catalog = () => JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>;

/** A catalog with nothing above format 1: the live one with its scenes and format-2 recipes removed by hand. */
function flattened(): Record<string, unknown> {
  const c = catalog();
  const moments = c.moments as Record<string, { format?: number }>;
  const only: Record<string, unknown> = {};
  for (const [id, m] of Object.entries(moments)) if ((m.format ?? 1) < 2) only[id] = m;
  return { ...c, format: 1, moments: only, scenes: undefined };
}

describe("the projection", () => {
  it("at format 1, a catalog with nothing newer comes back exactly as it went in", () => {
    const flat = flattened();
    delete flat.scenes;
    expect(JSON.stringify(projectLooks(flat, 1))).toBe(JSON.stringify(flat));
  });

  it("the live catalog at format 1 has no scenes and no format-2 recipes, and keeps every format-1 one", () => {
    const c = catalog();
    const cut = projectLooks(c, 1) as Record<string, unknown>;
    expect(cut.scenes).toBeUndefined();
    expect(cut.format).toBe(1);
    const moments = cut.moments as Record<string, { format?: number }>;
    for (const m of Object.values(moments)) expect(m.format ?? 1).toBe(1);
    const all = c.moments as Record<string, { format?: number }>;
    const keptCount = Object.values(all).filter((m) => (m.format ?? 1) === 1).length;
    expect(Object.keys(moments).length).toBe(keptCount);
    // Every section a format-1 build knows is still there, in the same order.
    expect(Object.keys(cut)).toEqual(Object.keys(c).filter((k) => FORMAT_KEYS[1].includes(k)));
  });

  it("at format 2 it is the catalog itself, with its format set", () => {
    const c = catalog();
    const cut = projectLooks(c, LOOKS_FORMAT_MAX) as Record<string, unknown>;
    expect(cut.format).toBe(2);
    expect(Object.keys(cut.moments as object).length).toBe(Object.keys(c.moments as object).length);
    expect(Object.keys((cut.scenes ?? {}) as object)).toEqual(Object.keys((c.scenes ?? {}) as object));
  });

  it("an idle surprise that a format drops goes with it; one that names nothing at all stays, so the check still sees it", () => {
    const c = {
      v: 1,
      moments: { a: { dur: 1, tracks: [] }, b: { format: 2, dur: 1, fallback: "wave", tracks: [] } },
      idle: { every: 30, chance: 0.2, moments: ["a", "b", "ghost"] },
    };
    const cut = projectLooks(c, 1) as { idle: { moments: string[] } };
    expect(cut.idle.moments).toEqual(["a", "ghost"]);
  });

  it("a format on a part, an avatar or a kind is refused by name: the shipped core refuses that key outright", () => {
    for (const where of ["parts", "avatars", "kinds"]) {
      const c = { v: 1, [where]: { x: { format: 2 } } };
      expect(() => projectLooks(c, 1)).toThrow(ProjectError);
      expect(() => projectLooks(c, 1)).toThrow(new RegExp(`${where}\\.x`));
    }
  });

  it("a format-1 recipe that plays a format-2 one is refused by name, not quietly dropped", () => {
    const c = {
      v: 1,
      moments: {
        caller: { dur: 2, tracks: [{ do: "others", play: "newer", n: 2 }] },
        newer: { format: 2, dur: 1, fallback: "wave", tracks: [] },
      },
    };
    expect(() => projectLooks(c, 1)).toThrow(/caller.*newer/);
    expect(() => projectLooks(c, 2)).not.toThrow();
  });

  it("f is clamped, and the catalog's own format is the highest any item asks for", () => {
    const c = catalog();
    expect((projectLooks(c, 0) as { format: number }).format).toBe(1);
    expect((projectLooks(c, 99) as { format: number }).format).toBe(LOOKS_FORMAT_MAX);
    expect(formatOfCatalog(c)).toBe(2);
    expect(formatOfCatalog(flattened())).toBe(1);
    expect(formatOfCatalog(null)).toBe(1);
  });
});
