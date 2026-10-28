/**
 * THE HARNESS AFTER FREE-FORM BECAME THE DEFAULT (e2e/, 2026-10-28): the phased flow as a contestant of its own, the comparison's own task list, and three
 * harness bugs the first paid run showed (a cut-short answer replayed to the gateway's larger retry, breakers shared across runs, a failed call with no reason).
 * No key, no network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CassetteClient, CassetteStore, cutShortFor, failedTransiently } from "../e2e/adapters/cassette.js";
import { whyOf } from "../e2e/adapters/models.js";
import { agentById } from "../e2e/agents/index.js";
import { isOurs, OUR_AGENTS } from "../e2e/agents/tailzu.js";
import { RealExecutor } from "../e2e/reality/exec.js";
import { codeFingerprint, externalVersion, taskPromptVersion } from "../e2e/reality/fingerprint.js";
import { contestants } from "../e2e/reality/installs.js";
import { chosenSample, PLAN_SPECS } from "../e2e/reality/plan.js";
import { shareOf } from "../e2e/reality/stages.js";
import { loadTasks } from "../e2e/tasks/schema.js";
import type { ChatClient } from "../src/code/brain/gateway.js";
import { workTokens, WORK_TOKENS } from "../src/code/agent/phases.js";
import { REASONING_ALLOWANCE } from "../src/agent/reasoning.js";

describe("our two arms", () => {
  it("are the product as it ships (free-form) and its phased flow, both run from the working tree", () => {
    expect([...OUR_AGENTS]).toEqual(["tailzu", "tailzu-phased", "tailzu-high", "tailzu-adaptive"]);
    expect(agentById("tailzu-phased").id).toBe("tailzu-phased");
    expect(agentById("tailzu-phased").usesCheckout).toBe(false);
    expect(isOurs("tailzu-phased") && isOurs("tailzu") && !isOurs("aider")).toBe(true);
    // The phased arm's results are keyed by the product's code, not by a pinned version like a contestant's.
    expect(codeFingerprint("task", "tailzu-phased")).toBe(codeFingerprint("task", "tailzu"));
    expect(codeFingerprint("task", "aider")).toBe(externalVersion("aider"));
    const t = loadTasks()[0]!;
    expect(taskPromptVersion(t, "tailzu-phased", t)).toBe(taskPromptVersion(t, "tailzu", t));
    expect(contestants(["tailzu", "tailzu-phased"]).every((c) => c.usable)).toBe(true);
  });
});

describe("the comparison's own tasks (--tasks)", () => {
  const pool = loadTasks();
  it("takes ids in the order given, leaves out what cannot run here and says why, and refuses a list that names nothing", () => {
    const s = chosenSample("express-hostile-add-workflow,body-parser-feat-rawbody,commander-vague-env-config", pool, new Map([["commander-vague-env-config", "not installed"]]));
    expect(s.ordered.map((t) => t.id)).toEqual(["express-hostile-add-workflow", "body-parser-feat-rawbody"]);
    expect(s.skipped).toEqual([{ id: "commander-vague-env-config", category: "vague", repo: "commander", reason: "not installed" }]);
    expect(() => chosenSample("no-such-task", pool, new Map())).toThrow(/matches no task/);
  });

  it("takes a glob too, in id order: the twelve complex tasks (two sets of six) are there and validated", () => {
    const s = chosenSample("tag:complex", pool, new Map());
    expect(s.ordered.map((t) => t.id)).toEqual([...s.ordered.map((t) => t.id)].sort());
    expect(s.ordered).toHaveLength(12);
    expect(chosenSample("tag:complex2", pool, new Map()).ordered).toHaveLength(6);
    expect(new Set(s.ordered.map((t) => t.category))).toEqual(new Set(["refactor", "feature", "bug", "vague", "language", "question", "hostile"]));
    expect(s.ordered.every((t) => t.validated?.oraclePasses && t.validated.baseFails)).toBe(true);
  });
});

describe("a cut-short answer is not replayed to the larger retry", () => {
  const lengthEmpty = { choices: [{ finish_reason: "length", message: { role: "assistant", content: "" } }], usage: { prompt_tokens: 10, completion_tokens: 4096, cost: 0.003 } };
  it("is told apart from an answer that wrote something, and from a retry with no more room", () => {
    expect(cutShortFor({ req: { model: "m", messages: [], max_tokens: 4096 }, res: lengthEmpty }, { max_tokens: 20480 })).toBe(true);
    expect(cutShortFor({ req: { model: "m", messages: [], max_tokens: 4096 }, res: lengthEmpty }, { max_tokens: 4096 })).toBe(false);
    const wrote = { choices: [{ finish_reason: "length", message: { role: "assistant", content: "half an answer" } }] };
    expect(cutShortFor({ req: { model: "m", messages: [], max_tokens: 4096 }, res: wrote }, { max_tokens: 20480 })).toBe(false);
    const stop = { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "" } }] };
    expect(cutShortFor({ req: { model: "m", messages: [], max_tokens: 4096 }, res: stop }, { max_tokens: 20480 })).toBe(false);
  });

  it("goes to the model in a mixed run, so the gateway's retry with more room gets a real answer", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cassette-cut-"));
    const store = new CassetteStore("c", dir);
    const seen: number[] = [];
    const upstream = { chat: { completions: { create: async (b: Record<string, unknown>) => { seen.push(b.max_tokens as number); return seen.length === 1 ? lengthEmpty : { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "done" } }], usage: { cost: 0.001 } }; } } } } as unknown as ChatClient;
    const client = new CassetteClient({ store, mode: "mixed", upstream });
    const req = { model: "m/one", messages: [{ role: "user", content: "write it" }], reasoning: { effort: "high" } };
    await client.create({ ...req, max_tokens: 4096 });
    // The same request again is the same answer (a replay); the larger one is a miss, and the model is asked.
    await client.create({ ...req, max_tokens: 4096 });
    const big = await client.create({ ...req, max_tokens: 20480 }) as { choices: Array<{ message: { content: string } }> };
    expect(seen).toEqual([4096, 20480]);
    expect(big.choices[0]!.message.content).toBe("done");
  });
});

describe("a recorded dropped connection is not replayed to the retry", () => {
  it("is told apart from a failure a second try cannot mend", () => {
    expect(failedTransiently({ err: { message: "terminated" } })).toBe(true);
    expect(failedTransiently({ err: { status: 429, message: "slow down" } })).toBe(true);
    expect(failedTransiently({ err: { status: 503, message: "busy" } })).toBe(true);
    expect(failedTransiently({ err: { status: 400, message: "bad request" } })).toBe(false);
    expect(failedTransiently({})).toBe(false);
  });

  it("goes to the model in a mixed run, and is still replayed in a replay run", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cassette-drop-"));
    const store = new CassetteStore("c", dir);
    let calls = 0;
    const upstream = { chat: { completions: { create: async () => { calls += 1; if (calls === 1) throw new TypeError("terminated"); return { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "done" } }], usage: { cost: 0.001 } }; } } } } as unknown as ChatClient;
    const req = { model: "m/one", messages: [{ role: "user", content: "write it" }], max_tokens: 4096 };
    const mixed = new CassetteClient({ store, mode: "mixed", upstream });
    await expect(mixed.create(req)).rejects.toThrow(/terminated/);
    const again = await mixed.create(req) as { choices: Array<{ message: { content: string } }> };
    expect(calls).toBe(2);
    expect(again.choices[0]!.message.content).toBe("done");
    // A replay of the same recording tells the story as it happened: the drop first.
    const replay = new CassetteClient({ store: new CassetteStore("c", dir).load(), mode: "replay" });
    await expect(replay.create(req)).rejects.toThrow(/terminated/);
  });
});

describe("the run's total", () => {
  it("keeps what the contestants' proxy paid after the executor is closed", async () => {
    const ex = new RealExecutor({ mode: "real", fx: 88, catalog: {} as never, outDir: os.tmpdir(), capInr: 10, log: () => {} });
    (ex as unknown as { proxy: unknown }).proxy = { guard: { spentUsd: 0.25 }, close: async () => {} };
    expect(ex.spentInr()).toBeCloseTo(22, 6);
    await ex.close();
    expect(ex.spentInr()).toBeCloseTo(22, 6);
  });
});

describe("a failed call says why", () => {
  it("names each model's outcome on the ladder and the cause's first words", () => {
    const err = Object.assign(new Error("every model for this call failed"), { causeError: new Error("429 Too Many Requests: slow down") });
    expect(whyOf([{ model: "deepseek/deepseek-v4.1-flash", outcome: "failed", status: 429 }, { model: "z-ai/glm-5.3-flash", outcome: "skipped", skipped: "breaker" }], err))
      .toBe("deepseek-v4.1-flash failed 429, glm-5.3-flash skipped (breaker): 429 Too Many Requests: slow down");
  });
});

describe("a work turn's room", () => {
  it("is the answer's room plus the tier's thinking, within the tier's limit", () => {
    expect(workTokens({ maxTokens: 8000, reasoning: "none" })).toBe(WORK_TOKENS);
    expect(workTokens({ maxTokens: 8000, reasoning: "medium" })).toBe(WORK_TOKENS + REASONING_ALLOWANCE.medium);
    expect(workTokens({ maxTokens: 6000, reasoning: "high" })).toBe(6000);
    expect(workTokens({ maxTokens: 600, reasoning: "none" })).toBe(600);
  });
});

describe("a stage's share of the cap", () => {
  it("is among the paid stages the run selected: stage 4 alone has the whole cap, the full plan keeps its shares", () => {
    const spec = PLAN_SPECS.quick;
    expect(shareOf({ stages: [0, 4], spec }, 4)).toBe(1);
    expect(shareOf({ stages: [0, 1, 2, 3, 4, 5], spec }, 4)).toBeCloseTo(spec.share[4], 6);
    expect(shareOf({ stages: [3, 4], spec }, 3) + shareOf({ stages: [3, 4], spec }, 4)).toBeCloseTo(1, 6);
  });
});
