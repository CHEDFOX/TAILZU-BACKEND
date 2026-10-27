/**
 * OBSERVATION MASKING (src/code/agent/mask.ts): what an old tool output becomes.
 *
 * A placeholder says what was done and the facts that matter, in one line, with no model: the command and its exit code, the first error, the file and
 * line range, the files a search found. It never carries a secret, and it says in its own words that the output was masked. The strategies as a whole
 * (tokens per turn, total input, model calls, whether the job finishes) are measured in tests/code-agent-context-strategies.test.ts.
 */
import { describe, expect, it } from "vitest";
import { CONTEXT_STRATEGIES, HYBRID_EVERY, OLD_ARG_CHARS, OLD_TEXT_CHARS, firstError, isStrategy, maskArguments, maskResult, maskText, placeholderOf } from "../src/code/agent/mask.js";
import type { CallRecord, ResultRecord } from "../src/code/agent/types.js";

const call = (name: string, args: Record<string, unknown>): CallRecord => ({ id: "c1", name, arguments: JSON.stringify(args) });
const result = (content: string, data?: string, label?: string): ResultRecord => ({ ok: true, content, ...(data !== undefined ? { data } : {}), ...(label ? { label } : {}) });

describe("the strategies", () => {
  it("are mask, summary and hybrid", () => {
    expect([...CONTEXT_STRATEGIES]).toEqual(["mask", "summary", "hybrid"]);
    expect(isStrategy("mask")).toBe(true);
    expect(isStrategy("hybrid")).toBe(true);
    expect(isStrategy("nope")).toBe(false);
    expect(isStrategy(undefined)).toBe(false);
    expect(HYBRID_EVERY).toBeGreaterThan(1);
  });
});

describe("a placeholder, tool by tool", () => {
  it("run: the command, the exit code, how many lines, and the first line that says what went wrong", () => {
    const out = ["> app@1 test", "RUN  v2", "src/a.test.ts (3)", "FAIL src/a.test.ts > adds", "AssertionError: expected 4 to be 5", "  at src/a.ts:12:3", "Tests 1 failed"].join("\n");
    const p = placeOrdinary(call("run", { cmd: "npm test" }), result("Exit code 1", out, "npm test"));
    expect(p.line).toBe('[run "npm test": exit 1, 7 lines, first error: FAIL src/a.test.ts > adds - output masked]');
    expect(p.quotes).toBe(true);
  });
  it("run that passed says so and quotes nothing", () => {
    const p = placeOrdinary(call("run", { cmd: "npm run build" }), result("Exit code 0", "built in 2s\nok", "npm run build"));
    expect(p.line).toBe('[run "npm run build": exit 0, 2 lines, passed - output masked]');
    expect(p.quotes).toBe(false);
  });
  it("run never quotes a line a secret scan flags", () => {
    const token = "ghp_" + "Qw3Er5Ty7Ui9Op1As2Df4Gh6Jk8Lz0Xc5Vb7";
    const p = placeOrdinary(call("run", { cmd: "env" }), result("Exit code 2", `error: bad credentials ${token}\nsecond line`, "env"));
    expect(p.line).not.toContain(token);
    expect(p.line).toContain("exit 2");
  });
  it("read_file: the path, the range and the size", () => {
    const p = placeOrdinary(call("read_file", { path: "src/lib/api.ts" }), result("src/lib/api.ts, lines 1-200 of 540", "x".repeat(8200), "src/lib/api.ts"));
    expect(p.line).toBe("[read src/lib/api.ts lines 1-200 of 540, 8.2k characters - output masked]");
    expect(p.quotes).toBe(false);
  });
  it("grep: the pattern, how many lines in how many files, and the top files", () => {
    const rows = ["src/lib/api.ts:10:fetchUsers()", "src/lib/api.ts:20:fetchUsers()", "src/server/index.ts:5:fetchUsers", "src/a.ts:1:fetchUsers"].join("\n");
    const p = placeOrdinary(call("grep", { pattern: "fetchUsers" }), result('4 lines match "fetchUsers" in 3 files.', rows, "fetchUsers"));
    expect(p.line).toBe('[grep "fetchUsers": 4 lines in 3 files, top src/lib/api.ts (2), src/a.ts (1), src/server/index.ts (1) - output masked]');
    expect(p.quotes).toBe(true);
  });
  it("glob, list_dir, search_code, read_page, web_search, research", () => {
    expect(placeOrdinary(call("glob", { pattern: "src/**/*.ts" }), result("2 files match", "src/a.ts\nsrc/b.ts")).line).toBe('[glob "src/**/*.ts": 2 files, first src/a.ts, src/b.ts - output masked]');
    expect(placeOrdinary(call("list_dir", { path: "src" }), result("src: 12 entries", "a\nb")).line).toBe("[list_dir src: 12 entries - output masked]");
    expect(placeOrdinary(call("search_code", { query: "login" }), result("found", "Files:\nsrc/auth.ts - login flow\nsrc/ui.ts - button\nSymbols:\nlogin")).line).toContain('[search_code "login"');
    expect(placeOrdinary(call("read_page", { url: "https://example.test/docs" }), result("page", "y".repeat(3000))).line).toBe("[read_page https://example.test/docs: 3.0k characters - output masked]");
    expect(placeOrdinary(call("web_search", { query: "tree-sitter wasm" }), result("results", "z".repeat(1500))).line).toBe('[web_search "tree-sitter wasm": 1.5k characters of results - output masked]');
    expect(placeOrdinary(call("research", { question: "why" }), result("done", "w".repeat(900))).line).toBe('[research "why": 900 characters - output masked]');
  });
  it("an unknown tool still gets a line that names it", () => {
    expect(placeOrdinary(call("frobnicate", {}), result("ok", "abc", "thing")).line).toBe("[frobnicate thing: 3 characters - output masked]");
  });
  it("a long argument is cut in the line", () => {
    const p = placeOrdinary(call("run", { cmd: "x".repeat(300) }), result("Exit code 0", "ok"));
    expect(p.line.length).toBeLessThan(200);
  });
});

