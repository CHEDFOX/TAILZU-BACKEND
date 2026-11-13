/**
 * THE NATIVE LOOKS, SERVER SIDE (src/experience/native/*; docs/native-looks.md).
 *
 * Most of this file runs the SHARED FIXTURES (shared/native/fixtures/) rather than cases of its own, because those are the
 * same cases the phone's cleanNativeLooks, the iOS decode and the Android planner run. A case here that disagrees with one of
 * them is a bug in one of us, and the fixture says which.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.STT_PROVIDER = "openai";
process.env.DEV_SKIP_AUTH = "true";
process.env.NODE_ENV = "test";
process.env.NATIVE_LOOKS = "true";
process.env.NATIVE_ACTIVITY = "true";
process.env.ANDROID_BOTS_NOTICE = "true";
// A control volume of this file's own: the high-water mark is a FILE, and a suite that shared /data/control with another
// would read a number that suite's pushes left behind (and then serve the repo's catalog under a bumped v).
process.env.CONTROL_DIR = mkdtempSync(join(tmpdir(), "tailzu-native-looks-"));

import { resetConfigForTests } from "../src/config.js";
import { cleanDesign, cleanPathD, isAllowedLink, isColour } from "../src/experience/native/clean.js";
import {
  activeNativeLooks, checkNativeLooks, cleanCatalog, drawsFormat, legacyLookOf, nativeFilesDir, nativeLooksFlags,
  nudgeLooks, project, resetNativeLooksForTests, setNativeLooksForTests, stampSince,
} from "../src/experience/native/catalog.js";
import { glanceLook, pickDesign } from "../src/experience/native/target.js";
import { activityLookFor } from "../src/widgets/activity.js";
import { activityVars, buildVars, widgetVars } from "../src/experience/native/bind.js";
import { ACTIVITY_BODY_BYTES, bodyBytes, clampVars, fitActivityBody } from "../src/experience/native/size.js";
import { checkSkin, cleanPress, resetSkinsForTests, skinChoices, withKeySkin } from "../src/experience/keyboard/skin.js";
import { WIDGETS_DEFAULTS } from "../src/widgets/defaults.js";
import {
  NLOOK_CAPS, NLOOK_LIMITS, bindsOn, eachItemInfo, isSensitivePath, wordResolvesOn, type NLookCatalog, type NLookDesign,
} from "../../shared/types/nlook.js";
import { KEY_FACE_LIMITS, KEY_SKIN_1 } from "../../shared/types/keyboardFace.js";
import type { KeyboardConfigResponse } from "../../shared/types/sdui.js";
import { formatCatalog } from "../scripts/native-render/format.js";
import { ROOT_SIZES, renderRoot } from "../scripts/native-render/ref.js";

const SHARED = resolve(import.meta.dirname, "../../shared/native");
const read = (p: string): Record<string, unknown> => JSON.parse(readFileSync(resolve(SHARED, p), "utf8")) as Record<string, unknown>;

const CATALOG = read("looks.json") as unknown as NLookCatalog;
const DESIGN_CASES = read("fixtures/designs.json").cases as Array<Record<string, unknown>>;
const ACTIVITY = read("fixtures/activity.json") as { designCases: Array<Record<string, unknown>>; stateCases: Array<Record<string, unknown>> };
const PATHS = read("fixtures/paths.json").cases as Array<Record<string, unknown>>;
const BINDS = read("fixtures/binds.json").cases as Array<Record<string, unknown>>;
const FACES = read("fixtures/faces.json") as { faceCases: Array<Record<string, unknown>>; pressCases: Array<Record<string, unknown>> };

beforeEach(() => { resetConfigForTests(); resetNativeLooksForTests(); resetSkinsForTests(); });
afterEach(() => { resetConfigForTests(); resetNativeLooksForTests(); resetSkinsForTests(); });

/** The options cleanDesign gets when it is run against the real catalog's world. */
const inCatalog = (extra: Partial<Parameters<typeof cleanDesign>[1]> = {}) => ({
  drawsFormat: 1,
  palettes: Object.keys(CATALOG.palettes),
  designIds: Object.keys(CATALOG.designs),
  fallbackOf: Object.fromEntries(Object.entries(CATALOG.designs).map(([id, d]) => [id, d.fallback])),
  ...extra,
});

// ------------------------------------------------------------------ the catalog in the repo

describe("the catalog", () => {
  it("passes its own check, so a deploy can never serve one that does not", () => {
    expect(checkNativeLooks(CATALOG)).toEqual([]);
  });

  it("holds the designs docs/native-looks.md lists, and every one of them is drawable", () => {
    for (const id of ["x0.plain", "x0.base", "x0.dusk", "x0.slab", "bots.plain", "bots.base", "bots.night", "board.base", "board.night", "bu.base"]) {
      expect(Object.keys(CATALOG.designs)).toContain(id);
    }
    for (const r of cleanCatalog(CATALOG)) expect([r.id, r.verdict]).toEqual([r.id, expect.stringMatching(/^(ok|clamped)$/)]);
  });

  it("binds nothing this build does not know: every {{…}} in every design resolves", () => {
    for (const r of cleanCatalog(CATALOG)) expect([r.id, r.binds]).toEqual([r.id, []]);
  });

  it("fits a phone: the whole thing is well under the 256 KB cap", () => {
    const bytes = Buffer.byteLength(JSON.stringify(project(CATALOG, { format: 1, platform: "ios", activity: true })));
    expect(bytes).toBeLessThan(NLOOK_LIMITS.catalogBytes);
  });

  it("every design is inside its own byte, node and depth caps", () => {
    for (const d of Object.values(CATALOG.designs)) {
      const cap = d.surface === "activity" ? NLOOK_LIMITS.activity.designBytes : NLOOK_LIMITS.widget.designBytes;
      expect([d.id, Buffer.byteLength(JSON.stringify(d)) <= cap]).toEqual([d.id, true]);
    }
  });

  it("the legacy widgets.look knob is a CHECKED COPY of the palette, so the two can never drift (H4)", () => {
    const look = WIDGETS_DEFAULTS.flags["widgets.look"] as Record<string, unknown>;
    const rebuilt = legacyLookOf(CATALOG.palettes.ink!);
    expect(look.colors).toEqual(rebuilt.colors);
    expect(look.light).toEqual(rebuilt.light);
    expect(look.alpha).toEqual(rebuilt.alpha);
  });

  it("serves a phone only what it asked for: no targeting rules, and no activity designs on Android", () => {
    const ios = project(CATALOG, { format: 1, platform: "ios", activity: true });
    expect(ios).not.toHaveProperty("targets");
    const android = project(CATALOG, { format: 1, platform: "android", activity: true });
    expect(Object.values(android.designs).some((d) => d.surface === "activity")).toBe(false);
    // Android has no accessory families, so those roots are weight for nothing.
    for (const d of Object.values(android.designs)) {
      if (d.surface !== "widget") continue;
      expect(Object.keys(d.roots ?? {}).filter((r) => ["inline", "rect", "circle"].includes(r))).toEqual([]);
    }
  });

  it("leaves a design above the build's format out, alone", () => {
    const future: NLookCatalog = { ...CATALOG, designs: { ...CATALOG.designs, "x0.next": { id: "x0.next", format: 2, surface: "widget", roots: { small: { type: "Text", props: { text: "x" } } } } } };
    const out = project(future, { format: 1, platform: "ios", activity: true });
    expect(out.designs["x0.next"]).toBeUndefined();
    expect(out.designs["x0.dusk"]).toBeDefined();
  });

  it("a design whose content did not change keeps the v it first appeared under", () => {
    const before = structuredClone(CATALOG);
    stampSince(before, null);
    const after = structuredClone(before);
    after.v = before.v + 5;
    after.designs["x0.dusk"]!.note = "changed";
    const since = stampSince(after, before);
    expect(since["x0.base"]).toBe(before.v);
    expect(since["x0.dusk"]).toBe(after.v);
  });
});

