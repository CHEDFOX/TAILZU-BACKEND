/**
 * IMPACT: WHAT A CHANGE TOUCHES BEYOND THE FILES IT NAMES, FROM THE GRAPH AND NOT FROM A GUESS.
 *
 * A model is asked what to change. It is not asked what that change will reach,
 * because the project brain (layer 4) already knows, exactly:
 *
 *   importers   every file that imports a changed file (neighbors), so a rename
 *               or a changed signature has its callers listed
 *   routes      the endpoints a changed file serves
 *   tests       the tests that cover the changed files, and those that cover
 *               their importers: what to run first
 *   config      a manifest, a compiler or build setting, Docker, a deploy file
 *   migrations  a database migration or schema
 *   env         the environment variables a changed file reads, and an
 *               .env.example that is changed
 *   public API  a changed file whose exports other files use, or an entry point
 *   untested    changed source with no test at all
 *   hot         changed files that keep changing (they keep breaking, too)
 *   features    which parts of the app the change is in
 *
 * and from these the risk (riskOf): the classifier's view of the request, raised
 * by what the graph says it reaches. Nothing here calls a model or GitHub; each
 * question is a read of the brain.
 */
import type { BrainHandle } from "../project/index.js";
import { classOf, isTestPath } from "../project/lang.js";
import type { StoredFile } from "../project/types.js";
import type { Level } from "../brain/types.js";

export type PlanAction = "edit" | "create" | "delete";
export interface Change { path: string; action: PlanAction }

export interface PlanImpact {
  /** Files the plan changes, once each. */
  files: string[];
  /** Files that import a changed file and are not themselves changed. */
  importers: Array<{ path: string; of: string }>;
  routes: Array<{ route: string; file: string }>;
  /** Tests to run first, in order: those that cover the changed files, then those that cover their importers. */
  tests: string[];
  config: string[];
  migrations: string[];
  /** Environment variables the changed files read, and whether an .env.example is among them. */
  env: { reads: Array<{ name: string; file: string }>; exampleChanged: string[] };
  /** Changed files other files depend on: what they export and how many use them. */
  publicApi: Array<{ path: string; exports: string[]; usedBy: number }>;
  /** Changed source files no test covers. */
  untested: string[];
  /** Changed files that were changed often in the last hundred commits, or carry TODOs. */
  hot: string[];
  features: string[];
}

export type ImpactBrain = Pick<BrainHandle, "file" | "neighbors" | "testsFor" | "features">;

const IMPORTERS_PER_FILE = 8;
const IMPORTERS_MAX = 30;
const TESTS_MAX = 25;
/** How many importers have their own tests looked up (each is a read). */
const IMPORTER_TEST_LOOKUPS = 20;

