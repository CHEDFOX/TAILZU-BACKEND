/**
 * THE SCREEN KERNEL BESIDE THIS BUILD (shared/sdui/kernel.cjs; pure/SPEC.md 2.0 principle 1, 2.12).
 *
 * The device works screens out with this kernel, and the publish gate has to refuse exactly what the device would
 * refuse — so the server does not keep a second compiler, it runs the generated copy of the phone's. This file
 * checks that the copy is the generated one (a hand edit fails here), and that it compiles, refuses and measures
 * the way the limits table says.
 *
 * Regenerate it with `node src/sdui/kernel/genKernel.mjs` in TAILZU-FRONTEND/app.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(HERE, "../../shared/sdui/kernel.cjs");
const PHONE = resolve(HERE, "../../../TAILZU-FRONTEND/app/src/sdui/kernel");
const SOURCES = ["limits.ts", "blocks.ts", "paths.ts", "coreGrammar.ts", "format.ts", "expr.ts", "text.ts", "defs.ts", "rules.ts"];

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

/* eslint-disable @typescript-eslint/no-explicit-any */
const kernel = createRequire(import.meta.url)(FILE) as any;

describe("the generated kernel", () => {
  it("is the file the generator wrote, untouched", () => {
    const text = readFileSync(FILE, "utf8");
    const body = /body sha256 ([0-9a-f]{64})/.exec(text);
    expect(body, "the header names the body").toBeTruthy();
    const at = text.indexOf("\n(function (root, factory)");
    expect(at).toBeGreaterThan(0);
    expect(sha(text.slice(at + 1)), "run `node src/sdui/kernel/genKernel.mjs` in TAILZU-FRONTEND/app").toBe(body![1]);
  });

  it("carries the sha of every source, and they are the phone's sources as they are now", () => {
    const text = readFileSync(FILE, "utf8");
    for (const name of SOURCES) {
      const m = new RegExp(`${name.replace(".", "\\.")} sha256 ([0-9a-f]{64})`).exec(text);
      expect(m, `the header names ${name}`).toBeTruthy();
      if (!existsSync(PHONE)) continue;
      expect(sha(readFileSync(join(PHONE, name), "utf8")), `${name} changed: regenerate the kernel`).toBe(m![1]);
    }
  });

  it("says which vocabulary and which blocks it speaks", () => {
    expect(kernel.VOCAB).toBe(2);
    expect([...kernel.BLOCKS]).toEqual([
      "expr", "defs", "rules", "device", "local", "paint", "motion", "gesture", "list", "input", "media", "data", "shell", "call",
    ]);
    expect(kernel.canDraw(["expr"], ["expr"])).toBe(true);
    expect(kernel.missingBlocks(["expr"], ["expr", "list"])).toEqual(["list"]);
  });
});

describe("the gate refuses what the device would refuse", () => {
  it("compiles a good screen's expressions and text", () => {
    const scope = { state: { done: [1, 2], items: [1, 2, 3] }, env: { locale: "en-US", now: 0, timeZone: "UTC", intl: false } };
    expect(kernel.compileExpr("count(state.done) < count(state.items)").run(scope)).toBe(true);
    expect(kernel.compileText("{{ count(state.done) }} of {{ count(state.items) }} done").run(scope)).toBe("2 of 3 done");
  });

  it("refuses what is not in the language, with a reason the author can read", () => {
    for (const src of ["state.x = 1", "fetch('https://x')", "(a) => a", "nope.x", "state.name.toUpperCase()"]) {
      const r = kernel.tryCompileExpr(src);
      expect(r.ok, src).toBe(false);
      expect(typeof r.error).toBe("string");
    }
  });

  it("measures against the same limits table the device holds", () => {
    expect(kernel.LIMITS.exprOps).toBe(256);
    expect(kernel.LIMITS.rules).toBe(32);
    expect(kernel.LIMITS.defsNodes).toBe(200);
    const long = Array.from({ length: 200 }, (_, i) => String(i % 7)).join("+").slice(0, 401);
    expect(kernel.tryCompileExpr(long).ok).toBe(false);
  });

  it("keeps user text out of the evaluator, which is the rule a publish gate cannot get wrong", () => {
    const title = "Dinner {{ state.token }}";
    expect(kernel.compileProp(title).kind).toBe("constant");
    expect(kernel.runProp(kernel.compileProp(title), {})).toBe(title);
    expect(kernel.looksLikeForgottenTemplate(title)).toBe(true);
  });

  it("checks the paths a screen may call and the keys it may keep on a phone", () => {
    expect(kernel.networkPathOk("/v1/notes/n1")).toBe(true);
    expect(kernel.networkPathError("/v1/../admin")).toMatch(/\.\./);
    expect(kernel.networkPathError("https://evil.test/v1/x")).toMatch(/scheme/);
    // Every spelling of a dot segment, because the clients' URL libraries resolve them all.
    for (const climb of ["/v1/.%2e/admin", "/v1/%2e./admin", "/v1/%2E%2E/x"]) {
      expect(kernel.networkPathError(climb), climb).toMatch(/\.\./);
    }
    expect(kernel.networkPathOk(`/v1/search?q=${kernel.encodeHole("wait...")}`), "ordinary words in a query").toBe(true);
    expect(kernel.statePathOk("call.startedAt")).toBe(true);
    expect(kernel.statePathOk("__proto__.x")).toBe(false);
    expect(kernel.localKeyError("sessionToken")).toMatch(/secret/);
  });

  it("refuses a template that uses itself, before any phone draws it", () => {
    const errors = kernel.checkDefs({
      a: { root: { type: "Stack", children: [{ type: "Use", def: "b" }] } },
      b: { root: { type: "Stack", children: [{ type: "Use", def: "a" }] } },
    });
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/circle/);
  });

  it("reports the hostile shapes rather than crashing on them, because this gate has to answer", () => {
    const proto = kernel.checkDefs(JSON.parse('{"__proto__":{"root":{"type":"Stack","children":[{"type":"Use","def":"__proto__"}]}}}'));
    expect(proto.join(" ")).toMatch(/not a plain name/);

    let deep: unknown = { type: "Text" };
    for (let i = 0; i < 6000; i += 1) deep = { type: "Stack", children: [deep] };
    expect(kernel.checkDefs({ d: { root: deep } }).join(" ")).toMatch(/nests more than/);

    // Definitions that draw nothing but fan out through Use and Slot: the work is counted, so this answers.
    const fan: Record<string, unknown> = {};
    const names = ["a", "b", "c", "d", "e", "f"];
    names.forEach((name, i) => {
      const kids = i + 1 < names.length ? Array.from({ length: 30 }, () => ({ type: "Use", def: names[i + 1] })) : [];
      fan[name] = { root: { type: "Slot", children: kids } };
    });
    expect(kernel.checkDefs(fan)).toEqual([]);
    expect(() => kernel.expandTree({ type: "Use", def: "a" }, fan)).toThrow(/at most 10000 steps/);
  });

  it("reads a screen's rules the way the device will run them", () => {
    const { rules, errors } = kernel.compileRules([
      { id: "tick", every: 1000, do: { kind: "setState" } },
      { id: "fast", every: 100, do: { kind: "setState" } },
    ]);
    expect(rules.length).toBe(1);
    expect(errors[0]).toMatch(/shortest here is 1000 ms/);
  });
});