// ------------------------------------------------------------------ the shared fixtures

describe("the shared design fixtures", () => {
  // The Android planner's own case: it counts RemoteViews levels, which the server never does. The fixture says so itself
  // ("iOS draws this same design in full"), so the server's verdict on it is `ok` and the planner's is `clamped`.
  const ANDROID_ONLY = new Set(["android.levels.overCap.usesFallback"]);

  for (const c of DESIGN_CASES) {
    const id = String(c.id);
    it(`${id}: ${String(c.expect)}`, () => {
      const design = structuredClone(c.design) as NLookDesign & { note?: string };
      // The cases that say "generate" are written as a count so the fixture stays readable.
      const g = c.generate as Record<string, unknown> | undefined;
      if (g?.repeatNode && g.times) {
        const root = design.roots![g.root as "large"]!;
        root.children = Array.from({ length: Number(g.times) }, () => structuredClone(g.repeatNode) as NLookNodeLike);
      }
      if (g?.nestNode && g.depth) {
        let node = design.roots![g.root as "large"]! as NLookNodeLike;
        for (let i = 1; i < Number(g.depth); i++) { const child = structuredClone(g.nestNode) as NLookNodeLike; node.children = [child]; node = child; }
        node.children = [structuredClone(g.leaf) as NLookNodeLike];
      }
      if (g?.padNoteToBytes) design.note = "p".repeat(Number(g.padNoteToBytes));

      const extra: Partial<Parameters<typeof cleanDesign>[1]> = {};
      if (c.palettes) extra.palettes = Object.keys(c.palettes as object);
      if (c.catalogArt) extra.art = c.catalogArt as never;
      const r = cleanDesign(design, inCatalog(extra));
      expect(r.verdict).toBe(ANDROID_ONLY.has(id) ? "ok" : c.expect);
      if (r.verdict === "ok" || r.verdict === "clamped") expect(r.design).toBeDefined();
      else expect(r.design).toBeUndefined();
    });
  }

  it("a clamped case says WHERE, so a failing publish is readable", () => {
    const bad = DESIGN_CASES.find((c) => c.id === "unknown.styleKey.ignored")!;
    const r = cleanDesign(bad.design, inCatalog());
    expect(r.issues.map((i) => i.at)).toEqual(expect.arrayContaining(["roots.small.style.blur", "roots.small.style.rotate"]));
    expect((r.design!.roots!.small!.style as Record<string, unknown>).pad).toBe(8);
  });

  it("an unknown node draws its fallback, and the sibling survives either way", () => {
    const withFb = cleanDesign(DESIGN_CASES.find((c) => c.id === "unknown.node.usesFallback")!.design, inCatalog());
    expect(withFb.design!.roots!.small!.children).toHaveLength(2);
    const without = cleanDesign(DESIGN_CASES.find((c) => c.id === "unknown.node.noFallbackDrawsNothing")!.design, inCatalog());
    expect(without.design!.roots!.small!.children).toHaveLength(1);
  });
});

describe("the shared activity fixtures", () => {
  for (const c of ACTIVITY.designCases) {
    it(`${String(c.id)}: ${String(c.expect)}`, () => {
      const design = structuredClone(c.design) as NLookDesign;
      const g = c.generate as Record<string, unknown> | undefined;
      if (g?.repeatNode && g.times) {
        design.roots![g.root as "minimal"]!.children = Array.from({ length: Number(g.times) }, () => structuredClone(g.repeatNode) as NLookNodeLike);
      }
      const extra = c.catalogArt ? { art: c.catalogArt as never } : {};
      expect(cleanDesign(design, inCatalog(extra)).verdict).toBe(c.expect);
    });
  }

  it("a region over its node cap keeps the first few rather than losing the region", () => {
    const c = ACTIVITY.designCases.find((x) => x.id === "limit.minimalNodes.clamped")!;
    const design = structuredClone(c.design) as NLookDesign;
    design.roots!.minimal!.children = Array.from({ length: 6 }, () => ({ type: "Text", props: { text: "m" } }));
    const r = cleanDesign(design, inCatalog());
    const count = (n: NLookNodeLike): number => 1 + (n.children ?? []).reduce((t, k) => t + count(k), 0);
    expect(count(r.design!.roots!.minimal! as NLookNodeLike)).toBeLessThanOrEqual(NLOOK_LIMITS.activity.nodesPerRoot.minimal!);
  });
});

describe("the path grammar", () => {
  for (const c of PATHS) {
    it(`${String(c.id)}: ${String(c.expect)}`, () => {
      let d = String(c.d ?? "");
      const g = c.generate as Record<string, unknown> | undefined;
      if (g?.repeat && g.toChars) d = String(g.repeat).repeat(Math.ceil(Number(g.toChars) / String(g.repeat).length));
      if (g?.paths) d = Array.from({ length: Number(g.paths) }, (_, i) => `M ${i} 0 L ${i} 4`).join(" ");
      const r = cleanPathD(d);
      if (c.expect === "dropped") expect(r).toBeNull();
      else {
        expect(r).not.toBeNull();
        if (c.expect === "clamped") expect(r!.cut).toBe(true);
        else expect(r!.cut).toBe(false);
      }
    });
  }
});

describe("the bind table", () => {
  for (const c of BINDS) {
    // The fixtures write a list's field as "needs.items[].question": an index picks WHICH item, so [0] is the same field.
    const path = (typeof c.path === "string" ? c.path : "").replace(/\[\]/g, "[0]");
    if (!path) continue;
    it(`${String(c.id)}: ${String(c.expect)}`, () => {
      const surface = c.surface as "widget" | "activity";
      const inside = typeof c.inside === "string" ? c.inside : null;
      let ok: boolean;
      let sensitive: boolean;
      if (path === "it" || path.startsWith("it.")) {
        const list = inside?.includes("needs.items[].choices") ? "needs.items[].choices"
          : inside?.includes("needs.items") ? "needs.items"
            : inside?.includes("stages") ? "stages" : inside?.includes("bots") ? "bots" : "";
        const info = list ? eachItemInfo(list, path) : null;
        ok = !!info;
        sensitive = info?.sensitive === true;
      } else if (path.startsWith("words.")) {
        ok = bindsOn(path, surface) && wordResolvesOn(path.slice(6), surface);
        sensitive = isSensitivePath(path);
      } else if (c.asTimer === true) {
        // A timer needs a date; pointed at words it draws nothing rather than a nonsense clock.
        ok = false;
        sensitive = false;
      } else {
        ok = bindsOn(path, surface);
        sensitive = isSensitivePath(path);
      }
      expect(ok).toBe(c.expect === "ok");
      if (c.expect === "ok" && c.sensitive !== undefined) expect(sensitive).toBe(c.sensitive === true);
    });
  }

  it("a sensitive mark survives an index and an it., which is the case the whole rule exists for", () => {
    expect(isSensitivePath("needs.items[0].question")).toBe(true);
    expect(eachItemInfo("needs.items", "it.question")?.sensitive).toBe(true);
    expect(isSensitivePath("vars.anything")).toBe(true);
  });
});

