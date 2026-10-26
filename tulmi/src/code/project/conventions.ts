/**
 * HOW THIS PROJECT IS WRITTEN: ITS FORMATTER AND LINTER, ITS STYLE, ITS COMMITS, ITS BRANCHES, AND ITS OWN RULES.
 *
 * What the bot writes should look like what is already there. So, with no
 * model:
 *
 *   formatter, linter   from the config files and dev dependencies (prettier,
 *                       biome, eslint, black, ruff, flake8, gofmt, rustfmt,
 *                       clang-format, rubocop, swiftlint, php-cs-fixer...) and
 *                       the .editorconfig
 *   style               sniffed from a sample of the source: tabs or how many
 *                       spaces, single or double quotes, semicolons or none (as
 *                       the formatter config says when there is one), and the
 *                       naming of files and of functions, read from every file
 *   commits             the last 30 messages: Conventional Commits (feat:, fix(scope):)
 *                       or freeform, with the scopes used and three examples
 *   branches            the default branch and how the others are named
 *                       (feature/..., fix/...)
 *   project rules       the agent docs the repo already has, KEPT VERBATIM and
 *                       capped: CLAUDE.md, AGENTS.md, .cursorrules,
 *                       .github/copilot-instructions.md, CONTRIBUTING.md.
 *                       They are the owners' own words about how to work here,
 *                       and they are text from a repo: data for the bot to read
 *                       and follow as the project's convention, never a way to
 *                       raise its own permissions
 *
 * Pure: it is handed what the build has read.
 */
import { scanForSecrets } from "../policy.js";
import { baseName, dirName, extOf, isTestPath } from "./lang.js";
import { blankComments } from "./symbols.js";
import {
  COMMIT_STYLE_SAMPLE, EMPTY_CONVENTIONS, RULES_DOC_CHARS, RULES_TOTAL_CHARS,
  type Conventions, type CoreEntry, type SymbolInfo,
} from "./types.js";

const get = (e: CoreEntry | undefined) => (e?.data ?? {}) as Record<string, unknown>;

// ----------------------------------------------------------- tools by name

const FORMATTER_FILES: Array<[RegExp, string]> = [
  [/^\.prettierrc|^prettier\.config\./, "prettier"], [/^biome\.jsonc?$/, "biome"], [/^\.clang-format$/, "clang-format"], [/^rustfmt\.toml$|^\.rustfmt\.toml$/, "rustfmt"],
  [/^\.php-cs-fixer/, "php-cs-fixer"], [/^dprint\.json$/, "dprint"], [/^\.scalafmt\.conf$/, "scalafmt"], [/^\.swiftformat$/, "swiftformat"],
];
const LINTER_FILES: Array<[RegExp, string]> = [
  [/^\.eslintrc|^eslint\.config\./, "eslint"], [/^biome\.jsonc?$/, "biome"], [/^\.flake8$/, "flake8"], [/^ruff\.toml$|^\.ruff\.toml$/, "ruff"], [/^\.pylintrc$|^pylintrc$/, "pylint"],
  [/^\.golangci\.ya?ml$|^\.golangci\.toml$/, "golangci-lint"], [/^analysis_options\.yaml$/, "dart analyze"], [/^\.rubocop\.yml$/, "rubocop"], [/^\.swiftlint\.yml$/, "swiftlint"],
  [/^phpstan\.neon(?:\.dist)?$/, "phpstan"], [/^psalm\.xml$/, "psalm"], [/^\.stylelintrc|^stylelint\.config\./, "stylelint"], [/^\.markdownlint/, "markdownlint"], [/^tslint\.json$/, "tslint"],
  [/^\.hlint\.yaml$/, "hlint"], [/^\.ktlint|^detekt\.ya?ml$/, "detekt"],
];
const CONFIG_FILES = /^(?:\.editorconfig|\.prettierrc[\w.]*|prettier\.config\.\w+|\.eslintrc[\w.]*|eslint\.config\.\w+|biome\.jsonc?|\.flake8|ruff\.toml|\.ruff\.toml|\.pylintrc|pylintrc|setup\.cfg|tox\.ini|pytest\.ini|mypy\.ini|\.golangci\.\w+|analysis_options\.yaml|\.rubocop\.yml|\.swiftlint\.yml|\.swiftformat|\.clang-format|rustfmt\.toml|\.rustfmt\.toml|phpstan\.neon(?:\.dist)?|psalm\.xml|\.stylelintrc[\w.]*|tsconfig\.json|\.babelrc[\w.]*|\.nvmrc|\.node-version|\.tool-versions|\.python-version|\.husky|lefthook\.ya?ml|\.pre-commit-config\.ya?ml|commitlint\.config\.\w+|\.commitlintrc[\w.]*|\.lintstagedrc[\w.]*)$/;

