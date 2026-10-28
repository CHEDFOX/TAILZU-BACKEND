/**
 * The harness bugs the second real-model run found (RESULTS-2026-10-28, section 7), each with the test that would have caught it:
 *   2. the smoke report hid the harness's own turn cap, and 12 turns was too few
 *   3. a strict --replay of a just-recorded cassette missed (parts-router-2, smoke-2): the test project's own output carried Node's proxy warning with a process id in
 *      it, colour codes and timings, so the request the replay made was never the one that was recorded; and the router part kept only pass counts, not which task
 *      failed at which stage
 * No key, no network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CassetteClient, CassetteStore, cassetteKey, normalize, type Entry } from "../e2e/adapters/cassette.js";
import { checkoutEnv, getRepo } from "../e2e/repos.js";
import { oracle } from "../e2e/adapters/personas.js";
import { loadTasks } from "../e2e/tasks/schema.js";
import { taskItem, type SmokeCtx } from "../e2e/smoke/items.js";
import { renderHtml, renderText, type SmokeRun } from "../e2e/smoke/report.js";
import { SMOKE_MAX_TURNS } from "../e2e/smoke/tiers.js";
import { SMOKE_SPEC } from "../e2e/smoke/index.js";
import type { ItemResult } from "../e2e/smoke/types.js";
import type { ChatClient } from "../src/code/brain/gateway.js";

const WARN = "(node:6454) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental, expect them to change at any time.\n(Use `node --trace-warnings ...` to show where the warning was created)";

/** What `npm test` printed in the session that RECORDED (NODE_USE_ENV_PROXY=1, colour, timings) and in the one that REPLAYS (none of it). */
const recordedOutput = `$ npm test\n${WARN}\nTAP version 13\n# ${WARN.split("\n")[0]}\n# ${WARN.split("\n")[1]}\n# Subtest: health\nok 1 - health\n  ---\n  duration_ms: 40.742993\n  type: 'test'\n  ...\n1..1\n# duration_ms 215.562806\n\u001b[32m✓\u001b[39m test/App.test.jsx \u001b[2m(\u001b[22m\u001b[2m3 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[90m 221\u001b[2mms\u001b[22m\u001b[39m`;
const replayedOutput = `$ npm test\nTAP version 13\n# Subtest: health\nok 1 - health\n  ---\n  duration_ms: 32.404297\n  type: 'test'\n  ...\n1..1\n# duration_ms 98.1\n\u001b[32m✓\u001b[39m test/App.test.jsx \u001b[2m(\u001b[22m\u001b[2m3 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[90m 147\u001b[2mms\u001b[22m\u001b[39m`;

const body = (tool: string): Record<string, unknown> => ({
  model: "m/one", reasoning: { effort: "high" },
  messages: [{ role: "system", content: "sys" }, { role: "user", content: "fix it" }, { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "run", arguments: "{}" } }] }, { role: "tool", tool_call_id: "c1", content: tool }],
});

const answer = (text: string): unknown => ({ id: "x", model: "m/one", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: text } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.002 } });

