/**
 * THE PROJECT'S TESTS DECIDE, SO THE MODEL MAY NOT WEAKEN THEM.
 *
 * A job is done when the project's own checks pass on the staged edits (phases.ts verify). The cheapest way to make a failing test pass is to change the
 * test, so an existing test file is locked: an edit may add tests and assertions, and change lines (a rename, a new argument), but it may not leave the
 * file with fewer tests or fewer assertions than the branch has, skip or narrow one (.skip, .only, xit, @pytest.mark.skip), or delete the file. A new
 * test file is the model's own and free.
 *
 * Unless the person asked for it: a task that says to change, fix, remove or update tests, or to remove, delete or drop something (whose tests go with
 * it), may change them. The lock counts, it does not read meaning: a test whose expected value was edited keeps its count, and the person sees that in
 * the diff.
 */

const TEST_CASES = /\bx?(?:it|test|describe|context)(?:\.(?:skip|only|todo|concurrent|each\s*\([^)]*\)))*\s*\(|\bdef\s+test_\w+|\bfunc\s+Test\w+\s*\(|#\[test\]|@Test\b/g;
const ASSERTIONS = /\bexpect\s*\(|\bassert(?:_\w+|\.\w+)?\s*\(|\bassert\s+\S|\bself\.assert\w+\s*\(|\bt\.(?:is|not|deepEqual|true|false|ok|equal|throws|snapshot)\s*\(|\.should\b|\b(?:assertEquals|assertTrue|assertFalse|assertThat)\s*\(|\bt\.(?:Error|Fatal|Errorf|Fatalf)\s*\(/g;
const SKIPS = /\.(?:skip|only|todo)\s*\(|\bx(?:it|describe|test)\s*\(|@pytest\.mark\.(?:skip|skipif|xfail)\b|@unittest\.skip|\bt\.Skip(?:Now|f)?\s*\(|#\[ignore\]|@Disabled\b|@Ignore\b/g;

/** The person asked for the tests to change, or for something to go (its tests go with it). */
export const TESTS_ASKED = /\b(?:fix|update|change|rewrite|edit|remove|delete|drop|replace|migrate|move|rename|clean\s*up|refactor)\b[^.\n]{0,40}\b(?:tests?|specs?|assertions?|fixtures?)\b|\b(?:tests?|specs?)\b[^.\n]{0,30}\b(?:wrong|outdated|out of date|flaky|broken|stale|obsolete)\b|\b(?:remove|delete|drop|deprecate)\b/i;

const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Why staging `next` over an existing test file `original` would weaken it, or null when it doesn't. `next` null is a delete. */
export function weakenedTests(original: string, next: string | null): string | null {
  if (next === null) return "it would delete a test file the project has";
  const cases = count(original, TEST_CASES) - count(next, TEST_CASES);
  if (cases > 0) return `it would remove ${plural(cases, "test")}`;
  const asserts = count(original, ASSERTIONS) - count(next, ASSERTIONS);
  if (asserts > 0) return `it would remove ${plural(asserts, "assertion")}`;
  const skips = count(next, SKIPS) - count(original, SKIPS);
  if (skips > 0) return `it would skip or narrow ${plural(skips, "test")}`;
  return null;
}

/** The refusal the model reads. */
export function lockedWords(path: string, why: string): string {
  return `${path} is one of the project's tests, and they decide when this job is done, so they are locked: ${why}. Change the code so they pass; you may add new tests or assertions.`;
}
