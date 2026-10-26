/**
 * The project brain, connecting the files: import extraction and resolution
 * (tsconfig paths and baseUrl, workspace packages, Python packages and relative
 * imports, Go modules, Dart packages, and a few more), the rank, the test map,
 * and the Merkle diff between two fingerprints.
 */
import { describe, expect, it } from "vitest";
import { buildResolver, extractImports, rankFiles, resolveImport, reverseEdges, joinPath } from "../src/code/project/graph.js";
import { ancestorsOf, ancestorsOfPath, diffSnapshots, fingerprintOf, isUnchanged, rollUp, toRead } from "../src/code/project/merkle.js";
import { extractCore } from "../src/code/project/scan.js";
import { coreKindOf, treeFromEntries } from "../src/code/project/snapshot.js";
import { buildTestMap, testStem, untestedImportant } from "../src/code/project/tests.js";
import { languageOf } from "../src/code/project/lang.js";
import type { CoreEntry } from "../src/code/project/types.js";

/** The repo's files with the core ones read the way the build reads them. */
function world(files: Record<string, string>) {
  const core: Record<string, CoreEntry> = {};
  for (const [p, text] of Object.entries(files)) {
    const kind = coreKindOf(p);
    if (kind) core[p] = { sha: "x", kind, data: extractCore(p, kind, text) };
  }
  const resolver = buildResolver(Object.keys(files), core);
  const resolve = (from: string, text?: string) => {
    const lang = languageOf(from);
    return extractImports(from, lang, text ?? files[from]!).flatMap((i) => resolveImport(resolver, i, from, lang));
  };
  return { core, resolver, resolve };
}

describe("reading import lines", () => {
  const ts = (text: string) => extractImports("a.ts", "TypeScript", text).map((i) => i.spec);

  it("finds import, side-effect import, re-export, require and dynamic import in TS/JS, and not a commented one", () => {
    expect(ts(`import a from './a';
import type { B } from "../b";
import './side-effect.css';
export * from './re';
export { x } from './x';
const c = require('./c');
const d = await import('./d');
import e = require('./e');
// import nope from './nope';
/* import nope2 from './nope2'; */
export const y = 'not an import';
import {
  long,
  list,
} from '@/lib/long';`)).toEqual(["./a", "../b", "./side-effect.css", "./re", "./x", "@/lib/long", "./c", "./d", "./e"]);
  });

  it("finds Python imports, relative ones with their dots and names, and multi-line lists", () => {
    const imps = extractImports("a/b.py", "Python", `import os, sys
import a.b.c as abc
from x.y import (
    one,
    two as dos,
)
from . import sibling
from ..parent import thing
from .mod import *
"""
import not_this
"""`);
    expect(imps).toEqual([
      { spec: "os" }, { spec: "sys" }, { spec: "a.b.c" }, { spec: "x.y", level: 0, names: ["one", "two"] }, { spec: "", level: 1, names: ["sibling"] },
      { spec: "parent", level: 2, names: ["thing"] }, { spec: "mod", level: 1, names: [] },
    ]);
  });

  it("finds Go, Dart, Rust, Ruby, C and Java imports", () => {
    expect(extractImports("a.go", "Go", 'import "fmt"\nimport (\n\t"net/http"\n\tm "example.com/x/store"\n\t_ "embed"\n)').map((i) => i.spec)).toEqual(["net/http", "example.com/x/store", "embed", "fmt"]);
    expect(extractImports("a.dart", "Dart", "import 'package:acme/a.dart';\nimport 'b.dart' as b;\nexport 'c.dart';\npart 'd.g.dart';").map((i) => i.spec)).toEqual(["package:acme/a.dart", "b.dart", "c.dart", "d.g.dart"]);
    expect(extractImports("a.rs", "Rust", "mod util;\npub mod net;\nuse std::io;").map((i) => i.spec)).toEqual(["util", "net"]);
    expect(extractImports("a.rb", "Ruby", "require_relative 'lib/x'\nrequire 'json'").map((i) => i.spec)).toEqual(["lib/x"]);
    expect(extractImports("a.c", "C", '#include "local.h"\n#include <stdio.h>').map((i) => i.spec)).toEqual(["local.h"]);
    expect(extractImports("A.java", "Java", "import com.acme.Foo;\nimport static com.acme.Util.helper;\nimport java.util.*;").map((i) => i.spec)).toEqual(["com.acme.Foo", "com.acme.Util.helper", "java.util"]);
  });
});