const CONFIG = [
  /(^|\/)package\.json$/, /(^|\/)tsconfig[\w.-]*\.json$/, /(^|\/)jsconfig\.json$/,
  /(^|\/)(?:vite|next|webpack|rollup|jest|vitest|tailwind|postcss|eslint|babel|prettier|svelte|astro|nuxt|playwright|metro|expo|capacitor|tsup)\.config\.[cm]?[jt]s$/,
  /(^|\/)\.eslintrc/, /(^|\/)\.prettierrc/, /(^|\/)(?:app|expo)\.json$/,
  /(^|\/)(?:Dockerfile[\w.-]*|docker-compose[\w.-]*\.ya?ml|compose\.ya?ml)$/,
  /(^|\/)(?:vercel|netlify|firebase|wrangler|fly|render|railway)\.(?:json|toml|ya?ml)$/,
  /(^|\/)(?:requirements[\w.-]*\.txt|pyproject\.toml|setup\.py|setup\.cfg|Pipfile|go\.mod|Cargo\.toml|pubspec\.ya?ml|Gemfile|composer\.json|build\.gradle(?:\.kts)?|pom\.xml|Package\.swift)$/,
  /(^|\/)Makefile$/, /(^|\/)\.env\.(?:example|sample|template)$/,
];
const MIGRATION = [/(^|\/)(?:migrations?|migrate)\//i, /(^|\/)alembic\/versions\//i, /(^|\/)prisma\/migrations\//i, /(^|\/)db\/migrate\//i, /(^|\/)schema\.prisma$/i, /(^|\/)(?:supabase|db|database|sql)\/[^/]*\.sql$/i];
const ENV_EXAMPLE = /(^|\/)\.env\.(?:example|sample|template|dist)$/;
const MONEY = /(?:^|[/_.-])pay(?:ments?|outs?|pal)?(?:[/_.-]|$)|billing|stripe|razorpay|invoice|checkout|subscription|wallet/i;
const AUTH = /(?:\bauth|login|logout|signin|signup|session|password|oauth|jwt|token|permission|acl|security|crypto|secret)/i;

export const isConfigPath = (p: string): boolean => CONFIG.some((r) => r.test(p));
export const isMigrationPath = (p: string): boolean => MIGRATION.some((r) => r.test(p));

const exportsOf = (f: StoredFile): string[] => f.symbols.filter((s) => s.exported === true && s.kind !== "route" && s.kind !== "env" && s.kind !== "entry").map((s) => s.name);
const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

/** The impact of a set of changes, from the brain. A file the brain does not hold (a create) has no importers and no tests yet. */
export async function computeImpact(changes: readonly Change[], brain: ImpactBrain, opts: { entryPoints?: readonly string[] } = {}): Promise<PlanImpact> {
  const files = uniq(changes.map((c) => c.path));
  const changed = new Set(files);
  const rows = new Map<string, StoredFile>();
  await Promise.all(files.map(async (p) => { const r = await brain.file(p); if (r) rows.set(p, r); }));

  const importers: PlanImpact["importers"] = [];
  const usedBy = new Map<string, number>();
  await Promise.all(files.map(async (p) => {
    if (!rows.has(p)) return;
    const n = await brain.neighbors(p);
    usedBy.set(p, n.importedBy.length);
    for (const i of n.importedBy.filter((x) => !changed.has(x)).slice(0, IMPORTERS_PER_FILE)) importers.push({ path: i, of: p });
  }));
  importers.sort((a, b) => (a.of < b.of ? -1 : a.of > b.of ? 1 : a.path < b.path ? -1 : 1));
  const seenImporter = new Set<string>();
  const importersKept = importers.filter((i) => (seenImporter.has(i.path) ? false : (seenImporter.add(i.path), true))).slice(0, IMPORTERS_MAX);

  // Tests: those that cover the changed files first, then those that cover their importers. A changed test is a test to run.
  const own = files.filter(isTestPath);
  const direct = uniq(files.flatMap((p) => rows.get(p)?.tests ?? []));
  const viaImporters = uniq((await Promise.all(importersKept.slice(0, IMPORTER_TEST_LOOKUPS).map((i) => brain.testsFor(i.path)))).flat());
  const tests = uniq([...own, ...direct, ...viaImporters]).filter((t) => !changed.has(t) || own.includes(t)).slice(0, TESTS_MAX);

  const routes: PlanImpact["routes"] = [];
  const reads: PlanImpact["env"]["reads"] = [];
  const publicApi: PlanImpact["publicApi"] = [];
  const untested: string[] = [];
  const hot: string[] = [];
  const entries = new Set(opts.entryPoints ?? []);
  for (const p of files) {
    const r = rows.get(p);
    if (!r) continue;
    for (const s of r.symbols) {
      if (s.kind === "route") routes.push({ route: `${s.method ?? "ANY"} ${s.path ?? s.name}`, file: p });
      else if (s.kind === "env") reads.push({ name: s.name, file: p });
    }
    const used = usedBy.get(p) ?? 0;
    const ex = exportsOf(r);
    if ((used > 0 && ex.length > 0) || entries.has(p)) publicApi.push({ path: p, exports: ex.slice(0, 8), usedBy: used });
    if (classOf(p) === "source" && !isTestPath(p) && r.tests.length === 0 && changes.some((c) => c.path === p && c.action !== "create")) untested.push(p);
    if (r.hot >= 5 || r.todo >= 3) hot.push(p);
  }

  const features = await brain.features().catch(() => []);
  const touched = uniq(files.flatMap((p) => features.filter((f) => f.files.includes(p)).map((f) => f.name)));

  return {
    files, importers: importersKept, routes, tests,
    config: files.filter(isConfigPath), migrations: files.filter(isMigrationPath),
    env: { reads, exampleChanged: files.filter((p) => ENV_EXAMPLE.test(p)) },
    publicApi, untested, hot, features: touched,
  };
}

// --------------------------------------------------------------------- risk

const ORDER: readonly Level[] = ["low", "medium", "high"];
const max = (a: Level, b: Level): Level => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

/**
 * The risk of a plan: the classifier's view of the request (what the words
 * suggest), raised by what the graph says the change reaches. The reasons are
 * plain words, kept for the person and the PR.
 */
export function riskOf(base: Level, changes: readonly Change[], impact: PlanImpact): { risk: Level; reasons: string[] } {
  let risk = base;
  const reasons: string[] = [];
  const raise = (to: Level, why: string) => { risk = max(risk, to); reasons.push(why); };
  const paths = changes.map((c) => c.path);

  if (impact.migrations.length) raise("high", `changes the database (${impact.migrations.slice(0, 2).join(", ")})`);
  const money = paths.filter((p) => MONEY.test(p));
  if (money.length) raise("high", `touches payments (${money.slice(0, 2).join(", ")})`);
  const auth = paths.filter((p) => AUTH.test(p) && !MONEY.test(p));
  if (auth.length) raise("medium", `touches sign-in or security (${auth.slice(0, 2).join(", ")})`);
  if (impact.config.length) raise("medium", `changes project settings (${impact.config.slice(0, 3).join(", ")})`);
  if (impact.env.exampleChanged.length) raise("medium", "changes the environment variables the project expects");
  if (impact.routes.length) raise("medium", `changes ${impact.routes.length === 1 ? "an endpoint" : `${impact.routes.length} endpoints`} (${impact.routes.slice(0, 2).map((r) => r.route).join(", ")})`);
  const used = impact.publicApi.reduce((n, x) => n + x.usedBy, 0);
  if (used >= 15) raise("high", `changes code that ${used} other files use`);
  else if (used >= 5) raise("medium", `changes code that ${used} other files use`);
  if (impact.importers.length >= IMPORTERS_MAX) raise("high", "reaches a great many other files");
  else if (impact.importers.length >= 15) raise("medium", `reaches ${impact.importers.length} other files`);
  const deletes = changes.filter((c) => c.action === "delete");
  if (deletes.length >= 5) raise("medium", `deletes ${deletes.length} files`);
  else if (deletes.some((d) => impact.importers.some((i) => i.of === d.path))) raise("medium", "deletes a file other files import");
  if (impact.files.length > 25) raise("high", `changes ${impact.files.length} files`);
  else if (impact.files.length > 12) raise("medium", `changes ${impact.files.length} files`);
  const brittle = impact.hot.filter((p) => impact.untested.includes(p));
  if (brittle.length) raise("medium", `changes a file that keeps changing and has no test (${brittle[0]})`);
  return { risk, reasons };
}
