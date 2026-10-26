/**
 * THE SHAPE OF A PROJECT, READ FROM ITS MANIFESTS AND ITS TREE: NO MODEL.
 *
 * Two steps. extractCore reads ONE core file (a manifest, a config, the README,
 * an agent doc) into a few facts, and the build keeps those facts keyed by the
 * file's blob sha, so a push that touches one package.json reads one
 * package.json. buildStructure puts all of them, and the tree, together:
 *
 *   languages          by bytes, from the tree alone (so even a repo too big to
 *                      download has them)
 *   package managers   from lockfiles and manifests (a lockfile is not read,
 *                      its name says enough)
 *   frameworks         from the dependencies in package.json, requirements and
 *                      pyproject, go.mod, Cargo.toml, pubspec.yaml, Gemfile,
 *                      composer.json, build.gradle and pom.xml, Package.swift
 *   workspaces         package.json workspaces, pnpm-workspace.yaml, lerna,
 *                      Cargo and Gradle members, go.work; or, without them,
 *                      several unrelated manifests in one repo
 *   entry points       main/bin/exports, src/index, main.py, cmd/*, lib/main.dart,
 *                      manage.py, and the files the symbols say start a program
 *   commands           install, dev, build, test, lint, typecheck, format, with
 *                      the package manager's prefix (npm run, pnpm, yarn, bun,
 *                      poetry run, cargo, go...) and the folder to run them in
 *   CI files, env var names (from .env.example and from the code), Docker, the
 *   README's title, and which secret files exist (their paths only)
 *
 * It reads the repo as it is; it never runs anything.
 */
import { baseName, dirName, isBinaryPath, isCodeLanguage, isGeneratedPath, isLockfile, isSecretPath, isTestPath, isVendoredPath, languageOf } from "./lang.js";
import { asArr, asStr, isObj, parseGoMod, parseJsonc, parseToml, parseYaml, type Json, type Obj } from "./parse.js";
import { coreKindOf } from "./snapshot.js";
import {
  EMPTY_STRUCTURE, RULES_DOC_CHARS,
  type Command, type CommandKind, type CoreEntry, type LanguageShare, type PackageInfo, type Structure, type SymbolInfo, type TreeInfo,
} from "./types.js";

// ------------------------------------------------------------------ the core

const names = (v: unknown): string[] => (isObj(v) ? Object.keys(v) : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const strMap = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (isObj(v)) for (const [k, x] of Object.entries(v)) out[k] = typeof x === "string" ? x : isObj(x) && typeof x.version === "string" ? x.version : "";
  return out;
};