function tools(tree: ReadonlyMap<string, unknown>, core: Record<string, CoreEntry>, depNames: ReadonlySet<string>, langs: ReadonlySet<string>) {
  const formatter = new Set<string>();
  const linter = new Set<string>();
  const configs: string[] = [];
  for (const p of tree.keys()) {
    const b = baseName(p);
    if (p.includes("node_modules/") || p.split("/").length > 4) continue;
    for (const [re, name] of FORMATTER_FILES) if (re.test(b)) formatter.add(name);
    for (const [re, name] of LINTER_FILES) if (re.test(b)) linter.add(name);
    if (CONFIG_FILES.test(b) && configs.length < 40) configs.push(p);
  }
  if (depNames.has("prettier")) formatter.add("prettier");
  if (depNames.has("eslint")) linter.add("eslint");
  if (depNames.has("@biomejs/biome")) { formatter.add("biome"); linter.add("biome"); }
  if (depNames.has("black")) formatter.add("black");
  if (depNames.has("ruff")) { linter.add("ruff"); formatter.add("ruff format"); }
  if (depNames.has("isort")) formatter.add("isort");
  if (depNames.has("flake8")) linter.add("flake8");
  if (depNames.has("pylint")) linter.add("pylint");
  if (depNames.has("mypy")) linter.add("mypy");
  for (const e of Object.values(core)) {
    if (e.kind === "pyproject") {
      for (const t of Array.isArray(get(e).tools) ? (get(e).tools as string[]) : []) {
        if (t === "black") formatter.add("black");
        if (t === "ruff") { linter.add("ruff"); }
        if (t === "isort") formatter.add("isort");
        if (t === "mypy") linter.add("mypy");
        if (t === "pylint") linter.add("pylint");
      }
    }
  }
  if (langs.has("Go")) formatter.add("gofmt");
  if (langs.has("Rust")) { formatter.add("rustfmt"); linter.add("clippy"); }
  if (langs.has("Dart")) formatter.add("dart format");
  return { formatter: [...formatter], linter: [...linter], configs: configs.sort() };
}

// ------------------------------------------------------------------- style

type NameStyle = "kebab-case" | "snake_case" | "camelCase" | "PascalCase" | "lowercase";

function nameStyle(name: string): NameStyle | null {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) return null;
  if (name.includes("-")) return /^[a-z0-9-]+$/.test(name) ? "kebab-case" : null;
  if (name.includes("_")) return /^[a-z0-9_]+$/.test(name) ? "snake_case" : null;
  if (/^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$|^[A-Z][a-z0-9]+$/.test(name)) return "PascalCase";
  if (/^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/.test(name)) return "camelCase";
  if (/^[a-z][a-z0-9]*$/.test(name)) return "lowercase";
  return null;
}