// ------------------------------------------------------------------ vars, the private rule and the body

describe("vars", () => {
  it("clamps to the caps and sorts, so the same facts always encode to the same bytes", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ key: `k${String(i).padStart(2, "0")}`, value: "x".repeat(200), safe: true }));
    const out = buildVars(many)!;
    expect(Object.keys(out)).toHaveLength(NLOOK_LIMITS.vars.keys);
    expect(Object.keys(out)).toEqual([...Object.keys(out)].sort());
    for (const v of Object.values(out)) expect(v.length).toBeLessThanOrEqual(NLOOK_LIMITS.vars.valueChars);
  });

  it("leaves an unsafe var out entirely while the thing is private (the server's half of the privacy rule)", () => {
    const vars = [{ key: "eta", value: "8", safe: true }, { key: "quote", value: "what they wrote" }];
    expect(buildVars(vars, { private: false })).toEqual({ eta: "8", quote: "what they wrote" });
    expect(buildVars(vars, { private: true })).toEqual({ eta: "8" });
  });

  it("the widget's and the activity's own vars are numbers the server counted, so both survive a private item", () => {
    const now = 1_763_000_000_000;
    expect(widgetVars({ now, sinceAt: now - 9 * 60_000, moved: 3 }, { private: true })).toEqual({ moved: "3", since: "9" });
    expect(activityVars({ now, startedAt: now - 20 * 60_000, stage: 3, of: 5, phase: "working" }, { private: true })).toEqual({ eta: "20", left: "2" });
  });

  it("no ETA from nothing: a job on its first stage, or one that just started, has none", () => {
    const now = 1_763_000_000_000;
    expect(activityVars({ now, startedAt: now - 20 * 60_000, stage: 1, of: 5, phase: "working" })).toEqual({ left: "4" });
    expect(activityVars({ now, startedAt: now - 10_000, stage: 3, of: 5, phase: "working" })).toEqual({ left: "2" });
    expect(activityVars({ now, startedAt: now - 20 * 60_000, stage: 5, of: 5, phase: "done" })).toBeUndefined();
  });
});

describe("the Live Activity's 3.5 KB", () => {
  const base = {
    bot: "code", botName: "Xode", face: "code", task: "Fix the cart total rounding", stage: 3, of: 5,
    stageName: "Build", stages: ["Read", "Plan", "Build", "Check", "Done"], startedAt: 1_763_000_000_000,
    phase: "working", link: "tulmi://job/j1",
  };

  it("leaves a body that already fits exactly as it was", () => {
    const r = fitActivityBody({ ...base });
    expect(r.gave).toEqual([]);
    expect(r.state).toEqual(base);
  });

  it("gives up vars FIRST, then the stage names, and always ends under the cap", () => {
    const vars = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`key${i}`, "v".repeat(120)]));
    const stages = Array.from({ length: 12 }, () => "s".repeat(200));
    const r = fitActivityBody({ ...base, stages, vars });
    expect(bodyBytes({ ...base, stages, vars })).toBeGreaterThan(ACTIVITY_BODY_BYTES);
    expect(r.gave[0]).toBe("vars");
    expect(r.state).not.toHaveProperty("vars");
    expect(r.bytes).toBeLessThanOrEqual(ACTIVITY_BODY_BYTES);
  });

  it("the worst body the server can legally build still fits (the property every language has to pass)", () => {
    for (const len of [40, 120, 200]) {
      const r = fitActivityBody({
        ...base,
        task: "क".repeat(len), question: "क".repeat(len), result: "क".repeat(len),
        stages: Array.from({ length: 12 }, () => "क".repeat(40)),
        choices: Array.from({ length: 3 }, (_, i) => ({ id: `a${i}`, label: "क".repeat(40) })),
        vars: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, "क".repeat(120)])),
      });
      expect(r.bytes).toBeLessThanOrEqual(ACTIVITY_BODY_BYTES);
      expect(bodyBytes(r.state)).toBeLessThanOrEqual(ACTIVITY_BODY_BYTES);
    }
  });

  it("clamps vars on their own before anything is measured", () => {
    expect(clampVars({ a: "x", ["b".repeat(40)]: "y" })).toEqual({ a: "x", ["b".repeat(NLOOK_LIMITS.vars.keyChars)]: "y" });
    expect(clampVars("nope")).toBeUndefined();
  });
});

// ------------------------------------------------------------------ who gets what