describe("resolving TS and JS imports", () => {
  it("resolves relative paths with every extension, a folder's index, and a .js that means .ts", () => {
    const w = world({
      "src/a.ts": "", "src/b.tsx": "", "src/c/index.ts": "", "src/d.js": "", "src/e.ts": "", "src/data.json": "",
      "src/main.ts": "import './a'; import './b'; import './c'; import './d'; import './e.js'; import './data.json'; import './missing'; import 'react';",
    });
    expect(w.resolve("src/main.ts")).toEqual(["src/a.ts", "src/b.tsx", "src/c/index.ts", "src/d.js", "src/e.ts", "src/data.json"]);
  });

  it("follows tsconfig paths (the @/ alias, exact aliases, several targets) and baseUrl", () => {
    const w = world({
      "tsconfig.json": '{\n  // comments and trailing commas are fine\n  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], "@config": ["src/config/index.ts"], "~lib/*": ["nope/*", "src/lib/*"] },\n  },\n}',
      "src/lib/api.ts": "", "src/components/Button.tsx": "", "src/config/index.ts": "", "src/lib/util.ts": "",
      "src/page.ts": "import { f } from '@/lib/api'; import { c } from '@config'; import { u } from '~lib/util'; import B from 'src/components/Button';",
    });
    expect(w.resolve("src/page.ts")).toEqual(["src/lib/api.ts", "src/config/index.ts", "src/lib/util.ts", "src/components/Button.tsx"]);
  });

  it("uses baseUrl alone for a bare import, the config nearest the file, and `extends`", () => {
    const w = world({
      "tsconfig.base.json": '{ "compilerOptions": { "paths": { "@shared/*": ["packages/shared/src/*"] } } }',
      "apps/web/tsconfig.json": '{ "extends": "../../tsconfig.base.json", "compilerOptions": { "baseUrl": "src" } }',
      "apps/web/src/components/Nav.tsx": "", "apps/web/src/page.tsx": "import Nav from 'components/Nav'; import { x } from '@shared/x';",
      "packages/shared/src/x.ts": "",
      "other/src/page.tsx": "import Nav from 'components/Nav';",
    });
    // The child's baseUrl finds Nav; the alias comes from the base config, relative to the folder that config is in.
    expect(w.resolve("apps/web/src/page.tsx")).toEqual(["apps/web/src/components/Nav.tsx", "packages/shared/src/x.ts"]);
    // A file outside apps/web has no baseUrl of src to look in.
    expect(w.resolve("other/src/page.tsx")).toEqual([]);
  });

  it("resolves a monorepo package by its name, with or without a path inside it", () => {
    const w = world({
      "packages/ui/package.json": '{ "name": "@acme/ui", "main": "src/main.ts" }', "packages/ui/src/main.ts": "", "packages/ui/src/button.ts": "", "packages/ui/src/index.ts": "",
      "packages/core/package.json": '{ "name": "@acme/core" }', "packages/core/src/index.ts": "",
      "apps/web/src/a.ts": "import { A } from '@acme/ui'; import b from '@acme/ui/button'; import { C } from '@acme/core'; import z from 'zod';",
    });
    expect(w.resolve("apps/web/src/a.ts")).toEqual(["packages/ui/src/main.ts", "packages/ui/src/button.ts", "packages/core/src/index.ts"]);
  });

  it("does not make an edge to itself", () => {
    const w = world({ "src/a.ts": "import './a';" });
    expect(w.resolve("src/a.ts")).toEqual([]);
  });

  it("joins paths and refuses one that climbs out of the repo", () => {
    expect(joinPath("a/b", "../c/./d")).toBe("a/c/d");
    expect(joinPath("", "../x")).toBeNull();
  });
});

