/**
 * The executors that do the running: a probe paid once and replayed free, a replay that refuses to start what was never recorded, the real flow on scripted models,
 * and the estimate's use of what earlier paid runs cost. Temp cassette folders; no key, no network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const nodeFs = require("node:fs") as typeof import("node:fs");
  const nodeOs = require("node:os") as typeof import("node:os");
  const nodePath = require("node:path") as typeof import("node:path");
  process.env.E2E_CASSETTES_DIR = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "reality-cass-"));
  process.env.E2E_OUT_DIR = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "reality-exec-out-"));
});

import { parseCatalog, type Catalog } from "../e2e/catalog.js";
import { simClient } from "../e2e/bakeoff/sim.js";
import { RealExecutor, runLabel } from "../e2e/reality/exec.js";
import { splitProxyUrl } from "../e2e/agents/external.js";
import { measuredTaskInr, LADDERS_ARM, taskKey } from "../e2e/reality/plan.js";
import { ResultsStore } from "../e2e/reality/store.js";
import { loadTasks } from "../e2e/tasks/schema.js";
import type { Arm } from "../e2e/reality/types.js";

const catalog = (): Catalog => ({ fetchedAt: 1, source: "live", models: parseCatalog({ data: [{ id: "deepseek/deepseek-v4.1-flash", pricing: { prompt: "0.0000003", completion: "0.0000012" }, architecture: { input_modalities: ["text"] }, supported_parameters: ["tools", "reasoning"] }] }) });
const opts = (mode: "real" | "replay" | "scripted", over: Record<string, unknown> = {}) => ({ mode, fx: 88, catalog: catalog(), outDir: fs.mkdtempSync(path.join(os.tmpdir(), "rx-")), capInr: 5, log: () => undefined, ...over });
const info = catalog().models.get("deepseek/deepseek-v4.1-flash");
const arm = (id: string, agent: string, model: string): Arm => ({ id, agent, model, group: "agents" });
const smokeTask = loadTasks().find((t) => t.id === "smoke-api-bug-pagination")!;

describe("a probe: paid once, then answered from the cassette", () => {
  it("is charged in rupees from the upstream's own cost on the first run, and is free and identical on the second", async () => {
    const upstream = simClient({ priceOf: () => ({ inUsdPerM: 0.3, outUsdPerM: 1.2 }) });
    const first = new RealExecutor(opts("real", { upstream }));
    const a = await first.probe("deepseek/deepseek-v4.1-flash", "json_contract", info);
    expect(a.costInr).toBeGreaterThan(0);
    expect(first.spentInr()).toBeGreaterThan(0);
    expect(first.spentInr()).toBeCloseTo(a.costInr, 8);
    await first.close();
    const second = new RealExecutor(opts("real", { upstream }));
    const b = await second.probe("deepseek/deepseek-v4.1-flash", "json_contract", info);
    expect(second.spentInr()).toBe(0);
    expect(b.ok).toBe(a.ok);
    expect(b.score).toBe(a.score);
    expect(b.costInr).toBeCloseTo(a.costInr, 8);
  });

  it("in replay mode, a probe nobody recorded is reported as not recorded, costs nothing and calls nothing", async () => {
    const ex = new RealExecutor(opts("replay"));
    const r = await ex.probe("deepseek/deepseek-v4.1-flash", "hindi", info);
    expect(r.unrecorded).toBe(true);
    expect(r.costInr).toBe(0);
    expect(ex.spentInr()).toBe(0);
  });
});

describe("a task in replay mode", () => {
  it("is not started when the cassette has no recording of it (an agent would run its whole loop into misses)", async () => {
    const ex = new RealExecutor(opts("replay"));
    const t0 = Date.now();
    const r = await ex.task(arm("aider:m", "aider", "m"), smokeTask, { repeat: 1, budgetInr: 5, index: 1 });
    expect(r.skipped).toMatch(/not recorded/);
    expect(Date.now() - t0).toBeLessThan(2000);
    const ours = await ex.task(arm("tailzu:ladders", "tailzu", "ladders"), smokeTask, { repeat: 1, budgetInr: 5, index: 1 });
    expect(ours.skipped).toMatch(/not recorded/);
    expect(ex.spentInr()).toBe(0);
  });
});

describe("the real flow on scripted models (free)", () => {
  it("the right answer passes the hidden tests through the real checkout and scoring, at no cost, and the wrong one fails at a stage", async () => {
    const ex = new RealExecutor(opts("scripted", { skipSuite: true }));
    const right = await ex.task(arm("tailzu:oracle", "tailzu", "oracle"), smokeTask, { repeat: 1, budgetInr: 5, index: 1 });
    expect(right.ok).toBe(true);
    expect(right.costInr).toBe(0);
    expect(right.perf.success).toBe(true);
    expect(right.perf.timeToGreenMs).not.toBeNull();
    expect(right.perf.detail).toBe("full");
    const wrong = await ex.task(arm("tailzu:fake", "tailzu", "fake"), smokeTask, { repeat: 1, budgetInr: 5, index: 1 });
    expect(wrong.ok).toBe(false);
    expect(wrong.perf.stage).not.toBeNull();
    expect(wrong.detail.length).toBeGreaterThan(0);
    const external = await ex.task(arm("aider:m", "aider", "m"), smokeTask, { repeat: 1, budgetInr: 5, index: 1 });
    expect(external.skipped).toMatch(/no scripted mode/);
    expect(ex.spentInr()).toBe(0);
  }, 180_000);
});

describe("the estimate learns what a task costs", () => {
  it("uses the mean of earlier PAID runs of the category, and ignores simulated, replayed and free ones", () => {
    const s = new ResultsStore(fs.mkdtempSync(path.join(os.tmpdir(), "rm-")), ["real", "replay", "sim"]).load();
    const t = loadTasks().find((x) => x.category === "bug")!;
    const add = (cost: number, source: "real" | "sim" | "replay", model = "ladders", item = t.id): void => s.append({ ...taskKey({ ...LADDERS_ARM, model }, t), item, at: "t", run: "r", source, ok: true, costInr: cost, wallMs: 1, category: "bug" });
    add(2, "real");
    expect(measuredTaskInr(s, "bug")).toBeNull();
    add(4, "real", "ladders", "other-1");
    expect(measuredTaskInr(s, "bug")).toBe(3);
    add(100, "sim", "ladders", "other-2");
    add(100, "replay", "ladders", "other-3");
    add(0, "real", "ladders", "other-4");
    add(100, "real", "some/model", "other-5");
    expect(measuredTaskInr(s, "bug")).toBe(3);
    expect(measuredTaskInr(s, "feature")).toBeNull();
  });
});

describe("the proxy label of a contestant's run", () => {
  it("stays a label the agent and the proxy accept, however long the task id (a long one once got a second /run/ prefix and only 404s)", () => {
    const long = runLabel("mini-swe-agent:deepseek/deepseek-v4.1-flash", "body-parser-hostile-skip-failing-test");
    expect(long.length).toBeLessThanOrEqual(80);
    expect(splitProxyUrl(`http://127.0.0.1:1/run/${long}/v1`).label).toBe(long);
    expect(runLabel("mini-swe-agent:deepseek/deepseek-v4.1-flash", "body-parser-hostile-skip-failing-tests")).not.toBe(long);
    expect(runLabel("aider:m/x", "t-1")).toBe("aider_m_x__t-1");
  });
});