describe("targeting", () => {
  const can = new Set([NLOOK_CAPS.look1]);

  it("names nothing at all while no rule names a design, however many are published", () => {
    expect(pickDesign("widget:x0", { can, platform: "ios", nl: 99 })).toBeNull();
  });

  it("names a design for the surface its rule names, and only for the people it names", () => {
    const cat = structuredClone(CATALOG);
    cat.targets = [{ surface: "widget:x0", design: "x0.dusk", when: { users: ["u1"] } }];
    withCatalog(cat, () => {
      expect(pickDesign("widget:x0", { can, platform: "ios", nl: 99, userId: "u1" })).toBe("x0.dusk");
      expect(pickDesign("widget:x0", { can, platform: "ios", nl: 99, userId: "u2" })).toBeNull();
    });
  });

  it("never names a design the phone cannot hold yet: `since` above its `nl`", () => {
    const cat = structuredClone(CATALOG);
    stampSince(cat, null);
    cat.designs["x0.dusk"]!.since = 9;
    cat.designs["x0.base"]!.since = 1;
    cat.targets = [{ surface: "widget:x0", design: "x0.dusk" }];
    withCatalog(cat, () => {
      // It walks the chain to the one that phone does hold, rather than naming nothing.
      expect(pickDesign("widget:x0", { can, platform: "ios", nl: 2 })).toBe("x0.base");
      expect(pickDesign("widget:x0", { can, platform: "ios", nl: 9 })).toBe("x0.dusk");
    });
  });

  it("never names one this device reported bad", () => {
    const cat = structuredClone(CATALOG);
    stampSince(cat, null);
    cat.targets = [{ surface: "widget:x0", design: "x0.dusk" }];
    withCatalog(cat, () => {
      expect(pickDesign("widget:x0", { can, platform: "ios", nl: 99 })).toBe("x0.dusk");
      expect(pickDesign("widget:x0", { can, platform: "ios", nl: 99, bad: ["x0.dusk"] })).toBe("x0.base");
    });
  });

  it("never names an activity design to Android, nor a board to a build without the kind", () => {
    const cat = structuredClone(CATALOG);
    stampSince(cat, null);
    cat.targets = [{ surface: "activity:bots", design: "bots.night" }, { surface: "widget:board", design: "board.night" }];
    withCatalog(cat, () => {
      expect(pickDesign("activity:bots", { can, platform: "ios", nl: 99 })).toBe("bots.night");
      expect(pickDesign("activity:bots", { can, platform: "android", nl: 99 })).toBeNull();
      expect(pickDesign("widget:board", { can, platform: "ios", nl: 99 })).toBeNull();
      expect(pickDesign("widget:board", { can: new Set([NLOOK_CAPS.look1, NLOOK_CAPS.widgetBoard1]), platform: "ios", nl: 99 })).toBe("board.night");
    });
  });

  it("the glance gains a look only for a build that says it can draw one", () => {
    const cat = structuredClone(CATALOG);
    stampSince(cat, null);
    cat.targets = [{ surface: "widget:x0", design: "x0.dusk" }];
    withCatalog(cat, () => {
      expect(glanceLook({ can: new Set(), platform: "ios", nl: 99 })).toBeNull();
      const look = glanceLook({ can, platform: "ios", nl: 99, vars: { moved: "3" } })!;
      expect(look.look).toEqual({ x0: "x0.dusk" });
      expect(look.palette).toBe("dusk");
      expect(look.vars).toEqual({ moved: "3" });
    });
  });

  it("drawsFormat counts up, and a build that says nothing draws nothing", () => {
    expect(drawsFormat(new Set())).toBe(0);
    expect(drawsFormat(new Set(["NativeLook1"]))).toBe(1);
    expect(drawsFormat(new Set(["NativeLook1", "NativeLook2"]))).toBe(2);
  });

  it("every switch off puts every phone back on its native view", () => {
    const cat = structuredClone(CATALOG);
    stampSince(cat, null);
    cat.targets = [{ surface: "widget:x0", design: "x0.dusk" }];
    withCatalog(cat, () => {
      process.env.NATIVE_LOOKS = "false";
      resetConfigForTests();
      expect(pickDesign("widget:x0", { can, platform: "ios", nl: 99 })).toBeNull();
      expect(glanceLook({ can, platform: "ios", nl: 99 })).toBeNull();
      process.env.NATIVE_LOOKS = "true";
      resetConfigForTests();
    });
  });

  it("there is no ?preview=: a tester is named in a rule's when.users, which reaches all four surfaces", () => {
    const cat = structuredClone(CATALOG);
    stampSince(cat, null);
    cat.targets = [
      { surface: "widget:x0", design: "x0.dusk", when: { users: ["tester"] } },
      { surface: "activity:bots", design: "bots.night", when: { users: ["tester"] } },
      { surface: "notice:bots", design: "bu.base", when: { users: ["tester"] } },
      { surface: "widget:board", design: "board.night", when: { users: ["tester"] } },
    ];
    withCatalog(cat, () => {
      const all = new Set([NLOOK_CAPS.look1, NLOOK_CAPS.widgetBoard1, NLOOK_CAPS.liveUpdate1]);
      for (const s of ["widget:x0", "activity:bots"] as const) expect(pickDesign(s, { can: all, platform: "ios", nl: 99, userId: "tester" })).toBeTruthy();
      for (const s of ["widget:board", "notice:bots"] as const) expect(pickDesign(s, { can: all, platform: "android", nl: 99, userId: "tester" })).toBeTruthy();
      // And nobody else, on any surface. There is no option on the request that could change that.
      for (const s of ["widget:x0", "widget:board", "activity:bots", "notice:bots"] as const) {
        expect(pickDesign(s, { can: all, platform: "ios", nl: 99, userId: "someone-else" } as never)).toBeNull();
      }
      // An older caller's `preview` is just an unknown key now: it cannot name anything.
      expect(pickDesign("widget:x0", { can: all, platform: "ios", nl: 99, preview: "x0.dusk" } as never)).toBeNull();
    });
  });

  it("the glance names `bots`: the Live Activity's design on iOS, the notice's on Android", () => {
    const cat = structuredClone(CATALOG);
    stampSince(cat, null);
    cat.targets = [
      { surface: "widget:x0", design: "x0.dusk" },
      { surface: "activity:bots", design: "bots.night" },
      { surface: "notice:bots", design: "bu.base" },
    ];
    withCatalog(cat, () => {
      const withLive = new Set([NLOOK_CAPS.look1, NLOOK_CAPS.liveUpdate1]);
      expect(glanceLook({ can, platform: "ios", nl: 99 })!.look!.bots).toBe("bots.night");
      expect(glanceLook({ can: withLive, platform: "android", nl: 99 })!.look!.bots).toBe("bu.base");
      // Android without LiveUpdate1 has nothing to draw the notice with, so it is not named one.
      expect(glanceLook({ can, platform: "android", nl: 99 })!.look!.bots).toBeUndefined();
      // Each switch turns its own surface off, and the widgets' design is untouched either way.
      process.env.NATIVE_ACTIVITY = "false";
      process.env.ANDROID_BOTS_NOTICE = "false";
      resetConfigForTests();
      expect(glanceLook({ can, platform: "ios", nl: 99 })!.look!.bots).toBeUndefined();
      expect(glanceLook({ can: withLive, platform: "android", nl: 99 })!.look!.bots).toBeUndefined();
      expect(glanceLook({ can, platform: "ios", nl: 99 })!.look!.x0).toBe("x0.dusk");
      process.env.NATIVE_ACTIVITY = "true";
      process.env.ANDROID_BOTS_NOTICE = "true";
// A control volume of this file's own: the high-water mark is a FILE, and a suite that shared /data/control with another
// would read a number that suite's pushes left behind (and then serve the repo's catalog under a bumped v).
process.env.CONTROL_DIR = mkdtempSync(join(tmpdir(), "tailzu-native-looks-"));
      resetConfigForTests();
    });
  });

  it("the glance's pick and the Activity's push agree for the same person, nl and bad list", () => {
    const cat = structuredClone(CATALOG);
    stampSince(cat, null);
    cat.targets = [{ surface: "activity:bots", design: "bots.night" }];
    withCatalog(cat, () => {
      // An Activity PUSH has no request to ask on, so it asks target.ts itself. The two must not drift.
      const fromGlance = glanceLook({ can, platform: "ios", nl: 99, bad: ["bots.night"] })?.look?.bots ?? null;
      const fromPush = activityLookFor("u1", 99, ["bots.night"]);
      expect(fromGlance).toBe(fromPush);
      expect(fromPush).toBe("bots.base");
      // Without the bad list the push would name the design the person has already told us kills their widgets.
      expect(activityLookFor("u1", 99)).toBe("bots.night");
    });
  });

  it("the glance lists the boards the X0 Board widget offers, named, and never board.base", () => {
    const cat = structuredClone(CATALOG);
    stampSince(cat, null);
    cat.targets = [
      { surface: "widget:board", design: "board.base" },
      { surface: "widget:board", design: "board.night" },
      { surface: "widget:x0", design: "x0.base" },
    ];
    withCatalog(cat, () => {
      const board = new Set([NLOOK_CAPS.look1, NLOOK_CAPS.widgetBoard1]);
      const named = (id: string) => (id === "board.night" ? "Tonight" : null);
      expect(glanceLook({ can: board, platform: "ios", nl: 99, boardName: named })!.boards).toEqual([{ id: "board.night", name: "Tonight" }]);
      // A board with no name in this language is not offered: nobody makes a name out of an id.
      expect(glanceLook({ can: board, platform: "ios", nl: 99, boardName: () => null })!.boards).toBeUndefined();
      // A build without the kind has no widget to draw a board in, so it is sent no list at all.
      expect(glanceLook({ can, platform: "ios", nl: 99, boardName: named })!.boards).toBeUndefined();
    });
  });

  it("the picker offers only the boards a rule reaches THIS person: a tester's board is not in anyone else's list", () => {
    const cat = structuredClone(CATALOG);
    stampSince(cat, null);
    // The plain x0 rule reaches everyone, so everyone's phone HOLDS the whole catalog, board.night included. Only the
    // rules decide who may be offered it.
    cat.targets = [
      { surface: "widget:x0", design: "x0.base" },
      { surface: "widget:board", design: "board.night", when: { users: ["tester"] } },
    ];
    withCatalog(cat, () => {
      const board = new Set([NLOOK_CAPS.look1, NLOOK_CAPS.widgetBoard1]);
      const named = () => "Tonight";
      const listFor = (userId?: string) => glanceLook({ can: board, platform: "ios", nl: 99, userId, boardName: named })?.boards;
      expect(listFor("tester")).toEqual([{ id: "board.night", name: "Tonight" }]);
      // pickDesign already answered null here; the list must say the same thing.
      expect(pickDesign("widget:board", { can: board, platform: "ios", userId: "someone", nl: 99 })).toBeNull();
      expect(listFor("someone")).toBeUndefined();
      expect(listFor()).toBeUndefined();
    });
  });

  it("a design with no `since` counts as the catalog's own v: the normal publish path stamps none", () => {
    // The admin PUT stamps `since`; editing looks.json, raising v and deploying never does. Reading a missing one as 0
    // would skip rule 2 entirely on the path we actually publish by, and name designs a phone has not downloaded.
    const cat = structuredClone(CATALOG);
    for (const d of Object.values(cat.designs)) delete (d as { since?: number }).since;
    cat.targets = [{ surface: "widget:x0", design: "x0.dusk" }];
    withCatalog(cat, () => {
      expect(pickDesign("widget:x0", { can, platform: "ios", nl: cat.v - 1 })).toBeNull();
      expect(pickDesign("widget:x0", { can, platform: "ios" })).toBeNull();
      expect(pickDesign("widget:x0", { can, platform: "ios", nl: cat.v })).toBe("x0.dusk");
    });
  });

  it("the bootstrap names a catalog only for someone a rule could reach", () => {
    const cat = structuredClone(CATALOG);
    stampSince(cat, null);
    cat.targets = [];
    withCatalog(cat, () => {
      // With `targets` empty, turning the master switch on must start the phone's sync on NOBODY: that sync fetches the
      // catalog, fetches art and draws bot stills, all for a design no one is ever shown.
      expect(nativeLooksFlags()).toEqual({});
      expect(nativeLooksFlags("u1")).toEqual({});
    });
    cat.targets = [{ surface: "widget:x0", design: "x0.dusk", when: { users: ["u1"] } }];
    withCatalog(cat, () => {
      expect(nativeLooksFlags("u1")["native.looks"]).toMatchObject({ v: cat.v });
      expect(nativeLooksFlags("u2")).toEqual({});
      expect(nativeLooksFlags()).toEqual({});
    });
    cat.targets = [{ surface: "widget:x0", design: "x0.base" }];
    withCatalog(cat, () => {
      // A plain rule reaches everyone, so everyone syncs.
      expect(nativeLooksFlags("u2")["native.looks"]).toMatchObject({ v: cat.v });
    });
  });

  it("the activity switch turns activity designs off on their own", () => {
    const cat = structuredClone(CATALOG);
    stampSince(cat, null);
    cat.targets = [{ surface: "activity:bots", design: "bots.night" }, { surface: "widget:x0", design: "x0.dusk" }];
    withCatalog(cat, () => {
      process.env.NATIVE_ACTIVITY = "false";
      resetConfigForTests();
      expect(pickDesign("activity:bots", { can, platform: "ios", nl: 99 })).toBeNull();
      expect(pickDesign("widget:x0", { can, platform: "ios", nl: 99 })).toBe("x0.dusk");
      process.env.NATIVE_ACTIVITY = "true";
      resetConfigForTests();
    });
  });
});

