/**
 * WHICH TESTS COVER WHICH FILE, AND WHICH IMPORTANT FILES HAVE NONE.
 *
 * The bot changes code, and the tests that cover that code are the cheapest
 * proof it didn't break anything. So the project brain knows, for each source
 * file, the test files that belong to it:
 *
 *   by name      `x.test.ts`, `x.spec.tsx`, `__tests__/x.ts` for x.ts;
 *                `test_x.py` and `x_test.py` for x.py; `x_test.go` for x.go;
 *                `x_test.dart`, `XTest.java`/`XTests.kt`/`XTest.php`/`XTests.cs`,
 *                `x_spec.rb`, `XTests.swift`. Where several files share the
 *                name, the one nearest the test (the longest shared folder
 *                path, a `tests/` or `__tests__/` folder standing for `src/`)
 *   by import    a test file that imports a source file covers it
 *
 * testsFor(path) is that list. The test framework is read from the
 * dependencies and the file names (jest, vitest, mocha, playwright, cypress,
 * pytest, unittest, go test, cargo test, JUnit, flutter_test, RSpec, PHPUnit,
 * XCTest...), and the FILES THAT MATTER WITH NO TEST (hot or central, and
 * uncovered) are what a first task, and a careful change, look at.
 *
 * Pure: it works from paths and the import graph.
 */
import { baseName, dirName, extOf, isTestPath } from "./lang.js";

/** The name a test file is named for: `x.test.ts` and `test_x.py` and `XTest.java` are all about x. */
export function testStem(path: string): string {
  let b = baseName(path);
  const ext = extOf(path);
  if (ext) b = b.slice(0, -(ext.length + 1));
  b = b.replace(/\.(?:test|spec|e2e|cy)$/i, "").replace(/^test_/, "").replace(/_(?:test|spec)$/, "");
  b = b.replace(/(?:Tests?|Spec|IT)$/, "");
  return b;
}

/** A name for a source file to be matched on. */
const stemOf = (path: string): string => {
  const b = baseName(path);
  const ext = extOf(path);
  return ext ? b.slice(0, -(ext.length + 1)) : b;
};

/** Folders a test lives in that stand for the source's own: tests/foo/ for src/foo/. */
const TEST_FOLDER = /(^|\/)(?:__tests__|tests?|spec|specs|e2e|cypress|integration[-_]tests?)(?=\/|$)/gi;

const closeness = (test: string, src: string): number => {
  // Take the test folders out of the test's path, then count the shared leading folders.
  const t = dirName(test).replace(TEST_FOLDER, "$1").split("/").filter(Boolean);
  const s = dirName(src).split("/").filter(Boolean);
  let n = 0;
  while (n < t.length && n < s.length && t[n] === s[n]) n += 1;
  // Folders that match after the leading `src`/`lib`/`app` are left out of the source's.
  const s2 = s.filter((p) => !["src", "lib", "app", "main", "java", "kotlin", "python"].includes(p));
  let m = 0;
  while (m < t.length && m < s2.length && t[m] === s2[m]) m += 1;
  return Math.max(n, m) * 10 - Math.abs(t.length - s2.length);
};

export interface TestFileFacts { path: string; lang: string; imports: readonly string[] }

export interface TestMap {
  frameworks: string[];
  testFiles: string[];
  /** Source path to the test files that cover it. */
  testsFor: Map<string, string[]>;
}

