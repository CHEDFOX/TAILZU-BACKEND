/**
 * WHAT A PATH IS: ITS LANGUAGE, ITS KIND, AND WHETHER IT IS WORTH READING AT ALL.
 *
 * Three small tables and the functions over them, shared by every part of the
 * project brain, so "is this a test file" and "is this vendored" have one
 * answer. Nothing here reads a file: a path is judged by its name alone, which
 * is what lets the tree (free) say what to fetch (not free) before anything is.
 */
import type { FileClass } from "./types.js";

// ------------------------------------------------------------------ languages

/** Extension (lower case, no dot) to the language it is counted as. */
const LANG_BY_EXT: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  py: "Python", pyi: "Python", pyw: "Python",
  go: "Go", rs: "Rust", java: "Java", kt: "Kotlin", kts: "Kotlin", scala: "Scala", groovy: "Groovy", gradle: "Groovy",
  dart: "Dart", rb: "Ruby", rake: "Ruby", php: "PHP", swift: "Swift", cs: "C#", fs: "F#", vb: "Visual Basic",
  c: "C", h: "C", cpp: "C++", cc: "C++", cxx: "C++", hpp: "C++", hh: "C++", m: "Objective-C", mm: "Objective-C++",
  ex: "Elixir", exs: "Elixir", erl: "Erlang", hs: "Haskell", clj: "Clojure", lua: "Lua", pl: "Perl", r: "R", jl: "Julia",
  sh: "Shell", bash: "Shell", zsh: "Shell", ps1: "PowerShell", sql: "SQL", tf: "Terraform", proto: "Protocol Buffers",
  sol: "Solidity", zig: "Zig", nim: "Nim", ml: "OCaml", elm: "Elm", v: "V",
  html: "HTML", htm: "HTML", vue: "Vue", svelte: "Svelte", astro: "Astro", ejs: "EJS", hbs: "Handlebars", erb: "ERB", jinja: "Jinja", j2: "Jinja",
  css: "CSS", scss: "SCSS", sass: "Sass", less: "Less", styl: "Stylus",
  xml: "XML", xaml: "XAML", plist: "XML",
  json: "JSON", jsonc: "JSON", json5: "JSON", yml: "YAML", yaml: "YAML", toml: "TOML", ini: "INI", cfg: "INI", properties: "Properties",
  md: "Markdown", mdx: "Markdown", rst: "reStructuredText", txt: "Text", strings: "iOS Strings", arb: "ARB", graphql: "GraphQL", gql: "GraphQL",
};

/** File names with no extension that mean something. */
const LANG_BY_NAME: Record<string, string> = {
  dockerfile: "Dockerfile", makefile: "Makefile", gemfile: "Ruby", rakefile: "Ruby", podfile: "Ruby", jenkinsfile: "Groovy",
  procfile: "Procfile", codeowners: "Text",
};

/** Languages that are prose or data, not code: counted in the tree's bytes but not shown among the languages of a project. */
const NOT_A_LANGUAGE = new Set(["JSON", "YAML", "TOML", "INI", "Properties", "Markdown", "reStructuredText", "Text", "XML", "iOS Strings", "ARB", "Procfile", "Makefile"]);

export function baseName(path: string): string { return path.slice(path.lastIndexOf("/") + 1); }
export function dirName(path: string): string { const i = path.lastIndexOf("/"); return i < 0 ? "" : path.slice(0, i); }
export function extOf(path: string): string {
  const b = baseName(path);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i + 1).toLowerCase();
}

/** The language a path is written in, or "" when it isn't one we know. */
export function languageOf(path: string): string {
  const b = baseName(path).toLowerCase();
  if (LANG_BY_NAME[b]) return LANG_BY_NAME[b]!;
  if (b.startsWith("dockerfile.") || b.endsWith(".dockerfile")) return "Dockerfile";
  return LANG_BY_EXT[extOf(path)] ?? "";
}

/** Whether a language counts when a project's languages are listed. */
export const isCodeLanguage = (lang: string): boolean => lang !== "" && !NOT_A_LANGUAGE.has(lang);

// --------------------------------------------------------------- what to skip