// ------------------------------------------------------------------ the nudge, and the files a catalog names

describe("the catalog nudge", () => {
  const phonesOf = (n: number) => Array.from({ length: n }, (_, i) => ({
    userId: i < 2 ? "u1" : `u${i}`, token: `t${i}`, platform: (i % 2 ? "ios" : "android") as "ios" | "android",
  }));

  it("tells NativeLook1 phones a new catalog is out, silently, at normal priority", async () => {
    const cat = structuredClone(CATALOG);
    stampSince(cat, null);
    cat.targets = [{ surface: "widget:x0", design: "x0.base" }];
    let sent: Record<string, unknown>[] = [];
    let askedFor = "";
    await withCatalogAsync(cat, async () => {
      const r = await nudgeLooks(7, {
        phones: async (capability) => { askedFor = capability; return phonesOf(3); },
        send: async (m) => { sent = m as unknown as Record<string, unknown>[]; },
        wait: async () => undefined,
      });
      expect(r).toMatchObject({ sent: 3, batches: 1 });
    });
    expect(askedFor).toBe(NLOOK_CAPS.look1);
    // Nothing of the person travels in it: the kind and the version, and nothing else.
    expect(sent[0]!.data).toEqual({ kind: "native.looks", v: 7 });
    expect(sent.every((m) => m.title === "" && m.body === "" && m.priority === "normal")).toBe(true);
    // Android takes a data-only message; iOS takes a content-available one, which Apple requires at priority 5.
    expect(sent.filter((m) => m.dataOnly).length).toBe(2);
    expect(sent.filter((m) => m.contentAvailable).length).toBe(1);
  });

  it("nudges only the people a rule names while every rule names its own, and nobody at all with no rule", async () => {
    const cat = structuredClone(CATALOG);
    stampSince(cat, null);
    cat.targets = [{ surface: "widget:x0", design: "x0.base", when: { users: ["u1"] } }];
    await withCatalogAsync(cat, async () => {
      let only: ReadonlySet<string> | undefined;
      await nudgeLooks(7, { phones: async (_c, o) => { only = o; return []; }, send: async () => undefined, wait: async () => undefined });
      expect([...(only ?? [])]).toEqual(["u1"]);
    });
    cat.targets = [];
    await withCatalogAsync(cat, async () => {
      const r = await nudgeLooks(7, { phones: async () => phonesOf(3), send: async () => undefined, wait: async () => undefined });
      expect(r).toMatchObject({ sent: 0, skipped: "no rule names a design" });
    });
  });

  it("sends nothing while the switch is off", async () => {
    process.env.NATIVE_LOOKS = "false";
    resetConfigForTests();
    const r = await nudgeLooks(7, { phones: async () => phonesOf(3), send: async () => undefined, wait: async () => undefined });
    expect(r.sent).toBe(0);
    process.env.NATIVE_LOOKS = "true";
    resetConfigForTests();
  });
});

