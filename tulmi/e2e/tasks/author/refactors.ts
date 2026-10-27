/**
 * REFACTORS WITH WIDE IMPACT: A NAME OR AN API USED ACROSS MANY FILES. THE HIDDEN CHECKS ARE THAT THE WHOLE SUITE STAYS GREEN, THAT NOTHING OF THE OLD
 * NAME IS LEFT BEHIND, AND THAT THE NEW ONE IS THERE. The oracle patches are made by applying the rename to every file of the pinned project that mentions it.
 */
import type { Task } from "../schema.js";
import { baseFiles, baseText, edit, task } from "./lib.js";

async function viteClassNames(): Promise<Task> {
  const all = (await baseFiles("bulletproof-vite", "src")).filter((p) => /\.(ts|tsx)$/.test(p));
  const files: Record<string, string | null> = {};
  const touched: string[] = [];
  for (const p of all) {
    const text = await baseText("bulletproof-vite", p);
    if (!/\bcn\b/.test(text) || p === "src/utils/cn.ts") continue;
    const next = text
      .replace(/from '@\/utils\/cn'/g, "from '@/utils/class-names'")
      .replace(/import \{ cn \}/g, "import { classNames }")
      .replace(/\bcn\(/g, "classNames(");
    if (/\bcn\b/.test(next)) throw new Error(`${p}: a use of cn the rename does not cover`);
    files[p] = next;
    touched.push(p);
  }
  const old = await baseText("bulletproof-vite", "src/utils/cn.ts");
  files["src/utils/class-names.ts"] = edit(old, "export function cn(", "export function classNames(");
  files["src/utils/cn.ts"] = null;
  const test = `import { classNames } from '../class-names';

test('joins class names and drops falsy ones', () => {
  expect(classNames('a', false && 'b', undefined, 'c', null)).toBe('a c');
});

test('merges conflicting tailwind classes, the last one wins', () => {
  expect(classNames('p-2 text-sm', 'p-4')).toBe('text-sm p-4');
});

test('takes objects and arrays like clsx', () => {
  expect(classNames(['a', { b: true, c: false }], 'd')).toBe('a b d');
});

test('the old helper module is gone', () => {
  const modules = Object.keys(import.meta.glob('../*.ts'));
  expect(modules.some((m) => m.endsWith('/cn.ts'))).toBe(false);
  expect(modules.some((m) => m.endsWith('/class-names.ts'))).toBe(true);
});
`;
  return task({
    id: "bulletproof-vite-refactor-classnames",
    title: "Rename the cn helper to classNames everywhere",
    category: "refactor",
    repo: "bulletproof-vite",
    request:
      "The `cn` helper in src/utils is too cryptic. Rename it to `classNames` and move it to `src/utils/class-names.ts`, then update every place that uses it. "
      + "Nothing else about it changes, the old file goes away, and the whole test suite has to stay green.",
    difficulty: 3,
    tags: ["refactor", "wide", "bakeoff", "vite-react", "bulletproof-vite"],
    truth: { files: [...touched, "src/utils/class-names.ts", "src/utils/cn.ts"], allowed: ["^src/utils/__tests__/"] },
    hidden: { files: { "src/utils/__tests__/class-names.test.ts": test }, run: ["src/utils/__tests__/class-names.test.ts"], kind: "tests", minTests: 4 },
    oracle: { kind: "patch", files, classify: { type: "refactor" }, plan: "Move the helper to its new name and file, update each importer and call" },
    checks: {
      suite: true, questions: { max: 1 }, expectPr: true,
      noLeftovers: [{ pattern: "\\bcn\\(|utils/cn['\"]|\\{ cn \\}", except: ["^src/utils/__tests__/"] }],
      mustContain: [{ path: "src/utils/class-names.ts", pattern: "export function classNames" }],
    },
  });
}

async function changesetsIsSkipped(): Promise<Task> {
  const all = [
    "assemble-release-plan/src/match-fixed-constraint.ts", "assemble-release-plan/src/determine-dependents.ts", "assemble-release-plan/src/index.ts",
    "assemble-release-plan/src/flatten-releases.ts", "should-skip-package/src/index.ts", "config/src/rules.ts", "cli/src/utils/versionablePackages.ts",
    "cli/src/commands/git-tag/index.ts", "cli/src/commands/publish-plan/getPublishPlan.ts", "cli/src/commands/add/index.ts", "cli/src/commands/version/index.ts",
    "apply-release-plan/src/index.ts",
  ].map((p) => `packages/${p}`);
  const files: Record<string, string | null> = {};
  for (const p of all) {
    const text = await baseText("changesets", p);
    if (!/\bshouldSkipPackage\b/.test(text)) throw new Error(`${p} does not mention shouldSkipPackage any more`);
    files[p] = text.replace(/\bshouldSkipPackage\b/g, "isSkippedPackage");
  }
  const test = `import { describe, expect, it } from "vitest";
import * as mod from "./index.ts";
import type { Package } from "@changesets/types";

const pkg = (name: string, extra: Record<string, unknown> = {}): Package => ({
  dir: "/x",
  packageJson: { name, version: "1.0.0", ...extra },
});

describe("isSkippedPackage", () => {
  it("is exported under the new name only", () => {
    expect(typeof (mod as Record<string, unknown>).isSkippedPackage).toBe("function");
    expect((mod as Record<string, unknown>).shouldSkipPackage).toBeUndefined();
  });

  it("skips a package in the ignore list", () => {
    expect(mod.isSkippedPackage(pkg("a"), { ignore: ["a"], allowPrivatePackages: true })).toBe(true);
  });

  it("skips a private package unless private packages are allowed", () => {
    expect(mod.isSkippedPackage(pkg("a", { private: true }), { ignore: [], allowPrivatePackages: false })).toBe(true);
    expect(mod.isSkippedPackage(pkg("a", { private: true }), { ignore: [], allowPrivatePackages: true })).toBe(false);
  });

  it("skips a package that has no version", () => {
    expect(mod.isSkippedPackage({ dir: "/x", packageJson: { name: "a" } } as Package, { ignore: [], allowPrivatePackages: true })).toBe(true);
  });

  it("keeps a normal package", () => {
    expect(mod.isSkippedPackage(pkg("a"), { ignore: ["b"], allowPrivatePackages: false })).toBe(false);
  });
});
`;
  return task({
    id: "changesets-refactor-isskipped",
    title: "Rename shouldSkipPackage to isSkippedPackage across the packages",
    category: "refactor",
    repo: "changesets",
    request:
      "`shouldSkipPackage` from the should-skip-package package reads badly next to the other predicates. Rename the function to `isSkippedPackage` and update every package that imports or calls it. "
      + "The behaviour must not change, the old name must not be left behind anywhere, and the whole test suite has to stay green.",
    difficulty: 3,
    tags: ["refactor", "wide", "bakeoff", "ts-monorepo", "changesets"],
    truth: { files: all, allowed: ["^packages/should-skip-package/", "^\\.changeset/", "CHANGELOG"] },
    hidden: { files: { "packages/should-skip-package/src/index.test.ts": test }, run: ["packages/should-skip-package/src/index.test.ts"], kind: "tests", minTests: 5 },
    oracle: { kind: "patch", files, classify: { type: "refactor" }, plan: "Rename the exported function and each import and call across the packages" },
    checks: { suite: true, questions: { max: 1 }, expectPr: true, noLeftovers: [{ pattern: "\\bshouldSkipPackage\\b", except: ["CHANGELOG", "^\\.changeset/", "^packages/should-skip-package/src/index\\.test\\.ts$"] }] },
  });
}

async function flaskIsDebugEnabled(): Promise<Task> {
  const paths = ["src/flask/helpers.py", "src/flask/app.py", "src/flask/sansio/app.py", "src/flask/cli.py", "tests/test_helpers.py"];
  const files: Record<string, string | null> = {};
  for (const p of paths) {
    let text = await baseText("flask", p);
    if (p === "src/flask/helpers.py") {
      text = edit(text, "def get_debug_flag() -> bool:", "def is_debug_enabled() -> bool:");
      text = edit(text, "    val = os.environ.get(\"FLASK_DEBUG\")\n    return bool(val and val.lower() not in {\"0\", \"false\", \"no\"})\n", "    val = os.environ.get(\"FLASK_DEBUG\")\n    return bool(val and val.lower() not in {\"0\", \"false\", \"no\"})\n\n\ndef get_debug_flag() -> bool:\n    \"\"\"Deprecated name of :func:`is_debug_enabled`.\"\"\"\n    warnings.warn(\n        \"'get_debug_flag' is deprecated and will be removed in Flask 3.3. Use\"\n        \" 'is_debug_enabled' instead.\",\n        DeprecationWarning,\n        stacklevel=2,\n    )\n    return is_debug_enabled()\n");
      text = edit(text, "import sys\nimport typing as t\n", "import sys\nimport typing as t\nimport warnings\n");
    } else {
      text = text.replace(/\bget_debug_flag\b/g, "is_debug_enabled");
    }
    files[p] = text;
  }
  const test = `import warnings

import pytest

from flask import Flask
from flask.helpers import get_debug_flag
from flask.helpers import is_debug_enabled


@pytest.mark.parametrize(
    ("value", "expect"), [(None, False), ("", False), ("0", False), ("false", False), ("No", False), ("1", True), ("true", True)]
)
def test_new_name(monkeypatch, value, expect):
    if value is None:
        monkeypatch.delenv("FLASK_DEBUG", raising=False)
    else:
        monkeypatch.setenv("FLASK_DEBUG", value)
    assert is_debug_enabled() is expect


def test_old_name_still_works_but_warns(monkeypatch):
    monkeypatch.setenv("FLASK_DEBUG", "1")
    with pytest.deprecated_call(match="is_debug_enabled"):
        assert get_debug_flag() is True


def test_flask_itself_no_longer_calls_the_old_name(monkeypatch):
    monkeypatch.setenv("FLASK_DEBUG", "1")
    with warnings.catch_warnings():
        warnings.simplefilter("error", DeprecationWarning)
        app = Flask("quiet")
        assert app.config["DEBUG"] is True
        app.run  # the attribute exists; running the server is not the point
`;
  return task({
    id: "flask-refactor-isdebugenabled",
    title: "Rename get_debug_flag to is_debug_enabled",
    category: "refactor",
    repo: "flask",
    request:
      "`flask.helpers.get_debug_flag` is named like a getter of a flag, but it answers a yes or no question. Rename it to `is_debug_enabled` and use the new name in all of Flask's own code and tests. "
      + "Anyone importing the old name must keep working, with a DeprecationWarning that names the new one, and Flask itself must no longer trigger that warning. The whole test suite has to stay green.",
    difficulty: 3,
    tags: ["refactor", "wide", "bakeoff", "python-web", "flask"],
    truth: { files: paths, allowed: ["^tests/", "^CHANGES\\.rst$", "^docs/"] },
    hidden: { files: { "tests/test_debug_name.py": test }, run: ["tests/test_debug_name.py"], kind: "tests", minTests: 9 },
    oracle: { kind: "patch", files, classify: { type: "refactor" }, plan: "Rename in helpers, keep a deprecated alias, update the callers and the existing test" },
    checks: {
      suite: true, questions: { max: 1 }, expectPr: true,
      noLeftovers: [{ pattern: "\\bget_debug_flag\\b", except: ["^src/flask/helpers\\.py$", "^CHANGES\\.rst$", "^docs/", "^tests/test_debug_name\\.py$"] }],
      mustContain: [{ path: "src/flask/helpers.py", pattern: "def is_debug_enabled" }],
    },
  });
}

export async function tasks(): Promise<Task[]> {
  return [await viteClassNames(), await changesetsIsSkipped(), await flaskIsDebugEnabled()];
}
