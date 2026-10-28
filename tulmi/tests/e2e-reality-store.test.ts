/**
 * The results store and the code fingerprints: nothing is paid for twice, and a result is reused only while the code and the prompt it was made with are unchanged.
 * Temp folders; no key, no network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ResultsStore, keyOf, storeFor, type ResultKey, type StoredResult } from "../e2e/reality/store.js";
import { codeFingerprint, externalVersion, resetFingerprintCache, taskPromptVersion, treeHash } from "../e2e/reality/fingerprint.js";

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "reality-store-"));
const key = (over: Partial<ResultKey> = {}): ResultKey => ({ kind: "probe", agent: "-", model: "m/one", item: "hindi", code: "c1", prompt: "p1", ...over });
const rec = (k: ResultKey, over: Partial<StoredResult> = {}): StoredResult => ({ ...k, at: "2026-10-28T00:00:00Z", run: "r1", source: "real", ok: true, costInr: 0.01, wallMs: 100, ...over });

describe("the store", () => {
  it("keeps a result and finds it by (kind, agent, model, item, code, prompt) after a reload", () => {
    const dir = tmp();
    const s = new ResultsStore(dir).load();
    expect(s.reusable(key())).toBe(false);
    s.append(rec(key(), { score: 0.8 }));
    expect(s.reusable(key())).toBe(true);
    expect(s.get(key())!.score).toBe(0.8);
    const again = new ResultsStore(dir).load();
    expect(again.reusable(key())).toBe(true);
    expect(again.size).toBe(1);
    expect(fs.readFileSync(path.join(dir, "probes.jsonl"), "utf8").trim().split("\n").length).toBe(1);
  });

  it("is NOT reusable when the code, the prompt, the model, the item or the agent differs, but the history still has it", () => {
    const s = new ResultsStore(tmp()).load();
    s.append(rec(key()));
    for (const other of [key({ code: "c2" }), key({ prompt: "p2" }), key({ model: "m/two" }), key({ item: "image" }), key({ agent: "tailzu" })]) expect(s.reusable(other), keyOf(other)).toBe(false);
    expect(s.history("probe", "-", "m/one", "hindi").length).toBe(1);
    s.append(rec(key({ code: "c2" }), { ok: false }));
    expect(s.history("probe", "-", "m/one", "hindi").map((r) => r.ok)).toEqual([true, false]);
    expect(s.latest().length).toBe(2);
  });

  it("keeps repeats under one key, oldest first, and the latest is the answer", () => {
    const s = new ResultsStore(tmp()).load();
    s.append(rec(key(), { ok: true }));
    s.append(rec(key(), { ok: false }));
    expect(s.runs(key()).map((r) => r.ok)).toEqual([true, false]);
    expect(s.get(key())!.ok).toBe(false);
    expect(s.latest().length).toBe(1);
  });

  it("writes each kind to its own file, and ignores a torn last line", () => {
    const dir = tmp();
    const s = new ResultsStore(dir).load();
    s.append(rec(key()));
    s.append(rec(key({ kind: "task", agent: "tailzu", model: "ladders", item: "t1" })));
    s.append(rec(key({ kind: "smoke", agent: "tailzu", model: "smoke-ladder", item: "i1" })));
    s.append(rec(key({ kind: "part", item: "router" })));
    s.append(rec(key({ kind: "replay", model: "smoke-2", item: "smoke/-/x" })));
    expect(fs.readdirSync(dir).sort()).toEqual(["parts.jsonl", "probes.jsonl", "replays.jsonl", "smoke.jsonl", "tasks.jsonl"]);
    fs.appendFileSync(path.join(dir, "probes.jsonl"), '{"kind":"probe","agent":"-"');
    expect(new ResultsStore(dir).load().size).toBe(5);
  });

  it("a simulated result is never read by a real run, and a real one never by a simulated run", () => {
    const dir = tmp();
    const sim = new ResultsStore(dir, ["sim"]).load();
    sim.append(rec(key(), { source: "sim" }));
    expect(sim.reusable(key())).toBe(true);
    expect(new ResultsStore(dir, ["real", "replay"]).load().reusable(key())).toBe(false);
    const real = new ResultsStore(dir, ["real", "replay"]).load();
    real.append(rec(key({ item: "image" }), { source: "real" }));
    expect(new ResultsStore(dir, ["sim"]).load().reusable(key({ item: "image" }))).toBe(false);
    expect(new ResultsStore(dir, ["real", "replay"]).load().reusable(key({ item: "image" }))).toBe(true);
  });

  it("storeFor puts a simulated run's results beside its report, not in the committed folder", () => {
    const out = tmp();
    const s = storeFor("sim", { outDir: out });
    expect(s.dir).toBe(path.join(out, "sim-results"));
    expect(storeFor("sim", { outDir: out, dir: path.join(out, "x") }).dir).toBe(path.join(out, "x", "sim-results"));
    expect(storeFor("real", { outDir: out, dir: path.join(out, "x") }).dir).toBe(path.join(out, "x"));
  });
});

describe("fingerprints", () => {
  it("a tree hash is the same for the same files and changes with any file's text", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "src", "a"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "a", "x.ts"), "export const x = 1\n");
    fs.writeFileSync(path.join(root, "src", "y.ts"), "export const y = 1\n");
    const h1 = treeHash(["src"], { root, fresh: true });
    expect(treeHash(["src"], { root, fresh: true })).toBe(h1);
    fs.writeFileSync(path.join(root, "src", "a", "x.ts"), "export const x = 2\n");
    expect(treeHash(["src"], { root, fresh: true })).not.toBe(h1);
    // Another directory does not count.
    fs.mkdirSync(path.join(root, "other"));
    fs.writeFileSync(path.join(root, "other", "z.ts"), "1");
    const h2 = treeHash(["src"], { root, fresh: true });
    fs.writeFileSync(path.join(root, "other", "z.ts"), "2");
    expect(treeHash(["src"], { root, fresh: true })).toBe(h2);
  });

  it("`except` leaves the prompt files out of the code hash, so a prompt edit changes the prompt version and not the code", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "src", "principles"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "code.ts"), "a");
    fs.writeFileSync(path.join(root, "src", "principles", "p.ts"), "words");
    const code = treeHash(["src"], { root, fresh: true, except: /^src\/principles\// });
    const prompt = treeHash(["src/principles"], { root, fresh: true });
    fs.writeFileSync(path.join(root, "src", "principles", "p.ts"), "other words");
    expect(treeHash(["src"], { root, fresh: true, except: /^src\/principles\// })).toBe(code);
    expect(treeHash(["src/principles"], { root, fresh: true })).not.toBe(prompt);
  });

  it("a contestant's code is its pinned version, ours is the working tree, and a task's prompt version follows its text", () => {
    resetFingerprintCache();
    expect(externalVersion("aider")).toMatch(/^aider@\d+\.\d+/);
    expect(codeFingerprint("task", "aider")).toBe(externalVersion("aider"));
    expect(codeFingerprint("task", "tailzu")).toMatch(/^[0-9a-f]{12}$/);
    expect(codeFingerprint("probe")).toMatch(/^[0-9a-f]{12}$/);
    const t = { id: "t1" };
    const a = taskPromptVersion(t, "tailzu", { id: "t1", request: "one" });
    expect(taskPromptVersion(t, "tailzu", { id: "t1", request: "one" })).toBe(a);
    expect(taskPromptVersion(t, "tailzu", { id: "t1", request: "two" })).not.toBe(a);
    expect(taskPromptVersion(t, "aider", { id: "t1", request: "one" })).not.toBe(a);
  });
});