describe("the files a catalog names", () => {
  it("refuses a catalog whose art is not on disk under its own hash", () => {
    const cat = structuredClone(CATALOG) as NLookCatalog & { art?: unknown };
    cat.art = [{ key: "dusk.sky", w: 600, h: 400, files: [{ scale: 2, sha256: "a".repeat(64), bytes: 1000 }] }];
    const errs = checkNativeLooks(cat);
    // The hot path cannot add a file: a design whose art is new needs a PR and a deploy, which is the price of serving
    // art from the image. A catalog that named a file nobody has would draw holes on Home Screens.
    expect(errs.some((e) => e.includes("no file at shared/native/art/"))).toBe(true);
  });

  it("refuses one hash for several scales: the @2 and @3 files are different bytes", () => {
    const cat = structuredClone(CATALOG) as NLookCatalog & { art?: unknown };
    // The old shape. The phone checks every downloaded scale against the entry's one hash, so at most one could pass and
    // the others were refused as bad_sha and silently drew their alt.
    cat.art = [{ key: "dusk.sky", sha256: "a".repeat(64), w: 600, h: 400, bytes: 1000, scales: [2, 3] }];
    expect(checkNativeLooks(cat).some((e) => e.includes("files is one entry per scale"))).toBe(true);
  });

  it("every file in shared/native/art and /fonts is named by its own hash", () => {
    for (const kind of ["art", "fonts"] as const) {
      const dir = nativeFilesDir(kind);
      if (!dir) continue;
      for (const name of readdirSync(dir).filter((f) => !f.startsWith("."))) {
        const sha = createHash("sha256").update(readFileSync(resolve(dir, name))).digest("hex");
        // Art carries its scale; a font is the bare hash with no extension, because that is what the phone asks for.
        expect(name).toBe(kind === "art" ? `${sha}@${/@([123])\.png$/.exec(name)?.[1] ?? "?"}.png` : sha);
      }
    }
  });
});

// ------------------------------------------------------------------ keyboard skins

