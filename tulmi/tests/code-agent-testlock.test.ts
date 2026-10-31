/**
 * THE PROJECT'S TESTS ARE LOCKED (src/code/agent/testlock.ts): the job is done when they pass, so the model may add to them but not weaken them,
 * unless the person asked for the tests to change or for something to go.
 */
import { describe, expect, it } from "vitest";
import { TESTS_ASKED, weakenedTests } from "../src/code/agent/testlock.js";
import { Tools } from "../src/code/agent/tools.js";
import { initialState } from "../src/code/agent/types.js";
import { FakeWorkspace, fakeLog } from "./live-fakes.js";

const TEST = 'import { slug } from "./util";\n\ndescribe("slug", () => {\n  it("lowers", () => {\n    expect(slug("A")).toBe("a");\n  });\n  it("trims", () => {\n    expect(slug(" a ")).toBe("a");\n  });\n});\n';
const PY = "def test_lower():\n    assert slug('A') == 'a'\n\ndef test_trim():\n    assert slug(' a ') == 'a'\n";

describe("what weakens a test file", () => {
  it("is a removed test, a removed assertion, a skip or a delete", () => {
    expect(weakenedTests(TEST, TEST.replace(/  it\("trims"[\s\S]*?\n  }\);\n/, ""))).toBe("it would remove 1 test");
    expect(weakenedTests(TEST, TEST.replace('    expect(slug(" a ")).toBe("a");\n', ""))).toBe("it would remove 1 assertion");
    expect(weakenedTests(TEST, TEST.replace('it("trims"', 'it.skip("trims"'))).toBe("it would skip or narrow 1 test");
    expect(weakenedTests(TEST, TEST.replace('it("lowers"', 'it.only("lowers"'))).toBe("it would skip or narrow 1 test");
    expect(weakenedTests(PY, PY.replace("def test_trim", "@pytest.mark.skip\ndef test_trim"))).toBe("it would skip or narrow 1 test");
    expect(weakenedTests(PY, "def test_lower():\n    assert slug('A') == 'a'\n")).toBe("it would remove 1 test");
    expect(weakenedTests(TEST, null)).toBe("it would delete a test file the project has");
  });

  it("is not an added test, a rename, or a changed argument", () => {
    expect(weakenedTests(TEST, TEST.replace(/slug/g, "slugify"))).toBeNull();
    expect(weakenedTests(TEST, TEST.replace("});\n});", '});\n  it("empties", () => {\n    expect(slug("")).toBe("");\n  });\n});'))).toBeNull();
    expect(weakenedTests(PY, PY.replace("slug(' a ')", "slug(' a ', strip=True)"))).toBeNull();
  });

  it("gives way when the person asked for the tests to change, or for something to go", () => {
    for (const t of ["fix the flaky test in util", "update the tests for the new API", "the slug tests are outdated", "remove the deprecated slug helper", "drop Node 16 support"]) expect(TESTS_ASKED.test(t), t).toBe(true);
    for (const t of ["add a --json flag to the status command", "make slug handle empty input, with a test", "why does the build fail?"]) expect(TESTS_ASKED.test(t), t).toBe(false);
  });
});

describe("the agent's edits", () => {
  function rig(task: string) {
    const ws = new FakeWorkspace({ "src/util.ts": "export const slug = (s: string) => s.toLowerCase();\n", "src/util.test.ts": TEST });
    const tools = new Tools({
      userId: "u", projectId: "p", state: initialState(task, 0), ws: ws as never, brain: {} as never, log: fakeLog(),
      web: { run: async () => ({ ok: false, message: { content: "no" } }) } as never,
      runStep: async () => ({ status: "done", exitCode: 0, outputTail: "", minutes: 0, stepIdx: 0, ms: 1 }), closedSource: false, now: () => 1000,
    });
    let n = 0;
    return (name: string, args: Record<string, unknown>) => tools.exec({ id: `c${(n += 1)}`, name, arguments: JSON.stringify(args) });
  }

  it("are refused when they weaken a test the project has, and staged when they add to it or the file is new", async () => {
    const run = rig("make slug trim spaces");
    const skipped = await run("edit_file", { path: "src/util.test.ts", old: 'it("trims"', new: 'it.skip("trims"' });
    expect(skipped).toMatchObject({ ok: false });
    expect(skipped.content).toMatch(/src\/util\.test\.ts is one of the project's tests.*locked: it would skip or narrow 1 test/);
    expect((await run("delete_file", { path: "src/util.test.ts" })).ok).toBe(false);
    expect((await run("edit_file", { path: "src/util.test.ts", old: "});\n});", new: '});\n  it("empties", () => {\n    expect(slug("")).toBe("");\n  });\n});' })).ok).toBe(true);
    expect((await run("write_file", { path: "src/trim.test.ts", content: 'it("x", () => {});\n' })).ok).toBe(true);
  });

  it("go through when the person asked for the tests to change", async () => {
    const run = rig("the trims test is outdated: remove it");
    expect((await run("edit_file", { path: "src/util.test.ts", old: '  it("trims", () => {\n    expect(slug(" a ")).toBe("a");\n  });\n', new: "" })).ok).toBe(true);
  });
});