/** A folder with one of these names is somebody else's code or this project's output. */
const VENDORED_DIRS = new Set([
  "node_modules", "vendor", "dist", "build", "out", ".next", "target", "coverage", "__pycache__", ".git",
  ".nuxt", ".svelte-kit", ".turbo", ".cache", "bower_components", "pods", ".gradle", ".idea", ".venv", "venv", ".tox",
  ".mypy_cache", ".pytest_cache", ".ruff_cache", "deriveddata", ".dart_tool", ".pub-cache", ".terraform", ".yarn", ".pnpm-store",
  "site-packages", ".expo", ".parcel-cache",
]);

export const LOCKFILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock", "npm-shrinkwrap.json", "cargo.lock", "poetry.lock",
  "pipfile.lock", "uv.lock", "gemfile.lock", "composer.lock", "go.sum", "pubspec.lock", "podfile.lock", "gradle.lockfile",
  "packages.lock.json", "flake.lock", "mix.lock", "package.resolved", ".terraform.lock.hcl", "pdm.lock", "conan.lock",
]);

const BINARY_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "tif", "tiff", "svg", "psd", "ai", "sketch", "fig", "heic", "icns",
  "woff", "woff2", "ttf", "otf", "eot", "mp3", "mp4", "m4a", "mov", "avi", "wav", "ogg", "webm", "flac", "mkv",
  "zip", "gz", "tgz", "tar", "rar", "7z", "bz2", "xz", "zst", "jar", "war", "ear", "apk", "aab", "ipa", "dex", "aar",
  "exe", "dll", "so", "dylib", "a", "o", "obj", "lib", "class", "bin", "dat", "wasm", "pyc", "pyd", "node", "pdb",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "key", "numbers", "pages",
  "sqlite", "sqlite3", "db", "mdb", "parquet", "pkl", "npy", "h5", "onnx", "pt", "pth", "ckpt", "safetensors", "tflite", "mlmodel",
  "gpg", "snap", "xcassets",
]);

/** `*.g.dart`, `*.pb.go`, `*.min.js`, `*.map`: made by a tool, not written by a person. */
const GENERATED = /(?:\.min\.[a-z0-9]+|\.map|\.g\.dart|\.freezed\.dart|\.gr\.dart|\.pb\.go|\.pb\.dart|_pb2(?:_grpc)?\.pyi?|\.generated\.[a-z]+|_generated\.[a-z]+|\.gen\.go|\.designer\.cs|\.snap)$/i;

/**
 * `.env`, `.env.local`, `.env.production`: a file that holds a person's secrets.
 * Not the committed examples (`.env.example`, `.sample`, `.template`...), which
 * are documentation. The same rule as policy.ts's secret scan.
 */
export function isEnvFile(path: string): boolean {
  const b = baseName(path).toLowerCase();
  return /^\.env(\..+)?$/.test(b) && !isEnvExample(path);
}
export function isEnvExample(path: string): boolean {
  return /^\.env(\..+)?\.(?:example|sample|template|dist|defaults?|schema)$/.test(baseName(path).toLowerCase());
}

/** A key, a certificate, a keystore, or a credentials file: its contents are never read or kept; only that it exists is. */
export function isSecretPath(path: string): boolean {
  if (isEnvFile(path)) return true;
  const b = baseName(path).toLowerCase();
  if (/\.(?:pem|key|p12|pfx|pkcs12|jks|keystore|crt|cer|der|p8|p7b|asc|ppk|kdbx|tfstate)$/.test(b)) return true;
  if (/^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pem)?$/.test(b)) return true;
  if (/^(?:\.npmrc|\.pypirc|\.netrc|\.htpasswd|\.pgpass|credentials|credentials\.json|service[-_]?account.*\.json|secrets?\.(?:ya?ml|json|toml))$/.test(b)) return true;
  if (/\.tfvars$/.test(b) && !/example|sample/.test(b)) return true;
  return false;
}

export const isLockfile = (path: string): boolean => LOCKFILES.has(baseName(path).toLowerCase());
export const isGeneratedPath = (path: string): boolean => GENERATED.test(baseName(path));

/** Any folder along the path that is vendored or output. */
export function isVendoredPath(path: string): boolean {
  const parts = path.split("/");
  for (let i = 0; i < parts.length - 1; i += 1) if (VENDORED_DIRS.has(parts[i]!.toLowerCase())) return true;
  return false;
}

export const isBinaryPath = (path: string): boolean => BINARY_EXTS.has(extOf(path));