describe("resolving Python imports", () => {
  const files = {
    "api/__init__.py": "", "api/main.py": "", "api/models.py": "", "api/utils/__init__.py": "", "api/utils/helpers.py": "", "api/utils/more.py": "",
    "src/pkg/__init__.py": "", "src/pkg/core.py": "", "pyproject.toml": "[project]\nname = 'x'",
  };

  it("resolves packages and modules by their dotted name from the repo root and from src/", () => {
    const w = world({ ...files, "app.py": "" });
    const r = (text: string) => w.resolve("app.py", text);
    expect(r("import api.models")).toEqual(["api/models.py"]);
    expect(r("import api")).toEqual(["api/__init__.py"]);
    expect(r("from api.utils import helpers")).toEqual(["api/utils/__init__.py", "api/utils/helpers.py"]);
    expect(r("from api.utils.helpers import fmt")).toEqual(["api/utils/helpers.py"]);
    expect(r("from pkg.core import thing")).toEqual(["src/pkg/core.py"]);
    expect(r("import requests\nfrom os import path")).toEqual([]);
  });

  it("resolves relative imports: the package, a sibling, a parent's module, a submodule named after import", () => {
    const w = world(files);
    const r = (from: string, text: string) => w.resolve(from, text);
    expect(r("api/utils/helpers.py", "from ..models import Item")).toEqual(["api/models.py"]);
    expect(r("api/utils/helpers.py", "from . import more")).toEqual(["api/utils/__init__.py", "api/utils/more.py"]);
    expect(r("api/utils/helpers.py", "from .more import x")).toEqual(["api/utils/more.py"]);
    expect(r("api/main.py", "from .utils.helpers import fmt\nfrom .models import Item")).toEqual(["api/utils/helpers.py", "api/models.py"]);
    expect(r("api/utils/helpers.py", "from ... import nothing")).toEqual([]);
  });
});

describe("resolving Go, Dart and the rest", () => {
  it("resolves a Go import under the module to the package folder's files (not its tests), and the nearest module wins", () => {
    const w = world({
      "svc/go.mod": "module example.com/acme/svc\n\ngo 1.22\n", "svc/main.go": "", "svc/internal/store/store.go": "", "svc/internal/store/other.go": "", "svc/internal/store/store_test.go": "",
      "tools/go.mod": "module example.com/acme/tools\n", "tools/gen/gen.go": "",
    });
    const r = (text: string) => w.resolve("svc/main.go", text);
    expect(r('import "example.com/acme/svc/internal/store"')).toEqual(["svc/internal/store/other.go", "svc/internal/store/store.go"]);
    expect(r('import "example.com/acme/tools/gen"')).toEqual(["tools/gen/gen.go"]);
    expect(r('import (\n"fmt"\n"github.com/gin-gonic/gin"\n)')).toEqual([]);
  });

  it("resolves Dart's package:<this package>/ and relative imports", () => {
    const w = world({
      "app/pubspec.yaml": "name: acme_app\ndependencies:\n  flutter:\n    sdk: flutter\n", "app/lib/main.dart": "", "app/lib/screens/home.dart": "", "app/lib/util.dart": "",
    });
    expect(w.resolve("app/lib/main.dart", "import 'package:acme_app/screens/home.dart';\nimport 'util.dart';\nimport 'package:flutter/material.dart';\nimport 'dart:io';")).toEqual(["app/lib/screens/home.dart", "app/lib/util.dart"]);
    expect(w.resolve("app/lib/screens/home.dart", "import '../util.dart';")).toEqual(["app/lib/util.dart"]);
  });

  it("resolves Rust mod, Ruby require_relative, C include and a unique Java import", () => {
    const w = world({
      "src/main.rs": "", "src/util.rs": "", "src/net/mod.rs": "", "lib/a.rb": "", "lib/x/b.rb": "", "c/main.c": "", "c/local.h": "",
      "src/main/java/com/acme/Foo.java": "", "src/main/java/com/acme/Bar.java": "", "other/com/acme/Bar.java": "",
    });
    expect(w.resolve("src/main.rs", "mod util;\nmod net;\nmod missing;")).toEqual(["src/util.rs", "src/net/mod.rs"]);
    expect(w.resolve("lib/a.rb", "require_relative 'x/b'")).toEqual(["lib/x/b.rb"]);
    expect(w.resolve("c/main.c", '#include "local.h"')).toEqual(["c/local.h"]);
    expect(w.resolve("src/main/java/com/acme/Foo.java", "import com.acme.Bar;\nimport com.acme.Foo;")).toEqual([]);
    expect(w.resolve("other/com/acme/Bar.java", "import com.acme.Foo;")).toEqual(["src/main/java/com/acme/Foo.java"]);
  });
});