/** Test frameworks by dependency name. */
const FRAMEWORK_DEPS: Array<[RegExp | string, string]> = [
  ["vitest", "Vitest"], ["jest", "Jest"], ["mocha", "Mocha"], ["jasmine", "Jasmine"], ["ava", "AVA"], ["@playwright/test", "Playwright"], ["cypress", "Cypress"],
  [/^@testing-library\//, "Testing Library"], ["pytest", "pytest"], ["nose2", "nose2"], ["hypothesis", "Hypothesis"],
  ["rspec", "RSpec"], ["rspec-rails", "RSpec"], ["minitest", "Minitest"], ["phpunit/phpunit", "PHPUnit"], ["pestphp/pest", "Pest"],
  ["flutter_test", "flutter_test"], ["test", "dart test"], [/^org\.junit|^junit:/, "JUnit"], ["org.testng:testng", "TestNG"], [/^io\.kotest/, "Kotest"],
  ["xunit", "xUnit"], ["NUnit", "NUnit"], ["MSTest.TestFramework", "MSTest"],
];

export function buildTestMap(files: readonly TestFileFacts[], deps: readonly string[], coreKinds: ReadonlySet<string>): TestMap {
  const tests = files.filter((f) => isTestPath(f.path) && !/\.(?:md|json|ya?ml|html?)$/i.test(f.path));
  const testSet = new Set(tests.map((t) => t.path));
  const sources = files.filter((f) => !testSet.has(f.path) && !isTestPath(f.path) && !/\.(?:md|mdx|json|ya?ml|toml|html?|css|scss|less|xml)$/i.test(f.path));
  const byStem = new Map<string, string[]>();
  for (const s of sources) {
    const k = stemOf(s.path);
    const l = byStem.get(k);
    if (l) l.push(s.path); else byStem.set(k, [s.path]);
  }

  const map = new Map<string, Set<string>>();
  const link = (src: string, test: string) => { const s = map.get(src) ?? new Set(); s.add(test); map.set(src, s); };

  for (const t of tests) {
    const stem = testStem(t.path);
    const same = (byStem.get(stem) ?? []).filter((p) => extOf(p) === extOf(t.path) || languageFamily(p) === languageFamily(t.path));
    if (same.length === 1) link(same[0]!, t.path);
    else if (same.length > 1) {
      const scored = same.map((p) => ({ p, c: closeness(t.path, p) })).sort((a, b) => b.c - a.c);
      const best = scored[0]!.c;
      for (const x of scored.filter((y) => y.c === best).slice(0, 3)) link(x.p, t.path);
    }
    // What the test imports and is not a test itself.
    for (const imp of t.imports.slice(0, 40)) {
      if (!testSet.has(imp) && byStem.get(stemOf(imp))?.includes(imp)) link(imp, t.path);
    }
  }

  const present = new Set(deps);
  const found = new Set<string>();
  for (const [m, label] of FRAMEWORK_DEPS) {
    if (typeof m === "string" ? present.has(m) : [...present].some((d) => m.test(d))) found.add(label);
  }
  const has = (re: RegExp) => tests.some((t) => re.test(t.path));
  if (has(/_test\.go$/)) found.add("go test");
  if (coreKinds.has("cargo") && (has(/(?:^|\/)tests\/[^/]+\.rs$/) || files.some((f) => f.lang === "Rust"))) found.add("cargo test");
  if (has(/(?:^|\/)test_[^/]+\.py$|_test\.py$/) && !found.has("pytest")) found.add("unittest");
  if (has(/Tests?\.swift$/)) found.add("XCTest");
  if (has(/_spec\.rb$/) && !found.has("RSpec")) found.add("RSpec");
  else if (has(/_test\.rb$/) && !found.has("RSpec")) found.add("Minitest");

  const testsFor = new Map<string, string[]>();
  for (const [src, set] of map) testsFor.set(src, [...set].sort());
  return { frameworks: [...found], testFiles: tests.map((t) => t.path).sort(), testsFor };
}

/** The family a file's language belongs to, so `x.test.ts` can cover `x.tsx` and `x.js`. */
function languageFamily(path: string): string {
  const e = extOf(path);
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "vue", "svelte"].includes(e)) return "js";
  if (["kt", "kts", "java"].includes(e)) return "jvm";
  return e;
}

/** Hot or central files with no test: the ones a careful change looks at first. */
export function untestedImportant(
  files: ReadonlyArray<{ path: string; hot: number; rank: number; tests: readonly string[]; isTest: boolean; lang: string }>, limit = 10,
): string[] {
  return files
    .filter((f) => !f.isTest && f.tests.length === 0 && (f.hot > 0 || f.rank >= 0.2) && /^(?:TypeScript|JavaScript|Python|Go|Rust|Java|Kotlin|Dart|Ruby|PHP|Swift|C#|C|C\+\+|Vue|Svelte)$/.test(f.lang))
    .sort((a, b) => (b.hot * 2 + b.rank * 10) - (a.hot * 2 + a.rank * 10) || (a.path < b.path ? -1 : 1))
    .slice(0, limit).map((f) => f.path);
}

