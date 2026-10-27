/**
 * WHAT THE REALITY CHECK FOUND IN THE PRODUCT, KEPT AS TESTS SO IT STAYS FOUND.
 *
 * 1. The affected tests for a Python change were listed with every .py file under a tests folder: conftest.py, __init__.py, an app a test uses. Named on
 *    pytest's command line each is an error ("cannot import name ...", "cannot collect 'testapp'"), so a correct change in Flask failed its own checks
 *    and was blamed for "test: test". Only files pytest would collect (test_*.py, *_test.py) are test files.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sweepStaleWork } from "../e2e/util.js";
import { affectedTestCommand, runnerOf } from "../src/code/work/plan.js";

const step = { kind: "test" as const, cmd: "uv run pytest", cwd: "" };

describe("the affected tests of a Python change are test files, not the folder's helpers", () => {
  it("leaves conftest.py, __init__.py and helper apps out of the list given to pytest", () => {
    const c = affectedTestCommand(step, [
      "tests/test_helpers.py", "tests/conftest.py", "tests/test_apps/cliapp/app.py", "tests/test_apps/blueprintapp/__init__.py",
      "examples/tutorial/tests/test_auth.py", "tests/basic_test.py",
    ], ["pytest"]);
    expect(c.scope).toBe("affected");
    expect(c.cmd).toBe("uv run pytest tests/test_helpers.py examples/tutorial/tests/test_auth.py tests/basic_test.py");
  });

  it("with nothing but helpers it runs the whole suite instead of an error", () => {
    expect(affectedTestCommand(step, ["tests/conftest.py", "tests/test_apps/x/__init__.py"], ["pytest"])).toMatchObject({ cmd: "uv run pytest", scope: "all" });
  });

  it("still takes any file of the other runners that the runner is given", () => {
    expect(runnerOf("go test ./...").tests.test("svc/store_test.go")).toBe(true);
    expect(runnerOf("pytest").tests.test("tests/test_x.py")).toBe(true);
    expect(runnerOf("pytest").tests.test("tests/conftest.py")).toBe(false);
  });
});

describe("the work folder a killed run leaves behind", () => {
  it("removes what nothing has touched for hours, and keeps what a live run is using", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweep-"));
    try {
      fs.mkdirSync(path.join(dir, "old", "inner"), { recursive: true });
      fs.mkdirSync(path.join(dir, "fresh"));
      const longAgo = new Date(Date.now() - 5 * 3_600_000);
      fs.utimesSync(path.join(dir, "old"), longAgo, longAgo);
      expect(sweepStaleWork(3 * 3_600_000, Date.now(), dir)).toEqual(["old"]);
      expect(fs.readdirSync(dir)).toEqual(["fresh"]);
      expect(sweepStaleWork(3 * 3_600_000, Date.now(), path.join(dir, "missing"))).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