describe("ranking", () => {
  const edges = (o: Record<string, string[]>) => new Map(Object.entries(o));

  it("gives the file everyone imports the highest rank, 0 to 1, and leaves the loose files at 0", () => {
    const paths = ["util.ts", "a.ts", "b.ts", "c.ts", "lonely.ts", "api.ts"];
    const rank = rankFiles(paths, edges({ "a.ts": ["util.ts", "api.ts"], "b.ts": ["util.ts", "api.ts"], "c.ts": ["util.ts"], "api.ts": ["util.ts"] }));
    expect(rank.get("util.ts")).toBe(1);
    expect(rank.get("api.ts")!).toBeGreaterThan(rank.get("a.ts")!);
    expect(rank.get("lonely.ts")).toBe(0);
    expect(rank.get("a.ts")).toBe(0);
    for (const r of rank.values()) { expect(r).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(1); }
  });

  it("counts a file imported by an important file for more than one imported by a loose one (PageRank, not just in-degree)", () => {
    // hub is imported by 4 files; deep is imported once, by hub; shallow is imported once, by a leaf.
    const paths = ["hub.ts", "deep.ts", "shallow.ts", "l1.ts", "l2.ts", "l3.ts", "l4.ts"];
    const rank = rankFiles(paths, edges({ "l1.ts": ["hub.ts"], "l2.ts": ["hub.ts"], "l3.ts": ["hub.ts"], "l4.ts": ["hub.ts", "shallow.ts"], "hub.ts": ["deep.ts"] }));
    expect(rank.get("deep.ts")!).toBeGreaterThan(rank.get("shallow.ts")!);
  });

  it("leaves out the imports of tests, and is all zeros for a repo with no edges", () => {
    const rank = rankFiles(["a.ts", "a.test.ts"], edges({ "a.test.ts": ["a.ts"] }), (p) => p.includes(".test."));
    expect(rank.get("a.ts")).toBe(0);
    expect([...rankFiles(["x", "y"], edges({})).values()]).toEqual([0, 0]);
    expect(rankFiles([], edges({})).size).toBe(0);
  });

  it("ignores edges to files that are not in the list, and an edge to itself", () => {
    const rank = rankFiles(["a.ts", "b.ts"], edges({ "a.ts": ["a.ts", "ghost.ts", "b.ts"] }));
    expect(rank.get("b.ts")).toBe(1);
  });

  it("says who imports a file, one hop back", () => {
    const rev = reverseEdges(edges({ "a.ts": ["c.ts"], "b.ts": ["c.ts", "a.ts"] }));
    expect(rev.get("c.ts")).toEqual(["a.ts", "b.ts"]);
    expect(rev.get("a.ts")).toEqual(["b.ts"]);
  });
});

