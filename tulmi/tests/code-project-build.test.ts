/**
 * The project brain, a build from start to end against a fake GitHub that serves
 * a small multi-language repo as a REAL gzipped tarball (tests/project-fixtures.ts):
 * the full build and what it kept, the privacy of it, summaries and the budget,
 * the second build after a change (Merkle: only what changed is read, analysed
 * and summarised again), ensureFresh, tree-only mode, the questions layer 5 asks,
 * and the locks.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.OPENROUTER_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  process.env.GROQ_API_KEY = "k";
  process.env.STT_PROVIDER = "groq";
  process.env.DEV_SKIP_AUTH = "true";
  process.env.NODE_ENV = "test";
  process.env.MEDIA_DIR = "/tmp/tailzu-test-media";
  process.env.CONNECTOR_TOKEN_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
});

const { projectRig, built } = await import("./project-rig.js");
const { acmeFiles } = await import("./project-repo.js");
const { PRIVATE_KEY, SECRET_ENV } = await import("./project-repo.js");

type Rig = Awaited<ReturnType<typeof projectRig>>;

/** Everything stored for the project, as one string: to prove something is nowhere in it. */
async function everything(r: Rig): Promise<string> {
  const row = await r.brainStore.getBrain(r.projectId);
  const files = await r.brainStore.listFiles(r.projectId);
  const dirs = await r.brainStore.listDirs(r.projectId);
  const texts = await r.brainStore.sampleTexts(r.projectId, 100_000);
  return JSON.stringify({ row, files, dirs, texts });
}

const fileRow = async (r: Rig, path: string) => (await r.brainStore.getFile(r.projectId, path))!;
const names = async (r: Rig, path: string) => (await fileRow(r, path)).symbols.map((s) => `${s.kind}:${s.name}`);