/** The style most of the names are in, if it is most (60%) of the ones that have a style; lowercase single words don't count for or against. */
function dominant(names: Iterable<string>): string | null {
  const count = new Map<NameStyle, number>();
  let n = 0;
  for (const nm of names) {
    const s = nameStyle(nm);
    if (!s || s === "lowercase") continue;
    count.set(s, (count.get(s) ?? 0) + 1);
    n += 1;
  }
  if (n < 5) return null;
  const [style, c] = [...count.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return c / n >= 0.6 ? style : null;
}

const STYLE_LANGS = new Set(["TypeScript", "JavaScript", "Python", "Dart", "Ruby", "PHP", "Vue", "Svelte"]);

function sniffStyle(sample: ReadonlyArray<{ path: string; lang: string; text: string }>) {
  let tabs = 0;
  const deltas = new Map<number, number>();
  let single = 0, double = 0;
  let semi = 0, noSemi = 0;
  let used = 0;
  for (const f of sample) {
    used += 1;
    const lines = f.text.split("\n").slice(0, 600);
    let prev = 0;
    for (const l of lines) {
      if (!l.trim()) continue;
      if (l.startsWith("\t")) { tabs += 1; prev = 0; continue; }
      const ind = l.length - l.trimStart().length;
      if (ind > prev && ind - prev <= 8) deltas.set(ind - prev, (deltas.get(ind - prev) ?? 0) + 1);
      prev = ind;
    }
    if (STYLE_LANGS.has(f.lang)) {
      const code = blankComments(f.text.slice(0, 40_000), { slash: f.lang !== "Python" && f.lang !== "Ruby", hash: f.lang === "Python" || f.lang === "Ruby", triple: f.lang === "Python", backtick: false, apostrophe: "string" });
      for (const m of code.matchAll(/(?<![\w'"`\\])(?:'([^'"\n\\]*)'|"([^'"\n\\]*)")/g)) { if (m[1] !== undefined) single += 1; else double += 1; }
      if (["TypeScript", "JavaScript", "Vue", "Svelte"].includes(f.lang)) {
        for (const l of code.split("\n")) {
          if (!/^\s*(?:const|let|var|return|import|throw|await|export\s+(?:const|default|\{))\b/.test(l)) continue;
          const t = l.trimEnd();
          if (t.endsWith(";")) semi += 1;
          else if (/[\w)'"`\]]$/.test(t) && !/^(?:import|export)\b.*\{$/.test(t)) noSemi += 1;
        }
      }
    }
  }
  const spaceCount = [...deltas.values()].reduce((a, b) => a + b, 0);
  let indent: string | null = null;
  if (tabs > spaceCount * 1.5 && tabs >= 20) indent = "tabs";
  else if (spaceCount >= 20) {
    const best = [...deltas.entries()].filter(([d]) => d === 2 || d === 4 || d === 8).sort((a, b) => b[1] - a[1])[0];
    if (best) indent = `${best[0]} spaces`;
  }
  const quotes = single + double >= 20 ? (single / (single + double) >= 0.6 ? "single" as const : double / (single + double) >= 0.6 ? "double" as const : null) : null;
  const semicolons = semi + noSemi >= 20 ? (semi / (semi + noSemi) >= 0.8 ? true : noSemi / (semi + noSemi) >= 0.8 ? false : null) : null;
  return { indent, quotes, semicolons, sampled: used };
}

// ----------------------------------------------------------------- commits

const CONVENTIONAL = /^(feat|fix|chore|docs|style|refactor|perf|test|tests|build|ci|revert|wip)(\(([^)]+)\))?(!)?:\s/i;

function commitStyle(messages: readonly string[]) {
  const sample = messages.slice(0, COMMIT_STYLE_SAMPLE).map((m) => m.split("\n")[0]!.trim()).filter(Boolean);
  const merges = (m: string) => /^(?:Merge (?:pull request|branch|remote)|Revert ")/.test(m);
  const real = sample.filter((m) => !merges(m));
  const conv = real.filter((m) => CONVENTIONAL.test(m));
  const scopes = new Map<string, number>();
  for (const m of conv) { const s = CONVENTIONAL.exec(m)?.[3]; if (s) scopes.set(s, (scopes.get(s) ?? 0) + 1); }
  const pct = real.length ? Math.round((conv.length / real.length) * 100) : 0;
  const examples = real.filter((m) => !scanForSecrets([{ path: "commit.txt", content: m }]).length).slice(0, 3).map((m) => (m.length > 100 ? `${m.slice(0, 99)}…` : m));
  return {
    style: real.length < 3 ? "unknown" as const : pct >= 60 ? "conventional" as const : "freeform" as const,
    conventionalPct: pct,
    scopes: [...scopes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s]) => s),
    examples, sampled: sample.length,
  };
}

function branchNaming(branches: readonly string[], defaultBranch: string) {
  const others = branches.filter((b) => b !== defaultBranch && !b.startsWith("tailzu/") && !b.startsWith("dependabot/") && !b.startsWith("renovate/"));
  const prefixes = new Map<string, number>();
  for (const b of others) { const i = b.indexOf("/"); if (i > 0) prefixes.set(b.slice(0, i), (prefixes.get(b.slice(0, i)) ?? 0) + 1); }
  const common = [...prefixes.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p]) => `${p}/<name>`);
  let naming: string | null = common.length ? common.join(", ") : null;
  if (!naming && others.length >= 3) {
    const style = dominant(others);
    naming = style ? `${style} names without a prefix` : null;
  }
  return { default: defaultBranch, naming, examples: others.slice(0, 5) };
}

// ------------------------------------------------------------------- rules

const AGENT_ORDER = (p: string): number => {
  const b = baseName(p).toLowerCase();
  const root = dirName(p) === "" || dirName(p) === ".github";
  return (root ? 0 : 100) + (b === "claude.md" ? 0 : b === "agents.md" ? 1 : b === ".cursorrules" ? 2 : b === "copilot-instructions.md" ? 3 : 4) + p.split("/").length / 100;
};

/** The agent docs the repo already has, verbatim and capped: 6,000 characters each and 16,000 in all. */
export function projectRules(core: Record<string, CoreEntry>): Conventions["rules"] {
  const docs = Object.entries(core).filter(([, e]) => e.kind === "agent-doc").sort((a, b) => AGENT_ORDER(a[0]) - AGENT_ORDER(b[0]) || (a[0] < b[0] ? -1 : 1));
  const out: Conventions["rules"] = [];
  let left = RULES_TOTAL_CHARS;
  for (const [path, e] of docs.slice(0, 10)) {
    if (left <= 0) break;
    const d = get(e);
    const text = String(d.text ?? "");
    const cut = text.slice(0, Math.min(RULES_DOC_CHARS, left));
    out.push({ path, text: cut, truncated: d.truncated === true || cut.length < text.length });
    left -= cut.length;
  }
  return out;
}

// ------------------------------------------------------------- the whole

export interface ConventionInput {
  /** Every path of the tree (for config files). */
  paths: ReadonlyMap<string, unknown>;
  core: Record<string, CoreEntry>;
  depNames: ReadonlySet<string>;
  languages: ReadonlySet<string>;
  /** Source files read this build: only used to sniff style when `sniff` is on. */
  sample: ReadonlyArray<{ path: string; lang: string; text: string }>;
  /** Sniff the style from the sample (a full build); otherwise `prior`'s is kept. */
  sniff: boolean;
  /** The names of every analysed source file, and the functions in them. */
  sourcePaths: readonly string[];
  symbols: ReadonlyArray<{ lang: string; symbols: readonly SymbolInfo[] }>;
  commits: readonly string[];
  branches: readonly string[];
  defaultBranch: string;
  prior?: Conventions | null;
}

export function analyseConventions(input: ConventionInput): Conventions {
  const base = tools(input.paths, input.core, input.depNames, input.languages);
  // A formatter's own settings beat the sniff.
  const sniffed = input.sniff || !input.prior ? sniffStyle(input.sample) : input.prior.style;
  let indent: string | null = sniffed.indent;
  let quotes: "single" | "double" | null = sniffed.quotes;
  let semicolons: boolean | null = sniffed.semicolons;
  for (const e of Object.values(input.core)) {
    const d = get(e);
    if (e.kind === "prettier") {
      if (typeof d.singleQuote === "boolean") quotes = d.singleQuote ? "single" : "double";
      if (typeof d.semi === "boolean") semicolons = d.semi;
      if (d.useTabs === true) indent = "tabs";
      else if (typeof d.tabWidth === "number") indent = `${d.tabWidth} spaces`;
    } else if (e.kind === "editor" && !input.core["prettier"]) {
      if (d.indentStyle === "tab") indent = "tabs";
      else if (d.indentStyle === "space" && typeof d.indentSize === "number") indent = `${d.indentSize} spaces`;
      if (d.tool === "biome") {
        if (d.quoteStyle === "single") quotes = "single"; else if (d.quoteStyle === "double") quotes = "double";
        if (d.semicolons === "asNeeded") semicolons = false; else if (d.semicolons === "always") semicolons = true;
      }
    }
  }
  if (input.languages.has("Go") && input.languages.size === 1) indent = "tabs";

  const sources = input.sourcePaths.filter((p) => !isTestPath(p) && !/\.(?:md|json|ya?ml|toml|html?|css|scss|xml)$/i.test(p));
  const fileNames = dominant(sources.map((p) => { const b = baseName(p); const e = extOf(p); return (e ? b.slice(0, -(e.length + 1)) : b).replace(/\.(?:d|test|spec|stories|module|config)$/, ""); }));
  const fnNames: string[] = [];
  for (const f of input.symbols) for (const s of f.symbols) if ((s.kind === "function" || s.kind === "method") && s.exported !== false) fnNames.push(s.name.split(".").pop()!);
  const identifiers = dominant(fnNames);

  return {
    ...EMPTY_CONVENTIONS,
    formatter: base.formatter, linter: base.linter, configs: base.configs,
    style: { indent, quotes, semicolons, fileNames, identifiers, sampled: sniffed.sampled },
    commits: input.commits.length ? commitStyle(input.commits) : input.prior?.commits ?? EMPTY_CONVENTIONS.commits,
    branches: input.branches.length ? branchNaming(input.branches, input.defaultBranch) : { ...(input.prior?.branches ?? EMPTY_CONVENTIONS.branches), default: input.defaultBranch },
    rules: projectRules(input.core),
  };
}