/** A requirement line: name and version spec, or null for a comment, an option or a URL. */
function pipLine(line: string): [string, string] | null {
  const l = line.split("#")[0]!.trim();
  if (!l || l.startsWith("-") || /^(?:git\+|https?:|\.|\/)/.test(l)) return null;
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*((?:[<>=!~]=?|===)[^;#]*)?/.exec(l);
  return m ? [m[1]!.toLowerCase().replace(/_/g, "-"), (m[2] ?? "").replace(/\s+/g, "").trim()] : null;
}

/** What one core file says, in a form that is small and plain data. `kind` is snapshot.ts coreKindOf. */
export function extractCore(path: string, kind: string, text: string): Record<string, unknown> {
  switch (kind) {
    case "npm": {
      const j = parseJsonc(text);
      if (!isObj(j)) return {};
      const ws = j.workspaces;
      const bin = typeof j.bin === "string" ? [j.bin] : isObj(j.bin) ? Object.values(j.bin).filter((x): x is string => typeof x === "string") : [];
      return {
        name: asStr(j.name), private: j.private === true, main: asStr(j.main) || asStr(j.module), bin, type: asStr(j.type),
        scripts: strMap(j.scripts), deps: names(j.dependencies), devDeps: names(j.devDependencies), peerDeps: names(j.peerDependencies),
        depVersions: { ...strMap(j.devDependencies), ...strMap(j.dependencies) },
        workspaces: Array.isArray(ws) ? ws.filter((x): x is string => typeof x === "string") : isObj(ws) ? names(ws.packages) : null,
        packageManager: asStr(j.packageManager).split("@")[0] ?? "",
      };
    }
    case "tsconfig": {
      const j = parseJsonc(text);
      if (!isObj(j)) return {};
      const co = isObj(j.compilerOptions) ? j.compilerOptions : {};
      const paths: Record<string, string[]> = {};
      if (isObj(co.paths)) for (const [k, v] of Object.entries(co.paths)) paths[k] = asArr(v).filter((x): x is string => typeof x === "string");
      return { extends: typeof j.extends === "string" ? j.extends : "", baseUrl: asStr(co.baseUrl), paths, hasPaths: isObj(co.paths) };
    }
    case "requirements": {
      const deps: Array<[string, string]> = [];
      for (const l of text.split("\n")) { const p = pipLine(l); if (p) deps.push(p); }
      return { deps };
    }
    case "pyproject": {
      const t = parseToml(text);
      const project = isObj(t.project) ? t.project : {};
      const tool = isObj(t.tool) ? t.tool : {};
      const poetry = isObj(tool.poetry) ? tool.poetry : {};
      const deps: Array<[string, string]> = [];
      for (const d of asArr(project.dependencies)) if (typeof d === "string") { const p = pipLine(d); if (p) deps.push(p); }
      for (const [k, v] of Object.entries(isObj(poetry.dependencies) ? poetry.dependencies : {})) if (k.toLowerCase() !== "python") deps.push([k.toLowerCase().replace(/_/g, "-"), typeof v === "string" ? v : isObj(v) ? asStr(v.version) : ""]);
      const opt = isObj(project["optional-dependencies"]) ? project["optional-dependencies"] : {};
      for (const group of Object.values(opt)) for (const d of asArr(group)) if (typeof d === "string") { const p = pipLine(d); if (p) deps.push(p); }
      const devGroup = isObj(poetry.group) ? Object.values(poetry.group).flatMap((g) => (isObj(g) && isObj(g.dependencies) ? Object.keys(g.dependencies) : [])) : [];
      for (const d of [...names(poetry["dev-dependencies"]), ...devGroup]) deps.push([d.toLowerCase().replace(/_/g, "-"), ""]);
      const build = isObj(t["build-system"]) ? asStr(t["build-system"]["build-backend"]) : "";
      return {
        name: asStr(project.name) || asStr(poetry.name),
        deps, tools: Object.keys(tool), scripts: { ...strMap(project.scripts), ...strMap(poetry.scripts) },
        backend: build, requiresPython: asStr(project["requires-python"]),
        manager: tool.poetry ? "poetry" : tool.uv ? "uv" : tool.pdm ? "pdm" : tool.hatch ? "hatch" : "pip",
      };
    }
    case "pipfile": {
      const t = parseToml(text);
      return { deps: [...names(t.packages), ...names(t["dev-packages"])].map((d) => [d.toLowerCase(), ""]) };
    }
    case "gomod": { const g = parseGoMod(text); return { module: g.module, goVersion: g.goVersion, requires: g.requires.slice(0, 200) }; }
    case "gowork": return { uses: [...text.matchAll(/^\s*(?:use\s+)?(\.{1,2}\/[^\s)]*|\.)\s*$/gm)].map((m) => m[1]!.replace(/^\.\//, "")).filter(Boolean) };
    case "cargo": {
      const t = parseToml(text);
      const pkg = isObj(t.package) ? t.package : {};
      const ws = isObj(t.workspace) ? t.workspace : {};
      return {
        name: asStr(pkg.name), deps: names(t.dependencies), dev: names(t["dev-dependencies"]),
        members: asArr(ws.members).filter((x): x is string => typeof x === "string"),
        bins: asArr(t.bin).flatMap((b) => (isObj(b) && typeof b.name === "string" ? [b.name] : [])),
        hasWorkspace: isObj(t.workspace),
      };
    }
    case "pubspec": {
      const y = parseYaml(text);
      if (!isObj(y)) return {};
      const dependencies = isObj(y.dependencies) ? y.dependencies : {};
      return {
        name: asStr(y.name), deps: Object.keys(dependencies), devDeps: names(y.dev_dependencies),
        flutter: "flutter" in dependencies || isObj(y.flutter), depVersions: strMap(dependencies),
      };
    }
    case "gemfile": return { gems: [...text.matchAll(/^\s*gem\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]!) };
    case "composer": {
      const j = parseJsonc(text);
      if (!isObj(j)) return {};
      return { name: asStr(j.name), deps: names(j.require), devDeps: names(j["require-dev"]), scripts: strMap(j.scripts), depVersions: { ...strMap(j["require-dev"]), ...strMap(j.require) } };
    }
    case "gradle": {
      const deps = [...text.matchAll(/(?:implementation|api|compileOnly|runtimeOnly|testImplementation|kapt|ksp|classpath)\s*\(?\s*["']([\w.-]+:[\w.-]+)/g)].map((m) => m[1]!);
      const plugins = [...text.matchAll(/(?:\bid\s*\(?\s*["']([\w.-]+)["']|apply\s+plugin:\s*["']([\w.-]+)["']|\bkotlin\("([\w.-]+)"\))/g)].map((m) => m[1] ?? m[2] ?? `org.jetbrains.kotlin.${m[3]}`);
      return { deps: deps.slice(0, 200), plugins };
    }
    case "gradle-settings": return { includes: [...text.matchAll(/include\s*\(?\s*((?:["'][^"']+["']\s*,?\s*)+)/g)].flatMap((m) => [...m[1]!.matchAll(/["']:?([^"']+)["']/g)].map((x) => x[1]!.replace(/:/g, "/"))) };
    case "maven": {
      const deps = [...text.matchAll(/<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>/g)].map((m) => `${m[1]}:${m[2]}`);
      return { name: /<artifactId>([^<]+)<\/artifactId>/.exec(text.replace(/<parent>[\s\S]*?<\/parent>/, ""))?.[1] ?? "", deps: deps.slice(0, 200), modules: [...text.matchAll(/<module>([^<]+)<\/module>/g)].map((m) => m[1]!) };
    }
    case "swiftpm": return { name: /name:\s*"([^"]+)"/.exec(text)?.[1] ?? "", deps: [...text.matchAll(/\.package\(\s*(?:name:\s*"[^"]*",\s*)?url:\s*"([^"]+)"/g)].map((m) => m[1]!) };
    case "dotnet": return { packages: [...text.matchAll(/<PackageReference\s+Include="([^"]+)"/g)].map((m) => m[1]!) };
    case "make": {
      const targets = [...text.matchAll(/^([A-Za-z0-9_.-]+)\s*:(?!=)/gm)].map((m) => m[1]!).filter((t) => !t.startsWith("."));
      return { targets: [...new Set(targets)].slice(0, 60) };
    }
    case "docker": {
      return {
        images: [...text.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/gim)].map((m) => m[1]!).filter((i) => i.toLowerCase() !== "scratch"),
        ports: [...text.matchAll(/^\s*EXPOSE\s+(.+)$/gim)].flatMap((m) => [...m[1]!.matchAll(/\b(\d{2,5})\b/g)].map((x) => Number(x[1]))),
        cmd: /^\s*(?:CMD|ENTRYPOINT)\s+(.+)$/im.exec(text)?.[1]?.slice(0, 160) ?? "",
      };
    }
    case "compose": {
      const y = parseYaml(text);
      const services = isObj(y) && isObj(y.services) ? y.services : {};
      const images: string[] = [];
      const ports: number[] = [];
      for (const s of Object.values(services)) {
        if (!isObj(s)) continue;
        if (typeof s.image === "string") images.push(s.image);
        for (const p of asArr(s.ports)) { const m = /(\d{2,5})(?:\/\w+)?$/.exec(String(p).replace(/^["']|["']$/g, "")); if (m) ports.push(Number(m[1])); }
      }
      return { services: Object.keys(services), images, ports };
    }
    case "readme": {
      const lines = text.split("\n");
      let title = "";
      const h = lines.find((l) => /^#\s+\S/.test(l));
      if (h) title = h.replace(/^#\s+/, "").replace(/[`*_[\]]|\(http[^)]*\)/g, "").replace(/<[^>]+>/g, "").trim();
      if (!title) {
        const alt = lines.findIndex((l, i) => l.trim() && /^[=-]{3,}\s*$/.test(lines[i + 1] ?? ""));
        title = alt >= 0 ? lines[alt]!.trim() : "";
      }
      let blurb = "";
      for (const l of lines) {
        const t = l.trim();
        if (!t || /^[#>!<[|=\-`*]/.test(t) || /^(?:\[!|<img|<p|<div|<a )/i.test(t)) continue;
        blurb = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "").slice(0, 220);
        break;
      }
      return { title: title.slice(0, 120), blurb };
    }
    case "agent-doc": return { text: text.slice(0, RULES_DOC_CHARS), truncated: text.length > RULES_DOC_CHARS };
    case "env-example": return { names: [...new Set([...text.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=/gm)].map((m) => m[1]!))].slice(0, 300) };
    case "workspace": {
      const b = baseName(path).toLowerCase();
      if (b === "pnpm-workspace.yaml") { const y = parseYaml(text); return { tool: "pnpm", packages: isObj(y) ? asArr(y.packages).filter((x): x is string => typeof x === "string") : [] }; }
      if (b === "lerna.json") { const j = parseJsonc(text); return { tool: "lerna", packages: isObj(j) ? asArr(j.packages).filter((x): x is string => typeof x === "string") : [] }; }
      return { tool: b.replace(/\.json$/, ""), packages: [] };
    }
    case "editor": {
      if (baseName(path).toLowerCase() === "biome.json") {
        const j = parseJsonc(text);
        const f = isObj(j) && isObj(j.formatter) ? j.formatter : {};
        const js = isObj(j) && isObj(j.javascript) && isObj(j.javascript.formatter) ? j.javascript.formatter : {};
        return { tool: "biome", indentStyle: asStr(f.indentStyle), indentSize: Number(f.indentWidth) || null, quoteStyle: asStr(js.quoteStyle), semicolons: asStr(js.semicolons) };
      }
      const all = /^\s*\[\*\]([\s\S]*?)(?=^\s*\[|$(?![\s\S]))/m.exec(text)?.[1] ?? text;
      return {
        tool: "editorconfig", indentStyle: /indent_style\s*=\s*(\w+)/.exec(all)?.[1] ?? "", indentSize: Number(/indent_size\s*=\s*(\d+)/.exec(all)?.[1]) || null,
      };
    }
    case "prettier": {
      const j = /\.(?:ya?ml)$/.test(path) ? parseYaml(text) : parseJsonc(text);
      const o: Obj = isObj(j) ? j : {};
      const js = (k: string) => new RegExp(`\\b${k}\\s*:\\s*(true|false)`).exec(text)?.[1];
      return {
        semi: typeof o.semi === "boolean" ? o.semi : js("semi") ? js("semi") === "true" : null,
        singleQuote: typeof o.singleQuote === "boolean" ? o.singleQuote : js("singleQuote") ? js("singleQuote") === "true" : null,
        useTabs: typeof o.useTabs === "boolean" ? o.useTabs : js("useTabs") ? js("useTabs") === "true" : null,
        tabWidth: typeof o.tabWidth === "number" ? o.tabWidth : Number(/\btabWidth\s*:\s*(\d+)/.exec(text)?.[1]) || null,
      };
    }
    default: return {};
  }
}

// --------------------------------------------------------------- frameworks

type Matcher = string | RegExp;
/** Dependency names to the label of what they mean, most important first. */
const FRAMEWORKS: Array<[Matcher, string]> = [
  ["next", "Next.js"], ["nuxt", "Nuxt"], [/^@remix-run\//, "Remix"], ["gatsby", "Gatsby"], ["astro", "Astro"], ["@sveltejs/kit", "SvelteKit"],
  ["react-native", "React Native"], ["expo", "Expo"], ["react", "React"], ["vue", "Vue"], ["svelte", "Svelte"], ["@angular/core", "Angular"],
  ["solid-js", "Solid"], ["preact", "Preact"], ["electron", "Electron"], [/^@tauri-apps\//, "Tauri"],
  ["express", "Express"], ["fastify", "Fastify"], ["hono", "Hono"], ["koa", "Koa"], ["@nestjs/core", "NestJS"], ["@trpc/server", "tRPC"],
  [/^(?:@apollo\/|apollo-server)/, "GraphQL (Apollo)"], ["graphql", "GraphQL"],
  [/^(?:@prisma\/client|prisma)$/, "Prisma"], ["drizzle-orm", "Drizzle"], ["typeorm", "TypeORM"], ["sequelize", "Sequelize"], ["mongoose", "Mongoose"], ["knex", "Knex"],
  ["tailwindcss", "Tailwind CSS"], ["styled-components", "styled-components"], [/^@emotion\//, "Emotion"], ["@mui/material", "Material UI"], ["antd", "Ant Design"], ["@chakra-ui/react", "Chakra UI"],
  ["@reduxjs/toolkit", "Redux Toolkit"], ["redux", "Redux"], ["zustand", "Zustand"], ["mobx", "MobX"], ["@tanstack/react-query", "TanStack Query"], ["swr", "SWR"],
  [/^react-router/, "React Router"], [/^@storybook\//, "Storybook"],
  ["vite", "Vite"], ["webpack", "webpack"], ["rollup", "Rollup"], ["esbuild", "esbuild"], ["parcel", "Parcel"],
  ["firebase", "Firebase"], ["@supabase/supabase-js", "Supabase"], ["stripe", "Stripe"], ["socket.io", "Socket.IO"], ["zod", "Zod"],
  ["vitest", "Vitest"], ["jest", "Jest"], ["mocha", "Mocha"], ["@playwright/test", "Playwright"], ["cypress", "Cypress"], [/^@testing-library\//, "Testing Library"],
  ["typescript", "TypeScript"], ["eslint", "ESLint"], ["prettier", "Prettier"],
  // Python
  ["django", "Django"], ["djangorestframework", "Django REST framework"], ["fastapi", "FastAPI"], ["flask", "Flask"], ["starlette", "Starlette"], ["tornado", "Tornado"],
  ["aiohttp", "aiohttp"], ["sanic", "Sanic"], ["streamlit", "Streamlit"], ["gradio", "Gradio"], ["celery", "Celery"], ["sqlalchemy", "SQLAlchemy"], ["alembic", "Alembic"],
  ["pydantic", "Pydantic"], ["pytest", "pytest"], ["numpy", "NumPy"], ["pandas", "pandas"], ["scikit-learn", "scikit-learn"], ["torch", "PyTorch"], ["tensorflow", "TensorFlow"],
  ["transformers", "Transformers"], ["langchain", "LangChain"], ["openai", "OpenAI SDK"], ["anthropic", "Anthropic SDK"], ["scrapy", "Scrapy"], ["apache-airflow", "Airflow"],
  // Go
  ["github.com/gin-gonic/gin", "Gin"], ["github.com/labstack/echo", "Echo"], [/^github\.com\/gofiber\/fiber/, "Fiber"], [/^github\.com\/go-chi\/chi/, "chi"],
  ["github.com/gorilla/mux", "Gorilla Mux"], ["gorm.io/gorm", "GORM"], ["github.com/spf13/cobra", "Cobra"], ["google.golang.org/grpc", "gRPC"],
  // Rust
  ["actix-web", "Actix Web"], ["axum", "Axum"], ["rocket", "Rocket"], ["tokio", "Tokio"], ["serde", "Serde"], ["clap", "clap"], ["diesel", "Diesel"], ["sqlx", "SQLx"],
  ["sea-orm", "SeaORM"], ["tauri", "Tauri"], ["warp", "Warp"], ["bevy", "Bevy"], ["yew", "Yew"], ["leptos", "Leptos"],
  // Dart / Flutter
  ["flutter", "Flutter"], [/^(?:flutter_)?riverpod$/, "Riverpod"], ["flutter_riverpod", "Riverpod"], [/^(?:flutter_)?bloc$/, "Bloc"], ["provider", "Provider"], ["get", "GetX"],
  ["go_router", "go_router"], ["auto_route", "auto_route"], ["dio", "Dio"], ["firebase_core", "Firebase"], ["supabase_flutter", "Supabase"], ["hive", "Hive"], ["isar", "Isar"],
  ["freezed", "freezed"], ["get_it", "get_it"],
  // Ruby, PHP
  ["rails", "Rails"], ["sinatra", "Sinatra"], ["rspec", "RSpec"], ["rspec-rails", "RSpec"], ["sidekiq", "Sidekiq"], ["devise", "Devise"], ["rubocop", "RuboCop"], ["puma", "Puma"],
  ["laravel/framework", "Laravel"], [/^symfony\/framework-bundle/, "Symfony"], ["slim/slim", "Slim"], ["phpunit/phpunit", "PHPUnit"], ["livewire/livewire", "Livewire"],
  // JVM, .NET, Swift
  [/^org\.springframework\.boot/, "Spring Boot"], [/^io\.ktor:/, "Ktor"], [/^io\.micronaut/, "Micronaut"], [/^io\.quarkus/, "Quarkus"], [/^androidx\.compose/, "Jetpack Compose"],
  ["com.android.application", "Android"], ["com.android.library", "Android"], [/^com\.squareup\.retrofit2/, "Retrofit"], [/^androidx\.room/, "Room"], [/^com\.google\.dagger/, "Dagger/Hilt"],
  [/^org\.junit/, "JUnit"], [/^junit:/, "JUnit"],
  ["Microsoft.AspNetCore.App", "ASP.NET Core"], ["Microsoft.EntityFrameworkCore", "Entity Framework"], ["xunit", "xUnit"], ["NUnit", "NUnit"],
  [/vapor\/vapor/, "Vapor"],
];

function frameworksOf(deps: Iterable<string>): string[] {
  const have = [...new Set(deps)];
  const out: string[] = [];
  for (const [m, label] of FRAMEWORKS) {
    const hit = typeof m === "string" ? have.includes(m) : have.some((d) => m.test(d));
    if (hit && !out.includes(label)) out.push(label);
  }
  return out;
}

// --------------------------------------------------------------- the pieces

/** Every language share, from the tree: the bytes of files that are not vendored, generated, locked, secret or binary. */
export function languageShares(tree: TreeInfo): LanguageShare[] {
  const by = new Map<string, { bytes: number; files: number }>();
  let total = 0;
  for (const [path, f] of tree.files) {
    if (isVendoredPath(path) || isGeneratedPath(path) || isLockfile(path) || isSecretPath(path) || isBinaryPath(path)) continue;
    const lang = languageOf(path);
    if (!isCodeLanguage(lang)) continue;
    const cur = by.get(lang) ?? { bytes: 0, files: 0 };
    cur.bytes += f.size;
    cur.files += 1;
    by.set(lang, cur);
    total += f.size;
  }
  return [...by.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 10)
    .map(([lang, v]) => ({ lang, bytes: v.bytes, files: v.files, pct: total ? Math.round((v.bytes / total) * 1000) / 10 : 0 }));
}

const LOCK_MANAGER: Record<string, string> = {
  "pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn", "package-lock.json": "npm", "npm-shrinkwrap.json": "npm", "bun.lockb": "bun", "bun.lock": "bun",
  "poetry.lock": "poetry", "uv.lock": "uv", "pipfile.lock": "pipenv", "pdm.lock": "pdm", "cargo.lock": "cargo", "gemfile.lock": "bundler", "composer.lock": "composer",
  "go.sum": "go modules", "pubspec.lock": "pub", "podfile.lock": "cocoapods", "package.resolved": "swiftpm", "gradle.lockfile": "gradle",
};

function matchGlob(pattern: string, dir: string): boolean {
  const p = pattern.replace(/^\.\//, "").replace(/\/+$/, "");
  if (p.startsWith("!")) return false;
  const re = new RegExp(`^${p.split("/").map((seg) => (seg === "**" ? ".*" : seg.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, "[^/]*"))).join("/")}$`);
  return re.test(dir);
}

const MANIFEST_KINDS = new Set(["npm", "pyproject", "pipfile", "gomod", "cargo", "pubspec", "gemfile", "composer", "gradle", "maven", "swiftpm", "dotnet"]);

export interface ScanInput {
  tree: TreeInfo;
  /** Everything the core files said, by path. Only paths in the tree. */
  core: Record<string, CoreEntry>;
  lockfiles: readonly string[];
  secretFiles: readonly string[];
  skipped: Structure["skipped"];
  /** Per analysed file: its language, size and symbols (env names and entry marks are among them). */
  files: ReadonlyArray<{ path: string; lang: string; symbols: readonly SymbolInfo[] }>;
  analysedCount: number;
  mode: Structure["mode"];
  note: string;
  skippedBlobs: Record<string, string>;
}

const get = (e: CoreEntry | undefined) => (e?.data ?? {}) as Record<string, unknown>;
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const pairs = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap((x) => (Array.isArray(x) && typeof x[0] === "string" ? [x[0]] : [])) : []);

/** Dependencies of every manifest, as one list of names (with Go modules and Maven coordinates in their own form). */
function allDeps(core: Record<string, CoreEntry>): string[] {
  const out: string[] = [];
  for (const e of Object.values(core)) {
    const d = get(e);
    switch (e.kind) {
      case "npm": out.push(...strs(d.deps), ...strs(d.devDeps)); break;
      case "requirements": case "pyproject": case "pipfile": out.push(...pairs(d.deps)); break;
      case "gomod": out.push(...strs(d.requires).map((r) => r)); break;
      case "cargo": out.push(...strs(d.deps), ...strs(d.dev)); break;
      case "pubspec": out.push(...strs(d.deps), ...strs(d.devDeps)); if (d.flutter) out.push("flutter"); break;
      case "gemfile": out.push(...strs(d.gems)); break;
      case "composer": out.push(...strs(d.deps), ...strs(d.devDeps)); break;
      case "gradle": out.push(...strs(d.deps), ...strs(d.plugins)); break;
      case "maven": out.push(...strs(d.deps)); break;
      case "dotnet": out.push(...strs(d.packages)); break;
      case "swiftpm": out.push(...strs(d.deps)); break;
      default: break;
    }
  }
  return out;
}

function packageManagers(input: ScanInput, deps: string[]): string[] {
  const out: string[] = [];
  const add = (m: string) => { if (!out.includes(m)) out.push(m); };
  for (const l of input.lockfiles) { const m = LOCK_MANAGER[baseName(l).toLowerCase()]; if (m) add(m); }
  const kinds = new Map<string, number>();
  for (const e of Object.values(input.core)) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  for (const e of Object.values(input.core)) {
    if (e.kind === "npm" && get(e).packageManager) add(String(get(e).packageManager));
    if (e.kind === "pyproject") add(String(get(e).manager ?? "pip"));
  }
  if (kinds.get("npm") && !out.some((m) => ["npm", "pnpm", "yarn", "bun"].includes(m))) add("npm");
  if (kinds.get("requirements") && !out.some((m) => ["poetry", "uv", "pipenv", "pdm", "pip"].includes(m))) add("pip");
  if (kinds.get("pipfile")) add("pipenv");
  if (kinds.get("cargo")) add("cargo");
  if (kinds.get("gomod")) add("go modules");
  if (kinds.get("gemfile")) add("bundler");
  if (kinds.get("composer")) add("composer");
  if (kinds.get("pubspec")) add(deps.includes("flutter") ? "pub (flutter)" : "pub");
  if (kinds.get("gradle")) add("gradle");
  if (kinds.get("maven")) add("maven");
  if (kinds.get("swiftpm")) add("swiftpm");
  if (kinds.get("dotnet")) add("nuget");
  for (const p of input.tree.files.keys()) if (baseName(p) === "Podfile" && !isVendoredPath(p)) add("cocoapods");
  return out;
}

// ----------------------------------------------------------- the workspaces

function packagesOf(input: ScanInput): { tool: string; packages: PackageInfo[] } | null {
  const { tree, core } = input;
  const manifestDirs = new Map<string, { kind: string; name?: string }>();
  for (const [path, e] of Object.entries(core)) {
    if (!MANIFEST_KINDS.has(e.kind) || isVendoredPath(path)) continue;
    const dir = dirName(path);
    const cur = manifestDirs.get(dir);
    // An npm manifest names the package; other kinds name an ecosystem.
    if (!cur || e.kind === "npm") manifestDirs.set(dir, { kind: e.kind, name: asStr(get(e).name) || undefined });
  }
  const patterns: string[] = [];
  let tool = "";
  const rootNpm = core["package.json"];
  const ws = rootNpm ? get(rootNpm).workspaces : null;
  if (Array.isArray(ws) && ws.length) { patterns.push(...strs(ws)); tool = String(get(rootNpm).packageManager ?? "") || "npm workspaces"; }
  for (const [path, e] of Object.entries(core)) {
    if (e.kind === "workspace" && !isVendoredPath(path)) {
      const d = get(e);
      if (strs(d.packages).length) { patterns.push(...strs(d.packages)); tool = String(d.tool); }
      else if (!tool) tool = String(d.tool);
    }
    if (e.kind === "cargo" && get(e).hasWorkspace) { patterns.push(...strs(get(e).members)); tool ||= "cargo workspace"; }
    if (e.kind === "gowork") { patterns.push(...strs(get(e).uses)); tool ||= "go workspace"; }
    if (e.kind === "gradle-settings") { patterns.push(...strs(get(e).includes)); tool ||= "gradle multi-project"; }
    if (e.kind === "maven" && strs(get(e).modules).length) { patterns.push(...strs(get(e).modules)); tool ||= "maven modules"; }
  }
  if (tool === "pnpm" || tool === "yarn" || tool === "bun") tool = `${tool} workspaces`;
  if (tool === "turbo") tool = "turborepo";

  if (patterns.length) {
    const packages: PackageInfo[] = [];
    const seen = new Set<string>();
    const dirs = [...tree.dirs.keys()].filter((d) => d !== "" && !isVendoredPath(`${d}/x`));
    for (const pat of patterns) {
      for (const d of dirs) {
        if (!seen.has(d) && matchGlob(pat, d)) {
          const m = manifestDirs.get(d);
          if (m || /gradle|maven/.test(tool)) { seen.add(d); packages.push({ path: d, ...(m?.name ? { name: m.name } : {}), kind: m?.kind ?? "module" }); }
        }
      }
    }
    if (packages.length) return { tool: tool || "workspaces", packages: packages.sort((a, b) => (a.path < b.path ? -1 : 1)).slice(0, 80) };
  }
  // No declared workspace: several unrelated manifests in one repo (a backend and a mobile app, say).
  const roots = [...manifestDirs.entries()].filter(([d]) => d.split("/").length <= 3);
  const independent = roots.filter(([d], _i, all) => !all.some(([o]) => o !== d && o !== "" && d.startsWith(`${o}/`)));
  if (independent.length >= 2 || (independent.length === 1 && independent[0]![0] !== "" && manifestDirs.size >= 2)) {
    const kinds = new Set(independent.map(([, v]) => v.kind));
    if (independent.length >= 2) {
      return { tool: kinds.size > 1 ? "multi-language repo" : "multi-package repo", packages: independent.map(([d, v]) => ({ path: d || ".", ...(v.name ? { name: v.name } : {}), kind: v.kind })).sort((a, b) => (a.path < b.path ? -1 : 1)).slice(0, 80) };
    }
  }
  return null;
}

// ------------------------------------------------------------------ commands

type Prefixer = (script: string) => string;

function jsPrefix(pm: string): Prefixer {
  switch (pm) {
    case "pnpm": return (s) => (s === "test" || s === "start" ? `pnpm ${s}` : `pnpm run ${s}`);
    case "yarn": return (s) => `yarn ${s}`;
    case "bun": return (s) => `bun run ${s}`;
    default: return (s) => (s === "test" || s === "start" ? `npm ${s}` : `npm run ${s}`);
  }
}

const pickScript = (scripts: Record<string, string>, ...patterns: RegExp[]): string | null => {
  for (const re of patterns) { const k = Object.keys(scripts).find((s) => re.test(s)); if (k) return k; }
  return null;
};

function jsCommands(dir: string, scripts: Record<string, string>, pm: string, source: string, hasLock: boolean): Command[] {
  const out: Command[] = [];
  const run = jsPrefix(pm);
  const add = (kind: CommandKind, script: string | null) => { if (script) out.push({ kind, cmd: run(script), cwd: dir, source }); };
  add("test", pickScript(scripts, /^test$/, /^test:(?:unit|ci|all)$/, /^test:/));
  add("lint", pickScript(scripts, /^lint$/, /^lint:(?:all|ci)$/, /^lint:/, /^eslint$/));
  add("typecheck", pickScript(scripts, /^(?:typecheck|type-check|check-types|check:types|tsc|types)$/, /^check$/));
  add("build", pickScript(scripts, /^build$/, /^build:(?:prod|all)$/, /^compile$/));
  add("dev", pickScript(scripts, /^dev$/, /^start:dev$/, /^develop$/, /^serve$/));
  add("format", pickScript(scripts, /^(?:format|fmt|prettier)$/));
  add("run", pickScript(scripts, /^start$/));
  if (out.length || Object.keys(scripts).length) {
    const install = pm === "npm" ? (hasLock ? "npm ci" : "npm install") : `${pm} install`;
    out.unshift({ kind: "install", cmd: install, cwd: dir, source });
  }
  return out;
}

function commandsOf(input: ScanInput, managers: string[], packages: PackageInfo[]): Command[] {
  const out: Command[] = [];
  const { core, tree } = input;
  const has = (name: string) => tree.files.has(name);
  const jsManager = managers.find((m) => ["pnpm", "yarn", "bun", "npm"].includes(m)) ?? "npm";
  const hasNpmLock = [...input.lockfiles].some((l) => baseName(l) === "package-lock.json" || baseName(l) === "npm-shrinkwrap.json");
  const seenDirs = new Set<string>();

  for (const [path, e] of Object.entries(core)) {
    if (isVendoredPath(path)) continue;
    const dir = dirName(path);
    const d = get(e);
    if (e.kind === "npm" && isObj(d.scripts as Json)) {
      seenDirs.add(dir);
      // A package in a workspace installs from the root; its own scripts run in its folder.
      const cmds = jsCommands(dir, d.scripts as Record<string, string>, jsManager, path, hasNpmLock);
      out.push(...(dir !== "" && packages.length ? cmds.filter((c) => c.kind !== "install") : cmds));
    } else if (e.kind === "gomod") {
      out.push({ kind: "install", cmd: "go mod download", cwd: dir, source: path }, { kind: "build", cmd: "go build ./...", cwd: dir, source: path },
        { kind: "test", cmd: "go test ./...", cwd: dir, source: path }, { kind: "typecheck", cmd: "go vet ./...", cwd: dir, source: path });
      if ([".golangci.yml", ".golangci.yaml", ".golangci.toml"].some((f) => has(dir ? `${dir}/${f}` : f))) out.push({ kind: "lint", cmd: "golangci-lint run", cwd: dir, source: path });
    } else if (e.kind === "cargo" && !(d.hasWorkspace === false && dir !== "" && packages.some((p) => p.path === dir))) {
      out.push({ kind: "install", cmd: "cargo fetch", cwd: dir, source: path }, { kind: "build", cmd: "cargo build", cwd: dir, source: path },
        { kind: "test", cmd: "cargo test", cwd: dir, source: path }, { kind: "lint", cmd: "cargo clippy", cwd: dir, source: path },
        { kind: "typecheck", cmd: "cargo check", cwd: dir, source: path }, { kind: "format", cmd: "cargo fmt", cwd: dir, source: path });
    } else if (e.kind === "pubspec") {
      const tool = d.flutter ? "flutter" : "dart";
      out.push({ kind: "install", cmd: `${tool} pub get`, cwd: dir, source: path }, { kind: "test", cmd: `${tool} test`, cwd: dir, source: path },
        { kind: "lint", cmd: `${tool} analyze`, cwd: dir, source: path }, { kind: "format", cmd: `${tool === "flutter" ? "dart" : tool} format .`, cwd: dir, source: path });
    } else if (e.kind === "gemfile") {
      const gems = new Set(strs(d.gems));
      out.push({ kind: "install", cmd: "bundle install", cwd: dir, source: path });
      if (gems.has("rspec") || gems.has("rspec-rails")) out.push({ kind: "test", cmd: "bundle exec rspec", cwd: dir, source: path });
      else out.push({ kind: "test", cmd: gems.has("rails") ? "bin/rails test" : "bundle exec rake test", cwd: dir, source: path });
      if (gems.has("rubocop")) out.push({ kind: "lint", cmd: "bundle exec rubocop", cwd: dir, source: path });
    } else if (e.kind === "composer") {
      const scripts = (d.scripts ?? {}) as Record<string, string>;
      out.push({ kind: "install", cmd: "composer install", cwd: dir, source: path });
      if (scripts.test) out.push({ kind: "test", cmd: "composer test", cwd: dir, source: path });
      else if (strs(d.devDeps).includes("phpunit/phpunit")) out.push({ kind: "test", cmd: "vendor/bin/phpunit", cwd: dir, source: path });
      if (scripts.lint) out.push({ kind: "lint", cmd: "composer lint", cwd: dir, source: path });
    } else if (e.kind === "gradle" && !seenDirs.has(`gradle:${dir}`)) {
      seenDirs.add(`gradle:${dir}`);
      const wrapper = has(dir ? `${dir}/gradlew` : "gradlew") ? "./gradlew" : "gradle";
      out.push({ kind: "build", cmd: `${wrapper} build`, cwd: dir, source: path }, { kind: "test", cmd: `${wrapper} test`, cwd: dir, source: path });
      if (strs(d.plugins).some((p) => p.startsWith("com.android."))) out.push({ kind: "lint", cmd: `${wrapper} lint`, cwd: dir, source: path });
    } else if (e.kind === "maven") {
      out.push({ kind: "build", cmd: "mvn -q package", cwd: dir, source: path }, { kind: "test", cmd: "mvn -q test", cwd: dir, source: path });
    } else if (e.kind === "swiftpm") {
      out.push({ kind: "build", cmd: "swift build", cwd: dir, source: path }, { kind: "test", cmd: "swift test", cwd: dir, source: path });
    } else if (e.kind === "dotnet") {
      out.push({ kind: "install", cmd: "dotnet restore", cwd: dir, source: path }, { kind: "build", cmd: "dotnet build", cwd: dir, source: path }, { kind: "test", cmd: "dotnet test", cwd: dir, source: path });
    }
  }

  // Python: one set of commands per folder, from every manifest in it.
  const pyByDir = new Map<string, Array<[string, CoreEntry]>>();
  for (const [path, e] of Object.entries(core)) {
    if (isVendoredPath(path) || !["pyproject", "requirements", "pipfile"].includes(e.kind)) continue;
    const dir = dirName(path);
    pyByDir.set(dir, [...(pyByDir.get(dir) ?? []), [path, e]]);
  }
  for (const [dir, list] of pyByDir) {
    const first = list.find(([, e]) => e.kind === "pyproject") ?? list[0]!;
    const [path, e] = first;
    const d = get(e);
    const tools = new Set<string>();
    for (const [, o] of list) { for (const t of strs(get(o).tools)) tools.add(t); for (const n of pairs(get(o).deps)) tools.add(n); }
    const req = list.find(([, o]) => o.kind === "requirements");
    const mgr = e.kind === "pyproject" ? String(d.manager ?? "pip") : e.kind === "pipfile" ? "pipenv" : managers.find((m) => ["poetry", "uv", "pipenv", "pdm"].includes(m)) ?? "pip";
    const pre = mgr === "poetry" ? "poetry run " : mgr === "uv" ? "uv run " : mgr === "pipenv" ? "pipenv run " : mgr === "pdm" ? "pdm run " : "";
    const install = mgr === "poetry" ? "poetry install" : mgr === "uv" ? "uv sync" : mgr === "pipenv" ? "pipenv install --dev" : mgr === "pdm" ? "pdm install"
      : req ? `pip install -r ${req[0]}` : "pip install -e .";
    out.push({ kind: "install", cmd: install, cwd: dir, source: path });
    if (tools.has("pytest")) out.push({ kind: "test", cmd: `${pre}pytest`, cwd: dir, source: path });
    else if (has(dir ? `${dir}/manage.py` : "manage.py")) out.push({ kind: "test", cmd: `${pre}python manage.py test`, cwd: dir, source: path });
    if (tools.has("ruff")) out.push({ kind: "lint", cmd: `${pre}ruff check .`, cwd: dir, source: path });
    else if (tools.has("flake8")) out.push({ kind: "lint", cmd: `${pre}flake8`, cwd: dir, source: path });
    else if (tools.has("pylint")) out.push({ kind: "lint", cmd: `${pre}pylint .`, cwd: dir, source: path });
    if (tools.has("mypy")) out.push({ kind: "typecheck", cmd: `${pre}mypy .`, cwd: dir, source: path });
    else if (tools.has("pyright")) out.push({ kind: "typecheck", cmd: `${pre}pyright`, cwd: dir, source: path });
    if (tools.has("black")) out.push({ kind: "format", cmd: `${pre}black .`, cwd: dir, source: path });
    else if (tools.has("ruff")) out.push({ kind: "format", cmd: `${pre}ruff format .`, cwd: dir, source: path });
  }

  // A Makefile fills in what the manifests didn't say.
  for (const [path, e] of Object.entries(core)) {
    if (e.kind !== "make" || isVendoredPath(path)) continue;
    const dir = dirName(path);
    const targets = new Set(strs(get(e).targets));
    const want: Array<[CommandKind, string[]]> = [["test", ["test", "tests", "check"]], ["lint", ["lint"]], ["build", ["build", "all"]], ["dev", ["dev", "run", "serve"]], ["format", ["fmt", "format"]], ["install", ["install", "setup", "deps"]]];
    for (const [kind, ts] of want) {
      const t = ts.find((x) => targets.has(x));
      if (t && !out.some((c) => c.kind === kind && c.cwd === dir)) out.push({ kind, cmd: `make ${t}`, cwd: dir, source: path });
    }
  }
  // Root first, then by folder; each kind once per folder.
  const seen = new Set<string>();
  return out.filter((c) => { const k = `${c.cwd}|${c.kind}|${c.cmd}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.cwd === b.cwd ? 0 : a.cwd === "" ? -1 : b.cwd === "" ? 1 : a.cwd < b.cwd ? -1 : 1)).slice(0, 60);
}

// -------------------------------------------------------------- entry points

function entryPointsOf(input: ScanInput, packages: PackageInfo[]): Array<{ path: string; why: string }> {
  const out: Array<{ path: string; why: string }> = [];
  const add = (path: string, why: string) => { if (input.tree.files.has(path) && !out.some((o) => o.path === path)) out.push({ path, why }); };
  for (const [path, e] of Object.entries(input.core)) {
    if (e.kind !== "npm" || isVendoredPath(path)) continue;
    const dir = dirName(path);
    const rel = (p: string) => (dir ? `${dir}/` : "") + p.replace(/^\.\//, "");
    const d = get(e);
    if (typeof d.main === "string" && d.main) add(rel(d.main), "package.json main");
    for (const b of strs(d.bin)) add(rel(b), "package.json bin");
  }
  const candidates = ["src/index.ts", "src/index.tsx", "src/index.js", "src/main.ts", "src/main.tsx", "src/main.js", "src/server.ts", "src/server.js", "src/app.ts", "src/app.js",
    "index.ts", "index.js", "server.ts", "server.js", "app.js", "app.ts", "main.py", "app.py", "manage.py", "wsgi.py", "asgi.py", "__main__.py", "src/main.py", "main.go",
    "src/main.rs", "src/lib.rs", "lib/main.dart", "bin/main.dart", "src/main/java/Main.java", "Program.cs", "Sources/main.swift", "config/routes.rb", "config.ru", "index.php", "public/index.php",
    "app/layout.tsx", "src/app/layout.tsx", "pages/_app.tsx", "src/pages/_app.tsx", "app/page.tsx", "src/app/page.tsx"];
  const roots = ["", ...packages.map((p) => p.path)];
  for (const root of roots.slice(0, 40)) for (const c of candidates) add(root ? `${root}/${c}` : c, "conventional entry file");
  for (const f of input.files) {
    if (isTestPath(f.path)) continue;
    for (const s of f.symbols) {
      if (s.kind === "entry") add(f.path, s.name === "__main__" ? "runs as a script (__main__)" : "defines main()");
    }
  }
  for (const p of input.tree.files.keys()) {
    if (/^(?:.*\/)?cmd\/[^/]+\/main\.go$/.test(p) && !isVendoredPath(p)) add(p, "Go command");
    if (/^(?:.*\/)?src\/bin\/[^/]+\.rs$/.test(p)) add(p, "Rust binary");
  }
  return out.slice(0, 30);
}

// ----------------------------------------------------------------- the whole

const CI_FILES = (p: string) =>
  /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p) || /^(?:\.gitlab-ci\.ya?ml|\.travis\.ya?ml|azure-pipelines\.ya?ml|bitbucket-pipelines\.ya?ml|\.drone\.ya?ml|cloudbuild\.ya?ml|appveyor\.ya?ml|jenkinsfile|codemagic\.ya?ml|bitrise\.ya?ml)$/i.test(p)
  || p === ".circleci/config.yml" || p === ".buildkite/pipeline.yml";

export function buildStructure(input: ScanInput): Structure {
  const { tree, core } = input;
  const deps = allDeps(core);
  const managers = packageManagers(input, deps);
  const monorepo = packagesOf(input);
  const packages = monorepo?.packages ?? [];

  const frameworks = frameworksOf(deps);
  const ciFiles = [...tree.files.keys()].filter(CI_FILES).sort();

  // Env var names: the example files, then the code.
  const envCount = new Map<string, { example: boolean; uses: number }>();
  for (const e of Object.values(core)) if (e.kind === "env-example") for (const n of strs(get(e).names)) envCount.set(n, { example: true, uses: 0 });
  for (const f of input.files) {
    const mine = new Set<string>();
    for (const s of f.symbols) if (s.kind === "env") mine.add(s.name);
    for (const n of mine) { const c = envCount.get(n) ?? { example: false, uses: 0 }; c.uses += 1; envCount.set(n, c); }
  }
  const envVars = [...envCount.entries()].map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.uses - a.uses || (a.name < b.name ? -1 : 1)).slice(0, 100);

  // Docker.
  const docker = { files: [] as string[], images: [] as string[], ports: [] as number[], services: [] as string[] };
  for (const [path, e] of Object.entries(core)) {
    if (e.kind !== "docker" && e.kind !== "compose") continue;
    docker.files.push(path);
    const d = get(e);
    for (const i of strs(d.images)) if (!docker.images.includes(i)) docker.images.push(i);
    for (const p of Array.isArray(d.ports) ? (d.ports as unknown[]) : []) if (typeof p === "number" && !docker.ports.includes(p)) docker.ports.push(p);
    for (const s of strs(d.services)) if (!docker.services.includes(s)) docker.services.push(s);
  }
  docker.files.sort();
  docker.images.splice(12);
  docker.ports.splice(12);
  docker.services.splice(20);

  // The README: the one nearest the root.
  const readmes = Object.entries(core).filter(([, e]) => e.kind === "readme").sort((a, b) => a[0].split("/").length - b[0].split("/").length || (a[0] < b[0] ? -1 : 1));
  const readme = readmes[0] ? { path: readmes[0][0], title: asStr(get(readmes[0][1]).title), blurb: asStr(get(readmes[0][1]).blurb) } : null;

  const languages = languageShares(tree);
  const sizes = [...tree.files.values()].reduce((n, f) => n + f.size, 0);

  return {
    ...EMPTY_STRUCTURE,
    mode: input.mode, note: input.note,
    fileCount: tree.files.size, analysedCount: input.analysedCount, totalBytes: sizes,
    languages, packageManagers: managers, lockfiles: [...input.lockfiles].slice(0, 40), frameworks: frameworks.slice(0, 30),
    monorepo, entryPoints: entryPointsOf(input, packages), commands: commandsOf(input, managers, packages),
    ci: ciFiles.slice(0, 30), envVars, docker, readme,
    secretFiles: [...input.secretFiles].slice(0, 50), skipped: input.skipped,
    testing: { frameworks: [], testFiles: 0, untestedHot: [] },
    core, skippedBlobs: input.skippedBlobs,
  };
}

/** The core entry kinds a path can have: re-exported so the build need not know snapshot.ts. */
export { coreKindOf };
