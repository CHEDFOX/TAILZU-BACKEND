/**
 * Task validation, the heart of the miner: a task is kept only if its hidden tests FAIL on the base project and PASS with the known-correct patch, and the
 * patch breaks nothing. Run here on tiny synthetic projects with node:test, so it needs no clone and no network.
 */
import { describe, expect, it } from "vitest";
import { cleanRequest } from "../e2e/mine.js";
import { substituteSecrets, validateTask } from "../e2e/validate.js";
import type { Task } from "../e2e/tasks/schema.js";
import { fakeSecret } from "../e2e/util.js";

const base = {
  "package.json": "{\"name\":\"p\",\"version\":\"1.0.0\"}\n",
  "src/add.js": "exports.add = (a, b) => a - b\n",
  "test/add.test.js": "const { test } = require('node:test'); const assert = require('node:assert'); const { add } = require('../src/add');\ntest('visible', () => assert.strictEqual(add(0, 0), 0))\n",
};

const hidden = "const { test } = require('node:test'); const assert = require('node:assert'); const { add } = require('../src/add');\ntest('adds', () => assert.strictEqual(add(2, 3), 5));\ntest('adds negatives', () => assert.strictEqual(add(-2, -3), -5));\n";

const mk = (over: Partial<Task> = {}): Task => ({
  id: "synthetic-add-bug", title: "add subtracts", category: "bug", repo: "synthetic", request: "add(2, 3) gives -1, not 5", difficulty: 1, tags: [],
  base: { files: base }, truth: { files: ["src/add.js"] },
  hidden: { files: { "test/add.hidden.test.js": hidden }, run: ["test/add.hidden.test.js"], kind: "tests", minTests: 2 },
  oracle: { kind: "patch", files: { "src/add.js": "exports.add = (a, b) => a + b\n" } },
  checks: { suite: false }, ...over,
} as Task);

describe("validating a task", () => {
  it("accepts one whose hidden tests fail before and pass with the oracle's patch", async () => {
    const v = await validateTask(mk());
    expect(v.why).toMatch(/fails before, passes with the oracle/);
    expect(v.ok).toBe(true);
    expect(v.baseFailed).toBeGreaterThan(0);
    expect(v.oracleTests).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it("rejects one whose hidden tests already pass on the base (nothing to ask for)", async () => {
    const v = await validateTask(mk({ base: { files: { ...base, "src/add.js": "exports.add = (a, b) => a + b\n" } } }));
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/already pass/);
  }, 60_000);

  it("rejects one whose oracle patch does not make the hidden tests pass (the ask is unfair or the patch wrong)", async () => {
    const v = await validateTask(mk({ oracle: { kind: "patch", files: { "src/add.js": "exports.add = (a, b) => a * b\n" } } }));
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/do not pass with the oracle/);
  }, 60_000);

  it("rejects one that has hidden tests but no patch", async () => {
    const v = await validateTask(mk({ oracle: { kind: "patch", files: {} } }));
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/no patch/);
  }, 30_000);

  it("rejects an oracle that does not satisfy the task's own file checks", async () => {
    const v = await validateTask(mk({ checks: { suite: false, noLeftovers: [{ pattern: "a \\+ b" }] } }));
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/file checks/);
  }, 60_000);

  it("a question needs an answer, and its truth files must be in the project", async () => {
    const q = (over: Partial<Task>): Task => mk({ category: "question", hidden: undefined as never, oracle: { kind: "answer", answer: "in src/add.js" }, truth: { files: [], answerFiles: ["src/add.js"], facts: ["a - b"] }, ...over });
    expect((await validateTask(q({}))).ok).toBe(true);
    expect((await validateTask(q({ truth: { files: [], answerFiles: ["src/missing.js"] } }))).ok).toBe(false);
    expect((await validateTask(q({ oracle: { kind: "answer" } }))).ok).toBe(false);
    expect((await validateTask(q({ truth: { files: [], answerFiles: ["src/add.js"], facts: ["not in the file"] } }))).why).toMatch(/fact/);
  }, 60_000);
});

describe("what a mined task's request is made of", () => {
  it("is the commit's subject and its prose, without the trailers and references", () => {
    const t = cleanRequest("fix: handle empty body (#123)", "Closes #123\n\nThe parser threw on an empty body.\n\nCo-authored-by: A <a@b.c>\nSigned-off-by: B <b@c.d>");
    expect(t).toContain("handle empty body");
    expect(t).toContain("The parser threw on an empty body.");
    expect(t).not.toMatch(/Co-authored-by|Signed-off-by/);
  });
});

describe("secrets are built at run time", () => {
  it("substitutes the planted placeholders with the same value the scorer will look for", () => {
    const t = mk({ checks: { suite: false, secrets: [{ kind: "stripe", salt: "s1" }] } });
    const text = substituteSecrets("KEY={{SECRET:0}}", t);
    expect(text).toBe(`KEY=${fakeSecret("stripe", "s1")}`);
    expect(substituteSecrets("{{SECRET:3}}", t)).toBe("");
  });
});