describe("bug 3: a strict replay of a just-recorded cassette must not miss", () => {
  it("normalizes Node's proxy warning (plain and as TAP comments, any process id), colour codes and the test runner's timings out of the key", () => {
    expect(normalize(recordedOutput)).toBe(normalize(replayedOutput));
    expect(cassetteKey(body(recordedOutput))).toBe(cassetteKey(body(replayedOutput)));
    // The output the agent read still differs where it should: a failing test is not the same key.
    expect(cassetteKey(body(recordedOutput.replace("ok 1", "not ok 1")))).not.toBe(cassetteKey(body(replayedOutput)));
    expect(normalize("(node:123) something else")).toBe("(node:<pid>) something else");
  });

  it("a request recorded with the warning is answered in a session without it (record, then replay strictly: no miss)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cassette-replay-"));
    const up: ChatClient = { chat: { completions: { async create() { return answer("done"); } } } };
    const rec = new CassetteClient({ store: new CassetteStore("c", dir), mode: "record", upstream: up });
    await rec.create(body(recordedOutput));
    const store = new CassetteStore("c", dir).load();
    const replay = new CassetteClient({ store, mode: "replay" });
    const res = (await replay.create(body(replayedOutput))) as { choices: Array<{ message: { content: string } }> };
    expect(res.choices[0]!.message.content).toBe("done");
    expect(replay.stats.misses).toEqual([]);
    expect(replay.stats.hits).toBe(1);
  });

  it("a cassette recorded under the OLD rules (its stored key made from the raw text) is found under the new ones, because the request is stored whole", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cassette-old-"));
    const b = body(recordedOutput);
    const old: Entry = { k: "0123456789abcdef01234567", at: "2026-10-28T00:00:00Z", req: { model: "m/one", messages: b.messages as never, reasoning: { effort: "high" } }, res: answer("from the old recording"), ms: 1, usd: 0.002 };
    fs.writeFileSync(path.join(dir, "old.jsonl"), `${JSON.stringify(old)}\n`);
    const store = new CassetteStore("old", dir).load();
    expect(store.count).toBe(1);
    expect(store.entries().length).toBe(1);
    const replay = new CassetteClient({ store, mode: "replay" });
    const res = (await replay.create(body(replayedOutput))) as { choices: Array<{ message: { content: string } }> };
    expect(res.choices[0]!.message.content).toBe("from the old recording");
    expect(replay.stats.misses.length).toBe(0);
  });

  it("a request that really differs is still a miss", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cassette-miss-"));
    const up: ChatClient = { chat: { completions: { async create() { return answer("done"); } } } };
    await new CassetteClient({ store: new CassetteStore("c", dir), mode: "record", upstream: up }).create(body(recordedOutput));
    const replay = new CassetteClient({ store: new CassetteStore("c", dir).load(), mode: "replay" });
    await expect(replay.create({ ...body(replayedOutput), model: "m/two" })).rejects.toThrow(/cassette miss/);
    expect(replay.stats.misses.length).toBe(1);
  });

  it("the harness no longer hands NODE_USE_ENV_PROXY to the project's own commands (it is where the warning came from)", () => {
    const saved = process.env.NODE_USE_ENV_PROXY;
    process.env.NODE_USE_ENV_PROXY = "1";
    try {
      const env = checkoutEnv(getRepo("smoke-api"));
      expect("NODE_USE_ENV_PROXY" in env).toBe(false);
    } finally { if (saved === undefined) delete process.env.NODE_USE_ENV_PROXY; else process.env.NODE_USE_ENV_PROXY = saved; }
  });
});

const item = (over: Partial<ItemResult>): ItemResult => ({ id: "smoke-web-feature-clear-completed", n: 2, title: "A Clear completed button", kind: "task", ok: false, stages: { work: { ok: false, detail: "did not meet the task's checks" } }, costPaise: 16, calls: 20, ms: 40_000, detail: "", notes: [], harness: [], ...over });
const run = (items: ItemResult[]): SmokeRun => ({ id: "x", startedAt: "2026-10-28T00:00:00Z", finishedAt: "2026-10-28T00:01:00Z", mode: "real", models: { primary: "a", fallback: "b", tiers: "smoke" }, capInr: 8, spentInr: 0.5, replayedInr: 0, estimatedInr: 1, fx: 88, items, misses: [] });

describe("bug 2: the smoke report shows what the harness did to a run, and the cap is 20", () => {
  it("the default turn cap is 20, in the constant and in the command's own help", () => {
    expect(SMOKE_MAX_TURNS).toBe(20);
    expect(SMOKE_SPEC.flags["max-turns"]!.about).toMatch(/default 20/);
  });

  it("the text report lists the harness's notes under their own heading, apart from the product's failures", () => {
    const text = renderText(run([item({ harness: ["the run was stopped at the 12-turn cap, with 3 file(s) staged and not committed"] })]));
    expect(text).toMatch(/harness notes \(what the test rig did to the run, not the product\)/);
    expect(text).toMatch(/12-turn cap, with 3 file\(s\) staged/);
    expect(renderText(run([item({ ok: true, stages: {}, harness: [] })]))).not.toMatch(/harness notes/);
  });

  it("the HTML report shows them too", () => {
    const html = renderHtml(run([item({ harness: ["the run was stopped at the 12-turn cap"] })]));
    expect(html).toMatch(/Harness notes/);
    expect(html).toMatch(/12-turn cap/);
  });

  it("a task stopped by the cap comes back with the note, and its failing stage says it was the harness", async () => {
    const t = loadTasks().find((x) => x.id === "smoke-api-bug-pagination")!;
    const ctx: SmokeCtx = { mode: "oracle", maxTurns: 1, maxTokens: 800, taskBudgetPaise: 250, outDir: fs.mkdtempSync(path.join(os.tmpdir(), "smoke-cap-")), log: () => undefined };
    void oracle;
    const r = await taskItem(t, ctx, 1, 0);
    expect(r.ok).toBe(false);
    expect(r.harness.join(" ")).toMatch(/1-turn cap/);
    expect(Object.values(r.stages).some((s) => !s.ok && /\[harness: .*1-turn cap/.test(s.detail))).toBe(true);
    // With room, the same task passes and there is nothing to report.
    const ok = await taskItem(t, { ...ctx, maxTurns: SMOKE_MAX_TURNS }, 1, 0);
    expect(ok.ok).toBe(true);
    expect(ok.harness.filter((h) => /turn cap/.test(h))).toEqual([]);
  }, 120_000);
});
