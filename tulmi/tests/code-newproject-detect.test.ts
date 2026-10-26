/**
 * IS THIS REPO EMPTY? (src/code/newproject/detect.ts): no files, or only README, LICENSE, .gitignore and the like.
 *
 * Against brains made of rows we chose, shaped as the real build leaves them: a LICENSE and a .gitignore are not text the
 * brain reads, so they are the files that make up the difference between the tree's count and the rows.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
});

const { fixtureBrain, sym } = await import("./work-fixtures.js");
const { isEmptyRepo, emptyRepoVerdict, isBoilerplate } = await import("../src/code/newproject/detect.js");

describe("isEmptyRepo", () => {
  it("a repo with no commits is empty", async () => {
    const f = await fixtureBrain({ files: [], structure: { fileCount: 0 } });
    await f.setRow({ headSha: "" });
    expect(await emptyRepoVerdict(f.brain)).toEqual({ empty: true, reason: "no_commits", found: [] });
    expect(await isEmptyRepo(f.brain)).toBe(true);
  });

  it("a repo with commits and no files is empty", async () => {
    const f = await fixtureBrain({ files: [], structure: { fileCount: 0 } });
    expect(await emptyRepoVerdict(f.brain)).toMatchObject({ empty: true, reason: "no_files" });
  });

  it("a README, a LICENSE and a .gitignore are an empty repo", async () => {
    // README is a row; LICENSE and .gitignore are in the tree and not read.
    const f = await fixtureBrain({ files: [{ path: "README.md", lang: "Markdown" }], structure: { fileCount: 3 } });
    expect(await emptyRepoVerdict(f.brain)).toEqual({ empty: true, reason: "only_boilerplate", found: ["README.md"] });
  });

  it("so are the other things a host or a habit puts in a new repo", async () => {
    const f = await fixtureBrain({
      files: ["README.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "CHANGELOG.md", ".github/ISSUE_TEMPLATE/bug.md", ".github/FUNDING.yml", ".github/workflows/ci.yml", ".editorconfig", "docs/README.md"].map((path) => ({ path, lang: "Markdown" })),
      structure: { fileCount: 12 },
    });
    // docs/README.md is a README by name
    expect((await emptyRepoVerdict(f.brain)).empty).toBe(true);
  });

  it("a repo with any code in it is not empty", async () => {
    const f = await fixtureBrain({
      files: [{ path: "README.md" }, { path: "src/index.ts", symbols: [sym("main")] }],
      structure: { fileCount: 4, languages: [{ lang: "TypeScript", bytes: 100, files: 1, pct: 100 }] },
    });
    expect(await emptyRepoVerdict(f.brain)).toEqual({ empty: false, reason: "has_files", found: [] });
  });

  it("a manifest or a lockfile is a project, however little code is in it", async () => {
    expect((await emptyRepoVerdict((await fixtureBrain({ files: [{ path: "README.md" }, { path: "package.json" }], structure: { fileCount: 3 } })).brain)).empty).toBe(false);
    expect((await emptyRepoVerdict((await fixtureBrain({ files: [{ path: "README.md" }], structure: { fileCount: 2, lockfiles: ["package-lock.json"], packageManagers: ["npm"] } })).brain)).empty).toBe(false);
  });

  it("a repo of pictures, or one with many files the brain did not read, is not empty", async () => {
    const pics = await fixtureBrain({ files: [{ path: "README.md" }], structure: { fileCount: 5, skipped: { vendored: 0, generated: 0, binary: 4, tooBig: 0, lockfiles: 0, secret: 0, capped: 0 } } });
    expect((await emptyRepoVerdict(pics.brain)).empty).toBe(false);
    const many = await fixtureBrain({ files: [{ path: "README.md" }], structure: { fileCount: 40 } });
    expect((await emptyRepoVerdict(many.brain)).empty).toBe(false);
  });

  it("a brain that was never built says nothing: it is not called empty", async () => {
    const none = { status: async () => ({ status: "none", structure: null }), paths: async () => [] } as never;
    expect(await emptyRepoVerdict(none)).toEqual({ empty: false, reason: "not_built", found: [] });
  });

  it("knows boilerplate by name", () => {
    for (const p of ["README.md", "readme.rst", "LICENSE", "LICENSE.md", "LICENCE", "COPYING", ".gitignore", ".gitattributes", ".gitkeep", ".editorconfig", "CONTRIBUTING.md", "docs/README.md", ".github/PULL_REQUEST_TEMPLATE.md"]) {
      expect(isBoilerplate(p), p).toBe(true);
    }
    for (const p of ["src/index.ts", "package.json", "main.py", "index.html", "Makefile", "docs/guide.md", "notes.txt"]) expect(isBoilerplate(p), p).toBe(false);
  });
});
