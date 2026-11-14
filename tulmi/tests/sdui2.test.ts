/**
 * THE SERVER SIDE OF THE PURE RENDERER (experience/sdui2; pure/SPEC.md 2.12, 5.1).
 *
 * The publish gate refuses what the device would refuse — a bad expression, a screen over a limit, a path that
 * climbs out of /v1/, a `local` key that reads like a secret, a block used without being declared — and the gate
 * serves a vocabulary-2 screen only to a client that holds every block it needs, with the short "open X0 again"
 * or "update X0" screen for everyone else. Today's screens pass through untouched, which is what the last
 * describe here is for.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.OPENROUTER_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
});

import type { Node, ScreenResponse } from "../../shared/types/sdui.js";
import { resetConfigForTests } from "../src/config.js";
import { lintScreen } from "../src/experience/sdui2/lint.js";
import { PHONE_RUNTIME, clientVocab, gateScreen, serveScreen, sduiV2Live, waitingScreen } from "../src/experience/sdui2/gate.js";
import { each, input, list, slot, use, v, t, cond, when, vocab2 } from "../src/experience/sdui2/build.js";
import { lintTree } from "../src/experience/bots/lint.js";
import { buildBotsScreen } from "../src/experience/bots/index.js";
import { fakeDeps, IST } from "../src/experience/bots/fixtures.js";

// ===================================================================== helpers

const stack = (children: Node[]): Node => ({ type: "Stack", style: { flexDirection: "column" }, children });

const screen = (root: Node, over: Partial<ScreenResponse> = {}): ScreenResponse =>
  ({ schemaVersion: 1, screenId: "t.one", root, ...over });

/** A screen built the way a page is: the kit's wrapper around a scrolling body. */
const page = (body: Node[], over: Partial<ScreenResponse> = {}): ScreenResponse => screen({
  type: "SafeArea",
  style: { flex: 1, flexDirection: "column" },
  children: [{ type: "Screen", style: { flexDirection: "column" }, children: body }],
}, over);

const v2 = (userId = "u1"): void => {
  process.env.SDUI_V2 = "true";
  process.env.SDUI_V2_USERS = "";
  resetConfigForTests();
  void userId;
};
const v2off = (): void => { delete process.env.SDUI_V2; delete process.env.SDUI_V2_USERS; resetConfigForTests(); };

const phone = (blocks: string[], runtime = PHONE_RUNTIME) =>
  clientVocab({ vocab: 2, blocks, runtime, platform: "ios" }, { client: "phone", userId: "u1" });

// ===================================================================== lint