describe("a full build", () => {
  it("reads the whole repo in one tarball: ready, 100%, the tree's head, and nothing but the tree, the ref, the commit, the tarball and the history was asked of GitHub", async () => {
    const r = await projectRig();
    const v = await built(r);
    expect(v.status).toBe("ready");
    expect(v.progress).toEqual({ pct: 100, phase: "ready" });
    expect(v.headSha).toBe(r.repo.head.sha);
    expect(v.error).toBe("");
    expect(r.gh.count(/\/git\/blobs\//)).toBe(0);
    expect(r.gh.count(/\/tarball\//)).toBe(1);
    expect(r.gh.calls.filter((c) => c.host === "codeload.github.com")).toHaveLength(1);
    expect(r.gh.count(/\/git\/trees\//)).toBe(1);
    expect(r.gh.count(/\/git\/ref\//)).toBe(1);
  });

  it("never sends the token to codeload", async () => {
    const r = await projectRig();
    await built(r);
    const download = r.gh.calls.filter((c) => c.host === "codeload.github.com");
    expect(download.length).toBeGreaterThan(0);
    expect(download.every((c) => c.auth === false)).toBe(true);
  });

  it("keeps the structure: languages, package manager, frameworks, workspaces, entry points, commands, CI, env names, Docker, the README", async () => {
    const r = await projectRig();
    const { structure: s } = await built(r);
    expect(s!.languages[0]).toMatchObject({ lang: "TypeScript" });
    expect(s!.languages.map((l) => l.lang)).toEqual(expect.arrayContaining(["Python", "Go", "Dart"]));
    expect(s!.packageManagers).toEqual(expect.arrayContaining(["pnpm", "pip", "go modules"]));
    expect(s!.lockfiles).toEqual(["pnpm-lock.yaml"]);
    expect(s!.frameworks).toEqual(expect.arrayContaining(["Next.js", "React", "Express", "FastAPI", "Gin", "Flutter"]));
    expect(s!.monorepo?.packages.map((p) => p.path)).toEqual([".", "app", "svc"]);
    expect(s!.entryPoints.map((e) => e.path)).toEqual(expect.arrayContaining(["src/server/index.ts", "app/lib/main.dart", "svc/main.go"]));
    expect(s!.commands.map((c) => `${c.cwd || "."}: ${c.kind} ${c.cmd}`)).toEqual(expect.arrayContaining([".: test pnpm test", ".: typecheck pnpm run typecheck", "svc: test go test ./...", "app: test flutter test"]));
    expect(s!.ci).toEqual([".github/workflows/ci.yml"]);
    expect(s!.envVars.map((e) => e.name)).toEqual(expect.arrayContaining(["STRIPE_KEY", "NEXT_PUBLIC_API", "DATABASE_URL", "API_TOKEN"]));
    expect(s!.docker).toMatchObject({ files: ["Dockerfile"], images: ["node:20-alpine"], ports: [3000] });
    expect(s!.readme).toEqual({ path: "README.md", title: "Acme Shop", blurb: "A small shop with a web app, an API, a Go worker and a Flutter app." });
    expect(s!.mode).toBe("full");
  });

  it("skips what it should: vendored, minified, binary, over 512 KB; and records the lockfile and the secret files by name", async () => {
    const r = await projectRig();
    const { structure: s } = await built(r);
    const rows = (await r.brainStore.listFiles(r.projectId)).map((f) => f.path);
    for (const gone of ["node_modules/lodash/index.js", "dist/bundle.js", "src/lib/vendor.min.js", "assets/logo.png", "src/generated/huge.ts", "src/lib/weird.js", "pnpm-lock.yaml", ".env", "certs/server.pem"]) {
      expect(rows, gone).not.toContain(gone);
    }
    expect(s!.secretFiles).toEqual([".env", "certs/server.pem"]);
    expect(s!.skipped).toMatchObject({ vendored: 2, generated: 1, binary: 1, tooBig: 1, lockfiles: 1, secret: 2 });
    // The NUL file was read and found binary: its sha is remembered so it is not fetched again.
    const row = await r.brainStore.getBrain(r.projectId);
    expect(Object.keys(row!.structure.skippedBlobs)).toEqual(["src/lib/weird.js"]);
  });

  it("keeps no secret anywhere: not in a row, not in the memory, not sent to a model", async () => {
    const r = await projectRig();
    await built(r);
    const all = await everything(r);
    for (const secret of ["hunter2", "sk_live_4eC39", "sk_live_abc123", "BEGIN PRIVATE KEY", "MIIEvQIBADANB", "admin:hunter2", "postgres://localhost/acme"]) {
      expect(all, secret).not.toContain(secret);
      expect(r.model.sent.join("\n"), secret).not.toContain(secret);
    }
    expect(SECRET_ENV).toContain("hunter2");
    expect(PRIVATE_KEY).toContain("BEGIN PRIVATE KEY");
    // The example file's NAMES are known, its values are not.
    expect((await r.brainStore.getBrain(r.projectId))!.structure.envVars.map((e) => e.name)).toContain("STRIPE_KEY");
  });

  it("finds symbols, routes and imports for the files it read, resolving the tsconfig alias and Python's relative imports", async () => {
    const r = await projectRig();
    await built(r);
    expect(await names(r, "src/lib/api.ts")).toEqual(["interface:User", "function:fetchUsers", "env:STRIPE_KEY", "const:API_VERSION"]);
    expect((await fileRow(r, "src/components/SignupForm.tsx")).imports).toEqual(["src/lib/api.ts", "src/lib/util.ts"]);
    expect((await fileRow(r, "src/app/settings/page.tsx")).imports).toEqual(["src/components/SettingsForm.tsx"]);
    expect((await fileRow(r, "api/main.py")).imports).toEqual(["api/models.py", "api/utils/helpers.py"]);
    expect((await fileRow(r, "api/utils/helpers.py")).imports).toEqual(["api/models.py"]);
    expect((await fileRow(r, "svc/main.go")).imports).toEqual(["svc/internal/store/store.go"]);
    expect((await fileRow(r, "app/lib/main.dart")).imports).toEqual(["app/lib/screens/home.dart"]);
    const routes = (await fileRow(r, "src/server/index.ts")).symbols.filter((s) => s.kind === "route").map((s) => `${s.method} ${s.path}`);
    expect(routes).toEqual(["GET /health", "POST /orders"]);
    expect((await fileRow(r, "src/app/api/users/route.ts")).symbols.filter((s) => s.kind === "route").map((s) => `${s.method} ${s.path}`)).toEqual(["GET /api/users", "POST /api/users"]);
    expect((await fileRow(r, "src/app/settings/page.tsx")).symbols.some((s) => s.kind === "route" && s.path === "/settings")).toBe(true);
  });

  it("ranks the file everyone imports highest, and maps tests to sources", async () => {
    const r = await projectRig();
    await built(r);
    const util = await fileRow(r, "src/lib/util.ts"), api = await fileRow(r, "src/lib/api.ts"), page = await fileRow(r, "src/app/page.tsx");
    expect(util.rank).toBe(1);
    expect(api.rank).toBeGreaterThan(page.rank);
    expect(api.tests).toEqual(["src/lib/api.test.ts"]);
    expect((await fileRow(r, "api/main.py")).tests).toEqual(["api/tests/test_main.py"]);
    expect((await fileRow(r, "svc/internal/store/store.go")).tests).toEqual(["svc/internal/store/store_test.go"]);
    expect((await fileRow(r, "app/lib/screens/home.dart")).tests).toEqual(["app/test/home_test.dart"]);
    const row = await r.brainStore.getBrain(r.projectId);
    expect(row!.structure.testing.frameworks).toEqual(expect.arrayContaining(["Vitest", "go test", "flutter_test"]));
  });

  it("indexes what a person sees, with file and line", async () => {
    const r = await projectRig();
    await built(r);
    const hit = (path: string, text: string) => r.brainStore.sampleTexts(r.projectId, 10_000).then((all) => all.find((t) => t.path === path && t.text.includes(text)));
    expect(await hit("src/app/page.tsx", "Sign up")).toMatchObject({ line: 5, kind: "jsx" });
    expect(await hit("src/components/SignupForm.tsx", "Email address")).toMatchObject({ line: 11, kind: "attr" });
    expect(await hit("locales/en.json", "Sign up")).toMatchObject({ line: 4, kind: "i18n", text: "auth.signup.button: Sign up" });
    expect(await hit("app/lib/screens/home.dart", "Welcome home")).toMatchObject({ kind: "flutter" });
    expect(await hit("app/android/app/src/main/res/values/strings.xml", "Check out now")).toMatchObject({ line: 3, kind: "android" });
    expect(await hit("app/ios/Runner/en.lproj/Localizable.strings", "Your cart is empty")).toMatchObject({ kind: "ios" });
  });

  it("counts TODOs, and picks up CLAUDE.md and AGENTS.md as the project's rules", async () => {
    const r = await projectRig();
    const v = await built(r);
    expect((await fileRow(r, "src/components/SettingsForm.tsx")).todo).toBe(3);
    expect((await fileRow(r, "api/main.py")).todo).toBe(1);
    expect(v.conventions!.rules.map((x) => [x.path, x.text])).toEqual([
      ["CLAUDE.md", acmeFiles()["CLAUDE.md"]], ["AGENTS.md", acmeFiles()["AGENTS.md"]],
    ]);
    expect(v.conventions!.formatter).toContain("prettier");
    expect(v.conventions!.style).toMatchObject({ quotes: "single", semicolons: true });
    const memory = (await r.brainStore.getBrain(r.projectId))!.memory;
    expect(memory).toContain("Always run `pnpm test` before you commit.");
    expect(memory).toContain("Never edit files under `src/generated`.");
  });

  it("makes features, a memory, a welcome of at most 900 characters, and the plan of checks to run", async () => {
    const r = await projectRig();
    const v = await built(r);
    expect(v.features.length).toBeGreaterThan(0);
    expect(v.welcome.length).toBeGreaterThan(40);
    expect(v.welcome.length).toBeLessThanOrEqual(900);
    const row = (await r.brainStore.getBrain(r.projectId))!;
    expect(row.memory).toMatch(/^# TAILZU\.md: alice\/acme/);
    expect(row.baseline!.plan.map((p) => `${p.kind}: ${p.cmd}`)).toEqual(expect.arrayContaining(["typecheck: pnpm run typecheck", "lint: pnpm run lint"]));
    expect(row.baseline!.recorded).toBeNull();
  });

  it("looks at the history for hotspots, and the first commit counts for nothing", async () => {
    const r = await projectRig();
    r.repo.commit({ "src/lib/api.ts": "export const API_VERSION = 'v2';\n" }, "feat(api): v2");
    r.repo.commit({ "src/lib/api.ts": "export const API_VERSION = 'v3';\n", "src/lib/util.ts": "export const slug = (s: string) => s;\n" }, "fix(api): v3");
    r.repo.commit({ "src/components/SignupForm.tsx": "export function SignupForm() { return null; }\n" }, "feat(ui): form");
    await built(r);
    expect((await fileRow(r, "src/lib/api.ts")).hot).toBe(2);
    expect((await fileRow(r, "src/lib/util.ts")).hot).toBe(1);
    expect((await fileRow(r, "src/app/page.tsx")).hot).toBe(0);
    const h = await (await r.brain.open("alice", r.projectId)).hotspots();
    expect(h[0]).toMatchObject({ path: "src/lib/api.ts", changes: 2 });
    const row = await r.brainStore.getBrain(r.projectId);
    expect(row!.conventions.commits).toMatchObject({ style: "conventional", scopes: ["api", "ui"] });
  });

  it("stops looking at commits when GitHub's rate limit falls under 500, and the build is still whole", async () => {
    const r = await projectRig();
    for (let i = 0; i < 30; i += 1) r.repo.commit({ [`src/lib/f${i}.ts`]: `export const v = ${i};\n` }, `chore: ${i}`);
    r.gh.rateRemaining = 520;
    r.gh.rateStep = 5;
    const v = await built(r);
    expect(v.status).toBe("ready");
    expect(r.gh.count(/\/commits\/[0-9a-f]{40}$/)).toBeLessThan(31);
    expect(r.gh.count(/\/commits\/[0-9a-f]{40}$/)).toBeGreaterThan(2);
  });

  it("charges the project for the model's work, and logs counts and never a path or a line of code", async () => {
    const r = await projectRig();
    const v = await built(r);
    expect(v.spentPaise).toBe(r.model.calls.length * 5);
    const built1 = r.logs.find((l) => l.m === "code project brain built")!;
    expect(built1.o).toMatchObject({ mode: "full", via: "tarball", paise: v.spentPaise });
    const logged = JSON.stringify(r.logs);
    for (const leak of ["src/lib/api.ts", "fetchUsers", "Sign up", "alice/acme", "hunter2"]) expect(logged).not.toContain(leak);
  });
});

describe("the words, and the money", () => {
  it("summarises at most 150 files, ten to a call, then the folders, the repo, the features and the welcome", async () => {
    const r = await projectRig();
    const v = await built(r);
    const files = r.model.of("brain.summarize.files");
    expect(files.every((c) => c.paths.length <= 10)).toBe(true);
    expect(r.model.summarized().length).toBeLessThanOrEqual(150);
    expect(new Set(r.model.summarized()).size).toBe(r.model.summarized().length);
    expect(r.model.of("brain.summarize.repo")).toHaveLength(1);
    expect(r.model.of("brain.features")).toHaveLength(1);
    expect(r.model.of("brain.welcome")).toHaveLength(1);
    expect(v.summaries).toBe("complete");
    expect((await fileRow(r, "src/lib/api.ts")).summary).toBe("Summary of src/lib/api.ts.");
    const dirs = await r.brainStore.listDirs(r.projectId);
    expect(dirs.find((d) => d.path === "")!.summary).toMatch(/^Acme Shop is a small shop/);
    expect(dirs.find((d) => d.path === "src/lib")!.summary).toBe("The src/lib folder.");
  });

  it("never sends a model the tests, the data files or the docs, and sends a user id of the person", async () => {
    const r = await projectRig();
    await built(r);
    const asked = r.model.summarized();
    expect(asked).toContain("src/lib/api.ts");
    for (const no of ["src/lib/api.test.ts", "locales/en.json", "README.md", "package.json", "api/tests/test_main.py"]) expect(asked, no).not.toContain(no);
    expect(r.model.calls.every((c) => c.user === "alice")).toBe(true);
  });

  it("keeps what it has when the budget runs out, says summaries are partial, and the analysis is whole", async () => {
    // 10 paise a call, 40 paise in all: files may use 26 (two calls), the folders up to 32 (one more), and the last fifth is left.
    const r = await projectRig({ budgetPaise: 40, paise: 10 });
    const v = await built(r);
    expect(v.status).toBe("ready");
    expect(v.summaries).toBe("partial");
    expect(v.spentPaise).toBeLessThanOrEqual(40);
    expect(r.model.calls.length).toBeLessThan(8);
    expect(r.model.refused).toBeGreaterThan(0);
    // What was done is kept, and the rest of the brain is untouched.
    const rows = await r.brainStore.listFiles(r.projectId);
    expect(rows.filter((f) => f.summary).length).toBeGreaterThan(0);
    expect(rows.filter((f) => f.summary).length).toBeLessThan(rows.filter((f) => f.symbols.length).length);
    expect((await fileRow(r, "src/lib/api.ts")).symbols.length).toBeGreaterThan(0);
    expect(v.structure!.frameworks).toContain("Next.js");
    expect(v.features.length).toBeGreaterThan(0);
    expect(v.welcome.length).toBeGreaterThan(40);
    expect(v.welcome.length).toBeLessThanOrEqual(900);
  });

  it("makes no model call at all with a budget of 0, and the build is ready with the plain welcome", async () => {
    const r = await projectRig({ budgetPaise: 0 });
    const v = await built(r);
    expect(r.model.calls).toHaveLength(0);
    expect(v.status).toBe("ready");
    expect(v.summaries).toBe("none");
    expect(v.spentPaise).toBe(0);
    expect(v.welcome).toMatch(/^alice\/acme: A small shop/);
    expect(v.welcome.length).toBeLessThanOrEqual(900);
    expect((await fileRow(r, "src/lib/api.ts")).symbols.length).toBeGreaterThan(0);
  });

  it("is ready, with the analysis whole and a plain welcome, when the models are down", async () => {
    const r = await projectRig({ modelDown: true });
    const v = await built(r);
    expect(v.status).toBe("ready");
    expect(v.summaries).toBe("none");
    expect(r.model.calls.length).toBeLessThanOrEqual(2);
    expect(v.welcome).toMatch(/^alice\/acme: A small shop/);
    expect(v.features.length).toBeGreaterThan(0);
    expect(v.features[0]!.name).not.toMatch(/^Feature \d/);
  });

  it("builds the welcome from what it found: a deprecated dependency, a version behind, untested hot files, TODOs", async () => {
    const r = await projectRig({ budgetPaise: 0 });
    r.repo.commit({ "src/lib/api.ts": "export const API_VERSION = 'v2';\n" }, "one");
    r.repo.commit({ "src/lib/api.ts": "export const API_VERSION = 'v3';\n" }, "two");
    r.repo.commit({ "src/lib/util.ts": "export const x = 1;\n" }, "three");
    r.repo.commit({ "src/lib/util.ts": "export const x = 2;\n" }, "four");
    const v = await built(r);
    expect(v.welcome).toContain("Replace the deprecated dependency old-lib");
    expect(v.welcome).toContain("TODO/FIXME notes in src/components/SettingsForm.tsx");
    expect(r.gh.count(/registry/)).toBe(0);
  });
});

describe("the next build after a change (Merkle)", () => {
  it("reads one blob, analyses one file, summarises that file and the folders above it, and nothing else", async () => {
    const r = await projectRig();
    await built(r);
    const before = await r.brainStore.listFiles(r.projectId);
    const dirsBefore = await r.brainStore.listDirs(r.projectId);
    r.gh.reset();
    r.model.calls.length = 0;

    r.repo.commit({ "src/lib/util.ts": "export function slug(s: string): string {\n  return s.trim();\n}\nexport function upper(s: string) { return s.toUpperCase(); }\n" }, "feat: upper");
    const v = await built(r, "incremental");
    expect(v.status).toBe("ready");
    expect(v.headSha).toBe(r.repo.head.sha);

    // GitHub: the tree, and one blob. No tarball.
    expect(r.gh.count(/\/tarball\//)).toBe(0);
    expect(r.gh.calls.filter((c) => c.host === "codeload.github.com")).toHaveLength(0);
    expect(r.gh.count(/\/git\/blobs\//)).toBe(1);
    expect(r.gh.calls.find((c) => /\/git\/blobs\//.test(c.path))!.path).toContain(r.repo.shaOf("src/lib/util.ts")!);

    // Analysed again: the changed file has its new symbol and sha; every other row is as it was.
    expect(await names(r, "src/lib/util.ts")).toEqual(["function:slug", "function:upper"]);
    expect((await fileRow(r, "src/lib/util.ts")).blobSha).toBe(r.repo.shaOf("src/lib/util.ts"));
    const after = new Map((await r.brainStore.listFiles(r.projectId)).map((f) => [f.path, f]));
    for (const b of before) {
      if (b.path === "src/lib/util.ts") continue;
      const a = after.get(b.path)!;
      expect({ ...a, rank: 0, hot: 0, tests: [] }).toEqual({ ...b, rank: 0, hot: 0, tests: [] });
    }

    // Summarised again: that file, and the folders whose sha changed above it.
    expect(r.model.summarized()).toEqual(["src/lib/util.ts"]);
    expect(r.model.of("brain.summarize.dirs").flatMap((c) => c.paths).sort()).toEqual(["src", "src/lib"]);
    expect(r.model.of("brain.summarize.repo")).toHaveLength(1);
    const dirsAfter = await r.brainStore.listDirs(r.projectId);
    for (const d of dirsBefore.filter((x) => !["", "src", "src/lib"].includes(x.path))) expect(dirsAfter.find((x) => x.path === d.path)).toEqual(d);
    const lib = dirsAfter.find((d) => d.path === "src/lib")!;
    expect(lib.treeSha).toBe(r.repo.shaOf("src/lib"));
    expect(lib.treeSha).not.toBe(dirsBefore.find((d) => d.path === "src/lib")!.treeSha);
  });

  it("does nothing at all when the head has not moved", async () => {
    const r = await projectRig();
    await built(r);
    r.gh.reset();
    r.model.calls.length = 0;
    const v = await built(r, "incremental");
    expect(v.status).toBe("ready");
    expect(r.model.calls).toHaveLength(0);
    expect(r.gh.count(/\/(tarball|git\/blobs)\//)).toBe(0);
  });

  it("adds a new file, drops a deleted one and every edge to it, and a moved import follows", async () => {
    const r = await projectRig();
    await built(r);
    r.repo.commit({
      "src/lib/extra.ts": "import { slug } from './util';\nexport const extra = () => slug('x');\n",
      "api/models.py": null,
    }, "add extra, drop models");
    await built(r, "incremental");
    expect(await names(r, "src/lib/extra.ts")).toEqual(["function:extra"]);
    expect((await fileRow(r, "src/lib/extra.ts")).imports).toEqual(["src/lib/util.ts"]);
    expect(await r.brainStore.getFile(r.projectId, "api/models.py")).toBeNull();
    expect((await fileRow(r, "api/main.py")).imports).toEqual(["api/utils/helpers.py"]);
    expect((await fileRow(r, "api/utils/helpers.py")).imports).toEqual([]);
    // util is imported by one more file now.
    const handle = await r.brain.open("alice", r.projectId);
    expect((await handle.neighbors("src/lib/util.ts")).importedBy).toContain("src/lib/extra.ts");
  });

  it("replaces the strings of a changed file and keeps those of the others", async () => {
    const r = await projectRig();
    await built(r);
    r.repo.commit({ "src/app/page.tsx": "export default function HomePage() {\n  return <main><h1>Hello again</h1></main>;\n}\n" }, "text");
    await built(r, "incremental");
    const all = await r.brainStore.sampleTexts(r.projectId, 10_000);
    expect(all.filter((t) => t.path === "src/app/page.tsx").map((t) => t.text)).toEqual(["Hello again"]);
    expect(all.some((t) => t.path === "locales/en.json" && t.text.includes("Sign up"))).toBe(true);
    expect(all.some((t) => t.path === "src/components/SignupForm.tsx")).toBe(true);
  });

  it("uses the tarball again when more than 200 files changed, and still re-analyses only those", async () => {
    const r = await projectRig();
    await built(r);
    const changes: Record<string, string> = {};
    for (let i = 0; i < 210; i += 1) changes[`src/bulk/f${i}.ts`] = `export const v${i} = ${i};\n`;
    r.repo.commit(changes, "bulk");
    r.gh.reset();
    r.model.calls.length = 0;
    const v = await built(r, "incremental");
    expect(v.status).toBe("ready");
    expect(r.gh.count(/\/tarball\//)).toBe(1);
    expect(r.gh.count(/\/git\/blobs\//)).toBe(0);
    const log = r.logs.filter((l) => l.m === "code project brain built").pop()!;
    expect(log.o).toMatchObject({ mode: "incremental", changed: 210, via: "tarball" });
    expect((await r.brainStore.listFiles(r.projectId)).length).toBeGreaterThan(210);
  });

  it("becomes a full build, by itself, when a file that decides how imports resolve changed", async () => {
    const r = await projectRig();
    await built(r);
    r.repo.commit({ "tsconfig.json": '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], "#lib/*": ["src/lib/*"] } } }' }, "paths");
    r.gh.reset();
    await built(r, "incremental");
    expect(r.gh.count(/\/tarball\//)).toBe(1);
    expect(r.logs.some((l) => l.m === "code project brain: a resolver file changed, building in full")).toBe(true);
    expect(r.logs.filter((l) => l.m === "code project brain built").pop()!.o).toMatchObject({ mode: "full" });
  });

  it("keeps the old lines of files and folders whose sha did not change, even in a full build, and pays only for what is missing", async () => {
    const r = await projectRig();
    await built(r);
    const paid = r.model.calls.length;
    r.model.calls.length = 0;
    await built(r, "full");
    expect(r.model.summarized()).toEqual([]);
    expect(r.model.of("brain.summarize.dirs")).toHaveLength(0);
    expect(r.model.of("brain.summarize.repo")).toHaveLength(0);
    expect(paid).toBeGreaterThan(r.model.calls.length);
    expect((await fileRow(r, "src/lib/api.ts")).summary).toBe("Summary of src/lib/api.ts.");
  });

  it("finishes a partial build later: what the money did not reach gets its line when the money is there", async () => {
    // 8 paise a call and 30 in all: the files (cap 19) take two calls, and the folders, the features and the overview are left.
    const small = await projectRig({ budgetPaise: 30, paise: 8 });
    const v1 = await built(small);
    expect(v1.summaries).toBe("partial");
    const dirLines = async () => (await small.brainStore.listDirs(small.projectId)).filter((d) => d.summary).length;
    const before = await dirLines();
    const fileLines = (await small.brainStore.listFiles(small.projectId)).filter((f) => f.summary);
    // The same store and repo, a bigger budget.
    const { ProjectBrain } = await import("../src/code/project/index.js");
    const more = new ProjectBrain({ projects: small.d, store: small.brainStore, call: small.model.call, fetchFn: small.gh.fetchFn, now: () => small.fake.clock.t, budgetPaise: 1000 });
    small.model.calls.length = 0;
    const v2 = await more.build("alice", small.projectId, { mode: "full" });
    expect(v2.summaries).toBe("complete");
    expect(await dirLines()).toBeGreaterThan(before);
    // The lines it already had are kept, not paid for again.
    expect(small.model.summarized().filter((p) => fileLines.some((f) => f.path === p))).toEqual([]);
  });
});

describe("tree-only mode", () => {
  it("reads the tree and the manifests when the tarball is declared over 300 MB, and every file can still be found by name", async () => {
    const r = await projectRig();
    r.gh.tarballDeclaredBytes = 301 * 1024 * 1024;
    const v = await built(r);
    expect(v.status).toBe("ready");
    expect(v.structure!.mode).toBe("tree_only");
    expect(v.structure!.note).toMatch(/too big/);
    expect(v.structure!.frameworks).toEqual(expect.arrayContaining(["Next.js", "FastAPI"]));
    expect(v.structure!.commands.length).toBeGreaterThan(0);
    expect(v.conventions!.rules.map((x) => x.path)).toEqual(["CLAUDE.md", "AGENTS.md"]);
    const handle = await r.brain.open("alice", r.projectId);
    expect((await handle.findFiles("signup form"))[0]!.path).toBe("src/components/SignupForm.tsx");
    expect((await handle.testsFor("src/lib/api.ts"))).toEqual(["src/lib/api.test.ts"]);
    expect((await fileRow(r, "src/lib/api.ts")).symbols).toEqual([]);
    expect(r.model.summarized()).toEqual([]);
    // The core files came by blob, one each; nothing else did.
    expect(r.gh.count(/\/git\/blobs\//)).toBeGreaterThan(0);
    expect(r.gh.count(/\/git\/blobs\//)).toBeLessThan(25);
  });

  it("falls back the same way when GitHub will not give the tarball, and a later incremental build stays tree-only", async () => {
    const r = await projectRig();
    r.gh.tarballStatus = 404;
    const v = await built(r);
    expect(v.structure!.mode).toBe("tree_only");
    r.repo.commit({ "src/lib/util.ts": "export const x = 1;\n", "package.json": acmeFiles()["package.json"] + "\n" }, "change");
    r.gh.reset();
    const v2 = await built(r, "incremental");
    expect(v2.structure!.mode).toBe("tree_only");
    expect(r.gh.count(/\/tarball\//)).toBe(0);
    // Asking for a full build tries the download again.
    r.gh.tarballStatus = null;
    const v3 = await built(r, "full");
    expect(v3.structure!.mode).toBe("full");
    expect((await fileRow(r, "src/lib/api.ts")).symbols.length).toBeGreaterThan(0);
  });
});

describe("a repo with nothing in it, and a build that fails", () => {
  it("says an empty repo is empty and what to do, and is ready", async () => {
    const r = await projectRig({ files: {} });
    const v = await built(r);
    expect(v.status).toBe("ready");
    expect(v.welcome).toMatch(/no commits yet/);
    expect(v.structure!.note).toMatch(/no commits/);
    expect(v.features).toEqual([]);
  });

  it("fails in plain words, never GitHub's own, and leaves the earlier rows as they were", async () => {
    const r = await projectRig();
    await built(r);
    const before = JSON.stringify(await r.brainStore.listFiles(r.projectId));
    const head = (await r.brainStore.getBrain(r.projectId))!.headSha;
    r.repo.commit({ "src/lib/util.ts": "export const y = 2;\n" }, "change");
    r.gh.fail.push({ re: /\/git\/trees\//, status: 500, message: "internal words about tokens ghs_zzz and /home/secret/path" });
    const v = await built(r, "incremental");
    expect(v.status).toBe("failed");
    expect(v.error).toBe("GitHub ran into a problem. Try again in a moment.");
    expect(v.error).not.toMatch(/ghs_|internal|secret/);
    expect(JSON.stringify(await r.brainStore.listFiles(r.projectId))).toBe(before);
    expect((await r.brainStore.getBrain(r.projectId))!.headSha).toBe(head);
    // The next try, with GitHub back, builds on what was there.
    r.gh.fail.length = 0;
    const again = await built(r, "incremental");
    expect(again.status).toBe("ready");
    expect(again.headSha).toBe(r.repo.head.sha);
  });

  it("says GitHub is busy in its own plain words", async () => {
    const r = await projectRig();
    r.gh.fail.push({ re: /\/git\/ref\//, status: 429, message: "rate limit" });
    const v = await built(r);
    expect(v.status).toBe("failed");
    expect(v.error).toBe("GitHub is busy right now. Try again in a minute.");
  });

  it("tells a build that stopped moving, with nothing running it, from one that is working", async () => {
    const r = await projectRig();
    await r.brainStore.saveBrain(r.projectId, { status: "building", headSha: "a".repeat(40), progress: { pct: 35, phase: "reading each file" } });
    const fresh = await r.brain.get("alice", r.projectId);
    expect(fresh.status).toBe("building");
    r.fake.clock.t += 16 * 60_000;
    const dead = await r.brain.get("alice", r.projectId);
    expect(dead.status).toBe("failed");
    expect(dead.error).toMatch(/stopped before it finished/);
    // And asking again starts over.
    const again = await r.brain.build("alice", r.projectId, { mode: "full" });
    expect(again.status).toBe("ready");
  });
});

describe("one build at a time, and the questions layer 5 asks", () => {
  it("joins a second request to the build that is running, and builds again after it for a push that came during it", async () => {
    const r = await projectRig();
    let release!: () => void;
    r.gh.gate = new Promise<void>((res) => { release = res; });
    const first = await r.brain.start("alice", r.projectId, { mode: "full" });
    expect(first.started).toBe(true);
    expect(first.status.status).toBe("building");
    const second = await r.brain.start("alice", r.projectId, { mode: "full" });
    expect(second.started).toBe(false);
    expect(second.status.status).toBe("building");
    // The first build has read the tree and is waiting for the code. A commit lands; the push asks for another build after this one.
    await vi.waitFor(() => expect(r.gh.count(/\/tarball\//)).toBe(1));
    const sha = r.repo.head.sha;
    r.repo.commit({ "src/lib/util.ts": "export const z = 3;\n" }, "during");
    const third = await r.brain.start("alice", r.projectId, { mode: "incremental", queue: true });
    expect(third.started).toBe(false);
    release();
    const done = await first.done;
    expect(done.status).toBe("ready");
    expect(done.headSha).toBe(r.repo.head.sha);
    expect(done.headSha).not.toBe(sha);
    const builds = r.logs.filter((l) => l.m === "code project brain built");
    expect(builds.map((b) => (b.o as { mode: string }).mode)).toEqual(["full", "incremental"]);
    expect(r.gh.count(/\/tarball\//)).toBe(1);
  });

  it("does not queue another build when nobody asked for one", async () => {
    const r = await projectRig();
    await Promise.all([r.brain.start("alice", r.projectId, { mode: "full" }).then((s) => s.done), r.brain.start("alice", r.projectId, { mode: "full" }).then((s) => s.done)]);
    expect(r.logs.filter((l) => l.m === "code project brain built")).toHaveLength(1);
  });

  it("is owner-only: another person's project is not found", async () => {
    const r = await projectRig();
    await built(r);
    await expect(r.brain.get("mallory", r.projectId)).rejects.toMatchObject({ code: "not_found" });
    await expect(r.brain.start("mallory", r.projectId)).rejects.toMatchObject({ code: "not_found" });
    await expect(r.brain.open("mallory", r.projectId)).rejects.toMatchObject({ code: "not_found" });
    await expect(r.brain.ensureFresh("mallory", r.projectId)).rejects.toMatchObject({ code: "not_found" });
  });

  it("finds files, symbols, routes, visible text and neighbours, and says what is tested and what is hot", async () => {
    const r = await projectRig();
    r.repo.commit({ "src/lib/api.ts": "export interface User { id: string }\nexport async function fetchUsers(): Promise<User[]> { return []; }\n" }, "a");
    r.repo.commit({ "src/lib/api.ts": "export interface User { id: string; name: string }\nexport async function fetchUsers(): Promise<User[]> { return []; }\n" }, "b");
    await built(r);
    const b = await r.brain.open("alice", r.projectId);

    expect((await b.findFiles("signup form"))[0]!).toMatchObject({ path: "src/components/SignupForm.tsx" });
    expect((await b.findFiles("settings"))[0]!.path).toMatch(/settings/i);
    expect((await b.findFiles("zzzznothing"))).toEqual([]);
    expect((await b.findFiles("api", 2))).toHaveLength(2);

    const sym = await b.findSymbols("fetchUsers");
    expect(sym[0]).toMatchObject({ path: "src/lib/api.ts", name: "fetchUsers", kind: "function", exported: true });
    expect((await b.findSymbols("login")).length).toBeGreaterThanOrEqual(0);
    expect((await b.findSymbols("/health"))[0]).toMatchObject({ path: "src/server/index.ts", kind: "route", method: "GET" });
    expect((await b.findSymbols("fetch"))[0]!.name).toBe("fetchUsers");
    expect((await b.findSymbols("NEXT_PUBLIC_API"))[0]).toMatchObject({ kind: "env", path: "src/components/SignupForm.tsx" });

    const texts = await b.findTexts("Sign up");
    // Both say exactly "Sign up"; the translation also names the key to change.
    expect(texts.map((t) => `${t.path}:${t.line}`)).toEqual(["locales/en.json:4", "src/app/page.tsx:5"]);
    expect(texts[0]!.text).toBe("auth.signup.button: Sign up");
    expect((await b.findTexts("account"))[0]!.text).toMatch(/account/i);
    expect((await b.findTexts("Check out now"))[0]).toMatchObject({ path: "app/android/app/src/main/res/values/strings.xml", kind: "android" });

    const n = await b.neighbors("src/lib/util.ts");
    expect(n.imports).toEqual([]);
    // (api.ts imported it too, before this test rewrote api.ts)
    expect(n.importedBy).toEqual(["src/components/SettingsForm.tsx", "src/components/SignupForm.tsx"]);
    expect(await b.neighbors("src/server/index.ts")).toEqual({ imports: ["src/lib/api.ts"], importedBy: [] });
    expect(await b.neighbors("nope.ts")).toEqual({ imports: [], importedBy: [] });

    expect(await b.testsFor("src/lib/api.ts")).toEqual(["src/lib/api.test.ts"]);
    expect(await b.testsFor("src/lib/util.ts")).toEqual([]);

    expect((await b.hotspots())[0]).toMatchObject({ path: "src/lib/api.ts", changes: 2, tests: 1 });
    expect((await b.coChanged("src/lib/api.ts")).length).toBe(0);
    expect((await b.baselinePlan()).some((p) => p.kind === "test")).toBe(true);
    expect(await b.memory()).toContain("# TAILZU.md");
    expect((await b.status()).status).toBe("ready");
  });

  it("finds a feature by name, loosely", async () => {
    const r = await projectRig({ budgetPaise: 0 });
    await built(r);
    const b = await r.brain.open("alice", r.projectId);
    const all = await b.features();
    expect(all.length).toBeGreaterThan(0);
    const first = all[0]!;
    expect(await b.feature(first.name)).toEqual(first);
    expect(await b.feature(first.name.toUpperCase())).toEqual(first);
    expect(await b.feature("")).toBeNull();
    expect(await b.feature("zzz nothing")).toBeNull();
    expect((await b.feature("settings"))?.files).toEqual(expect.arrayContaining(["src/app/settings/page.tsx", "src/components/SettingsForm.tsx"]));
  });
});

describe("recording the baseline, and keeping the brain fresh before a job", () => {
  it("records what the first run of the checks said, against the commit it ran at, and into the memory", async () => {
    const r = await projectRig();
    await built(r);
    const { recordBaseline } = await import("../src/code/project/index.js");
    const b = await recordBaseline(r.projectId, r.repo.head.sha, [
      { kind: "typecheck", exitCode: 0, durationMs: 8000, summary: "no errors" }, { kind: "test", exitCode: 1, durationMs: 21_000, summary: "1 failed", failing: ["cart > total"] },
    ], { store: r.brainStore, now: () => 5 });
    expect(b!.recorded).toMatchObject({ healthy: false, headSha: r.repo.head.sha });
    const row = (await r.brainStore.getBrain(r.projectId))!;
    expect(row.memory).toContain("- test: fail (exit 1), 21s. 1 failed");
    expect(row.baseline!.plan.length).toBeGreaterThan(0);
    // It survives the next build.
    r.repo.commit({ "src/lib/util.ts": "export const q = 1;\n" }, "later");
    await built(r, "incremental");
    expect((await r.brainStore.getBrain(r.projectId))!.baseline!.recorded).toMatchObject({ healthy: false });
  });

  it("ensureFresh leaves a brain alone when the default branch is where it was built", async () => {
    const r = await projectRig();
    await built(r);
    r.gh.reset();
    r.model.calls.length = 0;
    const f = await r.brain.ensureFresh("alice", r.projectId);
    expect(f).toMatchObject({ fresh: true, updated: false, status: "ready", headSha: r.repo.head.sha });
    expect(r.gh.count(/\/git\/ref\//)).toBe(1);
    expect(r.gh.count(/\/git\/trees\//)).toBe(0);
    expect(r.model.calls).toHaveLength(0);
  });

  it("ensureFresh brings a stale brain up to date incrementally before the job starts", async () => {
    const r = await projectRig();
    await built(r);
    r.repo.commit({ "src/lib/util.ts": "export const fresh = true;\n" }, "moved on");
    r.gh.reset();
    const f = await r.brain.ensureFresh("alice", r.projectId);
    expect(f).toMatchObject({ fresh: true, updated: true, status: "ready", headSha: r.repo.head.sha });
    expect(r.gh.count(/\/git\/blobs\//)).toBe(1);
    expect(r.gh.count(/\/tarball\//)).toBe(0);
    expect(await names(r, "src/lib/util.ts")).toEqual(["const:fresh"]);
  });

  it("ensureFresh on a project with no brain starts the first build and says it is not fresh yet", async () => {
    const r = await projectRig();
    const f = await r.brain.ensureFresh("alice", r.projectId);
    expect(f).toMatchObject({ fresh: false, updated: false, status: "building" });
    const view = await (await r.brain.start("alice", r.projectId)).done;
    expect(view.status).toBe("ready");
  });

  it("ensureFresh waits for a build that is running, but not forever", async () => {
    const r = await projectRig();
    const slow = await r.brain.start("alice", r.projectId, { mode: "full" });
    const f = await r.brain.ensureFresh("alice", r.projectId, { waitMs: 60_000 });
    expect(f.fresh).toBe(true);
    await slow.done;
    // A build that is stuck: answered after waitMs, not fresh.
    const r2 = await projectRig();
    await built(r2);
    r2.repo.commit({ "src/lib/util.ts": "export const w = 1;\n" }, "x");
    r2.gh.fail.push({ re: /\/git\/ref\//, status: 429, message: "slow" });
    const f2 = await r2.brain.ensureFresh("alice", r2.projectId).catch((e) => e);
    expect(f2).toMatchObject({ code: "busy" });
  });

  it("adds a project's first build by itself, once", async () => {
    const r = await projectRig();
    expect(await r.brain.added("alice", r.project)).toBe(true);
    expect(await r.brain.added("alice", r.project)).toBe(false);
    await (await r.brain.start("alice", r.projectId)).done;
    expect(await r.brain.added("alice", r.project)).toBe(false);
  });

  it("forgets what it learned when the project goes", async () => {
    const r = await projectRig();
    await built(r);
    await r.brain.forget(r.projectId);
    expect(await r.brainStore.getBrain(r.projectId)).toBeNull();
    expect(await r.brainStore.listFiles(r.projectId)).toEqual([]);
    expect((await r.brain.get("alice", r.projectId)).status).toBe("none");
  });
});