describe("the test map", () => {
  const f = (paths: string[], imports: Record<string, string[]> = {}) => paths.map((p) => ({ path: p, lang: languageOf(p), imports: imports[p] ?? [] }));
  const map = (paths: string[], imports: Record<string, string[]> = {}, deps: string[] = [], kinds: string[] = []) => buildTestMap(f(paths, imports), deps, new Set(kinds));

  it("takes the name a test is named for out of every convention", () => {
    for (const [file, stem] of [
      ["src/x.test.ts", "x"], ["src/x.spec.tsx", "x"], ["tests/test_x.py", "x"], ["tests/x_test.py", "x"], ["pkg/x_test.go", "x"], ["test/x_test.dart", "x"],
      ["src/test/java/XTest.java", "X"], ["XTests.kt", "X"], ["spec/x_spec.rb", "x"], ["tests/XTest.php", "X"], ["Tests/XTests.swift", "X"], ["cypress/e2e/x.cy.ts", "x"],
    ]) expect(testStem(file), file).toBe(stem);
  });

  it("maps tests to sources by name, whichever way the project names them", () => {
    const m = map([
      "src/x.ts", "src/x.test.ts", "src/y.tsx", "src/__tests__/y.test.tsx", "lib/z.py", "tests/test_z.py", "pkg/w.go", "pkg/w_test.go", "app/lib/v.dart", "app/test/v_test.dart",
      "src/main/java/com/Foo.java", "src/test/java/com/FooTest.java", "lib/q.rb", "spec/q_spec.rb",
    ]);
    expect([...m.testsFor]).toEqual([
      ["src/x.ts", ["src/x.test.ts"]], ["src/y.tsx", ["src/__tests__/y.test.tsx"]], ["lib/z.py", ["tests/test_z.py"]], ["pkg/w.go", ["pkg/w_test.go"]], ["app/lib/v.dart", ["app/test/v_test.dart"]],
      ["src/main/java/com/Foo.java", ["src/test/java/com/FooTest.java"]], ["lib/q.rb", ["spec/q_spec.rb"]],
    ]);
    expect(m.testFiles).toHaveLength(7);
  });

  it("takes the nearest source when two files share the name, and the test's folder stands for the source's", () => {
    const m = map(["web/src/auth/index.ts", "api/src/auth/index.ts", "api/tests/auth/index.test.ts", "web/src/auth/other.ts"]);
    expect(m.testsFor.get("api/src/auth/index.ts")).toEqual(["api/tests/auth/index.test.ts"]);
    expect(m.testsFor.has("web/src/auth/index.ts")).toBe(false);
  });

  it("maps a test to what it imports, besides what it is named for", () => {
    const m = map(["src/a.ts", "src/b.ts", "src/c.ts", "tests/flow.test.ts"], { "tests/flow.test.ts": ["src/a.ts", "src/b.ts", "tests/helper.test.ts"] });
    expect(m.testsFor.get("src/a.ts")).toEqual(["tests/flow.test.ts"]);
    expect(m.testsFor.get("src/b.ts")).toEqual(["tests/flow.test.ts"]);
    expect(m.testsFor.has("src/c.ts")).toBe(false);
  });

  it("detects the test framework from the dependencies and the files", () => {
    expect(map(["a.ts"], {}, ["vitest", "@testing-library/react", "@playwright/test"]).frameworks).toEqual(["Vitest", "Playwright", "Testing Library"]);
    expect(map(["svc/a_test.go", "svc/a.go"]).frameworks).toEqual(["go test"]);
    expect(map(["tests/test_a.py", "a.py"], {}, ["pytest"]).frameworks).toEqual(["pytest"]);
    expect(map(["tests/test_a.py", "a.py"]).frameworks).toEqual(["unittest"]);
    expect(map(["a.rs"], {}, [], ["cargo"]).frameworks).toEqual(["cargo test"]);
    expect(map(["app/test/a_test.dart"], {}, ["flutter_test"]).frameworks).toEqual(["flutter_test"]);
    expect(map(["spec/a_spec.rb"]).frameworks).toEqual(["RSpec"]);
    expect(map(["a.ts"]).frameworks).toEqual([]);
  });

  it("lists the hot or central files that have no test", () => {
    const rows = [
      { path: "a.ts", hot: 5, rank: 0.9, tests: [], isTest: false, lang: "TypeScript" },
      { path: "b.ts", hot: 5, rank: 0.9, tests: ["b.test.ts"], isTest: false, lang: "TypeScript" },
      { path: "c.ts", hot: 0, rank: 0.05, tests: [], isTest: false, lang: "TypeScript" },
      { path: "d.ts", hot: 1, rank: 0, tests: [], isTest: false, lang: "TypeScript" },
      { path: "e.test.ts", hot: 9, rank: 0, tests: [], isTest: true, lang: "TypeScript" },
      { path: "README.md", hot: 9, rank: 0, tests: [], isTest: false, lang: "Markdown" },
    ];
    expect(untestedImportant(rows)).toEqual(["a.ts", "d.ts"]);
  });
});