/** placeholderOf without the fuss of its destructuring. */
function placeOrdinary(c: CallRecord, r: ResultRecord): { line: string; quotes: boolean } { return placeholderOf(c, r); }

describe("firstError", () => {
  it("picks the first line that says something went wrong, else the last line", () => {
    expect(firstError("ok\nall good\nTS2345: Argument of type 'string'\nmore")).toBe("TS2345: Argument of type 'string'");
    expect(firstError("a\nb\nlast words")).toBe("last words");
    expect(firstError("")).toBe("");
  });
  it("cuts a long line", () => {
    expect(firstError("error: " + "x".repeat(400)).length).toBeLessThanOrEqual(110);
  });
});

describe("maskResult", () => {
  it("drops the output and marks the result, keeping ok", () => {
    const m = maskResult(call("read_file", { path: "a.ts" }), { ok: true, content: "a.ts, lines 1-10 of 10", data: "const a = 1;", label: "a.ts" });
    expect(m.masked).toBe(true);
    expect(m.data).toBeUndefined();
    expect(m.label).toBeUndefined();
    expect(m.ok).toBe(true);
    expect(m.content).toContain("output masked");
  });
  it("leaves alone a result with no output (an edit's one line) and one already masked", () => {
    const edit: ResultRecord = { ok: true, content: "Edited src/a.ts." };
    expect(maskResult(call("edit_file", { path: "src/a.ts" }), edit)).toBe(edit);
    const once = maskResult(call("read_file", { path: "a.ts" }), { ok: true, content: "c", data: "d" });
    expect(maskResult(call("read_file", { path: "a.ts" }), once)).toBe(once);
  });
  it("marks a result whose placeholder quotes the output, so it goes inside a data fence", () => {
    const m = maskResult(call("run", { cmd: "t" }), { ok: false, content: "Exit code 1", data: "boom: it failed" });
    expect(m.quotes).toBe(true);
  });
});

describe("maskArguments and maskText", () => {
  it("cut a long string argument and keep the JSON valid", () => {
    const args = JSON.stringify({ path: "src/a.ts", content: "y".repeat(5000), n: 3 });
    const m = maskArguments(args);
    expect(m.length).toBeLessThan(args.length / 4);
    const back = JSON.parse(m) as Record<string, unknown>;
    expect(back.path).toBe("src/a.ts");
    expect(back.n).toBe(3);
    expect(String(back.content)).toContain("more characters, masked");
    expect(String(back.content).startsWith("y".repeat(OLD_ARG_CHARS))).toBe(true);
  });
  it("leave short arguments and text alone, and cut long text", () => {
    expect(maskArguments('{"a":1}')).toBe('{"a":1}');
    expect(maskArguments("not json at all".repeat(100)).length).toBeLessThan(1600);
    expect(maskText("short")).toBe("short");
    expect(maskText("w".repeat(500)).length).toBe(OLD_TEXT_CHARS);
  });
});