describe("the publish gate compiles a screen the way the device does", () => {
  it("a good screen passes, and says which blocks it needs", () => {
    const r = lintScreen(page([
      { type: "Text", props: { content: t("{{ count(state.done) }} of {{ count(state.items) }} done") } },
      { type: "Stack", style: { opacity: v("state.busy ? 0.4 : 1") } },
    ], { needs: ["expr"] }));
    expect(r.errors).toEqual([]);
    expect(r.needs).toEqual(["expr"]);
    expect(r.counts.exprs).toBe(2);
  });

  it("every block the tree uses is worked out, in SDUI_BLOCKS order", () => {
    const r = lintScreen(page([
      list({ data: v("state.feed"), item: use("row", { row: v("item") }) }),
      input({ kind: "code", length: 6 }, { value: "code" }),
      { type: "Stack", style: { boxShadow: "0 4 12 0 rgba(0,0,0,.2)" } },
      { type: "Text", props: { content: "x" }, visibleIf: cond("device.keyboard.enabled && !local.dismissed") },
    ], {
      needs: ["expr", "defs", "device", "local", "paint", "list", "input"],
      defs: { row: { params: ["row"], root: { type: "Text", props: { content: v("args.row.name") } } } },
    }));
    expect(r.errors).toEqual([]);
    expect(r.needs).toEqual(["expr", "defs", "device", "local", "paint", "list", "input"]);
  });

  it("refuses a block the screen uses and did not declare", () => {
    const r = lintScreen(page([each({ data: v("state.rows"), item: { type: "Text", props: { content: "x" } } })], { needs: ["expr"] }));
    expect(r.errors.join(" ")).toContain('uses the "list" block and does not say it needs it');
  });

  it("refuses a block name no build will ever have", () => {
    const r = lintScreen(page([], { needs: ["telepathy" as never] }));
    expect(r.errors.join(" ")).toContain("no build will ever have that block");
  });

  it("refuses a bad expression, and says what is wrong with it", () => {
    const r = lintScreen(page([{ type: "Text", props: { content: v("state.a +") } }], { needs: ["expr"] }));
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toContain("props.content");
  });

  it("refuses an expression longer than the limit", () => {
    const long = `1 + ${"1 + ".repeat(120)}1`;
    const r = lintScreen(page([{ type: "Text", props: { content: v(long) } }], { needs: ["expr"] }));
    expect(r.errors.join(" ")).toContain("at most 400 characters");
  });

  it("refuses more rules than a screen may have", () => {
    const rules = Array.from({ length: 33 }, (_, i) => when(`r${i}`, "state.go", { kind: "refresh" }));
    const r = lintScreen(page([], { needs: ["expr", "rules"], rules }));
    expect(r.errors.join(" ")).toContain("at most 32 rules");
  });

  it("refuses a timer faster than the floor, and keeps the others", () => {
    const r = lintScreen(page([], {
      needs: ["rules", "expr"],
      rules: [
        { id: "fast", every: 100, do: { kind: "refresh" } },
        { id: "fine", every: 1000, do: { kind: "refresh" } },
      ],
    }));
    expect(r.errors.join(" ")).toContain("the shortest here is 1000 ms");
    expect(r.counts.timers).toBe(1);
  });

  it("refuses a state path that would reach every object in the app", () => {
    const r = lintScreen(page([], {
      needs: ["rules"],
      rules: [{ id: "x", after: 10, do: { kind: "setState", path: "a.__proto__.b", value: 1 } }],
    }));
    expect(r.errors.join(" ")).toContain('"__proto__" is not a name a path may use');
  });

  it("refuses a network path that climbs out of /v1/, and one with a scheme", () => {
    const climb = lintScreen(page([], {
      needs: ["defs"], defs: {},
      actions: { go: { kind: "callEndpoint", method: "GET", path: "/v1/notes/../../admin" } },
    }));
    expect(climb.errors.join(" ")).toContain('never contains ".."');
    const away = lintScreen(page([], {
      needs: ["defs"], defs: {},
      actions: { go: { kind: "callEndpoint", method: "GET", path: "https://example.com/v1/notes" } },
    }));
    expect(away.errors.join(" ")).toContain("carries no scheme");
  });

  it("takes a path with holes, because every hole is encoded", () => {
    const r = lintScreen(page([], {
      needs: ["expr"],
      actions: { go: { kind: "callEndpoint", method: "GET", path: t("/v1/notes/{{ state.note.id }}") as never } },
    }));
    expect(r.errors).toEqual([]);
  });

  it("refuses a local key that reads like a secret", () => {
    const r = lintScreen(page([], {
      needs: ["local"],
      actions: { keep: { kind: "local.set", path: "authToken", value: "x" } as never },
    }));
    expect(r.errors.join(" ")).toContain("reads like a secret");
  });

  it("refuses device.canOpen.* in a request body: that list never leaves the phone", () => {
    const r = lintScreen(page([], {
      needs: ["expr", "device"],
      actions: { pay: { kind: "callEndpoint", method: "POST", path: "/v1/pay", body: { apps: v("device.canOpen.gpay") } } },
    }));
    expect(r.errors.join(" ")).toContain("never sent to the server");
  });

  it("warns on a bare string that looks like a forgotten template, and refuses it only when asked", () => {
    const s = page([{ type: "Text", props: { content: "Lunch with {{ state.who }}" } }], { needs: [] });
    const soft = lintScreen(s);
    expect(soft.errors).toEqual([]);
    expect(soft.warnings.join(" ")).toContain('a plain string holds "{{');
    const hard = lintScreen(s, { strict: true });
    expect(hard.errors.join(" ")).toContain('a plain string holds "{{');
  });

  it("refuses a prop one of the blocks' nodes does not have", () => {
    const r = lintScreen(page([list({ data: v("state.rows"), item: { type: "Text", props: { content: "x" } }, columns: 2 } as never)], { needs: ["expr", "list"] }));
    expect(r.errors.join(" ")).toContain('List has no prop "columns"');
  });

  it("lets a List be the screen's own scroller, and refuses one inside a scroller that runs the same way", () => {
    const item = { type: "Text", props: { content: "x" } };
    const own = lintScreen(page([list({ data: v("state.rows"), item })], { needs: ["expr", "list"] }));
    expect(own.errors).toEqual([]);
    const nested = lintScreen(page([{ type: "Scroll", style: { flexDirection: "column" }, children: [list({ data: v("state.rows"), item })] }], { needs: ["expr", "list"] }));
    expect(nested.errors.join(" ")).toContain("windows nothing");
    const bounded = lintScreen(page([{
      type: "Scroll", style: { flexDirection: "column" },
      children: [list({ data: v("state.rows"), item, scroll: true }, { height: 240 })],
    }], { needs: ["expr", "list"] }));
    expect(bounded.errors).toEqual([]);
  });

  it("refuses a Use carrying what expansion would drop, and a template that uses itself", () => {
    const carried = lintScreen(page([{ ...use("row"), style: { opacity: 0.5 } }], {
      needs: ["defs"], defs: { row: { root: { type: "Text", props: { content: "x" } } } },
    }));
    expect(carried.errors.join(" ")).toContain("would lose it when it expands");
    const loop = lintScreen(page([use("row")], {
      needs: ["defs"], defs: { row: { root: { type: "Stack", children: [use("row")] } } },
    }));
    expect(loop.errors.length).toBeGreaterThan(0);
  });

  it("refuses a motion key the phone does not move, and a spring on the way out", () => {
    const r = lintScreen(page([
      { type: "Stack", motion: { enter: { blur: 4 } as never, exit: { opacity: { spring: 0 } as never } } },
    ], { needs: ["motion"] }));
    expect(r.errors.join(" ")).toContain("not a key motion moves");
    expect(r.errors.join(" ")).toContain("a spring has no end to leave on");
  });

  it("refuses a gesture bound to an expression, because the device reads it as a number", () => {
    const r = lintScreen(page([
      { type: "Stack", gestures: [{ kind: "drag", axis: "x", into: "pill", min: 0, max: v("device.width - 80") as never }] },
    ], { needs: ["gesture"] }));
    expect(r.errors.join(" ")).toContain("a number, not an expression");
  });

  it("refuses a filter Android would not draw", () => {
    const r = lintScreen(page([{ type: "Stack", style: { filter: "grayscale(1)" } }], { needs: ["paint"] }));
    expect(r.errors.join(" ")).toContain("brightness and opacity");
  });

  it("counts a screen's bytes, nodes and depth", () => {
    const r = lintScreen(page([{ type: "Text", props: { content: "x" } }], { needs: [] }));
    expect(r.counts.nodes).toBeGreaterThan(0);
    expect(r.counts.bytes).toBeGreaterThan(0);
    expect(r.counts.depth).toBeGreaterThanOrEqual(3);
  });
});

