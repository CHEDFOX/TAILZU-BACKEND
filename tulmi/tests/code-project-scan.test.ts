/**
 * The project brain, the shape of a project without a model: the readers for
 * manifests (JSONC, TOML, YAML, go.mod), the structure built from them (languages
 * by bytes, package managers, frameworks, workspaces, entry points, commands with
 * the right prefix, CI, env var names, Docker, the README's title) and the
 * conventions (formatter, linter, style, commits, branches, and the agent docs
 * kept as the project's rules).
 */
import { describe, expect, it } from "vitest";
import { analyseConventions, projectRules } from "../src/code/project/conventions.js";
import { parseGoMod, parseJsonc, parseToml, parseYaml } from "../src/code/project/parse.js";
import { buildStructure, extractCore, languageShares } from "../src/code/project/scan.js";
import { coreKindOf, selectFiles, treeFromEntries } from "../src/code/project/snapshot.js";
import { extractSymbols } from "../src/code/project/symbols.js";
import { languageOf } from "../src/code/project/lang.js";
import { EMPTY_CONVENTIONS, RULES_DOC_CHARS, RULES_TOTAL_CHARS, type CoreEntry, type Structure } from "../src/code/project/types.js";

describe("the readers", () => {
  it("reads JSON with comments and trailing commas", () => {
    expect(parseJsonc('{\n // a\n "a": [1, 2,], /* b */ "url": "http://x//y",\n}')).toEqual({ a: [1, 2], url: "http://x//y" });
    expect(parseJsonc("{ not json")).toBeNull();
  });

  it("reads TOML: tables, arrays of tables, inline tables, multi-line arrays, dotted keys, comments", () => {
    const t = parseToml(`# a comment
[package]
name = "demo" # trailing
version = '0.1.0'
edition = 2021
[dependencies]
serde = { version = "1", features = ["derive"] }
tokio = "1.0"
[workspace]
members = [
  "crates/a",
  "crates/b", # b
]
[[bin]]
name = "one"
[[bin]]
name = "two"
[tool.poetry.dependencies]
python = "^3.11"
requests = "^2"
a.b = true`);
    expect(t.package).toEqual({ name: "demo", version: "0.1.0", edition: 2021 });
    expect(t.dependencies).toEqual({ serde: { version: "1", features: ["derive"] }, tokio: "1.0" });
    expect((t.workspace as { members: string[] }).members).toEqual(["crates/a", "crates/b"]);
    expect(t.bin).toEqual([{ name: "one" }, { name: "two" }]);
    expect((t.tool as { poetry: { dependencies: Record<string, unknown> } }).poetry.dependencies).toEqual({ python: "^3.11", requests: "^2", a: { b: true } });
  });

  it("reads YAML: maps, lists, lists of maps, flow forms, block scalars, quotes and comments", () => {
    const y = parseYaml(`name: acme_app # the name
description: >
  folded text
  continues
dependencies:
  flutter:
    sdk: flutter
  provider: ^6.0.0
list:
  - one
  - "two words"
  - key: v
    other: w
  - [a, b]
flow: {x: 1, y: [2, 3]}
empty:
flag: true
n: 5
literal: |
  line1
  line2
`);
    expect(y).toEqual({
      name: "acme_app", description: "folded text continues", dependencies: { flutter: { sdk: "flutter" }, provider: "^6.0.0" },
      list: ["one", "two words", { key: "v", other: "w" }, ["a", "b"]], flow: { x: 1, y: [2, 3] }, empty: null, flag: true, n: 5, literal: "line1\nline2",
    });
  });

  it("reads go.mod", () => {
    expect(parseGoMod('module example.com/acme/svc // note\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgolang.org/x/net v0.1.0 // indirect\n)\nrequire github.com/lib/pq v1.0.0')).toEqual({
      module: "example.com/acme/svc", goVersion: "1.22", requires: ["github.com/gin-gonic/gin", "golang.org/x/net", "github.com/lib/pq"],
    });
  });
});