describe("keyboard skins", () => {
  const SKIN = JSON.parse(readFileSync(resolve(SHARED, "skins/clay-dusk.json"), "utf8")) as Record<string, unknown>;

  const tree = (): KeyboardConfigResponse => ({
    schemaVersion: 3,
    theme: { background: "#000", key: "#111", keyText: "#fff", accent: "#fff", keyPressed: "#222" },
    layouts: [{ language: "en", rows: [["a"]] }],
    features: { voice: true, refine: true, streaming: true, sdui: true },
    labels: {},
    root: { type: "Container", children: [{ type: "Row", children: [{ type: "LetterKey", props: { char: "a" } }, { type: "SpaceKey" }] }] },
  });

  it("the shipped skin passes its own check", () => {
    expect(checkSkin(SKIN)).toEqual([]);
  });

  it("refuses, never quietly cleans, anything that would change what a key does (4.4.1)", () => {
    for (const bad of [{ faces: { all: { label: "a", on: { onPress: { kind: "openUrl" } } } } }, { faces: { chars: { a: { rows: [["q"]] } } } }, { faces: { all: { callEndpoint: "/x" } } }]) {
      expect(checkSkin({ ...SKIN, ...bad }).length).toBeGreaterThan(0);
    }
  });

  it("refuses art that is not in the manifest, because drawing it would mean a fetch during a session", () => {
    const sha = "a".repeat(64);
    expect(checkSkin({ ...SKIN, faces: { all: { art: `${sha}@3.png` } }, manifest: { art: [] } }).some((e) => e.includes("not in manifest.art"))).toBe(true);
    // In the manifest is not enough: the file must BE on disk under that hash, exactly as a catalog's art must. A name
    // nobody has would be fetched, fail, and leave a flat key for the session.
    expect(checkSkin({ ...SKIN, faces: { all: { art: `${sha}@3.png` } }, manifest: { art: [`${sha}@3.png`] } }))
      .toEqual([`manifest.art "${sha}@3.png": no file at shared/native/art/${sha}@3.png`]);
  });

  it("art is the BARE manifest name: a URL is refused even when it names our own host", () => {
    const sha = "a".repeat(64);
    const manifest = { art: [`${sha}@3.png`] };
    // The lint once kept only the last `/` segment, so this passed the check and was then silently dropped by both phones.
    for (const art of [`url:https://api.x0bot.com/v1/native/art/${sha}@3.png`, `https://cdn.example.net/${sha}@3.png`, `art/${sha}@3.png`]) {
      expect(checkSkin({ ...SKIN, faces: { all: { art } }, manifest }).length).toBeGreaterThan(0);
    }
  });

  it("an icon is sf, asset or emoji: there is no url form", () => {
    expect(checkSkin({ ...SKIN, faces: { all: { label: "a", icon: { url: "https://api.x0bot.com/key.png" } } } }).length).toBeGreaterThan(0);
    expect(checkSkin({ ...SKIN, faces: { all: { label: "a", icon: { sf: "mic" } } } })).toEqual([]);
  });

  // Every face case in the shared fixture, through the one function that decides. The fixture is the contract both
  // phones' renderers read too: a case it marks "dropped" that this accepts is a hole.
  for (const c of FACES.faceCases) {
    it(`face ${String(c.id)}: ${String(c.expect)}`, () => {
      const errs = checkSkin({ ...SKIN, faces: { all: c.face }, manifest: (c.manifest as Record<string, unknown>) ?? { art: [], fonts: [] } });
      // The fixture's art hashes are made up, so a case about the SHAPE of a face is read without the on-disk rule.
      const shape = errs.filter((e) => !e.includes("no file at shared/native/art/"));
      if (c.expect === "ok") expect(shape).toEqual([]);
      else expect(shape.length).toBeGreaterThan(0);
    });
  }

  it("a skin may set only the callout and accent-tray flags: never where a link goes or when a letter is typed", () => {
    // The first law. A skin that could set kb.deepLink.urlTemplate, kb.deepLink.openUrlSchemes or
    // kb.keyPlane.commitOnDown would change what a key DOES, which is a 4.4.1 problem and not a look.
    const bad = { "kb.deepLink.urlTemplate": "otherapp://x?q={q}", "kb.deepLink.openUrlSchemes": ["https", "otherapp"], "kb.keyPlane.commitOnDown": false };
    expect(checkSkin({ ...SKIN, flags: { ...SKIN.flags as object, ...bad } }).length).toBe(3);
    expect(checkSkin({ ...SKIN, flags: { "kb.callout.radius": 10, "kb.accentTray.radius": 10 } })).toEqual([]);
    process.env.KEYBOARD_SKINS = "true";
    resetConfigForTests();
    // And again where the tree is built, from the same list: nothing but the two prefixes reaches a keyboard.
    const out = withKeySkin({ ...tree(), flags: { "kb.keyPlane.commitOnDown": true } } as KeyboardConfigResponse, { can: new Set([KEY_SKIN_1]), skin: "clay-dusk" });
    expect(out.flags!["kb.keyPlane.commitOnDown"]).toBe(true);
    expect(out.flags!["kb.callout.radius"]).toBe(10);
  });

  it("refuses an action anywhere in a skin, not only inside a face", () => {
    const on = { kind: "callEndpoint", url: "https://elsewhere.example/x" };
    for (const bad of [{ press: { kind: "pop", on } }, { theme: { dark: { on } } }, { flags: { "kb.callout.on": on } }]) {
      expect(checkSkin({ ...SKIN, ...bad }).length).toBeGreaterThan(0);
    }
  });

  it("a press block travels as kind, ms and the numbers its kind uses, and nothing else", () => {
    const out = cleanPress({ kind: "pop", ms: 140, scale: 1.08, dy: -2, ease: "spring", on: { kind: "callEndpoint" } } as never);
    expect(Object.keys(out!).sort()).toEqual(["dy", "ease", "kind", "ms", "scale"]);
  });

  it("a theme carries the keyboard's own colour keys and nothing else", () => {
    expect(checkSkin({ ...SKIN, theme: { dark: { key: "notacolour" } } }).length).toBeGreaterThan(0);
    expect(checkSkin({ ...SKIN, theme: { dark: { layouts: [] } } }).length).toBeGreaterThan(0);
  });

  it("a face vocabulary is closed, and every value in it is bounded", () => {
    for (const face of [
      { color: "notacolour" }, { font: "comic" }, { layer: "sideways" }, { subPos: "middle" },
      { opacity: 2 }, { label: "x".repeat(40) }, { mark: { viewBox: [0, 0, 48, 48], shapes: [{ kind: "blob" }] } },
      { program: { "r.cx": "press.x" } },
    ]) {
      expect(checkSkin({ ...SKIN, faces: { all: { label: "a", ...face } } }).length).toBeGreaterThan(0);
    }
  });

  it("a hooked font is named in the manifest, and its sha is 64 hex characters", () => {
    expect(checkSkin({ ...SKIN, manifest: { art: [], fonts: [{ id: "clay", sha256: "not-a-hash" }] } })
      .some((e) => e.includes("sha256 is 64 hex characters"))).toBe(true);
  });

  it("expands nothing at all while the switch is off: the same object, byte for byte", () => {
    process.env.KEYBOARD_SKINS = "false";
    resetConfigForTests();
    const cfg = tree();
    expect(withKeySkin(cfg, { can: new Set([KEY_SKIN_1]), skin: "clay-dusk" })).toBe(cfg);
    expect(skinChoices()).toEqual([]);
  });

  it("expands nothing for a build that cannot draw faces, or for a device that reported the skin bad", () => {
    process.env.KEYBOARD_SKINS = "true";
    resetConfigForTests();
    const cfg = tree();
    expect(withKeySkin(cfg, { can: new Set(), skin: "clay-dusk" })).toBe(cfg);
    expect(withKeySkin(cfg, { can: new Set([KEY_SKIN_1]), skin: "clay-dusk", bad: "clay-dusk" })).toBe(cfg);
    expect(withKeySkin(cfg, { can: new Set([KEY_SKIN_1]), skin: "nothing-like-this" })).toBe(cfg);
  });

  it("prints on the keys of a build that said KeySkin1, and the expanded tree carries no action of any kind", () => {
    process.env.KEYBOARD_SKINS = "true";
    resetConfigForTests();
    const out = withKeySkin(tree(), { can: new Set([KEY_SKIN_1]), skin: "clay-dusk" });
    expect(out.skin?.id).toBe("clay-dusk");
    expect(out.skin?.sha).toMatch(/^[0-9a-f]{16}$/);
    const row = out.root!.children![0]!;
    const a = row.children![0]!;
    expect((a.props as { face?: { sub?: string } }).face?.sub).toBe("à");
    expect((a.style as { fontFamily?: string }).fontFamily).toBe("brand");
    expect((a.style as { press?: { kind?: string } }).press?.kind).toBe("pop");
    const json = JSON.stringify(out.root);
    for (const forbidden of ['"on":', '"actions":', '"callEndpoint":', '"rows":']) expect(json).not.toContain(forbidden);
    // The themes carry the skin's colours for BOTH appearances, so a phone that follows the system still gets the skin.
    expect(out.themeDark?.key).toBe("#2A211C");
    expect(out.themeLight?.key).toBe("#FFFDFA");
  });

  it("the picker lists what this release has, with the words it shows", () => {
    process.env.KEYBOARD_SKINS = "true";
    resetConfigForTests();
    expect(skinChoices()).toEqual([{ id: "clay-dusk", label: "Clay dusk", blurb: expect.any(String), dark: true }]);
  });

  // A press as it may travel: the shared fixture's cases, through the one function that decides.
  for (const c of FACES.pressCases) {
    it(`press ${String(c.id)}: ${String(c.expect)}`, () => {
      const press = c.press as { kind: string; ms?: number; scale?: number; dy?: number };
      const out = cleanPress(press as never);
      if (press.kind === "shatter") {
        // An unknown kind never leaves the server at all, so the phone falls back to fade without being told to.
        expect(out).toBeUndefined();
        return;
      }
      // Every number is written out, clamped, so no phone default ever decides how a skin looks.
      expect(out!.ms).toBe(Math.min(press.ms ?? 140, KEY_FACE_LIMITS.press.maxMs));
      if (press.kind === "pop") {
        expect(out!.scale).toBe(Math.min(Math.max(press.scale ?? 1.08, KEY_FACE_LIMITS.press.scale.min), KEY_FACE_LIMITS.press.scale.max));
        expect(out!.dy).toBe(Math.min(Math.max(press.dy ?? 0, KEY_FACE_LIMITS.press.dy.min), KEY_FACE_LIMITS.press.dy.max));
      } else {
        // Only pop reads scale and dy, so the other kinds carry exactly what the author wrote plus the ms.
        expect(out!.kind).toBe(press.kind);
      }
      // What `checkSkin` would have said about the same block: a clamped case is one the publish check refuses outright.
      const errs = checkSkin({ ...SKIN, press });
      expect(errs.length > 0).toBe(c.expect === "clamped" && String(c.id) !== "press.pop.defaultsWritten");
    });
  }
});

// ------------------------------------------------------------------ small guards

// ------------------------------------------------------------------ what the publish check must refuse