describe("what changed since last time (git's own shas)", () => {
  const fp = (files: Record<string, string>, dirs: Record<string, string> = {}) => ({ files: new Map(Object.entries(files)), dirs: new Map(Object.entries(dirs)) });

  it("finds the added, the changed and the removed files, and the folders whose sha moved", () => {
    const prev = fp({ "a.ts": "1", "b.ts": "2", "src/c.ts": "3", "src/d.ts": "4" }, { "": "R1", src: "S1" });
    const next = fp({ "a.ts": "1", "b.ts": "2x", "src/c.ts": "3", "src/e.ts": "5", "new/f.ts": "6" }, { "": "R2", src: "S2", new: "N1" });
    const d = diffSnapshots(prev, next);
    expect(d).toEqual({ added: ["new/f.ts", "src/e.ts"], changed: ["b.ts"], removed: ["src/d.ts"], changedDirs: ["", "new", "src"], removedDirs: [] });
    expect(toRead(d)).toEqual(["new/f.ts", "src/e.ts", "b.ts"]);
    expect(isUnchanged(d)).toBe(false);
  });

  it("says nothing changed for the same tree, and everything for the first time", () => {
    const same = fp({ "a.ts": "1" }, { "": "R" });
    expect(isUnchanged(diffSnapshots(same, same))).toBe(true);
    expect(diffSnapshots(fp({}), same).added).toEqual(["a.ts"]);
  });

  it("names the folders that went", () => {
    const d = diffSnapshots(fp({ "x/a.ts": "1" }, { "": "R1", x: "X" }), fp({}, { "": "R2" }));
    expect(d.removed).toEqual(["x/a.ts"]);
    expect(d.removedDirs).toEqual(["x"]);
  });

  it("rolls a change up to the root: the folders above a changed file whose sha moved, and the root, and no others", () => {
    const prev = fp({ "src/lib/a.ts": "1", "src/other/b.ts": "2", "lock.json": "L" }, { "": "R1", src: "S1", "src/lib": "L1", "src/other": "O1" });
    const next = fp({ "src/lib/a.ts": "1x", "src/other/b.ts": "2", "lock.json": "L2" }, { "": "R2", src: "S2", "src/lib": "L2", "src/other": "O1" });
    expect([...rollUp(diffSnapshots(prev, next))].sort()).toEqual(["", "src", "src/lib"]);
    // A change that is not in a file we analyse moves its folder's sha but is not above any changed file.
    const onlyLock = diffSnapshots(fp({ "src/a.ts": "1" }, { "": "R1", src: "S" }), fp({ "src/a.ts": "1" }, { "": "R2", src: "S" }));
    expect([...rollUp(onlyLock)]).toEqual([]);
  });

  it("lists the folders above a path, nearest first, and above many", () => {
    expect(ancestorsOfPath("a/b/c.ts")).toEqual(["a/b", "a", ""]);
    expect(ancestorsOfPath("c.ts")).toEqual([""]);
    expect([...ancestorsOf(["a/b/c.ts", "a/d.ts", "e.ts"])].sort()).toEqual(["", "a", "a/b"]);
  });

  it("takes a fingerprint of a tree, or of just the files that are analysed", () => {
    const tree = treeFromEntries("h", "t", [
      { path: "src", type: "tree", sha: "S" }, { path: "src/a.ts", type: "blob", size: 1, sha: "A" }, { path: "logo.png", type: "blob", size: 1, sha: "P" },
    ], false);
    expect([...fingerprintOf(tree).files]).toEqual([["src/a.ts", "A"], ["logo.png", "P"]]);
    expect([...fingerprintOf(tree, ["src/a.ts", "ghost"]).files]).toEqual([["src/a.ts", "A"]]);
    expect([...fingerprintOf(tree).dirs]).toEqual([["", "t"], ["src", "S"]]);
  });
});