/** The structure of a repo made of these files, the way the build makes it (symbols only for the files given them). */
function structureOf(files: Record<string, string>, o: { symbols?: boolean } = {}): Structure {
  const tree = treeFromEntries("h".repeat(40), "t".repeat(40), [
    ...new Set(Object.keys(files).flatMap((p) => { const parts = p.split("/"); return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/")); })),
  ].map((d) => ({ path: d, type: "tree", sha: "d".repeat(40) })).concat(Object.entries(files).map(([p, t]) => ({ path: p, type: "blob", size: Math.max(1, t.length), sha: "b".repeat(40) } as never))), false);
  const sel = selectFiles(tree);
  const core: Record<string, CoreEntry> = {};
  for (const c of sel.candidates) {
    const kind = coreKindOf(c.path);
    if (kind) core[c.path] = { sha: c.sha, kind, data: extractCore(c.path, kind, files[c.path]!) };
  }
  return buildStructure({
    tree, core, lockfiles: sel.lockfiles, secretFiles: sel.secretFiles, skipped: sel.skipped, analysedCount: sel.candidates.length, mode: "full", note: "", skippedBlobs: {},
    files: sel.candidates.map((c) => ({ path: c.path, lang: languageOf(c.path), symbols: o.symbols ? extractSymbols(c.path, languageOf(c.path), files[c.path]!) : [] })),
  });
}

const pkg = (o: Record<string, unknown>) => JSON.stringify(o);

describe("languages", () => {
  it("counts bytes by language from the tree alone, leaves out prose, data, vendored and lock files, and ranks them", () => {
    const tree = treeFromEntries("h", "t", [
      { path: "a.ts", type: "blob", size: 600, sha: "1" }, { path: "b.py", type: "blob", size: 300, sha: "2" }, { path: "c.go", type: "blob", size: 100, sha: "3" },
      { path: "README.md", type: "blob", size: 9999, sha: "4" }, { path: "data.json", type: "blob", size: 9999, sha: "5" }, { path: "node_modules/x.js", type: "blob", size: 9999, sha: "6" },
      { path: "package-lock.json", type: "blob", size: 9999, sha: "7" }, { path: "logo.png", type: "blob", size: 9999, sha: "8" }, { path: ".env", type: "blob", size: 9999, sha: "9" },
    ], false);
    expect(languageShares(tree)).toEqual([
      { lang: "TypeScript", bytes: 600, files: 1, pct: 60 }, { lang: "Python", bytes: 300, files: 1, pct: 30 }, { lang: "Go", bytes: 100, files: 1, pct: 10 },
    ]);
  });
});

describe("package managers, frameworks and commands", () => {
  it("uses the lockfile's package manager as the prefix: npm, pnpm, yarn, bun", () => {
    const scripts = { test: "vitest run", lint: "eslint .", typecheck: "tsc --noEmit", build: "tsc", dev: "tsx watch src/index.ts", format: "prettier -w .", start: "node dist/index.js" };
    const cmds = (lock: string) => structureOf({ "package.json": pkg({ name: "x", scripts }), [lock]: "" }).commands.map((c) => `${c.kind}: ${c.cmd}`);
    expect(cmds("package-lock.json")).toEqual(["install: npm ci", "test: npm test", "lint: npm run lint", "typecheck: npm run typecheck", "build: npm run build", "dev: npm run dev", "format: npm run format", "run: npm start"]);
    expect(cmds("pnpm-lock.yaml")).toEqual(["install: pnpm install", "test: pnpm test", "lint: pnpm run lint", "typecheck: pnpm run typecheck", "build: pnpm run build", "dev: pnpm run dev", "format: pnpm run format", "run: pnpm start"]);
    expect(cmds("yarn.lock")).toEqual(["install: yarn install", "test: yarn test", "lint: yarn lint", "typecheck: yarn typecheck", "build: yarn build", "dev: yarn dev", "format: yarn format", "run: yarn start"]);
    expect(cmds("bun.lockb")).toEqual(["install: bun install", "test: bun run test", "lint: bun run lint", "typecheck: bun run typecheck", "build: bun run build", "dev: bun run dev", "format: bun run format", "run: bun run start"]);
  });

  it("reads the packageManager field when there is no lockfile, and records the lockfiles it saw", () => {
    const s = structureOf({ "package.json": pkg({ name: "x", packageManager: "pnpm@9.1.0", scripts: { test: "jest" } }), "yarn.lock": "" });
    expect(s.packageManagers).toEqual(["yarn", "pnpm"]);
    expect(s.lockfiles).toEqual(["yarn.lock"]);
    expect(structureOf({ "package.json": pkg({ name: "x", scripts: { test: "jest" } }) }).packageManagers).toEqual(["npm"]);
  });

  it("finds frameworks in manifests of every ecosystem", () => {
    expect(structureOf({ "package.json": pkg({ dependencies: { next: "14", react: "18", "@prisma/client": "5", "@nestjs/core": "10" }, devDependencies: { vitest: "1", typescript: "5" } }) }).frameworks).toEqual(["Next.js", "React", "NestJS", "Prisma", "Vitest", "TypeScript"]);
    expect(structureOf({ "requirements.txt": "Django==5.0\ncelery>=5\n# comment\n-r other.txt\ngit+https://x/y.git\nnumpy" }).frameworks).toEqual(["Django", "Celery", "NumPy"]);
    expect(structureOf({ "pyproject.toml": '[project]\nname = "p"\ndependencies = ["fastapi>=0.100", "pydantic[email]"]\n[tool.ruff]\nline-length = 100' }).frameworks).toEqual(["FastAPI", "Pydantic"]);
    expect(structureOf({ "go.mod": "module m\n\nrequire (\n\tgithub.com/gin-gonic/gin v1\n\tgorm.io/gorm v1\n)" }).frameworks).toEqual(["Gin", "GORM"]);
    expect(structureOf({ "Cargo.toml": '[package]\nname = "x"\n[dependencies]\naxum = "0.7"\ntokio = "1"\nserde = "1"' }).frameworks).toEqual(["Axum", "Tokio", "Serde"]);
    expect(structureOf({ "pubspec.yaml": "name: a\ndependencies:\n  flutter:\n    sdk: flutter\n  flutter_riverpod: ^2.0.0\n  go_router: ^10.0.0\n" }).frameworks).toEqual(["Flutter", "Riverpod", "go_router"]);
    expect(structureOf({ Gemfile: "source 'https://rubygems.org'\ngem 'rails', '~> 7.0'\ngem 'rspec-rails'\n" }).frameworks).toEqual(["Rails", "RSpec"]);
    expect(structureOf({ "composer.json": pkg({ require: { "laravel/framework": "^10" }, "require-dev": { "phpunit/phpunit": "^10" } }) }).frameworks).toEqual(["Laravel", "PHPUnit"]);
    expect(structureOf({ "build.gradle": "plugins { id 'org.springframework.boot' version '3.2' }\ndependencies { implementation 'org.springframework.boot:spring-boot-starter-web' }" }).frameworks).toEqual(["Spring Boot"]);
    expect(structureOf({ "pom.xml": "<project><artifactId>demo</artifactId><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter</artifactId></dependency></dependencies></project>" }).frameworks).toEqual(["Spring Boot"]);
    expect(structureOf({ "Package.swift": '// swift-tools\nlet package = Package(name: "App", dependencies: [.package(url: "https://github.com/vapor/vapor", from: "4.0.0")])' }).frameworks).toEqual(["Vapor"]);
  });

  it("makes the Python, Go, Rust, Dart, Ruby and Gradle commands", () => {
    const py = structureOf({ "pyproject.toml": '[tool.poetry]\nname = "x"\n[tool.poetry.dependencies]\npython = "^3.11"\n[tool.poetry.group.dev.dependencies]\npytest = "*"\nruff = "*"\nmypy = "*"\nblack = "*"', "poetry.lock": "" });
    expect(py.commands.map((c) => `${c.kind}: ${c.cmd}`)).toEqual(["install: poetry install", "test: poetry run pytest", "lint: poetry run ruff check .", "typecheck: poetry run mypy .", "format: poetry run black ."]);
    expect(py.packageManagers).toEqual(["poetry"]);
    expect(structureOf({ "go.mod": "module m\n", ".golangci.yml": "run: {}" }).commands.map((c) => c.cmd)).toEqual(["go mod download", "go build ./...", "go test ./...", "go vet ./...", "golangci-lint run"]);
    expect(structureOf({ "Cargo.toml": '[package]\nname="x"' }).commands.map((c) => c.cmd)).toEqual(["cargo fetch", "cargo build", "cargo test", "cargo clippy", "cargo check", "cargo fmt"]);
    expect(structureOf({ "pubspec.yaml": "name: a\ndependencies:\n  flutter:\n    sdk: flutter" }).commands.map((c) => c.cmd)).toEqual(["flutter pub get", "flutter test", "flutter analyze", "dart format ."]);
    expect(structureOf({ Gemfile: "gem 'rails'\ngem 'rspec'\ngem 'rubocop'" }).commands.map((c) => c.cmd)).toEqual(["bundle install", "bundle exec rspec", "bundle exec rubocop"]);
    expect(structureOf({ "build.gradle.kts": 'plugins { id("com.android.application") }', gradlew: "" }).commands.map((c) => c.cmd)).toEqual(["./gradlew build", "./gradlew test", "./gradlew lint"]);
  });

  it("falls back to Makefile targets for what the manifests didn't say", () => {
    const s = structureOf({ Makefile: ".PHONY: test\ntest:\n\tgo test\nlint:\n\tgolint\nbuild:\n\tgo build\nVAR := 1\n", "go.mod": "module m\n" });
    // go.mod already gave test and build; the Makefile adds only what is missing.
    expect(s.commands.filter((c) => c.source === "Makefile").map((c) => c.cmd)).toEqual(["make lint"]);
    expect(structureOf({ Makefile: "test:\n\tgo test\ndev:\n\tgo run .\nunrelated:\n" }).commands.map((c) => c.cmd)).toEqual(["make test", "make dev"]);
  });

  it("puts a package's commands in its own folder, and the root's first", () => {
    const s = structureOf({
      "package.json": pkg({ name: "root", private: true, workspaces: ["packages/*"], scripts: { test: "turbo test" } }), "pnpm-lock.yaml": "",
      "packages/a/package.json": pkg({ name: "@x/a", scripts: { test: "vitest", build: "tsc" } }), "packages/b/package.json": pkg({ name: "@x/b", scripts: { lint: "eslint ." } }),
    });
    expect(s.commands.map((c) => `${c.cwd || "."}: ${c.kind} ${c.cmd}`)).toEqual([
      ".: install pnpm install", ".: test pnpm test", "packages/a: test pnpm test", "packages/a: build pnpm run build", "packages/b: lint pnpm run lint",
    ]);
  });
});

describe("workspaces and monorepos", () => {
  it("finds packages from package.json workspaces, pnpm-workspace.yaml, Cargo, go.work and Gradle", () => {
    const npm = structureOf({
      "package.json": pkg({ name: "root", workspaces: ["apps/*", "packages/*"] }), "apps/web/package.json": pkg({ name: "web" }), "apps/api/package.json": pkg({ name: "api" }), "packages/ui/package.json": pkg({ name: "@x/ui" }), "docs/package.json": pkg({ name: "docs" }),
    });
    expect(npm.monorepo).toEqual({ tool: "npm workspaces", packages: [{ path: "apps/api", name: "api", kind: "npm" }, { path: "apps/web", name: "web", kind: "npm" }, { path: "packages/ui", name: "@x/ui", kind: "npm" }] });
    const pnpm = structureOf({ "pnpm-workspace.yaml": "packages:\n  - 'libs/*'\n", "package.json": pkg({ name: "r" }), "libs/a/package.json": pkg({ name: "a" }) });
    expect(pnpm.monorepo).toEqual({ tool: "pnpm workspaces", packages: [{ path: "libs/a", name: "a", kind: "npm" }] });
    const cargo = structureOf({ "Cargo.toml": '[workspace]\nmembers = ["crates/*"]', "crates/a/Cargo.toml": '[package]\nname = "a"', "crates/b/Cargo.toml": '[package]\nname = "b"' });
    expect(cargo.monorepo?.tool).toBe("cargo workspace");
    expect(cargo.monorepo?.packages.map((p) => p.path)).toEqual(["crates/a", "crates/b"]);
    const gradle = structureOf({ "settings.gradle": "rootProject.name = 'x'\ninclude ':app', ':lib'", "app/build.gradle": "", "lib/build.gradle": "" });
    expect(gradle.monorepo?.packages.map((p) => p.path)).toEqual(["app", "lib"]);
  });

  it("calls two unrelated manifests in one repo a multi-language repo, and one manifest not a monorepo at all", () => {
    const s = structureOf({ "backend/package.json": pkg({ name: "api" }), "mobile/pubspec.yaml": "name: app" });
    expect(s.monorepo).toEqual({ tool: "multi-language repo", packages: [{ path: "backend", name: "api", kind: "npm" }, { path: "mobile", name: "app", kind: "pubspec" }] });
    expect(structureOf({ "package.json": pkg({ name: "solo" }) }).monorepo).toBeNull();
  });
});

describe("entry points, CI, env vars, Docker, the README", () => {
  it("finds entry points from package.json, conventional names and the symbols that start a program", () => {
    const s = structureOf({
      "package.json": pkg({ name: "x", main: "./src/server.js", bin: { cli: "bin/cli.js" } }), "src/server.js": "", "bin/cli.js": "", "src/index.ts": "", "manage.py": "", "cmd/tool/main.go": "package main\nfunc main() {}",
      "scripts/run.py": "if __name__ == '__main__':\n    pass", "tests/helper_test.go": "package x\nfunc main() {}", "lib/main.dart": "void main() {}",
    }, { symbols: true });
    expect(s.entryPoints.map((e) => e.path)).toEqual(["src/server.js", "bin/cli.js", "src/index.ts", "manage.py", "lib/main.dart", "scripts/run.py", "cmd/tool/main.go"]);
  });

  it("lists CI files, and the env var names from .env.example and from the code, never a value", () => {
    const s = structureOf({
      ".github/workflows/ci.yml": "name: ci", ".github/workflows/deploy.yaml": "name: d", ".gitlab-ci.yml": "x: 1", ".circleci/config.yml": "x: 1",
      ".env.example": "# keys\nSTRIPE_KEY=sk_live_abc\nDB_URL=postgres://u:p@h\n", "src/a.ts": "process.env.STRIPE_KEY; process.env.OTHER_ONE;", "src/b.ts": "process.env.STRIPE_KEY",
    }, { symbols: true });
    expect(s.ci).toEqual([".circleci/config.yml", ".github/workflows/ci.yml", ".github/workflows/deploy.yaml", ".gitlab-ci.yml"]);
    expect(s.envVars).toEqual([{ name: "STRIPE_KEY", example: true, uses: 2 }, { name: "OTHER_ONE", example: false, uses: 1 }, { name: "DB_URL", example: true, uses: 0 }]);
    expect(JSON.stringify(s)).not.toMatch(/sk_live|postgres/);
  });

  it("reads Dockerfile and compose files: images, ports, services", () => {
    const s = structureOf({
      Dockerfile: "FROM node:20-alpine AS build\nFROM nginx\nEXPOSE 80 443/tcp\nCMD [\"nginx\"]",
      "docker-compose.yml": "services:\n  web:\n    image: acme/web\n    ports:\n      - \"8080:80\"\n  db:\n    image: postgres:16\n    ports: ['5432:5432']\n",
    });
    expect(s.docker.files).toEqual(["Dockerfile", "docker-compose.yml"]);
    expect(s.docker.images).toEqual(["node:20-alpine", "nginx", "acme/web", "postgres:16"]);
    expect(s.docker.ports).toEqual([80, 443, 5432]);
    expect(s.docker.services).toEqual(["web", "db"]);
  });

  it("takes the README's title and first sentence, from # or an underline", () => {
    expect(structureOf({ "README.md": "# Acme **Shop**\n\n[![ci](x)](y)\n\nA small shop for [people](https://x).\n" }).readme).toEqual({ path: "README.md", title: "Acme Shop", blurb: "A small shop for people." });
    expect(structureOf({ "README.md": "Acme\n====\n\nHello there.\n" }).readme?.title).toBe("Acme");
    expect(structureOf({ "src/a.ts": "" }).readme).toBeNull();
  });

  it("records secret files by path only", () => {
    const s = structureOf({ ".env": "SECRET=1", "keys/server.pem": "-----BEGIN", "a.ts": "" });
    expect(s.secretFiles).toEqual([".env", "keys/server.pem"]);
    expect(JSON.stringify(s)).not.toContain("SECRET=1");
  });
});

// ------------------------------------------------------------- conventions

const core = (files: Record<string, string>) => {
  const out: Record<string, CoreEntry> = {};
  for (const [p, t] of Object.entries(files)) { const kind = coreKindOf(p); if (kind) out[p] = { sha: "x", kind, data: extractCore(p, kind, t) }; }
  return out;
};

describe("conventions", () => {
  const base = (o: Partial<Parameters<typeof analyseConventions>[0]> = {}) => analyseConventions({
    paths: new Map(), core: {}, depNames: new Set(), languages: new Set(["TypeScript"]), sample: [], sniff: true, sourcePaths: [], symbols: [], commits: [], branches: [],
    defaultBranch: "main", prior: null, ...o,
  });

  it("keeps CLAUDE.md, AGENTS.md, .cursorrules and the rest verbatim as the project's rules, root files first", () => {
    const c = core({
      "CLAUDE.md": "# Rules\nAlways write tests.\n", "AGENTS.md": "Never touch generated files.\n", ".cursorrules": "Use tabs.", ".github/copilot-instructions.md": "Be brief.", "CONTRIBUTING.md": "Open an issue first.",
      "packages/a/CLAUDE.md": "Package rules.",
    });
    const rules = projectRules(c);
    expect(rules.map((r) => r.path)).toEqual(["CLAUDE.md", "AGENTS.md", ".cursorrules", ".github/copilot-instructions.md", "CONTRIBUTING.md", "packages/a/CLAUDE.md"]);
    expect(rules[0]).toEqual({ path: "CLAUDE.md", text: "# Rules\nAlways write tests.\n", truncated: false });
    expect(base({ core: c }).rules).toEqual(rules);
  });

  it("caps each doc at 6,000 characters and all of them at 16,000", () => {
    const long = "x".repeat(RULES_DOC_CHARS * 2);
    const c = core({ "CLAUDE.md": long, "AGENTS.md": long, ".cursorrules": long, "CONTRIBUTING.md": long });
    // extractCore already cuts a doc to its cap
    expect((c["CLAUDE.md"]!.data as { text: string }).text.length).toBe(RULES_DOC_CHARS);
    const rules = projectRules(c);
    expect(rules[0]!.truncated).toBe(true);
    expect(rules.reduce((n, r) => n + r.text.length, 0)).toBe(RULES_TOTAL_CHARS);
    expect(rules.length).toBe(3);
  });

  it("finds the formatter and linter from config files and dev dependencies, and the config files themselves", () => {
    const paths = new Map([[".prettierrc", 1], [".eslintrc.json", 1], [".editorconfig", 1], ["ruff.toml", 1], ["tsconfig.json", 1], ["src/a.ts", 1]]);
    const c = base({ paths, depNames: new Set(["black", "mypy"]), languages: new Set(["TypeScript", "Go", "Python"]) });
    expect(c.formatter).toEqual(["prettier", "black", "gofmt"]);
    expect(c.linter).toEqual(["eslint", "ruff", "mypy"]);
    expect(c.configs).toEqual([".editorconfig", ".eslintrc.json", ".prettierrc", "ruff.toml", "tsconfig.json"]);
  });

  it("sniffs two-space indent, single quotes and semicolons from a sample", () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `function f${i}() {\n  const a = 'x';\n  if (a) {\n    return a;\n  }\n}\n`).join("");
    const c = base({ sample: [{ path: "a.ts", lang: "TypeScript", text: lines(30) }] });
    expect(c.style).toMatchObject({ indent: "2 spaces", quotes: "single", semicolons: true });
    const tabs = Array.from({ length: 40 }, () => "function f() {\n\tconst a = \"x\"\n\treturn a\n}\n").join("");
    expect(base({ sample: [{ path: "b.ts", lang: "TypeScript", text: tabs }] }).style).toMatchObject({ indent: "tabs", quotes: "double", semicolons: false });
    expect(base({ sample: [{ path: "c.py", lang: "Python", text: "def f():\n    return 1\n".repeat(40) }] }).style.indent).toBe("4 spaces");
    expect(base({ sample: [] }).style).toMatchObject({ indent: null, quotes: null, semicolons: null });
  });

  it("lets the formatter's own settings beat the sniff", () => {
    const sample = [{ path: "a.ts", lang: "TypeScript", text: "function f() {\n  const a = \"x\"\n}\n".repeat(60) }];
    const c = base({ sample, core: core({ ".prettierrc": '{"singleQuote": true, "semi": false, "tabWidth": 4}' }) });
    expect(c.style).toMatchObject({ indent: "4 spaces", quotes: "single", semicolons: false });
    expect(base({ sample, core: core({ ".editorconfig": "root = true\n[*]\nindent_style = tab\n" }) }).style.indent).toBe("tabs");
  });

  it("reads the naming of files and functions", () => {
    const names = ["user-profile", "order-list", "cart-item", "sign-up-form", "nav-bar", "footer-links"].map((n) => `src/${n}.ts`);
    const fns = ["getUser", "setUser", "loadOrder", "saveOrder", "handleClick", "renderCart"].map((n) => ({ lang: "TypeScript", symbols: [{ name: n, kind: "function" as const, line: 1, exported: true }] }));
    expect(base({ sourcePaths: names, symbols: fns }).style).toMatchObject({ fileNames: "kebab-case", identifiers: "camelCase" });
    expect(base({ sourcePaths: ["a.py", "b.py"] }).style.fileNames).toBeNull();
  });

  it("recognises Conventional Commits, the scopes used, and freeform history", () => {
    const conv = base({ commits: ["feat(auth): add login", "fix(auth): token expiry", "chore: bump deps", "docs(readme): typo", "feat(ui)!: new nav", "Merge pull request #4 from x/y"] });
    expect(conv.commits).toMatchObject({ style: "conventional", conventionalPct: 100, scopes: ["auth", "readme", "ui"], sampled: 6 });
    expect(conv.commits.examples).toEqual(["feat(auth): add login", "fix(auth): token expiry", "chore: bump deps"]);
    const free = base({ commits: ["Add login", "Fix bug", "update stuff", "wip", "Merge branch 'x'"] });
    expect(free.commits.style).toBe("freeform");
    expect(base({ commits: ["one", "two"] }).commits.style).toBe("unknown");
  });

  it("looks at the last 30 commit messages and no further, and never keeps an example that holds a secret", () => {
    const commits = ["fix: key AKIAIOSFODNN7EXAMPLE leaked", "feat: ok", ...Array.from({ length: 28 }, () => "fix: x"), ...Array.from({ length: 40 }, () => "plain old message")];
    const c = base({ commits });
    expect(c.commits.sampled).toBe(30);
    expect(c.commits.style).toBe("conventional");
    expect(JSON.stringify(c.commits.examples)).not.toContain("AKIA");
  });

  it("reads how branches are named, leaving out Tailzu's own and dependabot's", () => {
    const c = base({ branches: ["main", "feature/login", "feature/cart", "fix/typo", "fix/bug", "tailzu/x-1a2b", "dependabot/npm/y", "release/1.0"] });
    expect(c.branches).toEqual({ default: "main", naming: "feature/<name>, fix/<name>", examples: ["feature/login", "feature/cart", "fix/typo", "fix/bug", "release/1.0"] });
  });

  it("keeps what it knew when this build has no commits or branches to look at", () => {
    const prior = { ...EMPTY_CONVENTIONS, commits: { style: "conventional" as const, conventionalPct: 90, scopes: ["a"], examples: ["feat: x"], sampled: 30 } };
    expect(base({ prior, sniff: false }).commits.style).toBe("conventional");
  });
});
