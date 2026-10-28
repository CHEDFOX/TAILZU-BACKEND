/**
 * Every e2e command line is strict (e2e/cli.ts): --help prints help and runs nothing, an unknown flag is an error, a paid run names its cap. The first re-check of the
 * bake-off started a REAL run (₹0.48 before it was killed, ₹677 planned) from `--help`, because the old parsers ignored what they did not know.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CliExit, closestFlag, helpText, parseCli, requireBudget, runCli, type CliSpec } from "../e2e/cli.js";
import { BAKEOFF_SPEC, runBakeoffCli } from "../e2e/bakeoff/index.js";
import { GRID_SPEC } from "../e2e/bakeoff/grid.js";
import { PARTS_SPEC } from "../e2e/bakeoff/parts.js";
import { LOAD_SPEC } from "../e2e/load.js";
import { MINE_SPEC } from "../e2e/mine.js";
import { PROXY_SPEC } from "../e2e/proxy.js";
import { REPOS_SPEC } from "../e2e/repos.js";
import { RUN_SPEC } from "../e2e/run.js";
import { PROVE_SPEC } from "../e2e/agents/prove.js";
import { TOOLS_SPEC } from "../e2e/agents/tools.js";
import { SECURITY_SPEC } from "../e2e/security/index.js";
import { SMOKE_SPEC, runSmokeCli } from "../e2e/smoke/index.js";
import { VALIDATE_SPEC } from "../e2e/validate.js";
import { REALITY_SPEC, optionsFrom } from "../e2e/reality/index.js";

const spec: CliSpec = {
  name: "tool", about: "a tool", positionals: false,
  flags: { suite: { kind: "string", about: "a suite" }, "budget-inr": { kind: "number", about: "cap" }, record: { kind: "bool", about: "record" }, tiers: { kind: "list", about: "tiers" } },
};

const exit = (f: () => unknown): CliExit => { try { f(); } catch (e) { if (e instanceof CliExit) return e; throw e; } throw new Error("did not exit"); };

describe("the parser", () => {
  it("reads strings, numbers, lists and booleans, in both --flag value and --flag=value forms", () => {
    const p = parseCli(spec, ["--suite", "smoke", "--budget-inr=12.5", "--record", "--tiers", "a, b,c"]);
    expect(p.str("suite")).toBe("smoke");
    expect(p.num("budget-inr")).toBe(12.5);
    expect(p.has("record")).toBe(true);
    expect(p.list("tiers")).toEqual(["a", "b", "c"]);
    expect(p.has("suite")).toBe(true);
    expect(p.num("nothing")).toBeUndefined();
  });

  it("rejects an unknown flag, naming the nearest known one, with exit code 2", () => {
    const e = exit(() => parseCli(spec, ["--suit", "smoke"]));
    expect(e.code).toBe(2);
    expect(e.message).toMatch(/unknown flag --suit \(did you mean --suite\?\)/);
    expect(exit(() => parseCli(spec, ["--help-me"])).code).toBe(2);
    expect(closestFlag("budget", ["budget-inr", "record"])).toBe("budget-inr");
    expect(closestFlag("zzzzzzzz", ["budget-inr", "record"])).toBeUndefined();
  });

  it("rejects a missing value, a value that is not a number, a value on a boolean and a stray word", () => {
    expect(exit(() => parseCli(spec, ["--suite"])).message).toMatch(/needs a value/);
    expect(exit(() => parseCli(spec, ["--suite", "--record"])).message).toMatch(/needs a value/);
    expect(exit(() => parseCli(spec, ["--budget-inr", "lots"])).message).toMatch(/needs a number/);
    expect(exit(() => parseCli(spec, ["--record=1"])).message).toMatch(/takes no value/);
    expect(exit(() => parseCli(spec, ["extra"])).message).toMatch(/unexpected argument/);
    expect(parseCli(spec, ["--budget-inr", "-3"]).num("budget-inr")).toBe(-3);
  });

  it("prints help and exits 0 for --help and -h, before anything else is looked at", () => {
    for (const w of ["--help", "-h"]) {
      const e = exit(() => parseCli(spec, ["--bogus", w]));
      // An unknown flag before --help is still an unknown flag; the help comes when the words are fine.
      expect(e.code).toBe(2);
    }
    const e = exit(() => parseCli(spec, ["--help"]));
    expect(e.code).toBe(0);
    expect(e.message).toBe(helpText(spec));
    expect(e.message).toMatch(/--budget-inr N/);
    expect(e.message).toMatch(/--help/);
  });

  it("takes positionals only where the tool does", () => {
    const withWords: CliSpec = { ...spec, positionals: { name: "[ids]", about: "ids" } };
    expect(parseCli(withWords, ["install", "a", "--record"]).positionals).toEqual(["install", "a"]);
    expect(exit(() => parseCli({ ...spec, positionals: { name: "[id]", about: "x", max: 1 } }, ["a", "b"])).message).toMatch(/too many/);
  });

  it("runCli turns --help into 0 with the help on stdout, and a mistake into 2 on stderr", async () => {
    const out: string[] = [], err: string[] = [];
    const log = console.log, error = console.error;
    console.log = (s: unknown) => { out.push(String(s)); };
    console.error = (s: unknown) => { err.push(String(s)); };
    try {
      expect(await runCli(async () => { parseCli(spec, ["--help"]); })).toBe(0);
      expect(await runCli(async () => { parseCli(spec, ["--nope"]); })).toBe(2);
      expect(await runCli(async () => { throw new Error("boom"); })).toBe(1);
      expect(await runCli(async () => 4)).toBe(4);
    } finally { console.log = log; console.error = error; }
    expect(out[0]).toMatch(/flags:/);
    expect(err[0]).toMatch(/unknown flag --nope/);
    expect(err[1]).toBe("boom");
  });
});

describe("a paid run names its cap", () => {
  it("requireBudget refuses a missing, zero or negative cap when it spends, and never asks when it does not", () => {
    expect(exit(() => requireBudget(parseCli(spec, []), true)).code).toBe(2);
    expect(exit(() => requireBudget(parseCli(spec, ["--budget-inr", "0"]), true)).code).toBe(2);
    expect(exit(() => requireBudget(parseCli(spec, ["--budget-inr", "-5"]), true)).code).toBe(2);
    expect(requireBudget(parseCli(spec, ["--budget-inr", "7"]), true)).toBe(7);
    expect(requireBudget(parseCli(spec, []), false)).toBe(0);
    expect(exit(() => requireBudget(parseCli(spec, []), true, "a real bake-off")).message).toMatch(/a real bake-off needs an explicit hard cap/);
  });

  it("a real bake-off, grid, smoke run or part with no --budget-inr stops before anything is called (whatever the key)", async () => {
    const quiet = async <T>(f: () => Promise<T>): Promise<{ code: T; err: string }> => {
      const err: string[] = []; const e = console.error; const l = console.log;
      console.error = (s: unknown) => { err.push(String(s)); }; console.log = () => undefined;
      try { return { code: await f(), err: err.join("\n") }; } finally { console.error = e; console.log = l; }
    };
    const bake = await quiet(() => runBakeoffCli(["--tiers", "tiny"]));
    expect(bake.code).toBe(2);
    expect(bake.err).toMatch(/--budget-inr/);
    const grid = await quiet(() => runBakeoffCli(["--grid", "--models", "a/b"]));
    expect(grid.code).toBe(2);
    expect(grid.err).toMatch(/--budget-inr/);
    const parts = await quiet(() => runBakeoffCli(["--parts", "--spend"]));
    expect(parts.code).toBe(2);
    const smoke = await quiet(() => runSmokeCli([]));
    expect(smoke.code).toBe(2);
    expect(smoke.err).toMatch(/--budget-inr/);
  });

  it("an unknown flag stops every mode of the bake-off and the smoke suite with exit 2", async () => {
    const quiet = async (f: () => Promise<number>): Promise<number> => { const e = console.error; console.error = () => undefined; try { return await f(); } finally { console.error = e; } };
    expect(await quiet(() => runBakeoffCli(["--bogus"]))).toBe(2);
    expect(await quiet(() => runBakeoffCli(["--grid", "--models", "a/b", "--bogus"]))).toBe(2);
    expect(await quiet(() => runBakeoffCli(["--parts", "--bogus"]))).toBe(2);
    expect(await quiet(() => runSmokeCli(["--items", "1", "--bogus"]))).toBe(2);
  });

  it("--help is 0 in every mode and runs nothing", async () => {
    const l = console.log; console.log = () => undefined;
    try {
      expect(await runBakeoffCli(["--help"])).toBe(0);
      expect(await runBakeoffCli(["--grid", "--help"])).toBe(0);
      expect(await runBakeoffCli(["--parts", "--help"])).toBe(0);
      expect(await runSmokeCli(["--help"])).toBe(0);
    } finally { console.log = l; }
  });
});

describe("every e2e tool has a strict spec", () => {
  const specs: Array<[string, CliSpec]> = [
    ["run", RUN_SPEC], ["smoke", SMOKE_SPEC], ["bakeoff", BAKEOFF_SPEC], ["grid", GRID_SPEC], ["parts", PARTS_SPEC], ["repos", REPOS_SPEC], ["mine", MINE_SPEC], ["validate", VALIDATE_SPEC],
    ["load", LOAD_SPEC], ["proxy", PROXY_SPEC], ["tools", TOOLS_SPEC], ["prove", PROVE_SPEC], ["security", SECURITY_SPEC], ["reality", REALITY_SPEC],
  ];
  for (const [name, s] of specs) {
    it(`${name}: an unknown flag is exit 2, --help is exit 0 with every flag listed`, () => {
      expect(exit(() => parseCli(s, ["--definitely-not-a-flag"])).code).toBe(2);
      const h = exit(() => parseCli(s, ["--help"]));
      expect(h.code).toBe(0);
      for (const f of Object.keys(s.flags)) expect(h.message, f).toContain(`--${f}`);
    });
  }

  it("a budget flag, wherever it exists, is never defaulted in its help", () => {
    for (const [, s] of specs) { const b = s.flags["budget-inr"]; if (b) expect(b.about).toMatch(/REQUIRED|hard cap/i); }
  });
});

describe("the real command lines, as a person runs them", () => {
  const tulmi = path.resolve(__dirname, "..");
  const run = (file: string, args: string[]) => spawnSync(process.execPath, [path.join(tulmi, "node_modules", "tsx", "dist", "cli.mjs"), file, ...args], { cwd: tulmi, encoding: "utf8", timeout: 60_000, env: { ...process.env, OPENROUTER_API_KEY: "" } });

  it("`bakeoff --help` prints help, exits 0 and does NOT start a bake-off", () => {
    const r = run("e2e/bakeoff/index.ts", ["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/flags:/);
    expect(r.stdout + r.stderr).not.toMatch(/BAKE-OFF PLAN|catalog:|== tiny/);
  }, 70_000);

  it("`run --help` does not start an oracle run of all the tasks, and `run --suit bugs` is an error", () => {
    const h = run("e2e/run.ts", ["--help"]);
    expect(h.status).toBe(0);
    expect(h.stdout).not.toMatch(/task\(s\) ×/);
    const bad = run("e2e/run.ts", ["--suit", "bugs"]);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/did you mean --suite/);
  }, 70_000);

  it("`reality --bogus` and a paid `reality` with no cap both stop with 2 and call nothing", () => {
    expect(run("e2e/reality/index.ts", ["--bogus"]).status).toBe(2);
    const r = run("e2e/reality/index.ts", ["--plan", "quick"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--budget-inr/);
  }, 70_000);
});

describe("the reality command's flags", () => {
  it("reads the plan, the stages, the groups, the mode and the scenario, with defaults and checks", () => {
    const d = optionsFrom([]);
    expect(d.opts.plan).toBe("quick");
    expect(d.opts.mode).toBe("real");
    expect(d.opts.stages).toEqual([0, 1, 2, 3, 4, 5]);
    expect(d.opts.groups).toEqual(["agents", "models"]);
    expect(d.opts.budgetInr).toBe(0);
    expect(d.opts.confidence).toBe(0.9);
    const o = optionsFrom(["--plan", "deep", "--stages", "4,1,1", "--groups", "agents", "--mode", "sim", "--sim", "tie", "--budget-inr", "50", "--estimate", "--task-limit", "5", "--seed", "9"]);
    expect(o.opts).toMatchObject({ plan: "deep", stages: [1, 4], groups: ["agents"], mode: "sim", sim: "tie", budgetInr: 50, seed: 9, taskLimit: 5 });
    expect(o.estimateOnly).toBe(true);
    expect(exit(() => optionsFrom(["--plan", "huge"])).code).toBe(2);
    expect(exit(() => optionsFrom(["--stages", "7"])).code).toBe(2);
    expect(exit(() => optionsFrom(["--groups", "everything"])).code).toBe(2);
    expect(exit(() => optionsFrom(["--mode", "fake"])).code).toBe(2);
    expect(exit(() => optionsFrom(["--confidence", "0.2"])).code).toBe(2);
    expect(exit(() => optionsFrom(["--budget-inr"])).code).toBe(2);
  });
});