// ------------------------------------------------------------- what to read

/** Extensions read as text for analysis: code, markup, styles, docs, and the small data files that carry meaning. */
const READ_EXTS = new Set([
  ...Object.keys(LANG_BY_EXT).filter((e) => !["json", "jsonc", "json5"].includes(e)),
  "csproj", "fsproj", "vbproj", "sln", "podspec", "gemspec", "env", "tpl", "mustache", "twig", "liquid", "pug", "jade", "slim",
]);

/** Where translations live: a JSON file here is read for its strings. */
export const I18N_DIR = /(?:^|\/)(?:locales?|i18n|l10n|translations?|lang|langs|languages|messages|intl|strings)(?:\/|$)/i;

/** The few JSON files that are read: manifests, compiler settings, and translations. */
function jsonIsRead(path: string): boolean {
  const b = baseName(path).toLowerCase();
  if (b === "package.json" || b === "composer.json" || b === "app.json" || b === "renovate.json" || b === "biome.json" || b === "deno.json") return true;
  if (/^(?:ts|js)config(?:\.[\w-]+)?\.json$/.test(b) || /^tsconfig\./.test(b)) return true;
  if (/^\.(?:eslintrc|prettierrc|babelrc|stylelintrc)(?:\.json)?$/.test(b)) return true;
  return I18N_DIR.test(path) || /\.arb$/.test(b);
}

/** Whether a path's contents are worth fetching: by extension (or name), not by anything inside. */
export function isReadable(path: string): boolean {
  const b = baseName(path).toLowerCase();
  if (LANG_BY_NAME[b] || b.startsWith("dockerfile") || b === "gemfile" || b === "go.mod" || b === "go.work" || b === ".editorconfig") return true;
  if (b.startsWith(".eslintrc") || b.startsWith(".prettierrc") || b === ".cursorrules" || b === ".flake8" || b === ".rubocop.yml") return true;
  if (isEnvExample(path)) return true;
  const e = extOf(path);
  if (e === "json" || e === "jsonc" || e === "json5") return jsonIsRead(path);
  // A .txt is read for the one thing that matters in it: the Python requirements.
  if (e === "txt") return /^(?:requirements|constraints)[\w.-]*\.txt$/.test(b);
  return READ_EXTS.has(e);
}

// ------------------------------------------------------------- what it is

const TEST_DIR = /(?:^|\/)(?:__tests__|tests?|spec|specs|e2e|cypress|__mocks__|testdata|integration[-_]tests?)(?:\/|$)/i;
const TEST_FILE = /(?:\.(?:test|spec|e2e|cy)\.[a-z0-9]+$|(?:^|\/)test_[^/]+\.py$|_test\.(?:py|go|dart|rb|exs?|cpp|cc|c)$|_spec\.rb$|(?:Test|Tests|Spec|IT)\.(?:java|kt|cs|php|swift|scala)$|(?:^|\/)conftest\.py$)/;

/** Whether a path is a test: by the file's name, or by sitting in a folder that holds tests. */
export function isTestPath(path: string): boolean {
  if (TEST_FILE.test(path)) return true;
  const e = extOf(path);
  const code = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "kt", "dart", "rb", "php", "swift", "cs", "ex", "exs"];
  return code.includes(e) && TEST_DIR.test(path);
}

/** What kind of file it is: source, test, config, doc, markup, style, data. */
export function classOf(path: string): FileClass {
  const lang = languageOf(path);
  const e = extOf(path);
  if (isTestPath(path)) return "test";
  if (["Markdown", "reStructuredText", "Text"].includes(lang)) return "doc";
  if (["CSS", "SCSS", "Sass", "Less", "Stylus"].includes(lang)) return "style";
  if (["HTML", "Vue", "Svelte", "Astro", "EJS", "Handlebars", "ERB", "Jinja"].includes(lang)) return "markup";
  if (["JSON", "YAML", "TOML", "INI", "Properties", "XML", "iOS Strings", "ARB"].includes(lang) || e === "env") return "data";
  if (lang === "Makefile" || lang === "Dockerfile" || lang === "Procfile") return "config";
  return isCodeLanguage(lang) ? "source" : "data";
}

/** Path depth: 0 for a file in the root. */
export const depthOf = (path: string): number => path.split("/").length - 1;