// ===================================================================== the builders

describe("writing one", () => {
  it("vocab2() works the needs out of the tree, so a screen cannot forget one", () => {
    const s = vocab2(page([
      list({ data: v("state.feed"), item: use("row", { row: v("item") }) }),
      slot("trail"),
    ]), { defs: { row: { params: ["row"], root: { type: "Text", props: { content: v("args.row.name") } } } } });
    expect(s.needs).toEqual(["expr", "defs", "list"]);
    expect(lintScreen(s).errors).toEqual([]);
  });

  it("the helpers emit the shapes the phone reads", () => {
    expect(v("state.a")).toEqual({ $: "state.a" });
    expect(t("a {{ state.b }}")).toEqual({ $t: "a {{ state.b }}" });
    expect(use("row", { a: 1 })).toEqual({ type: "Use", def: "row", args: { a: 1 } });
    expect(input({ kind: "switch" }, { value: "on" })).toMatchObject({ type: "Input", props: { kind: "switch" }, bind: { value: "on" } });
  });
});

// ===================================================================== the gate

describe("who gets a vocabulary-2 screen", () => {
  const needy = (): ScreenResponse => vocab2(page([
    { type: "Text", props: { content: t("{{ count(state.rows) }} rows") } },
    list({ data: v("state.rows"), item: { type: "Text", props: { content: v("item.name") } } }),
  ]));

  it("a client with every block gets the screen itself", () => {
    v2();
    const s = needy();
    const r = gateScreen(s, phone(["expr", "list"]));
    expect(r.served).toBe("screen");
    expect(r.screen).toBe(s);
  });

  it("a client missing one block gets \"open X0 again\" while it is on this runtime", () => {
    v2();
    const r = gateScreen(needy(), phone(["expr"]));
    expect(r.served).toBe("open-again");
    expect(r.missing).toEqual(["list"]);
    expect(JSON.stringify(r.screen)).toContain("Open X0 again");
    expect(JSON.stringify(r.screen)).not.toContain("apps.apple.com");
  });

  it("an older binary is told to update, with the store link", () => {
    v2();
    const r = gateScreen(needy(), phone(["expr"], "tailzu-2026-05-old"));
    expect(r.served).toBe("update");
    expect(JSON.stringify(r.screen)).toContain("apps.apple.com");
  });

  it("the window is told to update, with the download link", () => {
    v2();
    const c = clientVocab({ vocab: 2, blocks: ["expr"] }, { client: "desktop", userId: "u1" });
    const r = gateScreen(needy(), c);
    expect(r.served).toBe("update");
    expect(JSON.stringify(r.screen)).toContain("x0bot.com/download");
  });

  it("never lowers: the screen that goes out is the short one, not a trimmed version of the real one", () => {
    v2();
    const r = gateScreen(needy(), phone([]));
    expect(JSON.stringify(r.screen)).not.toContain("List");
    expect(lintTree(r.screen.root!)).toEqual([]);
  });

  it("a screen that fails lint is never served", () => {
    v2();
    const broken = page([{ type: "Text", props: { content: v("state.a +") } }], { needs: ["expr"] });
    const r = gateScreen(broken, phone(["expr"]));
    expect(r.served).toBe("refused");
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("with SDUI_V2 off nobody is treated as having a block, whatever they say", () => {
    v2off();
    expect(sduiV2Live("u1")).toBe(false);
    expect(phone(["expr", "list"]).blocks).toEqual([]);
    expect(gateScreen(needy(), phone(["expr", "list"])).served).toBe("open-again");
  });

  it("SDUI_V2_USERS stages it to the accounts named", () => {
    process.env.SDUI_V2 = "true";
    process.env.SDUI_V2_USERS = "u2, u3";
    resetConfigForTests();
    expect(sduiV2Live("u1")).toBe(false);
    expect(sduiV2Live("u2")).toBe(true);
    v2off();
  });

  it("a name no kernel knows is not a block, whoever says it", () => {
    v2();
    expect(phone(["expr", "telepathy"]).blocks).toEqual(["expr"]);
  });

  it("the short screen is drawn from the kit only, so the oldest build there is can draw it", () => {
    v2();
    for (const c of [phone([]), phone([], "old"), clientVocab({}, { client: "desktop" })]) {
      expect(lintTree(waitingScreen("t.one", c).root!)).toEqual([]);
    }
  });

  it("writes one audit line for every vocabulary-2 screen, served or not", () => {
    v2();
    const out = serveScreen(needy(), { vocab: 2, blocks: ["expr"], runtime: PHONE_RUNTIME }, { client: "phone", userId: "u1" });
    expect(out.audit).toContain("sdui2 open-again");
    expect(out.audit).toContain("needs=expr+list");
    expect(out.audit).toContain("missing=list");
  });
});

// ===================================================================== nothing changes for today's clients

describe("today's screens and today's clients", () => {
  it("a screen that says nothing of vocabulary 2 comes back as the very same object", () => {
    v2off();
    const s = page([{ type: "Text", props: { content: "Lunch" } }]);
    const r = gateScreen(s, clientVocab(undefined, { client: "phone" }));
    expect(r.screen).toBe(s);
    expect(r.served).toBe("screen");
    expect(r.needs).toEqual([]);
    expect(serveScreen(s, undefined, { client: "phone" }).audit).toBeNull();
  });

  it("real screens are untouched, and say no needs", async () => {
    v2off();
    const deps = fakeDeps();
    for (const id of ["bots.home", "bots.notify", "bots.settings"]) {
      const built = await buildBotsScreen({
        screenId: id, client: "phone", tzOffsetMinutes: IST, user: { id: "u1", name: "Aanya" },
        can: new Set(["BotsKit"]), desk: { pages: false, notes: false },
      }, deps);
      expect(built.needs, id).toBeUndefined();
      const out = serveScreen(built, { components: ["BotsKit"] }, { client: "phone", userId: "u1" });
      expect(out.screen, id).toBe(built);
      expect(out.audit, id).toBeNull();
    }
  });

  it("the kit's own lint refuses a block node until the screen says it needs that block", () => {
    const row = list({ data: v("state.rows"), item: { type: "Text", props: { content: "x" } } });
    const tree = stack([row]);
    expect(lintTree(tree).join(" ")).toContain("type List needs the list block");
    expect(lintTree(tree, { needs: ["list"] }).filter((x) => x.startsWith("type"))).toEqual([]);
  });
});