describe("the publish check", () => {
  /** A design that `cleanDesign` would only CLAMP: every one of these rode out to phones in the raw catalog. */
  const evil = (): NLookDesign => ({
    id: "x0.evil", format: 1, surface: "widget", palette: Object.keys(CATALOG.palettes)[0],
    roots: { small: { type: "V", children: [
      { type: "Button", props: { open: "https://evil.example/phish" }, children: [{ type: "Text", props: { text: "go" } }] },
      { type: "Image", props: { src: "https://tracker.example/p.png", alt: "https://tracker.example/q.png" } },
      { type: "Blink" },
      { type: "Text", props: { text: "x".repeat(1000), font: "comic" } },
    ] } },
  } as unknown as NLookDesign);

  it("refuses a design it would only CLAMP, because what is SERVED is the design as written", () => {
    const cat = structuredClone(CATALOG);
    cat.designs["x0.evil"] = evil();
    const errs = checkNativeLooks(cat);
    // project() hands out the catalog's own objects, never cleanDesign's copy, so every one of these would reach a phone.
    expect(errs.some((e) => e.includes("a link opens only"))).toBe(true);
    expect(errs.some((e) => e.includes('unknown node type "Blink"'))).toBe(true);
    expect(errs.some((e) => e.includes("unknown type token"))).toBe(true);
    // The alt becomes the src when the src is refused, so it is held to the same rule.
    expect(errs.some((e) => e.includes("props.alt"))).toBe(true);
  });

  it("measures the per-design byte cap on the design AS WRITTEN, not on the cleaned copy", () => {
    const cat = structuredClone(CATALOG);
    const big = structuredClone(cat.designs["x0.base"]!) as NLookDesign & { junk?: string };
    big.id = "x0.big";
    big.junk = "y".repeat(30_000); // dropped by cleanDesign, served by project()
    cat.designs["x0.big"] = big;
    expect(checkNativeLooks(cat).some((e) => e.includes("bytes as written"))).toBe(true);
  });

  it("checks the targeting rules: a missing design, the wrong surface, and `users` written as a word", () => {
    const cat = structuredClone(CATALOG);
    cat.targets = [{ surface: "widget:x0", design: "x0.typo" }];
    expect(checkNativeLooks(cat).some((e) => e.includes('no design called "x0.typo"'))).toBe(true);
    cat.targets = [{ surface: "widget:x0", design: "bots.base" }];
    expect(checkNativeLooks(cat).some((e) => e.includes("is a activity design"))).toBe(true);
    cat.targets = [{ surface: "nowhere", design: "x0.base" } as never];
    expect(checkNativeLooks(cat).some((e) => e.includes("targets[0].surface"))).toBe(true);
    // A string is substring-matched by includes, so "abc" would reach the account "b".
    cat.targets = [{ surface: "widget:x0", design: "x0.base", when: { users: "abc" } } as never];
    expect(checkNativeLooks(cat).some((e) => e.includes("a list of account ids"))).toBe(true);
    cat.targets = [{ surface: "widget:x0", design: "x0.base", when: { users: ["abc"] } }];
    expect(checkNativeLooks(cat).filter((e) => e.startsWith("targets"))).toEqual([]);
  });

  it("a `when.users` written as a word reaches nobody, rather than everyone whose id is inside it", () => {
    const cat = structuredClone(CATALOG);
    stampSince(cat, null);
    cat.targets = [{ surface: "widget:x0", design: "x0.dusk", when: { users: "abc" } } as never];
    withCatalog(cat, () => {
      const only = new Set([NLOOK_CAPS.look1]);
      expect(pickDesign("widget:x0", { can: only, platform: "ios", userId: "b", nl: 99 })).toBeNull();
      expect(nativeLooksFlags("b")).toEqual({});
    });
  });
});

describe("the small rules", () => {
  it("a link opens only our own scheme or the one https shape", () => {
    expect(isAllowedLink("tulmi://home")).toBe(true);
    expect(isAllowedLink("https://github.com/tailzu/app/pull/1")).toBe(true);
    expect(isAllowedLink("shortcuts://run?name=pay")).toBe(false);
    expect(isAllowedLink("https://example.com")).toBe(false);
  });

  it("a colour is a hex, a role, a bot's own ink, or one of those with an alpha", () => {
    for (const ok of ["#0A0A0A", "#0A0A0ACC", "ink@0.6", "$color", "$bot.code", "paper", "outline", "hollow@0.5"]) expect(isColour(ok)).toBe(true);
    for (const no of ["midnight", "rgb(0,0,0)", "ink@2", "#GGG"]) expect(isColour(no)).toBe(false);
  });

  it("the catalog on disk is the one that is served", () => {
    expect(activeNativeLooks()?.v).toBe(CATALOG.v);
  });
});

// ------------------------------------------------------------------ the file's own style, and the one Bar rule

describe("looks.json is kept in one style", () => {
  // The catalog is pretty-printed down to the node and compacted where a node fits. Pinning it here means the NEXT edit is
  // ten lines, not another whole-file reformat, and a hand edit in some other style fails with an instruction rather than a
  // review comment.
  it("the file already equals the formatter's output", () => {
    const raw = readFileSync(resolve(SHARED, "looks.json"), "utf8");
    expect(formatCatalog(JSON.parse(raw) as unknown)).toBe(raw);
  });

  it("the formatter is pure: the same object gives the same bytes", () => {
    const obj = JSON.parse(readFileSync(resolve(SHARED, "looks.json"), "utf8")) as unknown;
    expect(formatCatalog(obj)).toBe(formatCatalog(JSON.parse(JSON.stringify(obj)) as unknown));
  });
});

describe("the Bar rule: segments, and names only on an exact match", () => {
  type BarCase = {
    root: string;
    data: Record<string, unknown>;
    names: Array<{ name: string; role: string }> | null;
  };
  /** The label row the preview draws, in order: one entry per stage name, with its weight and its colour. */
  const labelsIn = (html: string): Array<{ weight: string; colour: string; name: string }> =>
    [...html.matchAll(/font-weight:(\d+);line-height:14px;color:([^;"]+)[^>]*>([^<]*)</g)]
      .map((m) => ({ weight: m[1]!, colour: m[2]!, name: m[3]! }));

  const drawn = (id: string): { html: string; bar: BarCase } => {
    const c = DESIGN_CASES.find((x) => x.id === id)!;
    const bar = c.bar as BarCase;
    const design = cleanDesign(structuredClone(c.design), inCatalog()).design!;
    const size = ROOT_SIZES[bar.root]!;
    const html = renderRoot({
      design, root: bar.root, palette: CATALOG.palettes.ink!, scheme: "dark",
      data: bar.data, width: size.w, height: size.h,
    });
    return { html, bar };
  };

  it("exactly `of` names: the names are drawn, done / current / to come", () => {
    const { html, bar } = drawn("ok.bar.segments.names");
    const dark = CATALOG.palettes.ink!.dark as unknown as Record<string, string>;
    expect(labelsIn(html)).toEqual(bar.names!.map((n) => ({
      weight: n.role === "ink" ? "600" : "400",
      colour: dark[n.role]!,
      name: n.name,
    })));
  });

  it("the wrong number of names: segments alone, never a half-labelled bar", () => {
    const { html } = drawn("bar.segments.count.mismatch");
    expect(labelsIn(html)).toEqual([]);
    expect(html).not.toContain("Read");
  });

  it("`of` is clamped to 8, so a long job draws eight segments and not a hairline each", () => {
    const c = DESIGN_CASES.find((x) => x.id === "ok.bar.segments.names")!;
    const design = cleanDesign(structuredClone(c.design), inCatalog()).design!;
    const size = ROOT_SIZES.medium!;
    const html = renderRoot({
      design, root: "medium", palette: CATALOG.palettes.ink!, scheme: "dark",
      data: { case: "working", job: { stage: 11, of: 12, stages: [], phase: "working" } },
      width: size.w, height: size.h,
    });
    expect([...html.matchAll(/flex:1 1 0;border-radius:inherit/g)]).toHaveLength(8);
  });
});

// ------------------------------------------------------------------ helpers

type NLookNodeLike = { type: string; props?: Record<string, unknown>; children?: NLookNodeLike[] };

/** The same, for a test that awaits inside it. */
async function withCatalogAsync(cat: NLookCatalog, fn: () => Promise<void>): Promise<void> {
  try {
    setNativeLooksForTests(cat);
    await fn();
  } finally {
    resetNativeLooksForTests();
  }
}

/** Run with a catalog of our own in place of the file's. Nothing is written to the repo: the loader is handed the object. */
function withCatalog(cat: NLookCatalog, fn: () => void): void {
  try {
    setNativeLooksForTests(cat);
    fn();
  } finally {
    resetNativeLooksForTests();
  }
}
